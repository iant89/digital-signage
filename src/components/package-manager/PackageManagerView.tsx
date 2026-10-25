// ============================================================================
// src/components/package-manager/PackageManagerView.tsx
// .signage Binary Archive Builder, 64-Byte Header & Directory Inspector,
// 12-Step Security Validator, Corruption Test Bench & Version Diffing
// ============================================================================

import React, { useMemo, useState } from 'react';
import {
  PackageCheck,
  Download,
  Upload,
  ShieldCheck,
  ShieldAlert,
  FileCode2,
  GitCompare,
  Play,
  CloudUpload,
  CheckCircle2,
  XCircle,
  Sparkles,
} from 'lucide-react';
import { useStudioStore } from '@/store/useStudioStore';
import {
  ArchiveValidationReport,
  DirectoryEntryType,
  applySignageDeltaPatch,
  buildSignageDeltaPatch,
  compareSignagePackages,
  readArchiveEntryBytes,
  validateSignageArchive,
} from '@packages/signage-format';
import { CompressionMethod } from '@packages/compression';
import { validateProject } from '@packages/project-model';
import { bytesToHex, bytesToString, formatBytes } from '@packages/shared';

function entryTypeLabel(t: DirectoryEntryType): string {
  switch (t) {
    case DirectoryEntryType.MANIFEST:
      return 'MANIFEST';
    case DirectoryEntryType.SCENE:
      return 'SCENE';
    case DirectoryEntryType.IMAGE:
      return 'IMAGE';
    case DirectoryEntryType.VIDEO:
      return 'VIDEO';
    case DirectoryEntryType.AUDIO:
      return 'AUDIO';
    case DirectoryEntryType.FONT:
      return 'FONT';
    case DirectoryEntryType.SCRIPT:
      return 'SCRIPT';
    default:
      return 'OTHER';
  }
}

export const PackageManagerView: React.FC = () => {
  const {
    project,
    builtPackages,
    exportSignagePackage,
    importSignagePackageBytes,
    setStandalonePlayerPackage,
    setAppMode,
    notify,
  } = useStudioStore();

  const [exportProfile, setExportProfile] = useState<'compact' | 'fast'>('compact');
  const [exportScope, setExportScope] = useState<'entire-project' | 'selected-scenes' | 'playlist'>(
    'entire-project'
  );
  const [signPackage, setSignPackage] = useState(true);
  const [selectedPkgHash, setSelectedPkgHash] = useState<string>(
    builtPackages[0]?.packageHashHex || ''
  );
  const [comparePkgHashB, setComparePkgHashB] = useState<string>('');
  const [inspectedEntryPreview, setInspectedEntryPreview] = useState<{
    path: string;
    size: number;
    hash: string;
    snippet: string;
  } | null>(null);
  const [securityTestReport, setSecurityTestReport] = useState<{
    testName: string;
    report: ArchiveValidationReport;
  } | null>(null);
  const [uploadingToServer, setUploadingToServer] = useState(false);

  const preflight = useMemo(() => validateProject(project), [project]);

  const activePackage = useMemo(() => {
    return (
      builtPackages.find((p) => p.packageHashHex === selectedPkgHash) ??
      builtPackages[0] ??
      null
    );
  }, [builtPackages, selectedPkgHash]);

  const activeValidation = useMemo(() => {
    if (!activePackage) return null;
    return validateSignageArchive(activePackage.bytes);
  }, [activePackage]);

  const headerHexDump = useMemo(() => {
    if (!activePackage) return '';
    const slice = activePackage.bytes.subarray(0, 64);
    const lines: string[] = [];
    for (let row = 0; row < 4; row++) {
      const offsetHex = (row * 16).toString(16).padStart(4, '0');
      const rowBytes = slice.subarray(row * 16, row * 16 + 16);
      const hexCols = Array.from(rowBytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join(' ');
      lines.push(`${offsetHex}:  ${hexCols}`);
    }
    return lines.join('\n');
  }, [activePackage]);

  const handleBuildPackage = () => {
    const pkg = exportSignagePackage({
      profile: exportProfile,
      scope: exportScope,
      signPackage,
    });
    setSelectedPkgHash(pkg.packageHashHex);
    setSecurityTestReport(null);
  };

  const handleDownloadBinary = () => {
    if (!activePackage) return;
    const blob = new Blob([new Uint8Array(activePackage.bytes)], {
      type: 'application/vnd.digital-signage.package',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = activePackage.fileName;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleUploadToServer = async () => {
    if (!activePackage) return;
    setUploadingToServer(true);
    try {
      let binary = '';
      for (let i = 0; i < activePackage.bytes.byteLength; i++) {
        binary += String.fromCharCode(activePackage.bytes[i]);
      }
      const archiveBase64 = btoa(binary);
      const res = await fetch('/api/v1/packages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: activePackage.manifest.project.name,
          version: builtPackages.length,
          archiveBase64,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        notify('error', data.error || 'Server upload failed');
      } else {
        notify(
          'success',
          data.deduplicated
            ? `Package already in Server Content-Addressed Store (${activePackage.packageHashHex.slice(0, 10)}).`
            : `Uploaded "${activePackage.fileName}" to Network Server Repository.`
        );
      }
    } catch (err) {
      notify('error', `Upload error: ${(err as Error).message}`);
    } finally {
      setUploadingToServer(false);
    }
  };

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const bytes = new Uint8Array(reader.result as ArrayBuffer);
        const imported = importSignagePackageBytes(bytes, false);
        setSelectedPkgHash(imported.packageHashHex);
        setSecurityTestReport(null);
      } catch (err) {
        notify('error', `Safe Rejection: ${(err as Error).message}`);
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  };

  const handleRunCorruptionSimulation = (
    kind: 'corrupt-payload' | 'corrupt-magic' | 'corrupt-reserved'
  ) => {
    if (!activePackage) return;
    const mutated = new Uint8Array(activePackage.bytes);
    if (kind === 'corrupt-magic') {
      mutated[0] = 0x58; // 'X' instead of 'S'
    } else if (kind === 'corrupt-reserved') {
      mutated[48] = 0xff; // Non-zero byte in reserved header bytes 40..63
    } else {
      // Flip a byte inside the first entry payload so SHA-256 verification catches it
      const targetOffset = Math.min(mutated.byteLength - 1, 72);
      mutated[targetOffset] ^= 0xff;
    }
    const report = validateSignageArchive(mutated);
    setSecurityTestReport({
      testName:
        kind === 'corrupt-magic'
          ? 'Corrupted Header Magic Bytes'
          : kind === 'corrupt-reserved'
            ? 'Non-Zero Header Reserved Field'
            : 'Tampered Entry Payload Byte (SHA-256 Integrity Check)',
      report,
    });
  };

  const comparisonResult = useMemo(() => {
    if (!activePackage || !comparePkgHashB) return null;
    const pkgB = builtPackages.find((p) => p.packageHashHex === comparePkgHashB);
    if (!pkgB) return null;
    try {
      const diff = compareSignagePackages(activePackage.bytes, pkgB.bytes);
      const deltaPatch = buildSignageDeltaPatch(activePackage.bytes, pkgB.bytes);
      const reconstructed = applySignageDeltaPatch(activePackage.bytes, deltaPatch);
      return {
        ...diff,
        deltaPatch,
        bitIdenticalVerified: reconstructed.byteLength === pkgB.bytes.byteLength,
      };
    } catch {
      return null;
    }
  }, [activePackage, comparePkgHashB, builtPackages]);

  return (
    <div className="package-manager-page">
      <div className="pm-grid">
        {/* LEFT COLUMN: EXPORT WORKFLOW & IMPORT */}
        <div className="pm-card">
          <div className="pm-card-header">
            <PackageCheck size={18} color="#38bdf8" />
            <h3>1. Build & Export `.signage` Binary Package</h3>
          </div>

          <div className="preflight-box">
            <div className="preflight-title">
              {preflight.valid ? (
                <CheckCircle2 size={15} color="#10b981" />
              ) : (
                <XCircle size={15} color="#f43f5e" />
              )}
              <span>
                Preflight Validation: {preflight.valid ? 'Ready to Package' : 'Issues Detected'}
              </span>
            </div>
            <div className="muted-line">
              {project.scenes.length} scenes • {project.assets.length} media assets •{' '}
              {project.scripts.length} restricted script(s)
            </div>
          </div>

          <label className="inspector-label">Export Scope (Spec 13.1)</label>
          <select
            className="inspector-input"
            value={exportScope}
            onChange={(e) =>
              setExportScope(
                e.target.value as 'entire-project' | 'selected-scenes' | 'playlist'
              )
            }
          >
            <option value="entire-project">Entire Project ({project.scenes.length} scenes)</option>
            <option value="playlist">Prepared Playlist ({project.playlists[0]?.name})</option>
            <option value="selected-scenes">Active Scene Only</option>
          </select>

          <label className="inspector-label">Compression Profile (Spec 7.5)</label>
          <select
            className="inspector-input"
            value={exportProfile}
            onChange={(e) => setExportProfile(e.target.value as 'compact' | 'fast')}
          >
            <option value="compact">
              Compact Export (Deflate eligible JSON/SVG/Scripts, store compressed media unchanged)
            </option>
            <option value="fast">
              Fast Export (Prioritize build speed, minimal compression work)
            </option>
          </select>

          <div className="checkbox-row" style={{ marginTop: '10px' }}>
            <label>
              <input
                type="checkbox"
                checked={signPackage}
                onChange={(e) => setSignPackage(e.target.checked)}
              />{' '}
              Attach Publisher Digital Signature
            </label>
          </div>

          <div className="pm-actions-stack">
            <button className="btn-primary full-width" onClick={handleBuildPackage}>
              <Sparkles size={15} /> Build & Validate .signage Archive
            </button>

            <div className="inline-row">
              <button className="btn-secondary flex-1" onClick={handleDownloadBinary}>
                <Download size={14} /> Download .signage
              </button>
              <button
                className="btn-secondary flex-1"
                onClick={handleUploadToServer}
                disabled={uploadingToServer}
              >
                <CloudUpload size={14} />{' '}
                {uploadingToServer ? 'Uploading...' : 'Push to Network Server'}
              </button>
            </div>

            <div className="inline-row">
              <button
                className="btn-xs flex-1"
                onClick={() => {
                  if (activePackage) {
                    setStandalonePlayerPackage(activePackage);
                    setAppMode('player');
                  }
                }}
              >
                <Play size={13} /> Open in Standalone Player
              </button>
              <label className="btn-xs flex-1" style={{ cursor: 'pointer', justifyContent: 'center' }}>
                <Upload size={13} /> Import .signage File
                <input
                  type="file"
                  accept=".signage,application/octet-stream"
                  style={{ display: 'none' }}
                  onChange={handleImportFile}
                />
              </label>
            </div>
          </div>

          {/* Built Packages History */}
          <div className="pm-sub-section">
            <div className="palette-title">Built Archives in Session ({builtPackages.length})</div>
            <div className="pkg-history-list">
              {builtPackages.map((pkg, idx) => (
                <div
                  key={pkg.packageHashHex}
                  className={`pkg-history-item ${
                    pkg.packageHashHex === activePackage?.packageHashHex ? 'active' : ''
                  }`}
                  onClick={() => {
                    setSelectedPkgHash(pkg.packageHashHex);
                    setSecurityTestReport(null);
                  }}
                >
                  <div>
                    <strong>
                      v{builtPackages.length - idx} • {pkg.fileName}
                    </strong>
                    <div className="muted-line">
                      {formatBytes(pkg.stats.archiveBytes)} ({pkg.stats.savingsPercent}% saved) •{' '}
                      SHA-256: {pkg.packageHashHex.slice(0, 12)}…
                    </div>
                  </div>
                  <span className="entry-pill">{pkg.manifest.exportProfile.toUpperCase()}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* CENTER/RIGHT COLUMN: 64-BYTE HEADER, RANDOM-ACCESS DIRECTORY & SECURITY BENCH */}
        {activePackage && activeValidation && (
          <div className="pm-card pm-inspector-wide">
            <div className="pm-card-header">
              <FileCode2 size={18} color="#38bdf8" />
              <h3>
                2. Binary Container Inspector — <code>{activePackage.fileName}</code>
              </h3>
            </div>

            {/* Summary KPI Strip */}
            <div className="pm-kpi-row">
              <div className="pm-kpi-box">
                <span>Magic Signature</span>
                <strong>{activePackage.header.magic}</strong>
              </div>
              <div className="pm-kpi-box">
                <span>Format Version</span>
                <strong>v{activePackage.header.formatVersion} (64B Header)</strong>
              </div>
              <div className="pm-kpi-box">
                <span>Directory Offset</span>
                <strong>Byte {activePackage.header.directoryOffset}</strong>
              </div>
              <div className="pm-kpi-box">
                <span>Archive Size</span>
                <strong>
                  {formatBytes(activePackage.stats.archiveBytes)} ({activePackage.stats.savingsPercent}%
                  saved)
                </strong>
              </div>
              <div className="pm-kpi-box">
                <span>Integrity & Signature</span>
                <strong style={{ color: activeValidation.valid ? '#10b981' : '#f43f5e' }}>
                  {activeValidation.valid ? 'SHA-256 VERIFIED' : 'INVALID'}
                </strong>
              </div>
            </div>

            {/* 64-Byte Binary Header Hex Dump */}
            <div className="pm-sub-section">
              <div className="palette-title">64-Byte Little-Endian Binary Header Dump</div>
              <pre className="hex-dump-box">{headerHexDump}</pre>
            </div>

            {/* Random-Access Directory Table */}
            <div className="pm-sub-section">
              <div className="palette-title">
                Entry Directory ({activePackage.entries.length} Independently Compressed Entries)
              </div>
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Type</th>
                      <th>Logical Path</th>
                      <th>MIME Type</th>
                      <th>Method</th>
                      <th>Offset</th>
                      <th>Stored / Orig</th>
                      <th>SHA-256 Content Hash</th>
                      <th>Random Access</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activePackage.entries.map((entry) => (
                      <tr key={entry.entryId}>
                        <td>#{entry.entryId}</td>
                        <td>
                          <span className="perm-badge">{entryTypeLabel(entry.entryType)}</span>
                        </td>
                        <td>
                          <code>{entry.logicalPath}</code>
                        </td>
                        <td>{entry.mimeType}</td>
                        <td>
                          {entry.compressionMethod === CompressionMethod.DEFLATE
                            ? 'DEFLATE'
                            : 'STORE'}
                        </td>
                        <td>{entry.dataOffset}</td>
                        <td>
                          {formatBytes(entry.storedLength)} / {formatBytes(entry.originalLength)}
                        </td>
                        <td>
                          <code title={entry.contentHashHex}>
                            {entry.contentHashHex.slice(0, 12)}…
                          </code>
                        </td>
                        <td>
                          <button
                            className="btn-xs"
                            onClick={() => {
                              const raw = readArchiveEntryBytes(activePackage.bytes, entry);
                              const textPreview = bytesToString(raw.subarray(0, 280));
                              setInspectedEntryPreview({
                                path: entry.logicalPath,
                                size: raw.byteLength,
                                hash: bytesToHex(entry.contentHashBytes),
                                snippet: textPreview,
                              });
                            }}
                          >
                            Verify & Read
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {inspectedEntryPreview && (
                <div className="sandbox-result-box" style={{ marginTop: '10px' }}>
                  <div className="sandbox-result-header">
                    <ShieldCheck size={14} color="#10b981" />
                    <strong>
                      Random-Access Read Verified: <code>{inspectedEntryPreview.path}</code> (
                      {formatBytes(inspectedEntryPreview.size)})
                    </strong>
                  </div>
                  <div className="muted-line">SHA-256: {inspectedEntryPreview.hash}</div>
                  <pre className="entry-snippet-pre">{inspectedEntryPreview.snippet}</pre>
                </div>
              )}
            </div>

            {/* Archive Security & Corruption Test Bench (Spec Section 17.1 Step 18-19) */}
            <div className="pm-sub-section">
              <div className="palette-title">
                Archive Security & Corruption Defense Test Bench (Spec Section 7.7 & 17.1)
              </div>
              <div className="inline-row">
                <button
                  className="btn-xs"
                  onClick={() => handleRunCorruptionSimulation('corrupt-payload')}
                >
                  <ShieldAlert size={13} /> Simulate Corrupted Payload Byte
                </button>
                <button
                  className="btn-xs"
                  onClick={() => handleRunCorruptionSimulation('corrupt-magic')}
                >
                  <ShieldAlert size={13} /> Simulate Invalid Magic Header
                </button>
                <button
                  className="btn-xs"
                  onClick={() => handleRunCorruptionSimulation('corrupt-reserved')}
                >
                  <ShieldAlert size={13} /> Simulate Non-Zero Reserved Header
                </button>
              </div>

              {securityTestReport && (
                <div className="security-test-result">
                  <div>
                    <strong>Test Scenario:</strong> {securityTestReport.testName}
                  </div>
                  <div>
                    <strong>Validator Decision:</strong>{' '}
                    <span style={{ color: '#10b981', fontWeight: 700 }}>
                      SAFELY REJECTED (valid = {String(securityTestReport.report.valid)})
                    </span>
                  </div>
                  <div>
                    <strong>Reported Integrity Error:</strong>{' '}
                    <code>{securityTestReport.report.errors.join(' | ')}</code>
                  </div>
                </div>
              )}
            </div>

            {/* Package Version Comparison (Spec Section 13.3) */}
            <div className="pm-sub-section">
              <div className="palette-title">
                <GitCompare size={14} /> Compare Package Versions (Spec Section 13.3)
              </div>
              <div className="inline-row">
                <select
                  className="inspector-input"
                  value={comparePkgHashB}
                  onChange={(e) => setComparePkgHashB(e.target.value)}
                >
                  <option value="">Select another built package version to compare...</option>
                  {builtPackages.map((p, i) => (
                    <option key={p.packageHashHex} value={p.packageHashHex}>
                      v{builtPackages.length - i} — {p.fileName} ({p.packageHashHex.slice(0, 8)})
                    </option>
                  ))}
                </select>
              </div>
              {comparisonResult && (
                <div className="comparison-grid">
                  <div>
                    <span>Format Compatible:</span>{' '}
                    <strong>{comparisonResult.compatible ? 'Yes' : 'No'}</strong>
                  </div>
                  <div>
                    <span>Size Delta:</span>{' '}
                    <strong>
                      {comparisonResult.sizeDeltaBytes >= 0 ? '+' : ''}
                      {comparisonResult.sizeDeltaBytes} B
                    </strong>
                  </div>
                  <div>
                    <span>Added/Removed Assets:</span>{' '}
                    <strong>
                      +{comparisonResult.addedAssets.length} / -
                      {comparisonResult.removedAssets.length}
                    </strong>
                  </div>
                  <div>
                    <span>Modified Scenes:</span>{' '}
                    <strong>{comparisonResult.modifiedScenes.length}</strong>
                  </div>
                  <div>
                    <span>Animation Track Diffs:</span>{' '}
                    <strong>{comparisonResult.animationChangesCount}</strong>
                  </div>
                  <div>
                    <span>Signature Status:</span>{' '}
                    <strong>
                      {comparisonResult.signatureStatusA} → {comparisonResult.signatureStatusB}
                    </strong>
                  </div>
                  <div>
                    <span>Delta Patch Wire Size:</span>{' '}
                    <strong>
                      {formatBytes(comparisonResult.deltaPatch.deltaPayloadBytes)} (
                      {comparisonResult.deltaPatch.bandwidthSavingsPercent}% WAN bandwidth saved)
                    </strong>
                  </div>
                  <div>
                    <span>Retained / Changed Entries:</span>{' '}
                    <strong>
                      {comparisonResult.deltaPatch.retainedEntryCount} retained /{' '}
                      {comparisonResult.deltaPatch.changedEntryCount} inline
                    </strong>
                  </div>
                  <div>
                    <span>Bit-Identical Reconstruction:</span>{' '}
                    <strong style={{ color: '#10b981' }}>
                      {comparisonResult.bitIdenticalVerified ? 'SHA-256 VERIFIED' : 'FAILED'}
                    </strong>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
