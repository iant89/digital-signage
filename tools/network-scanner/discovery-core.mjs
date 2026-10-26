// ============================================================================
// tools/network-scanner/discovery-core.mjs
// Pure, dependency-free helpers shared by the Windows LAN discovery CLI and
// its Vitest suites. No React, no DOM, no third-party packages.
// ============================================================================

import os from 'node:os';

export const DEFAULT_SERVICE_ID = 'digital-signage-studio';
export const DEFAULT_DISCOVERY_PATH = '/api/v1/discovery';
export const DEFAULT_PORT = 4000;
export const DEFAULT_SCHEME = 'http';
export const DEFAULT_TIMEOUT_MS = 400;
export const DEFAULT_HTTP_TIMEOUT_MS = 2000;
export const DEFAULT_CONCURRENCY = 96;
export const DEFAULT_MAX_HOSTS = 4096;

/** Convert a dotted IPv4 string to an unsigned 32-bit integer. */
export function ipv4ToInt(ip) {
  if (typeof ip !== 'string') throw new TypeError('IPv4 address must be a string');
  const parts = ip.trim().split('.');
  if (parts.length !== 4) throw new Error(`Invalid IPv4 address: "${ip}"`);
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) throw new Error(`Invalid IPv4 octet in "${ip}"`);
    const octet = Number(part);
    if (octet < 0 || octet > 255) throw new Error(`IPv4 octet out of range in "${ip}"`);
    value = (value * 256 + octet) >>> 0;
  }
  return value >>> 0;
}

/** Convert an unsigned 32-bit integer to a dotted IPv4 string. */
export function intToIpv4(value) {
  const n = value >>> 0;
  return `${(n >>> 24) & 255}.${(n >>> 16) & 255}.${(n >>> 8) & 255}.${n & 255}`;
}

/** Contiguous 1-bits mask for a CIDR prefix length (0..32). */
export function prefixToMask(prefix) {
  return prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
}

/** Convert a dotted netmask (e.g. 255.255.255.0) to a CIDR prefix length. */
export function maskToPrefix(netmask) {
  const mask = ipv4ToInt(netmask);
  let prefix = 0;
  let seenZero = false;
  for (let bit = 31; bit >= 0; bit--) {
    const isOne = ((mask >>> bit) & 1) === 1;
    if (isOne) {
      if (seenZero) throw new Error(`Non-contiguous IPv4 netmask: ${netmask}`);
      prefix += 1;
    } else {
      seenZero = true;
    }
  }
  return prefix;
}

/**
 * Parse an IPv4 CIDR (or bare IPv4 address) into a normalized subnet record.
 * Host bits in the supplied address are intentionally masked off.
 */
export function parseCidr(cidrOrIp, defaultPrefix = 32) {
  if (typeof cidrOrIp !== 'string' || !cidrOrIp.trim()) {
    throw new Error('Subnet must be a non-empty string, e.g. 192.168.1.0/24');
  }
  const trimmed = cidrOrIp.trim();
  const slash = trimmed.indexOf('/');
  const ipPart = slash === -1 ? trimmed : trimmed.slice(0, slash);
  // Reject IPv6 / hostnames early — this scanner is IPv4-only by design.
  if (ipPart.includes(':')) throw new Error(`IPv6 is not supported by this scanner: "${ipPart}"`);
  const prefixPart = slash === -1 ? String(defaultPrefix) : trimmed.slice(slash + 1);
  if (!/^\d{1,2}$/.test(prefixPart)) throw new Error(`Invalid CIDR prefix in "${trimmed}"`);
  const prefix = Number(prefixPart);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
    throw new Error(`CIDR prefix must be between 0 and 32 in "${trimmed}"`);
  }

  const mask = prefixToMask(prefix);
  const networkInt = (ipv4ToInt(ipPart) & mask) >>> 0;
  const broadcastInt = (networkInt | (~mask >>> 0)) >>> 0;
  // /31 (point-to-point) and /32 (single host) have no network/broadcast waste.
  const pointToPoint = prefix >= 31;
  const firstHostInt = pointToPoint ? networkInt : (networkInt + 1) >>> 0;
  const lastHostInt = pointToPoint ? broadcastInt : (broadcastInt - 1) >>> 0;
  const usableHosts = prefix === 32 ? 1 : Math.max(0, lastHostInt - firstHostInt + 1);

  return {
    cidr: `${intToIpv4(networkInt)}/${prefix}`,
    network: intToIpv4(networkInt),
    broadcast: intToIpv4(broadcastInt),
    prefix,
    networkInt,
    broadcastInt,
    firstHost: intToIpv4(firstHostInt),
    firstHostInt,
    lastHost: intToIpv4(lastHostInt),
    lastHostInt,
    totalAddresses: broadcastInt - networkInt + 1,
    usableHosts,
  };
}

/**
 * Expand a single target spec into a list of IPv4 host addresses.
 * Supports CIDR, a bare IPv4 address, or an inclusive range (a-b).
 */
export function expandTargetSpec(spec, options = {}) {
  const maxHosts = options.maxHosts ?? DEFAULT_MAX_HOSTS;
  const includeNetworkAndBroadcast = options.includeNetworkAndBroadcast === true;
  const trimmed = String(spec).trim();
  if (!trimmed) return [];

  if (trimmed.includes('-')) {
    const [startRaw, endRaw] = trimmed.split('-', 2);
    const start = ipv4ToInt(startRaw.trim());
    const end = ipv4ToInt(endRaw.trim());
    if (end < start) throw new Error(`Invalid IPv4 range (end before start): "${trimmed}"`);
    const count = end - start + 1;
    if (count > maxHosts) {
      throw new Error(`Range "${trimmed}" contains ${count} hosts, which exceeds --max-hosts ${maxHosts}.`);
    }
    const hosts = [];
    for (let n = start; n <= end; n++) hosts.push(intToIpv4(n));
    return hosts;
  }

  const subnet = parseCidr(trimmed);
  const start = includeNetworkAndBroadcast && subnet.prefix < 31 ? subnet.networkInt : subnet.firstHostInt;
  const end = includeNetworkAndBroadcast && subnet.prefix < 31 ? subnet.broadcastInt : subnet.lastHostInt;
  const count = end - start + 1;
  if (count > maxHosts) {
    throw new Error(
      `Subnet "${subnet.cidr}" contains ${count} candidate hosts, which exceeds --max-hosts ${maxHosts}. ` +
        'Narrow the subnet (e.g. /24) or raise --max-hosts.'
    );
  }
  const hosts = [];
  for (let n = start; n <= end; n++) hosts.push(intToIpv4(n));
  return hosts;
}

/** Expand many specs (comma-separated strings or arrays) into a deduped host list. */
export function normalizeTargets(specs, options = {}) {
  const list = Array.isArray(specs) ? specs : [specs];
  const hosts = [];
  for (const spec of list) {
    for (const piece of String(spec).split(',')) {
      if (!piece.trim()) continue;
      hosts.push(...expandTargetSpec(piece, options));
    }
  }
  return [...new Set(hosts)];
}

/**
 * Resolve the final list of subnet specs for a scan.
 * Kept pure so the "no NIC detected" fallback can be unit-tested on any host.
 */
export function resolveScanTargets(options, detectedNetworks = []) {
  const autoDetected = !options.subnet || options.subnet.length === 0;
  const warnings = [];
  let specs = autoDetected ? [...detectedNetworks] : [...options.subnet];
  let usedFallback = false;
  if (specs.length === 0) {
    warnings.push('No local IPv4 subnets detected; falling back to loopback 127.0.0.1/32. Use --subnet to override.');
    specs = ['127.0.0.1/32'];
    usedFallback = true;
  }
  return { specs, warnings, autoDetected: autoDetected && !usedFallback };
}

/** Derive local IPv4 CIDRs from the machine's network interfaces. */
export function getLocalIpv4Networks(options = {}) {
  const includeLoopback = options.includeLoopback === true;
  const includeLinkLocal = options.includeLinkLocal === true;
  const cidrs = new Set();
  for (const [name, addresses] of Object.entries(os.networkInterfaces())) {
    for (const address of addresses || []) {
      if (address.family !== 'IPv4' || address.internal) continue;
      let ipInt;
      try {
        ipInt = ipv4ToInt(address.address);
      } catch {
        continue;
      }
      if (!includeLoopback && (ipInt >>> 24) === 127) continue;
      // 169.254.0.0/16 (APIPA / link-local) is usually noise on Windows clients.
      if (!includeLinkLocal && ((ipInt & 0xffff0000) >>> 0) === 0xa9fe0000) continue;
      let prefix;
      try {
        prefix = maskToPrefix(address.netmask || '255.255.255.0');
      } catch {
        continue;
      }
      const networkInt = (ipInt & prefixToMask(prefix)) >>> 0;
      cidrs.add(`${intToIpv4(networkInt)}/${prefix}`);
      void name;
    }
  }
  return [...cidrs].sort();
}

/** Build a scheme://host[:port] authority, correctly bracketing IPv6 literals. */
export function buildBaseUrl(host, port, scheme = DEFAULT_SCHEME) {
  const normalizedScheme = scheme === 'https' ? 'https' : 'http';
  const numericPort = Number(port) || DEFAULT_PORT;
  const bracketed = String(host).includes(':') && !String(host).startsWith('[') ? `[${host}]` : String(host);
  const isDefaultPort =
    (normalizedScheme === 'http' && numericPort === 80) || (normalizedScheme === 'https' && numericPort === 443);
  return `${normalizedScheme}://${isDefaultPort ? bracketed : `${bracketed}:${numericPort}`}`;
}

/** Build an absolute discovery URL, correctly bracketing IPv6 literals. */
export function buildDiscoveryUrl(host, port, scheme = DEFAULT_SCHEME, path = DEFAULT_DISCOVERY_PATH) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${buildBaseUrl(host, port, scheme)}${normalizedPath}`;
}

/**
 * Validate a discovery payload against the signage service contract.
 * Returns { ok, reason, server } — never throws on untrusted JSON.
 */
export function isSignageDiscovery(payload, expectedServiceId = DEFAULT_SERVICE_ID) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, reason: 'Discovery response is not a JSON object.' };
  }
  const record = /** @type {Record<string, any>} */ (payload);
  if (record.service !== expectedServiceId) {
    return { ok: false, reason: `Unexpected service "${String(record.service)}" (expected ${expectedServiceId}).` };
  }
  if (typeof record.protocolVersion !== 'number' || !Number.isFinite(record.protocolVersion)) {
    return { ok: false, reason: 'Missing or invalid protocolVersion.' };
  }
  if (!record.endpoints || typeof record.endpoints !== 'object' || typeof record.endpoints.discovery !== 'string') {
    return { ok: false, reason: 'Missing endpoints.discovery in discovery response.' };
  }
  const timestamp = Date.parse(String(record.serverTimeUtc || ''));
  if (!Number.isFinite(timestamp)) {
    return { ok: false, reason: 'Missing or invalid serverTimeUtc.' };
  }
  const server = {
    service: record.service,
    protocolVersion: record.protocolVersion,
    instanceId: typeof record.instanceId === 'string' ? record.instanceId : 'unknown',
    displayName: typeof record.displayName === 'string' ? record.displayName : expectedServiceId,
    applicationVersion: typeof record.applicationVersion === 'string' ? record.applicationVersion : 'unknown',
    serverTimeUtc: record.serverTimeUtc,
    scheme: record.scheme === 'https' ? 'https' : 'http',
    hostname: typeof record.hostname === 'string' ? record.hostname : '',
    port: Number(record.port) || DEFAULT_PORT,
    baseUrl: typeof record.baseUrl === 'string' ? record.baseUrl : '',
    secure: record.secure === true,
    requiresAuthentication: record.requiresAuthentication === true,
    simulated: record.simulated === true,
    endpoints: record.endpoints,
    features: Array.isArray(record.features) ? record.features.filter((f) => typeof f === 'string') : [],
  };
  return { ok: true, server };
}

/** Deterministic, cooperative bounded-concurrency map. */
export async function mapWithConcurrency(items, limit, worker, options = {}) {
  const results = new Array(items.length);
  const concurrency = Math.max(1, Math.min(limit, items.length || 1));
  let nextIndex = 0;
  let completed = 0;
  const signal = options.signal || { aborted: false };
  const onProgress = options.onProgress;

  async function runWorker() {
    for (;;) {
      if (signal.aborted) return;
      const index = nextIndex++;
      if (index >= items.length) return;
      try {
        results[index] = { status: 'fulfilled', value: await worker(items[index], index) };
      } catch (error) {
        results[index] = { status: 'rejected', reason: error };
      }
      completed += 1;
      if (onProgress) onProgress(completed, items.length);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => runWorker()));
  return results;
}

/** CLI argument parser shared with unit tests. Accepts --flag/-Flag/=value forms. */
export function parseCliArgs(argv, defaults = {}) {
  const options = {
    subnet: [],
    port: DEFAULT_PORT,
    scheme: DEFAULT_SCHEME,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    httpTimeoutMs: DEFAULT_HTTP_TIMEOUT_MS,
    concurrency: DEFAULT_CONCURRENCY,
    maxHosts: DEFAULT_MAX_HOSTS,
    discoveryPath: DEFAULT_DISCOVERY_PATH,
    serviceId: DEFAULT_SERVICE_ID,
    json: false,
    quiet: false,
    first: false,
    insecure: false,
    tcpProbe: true,
    includeNetworkAndBroadcast: false,
    includeLinkLocal: false,
    includeLoopback: false,
    verbose: false,
    help: false,
    ...defaults,
  };

  const aliases = {
    s: 'subnet',
    p: 'port',
    j: 'json',
    q: 'quiet',
    f: 'first',
    h: 'help',
    v: 'verbose',
  };
  const booleanTrue = new Set([
    'json', 'quiet', 'first', 'insecure', 'includeNetworkAndBroadcast',
    'includeLinkLocal', 'includeLoopback', 'help', 'verbose', 'https',
  ]);
  const numberKeys = new Set(['port', 'timeoutMs', 'httpTimeoutMs', 'concurrency', 'maxHosts']);
  const positionals = [];

  for (let i = 0; i < argv.length; i++) {
    const raw = String(argv[i]);
    if (!raw.startsWith('-')) {
      positionals.push(raw);
      continue;
    }
    let key = raw.replace(/^-+/, '').toLowerCase();
    let inlineValue;
    const equals = key.indexOf('=');
    if (equals !== -1) {
      inlineValue = key.slice(equals + 1);
      key = key.slice(0, equals);
    }
    // Strip hyphens so --max-hosts, -MaxHosts and --maxhosts are equivalent.
    let compact = key.replace(/-/g, '');
    compact = aliases[compact] || compact;
    // Special cases must be handled before camelCase normalization.
    if (compact === 'notcpprobe') {
      options.tcpProbe = false;
      continue;
    }
    if (compact === 'https') {
      options.scheme = 'https';
      continue;
    }
    // camelCase normalization for PowerShell-style -TimeoutMs / -HttpTimeoutMs.
    const canonical = {
      subnet: 'subnet', port: 'port', scheme: 'scheme', timeoutms: 'timeoutMs',
      httptimeoutms: 'httpTimeoutMs', concurrency: 'concurrency', maxhosts: 'maxHosts',
      discoverypath: 'discoveryPath', serviceid: 'serviceId', json: 'json', quiet: 'quiet',
      first: 'first', insecure: 'insecure',
      includenetworkandbroadcast: 'includeNetworkAndBroadcast',
      includelinklocal: 'includeLinkLocal', includeloopback: 'includeLoopback',
      help: 'help', verbose: 'verbose',
    }[compact] || compact;

    if (booleanTrue.has(canonical)) {
      options[canonical] = true;
      continue;
    }
    let value = inlineValue;
    if (value === undefined) {
      value = argv[++i];
      if (value === undefined || String(value).startsWith('-')) {
        throw new Error(`Missing value for --${canonical}`);
      }
    }
    if (canonical === 'subnet') {
      options.subnet.push(...String(value).split(',').map((s) => s.trim()).filter(Boolean));
    } else if (numberKeys.has(canonical)) {
      const numeric = Number(value);
      if (!Number.isFinite(numeric) || numeric <= 0) throw new Error(`--${canonical} must be a positive number`);
      options[canonical] = Math.floor(numeric);
    } else {
      options[canonical] = String(value);
    }
  }

  if (positionals.length > 0 && options.subnet.length === 0) {
    options.subnet.push(...positionals);
  }
  return options;
}
