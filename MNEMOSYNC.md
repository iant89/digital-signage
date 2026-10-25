# MNEMOSYNC — Working Development Notebook & Session Ledger (`MNEMOSYNC.md`)

`MNEMOSYNC.md` is the persistent engineering notebook for **Digital Signage Studio**. Agents and developers should read this file at the start of every session and append a dated entry whenever architectural decisions, bug fixes, schema updates, or new features are introduced.

---

## Current Project Snapshot

- **Active Branch**: `arena/0c3849d9-digital-signage`
- **Build Status**: Passing (`npm run build` — zero TypeScript or Vite bundle errors)
- **Test Status**: Passing (`npm test` — 4 test files, 17 comprehensive test suites covering unit, archive fuzzing, UI integration, 19-step E2E workflow, and all 10 network synchronization acceptance tests)
- **Running Services**:
  - **Backend API & WebSocket Server**: Port `4000` (`npm run dev:server` via `tsx server/index.ts`, bound to `0.0.0.0:4000`)
  - **Frontend Vite Studio & Management App**: Port `5173` (`npm run dev`, bound to `0.0.0.0:5173`, proxying `/api` and `/ws` to `127.0.0.1:4000`)

---

## Chronological Session Log & Important Events

### [2026-10-25 — Session 01] Initial Architecture, `.signage` Format, Studio, Player & Sync Server

1. **Specification & Format-First Documentation (`docs/`)**:
   - Created `docs/signage-file-format.md` defining the exact 64-byte little-endian binary header (`SIGNAGE\0`, `formatVersion = 1`, `headerSize = 64`, `featureFlags`, 64-bit `directoryOffset` & `directoryLength`, `manifestEntryId`, `entryCount`, 24 zero reserved bytes) and 68-byte-prefixed variable-length directory records with 32-byte SHA-256 content hashes.
   - Created `docs/architecture.md`, `docs/script-api.md`, `docs/kiosk-deployment.md`, and `docs/security-model.md`.

2. **Core Engine Packages (`packages/`)**:
   - Enforced strict architectural separation (Rules 1–8):
     - `@packages/shared`: Pure-TypeScript FIPS 180-4 synchronous SHA-256 implementation (`sha256Bytes`, `sha256Hex`), byte buffer helpers, and path traversal validator (`isSafeArchivePath`).
     - `@packages/project-model`: Pure TypeScript schemas, validator (`validateProject`), asset duplicate/missing/unused analyzer (`analyzeProjectAssets`), schema migration (`migrateProjectSchema`), and starter 1080p multi-scene project (`createStarterProject`).
     - `@packages/editor-core`: Immutable alignment, distribution, grouping, layer Z-ordering, snap guide calculation (`computeSnappedPosition`), and IndexedDB + localStorage crash-recovery persistence.
     - `@packages/animation-engine`: Deterministic shared timeline math (`Progress = (CurrentTimelinePosition - A) / Duration`), keyframe interpolation (numbers, hex colors, typewriter text reveal, crop progress), easing curves, 14 built-in motion presets, and scene transitions.
     - `@packages/compression`: Bounded synchronous LZ77/Deflate block compressor (`SGLZ` header) + Web `CompressionStream` helper with strict `maxAllowedBytes` decompression bomb guard and MIME-type policy (never recompressing PNG/JPEG/WebP/MP4/WebM/WOFF2).
     - `@packages/signage-format`: Complete binary packager (`buildSignagePackage`), random-access single-entry reader (`readArchiveEntryBytes`), 12-step security validator (`validateSignageArchive`), publisher signature verifier, and version comparator (`compareSignagePackages`).
     - `@packages/script-runtime`: Restricted capability-gated sandbox (`RestrictedScriptRuntime`) with zero `eval()` or `new Function()`, instruction budgets (`maxOperationsPerInvoke`), rate limits, and automatic timer disposal on `onSceneExit`.
     - `@packages/playlist-engine` & `@packages/playback-engine`: Priority schedule resolver (`resolveActivePlaylist`), server-authoritative timeline evaluator (`evaluateAuthoritativeTimeline`), NTP-style 4-timestamp clock sync engine (`ClockSyncEngine`), drift evaluator (`evaluateDriftCorrection`), and atomic package cache (`AtomicPlayerPackageCache`).
     - `@packages/kiosk-integration` & `@packages/diagnostics`: Salted SHA-256 admin credential controller (`ProtectedAdminController`), `WatchdogSupervisor` with failing-package quarantine, and automatic credential/token redaction (`DiagnosticsCollector`).

3. **Network Management Server (`server/`)**:
   - Built with Fastify + `@fastify/websocket` + Node's built-in `node:sqlite` (`DatabaseSync`).
   - Implemented all relational tables from Spec Section 32 and content-addressed `.signage` package storage in `.storage/packages/`.
   - Seeded default admin credential (`ApexAdmin!2026`), starter `.signage` package (`pkg-apex-lobby-v1`), 3 display groups (`group-lobby-wall`, `group-cafe-menus`, `group-reception`), 6 registered players (`player-01`..`player-06`), and active synchronized session (`session-20261025-001`).

4. **Technical Gotchas Resolved**:
   - **Gotcha #1 (Vite/Vitest & `node:sqlite`)**: Vite's bundler transform strips the `node:` prefix if `node:sqlite` is imported via top-level ESM `import { DatabaseSync } from 'node:sqlite'`. Resolved in `server/db.ts` by loading `node:sqlite` via `createRequire(import.meta.url)('node:sqlite')` with `import type { DatabaseSync } from 'node:sqlite'`.
   - **Gotcha #2 (JSX Curly Braces)**: In JSX text nodes, literal `{{}}` is parsed as an object literal inside a JSX expression. Always escape literal double braces in JSX as `{'{{}}'}` or `{'{{time}}'}`.
   - **Gotcha #3 (Vite Preview Host Allowlist)**: E2B / Arena live preview proxies requests under `https://{port}-{sandboxId}.e2b.app`. Added `allowedHosts: true` to `server` in `vite.config.ts` so Vite accepts all preview hosts without HTTP 403 errors.

### [2026-10-25 — Session 02] Project Governance & Agent Documentation Files

- Saved the complete Application Design Specification & Network Synchronization Addendum into `PROMPT.md`.
- Created `ROADMAP.md` tracking all 13 implemented phases and future Phase 14 optional extensions.
- Created `MNEMOSYNC.md` (this file) as the persistent session notebook.
- Created `AGENTS.md` to guide coding agents on project structure, build/test workflows, architectural invariants, and maintenance of `ROADMAP.md` and `MNEMOSYNC.md`.

### [2026-10-25 — Session 03] GitHub Pages Setup & Static Server Fallback

- Added `.github/workflows/deploy-pages.yml` using `actions/configure-pages@v5`, `actions/upload-pages-artifact@v3`, and `actions/deploy-pages@v4` to run tests, build the static site, and deploy `./dist` to GitHub Pages.
- Updated `vite.config.ts` with `base: './'` so asset paths resolve properly on GitHub Pages project subpaths (`/<repo>/`).
- Added `public/.nojekyll` and updated `package.json` (`build` & `build:pages`) to generate `dist/404.html` for SPA routing on GitHub Pages.
- Created `src/services/staticServerSimulator.ts` and registered `installStaticServerFallback()` in `src/main.tsx`. When deployed to a static host like GitHub Pages where `/api/v1/*` returns HTML 404/network error, the browser seamlessly falls back to an in-memory virtual server with all 6 synchronized displays, groups, packages, sessions, NTP clock sync, enrollment codes, commands, and audit log.

---

## Key Credentials & Test Constants Reference

- **Default Kiosk & Server Admin Passphrase**: `ApexAdmin!2026`
- **Default Operator Passphrase**: `ApexOperator!2026`
- **Default Seeded Enrollment Code**: `ENROLL-APEX-2026`
- **Default Seeded Sync Session ID**: `session-20261025-001` (Group: `group-lobby-wall`)
- **Default Seeded Package ID**: `pkg-apex-lobby-v1`
