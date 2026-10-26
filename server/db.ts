// ============================================================================
// server/db.ts — SQLite Relational Database & Content-Addressed Package Store
// Implements all tables from Spec Section 32 + Seed Data & Transactional Ops
// ============================================================================

import { createRequire } from 'node:module';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { createStarterProject } from '@packages/project-model';
import { buildSignagePackage } from '@packages/signage-format';
import {
  AlertRule,
  BackupArchive,
  BackupTableSnapshot,
  DEFAULT_ALERT_RULES,
  DEMO_DEVICE_IDS,
  DeviceTelemetry,
  FleetAlert,
  HealthSample,
  NormalizedPlaybackEvent,
  applyRetention,
  createDemoHealthSamples,
  createDemoPlaybackEvents,
  normalizePlaybackEvents,
  playbackEventToWire,
} from '@packages/fleet-operations';
import { createId, sha256Hex } from '@packages/shared';

const requireNode = createRequire(import.meta.url);
const { DatabaseSync } = requireNode('node:sqlite') as {
  DatabaseSync: typeof DatabaseSyncType;
};

export interface ServerDatabaseOptions {
  dbPath?: string;
  storageDir?: string;
}

export class SignageManagementDatabase {
  public db: DatabaseSyncType;
  public storageDir: string;
  private memoryBlobs = new Map<string, Uint8Array>();

  constructor(options: ServerDatabaseOptions = {}) {
    const dbPath = options.dbPath ?? ':memory:';
    this.storageDir = options.storageDir ?? path.resolve(process.cwd(), '.storage/packages');
    fs.mkdirSync(this.storageDir, { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.initializeSchema();
    this.seedDefaultsIfEmpty();
    this.seedOperationalDefaultsIfEmpty();
  }

  private initializeSchema(): void {
    this.db.exec(`
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL,
        created_at TEXT NOT NULL,
        disabled_at TEXT
      );

      CREATE TABLE IF NOT EXISTS devices (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        location TEXT NOT NULL DEFAULT 'Main Building',
        assigned_display TEXT NOT NULL DEFAULT 'HDMI-1 (1920x1080)',
        os TEXT NOT NULL DEFAULT 'Linux Kiosk OS',
        status TEXT NOT NULL DEFAULT 'ONLINE',
        playback_state TEXT NOT NULL DEFAULT 'PLAYING',
        player_version TEXT NOT NULL DEFAULT '1.0.0',
        capabilities_json TEXT NOT NULL DEFAULT '{}',
        current_package_id TEXT,
        current_package_version INTEGER DEFAULT 1,
        current_scene_id TEXT DEFAULT 'scene-welcome',
        current_playlist_id TEXT DEFAULT 'playlist-main-loop',
        estimated_fps REAL DEFAULT 60,
        clock_offset_ms REAL DEFAULT 0,
        clock_uncertainty_ms REAL DEFAULT 8.5,
        drift_ms REAL DEFAULT 0,
        last_seen_at TEXT NOT NULL,
        configuration_revision INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS device_credentials (
        id TEXT PRIMARY KEY,
        device_id TEXT NOT NULL,
        credential_reference TEXT UNIQUE NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        revoked_at TEXT
      );

      CREATE TABLE IF NOT EXISTS enrollment_codes (
        code TEXT PRIMARY KEY,
        device_name TEXT NOT NULL,
        location TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        used_at TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS groups (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        topology TEXT NOT NULL DEFAULT 'SYNCHRONIZED_DISPLAYS',
        configuration_revision INTEGER NOT NULL DEFAULT 1,
        synchronization_policy TEXT NOT NULL DEFAULT 'DRIFT_CORRECTED',
        failure_policy TEXT NOT NULL DEFAULT 'START_WITH_AVAILABLE',
        default_package_id TEXT,
        default_playlist_id TEXT,
        timezone TEXT NOT NULL DEFAULT 'UTC',
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS group_members (
        group_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'member',
        viewport_col INTEGER DEFAULT 0,
        viewport_row INTEGER DEFAULT 0,
        PRIMARY KEY (group_id, device_id)
      );

      CREATE TABLE IF NOT EXISTS packages (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        version INTEGER NOT NULL,
        format_version INTEGER NOT NULL,
        content_hash TEXT NOT NULL,
        storage_reference TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        signature_status TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS playlists (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        revision INTEGER NOT NULL,
        configuration_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS schedules (
        id TEXT PRIMARY KEY,
        group_id TEXT NOT NULL,
        revision INTEGER NOT NULL,
        configuration_json TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        group_id TEXT NOT NULL,
        package_id TEXT NOT NULL,
        playlist_id TEXT NOT NULL,
        timeline_revision INTEGER NOT NULL DEFAULT 1,
        start_time_utc TEXT NOT NULL,
        status TEXT NOT NULL,
        paused_position_ms REAL,
        synchronization_policy TEXT NOT NULL DEFAULT 'DRIFT_CORRECTED',
        failure_policy TEXT NOT NULL DEFAULT 'START_WITH_AVAILABLE',
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS session_devices (
        session_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        readiness_state TEXT NOT NULL DEFAULT 'READY',
        last_reported_scene_id TEXT DEFAULT 'scene-welcome',
        last_reported_position REAL DEFAULT 0,
        expected_position REAL DEFAULT 0,
        drift_ms REAL DEFAULT 0,
        last_reported_at TEXT NOT NULL,
        PRIMARY KEY (session_id, device_id)
      );

      CREATE TABLE IF NOT EXISTS commands (
        id TEXT PRIMARY KEY,
        idempotency_key TEXT UNIQUE,
        target_device_id TEXT,
        target_group_id TEXT,
        command_type TEXT NOT NULL,
        payload_json TEXT NOT NULL DEFAULT '{}',
        issued_by TEXT NOT NULL DEFAULT 'admin',
        status TEXT NOT NULL DEFAULT 'RECEIVED',
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        device_id TEXT,
        event_type TEXT NOT NULL,
        payload_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS deployments (
        id TEXT PRIMARY KEY,
        package_id TEXT NOT NULL,
        target_group_id TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        completed_at TEXT
      );

      CREATE TABLE IF NOT EXISTS audit_log (
        id TEXT PRIMARY KEY,
        actor_id TEXT NOT NULL,
        action TEXT NOT NULL,
        target_type TEXT NOT NULL,
        target_id TEXT NOT NULL,
        details TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );

      -- Phase 15: Fleet Operations (proof-of-play, health telemetry, alerting,
      -- verified backups). These tables are append-mostly and restore-safe.
      CREATE TABLE IF NOT EXISTS playback_events (
        id TEXT PRIMARY KEY,
        event_key TEXT NOT NULL UNIQUE,
        device_id TEXT NOT NULL,
        scene_id TEXT NOT NULL,
        package_id TEXT NOT NULL DEFAULT '',
        started_at_utc TEXT NOT NULL,
        duration_ms REAL NOT NULL,
        completion_ratio REAL NOT NULL DEFAULT 1,
        offline_recorded INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_playback_events_started ON playback_events(started_at_utc);

      CREATE TABLE IF NOT EXISTS health_samples (
        id TEXT PRIMARY KEY,
        sample_key TEXT NOT NULL UNIQUE,
        device_id TEXT NOT NULL,
        recorded_at_utc TEXT NOT NULL,
        playback_state TEXT NOT NULL,
        status TEXT NOT NULL,
        drift_ms REAL NOT NULL DEFAULT 0,
        estimated_fps REAL NOT NULL DEFAULT 60,
        error_count REAL NOT NULL DEFAULT 0,
        clock_uncertainty_ms REAL NOT NULL DEFAULT 0,
        payload_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_health_samples_recorded ON health_samples(recorded_at_utc);

      CREATE TABLE IF NOT EXISTS alert_rules (
        id TEXT PRIMARY KEY,
        rule_type TEXT NOT NULL,
        threshold REAL NOT NULL,
        severity TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        cooldown_minutes REAL NOT NULL DEFAULT 15,
        description TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS fleet_alerts (
        id TEXT PRIMARY KEY,
        rule_id TEXT NOT NULL,
        rule_type TEXT NOT NULL,
        device_id TEXT NOT NULL,
        device_name TEXT NOT NULL DEFAULT '',
        severity TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'ACTIVE',
        message TEXT NOT NULL DEFAULT '',
        value REAL NOT NULL DEFAULT 0,
        threshold REAL NOT NULL DEFAULT 0,
        fingerprint TEXT NOT NULL,
        triggered_at_utc TEXT NOT NULL,
        acknowledged_at_utc TEXT,
        acknowledged_by TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_fleet_alerts_triggered ON fleet_alerts(triggered_at_utc);

      CREATE TABLE IF NOT EXISTS backups (
        id TEXT PRIMARY KEY,
        created_at_utc TEXT NOT NULL,
        created_by TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        checksum TEXT NOT NULL,
        archive_json TEXT NOT NULL
      );
    `);
  }

  public storePackageBytes(contentHash: string, bytes: Uint8Array): string {
    const fileRef = path.join(this.storageDir, `${contentHash}.signage`);
    this.memoryBlobs.set(contentHash, bytes);
    try {
      if (!fs.existsSync(fileRef)) {
        fs.writeFileSync(fileRef, bytes);
      }
    } catch {
      // Fallback to in-memory content-addressed store
    }
    return fileRef;
  }

  public readPackageBytes(contentHash: string): Uint8Array | null {
    const mem = this.memoryBlobs.get(contentHash);
    if (mem) return mem;
    const fileRef = path.join(this.storageDir, `${contentHash}.signage`);
    if (fs.existsSync(fileRef)) {
      const buf = fs.readFileSync(fileRef);
      const arr = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
      this.memoryBlobs.set(contentHash, arr);
      return arr;
    }
    return null;
  }

  public recordAudit(
    actorId: string,
    action: string,
    targetType: string,
    targetId: string,
    details = ''
  ): void {
    const stmt = this.db.prepare(`
      INSERT INTO audit_log (id, actor_id, action, target_type, target_id, details, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      createId('audit'),
      actorId,
      action,
      targetType,
      targetId,
      details,
      new Date().toISOString()
    );
  }

  public recordEvent(deviceId: string | null, eventType: string, payload: unknown): void {
    const stmt = this.db.prepare(`
      INSERT INTO events (id, device_id, event_type, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run(
      createId('evt'),
      deviceId,
      eventType,
      JSON.stringify(payload ?? {}),
      new Date().toISOString()
    );
  }

  // -------------------------------------------------------------------------
  // Phase 15: Fleet Operations persistence helpers
  // -------------------------------------------------------------------------

  public insertPlaybackEvents(events: NormalizedPlaybackEvent[]): { accepted: number; duplicates: number } {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO playback_events (
        id, event_key, device_id, scene_id, package_id, started_at_utc,
        duration_ms, completion_ratio, offline_recorded, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const now = new Date().toISOString();
    let accepted = 0;
    let duplicates = 0;
    for (const event of events) {
      const result = stmt.run(
        createId('pop'),
        event.eventId,
        event.deviceId,
        event.sceneId,
        event.packageId,
        event.startedAtUtc,
        event.durationMs,
        event.completionRatio,
        event.offlineRecorded ? 1 : 0,
        now
      );
      if (Number(result.changes) > 0) accepted += 1;
      else duplicates += 1;
    }
    return { accepted, duplicates };
  }

  public getPlaybackEvents(
    options: {
      fromUtc?: string;
      toUtc?: string;
      deviceId?: string;
      sceneId?: string;
      limit?: number;
    } = {}
  ): ReturnType<typeof playbackEventToWire>[] {
    const clauses = ['started_at_utc >= ?', 'started_at_utc <= ?'];
    const params: Array<string> = [options.fromUtc ?? '0000-01-01T00:00:00.000Z', options.toUtc ?? '9999-12-31T23:59:59.999Z'];
    if (options.deviceId) {
      clauses.push('device_id = ?');
      params.push(options.deviceId);
    }
    if (options.sceneId) {
      clauses.push('scene_id = ?');
      params.push(options.sceneId);
    }
    const limit = Math.max(1, Math.min(20_000, Math.round(options.limit ?? 20_000)));
    const rows = this.db
      .prepare(`SELECT * FROM playback_events WHERE ${clauses.join(' AND ')} ORDER BY started_at_utc ASC LIMIT ${limit}`)
      .all(...params) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      eventId: String(row.event_key),
      deviceId: String(row.device_id),
      sceneId: String(row.scene_id),
      packageId: String(row.package_id ?? ''),
      startedAtUtc: String(row.started_at_utc),
      durationMs: Number(row.duration_ms),
      completionRatio: Number(row.completion_ratio),
      offlineRecorded: Number(row.offline_recorded) === 1,
    }));
  }

  public insertHealthSample(sample: HealthSample & { currentSceneId?: string; currentPackageId?: string }): boolean {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO health_samples (
        id, sample_key, device_id, recorded_at_utc, playback_state, status,
        drift_ms, estimated_fps, error_count, clock_uncertainty_ms, payload_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      createId('hs'),
      sample.sampleId,
      sample.deviceId,
      sample.recordedAtUtc,
      sample.playbackState,
      sample.status,
      sample.driftMs,
      sample.estimatedFps,
      sample.errorCount,
      sample.clockUncertaintyMs,
      JSON.stringify({
        currentSceneId: sample.currentSceneId ?? '',
        currentPackageId: sample.currentPackageId ?? '',
      }),
      new Date().toISOString()
    );
    return Number(result.changes) > 0;
  }

  public getHealthSamples(limit = 2_000): HealthSample[] {
    const rows = this.db
      .prepare(`SELECT * FROM health_samples ORDER BY recorded_at_utc DESC LIMIT ${Math.max(1, Math.min(20_000, Math.round(limit)))}`)
      .all() as Array<Record<string, unknown>>;
    return rows
      .map((row) => {
        let payload: Record<string, unknown> = {};
        try {
          payload = JSON.parse(String(row.payload_json || '{}')) as Record<string, unknown>;
        } catch {
          payload = {};
        }
        return {
          sampleId: String(row.sample_key),
          deviceId: String(row.device_id),
          recordedAtUtc: String(row.recorded_at_utc),
          playbackState: String(row.playback_state),
          status: String(row.status),
          driftMs: Number(row.drift_ms),
          estimatedFps: Number(row.estimated_fps),
          errorCount: Number(row.error_count),
          clockUncertaintyMs: Number(row.clock_uncertainty_ms),
          currentSceneId: typeof payload.currentSceneId === 'string' ? payload.currentSceneId : undefined,
          currentPackageId: typeof payload.currentPackageId === 'string' ? payload.currentPackageId : undefined,
        };
      })
      .reverse();
  }

  public listAlertRules(): AlertRule[] {
    const rows = this.db.prepare('SELECT * FROM alert_rules ORDER BY id ASC').all() as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: String(row.id),
      type: String(row.rule_type) as AlertRule['type'],
      threshold: Number(row.threshold),
      severity: String(row.severity) as AlertRule['severity'],
      enabled: Number(row.enabled) === 1,
      cooldownMinutes: Number(row.cooldown_minutes),
      description: String(row.description),
    }));
  }

  public upsertAlertRule(rule: AlertRule): void {
    this.db
      .prepare(`
        INSERT INTO alert_rules (id, rule_type, threshold, severity, enabled, cooldown_minutes, description, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          rule_type = excluded.rule_type,
          threshold = excluded.threshold,
          severity = excluded.severity,
          enabled = excluded.enabled,
          cooldown_minutes = excluded.cooldown_minutes,
          description = excluded.description,
          updated_at = excluded.updated_at
      `)
      .run(
        rule.id,
        rule.type,
        rule.threshold,
        rule.severity,
        rule.enabled ? 1 : 0,
        rule.cooldownMinutes,
        rule.description,
        new Date().toISOString()
      );
  }

  public saveFleetAlerts(alerts: FleetAlert[]): number {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO fleet_alerts (
        id, rule_id, rule_type, device_id, device_name, severity, state,
        message, value, threshold, fingerprint, triggered_at_utc
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    let created = 0;
    for (const alert of alerts) {
      const result = stmt.run(
        alert.id,
        alert.ruleId,
        alert.ruleType,
        alert.deviceId,
        alert.deviceName,
        alert.severity,
        alert.state,
        alert.message,
        alert.value,
        alert.threshold,
        alert.fingerprint,
        alert.triggeredAtUtc
      );
      if (Number(result.changes) > 0) created += 1;
    }
    return created;
  }

  public listFleetAlerts(limit = 250): FleetAlert[] {
    const rows = this.db
      .prepare(`SELECT * FROM fleet_alerts ORDER BY triggered_at_utc DESC LIMIT ${Math.max(1, Math.min(2_000, Math.round(limit)))}`)
      .all() as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: String(row.id),
      ruleId: String(row.rule_id),
      ruleType: String(row.rule_type) as FleetAlert['ruleType'],
      deviceId: String(row.device_id),
      deviceName: String(row.device_name),
      severity: String(row.severity) as FleetAlert['severity'],
      state: String(row.state) as FleetAlert['state'],
      message: String(row.message),
      value: Number(row.value),
      threshold: Number(row.threshold),
      triggeredAtUtc: String(row.triggered_at_utc),
      acknowledgedAtUtc: row.acknowledged_at_utc ? String(row.acknowledged_at_utc) : undefined,
      acknowledgedBy: row.acknowledged_by ? String(row.acknowledged_by) : undefined,
      fingerprint: String(row.fingerprint),
    }));
  }

  public acknowledgeFleetAlert(alertId: string, actorId: string): boolean {
    const result = this.db
      .prepare(`UPDATE fleet_alerts SET state = 'ACKNOWLEDGED', acknowledged_at_utc = ?, acknowledged_by = ? WHERE id = ? AND state = 'ACTIVE'`)
      .run(new Date().toISOString(), actorId, alertId);
    return Number(result.changes) > 0;
  }

  /** Merge latest device rows + failed-command counters for health evaluation. */
  public getFleetTelemetry(): DeviceTelemetry[] {
    const devices = this.db.prepare('SELECT * FROM devices ORDER BY id ASC').all() as Array<Record<string, unknown>>;
    const failures = this.db
      .prepare(`SELECT target_device_id as device_id, COUNT(*) as cnt FROM commands WHERE status IN ('FAILED', 'REJECTED') GROUP BY target_device_id`)
      .all() as Array<{ device_id: string; cnt: number }>;
    const failureMap = new Map(failures.map((f) => [f.device_id, Number(f.cnt)]));
    return devices.map((row) => ({
      deviceId: String(row.id),
      name: String(row.name),
      lastSeenAtUtc: String(row.last_seen_at),
      status: String(row.status),
      playbackState: String(row.playback_state),
      driftMs: Number(row.drift_ms ?? 0),
      estimatedFps: Number(row.estimated_fps ?? 60),
      clockUncertaintyMs: Number(row.clock_uncertainty_ms ?? 0),
      commandFailures: failureMap.get(String(row.id)) ?? 0,
      currentPackageId: row.current_package_id ? String(row.current_package_id) : undefined,
      currentSceneId: row.current_scene_id ? String(row.current_scene_id) : undefined,
    }));
  }

  /** Tables included in an operational backup — credential tables are excluded. */
  public getBackupTables(): BackupTableSnapshot[] {
    const names = [
      'devices',
      'groups',
      'group_members',
      'playlists',
      'schedules',
      'sessions',
      'deployments',
      'commands',
      'events',
      'audit_log',
      'playback_events',
      'health_samples',
      'alert_rules',
      'fleet_alerts',
    ];
    return names.map((name) => ({
      name,
      rows: this.db.prepare(`SELECT * FROM ${name}`).all() as Array<Record<string, unknown>>,
    }));
  }

  public insertBackup(archive: BackupArchive, sizeBytes: number): void {
    this.db
      .prepare(`INSERT OR REPLACE INTO backups (id, created_at_utc, created_by, size_bytes, checksum, archive_json) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(
        archive.manifest.backupId,
        archive.manifest.createdAtUtc,
        archive.manifest.createdBy,
        sizeBytes,
        archive.manifest.checksum,
        JSON.stringify(archive)
      );
  }

  public listBackups(): Array<Record<string, unknown>> {
    return this.db
      .prepare('SELECT id, created_at_utc, created_by, size_bytes, checksum FROM backups ORDER BY created_at_utc DESC LIMIT 100')
      .all() as Array<Record<string, unknown>>;
  }

  public getBackup(backupId: string): BackupArchive | null {
    const row = this.db.prepare('SELECT archive_json FROM backups WHERE id = ?').get(backupId) as
      | { archive_json: string }
      | undefined;
    if (!row) return null;
    try {
      return JSON.parse(row.archive_json) as BackupArchive;
    } catch {
      return null;
    }
  }

  /** Restore only operational telemetry tables; never touches secrets or packages. */
  public restoreBackupTables(archive: BackupArchive): number {
    const allowed: Record<string, string[]> = {
      playback_events: [
        'id', 'event_key', 'device_id', 'scene_id', 'package_id', 'started_at_utc',
        'duration_ms', 'completion_ratio', 'offline_recorded', 'created_at',
      ],
      health_samples: [
        'id', 'sample_key', 'device_id', 'recorded_at_utc', 'playback_state', 'status',
        'drift_ms', 'estimated_fps', 'error_count', 'clock_uncertainty_ms', 'payload_json', 'created_at',
      ],
      alert_rules: ['id', 'rule_type', 'threshold', 'severity', 'enabled', 'cooldown_minutes', 'description', 'updated_at'],
      fleet_alerts: [
        'id', 'rule_id', 'rule_type', 'device_id', 'device_name', 'severity', 'state',
        'message', 'value', 'threshold', 'fingerprint', 'triggered_at_utc', 'acknowledged_at_utc', 'acknowledged_by',
      ],
    };
    const toSqlValue = (value: unknown): string | number | null => {
      if (value === null || value === undefined) return null;
      if (typeof value === 'number' && Number.isFinite(value)) return value;
      if (typeof value === 'boolean') return value ? 1 : 0;
      if (typeof value === 'string') return value;
      return JSON.stringify(value);
    };

    let restored = 0;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      for (const table of archive.tables) {
        const columns = allowed[table.name];
        if (!columns) continue;
        this.db.exec(`DELETE FROM ${table.name}`);
        const stmt = this.db.prepare(
          `INSERT OR REPLACE INTO ${table.name} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`
        );
        for (const row of table.rows) {
          stmt.run(...columns.map((column) => toSqlValue(row[column])));
          restored += 1;
        }
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return restored;
  }

  /** Audit/event/telemetry retention (Spec Section 34) with pinned active alerts. */
  public pruneOperationalData(
    options: { nowMs?: number; maxAgeMs?: number; maxRows?: number } = {}
  ): Record<string, { pruned: number; expired: number; overflow: number }> {
    const specs: Array<{ table: string; timeColumn: string; pinned?: (row: Record<string, unknown>) => boolean }> = [
      { table: 'playback_events', timeColumn: 'started_at_utc' },
      { table: 'health_samples', timeColumn: 'recorded_at_utc' },
      { table: 'fleet_alerts', timeColumn: 'triggered_at_utc', pinned: (row) => row.state === 'ACTIVE' },
      { table: 'events', timeColumn: 'created_at' },
      { table: 'audit_log', timeColumn: 'created_at' },
    ];
    const result: Record<string, { pruned: number; expired: number; overflow: number }> = {};
    for (const spec of specs) {
      const rows = this.db
        .prepare(`SELECT id, ${spec.timeColumn} as ts FROM ${spec.table}`)
        .all() as Array<Record<string, unknown>>;
      const retention = applyRetention(rows, {
        nowMs: options.nowMs,
        maxAgeMs: options.maxAgeMs,
        maxRows: options.maxRows,
        getTimestamp: (row) => String(row.ts),
        isPinned: spec.pinned,
      });
      const deleteStmt = this.db.prepare(`DELETE FROM ${spec.table} WHERE id = ?`);
      for (const row of retention.pruned) deleteStmt.run(String(row.id));
      result[spec.table] = {
        pruned: retention.pruned.length,
        expired: retention.byReason.expired,
        overflow: retention.byReason.overflow,
      };
    }
    return result;
  }

  private seedOperationalDefaultsIfEmpty(): void {
    const nowMs = Date.now();
    const deviceRows = this.db.prepare('SELECT id FROM devices ORDER BY id ASC LIMIT 6').all() as Array<{ id: string }>;
    const deviceIds = deviceRows.length ? deviceRows.map((d) => d.id) : DEMO_DEVICE_IDS;

    const ruleCount = this.db.prepare('SELECT COUNT(*) as cnt FROM alert_rules').get() as { cnt: number };
    if (Number(ruleCount.cnt) === 0) {
      for (const rule of DEFAULT_ALERT_RULES) this.upsertAlertRule(rule);
    }

    const eventCount = this.db.prepare('SELECT COUNT(*) as cnt FROM playback_events').get() as { cnt: number };
    if (Number(eventCount.cnt) === 0) {
      const normalized = normalizePlaybackEvents(createDemoPlaybackEvents(nowMs, deviceIds, 8), { nowMs });
      this.insertPlaybackEvents(normalized.events);
    }

    const sampleCount = this.db.prepare('SELECT COUNT(*) as cnt FROM health_samples').get() as { cnt: number };
    if (Number(sampleCount.cnt) === 0) {
      for (const sample of createDemoHealthSamples(nowMs, deviceIds, 12)) this.insertHealthSample(sample);
    }
  }

  private seedDefaultsIfEmpty(): void {
    const countRow = this.db.prepare('SELECT COUNT(*) as cnt FROM users').get() as { cnt: number };
    if (countRow.cnt > 0) return;

    const now = new Date().toISOString();

    // 1. Seed default administrator & operator accounts
    const insertUser = this.db.prepare(`
      INSERT INTO users (id, username, password_hash, role, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    insertUser.run('user-admin-01', 'admin', sha256Hex('ApexAdmin!2026'), 'admin', now);
    insertUser.run('user-op-01', 'operator', sha256Hex('ApexOperator!2026'), 'operator', now);

    // 2. Build starter .signage package & store in content-addressed storage
    const starterProject = createStarterProject();
    const builtPkg = buildSignagePackage(starterProject, {
      profile: 'compact',
      signPackage: true,
      publisherName: 'Apex Broadcast Authority',
    });
    const storageRef = this.storePackageBytes(builtPkg.packageHashHex, builtPkg.bytes);

    this.db
      .prepare(
        `INSERT INTO packages (id, name, version, format_version, content_hash, storage_reference, size_bytes, signature_status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        'pkg-apex-lobby-v1',
        starterProject.settings.name,
        1,
        1,
        builtPkg.packageHashHex,
        storageRef,
        builtPkg.bytes.byteLength,
        'VERIFIED',
        now
      );

    // 3. Seed groups
    const insertGroup = this.db.prepare(`
      INSERT INTO groups (id, name, description, topology, configuration_revision, synchronization_policy, failure_policy, default_package_id, default_playlist_id, timezone, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insertGroup.run(
      'group-lobby-wall',
      'Main Lobby 2×2 Video Wall',
      'Four synchronized 55-inch narrow-bezel displays in North Atrium Concourse',
      'MULTI_SCREEN_VIDEO_WALL',
      1,
      'DRIFT_CORRECTED',
      'START_WITH_AVAILABLE',
      'pkg-apex-lobby-v1',
      'playlist-main-loop',
      'America/New_York',
      now
    );
    insertGroup.run(
      'group-cafe-menus',
      'Sky Café Menu Boards',
      'Synchronized hospitality menu boards in Building A Roastery',
      'SYNCHRONIZED_PLAYLISTS',
      1,
      'TIMELINE_SYNC',
      'START_WITH_AVAILABLE',
      'pkg-apex-lobby-v1',
      'playlist-main-loop',
      'America/New_York',
      now
    );
    insertGroup.run(
      'group-reception',
      'Executive Reception Kiosks',
      'Independent lobby directory and visitor check-in displays',
      'INDEPENDENT_GROUP',
      1,
      'SCHEDULE_SYNC',
      'WAIT_FOR_ALL',
      'pkg-apex-lobby-v1',
      'playlist-main-loop',
      'America/New_York',
      now
    );

    // 4. Seed 6 registered players (5 in sync group + 1 reception)
    const players = [
      { id: 'player-01', name: 'Lobby Wall — Top Left (P01)', loc: 'North Atrium', disp: 'DP-1 (1920x1080)', os: 'Linux Kiosk Ubuntu 24.04', group: 'group-lobby-wall', role: 'leader', col: 0, row: 0, offset: 4.2, drift: 8 },
      { id: 'player-02', name: 'Lobby Wall — Top Right (P02)', loc: 'North Atrium', disp: 'DP-2 (1920x1080)', os: 'Linux Kiosk Ubuntu 24.04', group: 'group-lobby-wall', role: 'member', col: 1, row: 0, offset: -6.1, drift: -11 },
      { id: 'player-03', name: 'Lobby Wall — Bottom Left (P03)', loc: 'North Atrium', disp: 'DP-3 (1920x1080)', os: 'Linux Kiosk Ubuntu 24.04', group: 'group-lobby-wall', role: 'member', col: 0, row: 1, offset: 2.8, drift: 5 },
      { id: 'player-04', name: 'Lobby Wall — Bottom Right (P04)', loc: 'North Atrium', disp: 'DP-4 (1920x1080)', os: 'Linux Kiosk Ubuntu 24.04', group: 'group-lobby-wall', role: 'member', col: 1, row: 1, offset: -3.5, drift: -7 },
      { id: 'player-05', name: 'Sky Café Counter Board (P05)', loc: 'Sky Roastery', disp: 'HDMI-1 (1920x1080)', os: 'Windows 11 IoT Enterprise', group: 'group-lobby-wall', role: 'member', col: 0, row: 0, offset: 9.4, drift: 14 },
      { id: 'player-06', name: 'Building A Reception Stand (P06)', loc: 'West Entrance', disp: 'HDMI-1 (1080x1920)', os: 'Linux Kiosk Ubuntu 24.04', group: 'group-reception', role: 'leader', col: 0, row: 0, offset: 5.0, drift: 3 },
    ];

    const insertDevice = this.db.prepare(`
      INSERT INTO devices (
        id, name, location, assigned_display, os, status, playback_state,
        player_version, capabilities_json, current_package_id, current_package_version,
        current_scene_id, current_playlist_id, estimated_fps, clock_offset_ms,
        clock_uncertainty_ms, drift_ms, last_seen_at, configuration_revision, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertCred = this.db.prepare(`
      INSERT INTO device_credentials (id, device_id, credential_reference, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?)
    `);

    const insertMember = this.db.prepare(`
      INSERT INTO group_members (group_id, device_id, role, viewport_col, viewport_row)
      VALUES (?, ?, ?, ?, ?)
    `);

    for (const p of players) {
      insertDevice.run(
        p.id,
        p.name,
        p.loc,
        p.disp,
        p.os,
        'ONLINE',
        'PLAYING',
        '1.0.0',
        JSON.stringify({ codecs: ['h264', 'vp9', 'webp', 'svg'], maxResolution: '3840x2160', hardwareAccel: true }),
        'pkg-apex-lobby-v1',
        1,
        'scene-welcome',
        'playlist-main-loop',
        60,
        p.offset,
        6.5,
        p.drift,
        now,
        1,
        now
      );

      insertCred.run(
        `cred-${p.id}`,
        p.id,
        `devtok_${p.id}_${sha256Hex(p.id).slice(0, 16)}`,
        now,
        new Date(Date.now() + 365 * 86400_000).toISOString()
      );

      insertMember.run(p.group, p.id, p.role, p.col, p.row);
    }

    // 5. Seed playlist & schedule
    const pl = starterProject.playlists[0];
    this.db
      .prepare('INSERT INTO playlists (id, name, revision, configuration_json, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(pl.id, pl.name, pl.revision, JSON.stringify(pl), now);

    const sched = starterProject.schedules[0];
    this.db
      .prepare('INSERT INTO schedules (id, group_id, revision, configuration_json, enabled) VALUES (?, ?, ?, ?, ?)')
      .run(sched.id, 'group-lobby-wall', sched.revision, JSON.stringify(sched), 1);

    // 6. Seed an active synchronized playback session
    const sessionStartIso = new Date(Date.now() - 18_000).toISOString();
    const sessionId = 'session-20261025-001';
    this.db
      .prepare(`
        INSERT INTO sessions (
          id, group_id, package_id, playlist_id, timeline_revision, start_time_utc,
          status, synchronization_policy, failure_policy, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        sessionId,
        'group-lobby-wall',
        'pkg-apex-lobby-v1',
        'playlist-main-loop',
        1,
        sessionStartIso,
        'RUNNING',
        'DRIFT_CORRECTED',
        'START_WITH_AVAILABLE',
        now
      );

    const insertSessionDevice = this.db.prepare(`
      INSERT INTO session_devices (
        session_id, device_id, readiness_state, last_reported_scene_id,
        last_reported_position, expected_position, drift_ms, last_reported_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const p of players.filter((x) => x.group === 'group-lobby-wall')) {
      insertSessionDevice.run(sessionId, p.id, 'READY', 'scene-welcome', 6000 + p.drift, 6000, p.drift, now);
    }

    // 7. Seed deployment & enrollment code
    this.db
      .prepare('INSERT INTO deployments (id, package_id, target_group_id, status, created_at, completed_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run('deploy-initial-01', 'pkg-apex-lobby-v1', 'group-lobby-wall', 'COMPLETED', now, now);

    this.db
      .prepare('INSERT INTO enrollment_codes (code, device_name, location, expires_at, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(
        'ENROLL-APEX-2026',
        'East Wing Kiosk #07',
        'East Concourse',
        new Date(Date.now() + 24 * 3600_000).toISOString(),
        now
      );

    this.recordAudit('user-admin-01', 'SERVER_INITIALIZED', 'server', 'main', 'Initialized database and seeded default signage topology');
    this.recordEvent('player-01', 'SESSION_STARTED', { sessionId, groupId: 'group-lobby-wall' });
  }
}
