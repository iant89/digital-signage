# Digital Signage Studio — Security Model

## 1. Threat Model

Digital Signage systems operate unattended in public or semi-public environments and receive content packages over networks or removable media. Primary threats include:
1. **Malformed / Malicious `.signage` Archives**: Decompression bombs, integer overflows, path traversal (`../`), corrupted media, and unauthorized scripts.
2. **Physical Kiosk Tampering**: Spectators attempting to exit full-screen playback, access the underlying OS, or modify display settings.
3. **Unauthorized Network Commands**: Replay attacks, spoofed player enrollment, or unauthorized group deployments.
4. **Sensitive Data Leakage**: Diagnostic logs exposing tokens, credentials, or private feed URLs.

---

## 2. Security Controls

### 2.1 Binary Archive Hardening
- Strict 64-bit bounds checking on `directoryOffset`, `directoryLength`, and every entry's `dataOffset + storedLength`.
- Decompression streams enforce per-entry (`maxSingleEntryBytes`) and total archive (`maxTotalUncompressedBytes`) byte ceilings before allocation.
- SHA-256 verification on every entry read.
- Optional publisher signature verification over the canonical manifest and entry directory hashes.

### 2.2 Script Sandbox Containment
- Zero use of `eval()` or `new Function()` on package scripts.
- Declarative, capability-gated script execution with per-tick instruction limits (`<= 500` ops) and state key limits.
- Mandatory permission review during package import.

### 2.3 Device Enrollment & Network Authentication
- Single-use, time-expiring enrollment codes for player registration.
- Unique per-device bearer credentials that can be individually revoked without affecting other displays.
- Role-Based Access Control (`admin`, `operator`, `viewer`, `device`) enforced on all management endpoints.

### 2.4 Command Integrity & Replay Protection
- Every remote command carries a unique `id`, `idempotencyKey`, `createdAt`, and `expiresAt`.
- Players reject expired commands or duplicate idempotency keys and never restart sessions that have already ended.
- Every administrative action and authorization failure is recorded in `audit_log`.

### 2.5 Fleet Telemetry, Backups & Retention (Phase 15)
- **Untrusted telemetry**: Playback and heartbeat batches are size-limited, validated, clamped and de-duplicated by idempotency key before storage. Unknown device IDs are rejected, and all numeric fields are finite-number checked.
- **RBAC separation**: Devices may ingest their own telemetry; operators may read summaries and alerts; only admins may edit alert rules, create or restore backups, and apply retention. All mutations are written to `audit_log`.
- **Secret-redacted backups**: `buildBackupArchive` excludes `users` and `device_credentials` tables entirely and redacts any key matching `password|token|secret|credential|api_key|private_key|authorization`. Rows and table names are canonically sorted so checksums are deterministic.
- **Tamper-proof restore**: `verifyBackupArchive` recomputes all per-table SHA-256 checksums and the manifest checksum (which includes `createdAtUtc`, `retentionDays` and table hashes). Restore is refused with `INTEGRITY_CHECK_FAILED` on any mismatch, is transactional, and targets only `playback_events`, `health_samples`, `alert_rules` and `fleet_alerts` with fixed column whitelists.
- **Audit retention**: `applyRetention` enforces configurable maximum age and row count across playback events, health samples, alerts, events and the audit log, pinning active alerts so operators never lose an unresolved incident.

### 2.6 LAN Discovery Exposure (Phase 16)
- **Identity-only endpoint**: `GET /api/v1/discovery` is intentionally unauthenticated so players/technicians can find the server before credentials are provisioned. It returns only the service id, protocol version, a stable instance fingerprint, display name/version, UTC time, scheme/host/port, endpoint paths and capability flags — no tokens, credentials, device records or audit data.
- **Strict client verification**: `tools/network-scanner` rejects any response whose `service`, `protocolVersion`, `serverTimeUtc` or `endpoints.discovery` do not match the contract, preventing spoofed/decoy services on port 4000 from being trusted.
- **Bounded scanning**: the CLI enforces a `--max-hosts` cap, per-host TCP/HTTP timeouts and bounded concurrency, so discovery cannot be abused as an accidental LAN flood. Link-local subnets are excluded by default.
- **TLS**: HTTPS probes validate certificates by default; `--insecure` exists only for self-signed lab setups and should never be used in production provisioning. Operators should still confirm the discovered `instanceId` / `baseUrl` before writing it into kiosk configuration.
