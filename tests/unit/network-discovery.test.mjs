// ============================================================================
// tests/unit/network-discovery.test.mjs
// Pure helpers for the Windows LAN discovery CLI (tools/network-scanner).
// ============================================================================

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DISCOVERY_PATH,
  DEFAULT_PORT,
  DEFAULT_SERVICE_ID,
  buildBaseUrl,
  buildDiscoveryUrl,
  expandTargetSpec,
  getLocalIpv4Networks,
  intToIpv4,
  ipv4ToInt,
  isSignageDiscovery,
  mapWithConcurrency,
  maskToPrefix,
  normalizeTargets,
  parseCidr,
  parseCliArgs,
  prefixToMask,
  resolveScanTargets,
} from '../../tools/network-scanner/discovery-core.mjs';

const validDescriptor = {
  service: DEFAULT_SERVICE_ID,
  protocolVersion: 1,
  instanceId: 'srv-abc123',
  displayName: 'Digital Signage Studio Management Server',
  applicationVersion: '1.0.0',
  serverTimeUtc: '2026-10-26T10:30:00.000Z',
  scheme: 'http',
  hostname: '192.168.1.10',
  port: 4000,
  baseUrl: 'http://192.168.1.10:4000',
  secure: false,
  requiresAuthentication: false,
  endpoints: {
    discovery: DEFAULT_DISCOVERY_PATH,
    overview: '/api/v1/server/overview',
    websocket: '/ws',
  },
  features: ['network-sync', 'fleet-operations'],
};

describe('LAN discovery — IPv4 math', () => {
  it('round-trips IPv4 addresses and contiguous netmasks', () => {
    expect(ipv4ToInt('192.168.1.10')).toBe(3232235786);
    expect(intToIpv4(3232235786)).toBe('192.168.1.10');
    expect(ipv4ToInt('0.0.0.0')).toBe(0);
    expect(intToIpv4(0xffffffff)).toBe('255.255.255.255');
    expect(prefixToMask(24)).toBe(0xffffff00);
    expect(prefixToMask(0)).toBe(0);
    expect(maskToPrefix('255.255.255.0')).toBe(24);
    expect(maskToPrefix('255.255.254.0')).toBe(23);
    expect(() => maskToPrefix('255.0.255.0')).toThrow(/Non-contiguous/);
    expect(() => ipv4ToInt('999.1.1.1')).toThrow(/out of range/);
    expect(() => ipv4ToInt('::1')).toThrow(/Invalid IPv4/);
  });

  it('normalizes CIDRs and computes usable host ranges', () => {
    const subnet = parseCidr('192.168.1.5/24'); // host bits are masked off
    expect(subnet).toMatchObject({
      cidr: '192.168.1.0/24',
      network: '192.168.1.0',
      broadcast: '192.168.1.255',
      prefix: 24,
      firstHost: '192.168.1.1',
      lastHost: '192.168.1.254',
      totalAddresses: 256,
      usableHosts: 254,
    });
    expect(parseCidr('10.0.0.1/32').usableHosts).toBe(1);
    expect(parseCidr('10.0.0.0/31').usableHosts).toBe(2);
    expect(parseCidr('10.0.0.0/31').firstHost).toBe('10.0.0.0');
    expect(parseCidr('10.0.0.0/30').usableHosts).toBe(2);
    expect(() => parseCidr('10.0.0.0/33')).toThrow(/between 0 and 32/);
    expect(() => parseCidr('10.0.0.0/abc')).toThrow(/Invalid CIDR prefix/);
    expect(() => parseCidr('fd00::/64')).toThrow(/IPv6 is not supported/);
  });

  it('expands CIDRs, single IPs and inclusive ranges, with a safety cap', () => {
    expect(expandTargetSpec('192.168.1.0/29')).toEqual([
      '192.168.1.1',
      '192.168.1.2',
      '192.168.1.3',
      '192.168.1.4',
      '192.168.1.5',
      '192.168.1.6',
    ]);
    expect(expandTargetSpec('192.168.1.7')).toEqual(['192.168.1.7']);
    expect(expandTargetSpec('192.168.1.10-192.168.1.12')).toEqual([
      '192.168.1.10',
      '192.168.1.11',
      '192.168.1.12',
    ]);
    expect(
      expandTargetSpec('192.168.1.0/30', { includeNetworkAndBroadcast: true })
    ).toEqual(['192.168.1.0', '192.168.1.1', '192.168.1.2', '192.168.1.3']);
    expect(() => expandTargetSpec('10.0.0.0/8')).toThrow(/exceeds --max-hosts/);
    expect(() => expandTargetSpec('10.0.0.0/16', { maxHosts: 10 })).toThrow(/exceeds --max-hosts/);
    expect(() => expandTargetSpec('192.168.1.20-192.168.1.10')).toThrow(/end before start/);
  });

  it('deduplicates multiple target specs', () => {
    expect(normalizeTargets(['192.168.1.0/30', '192.168.1.2', '10.0.0.1-10.0.0.2'])).toEqual([
      '192.168.1.1',
      '192.168.1.2',
      '10.0.0.1',
      '10.0.0.2',
    ]);
    expect(normalizeTargets('192.168.1.1, 192.168.1.2')).toEqual(['192.168.1.1', '192.168.1.2']);
  });

  it('builds correct base and discovery URLs (including IPv6 literals)', () => {
    expect(buildBaseUrl('192.168.1.10', DEFAULT_PORT, 'http')).toBe('http://192.168.1.10:4000');
    expect(buildDiscoveryUrl('192.168.1.10', DEFAULT_PORT, 'http', DEFAULT_DISCOVERY_PATH)).toBe(
      'http://192.168.1.10:4000/api/v1/discovery'
    );
    expect(buildDiscoveryUrl('signage.local', 443, 'https', 'api/v1/discovery')).toBe(
      'https://signage.local/api/v1/discovery'
    );
    expect(buildDiscoveryUrl('::1', 4000, 'http', '/api/v1/discovery')).toBe(
      'http://[::1]:4000/api/v1/discovery'
    );
    expect(buildBaseUrl('127.0.0.1', 80, 'http')).toBe('http://127.0.0.1');
  });

  it('auto-detects local IPv4 networks with optional link-local filtering', () => {
    const defaultNetworks = getLocalIpv4Networks();
    const allNetworks = getLocalIpv4Networks({ includeLinkLocal: true });
    for (const cidr of [...defaultNetworks, ...allNetworks]) {
      expect(cidr).toMatch(/^\d+\.\d+\.\d+\.\d+\/\d{1,2}$/);
    }
    expect(allNetworks.length).toBeGreaterThanOrEqual(defaultNetworks.length);
  });
});

describe('LAN discovery — service verification', () => {
  it('accepts a well-formed signage discovery descriptor', () => {
    const result = isSignageDiscovery(validDescriptor);
    expect(result.ok).toBe(true);
    expect(result.server).toMatchObject({
      service: DEFAULT_SERVICE_ID,
      protocolVersion: 1,
      instanceId: 'srv-abc123',
      baseUrl: 'http://192.168.1.10:4000',
      secure: false,
    });
    expect(result.server.features).toEqual(['network-sync', 'fleet-operations']);
  });

  it('rejects wrong services and malformed descriptors without throwing', () => {
    expect(isSignageDiscovery(null).ok).toBe(false);
    expect(isSignageDiscovery([]).ok).toBe(false);
    expect(isSignageDiscovery({ ...validDescriptor, service: 'printer' }).reason).toMatch(/Unexpected service/);
    expect(isSignageDiscovery({ ...validDescriptor, protocolVersion: '1' }).reason).toMatch(/protocolVersion/);
    expect(isSignageDiscovery({ ...validDescriptor, serverTimeUtc: 'not-a-date' }).reason).toMatch(/serverTimeUtc/);
    expect(isSignageDiscovery({ ...validDescriptor, endpoints: {} }).reason).toMatch(/endpoints.discovery/);
    expect(isSignageDiscovery(validDescriptor, 'some-other-service').ok).toBe(false);
    expect(isSignageDiscovery({ ...validDescriptor, simulated: true }).server.simulated).toBe(true);
  });
});

describe('LAN discovery — CLI parsing and concurrency', () => {
  it('parses GNU, short, PowerShell-style and inline-value arguments', () => {
    const options = parseCliArgs([
      '--subnet',
      '192.168.1.0/24',
      '--port=4001',
      '--json',
      '--first',
      '--no-tcp-probe',
      '-TimeoutMs',
      '250',
      '--https',
      '--include-network-and-broadcast',
    ]);
    expect(options.subnet).toEqual(['192.168.1.0/24']);
    expect(options.port).toBe(4001);
    expect(options.scheme).toBe('https');
    expect(options.timeoutMs).toBe(250);
    expect(options.json).toBe(true);
    expect(options.first).toBe(true);
    expect(options.tcpProbe).toBe(false);
    expect(options.includeNetworkAndBroadcast).toBe(true);

    const positional = parseCliArgs(['10.0.0.0/24', '-p', '8080', '-j']);
    expect(positional.subnet).toEqual(['10.0.0.0/24']);
    expect(positional.port).toBe(8080);
    expect(positional.json).toBe(true);
    expect(parseCliArgs(['--help']).help).toBe(true);
    expect(() => parseCliArgs(['--port'])).toThrow(/Missing value/);
    expect(() => parseCliArgs(['--port', 'abc'])).toThrow(/positive number/);
  });

  it('falls back to loopback when auto-detection finds no usable NIC', () => {
    const fallback = resolveScanTargets({ subnet: [] }, []);
    expect(fallback.specs).toEqual(['127.0.0.1/32']);
    expect(fallback.autoDetected).toBe(false);
    expect(fallback.warnings[0]).toMatch(/No local IPv4 subnets detected/);

    const detected = resolveScanTargets({ subnet: [] }, ['192.168.1.0/24']);
    expect(detected.specs).toEqual(['192.168.1.0/24']);
    expect(detected.autoDetected).toBe(true);
    expect(detected.warnings).toEqual([]);

    const explicit = resolveScanTargets({ subnet: ['10.0.0.0/24'] }, ['192.168.1.0/24']);
    expect(explicit.specs).toEqual(['10.0.0.0/24']);
    expect(explicit.autoDetected).toBe(false);
  });

  it('maps with bounded concurrency and preserves result order', async () => {
    let active = 0;
    let peak = 0;
    const results = await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7, 8], 3, async (value) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      if (value === 4) throw new Error('boom');
      return value * 2;
    });
    expect(peak).toBeLessThanOrEqual(3);
    expect(results.map((r) => (r.status === 'fulfilled' ? r.value : r.reason.message))).toEqual([
      2,
      4,
      6,
      'boom',
      10,
      12,
      14,
      16,
    ]);
  });
});
