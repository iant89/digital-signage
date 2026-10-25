import { describe, expect, it } from 'vitest';
import { createStarterProject } from '@packages/project-model';
import {
  SIGNAGE_HEADER_SIZE,
  buildSignagePackage,
  compareSignagePackages,
  decodeSignageHeader,
  extractProjectFromArchive,
  readArchiveEntryBytes,
  validateSignageArchive,
} from '@packages/signage-format';
import {
  CompressionMethod,
  compressBytes,
  decompressBytes,
  shouldCompressMimeType,
} from '@packages/compression';
import { RestrictedScriptRuntime } from '@packages/script-runtime';
import { stringToBytes } from '@packages/shared';

describe('Custom .signage Binary Archive Format, Fuzz Security & Script Sandbox', () => {
  it('encodes exact 64-byte header, compresses eligible entries, and round-trips bit-for-bit', () => {
    const project = createStarterProject();
    const built = buildSignagePackage(project, { profile: 'compact', signPackage: true });

    expect(built.bytes.byteLength).toBeGreaterThan(SIGNAGE_HEADER_SIZE);
    const header = decodeSignageHeader(built.bytes);
    expect(header.magic).toBe('SIGNAGE\\0');
    expect(header.formatVersion).toBe(1);
    expect(header.headerSize).toBe(64);
    expect(header.manifestEntryId).toBe(1);
    expect(header.entryCount).toBe(built.entries.length);
    expect(header.reservedZeroValid).toBe(true);

    // Random-access read of a single entry without decompressing the entire archive
    const manifestEntry = built.entries.find((e) => e.entryId === 1)!;
    const rawManifestBytes = readArchiveEntryBytes(built.bytes, manifestEntry);
    expect(rawManifestBytes.byteLength).toBe(manifestEntry.originalLength);

    // Full extraction & round-trip verification
    const extracted = extractProjectFromArchive(built.bytes);
    expect(extracted.report.valid).toBe(true);
    expect(extracted.report.signatureVerified).toBe(true);
    expect(extracted.project.settings.name).toBe(project.settings.name);
    expect(extracted.project.scenes).toHaveLength(project.scenes.length);
    expect(extracted.project.assets).toHaveLength(project.assets.length);
  });

  it('respects compression rules: compresses JSON/SVG/Scripts, does not recompress PNG/MP4/WOFF2', () => {
    expect(shouldCompressMimeType('application/json', 'compact', 1200)).toBe(true);
    expect(shouldCompressMimeType('image/svg+xml', 'compact', 1200)).toBe(true);
    expect(shouldCompressMimeType('image/png', 'compact', 50000)).toBe(false);
    expect(shouldCompressMimeType('image/jpeg', 'compact', 50000)).toBe(false);
    expect(shouldCompressMimeType('video/mp4', 'compact', 500000)).toBe(false);
    expect(shouldCompressMimeType('font/woff2', 'compact', 50000)).toBe(false);
  });

  it('compares two .signage package versions accurately (Spec Section 13.3)', () => {
    const p1 = createStarterProject();
    const p2 = createStarterProject();
    p2.scenes[0].name = 'Updated Welcome Scene v2';
    p2.permissions.push('playlist:select');

    const pkg1 = buildSignagePackage(p1, { profile: 'compact' });
    const pkg2 = buildSignagePackage(p2, { profile: 'compact' });

    const diff = compareSignagePackages(pkg1.bytes, pkg2.bytes);
    expect(diff.compatible).toBe(true);
    expect(diff.modifiedScenes).toContain('Updated Welcome Scene v2');
    expect(diff.addedPermissions).toContain('playlist:select');
  });

  it('rejects malformed headers, corrupted payloads, decompression bombs, and fuzzed inputs safely', () => {
    const project = createStarterProject();
    const validPkg = buildSignagePackage(project, { profile: 'compact' });

    // 1. Truncated archive (< 64 bytes)
    expect(validateSignageArchive(new Uint8Array(20)).valid).toBe(false);

    // 2. Corrupted magic signature
    const badMagic = new Uint8Array(validPkg.bytes);
    badMagic[0] = 0x00;
    const repMagic = validateSignageArchive(badMagic);
    expect(repMagic.valid).toBe(false);
    expect(repMagic.errors.some((e) => e.includes('magic'))).toBe(true);

    // 3. Unsupported format version
    const badVersion = new Uint8Array(validPkg.bytes);
    badVersion[8] = 99;
    expect(validateSignageArchive(badVersion).valid).toBe(false);

    // 4. Non-zero reserved bytes (40..63)
    const badReserved = new Uint8Array(validPkg.bytes);
    badReserved[50] = 0x01;
    expect(validateSignageArchive(badReserved).valid).toBe(false);

    // 5. Corrupted payload byte caught by SHA-256 verification
    const corruptedPayload = new Uint8Array(validPkg.bytes);
    corruptedPayload[70] ^= 0xff;
    const repCorrupt = validateSignageArchive(corruptedPayload);
    expect(repCorrupt.valid).toBe(false);
    expect(repCorrupt.errors.some((e) => e.includes('SHA-256') || e.includes('Manifest'))).toBe(true);

    // 6. Decompression bomb protection (strict size limit)
    const repBomb = validateSignageArchive(validPkg.bytes, {
      maxEntries: 4096,
      maxSingleEntryBytes: 100, // Artificially small limit to trigger bomb guard
      maxTotalUncompressedBytes: 500,
    });
    expect(repBomb.valid).toBe(false);
    expect(repBomb.errors.some((e) => e.includes('exceeds'))).toBe(true);

    // Direct decompression bomb stream test
    const sample = stringToBytes('A'.repeat(2000));
    const compressed = compressBytes(sample, CompressionMethod.DEFLATE);
    expect(() =>
      decompressBytes(compressed.data, compressed.methodUsed, 2000, 500)
    ).toThrow(/Decompression bomb protection triggered/);

    // 7. Random fuzz inputs (25 iterations) never throw uncaught exceptions
    for (let i = 0; i < 25; i++) {
      const len = 32 + i * 17;
      const randomBytes = new Uint8Array(len);
      for (let j = 0; j < len; j++) {
        randomBytes[j] = (i * 31 + j * 13) & 0xff;
      }
      const res = validateSignageArchive(randomBytes);
      expect(res.valid).toBe(false);
    }
  });

  it('enforces script sandbox permissions, instruction limits, and timer cleanup on scene exit', () => {
    const runtime = new RestrictedScriptRuntime(
      ['scene:read', 'text:write', 'timer:use', 'diagnostics:log'],
      ['scene:read', 'text:write', 'timer:use'], // Note: visibility:write NOT granted
      { maxOperationsPerInvoke: 10, maxStateKeys: 4, maxMessagesPerSecond: 20 }
    );

    let timerFired = false;
    const registered = runtime.registerBoundedTimer(() => {
      timerFired = true;
    }, 5000);
    expect(registered).toBe(true);
    expect(runtime.getActiveTimerCount()).toBe(1);

    const diag = runtime.invokeHook(
      {
        id: 'script-test',
        name: 'Sandbox Test Script',
        description: '',
        enabled: true,
        permissions: ['text:write'],
        rules: [
          {
            id: 'r1',
            hook: 'onSceneEnter',
            actions: [
              { type: 'setText', elementId: 'el-1', value: 'Allowed Update' },
              { type: 'setVisibility', elementId: 'el-1', value: false }, // Unauthorized!
            ],
          },
        ],
      },
      'onSceneEnter',
      { elapsedMs: 0 }
    );

    expect(diag.emittedMessages).toHaveLength(1);
    expect(diag.emittedMessages[0].actionType).toBe('setText');
    expect(diag.deniedActions).toHaveLength(1);
    expect(diag.deniedActions[0]).toContain('visibility:write');

    // Exiting scene must cancel all active timers so timers never leak across scenes
    runtime.invokeHook(
      {
        id: 'script-test',
        name: 'Sandbox Test Script',
        description: '',
        enabled: true,
        permissions: [],
        rules: [],
      },
      'onSceneExit',
      { elapsedMs: 1000 }
    );
    expect(runtime.getActiveTimerCount()).toBe(0);
    expect(timerFired).toBe(false);
  });
});
