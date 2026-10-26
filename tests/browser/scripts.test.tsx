import React from 'react';
import { afterEach, describe, it, expect } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { StudioScriptEditor } from '../../src/components/studio/StudioScriptEditor';
import { useStudioStore } from '../../src/store/useStudioStore';
import { usePlaybackScripts } from '../../src/components/player/usePlaybackScripts';
import { createStarterProject } from '../../packages/project-model';
import { evaluateAuthoritativeTimeline } from '../../packages/playback-engine';

afterEach(cleanup);
describe('script authoring and playback integration', () => {
  it('creates, validates, binds, saves and deletes a script with undo', () => {
    useStudioStore.getState().resetToStarterProject();
    render(<StudioScriptEditor />);
    fireEvent.click(screen.getByRole('button', { name: 'New script' }));
    const input = screen.getByLabelText('Script JSON');
    const script = JSON.parse((input as HTMLTextAreaElement).value);
    script.name = 'My script';
    fireEvent.change(input, { target: { value: JSON.stringify(script) } });
    fireEvent.click(screen.getByRole('button', { name: 'Validate & save script' }));
    expect(screen.getByRole('status').textContent).toContain('saved');
    fireEvent.click(screen.getByLabelText('Run in this scene'));
    expect(useStudioStore.getState().project.scenes[0].scriptIds).toContain(script.id);
    fireEvent.change(input, { target: { value: 'bad javascript' } });
    fireEvent.click(screen.getByRole('button', { name: 'Validate & save script' }));
    expect(useStudioStore.getState().project.scripts.find(s => s.id === script.id)?.name).toBe('My script');
    fireEvent.click(screen.getByRole('button', { name: 'Delete script' }));
    expect(useStudioStore.getState().project.scripts.some(s => s.id === script.id)).toBe(false);
    act(() => useStudioStore.getState().undo());
    expect(useStudioStore.getState().project.scripts.some(s => s.id === script.id)).toBe(true);
  });
  it('applies player script output without mutating the loaded project and resets on scene change', () => {
    const project = createStarterProject();
    const session = { sessionId: 't', groupId: 'g', packageId: 'p', packageVersion: 1, playlistId: project.playlists[0].id,
      playlistRevision: 1, timelineRevision: 1, startTimeUtc: new Date(0).toISOString(), status: 'RUNNING' as const,
      synchronizationPolicy: 'TIMELINE_SYNC' as const, failurePolicy: 'START_WITH_AVAILABLE' as const };
    const at = (time: number) => evaluateAuthoritativeTimeline(project, project.playlists[0], session, time);
    const original = JSON.stringify(project);
    const commands: string[] = [];
    const { result, rerender } = renderHook(({ time }) => usePlaybackScripts(project, at(time), true, m => commands.push(m.actionType)), { initialProps: { time: 0 } });
    rerender({ time: 5000 });
    expect(result.current.elements.find(e => e.id === 'el-subheading')?.textProps?.text).toContain('Synchronized');
    expect(commands).toContain('log');
    expect(JSON.stringify(project)).toBe(original);
    rerender({ time: 13000 });
    expect(result.current.elements.some(e => e.id === 'el-subheading')).toBe(false);
  });
  it('routes click and named host events, forwards navigation, and gates animation control', () => {
    const project = createStarterProject();
    const scene = project.scenes[0];
    project.permissions.push('scene:transition', 'playlist:select', 'animation:control');
    scene.permissions.push('scene:transition', 'playlist:select', 'animation:control');
    const script = project.scripts[0];
    script.permissions.push('scene:transition', 'playlist:select', 'animation:control');
    script.rules = [
      { id: 'click', hook: 'onEvent', eventName: 'click', actions: [{ type: 'setVisibility', elementId: scene.elements[0].id, value: false }] },
      { id: 'host', hook: 'onEvent', eventName: 'alarm', actions: [
        { type: 'transitionToScene', sceneId: project.scenes[1].id },
        { type: 'selectPlaylist', playlistId: project.playlists[0].id },
        { type: 'triggerAnimation', elementId: scene.elements[0].id },
      ] },
    ];
    const timeline = { activeScene: scene, elements: scene.elements, sceneElapsedMs: 0, cycleIndex: 0, activeSlotIndex: 0 } as never;
    const commands: string[] = [];
    const { result, unmount } = renderHook(() => usePlaybackScripts(project, timeline, true, m => commands.push(m.actionType)));
    act(() => result.current.event('click'));
    expect(result.current.elements[0].visible).toBe(false);
    act(() => window.dispatchEvent(new CustomEvent('signage:script-event', { detail: { name: 'alarm' } })));
    expect(commands).toEqual(['transitionToScene', 'selectPlaylist']);
    unmount();
    act(() => window.dispatchEvent(new CustomEvent('signage:script-event', { detail: { name: 'alarm' } })));
    expect(commands).toHaveLength(2);
  });

});
