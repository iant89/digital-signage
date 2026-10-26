// ============================================================================
// tests/unit/phase15-fleet-operations.test.ts
// Phase 15 — Proof-of-Play Aggregation, Fleet Health Alerting, Verified
// Backups & Retention (pure TypeScript domain package).
// ============================================================================

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ALERT_RULES,
  DeviceTelemetry,
  aggregateProofOfPlay,
  applyRetention,
  backupSizeBytes,
  buildBackupArchive,
  createDemoHealthSamples,
  createDemoPlaybackEvents,
  evaluateFleetHealth,
  normalizePlaybackEvents,
  parseUtcTime,
  summarizeHealthHistory,
  verifyBackupArchive,
} from '@packages/fleet-operations';

const NOW_MS = Date.parse('2026-10-26T12:00:00.000Z');
const iso = (offsetMs: number) => new Date(NOW_MS + offsetMs).toISOString();

describe('Phase 15.1 — Playback report normalization & proof-of-play aggregation', () => {
  it('validates, clamps, de-duplicates and sorts untrusted player batches', () => {
    const batch = normalizePlaybackEvents(
      [
        {
          eventId: 'evt-1',
          deviceId: 'player-01',
          sceneId: 'scene-welcome',
          startedAtUtc: iso(-20_000),
          durationMs: 10_000,
          completionRatio: 1,
        },
        {
          eventId: 'evt-1', // exact replay of an offline-buffered batch
          deviceId: 'player-01',
          sceneId: 'scene-welcome',
          startedAtUtc: iso(-20_000),
          durationMs: 10_000,
        },
        {
          eventId: 'evt-2',
          deviceId: 'player-01',
          sceneId: 'scene-welcome',
          startedAtUtc: iso(-9_000),
          durationMs: 10_000,
          offlineRecorded: true,
        },
        { eventId: 'evt-3', deviceId: '', sceneId: 'scene-x', startedAtUtc: iso(-5_000), durationMs: 1_000 },
        { eventId: 'evt-4', deviceId: 'player-02', sceneId: 'scene-x', startedAtUtc: iso(600_000), durationMs: 1_000 },
        { eventId: 'evt-5', deviceId: 'player-02', sceneId: 'scene-x', startedAtUtc: iso(-4_000), durationMs: 999_999_999 },
      ],
      { nowMs: NOW_MS, maxDurationMs: 60_000 }
    );

    expect(batch.events).toHaveLength(3);
    expect(batch.duplicates).toBe(1);
    expect(batch.rejected).toHaveLength(2); // empty deviceId + future timestamp
    expect(batch.clamped).toBe(1);
    expect(batch.events.map((e) => e.eventId)).toEqual(['evt-1', 'evt-2', 'evt-5']);
    expect(batch.events[1].offlineRecorded).toBe(true);
    // Old timestamps alone must not be mislabeled as offline-buffered reports.
    expect(batch.events[0].offlineRecorded).toBe(false);
    expect(batch.events[2].durationMs).toBe(60_000);
  });

  it('merges overlapping reports per device and clips to the requested UTC window', () => {
    const events = [
      { eventId: 'a', deviceId: 'd1', sceneId: 's1', startedAtUtc: iso(0), durationMs: 10_000 },
      { eventId: 'b', deviceId: 'd1', sceneId: 's1', startedAtUtc: iso(5_000), durationMs: 10_000 },
      { eventId: 'c', deviceId: 'd2', sceneId: 's1', startedAtUtc: iso(0), durationMs: 8_000 },
      { eventId: 'd', deviceId: 'd1', sceneId: 's2', startedAtUtc: iso(0), durationMs: 4_000 },
    ];

    const summary = aggregateProofOfPlay(events, { nowMs: NOW_MS + 60_000, groupBy: 'scene' });
    expect(summary.totals.plays).toBe(4);
    expect(summary.totals.dwellMs).toBe(32_000);
    // d1: [0,10] ∪ [5,15] ∪ [0,4] = 15s; d2: [0,8] = 8s.
    expect(summary.totals.coverageMs).toBe(23_000);
    expect(summary.totals.uniqueDevices).toBe(2);
    expect(summary.totals.uniqueScenes).toBe(2);
    const s1 = summary.rows.find((row) => row.key === 's1');
    expect(s1?.plays).toBe(3);
    expect(s1?.coverageMs).toBe(23_000); // 15s from d1 + 8s from d2
    expect(summary.daily[0].dayUtc).toBe('2026-10-26');
    expect(summary.daily[0].coverageMs).toBe(23_000);

    const clipped = aggregateProofOfPlay(events, {
      nowMs: NOW_MS + 60_000,
      fromUtc: iso(3_000),
      toUtc: iso(9_000),
      groupBy: 'scene',
    });
    expect(clipped.totals.plays).toBe(4);
    expect(clipped.totals.dwellMs).toBe(16_000); // 6s + 4s + 5s + 1s
    expect(clipped.totals.coverageMs).toBe(11_000); // d1 6s + d2 5s after merging
  });

  it('groups by device-scene, device and UTC day deterministically', () => {
    const summary = aggregateProofOfPlay(createDemoPlaybackEvents(NOW_MS, ['d1', 'd2'], 2), {
      nowMs: NOW_MS,
      groupBy: 'device-scene',
    });
    expect(summary.rows.every((row) => row.key.includes('|'))).toBe(true);
    expect(summary.rows[0].dwellMs).toBeGreaterThanOrEqual(summary.rows[1].dwellMs);
    expect(aggregateProofOfPlay(createDemoPlaybackEvents(NOW_MS, ['d1'], 2), { nowMs: NOW_MS, groupBy: 'day' }).rows).toHaveLength(1);
  });
});

describe('Phase 15.2 — Fleet health grading & deterministic alert rules', () => {
  const devices: DeviceTelemetry[] = [
    {
      deviceId: 'd1',
      name: 'Healthy Display',
      lastSeenAtUtc: iso(-1_000),
      status: 'ONLINE',
      playbackState: 'PLAYING',
      driftMs: 5,
      estimatedFps: 60,
    },
    {
      deviceId: 'd2',
      name: 'Drifted Display',
      lastSeenAtUtc: iso(-90_000),
      status: 'ONLINE',
      playbackState: 'PLAYING',
      driftMs: 312,
      estimatedFps: 50,
    },
    {
      deviceId: 'd3',
      name: 'Offline Display',
      lastSeenAtUtc: iso(-10 * 60_000),
      status: 'OFFLINE',
      playbackState: 'STALLED',
      driftMs: 0,
      estimatedFps: 0,
    },
  ];

  it('grades HEALTHY / DEGRADED / OFFLINE and raises stable alert IDs per cooldown bucket', () => {
    const report = evaluateFleetHealth({ devices }, NOW_MS);
    expect(report.devices.map((d) => d.state)).toEqual(['HEALTHY', 'DEGRADED', 'OFFLINE']);
    expect(report.totals).toMatchObject({ total: 3, healthy: 1, degraded: 1, offline: 1 });
    expect(report.totals.activeAlerts).toBeGreaterThanOrEqual(4);
    expect(report.alerts.some((a) => a.ruleType === 'HEARTBEAT_STALE' && a.deviceId === 'd2')).toBe(true);
    expect(report.alerts.some((a) => a.ruleType === 'CLOCK_DRIFT' && a.deviceId === 'd2')).toBe(true);
    expect(report.alerts.some((a) => a.ruleType === 'DEVICE_OFFLINE' && a.deviceId === 'd3')).toBe(true);

    const ids = report.alerts.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    const repeat = evaluateFleetHealth({ devices }, NOW_MS + 1_000);
    expect(repeat.alerts.map((a) => a.id).sort()).toEqual([...ids].sort());
  });

  it('honors disabled rules and critical drift thresholds', () => {
    const rules = DEFAULT_ALERT_RULES.map((rule) => ({ ...rule, enabled: rule.type === 'CLOCK_DRIFT' }));
    const report = evaluateFleetHealth({ devices: [devices[1]], rules }, NOW_MS);
    expect(report.alerts.every((alert) => alert.ruleType === 'CLOCK_DRIFT')).toBe(true);
    // Raw health grading still catches drift even when the alert rule is off.
    expect(report.devices[0].state).toBe('DEGRADED');

    const critical = evaluateFleetHealth(
      {
        devices: [{ ...devices[0], driftMs: 1_800 }],
        rules: [],
      },
      NOW_MS
    );
    expect(critical.devices[0].state).toBe('CRITICAL');
    expect(critical.totals.maxDriftMs).toBe(1_800);
  });

  it('summarizes health history and generates deterministic demo telemetry', () => {
    const samples = createDemoHealthSamples(NOW_MS, ['d1'], 4);
    const history = summarizeHealthHistory(samples, 24 * 3_600_000, NOW_MS);
    expect(history).toHaveLength(1);
    expect(history[0].samples).toBe(5);
    expect(history[0].history[0].recordedAtUtc).toBe(iso(-20 * 60_000));
    expect(createDemoPlaybackEvents(NOW_MS, ['d1'], 1)).toEqual(createDemoPlaybackEvents(NOW_MS, ['d1'], 1));
    expect(parseUtcTime('2026-10-26T12:00:00.000Z')).toBe(NOW_MS);
    expect(Number.isNaN(parseUtcTime('not-a-date'))).toBe(true);
  });
});

describe('Phase 15.3 — Verified backups, secret redaction & retention', () => {
  it('redacts secret columns and detects table or manifest tampering', () => {
    const archive = buildBackupArchive(
      [
        {
          name: 'users',
          rows: [
            { id: 'u1', username: 'admin', password_hash: 'ApexAdmin!2026', api_key: 'sk-secret' },
            { id: 'u2', username: 'operator', password_hash: 'ApexOperator!2026', token: 'devtok_xyz' },
          ],
        },
        { name: 'playback_events', rows: [{ id: 'p1', duration_ms: 10_000 }, { id: 'p2', duration_ms: 8_000 }] },
        {
          name: 'commands',
          rows: [{ id: 'c1', payload_json: JSON.stringify({ note: 'cached device token devtok_leaky123' }) }],
        },
      ],
      { createdBy: 'admin', createdAtUtc: iso(0), retentionDays: 7, backupId: 'backup-phase15-test' }
    );

    expect(archive.manifest.checksum).toHaveLength(64);
    expect(archive.manifest.tables).toHaveLength(3);
    expect(archive.manifest.expiresAtUtc).toBe(iso(7 * 86_400_000));
    const users = archive.tables.find((table) => table.name === 'users');
    expect(users?.rows[0].password_hash).toBe('[REDACTED]');
    expect(users?.rows[0].api_key).toBe('[REDACTED]');
    expect(JSON.stringify(archive)).not.toContain('ApexAdmin!2026');
    // Secrets embedded inside free-form JSON payload columns are redacted too.
    expect(JSON.stringify(archive)).not.toContain('devtok_leaky123');
    expect(backupSizeBytes(archive)).toBeGreaterThan(100);
    expect(verifyBackupArchive(archive)).toMatchObject({ valid: true, errors: [] });

    const tableTampered = JSON.parse(JSON.stringify(archive)) as typeof archive;
    const events = tableTampered.tables.find((table) => table.name === 'playback_events');
    if (events) events.rows[0].duration_ms = 1;
    const tableCheck = verifyBackupArchive(tableTampered);
    expect(tableCheck.valid).toBe(false);
    expect(tableCheck.errors.some((error) => error.includes('Checksum mismatch'))).toBe(true);

    const manifestTampered = JSON.parse(JSON.stringify(archive)) as typeof archive;
    manifestTampered.manifest.retentionDays = 365;
    expect(verifyBackupArchive(manifestTampered).valid).toBe(false);
    expect(verifyBackupArchive({ manifest: {} }).valid).toBe(false);
  });

  it('applies age + row-count retention while keeping pinned active alerts', () => {
    const items = [
      { id: 'old', ts: iso(-40 * 86_400_000), pinned: false },
      { id: 'recent-1', ts: iso(-1_000), pinned: false },
      { id: 'recent-2', ts: iso(-2_000), pinned: false },
      { id: 'pinned-old', ts: iso(-90 * 86_400_000), pinned: true },
    ];
    const result = applyRetention(items, {
      nowMs: NOW_MS,
      maxAgeMs: 30 * 86_400_000,
      maxRows: 2,
      getTimestamp: (item) => item.ts,
      isPinned: (item) => item.pinned,
    });
    expect(result.kept.map((item) => item.id).sort()).toEqual(['pinned-old', 'recent-1']);
    expect(result.pruned.map((item) => item.id).sort()).toEqual(['old', 'recent-2']);
    expect(result.byReason.expired).toBe(1);
    expect(result.byReason.overflow).toBe(1);
  });
});
