// ============================================================================
// tests/unit/enterprise-phase14.test.ts
// Automated Verification for Phase 14 Enterprise Extensions:
// 14.1 Binary Delta Patch Transport (buildSignageDeltaPatch / applySignageDeltaPatch / API)
// 14.2 Native Desktop Host CLI, Multi-Display Bounds & Kiosk CSP
// 14.3 Filesystem & S3 Content-Addressed Blob Adapters + PostgreSQL Cluster Adapter
// ============================================================================

import { describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { createStarterProject } from '@packages/project-model';
import {
  applySignageDeltaPatch,
  buildSignageDeltaPatch,
  buildSignagePackage,
} from '@packages/signage-format';
import { sha256Hex, stringToBytes } from '@packages/shared';
import {
  DesktopKioskHost,
  buildKioskCspHeader,
  parseKioskCliArgs,
  resolveTargetDisplayBounds,
} from '../../apps/desktop-host/kiosk-host';
import {
  FilesystemBlobStorageAdapter,
  PostgresClusterAdapter,
  S3CompatibleBlobStorageAdapter,
} from '../../server/adapters/storage-adapter';
import { buildServerApp } from '../../server/app';

describe('Phase 14 Enterprise Extensions Suite', () => {
  it('14.1 builds entry-level binary delta patches and reconstructs bit-identical target .signage packages', () => {
    const projectV1 = createStarterProject();
    const pkgV1 = buildSignagePackage(projectV1, { profile: 'compact', signPackage: true });

    // Create v2 where only one scene's headline text changes, while all media assets remain identical
    const projectV2 = structuredClone(projectV1);
    projectV2.settings.name = 'Delta Patch Corporate Project v2';
    const firstText = projectV2.scenes[0].elements.find((e) => e.type === 'text');
    if (firstText?.textProps) {
      firstText.textProps.text = 'UPDATED HEADLINE VIA DELTA STREAM v2';
    }
    const pkgV2 = buildSignagePackage(projectV2, { profile: 'compact', signPackage: true });

    const deltaPatch = buildSignageDeltaPatch(pkgV1.bytes, pkgV2.bytes);

    expect(deltaPatch.basePackageHashHex).toBe(pkgV1.packageHashHex);
    expect(deltaPatch.targetPackageHashHex).toBe(pkgV2.packageHashHex);
    expect(deltaPatch.retainedEntryCount).toBeGreaterThanOrEqual(4);
    expect(deltaPatch.changedEntryCount).toBeGreaterThanOrEqual(1);
    expect(deltaPatch.deltaPayloadBytes).toBeLessThan(deltaPatch.targetPackageSizeBytes);
    expect(deltaPatch.bandwidthSavingsPercent).toBeGreaterThan(20);

    // Apply delta patch to pkgV1.bytes -> must yield bit-for-bit identical pkgV2.bytes
    const reconstructedBytes = applySignageDeltaPatch(pkgV1.bytes, deltaPatch);
    expect(reconstructedBytes.byteLength).toBe(pkgV2.bytes.byteLength);
    expect(sha256Hex(reconstructedBytes)).toBe(pkgV2.packageHashHex);

    // Tampered base package must be rejected before applying patch
    const tamperedBase = new Uint8Array(pkgV1.bytes);
    tamperedBase[70] ^= 0xff;
    expect(() => applySignageDeltaPatch(tamperedBase, deltaPatch)).toThrow();
  });

  it('14.1 serves binary delta patches over POST /api/v1/packages/delta', async () => {
    const tmpDir = path.join(os.tmpdir(), `signage-delta-api-${Date.now()}`);
    const { app, store } = await buildServerApp({
      dbPath: ':memory:',
      storageDir: tmpDir,
    });

    const projectV2 = createStarterProject();
    projectV2.settings.name = 'Apex Global Lobby v2';
    const uploadRes = await app.inject({
      method: 'POST',
      url: '/api/v1/packages',
      headers: { 'x-role': 'admin' },
      payload: {
        packageId: 'pkg-apex-lobby-v2',
        name: 'Apex Global Lobby v2',
        version: 2,
        project: projectV2,
      },
    });
    expect(uploadRes.statusCode).toBe(200);

    const deltaRes = await app.inject({
      method: 'POST',
      url: '/api/v1/packages/delta',
      payload: {
        basePackageId: 'pkg-apex-lobby-v1',
        targetPackageId: 'pkg-apex-lobby-v2',
      },
    });
    expect(deltaRes.statusCode).toBe(200);
    const body = deltaRes.json();
    expect(body.basePackageId).toBe('pkg-apex-lobby-v1');
    expect(body.targetPackageId).toBe('pkg-apex-lobby-v2');
    expect(body.deltaPatch.retainedEntryCount).toBeGreaterThan(0);

    await app.close();
    store.db.close();
  });

  it('14.2 parses desktop kiosk CLI flags, multi-display bounds, and strict CSP headers', () => {
    const cli = parseKioskCliArgs([
      '--kiosk',
      '--package',
      '/var/lib/signage/active.signage',
      '--server=https://signage.example.org:4000',
      '--display',
      '1',
      '--device-id=player-wall-02',
    ]);

    expect(cli.kiosk).toBe(true);
    expect(cli.fullscreen).toBe(true);
    expect(cli.packagePath).toBe('/var/lib/signage/active.signage');
    expect(cli.serverUrl).toBe('https://signage.example.org:4000');
    expect(cli.displayIndex).toBe(1);
    expect(cli.deviceId).toBe('player-wall-02');

    const bounds = resolveTargetDisplayBounds(
      [
        { id: 'disp-0', index: 0, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, primary: true },
        { id: 'disp-1', index: 1, bounds: { x: 1920, y: 0, width: 3840, height: 2160 }, primary: false },
      ],
      1
    );
    expect(bounds).toEqual({ x: 1920, y: 0, width: 3840, height: 2160 });

    const csp = buildKioskCspHeader('https://signage.example.org:4000');
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain('https://signage.example.org:4000');
    expect(csp).toContain('wss://signage.example.org:4000');

    const host = new DesktopKioskHost();
    expect(host.getBrowserWindowOptions(true).kiosk).toBe(true);
    expect(host.getBrowserWindowOptions(true).devToolsEnabled).toBe(false);
  });

  it('14.3 validates Filesystem, S3-compatible, and PostgreSQL cluster adapters', async () => {
    const tmpBlobDir = path.join(os.tmpdir(), `signage-blobs-${Date.now()}`);
    const fsAdapter = new FilesystemBlobStorageAdapter(tmpBlobDir);
    const sampleBytes = stringToBytes('SIGNAGE_SAMPLE_PACKAGE_PAYLOAD');
    const sampleHash = sha256Hex(sampleBytes);

    const fsMeta = await fsAdapter.putPackageBlob(sampleHash, sampleBytes);
    expect(fsMeta.contentHashHex).toBe(sampleHash);
    expect(await fsAdapter.hasPackageBlob(sampleHash)).toBe(true);
    const readBack = await fsAdapter.getPackageBlob(sampleHash);
    expect(readBack ? sha256Hex(readBack) : '').toBe(sampleHash);

    await expect(fsAdapter.putPackageBlob('0000badhash', sampleBytes)).rejects.toThrow();

    const s3Adapter = new S3CompatibleBlobStorageAdapter({
      endpoint: 'https://s3.us-east-1.amazonaws.com',
      region: 'us-east-1',
      bucket: 'apex-signage-prod',
      accessKeyId: 'AKIAEXAMPLE123',
      secretAccessKey: 'secret-key-example',
    });

    const s3Meta = await s3Adapter.putPackageBlob(sampleHash, sampleBytes);
    expect(s3Meta.storageKey).toContain('s3://apex-signage-prod/signage-packages/');
    const presignedUrl = s3Adapter.generatePresignedDownloadUrl(sampleHash, 600);
    expect(presignedUrl).toContain('X-Amz-Algorithm=AWS4-HMAC-SHA256');
    expect(presignedUrl).toContain(sampleHash);

    const pgAdapter = new PostgresClusterAdapter({
      connectionString: 'postgres://signage:pass@db.internal:5432/signage',
      nodeId: 'control-node-a',
    });
    const translated = pgAdapter.translateParameterizedSql(
      "SELECT * FROM devices WHERE status = ? AND location = 'Lobby?East' AND drift_ms > ?"
    );
    expect(translated).toBe(
      "SELECT * FROM devices WHERE status = $1 AND location = 'Lobby?East' AND drift_ms > $2"
    );

    expect(pgAdapter.tryAcquireSessionLeaderLock('session-01', 'node-1')).toBe(true);
    expect(pgAdapter.tryAcquireSessionLeaderLock('session-01', 'node-2')).toBe(false);
    expect(pgAdapter.releaseSessionLeaderLock('session-01', 'node-1')).toBe(true);
    expect(pgAdapter.tryAcquireSessionLeaderLock('session-01', 'node-2')).toBe(true);
  });
});
