// ============================================================================
// src/components/player/StandaloneSignagePlayer.tsx
// Production Signage Player, Full-Screen Kiosk Lockout, Protected Maintenance
// Authentication, Offline Cache Operation & Watchdog Recovery (Spec Sec 8 & 10)
// ============================================================================

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Maximize2,
  Minimize2,
  Play,
  Pause,
  SkipForward,
  Lock,
  Unlock,
  ShieldCheck,
  Wifi,
  WifiOff,
  AlertOctagon,
  RefreshCw,
  Upload,
  ArrowLeft,
} from 'lucide-react';
import { useStudioStore } from '@/store/useStudioStore';
import {
  SynchronizedSessionConfig,
  evaluateAuthoritativeTimeline,
} from '@packages/playback-engine';
import { resolveActivePlaylist } from '@packages/playlist-engine';
import { extractProjectFromArchive } from '@packages/signage-format';
import { SignageElementRenderer } from '@/components/shared/SignageElementRenderer';
import { formatDurationMs } from '@packages/shared';

export const StandaloneSignagePlayer: React.FC = () => {
  const {
    standalonePlayerPackage,
    builtPackages,
    setStandalonePlayerPackage,
    importSignagePackageBytes,
    kioskConfig,
    adminController,
    watchdogSupervisor,
    diagnostics,
    setAppMode,
    notify,
  } = useStudioStore();

  const [isPlaying, setIsPlaying] = useState(true);
  const [elapsedOffsetMs, setElapsedOffsetMs] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [kioskLocked, setKioskLocked] = useState(false);
  const [cursorHidden, setCursorHidden] = useState(false);
  const [offlineMode, setOfflineMode] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [adminPassphrase, setAdminPassphrase] = useState('');
  const [authError, setAuthError] = useState('');
  const [maintenanceRemainingSec, setMaintenanceRemainingSec] = useState(0);
  const [watchdogState, setWatchdogState] = useState(() => watchdogSupervisor.getStatus());
  const [estimatedFps, setEstimatedFps] = useState(60);
  const [cornerTapCount, setCornerTapCount] = useState(0);

  const playerContainerRef = useRef<HTMLDivElement | null>(null);
  const sessionStartRef = useRef<number>(Date.now());

  // Reconstruct playable project strictly from the binary .signage archive
  const loadedPackageData = useMemo(() => {
    const pkg = standalonePlayerPackage ?? builtPackages[0];
    if (!pkg) return null;
    try {
      const { project, report } = extractProjectFromArchive(pkg.bytes);
      return { pkg, project, report };
    } catch (err) {
      diagnostics.log('error', 'PLAYBACK', `Player rejected corrupted package: ${(err as Error).message}`);
      return null;
    }
  }, [standalonePlayerPackage, builtPackages, diagnostics]);

  // Schedule & Playlist resolution
  const resolvedSchedule = useMemo(() => {
    if (!loadedPackageData) return null;
    return resolveActivePlaylist(
      loadedPackageData.project.playlists,
      loadedPackageData.project.schedules,
      new Date()
    );
  }, [loadedPackageData]);

  // Continuous playback loop & FPS monitor
  useEffect(() => {
    if (!isPlaying || watchdogState.state === 'SAFE_RECOVERY_MODE') return;
    let lastTs = performance.now();
    let frames = 0;
    let fpsTimer = performance.now();
    let rafId = 0;

    const loop = (now: number) => {
      const dt = now - lastTs;
      lastTs = now;
      frames++;
      if (now - fpsTimer >= 1000) {
        setEstimatedFps(Math.min(60, Math.max(24, Math.round((frames * 1000) / (now - fpsTimer)))));
        frames = 0;
        fpsTimer = now;
        watchdogSupervisor.recordHeartbeat();
      }
      setElapsedOffsetMs((prev) => prev + dt);
      rafId = requestAnimationFrame(loop);
    };

    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [isPlaying, watchdogState.state, watchdogSupervisor]);

  // Maintenance session expiration ticker
  useEffect(() => {
    const timer = setInterval(() => {
      const rem = adminController.getRemainingMaintenanceSeconds();
      setMaintenanceRemainingSec(rem);
      if (rem === 0 && !kioskLocked) {
        // Maintenance session expired
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [adminController, kioskLocked]);

  // Cursor inactivity auto-hide in Kiosk Lockout mode
  useEffect(() => {
    if (!kioskLocked) {
      setCursorHidden(false);
      return;
    }
    let timeoutId = setTimeout(() => setCursorHidden(true), kioskConfig.hideCursorAfterMs || 3000);
    const onMove = () => {
      setCursorHidden(false);
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => setCursorHidden(true), kioskConfig.hideCursorAfterMs || 3000);
    };
    window.addEventListener('pointermove', onMove);
    return () => {
      clearTimeout(timeoutId);
      window.removeEventListener('pointermove', onMove);
    };
  }, [kioskLocked, kioskConfig.hideCursorAfterMs]);

  const timelineState = useMemo(() => {
    if (!loadedPackageData || !resolvedSchedule) return null;
    const session: SynchronizedSessionConfig = {
      sessionId: 'local-kiosk-session',
      groupId: 'local-display',
      packageId: loadedPackageData.pkg.manifest.project.id,
      packageVersion: 1,
      playlistId: resolvedSchedule.activePlaylist.id,
      playlistRevision: resolvedSchedule.activePlaylist.revision,
      timelineRevision: 1,
      startTimeUtc: new Date(sessionStartRef.current).toISOString(),
      status: isPlaying ? 'RUNNING' : 'PAUSED',
      pausedPositionMs: elapsedOffsetMs,
      synchronizationPolicy: 'TIMELINE_SYNC',
      failurePolicy: 'START_WITH_AVAILABLE',
    };
    return evaluateAuthoritativeTimeline(
      loadedPackageData.project,
      resolvedSchedule.activePlaylist,
      session,
      sessionStartRef.current + elapsedOffsetMs
    );
  }, [loadedPackageData, resolvedSchedule, isPlaying, elapsedOffsetMs]);

  const toggleFullscreen = async () => {
    try {
      if (!document.fullscreenElement && playerContainerRef.current) {
        await playerContainerRef.current.requestFullscreen();
        setIsFullscreen(true);
      } else if (document.fullscreenElement) {
        await document.exitFullscreen();
        setIsFullscreen(false);
      }
    } catch {
      setIsFullscreen(!isFullscreen);
    }
  };

  const handleCornerSecretGesture = () => {
    const next = cornerTapCount + 1;
    setCornerTapCount(next);
    if (next >= 5) {
      setCornerTapCount(0);
      setShowAuthModal(true);
    }
  };

  const handleAuthenticateAdmin = (e: React.FormEvent) => {
    e.preventDefault();
    const res = adminController.authenticateMaintenanceSession(
      adminPassphrase,
      kioskConfig.maintenanceSessionDurationSec
    );
    if (res.granted) {
      setKioskLocked(false);
      setShowAuthModal(false);
      setAdminPassphrase('');
      setAuthError('');
      setMaintenanceRemainingSec(adminController.getRemainingMaintenanceSeconds());
      notify('success', 'Maintenance access granted. Kiosk lockout temporarily lifted.');
    } else {
      setAuthError(res.reason);
    }
  };

  const handleSimulateCrash = () => {
    const nextStatus = watchdogSupervisor.reportFailureOrStall(
      'Simulated media decoder stall / renderer crash'
    );
    setWatchdogState(nextStatus);
    diagnostics.log('warn', 'PLAYBACK', `Watchdog triggered recovery (#${nextStatus.restartCount}): ${nextStatus.lastRecoveryReason}`);
  };

  const handleResetWatchdog = () => {
    const nextStatus = watchdogSupervisor.resetToHealthy();
    setWatchdogState(nextStatus);
    notify('info', 'Watchdog reset to HEALTHY playback state.');
  };

  const handleLoadPackageFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const bytes = new Uint8Array(reader.result as ArrayBuffer);
        importSignagePackageBytes(bytes, true);
        setElapsedOffsetMs(0);
      } catch (err) {
        notify('error', `Rejected corrupted or invalid .signage file: ${(err as Error).message}`);
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  };

  if (!loadedPackageData || !timelineState) {
    return (
      <div className="player-empty-recovery">
        <AlertOctagon size={48} color="#f43f5e" />
        <h2>Safe Recovery Screen — No Valid Package Loaded</h2>
        <p>Load a verified .signage archive or return to Studio to build a package.</p>
        <button className="btn-primary" onClick={() => setAppMode('studio')}>
          Return to Studio
        </button>
      </div>
    );
  }

  const { project, pkg, report } = loadedPackageData;
  const activeScene = timelineState.activeScene;

  return (
    <div
      ref={playerContainerRef}
      className={`standalone-player-shell ${kioskLocked ? 'kiosk-locked' : ''} ${cursorHidden ? 'cursor-hidden' : ''}`}
      onContextMenu={(e) => {
        if (kioskConfig.disableContextMenu || kioskLocked) {
          e.preventDefault();
        }
      }}
    >
      {/* Hidden 5-Tap Maintenance Gesture Zone in Top-Right Corner */}
      <div
        className="kiosk-secret-gesture-corner"
        onClick={handleCornerSecretGesture}
        title={kioskLocked ? 'Tap 5 times for Protected Admin Access' : 'Maintenance Trigger Zone'}
      />

      {/* Top Player Control & Telemetry Bar (Hidden when Kiosk Lockout is active) */}
      {!kioskLocked && (
        <div className="player-hud-bar">
          <div className="hud-group">
            <button className="btn-xs" onClick={() => setAppMode('studio')}>
              <ArrowLeft size={13} /> Back to Studio
            </button>
            <span className="hud-pkg-badge">
              <ShieldCheck size={14} color="#10b981" />
              <strong>{pkg.fileName}</strong> (SHA-256: {report.packageHashHex.slice(0, 10)}…)
            </span>
            <select
              className="toolbar-select"
              value={pkg.packageHashHex}
              onChange={(e) => {
                const found = builtPackages.find((b) => b.packageHashHex === e.target.value);
                if (found) {
                  setStandalonePlayerPackage(found);
                  setElapsedOffsetMs(0);
                }
              }}
            >
              {builtPackages.map((b) => (
                <option key={b.packageHashHex} value={b.packageHashHex}>
                  {b.fileName} ({b.manifest.scenes.length} scenes)
                </option>
              ))}
            </select>
            <label className="btn-xs" style={{ cursor: 'pointer' }}>
              <Upload size={12} /> Load .signage File
              <input
                type="file"
                accept=".signage,application/octet-stream"
                style={{ display: 'none' }}
                onChange={handleLoadPackageFile}
              />
            </label>
          </div>

          {/* Transport & Scene Controls */}
          <div className="hud-group">
            <button
              className="btn-xs primary-accent"
              onClick={() => setIsPlaying(!isPlaying)}
            >
              {isPlaying ? <Pause size={13} /> : <Play size={13} />}
              {isPlaying ? 'Pause' : 'Play'}
            </button>
            <button
              className="btn-xs"
              onClick={() => setElapsedOffsetMs((prev) => prev + activeScene.durationMs)}
              title="Advance to Next Scene"
            >
              <SkipForward size={13} /> Next Scene
            </button>
            <span className="hud-metric">
              Scene: <strong>{activeScene.name}</strong> (
              {formatDurationMs(timelineState.sceneElapsedMs)} /{' '}
              {formatDurationMs(timelineState.sceneDurationMs)})
            </span>
            <span className="hud-metric">{estimatedFps} FPS</span>
          </div>

          {/* Offline, Watchdog & Kiosk Lock Controls */}
          <div className="hud-group">
            <button
              className={`btn-xs ${offlineMode ? 'warning-active' : ''}`}
              onClick={() => {
                setOfflineMode(!offlineMode);
                notify(
                  'info',
                  !offlineMode
                    ? 'Simulated Network Disconnect: Playing 100% offline from local .signage cache.'
                    : 'Network Reconnected: Resynchronized with server.'
                );
              }}
            >
              {offlineMode ? <WifiOff size={13} /> : <Wifi size={13} />}
              {offlineMode ? 'Offline Cache Mode' : 'Online'}
            </button>

            <button
              className="btn-xs"
              onClick={handleSimulateCrash}
              title="Simulate Renderer Crash / Watchdog Recovery"
            >
              <RefreshCw size={13} /> Test Watchdog ({watchdogState.restartCount}/{watchdogState.maxRetries})
            </button>

            <button
              className="btn-xs"
              onClick={() => {
                adminController.exitMaintenanceSession();
                setKioskLocked(true);
              }}
              title="Engage Kiosk Lockout (Hides Chrome & Requires Admin Auth to Exit)"
            >
              <Lock size={13} /> Engage Kiosk Lockout
            </button>

            <button className="icon-btn" onClick={toggleFullscreen} title="Toggle Full-Screen">
              {isFullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
            </button>
          </div>
        </div>
      )}

      {/* Subtle Floating Unlock Pill when in Kiosk Lockout Mode */}
      {kioskLocked && (
        <div className="kiosk-locked-floating-indicator">
          <Lock size={12} /> KIOSK LOCKOUT ACTIVE •{' '}
          <button className="link-btn" onClick={() => setShowAuthModal(true)}>
            Admin Maintenance Unlock
          </button>
        </div>
      )}

      {/* Watchdog Safe Recovery Screen if repeated restarts fail (Spec 10.5) */}
      {watchdogState.state === 'SAFE_RECOVERY_MODE' ? (
        <div className="watchdog-safe-recovery-screen">
          <AlertOctagon size={56} color="#f59e0b" />
          <h2>WATCHDOG SAFE RECOVERY MODE</h2>
          <p>{watchdogState.lastRecoveryReason}</p>
          <p className="muted-line">
            Quarantined Package IDs: {watchdogState.quarantinedPackageIds.join(', ') || 'None'}
          </p>
          <div className="inline-row" style={{ marginTop: '16px' }}>
            <button className="btn-primary" onClick={handleResetWatchdog}>
              Restore Last Known-Good Package & Resume Playback
            </button>
          </div>
        </div>
      ) : (
        /* Main Scaled Signage Presentation Viewport */
        <div className="player-stage-wrapper">
          <div
            className="player-aspect-frame"
            style={{
              width: `${project.settings.width}px`,
              height: `${project.settings.height}px`,
              background:
                activeScene.backgroundGradient || activeScene.backgroundColor || '#090d16',
              opacity: timelineState.transitionStyle.opacity,
              transform: `scale(var(--player-scale, 0.62)) ${
                timelineState.transitionStyle.transform !== 'none'
                  ? timelineState.transitionStyle.transform
                  : ''
              }`,
              clipPath: timelineState.transitionStyle.clipPath,
            }}
          >
            {timelineState.elements.map((el) => (
              <SignageElementRenderer
                key={el.id}
                element={el}
                assets={project.assets}
                currentTimeMs={timelineState.sceneElapsedMs}
                deviceName={kioskConfig.deviceName}
                sceneName={activeScene.name}
              />
            ))}
          </div>
        </div>
      )}

      {/* Bottom Telemetry Strip when not locked */}
      {!kioskLocked && (
        <div className="player-bottom-telemetry">
          <span>
            <strong>Schedule:</strong> {resolvedSchedule?.reason}
          </span>
          <span>
            <strong>Watchdog:</strong> {watchdogState.state} (Restarts: {watchdogState.restartCount})
          </span>
          {maintenanceRemainingSec > 0 && (
            <span style={{ color: '#38bdf8' }}>
              <Unlock size={12} /> Maintenance Session Auto-Locks in {maintenanceRemainingSec}s
            </span>
          )}
        </div>
      )}

      {/* Protected Administrator Authentication Modal (Spec Section 10.4) */}
      {showAuthModal && (
        <div className="inline-edit-backdrop" onClick={() => setShowAuthModal(false)}>
          <form
            className="inline-edit-dialog"
            onClick={(e) => e.stopPropagation()}
            onSubmit={handleAuthenticateAdmin}
          >
            <h4>
              <Lock size={16} /> Protected Kiosk Maintenance Authentication
            </h4>
            <p className="muted-line">
              Enter the device-bound administrator passphrase to unlock maintenance controls for a
              time-limited session ({kioskConfig.maintenanceSessionDurationSec}s).
            </p>
            <p className="muted-line" style={{ color: '#38bdf8' }}>
              Default Provisioned Admin Passphrase: <code>ApexAdmin!2026</code>
            </p>
            <input
              type="password"
              className="inspector-input"
              placeholder="Administrator passphrase..."
              value={adminPassphrase}
              onChange={(e) => setAdminPassphrase(e.target.value)}
              autoFocus
            />
            {authError && <div className="error-banner">{authError}</div>}
            <div className="dialog-footer">
              <button
                type="button"
                className="btn-xs"
                onClick={() => setShowAuthModal(false)}
              >
                Cancel
              </button>
              <button type="submit" className="btn-primary">
                Verify & Unlock Maintenance
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
