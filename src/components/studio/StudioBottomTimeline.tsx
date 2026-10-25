// ============================================================================
// src/components/studio/StudioBottomTimeline.tsx — Timeline Keyframe Editor,
// Playhead Scrubber, Audio Waveform Visualization & Studio Status Bar
// ============================================================================

import React, { useEffect, useMemo, useState } from 'react';
import {
  Play,
  Pause,
  Square,
  SkipBack,
  Lock,
  Unlock,
  Volume2,
  VolumeX,
  CheckCircle2,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Music,
} from 'lucide-react';
import { useStudioStore } from '@/store/useStudioStore';
import { analyzeProjectAssets, validateProject } from '@packages/project-model';
import { formatBytes, formatDurationMs } from '@packages/shared';
import {
  evaluateAudioTrackAtTime,
  generateTrackWaveformBars,
  isAudioTrackActiveOnScene,
} from '@/utils/audioEngine';

export const StudioBottomTimeline: React.FC = () => {
  const {
    project,
    activeSceneId,
    selectedElementIds,
    setSelectedElementIds,
    timelineTimeMs,
    setTimelineTimeMs,
    timelinePlaying,
    setTimelinePlaying,
    frameDisplayMode,
    setFrameDisplayMode,
    toggleTrackMute,
    toggleTrackLock,
    commitProjectChange,
    saveStatus,
    bottomTimelineCollapsed,
    toggleBottomTimeline,
    setShowAudioEditorModal,
  } = useStudioStore();

  const [draggingTrackSpan, setDraggingTrackSpan] = useState<{
    trackId: string;
    startClientX: number;
    laneWidthPx: number;
    initialDelayMs: number;
  } | null>(null);

  const activeScene =
    project.scenes.find((s) => s.id === activeSceneId) ?? project.scenes[0];

  const sceneDurationMs = Math.max(1000, activeScene?.durationMs || 10000);
  const fps = project.settings.frameRate || 30;

  useEffect(() => {
    if (!draggingTrackSpan || !activeScene) return;
    const onMove = (e: PointerEvent | MouseEvent) => {
      e.preventDefault();
      const clientX = typeof e.clientX === 'number' ? e.clientX : draggingTrackSpan.startClientX;
      const deltaPx = clientX - draggingTrackSpan.startClientX;
      const deltaMs = Math.round(
        (deltaPx / Math.max(1, draggingTrackSpan.laneWidthPx)) * sceneDurationMs
      );
      const nextDelayMs = Math.max(
        0,
        Math.min(sceneDurationMs - 100, draggingTrackSpan.initialDelayMs + deltaMs)
      );
      commitProjectChange(
        'Move Track Start Time on Timeline',
        (draft) => {
          const sc = draft.scenes.find((s) => s.id === activeScene.id);
          const tr = sc?.animationTracks.find((t) => t.id === draggingTrackSpan.trackId);
          if (tr && !tr.locked) {
            tr.delayMs = nextDelayMs;
          }
        }
      );
    };
    const onUp = () => setDraggingTrackSpan(null);
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('mousemove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('mouseup', onUp);
    };
  }, [draggingTrackSpan, activeScene, sceneDurationMs, commitProjectChange]);

  useEffect(() => {
    if (!timelinePlaying) return;
    let lastTs = performance.now();
    let rafId = 0;

    const tick = (now: number) => {
      const dt = now - lastTs;
      lastTs = now;
      const next = useStudioStore.getState().timelineTimeMs + dt;
      if (next >= sceneDurationMs) {
        useStudioStore.getState().setTimelineTimeMs(0);
      } else {
        useStudioStore.getState().setTimelineTimeMs(next);
      }
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [timelinePlaying, sceneDurationMs]);

  const validation = useMemo(() => validateProject(project), [project]);
  const assetReport = useMemo(() => analyzeProjectAssets(project), [project]);

  const currentFrame = Math.floor((timelineTimeMs / 1000) * fps);
  const totalFrames = Math.floor((sceneDurationMs / 1000) * fps);

  return (
    <div className={`studio-bottom-dock ${bottomTimelineCollapsed ? 'collapsed' : ''}`}>
      {/* Timeline Controls Header */}
      <div className="timeline-header">
        <div className="timeline-transport">
          <button
            className="icon-btn-sm"
            onClick={() => {
              setTimelinePlaying(false);
              setTimelineTimeMs(0);
            }}
            title="Rewind to Start"
          >
            <SkipBack size={13} />
          </button>
          <button
            className="btn-xs primary-accent"
            onClick={() => setTimelinePlaying(!timelinePlaying)}
          >
            {timelinePlaying ? <Pause size={13} /> : <Play size={13} />}
            {timelinePlaying ? 'Pause' : 'Play'}
          </button>
          <button
            className="icon-btn-sm"
            onClick={() => {
              setTimelinePlaying(false);
              setTimelineTimeMs(0);
            }}
            title="Stop"
          >
            <Square size={12} />
          </button>

          <span className="timecode-badge">
            {frameDisplayMode === 'time'
              ? `${formatDurationMs(timelineTimeMs)} / ${formatDurationMs(sceneDurationMs)}`
              : `Frame ${currentFrame.toString().padStart(3, '0')} / ${totalFrames} (${fps} FPS)`}
          </span>

          <button
            className="btn-xs"
            onClick={() =>
              setFrameDisplayMode(frameDisplayMode === 'time' ? 'frames' : 'time')
            }
          >
            {frameDisplayMode === 'time' ? 'Show Frames' : 'Show Seconds'}
          </button>
        </div>

        {/* Scrubber Slider */}
        <div className="timeline-scrubber-wrap">
          <input
            type="range"
            min={0}
            max={sceneDurationMs}
            step={16}
            value={Math.min(sceneDurationMs, Math.round(timelineTimeMs))}
            aria-label="Timeline Scrubber"
            onChange={(e) => {
              setTimelinePlaying(false);
              setTimelineTimeMs(Number(e.target.value));
            }}
            className="timeline-range-input"
          />
        </div>

        <button
          className="btn-xs"
          onClick={() => setShowAudioEditorModal(true)}
          title="Open Simple Audio Editor & Background Music Mixer"
        >
          <Music size={13} /> Audio Editor ({project.audioTracks?.length ?? 0})
        </button>

        <button
          className="btn-xs"
          onClick={toggleBottomTimeline}
          title={bottomTimelineCollapsed ? 'Expand Timeline Tracks' : 'Collapse Timeline Tracks'}
          aria-label="Collapse or Expand Timeline"
        >
          {bottomTimelineCollapsed ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          {bottomTimelineCollapsed ? 'Expand Timeline' : 'Collapse'}
        </button>
      </div>

      {/* Multi-Track Keyframe Lanes */}
      {!bottomTimelineCollapsed && (
        <div className="timeline-tracks-body">
        {activeScene &&
          activeScene.animationTracks.map((track) => {
            const el = activeScene.elements.find((e) => e.id === track.elementId);
            const isSelected = selectedElementIds.includes(track.elementId);
            return (
              <div
                key={track.id}
                className={`timeline-track-row ${isSelected ? 'selected' : ''}`}
                onClick={() => setSelectedElementIds([track.elementId])}
              >
                <div className="track-label-col">
                  <span className="track-el-name">{el?.name || track.elementId}</span>
                  <span className="track-prop-pill">{track.property}</span>
                  <input
                    type="number"
                    className="inspector-input"
                    style={{
                      width: '62px',
                      height: '20px',
                      padding: '1px 4px',
                      fontSize: '10px',
                    }}
                    title={
                      frameDisplayMode === 'frames'
                        ? `Motion Start Frame (@ ${fps} FPS)`
                        : 'Motion Start Time (ms)'
                    }
                    aria-label={`Timeline Start for ${track.property}`}
                    min={0}
                    step={frameDisplayMode === 'frames' ? 1 : 50}
                    value={
                      frameDisplayMode === 'frames'
                        ? Math.round(((track.delayMs || 0) / 1000) * fps)
                        : track.delayMs || 0
                    }
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => {
                      const raw = Math.max(0, Number(e.target.value));
                      const nextDelayMs =
                        frameDisplayMode === 'frames'
                          ? Math.round((raw / fps) * 1000)
                          : raw;
                      commitProjectChange('Set Motion Start on Timeline', (draft) => {
                        const sc = draft.scenes.find((s) => s.id === activeScene.id);
                        const tr = sc?.animationTracks.find((t) => t.id === track.id);
                        if (tr && !tr.locked) tr.delayMs = nextDelayMs;
                      });
                    }}
                  />
                  <div
                    className="track-mini-btns"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      className="icon-btn-sm"
                      title={track.muted ? 'Unmute Track' : 'Mute Track'}
                      onClick={() => toggleTrackMute(track.id)}
                    >
                      {track.muted ? <VolumeX size={11} /> : <Volume2 size={11} />}
                    </button>
                    <button
                      className="icon-btn-sm"
                      title={track.locked ? 'Unlock Track' : 'Lock Track'}
                      onClick={() => toggleTrackLock(track.id)}
                    >
                      {track.locked ? <Lock size={11} /> : <Unlock size={11} />}
                    </button>
                  </div>
                </div>

                <div
                  className="track-lane-bar"
                  onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const ratio = Math.max(
                      0,
                      Math.min(1, (e.clientX - rect.left) / Math.max(1, rect.width))
                    );
                    setTimelineTimeMs(Math.round(ratio * sceneDurationMs));
                  }}
                >
                  {/* Active Duration Span (Draggable to adjust start time/frame on timeline) */}
                  <div
                    className="track-span-highlight"
                    title={`Drag horizontally to move start time (${track.delayMs || 0}ms / F${Math.round(((track.delayMs || 0) / 1000) * fps)})`}
                    style={{
                      left: `${((track.delayMs || 0) / sceneDurationMs) * 100}%`,
                      width: `${Math.min(100, (track.durationMs / sceneDurationMs) * 100)}%`,
                      opacity: track.muted ? 0.35 : 0.85,
                      cursor: track.locked ? 'not-allowed' : 'grab',
                    }}
                    onMouseDown={(e) => {
                      if (track.locked) return;
                      e.stopPropagation();
                      const laneEl = e.currentTarget.parentElement;
                      const laneWidthPx = laneEl?.getBoundingClientRect().width || 600;
                      setDraggingTrackSpan({
                        trackId: track.id,
                        startClientX: e.clientX,
                        laneWidthPx,
                        initialDelayMs: track.delayMs || 0,
                      });
                    }}
                  />

                  {/* Keyframe Diamonds */}
                  {track.keyframes.map((kf) => {
                    const leftPct = Math.min(
                      99,
                      Math.max(0, ((track.delayMs + kf.timeMs) / sceneDurationMs) * 100)
                    );
                    return (
                      <div
                        key={kf.id}
                        className="keyframe-diamond"
                        style={{ left: `${leftPct}%` }}
                        title={`${track.property}: ${kf.value} @ ${kf.timeMs}ms (${kf.easing})`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setTimelineTimeMs(track.delayMs + kf.timeMs);
                        }}
                      />
                    );
                  })}

                  {/* Playhead Marker */}
                  <div
                    className="track-playhead-line"
                    style={{
                      left: `${Math.min(100, (timelineTimeMs / sceneDurationMs) * 100)}%`,
                    }}
                  />
                </div>
              </div>
            );
          })}

        {/* Project Background / Scene / Environment Audio Tracks */}
        {activeScene &&
          (project.audioTracks ?? [])
            .filter((at) => isAudioTrackActiveOnScene(at, activeScene.id))
            .map((audioTrack) => {
              const wfBars = generateTrackWaveformBars(audioTrack, 48);
              const evalState = evaluateAudioTrackAtTime(
                audioTrack,
                activeScene.id,
                timelineTimeMs,
                sceneDurationMs
              );
              const startPct = Math.min(
                98,
                ((audioTrack.startAtMs || 0) / sceneDurationMs) * 100
              );
              const stopMs =
                audioTrack.stopAtMs && audioTrack.stopAtMs > (audioTrack.startAtMs || 0)
                  ? audioTrack.stopAtMs
                  : sceneDurationMs;
              const widthPct = Math.max(
                4,
                Math.min(100 - startPct, ((stopMs - (audioTrack.startAtMs || 0)) / sceneDurationMs) * 100)
              );

              return (
                <div
                  key={audioTrack.id}
                  className="timeline-track-row audio-waveform-row"
                  onClick={() => setShowAudioEditorModal(true)}
                  title="Click to open in Studio Audio Editor"
                >
                  <div className="track-label-col">
                    <span className="track-el-name">{audioTrack.name}</span>
                    <span className="track-prop-pill">{audioTrack.scope}</span>
                    <span className="muted-line" style={{ fontSize: '10px' }}>
                      {evalState.playing
                        ? `${Math.round(evalState.instantGain * 100)}%`
                        : 'idle'}
                    </span>
                  </div>
                  <div
                    className="track-lane-bar waveform-bars"
                    style={{ position: 'relative' }}
                  >
                    <div
                      className="track-span-highlight"
                      style={{
                        left: `${startPct}%`,
                        width: `${widthPct}%`,
                        background: 'rgba(16, 185, 129, 0.18)',
                        borderColor: '#10b981',
                      }}
                    />
                    {wfBars.map((bar) => (
                      <div
                        key={bar.index}
                        className="waveform-bar-tick"
                        style={{
                          height: `${Math.max(12, Math.round(bar.amplitude * 90))}%`,
                          opacity: bar.isDeleted ? 0.15 : bar.inCropRange ? 0.9 : 0.3,
                        }}
                      />
                    ))}
                    <div
                      className="track-playhead-line"
                      style={{
                        left: `${Math.min(100, (timelineTimeMs / sceneDurationMs) * 100)}%`,
                      }}
                    />
                  </div>
                </div>
              );
            })}
        </div>
      )}

      {/* Studio Status Bar (Spec Section 4.1) */}
      <footer className="studio-status-bar">
        <div className="status-item">
          <strong>Resolution:</strong> {project.settings.width} × {project.settings.height}
        </div>
        <div className="status-item">
          <strong>Frame Rate:</strong> {fps} FPS
        </div>
        <div className="status-item">
          <strong>Selection:</strong>{' '}
          {selectedElementIds.length === 0
            ? 'None'
            : `${selectedElementIds.length} layer(s)`}
        </div>
        <div className="status-item">
          <strong>Persistence:</strong> IndexedDB ({saveStatus})
        </div>
        <div className="status-item">
          <strong>Est. .signage Size:</strong>{' '}
          {formatBytes(assetReport.estimatedCompactSize)}
        </div>
        <div className="status-item status-right">
          {validation.valid ? (
            <span className="validation-ok">
              <CheckCircle2 size={13} /> Project Valid ({validation.issues.length} warnings)
            </span>
          ) : (
            <span className="validation-err">
              <AlertTriangle size={13} /> {validation.issues.length} Validation Issue(s)
            </span>
          )}
        </div>
      </footer>
    </div>
  );
};
