#!/usr/bin/env node
// ============================================================================
// tools/network-scanner/find-signage-server.mjs
// Dependency-free Windows/Cross-Platform CLI LAN scanner for the Digital
// Signage Studio management server.
//
//   1. Enumerate local IPv4 subnets (or --subnet overrides).
//   2. Concurrently TCP-probe the configured port (default 4000).
//   3. GET /api/v1/discovery on open ports and verify the service contract.
//   4. Print found servers as a table, JSON, or bare base URLs.
//
// Exit codes: 0 = found, 1 = not found, 2 = invalid arguments / fatal error.
// ============================================================================

import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import process from 'node:process';
import {
  DEFAULT_CONCURRENCY,
  DEFAULT_DISCOVERY_PATH,
  DEFAULT_HTTP_TIMEOUT_MS,
  DEFAULT_MAX_HOSTS,
  DEFAULT_PORT,
  DEFAULT_SCHEME,
  DEFAULT_SERVICE_ID,
  DEFAULT_TIMEOUT_MS,
  buildBaseUrl,
  buildDiscoveryUrl,
  getLocalIpv4Networks,
  isSignageDiscovery,
  mapWithConcurrency,
  normalizeTargets,
  parseCliArgs,
  parseCidr,
  resolveScanTargets,
} from './discovery-core.mjs';

const USAGE = `
Digital Signage Studio — LAN Server Scanner
==========================================

Usage (Windows cmd):
  tools\\windows\\find-signage-server.cmd [options]
  tools\\windows\\Find-SignageServer.ps1 -Subnet 192.168.1.0/24 -Json

Usage (cross-platform, Node 18+):
  node tools/network-scanner/find-signage-server.mjs [options]
  npm run scan:server -- --subnet 192.168.1.0/24

Options:
  --subnet <cidr|ip|range>   One or more targets. Repeatable or comma-separated.
                             Default: auto-detect every local IPv4 subnet.
  --port <n>                 TCP port to probe (default ${DEFAULT_PORT}).
  --scheme <http|https>      URL scheme (default ${DEFAULT_SCHEME}); --https is an alias.
  --timeout-ms <n>           TCP connect timeout (default ${DEFAULT_TIMEOUT_MS}).
  --http-timeout-ms <n>      HTTP discovery timeout (default ${DEFAULT_HTTP_TIMEOUT_MS}).
  --concurrency <n>          Parallel probes (default ${DEFAULT_CONCURRENCY}).
  --max-hosts <n>            Refuse scans larger than this (default ${DEFAULT_MAX_HOSTS}).
  --discovery-path <path>    Discovery endpoint (default ${DEFAULT_DISCOVERY_PATH}).
  --service-id <id>          Expected service id (default ${DEFAULT_SERVICE_ID}).
  --https                    Shortcut for --scheme https.
  --insecure                 Skip TLS certificate validation (lab/self-signed only).
  --no-tcp-probe             Skip the TCP connect step; HTTP-probe every host.
  --include-network-and-broadcast
                             Also probe .0 / .255 addresses for prefixes < 31.
  --include-link-local        Include 169.254.0.0/16 auto-detected subnets.
  --include-loopback          Include 127.0.0.0/8 auto-detected subnets.
  --first                     Stop as soon as one verified server is found.
  --json                      Emit a structured JSON report.
  --quiet                     Emit only discovered base URLs (one per line).
  --verbose                   Show per-host rejection reasons.
  -h, --help                  Show this help.

Aliases: -s/--subnet, -p/--port, -j/--json, -q/--quiet, -f/--first.
PowerShell-style -Subnet / -TimeoutMs / -HttpTimeoutMs are also accepted.

Exit codes: 0 = at least one server found, 1 = none found, 2 = invalid usage.

Examples:
  find-signage-server.cmd --subnet 192.168.1.0/24 --port 4000
  Find-SignageServer.ps1 -Subnet "10.0.0.0/24","10.0.1.15" -Json
  node find-signage-server.mjs --subnet 127.0.0.1/32 --first --quiet
`;

/** Resolve true when a TCP connection to host:port succeeds within timeoutMs. */
function probeTcp(host, port, timeoutMs) {
  const started = Date.now();
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const finish = (open, error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ open, rttMs: Date.now() - started, error });
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false, 'timeout'));
    socket.once('error', (error) => finish(false, error && error.code ? error.code : String(error)));
    try {
      socket.connect(port, host);
    } catch (error) {
      finish(false, String(error));
    }
  });
}

/** Fetch and parse a JSON discovery document with a hard timeout + size cap. */
function httpGetJson(urlString, timeoutMs, insecure) {
  return new Promise((resolve, reject) => {
    let url;
    try {
      url = new URL(urlString);
    } catch (error) {
      reject(new Error(`Invalid discovery URL: ${urlString}`));
      return;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      reject(new Error(`Unsupported URL scheme: ${url.protocol}`));
      return;
    }
    const transport = url.protocol === 'https:' ? https : http;
    const started = Date.now();
    let settled = false;
    const done = (error, value) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve(value);
    };

    const request = transport.request(
      url,
      {
        method: 'GET',
        timeout: timeoutMs,
        rejectUnauthorized: !insecure,
        headers: {
          Accept: 'application/json',
          'User-Agent': 'DigitalSignageScanner/1.0',
          Connection: 'close',
        },
      },
      (response) => {
        const status = response.statusCode || 0;
        if (status < 200 || status >= 300) {
          response.resume();
          done(new Error(`HTTP ${status}`));
          return;
        }
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          body += chunk;
          if (body.length > 65_536) {
            request.destroy(new Error('Discovery response too large'));
          }
        });
        response.on('end', () => {
          try {
            done(null, { payload: JSON.parse(body), status, rttMs: Date.now() - started });
          } catch {
            done(new Error('Discovery response was not valid JSON'));
          }
        });
        response.on('error', (error) => done(error));
      }
    );
    request.on('timeout', () => request.destroy(new Error('HTTP timeout')));
    request.on('error', (error) => done(error));
    request.end();
  });
}

function progressLine(done, total, portHits, found) {
  process.stderr.write(
    `\r  Scanned ${done}/${total} hosts · ${portHits} open port(s) · ${found} signage server(s)   `
  );
}

async function runScan(options) {
  const started = Date.now();
  const detectedNetworks = getLocalIpv4Networks({
    includeLinkLocal: options.includeLinkLocal,
    includeLoopback: options.includeLoopback,
  });
  const resolved = resolveScanTargets(options, detectedNetworks);
  const subnetSpecs = resolved.specs;
  const warnings = resolved.warnings;
  const autoDetected = resolved.autoDetected;

  const hosts = normalizeTargets(subnetSpecs, {
    maxHosts: options.maxHosts,
    includeNetworkAndBroadcast: options.includeNetworkAndBroadcast,
  });
  if (hosts.length === 0) throw new Error('No host addresses were generated from the supplied subnets.');
  if (hosts.length > options.maxHosts) {
    throw new Error(
      `Scan would cover ${hosts.length} hosts, exceeding --max-hosts ${options.maxHosts}. ` +
        'Narrow the subnet or raise --max-hosts.'
    );
  }

  const normalizedSubnets = subnetSpecs.map((spec) => {
    try {
      return parseCidr(String(spec)).cidr;
    } catch {
      return String(spec);
    }
  });

  const showProgress = !options.json && !options.quiet;
  const signal = { aborted: false };
  const servers = [];
  const rejections = [];
  let portHits = 0;

  await mapWithConcurrency(
    hosts,
    options.concurrency,
    async (host) => {
      if (signal.aborted) return;
      let tcpLatencyMs = null;
      if (options.tcpProbe) {
        const probe = await probeTcp(host, options.port, options.timeoutMs);
        if (!probe.open) return;
        tcpLatencyMs = probe.rttMs;
        portHits += 1;
      }

      const discoveryUrl = buildDiscoveryUrl(host, options.port, options.scheme, options.discoveryPath);
      let response;
      try {
        response = await httpGetJson(discoveryUrl, options.httpTimeoutMs, options.insecure);
      } catch (error) {
        if (!options.tcpProbe) portHits += 1;
        rejections.push({ host, reason: error instanceof Error ? error.message : String(error) });
        return;
      }
      if (!options.tcpProbe) portHits += 1;

      const check = isSignageDiscovery(response.payload, options.serviceId);
      if (!check.ok) {
        rejections.push({ host, reason: check.reason });
        return;
      }

      servers.push({
        ...check.server,
        // The scanned address/port are authoritative: a server may advertise a
        // different Host header, a reverse-proxy name, or a default port.
        ip: host,
        port: options.port,
        scheme: options.scheme,
        baseUrl: buildBaseUrl(host, options.port, options.scheme),
        discoveryUrl,
        tcpLatencyMs,
        httpLatencyMs: response.rttMs,
        totalLatencyMs: (tcpLatencyMs ?? 0) + response.rttMs,
      });
      if (options.first) signal.aborted = true;
    },
    {
      signal,
      onProgress: showProgress
        ? (done, total) => progressLine(done, total, portHits, servers.length)
        : undefined,
    }
  );

  if (showProgress) process.stderr.write('\n');
  servers.sort((a, b) => a.totalLatencyMs - b.totalLatencyMs || a.ip.localeCompare(b.ip));

  return {
    service: options.serviceId,
    scannedHosts: hosts.length,
    openPorts: portHits,
    elapsedMs: Date.now() - started,
    autoDetected,
    subnets: normalizedSubnets,
    port: options.port,
    scheme: options.scheme,
    discoveryPath: options.discoveryPath,
    warnings,
    servers,
    rejections: options.verbose ? rejections : rejections.slice(0, 5),
  };
}

function printHumanReport(report) {
  for (const warning of report.warnings) process.stderr.write(`[WARN] ${warning}\n`);
  if (report.servers.length === 0) {
    process.stderr.write(
      `\nNo ${report.service} server found on ${report.scannedHosts} host(s) ` +
        `(${report.subnets.join(', ')}) at ${report.scheme} port ${report.port}.\n`
    );
    process.stderr.write(
      'Hints: confirm the server is running (npm run dev:server), check Windows Firewall inbound TCP 4000, ' +
        'or pass --subnet 192.168.1.0/24.\n'
    );
    return;
  }
  process.stdout.write(`\nFound ${report.servers.length} signage server(s) in ${report.elapsedMs} ms:\n\n`);
  for (const server of report.servers) {
    process.stdout.write(`  ${server.baseUrl}\n`);
    process.stdout.write(`    Display Name : ${server.displayName}\n`);
    process.stdout.write(`    Instance ID  : ${server.instanceId}\n`);
    process.stdout.write(
      `    Version      : ${server.applicationVersion} (protocol ${server.protocolVersion}${server.simulated ? ', simulated' : ''})\n`
    );
    process.stdout.write(`    Server Time  : ${server.serverTimeUtc}\n`);
    process.stdout.write(
      `    Latency      : ${server.tcpLatencyMs === null ? 'n/a' : `${server.tcpLatencyMs} ms TCP`} / ${server.httpLatencyMs} ms HTTP\n`
    );
    process.stdout.write(`    WebSocket    : ${server.scheme === 'https' ? 'wss' : 'ws'}://${server.ip}:${server.port}/ws\n`);
    if (server.features.length) process.stdout.write(`    Features     : ${server.features.join(', ')}\n`);
    process.stdout.write(`    Discovery    : ${server.discoveryUrl}\n\n`);
  }
}

async function main(argv) {
  let options;
  try {
    options = parseCliArgs(argv);
  } catch (error) {
    process.stderr.write(`[ERROR] ${error instanceof Error ? error.message : String(error)}\n`);
    process.stderr.write(USAGE);
    process.exitCode = 2;
    return;
  }

  if (options.help) {
    process.stdout.write(USAGE);
    process.exitCode = 0;
    return;
  }
  if (options.scheme !== 'http' && options.scheme !== 'https') {
    process.stderr.write(`[ERROR] --scheme must be http or https (got "${options.scheme}").\n`);
    process.exitCode = 2;
    return;
  }

  let report;
  try {
    report = await runScan(options);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (options.json) process.stdout.write(`${JSON.stringify({ error: message }, null, 2)}\n`);
    else process.stderr.write(`[ERROR] ${message}\n`);
    process.exitCode = 2;
    return;
  }

  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else if (options.quiet) {
    for (const server of report.servers) process.stdout.write(`${server.baseUrl}\n`);
  } else {
    printHumanReport(report);
  }
  process.exitCode = report.servers.length > 0 ? 0 : 1;
}

await main(process.argv.slice(2));
