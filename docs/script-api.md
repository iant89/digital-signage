# Sandboxed Script Runtime & API Specification

## 1. Security Philosophy

Package scripts may originate from external designers or third-party templates. Therefore:
- Package scripts are **never** executed via unrestricted `eval()` or `new Function()`.
- Every script must declare its required permissions in the project manifest.
- The host validates every message emitted by a script against its declared permission set, instruction budget, memory quota, and rate limits.
- Scene transitions automatically dispose of all timers and event listeners registered by the outgoing scene.

---

## 2. Explicit Permission Model

| Permission Scope     | Permitted Actions |
|----------------------|-------------------|
| `scene:read`         | Read current scene metadata, elapsed time, and resolution. |
| `element:read`       | Read element text, visibility, and geometric bounds. |
| `text:write`         | Update text content or dynamic placeholder values on authorized elements. |
| `visibility:write`   | Toggle element visibility or opacity. |
| `animation:control`  | Trigger, pause, or restart a named animation track. |
| `scene:transition`   | Request an authorized transition to another scene in the project. |
| `playlist:select`    | Request switching to an authorized playlist ID. |
| `timer:use`          | Register bounded periodic or one-shot timers (cleaned up on scene exit). |
| `datafeed:read`      | Read from pre-configured, host-sanitized data feed keys. |
| `diagnostics:log`    | Emit structured diagnostic log entries (`info`, `warn`, `error`). |

---

## 3. Script Lifecycle Hooks

1. `initialize(ctx)`: Establish initial script state (`ctx.state`) and register permitted handlers.
2. `onSceneEnter(ctx)`: Executed when the host enters the bound scene.
3. `onTick(ctx, elapsedMs)`: Executed periodically within a strict operation budget (max 500 operations per tick).
4. `onEvent(ctx, event)`: Responds to authorized interactive or scheduled events.
5. `onSceneExit(ctx)`: Releases scene-specific resources and cancels active timers.
6. `dispose(ctx)`: Final teardown; removes all handlers, timers, and state references.

---

## 4. Declarative Rule & Safe Command Format

Scripts in `.signage` archives use structured, JSON-serializable action rules and safe expression evaluators so they can be statically inspected during package import:

```json
{
  "id": "script-lobby-ticker",
  "name": "Lobby Dynamic Greeting & Promo Trigger",
  "permissions": ["scene:read", "text:write", "visibility:write", "diagnostics:log"],
  "rules": [
    {
      "hook": "onSceneEnter",
      "actions": [
        { "type": "log", "level": "info", "message": "Entered Welcome Scene" },
        { "type": "setText", "elementId": "el-greeting", "value": "Welcome to Innovation Center — {{time}}" }
      ]
    },
    {
      "hook": "onTick",
      "condition": { "field": "elapsedMs", "operator": "gte", "value": 5000 },
      "actions": [
        { "type": "setVisibility", "elementId": "el-badge", "visible": true }
      ]
    }
  ]
}
```
