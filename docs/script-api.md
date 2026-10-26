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
        { "type": "setVisibility", "elementId": "el-badge", "value": true }
      ]
    }
  ]
}
```

## 5. Authoring and testing in Studio

Open **Inspector → Scene & Scripts → Script authoring**.

1. Choose **New script** (or select an existing script).
2. Edit the JSON, then choose **Validate & save script**. IDs are stable; rule IDs must be unique. Scripts are limited to 100 KB, 100 rules and 100 actions per rule.
3. Enable **Run in this scene** for each scene that should execute it and leave **Script enabled** checked.
4. Under **Project & scene permissions**, explicitly grant the necessary capabilities at both levels. Effective permissions are the intersection of project, scene and script permissions. Saving a script never grants permissions automatically.
5. Use **Preview elapsed (ms)** and **Preview event**, then **Test selected script**. The preview applies text/visibility/opacity to the authored scene as an undoable edit. Navigation is not performed in editor preview. Save before exporting a package; unsaved JSON is only a draft.
6. Build/load the `.signage` package in the standalone player to test lifecycle, animation, navigation and timers during real playback.

JSON example (replace `el-subheading` with an element ID from your scene):

```json
{
  "id": "script-example",
  "name": "Delayed message",
  "description": "Reveal a message after five seconds or on click",
  "enabled": true,
  "permissions": ["text:write", "visibility:write", "timer:use"],
  "rules": [
    {
      "id": "start-timer",
      "hook": "onSceneEnter",
      "actions": [{ "type": "scheduleEvent", "eventName": "reveal", "delayMs": 5000 }]
    },
    {
      "id": "reveal-message",
      "hook": "onEvent",
      "eventName": "reveal",
      "actions": [
        { "type": "setText", "elementId": "el-subheading", "value": "Welcome!" },
        { "type": "setVisibility", "elementId": "el-subheading", "value": true }
      ]
    },
    {
      "id": "click-message",
      "hook": "onEvent",
      "eventName": "click:el-subheading",
      "actions": [{ "type": "setText", "elementId": "el-subheading", "value": "Thanks for visiting" }]
    }
  ]
}
```

## 6. Player host behavior

- Only enabled scripts explicitly bound through `scene.scriptIds` execute. Invalid modules are skipped and recorded in diagnostics; no JavaScript source is evaluated.
- Every scene entry (including a new loop or playlist slot) creates fresh runtimes, calls `initialize` then `onSceneEnter`. Playing invokes `onTick` at most every 100ms of scene time. Pausing stops tick invocation and delivery of queued timer events.
- A rule may specify `"once": true` to execute at most once per scene entry. Otherwise a true `gte` condition runs repeatedly on each eligible tick.
- Click/tap emits `click` and `click:<elementId>`. Trusted host integrations may dispatch `new CustomEvent('signage:script-event', { detail: { name: 'alarm' } })` on the player window. The JSON interpreter cannot call browser APIs itself.
- Text, opacity and visibility output are transient playback overrides. They do not modify the package or authored project. Text is limited to 1,000 characters; opacity to 0–1.
- `triggerAnimation` targets an `elementId`; optional string `value` selects a track ID. Without a track ID, it restarts all authored tracks for that element. Animation progress uses scene time, so it pauses with playback.
- `transitionToScene` seeks to a scene slot in the active playlist; IDs not present in that playlist are ignored. `selectPlaylist` selects an existing project playlist from its start. Local script navigation is limited to one request per second to prevent tight scene-change loops. These local-player requests do **not** change a network-authoritative session or broadcast navigation to other devices.
- `log` messages go to the player's structured diagnostics. Runtime errors and denied actions are visible in the maintenance console's **Script diagnostics** section (most recent 20 records).
- `scheduleEvent` requires `timer:use`, an eventName and delayMs from 50 to 60,000. It schedules a one-shot event for the same script. At most 32 timers and 32 queued events are retained per runtime. Wall-clock timers can expire during pause, but their events wait for playing ticks to resume. A rule can schedule another timer to implement repetition.
- `onSceneExit` and `dispose` run on scene departure; timers and handlers are cleaned up. Unmount/package replacement tears down runtimes without applying further host mutations.

### Explicit boundaries

This is a declarative rules interpreter, not a general-purpose programming language. `scene:read`, `element:read` and `datafeed:read` are reserved capabilities; this version does not expose arbitrary object queries, custom expressions, network fetches or a datafeed scripting action. The host's bounded state/timer APIs are not arbitrary JavaScript entry points. Network-wall playback remains server-authoritative; the standalone player's local navigation is not a synchronization protocol.
