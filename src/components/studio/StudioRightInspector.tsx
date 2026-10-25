// ============================================================================
// src/components/studio/StudioRightInspector.tsx — Contextual Property,
// Typography, Media, Widget, Animation & Restricted Script Sandbox Inspector
// ============================================================================

import React, { useEffect, useState } from 'react';
import {
  Sliders,
  Sparkles,
  Code2,
  Play,
  Plus,
  Trash2,
  ShieldAlert,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  GripVertical,
  Music,
  Copy,
  Clock,
} from 'lucide-react';
import { useStudioStore } from '@/store/useStudioStore';
import {
  AnimatableProperty,
  AnimationPresetName,
  EasingFunction,
  QrContentType,
  QrDotStyle,
  QrErrorCorrectionLevel,
  TransitionType,
  WidgetKind,
} from '@packages/project-model';
import { QR_CONTENT_TYPES, formatQrWidgetPayload } from '@/utils/qrCodeGenerator';
import {
  RestrictedScriptRuntime,
  ScriptExecutionDiagnostics,
  applyScriptMessagesToElements,
} from '@packages/script-runtime';
import { createId } from '@packages/shared';

type InspectorTab = 'properties' | 'animation' | 'scene-scripts';

const ANIMATION_PRESETS: Array<{
  id: AnimationPresetName;
  label: string;
  category: 'entrance' | 'rotation' | 'emphasis' | 'continuous';
}> = [
  { id: 'none', label: 'Clear All', category: 'entrance' },
  { id: 'fade-in', label: 'Fade In', category: 'entrance' },
  { id: 'fade-out', label: 'Fade Out', category: 'entrance' },
  { id: 'slide-left', label: 'Slide Left', category: 'entrance' },
  { id: 'slide-right', label: 'Slide Right', category: 'entrance' },
  { id: 'slide-up', label: 'Slide Up', category: 'entrance' },
  { id: 'slide-down', label: 'Slide Down', category: 'entrance' },
  { id: 'zoom-in', label: 'Zoom In', category: 'entrance' },
  { id: 'zoom-out', label: 'Zoom Out', category: 'entrance' },
  { id: 'drop-in', label: 'Gravity Drop-In', category: 'entrance' },
  { id: 'skew-slide', label: 'Skew Slide', category: 'entrance' },
  { id: 'typewriter', label: 'Typewriter Reveal', category: 'entrance' },
  { id: 'wipe', label: 'Wipe Reveal', category: 'entrance' },
  { id: 'rotate', label: 'Rotate Angle', category: 'rotation' },
  { id: 'spin-cw', label: 'Spin Clockwise', category: 'rotation' },
  { id: 'spin-ccw', label: 'Spin Counter-CW', category: 'rotation' },
  { id: 'swing', label: 'Pendulum Swing', category: 'rotation' },
  { id: 'spiral-in', label: 'Spiral Rotate-In', category: 'rotation' },
  { id: 'flip', label: 'Flip Horizontal', category: 'rotation' },
  { id: 'flip-y', label: 'Flip Vertical', category: 'rotation' },
  { id: 'bounce', label: 'Bounce', category: 'emphasis' },
  { id: 'pulse', label: 'Heartbeat Pulse', category: 'emphasis' },
  { id: 'rubber-band', label: 'Elastic Snap', category: 'emphasis' },
  { id: 'shake', label: 'Attention Shake', category: 'emphasis' },
  { id: 'flash', label: 'Strobe Flash', category: 'emphasis' },
  { id: 'float', label: 'Hover Float', category: 'continuous' },
  { id: 'pan-drift', label: 'Pan Drift', category: 'continuous' },
  { id: 'ken-burns', label: 'Ken Burns Zoom', category: 'continuous' },
  { id: 'ticker', label: 'Ticker Crawl', category: 'continuous' },
];

export const StudioRightInspector: React.FC = () => {
  const [activeTab, setActiveTab] = useState<InspectorTab>('properties');
  const [newTrackProp, setNewTrackProp] = useState<AnimatableProperty>('rotation');
  const [presetDelayMs, setPresetDelayMs] = useState<number>(0);
  const [presetDurationMs, setPresetDurationMs] = useState<number>(1000);
  const [presetRotationDeg, setPresetRotationDeg] = useState<number>(180);
  const [presetDistancePx, setPresetDistancePx] = useState<number>(240);
  const [presetScaleFactor, setPresetScaleFactor] = useState<number>(1.2);
  const [replaceExistingMotions, setReplaceExistingMotions] = useState<boolean>(false);
  const [scriptTestResult, setScriptTestResult] = useState<ScriptExecutionDiagnostics | null>(
    null
  );
  const [resizingDrag, setResizingDrag] = useState<{
    startX: number;
    startWidth: number;
  } | null>(null);

  const {
    project,
    activeSceneId,
    selectedElementIds,
    updateElement,
    updateScene,
    applyAnimationPreset,
    clearElementTracks,
    duplicateTrack,
    deleteTrack,
    toggleTrackMute,
    commitProjectChange,
    timelineTimeMs,
    rightInspectorCollapsed,
    setRightInspectorCollapsed,
    toggleRightInspector,
    rightInspectorWidth,
    setRightInspectorWidth,
    setShowAudioEditorModal,
  } = useStudioStore();

  const fps = Math.max(1, project.settings.frameRate || 30);

  useEffect(() => {
    if (!resizingDrag) return;
    const onMove = (e: PointerEvent | MouseEvent) => {
      e.preventDefault();
      const clientX = typeof e.clientX === 'number' ? e.clientX : resizingDrag.startX;
      const delta = resizingDrag.startX - clientX;
      setRightInspectorWidth(resizingDrag.startWidth + delta);
    };
    const onUp = () => setResizingDrag(null);
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('mousemove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [resizingDrag, setRightInspectorWidth]);

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
      const dur = Math.max(100, presetDurationMs || 1200);
      const delay = Math.max(0, presetDelayMs || 0);
      const rotAngle = presetRotationDeg ?? 180;
      const dist = presetDistancePx ?? 200;
      const scale = presetScaleFactor ?? 1.25;

      const startVal =
        newTrackProp === 'opacity'
          ? 0
          : newTrackProp === 'x'
            ? selectedElement.x - dist
            : newTrackProp === 'y'
              ? selectedElement.y + dist
              : newTrackProp === 'rotation'
                ? selectedElement.rotation
                : newTrackProp === 'scaleX' || newTrackProp === 'scaleY'
                  ? 1
                  : newTrackProp === 'width'
                    ? selectedElement.width
                    : newTrackProp === 'height'
                      ? selectedElement.height
                      : 0;
      const endVal =
        newTrackProp === 'opacity'
          ? 1
          : newTrackProp === 'x'
            ? selectedElement.x
            : newTrackProp === 'y'
              ? selectedElement.y
              : newTrackProp === 'rotation'
                ? selectedElement.rotation + rotAngle
                : newTrackProp === 'scaleX' || newTrackProp === 'scaleY'
                  ? scale
                  : newTrackProp === 'width'
                    ? selectedElement.width + 120
                    : newTrackProp === 'height'
                      ? selectedElement.height + 80
                      : 1;

      s.animationTracks.push({
        id: createId('track'),
        elementId: selectedElement.id,
        property: newTrackProp,
        label: `Custom ${newTrackProp}`,
        durationMs: dur,
        delayMs: delay,
        repeatCount: 1,
        reverse: false,
        fillMode: 'both',
        rotationAngleDeg: newTrackProp === 'rotation' ? rotAngle : undefined,
        distancePx: newTrackProp === 'x' || newTrackProp === 'y' ? dist : undefined,
        scaleFactor: newTrackProp === 'scaleX' || newTrackProp === 'scaleY' ? scale : undefined,
        keyframes: [
          { id: createId('kf'), timeMs: 0, value: startVal, easing: 'easeOut' },
          { id: createId('kf'), timeMs: dur, value: endVal, easing: 'easeOut' },
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

  if (rightInspectorCollapsed) {
    return (
      <aside className="studio-right-inspector collapsed" aria-label="Collapsed Right Inspector">
        <div
          className="panel-inside-edge-bar right-panel-edge collapsed-edge"
          title="Click chevron to expand Right Inspector"
        >
          <button
            className="inside-edge-chevron-btn"
            onClick={() => setRightInspectorCollapsed(false)}
            title="Expand Right Inspector"
            aria-label="Expand Right Inspector"
          >
            <ChevronLeft size={15} />
          </button>
          <span
            className="inside-edge-vertical-title"
            onClick={() => setRightInspectorCollapsed(false)}
          >
            INSPECTOR &amp; MOTION
          </span>
          <button
            className={`collapsed-rail-btn ${activeTab === 'properties' ? 'active' : ''}`}
            onClick={() => {
              setActiveTab('properties');
              setRightInspectorCollapsed(false);
            }}
            title="Element & Scene Properties Inspector"
          >
            <Sliders size={14} />
          </button>
          <button
            className={`collapsed-rail-btn ${activeTab === 'animation' ? 'active' : ''}`}
            onClick={() => {
              setActiveTab('animation');
              setRightInspectorCollapsed(false);
            }}
            title={`Motion & Animation Tracks (${elementTracks.length})`}
          >
            <Sparkles size={14} />
          </button>
          <button
            className={`collapsed-rail-btn ${activeTab === 'scene-scripts' ? 'active' : ''}`}
            onClick={() => {
              setActiveTab('scene-scripts');
              setRightInspectorCollapsed(false);
            }}
            title="Scene Settings & Restricted Script Sandbox"
          >
            <Code2 size={14} />
          </button>
        </div>
      </aside>
    );
  }

  return (
    <aside
      className="studio-right-inspector has-inside-edge-bar"
      style={{ width: `${rightInspectorWidth}px` }}
    >
      {/* Inside-Edge Vertical Title Bar & Drag-to-Resize Handle (Left Edge of Right Inspector) */}
      <div
        className="panel-inside-edge-bar right-panel-edge"
        title="Drag horizontally to resize Right Inspector, or click chevron to collapse"
        aria-label="Resize Right Inspector"
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest('button')) return;
          e.preventDefault();
          e.stopPropagation();
          setResizingDrag({
            startX: typeof e.clientX === 'number' ? e.clientX : rightInspectorWidth,
            startWidth: rightInspectorWidth,
          });
        }}
        onMouseDown={(e) => {
          if ((e.target as HTMLElement).closest('button')) return;
          e.preventDefault();
          e.stopPropagation();
          setResizingDrag({
            startX: typeof e.clientX === 'number' ? e.clientX : rightInspectorWidth,
            startWidth: rightInspectorWidth,
          });
        }}
      >
        <button
          className="inside-edge-chevron-btn"
          onClick={toggleRightInspector}
          title="Collapse Right Inspector"
          aria-label="Collapse Right Inspector"
        >
          <ChevronRight size={14} />
        </button>
        <span className="inside-edge-vertical-title">
          INSPECTOR — {activeTab.toUpperCase()}
        </span>
        <GripVertical size={13} className="inside-edge-grip-icon" />
      </div>

      <div className="sidebar-main-column">
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
                      <div className="qr-inspector-block" style={{ marginTop: '8px' }}>
                        <label className="inspector-label">QR Code Type</label>
                        <select
                          className="inspector-input"
                          aria-label="QR Code Content Type"
                          value={selectedElement.widgetProps.qrContentType || 'link'}
                          onChange={(e) =>
                            updateElement(selectedElement.id, {
                              widgetProps: {
                                ...selectedElement.widgetProps!,
                                qrContentType: e.target.value as QrContentType,
                              },
                            })
                          }
                        >
                          {QR_CONTENT_TYPES.map((qt) => (
                            <option key={qt.id} value={qt.id}>
                              {qt.label}
                            </option>
                          ))}
                        </select>

                        {/* Contextual Inputs per QR Content Type */}
                        {(!selectedElement.widgetProps.qrContentType ||
                          selectedElement.widgetProps.qrContentType === 'link' ||
                          selectedElement.widgetProps.qrContentType === 'text') && (
                          <>
                            <label className="inspector-label">
                              {selectedElement.widgetProps.qrContentType === 'text'
                                ? 'Plain Text Content'
                                : 'Website URL / Link'}
                            </label>
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

                        {selectedElement.widgetProps.qrContentType === 'wifi' && (
                          <>
                            <label className="inspector-label">Wi-Fi Network Name (SSID)</label>
                            <input
                              type="text"
                              className="inspector-input"
                              placeholder="Guest-WiFi"
                              aria-label="Wi-Fi SSID"
                              value={selectedElement.widgetProps.qrWifiSsid || ''}
                              onChange={(e) =>
                                updateElement(selectedElement.id, {
                                  widgetProps: {
                                    ...selectedElement.widgetProps!,
                                    qrWifiSsid: e.target.value,
                                  },
                                })
                              }
                            />
                            <div className="inspector-grid-2">
                              <div>
                                <label className="inspector-label">Password</label>
                                <input
                                  type="text"
                                  className="inspector-input"
                                  placeholder="Network password..."
                                  value={selectedElement.widgetProps.qrWifiPassword || ''}
                                  onChange={(e) =>
                                    updateElement(selectedElement.id, {
                                      widgetProps: {
                                        ...selectedElement.widgetProps!,
                                        qrWifiPassword: e.target.value,
                                      },
                                    })
                                  }
                                />
                              </div>
                              <div>
                                <label className="inspector-label">Security</label>
                                <select
                                  className="inspector-input"
                                  value={selectedElement.widgetProps.qrWifiEncryption || 'WPA'}
                                  onChange={(e) =>
                                    updateElement(selectedElement.id, {
                                      widgetProps: {
                                        ...selectedElement.widgetProps!,
                                        qrWifiEncryption: e.target.value as 'WPA' | 'WEP' | 'nopass',
                                      },
                                    })
                                  }
                                >
                                  <option value="WPA">WPA / WPA2 / WPA3</option>
                                  <option value="WEP">WEP</option>
                                  <option value="nopass">Open (No Password)</option>
                                </select>
                              </div>
                            </div>
                          </>
                        )}

                        {selectedElement.widgetProps.qrContentType === 'contact' && (
                          <>
                            <div className="inspector-grid-2">
                              <div>
                                <label className="inspector-label">Full Name</label>
                                <input
                                  type="text"
                                  className="inspector-input"
                                  value={selectedElement.widgetProps.qrContactName || ''}
                                  onChange={(e) =>
                                    updateElement(selectedElement.id, {
                                      widgetProps: {
                                        ...selectedElement.widgetProps!,
                                        qrContactName: e.target.value,
                                      },
                                    })
                                  }
                                />
                              </div>
                              <div>
                                <label className="inspector-label">Organization</label>
                                <input
                                  type="text"
                                  className="inspector-input"
                                  value={selectedElement.widgetProps.qrContactOrg || ''}
                                  onChange={(e) =>
                                    updateElement(selectedElement.id, {
                                      widgetProps: {
                                        ...selectedElement.widgetProps!,
                                        qrContactOrg: e.target.value,
                                      },
                                    })
                                  }
                                />
                              </div>
                              <div>
                                <label className="inspector-label">Phone</label>
                                <input
                                  type="text"
                                  className="inspector-input"
                                  value={selectedElement.widgetProps.qrContactPhone || ''}
                                  onChange={(e) =>
                                    updateElement(selectedElement.id, {
                                      widgetProps: {
                                        ...selectedElement.widgetProps!,
                                        qrContactPhone: e.target.value,
                                      },
                                    })
                                  }
                                />
                              </div>
                              <div>
                                <label className="inspector-label">Email</label>
                                <input
                                  type="text"
                                  className="inspector-input"
                                  value={selectedElement.widgetProps.qrContactEmail || ''}
                                  onChange={(e) =>
                                    updateElement(selectedElement.id, {
                                      widgetProps: {
                                        ...selectedElement.widgetProps!,
                                        qrContactEmail: e.target.value,
                                      },
                                    })
                                  }
                                />
                              </div>
                            </div>
                          </>
                        )}

                        {selectedElement.widgetProps.qrContentType === 'email' && (
                          <>
                            <label className="inspector-label">Recipient Email</label>
                            <input
                              type="text"
                              className="inspector-input"
                              value={selectedElement.widgetProps.qrEmailTo || ''}
                              onChange={(e) =>
                                updateElement(selectedElement.id, {
                                  widgetProps: {
                                    ...selectedElement.widgetProps!,
                                    qrEmailTo: e.target.value,
                                  },
                                })
                              }
                            />
                            <label className="inspector-label">Email Subject</label>
                            <input
                              type="text"
                              className="inspector-input"
                              value={selectedElement.widgetProps.qrEmailSubject || ''}
                              onChange={(e) =>
                                updateElement(selectedElement.id, {
                                  widgetProps: {
                                    ...selectedElement.widgetProps!,
                                    qrEmailSubject: e.target.value,
                                  },
                                })
                              }
                            />
                            <label className="inspector-label">Message Body</label>
                            <input
                              type="text"
                              className="inspector-input"
                              value={selectedElement.widgetProps.qrEmailBody || ''}
                              onChange={(e) =>
                                updateElement(selectedElement.id, {
                                  widgetProps: {
                                    ...selectedElement.widgetProps!,
                                    qrEmailBody: e.target.value,
                                  },
                                })
                              }
                            />
                          </>
                        )}

                        {selectedElement.widgetProps.qrContentType === 'sms' && (
                          <div className="inspector-grid-2">
                            <div>
                              <label className="inspector-label">SMS Phone</label>
                              <input
                                type="text"
                                className="inspector-input"
                                value={selectedElement.widgetProps.qrSmsPhone || ''}
                                onChange={(e) =>
                                  updateElement(selectedElement.id, {
                                    widgetProps: {
                                      ...selectedElement.widgetProps!,
                                      qrSmsPhone: e.target.value,
                                    },
                                  })
                                }
                              />
                            </div>
                            <div>
                              <label className="inspector-label">SMS Text</label>
                              <input
                                type="text"
                                className="inspector-input"
                                value={selectedElement.widgetProps.qrSmsMessage || ''}
                                onChange={(e) =>
                                  updateElement(selectedElement.id, {
                                    widgetProps: {
                                      ...selectedElement.widgetProps!,
                                      qrSmsMessage: e.target.value,
                                    },
                                  })
                                }
                              />
                            </div>
                          </div>
                        )}

                        {selectedElement.widgetProps.qrContentType === 'phone' && (
                          <>
                            <label className="inspector-label">Telephone Number</label>
                            <input
                              type="text"
                              className="inspector-input"
                              value={selectedElement.widgetProps.qrPhone || ''}
                              onChange={(e) =>
                                updateElement(selectedElement.id, {
                                  widgetProps: {
                                    ...selectedElement.widgetProps!,
                                    qrPhone: e.target.value,
                                  },
                                })
                              }
                            />
                          </>
                        )}

                        {selectedElement.widgetProps.qrContentType === 'geo' && (
                          <div className="inspector-grid-2">
                            <div>
                              <label className="inspector-label">Latitude</label>
                              <input
                                type="text"
                                className="inspector-input"
                                value={selectedElement.widgetProps.qrGeoLat || '40.4406'}
                                onChange={(e) =>
                                  updateElement(selectedElement.id, {
                                    widgetProps: {
                                      ...selectedElement.widgetProps!,
                                      qrGeoLat: e.target.value,
                                    },
                                  })
                                }
                              />
                            </div>
                            <div>
                              <label className="inspector-label">Longitude</label>
                              <input
                                type="text"
                                className="inspector-input"
                                value={selectedElement.widgetProps.qrGeoLng || '-79.9959'}
                                onChange={(e) =>
                                  updateElement(selectedElement.id, {
                                    widgetProps: {
                                      ...selectedElement.widgetProps!,
                                      qrGeoLng: e.target.value,
                                    },
                                  })
                                }
                              />
                            </div>
                          </div>
                        )}

                        {selectedElement.widgetProps.qrContentType === 'event' && (
                          <>
                            <label className="inspector-label">Event Title</label>
                            <input
                              type="text"
                              className="inspector-input"
                              value={selectedElement.widgetProps.qrEventTitle || ''}
                              onChange={(e) =>
                                updateElement(selectedElement.id, {
                                  widgetProps: {
                                    ...selectedElement.widgetProps!,
                                    qrEventTitle: e.target.value,
                                  },
                                })
                              }
                            />
                            <label className="inspector-label">Event Location</label>
                            <input
                              type="text"
                              className="inspector-input"
                              value={selectedElement.widgetProps.qrEventLocation || ''}
                              onChange={(e) =>
                                updateElement(selectedElement.id, {
                                  widgetProps: {
                                    ...selectedElement.widgetProps!,
                                    qrEventLocation: e.target.value,
                                  },
                                })
                              }
                            />
                          </>
                        )}

                        {/* Error Correction, Module Style & Quiet Zone */}
                        <div className="inspector-grid-2" style={{ marginTop: '8px' }}>
                          <div>
                            <label className="inspector-label">Error Correction Level</label>
                            <select
                              className="inspector-input"
                              aria-label="QR Error Correction Level"
                              value={selectedElement.widgetProps.qrErrorCorrection || 'M'}
                              onChange={(e) =>
                                updateElement(selectedElement.id, {
                                  widgetProps: {
                                    ...selectedElement.widgetProps!,
                                    qrErrorCorrection: e.target.value as QrErrorCorrectionLevel,
                                  },
                                })
                              }
                            >
                              <option value="L">Level L (Low ~7%)</option>
                              <option value="M">Level M (Medium ~15%)</option>
                              <option value="Q">Level Q (Quartile ~25%)</option>
                              <option value="H">Level H (High ~30% — Logo Safe)</option>
                            </select>
                          </div>
                          <div>
                            <label className="inspector-label">Module Pattern Style</label>
                            <select
                              className="inspector-input"
                              value={selectedElement.widgetProps.qrDotStyle || 'square'}
                              onChange={(e) =>
                                updateElement(selectedElement.id, {
                                  widgetProps: {
                                    ...selectedElement.widgetProps!,
                                    qrDotStyle: e.target.value as QrDotStyle,
                                  },
                                })
                              }
                            >
                              <option value="square">Classic Square</option>
                              <option value="rounded">Rounded Modules</option>
                              <option value="dots">Circular Dots</option>
                            </select>
                          </div>
                        </div>

                        {/* QR Colors: Foreground, Background, Corner Finder Eye Color */}
                        <div className="inspector-grid-3" style={{ marginTop: '8px' }}>
                          <div>
                            <label className="inspector-label">QR Foreground</label>
                            <input
                              type="color"
                              className="inspector-color"
                              aria-label="QR Foreground Color"
                              value={selectedElement.widgetProps.qrForeground || '#0f172a'}
                              onChange={(e) =>
                                updateElement(selectedElement.id, {
                                  widgetProps: {
                                    ...selectedElement.widgetProps!,
                                    qrForeground: e.target.value,
                                  },
                                })
                              }
                            />
                          </div>
                          <div>
                            <label className="inspector-label">QR Background</label>
                            <input
                              type="color"
                              className="inspector-color"
                              aria-label="QR Background Color"
                              value={selectedElement.widgetProps.qrBackground || '#f8fafc'}
                              onChange={(e) =>
                                updateElement(selectedElement.id, {
                                  widgetProps: {
                                    ...selectedElement.widgetProps!,
                                    qrBackground: e.target.value,
                                  },
                                })
                              }
                            />
                          </div>
                          <div>
                            <label className="inspector-label">Corner Eyes</label>
                            <input
                              type="color"
                              className="inspector-color"
                              aria-label="QR Corner Eye Color"
                              value={
                                selectedElement.widgetProps.qrEyeColor ||
                                selectedElement.widgetProps.qrForeground ||
                                '#0f172a'
                              }
                              onChange={(e) =>
                                updateElement(selectedElement.id, {
                                  widgetProps: {
                                    ...selectedElement.widgetProps!,
                                    qrEyeColor: e.target.value,
                                  },
                                })
                              }
                            />
                          </div>
                        </div>

                        {/* Center Logo Overlay */}
                        <div style={{ marginTop: '10px' }}>
                          <label className="inline-check">
                            <input
                              type="checkbox"
                              checked={Boolean(selectedElement.widgetProps.qrLogoEnabled)}
                              aria-label="Enable Center Logo in QR Code"
                              onChange={(e) =>
                                updateElement(selectedElement.id, {
                                  widgetProps: {
                                    ...selectedElement.widgetProps!,
                                    qrLogoEnabled: e.target.checked,
                                    qrErrorCorrection: e.target.checked
                                      ? 'H'
                                      : selectedElement.widgetProps!.qrErrorCorrection,
                                  },
                                })
                              }
                            />
                            Show Brand Logo / Badge in Center of QR Code
                          </label>

                          {selectedElement.widgetProps.qrLogoEnabled && (
                            <div className="inspector-grid-2" style={{ marginTop: '6px' }}>
                              <div>
                                <label className="inspector-label">Center Logo Image Asset</label>
                                <select
                                  className="inspector-input"
                                  value={selectedElement.widgetProps.qrLogoAssetId || ''}
                                  onChange={(e) =>
                                    updateElement(selectedElement.id, {
                                      widgetProps: {
                                        ...selectedElement.widgetProps!,
                                        qrLogoAssetId: e.target.value,
                                      },
                                    })
                                  }
                                >
                                  <option value="">Use Text Badge Below</option>
                                  {project.assets
                                    .filter((a) => a.type === 'image')
                                    .map((a) => (
                                      <option key={a.id} value={a.id}>
                                        {a.name}
                                      </option>
                                    ))}
                                </select>
                              </div>
                              <div>
                                <label className="inspector-label">Or Logo Text Badge</label>
                                <input
                                  type="text"
                                  className="inspector-input"
                                  placeholder="APEX"
                                  value={selectedElement.widgetProps.qrLogoText || ''}
                                  onChange={(e) =>
                                    updateElement(selectedElement.id, {
                                      widgetProps: {
                                        ...selectedElement.widgetProps!,
                                        qrLogoText: e.target.value,
                                      },
                                    })
                                  }
                                />
                              </div>
                              <div>
                                <label className="inspector-label">
                                  Logo Size ({selectedElement.widgetProps.qrLogoSizePercent ?? 22}%)
                                </label>
                                <input
                                  type="range"
                                  min={14}
                                  max={32}
                                  value={selectedElement.widgetProps.qrLogoSizePercent ?? 22}
                                  onChange={(e) =>
                                    updateElement(selectedElement.id, {
                                      widgetProps: {
                                        ...selectedElement.widgetProps!,
                                        qrLogoSizePercent: Number(e.target.value),
                                      },
                                    })
                                  }
                                />
                              </div>
                              <div>
                                <label className="inspector-label">Bottom Caption</label>
                                <input
                                  type="text"
                                  className="inspector-input"
                                  value={selectedElement.widgetProps.qrLabelText ?? 'SCAN FOR PASS'}
                                  onChange={(e) =>
                                    updateElement(selectedElement.id, {
                                      widgetProps: {
                                        ...selectedElement.widgetProps!,
                                        qrLabelText: e.target.value,
                                      },
                                    })
                                  }
                                />
                              </div>
                            </div>
                          )}
                        </div>

                        <div style={{ marginTop: '6px' }}>
                          <span className="muted-line" style={{ fontSize: '10px', wordBreak: 'break-all' }}>
                            Encoded Payload: <code>{formatQrWidgetPayload(selectedElement.widgetProps)}</code>
                          </span>
                        </div>
                      </div>
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

                    {/* Switch Widget Kind Dropdown */}
                    <div style={{ marginTop: '8px' }}>
                      <label className="inspector-label">Widget Type</label>
                      <select
                        className="inspector-input"
                        aria-label="Widget Kind Selector"
                        value={selectedElement.widgetProps.widgetKind}
                        onChange={(e) =>
                          updateElement(selectedElement.id, {
                            widgetProps: {
                              ...selectedElement.widgetProps!,
                              widgetKind: e.target.value as WidgetKind,
                            },
                          })
                        }
                      >
                        <option value="clock">Clock &amp; Date</option>
                        <option value="countdown">Countdown Timer</option>
                        <option value="qrcode">QR Code (Multi-Type)</option>
                        <option value="ticker">Scrolling News Ticker</option>
                        <option value="weather">Local Weather Card</option>
                        <option value="datafeed">Data Feed / Menu Table</option>
                        <option value="kpi">KPI Metric &amp; Sparkline</option>
                        <option value="chart">Bar / Horizontal Chart</option>
                        <option value="wayfinding">Wayfinding &amp; Directional Sign</option>
                        <option value="queue">Now Serving Queue Ticket</option>
                        <option value="progress">Capacity &amp; Progress Gauge</option>
                        <option value="social">Social Wall Post</option>
                        <option value="calendar">Room Booking Schedule</option>
                        <option value="alert">CAP Emergency / Safety Alert</option>
                      </select>
                    </div>

                    {/* KPI METRIC CONTROLS */}
                    {selectedElement.widgetProps.widgetKind === 'kpi' && (
                      <div className="inspector-grid-2" style={{ marginTop: '8px' }}>
                        <div>
                          <label className="inspector-label">KPI Title</label>
                          <input
                            type="text"
                            className="inspector-input"
                            aria-label="KPI Metric Title"
                            value={selectedElement.widgetProps.kpiTitle || ''}
                            onChange={(e) =>
                              updateElement(selectedElement.id, {
                                widgetProps: {
                                  ...selectedElement.widgetProps!,
                                  kpiTitle: e.target.value,
                                },
                              })
                            }
                          />
                        </div>
                        <div>
                          <label className="inspector-label">Metric Value</label>
                          <input
                            type="text"
                            className="inspector-input"
                            aria-label="KPI Metric Value"
                            value={selectedElement.widgetProps.kpiValue || ''}
                            onChange={(e) =>
                              updateElement(selectedElement.id, {
                                widgetProps: {
                                  ...selectedElement.widgetProps!,
                                  kpiValue: e.target.value,
                                },
                              })
                            }
                          />
                        </div>
                        <div>
                          <label className="inspector-label">Unit</label>
                          <input
                            type="text"
                            className="inspector-input"
                            value={selectedElement.widgetProps.kpiUnit || ''}
                            onChange={(e) =>
                              updateElement(selectedElement.id, {
                                widgetProps: {
                                  ...selectedElement.widgetProps!,
                                  kpiUnit: e.target.value,
                                },
                              })
                            }
                          />
                        </div>
                        <div>
                          <label className="inspector-label">Delta Badge</label>
                          <input
                            type="text"
                            className="inspector-input"
                            value={selectedElement.widgetProps.kpiDelta || ''}
                            onChange={(e) =>
                              updateElement(selectedElement.id, {
                                widgetProps: {
                                  ...selectedElement.widgetProps!,
                                  kpiDelta: e.target.value,
                                },
                              })
                            }
                          />
                        </div>
                      </div>
                    )}

                    {/* CHART WIDGET CONTROLS */}
                    {selectedElement.widgetProps.widgetKind === 'chart' && (
                      <div className="inspector-grid-2" style={{ marginTop: '8px' }}>
                        <div>
                          <label className="inspector-label">Chart Title</label>
                          <input
                            type="text"
                            className="inspector-input"
                            value={selectedElement.widgetProps.chartTitle || ''}
                            onChange={(e) =>
                              updateElement(selectedElement.id, {
                                widgetProps: {
                                  ...selectedElement.widgetProps!,
                                  chartTitle: e.target.value,
                                },
                              })
                            }
                          />
                        </div>
                        <div>
                          <label className="inspector-label">Chart Layout</label>
                          <select
                            className="inspector-input"
                            value={selectedElement.widgetProps.chartType || 'bar'}
                            onChange={(e) =>
                              updateElement(selectedElement.id, {
                                widgetProps: {
                                  ...selectedElement.widgetProps!,
                                  chartType: e.target.value as 'bar' | 'horizontal-bar',
                                },
                              })
                            }
                          >
                            <option value="bar">Vertical Bar Chart</option>
                            <option value="horizontal-bar">Horizontal Bar Chart</option>
                          </select>
                        </div>
                      </div>
                    )}

                    {/* WAYFINDING WIDGET CONTROLS */}
                    {selectedElement.widgetProps.widgetKind === 'wayfinding' && (
                      <div className="inspector-grid-2" style={{ marginTop: '8px' }}>
                        <div>
                          <label className="inspector-label">Direction Arrow</label>
                          <select
                            className="inspector-input"
                            aria-label="Wayfinding Direction"
                            value={selectedElement.widgetProps.wayfindingDirection || 'up-right'}
                            onChange={(e) =>
                              updateElement(selectedElement.id, {
                                widgetProps: {
                                  ...selectedElement.widgetProps!,
                                  wayfindingDirection: e.target.value as NonNullable<
                                    typeof selectedElement.widgetProps
                                  >['wayfindingDirection'],
                                },
                              })
                            }
                          >
                            <option value="up">↑ Straight Ahead</option>
                            <option value="up-right">↗ Up-Right</option>
                            <option value="right">→ Turn Right</option>
                            <option value="down-right">↘ Down-Right</option>
                            <option value="down">↓ Downstairs</option>
                            <option value="left">← Turn Left</option>
                            <option value="up-left">↖ Up-Left</option>
                            <option value="elevator">🛗 Elevator</option>
                            <option value="accessible">♿ Accessible Route</option>
                          </select>
                        </div>
                        <div>
                          <label className="inspector-label">Destination Name</label>
                          <input
                            type="text"
                            className="inspector-input"
                            value={selectedElement.widgetProps.wayfindingDestination || ''}
                            onChange={(e) =>
                              updateElement(selectedElement.id, {
                                widgetProps: {
                                  ...selectedElement.widgetProps!,
                                  wayfindingDestination: e.target.value,
                                },
                              })
                            }
                          />
                        </div>
                        <div>
                          <label className="inspector-label">Floor / Subtext</label>
                          <input
                            type="text"
                            className="inspector-input"
                            value={selectedElement.widgetProps.wayfindingSubtext || ''}
                            onChange={(e) =>
                              updateElement(selectedElement.id, {
                                widgetProps: {
                                  ...selectedElement.widgetProps!,
                                  wayfindingSubtext: e.target.value,
                                },
                              })
                            }
                          />
                        </div>
                        <div>
                          <label className="inspector-label">Distance / Time</label>
                          <input
                            type="text"
                            className="inspector-input"
                            value={selectedElement.widgetProps.wayfindingDistance || ''}
                            onChange={(e) =>
                              updateElement(selectedElement.id, {
                                widgetProps: {
                                  ...selectedElement.widgetProps!,
                                  wayfindingDistance: e.target.value,
                                },
                              })
                            }
                          />
                        </div>
                      </div>
                    )}

                    {/* QUEUE TICKET CONTROLS */}
                    {selectedElement.widgetProps.widgetKind === 'queue' && (
                      <div className="inspector-grid-2" style={{ marginTop: '8px' }}>
                        <div>
                          <label className="inspector-label">Active Ticket</label>
                          <input
                            type="text"
                            className="inspector-input"
                            value={selectedElement.widgetProps.queueCurrentTicket || ''}
                            onChange={(e) =>
                              updateElement(selectedElement.id, {
                                widgetProps: {
                                  ...selectedElement.widgetProps!,
                                  queueCurrentTicket: e.target.value,
                                },
                              })
                            }
                          />
                        </div>
                        <div>
                          <label className="inspector-label">Counter / Desk</label>
                          <input
                            type="text"
                            className="inspector-input"
                            value={selectedElement.widgetProps.queueCounterLabel || ''}
                            onChange={(e) =>
                              updateElement(selectedElement.id, {
                                widgetProps: {
                                  ...selectedElement.widgetProps!,
                                  queueCounterLabel: e.target.value,
                                },
                              })
                            }
                          />
                        </div>
                      </div>
                    )}

                    {/* PROGRESS GAUGE CONTROLS */}
                    {selectedElement.widgetProps.widgetKind === 'progress' && (
                      <div className="inspector-grid-2" style={{ marginTop: '8px' }}>
                        <div>
                          <label className="inspector-label">Gauge Title</label>
                          <input
                            type="text"
                            className="inspector-input"
                            value={selectedElement.widgetProps.progressTitle || ''}
                            onChange={(e) =>
                              updateElement(selectedElement.id, {
                                widgetProps: {
                                  ...selectedElement.widgetProps!,
                                  progressTitle: e.target.value,
                                },
                              })
                            }
                          />
                        </div>
                        <div>
                          <label className="inspector-label">Value (0–100)</label>
                          <input
                            type="number"
                            className="inspector-input"
                            value={selectedElement.widgetProps.progressValue ?? 76}
                            onChange={(e) =>
                              updateElement(selectedElement.id, {
                                widgetProps: {
                                  ...selectedElement.widgetProps!,
                                  progressValue: Number(e.target.value),
                                },
                              })
                            }
                          />
                        </div>
                      </div>
                    )}

                    {/* SOCIAL WALL CONTROLS */}
                    {selectedElement.widgetProps.widgetKind === 'social' && (
                      <div style={{ marginTop: '8px' }}>
                        <div className="inspector-grid-2">
                          <div>
                            <label className="inspector-label">Author</label>
                            <input
                              type="text"
                              className="inspector-input"
                              value={selectedElement.widgetProps.socialAuthor || ''}
                              onChange={(e) =>
                                updateElement(selectedElement.id, {
                                  widgetProps: {
                                    ...selectedElement.widgetProps!,
                                    socialAuthor: e.target.value,
                                  },
                                })
                              }
                            />
                          </div>
                          <div>
                            <label className="inspector-label">Handle</label>
                            <input
                              type="text"
                              className="inspector-input"
                              value={selectedElement.widgetProps.socialHandle || ''}
                              onChange={(e) =>
                                updateElement(selectedElement.id, {
                                  widgetProps: {
                                    ...selectedElement.widgetProps!,
                                    socialHandle: e.target.value,
                                  },
                                })
                              }
                            />
                          </div>
                        </div>
                        <label className="inspector-label">Post Message</label>
                        <textarea
                          className="inspector-textarea"
                          rows={2}
                          value={selectedElement.widgetProps.socialPostText || ''}
                          onChange={(e) =>
                            updateElement(selectedElement.id, {
                              widgetProps: {
                                ...selectedElement.widgetProps!,
                                socialPostText: e.target.value,
                              },
                            })
                          }
                        />
                      </div>
                    )}

                    {/* CALENDAR / ROOM BOOKING CONTROLS */}
                    {selectedElement.widgetProps.widgetKind === 'calendar' && (
                      <div className="inspector-grid-2" style={{ marginTop: '8px' }}>
                        <div>
                          <label className="inspector-label">Room Name</label>
                          <input
                            type="text"
                            className="inspector-input"
                            value={selectedElement.widgetProps.calendarRoomName || ''}
                            onChange={(e) =>
                              updateElement(selectedElement.id, {
                                widgetProps: {
                                  ...selectedElement.widgetProps!,
                                  calendarRoomName: e.target.value,
                                },
                              })
                            }
                          />
                        </div>
                        <div>
                          <label className="inspector-label">Status</label>
                          <select
                            className="inspector-input"
                            value={selectedElement.widgetProps.calendarRoomStatus || 'available'}
                            onChange={(e) =>
                              updateElement(selectedElement.id, {
                                widgetProps: {
                                  ...selectedElement.widgetProps!,
                                  calendarRoomStatus: e.target.value as
                                    | 'available'
                                    | 'occupied'
                                    | 'upcoming',
                                },
                              })
                            }
                          >
                            <option value="available">Available</option>
                            <option value="occupied">In Session</option>
                            <option value="upcoming">Starting Soon</option>
                          </select>
                        </div>
                      </div>
                    )}

                    {/* EMERGENCY ALERT CONTROLS */}
                    {selectedElement.widgetProps.widgetKind === 'alert' && (
                      <div style={{ marginTop: '8px' }}>
                        <div className="inspector-grid-2">
                          <div>
                            <label className="inspector-label">Severity</label>
                            <select
                              className="inspector-input"
                              value={selectedElement.widgetProps.alertSeverity || 'warning'}
                              onChange={(e) =>
                                updateElement(selectedElement.id, {
                                  widgetProps: {
                                    ...selectedElement.widgetProps!,
                                    alertSeverity: e.target.value as 'info' | 'warning' | 'critical',
                                  },
                                })
                              }
                            >
                              <option value="info">Info Advisory</option>
                              <option value="warning">Warning Alert</option>
                              <option value="critical">Critical Emergency</option>
                            </select>
                          </div>
                          <div>
                            <label className="inspector-label">Headline</label>
                            <input
                              type="text"
                              className="inspector-input"
                              value={selectedElement.widgetProps.alertTitle || ''}
                              onChange={(e) =>
                                updateElement(selectedElement.id, {
                                  widgetProps: {
                                    ...selectedElement.widgetProps!,
                                    alertTitle: e.target.value,
                                  },
                                })
                              }
                            />
                          </div>
                        </div>
                      </div>
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
                  <div className="inline-row" style={{ justifyContent: 'space-between', marginBottom: '6px' }}>
                    <div className="palette-title" style={{ marginBottom: 0 }}>
                      New Motion Timing &amp; Parameters
                    </div>
                    <button
                      className="btn-xs"
                      title="Set New Motion Start Time to Current Timeline Playhead"
                      onClick={() => setPresetDelayMs(Math.round(timelineTimeMs))}
                    >
                      <Clock size={11} /> Use Playhead ({Math.round(timelineTimeMs)}ms / F
                      {Math.round((timelineTimeMs / 1000) * fps)})
                    </button>
                  </div>

                  <div className="inspector-grid-2">
                    <div>
                      <label className="inspector-label">Start Time (ms)</label>
                      <input
                        type="number"
                        className="inspector-input"
                        aria-label="New Motion Start Time (ms)"
                        min={0}
                        step={50}
                        value={presetDelayMs}
                        onChange={(e) => setPresetDelayMs(Math.max(0, Number(e.target.value)))}
                      />
                    </div>
                    <div>
                      <label className="inspector-label">Start Frame (@ {fps} FPS)</label>
                      <input
                        type="number"
                        className="inspector-input"
                        aria-label="New Motion Start Frame"
                        min={0}
                        step={1}
                        value={Math.round((presetDelayMs / 1000) * fps)}
                        onChange={(e) =>
                          setPresetDelayMs(
                            Math.max(0, Math.round((Number(e.target.value) / fps) * 1000))
                          )
                        }
                      />
                    </div>
                    <div>
                      <label className="inspector-label">Duration (ms)</label>
                      <input
                        type="number"
                        className="inspector-input"
                        aria-label="New Motion Duration (ms)"
                        min={100}
                        step={100}
                        value={presetDurationMs}
                        onChange={(e) => setPresetDurationMs(Math.max(100, Number(e.target.value)))}
                      />
                    </div>
                    <div>
                      <label className="inspector-label">Rotation Angle (°)</label>
                      <input
                        type="number"
                        className="inspector-input"
                        aria-label="New Motion Rotation Angle"
                        step={15}
                        value={presetRotationDeg}
                        onChange={(e) => setPresetRotationDeg(Number(e.target.value))}
                      />
                    </div>
                    <div>
                      <label className="inspector-label">Slide / Move Distance (px)</label>
                      <input
                        type="number"
                        className="inspector-input"
                        aria-label="New Motion Distance (px)"
                        step={20}
                        value={presetDistancePx}
                        onChange={(e) => setPresetDistancePx(Number(e.target.value))}
                      />
                    </div>
                    <div>
                      <label className="inspector-label">Zoom / Pulse Scale Factor</label>
                      <input
                        type="number"
                        className="inspector-input"
                        aria-label="New Motion Scale Factor"
                        step={0.1}
                        value={presetScaleFactor}
                        onChange={(e) => setPresetScaleFactor(Number(e.target.value))}
                      />
                    </div>
                  </div>

                  <div className="inline-row" style={{ justifyContent: 'space-between', marginTop: '6px' }}>
                    <label className="inline-check" style={{ fontSize: '11px' }}>
                      <input
                        type="checkbox"
                        checked={!replaceExistingMotions}
                        onChange={(e) => setReplaceExistingMotions(!e.target.checked)}
                      />
                      Stack / Add Multiple Motions to This Object
                    </label>
                    {elementTracks.length > 0 && (
                      <button
                        className="btn-xs"
                        onClick={() => clearElementTracks(selectedElement.id)}
                      >
                        <Trash2 size={11} /> Clear All ({elementTracks.length})
                      </button>
                    )}
                  </div>
                </div>

                <div className="inspector-section">
                  <div className="palette-title">
                    Motion Presets (Click to {replaceExistingMotions ? 'Replace' : 'Add to Object'})
                  </div>
                  <div className="preset-pill-grid">
                    {ANIMATION_PRESETS.map((p) => (
                      <button
                        key={p.id}
                        className="preset-pill"
                        onClick={() =>
                          applyAnimationPreset(selectedElement.id, p.id, presetDurationMs, {
                            delayMs: presetDelayMs,
                            rotationAngleDeg: presetRotationDeg,
                            distancePx: presetDistancePx,
                            scaleFactor: presetScaleFactor,
                            replaceExisting: replaceExistingMotions,
                          })
                        }
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="inspector-section">
                  <div className="palette-title">Add Custom Property Motion Track</div>
                  <div className="inline-row">
                    <select
                      className="inspector-input"
                      aria-label="Custom Track Property"
                      value={newTrackProp}
                      onChange={(e) => setNewTrackProp(e.target.value as AnimatableProperty)}
                    >
                      <option value="rotation">Rotation Angle (°)</option>
                      <option value="x">Position X (px)</option>
                      <option value="y">Position Y (px)</option>
                      <option value="scaleX">Scale X</option>
                      <option value="scaleY">Scale Y</option>
                      <option value="opacity">Opacity (0..1)</option>
                      <option value="width">Width (px)</option>
                      <option value="height">Height (px)</option>
                      <option value="borderRadius">Corner Radius (px)</option>
                      <option value="textReveal">Typewriter Reveal</option>
                      <option value="cropProgress">Wipe / Crop Progress</option>
                    </select>
                    <button className="btn-xs primary-accent" onClick={handleAddCustomTrack}>
                      <Plus size={12} /> Add Motion
                    </button>
                  </div>
                </div>

                <div className="inspector-section">
                  <div className="palette-title">
                    Object Motion Queue ({elementTracks.length} Active on &ldquo;{selectedElement.name}&rdquo;)
                  </div>
                  {elementTracks.map((track, idx) => {
                    const startMs = track.delayMs || 0;
                    const startFrame = Math.round((startMs / 1000) * fps);
                    const durFrames = Math.max(1, Math.round((track.durationMs / 1000) * fps));
                    const endMs = startMs + track.durationMs;
                    const kf0Val = track.keyframes[0]?.value ?? 0;
                    const kf1Val = track.keyframes[1]?.value ?? 0;
                    const currentRotDelta =
                      track.rotationAngleDeg ??
                      (typeof kf1Val === 'number' && typeof kf0Val === 'number'
                        ? kf1Val - kf0Val
                        : 180);

                    return (
                      <div key={track.id} className="track-inspector-card">
                        <div className="track-inspector-header">
                          <div>
                            <strong>
                              #{idx + 1} • {track.property.toUpperCase()}
                            </strong>{' '}
                            <span className="entry-pill">
                              {startMs}ms – {endMs}ms (F{startFrame}–F{startFrame + durFrames})
                            </span>
                          </div>
                          <div className="inline-row" style={{ gap: '4px' }}>
                            <button
                              className="icon-btn-sm"
                              title="Snap Start Time to Current Playhead"
                              onClick={() =>
                                commitProjectChange('Snap Track Start to Playhead', (draft) => {
                                  const sc = draft.scenes.find((s) => s.id === activeScene?.id);
                                  const tr = sc?.animationTracks.find((t) => t.id === track.id);
                                  if (tr) tr.delayMs = Math.max(0, Math.round(timelineTimeMs));
                                })
                              }
                            >
                              <Clock size={12} />
                            </button>
                            <button
                              className="icon-btn-sm"
                              title="Duplicate Motion After This One"
                              aria-label={`Duplicate Track ${track.property}`}
                              onClick={() => duplicateTrack(track.id)}
                            >
                              <Copy size={12} />
                            </button>
                            <button
                              className="icon-btn-sm danger-hover"
                              title="Delete Motion Track"
                              aria-label={`Delete Track ${track.property}`}
                              onClick={() => deleteTrack(track.id)}
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </div>

                        {/* Timeline Start Time (ms) & Start Frame Controls */}
                        <div className="inspector-grid-2">
                          <div>
                            <label className="inspector-label">Start Time (ms)</label>
                            <input
                              type="number"
                              className="inspector-input"
                              aria-label={`Track ${idx + 1} Start Time (ms)`}
                              min={0}
                              step={50}
                              value={startMs}
                              onChange={(e) =>
                                commitProjectChange('Update Track Start Time', (draft) => {
                                  const sc = draft.scenes.find((s) => s.id === activeScene?.id);
                                  const tr = sc?.animationTracks.find((t) => t.id === track.id);
                                  if (tr) tr.delayMs = Math.max(0, Number(e.target.value));
                                })
                              }
                            />
                          </div>
                          <div>
                            <label className="inspector-label">Start Frame (@ {fps} FPS)</label>
                            <input
                              type="number"
                              className="inspector-input"
                              aria-label={`Track ${idx + 1} Start Frame`}
                              min={0}
                              step={1}
                              value={startFrame}
                              onChange={(e) =>
                                commitProjectChange('Update Track Start Frame', (draft) => {
                                  const sc = draft.scenes.find((s) => s.id === activeScene?.id);
                                  const tr = sc?.animationTracks.find((t) => t.id === track.id);
                                  if (tr) {
                                    tr.delayMs = Math.max(
                                      0,
                                      Math.round((Number(e.target.value) / fps) * 1000)
                                    );
                                  }
                                })
                              }
                            />
                          </div>
                          <div>
                            <label className="inspector-label">Duration (ms)</label>
                            <input
                              type="number"
                              className="inspector-input"
                              aria-label={`Track ${idx + 1} Duration (ms)`}
                              value={track.durationMs}
                              min={100}
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
                            <label className="inspector-label">Duration (Frames)</label>
                            <input
                              type="number"
                              className="inspector-input"
                              aria-label={`Track ${idx + 1} Duration Frames`}
                              value={durFrames}
                              min={1}
                              step={1}
                              onChange={(e) =>
                                commitProjectChange('Update Track Duration Frames', (draft) => {
                                  const sc = draft.scenes.find((s) => s.id === activeScene?.id);
                                  const tr = sc?.animationTracks.find((t) => t.id === track.id);
                                  if (tr) {
                                    const nextMs = Math.max(
                                      100,
                                      Math.round((Number(e.target.value) / fps) * 1000)
                                    );
                                    tr.durationMs = nextMs;
                                    if (tr.keyframes[1]) tr.keyframes[1].timeMs = nextMs;
                                  }
                                })
                              }
                            />
                          </div>
                        </div>

                        {/* Rotation Angle Specific Control when property === 'rotation' */}
                        {track.property === 'rotation' && (
                          <div style={{ marginTop: '6px' }}>
                            <label className="inspector-label">
                              Rotation Angle Delta (°): <strong>{currentRotDelta}°</strong>
                            </label>
                            <div className="inline-row" style={{ gap: '6px' }}>
                              <input
                                type="range"
                                min={-360}
                                max={360}
                                step={5}
                                style={{ flex: 1 }}
                                value={Math.max(-360, Math.min(360, Number(currentRotDelta)))}
                                onChange={(e) => {
                                  const deg = Number(e.target.value);
                                  commitProjectChange('Update Track Rotation Angle', (draft) => {
                                    const sc = draft.scenes.find((s) => s.id === activeScene?.id);
                                    const tr = sc?.animationTracks.find((t) => t.id === track.id);
                                    if (tr && tr.keyframes.length >= 2) {
                                      tr.rotationAngleDeg = deg;
                                      const baseAngle = Number(tr.keyframes[0].value) || 0;
                                      tr.keyframes[1].value = baseAngle + deg;
                                    }
                                  });
                                }}
                              />
                              <input
                                type="number"
                                className="inspector-input"
                                style={{ width: '76px' }}
                                aria-label={`Track ${idx + 1} Rotation Angle`}
                                value={currentRotDelta}
                                step={15}
                                onChange={(e) => {
                                  const deg = Number(e.target.value);
                                  commitProjectChange('Update Track Rotation Angle', (draft) => {
                                    const sc = draft.scenes.find((s) => s.id === activeScene?.id);
                                    const tr = sc?.animationTracks.find((t) => t.id === track.id);
                                    if (tr && tr.keyframes.length >= 2) {
                                      tr.rotationAngleDeg = deg;
                                      const baseAngle = Number(tr.keyframes[0].value) || 0;
                                      tr.keyframes[1].value = baseAngle + deg;
                                    }
                                  });
                                }}
                              />
                            </div>
                          </div>
                        )}

                        {/* Start Value (From) & End Value (To) Controls for All Properties */}
                        <div className="inspector-grid-2" style={{ marginTop: '6px' }}>
                          <div>
                            <label className="inspector-label">Start Value (From)</label>
                            <input
                              type="number"
                              className="inspector-input"
                              aria-label={`Track ${idx + 1} Start Value`}
                              value={typeof kf0Val === 'number' ? kf0Val : 0}
                              step={track.property === 'opacity' || track.property.startsWith('scale') ? 0.1 : 10}
                              onChange={(e) =>
                                commitProjectChange('Update Track Start Value', (draft) => {
                                  const sc = draft.scenes.find((s) => s.id === activeScene?.id);
                                  const tr = sc?.animationTracks.find((t) => t.id === track.id);
                                  if (tr && tr.keyframes[0]) {
                                    tr.keyframes[0].value = Number(e.target.value);
                                  }
                                })
                              }
                            />
                          </div>
                          <div>
                            <label className="inspector-label">End Value (To)</label>
                            <input
                              type="number"
                              className="inspector-input"
                              aria-label={`Track ${idx + 1} End Value`}
                              value={typeof kf1Val === 'number' ? kf1Val : 0}
                              step={track.property === 'opacity' || track.property.startsWith('scale') ? 0.1 : 10}
                              onChange={(e) =>
                                commitProjectChange('Update Track End Value', (draft) => {
                                  const sc = draft.scenes.find((s) => s.id === activeScene?.id);
                                  const tr = sc?.animationTracks.find((t) => t.id === track.id);
                                  if (tr && tr.keyframes[1]) {
                                    tr.keyframes[1].value = Number(e.target.value);
                                    if (
                                      tr.property === 'rotation' &&
                                      typeof tr.keyframes[0]?.value === 'number'
                                    ) {
                                      tr.rotationAngleDeg =
                                        Number(e.target.value) - tr.keyframes[0].value;
                                    }
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
                          <div>
                            <label className="inspector-label">Repeat / Loop</label>
                            <select
                              className="inspector-input"
                              value={track.repeatCount}
                              onChange={(e) =>
                                commitProjectChange('Update Track Repeat', (draft) => {
                                  const sc = draft.scenes.find((s) => s.id === activeScene?.id);
                                  const tr = sc?.animationTracks.find((t) => t.id === track.id);
                                  if (tr) tr.repeatCount = Number(e.target.value);
                                })
                              }
                            >
                              <option value={1}>Play Once (1×)</option>
                              <option value={2}>Repeat 2×</option>
                              <option value={3}>Repeat 3×</option>
                              <option value={5}>Repeat 5×</option>
                              <option value={-1}>Infinite Loop (∞)</option>
                            </select>
                          </div>
                        </div>

                        <label className="inline-check" style={{ marginTop: '6px', fontSize: '11px' }}>
                          <input
                            type="checkbox"
                            checked={Boolean(track.reverse)}
                            onChange={(e) =>
                              commitProjectChange('Toggle Track Reverse', (draft) => {
                                const sc = draft.scenes.find((s) => s.id === activeScene?.id);
                                const tr = sc?.animationTracks.find((t) => t.id === track.id);
                                if (tr) tr.reverse = e.target.checked;
                              })
                            }
                          />
                          Ping-Pong / Alternate Reverse on Repeat
                        </label>
                      </div>
                    );
                  })}
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
              <div className="palette-title">Background Music &amp; Scene Audio</div>
              <button
                className="btn-primary full-width"
                onClick={() => setShowAudioEditorModal(true)}
              >
                <Music size={14} /> Open Audio Editor &amp; Background Music Mixer
              </button>
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
      </div>
    </aside>
  );
};
