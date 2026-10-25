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
}

function createInitialStaticStore(): SimulatedStore {
  const nowIso = new Date().toISOString();
  const sessionStartIso = new Date(Date.now() - 12_000).toISOString();

  return {
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
        estimated_fps: 60,
        clock_offset_ms: -0.7,
        clock_uncertainty_ms: 2.2,
        drift_ms: -2,
        last_seen_at: nowIso,
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
  };
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
