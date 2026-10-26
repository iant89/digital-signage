import React from 'react';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { StudioTopToolbar } from '../../src/components/studio/StudioTopToolbar';
import { StudioNewSceneDialog } from '../../src/components/studio/StudioNewSceneDialog';
import { useStudioStore } from '../../src/store/useStudioStore';
import { TEMPLATE_LIBRARY_KEY, loadTemplateLibrary, useTemplateLibrary } from '../../src/services/templateLibrary';
import { exportSceneTemplate, instantiateSavedTemplate } from '../../packages/scene-templates/export';

beforeEach(() => {
  localStorage.removeItem(TEMPLATE_LIBRARY_KEY);
  useTemplateLibrary.setState({ templates: [] });
  useStudioStore.getState().resetToStarterProject();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('scene template export and personal library', () => {
  it('downloads the active scene and immediately lists it in the persistent library', () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const originalCreate = URL.createObjectURL;
    URL.createObjectURL = vi.fn(() => 'blob:template-test');
    URL.revokeObjectURL = vi.fn();
    const { unmount } = render(<StudioTopToolbar />);
    const state = useStudioStore.getState();
    const original = JSON.stringify(state.project);
    fireEvent.click(screen.getByRole('button', { name: 'Export Scene Template' }));
    expect(click).toHaveBeenCalledOnce();
    expect((click.mock.contexts[0] as unknown as HTMLAnchorElement).download).toMatch(/\.signage-template\.json$/);
    expect(loadTemplateLibrary()).toHaveLength(1);
    expect(useTemplateLibrary.getState().templates).toHaveLength(1);
    expect(JSON.stringify(useStudioStore.getState().project)).toBe(original);
    const saved = loadTemplateLibrary()[0];
    expect(saved.scene.elements).toHaveLength(state.project.scenes[0].elements.length);
    unmount();
    render(<StudioNewSceneDialog onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Choose a template/i }));
    fireEvent.change(screen.getByLabelText('Template category'), { target: { value: 'My Templates' } });
    expect(screen.getByRole('img', { name: `${saved.name} preview` })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: `Select ${saved.name}` }));
    expect(useStudioStore.getState().project.scenes).toHaveLength(state.project.scenes.length + 1);
    act(() => useStudioStore.getState().undo());
    expect(useStudioStore.getState().project.scenes).toHaveLength(state.project.scenes.length);
    URL.createObjectURL = originalCreate;
  });

  it('retains media, animation, grouping, scene settings and scripts with independent ids', () => {
    const state = useStudioStore.getState();
    const project = structuredClone(state.project);
    const scene = project.scenes[0]; scene.aspectRatioLocked = true;
    scene.elements[1].parentGroupId = scene.elements[0].id;
    scene.elements[0].groupChildrenIds = [scene.elements[1].id];
    const template = exportSceneTemplate(project, scene.id);
    const before = JSON.stringify(template);
    const copy = instantiateSavedTemplate(template, project.settings.width, project.settings.height);
    expect(copy.scene.id).not.toBe(scene.id);
    expect(copy.scene.aspectRatioLocked).toBe(true);
    expect(copy.scene.elements[1].parentGroupId).toBe(copy.scene.elements[0].id);
    expect(copy.scene.elements[0].groupChildrenIds).toEqual([copy.scene.elements[1].id]);
    for (const element of copy.scene.elements) {
      expect(scene.elements.some(e => e.id === element.id)).toBe(false);
      if (element.mediaProps) expect(copy.assets.some(a => a.id === element.mediaProps?.assetId)).toBe(true);
    }
    for (const track of copy.scene.animationTracks) {
      expect(copy.scene.elements.some(e => e.id === track.elementId)).toBe(true);
    }
    expect(copy.scene.scriptIds).toEqual(copy.scripts.map(s => s.id));
    expect(JSON.stringify(template)).toBe(before);
    expect(copy.assets.every(a => a.dataUrl.startsWith('data:'))).toBe(true);
  });

  it('reports storage failure and rejects missing or external media', () => {
    const state = useStudioStore.getState();
    const template = exportSceneTemplate(state.project, state.activeSceneId);
    const storage = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    expect(() => useTemplateLibrary.getState().save(template)).toThrow(/full or unavailable/);
    expect(useTemplateLibrary.getState().templates).toHaveLength(0);
    storage.mockRestore();
    const project = structuredClone(state.project);
    const media = project.scenes[0].elements.find(e => e.mediaProps)!;
    project.assets = project.assets.filter(a => a.id !== media.mediaProps!.assetId);
    expect(() => exportSceneTemplate(project, project.scenes[0].id)).toThrow(/missing media/);
  });
});
