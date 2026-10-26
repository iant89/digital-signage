import React from 'react';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { StudioNewSceneDialog } from '../../src/components/studio/StudioNewSceneDialog';
import { StudioLeftSidebar } from '../../src/components/studio/StudioLeftSidebar';
import { useStudioStore } from '../../src/store/useStudioStore';
import { SCENE_TEMPLATES, instantiateSceneTemplate } from '../../packages/scene-templates';

beforeEach(() => useStudioStore.getState().resetToStarterProject());
afterEach(cleanup);

describe('scene template workflow', () => {
  it('opens the choice from New Scene and creates a truly blank scene', () => {
    render(<StudioLeftSidebar />);
    fireEvent.click(screen.getByRole('button', { name: /Scenes \(/i }));
    const count = useStudioStore.getState().project.scenes.length;
    fireEvent.click(screen.getByRole('button', { name: /New Scene/i }));
    expect(screen.getByRole('dialog', { name: 'Create a new scene' })).toBeTruthy();
    expect(useStudioStore.getState().project.scenes).toHaveLength(count);
    fireEvent.click(screen.getByRole('button', { name: /Blank scene/i }));
    expect(screen.queryByRole('dialog')).toBeNull();
    const state = useStudioStore.getState();
    expect(state.project.scenes).toHaveLength(count + 1);
    expect(state.project.scenes.at(-1)?.elements).toHaveLength(0);
    expect(state.activeSceneId).toBe(state.project.scenes.at(-1)?.id);
    expect(state.project.playlists[0].items.at(-1)?.sceneId).toBe(state.activeSceneId);
  });
  it('browses previews and dimensions, searches, filters and adds an editable template with undo', () => {
    render(<StudioNewSceneDialog onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Choose a template/i }));
    expect(screen.getAllByRole('img')).toHaveLength(SCENE_TEMPLATES.length);
    const card = screen.getByRole('article', { name: 'Event Spotlight' });
    expect(within(card).getByText(/1080 × 1920 px/)).toBeTruthy();
    expect(within(card).getByRole('button', { name: 'Select Event Spotlight' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Search templates'), { target: { value: 'nothing matches' } });
    expect(screen.getByRole('status').textContent).toContain('No templates');
    fireEvent.change(screen.getByLabelText('Search templates'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Template category'), { target: { value: 'Events' } });
    expect(screen.getAllByRole('article')).toHaveLength(1);
    const before = useStudioStore.getState().project.scenes.length;
    fireEvent.click(screen.getByRole('button', { name: 'Select Event Spotlight' }));
    const project = useStudioStore.getState().project;
    expect(project.scenes).toHaveLength(before + 1);
    expect(project.scenes.at(-1)?.name).toBe('Event Spotlight');
    expect(project.scenes.at(-1)?.referenceWidth).toBe(project.settings.width);
    expect(project.scenes.at(-1)?.elements.length).toBeGreaterThan(0);
    act(() => useStudioStore.getState().undo());
    expect(useStudioStore.getState().project.scenes).toHaveLength(before);
  });
  it('cancels either dialog without adding a scene and supports returning to the choice', () => {
    render(<StudioLeftSidebar />);
    fireEvent.click(screen.getByRole('button', { name: /Scenes \(/i }));
    const count = useStudioStore.getState().project.scenes.length;
    fireEvent.click(screen.getByRole('button', { name: /New Scene/i }));
    fireEvent.click(screen.getByRole('button', { name: /Choose a template/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('dialog', { name: 'Create a new scene' })).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(useStudioStore.getState().project.scenes).toHaveLength(count);
  });

  it('keeps mobile previews isolated and selects a template with a touch-generated click', () => {
    const originalWidth = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    try {
      render(<StudioLeftSidebar />);
      fireEvent.click(screen.getByRole('button', { name: /Scenes \(/i }));
      fireEvent.click(screen.getByRole('button', { name: /New Scene/i }));
      fireEvent.click(screen.getByRole('button', { name: /Choose a template/i }));
      const preview = screen.getByRole('img', { name: 'Corporate Welcome preview' });
      expect(preview.tagName).toBe('DIV');
      expect(preview.querySelector('foreignObject')).toBeNull();
      expect((preview.firstElementChild as HTMLElement).style.pointerEvents).toBe('none');
      const select = screen.getByRole('button', { name: 'Select Corporate Welcome' });
      expect(preview.contains(select)).toBe(false);
      const before = useStudioStore.getState().project.scenes.length;
      fireEvent.touchStart(select, { touches: [{ clientX: 160, clientY: 530 }] });
      fireEvent.touchEnd(select, { changedTouches: [{ clientX: 160, clientY: 530 }] });
      fireEvent.click(select); // Browsers synthesize click after a successful tap.
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(useStudioStore.getState().project.scenes).toHaveLength(before + 1);
      const state = useStudioStore.getState();
      expect(state.project.scenes.find(s => s.id === state.activeSceneId)?.name).toBe('Corporate Welcome');
    } finally {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth });
    }
  });

  it('provides complete layered designs with readable explicit typography', () => {
    for (const template of SCENE_TEMPLATES) {
      const scene = instantiateSceneTemplate(template.id);
      expect(scene.elements.length).toBeGreaterThanOrEqual(10);
      expect(scene.elements.filter(e => e.type === 'shape').length).toBeGreaterThanOrEqual(3);
      for (const e of scene.elements.filter(e => e.textProps)) {
        expect(e.textProps?.autoFit).toBe(false);
        expect(e.textProps?.verticalAlign).toBe('top');
        expect(e.textProps!.fontSize * e.textProps!.lineHeight).toBeLessThanOrEqual(e.height + 1);
      }
    }
  });

  it('allocates independent ids and fits every layout inside landscape and portrait canvases', () => {
    for (const template of SCENE_TEMPLATES) {
      for (const [w, h] of [[1920, 1080], [1080, 1920], [1080, 1080]]) {
        const a = instantiateSceneTemplate(template.id, w, h);
        const b = instantiateSceneTemplate(template.id, w, h);
        expect(a.id).not.toBe(b.id);
        expect(a.elements.some(e => b.elements.some(other => other.id === e.id))).toBe(false);
        for (const e of a.elements) {
          expect(e.x).toBeGreaterThanOrEqual(0); expect(e.y).toBeGreaterThanOrEqual(0);
          expect(e.x + e.width).toBeLessThanOrEqual(w + .01);
          expect(e.y + e.height).toBeLessThanOrEqual(h + .01);
        }
      }
    }
    expect(() => instantiateSceneTemplate('bad')).toThrow();
  });
});
