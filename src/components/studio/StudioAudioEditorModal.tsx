// ============================================================================
// src/components/studio/StudioAudioEditorModal.tsx
// Built-In Simple Audio Editor & Background Music / Scene Audio Studio
// Supports Scene / Multi-Scene / Continuous Environment Music, Looping,
// Cropping, Start/Stop by Time or Frame, Fade-In/Out, Volume, Stereo Channel
// Routing, Deleting Selected Sections & Combining Tracks
// ============================================================================

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Music,
  Play,
  Square,
  Scissors,
  Trash2,
  Plus,
  Upload,
  Merge,
  RotateCcw,
  Volume2,
  X,
  CheckCircle2,
} from 'lucide-react';
import { useStudioStore } from '@/store/useStudioStore';
import { AudioClipConfig } from '@packages/project-model';
import {
  buildWavDataUrlForTrack,
  combineAudioTracks,
  generateTrackWaveformBars,
} from '@/utils/audioEngine';
import { createId, formatDurationMs } from '@packages/shared';

export const StudioAudioEditorModal: React.FC = () => {
  const {
    project,
    activeSceneId,
    showAudioEditorModal,
    setShowAudioEditorModal,
    commitProjectChange,
    importAssetItem,
    notify,
  } = useStudioStore();

  const audioTracks = project.audioTracks ?? [];
  const [selectedTrackId, setSelectedTrackId] = useState<string>(
    audioTracks[0]?.id || ''
  );
  const [selectionStartMs, setSelectionStartMs] = useState<number>(1500);
  const [selectionEndMs, setSelectionEndMs] = useState<number>(4500);
  const [hasSelection, setHasSelection] = useState<boolean>(true);
  const [waveformDrag, setWaveformDrag] = useState<{
    mode: 'new' | 'resize-start' | 'resize-end';
    anchorMs: number;
    fixedStartMs: number;
    fixedEndMs: number;
    moved: boolean;
  } | null>(null);
  const [tracksToCombine, setTracksToCombine] = useState<string[]>([]);
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);
  const [previewPositionMs, setPreviewPositionMs] = useState<number | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const waveformCanvasRef = useRef<HTMLDivElement | null>(null);

  const selectedTrack = useMemo(() => {
    return (
      audioTracks.find((t) => t.id === selectedTrackId) ??
      audioTracks[0] ??
      null
    );
  }, [audioTracks, selectedTrackId]);

  const fps = project.settings.frameRate || 30;

  const waveformBars = useMemo(() => {
    if (!selectedTrack) return [];
    return generateTrackWaveformBars(selectedTrack, 64);
  }, [selectedTrack]);

  const previewWavUrl = useMemo(() => {
    if (!selectedTrack) return '';
    const uploadedAsset = project.assets.find(
      (a) => a.id === selectedTrack.assetId && a.type === 'audio' && a.dataUrl.startsWith('data:audio/')
    );
    if (uploadedAsset) return uploadedAsset.dataUrl;
    return buildWavDataUrlForTrack(selectedTrack, 3.0);
  }, [selectedTrack, project.assets]);

  const resolveWaveformTimeMs = useCallback(
    (clientX: number, target: EventTarget | null): number => {
      const duration = Math.max(1000, selectedTrack?.durationMs || 10000);
      const barEl =
        target instanceof HTMLElement
          ? (target.closest('[data-bar-time-ms]') as HTMLElement | null)
          : null;
      const container = waveformCanvasRef.current;
      const rect = container?.getBoundingClientRect();

      if (rect && rect.width > 0 && clientX > 0) {
        const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        return Math.round(ratio * duration);
      }
      if (barEl && barEl.dataset.barTimeMs !== undefined) {
        return Number(barEl.dataset.barTimeMs);
      }
      if (typeof clientX === 'number' && clientX > 0) {
        const ratio = Math.max(0, Math.min(1, clientX / 640));
        return Math.round(ratio * duration);
      }
      return 0;
    },
    [selectedTrack]
  );

  // Window-level drag listeners for waveform selection (new selection, move start, move end)
  useEffect(() => {
    if (!waveformDrag || !selectedTrack) return;
    const duration = Math.max(1000, selectedTrack.durationMs || 10000);

    const onMove = (e: PointerEvent | MouseEvent) => {
      const timeMs = Math.max(
        0,
        Math.min(duration, resolveWaveformTimeMs(e.clientX, e.target))
      );

      if (waveformDrag.mode === 'new') {
        const start = Math.min(waveformDrag.anchorMs, timeMs);
        const end = Math.max(waveformDrag.anchorMs, timeMs);
        if (Math.abs(timeMs - waveformDrag.anchorMs) > 0) {
          setHasSelection(true);
          setSelectionStartMs(start);
          setSelectionEndMs(end);
        }
      } else if (waveformDrag.mode === 'resize-start') {
        const nextStart = Math.min(timeMs, waveformDrag.fixedEndMs - 50);
        setHasSelection(true);
        setSelectionStartMs(Math.max(0, nextStart));
        setSelectionEndMs(waveformDrag.fixedEndMs);
      } else if (waveformDrag.mode === 'resize-end') {
        const nextEnd = Math.max(timeMs, waveformDrag.fixedStartMs + 50);
        setHasSelection(true);
        setSelectionStartMs(waveformDrag.fixedStartMs);
        setSelectionEndMs(Math.min(duration, nextEnd));
      }
    };

    const onUp = () => {
      setWaveformDrag(null);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('mouseup', onUp);
    };
  }, [waveformDrag, selectedTrack, resolveWaveformTimeMs]);

  // Live audio preview playhead tracker (turns current position bar red)
  useEffect(() => {
    if (!isPreviewPlaying || !selectedTrack) {
      setPreviewPositionMs(null);
      return;
    }

    const trimStart = Math.max(0, selectedTrack.trimStartMs || 0);
    const trimEnd = Math.max(
      trimStart + 200,
      selectedTrack.trimEndMs && selectedTrack.trimEndMs > trimStart
        ? selectedTrack.trimEndMs
        : selectedTrack.durationMs || 10000
    );
    const spanMs = Math.max(200, trimEnd - trimStart);
    const startedAt = performance.now();

    setPreviewPositionMs((prev) => (prev !== null ? prev : trimStart));

    const timer = window.setInterval(() => {
      const elapsed = performance.now() - startedAt;
      if (!selectedTrack.loop && elapsed >= spanMs) {
        setIsPreviewPlaying(false);
        setPreviewPositionMs(null);
        return;
      }
      const nextPos = trimStart + (elapsed % spanMs);
      setPreviewPositionMs(Math.round(nextPos));
    }, 60);

    return () => window.clearInterval(timer);
  }, [isPreviewPlaying, selectedTrack]);

  // Identify the single waveform bar closest to the current audio preview position
  const activePlayheadBarIndex = useMemo(() => {
    if (!isPreviewPlaying || previewPositionMs === null || waveformBars.length === 0) {
      return -1;
    }
    let bestIdx = 0;
    let bestDist = Number.POSITIVE_INFINITY;
    for (let i = 0; i < waveformBars.length; i++) {
      const dist = Math.abs(waveformBars[i].timeMs - previewPositionMs);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    }
    return bestIdx;
  }, [isPreviewPlaying, previewPositionMs, waveformBars]);

  if (!showAudioEditorModal) return null;

  const updateTrack = (trackId: string, updater: (t: AudioClipConfig) => void) => {
    commitProjectChange('Update Audio Track Settings', (draft) => {
      if (!draft.audioTracks) draft.audioTracks = [];
      const found = draft.audioTracks.find((item) => item.id === trackId);
      if (found) updater(found);
    });
  };

  const handleAddSynthTrack = (
    preset: 'ambient-pad' | 'corporate-chime' | 'upbeat-pulse' | 'lofi-drone'
  ) => {
    const newTrack: AudioClipConfig = {
      id: createId('audio-track'),
      name:
        preset === 'ambient-pad'
          ? 'Ambient Background Pad'
          : preset === 'corporate-chime'
            ? 'Transition Chime Cue'
            : preset === 'upbeat-pulse'
              ? 'Upbeat Promo Rhythm'
              : 'Lo-Fi Lounge Drone',
      assetId: `asset-synth-${preset}`,
      scope: 'scene',
      sceneIds: [activeSceneId],
      enabled: true,
      loop: preset !== 'corporate-chime',
      volume: 0.8,
      channel: 'stereo',
      startAtMs: 0,
      stopAtMs: 10000,
      trimStartMs: 0,
      trimEndMs: 10000,
      durationMs: 10000,
      fadeInMs: 600,
      fadeOutMs: 800,
      deletedRegions: [],
      synthPreset: preset,
    };

    commitProjectChange(`Add Audio Track (${newTrack.name})`, (draft) => {
      if (!draft.audioTracks) draft.audioTracks = [];
      draft.audioTracks.push(newTrack);
    });
    setSelectedTrackId(newTrack.id);
    notify('success', `Added audio track "${newTrack.name}".`);
  };

  const handleUploadAudioFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      const assetId = createId('asset-audio');
      importAssetItem({
        id: assetId,
        name: file.name,
        type: 'audio',
        mimeType: file.type || 'audio/mpeg',
        logicalPath: `assets/audio/${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`,
        dataUrl,
        byteSize: file.size,
        tags: ['audio', 'background-music'],
        folder: 'Audio',
      });

      const newTrack: AudioClipConfig = {
        id: createId('audio-track'),
        name: file.name.replace(/\.[^.]+$/, ''),
        assetId,
        scope: 'environment',
        sceneIds: project.scenes.map((s) => s.id),
        enabled: true,
        loop: true,
        volume: 0.85,
        channel: 'stereo',
        startAtMs: 0,
        stopAtMs: 0,
        trimStartMs: 0,
        trimEndMs: 12000,
        durationMs: 12000,
        fadeInMs: 800,
        fadeOutMs: 800,
        deletedRegions: [],
        synthPreset: 'uploaded',
      };

      commitProjectChange(`Import Audio Track ${newTrack.name}`, (draft) => {
        if (!draft.audioTracks) draft.audioTracks = [];
        draft.audioTracks.push(newTrack);
      });
      setSelectedTrackId(newTrack.id);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleCropToSelection = () => {
    if (!selectedTrack) return;
    if (!hasSelection) {
      notify('warning', 'Click and drag on the waveform to select an audio section first.');
      return;
    }
    const start = Math.min(selectionStartMs, selectionEndMs);
    const end = Math.max(selectionStartMs + 200, selectionEndMs);
    updateTrack(selectedTrack.id, (t) => {
      t.trimStartMs = start;
      t.trimEndMs = end;
    });
    notify(
      'success',
      `Cropped "${selectedTrack.name}" to segment ${formatDurationMs(start)} – ${formatDurationMs(end)}.`
    );
  };

  const handleDeleteSelectedSection = () => {
    if (!selectedTrack) return;
    if (!hasSelection) {
      notify('warning', 'Click and drag on the waveform to select an audio section first.');
      return;
    }
    const start = Math.min(selectionStartMs, selectionEndMs);
    const end = Math.max(selectionStartMs + 200, selectionEndMs);
    updateTrack(selectedTrack.id, (t) => {
      t.deletedRegions.push({
        id: createId('cut'),
        startMs: start,
        endMs: end,
      });
    });
    notify(
      'info',
      `Deleted audio section ${formatDurationMs(start)} – ${formatDurationMs(end)} from "${selectedTrack.name}".`
    );
  };

  const handleResetCropAndCuts = () => {
    if (!selectedTrack) return;
    updateTrack(selectedTrack.id, (t) => {
      t.trimStartMs = 0;
      t.trimEndMs = t.durationMs || 10000;
      t.deletedRegions = [];
    });
    notify('info', `Restored full duration and cleared deleted sections on "${selectedTrack.name}".`);
  };

  const handleCombineSelectedTracks = () => {
    const chosen = audioTracks.filter((t) => tracksToCombine.includes(t.id));
    const list = chosen.length >= 2 ? chosen : audioTracks.slice(0, 2);
    if (list.length < 2) {
      notify('warning', 'Add or select at least 2 audio tracks to combine.');
      return;
    }
    const combined = combineAudioTracks(list);
    commitProjectChange('Combine Audio Tracks into Mix', (draft) => {
      if (!draft.audioTracks) draft.audioTracks = [];
      draft.audioTracks.push(combined);
    });
    setSelectedTrackId(combined.id);
    setTracksToCombine([]);
    notify('success', `Combined ${list.length} tracks into "${combined.name}"!`);
  };

  const togglePlayPreview = () => {
    const el = audioElRef.current;
    if (isPreviewPlaying) {
      if (el) {
        try {
          el.pause();
          el.currentTime = 0;
        } catch {
          // ignore media element errors in headless environments
        }
      }
      setIsPreviewPlaying(false);
      setPreviewPositionMs(null);
    } else {
      const startPos = selectedTrack?.trimStartMs ?? 0;
      setIsPreviewPlaying(true);
      setPreviewPositionMs(startPos);
      if (el) {
        try {
          el.volume = selectedTrack?.volume ?? 0.8;
          el.loop = Boolean(selectedTrack?.loop);
          const playPromise = el.play();
          if (playPromise && typeof playPromise.catch === 'function') {
            playPromise.catch(() => {
              // Keep simulated playhead running even if browser blocks autoplay
            });
          }
        } catch {
          // Keep simulated playhead running in headless environments
        }
      }
    }
  };

  const handleWaveformMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!selectedTrack) return;
    const duration = Math.max(1000, selectedTrack.durationMs || 10000);
    const timeMs = Math.max(0, Math.min(duration, resolveWaveformTimeMs(e.clientX, e.target)));
    const selMin = Math.min(selectionStartMs, selectionEndMs);
    const selMax = Math.max(selectionStartMs, selectionEndMs);

    if (hasSelection && timeMs >= selMin && timeMs <= selMax) {
      // Clicked inside the existing selection:
      // Left half -> move start of selection; Right half -> move end of selection
      const selMid = (selMin + selMax) / 2;
      if (timeMs <= selMid) {
        const nextStart = Math.min(timeMs, selMax - 50);
        setSelectionStartMs(Math.max(0, nextStart));
        setSelectionEndMs(selMax);
        setWaveformDrag({
          mode: 'resize-start',
          anchorMs: timeMs,
          fixedStartMs: Math.max(0, nextStart),
          fixedEndMs: selMax,
          moved: false,
        });
      } else {
        const nextEnd = Math.max(timeMs, selMin + 50);
        setSelectionStartMs(selMin);
        setSelectionEndMs(Math.min(duration, nextEnd));
        setWaveformDrag({
          mode: 'resize-end',
          anchorMs: timeMs,
          fixedStartMs: selMin,
          fixedEndMs: Math.min(duration, nextEnd),
          moved: false,
        });
      }
    } else {
      // Clicked outside the current selection (or when nothing is selected):
      // Unselect immediately; if the user drags, a new selection range is swept out.
      setHasSelection(false);
      setWaveformDrag({
        mode: 'new',
        anchorMs: timeMs,
        fixedStartMs: timeMs,
        fixedEndMs: timeMs,
        moved: false,
      });
    }
  };

  return (
    <div
      className="inline-edit-backdrop"
      onClick={() => setShowAudioEditorModal(false)}
    >
      <div
        className="inline-edit-dialog audio-editor-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="audio-editor-header">
          <div className="inline-row">
            <Music size={18} color="#38bdf8" />
            <h4>Studio Audio Editor &amp; Background Music Mixer</h4>
          </div>
          <button
            className="icon-btn-sm"
            onClick={() => setShowAudioEditorModal(false)}
            aria-label="Close Audio Editor"
          >
            <X size={15} />
          </button>
        </div>

        <div className="audio-editor-grid">
          {/* LEFT COLUMN: TRACK LIST, UPLOAD & COMBINE */}
          <div className="audio-tracks-sidebar">
            <div className="palette-title">Project Audio Tracks ({audioTracks.length})</div>

            <div className="pkg-history-list">
              {audioTracks.map((t) => {
                const isChecked = tracksToCombine.includes(t.id);
                return (
                  <div
                    key={t.id}
                    className={`pkg-history-item ${
                      selectedTrack?.id === t.id ? 'active' : ''
                    }`}
                    onClick={() => setSelectedTrackId(t.id)}
                  >
                    <div className="inline-row" style={{ gap: '8px' }}>
                      <input
                        type="checkbox"
                        checked={isChecked}
                        title="Select track to combine"
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => {
                          setTracksToCombine((prev) =>
                            e.target.checked
                              ? [...prev, t.id]
                              : prev.filter((id) => id !== t.id)
                          );
                        }}
                      />
                      <div>
                        <strong>{t.name}</strong>
                        <div className="muted-line">
                          Scope: {t.scope.toUpperCase()} • Ch: {t.channel.toUpperCase()} • Vol:{' '}
                          {Math.round((t.volume ?? 0.8) * 100)}%
                        </div>
                      </div>
                    </div>
                    <span className="entry-pill">
                      {t.loop ? 'LOOP' : 'ONCE'}
                    </span>
                  </div>
                );
              })}
            </div>

            <div className="palette-title" style={{ marginTop: '12px' }}>
              Add or Upload Audio Track
            </div>
            <div className="palette-grid">
              <button
                className="btn-xs"
                onClick={() => handleAddSynthTrack('ambient-pad')}
              >
                <Plus size={12} /> Ambient Pad
              </button>
              <button
                className="btn-xs"
                onClick={() => handleAddSynthTrack('upbeat-pulse')}
              >
                <Plus size={12} /> Upbeat Pulse
              </button>
              <button
                className="btn-xs"
                onClick={() => handleAddSynthTrack('corporate-chime')}
              >
                <Plus size={12} /> Chime Cue
              </button>
              <label className="btn-xs" style={{ cursor: 'pointer' }}>
                <Upload size={12} /> Upload Audio
                <input
                  type="file"
                  accept="audio/*"
                  style={{ display: 'none' }}
                  onChange={handleUploadAudioFile}
                />
              </label>
            </div>

            <button
              className="btn-secondary full-width"
              style={{ marginTop: '10px' }}
              onClick={handleCombineSelectedTracks}
            >
              <Merge size={14} /> Combine Tracks into Single Mix
            </button>
          </div>

          {/* RIGHT COLUMN: WAVEFORM EDITOR, CROP, DELETE SECTION, START/STOP & EFFECTS */}
          {selectedTrack && (
            <div className="audio-inspector-main">
              {/* Top Track Header & Live Preview */}
              <div className="audio-track-top-bar">
                <input
                  type="text"
                  className="inspector-input"
                  style={{ maxWidth: '280px', fontWeight: 700 }}
                  value={selectedTrack.name}
                  aria-label="Audio Track Name"
                  onChange={(e) =>
                    updateTrack(selectedTrack.id, (t) => {
                      t.name = e.target.value;
                    })
                  }
                />

                <div className="inline-row">
                  <button
                    className="btn-primary"
                    onClick={togglePlayPreview}
                  >
                    {isPreviewPlaying ? <Square size={13} /> : <Play size={13} />}
                    {isPreviewPlaying ? 'Stop Preview' : 'Play Audio Preview'}
                  </button>
                  <audio
                    ref={audioElRef}
                    src={previewWavUrl}
                    onEnded={() => setIsPreviewPlaying(false)}
                    style={{ display: 'none' }}
                  />
                  <button
                    className="btn-xs danger-hover"
                    onClick={() => {
                      commitProjectChange('Delete Audio Track', (draft) => {
                        draft.audioTracks = (draft.audioTracks || []).filter(
                          (item) => item.id !== selectedTrack.id
                        );
                      });
                    }}
                  >
                    <Trash2 size={13} /> Delete Track
                  </button>
                </div>
              </div>

              {/* Interactive Waveform & Region Selection Visualizer */}
              <div className="audio-waveform-editor-box">
                <div className="waveform-legend-row">
                  <span>
                    <strong>Crop Window:</strong> {formatDurationMs(selectedTrack.trimStartMs)} –{' '}
                    {formatDurationMs(selectedTrack.trimEndMs || selectedTrack.durationMs)}
                  </span>
                  <span>
                    <strong>Selected Region:</strong>{' '}
                    {hasSelection
                      ? `${formatDurationMs(Math.min(selectionStartMs, selectionEndMs))} – ${formatDurationMs(Math.max(selectionStartMs, selectionEndMs))}`
                      : 'None (Click & drag to select)'}
                  </span>
                  {isPreviewPlaying && previewPositionMs !== null && (
                    <span style={{ color: '#ef4444', fontWeight: 700 }}>
                      ● Preview Position: {formatDurationMs(previewPositionMs)}
                    </span>
                  )}
                  <span>
                    <strong>Deleted Sections:</strong> {selectedTrack.deletedRegions.length}
                  </span>
                </div>

                <div
                  ref={waveformCanvasRef}
                  className="audio-waveform-canvas"
                  aria-label="Audio Waveform Selector"
                  title="Click and drag to select a section. Drag left side to move start, right side to move end. Click outside or double-click to unselect."
                  onMouseDown={handleWaveformMouseDown}
                  onDoubleClick={() => {
                    setHasSelection(false);
                    setWaveformDrag(null);
                  }}
                >
                  {waveformBars.map((bar, idx) => {
                    const selMin = Math.min(selectionStartMs, selectionEndMs);
                    const selMax = Math.max(selectionStartMs, selectionEndMs);
                    const inSelection =
                      hasSelection && bar.timeMs >= selMin && bar.timeMs <= selMax;
                    const isCurrentPlayhead = idx === activePlayheadBarIndex;

                    return (
                      <div
                        key={bar.index}
                        data-bar-index={idx}
                        data-bar-time-ms={bar.timeMs}
                        className={`audio-wf-bar ${bar.inCropRange ? 'in-crop' : 'out-crop'} ${
                          bar.isDeleted ? 'deleted-cut' : ''
                        } ${inSelection ? 'in-selection' : ''} ${
                          isCurrentPlayhead ? 'current-playhead-bar' : ''
                        }`}
                        style={{
                          height: `${Math.max(8, Math.round(bar.amplitude * 100))}%`,
                          backgroundColor: isCurrentPlayhead ? '#ef4444' : undefined,
                        }}
                        title={`${formatDurationMs(bar.timeMs)}${
                          isCurrentPlayhead ? ' (Current Preview Position)' : ''
                        }`}
                      />
                    );
                  })}
                </div>

                {/* Selection Range Sliders & Non-Destructive Edit Actions */}
                <div className="inspector-row-2col" style={{ marginTop: '8px' }}>
                  <div>
                    <label className="inspector-label">Selection Start (ms)</label>
                    <input
                      type="number"
                      className="inspector-input"
                      aria-label="Selection Start (ms)"
                      min={0}
                      max={selectedTrack.durationMs}
                      step={100}
                      value={hasSelection ? Math.min(selectionStartMs, selectionEndMs) : 0}
                      onChange={(e) => {
                        setHasSelection(true);
                        setSelectionStartMs(Number(e.target.value));
                      }}
                    />
                  </div>
                  <div>
                    <label className="inspector-label">Selection End (ms)</label>
                    <input
                      type="number"
                      className="inspector-input"
                      aria-label="Selection End (ms)"
                      min={0}
                      max={selectedTrack.durationMs}
                      step={100}
                      value={hasSelection ? Math.max(selectionStartMs, selectionEndMs) : 0}
                      onChange={(e) => {
                        setHasSelection(true);
                        setSelectionEndMs(Number(e.target.value));
                      }}
                    />
                  </div>
                </div>

                <div className="inline-row" style={{ marginTop: '8px', flexWrap: 'wrap' }}>
                  <button className="btn-xs primary-accent" onClick={handleCropToSelection}>
                    <Scissors size={12} /> Crop Audio to Selection
                  </button>
                  <button className="btn-xs" onClick={handleDeleteSelectedSection}>
                    <Trash2 size={12} /> Delete Selected Section
                  </button>
                  <button className="btn-xs" onClick={handleResetCropAndCuts}>
                    <RotateCcw size={12} /> Restore Full Clip &amp; Cuts
                  </button>
                </div>
              </div>

              {/* Scope: Environment Sound vs Single Scene vs Over Multiple Scenes */}
              <div className="inspector-row-2col" style={{ marginTop: '10px' }}>
                <div>
                  <label className="inspector-label">
                    Audio Playback Scope (Scene vs Multi-Scene vs Environment)
                  </label>
                  <select
                    className="inspector-input"
                    value={selectedTrack.scope}
                    aria-label="Audio Playback Scope"
                    onChange={(e) =>
                      updateTrack(selectedTrack.id, (t) => {
                        t.scope = e.target.value as AudioClipConfig['scope'];
                        if (t.scope === 'scene' && t.sceneIds.length === 0) {
                          t.sceneIds = [activeSceneId];
                        } else if (t.scope === 'environment') {
                          t.sceneIds = project.scenes.map((s) => s.id);
                        }
                      })
                    }
                  >
                    <option value="environment">
                      Continuous Environment Sound (Plays Across All Scenes)
                    </option>
                    <option value="scene">Tied to Single Scene Only</option>
                    <option value="multi-scene">Play Over Selected Scenes</option>
                  </select>
                </div>

                <div>
                  <label className="inspector-label">Looping &amp; Playback Mode</label>
                  <div className="inline-row" style={{ marginTop: '6px' }}>
                    <label className="inline-check">
                      <input
                        type="checkbox"
                        checked={selectedTrack.loop}
                        onChange={(e) =>
                          updateTrack(selectedTrack.id, (t) => {
                            t.loop = e.target.checked;
                          })
                        }
                      />
                      Loop Audio Continuously
                    </label>
                    <label className="inline-check">
                      <input
                        type="checkbox"
                        checked={selectedTrack.enabled}
                        onChange={(e) =>
                          updateTrack(selectedTrack.id, (t) => {
                            t.enabled = e.target.checked;
                          })
                        }
                      />
                      Track Enabled
                    </label>
                  </div>
                </div>
              </div>

              {/* Scene Binding Checkboxes when scope is scene or multi-scene */}
              {selectedTrack.scope !== 'environment' && (
                <div style={{ marginTop: '8px' }}>
                  <label className="inspector-label">Assigned Scenes</label>
                  <div className="inline-row" style={{ flexWrap: 'wrap' }}>
                    {project.scenes.map((sc) => {
                      const active = selectedTrack.sceneIds.includes(sc.id);
                      return (
                        <label key={sc.id} className="inline-check">
                          <input
                            type="checkbox"
                            checked={active}
                            onChange={(e) =>
                              updateTrack(selectedTrack.id, (t) => {
                                if (t.scope === 'scene') {
                                  t.sceneIds = [sc.id];
                                } else {
                                  t.sceneIds = e.target.checked
                                    ? [...t.sceneIds, sc.id]
                                    : t.sceneIds.filter((id) => id !== sc.id);
                                }
                              })
                            }
                          />
                          {sc.name}
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Start / Stop at Specific Time (ms) or Frame */}
              <div className="inspector-row-4col" style={{ marginTop: '10px' }}>
                <div>
                  <label className="inspector-label">Start Time (ms)</label>
                  <input
                    type="number"
                    className="inspector-input"
                    min={0}
                    step={100}
                    value={selectedTrack.startAtMs}
                    onChange={(e) =>
                      updateTrack(selectedTrack.id, (t) => {
                        t.startAtMs = Math.max(0, Number(e.target.value));
                      })
                    }
                  />
                </div>
                <div>
                  <label className="inspector-label">Start Frame (@{fps}fps)</label>
                  <input
                    type="number"
                    className="inspector-input"
                    min={0}
                    value={Math.round((selectedTrack.startAtMs / 1000) * fps)}
                    onChange={(e) =>
                      updateTrack(selectedTrack.id, (t) => {
                        t.startAtMs = Math.round((Math.max(0, Number(e.target.value)) / fps) * 1000);
                      })
                    }
                  />
                </div>
                <div>
                  <label className="inspector-label">Stop Time (ms, 0=End)</label>
                  <input
                    type="number"
                    className="inspector-input"
                    min={0}
                    step={100}
                    value={selectedTrack.stopAtMs}
                    onChange={(e) =>
                      updateTrack(selectedTrack.id, (t) => {
                        t.stopAtMs = Math.max(0, Number(e.target.value));
                      })
                    }
                  />
                </div>
                <div>
                  <label className="inspector-label">Stop Frame (@{fps}fps)</label>
                  <input
                    type="number"
                    className="inspector-input"
                    min={0}
                    value={Math.round((selectedTrack.stopAtMs / 1000) * fps)}
                    onChange={(e) =>
                      updateTrack(selectedTrack.id, (t) => {
                        t.stopAtMs = Math.round((Math.max(0, Number(e.target.value)) / fps) * 1000);
                      })
                    }
                  />
                </div>
              </div>

              {/* Audio Effects: Volume, Channel, Fade-In, Fade-Out */}
              <div className="inspector-row-4col" style={{ marginTop: '10px' }}>
                <div>
                  <label className="inspector-label">
                    <Volume2 size={11} /> Volume ({Math.round((selectedTrack.volume ?? 0.8) * 100)}%)
                  </label>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={selectedTrack.volume ?? 0.8}
                    onChange={(e) =>
                      updateTrack(selectedTrack.id, (t) => {
                        t.volume = Number(e.target.value);
                      })
                    }
                  />
                </div>
                <div>
                  <label className="inspector-label">Output Channel</label>
                  <select
                    className="inspector-input"
                    value={selectedTrack.channel}
                    aria-label="Audio Output Channel"
                    onChange={(e) =>
                      updateTrack(selectedTrack.id, (t) => {
                        t.channel = e.target.value as AudioClipConfig['channel'];
                      })
                    }
                  >
                    <option value="stereo">Stereo (L + R)</option>
                    <option value="left">Left Channel Only</option>
                    <option value="right">Right Channel Only</option>
                    <option value="mono">Mono Mixdown</option>
                  </select>
                </div>
                <div>
                  <label className="inspector-label">Fade-In (ms)</label>
                  <input
                    type="number"
                    className="inspector-input"
                    min={0}
                    step={100}
                    value={selectedTrack.fadeInMs}
                    onChange={(e) =>
                      updateTrack(selectedTrack.id, (t) => {
                        t.fadeInMs = Math.max(0, Number(e.target.value));
                      })
                    }
                  />
                </div>
                <div>
                  <label className="inspector-label">Fade-Out (ms)</label>
                  <input
                    type="number"
                    className="inspector-input"
                    min={0}
                    step={100}
                    value={selectedTrack.fadeOutMs}
                    onChange={(e) =>
                      updateTrack(selectedTrack.id, (t) => {
                        t.fadeOutMs = Math.max(0, Number(e.target.value));
                      })
                    }
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="dialog-footer" style={{ marginTop: '12px' }}>
          <span className="muted-line">
            <CheckCircle2 size={12} color="#10b981" /> Audio tracks are packaged inside the{' '}
            <code>.signage</code> archive and synchronized with the scene &amp; environment timeline.
          </span>
          <button
            className="btn-primary"
            onClick={() => setShowAudioEditorModal(false)}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
