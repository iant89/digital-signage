// ============================================================================
// src/services/staticServerSimulator.ts
// Seamless Client-Side Virtual Server Fallback for Static Hosts (GitHub Pages)
//
// When deployed as a static site (e.g. GitHub Pages), no Node.js Fastify server
// is running behind `/api/v1/*`. This fallback intercepts `/api/v1/*` requests
// ONLY when the upstream network request fails or returns a static-host HTML
// 404/405 response, providing full interactive support for the Network &
// Multi-Screen Synchronized Wall console in static deployments.
// ============================================================================

import { evaluateDriftCorrection } from '@packages/playback-engine';
import {
  AlertRule,
  BackupArchive,
  DEFAULT_ALERT_RULES,
  DeviceTelemetry,
  FleetAlert,
  HealthSample,
  PlaybackEvent,
  ProofOfPlayGroupBy,
  BackupTableSnapshot,
  aggregateProofOfPlay,
  applyRetention,
  backupSizeBytes,
  buildBackupArchive,
  createDemoHealthSamples,
  createDemoPlaybackEvents,
  evaluateFleetHealth,
  normalizePlaybackEvents,
  playbackEventToWire,
  summarizeHealthHistory,
  verifyBackupArchive,
} from '@packages/fleet-operations';

interface SimulatedStore {
  devices: Array<Record<string, unknown>>;
  enrollmentCodes: Array<Record<string, unknown>>;
  groups: Array<Record<string, unknown>>;
  packages: Array<Record<string, unknown>>;
  deployments: Array<Record<string, unknown>>;
  sessions: Array<Record<string, unknown>>;
  commands: Array<Record<string, unknown>>;
  auditLog: Array<Record<string, unknown>>;
  events: Array<Record<string, unknown>>;
  // Phase 15 fleet operations
  playbackEvents: PlaybackEvent[];
  healthSamples: HealthSample[];
  alertRules: AlertRule[];
  fleetAlerts: FleetAlert[];
  backups: BackupArchive[];
}

function createInitialStaticStore(): SimulatedStore {
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const sessionStartIso = new Date(nowMs - 12_000).toISOString();

  const initial: SimulatedStore = {
    devices: [
      {
        id: 'player-01',
        name: 'Lobby Wall — Tile 1 (NW)',
        location: 'Global HQ Atrium',
        assigned_display: 'Display-1 (1920x1080)',
        os: 'Linux Kiosk 6.8',
        status: 'ONLINE',
        playback_state: 'PLAYING',
        player_version: '1.0.0',
        current_package_id: 'pkg-apex-lobby-v1',
        current_scene_id: 'scene-welcome',
        estimated_fps: 60,
        clock_offset_ms: 2.1,
        clock_uncertainty_ms: 3.4,
        drift_ms: 4,
        last_seen_at: nowIso,
      },
      {
        id: 'player-02',
        name: 'Lobby Wall — Tile 2 (NE)',
        location: 'Global HQ Atrium',
        assigned_display: 'Display-2 (1920x1080)',
        os: 'Linux Kiosk 6.8',
        status: 'ONLINE',
        playback_state: 'PLAYING',
        player_version: '1.0.0',
        current_package_id: 'pkg-apex-lobby-v1',
        current_scene_id: 'scene-welcome',
        estimated_fps: 60,
        clock_offset_ms: -1.8,
        clock_uncertainty_ms: 2.9,
        drift_ms: -3,
        last_seen_at: nowIso,
      },
      {
        id: 'player-03',
        name: 'Lobby Wall — Tile 3 (SW)',
        location: 'Global HQ Atrium',
        assigned_display: 'Display-3 (1920x1080)',
        os: 'Linux Kiosk 6.8',
        status: 'ONLINE',
        playback_state: 'PLAYING',
        player_version: '1.0.0',
        current_package_id: 'pkg-apex-lobby-v1',
        current_scene_id: 'scene-welcome',
        estimated_fps: 60,
        clock_offset_ms: 1.2,
        clock_uncertainty_ms: 3.1,
        drift_ms: 2,
        last_seen_at: nowIso,
      },
      {
        id: 'player-04',
        name: 'Lobby Wall — Tile 4 (SE)',
        location: 'Global HQ Atrium',
        assigned_display: 'Display-4 (1920x1080)',
        os: 'Linux Kiosk 6.8',
        status: 'ONLINE',
        playback_state: 'PLAYING',
        player_version: '1.0.0',
        current_package_id: 'pkg-apex-lobby-v1',
        current_scene_id: 'scene-welcome',
        estimated_fps: 60,
        clock_offset_ms: 0.9,
        clock_uncertainty_ms: 2.5,
        drift_ms: 1,
        last_seen_at: nowIso,
      },
      {
        id: 'player-05',
        name: 'Cafe Menu Board East',
        location: 'Floor 2 Concourse',
        assigned_display: 'Display-1 (1920x1080)',
        os: 'Windows 11 Enterprise Kiosk',
        status: 'ONLINE',
        playback_state: 'PLAYING',
        player_version: '1.0.0',
        current_package_id: 'pkg-apex-lobby-v1',
        current_scene_id: 'scene-menu',
        estimated_fps: 60,
        clock_offset_ms: 3.4,
        clock_uncertainty_ms: 4.1,
        drift_ms: 6,
        last_seen_at: nowIso,
      },
      {
        id: 'player-06',
        name: 'Executive Briefing Kiosk',
        location: 'Tower B — 14th Floor',
        assigned_display: 'Display-1 (3840x2160)',
        os: 'Linux Kiosk 6.8',
        status: 'ONLINE',
        playback_state: 'PLAYING',
        player_version: '1.0.0',
        current_package_id: 'pkg-apex-lobby-v1',
        current_scene_id: 'scene-welcome',
        estimated_fps: 58,
        clock_offset_ms: -0.7,
        clock_uncertainty_ms: 2.2,
        drift_ms: 312,
        // Slightly stale heartbeat so the Fleet Operations demo shows a real
        // deterministic HEARTBEAT_STALE + CLOCK_DRIFT alert on static hosting.
        last_seen_at: new Date(nowMs - 95_000).toISOString(),
      },
    ],
    enrollmentCodes: [
      {
        code: 'ENROLL-APEX-2026',
        device_name: 'Lobby Reserve Spare #07',
        location: 'Global HQ Atrium',
        created_at: nowIso,
        expires_at: new Date(Date.now() + 86400_000).toISOString(),
        used_at: null,
      },
    ],
    groups: [
      {
        id: 'group-lobby-wall',
        name: 'Global HQ Lobby 2x2 Video Wall + Briefing',
        description: 'Frame-accurate synchronized lobby signage wall',
        topology: 'SYNCHRONIZED_WALL',
        sync_level: 'LEVEL_3_DRIFT_CONTROLLED',
        failure_policy: 'START_WITH_AVAILABLE',
        assigned_package_id: 'pkg-apex-lobby-v1',
        assigned_playlist_id: 'playlist-main-loop',
        memberIds: ['player-01', 'player-02', 'player-03', 'player-04', 'player-06'],
      },
      {
        id: 'group-cafe-menus',
        name: 'Campus Dining & Cafe Menu Boards',
        description: 'Synchronized digital menu boards',
        topology: 'IDENTICAL_GROUP',
        sync_level: 'LEVEL_2_TIMELINE',
        failure_policy: 'START_WITH_AVAILABLE',
        assigned_package_id: 'pkg-apex-lobby-v1',
        assigned_playlist_id: 'playlist-main-loop',
        memberIds: ['player-05'],
      },
    ],
    packages: [
      {
        id: 'pkg-apex-lobby-v1',
        project_id: 'proj-apex-corporate-2026',
        name: 'Apex Global Lobby & Menu Experience',
        version: 1,
        sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        size_bytes: 18432,
        compression_profile: 'compact',
        validation_status: 'VALID',
        created_at: nowIso,
      },
    ],
    deployments: [
      {
        id: 'dep-seed-001',
        package_id: 'pkg-apex-lobby-v1',
        target_group_id: 'group-lobby-wall',
        status: 'ACTIVE',
        created_at: nowIso,
      },
    ],
    sessions: [
      {
        id: 'session-20261025-001',
        group_id: 'group-lobby-wall',
        package_id: 'pkg-apex-lobby-v1',
        playlist_id: 'playlist-main-loop',
        timeline_revision: 1,
        start_time_utc: sessionStartIso,
        status: 'RUNNING',
        synchronization_policy: 'DRIFT_CORRECTED',
        failure_policy: 'START_WITH_AVAILABLE',
      },
    ],
    commands: [
      {
        id: 'cmd-seed-001',
        target_device_id: 'player-01',
        command_type: 'STATUS_REQUEST',
        status: 'SUCCEEDED',
        issued_by: 'admin',
        issued_at: nowIso,
        acknowledged_at: nowIso,
      },
    ],
    auditLog: [
      {
        id: 'aud-seed-001',
        actor: 'system-bootstrap',
        role: 'Admin',
        action: 'SERVER_INITIALIZED',
        target_id: 'group-lobby-wall',
        details_json: JSON.stringify({ mode: 'GitHub Pages Static Simulator' }),
        created_at: nowIso,
      },
    ],
    events: [
      {
        id: 'evt-seed-001',
        device_id: 'player-01',
        event_type: 'SESSION_SYNCHRONIZED',
        severity: 'INFO',
        created_at: nowIso,
      },
    ],
    playbackEvents: [],
    healthSamples: [],
    alertRules: [],
    fleetAlerts: [],
    backups: [],
  };

  const deviceIds = initial.devices.map((d) => String(d.id));
  initial.playbackEvents = normalizePlaybackEvents(createDemoPlaybackEvents(nowMs, deviceIds, 8), { nowMs })
    .events.map(playbackEventToWire);
  initial.healthSamples = createDemoHealthSamples(nowMs, deviceIds, 12);
  initial.alertRules = DEFAULT_ALERT_RULES.map((rule) => ({ ...rule }));
  const seedReport = evaluateFleetHealth(
    { devices: simulatedTelemetry(initial), rules: initial.alertRules },
    nowMs
  );
  initial.fleetAlerts = seedReport.alerts;
  return initial;
}

function simulatedTelemetry(store: SimulatedStore): DeviceTelemetry[] {
  const failureCounts = new Map<string, number>();
  for (const cmd of store.commands) {
    if (cmd.status === 'FAILED' || cmd.status === 'REJECTED') {
      const id = String(cmd.target_device_id || '');
      failureCounts.set(id, (failureCounts.get(id) ?? 0) + 1);
    }
  }
  return store.devices.map((device) => ({
    deviceId: String(device.id),
    name: String(device.name ?? device.id),
    lastSeenAtUtc: String(device.last_seen_at ?? ''),
    status: String(device.status ?? 'ONLINE'),
    playbackState: String(device.playback_state ?? 'PLAYING'),
    driftMs: Number(device.drift_ms ?? 0),
    estimatedFps: Number(device.estimated_fps ?? 60),
    commandFailures: failureCounts.get(String(device.id)) ?? 0,
    currentSceneId: device.current_scene_id ? String(device.current_scene_id) : undefined,
    currentPackageId: device.current_package_id ? String(device.current_package_id) : undefined,
  }));
}

function simulatedFleetReport(store: SimulatedStore, nowMs = Date.now()) {
  const report = evaluateFleetHealth({ devices: simulatedTelemetry(store), rules: store.alertRules }, nowMs);
  for (const alert of report.alerts) {
    if (!store.fleetAlerts.some((existing) => existing.id === alert.id)) store.fleetAlerts.unshift(alert);
  }
  store.fleetAlerts.sort((a, b) => b.triggeredAtUtc.localeCompare(a.triggeredAtUtc));
  return report;
}

function simulatedBackupTables(store: SimulatedStore): BackupTableSnapshot[] {
  const asRows = (items: Array<Record<string, unknown>>) => items.map((item) => ({ ...item }));
  return [
    { name: 'devices', rows: asRows(store.devices) },
    { name: 'groups', rows: asRows(store.groups) },
    { name: 'deployments', rows: asRows(store.deployments) },
    { name: 'commands', rows: asRows(store.commands) },
    { name: 'audit_log', rows: asRows(store.auditLog) },
    { name: 'events', rows: asRows(store.events) },
    { name: 'playback_events', rows: asRows(store.playbackEvents as unknown as Array<Record<string, unknown>>) },
    { name: 'health_samples', rows: asRows(store.healthSamples as unknown as Array<Record<string, unknown>>) },
    { name: 'alert_rules', rows: asRows(store.alertRules as unknown as Array<Record<string, unknown>>) },
    { name: 'fleet_alerts', rows: asRows(store.fleetAlerts as unknown as Array<Record<string, unknown>>) },
  ];
}

function simulatedBackupList(store: SimulatedStore) {
  return store.backups.map((archive) => ({
    id: archive.manifest.backupId,
    created_at_utc: archive.manifest.createdAtUtc,
    created_by: archive.manifest.createdBy,
    size_bytes: backupSizeBytes(archive),
    checksum: archive.manifest.checksum,
  }));
}

let staticStore: SimulatedStore | null = null;

function getStore(): SimulatedStore {
  if (!staticStore) {
    staticStore = createInitialStaticStore();
  }
  return staticStore;
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function handleSimulatedApiRequest(urlPath: string, init?: RequestInit): Promise<Response> {
  const store = getStore();
  const method = (init?.method || 'GET').toUpperCase();
  const bodyText = typeof init?.body === 'string' ? init.body : '';
  const body = bodyText ? JSON.parse(bodyText) : {};
  const nowIso = new Date().toISOString();
  const nowMs = Date.parse(nowIso);
  const [pathOnly, queryString = ''] = urlPath.split('?');
  const query = new URLSearchParams(queryString);

  if (pathOnly === '/api/v1/discovery' && method === 'GET') {
    // Static Pages has no LAN server, but the browser-side simulator still
    // answers the discovery contract so client probes behave consistently.
    const pageScheme =
      typeof window !== 'undefined' && window.location && window.location.protocol === 'https:' ? 'https' : 'http';
    const authority =
      typeof window !== 'undefined' && window.location && window.location.host
        ? window.location.host
        : 'static-pages.local:4000';
    return jsonResponse({
      service: 'digital-signage-studio',
      protocolVersion: 1,
      instanceId: 'srv-sim-static-pages',
      displayName: 'Digital Signage Studio (Static Simulator)',
      applicationVersion: '1.0.0',
      serverTimeUtc: nowIso,
      scheme: pageScheme,
      hostname: authority.split(':')[0],
      port: 4000,
      authority,
      baseUrl: `${pageScheme}://${authority}`,
      secure: pageScheme === 'https',
      requiresAuthentication: false,
      simulated: true,
      endpoints: {
        discovery: '/api/v1/discovery',
        overview: '/api/v1/server/overview',
        diagnostics: '/api/v1/diagnostics',
        operations: '/api/v1/operations/summary',
        websocket: '/ws',
      },
      features: [
        'network-sync',
        'device-enrollment',
        'package-repository',
        'playlists-schedules',
        'synchronized-sessions',
        'clock-sync',
        'remote-commands',
        'fleet-operations',
      ],
    });
  }

  if (urlPath === '/api/v1/server/overview' && method === 'GET') {
    const online = store.devices.filter((d) => d.status === 'ONLINE').length;
    const offline = store.devices.filter((d) => d.status !== 'ONLINE').length;
    const playing = store.devices.filter((d) => d.playback_state === 'PLAYING').length;
    const driftErrs = store.devices.filter((d) => Math.abs(Number(d.drift_ms || 0)) > 200).length;
    return jsonResponse({
      serverTimeUtc: nowIso,
      totalDevices: store.devices.length,
      onlineDevices: online,
      offlineDevices: offline,
      playingDevices: playing,
      activeSyncGroups: store.groups.length,
      sessionsWithSyncErrors: driftErrs,
      storageBytes: store.packages.reduce((acc, p) => acc + Number(p.size_bytes || 0), 0),
      recentEvents: store.events.slice(0, 12),
    });
  }

  if (urlPath === '/api/v1/clock/sync' && method === 'POST') {
    const serverNow = Date.now();
    return jsonResponse({
      t1ClientSendMs: Number(body.t1ClientSendMs || serverNow),
      t2ServerRecvMs: serverNow,
      t3ServerSendMs: Date.now(),
      serverUtcIso: new Date(serverNow).toISOString(),
    });
  }

  if (urlPath === '/api/v1/devices' && method === 'GET') {
    return jsonResponse({
      devices: store.devices,
      enrollmentCodes: store.enrollmentCodes,
    });
  }

  if (urlPath === '/api/v1/devices/enrollment-codes' && method === 'POST') {
    const code = `ENROLL-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const entry = {
      code,
      device_name: body.deviceName || 'New Signage Player',
      location: body.location || 'Main Floor',
      created_at: nowIso,
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
      used_at: null,
    };
    store.enrollmentCodes.unshift(entry);
    return jsonResponse(entry, 201);
  }

  if (urlPath === '/api/v1/devices/enroll' && method === 'POST') {
    if (body.enrollmentCode) {
      const found = store.enrollmentCodes.find((c) => c.code === body.enrollmentCode);
      if (!found || found.used_at) {
        return jsonResponse({ error: 'Invalid or already-used enrollment code' }, 400);
      }
      found.used_at = nowIso;
    }
    const newId = `player-0${store.devices.length + 1}`;
    const dev = {
      id: newId,
      name: body.deviceName || `Wall Display #${store.devices.length + 1}`,
      location: body.location || 'Atrium',
      assigned_display: 'Display-1 (1920x1080)',
      os: 'Linux Kiosk 6.8',
      status: 'ONLINE',
      playback_state: 'PLAYING',
      player_version: '1.0.0',
      current_package_id: 'pkg-apex-lobby-v1',
      current_scene_id: 'scene-welcome',
      estimated_fps: 60,
      clock_offset_ms: 1.1,
      clock_uncertainty_ms: 2.4,
      drift_ms: 2,
      last_seen_at: nowIso,
    };
    store.devices.push(dev);
    store.auditLog.unshift({
      id: `aud-${Date.now()}`,
      actor: 'admin',
      role: 'Admin',
      action: 'DEVICE_ENROLLED',
      target_id: newId,
      details_json: JSON.stringify({ name: dev.name }),
      created_at: nowIso,
    });
    return jsonResponse({
      deviceId: newId,
      deviceName: dev.name,
      deviceToken: `tok-${Date.now()}`,
    }, 201);
  }

  if (urlPath.startsWith('/api/v1/devices/') && urlPath.endsWith('/heartbeat') && method === 'POST') {
    const devId = urlPath.split('/')[4];
    const dev = store.devices.find((d) => d.id === devId);
    if (dev) {
      dev.status = body.status || 'ONLINE';
      dev.playback_state = body.playbackState || 'PLAYING';
      dev.drift_ms = Number(body.driftMs ?? 2);
      dev.last_seen_at = nowIso;
    }
    return jsonResponse({ ok: true });
  }

  if (urlPath.startsWith('/api/v1/devices/') && urlPath.endsWith('/revoke') && method === 'POST') {
    const devId = urlPath.split('/')[4];
    const dev = store.devices.find((d) => d.id === devId);
    if (dev) {
      dev.status = 'OFFLINE';
      dev.playback_state = 'REVOKED';
    }
    store.auditLog.unshift({
      id: `aud-${Date.now()}`,
      actor: 'admin',
      role: 'Admin',
      action: 'DEVICE_CREDENTIAL_REVOKED',
      target_id: devId,
      details_json: '{}',
      created_at: nowIso,
    });
    return jsonResponse({ revoked: true, deviceId: devId });
  }

  if (urlPath.startsWith('/api/v1/devices/') && method === 'PATCH') {
    const devId = urlPath.split('/')[4];
    const dev = store.devices.find((d) => d.id === devId);
    if (dev) {
      if (body.status) dev.status = body.status;
      if (body.playbackState) dev.playback_state = body.playbackState;
    }
    return jsonResponse({ ok: true });
  }

  if (urlPath === '/api/v1/groups' && method === 'GET') {
    return jsonResponse({ groups: store.groups });
  }

  if (urlPath === '/api/v1/packages' && method === 'GET') {
    return jsonResponse({ packages: store.packages, deployments: store.deployments });
  }

  if (urlPath === '/api/v1/deployments' && method === 'POST') {
    const dep = {
      id: `dep-${Date.now()}`,
      package_id: body.packageId || 'pkg-apex-lobby-v1',
      target_group_id: body.targetGroupId || 'group-lobby-wall',
      status: 'ACTIVE',
      created_at: nowIso,
    };
    store.deployments.unshift(dep);
    return jsonResponse({ deployment: dep }, 201);
  }

  if (urlPath === '/api/v1/sessions' && method === 'GET') {
    return jsonResponse({ sessions: store.sessions });
  }

  if (urlPath === '/api/v1/sessions' && method === 'POST') {
    const leadTimeMs = Number(body.leadTimeMs ?? 2500);
    const startUtc = new Date(Date.now() + leadTimeMs).toISOString();
    const newSession = {
      id: `session-${Date.now()}`,
      group_id: body.groupId || 'group-lobby-wall',
      package_id: body.packageId || 'pkg-apex-lobby-v1',
      playlist_id: body.playlistId || 'playlist-main-loop',
      timeline_revision: Number(store.sessions[0]?.timeline_revision || 1) + 1,
      start_time_utc: startUtc,
      status: 'RUNNING',
      synchronization_policy: 'DRIFT_CORRECTED',
      failure_policy: 'START_WITH_AVAILABLE',
    };
    store.sessions.unshift(newSession);
    return jsonResponse({ session: newSession }, 201);
  }

  if (urlPath.startsWith('/api/v1/sessions/') && urlPath.endsWith('/report') && method === 'POST') {
    const dev = store.devices.find((d) => d.id === body.deviceId);
    const sceneId = String(body.actualSceneId || 'scene-welcome');
    const driftMs = 780;
    if (dev) dev.drift_ms = driftMs;
    const correction = evaluateDriftCorrection(sceneId, sceneId, 0, driftMs);
    return jsonResponse({ driftMs, correction });
  }

  if (urlPath.startsWith('/api/v1/sessions/') && urlPath.endsWith('/resynchronize') && method === 'POST') {
    for (const dev of store.devices) {
      dev.drift_ms = 3;
    }
    return jsonResponse({ resynchronized: true });
  }

  if (urlPath === '/api/v1/commands' && method === 'GET') {
    return jsonResponse({ commands: store.commands });
  }

  if (urlPath === '/api/v1/commands' && method === 'POST') {
    const cmd = {
      id: `cmd-${Date.now()}`,
      target_device_id: body.targetDeviceId || 'player-01',
      command_type: body.commandType || 'STATUS_REQUEST',
      status: 'SUCCEEDED',
      issued_by: 'admin',
      issued_at: nowIso,
      acknowledged_at: nowIso,
    };
    store.commands.unshift(cmd);
    store.auditLog.unshift({
      id: `aud-${Date.now()}`,
      actor: 'admin',
      role: 'Admin',
      action: `COMMAND_${cmd.command_type}`,
      target_id: cmd.target_device_id,
      details_json: JSON.stringify({ commandId: cmd.id }),
      created_at: nowIso,
    });
    return jsonResponse({ command: cmd }, 201);
  }

  if (urlPath === '/api/v1/audit-log' && method === 'GET') {
    return jsonResponse({ auditLog: store.auditLog });
  }

  // --------------------------------------------------------------------------
  // Phase 15: Fleet Operations fallback (proof-of-play, health, alerts, backups)
  // --------------------------------------------------------------------------

  if (pathOnly === '/api/v1/operations/summary' && method === 'GET') {
    const health = simulatedFleetReport(store, nowMs);
    const todayStartIso = `${nowIso.slice(0, 10)}T00:00:00.000Z`;
    const proofOfPlayToday = aggregateProofOfPlay(store.playbackEvents, {
      nowMs,
      fromUtc: todayStartIso,
      groupBy: 'scene',
    });
    return jsonResponse({
      generatedAtUtc: nowIso,
      health,
      healthHistory: summarizeHealthHistory(store.healthSamples, 24 * 3_600_000, nowMs),
      alerts: store.fleetAlerts,
      rules: store.alertRules,
      proofOfPlayToday,
      backups: simulatedBackupList(store),
    });
  }

  if (pathOnly === '/api/v1/operations/proof-of-play' && method === 'GET') {
    const requested = query.get('groupBy') ?? 'scene';
    const groupBy: ProofOfPlayGroupBy = (['scene', 'device-scene', 'device', 'day'] as string[]).includes(requested)
      ? (requested as ProofOfPlayGroupBy)
      : 'scene';
    const summary = aggregateProofOfPlay(store.playbackEvents, {
      nowMs,
      fromUtc: query.get('fromUtc') ?? undefined,
      toUtc: query.get('toUtc') ?? undefined,
      groupBy,
    });
    return jsonResponse({ summary, eventCount: store.playbackEvents.length });
  }

  if (pathOnly === '/api/v1/operations/playback-events' && method === 'POST') {
    const payload = Array.isArray(body) ? body : body.events;
    if (!Array.isArray(payload)) return jsonResponse({ error: 'Expected an array of playback events.' }, 400);
    const normalized = normalizePlaybackEvents(payload, { nowMs });
    const known = new Set(store.playbackEvents.map((event) => event.eventId));
    let accepted = 0;
    let duplicates = normalized.duplicates;
    for (const event of normalized.events) {
      if (known.has(event.eventId)) {
        duplicates += 1;
        continue;
      }
      known.add(event.eventId);
      store.playbackEvents.push(playbackEventToWire(event));
      accepted += 1;
    }
    store.events.unshift({
      id: `evt-pop-${nowMs}`,
      device_id: normalized.events[0]?.deviceId ?? null,
      event_type: 'PROOF_OF_PLAY_INGESTED',
      severity: 'INFO',
      created_at: nowIso,
    });
    return jsonResponse({
      accepted,
      duplicates,
      rejected: normalized.rejected,
      clamped: normalized.clamped,
      total: payload.length,
    });
  }

  if (pathOnly === '/api/v1/operations/health-samples' && method === 'POST') {
    const payload: unknown[] = Array.isArray(body)
      ? body
      : Array.isArray(body.samples)
        ? body.samples
        : [body];
    let accepted = 0;
    let duplicates = 0;
    let invalid = 0;
    let unknownDevices = 0;
    const alertCountBefore = store.fleetAlerts.length;
    for (const raw of payload) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        invalid += 1;
        continue;
      }
      const input = raw as Record<string, unknown>;
      const deviceId = typeof input.deviceId === 'string' ? input.deviceId.trim() : '';
      const device = store.devices.find((d) => String(d.id) === deviceId);
      if (!device) {
        unknownDevices += 1;
        continue;
      }
      const num = (value: unknown, fallback: number) => {
        const parsed = typeof value === 'number' ? value : Number(value);
        return Number.isFinite(parsed) ? parsed : fallback;
      };
      const sample: HealthSample = {
        sampleId: typeof input.sampleId === 'string' && input.sampleId ? input.sampleId : `sim-hs-${nowMs}-${accepted}`,
        deviceId,
        recordedAtUtc: nowIso,
        playbackState: typeof input.playbackState === 'string' ? input.playbackState : 'PLAYING',
        status: typeof input.status === 'string' ? input.status : 'ONLINE',
        driftMs: num(input.driftMs, 0),
        estimatedFps: num(input.estimatedFps, 60),
        errorCount: num(input.errorCount, 0),
        clockUncertaintyMs: num(input.clockUncertaintyMs, 0),
        currentSceneId: typeof input.currentSceneId === 'string' ? input.currentSceneId : undefined,
        currentPackageId: typeof input.currentPackageId === 'string' ? input.currentPackageId : undefined,
      };
      if (store.healthSamples.some((s) => s.sampleId === sample.sampleId)) duplicates += 1;
      else {
        store.healthSamples.push(sample);
        accepted += 1;
      }
      device.last_seen_at = sample.recordedAtUtc;
      device.playback_state = sample.playbackState;
      device.status = sample.status;
      device.drift_ms = sample.driftMs;
      device.estimated_fps = sample.estimatedFps;
      if (sample.currentSceneId) device.current_scene_id = sample.currentSceneId;
      if (sample.currentPackageId) device.current_package_id = sample.currentPackageId;
    }
    const health = simulatedFleetReport(store, nowMs);
    return jsonResponse({
      accepted,
      duplicates,
      rejected: invalid,
      unknownDevices,
      createdAlerts: Math.max(0, store.fleetAlerts.length - alertCountBefore),
      health,
    });
  }

  if (pathOnly === '/api/v1/operations/health' && method === 'GET') {
    const health = simulatedFleetReport(store, nowMs);
    return jsonResponse({
      health,
      samples: store.healthSamples,
      history: summarizeHealthHistory(store.healthSamples, 24 * 3_600_000, nowMs),
    });
  }

  if (pathOnly === '/api/v1/operations/alerts' && method === 'GET') {
    const health = simulatedFleetReport(store, nowMs);
    return jsonResponse({ alerts: store.fleetAlerts, health });
  }

  const acknowledgeMatch = pathOnly.match(/^\/api\/v1\/operations\/alerts\/([^/]+)\/acknowledge$/);
  if (acknowledgeMatch && method === 'POST') {
    const alert = store.fleetAlerts.find((a) => a.id === decodeURIComponent(acknowledgeMatch[1]));
    if (!alert) return jsonResponse({ error: 'Alert not found.' }, 404);
    const changed = alert.state === 'ACTIVE';
    alert.state = 'ACKNOWLEDGED';
    alert.acknowledgedAtUtc = nowIso;
    alert.acknowledgedBy = 'admin';
    return jsonResponse({ acknowledged: true, alreadyAcknowledged: !changed, alertId: alert.id });
  }

  if (pathOnly === '/api/v1/operations/alert-rules' && method === 'GET') {
    return jsonResponse({ rules: store.alertRules });
  }

  const ruleMatch = pathOnly.match(/^\/api\/v1\/operations\/alert-rules\/([^/]+)$/);
  if (ruleMatch && method === 'PATCH') {
    const rule = store.alertRules.find((r) => r.id === decodeURIComponent(ruleMatch[1]));
    if (!rule) return jsonResponse({ error: 'Alert rule not found.' }, 404);
    if (body.threshold !== undefined) rule.threshold = Number(body.threshold) || rule.threshold;
    if (body.cooldownMinutes !== undefined) rule.cooldownMinutes = Number(body.cooldownMinutes) || rule.cooldownMinutes;
    if (body.enabled !== undefined) rule.enabled = Boolean(body.enabled);
    if (body.severity !== undefined) rule.severity = String(body.severity).toUpperCase() as AlertRule['severity'];
    if (body.description !== undefined) rule.description = String(body.description);
    return jsonResponse({ rule });
  }

  if (pathOnly === '/api/v1/operations/backups' && method === 'GET') {
    return jsonResponse({ backups: simulatedBackupList(store) });
  }

  if (pathOnly === '/api/v1/operations/backups' && method === 'POST') {
    const archive = buildBackupArchive(simulatedBackupTables(store), {
      createdBy: 'admin',
      retentionDays: Number(body.retentionDays) || 30,
    });
    store.backups.unshift(archive);
    store.auditLog.unshift({
      id: `aud-backup-${nowMs}`,
      actor: 'admin',
      role: 'Admin',
      action: 'FLEET_BACKUP_CREATED',
      target_id: archive.manifest.backupId,
      details_json: JSON.stringify({ checksum: archive.manifest.checksum }),
      created_at: nowIso,
    });
    return jsonResponse({ backup: archive.manifest, sizeBytes: backupSizeBytes(archive), created: true }, 201);
  }

  const backupMatch = pathOnly.match(/^\/api\/v1\/operations\/backups\/([^/]+)(\/restore)?$/);
  if (backupMatch && (method === 'GET' || method === 'POST')) {
    const backupId = decodeURIComponent(backupMatch[1]);
    const archive = store.backups.find((b) => b.manifest.backupId === backupId);
    if (!archive) return jsonResponse({ error: 'Backup not found.' }, 404);
    if (method === 'GET') {
      return jsonResponse({ archive, verification: verifyBackupArchive(archive) });
    }
    const verification = verifyBackupArchive(archive);
    if (!verification.valid) return jsonResponse({ error: 'INTEGRITY_CHECK_FAILED', details: verification.errors }, 400);
    let restoredRows = 0;
    for (const table of archive.tables) {
      if (table.name === 'playback_events') store.playbackEvents = table.rows as unknown as PlaybackEvent[];
      else if (table.name === 'health_samples') store.healthSamples = table.rows as unknown as HealthSample[];
      else if (table.name === 'alert_rules') store.alertRules = table.rows as unknown as AlertRule[];
      else if (table.name === 'fleet_alerts') store.fleetAlerts = table.rows as unknown as FleetAlert[];
      else continue;
      restoredRows += table.rows.length;
    }
    return jsonResponse({ restored: true, restoredRows, backupId, checksum: archive.manifest.checksum });
  }

  if (pathOnly === '/api/v1/operations/retention' && method === 'POST') {
    const maxAgeDays = Math.max(1, Number(body.maxAgeDays) || 30);
    const maxRows = Math.max(10, Number(body.maxRows) || 5_000);
    const opts = { nowMs, maxAgeMs: maxAgeDays * 86_400_000, maxRows };
    const retention = <T extends Record<string, unknown>>(items: T[], timeKey: string) =>
      applyRetention(items, { ...opts, getTimestamp: (item) => String(item[timeKey] ?? '') });
    const playback = retention(store.playbackEvents as unknown as Array<Record<string, unknown>>, 'startedAtUtc');
    const health = retention(store.healthSamples as unknown as Array<Record<string, unknown>>, 'recordedAtUtc');
    const events = retention(store.events, 'created_at');
    const audit = retention(store.auditLog, 'created_at');
    store.playbackEvents = playback.kept as unknown as PlaybackEvent[];
    store.healthSamples = health.kept as unknown as HealthSample[];
    store.events = events.kept;
    store.auditLog = audit.kept;
    return jsonResponse({
      maxAgeDays,
      maxRows,
      pruned: {
        playback_events: { pruned: playback.pruned.length, ...playback.byReason },
        health_samples: { pruned: health.pruned.length, ...health.byReason },
        events: { pruned: events.pruned.length, ...events.byReason },
        audit_log: { pruned: audit.pruned.length, ...audit.byReason },
      },
    });
  }

  return jsonResponse({ ok: true });
}

export function installStaticServerFallback(): void {
  if (typeof window === 'undefined' || typeof window.fetch !== 'function') return;
  const originalFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url;
    const apiIdx = urlStr.indexOf('/api/v1/');
    if (apiIdx === -1) {
      return originalFetch(input, init);
    }

    const apiPath = urlStr.slice(apiIdx);
    try {
      const response = await originalFetch(input, init);
      const contentType = response.headers.get('content-type') || '';
      // If a real Fastify API server answered with JSON, return its response directly
      if (contentType.includes('application/json') || contentType.includes('application/vnd.digital-signage')) {
        return response;
      }
      // Otherwise (e.g. GitHub Pages returning a static HTML 404/405 page), fall back to the static simulator
      return handleSimulatedApiRequest(apiPath, init);
    } catch {
      // Network error reaching `/api/v1/*` on static hosting -> serve from static simulator
      return handleSimulatedApiRequest(apiPath, init);
    }
  };
}
