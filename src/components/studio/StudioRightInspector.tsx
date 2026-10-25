// ============================================================================
// src/components/studio/StudioRightInspector.tsx — Contextual Property,
// Typography, Media, Widget, Animation & Restricted Script Sandbox Inspector
// ============================================================================

import React, { useState } from 'react';
import {
  Sliders,
  Sparkles,
  Code2,
  Play,
  Plus,
  Trash2,
  ShieldAlert,
  CheckCircle2,
} from 'lucide-react';
import { useStudioStore } from '@/store/useStudioStore';
import {
  AnimatableProperty,
  AnimationPresetName,
  EasingFunction,
  TransitionType,
} from '@packages/project-model';
import {
  RestrictedScriptRuntime,
  ScriptExecutionDiagnostics,
  applyScriptMessagesToElements,
} from '@packages/script-runtime';
import { createId } from '@packages/shared';

type InspectorTab = 'properties' | 'animation' | 'scene-scripts';

const ANIMATION_PRESETS: Array<{ id: AnimationPresetName; label: string }> = [
  { id: 'none', label: 'None' },
  { id: 'fade-in', label: 'Fade In' },
  { id: 'fade-out', label: 'Fade Out' },
  { id: 'slide-left', label: 'Slide Left' },
  { id: 'slide-right', label: 'Slide Right' },
  { id: 'slide-up', label: 'Slide Up' },
  { id: 'slide-down', label: 'Slide Down' },
  { id: 'zoom-in', label: 'Zoom In' },
  { id: 'zoom-out', label: 'Zoom Out' },
  { id: 'bounce', label: 'Bounce' },
  { id: 'rotate', label: 'Rotate 180°' },
  { id: 'flip', label: 'Horizontal Flip' },
  { id: 'typewriter', label: 'Typewriter Reveal' },
  { id: 'wipe', label: 'Wipe Reveal' },
  { id: 'ken-burns', label: 'Ken Burns Drift' },
];

export const StudioRightInspector: React.FC = () => {
  const [activeTab, setActiveTab] = useState<InspectorTab>('properties');
  const [newTrackProp, setNewTrackProp] = useState<AnimatableProperty>('opacity');
  const [scriptTestResult, setScriptTestResult] = useState<ScriptExecutionDiagnostics | null>(
    null
  );

  const {
    project,
    activeSceneId,
    selectedElementIds,
    updateElement,
    updateScene,
    applyAnimationPreset,
    deleteTrack,
    commitProjectChange,
    timelineTimeMs,
  } = useStudioStore();

  const activeScene =
    project.scenes.find((s) => s.id === activeSceneId) ?? project.scenes[0];

  const selectedElement =
    activeScene && selectedElementIds.length > 0
      ? activeScene.elements.find((e) => e.id === selectedElementIds[0]) ?? null
      : null;

  const elementTracks =
    activeScene && selectedElement
      ? activeScene.animationTracks.filter((t) => t.elementId === selectedElement.id)
      : [];

  const handleAddCustomTrack = () => {
    if (!selectedElement || !activeScene) return;
    commitProjectChange(`Add ${newTrackProp} Track`, (draft) => {
      const s = draft.scenes.find((sc) => sc.id === activeScene.id);
      if (!s) return;
      const startVal =
        newTrackProp === 'opacity'
          ? 0
          : newTrackProp === 'x'
            ? selectedElement.x - 100
            : newTrackProp === 'y'
              ? selectedElement.y + 80
              : newTrackProp === 'rotation'
                ? -45
                : 0.5;
      const endVal =
        newTrackProp === 'opacity'
          ? 1
          : newTrackProp === 'x'
            ? selectedElement.x
            : newTrackProp === 'y'
              ? selectedElement.y
              : newTrackProp === 'rotation'
                ? 0
                : 1;

      s.animationTracks.push({
        id: createId('track'),
        elementId: selectedElement.id,
        property: newTrackProp,
        durationMs: 1200,
        delayMs: 0,
        repeatCount: 1,
        reverse: false,
        fillMode: 'both',
        keyframes: [
          { id: createId('kf'), timeMs: 0, value: startVal, easing: 'easeOut' },
          { id: createId('kf'), timeMs: 1200, value: endVal, easing: 'easeOut' },
        ],
      });
    });
  };

  const handleRunSandboxScriptTest = () => {
    if (!activeScene) return;
    const script = project.scripts[0];
    if (!script) return;
    const runtime = new RestrictedScriptRuntime(project.permissions, script.permissions);
    runtime.invokeHook(script, 'initialize', { elapsedMs: 0 });
    const enterRes = runtime.invokeHook(script, 'onSceneEnter', { elapsedMs: 0 });
    const tickRes = runtime.invokeHook(script, 'onTick', { elapsedMs: Math.max(4500, timelineTimeMs) });
    const combinedMessages = [...enterRes.emittedMessages, ...tickRes.emittedMessages];

    commitProjectChange('Apply Sandbox Script Output', (draft) => {
      const s = draft.scenes.find((sc) => sc.id === activeScene.id);
      if (s) {
        s.elements = applyScriptMessagesToElements(s.elements, combinedMessages);
      }
    });

    setScriptTestResult({
      scriptId: script.id,
      operationsExecuted: enterRes.operationsExecuted + tickRes.operationsExecuted,
      deniedActions: [...enterRes.deniedActions, ...tickRes.deniedActions],
      emittedMessages: combinedMessages,
      activeTimerCount: runtime.getActiveTimerCount(),
      errors: [...enterRes.errors, ...tickRes.errors],
    });
    runtime.cleanupSceneResources();
  };

  return (
    <aside className="studio-right-inspector">
      <div className="sidebar-tabs">
        <button
          className={`sidebar-tab ${activeTab === 'properties' ? 'active' : ''}`}
          onClick={() => setActiveTab('properties')}
        >
          <Sliders size={14} /> Inspector
        </button>
        <button
          className={`sidebar-tab ${activeTab === 'animation' ? 'active' : ''}`}
          onClick={() => setActiveTab('animation')}
        >
          <Sparkles size={14} /> Motion ({elementTracks.length})
        </button>
        <button
          className={`sidebar-tab ${activeTab === 'scene-scripts' ? 'active' : ''}`}
          onClick={() => setActiveTab('scene-scripts')}
        >
          <Code2 size={14} /> Scene & Scripts
        </button>
      </div>

      <div className="sidebar-body">
        {/* TAB 1: ELEMENT PROPERTIES */}
        {activeTab === 'properties' && (
          <>
            {!selectedElement ? (
              <div className="empty-inspector-state">
                <p>Select any layer on the canvas or in the Layers tab to edit its properties.</p>
                {activeScene && (
                  <div className="inspector-section">
                    <div className="palette-title">Active Scene Quick Settings</div>
                    <label className="inspector-label">Scene Name</label>
                    <input
                      type="text"
                      className="inspector-input"
                      value={activeScene.name}
                      onChange={(e) => updateScene(activeScene.id, { name: e.target.value })}
                    />
                    <label className="inspector-label">Duration (ms)</label>
                    <input
                      type="number"
                      className="inspector-input"
                      value={activeScene.durationMs}
                      step={500}
                      onChange={(e) =>
                        updateScene(activeScene.id, {
                          durationMs: Math.max(1000, Number(e.target.value)),
                        })
                      }
                    />
                    <label className="inspector-label">Background Color</label>
                    <input
                      type="color"
                      className="inspector-color"
                      value={activeScene.backgroundColor || '#090d16'}
                      onChange={(e) =>
                        updateScene(activeScene.id, {
                          backgroundColor: e.target.value,
                          backgroundGradient: undefined,
                        })
                      }
                    />
                  </div>
                )}
              </div>
            ) : (
              <div className="inspector-form">
                <div className="inspector-section">
                  <div className="palette-title">Layer Identity & Transform</div>
                  <label className="inspector-label">Layer Name</label>
                  <input
                    type="text"
                    className="inspector-input"
                    value={selectedElement.name}
                    onChange={(e) =>
                      updateElement(selectedElement.id, { name: e.target.value })
                    }
                  />

                  <div className="inspector-grid-2">
                    <div>
                      <label className="inspector-label">X (px)</label>
                      <input
                        type="number"
                        className="inspector-input"
                        value={Math.round(selectedElement.x)}
                        onChange={(e) =>
                          updateElement(selectedElement.id, { x: Number(e.target.value) })
                        }
                      />
                    </div>
                    <div>
                      <label className="inspector-label">Y (px)</label>
                      <input
                        type="number"
                        className="inspector-input"
                        value={Math.round(selectedElement.y)}
                        onChange={(e) =>
                          updateElement(selectedElement.id, { y: Number(e.target.value) })
                        }
                      />
                    </div>
                    <div>
                      <label className="inspector-label">Width (px)</label>
                      <input
                        type="number"
                        className="inspector-input"
                        value={Math.round(selectedElement.width)}
                        onChange={(e) =>
                          updateElement(selectedElement.id, {
                            width: Math.max(10, Number(e.target.value)),
                          })
                        }
                      />
                    </div>
                    <div>
                      <label className="inspector-label">Height (px)</label>
                      <input
                        type="number"
                        className="inspector-input"
                        value={Math.round(selectedElement.height)}
                        onChange={(e) =>
                          updateElement(selectedElement.id, {
                            height: Math.max(10, Number(e.target.value)),
                          })
                        }
                      />
                    </div>
                    <div>
                      <label className="inspector-label">Rotation (°)</label>
                      <input
                        type="number"
                        className="inspector-input"
                        value={Math.round(selectedElement.rotation)}
                        onChange={(e) =>
                          updateElement(selectedElement.id, { rotation: Number(e.target.value) })
                        }
                      />
                    </div>
                    <div>
                      <label className="inspector-label">
                        Opacity ({Math.round(selectedElement.opacity * 100)}%)
                      </label>
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.05}
                        value={selectedElement.opacity}
                        onChange={(e) =>
                          updateElement(selectedElement.id, { opacity: Number(e.target.value) })
                        }
                      />
                    </div>
                  </div>
                </div>

                {/* TEXT SPECIFIC CONTROLS */}
                {selectedElement.type === 'text' && selectedElement.textProps && (
                  <div className="inspector-section">
                    <div className="palette-title">Typography & Rich Text</div>
                    <label className="inspector-label">Content (supports {'{{time}}'}, {'{{date}}'})</label>
                    <textarea
                      className="inspector-textarea"
                      rows={3}
                      value={selectedElement.textProps.text}
                      onChange={(e) =>
                        updateElement(selectedElement.id, {
                          textProps: { ...selectedElement.textProps!, text: e.target.value },
                        })
                      }
                    />
                    <div className="inspector-grid-2">
                      <div>
                        <label className="inspector-label">Font Size (px)</label>
                        <input
                          type="number"
                          className="inspector-input"
                          value={selectedElement.textProps.fontSize}
                          onChange={(e) =>
                            updateElement(selectedElement.id, {
                              textProps: {
                                ...selectedElement.textProps!,
                                fontSize: Math.max(8, Number(e.target.value)),
                              },
                            })
                          }
                        />
                      </div>
                      <div>
                        <label className="inspector-label">Text Color</label>
                        <input
                          type="color"
                          className="inspector-color"
                          value={selectedElement.textProps.color || '#ffffff'}
                          onChange={(e) =>
                            updateElement(selectedElement.id, {
                              textProps: {
                                ...selectedElement.textProps!,
                                color: e.target.value,
                              },
                            })
                          }
                        />
                      </div>
                      <div>
                        <label className="inspector-label">Alignment</label>
                        <select
                          className="inspector-input"
                          value={selectedElement.textProps.textAlign}
                          onChange={(e) =>
                            updateElement(selectedElement.id, {
                              textProps: {
                                ...selectedElement.textProps!,
                                textAlign: e.target.value as 'left' | 'center' | 'right',
                              },
                            })
                          }
                        >
                          <option value="left">Left</option>
                          <option value="center">Center</option>
                          <option value="right">Right</option>
                        </select>
                      </div>
                      <div>
                        <label className="inspector-label">Direction (LTR / RTL)</label>
                        <select
                          className="inspector-input"
                          value={selectedElement.textProps.direction}
                          onChange={(e) =>
                            updateElement(selectedElement.id, {
                              textProps: {
                                ...selectedElement.textProps!,
                                direction: e.target.value as 'ltr' | 'rtl',
                              },
                            })
                          }
                        >
                          <option value="ltr">LTR (Left-to-Right)</option>
                          <option value="rtl">RTL (Right-to-Left)</option>
                        </select>
                      </div>
                    </div>
                  </div>
                )}

                {/* SHAPE SPECIFIC CONTROLS */}
                {selectedElement.type === 'shape' && selectedElement.shapeProps && (
                  <div className="inspector-section">
                    <div className="palette-title">Vector Shape Styling</div>
                    <div className="inspector-grid-2">
                      <div>
                        <label className="inspector-label">Fill Color</label>
                        <input
                          type="color"
                          className="inspector-color"
                          value={selectedElement.shapeProps.fillColor || '#0284c7'}
                          onChange={(e) =>
                            updateElement(selectedElement.id, {
                              shapeProps: {
                                ...selectedElement.shapeProps!,
                                fillColor: e.target.value,
                              },
                            })
                          }
                        />
                      </div>
                      <div>
                        <label className="inspector-label">Stroke Color</label>
                        <input
                          type="color"
                          className="inspector-color"
                          value={selectedElement.shapeProps.strokeColor || '#38bdf8'}
                          onChange={(e) =>
                            updateElement(selectedElement.id, {
                              shapeProps: {
                                ...selectedElement.shapeProps!,
                                strokeColor: e.target.value,
                              },
                            })
                          }
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* IMAGE / MEDIA SPECIFIC CONTROLS */}
                {(selectedElement.type === 'image' || selectedElement.type === 'video') &&
                  selectedElement.mediaProps && (
                    <div className="inspector-section">
                      <div className="palette-title">Media Source & Fit</div>
                      <label className="inspector-label">Linked Asset</label>
                      <select
                        className="inspector-input"
                        value={selectedElement.mediaProps.assetId}
                        onChange={(e) =>
                          updateElement(selectedElement.id, {
                            mediaProps: {
                              ...selectedElement.mediaProps!,
                              assetId: e.target.value,
                            },
                          })
                        }
                      >
                        {project.assets.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name}
                          </option>
                        ))}
                      </select>

                      <label className="inspector-label">Scaling / Object Fit</label>
                      <select
                        className="inspector-input"
                        value={selectedElement.mediaProps.objectFit}
                        onChange={(e) =>
                          updateElement(selectedElement.id, {
                            mediaProps: {
                              ...selectedElement.mediaProps!,
                              objectFit: e.target.value as 'contain' | 'cover' | 'fill',
                            },
                          })
                        }
                      >
                        <option value="cover">Cover (Crop to Fill)</option>
                        <option value="contain">Contain (Letterbox)</option>
                        <option value="fill">Stretch</option>
                      </select>
                    </div>
                  )}

                {/* WIDGET SPECIFIC CONTROLS */}
                {selectedElement.type === 'widget' && selectedElement.widgetProps && (
                  <div className="inspector-section">
                    <div className="palette-title">
                      Widget Settings ({selectedElement.widgetProps.widgetKind.toUpperCase()})
                    </div>
                    <label className="inspector-label">Accent Color</label>
                    <input
                      type="color"
                      className="inspector-color"
                      value={selectedElement.widgetProps.accentColor || '#38bdf8'}
                      onChange={(e) =>
                        updateElement(selectedElement.id, {
                          widgetProps: {
                            ...selectedElement.widgetProps!,
                            accentColor: e.target.value,
                          },
                        })
                      }
                    />
                    {selectedElement.widgetProps.widgetKind === 'qrcode' && (
                      <>
                        <label className="inspector-label">QR Code URL / Payload</label>
                        <input
                          type="text"
                          className="inspector-input"
                          value={selectedElement.widgetProps.qrPayload || ''}
                          onChange={(e) =>
                            updateElement(selectedElement.id, {
                              widgetProps: {
                                ...selectedElement.widgetProps!,
                                qrPayload: e.target.value,
                              },
                            })
                          }
                        />
                      </>
                    )}
                    {selectedElement.widgetProps.widgetKind === 'weather' && (
                      <div className="inspector-grid-2">
                        <div>
                          <label className="inspector-label">Location</label>
                          <input
                            type="text"
                            className="inspector-input"
                            value={selectedElement.widgetProps.weatherLocation || ''}
                            onChange={(e) =>
                              updateElement(selectedElement.id, {
                                widgetProps: {
                                  ...selectedElement.widgetProps!,
                                  weatherLocation: e.target.value,
                                },
                              })
                            }
                          />
                        </div>
                        <div>
                          <label className="inspector-label">Temp (°C)</label>
                          <input
                            type="number"
                            className="inspector-input"
                            value={selectedElement.widgetProps.weatherTempC ?? 19}
                            onChange={(e) =>
                              updateElement(selectedElement.id, {
                                widgetProps: {
                                  ...selectedElement.widgetProps!,
                                  weatherTempC: Number(e.target.value),
                                },
                              })
                            }
                          />
                        </div>
                      </div>
                    )}
                    {selectedElement.widgetProps.widgetKind === 'ticker' && (
                      <>
                        <label className="inspector-label">Ticker Messages (one per line)</label>
                        <textarea
                          className="inspector-textarea"
                          rows={3}
                          value={(selectedElement.widgetProps.tickerItems || []).join('\n')}
                          onChange={(e) =>
                            updateElement(selectedElement.id, {
                              widgetProps: {
                                ...selectedElement.widgetProps!,
                                tickerItems: e.target.value.split('\n').filter(Boolean),
                              },
                            })
                          }
                        />
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* TAB 2: ANIMATION & KEYFRAMES */}
        {activeTab === 'animation' && (
          <div className="inspector-form">
            {!selectedElement ? (
              <div className="empty-inspector-state">
                Select a layer on the canvas to configure motion presets and keyframe tracks.
              </div>
            ) : (
              <>
                <div className="inspector-section">
                  <div className="palette-title">Built-in Motion Presets</div>
                  <div className="preset-pill-grid">
                    {ANIMATION_PRESETS.map((p) => (
                      <button
                        key={p.id}
                        className="preset-pill"
                        onClick={() => applyAnimationPreset(selectedElement.id, p.id, 1000)}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="inspector-section">
                  <div className="palette-title">Add Custom Keyframe Track</div>
                  <div className="inline-row">
                    <select
                      className="inspector-input"
                      value={newTrackProp}
                      onChange={(e) => setNewTrackProp(e.target.value as AnimatableProperty)}
                    >
                      <option value="opacity">Opacity</option>
                      <option value="x">Position X</option>
                      <option value="y">Position Y</option>
                      <option value="scaleX">Scale X</option>
                      <option value="scaleY">Scale Y</option>
                      <option value="rotation">Rotation</option>
                      <option value="textReveal">Typewriter Reveal</option>
                      <option value="cropProgress">Wipe / Crop Progress</option>
                    </select>
                    <button className="btn-xs" onClick={handleAddCustomTrack}>
                      <Plus size={12} /> Add Track
                    </button>
                  </div>
                </div>

                <div className="inspector-section">
                  <div className="palette-title">Active Tracks ({elementTracks.length})</div>
                  {elementTracks.map((track) => (
                    <div key={track.id} className="track-inspector-card">
                      <div className="track-inspector-header">
                        <strong>{track.property.toUpperCase()}</strong>
                        <button
                          className="icon-btn-sm danger-hover"
                          onClick={() => deleteTrack(track.id)}
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                      <div className="inspector-grid-2">
                        <div>
                          <label className="inspector-label">Duration (ms)</label>
                          <input
                            type="number"
                            className="inspector-input"
                            value={track.durationMs}
                            step={100}
                            onChange={(e) =>
                              commitProjectChange('Update Track Duration', (draft) => {
                                const sc = draft.scenes.find((s) => s.id === activeScene?.id);
                                const tr = sc?.animationTracks.find((t) => t.id === track.id);
                                if (tr) {
                                  tr.durationMs = Math.max(100, Number(e.target.value));
                                  if (tr.keyframes[1]) tr.keyframes[1].timeMs = tr.durationMs;
                                }
                              })
                            }
                          />
                        </div>
                        <div>
                          <label className="inspector-label">Easing</label>
                          <select
                            className="inspector-input"
                            value={track.keyframes[1]?.easing || 'easeOut'}
                            onChange={(e) =>
                              commitProjectChange('Update Track Easing', (draft) => {
                                const sc = draft.scenes.find((s) => s.id === activeScene?.id);
                                const tr = sc?.animationTracks.find((t) => t.id === track.id);
                                if (tr) {
                                  tr.keyframes.forEach(
                                    (k) => (k.easing = e.target.value as EasingFunction)
                                  );
                                }
                              })
                            }
                          >
                            <option value="linear">Linear</option>
                            <option value="easeIn">Ease In</option>
                            <option value="easeOut">Ease Out</option>
                            <option value="easeInOut">Ease In-Out</option>
                            <option value="bounce">Bounce</option>
                            <option value="elastic">Elastic</option>
                            <option value="step">Step</option>
                          </select>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* TAB 3: SCENE TRANSITIONS & RESTRICTED SCRIPTS */}
        {activeTab === 'scene-scripts' && activeScene && (
          <div className="inspector-form">
            <div className="inspector-section">
              <div className="palette-title">Scene Transitions</div>
              <div className="inspector-grid-2">
                <div>
                  <label className="inspector-label">Entry Transition</label>
                  <select
                    className="inspector-input"
                    value={activeScene.entryTransition.type}
                    onChange={(e) =>
                      updateScene(activeScene.id, {
                        entryTransition: {
                          ...activeScene.entryTransition,
                          type: e.target.value as TransitionType,
                        },
                      })
                    }
                  >
                    <option value="none">None</option>
                    <option value="fade">Crossfade</option>
                    <option value="slide-left">Slide Left</option>
                    <option value="slide-right">Slide Right</option>
                    <option value="slide-up">Slide Up</option>
                    <option value="zoom">Zoom</option>
                    <option value="wipe">Wipe</option>
                  </select>
                </div>
                <div>
                  <label className="inspector-label">Exit Transition</label>
                  <select
                    className="inspector-input"
                    value={activeScene.exitTransition.type}
                    onChange={(e) =>
                      updateScene(activeScene.id, {
                        exitTransition: {
                          ...activeScene.exitTransition,
                          type: e.target.value as TransitionType,
                        },
                      })
                    }
                  >
                    <option value="none">None</option>
                    <option value="fade">Crossfade</option>
                    <option value="slide-left">Slide Left</option>
                    <option value="slide-right">Slide Right</option>
                    <option value="zoom">Zoom</option>
                    <option value="wipe">Wipe</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="inspector-section">
              <div className="palette-title">Restricted Script Sandbox (Spec Section 11)</div>
              {project.scripts.map((script) => (
                <div key={script.id} className="script-card">
                  <div className="script-card-title">
                    <ShieldAlert size={14} color="#38bdf8" />
                    <strong>{script.name}</strong>
                  </div>
                  <p className="muted-line">{script.description}</p>
                  <div className="permission-badges">
                    {script.permissions.map((perm) => (
                      <span key={perm} className="perm-badge">
                        {perm}
                      </span>
                    ))}
                  </div>
                  <button
                    className="btn-secondary full-width"
                    style={{ marginTop: '8px' }}
                    onClick={handleRunSandboxScriptTest}
                  >
                    <Play size={13} /> Execute in Restricted Sandbox
                  </button>
                </div>
              ))}

              {scriptTestResult && (
                <div className="sandbox-result-box">
                  <div className="sandbox-result-header">
                    <CheckCircle2 size={14} color="#10b981" />
                    <span>
                      Sandbox Executed ({scriptTestResult.operationsExecuted} ops,{' '}
                      {scriptTestResult.activeTimerCount} leaked timers)
                    </span>
                  </div>
                  {scriptTestResult.emittedMessages.map((m, i) => (
                    <div key={i} className="sandbox-msg-row">
                      <code>{m.actionType}</code> → {m.elementId || m.message}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
};
