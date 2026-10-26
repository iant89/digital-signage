# AGENTS.md — Developer & Coding Agent Guide for Digital Signage Studio

Welcome, Agent! Before making changes to this repository, read this guide along with:
1. **[`PROMPT.md`](PROMPT.md)** — The authoritative Application Design Specification & Network Synchronization Addendum (Sections 1–38).
2. **[`ROADMAP.md`](ROADMAP.md)** — The phased implementation checklist (Phases 0–14) mapping requirements to source files and verification tests.
3. **[`MNEMOSYNC.md`](MNEMOSYNC.md)** — The persistent working notebook containing session history, architectural decisions, resolved gotchas, and test constants.

Whenever you complete a feature, fix a bug, or alter an interface, **update both `ROADMAP.md` and `MNEMOSYNC.md`** before finishing your turn.

---

## 1. Repository Structure

```
/home/user/digital-signage/
├── PROMPT.md                  # Full verbatim application specification (Sections 1–38)
├── ROADMAP.md                 # Phased implementation status & feature checklist
├── MNEMOSYNC.md               # Persistent session notebook & engineering ledger
├── AGENTS.md                  # This agent guide (build, architecture, tricks of the trade)
├── README.md                  # User-facing overview & quickstart instructions
├── docs/                      # Detailed subsystem specifications
│   ├── architecture.md
│   ├── signage-file-format.md
│   ├── script-api.md
│   ├── kiosk-deployment.md
│   └── security-model.md
├── packages/                  # Pure TypeScript domain & engine modules (aliased as @packages/*)
│   ├── shared/                # Pure-TS FIPS 180-4 SHA-256, byte buffers, safe path validation
│   ├── project-model/         # Project, Scene, Element, Playlist, Schedule schemas & migrations
│   ├── editor-core/           # Immutable transforms, align/distribute, snap guides, IndexedDB
│   ├── animation-engine/      # Shared timeline math, keyframes, easing, presets, transitions
│   ├── compression/           # Bounded LZ/Deflate compression & decompression bomb guards
│   ├── signage-format/        # .signage 64B header, directory, reader, writer, 12-step validator
│   ├── script-runtime/        # Restricted sandboxed script interpreter (no eval/new Function)
│   ├── playlist-engine/       # Playlist timeline builder & deterministic schedule resolution
│   ├── playback-engine/       # Authoritative timeline, NTP clock sync, drift control, atomic cache
│   ├── kiosk-integration/     # Salted SHA-256 admin auth, maintenance timer, WatchdogSupervisor
│   ├── diagnostics/           # Structured diagnostic logger with automatic secret redaction
│   └── fleet-operations/      # Proof-of-play, fleet health alerts, verified backups & retention
├── apps/
│   └── desktop-host/          # Electron/Tauri kiosk window policy & Linux systemd unit
├── tools/                     # Standalone operator CLIs (no third-party runtime deps)
│   ├── network-scanner/       # LAN discovery helpers + dependency-free Node CLI + README
│   └── windows/               # find-signage-server.cmd launcher & Find-SignageServer.ps1 wrapper
├── server/                    # Fastify + WebSocket + SQLite Network Management Server
│   ├── db.ts                  # SQLite schema (20 tables), content-addressed store & seed data
│   ├── app.ts                 # Fastify REST endpoints (/api/v1/* incl. /operations/*) & WebSocket gateway (/ws)
│   └── index.ts               # Server entrypoint listening on 0.0.0.0:4000
├── src/                       # React + TypeScript Frontend (aliased as @/*)
│   ├── store/useStudioStore.ts# Zustand immutable state, undo/redo, persistence, package actions
│   ├── components/
│   │   ├── shared/            # SignageElementRenderer.tsx (Hybrid DOM/SVG/Canvas/Video renderer)
│   │   ├── studio/            # TopToolbar, LeftSidebar, CanvasWorkspace, RightInspector, BottomTimeline
│   │   ├── player/            # StandaloneSignagePlayer.tsx (Fullscreen kiosk, 5-tap unlock, watchdog)
│   │   ├── package-manager/   # PackageManagerView.tsx (64B hex dump, directory, corruption bench)
│   │   ├── network/           # NetworkManagementView.tsx (6-screen sync wall, drift test, RBAC)
│   │   └── admin/             # DeviceAdminView.tsx (Kiosk settings, password rotation, redacted logs)
│   ├── App.tsx                # Unified 5-mode shell & global keyboard shortcuts
│   └── styles.css             # Dark/Light studio & broadcast UI theme
└── tests/                     # Automated Vitest suites
    ├── unit/                  # Project model, editor core, animation, enterprise, fleet-ops & LAN discovery tests
    ├── archive-fuzz/          # .signage binary round-trip, corruption, bomb, fuzz & script sandbox
    ├── integration/           # 19-step E2E, 10 Sync Acceptance, Phase 15 Fleet Ops & LAN discovery tests
    └── browser/               # React Testing Library UI mode & interaction tests
```

---

## 2. Build, Dev Server & Test Commands

```bash
# Run all automated unit, fuzz, integration, E2E, and UI tests
npm test

# Type-check all packages/server/src with tsc and build production frontend bundle
npm run build

# Build static GitHub Pages bundle (dist/index.html, dist/404.html, dist/.nojekyll)
npm run build:pages

# Start the Fastify + WebSocket + SQLite backend server (binds to 0.0.0.0:4000)
npm run dev:server

# Start the Vite React frontend server (binds to 0.0.0.0:5173, proxies /api and /ws -> 4000)
npm run dev

# Find the signage server on the LAN (Windows: tools\windows\find-signage-server.cmd)
npm run scan:server -- --subnet 192.168.1.0/24 --json
```

---

## 3. Non-Negotiable Architectural Rules (Spec Section 15)

1. **No React in `@packages/project-model`**: Keep `packages/project-model/index.ts` pure TypeScript so both the Node.js server and browser workers can import it directly.
2. **No Editor UI in `@packages/playback-engine`**: The standalone player and server timeline calculators must never import studio editor components.
3. **No UI in `@packages/signage-format` or `@packages/compression`**: Binary archive creation and validation must run identically in Node.js, Web Workers, and browsers.
4. **No `eval()` or `new Function()` in `@packages/script-runtime`**: Package scripts are untrusted data. Execute them strictly through the capability-gated `RestrictedScriptRuntime` and always clean up timers in `onSceneExit` and `dispose`.
5. **Shared Rendering Semantics**: Studio Canvas Preview, Standalone Player, and the Network Multi-Screen Wall Simulator all render elements through `src/components/shared/SignageElementRenderer.tsx` and compute animations through `computeSceneElementsAtTime` (`@packages/animation-engine`).
6. **Zero Script Execution During Validation**: `validateSignageArchive` must remain strictly side-effect-free.
7. **No Environment APIs in `@packages/fleet-operations`**: Proof-of-play aggregation, health grading, alert IDs, backup checksums and retention must stay pure TypeScript (no React, `node:sqlite`, `fs` or DOM globals) so the Fastify server, the static Pages simulator and the React console compute identical results.
8. **Never Restore Secrets**: Operational backups must exclude `users` / `device_credentials`, redact secret-like columns, verify every SHA-256 checksum before restore, and only write to the four whitelisted telemetry tables.
9. **Discovery Is Identity-Only**: `GET /api/v1/discovery` must stay unauthenticated, side-effect-free and secret-free. LAN scanners must verify the full service descriptor — never treat an open port 4000 as proof of a signage server.

---

## 4. Tricks of the Trade & Environment Gotchas

### 4.1 Live Preview & Proxy Rules
- **Bind to `0.0.0.0`**: Always bind dev and API servers to `0.0.0.0`, never `127.0.0.1`.
- **Vite `allowedHosts: true`**: In `vite.config.ts`, `server.allowedHosts: true` is required so the sandbox preview proxy (`https://{port}-{sandboxId}.e2b.app`) is not blocked with HTTP 403.
- **Relative URLs Only in Browser Code**: Browser code in `src/` must **never** call `http://localhost:4000` or `ws://127.0.0.1:4000` directly (because the user's browser runs outside the sandbox). Always use relative paths (`fetch('/api/v1/...')` and `ws://${window.location.host}/ws`) which Vite proxies to `127.0.0.1:4000`.

### 4.2 Node.js Built-in SQLite (`node:sqlite`) with Vite/Vitest
- Node v22 provides `DatabaseSync` in `node:sqlite` with zero native compilation.
- However, Vite's module bundler strips the `node:` prefix if imported via static ESM `import { DatabaseSync } from 'node:sqlite'`.
- **Trick**: In `server/db.ts`, always load `node:sqlite` using `createRequire(import.meta.url)('node:sqlite')` paired with `import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite'`.

### 4.3 Synchronous Cross-Environment SHA-256 & Compression
- `crypto.subtle.digest` and `CompressionStream` are async-only, which complicates synchronous binary directory indexing and fast fuzz testing.
- `@packages/shared` provides a pure-TypeScript FIPS 180-4 `sha256Bytes` / `sha256Hex` implementation, and `@packages/compression` provides a deterministic synchronous LZ77/Deflate block codec (`compressBytes` / `decompressBytes`) with strict `maxAllowedBytes` decompression-bomb protection. Use these for instant synchronous packaging and verification across Browser, Worker, Vitest, and Node.

### 4.4 Server-Authoritative Synchronization Math
- Never synchronize displays by broadcasting "advance scene now" over WebSockets.
- Always use `evaluateAuthoritativeTimeline(project, playlist, session, estimatedServerTimeMs)` in `@packages/playback-engine`. Given `session.startTimeUtc`, every player (including late joiners) deterministically computes `(estimatedServerTimeMs - startUtcMs) % totalCycleDurationMs` to land on the exact active scene and keyframe progress `Progress = (CurrentTimelinePosition - A) / Duration`.

### 4.5 Keeping `ROADMAP.md` and `MNEMOSYNC.md` Updated
- At the start of a task: Check `MNEMOSYNC.md` for recent context and `ROADMAP.md` for phase status.
- At the end of a task: Run `npm test && npm run build`, record any new architectural notes or gotchas in `MNEMOSYNC.md`, and update checkboxes in `ROADMAP.md`.

### 4.6 Phase 15 Fleet Operations Gotchas
- **Proof-of-play idempotency**: Player batches must be normalized via `normalizePlaybackEvents` before `INSERT OR IGNORE` on `playback_events.event_key`; never count a replayed offline batch twice.
- **Coverage vs. dwell**: `dwellMs` sums clipped durations, `coverageMs` merges overlapping intervals per device. Fleet totals merge all scenes per device; row coverage merges within its group.
- **Deterministic alerts**: Alert IDs hash `ruleId|deviceId|cooldownBucket`; `saveFleetAlerts` uses `INSERT OR IGNORE` so acknowledgements survive repeated health evaluations.
- **Static Pages parity**: Any new `/api/v1/operations/*` endpoint needs a matching branch in `src/services/staticServerSimulator.ts` (parse `urlPath.split('?')` first — the fallback router otherwise matches only exact paths).
- **Offline UI demo**: `NetworkManagementView.tsx` computes its fallback snapshot from `@packages/fleet-operations`, so headless/jsdom UI tests stay deterministic without a backend.

### 4.7 Phase 16 LAN Discovery Gotchas
- **Keep the CLI dependency-free**: `tools/network-scanner/*.mjs` uses only Node built-ins so `find-signage-server.cmd` works on a technician laptop with just Node 18+ installed — no `npm install`.
- **Pure helpers live in `discovery-core.mjs`**: CIDR math, target resolution, URL building, descriptor validation, arg parsing and bounded concurrency are unit-tested; the CLI only adds sockets and HTTP.
- **`resolveScanTargets` fallback**: when no usable IPv4 NIC is detected (CI/headless hosts), scanning falls back to `127.0.0.1/32` with a warning. This path was extracted after a `const` reassignment bug — don't inline it back into the CLI.
- **Windows wrappers are thin**: `Find-SignageServer.ps1` and `find-signage-server.cmd` delegate to the Node CLI. `pwsh` is unavailable in the Linux sandbox, so keep PowerShell syntax minimal and rely on the Node integration tests for behavior.
- **Vitest now includes `.mjs` tests**: `vite.config.ts` `test.include` is `tests/**/*.test.{ts,tsx,mjs}`.
