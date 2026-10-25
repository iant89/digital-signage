// ============================================================================
// src/components/studio/StudioCanvasWorkspace.tsx — Interactive Visual Canvas
// Logical Reference Resolution, Rulers, Snap Guides, Resize/Rotate Handles
// ============================================================================

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
  } = useStudioStore();

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
    return computeSceneElementsAtTime(
      activeScene.elements,
      activeScene.animationTracks,
      timelineTimeMs
    ).sort((a, b) => a.zIndex - b.zIndex);
  }, [activeScene, timelineTimeMs]);

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

        if (dragState.aspectLocked && dragState.origH > 0) {
          const ratio = dragState.origW / dragState.origH;
          nextH = Math.max(24, Math.round(nextW / ratio));
        }

        updateElement(
          dragState.elementId,
          { x: nextX, y: nextY, width: nextW, height: nextH },
          false
        );
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
          {showGrid && (
            <div
              className="canvas-grid-overlay"
              style={{
                backgroundSize: `${project.settings.gridSizePx * 2}px ${project.settings.gridSizePx * 2}px`,
              }}
            />
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
            const isSelected = selectedElementIds.includes(el.id);
            return (
              <div
                key={el.id}
                style={{ touchAction: 'none', userSelect: 'none' }}
                onPointerDown={(e) => {
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
                  {(['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const).map((handle) => (
                    <div
                      key={handle}
                      className={`resize-handle handle-${handle}`}
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
                          kind: 'resize',
                          elementId: primarySelected.id,
                          handle,
                          startClientX: e.clientX,
                          startClientY: e.clientY,
                          origX: primarySelected.x,
                          origY: primarySelected.y,
                          origW: primarySelected.width,
                          origH: primarySelected.height,
                          aspectLocked: primarySelected.aspectRatioLocked,
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
