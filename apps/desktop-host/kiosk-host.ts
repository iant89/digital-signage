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
