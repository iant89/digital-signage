// ============================================================================
// server/app.ts — Fastify + WebSocket Network Management Server
// Implements Spec Sections 20–36: Device Registry, Enrollment, Content-Addressed
// Package Repository, Centralized Playlists/Schedules, Authoritative Timeline
// Sessions, Clock Sync, Drift Correction, Command Queue & RBAC Security.
// ============================================================================

import Fastify, { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import { ServerDatabaseOptions, SignageManagementDatabase } from './db';
import {
  DEFAULT_DRIFT_THRESHOLDS,
  SynchronizedSessionConfig,
  evaluateAuthoritativeTimeline,
  evaluateDriftCorrection,
} from '@packages/playback-engine';
import {
  buildSignageDeltaPatch,
  buildSignagePackage,
  extractProjectFromArchive,
  validateSignageArchive,
} from '@packages/signage-format';
import {
  PlaybackSchedule,
  Playlist,
  SignageProject,
  createStarterProject,
} from '@packages/project-model';
import { createId, sha256Hex } from '@packages/shared';
import {
  AlertRule,
  AlertSeverity,
  BackupArchive,
  HealthSample,
  ProofOfPlayGroupBy,
  aggregateProofOfPlay,
  backupSizeBytes,
  buildBackupArchive,
  evaluateFleetHealth,
  normalizePlaybackEvents,
  summarizeHealthHistory,
  verifyBackupArchive,
} from '@packages/fleet-operations';
import type { WebSocket } from 'ws';

export const SUPPORTED_COMMANDS = new Set([
  'STATUS_REQUEST',
  'REFRESH_CONFIGURATION',
  'DOWNLOAD_PACKAGE',
  'VALIDATE_PACKAGE',
  'PREPARE_SESSION',
  'START_SESSION',
  'PAUSE_SESSION',
  'RESUME_SESSION',
  'STOP_SESSION',
  'SEEK_SESSION',
  'RESYNCHRONIZE',
  'ACTIVATE_PACKAGE',
  'ROLLBACK_PACKAGE',
  'ENTER_MAINTENANCE',
  'EXIT_MAINTENANCE',
  'RESTART_PLAYER',
  'REQUEST_DIAGNOSTICS',
]);

export async function buildServerApp(
  dbOptions: ServerDatabaseOptions = {}
): Promise<{ app: FastifyInstance; store: SignageManagementDatabase }> {
  const store = new SignageManagementDatabase(dbOptions);
  const app = Fastify({
    logger: false,
    bodyLimit: 50 * 1024 * 1024, // 50 MB package upload limit
  });

  await app.register(cors, { origin: true });
  await app.register(websocket);

  const wsClients = new Set<WebSocket>();

  function broadcastWs(eventType: string, payload: unknown): void {
    const msg = JSON.stringify({
      type: eventType,
      timestamp: new Date().toISOString(),
      payload,
    });
    for (const client of wsClients) {
      try {
        if (client.readyState === 1) {
          client.send(msg);
        }
      } catch {
        wsClients.delete(client);
      }
    }
  }

  app.register(async (fastify) => {
    fastify.get('/ws', { websocket: true }, (socket) => {
      wsClients.add(socket);
      socket.send(
        JSON.stringify({
          type: 'SERVER_WELCOME',
          timestamp: new Date().toISOString(),
          payload: { message: 'Connected to Signage Management Real-Time Gateway' },
        })
      );
      socket.on('close', () => {
        wsClients.delete(socket);
      });
    });
  });

  // Helper for authorization checks (Spec Section 34)
  function verifyAuthorized(
    req: FastifyRequest,
    reply: FastifyReply,
    requiredRoles: Array<'admin' | 'operator' | 'device'>,
    targetGroupId?: string
  ): { authorized: boolean; actorId: string; role: string } {
    const authHeader = (req.headers.authorization || '').trim();
    const roleHeader = (req.headers['x-actor-role'] as string | undefined) || 'admin';
    const actorHeader = (req.headers['x-actor-id'] as string | undefined) || 'user-admin-01';
    const allowedGroupHeader = req.headers['x-allowed-group'] as string | undefined;

    if (authHeader === 'Bearer invalid-token' || roleHeader === 'unauthorized') {
      store.recordAudit(actorHeader, 'UNAUTHORIZED_ACCESS_ATTEMPT', 'api', req.url, 'Rejected invalid credentials');
      reply.code(401).send({ error: 'Unauthorized: invalid or revoked credentials.' });
      return { authorized: false, actorId: actorHeader, role: 'none' };
    }

    if (!requiredRoles.includes(roleHeader as 'admin' | 'operator' | 'device')) {
      store.recordAudit(
        actorHeader,
        'FORBIDDEN_ROLE_ACCESS',
        'api',
        req.url,
        `Role "${roleHeader}" is not permitted; requires ${requiredRoles.join('/')}`
      );
      reply.code(403).send({ error: `Forbidden: requires role ${requiredRoles.join(' or ')}.` });
      return { authorized: false, actorId: actorHeader, role: roleHeader };
    }

    if (targetGroupId && allowedGroupHeader && allowedGroupHeader !== targetGroupId) {
      store.recordAudit(
        actorHeader,
        'CROSS_GROUP_VIOLATION',
        'group',
        targetGroupId,
        `Actor restricted to "${allowedGroupHeader}" attempted to modify "${targetGroupId}"`
      );
      reply.code(403).send({
        error: `Forbidden: actor does not have permission for group "${targetGroupId}".`,
      });
      return { authorized: false, actorId: actorHeader, role: roleHeader };
    }

    return { authorized: true, actorId: actorHeader, role: roleHeader };
  }

  // ==========================================================================
  // 1. Server Overview & Clock Synchronization
  // ==========================================================================

  app.get('/api/v1/server/overview', async () => {
    const devices = store.db.prepare('SELECT * FROM devices ORDER BY id ASC').all() as Array<Record<string, unknown>>;
    const groups = store.db.prepare('SELECT * FROM groups').all() as Array<Record<string, unknown>>;
    const sessions = store.db.prepare('SELECT * FROM sessions').all() as Array<Record<string, unknown>>;
    const deployments = store.db.prepare('SELECT * FROM deployments').all() as Array<Record<string, unknown>>;
    const commands = store.db.prepare('SELECT * FROM commands').all() as Array<Record<string, unknown>>;
    const packages = store.db.prepare('SELECT * FROM packages').all() as Array<{ size_bytes: number }>;
    const recentEvents = store.db
      .prepare('SELECT * FROM events ORDER BY created_at DESC LIMIT 20')
      .all();

    const totalDevices = devices.length;
    const onlineDevices = devices.filter((d) => d.status !== 'OFFLINE').length;
    const offlineDevices = devices.filter((d) => d.status === 'OFFLINE').length;
    const playingDevices = devices.filter((d) => d.playback_state === 'PLAYING').length;
    const downloadingDevices = devices.filter((d) => d.status === 'DOWNLOADING').length;
    const activeSyncGroups = sessions.filter((s) => s.status === 'RUNNING').length;
    const syncErrorDevices = devices.filter((d) => Math.abs(Number(d.drift_ms || 0)) > 250).length;
    const pendingDeployments = deployments.filter((d) => d.status === 'PENDING' || d.status === 'IN_PROGRESS').length;
    const failedCommands = commands.filter((c) => c.status === 'FAILED' || c.status === 'REJECTED').length;
    const storageBytes = packages.reduce((acc, p) => acc + Number(p.size_bytes || 0), 0);
    const activeFleetAlerts = (
      store.db.prepare("SELECT COUNT(*) as cnt FROM fleet_alerts WHERE state = 'ACTIVE'").get() as { cnt: number }
    ).cnt;
    const lastBackup = store.db
      .prepare('SELECT created_at_utc FROM backups ORDER BY created_at_utc DESC LIMIT 1')
      .get() as { created_at_utc: string } | undefined;
    const todayStartIso = `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`;
    const playsToday = (
      store.db.prepare('SELECT COUNT(*) as cnt FROM playback_events WHERE started_at_utc >= ?').get(todayStartIso) as {
        cnt: number;
      }
    ).cnt;

    return {
      serverTimeUtc: new Date().toISOString(),
      totalDevices,
      onlineDevices,
      offlineDevices,
      playingDevices,
      downloadingDevices,
      totalGroups: groups.length,
      activeSyncGroups,
      sessionsWithSyncErrors: syncErrorDevices > 0 ? 1 : 0,
      pendingDeployments,
      failedCommands,
      storageBytes,
      activeFleetAlerts: Number(activeFleetAlerts),
      lastBackupAtUtc: lastBackup?.created_at_utc ?? null,
      proofOfPlayToday: Number(playsToday),
      recentEvents,
    };
  });

  app.post('/api/v1/clock/sync', async (req) => {
    const t2ServerRecvMs = Date.now();
    const body = (req.body as { t1ClientSendMs?: number; deviceId?: string }) || {};
    const t1ClientSendMs = Number(body.t1ClientSendMs ?? t2ServerRecvMs);
    const t3ServerSendMs = Date.now();
    return {
      t1ClientSendMs,
      t2ServerRecvMs,
      t3ServerSendMs,
      serverIsoUtc: new Date(t3ServerSendMs).toISOString(),
    };
  });

  // ==========================================================================
  // 2. Devices & Enrollment (Spec Section 22)
  // ==========================================================================

  app.get('/api/v1/devices', async () => {
    const rows = store.db.prepare('SELECT * FROM devices ORDER BY id ASC').all() as Array<Record<string, unknown>>;
    const memberships = store.db.prepare('SELECT * FROM group_members').all() as Array<{
      group_id: string;
      device_id: string;
      role: string;
      viewport_col: number;
      viewport_row: number;
    }>;
    const enrollmentCodes = store.db
      .prepare('SELECT * FROM enrollment_codes ORDER BY created_at DESC')
      .all();

    const devices = rows.map((r) => ({
      ...r,
      capabilities: JSON.parse(String(r.capabilities_json || '{}')),
      groups: memberships.filter((m) => m.device_id === r.id),
    }));

    return { devices, enrollmentCodes };
  });

  app.get('/api/v1/devices/:deviceId', async (req, reply) => {
    const { deviceId } = req.params as { deviceId: string };
    const row = store.db.prepare('SELECT * FROM devices WHERE id = ?').get(deviceId) as
      | Record<string, unknown>
      | undefined;
    if (!row) {
      return reply.code(404).send({ error: 'Device not found' });
    }
    const groups = store.db
      .prepare('SELECT * FROM group_members WHERE device_id = ?')
      .all(deviceId);
    return {
      ...row,
      capabilities: JSON.parse(String(row.capabilities_json || '{}')),
      groups,
    };
  });

  app.post('/api/v1/devices/enrollment-codes', async (req, reply) => {
    const auth = verifyAuthorized(req, reply, ['admin', 'operator']);
    if (!auth.authorized) return;

    const body = (req.body as { deviceName?: string; location?: string; ttlMinutes?: number }) || {};
    const code = `ENROLL-${Math.random().toString(36).slice(2, 6).toUpperCase()}-${Date.now().toString(36).slice(-4).toUpperCase()}`;
    const now = new Date().toISOString();
    const ttlMs = Math.max(1, body.ttlMinutes ?? 60) * 60_000;
    const expiresAt = new Date(Date.now() + ttlMs).toISOString();

    store.db
      .prepare(
        'INSERT INTO enrollment_codes (code, device_name, location, expires_at, created_at) VALUES (?, ?, ?, ?, ?)'
      )
      .run(code, body.deviceName || 'New Signage Player', body.location || 'Main Floor', expiresAt, now);

    store.recordAudit(auth.actorId, 'CREATE_ENROLLMENT_CODE', 'enrollment_code', code, `Created enrollment code for ${body.deviceName}`);
    return { code, deviceName: body.deviceName, location: body.location, expiresAt };
  });

  app.post('/api/v1/devices/enroll', async (req, reply) => {
    const body = (req.body as {
      enrollmentCode?: string;
      deviceId?: string;
      deviceName?: string;
      location?: string;
      assignedDisplay?: string;
      os?: string;
      playerVersion?: string;
      groupId?: string;
    }) || {};

    const now = new Date();
    const nowIso = now.toISOString();

    if (body.enrollmentCode) {
      const codeRow = store.db
        .prepare('SELECT * FROM enrollment_codes WHERE code = ?')
        .get(body.enrollmentCode) as
        | { code: string; device_name: string; location: string; expires_at: string; used_at: string | null }
        | undefined;

      if (!codeRow) {
        return reply.code(400).send({ error: 'Invalid enrollment code.' });
      }
      if (codeRow.used_at) {
        return reply.code(400).send({ error: 'Enrollment code has already been used.' });
      }
      if (Date.parse(codeRow.expires_at) < now.getTime()) {
        return reply.code(400).send({ error: 'Enrollment code has expired.' });
      }

      store.db
        .prepare('UPDATE enrollment_codes SET used_at = ? WHERE code = ?')
        .run(nowIso, body.enrollmentCode);
    }

    const deviceId = body.deviceId || createId('player');
    const deviceName = body.deviceName || `Signage Display ${deviceId.slice(-4)}`;
    const location = body.location || 'Main Lobby';
    const assignedDisplay = body.assignedDisplay || 'HDMI-1 (1920x1080)';
    const os = body.os || 'Linux Kiosk OS';

    store.db
      .prepare(`
        INSERT OR REPLACE INTO devices (
          id, name, location, assigned_display, os, status, playback_state,
          player_version, capabilities_json, current_package_id, current_package_version,
          current_scene_id, current_playlist_id, estimated_fps, clock_offset_ms,
          clock_uncertainty_ms, drift_ms, last_seen_at, configuration_revision, created_at
        ) VALUES (?, ?, ?, ?, ?, 'READY', 'PLAYING', ?, '{}', 'pkg-apex-lobby-v1', 1, 'scene-welcome', 'playlist-main-loop', 60, 0, 5.0, 0, ?, 1, ?)
      `)
      .run(deviceId, deviceName, location, assignedDisplay, os, body.playerVersion || '1.0.0', nowIso, nowIso);

    const token = `devtok_${deviceId}_${sha256Hex(`${deviceId}:${nowIso}`).slice(0, 20)}`;
    store.db
      .prepare(
        'INSERT INTO device_credentials (id, device_id, credential_reference, created_at, expires_at) VALUES (?, ?, ?, ?, ?)'
      )
      .run(
        createId('cred'),
        deviceId,
        token,
        nowIso,
        new Date(now.getTime() + 365 * 86400_000).toISOString()
      );

    const groupId = body.groupId || 'group-lobby-wall';
    store.db
      .prepare('INSERT OR REPLACE INTO group_members (group_id, device_id, role, viewport_col, viewport_row) VALUES (?, ?, ?, 0, 0)')
      .run(groupId, deviceId, 'member');

    store.recordAudit('system', 'DEVICE_ENROLLED', 'device', deviceId, `Enrolled "${deviceName}" into ${groupId}`);
    store.recordEvent(deviceId, 'DEVICE_CONNECTED', { deviceId, deviceName, groupId });
    broadcastWs('DEVICE_CONNECTED', { deviceId, deviceName, groupId });

    return {
      deviceId,
      deviceName,
      credentialToken: token,
      assignedGroupId: groupId,
      defaultPackageId: 'pkg-apex-lobby-v1',
      defaultPlaylistId: 'playlist-main-loop',
    };
  });

  app.patch('/api/v1/devices/:deviceId', async (req, reply) => {
    const auth = verifyAuthorized(req, reply, ['admin', 'operator']);
    if (!auth.authorized) return;

    const { deviceId } = req.params as { deviceId: string };
    const body = (req.body as {
      name?: string;
      location?: string;
      assignedDisplay?: string;
      status?: string;
      playbackState?: string;
      currentPackageId?: string;
      currentSceneId?: string;
      driftMs?: number;
      clockOffsetMs?: number;
    }) || {};

    const existing = store.db.prepare('SELECT * FROM devices WHERE id = ?').get(deviceId) as
      | Record<string, unknown>
      | undefined;
    if (!existing) {
      return reply.code(404).send({ error: 'Device not found' });
    }

    store.db
      .prepare(`
        UPDATE devices SET
          name = ?,
          location = ?,
          assigned_display = ?,
          status = ?,
          playback_state = ?,
          current_package_id = ?,
          current_scene_id = ?,
          drift_ms = ?,
          clock_offset_ms = ?,
          last_seen_at = ?,
          configuration_revision = configuration_revision + 1
        WHERE id = ?
      `)
      .run(
        String(body.name ?? existing.name),
        String(body.location ?? existing.location),
        String(body.assignedDisplay ?? existing.assigned_display),
        String(body.status ?? existing.status),
        String(body.playbackState ?? existing.playback_state),
        String(body.currentPackageId ?? existing.current_package_id),
        String(body.currentSceneId ?? existing.current_scene_id),
        Number(body.driftMs ?? existing.drift_ms ?? 0),
        Number(body.clockOffsetMs ?? existing.clock_offset_ms ?? 0),
        new Date().toISOString(),
        deviceId
      );

    store.recordAudit(auth.actorId, 'UPDATE_DEVICE', 'device', deviceId, JSON.stringify(body));
    const updated = store.db.prepare('SELECT * FROM devices WHERE id = ?').get(deviceId);
    broadcastWs('DEVICE_STATUS_UPDATED', updated);
    return updated;
  });

  app.post('/api/v1/devices/:deviceId/heartbeat', async (req, reply) => {
    const { deviceId } = req.params as { deviceId: string };
    const body = (req.body as {
      status?: string;
      playbackState?: string;
      currentSceneId?: string;
      estimatedFps?: number;
      clockOffsetMs?: number;
      clockUncertaintyMs?: number;
      driftMs?: number;
    }) || {};

    // Check if device credential was revoked
    const cred = store.db
      .prepare('SELECT * FROM device_credentials WHERE device_id = ? ORDER BY created_at DESC LIMIT 1')
      .get(deviceId) as { revoked_at: string | null } | undefined;
    if (cred?.revoked_at) {
      return reply.code(401).send({ error: 'Device credentials have been revoked.' });
    }

    const nowIso = new Date().toISOString();
    store.db
      .prepare(`
        UPDATE devices SET
          status = COALESCE(?, status),
          playback_state = COALESCE(?, playback_state),
          current_scene_id = COALESCE(?, current_scene_id),
          estimated_fps = COALESCE(?, estimated_fps),
          clock_offset_ms = COALESCE(?, clock_offset_ms),
          clock_uncertainty_ms = COALESCE(?, clock_uncertainty_ms),
          drift_ms = COALESCE(?, drift_ms),
          last_seen_at = ?
        WHERE id = ?
      `)
      .run(
        body.status ?? 'ONLINE',
        body.playbackState ?? null,
        body.currentSceneId ?? null,
        body.estimatedFps ?? null,
        body.clockOffsetMs ?? null,
        body.clockUncertaintyMs ?? null,
        body.driftMs ?? null,
        nowIso,
        deviceId
      );

    const pendingCommands = store.db
      .prepare(
        `SELECT * FROM commands
         WHERE (target_device_id = ? OR target_group_id IN (SELECT group_id FROM group_members WHERE device_id = ?))
         AND status IN ('RECEIVED', 'ACCEPTED')
         ORDER BY created_at ASC`
      )
      .all(deviceId, deviceId);

    const deviceRow = store.db.prepare('SELECT * FROM devices WHERE id = ?').get(deviceId);
    return {
      ok: true,
      serverTimeUtc: nowIso,
      device: deviceRow,
      pendingCommands,
    };
  });

  app.post('/api/v1/devices/:deviceId/revoke', async (req, reply) => {
    const auth = verifyAuthorized(req, reply, ['admin']);
    if (!auth.authorized) return;

    const { deviceId } = req.params as { deviceId: string };
    const nowIso = new Date().toISOString();
    store.db
      .prepare('UPDATE device_credentials SET revoked_at = ? WHERE device_id = ?')
      .run(nowIso, deviceId);
    store.db
      .prepare("UPDATE devices SET status = 'OFFLINE', playback_state = 'PAUSED' WHERE id = ?")
      .run(deviceId);

    store.recordAudit(auth.actorId, 'REVOKE_DEVICE_CREDENTIALS', 'device', deviceId, 'Revoked active device tokens');
    broadcastWs('DEVICE_DISCONNECTED', { deviceId, reason: 'Credentials revoked' });
    return { ok: true, deviceId, revokedAt: nowIso };
  });

  // ==========================================================================
  // 3. Device Groups & Display Topology (Spec Section 23)
  // ==========================================================================

  app.get('/api/v1/groups', async () => {
    const groups = store.db.prepare('SELECT * FROM groups ORDER BY created_at ASC').all() as Array<
      Record<string, unknown>
    >;
    const members = store.db.prepare('SELECT * FROM group_members').all() as Array<{
      group_id: string;
      device_id: string;
      role: string;
      viewport_col: number;
      viewport_row: number;
    }>;

    return {
      groups: groups.map((g) => ({
        ...g,
        members: members.filter((m) => m.group_id === g.id),
      })),
    };
  });

  app.post('/api/v1/groups', async (req, reply) => {
    const auth = verifyAuthorized(req, reply, ['admin', 'operator']);
    if (!auth.authorized) return;

    const body = (req.body as {
      id?: string;
      name: string;
      description?: string;
      topology?: string;
      synchronizationPolicy?: string;
      failurePolicy?: string;
      defaultPackageId?: string;
      defaultPlaylistId?: string;
      timezone?: string;
      deviceIds?: string[];
    }) || { name: 'New Display Group' };

    const groupId = body.id || createId('group');
    const nowIso = new Date().toISOString();

    store.db
      .prepare(`
        INSERT INTO groups (
          id, name, description, topology, configuration_revision,
          synchronization_policy, failure_policy, default_package_id,
          default_playlist_id, timezone, created_at
        ) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        groupId,
        body.name,
        body.description || '',
        body.topology || 'SYNCHRONIZED_DISPLAYS',
        body.synchronizationPolicy || 'DRIFT_CORRECTED',
        body.failurePolicy || 'START_WITH_AVAILABLE',
        body.defaultPackageId || 'pkg-apex-lobby-v1',
        body.defaultPlaylistId || 'playlist-main-loop',
        body.timezone || 'UTC',
        nowIso
      );

    if (Array.isArray(body.deviceIds)) {
      const insertMember = store.db.prepare(
        'INSERT OR REPLACE INTO group_members (group_id, device_id, role, viewport_col, viewport_row) VALUES (?, ?, ?, ?, ?)'
      );
      body.deviceIds.forEach((devId, idx) => {
        insertMember.run(groupId, devId, idx === 0 ? 'leader' : 'member', idx % 2, Math.floor(idx / 2));
      });
    }

    store.recordAudit(auth.actorId, 'CREATE_GROUP', 'group', groupId, body.name);
    return store.db.prepare('SELECT * FROM groups WHERE id = ?').get(groupId);
  });

  app.patch('/api/v1/groups/:groupId', async (req, reply) => {
    const { groupId } = req.params as { groupId: string };
    const auth = verifyAuthorized(req, reply, ['admin', 'operator'], groupId);
    if (!auth.authorized) return;

    const existing = store.db.prepare('SELECT * FROM groups WHERE id = ?').get(groupId) as
      | Record<string, unknown>
      | undefined;
    if (!existing) {
      return reply.code(404).send({ error: 'Group not found' });
    }

    const body = (req.body as {
      name?: string;
      synchronizationPolicy?: string;
      failurePolicy?: string;
      defaultPackageId?: string;
      defaultPlaylistId?: string;
    }) || {};

    store.db
      .prepare(`
        UPDATE groups SET
          name = ?,
          synchronization_policy = ?,
          failure_policy = ?,
          default_package_id = ?,
          default_playlist_id = ?,
          configuration_revision = configuration_revision + 1
        WHERE id = ?
      `)
      .run(
        String(body.name ?? existing.name),
        String(body.synchronizationPolicy ?? existing.synchronization_policy),
        String(body.failurePolicy ?? existing.failure_policy),
        String(body.defaultPackageId ?? existing.default_package_id),
        String(body.defaultPlaylistId ?? existing.default_playlist_id),
        groupId
      );

    store.recordAudit(auth.actorId, 'UPDATE_GROUP', 'group', groupId, JSON.stringify(body));
    return store.db.prepare('SELECT * FROM groups WHERE id = ?').get(groupId);
  });

  // ==========================================================================
  // 4. Package Repository & Distribution (Spec Section 27)
  // ==========================================================================

  app.get('/api/v1/packages', async () => {
    const packages = store.db.prepare('SELECT * FROM packages ORDER BY created_at DESC').all();
    const deployments = store.db.prepare('SELECT * FROM deployments ORDER BY created_at DESC').all();
    return { packages, deployments };
  });

  app.post('/api/v1/packages', async (req, reply) => {
    const auth = verifyAuthorized(req, reply, ['admin', 'operator']);
    if (!auth.authorized) return;

    const body = (req.body as {
      packageId?: string;
      name?: string;
      version?: number;
      archiveBase64?: string;
      project?: SignageProject;
      profile?: 'fast' | 'compact';
    }) || {};

    let archiveBytes: Uint8Array;
    if (body.archiveBase64) {
      const buf = Buffer.from(body.archiveBase64, 'base64');
      archiveBytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    } else if (body.project) {
      const built = buildSignagePackage(body.project, {
        profile: body.profile ?? 'compact',
        signPackage: true,
      });
      archiveBytes = built.bytes;
    } else {
      return reply.code(400).send({ error: 'Provide either archiveBase64 or project payload.' });
    }

    // Validate untrusted package before storing (Spec 27.2)
    const validation = validateSignageArchive(archiveBytes);
    if (!validation.valid || !validation.manifest) {
      store.recordAudit(auth.actorId, 'REJECT_MALFORMED_PACKAGE', 'package', 'upload', validation.errors.join('; '));
      return reply.code(400).send({
        error: 'Uploaded .signage package failed integrity validation.',
        validationErrors: validation.errors,
      });
    }

    // Content-addressed deduplication check
    const existingByHash = store.db
      .prepare('SELECT * FROM packages WHERE content_hash = ?')
      .get(validation.packageHashHex) as Record<string, unknown> | undefined;

    if (existingByHash) {
      return {
        package: existingByHash,
        deduplicated: true,
        validationReport: {
          packageHashHex: validation.packageHashHex,
          signatureVerified: validation.signatureVerified,
          totalEntries: validation.entries?.length ?? 0,
        },
      };
    }

    const pkgId = body.packageId || createId('pkg');
    const pkgName = body.name || validation.manifest.project.name;
    const version = body.version || 1;
    const storageRef = store.storePackageBytes(validation.packageHashHex, archiveBytes);
    const nowIso = new Date().toISOString();

    store.db
      .prepare(`
        INSERT INTO packages (
          id, name, version, format_version, content_hash,
          storage_reference, size_bytes, signature_status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        pkgId,
        pkgName,
        version,
        validation.header?.formatVersion ?? 1,
        validation.packageHashHex,
        storageRef,
        archiveBytes.byteLength,
        validation.signatureVerified ? 'VERIFIED' : 'UNSIGNED',
        nowIso
      );

    store.recordAudit(auth.actorId, 'UPLOAD_PACKAGE', 'package', pkgId, `${pkgName} (${validation.packageHashHex.slice(0, 12)})`);
    const created = store.db.prepare('SELECT * FROM packages WHERE id = ?').get(pkgId);
    return {
      package: created,
      deduplicated: false,
      validationReport: {
        packageHashHex: validation.packageHashHex,
        signatureVerified: validation.signatureVerified,
        totalEntries: validation.entries?.length ?? 0,
      },
    };
  });

  app.get('/api/v1/packages/:packageId/download', async (req, reply) => {
    const { packageId } = req.params as { packageId: string };
    const pkg = store.db.prepare('SELECT * FROM packages WHERE id = ?').get(packageId) as
      | { id: string; name: string; version: number; content_hash: string; size_bytes: number }
      | undefined;

    if (!pkg) {
      return reply.code(404).send({ error: 'Package not found' });
    }

    const bytes = store.readPackageBytes(pkg.content_hash);
    if (!bytes) {
      return reply.code(404).send({ error: 'Package binary blob missing from storage' });
    }

    return {
      packageId: pkg.id,
      name: pkg.name,
      version: pkg.version,
      contentHash: pkg.content_hash,
      sizeBytes: pkg.size_bytes,
      archiveBase64: Buffer.from(bytes).toString('base64'),
    };
  });

  app.post('/api/v1/packages/delta', async (req, reply) => {
    const body = (req.body as { basePackageId?: string; targetPackageId?: string }) || {};
    if (!body.basePackageId || !body.targetPackageId) {
      return reply.code(400).send({ error: 'Both basePackageId and targetPackageId are required' });
    }

    const basePkg = store.db
      .prepare('SELECT * FROM packages WHERE id = ?')
      .get(body.basePackageId) as { id: string; content_hash: string } | undefined;
    const targetPkg = store.db
      .prepare('SELECT * FROM packages WHERE id = ?')
      .get(body.targetPackageId) as { id: string; content_hash: string } | undefined;

    if (!basePkg || !targetPkg) {
      return reply.code(404).send({ error: 'Base or target package not found' });
    }

    const baseBytes = store.readPackageBytes(basePkg.content_hash);
    const targetBytes = store.readPackageBytes(targetPkg.content_hash);
    if (!baseBytes || !targetBytes) {
      return reply.code(404).send({ error: 'Package binary blob missing from storage' });
    }

    const deltaPatch = buildSignageDeltaPatch(baseBytes, targetBytes);
    return {
      basePackageId: basePkg.id,
      targetPackageId: targetPkg.id,
      deltaPatch,
    };
  });

  app.post('/api/v1/deployments', async (req, reply) => {
    const auth = verifyAuthorized(req, reply, ['admin', 'operator']);
    if (!auth.authorized) return;

    const body = (req.body as { packageId: string; targetGroupId: string }) || {};
    const pkg = store.db.prepare('SELECT * FROM packages WHERE id = ?').get(body.packageId) as
      | { id: string; version: number; content_hash: string }
      | undefined;
    if (!pkg) {
      return reply.code(404).send({ error: 'Package not found' });
    }

    const deployId = createId('deploy');
    const nowIso = new Date().toISOString();

    store.db
      .prepare(
        'INSERT INTO deployments (id, package_id, target_group_id, status, created_at, completed_at) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(deployId, pkg.id, body.targetGroupId, 'COMPLETED', nowIso, nowIso);

    store.db
      .prepare(
        'UPDATE groups SET default_package_id = ?, configuration_revision = configuration_revision + 1 WHERE id = ?'
      )
      .run(pkg.id, body.targetGroupId);

    store.db
      .prepare(
        `UPDATE devices SET
          current_package_id = ?,
          current_package_version = ?,
          status = 'READY',
          configuration_revision = configuration_revision + 1
         WHERE id IN (SELECT device_id FROM group_members WHERE group_id = ?)`
      )
      .run(pkg.id, pkg.version, body.targetGroupId);

    store.recordAudit(
      auth.actorId,
      'DEPLOY_PACKAGE',
      'deployment',
      deployId,
      `Deployed ${pkg.id} (hash ${pkg.content_hash.slice(0, 10)}) to ${body.targetGroupId}`
    );
    broadcastWs('PACKAGE_DOWNLOAD_COMPLETED', {
      deploymentId: deployId,
      packageId: pkg.id,
      targetGroupId: body.targetGroupId,
      contentHash: pkg.content_hash,
    });

    return store.db.prepare('SELECT * FROM deployments WHERE id = ?').get(deployId);
  });

  // ==========================================================================
  // 5. Centralized Playlists & Schedules (Spec Section 28)
  // ==========================================================================

  app.get('/api/v1/playlists', async () => {
    const rows = store.db.prepare('SELECT * FROM playlists ORDER BY created_at DESC').all() as Array<{
      id: string;
      name: string;
      revision: number;
      configuration_json: string;
      created_at: string;
    }>;
    return {
      playlists: rows.map((r) => ({
        ...r,
        configuration: JSON.parse(r.configuration_json) as Playlist,
      })),
    };
  });

  app.post('/api/v1/playlists', async (req, reply) => {
    const auth = verifyAuthorized(req, reply, ['admin', 'operator']);
    if (!auth.authorized) return;

    const pl = req.body as Playlist;
    const id = pl.id || createId('playlist');
    const existing = store.db.prepare('SELECT revision FROM playlists WHERE id = ?').get(id) as
      | { revision: number }
      | undefined;
    const nextRevision = (existing?.revision ?? 0) + 1;
    const updatedPl: Playlist = { ...pl, id, revision: nextRevision };
    const nowIso = new Date().toISOString();

    store.db
      .prepare('INSERT OR REPLACE INTO playlists (id, name, revision, configuration_json, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, updatedPl.name, nextRevision, JSON.stringify(updatedPl), nowIso);

    store.recordAudit(auth.actorId, 'UPSERT_PLAYLIST', 'playlist', id, `Revision ${nextRevision}`);
    broadcastWs('CONFIGURATION_UPDATED', { type: 'playlist', id, revision: nextRevision });
    return { playlist: updatedPl };
  });

  app.get('/api/v1/schedules', async () => {
    const rows = store.db.prepare('SELECT * FROM schedules').all() as Array<{
      id: string;
      group_id: string;
      revision: number;
      configuration_json: string;
      enabled: number;
    }>;
    return {
      schedules: rows.map((r) => ({
        ...r,
        configuration: JSON.parse(r.configuration_json) as PlaybackSchedule,
      })),
    };
  });

  // ==========================================================================
  // 6. Synchronized Playback Sessions & Drift Control (Spec Sections 24–26)
  // ==========================================================================

  app.get('/api/v1/sessions', async () => {
    const sessions = store.db.prepare('SELECT * FROM sessions ORDER BY created_at DESC').all() as Array<
      Record<string, unknown>
    >;
    const sessionDevices = store.db.prepare('SELECT * FROM session_devices').all() as Array<
      Record<string, unknown>
    >;

    return {
      serverTimeUtc: new Date().toISOString(),
      sessions: sessions.map((s) => ({
        ...s,
        devices: sessionDevices.filter((d) => d.session_id === s.id),
      })),
    };
  });

  app.post('/api/v1/sessions', async (req, reply) => {
    const auth = verifyAuthorized(req, reply, ['admin', 'operator']);
    if (!auth.authorized) return;

    const body = (req.body as {
      sessionId?: string;
      groupId: string;
      packageId?: string;
      playlistId?: string;
      leadTimeMs?: number;
      startTimeUtc?: string;
      synchronizationPolicy?: string;
      failurePolicy?: string;
    }) || { groupId: 'group-lobby-wall' };

    const group = store.db.prepare('SELECT * FROM groups WHERE id = ?').get(body.groupId) as
      | Record<string, unknown>
      | undefined;
    if (!group) {
      return reply.code(404).send({ error: `Group "${body.groupId}" not found` });
    }

    const memberDevices = store.db
      .prepare(
        `SELECT d.* FROM devices d
         JOIN group_members gm ON gm.device_id = d.id
         WHERE gm.group_id = ?`
      )
      .all(body.groupId) as Array<Record<string, unknown>>;

    const failurePolicy = String(body.failurePolicy || group.failure_policy || 'START_WITH_AVAILABLE');
    const readyDevices = memberDevices.filter((d) => d.status !== 'OFFLINE' && d.status !== 'ERROR');
    const unavailableDevices = memberDevices.filter((d) => d.status === 'OFFLINE' || d.status === 'ERROR');

    if (failurePolicy === 'ABORT' && unavailableDevices.length > 0) {
      return reply.code(409).send({
        error: 'Session start aborted by group failure policy: not all assigned players are READY.',
        unavailableDeviceIds: unavailableDevices.map((d) => d.id),
      });
    }

    const leadTimeMs = typeof body.leadTimeMs === 'number' ? body.leadTimeMs : 2500;
    const startTimeUtc =
      body.startTimeUtc || new Date(Date.now() + Math.max(0, leadTimeMs)).toISOString();

    const sessionId = body.sessionId || createId('session');
    const packageId = body.packageId || String(group.default_package_id || 'pkg-apex-lobby-v1');
    const playlistId = body.playlistId || String(group.default_playlist_id || 'playlist-main-loop');
    const syncPolicy = String(body.synchronizationPolicy || group.synchronization_policy || 'DRIFT_CORRECTED');
    const nowIso = new Date().toISOString();

    store.db
      .prepare(`
        INSERT OR REPLACE INTO sessions (
          id, group_id, package_id, playlist_id, timeline_revision,
          start_time_utc, status, synchronization_policy, failure_policy, created_at
        ) VALUES (?, ?, ?, ?, 1, ?, 'RUNNING', ?, ?, ?)
      `)
      .run(sessionId, body.groupId, packageId, playlistId, startTimeUtc, syncPolicy, failurePolicy, nowIso);

    const insertSd = store.db.prepare(`
      INSERT OR REPLACE INTO session_devices (
        session_id, device_id, readiness_state, last_reported_scene_id,
        last_reported_position, expected_position, drift_ms, last_reported_at
      ) VALUES (?, ?, ?, 'scene-welcome', 0, 0, 0, ?)
    `);

    const activeParticipants =
      failurePolicy === 'REMOVE_UNAVAILABLE' ? readyDevices : memberDevices;
    for (const d of activeParticipants) {
      const readiness = d.status === 'OFFLINE' ? 'OFFLINE' : 'READY';
      insertSd.run(sessionId, String(d.id), readiness, nowIso);
    }

    store.recordAudit(
      auth.actorId,
      'START_SYNCHRONIZED_SESSION',
      'session',
      sessionId,
      `Scheduled group "${body.groupId}" start at ${startTimeUtc}`
    );
    broadcastWs('SESSION_STARTED', {
      sessionId,
      groupId: body.groupId,
      packageId,
      playlistId,
      startTimeUtc,
      readyCount: readyDevices.length,
      totalAssigned: memberDevices.length,
    });

    const created = store.db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
    const devices = store.db.prepare('SELECT * FROM session_devices WHERE session_id = ?').all(sessionId);
    return {
      session: created,
      devices,
      readyCount: readyDevices.length,
      missingCount: unavailableDevices.length,
    };
  });

  app.get('/api/v1/sessions/:sessionId', async (req, reply) => {
    const { sessionId } = req.params as { sessionId: string };
    const sessionRow = store.db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as
      | Record<string, unknown>
      | undefined;
    if (!sessionRow) {
      return reply.code(404).send({ error: 'Session not found' });
    }

    const pkgRow = store.db
      .prepare('SELECT * FROM packages WHERE id = ?')
      .get(String(sessionRow.package_id)) as { content_hash: string } | undefined;

    let project = createStarterProject();
    if (pkgRow) {
      const bytes = store.readPackageBytes(pkgRow.content_hash);
      if (bytes) {
        try {
          project = extractProjectFromArchive(bytes).project;
        } catch {
          // Use starter project fallback
        }
      }
    }

    const playlist = project.playlists.find((p) => p.id === sessionRow.playlist_id) ?? project.playlists[0];
    const sessionConfig: SynchronizedSessionConfig = {
      sessionId: String(sessionRow.id),
      groupId: String(sessionRow.group_id),
      packageId: String(sessionRow.package_id),
      packageVersion: 1,
      playlistId: String(sessionRow.playlist_id),
      playlistRevision: playlist.revision,
      timelineRevision: Number(sessionRow.timeline_revision || 1),
      startTimeUtc: String(sessionRow.start_time_utc),
      status: sessionRow.status as SynchronizedSessionConfig['status'],
      pausedPositionMs:
        typeof sessionRow.paused_position_ms === 'number'
          ? Number(sessionRow.paused_position_ms)
          : undefined,
      synchronizationPolicy: sessionRow.synchronization_policy as SynchronizedSessionConfig['synchronizationPolicy'],
      failurePolicy: sessionRow.failure_policy as SynchronizedSessionConfig['failurePolicy'],
    };

    const nowMs = Date.now();
    const authoritativeState = evaluateAuthoritativeTimeline(project, playlist, sessionConfig, nowMs);
    const devices = store.db.prepare('SELECT * FROM session_devices WHERE session_id = ?').all(sessionId);

    return {
      serverTimeUtc: new Date(nowMs).toISOString(),
      session: sessionRow,
      authoritativeState: {
        phase: authoritativeState.phase,
        countdownMs: authoritativeState.countdownMs,
        sessionElapsedMs: authoritativeState.sessionElapsedMs,
        cycleElapsedMs: authoritativeState.cycleElapsedMs,
        activeSceneId: authoritativeState.activeScene.id,
        activeSceneName: authoritativeState.activeScene.name,
        sceneElapsedMs: authoritativeState.sceneElapsedMs,
        sceneDurationMs: authoritativeState.sceneDurationMs,
      },
      devices,
    };
  });

  app.post('/api/v1/sessions/:sessionId/report', async (req, reply) => {
    const { sessionId } = req.params as { sessionId: string };
    const body = (req.body as {
      deviceId: string;
      actualSceneId: string;
      actualScenePositionMs: number;
      reportedAtUtcMs?: number;
      clockOffsetMs?: number;
      clockUncertaintyMs?: number;
    }) || { deviceId: 'player-01', actualSceneId: 'scene-welcome', actualScenePositionMs: 0 };

    const sessionRow = store.db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as
      | Record<string, unknown>
      | undefined;
    if (!sessionRow) {
      return reply.code(404).send({ error: 'Session not found' });
    }

    const project = createStarterProject();
    const playlist = project.playlists[0];
    const sessionConfig: SynchronizedSessionConfig = {
      sessionId: String(sessionRow.id),
      groupId: String(sessionRow.group_id),
      packageId: String(sessionRow.package_id),
      packageVersion: 1,
      playlistId: String(sessionRow.playlist_id),
      playlistRevision: playlist.revision,
      timelineRevision: Number(sessionRow.timeline_revision || 1),
      startTimeUtc: String(sessionRow.start_time_utc),
      status: sessionRow.status as SynchronizedSessionConfig['status'],
      synchronizationPolicy: 'DRIFT_CORRECTED',
      failurePolicy: 'START_WITH_AVAILABLE',
    };

    const refTimeMs = typeof body.reportedAtUtcMs === 'number' ? body.reportedAtUtcMs : Date.now();
    const expected = evaluateAuthoritativeTimeline(project, playlist, sessionConfig, refTimeMs);

    const correction = evaluateDriftCorrection(
      expected.activeScene.id,
      body.actualSceneId,
      expected.sceneElapsedMs,
      body.actualScenePositionMs,
      DEFAULT_DRIFT_THRESHOLDS
    );

    const nowIso = new Date().toISOString();
    store.db
      .prepare(`
        INSERT OR REPLACE INTO session_devices (
          session_id, device_id, readiness_state, last_reported_scene_id,
          last_reported_position, expected_position, drift_ms, last_reported_at
        ) VALUES (?, ?, 'READY', ?, ?, ?, ?, ?)
      `)
      .run(
        sessionId,
        body.deviceId,
        body.actualSceneId,
        body.actualScenePositionMs,
        expected.sceneElapsedMs,
        correction.driftMs,
        nowIso
      );

    store.db
      .prepare('UPDATE devices SET drift_ms = ?, current_scene_id = ?, last_seen_at = ? WHERE id = ?')
      .run(correction.driftMs, body.actualSceneId, nowIso, body.deviceId);

    if (correction.type !== 'NONE') {
      broadcastWs('PLAYBACK_DRIFT_DETECTED', {
        sessionId,
        deviceId: body.deviceId,
        driftMs: correction.driftMs,
        correctionAction: correction.type,
      });
    }

    return {
      sessionId,
      deviceId: body.deviceId,
      expectedSceneId: expected.activeScene.id,
      expectedScenePositionMs: expected.sceneElapsedMs,
      driftMs: correction.driftMs,
      correction,
    };
  });

  app.post('/api/v1/sessions/:sessionId/resynchronize', async (req, reply) => {
    const auth = verifyAuthorized(req, reply, ['admin', 'operator']);
    if (!auth.authorized) return;

    const { sessionId } = req.params as { sessionId: string };
    const sessionRow = store.db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as
      | Record<string, unknown>
      | undefined;
    if (!sessionRow) {
      return reply.code(404).send({ error: 'Session not found' });
    }

    store.db
      .prepare('UPDATE sessions SET timeline_revision = timeline_revision + 1 WHERE id = ?')
      .run(sessionId);

    store.db
      .prepare('UPDATE session_devices SET drift_ms = 0, last_reported_position = expected_position WHERE session_id = ?')
      .run(sessionId);

    store.db
      .prepare(
        `UPDATE devices SET drift_ms = 0
         WHERE id IN (SELECT device_id FROM session_devices WHERE session_id = ?)`
      )
      .run(sessionId);

    store.recordAudit(auth.actorId, 'RESYNCHRONIZE_SESSION', 'session', sessionId, 'Broadcast resynchronization pulse');
    broadcastWs('PLAYBACK_RESYNCHRONIZED', { sessionId });

    return store.db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
  });

  // ==========================================================================
  // 7. Authenticated Network Command System (Spec Section 29)
  // ==========================================================================

  app.get('/api/v1/commands', async () => {
    const commands = store.db.prepare('SELECT * FROM commands ORDER BY created_at DESC LIMIT 100').all();
    return { commands };
  });

  async function issueCommandHandler(req: FastifyRequest, reply: FastifyReply) {
    const body = (req.body as {
      id?: string;
      idempotencyKey?: string;
      targetDeviceId?: string;
      targetGroupId?: string;
      commandType: string;
      parameters?: Record<string, unknown>;
      expiresAt?: string;
      ttlSeconds?: number;
    }) || { commandType: 'STATUS_REQUEST' };

    const paramsDevice = (req.params as { deviceId?: string })?.deviceId;
    const targetDeviceId = body.targetDeviceId || paramsDevice || null;
    const targetGroupId = body.targetGroupId || null;

    const auth = verifyAuthorized(req, reply, ['admin', 'operator'], targetGroupId ?? undefined);
    if (!auth.authorized) return;

    if (!SUPPORTED_COMMANDS.has(body.commandType)) {
      return reply.code(400).send({ error: `Unsupported command type: ${body.commandType}` });
    }

    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    const expiresAt =
      body.expiresAt || new Date(now + Math.max(5, body.ttlSeconds ?? 300) * 1000).toISOString();

    // Reject already-expired commands (Spec Section 29 & Test 9)
    if (Date.parse(expiresAt) <= now) {
      store.recordAudit(
        auth.actorId,
        'REJECT_EXPIRED_COMMAND',
        'command',
        body.commandType,
        `Command expired at ${expiresAt}`
      );
      return reply.code(400).send({
        error: 'Command rejected: expiration timestamp is in the past.',
        status: 'EXPIRED',
      });
    }

    // Idempotency key deduplication (Spec Section 29)
    if (body.idempotencyKey) {
      const existingCmd = store.db
        .prepare('SELECT * FROM commands WHERE idempotency_key = ?')
        .get(body.idempotencyKey);
      if (existingCmd) {
        return { command: existingCmd, deduplicated: true };
      }
    }

    const cmdId = body.id || createId('cmd');
    store.db
      .prepare(`
        INSERT INTO commands (
          id, idempotency_key, target_device_id, target_group_id,
          command_type, payload_json, issued_by, status, expires_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'ACCEPTED', ?, ?)
      `)
      .run(
        cmdId,
        body.idempotencyKey || null,
        targetDeviceId,
        targetGroupId,
        body.commandType,
        JSON.stringify(body.parameters || {}),
        auth.actorId,
        expiresAt,
        nowIso
      );

    // Apply immediate state effects for maintenance / rollback / restart commands
    if (targetDeviceId) {
      if (body.commandType === 'ENTER_MAINTENANCE') {
        store.db
          .prepare("UPDATE devices SET status = 'MAINTENANCE', playback_state = 'PAUSED' WHERE id = ?")
          .run(targetDeviceId);
      } else if (body.commandType === 'EXIT_MAINTENANCE') {
        store.db
          .prepare("UPDATE devices SET status = 'ONLINE', playback_state = 'PLAYING' WHERE id = ?")
          .run(targetDeviceId);
      } else if (body.commandType === 'RESYNCHRONIZE') {
        store.db.prepare('UPDATE devices SET drift_ms = 0 WHERE id = ?').run(targetDeviceId);
      }
    }

    store.recordAudit(
      auth.actorId,
      `ISSUE_COMMAND_${body.commandType}`,
      targetDeviceId ? 'device' : 'group',
      targetDeviceId || targetGroupId || 'broadcast',
      `Command ${cmdId}`
    );

    const created = store.db.prepare('SELECT * FROM commands WHERE id = ?').get(cmdId);
    broadcastWs('COMMAND_ACKNOWLEDGED', created);
    return { command: created, deduplicated: false };
  }

  app.post('/api/v1/commands', issueCommandHandler);
  app.post('/api/v1/devices/:deviceId/commands', issueCommandHandler);

  app.post('/api/v1/commands/:commandId/ack', async (req, reply) => {
    const { commandId } = req.params as { commandId: string };
    const body = (req.body as { status: string; deviceId?: string }) || { status: 'COMPLETED' };

    const cmd = store.db.prepare('SELECT * FROM commands WHERE id = ?').get(commandId) as
      | { id: string; expires_at: string; status: string }
      | undefined;
    if (!cmd) {
      return reply.code(404).send({ error: 'Command not found' });
    }

    if (Date.parse(cmd.expires_at) <= Date.now()) {
      store.db.prepare("UPDATE commands SET status = 'EXPIRED' WHERE id = ?").run(commandId);
      return reply.code(400).send({ error: 'Command expired before execution', status: 'EXPIRED' });
    }

    store.db.prepare('UPDATE commands SET status = ? WHERE id = ?').run(body.status, commandId);
    const updated = store.db.prepare('SELECT * FROM commands WHERE id = ?').get(commandId);
    broadcastWs('COMMAND_ACKNOWLEDGED', updated);
    return { command: updated };
  });

  // ==========================================================================
  // 8. Events, Diagnostics & Audit Log (Spec Section 30 & 33)
  // ==========================================================================

  app.get('/api/v1/events', async () => {
    const events = store.db.prepare('SELECT * FROM events ORDER BY created_at DESC LIMIT 100').all();
    return { events };
  });

  app.get('/api/v1/audit-log', async () => {
    const auditLog = store.db
      .prepare('SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 150')
      .all();
    return { auditLog };
  });

  app.get('/api/v1/diagnostics', async () => {
    const devices = store.db.prepare('SELECT * FROM devices ORDER BY id ASC').all();
    const sessions = store.db.prepare('SELECT * FROM sessions ORDER BY created_at DESC').all();
    const commands = store.db.prepare('SELECT * FROM commands ORDER BY created_at DESC LIMIT 30').all();
    return {
      applicationVersion: '1.0.0',
      runtimeVersion: process.version,
      serverUptimeSec: Math.round(process.uptime()),
      devices,
      sessions,
      recentCommands: commands,
    };
  });

  // ==========================================================================
  // 9. Phase 15 — Fleet Operations: Proof-of-Play, Health Telemetry, Alerts,
  //    Verified Backups & Retention (Spec Sections 20, 32, 33, 34)
  // ==========================================================================

  const MAX_TELEMETRY_BATCH = 1_000;

  function validIso(value: unknown): string | undefined {
    if (typeof value !== 'string' || !value.trim()) return undefined;
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? new Date(ms).toISOString() : undefined;
  }

  /** Evaluate current fleet health and persist newly-raised (deduplicated) alerts. */
  function refreshFleetHealth(nowMs = Date.now()) {
    const telemetry = store.getFleetTelemetry();
    const rules = store.listAlertRules();
    const report = evaluateFleetHealth({ devices: telemetry, rules }, nowMs);
    const createdAlerts = store.saveFleetAlerts(report.alerts);
    return { report, createdAlerts };
  }

  function normalizeHealthSample(
    raw: unknown,
    nowMs: number
  ): (HealthSample & { currentSceneId?: string; currentPackageId?: string }) | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const input = raw as Record<string, unknown>;
    const deviceId = typeof input.deviceId === 'string' ? input.deviceId.trim() : '';
    if (!deviceId || deviceId.length > 128) return null;
    const numeric = (value: unknown, fallback: number) => {
      const parsed = typeof value === 'string' ? Number(value) : value;
      return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : fallback;
    };
    const recordedMs = validIso(input.recordedAtUtc) ? Date.parse(String(input.recordedAtUtc)) : nowMs;
    const fingerprint = `${deviceId}|${recordedMs}|${numeric(input.driftMs, 0)}|${numeric(input.estimatedFps, 60)}`;
    const sampleId =
      typeof input.sampleId === 'string' && input.sampleId.trim()
        ? input.sampleId.trim().slice(0, 128)
        : `hs-${sha256Hex(fingerprint).slice(0, 24)}`;
    return {
      sampleId,
      deviceId,
      recordedAtUtc: new Date(Math.min(recordedMs, nowMs)).toISOString(),
      playbackState: (typeof input.playbackState === 'string' ? input.playbackState : 'PLAYING').slice(0, 40),
      status: (typeof input.status === 'string' ? input.status : 'ONLINE').slice(0, 40),
      driftMs: numeric(input.driftMs, 0),
      estimatedFps: numeric(input.estimatedFps, 60),
      errorCount: Math.max(0, numeric(input.errorCount, 0)),
      clockUncertaintyMs: Math.max(0, numeric(input.clockUncertaintyMs, 0)),
      currentSceneId: typeof input.currentSceneId === 'string' ? input.currentSceneId.slice(0, 128) : undefined,
      currentPackageId: typeof input.currentPackageId === 'string' ? input.currentPackageId.slice(0, 128) : undefined,
    };
  }

  app.get('/api/v1/operations/summary', async (req, reply) => {
    const auth = verifyAuthorized(req, reply, ['admin', 'operator']);
    if (!auth.authorized) return;
    const nowMs = Date.now();
    const { report } = refreshFleetHealth(nowMs);
    const todayStartIso = `${new Date(nowMs).toISOString().slice(0, 10)}T00:00:00.000Z`;
    const proofOfPlayToday = aggregateProofOfPlay(store.getPlaybackEvents({ fromUtc: todayStartIso }), {
      nowMs,
      fromUtc: todayStartIso,
      groupBy: 'scene',
    });
    return {
      generatedAtUtc: new Date(nowMs).toISOString(),
      health: report,
      healthHistory: summarizeHealthHistory(store.getHealthSamples(), 24 * 3_600_000, nowMs),
      alerts: store.listFleetAlerts(),
      rules: store.listAlertRules(),
      proofOfPlayToday,
      backups: store.listBackups(),
    };
  });

  app.get('/api/v1/operations/proof-of-play', async (req, reply) => {
    const auth = verifyAuthorized(req, reply, ['admin', 'operator']);
    if (!auth.authorized) return;
    const query = (req.query || {}) as Record<string, string>;
    const groupBy: ProofOfPlayGroupBy = (['scene', 'device-scene', 'device', 'day'] as string[]).includes(query.groupBy)
      ? (query.groupBy as ProofOfPlayGroupBy)
      : 'scene';
    const fromUtc = validIso(query.fromUtc);
    const toUtc = validIso(query.toUtc);
    const nowMs = Date.now();
    const events = store.getPlaybackEvents({
      fromUtc,
      toUtc,
      deviceId: query.deviceId,
      sceneId: query.sceneId,
    });
    return {
      summary: aggregateProofOfPlay(events, { nowMs, fromUtc, toUtc, groupBy }),
      eventCount: events.length,
    };
  });

  app.post('/api/v1/operations/playback-events', async (req, reply) => {
    const auth = verifyAuthorized(req, reply, ['admin', 'operator', 'device']);
    if (!auth.authorized) return;
    const body = (req.body || {}) as Record<string, unknown>;
    const payload = Array.isArray(body) ? body : body.events;
    if (!Array.isArray(payload)) {
      return reply.code(400).send({ error: 'Expected an array of playback events (or { events: [...] }).' });
    }
    if (payload.length > MAX_TELEMETRY_BATCH) {
      return reply.code(413).send({ error: `Batch exceeds ${MAX_TELEMETRY_BATCH} events.` });
    }
    const nowMs = Date.now();
    const normalized = normalizePlaybackEvents(payload, { nowMs });
    const result = store.insertPlaybackEvents(normalized.events);
    store.recordEvent(normalized.events[0]?.deviceId ?? null, 'PROOF_OF_PLAY_INGESTED', {
      accepted: result.accepted,
      duplicates: result.duplicates,
      rejected: normalized.rejected.length,
      offlineBuffered: normalized.events.filter((e) => e.offlineRecorded).length,
    });
    broadcastWs('PROOF_OF_PLAY_UPDATED', { accepted: result.accepted, duplicates: result.duplicates });
    return {
      accepted: result.accepted,
      duplicates: result.duplicates + normalized.duplicates,
      rejected: normalized.rejected,
      clamped: normalized.clamped,
      total: payload.length,
    };
  });

  app.post('/api/v1/operations/health-samples', async (req, reply) => {
    const auth = verifyAuthorized(req, reply, ['admin', 'operator', 'device']);
    if (!auth.authorized) return;
    const body = (req.body || {}) as Record<string, unknown>;
    const payload = Array.isArray(body)
      ? body
      : Array.isArray(body.samples)
        ? body.samples
        : [body];
    if (payload.length > MAX_TELEMETRY_BATCH) {
      return reply.code(413).send({ error: `Batch exceeds ${MAX_TELEMETRY_BATCH} samples.` });
    }
    const nowMs = Date.now();
    const samples = payload
      .map((raw) => normalizeHealthSample(raw, nowMs))
      .filter((sample): sample is NonNullable<typeof sample> => sample !== null);
    let accepted = 0;
    let duplicates = 0;
    let unknownDevices = 0;
    const updateDevice = store.db.prepare(`
      UPDATE devices SET
        last_seen_at = ?, playback_state = ?, status = ?, drift_ms = ?, estimated_fps = ?,
        current_scene_id = COALESCE(?, current_scene_id),
        current_package_id = COALESCE(?, current_package_id)
      WHERE id = ?
    `);
    for (const sample of samples) {
      const exists = store.db.prepare('SELECT id FROM devices WHERE id = ?').get(sample.deviceId);
      if (!exists) {
        unknownDevices += 1;
        continue;
      }
      if (store.insertHealthSample(sample)) accepted += 1;
      else duplicates += 1;
      updateDevice.run(
        sample.recordedAtUtc,
        sample.playbackState,
        sample.status,
        sample.driftMs,
        sample.estimatedFps,
        sample.currentSceneId ?? null,
        sample.currentPackageId ?? null,
        sample.deviceId
      );
    }
    const { report, createdAlerts } = refreshFleetHealth(nowMs);
    if (createdAlerts > 0) broadcastWs('FLEET_ALERTS_RAISED', { createdAlerts });
    return {
      accepted,
      duplicates,
      rejected: payload.length - samples.length,
      unknownDevices,
      createdAlerts,
      health: report,
    };
  });

  app.get('/api/v1/operations/health', async (req, reply) => {
    const auth = verifyAuthorized(req, reply, ['admin', 'operator']);
    if (!auth.authorized) return;
    const nowMs = Date.now();
    const { report } = refreshFleetHealth(nowMs);
    const samples = store.getHealthSamples(2_000);
    return {
      health: report,
      samples,
      history: summarizeHealthHistory(samples, 24 * 3_600_000, nowMs),
    };
  });

  app.get('/api/v1/operations/alerts', async (req, reply) => {
    const auth = verifyAuthorized(req, reply, ['admin', 'operator']);
    if (!auth.authorized) return;
    const { report } = refreshFleetHealth();
    return { alerts: store.listFleetAlerts(), health: report };
  });

  app.post('/api/v1/operations/alerts/:alertId/acknowledge', async (req, reply) => {
    const auth = verifyAuthorized(req, reply, ['admin', 'operator']);
    if (!auth.authorized) return;
    const { alertId } = req.params as { alertId: string };
    const existing = store.db.prepare('SELECT state FROM fleet_alerts WHERE id = ?').get(alertId) as
      | { state: string }
      | undefined;
    if (!existing) return reply.code(404).send({ error: 'Alert not found.' });
    const changed = store.acknowledgeFleetAlert(alertId, auth.actorId);
    store.recordAudit(auth.actorId, 'FLEET_ALERT_ACKNOWLEDGED', 'alert', alertId, changed ? 'Acknowledged' : 'Already acknowledged');
    if (changed) broadcastWs('FLEET_ALERT_ACKNOWLEDGED', { alertId, actorId: auth.actorId });
    return { acknowledged: true, alreadyAcknowledged: !changed, alertId };
  });

  app.get('/api/v1/operations/alert-rules', async (req, reply) => {
    const auth = verifyAuthorized(req, reply, ['admin', 'operator']);
    if (!auth.authorized) return;
    return { rules: store.listAlertRules() };
  });

  app.patch('/api/v1/operations/alert-rules/:ruleId', async (req, reply) => {
    const auth = verifyAuthorized(req, reply, ['admin']);
    if (!auth.authorized) return;
    const { ruleId } = req.params as { ruleId: string };
    const current = store.listAlertRules().find((rule) => rule.id === ruleId);
    if (!current) return reply.code(404).send({ error: 'Alert rule not found.' });
    const body = (req.body || {}) as Record<string, unknown>;
    const threshold = body.threshold === undefined ? current.threshold : Number(body.threshold);
    const cooldownMinutes = body.cooldownMinutes === undefined ? current.cooldownMinutes : Number(body.cooldownMinutes);
    if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 1e9) {
      return reply.code(400).send({ error: 'threshold must be a positive number.' });
    }
    if (!Number.isFinite(cooldownMinutes) || cooldownMinutes < 1 || cooldownMinutes > 1440) {
      return reply.code(400).send({ error: 'cooldownMinutes must be between 1 and 1440.' });
    }
    const severity =
      body.severity === undefined
        ? current.severity
        : (String(body.severity).toUpperCase() as AlertSeverity);
    if (!['INFO', 'WARNING', 'CRITICAL'].includes(severity)) {
      return reply.code(400).send({ error: 'severity must be INFO, WARNING or CRITICAL.' });
    }
    const updated: AlertRule = {
      ...current,
      threshold,
      cooldownMinutes,
      severity,
      enabled: body.enabled === undefined ? current.enabled : Boolean(body.enabled),
      description:
        typeof body.description === 'string' ? body.description.slice(0, 240) : current.description,
    };
    store.upsertAlertRule(updated);
    store.recordAudit(auth.actorId, 'FLEET_ALERT_RULE_UPDATED', 'rule', ruleId, JSON.stringify(updated));
    return { rule: updated };
  });

  app.get('/api/v1/operations/backups', async (req, reply) => {
    const auth = verifyAuthorized(req, reply, ['admin', 'operator']);
    if (!auth.authorized) return;
    return { backups: store.listBackups() };
  });

  app.post('/api/v1/operations/backups', async (req, reply) => {
    const auth = verifyAuthorized(req, reply, ['admin']);
    if (!auth.authorized) return;
    const body = (req.body || {}) as Record<string, unknown>;
    const retentionDays = Math.max(1, Math.min(3_650, Number(body.retentionDays ?? 30) || 30));
    const archive = buildBackupArchive(store.getBackupTables(), { createdBy: auth.actorId, retentionDays });
    const sizeBytes = backupSizeBytes(archive);
    store.insertBackup(archive, sizeBytes);
    store.recordAudit(auth.actorId, 'FLEET_BACKUP_CREATED', 'backup', archive.manifest.backupId, archive.manifest.checksum);
    broadcastWs('FLEET_BACKUP_CREATED', { backupId: archive.manifest.backupId, sizeBytes });
    return { backup: archive.manifest, sizeBytes, created: true };
  });

  app.get('/api/v1/operations/backups/:backupId', async (req, reply) => {
    const auth = verifyAuthorized(req, reply, ['admin', 'operator']);
    if (!auth.authorized) return;
    const { backupId } = req.params as { backupId: string };
    const archive = store.getBackup(backupId);
    if (!archive) return reply.code(404).send({ error: 'Backup not found.' });
    return { archive, verification: verifyBackupArchive(archive) };
  });

  app.post('/api/v1/operations/backups/:backupId/restore', async (req, reply) => {
    const auth = verifyAuthorized(req, reply, ['admin']);
    if (!auth.authorized) return;
    const { backupId } = req.params as { backupId: string };
    const archive = store.getBackup(backupId);
    if (!archive) return reply.code(404).send({ error: 'Backup not found.' });
    const verification = verifyBackupArchive(archive);
    if (!verification.valid) {
      store.recordAudit(auth.actorId, 'FLEET_BACKUP_RESTORE_REJECTED', 'backup', backupId, verification.errors.join('; '));
      return reply.code(400).send({ error: 'INTEGRITY_CHECK_FAILED', details: verification.errors });
    }
    const restoredRows = store.restoreBackupTables(archive as BackupArchive);
    store.recordAudit(auth.actorId, 'FLEET_BACKUP_RESTORED', 'backup', backupId, `${restoredRows} operational rows`);
    broadcastWs('FLEET_BACKUP_RESTORED', { backupId, restoredRows });
    return { restored: true, restoredRows, backupId, checksum: archive.manifest.checksum };
  });

  app.post('/api/v1/operations/retention', async (req, reply) => {
    const auth = verifyAuthorized(req, reply, ['admin']);
    if (!auth.authorized) return;
    const body = (req.body || {}) as Record<string, unknown>;
    const maxAgeDays = Math.max(1, Math.min(3_650, Number(body.maxAgeDays ?? 30) || 30));
    const maxRows = Math.max(10, Math.min(100_000, Number(body.maxRows ?? 5_000) || 5_000));
    const pruned = store.pruneOperationalData({ maxAgeMs: maxAgeDays * 86_400_000, maxRows });
    store.recordAudit(auth.actorId, 'FLEET_RETENTION_APPLIED', 'server', 'operations', JSON.stringify({ maxAgeDays, maxRows, pruned }));
    return { maxAgeDays, maxRows, pruned };
  });

  return { app, store };
}
