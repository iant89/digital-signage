// ============================================================================
// tests/integration/network-discovery.test.mjs
// End-to-end verification of the Windows LAN scanner against a real signage
// server, against a decoy HTTP service, and against invalid scan parameters.
// ============================================================================

import { describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');
const scannerPath = path.join(repoRoot, 'tools/network-scanner/find-signage-server.mjs');
const { buildServerApp, SIGNAGE_DISCOVERY_SERVICE_ID, SIGNAGE_DISCOVERY_PROTOCOL_VERSION } = await import(
  '../../server/app.ts'
);

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

function runScanner(args, timeoutMs = 25_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scannerPath, ...args], {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`Scanner timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

describe('Windows LAN discovery scanner — integration', () => {
  it('exposes a secret-free unauthenticated /api/v1/discovery descriptor', async () => {
    const { app } = await buildServerApp();
    try {
      const response = await app.inject({ method: 'GET', url: '/api/v1/discovery' });
      expect(response.statusCode).toBe(200);
      const descriptor = response.json();
      expect(descriptor).toMatchObject({
        service: SIGNAGE_DISCOVERY_SERVICE_ID,
        protocolVersion: SIGNAGE_DISCOVERY_PROTOCOL_VERSION,
        requiresAuthentication: false,
        applicationVersion: '1.0.0',
      });
      expect(descriptor.instanceId).toMatch(/^srv-[0-9a-f]{16}$/);
      expect(descriptor.endpoints.discovery).toBe('/api/v1/discovery');
      expect(descriptor.endpoints.websocket).toBe('/ws');
      expect(descriptor.features).toContain('fleet-operations');
      expect(Number.isFinite(Date.parse(descriptor.serverTimeUtc))).toBe(true);
      expect(JSON.stringify(descriptor)).not.toMatch(/devtok_|ApexAdmin!2026|password_hash/);
    } finally {
      await app.close();
    }
  });

  it('discovers a running signage server on 127.0.0.1/32 and prints its base URL', async () => {
    const port = await getFreePort();
    const { app } = await buildServerApp();
    await app.listen({ port, host: '127.0.0.1' });
    try {
      const result = await runScanner([
        '--subnet',
        '127.0.0.1/32',
        '--port',
        String(port),
        '--json',
        '--timeout-ms',
        '500',
        '--http-timeout-ms',
        '3000',
      ]);
      expect(result.code).toBe(0);
      const report = JSON.parse(result.stdout);
      expect(report).toMatchObject({
        service: SIGNAGE_DISCOVERY_SERVICE_ID,
        scannedHosts: 1,
        openPorts: 1,
        port,
        scheme: 'http',
        subnets: ['127.0.0.1/32'],
      });
      expect(report.servers).toHaveLength(1);
      expect(report.servers[0]).toMatchObject({
        ip: '127.0.0.1',
        port,
        service: SIGNAGE_DISCOVERY_SERVICE_ID,
        protocolVersion: 1,
        baseUrl: `http://127.0.0.1:${port}`,
        discoveryUrl: `http://127.0.0.1:${port}/api/v1/discovery`,
        simulated: false,
      });
      expect(report.servers[0].endpoints.websocket).toBe('/ws');

      const quiet = await runScanner([
        '--subnet',
        '127.0.0.1/32',
        '--port',
        String(port),
        '--quiet',
        '--first',
        '--timeout-ms',
        '500',
      ]);
      expect(quiet.code).toBe(0);
      expect(quiet.stdout.trim()).toBe(`http://127.0.0.1:${port}`);
    } finally {
      await app.close();
    }
  });

  it('does not misidentify a non-signage HTTP service listening on the same port', async () => {
    const port = await getFreePort();
    const decoy = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ service: 'office-printer', protocolVersion: 1, endpoints: { discovery: '/' } }));
    });
    await new Promise((resolve) => decoy.listen(port, '127.0.0.1', resolve));
    try {
      const result = await runScanner([
        '--subnet',
        '127.0.0.1/32',
        '--port',
        String(port),
        '--json',
        '--timeout-ms',
        '500',
      ]);
      expect(result.code).toBe(1);
      const report = JSON.parse(result.stdout);
      expect(report.servers).toHaveLength(0);
      expect(report.openPorts).toBe(1);
      expect(report.rejections.some((entry) => /Unexpected service/.test(entry.reason))).toBe(true);
    } finally {
      await new Promise((resolve) => decoy.close(resolve));
    }
  });

  it('completes an auto-detected scan without crashing when no LAN NIC is usable', async () => {
    // On a normal Windows host this scans the real LAN subnet; in the sandbox
    // the pure fallback (unit-tested separately) scans loopback instead.
    const port = await getFreePort();
    const { app } = await buildServerApp();
    await app.listen({ port, host: '127.0.0.1' });
    try {
      const result = await runScanner(['--port', String(port), '--json', '--timeout-ms', '500', '--max-hosts', '512']);
      expect([0, 1]).toContain(result.code);
      const report = JSON.parse(result.stdout);
      expect(report.error).toBeUndefined();
      expect(Array.isArray(report.servers)).toBe(true);
      expect(Array.isArray(report.subnets)).toBe(true);
    } finally {
      await app.close();
    }
  });

  it('refuses oversized subnets and invalid schemes with exit code 2', async () => {
    const oversized = await runScanner(['--subnet', '10.0.0.0/8', '--max-hosts', '100', '--json']);
    expect(oversized.code).toBe(2);
    expect(JSON.parse(oversized.stdout).error).toMatch(/exceeds --max-hosts/);

    const badScheme = await runScanner(['--subnet', '127.0.0.1/32', '--scheme', 'ftp', '--json']);
    expect(badScheme.code).toBe(2);
    expect(badScheme.stderr).toMatch(/--scheme must be http or https/);
  });
});
