# Kiosk Deployment & Operating-System Lockout Guide

## 1. Defense-in-Depth Kiosk Architecture

A browser webpage alone cannot prevent OS-level window switching (`Alt+Tab`, `Ctrl+Alt+Del`), closing the window, or opening system settings. Production signage deployments use a layered defense-in-depth architecture:

1. **Physical Display Layer**: Commercial display with CEC/RS-232 wake rules and hardware input lock.
2. **OS Kiosk Account Layer**:
   - **Windows 10/11**: Assigned Access (Single-App Kiosk Mode) or Shell Launcher v2 running under a restricted standard user account (`signage-kiosk`).
   - **Linux (Ubuntu / Debian)**: Dedicated unprivileged user running a minimal X11/Wayland session (`openbox` or `cage`) launched and supervised by `systemd` (`digital-signage-player.service`).
3. **Desktop Playback Host (`apps/desktop-host`)**:
   - Electron / Tauri wrapper configured with `kiosk: true`, `fullscreen: true`, `autoHideMenuBar: true`, disabled DevTools in production, and a native process watchdog.
4. **TypeScript Playback Engine (`packages/kiosk-integration`)**:
   - Enforces Fullscreen API, Wake Lock API, cursor auto-hide after configurable inactivity (default `3000 ms`), disabled context menu, blocked browser navigation shortcuts, and protected maintenance authentication.

---

## 2. Protected Administrative Maintenance Access

- **Hidden Maintenance Trigger**: Configurable multi-step gesture (e.g., 5 rapid taps in the top-right corner within 3 seconds) or keyboard shortcut (`Ctrl+Shift+M`).
- **Salted Hash Authentication**: Credentials are verified against a salted SHA-256 / PBKDF2 administrator digest. Hardcoded universal PINs are prohibited.
- **Time-Limited Sessions**: Maintenance mode automatically expires after the configured timeout (default 5 minutes) and returns the display to full-screen playback.
- **Audit Logging**: Every authentication attempt, maintenance session entry/exit, and configuration change is recorded in the local and server audit logs.

---

## 3. Watchdog & Crash Recovery

- The watchdog monitors heartbeat signals from the playback renderer every 2 seconds.
- If the renderer stalls or crashes, the watchdog restarts playback using the last known-good `.signage` package from the atomic cache.
- If 3 consecutive restarts fail within 60 seconds, the player marks the current package as quarantined, falls back to the configured default package/playlist, or enters a safe recovery screen to prevent infinite restart loops.
