// ============================================================================
// @packages/kiosk-integration — Full-Screen Controls, Salted Admin Auth,
// Time-Limited Maintenance Sessions & Watchdog Crash Loop Recovery
// ============================================================================

import { sha256Hex } from '@packages/shared';

export interface KioskConfiguration {
  deviceId: string;
  deviceName: string;
  assignedDisplay: string;
  launchFullscreen: boolean;
  startPlaybackAutomatically: boolean;
  assignedPackageId: string;
  defaultPlaylistId: string;
  hideApplicationChrome: boolean;
  disableContextMenu: boolean;
  restrictDevToolsInProduction: boolean;
  hideCursorAfterMs: number;
  keepDisplayAwake: boolean;
  displayOrientation: 'landscape' | 'portrait' | 'landscape-flipped' | 'portrait-flipped';
  targetResolution: string;
  restorePlaybackAfterRestart: boolean;
  maintenanceAccessEnabled: boolean;
  maintenanceHotkey: string;
  maintenanceSessionDurationSec: number;
}

export const DEFAULT_KIOSK_CONFIGURATION: KioskConfiguration = {
  deviceId: 'dev-kiosk-local-01',
  deviceName: 'Main Concourse Kiosk #01',
  assignedDisplay: 'HDMI-1 (Primary 1920x1080)',
  launchFullscreen: true,
  startPlaybackAutomatically: true,
  assignedPackageId: 'pkg-apex-lobby-v1',
  defaultPlaylistId: 'playlist-main-loop',
  hideApplicationChrome: true,
  disableContextMenu: true,
  restrictDevToolsInProduction: true,
  hideCursorAfterMs: 3000,
  keepDisplayAwake: true,
  displayOrientation: 'landscape',
  targetResolution: '1920x1080',
  restorePlaybackAfterRestart: true,
  maintenanceAccessEnabled: true,
  maintenanceHotkey: 'Ctrl+Shift+M',
  maintenanceSessionDurationSec: 300,
};

export interface MaintenanceAuditEntry {
  id: string;
  timestamp: string;
  actor: string;
  action: string;
  outcome: 'SUCCESS' | 'DENIED' | 'EXPIRED' | 'RECOVERY';
  details: string;
}

export function deriveAdminCredentialDigest(passphrase: string, deviceSalt: string): string {
  // Multi-round salted SHA-256 key stretching (no plaintext secrets stored)
  let digest = sha256Hex(`${deviceSalt}:${passphrase}:kiosk-auth-v1`);
  for (let i = 0; i < 64; i++) {
    digest = sha256Hex(`${digest}:${deviceSalt}:${i}`);
  }
  return digest;
}

export class ProtectedAdminController {
  private deviceSalt: string;
  private credentialDigest: string;
  private sessionExpiresAtMs = 0;
  private failedAttempts = 0;
  private lockoutUntilMs = 0;
  private auditLog: MaintenanceAuditEntry[] = [];

  constructor(initialAdminSecret: string, deviceSalt = 'kiosk-device-salt-01') {
    this.deviceSalt = deviceSalt;
    this.credentialDigest = deriveAdminCredentialDigest(initialAdminSecret, deviceSalt);
  }

  public rotateAdminCredential(currentSecret: string, newSecret: string): boolean {
    if (!this.verifySecret(currentSecret)) {
      this.recordAudit('admin', 'ROTATE_CREDENTIAL', 'DENIED', 'Invalid current secret');
      return false;
    }
    if (newSecret.trim().length < 6) {
      return false;
    }
    this.credentialDigest = deriveAdminCredentialDigest(newSecret, this.deviceSalt);
    this.recordAudit('admin', 'ROTATE_CREDENTIAL', 'SUCCESS', 'Updated device-bound admin credential digest');
    return true;
  }

  private verifySecret(candidateSecret: string): boolean {
    const candidateDigest = deriveAdminCredentialDigest(candidateSecret, this.deviceSalt);
    return candidateDigest === this.credentialDigest;
  }

  public authenticateMaintenanceSession(
    candidateSecret: string,
    durationSec = 300,
    nowMs = Date.now()
  ): { granted: boolean; expiresAtMs?: number; reason: string } {
    if (nowMs < this.lockoutUntilMs) {
      this.recordAudit('admin', 'MAINTENANCE_LOGIN', 'DENIED', 'Account temporarily locked out due to failed attempts');
      return {
        granted: false,
        reason: `Locked out for ${Math.ceil((this.lockoutUntilMs - nowMs) / 1000)}s after repeated failures.`,
      };
    }

    if (!this.verifySecret(candidateSecret)) {
      this.failedAttempts++;
      if (this.failedAttempts >= 4) {
        this.lockoutUntilMs = nowMs + 30_000;
      }
      this.recordAudit('admin', 'MAINTENANCE_LOGIN', 'DENIED', `Invalid credential (attempt ${this.failedAttempts})`);
      return {
        granted: false,
        reason: 'Invalid administrator credentials.',
      };
    }

    this.failedAttempts = 0;
    this.sessionExpiresAtMs = nowMs + Math.max(10, durationSec) * 1000;
    this.recordAudit(
      'admin',
      'MAINTENANCE_LOGIN',
      'SUCCESS',
      `Authorized time-limited maintenance session (${durationSec}s)`
    );
    return {
      granted: true,
      expiresAtMs: this.sessionExpiresAtMs,
      reason: 'Maintenance session granted.',
    };
  }

  public isMaintenanceActive(nowMs = Date.now()): boolean {
    if (this.sessionExpiresAtMs > 0 && nowMs >= this.sessionExpiresAtMs) {
      this.sessionExpiresAtMs = 0;
      this.recordAudit('system', 'MAINTENANCE_AUTO_EXIT', 'EXPIRED', 'Time-limited maintenance session expired; returned to playback.');
      return false;
    }
    return this.sessionExpiresAtMs > nowMs;
  }

  public getRemainingMaintenanceSeconds(nowMs = Date.now()): number {
    if (!this.isMaintenanceActive(nowMs)) return 0;
    return Math.max(0, Math.ceil((this.sessionExpiresAtMs - nowMs) / 1000));
  }

  public exitMaintenanceSession(): void {
    if (this.sessionExpiresAtMs > 0) {
      this.sessionExpiresAtMs = 0;
      this.recordAudit('admin', 'MAINTENANCE_EXIT', 'SUCCESS', 'Returned display to kiosk playback.');
    }
  }

  public getAuditLog(): MaintenanceAuditEntry[] {
    return [...this.auditLog];
  }

  private recordAudit(
    actor: string,
    action: string,
    outcome: MaintenanceAuditEntry['outcome'],
    details: string
  ): void {
    this.auditLog.unshift({
      id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toISOString(),
      actor,
      action,
      outcome,
      details,
    });
    if (this.auditLog.length > 200) {
      this.auditLog.length = 200;
    }
  }
}

export interface WatchdogStatus {
  state: 'HEALTHY' | 'RECOVERING' | 'SAFE_RECOVERY_MODE';
  restartCount: number;
  maxRetries: number;
  lastHeartbeatMs: number;
  activePackageId: string;
  quarantinedPackageIds: string[];
  lastRecoveryReason?: string;
}

/**
 * Spec Section 10.5: Watchdog and Recovery Supervisor.
 * Detects crashes or unresponsive renderer, restarts playback with bounded retries,
 * restores last known valid package/playlist, and enters safe recovery mode if
 * repeated restarts fail (preventing infinite restart loops on corrupted packages).
 */
export class WatchdogSupervisor {
  private maxRetries: number;
  private restartCount = 0;
  private state: WatchdogStatus['state'] = 'HEALTHY';
  private lastHeartbeatMs = Date.now();
  private activePackageId: string;
  private fallbackPackageId: string;
  private quarantinedPackageIds = new Set<string>();
  private lastRecoveryReason?: string;

  constructor(
    initialPackageId = 'pkg-apex-lobby-v1',
    fallbackPackageId = 'pkg-default-safe-fallback',
    maxRetries = 3
  ) {
    this.activePackageId = initialPackageId;
    this.fallbackPackageId = fallbackPackageId;
    this.maxRetries = maxRetries;
  }

  public recordHeartbeat(nowMs = Date.now()): void {
    this.lastHeartbeatMs = nowMs;
    if (this.state === 'RECOVERING') {
      this.state = 'HEALTHY';
    }
  }

  public reportFailureOrStall(reason: string): WatchdogStatus {
    this.restartCount++;
    this.lastRecoveryReason = reason;

    if (this.restartCount > this.maxRetries) {
      // Quarantine the offending package to prevent infinite restart loop
      this.quarantinedPackageIds.add(this.activePackageId);
      if (this.activePackageId !== this.fallbackPackageId && !this.quarantinedPackageIds.has(this.fallbackPackageId)) {
        this.activePackageId = this.fallbackPackageId;
        this.restartCount = 1;
        this.state = 'RECOVERING';
        this.lastRecoveryReason = `Quarantined failing package; switched to fallback "${this.fallbackPackageId}" (${reason})`;
      } else {
        this.state = 'SAFE_RECOVERY_MODE';
        this.lastRecoveryReason = `Entered Safe Recovery Screen after ${this.maxRetries} consecutive failures (${reason})`;
      }
    } else {
      this.state = 'RECOVERING';
    }

    return this.getStatus();
  }

  public resetToHealthy(packageId?: string): WatchdogStatus {
    this.restartCount = 0;
    this.state = 'HEALTHY';
    this.lastHeartbeatMs = Date.now();
    if (packageId) this.activePackageId = packageId;
    return this.getStatus();
  }

  public getStatus(): WatchdogStatus {
    return {
      state: this.state,
      restartCount: this.restartCount,
      maxRetries: this.maxRetries,
      lastHeartbeatMs: this.lastHeartbeatMs,
      activePackageId: this.activePackageId,
      quarantinedPackageIds: Array.from(this.quarantinedPackageIds),
      lastRecoveryReason: this.lastRecoveryReason,
    };
  }
}
