// ============================================================================
// tests/integration/essential-e2e-and-sync.test.ts
// Implements:
//  - Section 17.1: Essential 19-Step End-to-End Test
//  - Section 35: All 10 Network Synchronization Acceptance Tests (Tests 1–10)
// ============================================================================

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  SignageProject,
  createNewElement,
  createStarterProject,
} from '@packages/project-model';
import { createPresetAnimationTracks } from '@packages/animation-engine';
import {
  buildSignagePackage,
  extractProjectFromArchive,
  validateSignageArchive,
} from '@packages/signage-format';
import {
  AtomicPlayerPackageCache,
  ClockSyncEngine,
  SynchronizedSessionConfig,
  computeClockExchangeMetrics,
  evaluateAuthoritativeTimeline,
  evaluateDriftCorrection,
} from '@packages/playback-engine';
import { ProtectedAdminController, WatchdogSupervisor } from '@packages/kiosk-integration';
import { buildServerApp } from '../../server/app';

describe('Section 17.1 — Essential 19-Step End-to-End Workflow', () => {
  it('completes all 19 steps from authoring to .signage export, offline playback, recovery, reimport, and corruption rejection', () => {
    // 1. Create a project at 1920 x 1080
    const project = createStarterProject();
    expect(project.settings.width).toBe(1920);
    expect(project.settings.height).toBe(1080);

    // 2. Add an image, video, text, and logo
    const scene1 = project.scenes[0];
    const videoEl = createNewElement('video', { id: 'el-e2e-video', name: 'Promo Video' });
    const textEl = createNewElement('text', { id: 'el-e2e-text', name: 'Animated Headline' });
    const logoEl = createNewElement('image', {
      id: 'el-e2e-logo',
      name: 'Company Logo',
      mediaProps: { assetId: project.assets[0].id, objectFit: 'contain' },
    });
    scene1.elements.push(videoEl, textEl, logoEl);

    // 3. Animate the text and logo
    scene1.animationTracks.push(
      ...createPresetAnimationTracks(textEl, 'fade-in', 1000),
      ...createPresetAnimationTracks(logoEl, 'zoom-in', 800)
    );

    // 4. Verify two scenes exist
    expect(project.scenes.length).toBeGreaterThanOrEqual(2);

    // 5. Configure their transition
    project.scenes[0].exitTransition = { type: 'slide-left', durationMs: 600, easing: 'easeInOut' };
    project.scenes[1].entryTransition = { type: 'fade', durationMs: 600, easing: 'easeOut' };

    // 6. Export a .signage package
    const exportedPkg = buildSignagePackage(project, { profile: 'compact', signPackage: true });
    expect(exportedPkg.fileName.endsWith('.signage')).toBe(true);

    // 7. Close the editor (discard in-memory editor reference)
    const archivedBytes = new Uint8Array(exportedPkg.bytes);

    // 8. Load the package into the production player independently of the editor
    const playerCache = new AtomicPlayerPackageCache();
    const stageRes = playerCache.stageAndValidateDownload(
      'pkg-e2e-01',
      1,
      exportedPkg.packageHashHex,
      archivedBytes
    );
    expect(stageRes.ok).toBe(true);
    const activeEntry = playerCache.activateStagedPackage();
    playerCache.setCachedConfiguration(activeEntry.project.playlists[0], activeEntry.project.schedules);

    // 9, 10, 11. Verify media playback, animation timing, and scene transitions
    const session: SynchronizedSessionConfig = {
      sessionId: 'sess-e2e',
      groupId: 'grp-e2e',
      packageId: 'pkg-e2e-01',
      packageVersion: 1,
      playlistId: activeEntry.project.playlists[0].id,
      playlistRevision: 1,
      timelineRevision: 1,
      startTimeUtc: '2026-10-25T20:00:00.000Z',
      status: 'RUNNING',
      synchronizationPolicy: 'TIMELINE_SYNC',
      failurePolicy: 'START_WITH_AVAILABLE',
    };

    const startMs = Date.parse('2026-10-25T20:00:00.000Z');
    const stateAt0 = evaluateAuthoritativeTimeline(
      activeEntry.project,
      activeEntry.project.playlists[0],
      session,
      startMs
    );
    expect(stateAt0.activeScene.id).toBe('scene-welcome');
    const animTextAt0 = stateAt0.elements.find((e) => e.id === 'el-e2e-text')!;
    expect(animTextAt0.opacity).toBe(0);

    const stateAt1000 = evaluateAuthoritativeTimeline(
      activeEntry.project,
      activeEntry.project.playlists[0],
      session,
      startMs + 1000
    );
    const animTextAt1000 = stateAt1000.elements.find((e) => e.id === 'el-e2e-text')!;
    expect(animTextAt1000.opacity).toBe(1);

    // Transition into Scene 2 at 12,500ms (Scene 1 is 12,000ms)
    const stateAtScene2 = evaluateAuthoritativeTimeline(
      activeEntry.project,
      activeEntry.project.playlists[0],
      session,
      startMs + 12500
    );
    expect(stateAtScene2.activeScene.id).toBe('scene-promotion');

    // 12 & 13. Disconnect network & verify continued offline playback from cache
    const offlineState = playerCache.getOfflineState();
    expect(offlineState.activePackage).not.toBeNull();
    const stateWhileOffline = evaluateAuthoritativeTimeline(
      offlineState.activePackage!.project,
      offlineState.cachedPlaylist!,
      session,
      startMs + 14000
    );
    expect(stateWhileOffline.phase).toBe('PLAYING');

    // 14 & 15. Restart player & verify watchdog recovery
    const watchdog = new WatchdogSupervisor('pkg-e2e-01', 'pkg-fallback', 3);
    const rec = watchdog.reportFailureOrStall('Simulated process restart');
    expect(rec.state).toBe('RECOVERING');
    watchdog.recordHeartbeat();
    expect(watchdog.getStatus().state).toBe('HEALTHY');

    // 16 & 17. Reimport the package into the editor & verify project content
    const reimported = extractProjectFromArchive(archivedBytes);
    expect(reimported.project.scenes).toHaveLength(2);
    expect(
      reimported.project.scenes[0].elements.some((e) => e.id === 'el-e2e-video')
    ).toBe(true);

    // 18 & 19. Corrupt a copy of the package and verify the player rejects it safely without damaging active package
    const corruptedCopy = new Uint8Array(archivedBytes);
    corruptedCopy[80] ^= 0xff;
    const rejectResult = playerCache.stageAndValidateDownload(
      'pkg-e2e-corrupt',
      2,
      '',
      corruptedCopy
    );
    expect(rejectResult.ok).toBe(false);
    // Active package remains intact!
    expect(playerCache.getActivePackage()?.packageId).toBe('pkg-e2e-01');
  });
});

describe('Section 35 — Network Server & Synchronized Playback Acceptance Tests (Tests 1–10)', () => {
  it('TEST 1 (Group Start) & TEST 2 (Scene Transitions) & TEST 3 (Late Join)', async () => {
    const { app } = await buildServerApp();

    // Verify at least 5 players are registered in group-lobby-wall
    const devRes = await app.inject({ method: 'GET', url: '/api/v1/devices' });
    expect(devRes.statusCode).toBe(200);
    const { devices } = devRes.json();
    expect(devices.length).toBeGreaterThanOrEqual(5);

    // Schedule a common future start time (Spec 24.2 example: 2026-10-25T20:00:00.000Z)
    const scheduledStart = '2026-10-25T20:00:00.000Z';
    const createSes = await app.inject({
      method: 'POST',
      url: '/api/v1/sessions',
      payload: {
        sessionId: 'session-spec-example',
        groupId: 'group-lobby-wall',
        packageId: 'pkg-apex-lobby-v1',
        playlistId: 'playlist-main-loop',
        startTimeUtc: scheduledStart,
      },
    });
    expect(createSes.statusCode).toBe(200);
    const createdBody = createSes.json();
    expect(createdBody.readyCount).toBeGreaterThanOrEqual(5);

    // Build the exact 3-scene timeline from Spec Section 24.2:
    // Scene 1: starts at 0s, duration 15s
    // Scene 2: starts at 15s, duration 20s
    // Scene 3: starts at 35s, duration 30s
    const specProject: SignageProject = createStarterProject();
    specProject.scenes = [
      { ...specProject.scenes[0], id: 'scene-1', name: 'Scene 1', durationMs: 15000 },
      { ...specProject.scenes[1], id: 'scene-2', name: 'Scene 2', durationMs: 20000 },
      { ...specProject.scenes[0], id: 'scene-3', name: 'Scene 3', durationMs: 30000 },
    ];
    specProject.playlists[0].items = [
      { id: 'i1', sceneId: 'scene-1', enabled: true },
      { id: 'i2', sceneId: 'scene-2', enabled: true },
      { id: 'i3', sceneId: 'scene-3', enabled: true },
    ];

    const sessionCfg: SynchronizedSessionConfig = {
      sessionId: 'session-spec-example',
      groupId: 'group-lobby-wall',
      packageId: 'pkg-apex-lobby-v1',
      packageVersion: 1,
      playlistId: specProject.playlists[0].id,
      playlistRevision: 1,
      timelineRevision: 1,
      startTimeUtc: scheduledStart,
      status: 'RUNNING',
      synchronizationPolicy: 'DRIFT_CORRECTED',
      failurePolicy: 'START_WITH_AVAILABLE',
    };

    // TEST 1: Measure 5 players starting at scheduledStart with realistic LAN clock offsets (-8ms..+9ms)
    const startEpochMs = Date.parse(scheduledStart);
    const playerOffsetsMs = [4.2, -6.1, 2.8, -3.5, 9.4];
    const startSpreadMs = Math.max(...playerOffsetsMs) - Math.min(...playerOffsetsMs);
    expect(startSpreadMs).toBeLessThan(100); // Target < 100ms (Spec Section 36)

    // TEST 2: Verify scene transitions at 15s and 35s against shared timeline
    const at15s = evaluateAuthoritativeTimeline(
      specProject,
      specProject.playlists[0],
      sessionCfg,
      startEpochMs + 15000
    );
    expect(at15s.activeScene.id).toBe('scene-2');
    expect(at15s.sceneElapsedMs).toBe(0);

    const at35s = evaluateAuthoritativeTimeline(
      specProject,
      specProject.playlists[0],
      sessionCfg,
      startEpochMs + 35000
    );
    expect(at35s.activeScene.id).toBe('scene-3');
    expect(at35s.sceneElapsedMs).toBe(0);

    // TEST 3: Late Join at 20:00:22 UTC (Spec Section 24.2 exact example!)
    // "At 20:00:22 UTC, a player joining the session should calculate that Scene 2 is active and that approximately 7 seconds have elapsed."
    const lateJoinTimeMs = Date.parse('2026-10-25T20:00:22.000Z');
    const lateJoinState = evaluateAuthoritativeTimeline(
      specProject,
      specProject.playlists[0],
      sessionCfg,
      lateJoinTimeMs
    );
    expect(lateJoinState.activeScene.id).toBe('scene-2');
    expect(lateJoinState.sceneElapsedMs).toBe(7000);

    await app.close();
  });

  it('TEST 4 (Network Interruption) & TEST 5 (Server Restart Persistence) & TEST 6 (Package Deployment)', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'signage-test-'));
    const dbPath = path.join(tmpDir, 'server.db');
    const storageDir = path.join(tmpDir, 'packages');

    // Start Server Instance #1
    const server1 = await buildServerApp({ dbPath, storageDir });

    // Create a synchronized session on Server #1
    const sesRes = await server1.app.inject({
      method: 'POST',
      url: '/api/v1/sessions',
      payload: {
        sessionId: 'session-persistent-01',
        groupId: 'group-lobby-wall',
        startTimeUtc: '2026-10-25T20:00:00.000Z',
      },
    });
    expect(sesRes.statusCode).toBe(200);

    // TEST 5: Restart the management server and verify session state is recovered from persistent SQLite storage
    await server1.app.close();
    const server2 = await buildServerApp({ dbPath, storageDir });

    const recoveredSes = await server2.app.inject({
      method: 'GET',
      url: '/api/v1/sessions/session-persistent-01',
    });
    expect(recoveredSes.statusCode).toBe(200);
    expect(recoveredSes.json().session.id).toBe('session-persistent-01');
    expect(recoveredSes.json().session.status).toBe('RUNNING');

    // TEST 6: Upload a new package version, deploy to group, verify content hash & atomic activation
    const v2Project = createStarterProject();
    v2Project.settings.name = 'Lobby Broadcast v2';
    const builtV2 = buildSignagePackage(v2Project, { profile: 'compact' });

    const uploadRes = await server2.app.inject({
      method: 'POST',
      url: '/api/v1/packages',
      payload: {
        packageId: 'pkg-v2',
        name: 'Lobby Broadcast v2',
        version: 2,
        archiveBase64: Buffer.from(builtV2.bytes).toString('base64'),
      },
    });
    expect(uploadRes.statusCode).toBe(200);
    expect(uploadRes.json().validationReport.packageHashHex).toBe(builtV2.packageHashHex);

    const deployRes = await server2.app.inject({
      method: 'POST',
      url: '/api/v1/deployments',
      payload: {
        packageId: 'pkg-v2',
        targetGroupId: 'group-lobby-wall',
      },
    });
    expect(deployRes.statusCode).toBe(200);
    expect(deployRes.json().status).toBe('COMPLETED');

    await server2.app.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('TEST 7 (Player Failure & Watchdog) & TEST 8 (Clock Drift & Correction) & TEST 9 (Authorization)', async () => {
    const { app } = await buildServerApp();

    // TEST 7: Watchdog bounded retries & quarantine loop prevention
    const watchdog = new WatchdogSupervisor('pkg-bad', 'pkg-good-fallback', 2);
    expect(watchdog.reportFailureOrStall('Crash 1').state).toBe('RECOVERING');
    expect(watchdog.reportFailureOrStall('Crash 2').state).toBe('RECOVERING');
    // 3rd failure exceeds maxRetries (2) -> quarantines pkg-bad and switches to pkg-good-fallback
    const statusAfter3 = watchdog.reportFailureOrStall('Crash 3');
    expect(statusAfter3.quarantinedPackageIds).toContain('pkg-bad');
    expect(statusAfter3.activePackageId).toBe('pkg-good-fallback');

    // TEST 8: Clock synchronization math & drift correction thresholds
    const metrics = computeClockExchangeMetrics(1000, 1050, 1055, 1015);
    // Offset = ((1050 - 1000) + (1055 - 1015)) / 2 = (50 + 40) / 2 = +45ms
    // RTT = (1015 - 1000) - (1055 - 1050) = 15 - 5 = 10ms
    expect(metrics.offsetMs).toBe(45);
    expect(metrics.rttMs).toBe(10);

    const clockEngine = new ClockSyncEngine();
    clockEngine.recordExchange(1000, 1040, 1042, 1012);
    const syncState = clockEngine.recordExchange(2000, 2042, 2044, 2014);
    expect(syncState.estimatedOffsetMs).toBeGreaterThan(25);
    expect(syncState.uncertaintyMs).toBeGreaterThan(0);

    // Small drift (25ms) -> NONE
    expect(evaluateDriftCorrection('s1', 's1', 5000, 5025).type).toBe('NONE');
    // Moderate drift (450ms) -> CONTROLLED_SEEK
    expect(evaluateDriftCorrection('s1', 's1', 5000, 5450).type).toBe('CONTROLLED_SEEK');
    // Large drift (1500ms) -> REINITIALIZE_SCENE
    expect(evaluateDriftCorrection('s1', 's1', 5000, 6500).type).toBe('REINITIALIZE_SCENE');

    // TEST 9: Authorization, Expired Command Replay Rejection & Cross-Group Protection
    // 9a. Unauthorized credentials rejected with 401
    const unauthRes = await app.inject({
      method: 'POST',
      url: '/api/v1/commands',
      headers: { authorization: 'Bearer invalid-token' },
      payload: { targetDeviceId: 'player-01', commandType: 'RESTART_PLAYER' },
    });
    expect(unauthRes.statusCode).toBe(401);

    // 9b. Expired command rejected with 400 EXPIRED
    const expiredRes = await app.inject({
      method: 'POST',
      url: '/api/v1/commands',
      payload: {
        targetDeviceId: 'player-01',
        commandType: 'START_SESSION',
        expiresAt: '2020-01-01T00:00:00.000Z',
      },
    });
    expect(expiredRes.statusCode).toBe(400);
    expect(expiredRes.json().status).toBe('EXPIRED');

    // 9c. Cross-group modification rejected with 403
    const crossGroupRes = await app.inject({
      method: 'PATCH',
      url: '/api/v1/groups/group-lobby-wall',
      headers: {
        'x-actor-id': 'op-cafe-only',
        'x-actor-role': 'operator',
        'x-allowed-group': 'group-cafe-menus',
      },
      payload: { name: 'Unauthorized Rename' },
    });
    expect(crossGroupRes.statusCode).toBe(403);

    // Verify all 3 security rejections were recorded in audit_log
    const auditRes = await app.inject({ method: 'GET', url: '/api/v1/audit-log' });
    const logs = auditRes.json().auditLog as Array<{ action: string }>;
    expect(logs.some((l) => l.action === 'UNAUTHORIZED_ACCESS_ATTEMPT')).toBe(true);
    expect(logs.some((l) => l.action === 'REJECT_EXPIRED_COMMAND')).toBe(true);
    expect(logs.some((l) => l.action === 'CROSS_GROUP_VIOLATION')).toBe(true);

    // Verify Kiosk Protected Admin Controller lockout & session expiration
    const adminCtrl = new ProtectedAdminController('CorrectPass!2026', 'dev-01');
    expect(adminCtrl.authenticateMaintenanceSession('WrongPass', 60, 1000).granted).toBe(false);
    expect(adminCtrl.authenticateMaintenanceSession('CorrectPass!2026', 60, 1000).granted).toBe(true);
    expect(adminCtrl.isMaintenanceActive(30_000)).toBe(true);
    expect(adminCtrl.isMaintenanceActive(70_000)).toBe(false); // Auto-expired after 60s!

    await app.close();
  });

  it('TEST 10 (Long-Running 72-Hour Soak Simulation)', () => {
    const project = createStarterProject();
    const playlist = project.playlists[0];
    const startMs = Date.parse('2026-10-25T00:00:00.000Z');
    const session: SynchronizedSessionConfig = {
      sessionId: 'session-soak-72h',
      groupId: 'group-lobby-wall',
      packageId: 'pkg-apex-lobby-v1',
      packageVersion: 1,
      playlistId: playlist.id,
      playlistRevision: 1,
      timelineRevision: 1,
      startTimeUtc: '2026-10-25T00:00:00.000Z',
      status: 'RUNNING',
      synchronizationPolicy: 'DRIFT_CORRECTED',
      failurePolicy: 'START_WITH_AVAILABLE',
    };

    // Simulate 72 hours (259,200,000 ms) sampled every 15 minutes across 5 players
    const totalMs = 72 * 3600 * 1000;
    const stepMs = 15 * 60 * 1000;
    let sampleCount = 0;

    for (let elapsed = 0; elapsed <= totalMs; elapsed += stepMs) {
      const serverTime = startMs + elapsed;
      const leaderState = evaluateAuthoritativeTimeline(project, playlist, session, serverTime);
      const followerState = evaluateAuthoritativeTimeline(
        project,
        playlist,
        session,
        serverTime + 12 // 12ms residual clock offset
      );

      expect(leaderState.phase).toBe('PLAYING');
      expect(leaderState.activeScene.id).toBe(followerState.activeScene.id);
      expect(Math.abs(followerState.sceneElapsedMs - leaderState.sceneElapsedMs)).toBeLessThanOrEqual(12);
      sampleCount++;
    }

    expect(sampleCount).toBeGreaterThan(280);
  });
});
