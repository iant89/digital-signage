# Digital Signage Studio — Windows LAN Discovery Scanner

A dependency-free command-line tool that finds the **Digital Signage Studio management server** on the local IPv4 network. It works in `cmd.exe`, PowerShell, Windows Terminal, and (because it is plain Node.js) on Linux/macOS too.

## How it works

1. **Enumerate** every local IPv4 subnet from the machine's NICs (or use `--subnet` overrides).
2. **TCP probe** the configured port (default `4000`) concurrently, with a bounded timeout.
3. **Verify** open ports by requesting `GET /api/v1/discovery` and checking the response against the signage service contract (`service = "digital-signage-studio"`, `protocolVersion`, `endpoints.discovery`, `serverTimeUtc`). A random web service on port 4000 is **not** reported as a signage server.
4. **Report** each verified server with its base URL, instance ID, version, latency, WebSocket URL, features, and discovery URL.

The discovery endpoint is deliberately unauthenticated and returns **no secrets** — only service identity and endpoint paths.

## Running on Windows

From the repository root:

```bat
:: cmd.exe — auto-detect local subnets
tools\windows\find-signage-server.cmd

:: cmd.exe — explicit subnet + JSON output
tools\windows\find-signage-server.cmd --subnet 192.168.1.0/24 --port 4000 --json
```

```powershell
# PowerShell — cmdlet-style parameters
.\tools\windows\Find-SignageServer.ps1 -Subnet 192.168.1.0/24 -Json

# Multiple targets and a self-signed HTTPS server
.\tools\windows\Find-SignageServer.ps1 -Subnet "10.0.0.0/24","10.0.1.15" -Https -Insecure -First
```

Or directly with Node.js 18+ (no `npm install` required):

```bat
node tools\network-scanner\find-signage-server.mjs --subnet 192.168.1.0/24 --first
npm run scan:server -- --subnet 192.168.1.0/24 --json
```

## Output modes

| Mode | Flag | Output |
|------|------|--------|
| Human table | *(default)* | Found servers with identity, latency and WebSocket URL. |
| JSON report | `--json` | Structured object: scanned hosts, open ports, elapsed time, subnets, servers, warnings, rejections. |
| Bare URLs | `--quiet` | One `http://host:port` per line (ideal for piping into `Set-Variable` / `for /f`). |

### Example JSON

```json
{
  "service": "digital-signage-studio",
  "scannedHosts": 254,
  "openPorts": 1,
  "elapsedMs": 812,
  "autoDetected": false,
  "subnets": ["192.168.1.0/24"],
  "port": 4000,
  "scheme": "http",
  "discoveryPath": "/api/v1/discovery",
  "warnings": [],
  "servers": [
    {
      "ip": "192.168.1.10",
      "port": 4000,
      "scheme": "http",
      "baseUrl": "http://192.168.1.10:4000",
      "discoveryUrl": "http://192.168.1.10:4000/api/v1/discovery",
      "service": "digital-signage-studio",
      "protocolVersion": 1,
      "instanceId": "srv-1a2b3c4d5e6f7890",
      "displayName": "Digital Signage Studio Management Server",
      "applicationVersion": "1.0.0",
      "serverTimeUtc": "2026-10-26T10:30:00.000Z",
      "secure": false,
      "requiresAuthentication": false,
      "simulated": false,
      "endpoints": { "discovery": "/api/v1/discovery", "overview": "/api/v1/server/overview", "websocket": "/ws" },
      "features": ["network-sync", "package-repository", "fleet-operations"],
      "tcpLatencyMs": 4,
      "httpLatencyMs": 21,
      "totalLatencyMs": 25
    }
  ],
  "rejections": []
}
```

## Arguments

| Argument | Default | Description |
|----------|---------|-------------|
| `--subnet` | auto-detect | CIDR, single IPv4, or `start-end` range. Repeatable / comma-separated. |
| `--port` | `4000` | TCP port to probe. |
| `--scheme` / `--https` | `http` | URL scheme. `--https` implies `--scheme https`. |
| `--timeout-ms` | `400` | TCP connect timeout per host. |
| `--http-timeout-ms` | `2000` | HTTP discovery timeout per open port. |
| `--concurrency` | `96` | Number of parallel probes. |
| `--max-hosts` | `4096` | Safety cap; refuses larger scans instead of flooding the LAN. |
| `--discovery-path` | `/api/v1/discovery` | Discovery endpoint path. |
| `--service-id` | `digital-signage-studio` | Expected service identifier. |
| `--insecure` | off | Skip TLS certificate validation (self-signed lab servers only). |
| `--no-tcp-probe` | off | Skip TCP connect and HTTP-probe every host (slower, useful behind firewalls that drop SYNs). |
| `--include-network-and-broadcast` | off | Also probe `.0` / `.255` for prefixes `< 31`. |
| `--include-link-local` | off | Include `169.254.0.0/16` auto-detected subnets. |
| `--include-loopback` | off | Include `127.0.0.0/8` auto-detected subnets. |
| `--first` | off | Stop after the first verified server (cooperative cancellation). |
| `--json` / `--quiet` / `--verbose` | off | Output control. `--verbose` includes per-host rejection reasons. |
| `-h`, `--help` | — | Print usage. |

PowerShell-style parameter names (`-Subnet`, `-TimeoutMs`, `-HttpTimeoutMs`, `-MaxHosts`, ...) are accepted by the Node CLI as well as by `Find-SignageServer.ps1`.

## Exit codes

| Code | Meaning |
|------|---------|
| `0` | At least one signage server was found. |
| `1` | Scan completed, no signage server found. |
| `2` | Invalid arguments, invalid subnet, or fatal error. |

## Firewall / operations notes

- The server binds to `0.0.0.0:4000` by default (`npm run dev:server`). On Windows, allow **inbound TCP 4000** on the server's network profile (Private/Domain). The scanner only needs outbound TCP.
- If the server is behind a reverse proxy on `443`, use `--https --port 443` (and `--insecure` only for self-signed certs).
- Link-local (`169.254.x.x`) subnets are skipped by default to avoid noise from APIPA and virtual adapters; enable with `--include-link-local`.
- Large flat networks: the scanner refuses subnets above `--max-hosts` rather than sending tens of thousands of probes. Narrow to `/24` ranges or raise the cap deliberately.
- The scanner is IPv4-only by design. IPv6 literals are still handled correctly when building URLs, but auto-discovery enumerates IPv4 subnets.

## Server-side contract

`GET /api/v1/discovery` is implemented in `server/app.ts` and mirrored in `src/services/staticServerSimulator.ts` for static GitHub Pages parity. Constants live in `SIGNAGE_DISCOVERY_SERVICE_ID` / `SIGNAGE_DISCOVERY_PROTOCOL_VERSION`. See `docs/architecture.md` §5 for the full descriptor.
