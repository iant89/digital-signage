# MNEMOSYNC — Working Development Notebook & Session Ledger (`MNEMOSYNC.md`)

`MNEMOSYNC.md` is the persistent engineering notebook for **Digital Signage Studio**. Agents and developers should read this file at the start of every session and append a dated entry whenever architectural decisions, bug fixes, schema updates, or new features are introduced.

---

## Current Project Snapshot

- **Active Branch**: `arena/de0423fc-digital-signage`
- **Build Status**: Passing (`npm run build` — zero TypeScript or Vite bundle errors)
- **Test Status**: Passing (`npm test` — 7 test files, 43 tests covering unit, archive fuzzing, React UI, 19-step E2E, all 10 network synchronization acceptance tests, Phase 14 enterprise extensions, and Phase 15 fleet operations unit/API/UI suites)
- **Running Services** (start on demand):
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
- Added `if: github.ref == 'refs/heads/main'` to the `deploy` job and Pages artifact steps so feature branches (`arena/**`) run the full `build` + `npm test` CI checks and pass cleanly without triggering GitHub's `github-pages` environment branch protection rule (`Branch "arena/..." is not allowed to deploy to github-pages due to environment protection rules`).
- Updated `vite.config.ts` with `base: './'` so asset paths resolve properly on GitHub Pages project subpaths (`/<repo>/`).
- Added `public/.nojekyll` and updated `package.json` (`build` & `build:pages`) to generate `dist/404.html` for SPA routing on GitHub Pages.
- Created `src/services/staticServerSimulator.ts` and registered `installStaticServerFallback()` in `src/main.tsx`. When deployed to a static host like GitHub Pages where `/api/v1/*` returns HTML 404/network error, the browser seamlessly falls back to an in-memory virtual server with all 6 synchronized displays, groups, packages, sessions, NTP clock sync, enrollment codes, commands, and audit log.

### [2026-10-25 — Session 04] Phase 14 Enterprise Extensions Implemented

- **14.1 Binary Delta Patch Transport (`packages/signage-format/index.ts`, `server/app.ts`, `src/components/package-manager/PackageManagerView.tsx`)**:
  - Implemented `buildSignageDeltaPatch(baseBytes, targetBytes)` and `applySignageDeltaPatch(baseBytes, deltaPatch)` with entry-level content-hash deduplication and bit-for-bit target `.signage` reconstruction.
  - Added `POST /api/v1/packages/delta` endpoint and UI WAN bandwidth analyzer in Package Manager.
- **14.2 Native Desktop Host Packaging (`apps/desktop-host/`)**:
  - Added `parseKioskCliArgs`, `resolveTargetDisplayBounds`, and `buildKioskCspHeader` to `apps/desktop-host/kiosk-host.ts`.
  - Created `electron-builder.yml`, `tauri.conf.json`, and `windows-kiosk-provision.ps1`.
- **14.3 Cloud Storage & PostgreSQL Cluster Adapters (`server/adapters/storage-adapter.ts`)**:
  - Implemented `FilesystemBlobStorageAdapter`, `S3CompatibleBlobStorageAdapter`, and `PostgresClusterAdapter`.
- Added automated test suite `tests/unit/enterprise-phase14.test.ts` (all 5 test files / 21 tests passing).

### [2026-10-25 — Session 05] Collapsible Studio Panels, Mobile-Friendly Layout & Mobile QR Enrollment

- **Collapsible Studio Panels (`useStudioStore.ts`, `StudioTopToolbar.tsx`, `StudioLeftSidebar.tsx`, `StudioRightInspector.tsx`, `StudioBottomTimeline.tsx`)**:
  - Added `leftSidebarCollapsed`, `rightInspectorCollapsed`, and `bottomTimelineCollapsed` state and toggle actions.
  - When collapsed on desktop, Left Sidebar and Right Inspector render 42px vertical icon rails (`collapsed-rail-btn`) so users can jump directly to any tab (`Elements`, `Media`, `Scenes`, `Layers` or `Properties`, `Motion`, `Scripts`).
  - Added `PanelLeft`, `PanelBottom`, and `PanelRight` toggle buttons to `StudioTopToolbar.tsx`.
- **Mobile Phone Responsive Layout (`App.tsx`, `src/styles.css`)**:
  - Added automatic mobile detection (`window.innerWidth <= 768` or mobile user-agent) plus a header **Mobile View / Desktop View** toggle button.
  - Added a touch-friendly bottom drawer switcher bar (`Canvas`, `Add / Scenes`, `Inspector`, `Timeline`) in Studio mode when on mobile, with mutually exclusive slide-over drawers so the canvas is never crushed on phone screens.
- **Player Setup QR Code & Mobile Enrollment Scanner (`src/utils/enrollmentQr.ts`, `StandaloneSignagePlayer.tsx`, `NetworkManagementView.tsx`)**:
  - Created `src/utils/enrollmentQr.ts` with `encodePlayerSetupQrPayload`, `decodePlayerSetupQrPayload`, and 21×21 Version-1 QR matrix generator `buildEnrollmentQrMatrix`.
  - Added **Setup QR Code** modal on the Signage Player (`StandaloneSignagePlayer.tsx`) that displays the player's `signage://enroll?...` QR code upon setup.
  - Added **Scan Player Setup QR Code** modal in `NetworkManagementView.tsx` (Devices & Enrollment tab) supporting live rear camera (`getUserMedia({ video: { facingMode: 'environment' } })` + `BarcodeDetector`), photo capture (`capture="environment"`), one-tap scan of the active Player Setup QR code, and manual URI decoding.

### [2026-10-25 — Session 06] Multi-Type QR Widget, Canvas Drag/Rotate Scroll Fix, Audio Editor & Inside-Edge Panel Bars

- **Rich QR Code Widget (`src/utils/qrCodeGenerator.ts`, `SignageElementRenderer.tsx`, `StudioRightInspector.tsx`)**:
  - Added `formatQrWidgetPayload` supporting 9 QR types (`link`, `wifi`, `contact`/vCard 3.0, `email`/MATMSG, `sms`/SMSTO, `phone`/tel, `geo`, `event`/VEVENT, `text`).
  - Added `buildRichQrMatrix` supporting error correction levels `L` (21×21), `M` (25×25), `Q` (29×29), and `H` (33×33), custom corner finder eye color, module pattern styles (`square`, `rounded`, `dots`), quiet zone padding, and center logo overlay (upload image, project asset, or text badge).
- **Canvas Drag / Rotate / Resize Scroll Fix (`src/components/studio/StudioCanvasWorkspace.tsx`, `src/styles.css`)**:
  - Fixed viewport scrolling interference when dragging, rotating, or resizing widgets on scenes wider than the viewport by locking `scrollLeft`/`scrollTop` (`lockedScrollRef`), applying `.canvas-drag-active` (`overflow: hidden; touch-action: none`), calling `e.currentTarget.setPointerCapture(e.pointerId)` + `e.preventDefault()`, and handling pointer movements via window-level `pointermove`/`pointerup`/`pointercancel` listeners.
- **Background Music & Simple Audio Editor (`src/utils/audioEngine.ts`, `src/components/studio/StudioAudioEditorModal.tsx`, `StudioBottomTimeline.tsx`, `StandaloneSignagePlayer.tsx`)**:
  - Added `AudioClipConfig` to `SignageProject` and `.signage` manifest (`packages/project-model/index.ts`, `packages/signage-format/index.ts`).
  - Implemented `StudioAudioEditorModal.tsx` with playback scope (`environment` across all scenes, `multi-scene`, or single `scene`), looping, non-destructive cropping (`trimStartMs`..`trimEndMs`), timeline start/stop by ms or frame (`startAtMs`..`stopAtMs`), audio effects (`fadeInMs`, `fadeOutMs`, `volume`, `channel` routing `stereo`/`left`/`right`/`mono`), deleting selected sections (`deletedRegions`), and combining multiple tracks into a single mix (`combineAudioTracks`).
- **Side Panel Inside-Edge Vertical Title & Resize Bars (`StudioLeftSidebar.tsx`, `StudioRightInspector.tsx`, `src/styles.css`)**:
  - Placed `.panel-inside-edge-bar.left-panel-edge` down the right (inside) edge of the left sidebar and `.panel-inside-edge-bar.right-panel-edge` down the left (inside) edge of the right inspector, each with a collapse/expand chevron at the top of the inside edge, rotated vertical title, and horizontal drag-to-resize.

### [2026-10-25 — Session 07] Extended Widget Types, Motion Presets, Rotation Angle Modifiers & Multi-Motion Timeline Sequencing

- **8 New Signage Widget Types (`packages/project-model/index.ts`, `SignageElementRenderer.tsx`, `StudioLeftSidebar.tsx`, `StudioRightInspector.tsx`)**:
  - Added `kpi` (KPI Metric & SVG Sparkline), `chart` (Vertical & Horizontal Bar Charts), `wayfinding` (Directional Arrow Sign with floor/distance/status), `queue` (Now Serving Ticket & Waiting Queue Board), `progress` (Radial SVG Gauge & Linear Capacity Meter), `social` (Verified Social Wall Post), `calendar` (Room Booking Door Schedule with `available`/`occupied`/`upcoming` status), and `alert` (CAP Emergency / Facility Advisory Banner).
- **12 New Motion Types & Multi-Motion Sequencing (`packages/animation-engine/index.ts`, `useStudioStore.ts`, `StudioRightInspector.tsx`, `StudioBottomTimeline.tsx`)**:
  - Added `spin-cw`, `spin-ccw`, `swing`, `pulse`, `float`, `shake`, `flip-y`, `skew-slide`, `drop-in`, `spiral-in`, `flash`, and `rubber-band` (28 motion presets total).
  - Updated `applyAnimationPreset` to append/stack multiple motions onto the same object by default (`replaceExisting: false`) and added `duplicateTrack` and `clearElementTracks`.
  - Updated `computeSceneElementsAtTime` to group tracks per `(elementId, property)` sorted by `delayMs` ascending so sequential motions on the same object only take over when the timeline reaches their `delayMs` start time.
  - Added **Start Time (`ms`)** and **Start Frame (`@ FPS`)** inputs, **Snap to Playhead**, **Rotation Angle (`°`)** slider/input (`rotationAngleDeg`), **Slide Distance (`px`)**, **Scale Factor**, and **Start/End Value** editors in `StudioRightInspector.tsx`, plus inline start time/frame inputs and horizontal span dragging on `StudioBottomTimeline.tsx`.

### [2026-10-25 — Session 08] Audio Waveform Click-and-Drag Section Selector & Red Preview Playhead Bar

- **Interactive Audio Waveform Section Selector (`src/components/studio/StudioAudioEditorModal.tsx`, `src/styles.css`)**:
  - Replaced single-click bar toggling with natural mouse/pointer drag selection (`waveformDrag` modes: `'new'`, `'resize-start'`, `'resize-end'`).
  - **Click and drag** sweeps out a new selection range (`[selectionStartMs, selectionEndMs]`).
  - Once a section is selected, **clicking on the right side and dragging** moves the **end** of the selection (`selectionEndMs`), while **clicking on the left side and dragging** moves the **start** of the selection (`selectionStartMs`).
  - **Clicking outside** the selection (without dragging) or **double-clicking** anywhere on the waveform unselects everything (`hasSelection = false`).
- **Red Audio Preview Position Bar (`activePlayheadBarIndex`, `.current-playhead-bar`)**:
  - During audio preview playback (`isPreviewPlaying`), `previewPositionMs` tracks the current playback position across the active crop window (`trimStartMs` .. `trimEndMs`) and highlights the corresponding waveform bar in **red** (`#ef4444`, `.current-playhead-bar`).

### [2026-10-25 — Session 09] Synchronized Component Grouping & Slide-In Actual Position Fix in Scene Designer

- **Synchronized Component Grouping (`packages/editor-core/index.ts`, `src/store/useStudioStore.ts`, `StudioTopToolbar.tsx`, `StudioLeftSidebar.tsx`, `StudioRightInspector.tsx`, `StudioCanvasWorkspace.tsx`)**:
  - Added `ungroupElements` and `applyElementOrGroupUpdate` in `packages/editor-core/index.ts`.
  - When any component belonging to a group (`el.parentGroupId`) is moved (`x`, `y`), resized (`width`, `height`, `x`, `y`), or rotated (`rotation`) on the canvas or in the Inspector, all components in that group move by `(dx, dy)`, scale proportionally in dimensions and relative offsets, and rotate by `dRot` together.
  - Added Group and Ungroup controls in the Top Toolbar, Left Sidebar Layers tab (with multi-select checkboxes and `🔗` badges), and Right Inspector (**Component Grouping (Sync Transform)** section with one-click quick grouping).
  - Animations (`scene.animationTracks`) that affect position, size, or rotation remain strictly scoped to their individual `elementId` in `computeSceneElementsAtTime` and never affect other objects in the group.
- **Slide-In / Motion Objects in Actual Position in Scene Designer (`StudioCanvasWorkspace.tsx`, `packages/editor-core/index.ts`, `useStudioStore.ts`)**:
  - Updated `StudioCanvasWorkspace.tsx` so that whenever `!timelinePlaying || dragState !== null`, elements render at their actual authored positions/sizes/rotations (`activeScene.elements`) instead of being stuck at `t = 0` start offsets of `slide-left`/`slide-right`/`slide-up`/`slide-down` animations.
  - Updated `applyAnimationPreset` so adding a preset in the Scene Designer does not force `timelinePlaying: true`.
  - Updated `applyElementOrGroupUpdate` so moving or rotating an animated object in the Scene Designer shifts its own `x`, `y`, and `rotation` animation track keyframes by the same delta so slide-in animations always land at the object's new actual position.

### [2026-10-25 — Session 10] Signage Player Viewport Auto-Scaling & Real Maintenance Key Sequence

- **Dynamic Player Viewport Auto-Scaling (`src/components/player/StandaloneSignagePlayer.tsx`, `src/styles.css`)**:
  - Replaced hardcoded `scale(var(--player-scale, 0.62))` with live viewport measurement using `ResizeObserver` on `.player-stage-wrapper`, `window.resize`, and `fullscreenchange`.
  - Added `.player-scaled-bounds` (`width = sceneW * scaleX`, `height = sceneH * scaleY`) with `.player-aspect-frame` (`transformOrigin: 'top left'`) so layout and visual bounds match 1:1 and center cleanly at any resolution.
  - Added a HUD scaling mode selector (`Auto-Fit Viewport`, `Auto-Fill Viewport`, `Stretch to Viewport`, `100% Native`) displaying the real-time scale percentage.
- **Real Player Maintenance Key Sequence & Kiosk Lockout Lifecycle (`packages/kiosk-integration/index.ts`, `StandaloneSignagePlayer.tsx`, `DeviceAdminView.tsx`)**:
  - Implemented `matchesMaintenanceHotkey` (for chords like `Ctrl+Shift+M` / `Ctrl+Alt+M`) and `MaintenanceSequenceTracker` (for multi-key hardware/remote sequences like `ArrowUp,ArrowUp,ArrowDown,ArrowDown,ArrowLeft,ArrowRight` and `m,a,i,n,t` with a 3.5s inter-key timeout).
  - Engaging Kiosk Lockout sets `body.kiosk-lockout-active` (hiding the global studio header as well as the player HUD so the signage scene fills 100% of the viewport cleanly without a permanent floating unlock button), shows a brief top-centered transient OSD hint that auto-fades, blocks `Escape`/`F5`/`Ctrl+R`, and opens the **Protected Kiosk Maintenance Authentication** modal when the hotkey chord, sequential key sequence, or 5-tap top-right corner gesture is triggered.
  - Authenticating opens a centered **Player Maintenance Mode Console** overlay (`.player-maintenance-console-backdrop` / `.player-maintenance-console-card`) in the center of the viewport (and in the top HUD bar) rather than placing maintenance status or telemetry at the bottom of the viewport, and `.player-scaled-bounds` uses `position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%)` inside `min-height: 0` flex containers so it never pushes elements down or inflates the stage height.
  - Automatically re-engages Kiosk Lockout when the time-limited maintenance session (`maintenanceRemainingSec`) expires.






### [2026-10-26 — Session 11] Phase 15 — Fleet Operations, Proof-of-Play & Verified Backups

**Trigger / Interpretation**: The user asked to "Start the next phase". `ROADMAP.md` showed Phases 0–14 all `[COMPLETED]`, so Phase 15 was defined from the remaining explicit gaps in `PROMPT.md` Sections 20, 32, 33 and 34: player health monitoring, playback-state monitoring, network diagnostics, database backups and audit retention.

1. **New pure-TS domain package (`packages/fleet-operations/index.ts`)**:
   - `normalizePlaybackEvents` validates/clamps/deduplicates untrusted player batches (`eventId` is the idempotency key); `aggregateProofOfPlay` clips to UTC windows, groups by scene/device-scene/device/day, and merges overlapping intervals.
   - `evaluateFleetHealth` grades `HEALTHY`/`DEGRADED`/`CRITICAL`/`OFFLINE` from heartbeat staleness, drift, FPS, render errors, stalled playback and failed commands; `DEFAULT_ALERT_RULES` supplies 6 editable rules.
   - `buildBackupArchive` / `verifyBackupArchive` produce canonical, secret-redacted, SHA-256-verified backups; `applyRetention` implements deterministic age + row-count pruning with pinned rows; `createDemoPlaybackEvents` / `createDemoHealthSamples` provide deterministic offline telemetry.
   - Zero React/Node/DOM dependencies (Architectural Rules 1–3), so the exact same math runs in Fastify, Vite, static Pages fallback and Vitest.

2. **SQLite schema & persistence (`server/db.ts`)**:
   - Added `playback_events` (unique `event_key`), `health_samples` (unique `sample_key`), `alert_rules`, `fleet_alerts` (unique alert ID), and `backups` tables plus indexes; `seedOperationalDefaultsIfEmpty()` seeds default rules and 8 hours of demo playback/health history even for pre-existing databases.
   - Added insert/list/ack/restore/prune helpers. `getBackupTables()` intentionally excludes `users` and `device_credentials`; `restoreBackupTables()` whitelists only `playback_events`, `health_samples`, `alert_rules` and `fleet_alerts` with fixed column lists inside `BEGIN IMMEDIATE` / `COMMIT` (`ROLLBACK` on error).

3. **REST API (`server/app.ts`)**:
   - New `/api/v1/operations/*` endpoints: `summary`, `proof-of-play`, `playback-events`, `health`, `health-samples`, `alerts`, `alerts/:id/acknowledge`, `alert-rules`, `backups`, `backups/:id`, `backups/:id/restore`, `retention`.
   - RBAC: device/admin/operator may ingest telemetry; operator may read; only admin may edit rules, create/restore backups or apply retention. All mutations are audited; new fleet KPIs (`activeFleetAlerts`, `lastBackupAtUtc`, `proofOfPlayToday`) were added to `/api/v1/server/overview`.

4. **Static GitHub Pages fallback & UI**:
   - `src/services/staticServerSimulator.ts` now implements every `/api/v1/operations/*` route in memory using the same pure-TS package (query strings parsed via `URLSearchParams`; new route matches use `pathOnly`). `player-06` is seeded with a 95-second stale heartbeat and 312 ms drift so static deployments demonstrate real alerts.
   - `NetworkManagementView.tsx` gained a sixth **Fleet Operations** tab with health KPIs, proof-of-play filters and daily bars, per-device health + FPS sparklines, editable alert rules, alert acknowledgement, backup create/verify/restore/download, retention, and telemetry-injection diagnostics. When no API is reachable, a deterministic offline demo (computed via `evaluateFleetHealth` + `aggregateProofOfPlay`) keeps the tab fully interactive — this also makes jsdom UI tests deterministic.

5. **Gotchas / decisions worth remembering**:
   - **Coverage semantics**: `totals.coverageMs` merges ALL scene intervals per device (one screen = one timeline), while `rows[].coverageMs` merges per device *within* each group. Do not sum row coverage to obtain fleet coverage when reports overlap across scenes.
   - **Alert storms**: alert IDs are `sha256(ruleId|deviceId|cooldownBucket)`; `saveFleetAlerts` uses `INSERT OR IGNORE` so repeated heartbeats and replays never duplicate alerts and never overwrite an `ACKNOWLEDGED` state.
   - **Offline flag**: `offlineRecorded` is set only when the player explicitly reports buffered telemetry; old timestamps alone are NOT evidence of an offline batch.
   - **Backup integrity**: the manifest checksum includes `createdAtUtc`, `retentionDays` and per-table checksums, and `verifyBackupArchive` re-redacts rows before recomputing checksums — so both manifest edits and table edits fail with `INTEGRITY_CHECK_FAILED`.
   - **Retention**: active alerts are pinned; `pruneOperationalData` covers playback events, health samples, fleet alerts, events and audit log with the same `applyRetention` policy as the static simulator.
   - **UI tests**: `getByRole('heading', ...)` is used for card headings because the fleet status line also contains the phrase "proof-of-play impressions"; `getAllByText` is used for state labels that appear more than once.

6. **Verification**: Added `tests/unit/phase15-fleet-operations.test.ts` (8 tests) and `tests/integration/phase15-fleet-operations.test.ts` (5 API tests), plus a new browser test in `tests/browser/studio-ui.test.tsx`. `npm test` → 7 files / 43 tests passing; `npm run build` → clean TypeScript + Vite production bundle.

---

## Key Credentials & Test Constants Reference

- **Default Kiosk & Server Admin Passphrase**: `ApexAdmin!2026`
- **Default Operator Passphrase**: `ApexOperator!2026`
- **Default Seeded Enrollment Code**: `ENROLL-APEX-2026`
- **Default Seeded Sync Session ID**: `session-20261025-001` (Group: `group-lobby-wall`)
- **Default Seeded Package ID**: `pkg-apex-lobby-v1`
- **Phase 15 Default Alert Rule IDs**: `rule-device-offline`, `rule-heartbeat-stale`, `rule-playback-stalled`, `rule-clock-drift`, `rule-low-fps`, `rule-command-failures`
- **Phase 15 Default Retention Policy**: 30 days / 5,000 rows; backup retention 30 days
- **Phase 15 API Prefix**: `/api/v1/operations/*` (summary, proof-of-play, playback-events, health, health-samples, alerts, alert-rules, backups, retention)
- **Phase 15 Test Fixtures**: `tests/unit/phase15-fleet-operations.test.ts`, `tests/integration/phase15-fleet-operations.test.ts`
