// ============================================================================
// @packages/fleet-operations — Proof-of-Play, Fleet Health Telemetry,
// Deterministic Alert Rules, Verified Backups & Data Retention
//
// Phase 15. Pure TypeScript: no React, no Node.js APIs, no DOM globals.
// Runs identically in the Fastify server, the Vite browser bundle, Web
// Workers and Vitest. (Architectural Rules 1–3.)
// ============================================================================

import { clamp, sha256Hex, stringToBytes } from '@packages/shared';

// ---------------------------------------------------------------------------
// 1. Types
// ---------------------------------------------------------------------------

export type FleetHealthState = 'HEALTHY' | 'DEGRADED' | 'CRITICAL' | 'OFFLINE';
export type AlertSeverity = 'INFO' | 'WARNING' | 'CRITICAL';
export type AlertState = 'ACTIVE' | 'ACKNOWLEDGED';

export type AlertRuleType =
  | 'DEVICE_OFFLINE'
  | 'HEARTBEAT_STALE'
  | 'PLAYBACK_STALLED'
  | 'CLOCK_DRIFT'
  | 'LOW_FPS'
  | 'COMMAND_FAILURES';

export interface PlaybackEvent {
  eventId?: string;
  deviceId: string;
  sceneId: string;
  packageId?: string;
  /** ISO-8601 UTC timestamp (epoch milliseconds are also accepted). */
  startedAtUtc: string | number;
  /** Actually displayed duration, in milliseconds. */
  durationMs: number;
  /** 0..1 — fraction of the authored scene duration that was displayed. */
  completionRatio?: number;
  /** True when the player buffered the event while offline. */
  offlineRecorded?: boolean;
}

export interface NormalizedPlaybackEvent {
  eventId: string;
  deviceId: string;
  sceneId: string;
  packageId: string;
  startedAtUtc: string;
  startMs: number;
  endMs: number;
  durationMs: number;
  completionRatio: number;
  offlineRecorded: boolean;
}

export interface NormalizedPlaybackBatch {
  events: NormalizedPlaybackEvent[];
  rejected: Array<{ index: number; reason: string }>;
  duplicates: number;
  clamped: number;
}

export type ProofOfPlayGroupBy = 'scene' | 'device-scene' | 'device' | 'day';

export interface ProofOfPlayRow {
  key: string;
  deviceId: string;
  sceneId: string;
  packageId: string;
  dayUtc: string;
  plays: number;
  /** Sum of displayed durations (may double-count overlapping reports). */
  dwellMs: number;
  /** De-duplicated, non-overlapping display time per device. */
  coverageMs: number;
  avgCompletionRatio: number;
  firstPlayedAtUtc: string;
  lastPlayedAtUtc: string;
}

export interface ProofOfPlaySummary {
  fromUtc: string | null;
  toUtc: string | null;
  groupBy: ProofOfPlayGroupBy;
  rows: ProofOfPlayRow[];
  daily: Array<{ dayUtc: string; plays: number; dwellMs: number; coverageMs: number }>;
  totals: {
    plays: number;
    dwellMs: number;
    coverageMs: number;
    uniqueDevices: number;
    uniqueScenes: number;
    avgCompletionRatio: number;
    offlineEvents: number;
  };
}

export interface DeviceTelemetry {
  deviceId: string;
  name?: string;
  lastSeenAtUtc?: string;
  status?: string;
  playbackState?: string;
  driftMs?: number;
  estimatedFps?: number;
  errorCount?: number;
  commandFailures?: number;
  clockUncertaintyMs?: number;
  currentPackageId?: string;
  currentSceneId?: string;
}

export interface HealthSample {
  sampleId: string;
  deviceId: string;
  recordedAtUtc: string;
  playbackState: string;
  status: string;
  driftMs: number;
  estimatedFps: number;
  errorCount: number;
  clockUncertaintyMs: number;
  currentSceneId?: string;
  currentPackageId?: string;
}

export interface FleetHealthThresholds {
  staleHeartbeatMs: number;
  offlineMs: number;
  driftWarningMs: number;
  driftCriticalMs: number;
  minFps: number;
  maxErrorCount: number;
  maxCommandFailures: number;
}

export interface AlertRule {
  id: string;
  type: AlertRuleType;
  /** Units depend on type: minutes, seconds, count, ms drift, or FPS. */
  threshold: number;
  severity: AlertSeverity;
  enabled: boolean;
  cooldownMinutes: number;
  description: string;
}

export interface FleetAlert {
  id: string;
  ruleId: string;
  ruleType: AlertRuleType;
  deviceId: string;
  deviceName: string;
  severity: AlertSeverity;
  state: AlertState;
  message: string;
  value: number;
  threshold: number;
  triggeredAtUtc: string;
  acknowledgedAtUtc?: string;
  acknowledgedBy?: string;
  fingerprint: string;
}

export interface DeviceHealthSnapshot {
  deviceId: string;
  name: string;
  state: FleetHealthState;
  staleMs: number;
  lastSeenAtUtc: string;
  playbackState: string;
  driftMs: number;
  estimatedFps: number;
  commandFailures: number;
  reasons: string[];
  activeAlertIds: string[];
}

export interface FleetHealthReport {
  generatedAtUtc: string;
  devices: DeviceHealthSnapshot[];
  alerts: FleetAlert[];
  totals: {
    total: number;
    healthy: number;
    degraded: number;
    critical: number;
    offline: number;
    activeAlerts: number;
    criticalAlerts: number;
    averageFps: number;
    maxDriftMs: number;
    uptimePercent: number;
  };
}

export interface BackupTableSnapshot {
  name: string;
  rows: Array<Record<string, unknown>>;
}

export interface BackupManifest {
  formatVersion: 1;
  backupId: string;
  createdAtUtc: string;
  createdBy: string;
  retentionDays: number;
  expiresAtUtc: string;
  tables: Array<{ name: string; rowCount: number; checksum: string }>;
  checksum: string;
}

export interface BackupArchive {
  manifest: BackupManifest;
  tables: BackupTableSnapshot[];
}

export interface BackupVerification {
  valid: boolean;
  errors: string[];
  computedChecksum: string;
}

// ---------------------------------------------------------------------------
// 2. Constants & deterministic helpers
// ---------------------------------------------------------------------------

export const DEFAULT_HEALTH_THRESHOLDS: FleetHealthThresholds = {
  staleHeartbeatMs: 60_000,
  offlineMs: 180_000,
  driftWarningMs: 250,
  driftCriticalMs: 1_000,
  minFps: 24,
  maxErrorCount: 0,
  maxCommandFailures: 1,
};

export const DEFAULT_ALERT_RULES: AlertRule[] = [
  {
    id: 'rule-device-offline',
    type: 'DEVICE_OFFLINE',
    threshold: 3,
    severity: 'CRITICAL',
    enabled: true,
    cooldownMinutes: 15,
    description: 'Device has not been seen for N minutes.',
  },
  {
    id: 'rule-heartbeat-stale',
    type: 'HEARTBEAT_STALE',
    threshold: 60,
    severity: 'WARNING',
    enabled: true,
    cooldownMinutes: 10,
    description: 'Heartbeat older than N seconds.',
  },
  {
    id: 'rule-playback-stalled',
    type: 'PLAYBACK_STALLED',
    threshold: 1,
    severity: 'CRITICAL',
    enabled: true,
    cooldownMinutes: 10,
    description: 'Player reported a stalled or errored playback state.',
  },
  {
    id: 'rule-clock-drift',
    type: 'CLOCK_DRIFT',
    threshold: 250,
    severity: 'WARNING',
    enabled: true,
    cooldownMinutes: 10,
    description: 'Absolute NTP/session drift exceeded N milliseconds.',
  },
  {
    id: 'rule-low-fps',
    type: 'LOW_FPS',
    threshold: 24,
    severity: 'WARNING',
    enabled: true,
    cooldownMinutes: 15,
    description: 'Renderer frame rate dropped below N FPS.',
  },
  {
    id: 'rule-command-failures',
    type: 'COMMAND_FAILURES',
    threshold: 3,
    severity: 'WARNING',
    enabled: true,
    cooldownMinutes: 30,
    description: 'Device accumulated N failed or rejected commands.',
  },
];

const SECRET_KEY_PATTERN = /password|passwd|secret|token|credential|api[_-]?key|private[_-]?key|authorization/i;
// Credentials can also be embedded inside free-form JSON payload columns.
const SECRET_VALUE_PATTERN = /(devtok_|sk-[A-Za-z0-9_-]{8,}|Bearer\s+[\w.-]+|ApexAdmin!2026|ApexOperator!2026|ENROLL-[A-Z0-9-]{4,})/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown, fallback = 0): number {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : fallback;
}

/** Parse an ISO-8601 UTC string or epoch milliseconds. Returns NaN on failure. */
export function parseUtcTime(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 1e11 ? value : value * 1000;
  }
  if (typeof value === 'string' && value.trim()) {
    const trimmed = value.trim();
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) return parseUtcTime(Number(trimmed));
    const parsed = Date.parse(trimmed);
    return Number.isFinite(parsed) ? parsed : Number.NaN;
  }
  return Number.NaN;
}

export function utcDayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .filter((k) => value[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

function mergeIntervalMs(intervals: Array<[number, number]>): number {
  if (intervals.length === 0) return 0;
  const sorted = [...intervals].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let total = 0;
  let [start, end] = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    const [nextStart, nextEnd] = sorted[i];
    if (nextStart <= end) {
      end = Math.max(end, nextEnd);
    } else {
      total += end - start;
      start = nextStart;
      end = nextEnd;
    }
  }
  return total + (end - start);
}

// ---------------------------------------------------------------------------
// 3. Proof-of-play ingestion & aggregation
// ---------------------------------------------------------------------------

/**
 * Validate, clamp, de-duplicate and chronologically sort untrusted playback
 * reports. Players may upload the same offline-buffered batch repeatedly
 * after a WAN outage, so `eventId` is the idempotency key.
 */
export function normalizePlaybackEvents(
  raw: unknown,
  options: { nowMs?: number; maxDurationMs?: number; futureToleranceMs?: number } = {}
): NormalizedPlaybackBatch {
  const nowMs = options.nowMs ?? Date.now();
  const maxDurationMs = options.maxDurationMs ?? 6 * 60 * 60_000;
  const futureToleranceMs = options.futureToleranceMs ?? 5 * 60_000;
  const list: unknown[] = Array.isArray(raw)
    ? raw
    : isRecord(raw) && Array.isArray(raw.events)
      ? (raw.events as unknown[])
      : [];

  const events: NormalizedPlaybackEvent[] = [];
  const rejected: Array<{ index: number; reason: string }> = [];
  const seen = new Set<string>();
  let duplicates = 0;
  let clamped = 0;

  list.forEach((item, index) => {
    if (!isRecord(item)) {
      rejected.push({ index, reason: 'Event must be an object.' });
      return;
    }
    const deviceId = typeof item.deviceId === 'string' ? item.deviceId.trim() : '';
    const sceneId = typeof item.sceneId === 'string' ? item.sceneId.trim() : '';
    const startMs = parseUtcTime(item.startedAtUtc);
    if (!deviceId || !sceneId) {
      rejected.push({ index, reason: 'Missing deviceId or sceneId.' });
      return;
    }
    if (deviceId.length > 128 || sceneId.length > 128) {
      rejected.push({ index, reason: 'Identifier exceeds 128 characters.' });
      return;
    }
    if (!Number.isFinite(startMs)) {
      rejected.push({ index, reason: 'Invalid startedAtUtc timestamp.' });
      return;
    }
    if (startMs > nowMs + futureToleranceMs) {
      rejected.push({ index, reason: 'Playback event is in the future.' });
      return;
    }
    const rawDuration = Math.round(finiteNumber(item.durationMs, Number.NaN));
    if (!Number.isFinite(rawDuration) || rawDuration <= 0) {
      rejected.push({ index, reason: 'durationMs must be a positive number.' });
      return;
    }
    const durationMs = Math.round(clamp(rawDuration, 1, maxDurationMs));
    if (durationMs !== rawDuration) clamped += 1;

    const packageId = typeof item.packageId === 'string' ? item.packageId.trim().slice(0, 128) : '';
    const suppliedId = typeof item.eventId === 'string' ? item.eventId.trim() : '';
    const fingerprint = `${deviceId}|${sceneId}|${packageId}|${Math.round(startMs)}|${durationMs}`;
    const eventId = (suppliedId || `pop-${sha256Hex(fingerprint).slice(0, 24)}`).slice(0, 128);
    if (seen.has(eventId)) {
      duplicates += 1;
      return;
    }
    seen.add(eventId);

    // Only the player knows whether an event was buffered during a WAN outage;
    // old timestamps alone are not evidence of offline reporting.
    const offlineRecorded = item.offlineRecorded === true;
    events.push({
      eventId,
      deviceId,
      sceneId,
      packageId,
      startedAtUtc: new Date(startMs).toISOString(),
      startMs,
      endMs: startMs + durationMs,
      durationMs,
      completionRatio: clamp(finiteNumber(item.completionRatio, 1), 0, 1),
      offlineRecorded,
    });
  });

  events.sort((a, b) => a.startMs - b.startMs || a.eventId.localeCompare(b.eventId));
  return { events, rejected, duplicates, clamped };
}

/** Convert a normalized event back into a portable wire/DB record. */
export function playbackEventToWire(event: NormalizedPlaybackEvent): PlaybackEvent {
  return {
    eventId: event.eventId,
    deviceId: event.deviceId,
    sceneId: event.sceneId,
    packageId: event.packageId,
    startedAtUtc: event.startedAtUtc,
    durationMs: event.durationMs,
    completionRatio: event.completionRatio,
    offlineRecorded: event.offlineRecorded,
  };
}

export interface ProofOfPlayOptions {
  fromUtc?: string | number;
  toUtc?: string | number;
  groupBy?: ProofOfPlayGroupBy;
  nowMs?: number;
  maxDurationMs?: number;
}

/**
 * Deterministic proof-of-play aggregation. Overlapping reports from a single
 * device are merged into `coverageMs` so impressions are never double-counted
 * (e.g. a re-sent offline batch or a looping scene with overlapping clocks).
 */
export function aggregateProofOfPlay(
  rawEvents: unknown,
  options: ProofOfPlayOptions = {}
): ProofOfPlaySummary {
  const nowMs = options.nowMs ?? Date.now();
  const groupBy = options.groupBy ?? 'scene';
  const fromMs = options.fromUtc === undefined ? Number.NEGATIVE_INFINITY : parseUtcTime(options.fromUtc);
  const toMs = options.toUtc === undefined ? Number.POSITIVE_INFINITY : parseUtcTime(options.toUtc);
  const normalized = normalizePlaybackEvents(rawEvents, { nowMs, maxDurationMs: options.maxDurationMs });

  interface Accumulator {
    key: string;
    deviceId: string;
    sceneId: string;
    packageId: string;
    dayUtc: string;
    plays: number;
    dwellMs: number;
    ratioWeightedMs: number;
    firstMs: number;
    lastMs: number;
  }
  const groups = new Map<string, Accumulator>();
  const dailyMap = new Map<string, { dayUtc: string; plays: number; dwellMs: number }>();
  const coverageMap = new Map<string, Array<[number, number]>>();
  const fleetCoverageMap = new Map<string, Array<[number, number]>>();
  const allDevices = new Set<string>();
  const allScenes = new Set<string>();
  let totalPlays = 0;
  let totalDwellMs = 0;
  let totalRatioWeightedMs = 0;
  let offlineEvents = 0;

  for (const event of normalized.events) {
    const clippedStart = Math.max(event.startMs, fromMs);
    const clippedEnd = Math.min(event.endMs, toMs);
    const clippedMs = Math.max(0, clippedEnd - clippedStart);
    if (clippedMs <= 0 || event.startMs >= event.endMs) continue;

    const dayUtc = utcDayKey(event.startMs);
    const parts: Record<ProofOfPlayGroupBy, string[]> = {
      scene: [event.sceneId],
      'device-scene': [event.deviceId, event.sceneId],
      device: [event.deviceId],
      day: [dayUtc],
    };
    const key = parts[groupBy].join('|');
    let acc = groups.get(key);
    if (!acc) {
      acc = {
        key,
        deviceId: groupBy === 'device' || groupBy === 'device-scene' ? event.deviceId : '*',
        sceneId: groupBy === 'scene' || groupBy === 'device-scene' ? event.sceneId : '*',
        packageId: '*',
        dayUtc: groupBy === 'day' ? dayUtc : '*',
        plays: 0,
        dwellMs: 0,
        ratioWeightedMs: 0,
        firstMs: clippedStart,
        lastMs: clippedEnd,
      };
      groups.set(key, acc);
    }
    acc.plays += 1;
    acc.dwellMs += clippedMs;
    acc.ratioWeightedMs += clippedMs * event.completionRatio;
    acc.firstMs = Math.min(acc.firstMs, clippedStart);
    acc.lastMs = Math.max(acc.lastMs, clippedEnd);

    const coverageKey = `${event.deviceId}|${key}`;
    const intervals = coverageMap.get(coverageKey) ?? [];
    intervals.push([clippedStart, clippedEnd]);
    coverageMap.set(coverageKey, intervals);
    const fleetIntervals = fleetCoverageMap.get(event.deviceId) ?? [];
    fleetIntervals.push([clippedStart, clippedEnd]);
    fleetCoverageMap.set(event.deviceId, fleetIntervals);

    const daily = dailyMap.get(dayUtc) ?? { dayUtc, plays: 0, dwellMs: 0 };
    daily.plays += 1;
    daily.dwellMs += clippedMs;
    dailyMap.set(dayUtc, daily);

    allDevices.add(event.deviceId);
    allScenes.add(event.sceneId);
    totalPlays += 1;
    totalDwellMs += clippedMs;
    totalRatioWeightedMs += clippedMs * event.completionRatio;
    if (event.offlineRecorded) offlineEvents += 1;
  }

  const coverageByGroup = new Map<string, number>();
  for (const [coverageKey, intervals] of coverageMap) {
    const key = coverageKey.slice(coverageKey.indexOf('|') + 1);
    coverageByGroup.set(key, (coverageByGroup.get(key) ?? 0) + mergeIntervalMs(intervals));
  }

  const rows: ProofOfPlayRow[] = [...groups.values()]
    .map((acc) => ({
      key: acc.key,
      deviceId: acc.deviceId,
      sceneId: acc.sceneId,
      packageId: acc.packageId,
      dayUtc: acc.dayUtc,
      plays: acc.plays,
      dwellMs: Math.round(acc.dwellMs),
      coverageMs: Math.round(coverageByGroup.get(acc.key) ?? 0),
      avgCompletionRatio: acc.dwellMs > 0 ? acc.ratioWeightedMs / acc.dwellMs : 0,
      firstPlayedAtUtc: new Date(acc.firstMs).toISOString(),
      lastPlayedAtUtc: new Date(acc.lastMs).toISOString(),
    }))
    .sort((a, b) => b.dwellMs - a.dwellMs || a.key.localeCompare(b.key));

  const daily = [...dailyMap.values()]
    .map((d) => ({ ...d, dwellMs: Math.round(d.dwellMs), coverageMs: 0 }))
    .sort((a, b) => a.dayUtc.localeCompare(b.dayUtc));
  for (const day of daily) {
    const dayStart = Date.parse(`${day.dayUtc}T00:00:00.000Z`);
    // Coverage is per-device: overlapping reports from different displays must
    // be added, not merged away. Clip each interval to the UTC day window.
    const intervalsByDevice = new Map<string, Array<[number, number]>>();
    for (const event of normalized.events) {
      const start = Math.max(event.startMs, fromMs, dayStart);
      const end = Math.min(event.endMs, toMs, dayStart + 86_400_000);
      if (end <= start) continue;
      const list = intervalsByDevice.get(event.deviceId) ?? [];
      list.push([start, end]);
      intervalsByDevice.set(event.deviceId, list);
    }
    let coverage = 0;
    for (const list of intervalsByDevice.values()) coverage += mergeIntervalMs(list);
    day.coverageMs = Math.round(Math.min(day.dwellMs, coverage));
  }

  // Fleet-wide coverage merges ALL scenes per device, so a re-sent offline
  // batch can never inflate total display time (one screen = one timeline).
  let totalCoverage = 0;
  for (const intervals of fleetCoverageMap.values()) totalCoverage += mergeIntervalMs(intervals);
  return {
    fromUtc: Number.isFinite(fromMs) ? new Date(fromMs).toISOString() : null,
    toUtc: Number.isFinite(toMs) ? new Date(toMs).toISOString() : null,
    groupBy,
    rows,
    daily,
    totals: {
      plays: totalPlays,
      dwellMs: Math.round(totalDwellMs),
      coverageMs: Math.round(totalCoverage),
      uniqueDevices: allDevices.size,
      uniqueScenes: allScenes.size,
      avgCompletionRatio: totalDwellMs > 0 ? totalRatioWeightedMs / totalDwellMs : 0,
      offlineEvents,
    },
  };
}

// ---------------------------------------------------------------------------
// 4. Fleet health & deterministic alert rules
// ---------------------------------------------------------------------------

function ruleValue(
  rule: AlertRule,
  device: DeviceTelemetry,
  staleMs: number,
  thresholds: FleetHealthThresholds
): { value: number; triggered: boolean; unit: string } {
  switch (rule.type) {
    case 'DEVICE_OFFLINE': {
      const minutes = staleMs / 60_000;
      return {
        value: minutes,
        triggered: device.status === 'OFFLINE' || staleMs >= thresholds.offlineMs || minutes >= rule.threshold,
        unit: 'min',
      };
    }
    case 'HEARTBEAT_STALE': {
      const seconds = staleMs / 1000;
      return {
        value: seconds,
        triggered: device.status !== 'OFFLINE' && seconds >= rule.threshold && staleMs < thresholds.offlineMs,
        unit: 's',
      };
    }
    case 'PLAYBACK_STALLED': {
      const state = (device.playbackState || '').toUpperCase();
      const stalled = state === 'STALLED' || state === 'ERROR' || state === 'FROZEN';
      return { value: stalled ? 1 : 0, triggered: stalled && rule.threshold <= 1, unit: 'state' };
    }
    case 'CLOCK_DRIFT': {
      const drift = Math.abs(finiteNumber(device.driftMs));
      return { value: drift, triggered: drift >= rule.threshold, unit: 'ms' };
    }
    case 'LOW_FPS': {
      const fps = finiteNumber(device.estimatedFps, 60);
      return { value: fps, triggered: fps > 0 && fps < rule.threshold, unit: 'fps' };
    }
    case 'COMMAND_FAILURES': {
      const failures = finiteNumber(device.commandFailures);
      return { value: failures, triggered: failures >= rule.threshold, unit: 'commands' };
    }
    default:
      return { value: 0, triggered: false, unit: '' };
  }
}

/**
 * Evaluate all enabled alert rules for a fleet telemetry snapshot.
 * Alert IDs are deterministic for a cooldown bucket, so repeated heartbeats
 * never create duplicate alerts (and offline replays stay idempotent).
 */
export function evaluateFleetHealth(
  input: { devices: DeviceTelemetry[]; rules?: AlertRule[]; thresholds?: Partial<FleetHealthThresholds> },
  nowMs = Date.now()
): FleetHealthReport {
  const thresholds: FleetHealthThresholds = { ...DEFAULT_HEALTH_THRESHOLDS, ...(input.thresholds ?? {}) };
  const rules = input.rules ?? DEFAULT_ALERT_RULES;
  const enabledRules = rules.filter((r) => r.enabled);
  const generatedAtUtc = new Date(nowMs).toISOString();
  const alerts: FleetAlert[] = [];

  const devices: DeviceHealthSnapshot[] = input.devices.map((device) => {
    const lastSeenMs = parseUtcTime(device.lastSeenAtUtc);
    const staleMs = Number.isFinite(lastSeenMs) ? Math.max(0, nowMs - lastSeenMs) : Number.MAX_SAFE_INTEGER;
    const reasons: string[] = [];
    const activeAlertIds: string[] = [];
    let worstSeverity = 0; // 0 healthy, 1 degraded, 2 critical
    let offline = device.status === 'OFFLINE' || staleMs >= thresholds.offlineMs;

    for (const rule of enabledRules) {
      const { value, triggered, unit } = ruleValue(rule, device, staleMs, thresholds);
      if (!triggered) continue;
      if (rule.type === 'DEVICE_OFFLINE') offline = true;
      const severityWeight = rule.severity === 'CRITICAL' ? 2 : rule.severity === 'WARNING' ? 1 : 0;
      worstSeverity = Math.max(worstSeverity, severityWeight);
      reasons.push(`${rule.type} (${value.toFixed(unit === 'fps' || unit === 'min' ? 1 : 0)}${unit})`);

      const cooldownMs = Math.max(1, rule.cooldownMinutes) * 60_000;
      const bucket = Math.floor(nowMs / cooldownMs);
      const fingerprint = sha256Hex(`${rule.id}|${device.deviceId}|${bucket}`).slice(0, 24);
      const id = `fleet-alert-${fingerprint}`;
      activeAlertIds.push(id);
      alerts.push({
        id,
        ruleId: rule.id,
        ruleType: rule.type,
        deviceId: device.deviceId,
        deviceName: device.name || device.deviceId,
        severity: rule.severity,
        state: 'ACTIVE',
        message: `${device.name || device.deviceId}: ${rule.description} (observed ${value.toFixed(1)} ${unit}, threshold ${rule.threshold} ${unit}).`,
        value: Number(value.toFixed(3)),
        threshold: rule.threshold,
        triggeredAtUtc: generatedAtUtc,
        fingerprint,
      });
    }

    // Health grade also honors raw thresholds even when a rule is disabled.
    if (Math.abs(finiteNumber(device.driftMs)) >= thresholds.driftCriticalMs) {
      worstSeverity = 2;
      reasons.push(`CRITICAL_DRIFT (${finiteNumber(device.driftMs).toFixed(0)}ms)`);
    } else if (Math.abs(finiteNumber(device.driftMs)) >= thresholds.driftWarningMs) {
      worstSeverity = Math.max(worstSeverity, 1);
      reasons.push(`DRIFT (${finiteNumber(device.driftMs).toFixed(0)}ms)`);
    }
    if (finiteNumber(device.errorCount) > thresholds.maxErrorCount) {
      worstSeverity = Math.max(worstSeverity, 1);
      reasons.push(`RENDER_ERRORS (${finiteNumber(device.errorCount)})`);
    }
    if (finiteNumber(device.estimatedFps, 60) > 0 && finiteNumber(device.estimatedFps, 60) < thresholds.minFps) {
      worstSeverity = Math.max(worstSeverity, 1);
      reasons.push(`LOW_FPS (${finiteNumber(device.estimatedFps, 60).toFixed(1)})`);
    }

    const state: FleetHealthState = offline
      ? 'OFFLINE'
      : worstSeverity >= 2
        ? 'CRITICAL'
        : worstSeverity >= 1 || reasons.length > 0
          ? 'DEGRADED'
          : 'HEALTHY';

    return {
      deviceId: device.deviceId,
      name: device.name || device.deviceId,
      state,
      staleMs: Number.isFinite(staleMs) ? staleMs : 0,
      lastSeenAtUtc: Number.isFinite(lastSeenMs) ? new Date(lastSeenMs).toISOString() : '',
      playbackState: device.playbackState || 'UNKNOWN',
      driftMs: finiteNumber(device.driftMs),
      estimatedFps: finiteNumber(device.estimatedFps, 60),
      commandFailures: finiteNumber(device.commandFailures),
      reasons: [...new Set(reasons)],
      activeAlertIds,
    };
  });

  devices.sort((a, b) => a.deviceId.localeCompare(b.deviceId));
  alerts.sort((a, b) => a.id.localeCompare(b.id));

  const count = (state: FleetHealthState) => devices.filter((d) => d.state === state).length;
  const fpsValues = devices.filter((d) => d.state !== 'OFFLINE').map((d) => d.estimatedFps);
  return {
    generatedAtUtc,
    devices,
    alerts,
    totals: {
      total: devices.length,
      healthy: count('HEALTHY'),
      degraded: count('DEGRADED'),
      critical: count('CRITICAL'),
      offline: count('OFFLINE'),
      activeAlerts: alerts.length,
      criticalAlerts: alerts.filter((a) => a.severity === 'CRITICAL').length,
      averageFps: fpsValues.length ? fpsValues.reduce((a, b) => a + b, 0) / fpsValues.length : 0,
      maxDriftMs: devices.reduce((max, d) => Math.max(max, Math.abs(d.driftMs)), 0),
      uptimePercent: devices.length ? ((devices.length - count('OFFLINE')) / devices.length) * 100 : 100,
    },
  };
}

/** Compact trend summary for the health history sparkline/telemetry view. */
export function summarizeHealthHistory(
  samples: HealthSample[],
  windowMs = 24 * 60 * 60_000,
  nowMs = Date.now()
): Array<{
  deviceId: string;
  samples: number;
  avgFps: number;
  minFps: number;
  avgDriftMs: number;
  maxDriftMs: number;
  availabilityPercent: number;
  history: Array<{ recordedAtUtc: string; fps: number; driftMs: number }>;
}> {
  const byDevice = new Map<string, HealthSample[]>();
  for (const sample of samples) {
    const t = parseUtcTime(sample.recordedAtUtc);
    if (!Number.isFinite(t) || t < nowMs - windowMs || t > nowMs + 60_000) continue;
    const list = byDevice.get(sample.deviceId) ?? [];
    list.push(sample);
    byDevice.set(sample.deviceId, list);
  }
  return [...byDevice.entries()]
    .map(([deviceId, list]) => {
      list.sort((a, b) => parseUtcTime(a.recordedAtUtc) - parseUtcTime(b.recordedAtUtc));
      const fps = list.map((s) => finiteNumber(s.estimatedFps));
      const drifts = list.map((s) => finiteNumber(s.driftMs));
      const playing = list.filter((s) => (s.playbackState || '').toUpperCase() === 'PLAYING').length;
      return {
        deviceId,
        samples: list.length,
        avgFps: fps.length ? fps.reduce((a, b) => a + b, 0) / fps.length : 0,
        minFps: fps.length ? Math.min(...fps) : 0,
        avgDriftMs: drifts.length ? drifts.reduce((a, b) => a + b, 0) / drifts.length : 0,
        maxDriftMs: drifts.length ? Math.max(...drifts.map(Math.abs)) : 0,
        availabilityPercent: list.length ? (playing / list.length) * 100 : 0,
        history: list.map((s) => ({
          recordedAtUtc: s.recordedAtUtc,
          fps: finiteNumber(s.estimatedFps),
          driftMs: finiteNumber(s.driftMs),
        })),
      };
    })
    .sort((a, b) => a.deviceId.localeCompare(b.deviceId));
}

// ---------------------------------------------------------------------------
// 5. Backups, secret redaction & retention
// ---------------------------------------------------------------------------

function redactBackupValue(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return SECRET_VALUE_PATTERN.test(value) ? '[REDACTED]' : value;
  if (depth >= 4) return value;
  if (Array.isArray(value)) return value.map((entry) => redactBackupValue(entry, depth + 1));
  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      out[key] = SECRET_KEY_PATTERN.test(key) && value[key] !== null && value[key] !== undefined
        ? '[REDACTED]'
        : redactBackupValue(value[key], depth + 1);
    }
    return out;
  }
  return value;
}

export function redactBackupRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(row).sort()) {
    out[key] = SECRET_KEY_PATTERN.test(key) && row[key] !== null && row[key] !== undefined
      ? '[REDACTED]'
      : redactBackupValue(row[key], 0);
  }
  return out;
}

/** Deterministic, secret-redacted, SHA-256 verified operational backup. */
export function buildBackupArchive(
  tables: BackupTableSnapshot[],
  options: { createdBy?: string; createdAtUtc?: string; retentionDays?: number; backupId?: string } = {}
): BackupArchive {
  const createdAtUtc = options.createdAtUtc ?? new Date().toISOString();
  const retentionDays = Math.max(1, Math.round(options.retentionDays ?? 30));
  const sanitized = tables
    .map((table) => ({
      name: table.name,
      rows: table.rows.map((row) => redactBackupRow(row)).sort((a, b) => canonicalJson(a).localeCompare(canonicalJson(b))),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const tableManifest = sanitized.map((table) => ({
    name: table.name,
    rowCount: table.rows.length,
    checksum: sha256Hex(canonicalJson(table.rows)),
  }));
  const checksum = sha256Hex(
    canonicalJson({
      formatVersion: 1,
      createdAtUtc,
      retentionDays,
      tables: tableManifest,
    })
  );
  return {
    manifest: {
      formatVersion: 1,
      backupId: options.backupId ?? `backup-${checksum.slice(0, 20)}`,
      createdAtUtc,
      createdBy: options.createdBy || 'admin',
      retentionDays,
      expiresAtUtc: new Date(Date.parse(createdAtUtc) + retentionDays * 86_400_000).toISOString(),
      tables: tableManifest,
      checksum,
    },
    tables: sanitized,
  };
}

/** Recompute every table checksum and the manifest checksum. Never throws. */
export function verifyBackupArchive(archive: unknown): BackupVerification {
  const errors: string[] = [];
  if (!isRecord(archive) || !isRecord(archive.manifest) || !Array.isArray(archive.tables)) {
    return { valid: false, errors: ['Malformed backup archive.'], computedChecksum: '' };
  }
  const manifest = archive.manifest as unknown as BackupManifest;
  if (manifest.formatVersion !== 1) errors.push('Unsupported backup format version.');
  if (typeof manifest.checksum !== 'string' || manifest.checksum.length !== 64) {
    errors.push('Missing or invalid manifest checksum.');
  }

  const tables = archive.tables as BackupTableSnapshot[];
  const recomputed = tables.map((table) => {
    const rows = Array.isArray(table.rows) ? table.rows : [];
    return {
      name: table.name,
      rowCount: rows.length,
      checksum: sha256Hex(
        canonicalJson(
          rows
            .map(redactBackupRow)
            .sort((a, b) => canonicalJson(a).localeCompare(canonicalJson(b)))
        )
      ),
    };
  });
  const manifestTables = Array.isArray(manifest.tables) ? manifest.tables : [];
  for (const entry of manifestTables) {
    const found = recomputed.find((t) => t.name === entry.name);
    if (!found) errors.push(`Missing table "${entry.name}".`);
    else if (found.checksum !== entry.checksum || found.rowCount !== entry.rowCount) {
      errors.push(`Checksum mismatch for table "${entry.name}".`);
    }
  }
  if (recomputed.length !== manifestTables.length) errors.push('Table count mismatch.');

  const computedChecksum = sha256Hex(
    canonicalJson({
      formatVersion: 1,
      createdAtUtc: manifest.createdAtUtc,
      retentionDays: manifest.retentionDays,
      tables: manifestTables,
    })
  );
  if (computedChecksum !== manifest.checksum) errors.push('Manifest checksum mismatch.');
  return { valid: errors.length === 0, errors, computedChecksum };
}

export function backupSizeBytes(archive: BackupArchive): number {
  return stringToBytes(canonicalJson(archive)).byteLength;
}

export interface RetentionResult<T> {
  kept: T[];
  pruned: T[];
  byReason: { expired: number; overflow: number };
}

/** Deterministic retention: pinned rows always survive, then newest-first. */
export function applyRetention<T>(
  items: T[],
  options: {
    nowMs?: number;
    maxAgeMs?: number;
    maxRows?: number;
    getTimestamp: (item: T) => string | number;
    isPinned?: (item: T) => boolean;
  }
): RetentionResult<T> {
  const nowMs = options.nowMs ?? Date.now();
  const maxAgeMs = options.maxAgeMs ?? 30 * 86_400_000;
  const maxRows = options.maxRows ?? 5_000;
  const indexed = items.map((item, index) => ({ item, index, time: parseUtcTime(options.getTimestamp(item)) }));
  const pinned = indexed.filter((entry) => options.isPinned?.(entry.item));
  const candidates = indexed
    .filter((entry) => !options.isPinned?.(entry.item))
    .sort((a, b) => (b.time || 0) - (a.time || 0) || a.index - b.index);

  const kept = new Set<number>(pinned.map((entry) => entry.index));
  const pruned: T[] = [];
  const byReason = { expired: 0, overflow: 0 };
  let keptCount = kept.size;
  for (const entry of candidates) {
    const expired = !Number.isFinite(entry.time) || nowMs - entry.time > maxAgeMs;
    const overflow = keptCount >= maxRows;
    if (expired || overflow) {
      pruned.push(entry.item);
      if (expired) byReason.expired += 1;
      else byReason.overflow += 1;
    } else {
      kept.add(entry.index);
      keptCount += 1;
    }
  }
  return {
    kept: indexed.filter((entry) => kept.has(entry.index)).map((entry) => entry.item),
    pruned,
    byReason,
  };
}

// ---------------------------------------------------------------------------
// 6. Deterministic demo telemetry (used by seeded DBs, static Pages fallback
//    and the offline UI demo — never used when live telemetry is available).
// ---------------------------------------------------------------------------

export const DEMO_DEVICE_IDS = [
  'player-01',
  'player-02',
  'player-03',
  'player-04',
  'player-05',
  'player-06',
];

export const DEMO_SCENE_IDS = ['scene-welcome', 'scene-menu', 'scene-promotions', 'scene-wayfinding'];

export function createDemoPlaybackEvents(
  nowMs = Date.now(),
  deviceIds: string[] = DEMO_DEVICE_IDS,
  hours = 8
): PlaybackEvent[] {
  const events: PlaybackEvent[] = [];
  const scenes = DEMO_SCENE_IDS;
  for (let h = hours; h >= 1; h--) {
    for (let s = 0; s < scenes.length; s++) {
      for (let d = 0; d < Math.min(deviceIds.length, 4); d++) {
        // Deterministic pseudo-variation without Math.random().
        const durationMs = 8_000 + ((h * 7 + s * 13 + d * 11) % 9) * 1_000;
        events.push({
          eventId: `demo-pop-${h}-${s}-${d}`,
          deviceId: deviceIds[d],
          sceneId: scenes[s],
          packageId: 'pkg-apex-lobby-v1',
          startedAtUtc: new Date(nowMs - h * 3_600_000 - s * 20_000 - d * 1_500).toISOString(),
          durationMs,
          completionRatio: 0.92 + ((h + s + d) % 8) / 100,
          offlineRecorded: h >= 7 && d === 3,
        });
      }
    }
  }
  return events;
}

export function createDemoHealthSamples(
  nowMs = Date.now(),
  deviceIds: string[] = DEMO_DEVICE_IDS,
  count = 12
): HealthSample[] {
  const samples: HealthSample[] = [];
  for (let i = count; i >= 0; i--) {
    for (let d = 0; d < deviceIds.length; d++) {
      samples.push({
        sampleId: `demo-health-${i}-${d}`,
        deviceId: deviceIds[d],
        recordedAtUtc: new Date(nowMs - i * 5 * 60_000).toISOString(),
        playbackState: d === 5 && i <= 2 ? 'STALLED' : 'PLAYING',
        status: 'ONLINE',
        driftMs: ((d * 3 + i * 2) % 11) - 5,
        estimatedFps: d === 5 && i <= 2 ? 12 : 58 + ((d + i) % 3),
        errorCount: 0,
        clockUncertaintyMs: 2 + ((d + i) % 4),
        currentSceneId: DEMO_SCENE_IDS[i % DEMO_SCENE_IDS.length],
        currentPackageId: 'pkg-apex-lobby-v1',
      });
    }
  }
  return samples;
}
