# Digital Signage Studio & Synchronized Network Server

A complete digital signage authoring studio, custom compressed binary archive format (`.signage`), standalone kiosk playback engine, and centralized network management & display synchronization server built with **React**, **TypeScript**, **Fastify**, **WebSockets**, and **SQLite**.

---

## System Overview

Digital Signage Studio implements all subsystems defined in the Application Design Specification & Network Synchronization Addendum (Sections 1–38):

1. **Studio Designer (`src/components/studio/`, `packages/project-model`, `packages/editor-core`)**:
   - Drag-and-drop visual composition canvas with pixel-accurate logical coordinates (`1920×1080` Full HD, `3840×2160` 4K UHD, `1080×1920` Portrait, `1080×1080` Square, `2560×720` Ribbon).
   - 8-point resize handles, rotation handle, snap-to-grid, snap-to-element alignment guides, broadcast safe-area overlay, alignment & distribution tools, grouping, and Z-order layer management.
   - Rich elements: Typography (with dynamic variables `{{time}}`, `{{date}}`, `{{deviceName}}`, LTR/RTL), Images (SVG/PNG/JPEG/WebP), HTML5 Video & Audio streams, Vector Shapes, and Live Signage Widgets (Digital Clock, Event Countdown, SVG QR Code Generator, Scrolling News Ticker, Data Feed Table, Local Weather Card).
   - Multi-scene presentations, transitions (`fade`, `slide-left`, `slide-right`, `slide-up`, `zoom`, `wipe`), playlists, and priority-resolved schedules.
   - Keyframe timeline editor (`packages/animation-engine`) with built-in motion presets, custom keyframe tracks, easing curves, frame/timecode display, and audio waveform lane.
   - Immutable command history (Undo/Redo) and automatic IndexedDB + crash-recovery snapshot persistence.

2. **Custom `.signage` Binary Archive Format (`packages/signage-format`, `packages/compression`)**:
   - 64-byte little-endian binary header (`SIGNAGE\0` magic signature, format version `1`, header size `64`, feature flags, 64-bit directory offset & length, manifest entry ID, entry count, 24 zero reserved bytes).
   - Random-access directory indexing independently compressed entries (`Store` for already-compressed PNG/JPEG/MP4/WOFF2 media; `Deflate` for JSON manifests, SVG graphics, and scripts).
   - 12-step security & integrity validation pipeline enforcing SHA-256 verification per entry, non-overlapping bounds, path traversal protection, decompression bomb ceilings, publisher signature verification, and zero script execution during validation.
   - Package version diffing (`compareSignagePackages`) and `Fast` vs. `Compact` export profiles.

3. **Standalone Signage Player & Kiosk Controls (`src/components/player/`, `packages/playback-engine`, `packages/kiosk-integration`, `apps/desktop-host`)**:
   - Loads and plays `.signage` binary archives independently of the editor.
   - Hybrid renderer combining DOM/CSS, SVG vector graphics, Canvas 2D visualizations, and HTML5 media.
   - Full-screen kiosk lockout mode with cursor inactivity hiding, context-menu lockout, protected salted-SHA-256 administrator maintenance authentication (`ApexAdmin!2026`), time-limited maintenance sessions, and `WatchdogSupervisor` crash recovery with corrupted-package quarantine.

4. **Restricted Script Runtime (`packages/script-runtime`)**:
   - Capability-gated sandbox executing lifecycle hooks (`initialize`, `onSceneEnter`, `onTick`, `onEvent`, `onSceneExit`, `dispose`) without `eval()` or `new Function()`.
   - Enforces explicit permissions (`scene:read`, `text:write`, `visibility:write`, `animation:control`, `scene:transition`, `playlist:select`, `timer:use`, `diagnostics:log`), CPU operation budgets, and automatic timer cleanup on scene exit.

5. **Network Management Server & Synchronized Playback (`server/`, `src/components/network/`)**:
   - Fastify REST API (`/api/v1/*`) + WebSocket real-time gateway (`/ws`) + SQLite relational store (`users`, `devices`, `device_credentials`, `enrollment_codes`, `groups`, `group_members`, `packages`, `playlists`, `schedules`, `sessions`, `session_devices`, `commands`, `events`, `deployments`, `audit_log`) + content-addressed `.signage` package storage.
   - **Server-Authoritative Timeline Synchronization**: Uses future scheduled UTC start times (`startTimeUtc`), multi-sample NTP-style clock offset estimation (`Offset = ((T2 - T1) + (T3 - T4)) / 2`, `RTT = (T4 - T1) - (T3 - T2)`), deterministic late-join scene/offset calculation, and automated playback drift detection & correction.

---

## Documentation

- [`docs/architecture.md`](docs/architecture.md) — Architectural boundaries, package structure, and synchronization model.
- [`docs/signage-file-format.md`](docs/signage-file-format.md) — Complete `.signage` 64-byte header, directory record binary layout, compression rules, and 12-step validation spec.
- [`docs/script-api.md`](docs/script-api.md) — Restricted script sandbox lifecycle, permissions, and declarative rule format.
- [`docs/kiosk-deployment.md`](docs/kiosk-deployment.md) — Windows/Linux OS kiosk lockout, desktop host wrapper, and watchdog recovery.
- [`docs/security-model.md`](docs/security-model.md) — End-to-end threat model and security controls.

---

## Running & Testing

```bash
# Start the Network Management Server (Fastify + WebSocket + SQLite on port 4000)
npm run dev:server

# Start the Studio & Management Web Application (Vite on port 5173)
npm run dev

# Run Unit, Archive Fuzz, UI, Essential E2E, and Synchronization Acceptance Tests
npm test

# Type-check and build production bundle
npm run build

# Build static GitHub Pages bundle (outputs dist/ with relative asset paths, 404.html & .nojekyll)
npm run build:pages
```

---

## GitHub Pages Deployment

This repository is pre-configured for automated **GitHub Pages** deployment via [`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml):

1. In your GitHub repository settings, go to **Settings → Pages** and set **Build and deployment → Source** to **GitHub Actions**.
2. Push to `main` (or trigger **Deploy Digital Signage Studio to GitHub Pages** from the **Actions** tab).
3. Vite builds with `base: './'`, copies `public/.nojekyll` and `dist/404.html` for single-page routing, and uses [`src/services/staticServerSimulator.ts`](src/services/staticServerSimulator.ts) to transparently emulate `/api/v1/*` endpoints in the browser when hosted statically without a Node.js backend.

