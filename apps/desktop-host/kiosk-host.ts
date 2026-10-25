// ============================================================================
// apps/desktop-host/kiosk-host.ts
// Electron / Tauri Desktop Playback Host & Native Watchdog Wrapper (Section 10)
// Enforces OS-level kiosk window management, startup package launch,
// context-menu/DevTools lockout, and renderer crash recovery.
// ============================================================================

import {
  DEFAULT_KIOSK_CONFIGURATION,
  KioskConfiguration,
  ProtectedAdminController,
  WatchdogSupervisor,
} from '@packages/kiosk-integration';

export interface DesktopWindowPolicy {
  kiosk: boolean;
  fullscreen: boolean;
  frame: boolean;
  alwaysOnTop: boolean;
  autoHideMenuBar: boolean;
  devToolsEnabled: boolean;
  contextMenuEnabled: boolean;
  cursorHideTimeoutMs: number;
}

export interface KioskCliOptions {
  kiosk: boolean;
  fullscreen: boolean;
  packagePath: string | null;
  serverUrl: string | null;
  displayIndex: number;
  deviceId: string | null;
  maintenanceMode: boolean;
}

export interface PhysicalDisplayDescriptor {
  id: string;
  index: number;
  bounds: { x: number; y: number; width: number; height: number };
  primary: boolean;
}

export function parseKioskCliArgs(argv: string[]): KioskCliOptions {
  const opts: KioskCliOptions = {
    kiosk: false,
    fullscreen: false,
    packagePath: null,
    serverUrl: null,
    displayIndex: 0,
    deviceId: null,
    maintenanceMode: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--kiosk') opts.kiosk = true;
    else if (arg === '--fullscreen') opts.fullscreen = true;
    else if (arg === '--maintenance') opts.maintenanceMode = true;
    else if (arg === '--package' && argv[i + 1]) {
      opts.packagePath = argv[++i];
    } else if (arg.startsWith('--package=')) {
      opts.packagePath = arg.slice('--package='.length);
    } else if (arg === '--server' && argv[i + 1]) {
      opts.serverUrl = argv[++i];
    } else if (arg.startsWith('--server=')) {
      opts.serverUrl = arg.slice('--server='.length);
    } else if (arg === '--display' && argv[i + 1]) {
      opts.displayIndex = Math.max(0, Number.parseInt(argv[++i], 10) || 0);
    } else if (arg.startsWith('--display=')) {
      opts.displayIndex = Math.max(0, Number.parseInt(arg.slice('--display='.length), 10) || 0);
    } else if (arg === '--device-id' && argv[i + 1]) {
      opts.deviceId = argv[++i];
    } else if (arg.startsWith('--device-id=')) {
      opts.deviceId = arg.slice('--device-id='.length);
    }
  }

  if (opts.kiosk) {
    opts.fullscreen = true;
  }
  return opts;
}

export function resolveTargetDisplayBounds(
  displays: PhysicalDisplayDescriptor[],
  requestedIndex: number
): { x: number; y: number; width: number; height: number } {
  if (displays.length === 0) {
    return { x: 0, y: 0, width: 1920, height: 1080 };
  }
  const byIndex = displays.find((d) => d.index === requestedIndex);
  if (byIndex) return { ...byIndex.bounds };
  const primary = displays.find((d) => d.primary) ?? displays[0];
  return { ...primary.bounds };
}

export function buildKioskCspHeader(allowedServerOrigin?: string | null): string {
  const connectSources = ["'self'", 'blob:', 'data:'];
  if (allowedServerOrigin) {
    connectSources.push(allowedServerOrigin);
    if (allowedServerOrigin.startsWith('http://')) {
      connectSources.push(allowedServerOrigin.replace('http://', 'ws://'));
    } else if (allowedServerOrigin.startsWith('https://')) {
      connectSources.push(allowedServerOrigin.replace('https://', 'wss://'));
    }
  }
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src ${connectSources.join(' ')}`,
    "object-src 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

export class DesktopKioskHost {
  private config: KioskConfiguration;
  private watchdog: WatchdogSupervisor;
  private adminController: ProtectedAdminController;

  constructor(
    config: KioskConfiguration = DEFAULT_KIOSK_CONFIGURATION,
    adminSecret = 'ApexAdmin!2026'
  ) {
    this.config = { ...config };
    this.watchdog = new WatchdogSupervisor(config.assignedPackageId, 'pkg-default-safe-fallback', 3);
    this.adminController = new ProtectedAdminController(adminSecret, config.deviceId);
  }

  public getBrowserWindowOptions(isProduction = true): DesktopWindowPolicy {
    const inMaintenance = this.adminController.isMaintenanceActive();
    return {
      kiosk: this.config.launchFullscreen && !inMaintenance,
      fullscreen: this.config.launchFullscreen && !inMaintenance,
      frame: !this.config.hideApplicationChrome || inMaintenance,
      alwaysOnTop: this.config.launchFullscreen && !inMaintenance,
      autoHideMenuBar: this.config.hideApplicationChrome,
      devToolsEnabled: !isProduction || !this.config.restrictDevToolsInProduction || inMaintenance,
      contextMenuEnabled: !this.config.disableContextMenu || inMaintenance,
      cursorHideTimeoutMs: inMaintenance ? 0 : this.config.hideCursorAfterMs,
    };
  }

  public onRendererHeartbeat(nowMs = Date.now()) {
    this.watchdog.recordHeartbeat(nowMs);
    return this.watchdog.getStatus();
  }

  public onRendererCrash(reason: string) {
    return this.watchdog.reportFailureOrStall(reason);
  }

  public unlockMaintenance(passphrase: string, nowMs = Date.now()) {
    return this.adminController.authenticateMaintenanceSession(
      passphrase,
      this.config.maintenanceSessionDurationSec,
      nowMs
    );
  }

  public lockMaintenance() {
    this.adminController.exitMaintenanceSession();
  }

  public getDiagnostics() {
    return {
      config: this.config,
      windowPolicy: this.getBrowserWindowOptions(true),
      watchdog: this.watchdog.getStatus(),
      maintenanceActive: this.adminController.isMaintenanceActive(),
      remainingMaintenanceSeconds: this.adminController.getRemainingMaintenanceSeconds(),
      auditLog: this.adminController.getAuditLog(),
    };
  }
}
