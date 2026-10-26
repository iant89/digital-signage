import { describe, it, expect, vi } from 'vitest';
import { createStarterProject, ScriptModule } from '../../packages/project-model';
import { ScriptPlaybackSession, parseScriptModule, SCRIPT_PERMISSIONS } from '../../packages/script-runtime/session';
import { ScriptHostMessage, RestrictedScriptRuntime } from '../../packages/script-runtime';

function fixture() {
  const project = createStarterProject();
  project.permissions = [...SCRIPT_PERMISSIONS];
  const scene = project.scenes[0]; scene.permissions = [...SCRIPT_PERMISSIONS];
  const script: ScriptModule = { id: 'test', name: 'Test', description: '', enabled: true, permissions: [...SCRIPT_PERMISSIONS], rules: [
    { id: 'init', hook: 'initialize', actions: [{ type: 'log', level: 'info', message: 'init' }] },
    { id: 'enter', hook: 'onSceneEnter', actions: [{ type: 'setOpacity', elementId: scene.elements[0].id, value: 0.5 }] },
    { id: 'tick', hook: 'onTick', once: true, condition: { field: 'elapsedMs', operator: 'gte', value: 500 }, actions: [{ type: 'setText', elementId: 'el-subheading', value: 'Updated' }] },
    { id: 'click', hook: 'onEvent', eventName: 'click', actions: [{ type: 'setVisibility', elementId: scene.elements[0].id, value: false }] },
    { id: 'exit', hook: 'onSceneExit', actions: [{ type: 'log', level: 'info', message: 'exit' }] },
    { id: 'dispose', hook: 'dispose', actions: [{ type: 'log', level: 'info', message: 'dispose' }] },
  ] };
  project.scripts = [script]; scene.scriptIds = [script.id];
  const messages: ScriptHostMessage[] = [];
  const session = new ScriptPlaybackSession(project, output => messages.push(...output));
  return { project, scene, script, session, messages };
}
describe('script playback lifecycle', () => {
  it('runs lifecycle, throttles ticks, fires once, routes events and restarts on loop', () => {
    const { scene, session, messages } = fixture();
    session.step(scene, '0:0', 0, true);
    expect(messages.map(m => m.actionType)).toEqual(['log', 'setOpacity']);
    session.step(scene, '0:0', 500, false);
    expect(messages.some(m => m.actionType === 'setText')).toBe(false);
    session.step(scene, '0:0', 500, true);
    session.step(scene, '0:0', 700, true);
    expect(messages.filter(m => m.actionType === 'setText')).toHaveLength(1);
    session.event('other'); session.event('click');
    expect(messages.filter(m => m.actionType === 'setVisibility')).toHaveLength(1);
    session.step(scene, '1:0', 0, true);
    expect(messages.filter(m => m.message === 'exit')).toHaveLength(1);
    expect(messages.filter(m => m.message === 'init')).toHaveLength(2);
    session.dispose();
    expect(messages.filter(m => m.message === 'dispose')).toHaveLength(2);
    const count = messages.length; session.event('click'); expect(messages).toHaveLength(count);
  });
  it('requires binding, enabled state and all three permission layers', () => {
    const { scene, script, project, messages } = fixture();
    scene.permissions = [];
    const session = new ScriptPlaybackSession(project, m => messages.push(...m));
    session.step(scene, 'a', 600, true);
    expect(messages).toHaveLength(0);
    expect(session.diagnostics.some(d => d.deniedActions.length)).toBe(true);
    session.dispose(); scene.permissions = [...SCRIPT_PERMISSIONS]; script.enabled = false;
    session.step(scene, 'b', 0, true); expect(messages).toHaveLength(0);
    script.enabled = true; scene.scriptIds = [];
    session.step(scene, 'c', 0, true); expect(messages).toHaveLength(0);
  });
  it('handles bounded delayed events and disposes timers on scene exit', () => {
    vi.useFakeTimers();
    try {
      const { script, scene, session, messages } = fixture();
      script.rules.push({ id: 'timer', hook: 'onSceneEnter', actions: [{ type: 'scheduleEvent', eventName: 'click', delayMs: 500 }] });
      session.step(scene, 'a', 0, true);
      vi.advanceTimersByTime(500);
      session.step(scene, 'a', 500, true);
      expect(messages.some(m => m.actionType === 'setVisibility')).toBe(true);
      session.step(scene, 'b', 0, true);
      expect(vi.getTimerCount()).toBe(1);
      session.dispose(); expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });
  it('validates malformed scripts and denies source code or unsupported actions', () => {
    const { script } = fixture();
    expect(parseScriptModule(JSON.stringify(script)).id).toBe('test');
    expect(() => parseScriptModule('alert(1)')).toThrow();
    expect(() => parseScriptModule(JSON.stringify({ ...script, rules: [{ id: 'bad', hook: 'onTick', actions: [{ type: 'fetch' }] }] }))).toThrow();
    expect(() => parseScriptModule(JSON.stringify({ ...script, rules: [{ id: 'bad', hook: 'onTick', actions: [{ type: 'setOpacity', elementId: 'x', value: 999 }] }] }))).toThrow();
  });
  it('bounds timers and quarantines malformed modules without crashing the host', () => {
    vi.useFakeTimers();
    try {
      const runtime = new RestrictedScriptRuntime(['timer:use'], ['timer:use']);
      for (let i = 0; i < 32; i++) expect(runtime.registerBoundedTimer(() => {}, 500)).toBe(true);
      expect(runtime.registerBoundedTimer(() => {}, 500)).toBe(false);
      runtime.cleanupSceneResources(); expect(vi.getTimerCount()).toBe(0);
      const { project, scene, script } = fixture();
      script.rules = null as never;
      const session = new ScriptPlaybackSession(project, () => {});
      expect(() => session.step(scene, 'a', 0, true)).not.toThrow();
      expect(session.diagnostics[0].errors.length).toBeGreaterThan(0);
    } finally { vi.useRealTimers(); }
  });
});
