# Digital Signage Studio — Phased Implementation Roadmap (`ROADMAP.md`)

This document tracks the end-to-end engineering roadmap for **Digital Signage Studio**, covering Phases 1–7 from the Core Specification, Phases 8–13 from the Network Synchronization Addendum (`PROMPT.md`), and Phases 14–16 optional enterprise, fleet-operations and LAN-discovery extensions.

---

## Executive Status Summary

| Phase | Name | Status | Primary Modules / Files | Verification Suite |
|------:|------|--------|-------------------------|--------------------|
| **0** | Specification & Format Design First | **COMPLETED** | `docs/signage-file-format.md`, `docs/architecture.md`, `docs/script-api.md`, `docs/kiosk-deployment.md`, `docs/security-model.md` | Verified against Spec Decision 5 |
| **1** | Core Project Model and Editor | **COMPLETED** | `packages/project-model/`, `packages/editor-core/`, `src/store/useStudioStore.ts`, `src/components/studio/` | `tests/unit/project-and-animation.test.ts` |
| **2** | Media and Typography | **COMPLETED** | `src/components/shared/SignageElementRenderer.tsx`, `src/components/studio/StudioLeftSidebar.tsx`, `src/components/studio/StudioRightInspector.tsx` | `tests/unit/project-and-animation.test.ts` |
| **3** | Animation and Timeline Engine | **COMPLETED** | `packages/animation-engine/`, `src/components/studio/StudioBottomTimeline.tsx` | `tests/unit/project-and-animation.test.ts` |
| **4** | Custom `.signage` Binary Package Format | **COMPLETED** | `packages/signage-format/`, `packages/compression/`, `src/components/package-manager/PackageManagerView.tsx` | `tests/archive-fuzz/signage-format.test.ts` |
| **5** | Production Playback Engine | **COMPLETED** | `packages/playback-engine/`, `packages/playlist-engine/`, `src/components/player/StandaloneSignagePlayer.tsx` | `tests/integration/essential-e2e-and-sync.test.ts` |
| **6** | Kiosk Deployment, Script Sandbox & Security | **COMPLETED** | `packages/kiosk-integration/`, `packages/script-runtime/`, `packages/diagnostics/`, `apps/desktop-host/`, `src/components/admin/DeviceAdminView.tsx` | `tests/archive-fuzz/signage-format.test.ts`, `tests/integration/essential-e2e-and-sync.test.ts` |
| **7** | Hardening, Fuzzing & Release QA | **COMPLETED** | `tests/archive-fuzz/`, `tests/integration/`, `tests/browser/` | All 17 Vitest suites passing |
| **8** | Network Server Foundation | **COMPLETED** | `server/db.ts`, `server/app.ts`, `server/index.ts` | `tests/integration/essential-e2e-and-sync.test.ts` |
| **9** | Package Repository and Distribution | **COMPLETED** | `server/app.ts` (`/api/v1/packages`, `/api/v1/deployments`), `packages/playback-engine/` (`AtomicPlayerPackageCache`) | `tests/integration/essential-e2e-and-sync.test.ts` (Test 6) |
| **10** | Centralized Playlists and Schedules | **COMPLETED** | `packages/playlist-engine/`, `server/app.ts` (`/api/v1/playlists`, `/api/v1/schedules`) | `tests/unit/project-and-animation.test.ts` |
| **11** | Synchronized Playback & Drift Control | **COMPLETED** | `packages/playback-engine/` (`evaluateAuthoritativeTimeline`, `ClockSyncEngine`, `evaluateDriftCorrection`), `server/app.ts` (`/api/v1/sessions`, `/api/v1/clock/sync`) | `tests/integration/essential-e2e-and-sync.test.ts` (Tests 1–3, 8, 10) |
| **12** | Network Management UI & Video Wall Simulator | **COMPLETED** | `src/components/network/NetworkManagementView.tsx` | `tests/browser/studio-ui.test.tsx` |
| **13** | Reliability, Persistence & Security Hardening | **COMPLETED** | `server/db.ts`, `server/app.ts` (`/api/v1/commands`, `/api/v1/audit-log`) | `tests/integration/essential-e2e-and-sync.test.ts` (Tests 4, 5, 7, 9, 10) |
| **14** | Enterprise Extensions (Delta Patch, Desktop Installers, S3/Postgres Adapters) | **COMPLETED** | `packages/signage-format/`, `apps/desktop-host/`, `server/adapters/storage-adapter.ts` | `tests/unit/enterprise-phase14.test.ts` |
| **15** | Fleet Operations (Proof-of-Play, Health Alerts, Verified Backups) | **COMPLETED** | `packages/fleet-operations/`, `server/db.ts`, `server/app.ts` (`/api/v1/operations/*`), `src/components/network/NetworkManagementView.tsx`, `src/services/staticServerSimulator.ts` | `tests/unit/phase15-fleet-operations.test.ts`, `tests/integration/phase15-fleet-operations.test.ts`, `tests/browser/studio-ui.test.tsx` |
| **16** | Windows CLI LAN Discovery Scanner | **COMPLETED** | `server/app.ts` (`/api/v1/discovery`), `tools/network-scanner/`, `tools/windows/`, `src/services/staticServerSimulator.ts` | `tests/unit/network-discovery.test.mjs`, `tests/integration/network-discovery.test.mjs` |

---

## Detailed Phase Breakdown

### Phase 0: Format & Architecture Specification First (Decision 5) — [COMPLETED]
- [x] Document the `.signage` 64-byte little-endian binary header, directory entry binary layout, compression rules, manifest schema, and 12-step validation pipeline (`docs/signage-file-format.md`).
- [x] Document strict architectural rules ensuring UI independence for `project-model`, `playback-engine`, and `signage-format` (`docs/architecture.md`).
- [x] Document the restricted script sandbox API and capability permission model (`docs/script-api.md`).
- [x] Document OS-level Windows/Linux kiosk deployment and desktop wrapper integration (`docs/kiosk-deployment.md`).
- [x] Document the end-to-end threat model and security controls (`docs/security-model.md`).

### Phase 1: Core Project Model and Editor — [COMPLETED]
- [x] Define pure TypeScript schemas (`SignageProject`, `ProjectSettings`, `ProjectTheme`, `Scene`, `SceneElement`, `AnimationTrack`, `Keyframe`, `Playlist`, `PlaybackSchedule`, `ScriptModule`) in `packages/project-model/index.ts` with zero React dependency.
- [x] Implement schema validation (`validateProject`) and legacy schema migration (`migrateProjectSchema`).
- [x] Implement multi-scene management (add, duplicate, delete, reorder, entry scene selection, scene transitions).
- [x] Implement interactive logical-resolution canvas (`1920×1080`, `3840×2160`, `1080×1920`, `1080×1080`, `2560×720`) with zoom, rulers, grid, and broadcast 90% safe-area overlays (`src/components/studio/StudioCanvasWorkspace.tsx`).
- [x] Implement pointer-based drag-to-move, 8-point resize handles (`nw`, `n`, `ne`, `e`, `se`, `s`, `sw`, `w`), rotation handle, snap-to-grid, and snap-to-element alignment guides (`computeSnappedPosition`).
- [x] Implement alignment (`left`, `center`, `right`, `top`, `middle`, `bottom`), distribution (`horizontal`, `vertical`), grouping (`groupElements`), and layer Z-order operations (`front`, `back`, `forward`, `backward`).
- [x] Implement Undo/Redo command history stack (`useStudioStore.ts`) and global keyboard shortcuts (`Ctrl+Z`, `Ctrl+Y`, `Ctrl+C`, `Ctrl+V`, `Ctrl+D`, `Delete`).
- [x] Implement automatic IndexedDB persistence with localStorage fallback and crash-recovery snapshots (`saveProjectPersistence`, `loadProjectPersistence`).

### Phase 2: Media, Widgets, and Typography — [COMPLETED]
- [x] Implement rich-text elements with font family, size, weight, color, alignment, letter spacing, line height, outline, wrapping, scrolling, LTR/RTL direction, inline double-click editing, and live dynamic placeholders (`{{time}}`, `{{date}}`, `{{deviceName}}`, `{{sceneName}}`).
- [x] Implement image and SVG vector asset importing, object-fit modes (`cover`, `contain`, `fill`), masks (`circle`, `rounded`, `diamond`), and CSS filters (`brightness`, `contrast`, `blur`, `grayscale`).
- [x] Implement HTML5 video and audio elements with loop, mute, volume, playback rate, and Canvas 2D synthetic stream fallback.
- [x] Implement scalable SVG vector shapes (`rectangle`, `roundedRect`, `circle`, `ellipse`, `line`, `polygon`, `diamond`).
- [x] Implement signage widgets (`clock`, `date`, `countdown`, deterministic SVG `qrcode`, scrolling `ticker`, tabular `datafeed`, and `weather`).
- [x] Implement Media Library analysis (`analyzeProjectAssets`) detecting SHA-256 content-hash duplicates, missing assets, unused assets, and estimated `.signage` package size.

### Phase 3: Animation and Timeline Engine — [COMPLETED]
- [x] Implement shared timeline progress evaluation (`Progress = (CurrentTimelinePosition - A) / Duration`) supporting delay, repeat count, infinite loops, reverse playback, and fill modes (`none`, `forwards`, `backwards`, `both`) in `packages/animation-engine/index.ts`.
- [x] Implement keyframe interpolation for numeric properties, hex colors, step values, typewriter text reveal (`textRevealRatio`), and wipe progress (`cropProgress`).
- [x] Implement easing functions (`linear`, `easeIn`, `easeOut`, `easeInOut`, `bounce`, `elastic`, `step`).
- [x] Implement 14 built-in motion presets (`fade-in/out`, `slide-left/right/up/down`, `zoom-in/out`, `bounce`, `rotate`, `flip`, `typewriter`, `wipe`, `ken-burns`).
- [x] Implement scene entry/exit transition computation (`fade`, `slide-left`, `slide-right`, `slide-up`, `zoom`, `wipe`).
- [x] Implement the bottom multi-track timeline editor (`StudioBottomTimeline.tsx`) with timecode/frame toggle (30 FPS default), play/pause/stop/scrub controls, keyframe diamonds, track mute/lock, and audio waveform lane.

### Phase 4: Custom `.signage` Binary Package Format — [COMPLETED]
- [x] Implement 64-byte little-endian binary header encoder/decoder (`SIGNAGE\0`, `formatVersion`, `headerSize = 64`, `featureFlags`, 64-bit `directoryOffset` & `directoryLength`, `manifestEntryId`, `entryCount`, 24 zero reserved bytes) in `packages/signage-format/index.ts`.
- [x] Implement variable-length binary directory encoding/decoding with 32-byte SHA-256 content hashes per entry.
- [x] Implement random-access single-entry reader (`readArchiveEntryBytes`) that decompresses and verifies SHA-256 of an individual entry without decompressing the entire archive.
- [x] Implement bounded Deflate/LZ compression (`packages/compression/index.ts`) and MIME-aware compression policy (compressing JSON/SVG/scripts while storing PNG/JPEG/WebP/MP4/WebM/WOFF2 unchanged) with `Fast` and `Compact` export profiles.
- [x] Implement the 12-step archive validation pipeline (`validateSignageArchive`) protecting against corrupted headers, overlapping offsets, path traversal (`../`), decompression bombs, and tampered payloads without executing scripts.
- [x] Implement publisher signature generation & verification (`computePublisherSignature`) and package version comparison (`compareSignagePackages`).
- [x] Implement the Package Manager UI (`PackageManagerView.tsx`) with 64-byte header hex dump, directory inspector, corruption defense test bench, and version diffing.

### Phase 5: Production Playback Engine — [COMPLETED]
- [x] Implement standalone package extraction and playback orchestration (`packages/playback-engine/index.ts`) independent of editor UI components.
- [x] Implement playlist timeline sequencing (`buildPlaylistTimeline`) with priority announcements and duration overrides (`packages/playlist-engine/index.ts`).
- [x] Implement deterministic schedule evaluation (`resolveActivePlaylist`) with date ranges, days of week, time windows, date-specific overrides, priority rules, deterministic tie-breaking, and fallback playlist recovery.
- [x] Implement `AtomicPlayerPackageCache` so new package downloads are staged and SHA-256 validated before atomic promotion, preserving the active and rollback packages during interrupted or corrupted downloads.
- [x] Implement the Standalone Signage Player UI (`StandaloneSignagePlayer.tsx`) capable of loading `.signage` files from disk or session memory and playing offline.

### Phase 6: Kiosk Deployment, Script Sandbox, and Security — [COMPLETED]
- [x] Implement `RestrictedScriptRuntime` (`packages/script-runtime/index.ts`) with zero `eval()` or `new Function()`, explicit capability permission checks, CPU instruction budget (`maxOperationsPerInvoke`), state key quota, message rate limits, and automatic timer/handler disposal on `onSceneExit`.
- [x] Implement `ProtectedAdminController` (`packages/kiosk-integration/index.ts`) using multi-round salted SHA-256 digests, failed-attempt lockout, time-limited maintenance sessions, and audit logging.
- [x] Implement hidden 5-tap top-right corner gesture and maintenance unlock flow in `StandaloneSignagePlayer.tsx`.
- [x] Implement `WatchdogSupervisor` (`packages/kiosk-integration/index.ts`) with bounded restart retries, failing-package quarantine (preventing infinite restart loops), and Safe Recovery Screen fallback.
- [x] Implement `DiagnosticsCollector` (`packages/diagnostics/index.ts`) with automatic redaction of passwords, tokens, bearer headers, and secrets.
- [x] Provide desktop host wrapper (`apps/desktop-host/kiosk-host.ts`) and Linux `systemd` kiosk unit (`apps/desktop-host/linux-kiosk.service`).

### Phase 7: Hardening, Fuzzing, and Essential E2E Verification — [COMPLETED]
- [x] Implement unit tests for project validation, migrations, editor transforms, animation math, schedule resolution, and diagnostic redaction (`tests/unit/project-and-animation.test.ts`).
- [x] Implement binary format round-trip tests, compression policy tests, corruption/decompression-bomb/fuzz tests, and script sandbox security tests (`tests/archive-fuzz/signage-format.test.ts`).
- [x] Implement the complete 19-step Essential End-to-End workflow test (`tests/integration/essential-e2e-and-sync.test.ts`).
- [x] Implement React UI mode-switching and component integration tests (`tests/browser/studio-ui.test.tsx`).

### Phase 8: Network Server Foundation (Addendum) — [COMPLETED]
- [x] Implement Fastify REST API (`server/app.ts`, `server/index.ts`) and WebSocket real-time gateway (`/ws`).
- [x] Implement SQLite relational database (`server/db.ts`) with all tables from Spec Section 32 (`users`, `devices`, `device_credentials`, `enrollment_codes`, `groups`, `group_members`, `packages`, `playlists`, `schedules`, `sessions`, `session_devices`, `commands`, `events`, `deployments`, `audit_log`).
- [x] Implement single-use expiring enrollment codes (`/api/v1/devices/enrollment-codes`, `/api/v1/devices/enroll`), per-device credential issuance & revocation (`/api/v1/devices/:deviceId/revoke`), and heartbeat monitoring (`/api/v1/devices/:deviceId/heartbeat`).

### Phase 9: Package Repository and Distribution (Addendum) — [COMPLETED]
- [x] Implement server-side `.signage` package upload and 12-step archive validation (`POST /api/v1/packages`).
- [x] Implement content-addressed SHA-256 package storage (`storePackageBytes`, `readPackageBytes`) with automatic deduplication.
- [x] Implement package downloads (`GET /api/v1/packages/:packageId/download`) and group deployments (`POST /api/v1/deployments`).

### Phase 10: Centralized Playlists and Schedules (Addendum) — [COMPLETED]
- [x] Implement revision-tracked server playlists (`GET/POST /api/v1/playlists`) and group schedules (`GET /api/v1/schedules`).
- [x] Implement deterministic conflict resolution and offline cached schedule fallback.

### Phase 11: Synchronized Playback & Clock Coordination (Addendum) — [COMPLETED]
- [x] Implement NTP-style 4-timestamp clock exchange endpoint (`POST /api/v1/clock/sync`) and client `ClockSyncEngine` (`Offset = ((T2 - T1) + (T3 - T4)) / 2`, `RTT = (T4 - T1) - (T3 - T2)`) with outlier rejection, uncertainty estimation, gradual slew, and large-jump detection.
- [x] Implement server-authoritative timeline sessions (`POST /api/v1/sessions`, `GET /api/v1/sessions/:sessionId`) with player readiness checks, group failure policies (`START_WITH_AVAILABLE`, `WAIT_FOR_ALL`, `REMOVE_UNAVAILABLE`, `ABORT`, `CONTINUE_PREVIOUS`), and future scheduled UTC start times (`startTimeUtc`).
- [x] Implement deterministic late-join scene and elapsed-offset calculation (`evaluateAuthoritativeTimeline`).
- [x] Implement playback drift reporting (`POST /api/v1/sessions/:sessionId/report`), drift classification (`NONE`, `RATE_ADJUST`, `CONTROLLED_SEEK`, `REINITIALIZE_SCENE`), and group resynchronization (`POST /api/v1/sessions/:sessionId/resynchronize`).

### Phase 12: Network Management UI (Addendum) — [COMPLETED]
- [x] Implement `NetworkManagementView.tsx` covering Server Overview, Synchronized Multi-Screen Wall Simulator (6 virtual displays rendering the shared timeline in real time), Devices & Enrollment, Groups & Package Distribution, Remote Commands, and Security Audit Log.
- [x] Provide interactive test controls in the UI for scheduling future group starts, simulating late-joining displays, injecting +780ms clock drift with automatic seek recovery, and simulating LAN disconnect/reconnect.

### Phase 13: Reliability, Command Security, and Acceptance Tests (Addendum) — [COMPLETED]
- [x] Implement persistent command queue (`POST /api/v1/commands`, `POST /api/v1/commands/:commandId/ack`) supporting all 17 command types from Spec Section 29 with expiration enforcement, idempotency key deduplication, and RBAC checks.
- [x] Implement all 10 Synchronization Acceptance Tests from Spec Section 35 (`tests/integration/essential-e2e-and-sync.test.ts`), including server restart persistence recovery (Test 5), authorization & replay rejection (Test 9), and 72-hour soak simulation (Test 10).
- [x] Configure static **GitHub Pages** CI/CD pipeline (`.github/workflows/deploy-pages.yml`), relative Vite asset paths (`base: './'`), `.nojekyll`, `404.html` SPA fallback, and client-side virtual API fallback (`src/services/staticServerSimulator.ts`) so all 5 application modes function seamlessly on static GitHub Pages deployments.

---

## Phase 14: Optional Future Enterprise Extensions — [COMPLETED]
- [x] **Binary Delta Patch Transport (Spec 27.5)**: Implemented `buildSignageDeltaPatch` and `applySignageDeltaPatch` in `packages/signage-format/index.ts`, added `POST /api/v1/packages/delta` in `server/app.ts`, and integrated WAN delta bandwidth savings + bit-identical SHA-256 verification into `PackageManagerView.tsx`.
- [x] **Native Desktop Host Packaging**: Added CLI flag parser (`parseKioskCliArgs`), multi-display bounds resolver (`resolveTargetDisplayBounds`), strict kiosk CSP generator (`buildKioskCspHeader`), `apps/desktop-host/electron-builder.yml` (`.deb`, `.AppImage`, `.msi`, `.dmg`), `apps/desktop-host/tauri.conf.json`, and Windows 11 Enterprise provisioning script (`apps/desktop-host/windows-kiosk-provision.ps1`).
- [x] **PostgreSQL & S3 Storage Adapters**: Implemented `FilesystemBlobStorageAdapter`, `S3CompatibleBlobStorageAdapter` (with SigV4 presigned URL generation), and `PostgresClusterAdapter` (with `?` → `$1` SQL parameter translation and multi-node session leader advisory locks) in `server/adapters/storage-adapter.ts`.
- [x] **Collapsible Editor Side Panels & Mobile-Friendly Layout**: Added collapsible Left Sidebar, Right Inspector, and Bottom Timeline docks (both via header/rail controls and top toolbar toggles), responsive mobile phone detection (`<= 768px` or manual **Mobile View** toggle), slide-over mobile studio drawers, and a bottom mobile drawer switcher bar (`Canvas`, `Add / Scenes`, `Inspector`, `Timeline`).
- [x] **Mobile Player Setup QR Code Provisioning**: Added a **Setup QR Code** modal on the Signage Player (`StandaloneSignagePlayer.tsx`) encoding a `signage://enroll?...` provisioning payload (`src/utils/enrollmentQr.ts`) into a 21×21 QR matrix, and added a **Scan Player Setup QR Code** camera/viewfinder modal in Network Management → Devices & Enrollment (`NetworkManagementView.tsx`).
- [x] **Multi-Type QR Code Widget with Error Correction & Center Logo**: Added 9 QR content types (`link`, `wifi`, `contact`/vCard, `email`, `sms`, `phone`, `geo`, `event`, `text`), selectable error correction levels (`L`, `M`, `Q`, `H`), module dot styles (`square`, `rounded`, `dots`), custom corner eye color, quiet zone control, and center logo overlay (`src/utils/qrCodeGenerator.ts`, `SignageElementRenderer.tsx`, `StudioRightInspector.tsx`).
- [x] **Canvas Drag / Rotate / Resize Scroll Fix**: Locked viewport scroll and attached window-level `pointermove`/`pointerup`/`pointercancel` listeners with `setPointerCapture` and `touchAction: 'none'` in `StudioCanvasWorkspace.tsx` so dragging, resizing, or rotating widgets on wide scenes never triggers viewport scrolling or drops pointer capture.
- [x] **Background / Scene / Environment Audio Playback & Simple Audio Editor**: Implemented `AudioClipConfig`, `src/utils/audioEngine.ts`, and `StudioAudioEditorModal.tsx` supporting continuous `environment` background music, `multi-scene`, or single-`scene` audio, looping, non-destructive segment cropping (`trimStartMs`..`trimEndMs`), starting/stopping at specific ms or frames (`startAtMs`..`stopAtMs`), audio effects (`fadeInMs`, `fadeOutMs`, `volume`, `channel` routing `stereo`/`left`/`right`/`mono`), deleting selected sections (`deletedRegions`), and combining multiple tracks into a single mix.
- [x] **Inside-Edge Vertical Panel Title & Resize Bars**: Added vertical inside-edge title bars (`.panel-inside-edge-bar`) down the right edge of `StudioLeftSidebar.tsx` and the left edge of `StudioRightInspector.tsx` with rotated vertical panel titles, inside-edge collapse/expand chevrons, and horizontal drag-to-resize handles.
- [x] **Extended Signage Widget Suite (14 Widget Types)**: Added 8 new broadcast widget types (`kpi` Metric & Sparkline, `chart` Vertical/Horizontal Bar Chart, `wayfinding` Directional Sign, `queue` Now Serving Ticket Counter, `progress` Radial/Linear Capacity Gauge, `social` Social Wall Post, `calendar` Room Booking Schedule, and `alert` CAP Emergency Advisory) with palette buttons in `StudioLeftSidebar.tsx`, live rendering in `SignageElementRenderer.tsx`, and contextual property editors + Widget Type switcher in `StudioRightInspector.tsx`.
- [x] **Extended Motion Presets, Property Modifiers & Multi-Motion Timeline Sequencing per Object**: Added 12 new motion presets (`spin-cw`, `spin-ccw`, `swing`, `pulse`, `float`, `shake`, `flip-y`, `skew-slide`, `drop-in`, `spiral-in`, `flash`, `rubber-band` — 28 presets total), enabled stacking multiple motions on a single object without overwriting earlier motions (`computeSceneElementsAtTime`), added per-track property modifiers (**Rotation Angle `°`**, **Slide Distance `px`**, **Scale Factor**, **Start/End Keyframe Values**, **Repeat Count**, **Ping-Pong Reverse**), and added **Start Time (`ms`)** & **Start Frame (`@ FPS`)** controls in both the Motion Inspector and the Bottom Timeline (with horizontal span dragging).
- [x] **Audio Waveform Click-and-Drag Section Selector & Red Preview Playhead Bar**: Upgraded `.audio-waveform-canvas` in `StudioAudioEditorModal.tsx` to support click-and-drag range selection, left-side click-and-drag to move the start of the selection, right-side click-and-drag to move the end of the selection, clicking outside or double-clicking to unselect everything, and highlighting the current preview position bar in **red** (`#ef4444`, `.current-playhead-bar`) during audio preview playback.
- [x] **Synchronized Component Grouping & Slide-In Actual Position in Scene Designer**: Implemented `ungroupElements` and `applyElementOrGroupUpdate` in `packages/editor-core/index.ts`, integrated synchronized group move/resize/rotate into `useStudioStore.ts`, exposed Group/Ungroup controls in `StudioTopToolbar.tsx`, `StudioLeftSidebar.tsx` (Layers tab with multi-select checkboxes), and `StudioRightInspector.tsx`, ensured animations remain strictly scoped to individual objects (`computeSceneElementsAtTime`), and updated `StudioCanvasWorkspace.tsx` so slide-in / motion objects always render in their actual authored position in the Scene Designer (and shift their `x`/`y`/`rotation` animation keyframes when moved or rotated).
- [x] **Signage Player Viewport Auto-Scaling & Real Maintenance Key Sequence**: Updated `StandaloneSignagePlayer.tsx` to automatically measure `.player-stage-wrapper` via `ResizeObserver` + `window.resize` + `fullscreenchange` and dynamically scale the scene (`auto-fit`, `auto-fill`, `stretch`, `native`) inside absolutely-centered `.player-scaled-bounds`; implemented `matchesMaintenanceHotkey` and `MaintenanceSequenceTracker` in `packages/kiosk-integration/index.ts` so Kiosk Lockout hides all application chrome cleanly (`body.kiosk-lockout-active`), responds to the configured Maintenance Hotkey Chord (`Ctrl+Shift+M`), sequential hardware/remote key sequence (`↑ ↑ ↓ ↓ ← →` or `M A I N T`), or 5-tap corner gesture, opens a centered **Player Maintenance Mode Console** overlay (instead of placing maintenance status/indicators at the bottom of the viewport), and automatically re-locks when the time-limited maintenance session expires.





---

## Phase 15: Fleet Operations — [COMPLETED]

**Objective:** Close the remaining operations gaps in Spec Sections 20, 32, 33 and 34 — player health monitoring, playback-state monitoring, network diagnostics, database backups and audit retention — with a fully testable, offline-capable subsystem that works both against the Fastify/SQLite server and on static GitHub Pages.

- [x] **Pure-TS Fleet Operations Domain Package (`packages/fleet-operations/`)**: Added `normalizePlaybackEvents`, `aggregateProofOfPlay`, `evaluateFleetHealth`, `summarizeHealthHistory`, `buildBackupArchive`, `verifyBackupArchive`, `applyRetention`, `redactBackupRow`, deterministic demo telemetry generators, 6 default alert rules and configurable health thresholds — zero React/Node/DOM dependencies so it runs in the server, browser, workers and Vitest.
- [x] **De-duplicated Proof-of-Play**: Added append-only `playback_events` storage with idempotent `event_key` ingestion (offline batch replay safe), bounded batch limits, window clipping, per-device interval merging (one screen = one timeline), scene/device/day grouping, dwell vs. unique display time, completion ratios and offline-buffered counters.
- [x] **Heartbeat Health Grading & Alert Rules**: Added `health_samples`, `alert_rules` and `fleet_alerts` tables, `HEALTHY`/`DEGRADED`/`CRITICAL`/`OFFLINE` grading from heartbeat staleness, drift, FPS, render errors, stalled playback and failed commands, plus deterministic cooldown-bucketed alert IDs (no alert storms), acknowledgement idempotency and editable rule thresholds/severity/enabled state.
- [x] **Verified Backups & Restore**: Added SHA-256 manifest backups that exclude credential tables, redact secret-like columns, sort rows canonically, and recompute every table checksum plus the manifest checksum before restore; restore is limited to operational telemetry tables and is rejected with `INTEGRITY_CHECK_FAILED` on any tampering.
- [x] **Audit & Telemetry Retention**: Added deterministic age + row-count pruning for playback events, health samples, alerts, events and audit log with pinned active alerts, exposed through an admin-only `POST /api/v1/operations/retention` endpoint and audited in `audit_log`.
- [x] **Fleet Operations REST API (`server/app.ts`)**: Added `/api/v1/operations/summary`, `/proof-of-play`, `/playback-events`, `/health`, `/health-samples`, `/alerts`, `/alerts/:id/acknowledge`, `/alert-rules`, `/backups`, `/backups/:id`, `/backups/:id/restore` and `/retention`, with RBAC (device ingest vs. operator read vs. admin mutation), WebSocket broadcasts, audit logging and new fleet KPIs in `/api/v1/server/overview`.
- [x] **Network Console "Fleet Operations" Tab**: Added a sixth Network Management tab with health KPIs, proof-of-play filtering (Today / 7 days / All; group by scene, device+scene, device or UTC day), daily display-time bars, per-device health states and FPS sparklines, editable alert rules, active alert acknowledgement, verified backup create/verify/restore/download, retention controls, and telemetry-injection diagnostics (offline, stalled, +780 ms drift, healthy recovery).
- [x] **Static GitHub Pages Parity**: Extended `src/services/staticServerSimulator.ts` with an in-memory implementation of every `/api/v1/operations/*` endpoint using the same pure-TS package (including seeded stale-heartbeat/drift alerts), plus a deterministic offline UI demo fallback so the console remains interactive without any backend.
- [x] **Verification**: Added `tests/unit/phase15-fleet-operations.test.ts` (8 tests: normalization, overlap-safe aggregation, alert determinism, backup tamper detection, retention), `tests/integration/phase15-fleet-operations.test.ts` (5 API tests: seeded telemetry, idempotent ingest, alert lifecycle, RBAC, backup/restore/retention) and a new browser UI test in `tests/browser/studio-ui.test.tsx`; `npm test` = 43/43 passing, `npm run build` = clean.
---

## Phase 16: Windows CLI LAN Discovery Scanner — [COMPLETED]

**Objective:** Let a Windows technician locate the Digital Signage Studio management server on a LAN from `cmd.exe` or PowerShell, without hardcoding an IP address and without mistaking an unrelated service on port 4000 for a signage server.

- [x] **Discovery Contract (`server/app.ts`, `src/services/staticServerSimulator.ts`)**: Added an unauthenticated, secret-free `GET /api/v1/discovery` endpoint returning `service = "digital-signage-studio"`, `protocolVersion`, stable `instanceId`, display name/version, UTC server time, scheme/host/port/base URL, endpoint paths, and feature flags. Exported `SIGNAGE_DISCOVERY_SERVICE_ID` / `SIGNAGE_DISCOVERY_PROTOCOL_VERSION` / `SIGNAGE_DISCOVERY_PATH`; mirrored the contract in the static Pages simulator and logged the endpoint on server startup.
- [x] **Pure Discovery Helpers (`tools/network-scanner/discovery-core.mjs`)**: Implemented IPv4/CIDR math, host/range expansion, local NIC subnet enumeration, URL building, service-descriptor validation, bounded-concurrency mapping, CLI argument parsing and a loopback fallback when no LAN NIC is usable — all dependency-free and unit-testable.
- [x] **Dependency-Free CLI (`tools/network-scanner/find-signage-server.mjs`)**: Auto-detects local IPv4 subnets (or accepts `--subnet` overrides), concurrently TCP-probes the configured port, verifies open ports via `GET /api/v1/discovery`, and emits human, JSON or quiet output with deterministic exit codes (0 found / 1 not found / 2 invalid usage). Supports `--port`, `--scheme`/`--https`, timeouts, concurrency, `--max-hosts` safety cap, `--first`, `--no-tcp-probe`, `--insecure`, link-local/loopback/network-broadcast toggles and a custom `--service-id`.
- [x] **Windows Entry Points (`tools/windows/`)**: Added `find-signage-server.cmd` (cmd.exe launcher) and `Find-SignageServer.ps1` (PowerShell cmdlet-style front-end with `-Subnet`, `-Json`, `-First`, `-Https`, `-Insecure`, etc.), plus `npm run scan:server` for cross-platform use.
- [x] **Documentation**: Added `tools/network-scanner/README.md` (usage, output modes, arguments, exit codes, firewall notes), plus architecture/kiosk/security notes for the discovery contract.
- [x] **Verification**: Added `tests/unit/network-discovery.test.mjs` (11 tests: IPv4 math, CIDR/range expansion, URL building, descriptor validation, CLI parsing, fallback, concurrency) and `tests/integration/network-discovery.test.mjs` (5 tests: descriptor shape, real server discovery via child-process CLI, decoy HTTP rejection, auto-detect handling, invalid arguments). `npm test` = 59/59 passing, `npm run build` = clean, and the GitHub Actions `npm test` + `build:pages` job passes on the pushed branch (the auto-detect test tolerates CI Docker `/16` bridges via the `--max-hosts` safety cap).

## Editor Interaction Enhancement — Resize Grid & Context Menu

- [x] Show the configured logical-pixel grid during resizing; dwell for 1.8 seconds without significant movement to snap active edges (opposite edges anchored, minimum size and aspect lock respected).
- [x] Right-click or hold touch for 1.5 seconds to open component actions: copy, cut, paste, duplicate, delete and properties. Background menu supports paste.
- [x] Keep touch hold active through movement; cancel pending hold on release/cancel; dismiss menu outside or with Escape; arrow-key menu navigation and touch-friendly targets.
- [x] Resize gesture undo checkpoint and automated interaction/geometry coverage (`tests/browser/canvas-interactions.test.tsx`).

## Editor Grid Settings Dropdown

- [x] Toolbar grid icon opens an accessible, outside-click/Escape-dismissible settings popover (portaled outside toolbar overflow).
- [x] Configure spacing (4–256 logical pixels), color, solid/dashed/dotted lines, persistent visibility, temporary visibility while moving/resizing, grid snapping and component snapping.
- [x] Save grid preferences in project settings with backward-compatible optional fields and undo support; rendering and resize/move snapping honor those preferences independently.
- [x] Browser tests verify dropdown editing, SVG grid style/spacing/color, undo, visibility and disabled resize snapping. Full suite: 65 tests passing; production build passes.

## Scene Aspect Lock

- [x] Scene-level aspect lock toggle in toolbar and inspector; saved with scene and undoable, defaults off for existing scenes.
- [x] When enabled, expose only four corner resize handles and preserve each component's current ratio (without overwriting component-level locks).
- [x] Corner resizing uses the dominant pointer axis and anchors the opposite corner, including grid dwell snapping.
- [x] Regression coverage exercises all four corners, ratio preservation, opposite anchors, restoring eight handles and undo. Full suite: 66 tests passing; production build passes.

## Declarative Scripting — Authoring & Standalone Playback

- [x] Create/select/edit JSON scripts, validate/save, enable/disable, delete, bind per scene, and grant explicit project/scene permissions with undo/persistence.
- [x] Selected-script sandbox with configurable elapsed time/event, output/errors/denials and undoable element preview (replaces the first-script-only demo).
- [x] Player lifecycle initialize/enter/tick/event/exit/dispose, scene-loop reinitialization, tick throttling and pause-aware event delivery.
- [x] Transient text/visibility/opacity, authored animation restart, click/tap and named host events, structured logging, local scene/playlist navigation, bounded one-shot timer events and once-per-entry rules.
- [x] Validate untrusted rules, require three-layer permissions, bound operations/messages/timers/queued events/diagnostics; teardown on scene exit, package change and unmount.
- [x] Unit/browser regression coverage and operator/API examples in `docs/script-api.md`. Verification: 74 tests / 12 files passing, TypeScript/Vite build passing.
- Scope: JSON rules only, no arbitrary JS or external datafeed query action. Local player navigation does not override server-authoritative network sessions. Scene navigation targets slots in the active playlist.

## Scene Templates & New Scene Workflow

- [x] New Scene opens a blank-versus-template choice; template choice opens a searchable, category-filtered template browser.
- [x] Six built-in editable layouts: Corporate Welcome, Café Menu, Event Spotlight, Retail Promotion, Building Directory and Team Announcement. Each card shows a shared-renderer preview, native pixel dimensions/orientation, description and bottom Select button.
- [x] Blank scene is genuinely empty. Template instantiation allocates fresh IDs and fits proportionally/centers on the existing project canvas without changing its resolution or stretching text.
- [x] New scenes activate immediately and join the default playlist in one undoable persisted change; dialogs support Escape, cancel/back, focus containment/restoration and responsive scrolling.
- [x] Tests cover New Scene integration, blank creation, browser previews/dimensions/filter/search, selection, undo, cancellation and fitting/ID independence across all layouts. Full verification: 78 tests / 13 files; production build passing.

## Export Current Scene as a Template

- [x] Toolbar **Export Scene Template** saves the current scene into the browser's persistent **My Templates** library and downloads a versioned `.signage-template.json` file.
- [x] Personal templates appear in the existing browser with previews, native dimensions, search/category filtering and Select actions.
- [x] Export includes scene settings, components, animation tracks, referenced embedded media/fonts, bound scripts and scene/multi-scene audio. Creating an instance remaps scene/component/group/track/keyframe/asset/script IDs and fits proportionally; imported dependencies and playlist insertion share one undoable change.
- [x] Storage/quota failures produce a warning while preserving the download; missing/external media is rejected rather than silently producing a broken portable file. Library is browser/origin-local, separate from project undo/reset.
- [x] Tests exercise toolbar download, persistence, browser reuse, dependency remapping, undo and storage failure. Verification: 81 tests / 14 files; production build passing.

## Template Visual Polish & Mobile Selection

- [x] Redesign all six built-in layouts with layered cards, editorial typography, coordinated colors/gradients, mastheads, detail panels and footer hierarchy. Keep every component editable and asset-free.
- [x] Replace SVG foreignObject previews with clipped, measured DOM previews rendered through the shared renderer. Disable preview hit-testing so transformed components cannot intercept template selection taps.
- [x] Mobile dialog scrolling, safe-area spacing, single-column cards and non-shrinking 48px Select buttons; isolate portal events from editor controls.
- [x] Regression tests for touch-generated selection at mobile viewport width, preview isolation and design typography. Real iOS/Android device validation remains recommended.

## Overlapping Component Resize Handle Fix

- [x] Isolate authored scene components in their own z-index stack so arbitrary component layer values cannot cover editor selection controls.
- [x] Keep resize/rotation controls above scene content and editor grid/outlines, with click-through scene wrapper and interactive component children.
- [x] Regression test with overlapping components at z-indices above 200,000 verifies overlay separation, retained selection and resizing without moving the underlying component. Full suite: 84 tests passing; production build passes.
