// ============================================================================
// src/components/player/StandaloneSignagePlayer.tsx
// Production Signage Player, Full-Screen Kiosk Lockout, Protected Maintenance
// Authentication, Offline Cache Operation & Watchdog Recovery (Spec Sec 8 & 10)
// ============================================================================

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  QrCode,
  Smartphone,
  Volume2,
  KeyRound,
} from 'lucide-react';
import { useStudioStore } from '@/store/useStudioStore';
import {
  evaluateAudioTrackAtTime,
  isAudioTrackActiveOnScene,
} from '@/utils/audioEngine';
import {
  PlayerSetupQrPayload,
  buildEnrollmentQrMatrix,
  encodePlayerSetupQrPayload,
  saveActivePlayerSetupQr,
} from '@/utils/enrollmentQr';
import {
  SynchronizedSessionConfig,
  evaluateAuthoritativeTimeline,
} from '@packages/playback-engine';
import {
  MaintenanceSequenceTracker,
  matchesMaintenanceHotkey,
} from '@packages/kiosk-integration';
import { resolveActivePlaylist } from '@packages/playlist-engine';
import { extractProjectFromArchive } from '@packages/signage-format';
import { SignageElementRenderer } from '@/components/shared/SignageElementRenderer';
import { formatDurationMs } from '@packages/shared';

function formatKeySequenceBadge(seq: string): string {
  return seq
    .split(',')
    .map((k) => {
      const clean = k.trim();
      const lower = clean.toLowerCase();
      if (lower === 'arrowup') return '↑';
      if (lower === 'arrowdown') return '↓';
      if (lower === 'arrowleft') return '←';
      if (lower === 'arrowright') return '→';
      return clean.toUpperCase();
    })
    .join(' ');
}

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
  const [showMaintenanceConsole, setShowMaintenanceConsole] = useState(false);
  const [watchdogState, setWatchdogState] = useState(() => watchdogSupervisor.getStatus());
  const [estimatedFps, setEstimatedFps] = useState(60);
  const [cornerTapCount, setCornerTapCount] = useState(0);
  const [showSetupQrModal, setShowSetupQrModal] = useState(false);
  const [playerScaleMode, setPlayerScaleMode] = useState<
    'auto-fit' | 'auto-fill' | 'stretch' | 'native'
  >('auto-fit');
  const [viewportSize, setViewportSize] = useState<{ width: number; height: number }>(() => ({
    width: typeof window !== 'undefined' && window.innerWidth > 0 ? window.innerWidth : 1280,
    height:
      typeof window !== 'undefined' && window.innerHeight > 0
        ? Math.max(200, window.innerHeight - 96)
        : 640,
  }));
  const [authTriggerSource, setAuthTriggerSource] = useState<string>('Maintenance Key Sequence');
  const [sequenceProgress, setSequenceProgress] = useState<{
    current: number;
    total: number;
    label: string;
  } | null>(null);
  const [kioskOsdHint, setKioskOsdHint] = useState<string | null>(null);

  const playerContainerRef = useRef<HTMLDivElement | null>(null);
  const stageWrapperRef = useRef<HTMLDivElement | null>(null);
  const sessionStartRef = useRef<number>(Date.now());
  const wasInMaintenanceSessionRef = useRef<boolean>(false);
  const cornerTapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const osdHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seqClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const primarySeqTrackerRef = useRef<MaintenanceSequenceTracker>(
    new MaintenanceSequenceTracker(
      kioskConfig.maintenanceKeySequence ||
        'ArrowUp,ArrowUp,ArrowDown,ArrowDown,ArrowLeft,ArrowRight'
    )
  );
  const wordSeqTrackerRef = useRef<MaintenanceSequenceTracker>(
    new MaintenanceSequenceTracker('m,a,i,n,t')
  );

  const showTransientOsd = useCallback((msg: string, durationMs = 3600) => {
    setKioskOsdHint(msg);
    if (osdHintTimerRef.current) {
      clearTimeout(osdHintTimerRef.current);
    }
    osdHintTimerRef.current = setTimeout(() => {
      setKioskOsdHint(null);
    }, durationMs);
  }, []);

  useEffect(() => {
    primarySeqTrackerRef.current.setSequence(
      kioskConfig.maintenanceKeySequence ||
        'ArrowUp,ArrowUp,ArrowDown,ArrowDown,ArrowLeft,ArrowRight'
    );
  }, [kioskConfig.maintenanceKeySequence]);

  // Hide global studio top nav when Kiosk Lockout is engaged so player fills 100% of screen
  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.body.classList.toggle('kiosk-lockout-active', kioskLocked);
    }
    return () => {
      if (typeof document !== 'undefined') {
        document.body.classList.remove('kiosk-lockout-active');
      }
    };
  }, [kioskLocked]);

  // Measure available stage viewport dimensions and auto-update on window/container resize
  const updateStageDimensions = useCallback(() => {
    const el = stageWrapperRef.current;
    if (el && el.clientWidth > 0 && el.clientHeight > 0) {
      setViewportSize({
        width: el.clientWidth,
        height: el.clientHeight,
      });
      return;
    }
    if (typeof window !== 'undefined') {
      const fallbackW = Math.max(320, window.innerWidth || 1280);
      const chromeOffset = kioskLocked || isFullscreen ? 0 : 124;
      const fallbackH = Math.max(200, (window.innerHeight || 720) - chromeOffset);
      setViewportSize({ width: fallbackW, height: fallbackH });
    }
  }, [kioskLocked, isFullscreen]);

  useEffect(() => {
    updateStageDimensions();
    const raf = requestAnimationFrame(() => updateStageDimensions());
    window.addEventListener('resize', updateStageDimensions);
    document.addEventListener('fullscreenchange', updateStageDimensions);

    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined' && stageWrapperRef.current) {
      observer = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const { width, height } = entry.contentRect;
          if (width > 0 && height > 0) {
            setViewportSize({ width: Math.round(width), height: Math.round(height) });
          }
        }
      });
      observer.observe(stageWrapperRef.current);
    }

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', updateStageDimensions);
      document.removeEventListener('fullscreenchange', updateStageDimensions);
      if (observer) observer.disconnect();
    };
  }, [updateStageDimensions, kioskLocked, isFullscreen]);

  const setupQrPayload = useMemo<PlayerSetupQrPayload>(() => {
    const payload: PlayerSetupQrPayload = {
      enrollmentCode: 'ENROLL-APEX-2026',
      deviceId: kioskConfig.deviceId || 'player-kiosk-07',
      deviceName: kioskConfig.deviceName || 'Lobby Reserve Kiosk #07',
      location: 'Global HQ Atrium',
      assignedDisplay: 'HDMI-1 (1920x1080)',
      os: 'Linux Kiosk 6.8',
      generatedAtIso: new Date().toISOString(),
    };
    saveActivePlayerSetupQr(payload);
    return payload;
  }, [kioskConfig.deviceId, kioskConfig.deviceName]);

  const setupQrUri = useMemo(
    () => encodePlayerSetupQrPayload(setupQrPayload),
    [setupQrPayload]
  );
  const setupQrMatrix = useMemo(
    () => buildEnrollmentQrMatrix(setupQrUri),
    [setupQrUri]
  );

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

  // Maintenance session expiration ticker (automatically re-locks kiosk when timer reaches 0)
  useEffect(() => {
    const timer = setInterval(() => {
      const rem = adminController.getRemainingMaintenanceSeconds();
      setMaintenanceRemainingSec(rem);
      if (wasInMaintenanceSessionRef.current && rem === 0) {
        wasInMaintenanceSessionRef.current = false;
        setShowMaintenanceConsole(false);
        setKioskLocked(true);
        showTransientOsd(
          `Maintenance session expired — Kiosk Lockout re-engaged (${kioskConfig.maintenanceHotkey} to unlock)`
        );
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [adminController, kioskConfig.maintenanceHotkey, showTransientOsd]);

  // Real Signage Player Maintenance Key Sequence & Hotkey Chord Listener (Spec Section 10.4)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isInput =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);

      if (isInput) return;

      if (!kioskConfig.maintenanceAccessEnabled) {
        if (kioskLocked) {
          e.preventDefault();
        }
        return;
      }

      const configuredHotkey = kioskConfig.maintenanceHotkey || 'Ctrl+Shift+M';
      // 1. Check Maintenance Hotkey Chord (e.g., Ctrl+Shift+M or Ctrl+Alt+M)
      if (
        matchesMaintenanceHotkey(e, configuredHotkey) ||
        matchesMaintenanceHotkey(e, 'Ctrl+Alt+M')
      ) {
        e.preventDefault();
        e.stopPropagation();
        setCursorHidden(false);
        setSequenceProgress(null);
        setAuthTriggerSource(`Hotkey Chord (${configuredHotkey})`);
        setAuthError('');
        setShowAuthModal(true);
        return;
      }

      // 2. Check Multi-Key Sequential Maintenance Sequence (e.g., ↑ ↑ ↓ ↓ ← → or M-A-I-N-T)
      if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        const primaryRes = primarySeqTrackerRef.current.feedKey(e.key);
        const wordRes = wordSeqTrackerRef.current.feedKey(e.key);

        if (primaryRes.matched || wordRes.matched) {
          e.preventDefault();
          e.stopPropagation();
          primarySeqTrackerRef.current.reset();
          wordSeqTrackerRef.current.reset();
          setSequenceProgress(null);
          setCursorHidden(false);
          setAuthTriggerSource(
            primaryRes.matched
              ? `Key Sequence (${formatKeySequenceBadge(
                  kioskConfig.maintenanceKeySequence ||
                    'ArrowUp,ArrowUp,ArrowDown,ArrowDown,ArrowLeft,ArrowRight'
                )})`
              : 'Key Sequence (M A I N T)'
          );
          setAuthError('');
          setShowAuthModal(true);
          return;
        }

        const activeProg =
          primaryRes.progress >= wordRes.progress
            ? {
                current: primaryRes.progress,
                total: primaryRes.total,
                label: formatKeySequenceBadge(
                  kioskConfig.maintenanceKeySequence ||
                    'ArrowUp,ArrowUp,ArrowDown,ArrowDown,ArrowLeft,ArrowRight'
                ),
              }
            : {
                current: wordRes.progress,
                total: wordRes.total,
                label: 'M A I N T',
              };

        if (activeProg.current >= 2) {
          e.preventDefault();
          setSequenceProgress(activeProg);
          if (seqClearTimerRef.current) clearTimeout(seqClearTimerRef.current);
          seqClearTimerRef.current = setTimeout(() => {
            setSequenceProgress(null);
          }, 3500);
          return;
        } else if (sequenceProgress) {
          setSequenceProgress(null);
        }
      }

      // 3. When Kiosk Lockout is active, intercept escape/refresh shortcuts and display a brief OSD reminder
      if (kioskLocked && !showAuthModal) {
        if (
          e.key === 'Escape' ||
          e.key === 'F11' ||
          e.key === 'F5' ||
          ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'r' || e.key.toLowerCase() === 'w'))
        ) {
          e.preventDefault();
          e.stopPropagation();
          showTransientOsd(
            `Kiosk Locked • Press ${configuredHotkey} or key sequence [${formatKeySequenceBadge(
              kioskConfig.maintenanceKeySequence ||
                'ArrowUp,ArrowUp,ArrowDown,ArrowDown,ArrowLeft,ArrowRight'
            )}] for Maintenance Access`
          );
        }
      }
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [
    kioskConfig.maintenanceAccessEnabled,
    kioskConfig.maintenanceHotkey,
    kioskConfig.maintenanceKeySequence,
    kioskLocked,
    showAuthModal,
    sequenceProgress,
    showTransientOsd,
  ]);

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
    if (!kioskConfig.maintenanceAccessEnabled) return;
    if (cornerTapTimerRef.current) {
      clearTimeout(cornerTapTimerRef.current);
    }
    const next = cornerTapCount + 1;
    if (next >= 5) {
      setCornerTapCount(0);
      setCursorHidden(false);
      setAuthTriggerSource('5-Tap Top-Right Corner Gesture');
      setAuthError('');
      setShowAuthModal(true);
    } else {
      setCornerTapCount(next);
      if (next >= 3) {
        showTransientOsd(`Maintenance Corner Gesture: ${next} / 5 taps`, 2200);
      }
      cornerTapTimerRef.current = setTimeout(() => {
        setCornerTapCount(0);
      }, 4000);
    }
  };

  const handleEngageKioskLockout = () => {
    adminController.exitMaintenanceSession();
    wasInMaintenanceSessionRef.current = false;
    setMaintenanceRemainingSec(0);
    setShowMaintenanceConsole(false);
    setKioskLocked(true);
    showTransientOsd(
      `Kiosk Lockout Engaged • Press ${kioskConfig.maintenanceHotkey || 'Ctrl+Shift+M'}, sequence [${formatKeySequenceBadge(
        kioskConfig.maintenanceKeySequence ||
          'ArrowUp,ArrowUp,ArrowDown,ArrowDown,ArrowLeft,ArrowRight'
      )}], or 5-tap top-right corner for Maintenance Access`,
      4200
    );
  };

  const handleAuthenticateAdmin = (e: React.FormEvent) => {
    e.preventDefault();
    const res = adminController.authenticateMaintenanceSession(
      adminPassphrase,
      kioskConfig.maintenanceSessionDurationSec
    );
    if (res.granted) {
      setKioskLocked(false);
      wasInMaintenanceSessionRef.current = true;
      setShowAuthModal(false);
      setShowMaintenanceConsole(true);
      setAdminPassphrase('');
      setAuthError('');
      setKioskOsdHint(null);
      setMaintenanceRemainingSec(adminController.getRemainingMaintenanceSeconds());
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
  const activeAudioStatuses = (project.audioTracks ?? [])
    .filter((track) => isAudioTrackActiveOnScene(track, activeScene.id))
    .map((track) => ({
      track,
      evalState: evaluateAudioTrackAtTime(
        track,
        activeScene.id,
        timelineState.sceneElapsedMs,
        timelineState.sceneDurationMs
      ),
    }));

  // Compute dynamic viewport auto-scaling for the Signage Player stage
  const sceneW = Math.max(1, project.settings.width || 1920);
  const sceneH = Math.max(1, project.settings.height || 1080);
  const stageMargin = kioskLocked || isFullscreen ? 0 : 20;
  const availW = Math.max(120, viewportSize.width - stageMargin);
  const availH = Math.max(90, viewportSize.height - stageMargin);
  const rawScaleX = availW / sceneW;
  const rawScaleY = availH / sceneH;

  let scaleX = 1;
  let scaleY = 1;
  if (playerScaleMode === 'native') {
    scaleX = 1;
    scaleY = 1;
  } else if (playerScaleMode === 'stretch') {
    scaleX = Math.max(0.05, rawScaleX);
    scaleY = Math.max(0.05, rawScaleY);
  } else if (playerScaleMode === 'auto-fill') {
    const uniformFill = Math.max(0.05, Math.max(rawScaleX, rawScaleY));
    scaleX = uniformFill;
    scaleY = uniformFill;
  } else {
    // 'auto-fit' (default: scales scene proportionally to fit the viewport)
    const uniformFit = Math.max(0.05, Math.min(rawScaleX, rawScaleY));
    scaleX = uniformFit;
    scaleY = uniformFit;
  }

  const scaledBoxWidth = Math.max(1, Math.round(sceneW * scaleX));
  const scaledBoxHeight = Math.max(1, Math.round(sceneH * scaleY));
  const scalePercentLabel = `${Math.round(scaleX * 100)}%`;
  const formattedSeqLabel = formatKeySequenceBadge(
    kioskConfig.maintenanceKeySequence ||
      'ArrowUp,ArrowUp,ArrowDown,ArrowDown,ArrowLeft,ArrowRight'
  );

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
            <select
              className="toolbar-select"
              aria-label="Player Viewport Scaling Mode"
              value={playerScaleMode}
              onChange={(e) =>
                setPlayerScaleMode(
                  e.target.value as 'auto-fit' | 'auto-fill' | 'stretch' | 'native'
                )
              }
              title="Auto-scale scene to player viewport"
            >
              <option value="auto-fit">Auto-Fit Viewport ({scalePercentLabel})</option>
              <option value="auto-fill">Auto-Fill Viewport ({scalePercentLabel})</option>
              <option value="stretch">Stretch to Viewport</option>
              <option value="native">100% Native ({sceneW}×{sceneH})</option>
            </select>
            {activeAudioStatuses.length > 0 && (
              <span
                className="hud-metric"
                title={activeAudioStatuses
                  .map(
                    ({ track, evalState }) =>
                      `${track.name} (${track.scope}, ${track.channel}): ${
                        evalState.playing
                          ? `${Math.round(evalState.instantGain * 100)}%`
                          : 'Standby'
                      }`
                  )
                  .join(' | ')}
              >
                <Volume2 size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                Audio ({activeAudioStatuses.filter((a) => a.evalState.playing).length}/
                {activeAudioStatuses.length} active)
              </span>
            )}
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
              className="btn-xs primary-accent"
              onClick={() => {
                saveActivePlayerSetupQr(setupQrPayload);
                setShowSetupQrModal(true);
              }}
              title="Show Player Setup & Mobile Enrollment QR Code"
            >
              <QrCode size={13} /> Setup QR Code
            </button>

            <button
              className={`btn-xs ${showMaintenanceConsole ? 'primary-accent' : ''}`}
              onClick={() => setShowMaintenanceConsole(!showMaintenanceConsole)}
              title={`Toggle Centered Player Maintenance Mode Console (${kioskConfig.maintenanceHotkey || 'Ctrl+Shift+M'})`}
            >
              <KeyRound size={13} /> Maintenance Console
              {maintenanceRemainingSec > 0 ? ` (${maintenanceRemainingSec}s)` : ''}
            </button>

            <button
              className="btn-xs"
              onClick={handleEngageKioskLockout}
              title={`Engage Kiosk Lockout (Unlock with ${kioskConfig.maintenanceHotkey || 'Ctrl+Shift+M'} or [${formattedSeqLabel}])`}
            >
              <Lock size={13} /> Engage Kiosk Lockout
            </button>

            <button className="icon-btn" onClick={toggleFullscreen} title="Toggle Full-Screen">
              {isFullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
            </button>
          </div>
        </div>
      )}

      {/* Top-Centered Transient Kiosk OSD Banner & Live Key-Sequence Progress Indicator */}
      {(kioskOsdHint || sequenceProgress) && (
        <div
          className="kiosk-locked-floating-indicator"
          role="status"
          aria-live="polite"
        >
          <KeyRound size={13} color="#38bdf8" />
          {sequenceProgress ? (
            <span>
              Maintenance Key Sequence (<code>{sequenceProgress.label}</code>):{' '}
              <strong>
                {sequenceProgress.current} / {sequenceProgress.total}
              </strong>{' '}
              keys matched
            </span>
          ) : (
            <span>{kioskOsdHint}</span>
          )}
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
        /* Main Auto-Scaled Signage Presentation Viewport */
        <div ref={stageWrapperRef} className="player-stage-wrapper">
          <div
            className="player-scaled-bounds"
            style={{
              width: `${scaledBoxWidth}px`,
              height: `${scaledBoxHeight}px`,
            }}
          >
            <div
              className="player-aspect-frame"
              data-scale-mode={playerScaleMode}
              data-scale-x={scaleX.toFixed(4)}
              data-scale-y={scaleY.toFixed(4)}
              style={
                {
                  width: `${sceneW}px`,
                  height: `${sceneH}px`,
                  background:
                    activeScene.backgroundGradient || activeScene.backgroundColor || '#090d16',
                  opacity: timelineState.transitionStyle.opacity,
                  transformOrigin: 'top left',
                  '--player-scale': scaleX.toFixed(4),
                  transform: `scale(${scaleX.toFixed(4)}, ${scaleY.toFixed(4)}) ${
                    timelineState.transitionStyle.transform !== 'none'
                      ? timelineState.transitionStyle.transform
                      : ''
                  }`,
                  clipPath: timelineState.transitionStyle.clipPath,
                } as React.CSSProperties
              }
            >
              {timelineState.elements
                .filter((el) => el.type !== 'group')
                .map((el) => (
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

          {/* Centered Player Maintenance Mode Console Overlay (Appears Centered Over Viewport) */}
          {!kioskLocked && showMaintenanceConsole && (
            <div
              className="player-maintenance-console-backdrop"
              onClick={() => setShowMaintenanceConsole(false)}
            >
              <div
                className="inline-edit-dialog player-maintenance-console-card"
                onClick={(e) => e.stopPropagation()}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '10px',
                  }}
                >
                  <h4 style={{ margin: 0 }}>
                    <Unlock size={16} color="#10b981" /> Player Maintenance Mode Console
                  </h4>
                  {maintenanceRemainingSec > 0 && (
                    <span
                      className="perm-badge"
                      style={{
                        background: 'rgba(16, 185, 129, 0.16)',
                        color: '#10b981',
                        fontWeight: 700,
                      }}
                    >
                      Auto-Locks in {maintenanceRemainingSec}s
                    </span>
                  )}
                </div>

                <div className="asset-stats-card" style={{ marginTop: '4px' }}>
                  <div>
                    <span>Device Name &amp; ID:</span>{' '}
                    <strong>
                      {kioskConfig.deviceName} ({kioskConfig.deviceId})
                    </strong>
                  </div>
                  <div>
                    <span>Active Package:</span>{' '}
                    <strong>{pkg.fileName}</strong> (SHA-256: {report.packageHashHex.slice(0, 10)}…)
                  </div>
                  <div>
                    <span>Viewport Auto-Scale:</span>{' '}
                    <strong>
                      {scalePercentLabel} ({sceneW}×{sceneH} → {scaledBoxWidth}×{scaledBoxHeight}px)
                    </strong>
                  </div>
                  <div>
                    <span>Schedule &amp; Watchdog:</span>{' '}
                    <strong>
                      {resolvedSchedule?.reason} • {watchdogState.state} ({estimatedFps} FPS)
                    </strong>
                  </div>
                  <div>
                    <span>Maintenance Sequence:</span>{' '}
                    <code>{kioskConfig.maintenanceHotkey || 'Ctrl+Shift+M'}</code> or{' '}
                    <code>{formattedSeqLabel}</code>
                  </div>
                </div>

                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: '8px',
                    marginTop: '6px',
                  }}
                >
                  <button
                    type="button"
                    className="btn-xs"
                    onClick={() => setAppMode('studio')}
                  >
                    <ArrowLeft size={13} /> Open Studio Designer
                  </button>
                  <button
                    type="button"
                    className="btn-xs"
                    onClick={() => setAppMode('device-admin')}
                  >
                    <KeyRound size={13} /> Kiosk &amp; Key Sequence Settings
                  </button>
                  <button
                    type="button"
                    className="btn-xs"
                    onClick={() => {
                      saveActivePlayerSetupQr(setupQrPayload);
                      setShowSetupQrModal(true);
                    }}
                  >
                    <QrCode size={13} /> Player Setup QR Code
                  </button>
                </div>

                <div className="dialog-footer" style={{ marginTop: '10px' }}>
                  <button
                    type="button"
                    className="btn-xs"
                    onClick={() => setShowMaintenanceConsole(false)}
                  >
                    Minimize to Top Bar
                  </button>
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={handleEngageKioskLockout}
                  >
                    <Lock size={13} /> Exit Maintenance &amp; Relock Display
                  </button>
                </div>
              </div>
            </div>
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
              Triggered via <strong>{authTriggerSource}</strong>. Enter the device-bound
              administrator passphrase to unlock maintenance controls for a time-limited session (
              {kioskConfig.maintenanceSessionDurationSec}s).
            </p>
            <p className="muted-line" style={{ color: '#38bdf8' }}>
              Default Provisioned Admin Passphrase: <code>ApexAdmin!2026</code>
            </p>
            <input
              type="password"
              className="inspector-input"
              aria-label="Administrator Passphrase"
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

      {/* Player Setup & Mobile Enrollment QR Code Modal */}
      {showSetupQrModal && (
        <div className="inline-edit-backdrop" onClick={() => setShowSetupQrModal(false)}>
          <div
            className="inline-edit-dialog qr-setup-dialog"
            onClick={(e) => e.stopPropagation()}
          >
            <h4>
              <QrCode size={17} color="#38bdf8" /> Player Setup & Mobile Provisioning QR Code
            </h4>
            <p className="muted-line">
              Scan this QR code from the <strong>Network &amp; Sync Server → Devices &amp; Enrollment</strong>{' '}
              view on a mobile phone to automatically enroll and provision this display.
            </p>

            <div className="qr-setup-preview-box">
              <svg
                viewBox={`0 0 ${setupQrMatrix.length} ${setupQrMatrix.length}`}
                width="196"
                height="196"
                style={{
                  background: '#ffffff',
                  padding: '12px',
                  borderRadius: '10px',
                  shapeRendering: 'crispEdges',
                }}
                aria-label="Player Setup Enrollment QR Code"
              >
                {setupQrMatrix.map((row, r) =>
                  row.map((cell, c) =>
                    cell ? (
                      <rect
                        key={`${r}-${c}`}
                        x={c}
                        y={r}
                        width={1}
                        height={1}
                        fill="#0f172a"
                      />
                    ) : null
                  )
                )}
              </svg>
            </div>

            <div className="asset-stats-card" style={{ marginTop: '10px' }}>
              <div>
                <span>Enrollment Code:</span>{' '}
                <code>{setupQrPayload.enrollmentCode}</code>
              </div>
              <div>
                <span>Player Device ID:</span>{' '}
                <strong>{setupQrPayload.deviceId}</strong>
              </div>
              <div>
                <span>Display Name:</span>{' '}
                <strong>{setupQrPayload.deviceName}</strong>
              </div>
              <div>
                <span>URI Payload:</span>{' '}
                <code style={{ wordBreak: 'break-all', fontSize: '10px' }}>
                  {setupQrUri}
                </code>
              </div>
            </div>

            <div className="dialog-footer" style={{ marginTop: '12px' }}>
              <button
                type="button"
                className="btn-xs"
                onClick={() => setShowSetupQrModal(false)}
              >
                Close
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={() => {
                  saveActivePlayerSetupQr(setupQrPayload);
                  setShowSetupQrModal(false);
                  setAppMode('network-console');
                  notify(
                    'info',
                    'Player Setup QR Code active — open Devices & Enrollment to scan with your mobile device.'
                  );
                }}
              >
                <Smartphone size={14} /> Open Mobile Enrollment Scanner
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
