// ============================================================================
// tests/integration/phase15-fleet-operations.test.ts
// Phase 15 — Fastify + SQLite Fleet Operations API verification:
// seeded telemetry, proof-of-play ingest, alert rules, RBAC, verified backups,
// tamper-proof restore and audit/telemetry retention.
// ============================================================================

import { describe, expect, it } from 'vitest';
import { buildServerApp } from '../../server/app';

describe('Phase 15 — Fleet Operations REST API', () => {
  it('seeds deterministic demo telemetry and exposes it through the summary + overview endpoints', async () => {
    const { app } = await buildServerApp();
    try {
      const summaryRes = await app.inject({ method: 'GET', url: '/api/v1/operations/summary' });
      expect(summaryRes.statusCode).toBe(200);
      const summary = summaryRes.json();
      expect(summary.health.totals.total).toBeGreaterThanOrEqual(5);
      expect(summary.rules).toHaveLength(6);
      expect(summary.proofOfPlayToday.totals.plays).toBeGreaterThan(0);
      expect(summary.healthHistory.length).toBeGreaterThan(0);
      expect(Array.isArray(summary.backups)).toBe(true);
      expect(summary.backups).toHaveLength(0);

      const overviewRes = await app.inject({ method: 'GET', url: '/api/v1/server/overview' });
      expect(overviewRes.statusCode).toBe(200);
      const overview = overviewRes.json();
      expect(overview).toHaveProperty('activeFleetAlerts');
      expect(overview).toHaveProperty('proofOfPlayToday');
      expect(overview).toHaveProperty('lastBackupAtUtc');
      expect(overview.proofOfPlayToday).toBeGreaterThan(0);
    } finally {
      await app.close();
    }
  });

  it('ingests idempotent proof-of-play batches and aggregates them by device + scene', async () => {
    const { app } = await buildServerApp();
    try {
      const nowMs = Date.now();
      const event = {
        eventId: 'phase15-pop-001',
        deviceId: 'player-01',
        sceneId: 'scene-phase15',
        packageId: 'pkg-apex-lobby-v1',
        startedAtUtc: new Date(nowMs - 30_000).toISOString(),
        durationMs: 12_000,
        completionRatio: 1,
        offlineRecorded: true,
      };
      const ingest = await app.inject({
        method: 'POST',
        url: '/api/v1/operations/playback-events',
        payload: { events: [event, event] },
      });
      expect(ingest.statusCode).toBe(200);
      expect(ingest.json()).toMatchObject({ accepted: 1, duplicates: 1, rejected: [], clamped: 0 });

      const replay = await app.inject({
        method: 'POST',
        url: '/api/v1/operations/playback-events',
        payload: { events: [event] },
      });
      expect(replay.json()).toMatchObject({ accepted: 0, duplicates: 1 });

      const proofRes = await app.inject({
        method: 'GET',
        url: `/api/v1/operations/proof-of-play?groupBy=device-scene&fromUtc=${encodeURIComponent(new Date(nowMs - 60_000).toISOString())}`,
      });
      expect(proofRes.statusCode).toBe(200);
      const proof = proofRes.json();
      const row = proof.summary.rows.find((r: { key: string }) => r.key === 'player-01|scene-phase15');
      expect(row).toBeTruthy();
      expect(row.plays).toBe(1);
      expect(row.dwellMs).toBe(12_000);
      expect(proof.summary.totals.offlineEvents).toBeGreaterThanOrEqual(1);

      const oversized = await app.inject({
        method: 'POST',
        url: '/api/v1/operations/playback-events',
        payload: { events: new Array(1_001).fill(event) },
      });
      expect(oversized.statusCode).toBe(413);
    } finally {
      await app.close();
    }
  });

  it('grades health samples, raises deduplicated alerts, and acknowledges them idempotently', async () => {
    const { app } = await buildServerApp();
    try {
      const sample = {
        deviceId: 'player-01',
        sampleId: 'phase15-stalled-sample',
        playbackState: 'STALLED',
        status: 'ONLINE',
        driftMs: 780,
        estimatedFps: 9,
        errorCount: 3,
        clockUncertaintyMs: 12,
        currentSceneId: 'scene-welcome',
      };
      const report = await app.inject({
        method: 'POST',
        url: '/api/v1/operations/health-samples',
        payload: { samples: [sample, { deviceId: 'ghost-player', playbackState: 'PLAYING' }] },
      });
      expect(report.statusCode).toBe(200);
      expect(report.json()).toMatchObject({ accepted: 1, unknownDevices: 1, rejected: 0 });
      expect(report.json().createdAlerts).toBeGreaterThan(0);
      expect(report.json().health.devices.find((d: { deviceId: string }) => d.deviceId === 'player-01').state).toBe('CRITICAL');

      const alertsRes = await app.inject({ method: 'GET', url: '/api/v1/operations/alerts' });
      expect(alertsRes.statusCode).toBe(200);
      const alerts = alertsRes.json().alerts as Array<{ id: string; ruleType: string; deviceId: string; state: string }>;
      const stalled = alerts.find((a) => a.deviceId === 'player-01' && a.ruleType === 'PLAYBACK_STALLED');
      expect(stalled).toBeTruthy();

      const firstAck = await app.inject({
        method: 'POST',
        url: `/api/v1/operations/alerts/${encodeURIComponent(stalled!.id)}/acknowledge`,
        payload: {},
      });
      expect(firstAck.json()).toMatchObject({ acknowledged: true, alreadyAcknowledged: false });
      const secondAck = await app.inject({
        method: 'POST',
        url: `/api/v1/operations/alerts/${encodeURIComponent(stalled!.id)}/acknowledge`,
        payload: {},
      });
      expect(secondAck.json()).toMatchObject({ acknowledged: true, alreadyAcknowledged: true });
      const missingAck = await app.inject({
        method: 'POST',
        url: '/api/v1/operations/alerts/does-not-exist/acknowledge',
        payload: {},
      });
      expect(missingAck.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it('enforces RBAC on rule edits, backups and restore, while allowing operators to read', async () => {
    const { app } = await buildServerApp();
    try {
      const operatorRead = await app.inject({
        method: 'GET',
        url: '/api/v1/operations/summary',
        headers: { 'x-actor-role': 'operator' },
      });
      expect(operatorRead.statusCode).toBe(200);

      const forbiddenRule = await app.inject({
        method: 'PATCH',
        url: '/api/v1/operations/alert-rules/rule-clock-drift',
        headers: { 'x-actor-role': 'operator' },
        payload: { threshold: 500 },
      });
      expect(forbiddenRule.statusCode).toBe(403);

      const updatedRule = await app.inject({
        method: 'PATCH',
        url: '/api/v1/operations/alert-rules/rule-clock-drift',
        payload: { threshold: 500, enabled: false },
      });
      expect(updatedRule.statusCode).toBe(200);
      expect(updatedRule.json().rule).toMatchObject({ threshold: 500, enabled: false });

      const invalidRule = await app.inject({
        method: 'PATCH',
        url: '/api/v1/operations/alert-rules/rule-clock-drift',
        payload: { threshold: -1 },
      });
      expect(invalidRule.statusCode).toBe(400);

      const forbiddenBackup = await app.inject({
        method: 'POST',
        url: '/api/v1/operations/backups',
        headers: { 'x-actor-role': 'operator' },
        payload: {},
      });
      expect(forbiddenBackup.statusCode).toBe(403);

      const invalidCredential = await app.inject({
        method: 'POST',
        url: '/api/v1/operations/playback-events',
        headers: { authorization: 'Bearer invalid-token' },
        payload: { events: [] },
      });
      expect(invalidCredential.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('creates SHA-256 verified backups, rejects tampered restores, and applies retention', async () => {
    const { app, store } = await buildServerApp();
    try {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/operations/backups',
        payload: { retentionDays: 7 },
      });
      expect(createRes.statusCode).toBe(200);
      const { backup, sizeBytes } = createRes.json();
      expect(backup.checksum).toHaveLength(64);
      expect(backup.retentionDays).toBe(7);
      expect(sizeBytes).toBeGreaterThan(100);

      const getRes = await app.inject({
        method: 'GET',
        url: `/api/v1/operations/backups/${encodeURIComponent(backup.backupId)}`,
      });
      expect(getRes.statusCode).toBe(200);
      const { archive, verification } = getRes.json();
      expect(verification.valid).toBe(true);
      expect(JSON.stringify(archive)).not.toContain('devtok_');
      expect(archive.tables.some((t: { name: string }) => t.name === 'alert_rules')).toBe(true);

      // Tamper the stored archive payload: restore must refuse it.
      const tampered = JSON.parse(JSON.stringify(archive));
      const events = tampered.tables.find((t: { name: string }) => t.name === 'playback_events');
      if (events && events.rows.length > 0) events.rows[0].duration_ms = 1;
      store.db
        .prepare('UPDATE backups SET archive_json = ? WHERE id = ?')
        .run(JSON.stringify(tampered), backup.backupId);

      const rejected = await app.inject({
        method: 'POST',
        url: `/api/v1/operations/backups/${encodeURIComponent(backup.backupId)}/restore`,
        payload: {},
      });
      expect(rejected.statusCode).toBe(400);
      expect(rejected.json()).toMatchObject({ error: 'INTEGRITY_CHECK_FAILED' });

      // Repair the payload and restore only operational tables.
      store.db
        .prepare('UPDATE backups SET archive_json = ? WHERE id = ?')
        .run(JSON.stringify(archive), backup.backupId);
      const restored = await app.inject({
        method: 'POST',
        url: `/api/v1/operations/backups/${encodeURIComponent(backup.backupId)}/restore`,
        payload: {},
      });
      expect(restored.statusCode).toBe(200);
      expect(restored.json().restoredRows).toBeGreaterThan(0);
      expect(restored.json().checksum).toBe(backup.checksum);

      const missing = await app.inject({
        method: 'POST',
        url: '/api/v1/operations/backups/no-such-backup/restore',
        payload: {},
      });
      expect(missing.statusCode).toBe(404);

      const retention = await app.inject({
        method: 'POST',
        url: '/api/v1/operations/retention',
        payload: { maxAgeDays: 1, maxRows: 50 },
      });
      expect(retention.statusCode).toBe(200);
      expect(retention.json().pruned.playback_events.pruned).toBeGreaterThan(0);
      expect(retention.json().maxRows).toBe(50);

      const auditRes = await app.inject({ method: 'GET', url: '/api/v1/audit-log' });
      const actions = (auditRes.json().auditLog as Array<{ action: string }>).map((entry) => entry.action);
      expect(actions).toContain('FLEET_BACKUP_CREATED');
      expect(actions).toContain('FLEET_BACKUP_RESTORE_REJECTED');
      expect(actions).toContain('FLEET_BACKUP_RESTORED');
      expect(actions).toContain('FLEET_RETENTION_APPLIED');
    } finally {
      await app.close();
    }
  });
});
