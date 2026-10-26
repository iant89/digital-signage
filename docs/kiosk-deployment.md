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

---

## 7. Finding the Management Server on a Windows LAN

`apps/desktop-host/windows-kiosk-provision.ps1` accepts a `-ServerUrl` (default `https://signage-control.local:4000`). Instead of guessing the address, technicians can discover the live server with the dependency-free scanner:

```powershell
# Auto-detect local subnets and print the server URL
.\tools\windows\Find-SignageServer.ps1 -Quiet -First

# Explicit subnet, JSON output (pipe into provisioning)
$server = .\tools\windows\Find-SignageServer.ps1 -Subnet 192.168.1.0/24 -Json | ConvertFrom-Json
if ($server.servers.Count -gt 0) {
    .\apps\desktop-host\windows-kiosk-provision.ps1 -ServerUrl $server.servers[0].baseUrl
}
```

Or from `cmd.exe`:

```bat
tools\windows\find-signage-server.cmd --subnet 192.168.1.0/24 --quiet --first
```

The scanner probes inbound TCP 4000 on the server (allow this on the server's Windows Firewall Private/Domain profile) and then verifies `GET /api/v1/discovery`. It reports `0` when a signage server is found, `1` when the scan completes without a match, and `2` for invalid arguments. For HTTPS reverse proxies use `--https --port 443` (and `--insecure` only with self-signed lab certificates). See `tools/network-scanner/README.md` for the full option list.
