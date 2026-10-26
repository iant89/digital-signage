import React from 'react';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { render, fireEvent, screen, act, cleanup } from '@testing-library/react';
import { StudioGridSettings } from '../../src/components/studio/StudioGridSettings';
import { StudioCanvasWorkspace } from '../../src/components/studio/StudioCanvasWorkspace';
import { useStudioStore } from '../../src/store/useStudioStore';
import { snapResizeToGrid } from '../../src/components/studio/resizeGrid';

beforeEach(() => {
  vi.useFakeTimers();
  // jsdom does not supply PointerEvent coordinates/type.
  class TestPointerEvent extends MouseEvent {
    pointerType: string;
    constructor(type: string, options: PointerEventInit = {}) {
      super(type, options); this.pointerType = options.pointerType || 'mouse';
    }
  }
  vi.stubGlobal('PointerEvent', TestPointerEvent);
  useStudioStore.getState().resetToStarterProject();
  useStudioStore.setState({ selectedElementIds: [], clipboardElements: [], showGrid: false });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
const firstElement = () => useStudioStore.getState().project.scenes[0].elements.find(e => e.type !== 'group')!;

describe('canvas context menu and resize grid', () => {
  it('selects the right-clicked component and supports copy, paste, cut and undo', () => {
    const { container } = render(<StudioCanvasWorkspace />);
    const el = firstElement();
    const target = container.querySelector(`[data-element-id="${el.id}"]`)!;
    fireEvent.contextMenu(target, { clientX: 100, clientY: 100 });
    expect(useStudioStore.getState().selectedElementIds).toEqual([el.id]);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy' }));
    fireEvent.contextMenu(container.querySelector('.canvas-logical-surface')!);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Paste' }));
    expect(useStudioStore.getState().project.scenes[0].elements.length).toBeGreaterThan(1);
    fireEvent.contextMenu(target);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Cut' }));
    expect(useStudioStore.getState().project.scenes[0].elements.some(e => e.id === el.id)).toBe(false);
    act(() => useStudioStore.getState().undo());
    expect(useStudioStore.getState().project.scenes[0].elements.some(e => e.id === el.id)).toBe(true);
  });

  it('keeps the touch menu open through movement and release until an outside press', () => {
    const { container } = render(<StudioCanvasWorkspace />);
    const target = container.querySelector(`[data-element-id="${firstElement().id}"]`)!;
    fireEvent.pointerDown(target, { pointerType: 'touch', clientX: 100, clientY: 100 });
    act(() => vi.advanceTimersByTime(1500));
    expect(screen.getByRole('menu')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.pointerDown(target, { pointerType: 'touch', clientX: 100, clientY: 100 });
    fireEvent.pointerMove(window, { clientX: 150, clientY: 100 });
    act(() => vi.advanceTimersByTime(1800));
    expect(screen.getByRole('menu')).toBeTruthy();
    fireEvent.pointerMove(window, { clientX: 180, clientY: 120 });
    fireEvent.pointerUp(window);
    expect(screen.getByRole('menu')).toBeTruthy();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('shows the temporary grid, waits for dwell, snaps and hides on release', () => {
    const el = firstElement();
    act(() => {
      useStudioStore.getState().updateElement(el.id, { x: 0, y: 0, width: 100, height: 100, aspectRatioLocked: false });
      useStudioStore.setState({ selectedElementIds: [el.id], canvasZoom: 1 });
    });
    const { container } = render(<StudioCanvasWorkspace />);
    fireEvent.pointerDown(container.querySelector('.handle-se')!, { clientX: 100, clientY: 100 });
    expect(container.querySelector('.resize-grid-active')).toBeTruthy();
    fireEvent.pointerMove(window, { clientX: 113, clientY: 113 });
    act(() => vi.advanceTimersByTime(1799));
    expect(firstElement().width).toBe(113);
    act(() => vi.advanceTimersByTime(1));
    const grid = useStudioStore.getState().project.settings.gridSizePx;
    expect(firstElement().width % grid).toBe(0);
    fireEvent.pointerUp(window);
    expect(container.querySelector('.canvas-grid-overlay')).toBeNull();
    act(() => useStudioStore.getState().undo());
    expect(firstElement().width).toBe(100);
  });

  it('edits saved grid preferences, renders line styles and supports undo', () => {
    const { container } = render(<><StudioGridSettings /><StudioCanvasWorkspace /></>);
    fireEvent.click(screen.getByRole('button', { name: 'Grid settings' }));
    expect(screen.getByRole('dialog', { name: 'Grid settings' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Grid spacing (px)'), { target: { value: '32' } });
    fireEvent.change(screen.getByLabelText('Grid color'), { target: { value: '#ff0000' } });
    fireEvent.change(screen.getByLabelText('Grid line style'), { target: { value: 'dashed' } });
    fireEvent.click(screen.getByLabelText('Show grid'));
    expect(container.querySelector('pattern')?.getAttribute('width')).toBe('32');
    expect(container.querySelector('pattern path')?.getAttribute('stroke')).toBe('#ff0000');
    expect(container.querySelector('pattern path')?.getAttribute('stroke-dasharray')).toBe('6 4');
    fireEvent.click(screen.getByLabelText('Show grid'));
    expect(container.querySelector('.canvas-grid-overlay')).toBeNull();
    act(() => useStudioStore.getState().undo());
    expect(container.querySelector('.canvas-grid-overlay')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('respects disabled resize visibility and disabled snapping', () => {
    const el = firstElement();
    act(() => {
      useStudioStore.getState().commitProjectChange('Test preferences', draft => {
        draft.settings.gridVisible = false;
        draft.settings.gridShowDuringResize = false;
        draft.settings.snapToGrid = false;
      });
      useStudioStore.getState().updateElement(el.id, { x: 0, y: 0, width: 100, height: 100, aspectRatioLocked: false });
      useStudioStore.setState({ selectedElementIds: [el.id], canvasZoom: 1 });
    });
    const { container } = render(<StudioCanvasWorkspace />);
    fireEvent.pointerDown(container.querySelector('.handle-se')!, { clientX: 100, clientY: 100 });
    fireEvent.pointerMove(window, { clientX: 113, clientY: 113 });
    act(() => vi.advanceTimersByTime(1800));
    expect(container.querySelector('.canvas-grid-overlay')).toBeNull();
    expect(firstElement().width).toBe(113);
    fireEvent.pointerUp(window);
  });

  it('scene aspect lock exposes four corners and preserves ratios and opposite anchors', () => {
    const el = firstElement();
    act(() => {
      useStudioStore.getState().updateScene(useStudioStore.getState().activeSceneId, { aspectRatioLocked: true });
      useStudioStore.getState().commitProjectChange('Disable snap for test', draft => { draft.settings.snapToGrid = false; });
      useStudioStore.setState({ selectedElementIds: [el.id], canvasZoom: 1 });
    });
    const { container } = render(<StudioCanvasWorkspace />);
    expect(container.querySelectorAll('.resize-handle').length).toBe(4);
    expect(container.querySelector('.handle-n')).toBeNull();
    for (const corner of ['nw', 'ne', 'sw', 'se']) {
      act(() => useStudioStore.getState().updateElement(el.id, {
        x: 100, y: 100, width: 200, height: 100, aspectRatioLocked: false,
      }));
      fireEvent.pointerDown(container.querySelector(`.handle-${corner}`)!, { clientX: 100, clientY: 100 });
      fireEvent.pointerMove(window, { clientX: 120, clientY: 140 });
      const resized = firstElement();
      expect(resized.width / resized.height).toBeCloseTo(2);
      expect(corner.includes('w') ? resized.x + resized.width : resized.x).toBe( corner.includes('w') ? 300 : 100 );
      expect(corner.includes('n') ? resized.y + resized.height : resized.y).toBe( corner.includes('n') ? 200 : 100 );
      fireEvent.pointerUp(window);
    }
    act(() => useStudioStore.getState().updateScene(useStudioStore.getState().activeSceneId, { aspectRatioLocked: false }));
    expect(container.querySelectorAll('.resize-handle').length).toBe(8);
    act(() => useStudioStore.getState().undo());
    expect(container.querySelectorAll('.resize-handle').length).toBe(4);
  });

  it('anchors opposite edges and preserves aspect ratio when snapping', () => {
    expect(snapResizeToGrid({ x: 13, y: 13, width: 100, height: 100 }, 'nw', 24))
      .toEqual({ x: 24, y: 24, width: 89, height: 89 });
    const result = snapResizeToGrid({ x: 0, y: 0, width: 110, height: 55 }, 'se', 24, true);
    expect(result.width / result.height).toBe(2);
  });
});
