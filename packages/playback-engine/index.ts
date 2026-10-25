// ============================================================================
// @packages/playback-engine — Standalone Playback Engine, Server-Authoritative
// Synchronized Timeline, NTP Clock Sync, Drift Correction & Atomic Local Cache
// (Independent of Editor UI — Architectural Rule 2)
// ============================================================================

import {
  ComputedElementState,
  SceneTransitionStyle,
  computeSceneElementsAtTime,
  computeSceneTransitionStyle,
} from '@packages/animation-engine';
import { TimelineSlot, buildPlaylistTimeline } from '@packages/playlist-engine';
import {
  PlaybackSchedule,
  Playlist,
  Scene,
  SignageProject,
} from '@packages/project-model';
import { extractProjectFromArchive, validateSignageArchive } from '@packages/signage-format';

export type SynchronizationPolicy =
  | 'SCHEDULE_SYNC'       // Level 1
  | 'TIMELINE_SYNC'       // Level 2
  | 'DRIFT_CORRECTED'     // Level 3
  | 'VIDEO_WALL_STRICT';  // Level 4

export type GroupStartFailurePolicy =
  | 'WAIT_FOR_ALL'
  | 'START_WITH_AVAILABLE'
  | 'REMOVE_UNAVAILABLE'
  | 'ABORT'
  | 'CONTINUE_PREVIOUS';

export interface SynchronizedSessionConfig {
  sessionId: string;
  groupId: string;
  packageId: string;
  packageVersion: number;
  playlistId: string;
  playlistRevision: number;
  timelineRevision: number;
  startTimeUtc: string; // ISO-8601 UTC timestamp
  status: 'PREPARED' | 'RUNNING' | 'PAUSED' | 'STOPPED' | 'COMPLETED';
  pausedPositionMs?: number;
  synchronizationPolicy: SynchronizationPolicy;
  failurePolicy: GroupStartFailurePolicy;
}

export interface EvaluatedTimelineState {
  phase: 'PRE_START_COUNTDOWN' | 'PLAYING' | 'PAUSED' | 'COMPLETED';
  countdownMs: number;
  sessionElapsedMs: number;
  cycleElapsedMs: number;
  cycleIndex: number;
  activeScene: Scene;
  activeSlotIndex: number;
  sceneElapsedMs: number;
  sceneDurationMs: number;
  elements: ComputedElementState[];
  transitionStyle: SceneTransitionStyle;
}

/**
 * Spec Section 24.2: Server-Authoritative Timeline Evaluation.
 * Given a session and estimated server UTC time (ms), deterministically computes
 * the exact active scene, elapsed milliseconds inside that scene, and animated
 * element properties — allowing late joiners or reconnecting players to land at
 * the exact right frame without restarting the presentation.
 */
export function evaluateAuthoritativeTimeline(
  project: SignageProject,
  playlist: Playlist,
  session: SynchronizedSessionConfig,
  estimatedServerTimeMs: number
): EvaluatedTimelineState {
  const { slots, totalCycleDurationMs } = buildPlaylistTimeline(playlist, project.scenes);
  const startUtcMs = Date.parse(session.startTimeUtc);

  if (Number.isNaN(startUtcMs)) {
    throw new Error(`Invalid session startTimeUtc: ${session.startTimeUtc}`);
  }

  if (estimatedServerTimeMs < startUtcMs && session.status !== 'PAUSED') {
    const firstSlot = slots[0];
    return {
      phase: 'PRE_START_COUNTDOWN',
      countdownMs: startUtcMs - estimatedServerTimeMs,
      sessionElapsedMs: 0,
      cycleElapsedMs: 0,
      cycleIndex: 0,
      activeScene: firstSlot.scene,
      activeSlotIndex: 0,
      sceneElapsedMs: 0,
      sceneDurationMs: firstSlot.durationMs,
      elements: computeSceneElementsAtTime(
        firstSlot.scene.elements,
        firstSlot.scene.animationTracks,
        0
      ),
      transitionStyle: { opacity: 1, transform: 'none' },
    };
  }

  const rawElapsed =
    session.status === 'PAUSED' && typeof session.pausedPositionMs === 'number'
      ? Math.max(0, session.pausedPositionMs)
      : Math.max(0, estimatedServerTimeMs - startUtcMs);

  const isLoop = playlist.loop !== false;
  if (!isLoop && rawElapsed >= totalCycleDurationMs) {
    const lastSlot = slots[slots.length - 1];
    return {
      phase: 'COMPLETED',
      countdownMs: 0,
      sessionElapsedMs: rawElapsed,
      cycleElapsedMs: totalCycleDurationMs,
      cycleIndex: 1,
      activeScene: lastSlot.scene,
      activeSlotIndex: lastSlot.slotIndex,
      sceneElapsedMs: lastSlot.durationMs,
      sceneDurationMs: lastSlot.durationMs,
      elements: computeSceneElementsAtTime(
        lastSlot.scene.elements,
        lastSlot.scene.animationTracks,
        lastSlot.durationMs
      ),
      transitionStyle: { opacity: 1, transform: 'none' },
    };
  }

  const cycleIndex = Math.floor(rawElapsed / totalCycleDurationMs);
  const cycleElapsedMs = rawElapsed % totalCycleDurationMs;

  let activeSlot: TimelineSlot = slots[0];
  for (const slot of slots) {
    if (cycleElapsedMs >= slot.startOffsetMs && cycleElapsedMs < slot.endOffsetMs) {
      activeSlot = slot;
      break;
    }
  }

  const sceneElapsedMs = Math.max(0, cycleElapsedMs - activeSlot.startOffsetMs);
  const elements = computeSceneElementsAtTime(
    activeSlot.scene.elements,
    activeSlot.scene.animationTracks,
    sceneElapsedMs
  );
  const transitionStyle = computeSceneTransitionStyle(
    activeSlot.scene.entryTransition,
    activeSlot.scene.exitTransition,
    sceneElapsedMs,
    activeSlot.durationMs
  );

  return {
    phase: session.status === 'PAUSED' ? 'PAUSED' : 'PLAYING',
    countdownMs: 0,
    sessionElapsedMs: rawElapsed,
    cycleElapsedMs,
    cycleIndex,
    activeScene: activeSlot.scene,
    activeSlotIndex: activeSlot.slotIndex,
    sceneElapsedMs,
    sceneDurationMs: activeSlot.durationMs,
    elements,
    transitionStyle,
  };
}

// ============================================================================
// Clock Synchronization Engine (Spec Section 25)
// ============================================================================

export interface ClockSyncSample {
  t1ClientSendMs: number;
  t2ServerRecvMs: number;
  t3ServerSendMs: number;
  t4ClientRecvMs: number;
  offsetMs: number;
  rttMs: number;
  timestampMs: number;
}

export interface ClockSyncStatus {
  estimatedOffsetMs: number;
  uncertaintyMs: number;
  minRttMs: number;
  sampleCount: number;
  lastSyncAtMs: number;
  largeJumpDetected: boolean;
}

/**
 * Spec Section 25.1:
 * Offset = ((T2 - T1) + (T3 - T4)) / 2
 * RTT = (T4 - T1) - (T3 - T2)
 */
export function computeClockExchangeMetrics(
  t1: number,
  t2: number,
  t3: number,
  t4: number
): { offsetMs: number; rttMs: number } {
  const offsetMs = ((t2 - t1) + (t3 - t4)) / 2;
  const rttMs = Math.max(0, (t4 - t1) - (t3 - t2));
  return { offsetMs, rttMs };
}

export class ClockSyncEngine {
  private samples: ClockSyncSample[] = [];
  private maxSamples = 12;
  private currentOffsetMs = 0;
  private uncertaintyMs = 25;
  private largeJumpDetected = false;
  private anchorWallMs = Date.now();
  private anchorMonotonicMs = performance.now();

  public recordExchange(t1: number, t2: number, t3: number, t4: number): ClockSyncStatus {
    const { offsetMs, rttMs } = computeClockExchangeMetrics(t1, t2, t3, t4);
    const sample: ClockSyncSample = {
      t1ClientSendMs: t1,
      t2ServerRecvMs: t2,
      t3ServerSendMs: t3,
      t4ClientRecvMs: t4,
      offsetMs,
      rttMs,
      timestampMs: Date.now(),
    };

    this.samples.push(sample);
    if (this.samples.length > this.maxSamples) {
      this.samples.shift();
    }

    // Outlier rejection: prefer lowest-RTT 60% of samples
    const sortedByRtt = [...this.samples].sort((a, b) => a.rttMs - b.rttMs);
    const keepCount = Math.max(1, Math.ceil(sortedByRtt.length * 0.6));
    const filtered = sortedByRtt.slice(0, keepCount);

    const avgOffset =
      filtered.reduce((acc, s) => acc + s.offsetMs, 0) / filtered.length;
    const minRtt = sortedByRtt[0].rttMs;

    // Variance / uncertainty estimate
    const meanDiff =
      filtered.reduce((acc, s) => acc + Math.abs(s.offsetMs - avgOffset), 0) / filtered.length;
    this.uncertaintyMs = Math.round((minRtt / 2 + meanDiff) * 100) / 100;

    const delta = avgOffset - this.currentOffsetMs;
    if (this.samples.length > 1 && Math.abs(delta) > 1000) {
      // Large clock jump detected (> 1000 ms): snap immediately and flag
      this.largeJumpDetected = true;
      this.currentOffsetMs = avgOffset;
    } else if (this.samples.length === 1) {
      this.largeJumpDetected = false;
      this.currentOffsetMs = avgOffset;
    } else {
      this.largeJumpDetected = false;
      // Gradual slew correction for small offsets (Spec 25.2)
      this.currentOffsetMs = this.currentOffsetMs + delta * 0.65;
    }

    this.anchorWallMs = Date.now();
    this.anchorMonotonicMs = performance.now();

    return this.getStatus();
  }

  public getEstimatedServerTimeMs(): number {
    const monotonicElapsed = performance.now() - this.anchorMonotonicMs;
    return this.anchorWallMs + monotonicElapsed + this.currentOffsetMs;
  }

  public getStatus(): ClockSyncStatus {
    const minRtt =
      this.samples.length > 0
        ? Math.min(...this.samples.map((s) => s.rttMs))
        : 0;
    return {
      estimatedOffsetMs: Math.round(this.currentOffsetMs * 100) / 100,
      uncertaintyMs: this.uncertaintyMs,
      minRttMs: Math.round(minRtt * 100) / 100,
      sampleCount: this.samples.length,
      lastSyncAtMs:
        this.samples.length > 0 ? this.samples[this.samples.length - 1].timestampMs : 0,
      largeJumpDetected: this.largeJumpDetected,
    };
  }
}

// ============================================================================
// Drift Measurement & Correction Policy (Spec Section 26)
// ============================================================================

export interface DriftThresholds {
  smallDriftMs: number;    // default 80ms: keep running / subtle rate slew
  moderateDriftMs: number; // default 350ms: controlled seek
  largeDriftMs: number;    // default 1000ms: reinitialize scene & seek
}

export const DEFAULT_DRIFT_THRESHOLDS: DriftThresholds = {
  smallDriftMs: 80,
  moderateDriftMs: 350,
  largeDriftMs: 1000,
};

export type DriftCorrectionAction =
  | { type: 'NONE'; driftMs: number; recommendedPlaybackRate: number }
  | { type: 'RATE_ADJUST'; driftMs: number; recommendedPlaybackRate: number }
  | { type: 'CONTROLLED_SEEK'; driftMs: number; targetSceneId: string; targetScenePositionMs: number }
  | { type: 'REINITIALIZE_SCENE'; driftMs: number; targetSceneId: string; targetScenePositionMs: number };

export function evaluateDriftCorrection(
  expectedSceneId: string,
  actualSceneId: string,
  expectedPositionMs: number,
  actualPositionMs: number,
  thresholds: DriftThresholds = DEFAULT_DRIFT_THRESHOLDS
): DriftCorrectionAction {
  const driftMs = actualPositionMs - expectedPositionMs;
  const absDrift = Math.abs(driftMs);

  if (expectedSceneId !== actualSceneId) {
    return {
      type: 'REINITIALIZE_SCENE',
      driftMs,
      targetSceneId: expectedSceneId,
      targetScenePositionMs: expectedPositionMs,
    };
  }

  if (absDrift <= thresholds.smallDriftMs) {
    return {
      type: 'NONE',
      driftMs,
      recommendedPlaybackRate: 1.0,
    };
  }

  if (absDrift <= thresholds.moderateDriftMs) {
    // Small conservative playback rate adjustment (0.97x .. 1.03x) or controlled seek
    const rate = driftMs > 0 ? 0.97 : 1.03;
    if (absDrift <= thresholds.smallDriftMs * 2.2) {
      return {
        type: 'RATE_ADJUST',
        driftMs,
        recommendedPlaybackRate: rate,
      };
    }
    return {
      type: 'CONTROLLED_SEEK',
      driftMs,
      targetSceneId: expectedSceneId,
      targetScenePositionMs: expectedPositionMs,
    };
  }

  if (absDrift <= thresholds.largeDriftMs) {
    return {
      type: 'CONTROLLED_SEEK',
      driftMs,
      targetSceneId: expectedSceneId,
      targetScenePositionMs: expectedPositionMs,
    };
  }

  return {
    type: 'REINITIALIZE_SCENE',
    driftMs,
    targetSceneId: expectedSceneId,
    targetScenePositionMs: expectedPositionMs,
  };
}

// ============================================================================
// Atomic Local Package Cache & Offline Recovery (Spec Section 27.3 & 31)
// ============================================================================

export interface CachedPackageEntry {
  packageId: string;
  version: number;
  contentHash: string;
  bytes: Uint8Array;
  project: SignageProject;
  activatedAt: string;
}

export class AtomicPlayerPackageCache {
  private activePackage: CachedPackageEntry | null = null;
  private rollbackPackage: CachedPackageEntry | null = null;
  private stagingPackage: CachedPackageEntry | null = null;
  private cachedPlaylist: Playlist | null = null;
  private cachedSchedules: PlaybackSchedule[] = [];
  private lastSession: SynchronizedSessionConfig | null = null;

  /**
   * Downloads and validates a candidate package in a temporary staging slot
   * without touching the currently playing active package (Spec 27.3).
   */
  public stageAndValidateDownload(
    packageId: string,
    version: number,
    expectedHash: string,
    downloadedBytes: Uint8Array
  ): { ok: boolean; error?: string } {
    const report = validateSignageArchive(downloadedBytes);
    if (!report.valid) {
      this.stagingPackage = null;
      return {
        ok: false,
        error: `Downloaded archive failed validation: ${report.errors.join('; ')}`,
      };
    }

    if (expectedHash && report.packageHashHex !== expectedHash) {
      this.stagingPackage = null;
      return {
        ok: false,
        error: `Package hash mismatch: expected ${expectedHash}, got ${report.packageHashHex}`,
      };
    }

    const { project } = extractProjectFromArchive(downloadedBytes);
    this.stagingPackage = {
      packageId,
      version,
      contentHash: report.packageHashHex,
      bytes: downloadedBytes,
      project,
      activatedAt: new Date().toISOString(),
    };
    return { ok: true };
  }

  /**
   * Atomically promotes the verified staging package to active while preserving
   * the previous known-good package for rollback.
   */
  public activateStagedPackage(): CachedPackageEntry {
    if (!this.stagingPackage) {
      throw new Error('No validated staging package available to activate.');
    }
    if (this.activePackage) {
      this.rollbackPackage = this.activePackage;
    }
    this.activePackage = {
      ...this.stagingPackage,
      activatedAt: new Date().toISOString(),
    };
    this.stagingPackage = null;
    if (this.activePackage.project.playlists.length > 0 && !this.cachedPlaylist) {
      this.cachedPlaylist = this.activePackage.project.playlists[0];
    }
    if (this.activePackage.project.schedules.length > 0 && this.cachedSchedules.length === 0) {
      this.cachedSchedules = this.activePackage.project.schedules;
    }
    return this.activePackage;
  }

  public rollbackToPreviousPackage(): CachedPackageEntry | null {
    if (!this.rollbackPackage) return null;
    const prev = this.rollbackPackage;
    this.rollbackPackage = this.activePackage;
    this.activePackage = prev;
    return this.activePackage;
  }

  public getActivePackage(): CachedPackageEntry | null {
    return this.activePackage;
  }

  public getRollbackPackage(): CachedPackageEntry | null {
    return this.rollbackPackage;
  }

  public setCachedConfiguration(
    playlist: Playlist,
    schedules: PlaybackSchedule[],
    session?: SynchronizedSessionConfig
  ): void {
    this.cachedPlaylist = playlist;
    this.cachedSchedules = schedules;
    if (session) this.lastSession = session;
  }

  public getOfflineState() {
    return {
      activePackage: this.activePackage,
      rollbackPackage: this.rollbackPackage,
      cachedPlaylist: this.cachedPlaylist,
      cachedSchedules: this.cachedSchedules,
      lastSession: this.lastSession,
    };
  }
}
