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
│   └── diagnostics/           # Structured diagnostic logger with automatic secret redaction
├── apps/
│   └── desktop-host/          # Electron/Tauri kiosk window policy & Linux systemd unit
├── server/                    # Fastify + WebSocket + SQLite Network Management Server
│   ├── db.ts                  # SQLite schema (15 tables), content-addressed store & seed data
│   ├── app.ts                 # Fastify REST endpoints (/api/v1/*) & WebSocket gateway (/ws)
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
    ├── unit/                  # Project model, editor core, animation, schedule, redaction tests
    ├── archive-fuzz/          # .signage binary round-trip, corruption, bomb, fuzz & script sandbox
    ├── integration/           # 19-step Essential E2E test + all 10 Network Sync Acceptance Tests
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
```

---

## 3. Non-Negotiable Architectural Rules (Spec Section 15)

1. **No React in `@packages/project-model`**: Keep `packages/project-model/index.ts` pure TypeScript so both the Node.js server and browser workers can import it directly.
2. **No Editor UI in `@packages/playback-engine`**: The standalone player and server timeline calculators must never import studio editor components.
3. **No UI in `@packages/signage-format` or `@packages/compression`**: Binary archive creation and validation must run identically in Node.js, Web Workers, and browsers.
4. **No `eval()` or `new Function()` in `@packages/script-runtime`**: Package scripts are untrusted data. Execute them strictly through the capability-gated `RestrictedScriptRuntime` and always clean up timers in `onSceneExit` and `dispose`.
5. **Shared Rendering Semantics**: Studio Canvas Preview, Standalone Player, and the Network Multi-Screen Wall Simulator all render elements through `src/components/shared/SignageElementRenderer.tsx` and compute animations through `computeSceneElementsAtTime` (`@packages/animation-engine`).
6. **Zero Script Execution During Validation**: `validateSignageArchive` must remain strictly side-effect-free.

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
