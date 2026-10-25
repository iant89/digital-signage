// ============================================================================
// @packages/signage-format — Custom .signage Binary Archive Format
// 64-Byte Header, Random-Access Directory, SHA-256 Integrity, 12-Step Validator,
// Fast/Compact Package Builder, Version Diffing & Delta Patching
// (No UI or React dependencies — Architectural Rule 3)
// ============================================================================

import {
  CompressionMethod,
  compressBytes,
  decompressBytes,
  shouldCompressMimeType,
} from '@packages/compression';
import {
  AssetItem,
  PlaybackSchedule,
  Playlist,
  ProjectSettings,
  ProjectTheme,
  ReusableComponent,
  Scene,
  ScriptModule,
  ScriptPermission,
  SignageProject,
  validateProject,
} from '@packages/project-model';
import {
  bytesToHex,
  bytesToString,
  concatBytes,
  equalBytes,
  hexToBytes,
  isSafeArchivePath,
  sha256Bytes,
  sha256Hex,
  stringToBytes,
} from '@packages/shared';

export const SIGNAGE_EXTENSION = '.signage';
export const SIGNAGE_MIME_TYPE = 'application/vnd.digital-signage.package';
export const SIGNAGE_MAGIC_BYTES = new Uint8Array([0x53, 0x49, 0x47, 0x4e, 0x41, 0x47, 0x45, 0x00]); // "SIGNAGE\0"
export const SIGNAGE_FORMAT_VERSION = 1;
export const SIGNAGE_HEADER_SIZE = 64;

export enum SignageFeatureFlags {
  NONE = 0,
  COMPACT_COMPRESSION = 1 << 0,
  SIGNED_PACKAGE = 1 << 1,
  ENCRYPTED_PAYLOAD = 1 << 2,
  HAS_SCRIPTS = 1 << 3,
}

export enum DirectoryEntryType {
  MANIFEST = 1,
  SCENE = 2,
  IMAGE = 3,
  VIDEO = 4,
  AUDIO = 5,
  FONT = 6,
  SCRIPT = 7,
  ANIMATION = 8,
  THEME = 9,
  COMPONENT = 10,
  SIGNATURE = 11,
  OTHER = 12,
}

export interface SignageHeader {
  magic: string;
  formatVersion: number;
  headerSize: number;
  featureFlags: number;
  directoryOffset: number;
  directoryLength: number;
  manifestEntryId: number;
  entryCount: number;
  reservedZeroValid: boolean;
}

export interface SignageDirectoryEntry {
  entryId: number;
  entryType: DirectoryEntryType;
  compressionMethod: CompressionMethod;
  flags: number;
  dataOffset: number;
  storedLength: number;
  originalLength: number;
  contentHashHex: string;
  contentHashBytes: Uint8Array;
  logicalPath: string;
  mimeType: string;
}

export interface SignageManifest {
  format: 'SIGNAGE';
  manifestVersion: number;
  createdAt: string;
  exportProfile: 'fast' | 'compact';
  publisher?: {
    publisherName: string;
    keyId: string;
    signatureHex: string;
  };
  project: ProjectSettings;
  theme: ProjectTheme;
  entrySceneId: string;
  scenes: Scene[];
  assets: Array<Omit<AssetItem, 'dataUrl' | 'optimizedDataUrl'> & { entryId: number }>;
  playlists: Playlist[];
  schedules: PlaybackSchedule[];
  scripts: ScriptModule[];
  permissions: ScriptPermission[];
  components: ReusableComponent[];
}

export interface ArchiveValidationLimits {
  maxEntries: number;
  maxSingleEntryBytes: number;
  maxTotalUncompressedBytes: number;
}

export const DEFAULT_ARCHIVE_LIMITS: ArchiveValidationLimits = {
  maxEntries: 4096,
  maxSingleEntryBytes: 128 * 1024 * 1024, // 128 MB
  maxTotalUncompressedBytes: 512 * 1024 * 1024, // 512 MB
};

export interface ArchiveValidationReport {
  valid: boolean;
  errors: string[];
  warnings: string[];
  header?: SignageHeader;
  entries?: SignageDirectoryEntry[];
  manifest?: SignageManifest;
  packageHashHex: string;
  totalStoredBytes: number;
  totalOriginalBytes: number;
  compressionRatio: number;
  signatureVerified: boolean;
}

export interface BuildPackageOptions {
  profile?: 'fast' | 'compact';
  scope?: 'entire-project' | 'selected-scenes' | 'playlist';
  selectedSceneIds?: string[];
  selectedPlaylistId?: string;
  signPackage?: boolean;
  publisherName?: string;
  signingSecret?: string;
}

export interface BuiltSignagePackage {
  bytes: Uint8Array;
  fileName: string;
  packageHashHex: string;
  header: SignageHeader;
  entries: SignageDirectoryEntry[];
  manifest: SignageManifest;
  stats: {
    totalEntries: number;
    originalBytes: number;
    storedBytes: number;
    archiveBytes: number;
    savedBytes: number;
    savingsPercent: number;
    buildDurationMs: number;
  };
}

function writeUint64LE(view: DataView, offset: number, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Invalid uint64 value: ${value}`);
  }
  const lo = value >>> 0;
  const hi = Math.floor(value / 0x100000000) >>> 0;
  view.setUint32(offset, lo, true);
  view.setUint32(offset + 4, hi, true);
}

function readUint64LE(view: DataView, offset: number): number {
  const lo = view.getUint32(offset, true);
  const hi = view.getUint32(offset + 4, true);
  if (hi > 0x1fffff) {
    throw new Error('64-bit integer exceeds Number.MAX_SAFE_INTEGER');
  }
  return hi * 0x100000000 + lo;
}

export function encodeSignageHeader(header: Omit<SignageHeader, 'magic' | 'reservedZeroValid'>): Uint8Array {
  const buf = new Uint8Array(SIGNAGE_HEADER_SIZE);
  buf.set(SIGNAGE_MAGIC_BYTES, 0);
  const view = new DataView(buf.buffer);
  view.setUint16(8, header.formatVersion, true);
  view.setUint16(10, header.headerSize, true);
  view.setUint32(12, header.featureFlags >>> 0, true);
  writeUint64LE(view, 16, header.directoryOffset);
  writeUint64LE(view, 24, header.directoryLength);
  view.setUint32(32, header.manifestEntryId >>> 0, true);
  view.setUint32(36, header.entryCount >>> 0, true);
  // Bytes 40..63 remain zero-initialized (24 reserved bytes)
  return buf;
}

export function decodeSignageHeader(archiveBytes: Uint8Array): SignageHeader {
  if (archiveBytes.byteLength < SIGNAGE_HEADER_SIZE) {
    throw new Error(`Archive is smaller than 64-byte header (${archiveBytes.byteLength} bytes).`);
  }

  const magicSlice = archiveBytes.subarray(0, 8);
  const magicMatch = equalBytes(magicSlice, SIGNAGE_MAGIC_BYTES);
  const magicStr = magicMatch ? 'SIGNAGE\\0' : bytesToString(magicSlice);

  const view = new DataView(archiveBytes.buffer, archiveBytes.byteOffset, archiveBytes.byteLength);
  const formatVersion = view.getUint16(8, true);
  const headerSize = view.getUint16(10, true);
  const featureFlags = view.getUint32(12, true);
  const directoryOffset = readUint64LE(view, 16);
  const directoryLength = readUint64LE(view, 24);
  const manifestEntryId = view.getUint32(32, true);
  const entryCount = view.getUint32(36, true);

  let reservedZeroValid = true;
  for (let i = 40; i < 64; i++) {
    if (archiveBytes[i] !== 0) {
      reservedZeroValid = false;
      break;
    }
  }

  return {
    magic: magicStr,
    formatVersion,
    headerSize,
    featureFlags,
    directoryOffset,
    directoryLength,
    manifestEntryId,
    entryCount,
    reservedZeroValid,
  };
}

export function encodeDirectoryEntries(entries: SignageDirectoryEntry[]): Uint8Array {
  const records: Uint8Array[] = [];
  for (const entry of entries) {
    const pathBytes = stringToBytes(entry.logicalPath);
    const mimeBytes = stringToBytes(entry.mimeType);
    if (pathBytes.byteLength === 0 || pathBytes.byteLength > 512) {
      throw new Error(`Invalid logicalPath length for "${entry.logicalPath}"`);
    }
    if (mimeBytes.byteLength === 0 || mimeBytes.byteLength > 128) {
      throw new Error(`Invalid mimeType length for "${entry.mimeType}"`);
    }
    if (entry.contentHashBytes.byteLength !== 32) {
      throw new Error('Directory entry contentHashBytes must be 32 bytes (SHA-256).');
    }

    const recordLen = 68 + pathBytes.byteLength + mimeBytes.byteLength;
    const rec = new Uint8Array(recordLen);
    const view = new DataView(rec.buffer);
    view.setUint32(0, entry.entryId >>> 0, true);
    view.setUint8(4, entry.entryType);
    view.setUint8(5, entry.compressionMethod);
    view.setUint16(6, entry.flags, true);
    writeUint64LE(view, 8, entry.dataOffset);
    writeUint64LE(view, 16, entry.storedLength);
    writeUint64LE(view, 24, entry.originalLength);
    rec.set(entry.contentHashBytes, 32);
    view.setUint16(64, pathBytes.byteLength, true);
    view.setUint16(66, mimeBytes.byteLength, true);
    rec.set(pathBytes, 68);
    rec.set(mimeBytes, 68 + pathBytes.byteLength);
    records.push(rec);
  }
  return concatBytes(records);
}

export function decodeDirectoryEntries(
  archiveBytes: Uint8Array,
  header: SignageHeader,
  limits: ArchiveValidationLimits = DEFAULT_ARCHIVE_LIMITS
): SignageDirectoryEntry[] {
  if (header.entryCount > limits.maxEntries) {
    throw new Error(`Entry count (${header.entryCount}) exceeds limit (${limits.maxEntries}).`);
  }
  if (
    header.directoryOffset < SIGNAGE_HEADER_SIZE ||
    header.directoryOffset + header.directoryLength > archiveBytes.byteLength
  ) {
    throw new Error('Directory offset/length out of archive bounds.');
  }

  const entries: SignageDirectoryEntry[] = [];
  let cursor = header.directoryOffset;
  const dirEnd = header.directoryOffset + header.directoryLength;
  const view = new DataView(archiveBytes.buffer, archiveBytes.byteOffset, archiveBytes.byteLength);

  for (let i = 0; i < header.entryCount; i++) {
    if (cursor + 68 > dirEnd) {
      throw new Error(`Truncated directory record at index ${i}`);
    }
    const entryId = view.getUint32(cursor, true);
    const entryType = view.getUint8(cursor + 4) as DirectoryEntryType;
    const compressionMethod = view.getUint8(cursor + 5) as CompressionMethod;
    const flags = view.getUint16(cursor + 6, true);
    const dataOffset = readUint64LE(view, cursor + 8);
    const storedLength = readUint64LE(view, cursor + 16);
    const originalLength = readUint64LE(view, cursor + 24);
    const contentHashBytes = archiveBytes.slice(cursor + 32, cursor + 64);
    const contentHashHex = bytesToHex(contentHashBytes);
    const pathLen = view.getUint16(cursor + 64, true);
    const mimeLen = view.getUint16(cursor + 66, true);

    const recordEnd = cursor + 68 + pathLen + mimeLen;
    if (recordEnd > dirEnd) {
      throw new Error(`Directory record ${i} strings overflow directory boundary.`);
    }

    const logicalPath = bytesToString(archiveBytes.subarray(cursor + 68, cursor + 68 + pathLen));
    const mimeType = bytesToString(
      archiveBytes.subarray(cursor + 68 + pathLen, cursor + 68 + pathLen + mimeLen)
    );

    entries.push({
      entryId,
      entryType,
      compressionMethod,
      flags,
      dataOffset,
      storedLength,
      originalLength,
      contentHashHex,
      contentHashBytes,
      logicalPath,
      mimeType,
    });

    cursor = recordEnd;
  }

  if (cursor !== dirEnd) {
    throw new Error(`Directory byte length mismatch: parsed ${cursor - header.directoryOffset} of ${header.directoryLength} bytes.`);
  }

  return entries;
}

/**
 * Reads, decompresses, and verifies SHA-256 content hash of a single entry
 * without decompressing the rest of the archive (Random-Access Lazy Loading).
 */
export function readArchiveEntryBytes(
  archiveBytes: Uint8Array,
  entry: SignageDirectoryEntry,
  limits: ArchiveValidationLimits = DEFAULT_ARCHIVE_LIMITS
): Uint8Array {
  if (
    entry.dataOffset < SIGNAGE_HEADER_SIZE ||
    entry.dataOffset + entry.storedLength > archiveBytes.byteLength
  ) {
    throw new Error(`Entry "${entry.logicalPath}" data range is out of archive bounds.`);
  }

  const storedSlice = archiveBytes.subarray(entry.dataOffset, entry.dataOffset + entry.storedLength);
  const decompressed = decompressBytes(
    storedSlice,
    entry.compressionMethod,
    entry.originalLength,
    limits.maxSingleEntryBytes
  );

  const actualHash = sha256Bytes(decompressed);
  if (!equalBytes(actualHash, entry.contentHashBytes)) {
    throw new Error(
      `SHA-256 integrity mismatch for entry "${entry.logicalPath}" (expected ${entry.contentHashHex}, got ${bytesToHex(actualHash)})`
    );
  }

  return decompressed;
}

export function computePublisherSignature(
  manifestWithoutSig: Omit<SignageManifest, 'publisher'>,
  signingSecret = 'digital-signage-studio-default-signing-key-v1'
): string {
  const payload = JSON.stringify({
    format: manifestWithoutSig.format,
    manifestVersion: manifestWithoutSig.manifestVersion,
    project: manifestWithoutSig.project.id,
    entrySceneId: manifestWithoutSig.entrySceneId,
    sceneIds: manifestWithoutSig.scenes.map((s) => s.id),
    assetHashes: manifestWithoutSig.assets.map((a) => a.contentHash),
    permissions: manifestWithoutSig.permissions,
    secret: signingSecret,
  });
  return sha256Hex(payload);
}

/**
 * Full 12-Step Security & Integrity Validation Pipeline (Spec Section 7.7).
 * Never executes scripts during validation.
 */
export function validateSignageArchive(
  archiveBytes: Uint8Array,
  limits: ArchiveValidationLimits = DEFAULT_ARCHIVE_LIMITS,
  verifyAllEntryHashes = true,
  signingSecret = 'digital-signage-studio-default-signing-key-v1'
): ArchiveValidationReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const packageHashHex = archiveBytes.byteLength > 0 ? sha256Hex(archiveBytes) : '';

  // 1. Validate minimum size & magic signature
  if (archiveBytes.byteLength < SIGNAGE_HEADER_SIZE) {
    return {
      valid: false,
      errors: [`Archive truncated: ${archiveBytes.byteLength} bytes < 64-byte header.`],
      warnings,
      packageHashHex,
      totalStoredBytes: 0,
      totalOriginalBytes: 0,
      compressionRatio: 1,
      signatureVerified: false,
    };
  }

  let header: SignageHeader;
  try {
    header = decodeSignageHeader(archiveBytes);
  } catch (err) {
    return {
      valid: false,
      errors: [`Header decode failed: ${(err as Error).message}`],
      warnings,
      packageHashHex,
      totalStoredBytes: 0,
      totalOriginalBytes: 0,
      compressionRatio: 1,
      signatureVerified: false,
    };
  }

  if (header.magic !== 'SIGNAGE\\0') {
    errors.push('Invalid magic signature: expected "SIGNAGE\\0".');
  }

  // 2. Validate format version
  if (header.formatVersion !== SIGNAGE_FORMAT_VERSION) {
    errors.push(`Unsupported format version: ${header.formatVersion} (supported: ${SIGNAGE_FORMAT_VERSION}).`);
  }

  // 3. Validate header bounds & reserved bytes
  if (header.headerSize !== SIGNAGE_HEADER_SIZE) {
    errors.push(`Invalid header size: ${header.headerSize} (expected 64).`);
  }
  if (!header.reservedZeroValid) {
    errors.push('Header reserved bytes (40..63) must be all zero.');
  }

  // 11. Report unsupported feature flags
  const knownFlags =
    SignageFeatureFlags.COMPACT_COMPRESSION |
    SignageFeatureFlags.SIGNED_PACKAGE |
    SignageFeatureFlags.ENCRYPTED_PAYLOAD |
    SignageFeatureFlags.HAS_SCRIPTS;
  if ((header.featureFlags & ~knownFlags) !== 0) {
    errors.push(`Unsupported feature flags in header: 0x${header.featureFlags.toString(16)}`);
  }

  // 4 & 6. Validate directory bounds & entry count limits
  if (header.entryCount < 1 || header.entryCount > limits.maxEntries) {
    errors.push(`Invalid entry count: ${header.entryCount} (allowed: 1..${limits.maxEntries}).`);
  }
  if (
    header.directoryOffset < SIGNAGE_HEADER_SIZE ||
    header.directoryLength <= 0 ||
    header.directoryOffset + header.directoryLength > archiveBytes.byteLength
  ) {
    errors.push('Directory offset or length exceeds archive file bounds.');
  }

  if (errors.length > 0) {
    return {
      valid: false,
      errors,
      warnings,
      header,
      packageHashHex,
      totalStoredBytes: 0,
      totalOriginalBytes: 0,
      compressionRatio: 1,
      signatureVerified: false,
    };
  }

  let entries: SignageDirectoryEntry[] = [];
  try {
    entries = decodeDirectoryEntries(archiveBytes, header, limits);
  } catch (err) {
    errors.push(`Directory parse error: ${(err as Error).message}`);
    return {
      valid: false,
      errors,
      warnings,
      header,
      packageHashHex,
      totalStoredBytes: 0,
      totalOriginalBytes: 0,
      compressionRatio: 1,
      signatureVerified: false,
    };
  }

  // 5, 7, 8: Non-overlapping ranges, path traversal protection, decompression bomb limits
  const sortedByOffset = [...entries].sort((a, b) => a.dataOffset - b.dataOffset);
  let prevEnd = SIGNAGE_HEADER_SIZE;
  let totalStoredBytes = 0;
  let totalOriginalBytes = 0;
  const seenIds = new Set<number>();
  const seenPaths = new Set<string>();

  for (const entry of sortedByOffset) {
    if (seenIds.has(entry.entryId)) {
      errors.push(`Duplicate directory entry ID: ${entry.entryId}`);
    }
    seenIds.add(entry.entryId);

    if (!isSafeArchivePath(entry.logicalPath)) {
      errors.push(`Unsafe or invalid archive path rejected: "${entry.logicalPath}"`);
    }
    if (seenPaths.has(entry.logicalPath)) {
      errors.push(`Duplicate logical path in directory: "${entry.logicalPath}"`);
    }
    seenPaths.add(entry.logicalPath);

    if (entry.dataOffset < prevEnd) {
      errors.push(`Overlapping or out-of-order entry data at offset ${entry.dataOffset} ("${entry.logicalPath}").`);
    }
    const entryEnd = entry.dataOffset + entry.storedLength;
    if (entryEnd > header.directoryOffset) {
      errors.push(`Entry "${entry.logicalPath}" extends into directory region (${entryEnd} > ${header.directoryOffset}).`);
    }
    prevEnd = Math.max(prevEnd, entryEnd);

    if (entry.originalLength > limits.maxSingleEntryBytes) {
      errors.push(
        `Entry "${entry.logicalPath}" uncompressed size (${entry.originalLength}) exceeds limit (${limits.maxSingleEntryBytes}).`
      );
    }

    totalStoredBytes += entry.storedLength;
    totalOriginalBytes += entry.originalLength;
  }

  if (totalOriginalBytes > limits.maxTotalUncompressedBytes) {
    errors.push(
      `Total archive uncompressed size (${totalOriginalBytes}) exceeds decompression bomb limit (${limits.maxTotalUncompressedBytes}).`
    );
  }

  if (errors.length > 0) {
    return {
      valid: false,
      errors,
      warnings,
      header,
      entries,
      packageHashHex,
      totalStoredBytes,
      totalOriginalBytes,
      compressionRatio: totalOriginalBytes > 0 ? totalStoredBytes / totalOriginalBytes : 1,
      signatureVerified: false,
    };
  }

  // 8. Verify entry hashes and read manifest
  const manifestEntry = entries.find((e) => e.entryId === header.manifestEntryId);
  if (!manifestEntry) {
    errors.push(`Manifest entry ID ${header.manifestEntryId} not found in directory.`);
  }

  let manifest: SignageManifest | undefined;
  let signatureVerified = false;

  if (manifestEntry) {
    try {
      const manifestBytes = readArchiveEntryBytes(archiveBytes, manifestEntry, limits);
      const parsed = JSON.parse(bytesToString(manifestBytes)) as SignageManifest;
      manifest = parsed;

      // 9. Validate manifest schema
      if (parsed.format !== 'SIGNAGE' || parsed.manifestVersion !== 1) {
        errors.push('Invalid manifest format or manifestVersion.');
      }
      if (!parsed.project?.id || !parsed.project?.name) {
        errors.push('Manifest missing project metadata.');
      }
      if (!Array.isArray(parsed.scenes) || parsed.scenes.length === 0) {
        errors.push('Manifest must contain at least one scene.');
      } else if (!parsed.scenes.some((s) => s.id === parsed.entrySceneId)) {
        errors.push(`Manifest entrySceneId "${parsed.entrySceneId}" not found in scenes.`);
      }

      // 10. Verify asset and script references against directory entries
      const entryIdMap = new Map(entries.map((e) => [e.entryId, e]));
      const manifestAssetIds = new Set<string>();
      for (const assetMeta of parsed.assets ?? []) {
        manifestAssetIds.add(assetMeta.id);
        const dirEntry = entryIdMap.get(assetMeta.entryId);
        if (!dirEntry) {
          errors.push(`Asset "${assetMeta.id}" references missing directory entry ID ${assetMeta.entryId}.`);
        } else if (dirEntry.contentHashHex !== assetMeta.contentHash) {
          errors.push(`Asset "${assetMeta.id}" contentHash does not match directory entry hash.`);
        }
      }

      const manifestScriptIds = new Set((parsed.scripts ?? []).map((s) => s.id));
      for (const scene of parsed.scenes ?? []) {
        for (const el of scene.elements ?? []) {
          if ((el.type === 'image' || el.type === 'video' || el.type === 'audio') && el.mediaProps?.assetId) {
            if (!manifestAssetIds.has(el.mediaProps.assetId)) {
              errors.push(
                `Scene "${scene.name}" element "${el.name}" references unknown asset "${el.mediaProps.assetId}".`
              );
            }
          }
        }
        for (const sid of scene.scriptIds ?? []) {
          if (!manifestScriptIds.has(sid)) {
            errors.push(`Scene "${scene.name}" references unknown script "${sid}".`);
          }
        }
      }

      // Verify publisher signature if present
      if (parsed.publisher?.signatureHex) {
        const expectedSig = computePublisherSignature(parsed, signingSecret);
        if (expectedSig === parsed.publisher.signatureHex) {
          signatureVerified = true;
        } else {
          warnings.push('Publisher signature did not match local verification key.');
        }
      }
    } catch (err) {
      errors.push(`Manifest validation error: ${(err as Error).message}`);
    }
  }

  if (verifyAllEntryHashes) {
    for (const entry of entries) {
      if (manifestEntry && entry.entryId === manifestEntry.entryId) continue;
      try {
        readArchiveEntryBytes(archiveBytes, entry, limits);
      } catch (err) {
        errors.push((err as Error).message);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    header,
    entries,
    manifest,
    packageHashHex,
    totalStoredBytes,
    totalOriginalBytes,
    compressionRatio: totalOriginalBytes > 0 ? totalStoredBytes / totalOriginalBytes : 1,
    signatureVerified,
  };
}

/**
 * Builds a complete, portable `.signage` binary archive from a SignageProject.
 */
export function buildSignagePackage(
  project: SignageProject,
  options: BuildPackageOptions = {}
): BuiltSignagePackage {
  const startMs = performance.now();
  const profile = options.profile ?? 'compact';
  const scope = options.scope ?? 'entire-project';

  // Preflight check
  const validation = validateProject(project);
  if (!validation.valid) {
    const firstErr = validation.issues.find((i) => i.severity === 'error');
    throw new Error(`Preflight validation failed: ${firstErr?.message ?? 'Invalid project'}`);
  }

  // Filter scenes based on scope
  let scenesToExport = project.scenes;
  if (scope === 'selected-scenes' && options.selectedSceneIds && options.selectedSceneIds.length > 0) {
    const allowed = new Set(options.selectedSceneIds);
    scenesToExport = project.scenes.filter((s) => allowed.has(s.id));
  } else if (scope === 'playlist' && options.selectedPlaylistId) {
    const pl = project.playlists.find((p) => p.id === options.selectedPlaylistId);
    if (pl) {
      const allowed = new Set(pl.items.map((item) => item.sceneId));
      scenesToExport = project.scenes.filter((s) => allowed.has(s.id));
    }
  }
  if (scenesToExport.length === 0) {
    scenesToExport = project.scenes;
  }

  const entrySceneId = scenesToExport.some((s) => s.id === project.entrySceneId)
    ? project.entrySceneId
    : scenesToExport[0].id;

  // Prepare asset entries (Entry IDs 2..N)
  let nextEntryId = 2;
  const assetManifestItems: SignageManifest['assets'] = [];
  const rawEntriesToPack: Array<{
    entryId: number;
    entryType: DirectoryEntryType;
    flags: number;
    logicalPath: string;
    mimeType: string;
    uncompressedBytes: Uint8Array;
  }> = [];

  for (const asset of project.assets) {
    const entryId = nextEntryId++;
    const payloadStr = asset.optimizedDataUrl || asset.dataUrl;
    const uncompressedBytes = stringToBytes(payloadStr);
    const contentHash = sha256Hex(uncompressedBytes);
    const safePath = isSafeArchivePath(asset.logicalPath)
      ? asset.logicalPath
      : `assets/${asset.id}.dat`;

    let entryType = DirectoryEntryType.OTHER;
    if (asset.type === 'image') entryType = DirectoryEntryType.IMAGE;
    else if (asset.type === 'video') entryType = DirectoryEntryType.VIDEO;
    else if (asset.type === 'audio') entryType = DirectoryEntryType.AUDIO;
    else if (asset.type === 'font') entryType = DirectoryEntryType.FONT;

    assetManifestItems.push({
      id: asset.id,
      name: asset.name,
      type: asset.type,
      mimeType: asset.mimeType,
      logicalPath: safePath,
      byteSize: uncompressedBytes.byteLength,
      contentHash,
      width: asset.width,
      height: asset.height,
      durationMs: asset.durationMs,
      codec: asset.codec,
      tags: asset.tags,
      folder: asset.folder,
      entryId,
    });

    rawEntriesToPack.push({
      entryId,
      entryType,
      flags: 0x01,
      logicalPath: safePath,
      mimeType: asset.mimeType,
      uncompressedBytes,
    });
  }

  // Also store each script module as an inspectable directory entry
  for (const script of project.scripts) {
    const entryId = nextEntryId++;
    const scriptBytes = stringToBytes(JSON.stringify(script, null, 2));
    rawEntriesToPack.push({
      entryId,
      entryType: DirectoryEntryType.SCRIPT,
      flags: 0x04,
      logicalPath: `scripts/${script.id}.json`,
      mimeType: 'application/vnd.digital-signage.script+json',
      uncompressedBytes: scriptBytes,
    });
  }

  // Construct Manifest (Entry ID 1)
  const manifestDraft: SignageManifest = {
    format: 'SIGNAGE',
    manifestVersion: 1,
    createdAt: new Date().toISOString(),
    exportProfile: profile,
    project: project.settings,
    theme: project.theme,
    entrySceneId,
    scenes: scenesToExport,
    assets: assetManifestItems,
    playlists: project.playlists,
    schedules: project.schedules,
    scripts: project.scripts,
    permissions: project.permissions,
    components: project.components,
  };

  if (options.signPackage !== false) {
    const sigHex = computePublisherSignature(manifestDraft, options.signingSecret);
    manifestDraft.publisher = {
      publisherName: options.publisherName ?? 'Digital Signage Studio Authority',
      keyId: 'pub-ed25519-sha256-01',
      signatureHex: sigHex,
    };
  }

  const manifestBytes = stringToBytes(JSON.stringify(manifestDraft));
  const allEntriesRaw = [
    {
      entryId: 1,
      entryType: DirectoryEntryType.MANIFEST,
      flags: 0x01,
      logicalPath: 'manifest.json',
      mimeType: 'application/json',
      uncompressedBytes: manifestBytes,
    },
    ...rawEntriesToPack,
  ];

  const payloadChunks: Uint8Array[] = [];
  const directoryEntries: SignageDirectoryEntry[] = [];
  let currentDataOffset = SIGNAGE_HEADER_SIZE;
  let totalOriginalBytes = 0;
  let totalStoredBytes = 0;

  for (const item of allEntriesRaw) {
    const shouldCompress = shouldCompressMimeType(
      item.mimeType,
      profile,
      item.uncompressedBytes.byteLength
    );
    const { data: storedBytes, methodUsed } = shouldCompress
      ? compressBytes(item.uncompressedBytes, CompressionMethod.DEFLATE)
      : { data: item.uncompressedBytes, methodUsed: CompressionMethod.NONE };

    const contentHashBytes = sha256Bytes(item.uncompressedBytes);
    const contentHashHex = bytesToHex(contentHashBytes);

    directoryEntries.push({
      entryId: item.entryId,
      entryType: item.entryType,
      compressionMethod: methodUsed,
      flags: item.flags,
      dataOffset: currentDataOffset,
      storedLength: storedBytes.byteLength,
      originalLength: item.uncompressedBytes.byteLength,
      contentHashHex,
      contentHashBytes,
      logicalPath: item.logicalPath,
      mimeType: item.mimeType,
    });

    payloadChunks.push(storedBytes);
    currentDataOffset += storedBytes.byteLength;
    totalOriginalBytes += item.uncompressedBytes.byteLength;
    totalStoredBytes += storedBytes.byteLength;
  }

  const directoryBytes = encodeDirectoryEntries(directoryEntries);
  const directoryOffset = currentDataOffset;
  const directoryLength = directoryBytes.byteLength;

  let featureFlags = SignageFeatureFlags.NONE;
  if (profile === 'compact') featureFlags |= SignageFeatureFlags.COMPACT_COMPRESSION;
  if (manifestDraft.publisher) featureFlags |= SignageFeatureFlags.SIGNED_PACKAGE;
  if (project.scripts.length > 0) featureFlags |= SignageFeatureFlags.HAS_SCRIPTS;

  const headerObj: SignageHeader = {
    magic: 'SIGNAGE\\0',
    formatVersion: SIGNAGE_FORMAT_VERSION,
    headerSize: SIGNAGE_HEADER_SIZE,
    featureFlags,
    directoryOffset,
    directoryLength,
    manifestEntryId: 1,
    entryCount: directoryEntries.length,
    reservedZeroValid: true,
  };

  const headerBytes = encodeSignageHeader(headerObj);
  const archiveBytes = concatBytes([headerBytes, ...payloadChunks, directoryBytes]);
  const packageHashHex = sha256Hex(archiveBytes);
  const savedBytes = Math.max(0, totalOriginalBytes - totalStoredBytes);
  const savingsPercent =
    totalOriginalBytes > 0 ? Math.round((savedBytes / totalOriginalBytes) * 1000) / 10 : 0;

  const slug = project.settings.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

  return {
    bytes: archiveBytes,
    fileName: `${slug || 'presentation'}${SIGNAGE_EXTENSION}`,
    packageHashHex,
    header: headerObj,
    entries: directoryEntries,
    manifest: manifestDraft,
    stats: {
      totalEntries: directoryEntries.length,
      originalBytes: totalOriginalBytes,
      storedBytes: totalStoredBytes,
      archiveBytes: archiveBytes.byteLength,
      savedBytes,
      savingsPercent,
      buildDurationMs: Math.round((performance.now() - startMs) * 100) / 100,
    },
  };
}

/**
 * Reconstructs a full editable SignageProject from a validated .signage binary archive.
 */
export function extractProjectFromArchive(
  archiveBytes: Uint8Array,
  limits: ArchiveValidationLimits = DEFAULT_ARCHIVE_LIMITS
): {
  project: SignageProject;
  report: ArchiveValidationReport;
} {
  const report = validateSignageArchive(archiveBytes, limits, true);
  if (!report.valid || !report.manifest || !report.entries) {
    throw new Error(`Cannot import invalid .signage archive: ${report.errors.join('; ')}`);
  }

  const entryMap = new Map(report.entries.map((e) => [e.entryId, e]));
  const reconstructedAssets: AssetItem[] = report.manifest.assets.map((assetMeta) => {
    const dirEntry = entryMap.get(assetMeta.entryId);
    if (!dirEntry) {
      throw new Error(`Missing directory entry ${assetMeta.entryId} for asset ${assetMeta.id}`);
    }
    const rawBytes = readArchiveEntryBytes(archiveBytes, dirEntry, limits);
    const dataUrl = bytesToString(rawBytes);
    return {
      id: assetMeta.id,
      name: assetMeta.name,
      type: assetMeta.type,
      mimeType: assetMeta.mimeType,
      logicalPath: assetMeta.logicalPath,
      dataUrl,
      byteSize: assetMeta.byteSize,
      contentHash: assetMeta.contentHash,
      width: assetMeta.width,
      height: assetMeta.height,
      durationMs: assetMeta.durationMs,
      codec: assetMeta.codec,
      tags: assetMeta.tags ?? [],
      folder: assetMeta.folder ?? 'Imported',
    };
  });

  const project: SignageProject = {
    schemaVersion: 1,
    updatedAt: report.manifest.createdAt,
    settings: report.manifest.project,
    theme: report.manifest.theme,
    entrySceneId: report.manifest.entrySceneId,
    scenes: report.manifest.scenes,
    assets: reconstructedAssets,
    playlists: report.manifest.playlists ?? [],
    schedules: report.manifest.schedules ?? [],
    scripts: report.manifest.scripts ?? [],
    permissions: report.manifest.permissions ?? [],
    components: report.manifest.components ?? [],
  };

  return { project, report };
}

export interface PackageComparisonResult {
  compatible: boolean;
  sizeDeltaBytes: number;
  addedAssets: string[];
  removedAssets: string[];
  modifiedAssets: string[];
  addedScenes: string[];
  removedScenes: string[];
  modifiedScenes: string[];
  animationChangesCount: number;
  scriptChanges: string[];
  addedPermissions: ScriptPermission[];
  removedPermissions: ScriptPermission[];
  signatureStatusA: string;
  signatureStatusB: string;
}

export function compareSignagePackages(
  bytesA: Uint8Array,
  bytesB: Uint8Array
): PackageComparisonResult {
  const repA = validateSignageArchive(bytesA);
  const repB = validateSignageArchive(bytesB);
  if (!repA.valid || !repB.valid || !repA.manifest || !repB.manifest) {
    throw new Error('Both packages must be valid .signage archives to compare.');
  }

  const mA = repA.manifest;
  const mB = repB.manifest;

  const assetsA = new Map(mA.assets.map((a) => [a.id, a.contentHash]));
  const assetsB = new Map(mB.assets.map((a) => [a.id, a.contentHash]));

  const addedAssets: string[] = [];
  const removedAssets: string[] = [];
  const modifiedAssets: string[] = [];

  for (const [id, hashB] of assetsB.entries()) {
    if (!assetsA.has(id)) addedAssets.push(id);
    else if (assetsA.get(id) !== hashB) modifiedAssets.push(id);
  }
  for (const id of assetsA.keys()) {
    if (!assetsB.has(id)) removedAssets.push(id);
  }

  const scenesA = new Map(mA.scenes.map((s) => [s.id, s]));
  const scenesB = new Map(mB.scenes.map((s) => [s.id, s]));
  const addedScenes: string[] = [];
  const removedScenes: string[] = [];
  const modifiedScenes: string[] = [];
  let animationChangesCount = 0;

  for (const [id, sB] of scenesB.entries()) {
    const sA = scenesA.get(id);
    if (!sA) {
      addedScenes.push(sB.name);
      animationChangesCount += sB.animationTracks.length;
    } else {
      if (JSON.stringify(sA) !== JSON.stringify(sB)) {
        modifiedScenes.push(sB.name);
      }
      if (JSON.stringify(sA.animationTracks) !== JSON.stringify(sB.animationTracks)) {
        animationChangesCount += Math.max(1, Math.abs(sB.animationTracks.length - sA.animationTracks.length));
      }
    }
  }
  for (const [id, sA] of scenesA.entries()) {
    if (!scenesB.has(id)) removedScenes.push(sA.name);
  }

  const scriptsA = new Map(mA.scripts.map((s) => [s.id, JSON.stringify(s)]));
  const scriptsB = new Map(mB.scripts.map((s) => [s.id, JSON.stringify(s)]));
  const scriptChanges: string[] = [];
  for (const [id, jsonB] of scriptsB.entries()) {
    if (!scriptsA.has(id)) scriptChanges.push(`Added script ${id}`);
    else if (scriptsA.get(id) !== jsonB) scriptChanges.push(`Modified script ${id}`);
  }
  for (const id of scriptsA.keys()) {
    if (!scriptsB.has(id)) scriptChanges.push(`Removed script ${id}`);
  }

  const permsA = new Set(mA.permissions);
  const permsB = new Set(mB.permissions);
  const addedPermissions = mB.permissions.filter((p) => !permsA.has(p));
  const removedPermissions = mA.permissions.filter((p) => !permsB.has(p));

  return {
    compatible: repA.header?.formatVersion === repB.header?.formatVersion,
    sizeDeltaBytes: bytesB.byteLength - bytesA.byteLength,
    addedAssets,
    removedAssets,
    modifiedAssets,
    addedScenes,
    removedScenes,
    modifiedScenes,
    animationChangesCount,
    scriptChanges,
    addedPermissions,
    removedPermissions,
    signatureStatusA: repA.signatureVerified ? 'Verified' : 'Unsigned/Unverified',
    signatureStatusB: repB.signatureVerified ? 'Verified' : 'Unsigned/Unverified',
  };
}
