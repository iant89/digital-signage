// ============================================================================
// src/components/admin/DeviceAdminView.tsx — Local Kiosk Configuration,
// Protected Admin Credential Management & Redacted Diagnostics (Spec Sec 10 & 12)
// ============================================================================

import React, { useState } from 'react';
import {
  Shield,
  Settings,
  Activity,
  KeyRound,
  MonitorCheck,
  FileText,
  RefreshCw,
} from 'lucide-react';
import { useStudioStore } from '@/store/useStudioStore';

export const DeviceAdminView: React.FC = () => {
  const {
    kioskConfig,
    updateKioskConfig,
    adminController,
    watchdogSupervisor,
    diagnostics,
    builtPackages,
    project,
    notify,
  } = useStudioStore();

  const [currentSecret, setCurrentSecret] = useState('');
  const [newSecret, setNewSecret] = useState('');
  const [, setTick] = useState(0);

  const handleRotatePassword = (e: React.FormEvent) => {
    e.preventDefault();
    const ok = adminController.rotateAdminCredential(currentSecret, newSecret);
    if (ok) {
      setCurrentSecret('');
      setNewSecret('');
      notify('success', 'Rotated device-bound administrator credential digest.');
    } else {
      notify('error', 'Failed to rotate credential: verify current passphrase and minimum 6-char length.');
    }
    setTick((t) => t + 1);
  };

  const handleTestRedactedLog = () => {
    diagnostics.log(
      'info',
      'ADMIN',
      'Tested diagnostic logger with Bearer secret_token_12345',
      {
        adminPassword: 'SuperSecretPassword!',
        deviceToken: 'devtok_secret_999',
        displayStatus: 'ACTIVE_1080P',
      }
    );
    setTick((t) => t + 1);
    notify('info', 'Logged diagnostic event with automatic credential redaction.');
  };

  const watchdog = watchdogSupervisor.getStatus();
  const auditEntries = adminController.getAuditLog();
  const diagEntries = diagnostics.getEntries();

  return (
    <div className="package-manager-page">
      <div className="pm-grid">
        {/* LEFT COLUMN: KIOSK & FULL-SCREEN CONTROLS (Spec Section 10.3) */}
        <div className="pm-card">
          <div className="pm-card-header">
            <Settings size={18} color="#38bdf8" />
            <h3>1. Kiosk & Display Lockout Configuration</h3>
          </div>

          <label className="inspector-label">Device Name</label>
          <input
            type="text"
            className="inspector-input"
            value={kioskConfig.deviceName}
            onChange={(e) => updateKioskConfig({ deviceName: e.target.value })}
          />

          <label className="inspector-label">Assigned Physical Display</label>
          <input
            type="text"
            className="inspector-input"
            value={kioskConfig.assignedDisplay}
            onChange={(e) => updateKioskConfig({ assignedDisplay: e.target.value })}
          />

          <div className="inspector-grid-2">
            <div>
              <label className="inspector-label">Orientation</label>
              <select
                className="inspector-input"
                value={kioskConfig.displayOrientation}
                onChange={(e) =>
                  updateKioskConfig({
                    displayOrientation: e.target.value as typeof kioskConfig.displayOrientation,
                  })
                }
              >
                <option value="landscape">Landscape (0°)</option>
                <option value="portrait">Portrait (90°)</option>
                <option value="landscape-flipped">Landscape Flipped (180°)</option>
                <option value="portrait-flipped">Portrait Flipped (270°)</option>
              </select>
            </div>
            <div>
              <label className="inspector-label">Cursor Hide Delay (ms)</label>
              <input
                type="number"
                className="inspector-input"
                value={kioskConfig.hideCursorAfterMs}
                step={500}
                onChange={(e) =>
                  updateKioskConfig({ hideCursorAfterMs: Math.max(500, Number(e.target.value)) })
                }
              />
            </div>
          </div>

          <label className="inspector-label">Startup Package Assignment</label>
          <select
            className="inspector-input"
            value={kioskConfig.assignedPackageId}
            onChange={(e) => updateKioskConfig({ assignedPackageId: e.target.value })}
          >
            {builtPackages.map((b) => (
              <option key={b.packageHashHex} value={b.manifest.project.id}>
                {b.fileName} ({b.packageHashHex.slice(0, 10)})
              </option>
            ))}
          </select>

          <label className="inspector-label">Default Fallback Playlist</label>
          <select
            className="inspector-input"
            value={kioskConfig.defaultPlaylistId}
            onChange={(e) => updateKioskConfig({ defaultPlaylistId: e.target.value })}
          >
            {project.playlists.map((pl) => (
              <option key={pl.id} value={pl.id}>
                {pl.name}
              </option>
            ))}
          </select>

          <div className="kiosk-checkbox-list">
            <label>
              <input
                type="checkbox"
                checked={kioskConfig.launchFullscreen}
                onChange={(e) => updateKioskConfig({ launchFullscreen: e.target.checked })}
              />{' '}
              Launch in Full-Screen Mode on Startup
            </label>
            <label>
              <input
                type="checkbox"
                checked={kioskConfig.startPlaybackAutomatically}
                onChange={(e) =>
                  updateKioskConfig({ startPlaybackAutomatically: e.target.checked })
                }
              />{' '}
              Start Playback Automatically
            </label>
            <label>
              <input
                type="checkbox"
                checked={kioskConfig.hideApplicationChrome}
                onChange={(e) => updateKioskConfig({ hideApplicationChrome: e.target.checked })}
              />{' '}
              Hide Application Chrome & Navigation
            </label>
            <label>
              <input
                type="checkbox"
                checked={kioskConfig.disableContextMenu}
                onChange={(e) => updateKioskConfig({ disableContextMenu: e.target.checked })}
              />{' '}
              Disable Right-Click Context Menu in Player
            </label>
            <label>
              <input
                type="checkbox"
                checked={kioskConfig.restrictDevToolsInProduction}
                onChange={(e) =>
                  updateKioskConfig({ restrictDevToolsInProduction: e.target.checked })
                }
              />{' '}
              Restrict Developer Tools in Production Host
            </label>
            <label>
              <input
                type="checkbox"
                checked={kioskConfig.keepDisplayAwake}
                onChange={(e) => updateKioskConfig({ keepDisplayAwake: e.target.checked })}
              />{' '}
              Keep Display Awake (Wake Lock API + OS DPMS)
            </label>
            <label>
              <input
                type="checkbox"
                checked={kioskConfig.restorePlaybackAfterRestart}
                onChange={(e) =>
                  updateKioskConfig({ restorePlaybackAfterRestart: e.target.checked })
                }
              />{' '}
              Restore Last Active Playback State After Restart
            </label>
            <label>
              <input
                type="checkbox"
                checked={kioskConfig.maintenanceAccessEnabled}
                onChange={(e) =>
                  updateKioskConfig({ maintenanceAccessEnabled: e.target.checked })
                }
              />{' '}
              Enable Protected Maintenance Key Sequence &amp; 5-Tap Corner Gesture
            </label>
          </div>

          <div className="pm-sub-section">
            <div className="palette-title">
              <KeyRound size={14} /> Protected Maintenance Key Sequence &amp; Session Timeout
            </div>
            <div className="inspector-grid-2">
              <div>
                <label className="inspector-label">Maintenance Hotkey Chord</label>
                <input
                  type="text"
                  className="inspector-input"
                  aria-label="Maintenance Hotkey Chord"
                  value={kioskConfig.maintenanceHotkey}
                  onChange={(e) => updateKioskConfig({ maintenanceHotkey: e.target.value })}
                  placeholder="Ctrl+Shift+M"
                />
              </div>
              <div>
                <label className="inspector-label">Session Duration (sec)</label>
                <input
                  type="number"
                  className="inspector-input"
                  aria-label="Maintenance Session Duration"
                  value={kioskConfig.maintenanceSessionDurationSec}
                  min={10}
                  step={30}
                  onChange={(e) =>
                    updateKioskConfig({
                      maintenanceSessionDurationSec: Math.max(10, Number(e.target.value)),
                    })
                  }
                />
              </div>
            </div>
            <label className="inspector-label" style={{ marginTop: '6px' }}>
              Sequential Remote / Hardware Key Sequence (comma-separated)
            </label>
            <input
              type="text"
              className="inspector-input"
              aria-label="Sequential Maintenance Key Sequence"
              value={
                kioskConfig.maintenanceKeySequence ||
                'ArrowUp,ArrowUp,ArrowDown,ArrowDown,ArrowLeft,ArrowRight'
              }
              onChange={(e) => updateKioskConfig({ maintenanceKeySequence: e.target.value })}
              placeholder="ArrowUp,ArrowUp,ArrowDown,ArrowDown,ArrowLeft,ArrowRight"
            />
          </div>

          {/* Protected Admin Credential Rotation */}
          <form className="pm-sub-section" onSubmit={handleRotatePassword}>
            <div className="palette-title">
              <KeyRound size={14} /> Rotate Protected Admin Passphrase (Salted SHA-256)
            </div>
            <input
              type="password"
              className="inspector-input"
              placeholder="Current passphrase (default: ApexAdmin!2026)"
              value={currentSecret}
              onChange={(e) => setCurrentSecret(e.target.value)}
            />
            <input
              type="password"
              className="inspector-input"
              style={{ marginTop: '6px' }}
              placeholder="New passphrase (min 6 chars)"
              value={newSecret}
              onChange={(e) => setNewSecret(e.target.value)}
            />
            <button type="submit" className="btn-secondary full-width" style={{ marginTop: '8px' }}>
              Update Device-Bound Admin Credential
            </button>
          </form>
        </div>

        {/* RIGHT COLUMN: DEVICE DIAGNOSTICS, WATCHDOG & REDACTED LOGS (Spec Sec 12) */}
        <div className="pm-card pm-inspector-wide">
          <div className="pm-card-header">
            <MonitorCheck size={18} color="#10b981" />
            <h3>2. Device Health, Watchdog Supervisor & Sanitized Diagnostics</h3>
          </div>

          <div className="pm-kpi-row">
            <div className="pm-kpi-box">
              <span>Device ID</span>
              <strong>{kioskConfig.deviceId}</strong>
            </div>
            <div className="pm-kpi-box">
              <span>Watchdog State</span>
              <strong style={{ color: watchdog.state === 'HEALTHY' ? '#10b981' : '#f59e0b' }}>
                {watchdog.state}
              </strong>
            </div>
            <div className="pm-kpi-box">
              <span>Restart Counter</span>
              <strong>
                {watchdog.restartCount} / {watchdog.maxRetries} Max
              </strong>
            </div>
            <div className="pm-kpi-box">
              <span>Maintenance Timeout</span>
              <strong>{kioskConfig.maintenanceSessionDurationSec}s</strong>
            </div>
          </div>

          <div className="pm-sub-section">
            <div className="section-header-row">
              <span className="palette-title">
                <FileText size={14} /> Sanitized Local Diagnostic Logs (Sensitive Fields Redacted)
              </span>
              <button className="btn-xs" onClick={handleTestRedactedLog}>
                <RefreshCw size={12} /> Test Credential Redaction
              </button>
            </div>

            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Timestamp</th>
                    <th>Level</th>
                    <th>Category</th>
                    <th>Message</th>
                    <th>Sanitized Metadata</th>
                  </tr>
                </thead>
                <tbody>
                  {diagEntries.map((entry) => (
                    <tr key={entry.id}>
                      <td className="muted-line">{entry.timestamp}</td>
                      <td>
                        <span className="perm-badge">{entry.level.toUpperCase()}</span>
                      </td>
                      <td>{entry.category}</td>
                      <td>{entry.message}</td>
                      <td>
                        <code>{entry.metadata ? JSON.stringify(entry.metadata) : '—'}</code>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="pm-sub-section">
            <div className="palette-title">
              <Shield size={14} /> Local Kiosk Maintenance Audit Trail ({auditEntries.length})
            </div>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Timestamp</th>
                    <th>Actor</th>
                    <th>Action</th>
                    <th>Outcome</th>
                    <th>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {auditEntries.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="muted-line">
                        No maintenance login attempts recorded in this session yet.
                      </td>
                    </tr>
                  ) : (
                    auditEntries.map((a) => (
                      <tr key={a.id}>
                        <td className="muted-line">{a.timestamp}</td>
                        <td>{a.actor}</td>
                        <td>{a.action}</td>
                        <td>
                          <span className="perm-badge">{a.outcome}</span>
                        </td>
                        <td>{a.details}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
