import { Scene, ScriptModule, ScriptPermission, SignageProject } from '@packages/project-model';
import { RestrictedScriptRuntime, ScriptExecutionDiagnostics, ScriptHostMessage } from './index';

export const SCRIPT_PERMISSIONS: ScriptPermission[] = ['scene:read', 'element:read', 'text:write', 'visibility:write', 'animation:control', 'scene:transition', 'playlist:select', 'timer:use', 'datafeed:read', 'diagnostics:log'];
const hooks = ['initialize', 'onSceneEnter', 'onTick', 'onEvent', 'onSceneExit', 'dispose'];
const actions = ['scheduleEvent', 'setText', 'setVisibility', 'setOpacity', 'triggerAnimation', 'transitionToScene', 'selectPlaylist', 'log'];
/** Validate untrusted JSON before it reaches the interpreter. No source evaluation. */
export function parseScriptModule(source: string): ScriptModule {
  if (source.length > 100000) throw new Error('Script exceeds 100 KB.');
  const s = JSON.parse(source);
  const fail = (message: string): never => { throw new Error(message); };
  if (!s || typeof s.id !== 'string' || !s.id || typeof s.name !== 'string' || typeof s.description !== 'string' || typeof s.enabled !== 'boolean') fail('Script needs id, name, description and enabled.');
  if (!Array.isArray(s.permissions) || s.permissions.some((p: ScriptPermission) => !SCRIPT_PERMISSIONS.includes(p))) fail('Invalid permissions.');
  if (!Array.isArray(s.rules) || s.rules.length > 100) fail('Use at most 100 rules.');
  const ids = new Set();
  for (const r of s.rules) {
    if (!r || typeof r.id !== 'string' || ids.has(r.id) || !hooks.includes(r.hook)) fail('Each rule needs a unique id and valid hook.');
    ids.add(r.id);
    if (r.hook === 'onEvent' && (typeof r.eventName !== 'string' || !r.eventName)) fail('Event rules require eventName.');
    if (r.once !== undefined && typeof r.once !== 'boolean') fail('once must be boolean.');
    if (r.condition && (!['elapsedMs', 'tickCount'].includes(r.condition.field) || !['gte', 'lte', 'eq', 'mod'].includes(r.condition.operator) || !Number.isFinite(r.condition.value))) fail('Invalid rule condition.');
    if (!Array.isArray(r.actions) || r.actions.length > 100) fail('Use at most 100 actions per rule.');
    for (const a of r.actions) {
      if (!a || !actions.includes(a.type)) fail('Unknown action.');
      if (['setText', 'setVisibility', 'setOpacity', 'triggerAnimation'].includes(a.type) && (typeof a.elementId !== 'string' || !a.elementId)) fail('Action requires elementId.');
      if (a.type === 'scheduleEvent' && (typeof a.eventName !== 'string' || !a.eventName || !Number.isFinite(a.delayMs) || a.delayMs < 50 || a.delayMs > 60000)) fail('Timer requires eventName and delayMs between 50 and 60000.');
      if (a.type === 'triggerAnimation' && a.value !== undefined && typeof a.value !== 'string') fail('Animation value must be a track id.');
      if (a.type === 'setText' && (typeof a.value !== 'string' || a.value.length > 1000)) fail('Text must be a string of at most 1000 characters.');
      if (a.type === 'setVisibility' && typeof a.value !== 'boolean') fail('Visibility must be boolean.');
      if (a.type === 'setOpacity' && (!Number.isFinite(a.value) || a.value < 0 || a.value > 1)) fail('Opacity must be between 0 and 1.');
      if (a.type === 'transitionToScene' && typeof a.sceneId !== 'string') fail('Transition requires sceneId.');
      if (a.type === 'selectPlaylist' && typeof a.playlistId !== 'string') fail('Playlist action requires playlistId.');
      if (a.type === 'log' && (typeof a.message !== 'string' || !['info', 'warn', 'error'].includes(a.level))) fail('Log requires message and level.');
    }
  }
  return s as ScriptModule;
}

/** Scene-scoped lifecycle coordinator. All side effects are emitted to a host. */
export class ScriptPlaybackSession {
  private instances: Array<{ script: ScriptModule; runtime: RestrictedScriptRuntime }> = [];
  private scene: Scene | null = null;
  private key = '';
  private elapsed = 0;
  private lastTick = -Infinity;
  private errors: ScriptExecutionDiagnostics[] = [];
  constructor(private project: SignageProject, private emit: (messages: ScriptHostMessage[]) => void) {}
  get diagnostics() { return this.errors; }
  private invoke(hook: Parameters<RestrictedScriptRuntime['invokeHook']>[1], eventName?: string) {
    for (const { script, runtime } of this.instances) {
      try {
        const result = runtime.invokeHook(script, hook, { elapsedMs: this.elapsed, eventName });
        if (result.errors.length || result.deniedActions.length) this.errors = [...this.errors.slice(-19), result];
        this.emit(result.emittedMessages);
      } catch (error) {
        this.errors = [...this.errors.slice(-19), { scriptId: script.id, operationsExecuted: 0, deniedActions: [], emittedMessages: [], activeTimerCount: 0, errors: [String(error)] }];
      }
    }
  }
  step(scene: Scene, key: string, elapsed: number, playing: boolean) {
    if (this.key !== key || this.scene?.id !== scene.id) {
      this.dispose();
      this.key = key;
      this.scene = scene;
      this.elapsed = elapsed;
      const allowed = this.project.permissions.filter(p => scene.permissions.includes(p));
      this.instances = this.project.scripts.filter(s => s.enabled && scene.scriptIds.includes(s.id)).flatMap(script => {
        try {
          parseScriptModule(JSON.stringify(script));
          return [{ script, runtime: new RestrictedScriptRuntime(allowed, script.permissions) }];
        } catch (error) {
          this.errors = this.errors.slice(-19);
          this.errors.push({ scriptId: script.id, operationsExecuted: 0, deniedActions: [], emittedMessages: [], activeTimerCount: 0, errors: [String(error)] });
          return [];
        }
      });
      this.invoke('initialize'); this.invoke('onSceneEnter');
      this.lastTick = -Infinity;
    }
    this.elapsed = elapsed;
    if (playing && (elapsed - this.lastTick >= 100 || elapsed < this.lastTick)) {
      this.lastTick = elapsed;
      this.invoke('onTick');
      for (const { script, runtime } of this.instances) {
        for (const eventName of runtime.drainEvents()) {
          const result = runtime.invokeHook(script, 'onEvent', { elapsedMs: elapsed, eventName });
          if (result.errors.length || result.deniedActions.length) this.errors = [...this.errors.slice(-19), result];
          this.emit(result.emittedMessages);
        }
      }
    }
  }
  event(name: string) { if (this.scene) this.invoke('onEvent', name); }
  dispose() {
    if (this.instances.length) { this.invoke('onSceneExit'); this.invoke('dispose'); }
    this.instances = []; this.scene = null; this.key = '';
  }
}
