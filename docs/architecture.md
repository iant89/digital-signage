# Digital Signage Studio — Architecture & Subsystem Design

## 1. Architectural Principles

Digital Signage Studio adheres to eight strict architectural boundaries:

1. **Project Model Independence**: `packages/project-model` is pure TypeScript with zero dependency on React or browser DOM APIs.
2. **Playback Engine Independence**: `packages/playback-engine` operates independently of editor UI components so standalone kiosk players and headless verification tools can run without loading the studio editor.
3. **Archive Format Independence**: `packages/signage-format` and `packages/compression` are standalone binary processing libraries usable in browsers, Web Workers, and Node.js servers.
4. **Restricted Script Runtime**: `packages/script-runtime` executes custom signage behaviors through a deterministic, permission-gated sandbox without unrestricted `eval()` or `new Function()`.
5. **OS-Level Kiosk Enforcement**: `packages/kiosk-integration` and `apps/desktop-host` combine browser fullscreen/wake-lock controls with native desktop wrapper policies and OS kiosk scripts.
6. **Shared Rendering Semantics**: Both Studio Preview and Production Playback calculate element transforms, keyframe interpolations, and scene transitions through `packages/animation-engine` and `packages/playback-engine`.
7. **Cross-Version Package Portability**: Schema versioning and migrations ensure `.signage` packages remain playable across compatible player releases.
8. **Runtime Input Validation**: Every untrusted package, network command, script message, and API payload is validated before execution.

---

## 2. Repository & Package Layout

```
digital-signage/
├── apps/
│   └── desktop-host/          # Electron / Tauri native kiosk host & OS integration scripts
├── packages/
│   ├── shared/                # Binary utilities, SHA-256 hashing, IDs, canonical JSON
│   ├── project-model/         # Project, Scene, Element, Playlist, Schedule schemas & migrations
│   ├── editor-core/           # Immutable commands, undo/redo, alignment, snapping, IndexedDB storage
│   ├── animation-engine/      # Shared timeline math, keyframes, easing, presets, transitions
│   ├── compression/           # Deflate/Gzip compression & bounded decompression
│   ├── signage-format/        # 64-byte header, directory indexer, reader, writer, validator, diffing
│   ├── script-runtime/        # Sandboxed script interpreter, lifecycle hooks, permission checks
│   ├── playlist-engine/       # Playlist sequencing, schedule resolution, priority tie-breaking
│   ├── playback-engine/       # Standalone player engine, NTP clock sync, server timeline, drift control
│   ├── kiosk-integration/     # Fullscreen, watchdog recovery, protected maintenance auth
│   ├── diagnostics/           # Redacted structured logging, health metrics, recovery reports
│   └── fleet-operations/      # Proof-of-play, health alerts, verified backups & retention (Phase 15)
├── server/
│   ├── index.ts               # Fastify + WebSocket Network Management Server
│   └── db.ts                  # SQLite relational database & content-addressed package store
├── src/
│   ├── store/                 # Zustand studio & network application state
│   ├── components/            # Studio Designer, Player, Package Manager, Network Console, Device Admin
│   └── App.tsx                # Unified multi-mode Digital Signage Studio & Management interface
├── tests/                     # Unit, integration, archive-fuzz, and synchronization acceptance tests
└── docs/                      # Architecture, binary format, script API, kiosk, and security docs
```

---

## 3. Server-Authoritative Synchronized Playback

To coordinate playback across multiple displays (display walls, menu boards, lobby screens), the system never relies on "start now" WebSocket messages. Instead:

1. **Clock Synchronization**: Players periodically exchange `(T1, T2, T3, T4)` timestamps with `/api/v1/clock/sync` to estimate clock offset `((T2 - T1) + (T3 - T4)) / 2` and round-trip latency `(T4 - T1) - (T3 - T2)` using a multi-sample outlier-rejecting filter anchored to `performance.now()`.
2. **Future Scheduled Start (`startTimeUtc`)**: The server creates a `PlaybackSession` with a future UTC start timestamp after verifying target player readiness (or applying the group's failure policy).
3. **Deterministic Timeline Math**: At any server time $T$, every player computes `(T - startTimeUtc)` modulo the playlist cycle duration to determine the exact active scene, scene offset, transition state, and keyframe progress `Progress = (CurrentTimelinePosition - A) / Duration`.
4. **Drift Correction**: Players report expected vs. actual timeline position; small drift (`< 120 ms`) is tolerated or slewed gently, moderate drift (`120..600 ms`) triggers a controlled seek, and large drift (`> 600 ms`) reinitializes the active scene.

---

## 4. Fleet Operations Subsystem (Phase 15)

Fleet Operations closes the operational visibility gaps in the addendum: player health monitoring, playback-state monitoring, diagnostics, database backups and audit retention. It is deliberately split into three layers so the same deterministic math runs everywhere:

1. **Pure domain layer — `@packages/fleet-operations`** (no React, Node or DOM APIs):
   - `normalizePlaybackEvents` validates, clamps and de-duplicates untrusted player batches; `aggregateProofOfPlay` clips events to a UTC window, groups them by scene/device/day, and merges overlapping intervals per device so a replayed offline batch never inflates display time.
   - `evaluateFleetHealth` grades each display from heartbeat staleness, clock drift, FPS, render errors, failed commands and stalled playback. Alert IDs hash `ruleId|deviceId|cooldownBucket`, making repeated evaluations idempotent.
   - `buildBackupArchive` / `verifyBackupArchive` create canonical, secret-redacted, SHA-256 verified snapshots; `applyRetention` implements age + row-count pruning with pinned active alerts.

2. **Persistence & API layer — `server/db.ts`, `server/app.ts`**:
   - Append-only `playback_events` (unique `event_key`) and `health_samples` (unique `sample_key`) tables, `alert_rules`, `fleet_alerts` and `backups`.
   - `/api/v1/operations/*` endpoints for summary, proof-of-play queries, telemetry ingest, alert acknowledgement, editable rules, backup create/verify/restore and retention. Device/operator/admin roles are separated; every mutation is audited and broadcast over `/ws`.
   - Backups exclude credential tables and restore only into four whitelisted telemetry tables after recomputing every checksum. A mismatched archive returns `INTEGRITY_CHECK_FAILED` and writes an audit record.

3. **Presentation layer — `NetworkManagementView.tsx`, `staticServerSimulator.ts`**:
   - The **Fleet Operations** tab renders health KPIs, proof-of-play filters and daily bars, FPS sparklines, editable alert rules, acknowledgement, backup management and telemetry-injection diagnostics.
   - The static Pages simulator implements the same `/api/v1/operations/*` contract in memory using the pure domain layer, and the UI has a deterministic offline demo fallback for headless environments. This keeps the console fully functional with or without the Fastify backend.

---

## 5. LAN Discovery (Phase 16)

The management server advertises a minimal, unauthenticated identity document at `GET /api/v1/discovery`:

| Field | Purpose |
|-------|---------|
| `service`, `protocolVersion` | Stable contract check (`digital-signage-studio`, `1`). |
| `instanceId` | Stable per-installation ID derived from the storage directory hash. |
| `displayName`, `applicationVersion`, `serverTimeUtc` | Human/operator context and clock sanity. |
| `scheme`, `hostname`, `port`, `authority`, `baseUrl`, `secure` | How to reach this instance (derived from the request `Host` / forwarded proto, not `process.env.PORT`). |
| `endpoints` | `discovery`, `overview`, `diagnostics`, `operations`, `websocket` paths. |
| `features` | Capability flags (`network-sync`, `package-repository`, `fleet-operations`, …). |
| `requiresAuthentication` | Always `false` for this endpoint; it returns **no secrets** and **no device data**. |

`tools/network-scanner/` implements the client side in three layers:

1. **Pure helpers** (`discovery-core.mjs`) — IPv4/CIDR math, local NIC subnet enumeration, target expansion, URL construction, descriptor validation, CLI parsing and bounded concurrency.
2. **Node CLI** (`find-signage-server.mjs`) — auto-detect subnets → concurrent TCP connect probe → HTTP GET discovery descriptor → strict verification → table / JSON / quiet output, with a `--max-hosts` safety cap and cooperative `--first` cancellation.
3. **Windows entry points** (`tools/windows/`) — `find-signage-server.cmd` for cmd.exe and `Find-SignageServer.ps1` for PowerShell 5.1+, both delegating to the tested Node CLI. `npm run scan:server` exposes the same tool cross-platform.

Verification is deliberately stricter than port scanning: `isSignageDiscovery` requires a matching `service` id, numeric `protocolVersion`, parseable `serverTimeUtc` and `endpoints.discovery`. The scanned IP/port always overrides any advertised `baseUrl`, so reverse-proxied or misconfigured `Host` headers cannot redirect an operator to the wrong machine. `src/services/staticServerSimulator.ts` mirrors the descriptor (with `simulated: true`) for static GitHub Pages parity.
