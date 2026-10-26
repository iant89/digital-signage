// ============================================================================
// @packages/script-runtime — Restricted Sandboxed Script Runtime
// No eval() or new Function(). Enforces explicit capability permissions,
// instruction budgets, rate limits, message validation, and timer disposal.
// ============================================================================

import {
  SceneElement,
  ScriptAction,
  ScriptModule,
  ScriptPermission,
  ScriptRule,
} from '@packages/project-model';

export interface ScriptHostMessage {
  scriptId: string;
  actionType: ScriptAction['type'];
  elementId?: string;
  value?: string | number | boolean;
  sceneId?: string;
  playlistId?: string;
  level?: 'info' | 'warn' | 'error';
  message?: string;
  timestamp: number;
}

export interface ScriptExecutionDiagnostics {
  scriptId: string;
  operationsExecuted: number;
  deniedActions: string[];
  emittedMessages: ScriptHostMessage[];
  activeTimerCount: number;
  errors: string[];
}

export interface SandboxLimits {
  maxOperationsPerInvoke: number;
  maxStateKeys: number;
  maxMessagesPerSecond: number;
}

export const DEFAULT_SANDBOX_LIMITS: SandboxLimits = {
  maxOperationsPerInvoke: 500,
  maxStateKeys: 64,
  maxMessagesPerSecond: 40,
};

function requiredPermissionForAction(actionType: ScriptAction['type']): ScriptPermission {
  switch (actionType) {
    case 'scheduleEvent':
      return 'timer:use';
    case 'setText':
      return 'text:write';
    case 'setVisibility':
    case 'setOpacity':
      return 'visibility:write';
    case 'triggerAnimation':
      return 'animation:control';
    case 'transitionToScene':
      return 'scene:transition';
    case 'selectPlaylist':
      return 'playlist:select';
    case 'log':
    default:
      return 'diagnostics:log';
  }
}

export class RestrictedScriptRuntime {
  private allowedPermissions: Set<ScriptPermission>;
  private limits: SandboxLimits;
  private stateStore = new Map<string, string | number | boolean>();
  private activeTimers = new Set<ReturnType<typeof setTimeout>>();
  private activeEventHandlers = new Map<string, ScriptRule[]>();
  private tickCount = 0;
  private firedRules = new Set<string>();
  private pendingEvents: string[] = [];
  private messageTimestamps: number[] = [];
  private disposed = false;

  constructor(
    projectPermissions: ScriptPermission[],
    scriptPermissions: ScriptPermission[],
    limits: SandboxLimits = DEFAULT_SANDBOX_LIMITS
  ) {
    // Effective permissions are the intersection of project-granted and script-declared permissions
    const projectSet = new Set(projectPermissions);
    this.allowedPermissions = new Set(scriptPermissions.filter((p) => projectSet.has(p)));
    this.limits = limits;
  }

  public hasPermission(permission: ScriptPermission): boolean {
    return this.allowedPermissions.has(permission);
  }

  public getActiveTimerCount(): number {
    return this.activeTimers.size;
  }

  public getRegisteredEventHandlerCount(): number {
    return this.activeEventHandlers.size;
  }

  public setState(key: string, val: string | number | boolean): void {
    if (!this.stateStore.has(key) && this.stateStore.size >= this.limits.maxStateKeys) {
      throw new Error(`Script memory limit exceeded: max ${this.limits.maxStateKeys} state keys.`);
    }
    this.stateStore.set(key, val);
  }

  public registerBoundedTimer(callback: () => void, delayMs: number): boolean {
    if (this.disposed || this.activeTimers.size >= 32 || !this.hasPermission('timer:use')) {
      return false;
    }
    const safeDelay = Math.max(50, Math.min(60000, delayMs));
    const timer = setTimeout(() => {
      this.activeTimers.delete(timer);
      if (!this.disposed) {
        callback();
      }
    }, safeDelay);
    this.activeTimers.add(timer);
    return true;
  }

  public invokeHook(
    script: ScriptModule,
    hook: ScriptRule['hook'],
    context: { elapsedMs: number; eventName?: string }
  ): ScriptExecutionDiagnostics {
    const emittedMessages: ScriptHostMessage[] = [];
    const deniedActions: string[] = [];
    const errors: string[] = [];
    let operationsExecuted = 0;

    if (this.disposed || !script.enabled) {
      return {
        scriptId: script.id,
        operationsExecuted: 0,
        deniedActions,
        emittedMessages,
        activeTimerCount: this.activeTimers.size,
        errors,
      };
    }

    if (hook === 'initialize') {
      this.activeEventHandlers.clear();
      for (const rule of script.rules) {
        if (rule.hook === 'onEvent' && rule.eventName) {
          const list = this.activeEventHandlers.get(rule.eventName) ?? [];
          list.push(rule);
          this.activeEventHandlers.set(rule.eventName, list);
        }
      }
    }

    if (hook === 'onTick') {
      this.tickCount++;
    }

    const matchingRules = script.rules.filter((r) => {
      if (r.once && this.firedRules.has(r.id)) return false;
      if (r.hook !== hook) return false;
      if (hook === 'onEvent' && r.eventName && r.eventName !== context.eventName) return false;
      return true;
    });

    const now = Date.now();
    this.messageTimestamps = this.messageTimestamps.filter((ts) => now - ts < 1000);

    for (const rule of matchingRules) {
      operationsExecuted++;
      if (operationsExecuted > this.limits.maxOperationsPerInvoke) {
        errors.push(`CPU instruction budget exceeded (${this.limits.maxOperationsPerInvoke} ops).`);
        break;
      }

      if (rule.condition) {
        const metricVal =
          rule.condition.field === 'elapsedMs' ? context.elapsedMs : this.tickCount;
        let condMet = false;
        switch (rule.condition.operator) {
          case 'gte':
            condMet = metricVal >= rule.condition.value;
            break;
          case 'lte':
            condMet = metricVal <= rule.condition.value;
            break;
          case 'eq':
            condMet = metricVal === rule.condition.value;
            break;
          case 'mod':
            condMet = rule.condition.value > 0 && metricVal % rule.condition.value === 0;
            break;
        }
        if (!condMet) continue;
      }

      if (rule.once) this.firedRules.add(rule.id);
      for (const action of rule.actions) {
        operationsExecuted++;
        if (operationsExecuted > this.limits.maxOperationsPerInvoke) {
          errors.push(`CPU instruction budget exceeded (${this.limits.maxOperationsPerInvoke} ops).`);
          break;
        }

        const reqPerm = requiredPermissionForAction(action.type);
        if (!this.hasPermission(reqPerm)) {
          deniedActions.push(
            `Denied action "${action.type}" in script "${script.name}": missing permission "${reqPerm}".`
          );
          continue;
        }

        if (this.messageTimestamps.length >= this.limits.maxMessagesPerSecond) {
          errors.push('Event rate limit exceeded for script runtime.');
          break;
        }

        if (action.type === 'scheduleEvent') {
          if (typeof action.eventName !== 'string' || !action.eventName || !Number.isFinite(action.delayMs) ||
              !this.registerBoundedTimer(() => { if (this.pendingEvents.length < 32) this.pendingEvents.push(action.eventName!); }, action.delayMs!)) {
            errors.push('Invalid timer or timer limit reached (32).');
          }
          this.messageTimestamps.push(now);
          continue;
        }
        // Validate message structure before emitting to host
        if (
          (action.type === 'setText' ||
            action.type === 'setVisibility' ||
            action.type === 'setOpacity') &&
          !action.elementId
        ) {
          errors.push(`Invalid script message: "${action.type}" requires target elementId.`);
          continue;
        }

        this.messageTimestamps.push(now);
        emittedMessages.push({
          scriptId: script.id,
          actionType: action.type,
          elementId: action.elementId,
          value: action.value,
          sceneId: action.sceneId,
          playlistId: action.playlistId,
          level: action.level,
          message: action.message,
          timestamp: now,
        });
      }
    }

    if (hook === 'onSceneExit' || hook === 'dispose') {
      this.cleanupSceneResources();
    }
    if (hook === 'dispose') {
      this.disposed = true;
      this.stateStore.clear();
    }

    return {
      scriptId: script.id,
      operationsExecuted,
      deniedActions,
      emittedMessages,
      activeTimerCount: this.activeTimers.size,
      errors,
    };
  }

  public drainEvents(): string[] {
    const events = this.pendingEvents.splice(0);
    return events;
  }

  public cleanupSceneResources(): void {
    this.pendingEvents = [];
    this.firedRules.clear();
    for (const timer of this.activeTimers) {
      clearTimeout(timer);
    }
    this.activeTimers.clear();
    this.activeEventHandlers.clear();
  }
}

export function applyScriptMessagesToElements(
  elements: SceneElement[],
  messages: ScriptHostMessage[]
): SceneElement[] {
  if (messages.length === 0) return elements;
  const copy = elements.map((e) => ({
    ...e,
    textProps: e.textProps ? { ...e.textProps } : undefined,
  }));
  const map = new Map(copy.map((e) => [e.id, e]));

  for (const msg of messages) {
    if (!msg.elementId) continue;
    const target = map.get(msg.elementId);
    if (!target) continue;

    if (msg.actionType === 'setText' && typeof msg.value === 'string' && target.textProps) {
      target.textProps.text = msg.value.slice(0, 1000);
    } else if (msg.actionType === 'setVisibility' && typeof msg.value === 'boolean') {
      target.visible = msg.value;
    } else if (msg.actionType === 'setOpacity' && typeof msg.value === 'number') {
      target.opacity = Math.max(0, Math.min(1, msg.value));
    }
  }

  return copy;
}
