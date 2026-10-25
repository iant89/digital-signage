// ============================================================================
// src/components/studio/StudioAudioEditorModal.tsx
// Built-In Simple Audio Editor & Background Music / Scene Audio Studio
// Supports Scene / Multi-Scene / Continuous Environment Music, Looping,
// Cropping, Start/Stop by Time or Frame, Fade-In/Out, Volume, Stereo Channel
// Routing, Deleting Selected Sections & Combining Tracks
// ============================================================================

import React, { useMemo, useRef, useState } from 'react';
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
  const [tracksToCombine, setTracksToCombine] = useState<string[]>([]);
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);
  const audioElRef = useRef<HTMLAudioElement | null>(null);

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
    if (!el) return;
    if (isPreviewPlaying) {
      el.pause();
      el.currentTime = 0;
      setIsPreviewPlaying(false);
    } else {
      el.volume = selectedTrack?.volume ?? 0.8;
      el.loop = Boolean(selectedTrack?.loop);
      el.play()
        .then(() => setIsPreviewPlaying(true))
        .catch(() => setIsPreviewPlaying(false));
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
                    <strong>Selected Region:</strong> {formatDurationMs(selectionStartMs)} –{' '}
                    {formatDurationMs(selectionEndMs)}
                  </span>
                  <span>
                    <strong>Deleted Sections:</strong> {selectedTrack.deletedRegions.length}
                  </span>
                </div>

                <div className="audio-waveform-canvas">
                  {waveformBars.map((bar) => {
                    const inSelection =
                      bar.timeMs >= Math.min(selectionStartMs, selectionEndMs) &&
                      bar.timeMs <= Math.max(selectionStartMs, selectionEndMs);
                    return (
                      <div
                        key={bar.index}
                        className={`audio-wf-bar ${bar.inCropRange ? 'in-crop' : 'out-crop'} ${
                          bar.isDeleted ? 'deleted-cut' : ''
                        } ${inSelection ? 'in-selection' : ''}`}
                        style={{ height: `${Math.max(8, Math.round(bar.amplitude * 100))}%` }}
                        title={`${formatDurationMs(bar.timeMs)}`}
                        onClick={() => {
                          if (bar.timeMs < selectionEndMs) {
                            setSelectionStartMs(bar.timeMs);
                          } else {
                            setSelectionEndMs(bar.timeMs);
                          }
                        }}
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
                      min={0}
                      max={selectedTrack.durationMs}
                      step={100}
                      value={selectionStartMs}
                      onChange={(e) => setSelectionStartMs(Number(e.target.value))}
                    />
                  </div>
                  <div>
                    <label className="inspector-label">Selection End (ms)</label>
                    <input
                      type="number"
                      className="inspector-input"
                      min={0}
                      max={selectedTrack.durationMs}
                      step={100}
                      value={selectionEndMs}
                      onChange={(e) => setSelectionEndMs(Number(e.target.value))}
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
