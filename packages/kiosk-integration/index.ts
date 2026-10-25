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
  maintenanceKeySequence: string;
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
  maintenanceKeySequence: 'ArrowUp,ArrowUp,ArrowDown,ArrowDown,ArrowLeft,ArrowRight',
  maintenanceSessionDurationSec: 300,
};

export interface HotkeyEventLike {
  key: string;
  code?: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}

/**
 * Matches a keyboard event against a human-readable hotkey chord such as
 * "Ctrl+Shift+M", "Ctrl+Alt+K", or "F12". Treats Ctrl or Meta (Cmd) as satisfying "Ctrl".
 */
export function matchesMaintenanceHotkey(
  event: HotkeyEventLike,
  hotkeySpec: string
): boolean {
  if (!hotkeySpec || !hotkeySpec.trim()) return false;
  const parts = hotkeySpec
    .split('+')
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);
  if (parts.length === 0) return false;

  const expectCtrl = parts.includes('ctrl') || parts.includes('control') || parts.includes('cmd') || parts.includes('meta');
  const expectShift = parts.includes('shift');
  const expectAlt = parts.includes('alt') || parts.includes('option');

  const keyTokens = parts.filter(
    (p) =>
      p !== 'ctrl' &&
      p !== 'control' &&
      p !== 'cmd' &&
      p !== 'meta' &&
      p !== 'shift' &&
      p !== 'alt' &&
      p !== 'option'
  );
  if (keyTokens.length === 0) return false;
  const targetKey = keyTokens[keyTokens.length - 1];

  const hasCtrl = Boolean(event.ctrlKey || event.metaKey);
  const hasShift = Boolean(event.shiftKey);
  const hasAlt = Boolean(event.altKey);

  if (expectCtrl !== hasCtrl || expectShift !== hasShift || expectAlt !== hasAlt) {
    return false;
  }

  const eventKey = (event.key || '').toLowerCase();
  const eventCode = (event.code || '').toLowerCase();
  if (eventKey === targetKey) return true;
  if (eventCode === `key${targetKey}` || eventCode === `digit${targetKey}` || eventCode === targetKey) {
    return true;
  }
  return false;
}

/**
 * Tracks a multi-step hardware/remote key sequence (e.g.,
 * "ArrowUp,ArrowUp,ArrowDown,ArrowDown,ArrowLeft,ArrowRight" or "m,a,i,n,t")
 * with an inter-key expiration timeout so normal player remote sequences work.
 */
export class MaintenanceSequenceTracker {
  private sequence: string[] = [];
  private currentIndex = 0;
  private lastKeyTimestampMs = 0;
  private timeoutMs: number;

  constructor(sequenceSpec: string, timeoutMs = 3500) {
    this.timeoutMs = timeoutMs;
    this.setSequence(sequenceSpec);
  }

  public setSequence(sequenceSpec: string): void {
    this.sequence = sequenceSpec
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    this.currentIndex = 0;
    this.lastKeyTimestampMs = 0;
  }

  public reset(): void {
    this.currentIndex = 0;
    this.lastKeyTimestampMs = 0;
  }

  public feedKey(
    key: string,
    nowMs = Date.now()
  ): { matched: boolean; progress: number; total: number } {
    const total = this.sequence.length;
    if (total === 0) {
      return { matched: false, progress: 0, total: 0 };
    }

    const normalized = (key || '').trim().toLowerCase();
    // Ignore bare modifier presses so holding Shift/Ctrl doesn't break sequence
    if (
      normalized === 'shift' ||
      normalized === 'control' ||
      normalized === 'alt' ||
      normalized === 'meta'
    ) {
      return { matched: false, progress: this.currentIndex, total };
    }

    if (
      this.currentIndex > 0 &&
      this.lastKeyTimestampMs > 0 &&
      nowMs - this.lastKeyTimestampMs > this.timeoutMs
    ) {
      this.currentIndex = 0;
    }

    if (normalized === this.sequence[this.currentIndex]) {
      this.currentIndex += 1;
      this.lastKeyTimestampMs = nowMs;
      if (this.currentIndex >= total) {
        this.currentIndex = 0;
        this.lastKeyTimestampMs = 0;
        return { matched: true, progress: total, total };
      }
      return { matched: false, progress: this.currentIndex, total };
    }

    // Check if the pressed key restarts the sequence from index 0
    if (normalized === this.sequence[0]) {
      this.currentIndex = 1;
      this.lastKeyTimestampMs = nowMs;
      return { matched: false, progress: 1, total };
    }

    this.currentIndex = 0;
    this.lastKeyTimestampMs = 0;
    return { matched: false, progress: 0, total };
  }
}

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
