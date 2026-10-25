// ============================================================================
// src/components/studio/StudioBottomTimeline.tsx — Timeline Keyframe Editor,
// Playhead Scrubber, Audio Waveform Visualization & Studio Status Bar
// ============================================================================

import React, { useEffect, useMemo } from 'react';
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
} from 'lucide-react';
import { useStudioStore } from '@/store/useStudioStore';
import { analyzeProjectAssets, validateProject } from '@packages/project-model';
import { formatBytes, formatDurationMs } from '@packages/shared';

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
    saveStatus,
  } = useStudioStore();

  const activeScene =
    project.scenes.find((s) => s.id === activeSceneId) ?? project.scenes[0];

  const sceneDurationMs = Math.max(1000, activeScene?.durationMs || 10000);
  const fps = project.settings.frameRate || 30;

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
    <div className="studio-bottom-dock">
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
      </div>

      {/* Multi-Track Keyframe Lanes */}
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
                  {/* Active Duration Span */}
                  <div
                    className="track-span-highlight"
                    style={{
                      left: `${((track.delayMs || 0) / sceneDurationMs) * 100}%`,
                      width: `${Math.min(100, (track.durationMs / sceneDurationMs) * 100)}%`,
                      opacity: track.muted ? 0.35 : 0.85,
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

        {/* Audio Waveform Synchronization Track */}
        <div className="timeline-track-row audio-waveform-row">
          <div className="track-label-col">
            <span className="track-el-name">Scene Audio Sync</span>
            <span className="track-prop-pill">waveform</span>
          </div>
          <div className="track-lane-bar waveform-bars">
            {Array.from({ length: 48 }).map((_, idx) => {
              const h = 25 + Math.round(Math.abs(Math.sin(idx * 0.65)) * 65);
              return (
                <div
                  key={idx}
                  className="waveform-bar-tick"
                  style={{ height: `${h}%` }}
                />
              );
            })}
            <div
              className="track-playhead-line"
              style={{
                left: `${Math.min(100, (timelineTimeMs / sceneDurationMs) * 100)}%`,
              }}
            />
          </div>
        </div>
      </div>

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
