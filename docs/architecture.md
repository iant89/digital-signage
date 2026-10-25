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
│   └── diagnostics/           # Redacted structured logging, health metrics, recovery reports
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
