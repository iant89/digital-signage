# Digital Signage Studio — Phased Implementation Roadmap (`ROADMAP.md`)

This document tracks the end-to-end engineering roadmap for **Digital Signage Studio**, covering Phases 1–7 from the Core Specification and Phases 8–13 from the Network Synchronization Addendum (`PROMPT.md`), along with future optional enhancements.

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
| **14** | Future Optional Enhancements | **PLANNED** | Delta binary patch streaming, WebRTC/genlock hardware wall adapter, PostgreSQL/S3 cloud adapters | Future expansion |

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

## Phase 14: Optional Future Enterprise Extensions — [PLANNED]
- [ ] **Binary Delta Patch Transport (Spec 27.5)**: Extend `/api/v1/packages` with entry-level delta diff streams between base and target package hashes to reduce WAN bandwidth for multi-gigabyte video packages.
- [ ] **Native Desktop Host Packaging**: Add Electron Builder / Tauri bundler configuration to output native `.deb` / `.AppImage` (Linux) and `.msi` (Windows) installers from `apps/desktop-host/`.
- [ ] **PostgreSQL & S3 Storage Adapters**: Add optional connection adapters alongside the built-in SQLite + filesystem content-addressed store for multi-node cloud clusters.
