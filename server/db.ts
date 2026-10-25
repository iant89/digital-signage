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
