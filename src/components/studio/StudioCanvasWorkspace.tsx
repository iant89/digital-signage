// ============================================================================
// src/components/studio/StudioCanvasWorkspace.tsx — Interactive Visual Canvas
// Logical Reference Resolution, Rulers, Snap Guides, Resize/Rotate Handles
// ============================================================================

import { createPortal } from 'react-dom';
import { snapResizeToGrid } from './resizeGrid';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStudioStore } from '@/store/useStudioStore';
import { computeSceneElementsAtTime } from '@packages/animation-engine';
import { SnapGuide, computeSnappedPosition } from '@packages/editor-core';
import { SignageElementRenderer } from '@/components/shared/SignageElementRenderer';

type DragMode =
  | {
      kind: 'move';
      elementId: string;
      startClientX: number;
      startClientY: number;
      origX: number;
      origY: number;
      width: number;
      height: number;
    }
  | {
      kind: 'resize';
      elementId: string;
      handle: 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
      startClientX: number;
      startClientY: number;
      origX: number;
      origY: number;
      origW: number;
      origH: number;
      aspectLocked: boolean;
    }
  | {
      kind: 'rotate';
      elementId: string;
      centerX: number;
      centerY: number;
    };

export const StudioCanvasWorkspace: React.FC = () => {
  const {
    project,
    activeSceneId,
    selectedElementIds,
    setSelectedElementIds,
    updateElement,
    canvasZoom,
    showGrid,
    showSafeArea,
    showRulers,
    timelineTimeMs,
    timelinePlaying,
  } = useStudioStore();

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const holdRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resizeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resizeOrigin = useRef<{ x: number; y: number } | null>(null);
  const [gridSnapped, setGridSnapped] = useState(false);
  const clearHold = () => {
    if (holdRef.current) clearTimeout(holdRef.current);
    holdRef.current = null;
  };
  const openContextMenu = (x: number, y: number, elementId?: string) => {
    clearHold();
    if (resizeTimer.current) clearTimeout(resizeTimer.current);
    setDragState(null);
    setSnapGuides([]);
    if (elementId && !useStudioStore.getState().selectedElementIds.includes(elementId)) {
      setSelectedElementIds([elementId]);
    } else if (!elementId) setSelectedElementIds([]);
    setContextMenu({ x: Math.max(8, Math.min(x, window.innerWidth - 216)),
      y: Math.max(8, Math.min(y, window.innerHeight - 310)) });
  };
  useEffect(() => {
    const end = () => { clearHold(); };
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    window.addEventListener('blur', end);
    return () => {
      end();
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      window.removeEventListener('blur', end);
      if (resizeTimer.current) clearTimeout(resizeTimer.current);
    };
  }, []);
  useEffect(() => {
    if (!contextMenu) return;
    menuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    const close = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setContextMenu(null);
    };
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') setContextMenu(null); };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', escape);
    return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('keydown', escape); };
  }, [contextMenu]);

  const [dragState, setDragState] = useState<DragMode | null>(null);
  const [snapGuides, setSnapGuides] = useState<SnapGuide[]>([]);
  const [inlineEditingId, setInlineEditingId] = useState<string | null>(null);
  const canvasSurfaceRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const lockedScrollRef = useRef<{ left: number; top: number } | null>(null);

  const activeScene =
    project.scenes.find((s) => s.id === activeSceneId) ?? project.scenes[0];

  const evaluatedElements = useMemo(() => {
    if (!activeScene) return [];
    // While designing on the canvas (not actively playing the timeline preview),
    // always render objects in their actual authored position/size/rotation so
    // slide-in and motion objects are never stuck at their animation start offset.
    if (!timelinePlaying || dragState !== null) {
      return [...activeScene.elements].sort((a, b) => a.zIndex - b.zIndex);
    }
    return computeSceneElementsAtTime(
      activeScene.elements,
      activeScene.animationTracks,
      timelineTimeMs
    ).sort((a, b) => a.zIndex - b.zIndex);
  }, [activeScene, timelineTimeMs, timelinePlaying, dragState]);

  const primarySelected = useMemo(() => {
    if (!activeScene || selectedElementIds.length === 0) return null;
    return activeScene.elements.find((e) => e.id === selectedElementIds[0]) ?? null;
  }, [activeScene, selectedElementIds]);

  const applyDragCoordinates = useCallback(
    (clientX: number, clientY: number) => {
      if (!dragState || !activeScene) return;

      // Keep viewport scroll locked while dragging/resizing/rotating so wide scenes never auto-scroll
      if (viewportRef.current && lockedScrollRef.current) {
        viewportRef.current.scrollLeft = lockedScrollRef.current.left;
        viewportRef.current.scrollTop = lockedScrollRef.current.top;
      }

      if (dragState.kind === 'move') {
        const dx = (clientX - dragState.startClientX) / canvasZoom;
        const dy = (clientY - dragState.startClientY) / canvasZoom;
        const rawX = Math.round(dragState.origX + dx);
        const rawY = Math.round(dragState.origY + dy);

        const snapped = computeSnappedPosition(
          {
            id: dragState.elementId,
            x: rawX,
            y: rawY,
            width: dragState.width,
            height: dragState.height,
          },
          activeScene.elements,
          {
            snapToGrid: project.settings.snapToGrid,
            gridSizePx: project.settings.gridSizePx || 24,
            snapToElements: project.settings.snapToElements,
            canvasWidth: project.settings.width,
            canvasHeight: project.settings.height,
          }
        );

        setSnapGuides(snapped.guides);
        updateElement(dragState.elementId, { x: snapped.x, y: snapped.y }, false);
      } else if (dragState.kind === 'resize') {
        const dx = (clientX - dragState.startClientX) / canvasZoom;
        const dy = (clientY - dragState.startClientY) / canvasZoom;
        let nextX = dragState.origX;
        let nextY = dragState.origY;
        let nextW = dragState.origW;
        let nextH = dragState.origH;

        const h = dragState.handle;
        if (h.includes('e')) nextW = Math.max(24, Math.round(dragState.origW + dx));
        if (h.includes('s')) nextH = Math.max(24, Math.round(dragState.origH + dy));
        if (h.includes('w')) {
          const wCandidate = Math.max(24, Math.round(dragState.origW - dx));
          nextX = Math.round(dragState.origX + (dragState.origW - wCandidate));
          nextW = wCandidate;
        }
        if (h.includes('n')) {
          const hCandidate = Math.max(24, Math.round(dragState.origH - dy));
          nextY = Math.round(dragState.origY + (dragState.origH - hCandidate));
          nextH = hCandidate;
        }

        if (dragState.aspectLocked && dragState.origH > 0 && dragState.origW > 0) {
          const ratio = dragState.origW / dragState.origH;
          const horizontal = h.includes('e') || h.includes('w');
          const vertical = h.includes('n') || h.includes('s');
          // Use the dominant pointer axis on corners; keep the opposite corner fixed.
          const useWidth = horizontal && (!vertical || Math.abs(dx / dragState.origW) >= Math.abs(dy / dragState.origH));
          nextW = Math.max(24, 24 * ratio, useWidth ? nextW : nextH * ratio);
          nextH = nextW / ratio;
          if (h.includes('w')) nextX = dragState.origX + dragState.origW - nextW;
          if (h.includes('n')) nextY = dragState.origY + dragState.origH - nextH;
        }

        const raw = { x: nextX, y: nextY, width: nextW, height: nextH };
        if (!resizeOrigin.current || Math.hypot(clientX - resizeOrigin.current.x, clientY - resizeOrigin.current.y) > 5) {
          updateElement(dragState.elementId, raw, false);
        }
        // Restart the dwell only after meaningful movement, not pointer jitter.
        if (!resizeOrigin.current || Math.hypot(clientX - resizeOrigin.current.x, clientY - resizeOrigin.current.y) > 5) {
          resizeOrigin.current = { x: clientX, y: clientY };
          if (resizeTimer.current) clearTimeout(resizeTimer.current);
          setGridSnapped(false);
          resizeTimer.current = setTimeout(() => {
            if (!project.settings.snapToGrid) return;
            updateElement(dragState.elementId, snapResizeToGrid(raw, h,
              project.settings.gridSizePx, dragState.aspectLocked), false);
            setGridSnapped(true);
          }, 1800);
        }

      } else if (dragState.kind === 'rotate') {
        const rect = canvasSurfaceRef.current?.getBoundingClientRect();
        if (!rect) return;
        const localX = (clientX - rect.left) / canvasZoom;
        const localY = (clientY - rect.top) / canvasZoom;
        const angleRad = Math.atan2(localY - dragState.centerY, localX - dragState.centerX);
        const angleDeg = Math.round((angleRad * 180) / Math.PI + 90);
        updateElement(dragState.elementId, { rotation: angleDeg }, false);
      }
    },
    [dragState, activeScene, canvasZoom, project.settings, updateElement]
  );

  useEffect(() => {
    if (!dragState) {
      if (resizeTimer.current) clearTimeout(resizeTimer.current);
      resizeOrigin.current = null;
      setGridSnapped(false);
    }
  }, [dragState]);

  useEffect(() => {
    if (dragState?.kind === 'resize') {
      applyDragCoordinates(dragState.startClientX, dragState.startClientY);
    }
    // Initialize the dwell once per gesture, not on every project update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragState]);

  // Global window pointer listeners while dragging/resizing/rotating so wide scenes never scroll or drop pointer capture
  useEffect(() => {
    if (!dragState) {
      lockedScrollRef.current = null;
      return;
    }

    if (viewportRef.current) {
      lockedScrollRef.current = {
        left: viewportRef.current.scrollLeft,
        top: viewportRef.current.scrollTop,
      };
    }

    const onWindowPointerMove = (e: PointerEvent) => {
      e.preventDefault();
      applyDragCoordinates(e.clientX, e.clientY);
    };

    const onWindowPointerUp = () => {
      if (resizeTimer.current) clearTimeout(resizeTimer.current);
      setDragState(null);
      setSnapGuides([]);
      lockedScrollRef.current = null;
    };

    window.addEventListener('pointermove', onWindowPointerMove, { passive: false });
    window.addEventListener('pointerup', onWindowPointerUp);
    window.addEventListener('pointercancel', onWindowPointerUp);
    return () => {
      window.removeEventListener('pointermove', onWindowPointerMove);
      window.removeEventListener('pointerup', onWindowPointerUp);
      window.removeEventListener('pointercancel', onWindowPointerUp);
    };
  }, [dragState, applyDragCoordinates]);

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragState) return;
    e.preventDefault();
    applyDragCoordinates(e.clientX, e.clientY);
  };

  const handlePointerUp = () => {
    if (dragState) {
      if (resizeTimer.current) clearTimeout(resizeTimer.current);
      setDragState(null);
      setSnapGuides([]);
      lockedScrollRef.current = null;
    }
  };

  if (!activeScene) return null;

  const canvasW = project.settings.width;
  const canvasH = project.settings.height;
  const safeMarginX = Math.round(canvasW * 0.05);
  const safeMarginY = Math.round(canvasH * 0.05);

  const inlineEl = inlineEditingId
    ? activeScene.elements.find((e) => e.id === inlineEditingId)
    : null;

  return (
    <div
      ref={viewportRef}
      className={`studio-canvas-viewport ${dragState ? 'canvas-drag-active' : ''}`}
      onContextMenu={(e) => {
        if ((e.target as HTMLElement).closest('textarea,input')) return;
        e.preventDefault();
        const target = (e.target as HTMLElement).closest<HTMLElement>('[data-element-id]');
        openContextMenu(e.clientX, e.clientY, target?.dataset.elementId);
      }}
      onPointerDownCapture={(e) => {
        if (e.pointerType !== 'touch' || (e.target as HTMLElement).closest('.resize-handle,.rotation-handle,textarea,input')) return;
        clearHold();
        const target = (e.target as HTMLElement).closest<HTMLElement>('[data-element-id]');
        holdRef.current = setTimeout(() => openContextMenu(e.clientX, e.clientY, target?.dataset.elementId), 1500);
      }}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onScroll={() => {
        if (dragState && viewportRef.current && lockedScrollRef.current) {
          viewportRef.current.scrollLeft = lockedScrollRef.current.left;
          viewportRef.current.scrollTop = lockedScrollRef.current.top;
        }
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          setSelectedElementIds([]);
        }
      }}
    >
      {/* Rulers Header */}
      {showRulers && (
        <div className="canvas-ruler-badge">
          {canvasW} × {canvasH}px ({project.settings.scalingMode.toUpperCase()}) • Scene:{' '}
          {activeScene.name}
        </div>
      )}

      {/* Scaled Composition Stage */}
      <div
        className="canvas-stage-scaler"
        style={{
          width: `${canvasW * canvasZoom}px`,
          height: `${canvasH * canvasZoom}px`,
        }}
      >
        <div
          ref={canvasSurfaceRef}
          className="canvas-logical-surface"
          style={{
            width: `${canvasW}px`,
            height: `${canvasH}px`,
            transform: `scale(${canvasZoom})`,
            transformOrigin: 'top left',
            background: activeScene.backgroundGradient || activeScene.backgroundColor || '#090d16',
          }}
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) {
              setSelectedElementIds([]);
            }
          }}
        >
          {/* Optional Grid Overlay */}
          {((project.settings.gridVisible ?? showGrid) ||
            (dragState?.kind === 'resize' && (project.settings.gridShowDuringResize ?? true)) ||
            (dragState?.kind === 'move' && (project.settings.gridShowDuringMove ?? true))) && (
            <div
              className={`canvas-grid-overlay ${dragState?.kind === 'resize' ? 'resize-grid-active' : ''}`}
              style={{
                backgroundSize: `${project.settings.gridSizePx || 24}px ${project.settings.gridSizePx || 24}px`,
                backgroundImage: 'none',

              }}
            >
              <svg width="100%" height="100%" aria-hidden="true">
                <defs><pattern id="studio-grid-pattern" width={project.settings.gridSizePx || 24}
                  height={project.settings.gridSizePx || 24} patternUnits="userSpaceOnUse">
                  <path d={`M ${project.settings.gridSizePx || 24} 0 H 0 V ${project.settings.gridSizePx || 24}`}
                    fill="none" stroke={project.settings.gridColor ?? '#94a3b8'} strokeOpacity={0.4}
                    strokeWidth="1" strokeDasharray={project.settings.gridLineStyle === 'dashed' ? '6 4' : project.settings.gridLineStyle === 'dotted' ? '1 3' : undefined} />
                </pattern></defs>
                <rect width="100%" height="100%" fill="url(#studio-grid-pattern)" />
              </svg>
            </div>
          )}

          {/* Optional Broadcast Safe Area Overlay */}
          {showSafeArea && (
            <div
              className="canvas-safe-area-overlay"
              style={{
                left: `${safeMarginX}px`,
                top: `${safeMarginY}px`,
                width: `${canvasW - safeMarginX * 2}px`,
                height: `${canvasH - safeMarginY * 2}px`,
              }}
            >
              <span className="safe-area-tag">90% ACTION SAFE</span>
            </div>
          )}

          {/* Render All Scene Elements */}
          {evaluatedElements.map((el) => {
            if (el.type === 'group') {
              return null;
            }
            const isSelected = selectedElementIds.includes(el.id);
            return (
              <div
                key={el.id}
                data-element-id={el.id}
                style={{ touchAction: 'none', userSelect: 'none' }}
                onPointerDown={(e) => {
                  if (e.button !== 0) return;
                  e.stopPropagation();
                  e.preventDefault();
                  try {
                    e.currentTarget.setPointerCapture(e.pointerId);
                  } catch {
                    // Ignore in synthetic test environments
                  }
                  if (e.shiftKey || e.metaKey || e.ctrlKey) {
                    setSelectedElementIds(
                      isSelected
                        ? selectedElementIds.filter((id) => id !== el.id)
                        : [...selectedElementIds, el.id]
                    );
                  } else if (!isSelected) {
                    setSelectedElementIds([el.id]);
                  }

                  if (!el.locked) {
                    const rawEl = activeScene.elements.find((item) => item.id === el.id) ?? el;
                    useStudioStore.getState().commitProjectChange('Move Element', () => {});
                    setDragState({
                      kind: 'move',
                      elementId: el.id,
                      startClientX: e.clientX,
                      startClientY: e.clientY,
                      origX: rawEl.x,
                      origY: rawEl.y,
                      width: rawEl.width,
                      height: rawEl.height,
                    });
                  }
                }}
              >
                <SignageElementRenderer
                  element={el}
                  assets={project.assets}
                  currentTimeMs={timelineTimeMs}
                  sceneName={activeScene.name}
                  onDoubleClickText={(id) => setInlineEditingId(id)}
                />
              </div>
            );
          })}

          {/* Multi-Selection & Group Member Outlines */}
          {activeScene.elements
            .filter((el) => {
              if (!el.visible || el.type === 'group') return false;
              if (primarySelected && el.id === primarySelected.id) return false;
              const isMultiSelected = selectedElementIds.includes(el.id);
              const isSameGroup =
                Boolean(primarySelected?.parentGroupId) &&
                el.parentGroupId === primarySelected?.parentGroupId;
              return isMultiSelected || isSameGroup;
            })
            .map((el) => (
              <div
                key={`group-outline-${el.id}`}
                className="group-sibling-bounding-box"
                style={{
                  position: 'absolute',
                  left: `${el.x}px`,
                  top: `${el.y}px`,
                  width: `${el.width}px`,
                  height: `${el.height}px`,
                  transform: `rotate(${el.rotation || 0}deg)`,
                  border: '2px dashed #38bdf8',
                  borderRadius: '4px',
                  pointerEvents: 'none',
                  zIndex: 9998,
                }}
              >
                <span
                  style={{
                    position: 'absolute',
                    top: '-20px',
                    left: 0,
                    background: 'rgba(14, 165, 233, 0.9)',
                    color: '#fff',
                    fontSize: '10px',
                    fontWeight: 700,
                    padding: '1px 6px',
                    borderRadius: '3px',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {el.parentGroupId ? `🔗 ${el.name}` : el.name}
                </span>
              </div>
            ))}

          {/* Dynamic Alignment Snap Guides */}
          {snapGuides.map((g, idx) =>
            g.orientation === 'vertical' ? (
              <div
                key={idx}
                className="snap-guide-vertical"
                style={{ left: `${g.position}px` }}
              />
            ) : (
              <div
                key={idx}
                className="snap-guide-horizontal"
                style={{ top: `${g.position}px` }}
              />
            )
          )}

          {/* Selection Bounding Box & 8 Resize + 1 Rotate Handle */}
          {primarySelected && primarySelected.visible && (
            <div
              data-element-id={primarySelected.id}
              className="selection-bounding-box"
              style={{
                left: `${primarySelected.x}px`,
                top: `${primarySelected.y}px`,
                width: `${primarySelected.width}px`,
                height: `${primarySelected.height}px`,
                transform: `rotate(${primarySelected.rotation || 0}deg)`,
              }}
            >
              <div className="selection-dimension-pill">
                {dragState?.kind === 'resize' && project.settings.snapToGrid && (gridSnapped ? '✓ Grid snapped · ' : 'Hold 1.8s to snap · ')}
                {primarySelected.parentGroupId ? '🔗 [GROUP] ' : ''}
                {primarySelected.name} ({Math.round(primarySelected.width)} ×{' '}
                {Math.round(primarySelected.height)})
              </div>

              {!primarySelected.locked && (
                <>
                  {/* Rotation Handle */}
                  <div
                    className="rotation-handle"
                    title="Drag to Rotate"
                    style={{ touchAction: 'none', userSelect: 'none' }}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      try {
                        e.currentTarget.setPointerCapture(e.pointerId);
                      } catch {
                        // Ignore in synthetic test environments
                      }
                      setDragState({
                        kind: 'rotate',
                        elementId: primarySelected.id,
                        centerX: primarySelected.x + primarySelected.width / 2,
                        centerY: primarySelected.y + primarySelected.height / 2,
                      });
                    }}
                  />

                  {/* 8 Resize Handles */}
                  {(['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const).filter(handle => !activeScene.aspectRatioLocked || handle.length === 2).map((handle) => (
                    <div
                      key={handle}
                      className={`resize-handle handle-${handle}`}
                      style={{ touchAction: 'none', userSelect: 'none' }}
                      onPointerDown={(e) => {
                        if (e.button !== 0) return;
                        e.stopPropagation();
                        e.preventDefault();
                        useStudioStore.getState().commitProjectChange('Resize Element', () => {});
                        try {
                          e.currentTarget.setPointerCapture(e.pointerId);
                        } catch {
                          // Ignore in synthetic test environments
                        }
                        setDragState({
                          kind: 'resize',
                          elementId: primarySelected.id,
                          handle,
                          startClientX: e.clientX,
                          startClientY: e.clientY,
                          origX: primarySelected.x,
                          origY: primarySelected.y,
                          origW: primarySelected.width,
                          origH: primarySelected.height,
                          aspectLocked: Boolean(activeScene.aspectRatioLocked || primarySelected.aspectRatioLocked),
                        });
                      }}
                    />
                  ))}
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {contextMenu && createPortal(
        <div ref={menuRef} role="menu" aria-label="Component actions" className="canvas-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onContextMenu={(e) => e.preventDefault()}
          onKeyDown={(e) => {
            if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
              e.preventDefault();
              const buttons = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
              const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
              const next = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 :
                (index + (e.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length;
              buttons[next]?.focus();
            }
          }}>
          {[
            { label: 'Copy', action: useStudioStore.getState().copySelectedElements },
            { label: 'Cut', action: useStudioStore.getState().cutSelectedElements },
            { label: 'Paste', action: useStudioStore.getState().pasteElements, enabled: useStudioStore.getState().clipboardElements.length > 0 },
            { label: 'Duplicate', action: useStudioStore.getState().duplicateSelectedElements },
            { label: 'Delete', action: useStudioStore.getState().deleteSelectedElements },
            { label: 'Properties', action: () => {
              useStudioStore.getState().setRightInspectorCollapsed(false);
              window.dispatchEvent(new Event('studio:show-properties'));
            } },
          ].map(({ label, action, enabled }) => (
            <button key={label} role="menuitem" disabled={!(enabled ?? selectedElementIds.length > 0)}
              onClick={() => { action(); setContextMenu(null); }}>{label}</button>
          ))}
        </div>, document.body
      )}

      {/* Inline Text Editing Modal */}
      {inlineEl && inlineEl.textProps && (
        <div className="inline-edit-backdrop" onClick={() => setInlineEditingId(null)}>
          <div className="inline-edit-dialog" onClick={(e) => e.stopPropagation()}>
            <h4>Edit Text Layer: {inlineEl.name}</h4>
            <textarea
              className="inspector-textarea"
              rows={4}
              value={inlineEl.textProps.text}
              onChange={(e) =>
                updateElement(inlineEl.id, {
                  textProps: { ...inlineEl.textProps!, text: e.target.value },
                })
              }
            />
            <div className="dialog-footer">
              <span className="muted-line">
                Supports dynamic variables: {'{{time}}'}, {'{{date}}'}, {'{{deviceName}}'}
              </span>
              <button className="btn-primary" onClick={() => setInlineEditingId(null)}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
