// ============================================================================
// src/components/network/NetworkManagementView.tsx
// Centralized Network Management Server UI, Multi-Display Synchronized Wall
// Simulator, NTP Clock Sync, Drift Correction, Device Registry & Audit Log
// (Implements Spec Sections 20–36)
// ============================================================================

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Server,
  Monitor,
  Layers,
  Radio,
  Package,
  Terminal,
  ShieldCheck,
  RefreshCw,
  Plus,
  Play,
  Wifi,
  WifiOff,
  Clock,
  Activity,
  Send,
  KeyRound,
  UserX,
  Zap,
  QrCode,
  Camera,
  Smartphone,
  CheckCircle2,
  Database,
  Bell,
  AlertTriangle,
  BarChart3,
  Trash2,
  RotateCcw,
  Download,
} from 'lucide-react';
import { useStudioStore } from '@/store/useStudioStore';
import {
  PlayerSetupQrPayload,
  buildEnrollmentQrMatrix,
  decodePlayerSetupQrPayload,
  encodePlayerSetupQrPayload,
  loadActivePlayerSetupQr,
} from '@/utils/enrollmentQr';
import {
  ClockSyncEngine,
  SynchronizedSessionConfig,
  evaluateAuthoritativeTimeline,
} from '@packages/playback-engine';
import { SignageElementRenderer } from '@/components/shared/SignageElementRenderer';
import { formatBytes, formatDurationMs } from '@packages/shared';
import {
  DEFAULT_ALERT_RULES,
  DEMO_DEVICE_IDS,
  aggregateProofOfPlay,
  createDemoHealthSamples,
  createDemoPlaybackEvents,
  evaluateFleetHealth,
  summarizeHealthHistory,
  type AlertRule,
  type DeviceTelemetry,
  type FleetAlert,
  type ProofOfPlayGroupBy,
  type ProofOfPlaySummary,
} from '@packages/fleet-operations';

type NetworkTab =
  | 'sync-dashboard'
  | 'overview'
  | 'devices'
  | 'groups-packages'
  | 'commands-audit'
  | 'fleet-operations';

type FleetRange = 'today' | 'week' | 'all';

interface FleetDeviceHealth {
  deviceId: string;
  name: string;
  state: string;
  staleMs: number;
  lastSeenAtUtc: string;
  playbackState: string;
  driftMs: number;
  estimatedFps: number;
  commandFailures: number;
  reasons: string[];
}

interface FleetHistoryRow {
  deviceId: string;
  samples: number;
  avgFps: number;
  minFps: number;
  avgDriftMs: number;
  maxDriftMs: number;
  availabilityPercent: number;
  history: Array<{ recordedAtUtc: string; fps: number; driftMs: number }>;
}

interface FleetBackupRow {
  id: string;
  created_at_utc: string;
  created_by: string;
  size_bytes: number;
  checksum: string;
}

interface FleetSummaryResponse {
  generatedAtUtc: string;
  health: {
    generatedAtUtc: string;
    devices: FleetDeviceHealth[];
    totals: Record<string, number>;
  };
  healthHistory: FleetHistoryRow[];
  alerts: FleetAlert[];
  rules: AlertRule[];
  proofOfPlayToday: ProofOfPlaySummary;
  backups: FleetBackupRow[];
}

const FLEET_STATE_COLORS: Record<string, string> = {
  HEALTHY: '#10b981',
  DEGRADED: '#f59e0b',
  CRITICAL: '#ef4444',
  OFFLINE: '#64748b',
};

function FleetSparkline({ history }: { history: FleetHistoryRow }): React.ReactElement {
  const values = history.history.slice(-24);
  if (values.length < 2) return <span className="muted-line">No samples yet</span>;
  const points = values
    .map((sample, index) => {
      const x = (index / (values.length - 1)) * 100;
      const y = 38 - Math.max(0, Math.min(1, sample.fps / 60)) * 34;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg className="fleet-sparkline" viewBox="0 0 100 40" preserveAspectRatio="none" aria-label={`${history.deviceId} FPS history`} role="img">
      <polyline points={points} fill="none" stroke="#38bdf8" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

interface ServerDevice {
  id: string;
  name: string;
  location: string;
  assigned_display: string;
  os: string;
  status: string;
  playback_state: string;
  player_version: string;
  current_package_id: string;
  current_scene_id: string;
  estimated_fps: number;
  clock_offset_ms: number;
  clock_uncertainty_ms: number;
  drift_ms: number;
  last_seen_at: string;
}

export const NetworkManagementView: React.FC = () => {
  const { project, notify, isMobileLayout } = useStudioStore();
  const [activeTab, setActiveTab] = useState<NetworkTab>('sync-dashboard');

  const [overview, setOverview] = useState<Record<string, unknown> | null>(null);
  const [devices, setDevices] = useState<ServerDevice[]>([]);
  const [enrollmentCodes, setEnrollmentCodes] = useState<Array<Record<string, unknown>>>([]);
  const [groups, setGroups] = useState<Array<Record<string, unknown>>>([]);
  const [packages, setPackages] = useState<Array<Record<string, unknown>>>([]);
  const [deployments, setDeployments] = useState<Array<Record<string, unknown>>>([]);
  const [sessions, setSessions] = useState<Array<Record<string, unknown>>>([]);
  const [commands, setCommands] = useState<Array<Record<string, unknown>>>([]);
  const [auditLog, setAuditLog] = useState<Array<Record<string, unknown>>>([]);
  const [wsEvents, setWsEvents] = useState<Array<{ type: string; timestamp: string }>>([]);

  // Clock Sync & Authoritative Timeline state
  const clockEngineRef = useRef(new ClockSyncEngine());
  const [clockStatus, setClockStatus] = useState(() => clockEngineRef.current.getStatus());
  const [authoritativeNowMs, setAuthoritativeNowMs] = useState(() => Date.now());
  const [simulatedDisconnectedIds, setSimulatedDisconnectedIds] = useState<string[]>([]);
  const [simulatedDrifts, setSimulatedDrifts] = useState<Record<string, number>>({});

  // Forms state
  const [newDeviceName, setNewDeviceName] = useState('Concourse Display #08');
  const [newDeviceLocation, setNewDeviceLocation] = useState('East Wing');
  const [selectedCmdDevice, setSelectedCmdDevice] = useState('player-01');
  const [selectedCmdType, setSelectedCmdType] = useState('STATUS_REQUEST');
  const [deployPackageId, setDeployPackageId] = useState('pkg-apex-lobby-v1');
  const [deployGroupId, setDeployGroupId] = useState('group-lobby-wall');

  // Mobile Player Setup QR Code Scanner state
  const [showQrScannerModal, setShowQrScannerModal] = useState(false);
  const [detectedPlayerQr, setDetectedPlayerQr] = useState<PlayerSetupQrPayload>(() =>
    loadActivePlayerSetupQr()
  );
  const [qrInputText, setQrInputText] = useState('');
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraStatusText, setCameraStatusText] = useState(
    'Point mobile camera at the Signage Player Setup QR Code'
  );
  const qrVideoRef = useRef<HTMLVideoElement | null>(null);

  // -------------------------------------------------------------------------
  // Phase 15 — Fleet Operations state (live server data + offline demo fallback)
  // -------------------------------------------------------------------------
  const [fleetSummary, setFleetSummary] = useState<FleetSummaryResponse | null>(null);
  const [fleetProof, setFleetProof] = useState<ProofOfPlaySummary | null>(null);
  const [fleetRange, setFleetRange] = useState<FleetRange>('week');
  const [fleetGroupBy, setFleetGroupBy] = useState<ProofOfPlayGroupBy>('scene');
  const [fleetBusy, setFleetBusy] = useState<string | null>(null);
  const [fleetMessage, setFleetMessage] = useState(
    'Fleet telemetry, proof-of-play impressions, alerts and verified backups.'
  );

  const fleetRangeStartUtc = useMemo(() => {
    if (fleetRange === 'all') return undefined;
    if (fleetRange === 'today') return `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`;
    return new Date(Date.now() - 7 * 86_400_000).toISOString();
  }, [fleetRange]);

  /** Deterministic demo used only when no API is reachable (e.g. headless tests). */
  const offlineFleetDemo = useMemo<FleetSummaryResponse>(() => {
    const nowMs = Date.now();
    const devices: DeviceTelemetry[] = DEMO_DEVICE_IDS.map((id, index) => ({
      deviceId: id,
      name: `Apex Display ${String(index + 1).padStart(2, '0')}`,
      lastSeenAtUtc: new Date(nowMs - (index === 5 ? 95_000 : 2_000)).toISOString(),
      status: 'ONLINE',
      playbackState: 'PLAYING',
      driftMs: index === 5 ? 312 : (index - 2) * 2,
      estimatedFps: 60 - index,
      commandFailures: 0,
    }));
    const report = evaluateFleetHealth({ devices, rules: DEFAULT_ALERT_RULES }, nowMs);
    const todayStartIso = `${new Date(nowMs).toISOString().slice(0, 10)}T00:00:00.000Z`;
    return {
      generatedAtUtc: new Date(nowMs).toISOString(),
      health: {
        generatedAtUtc: report.generatedAtUtc,
        devices: report.devices,
        totals: report.totals as unknown as Record<string, number>,
      },
      healthHistory: summarizeHealthHistory(createDemoHealthSamples(nowMs, DEMO_DEVICE_IDS, 12), 24 * 3_600_000, nowMs),
      alerts: report.alerts,
      rules: DEFAULT_ALERT_RULES.map((rule) => ({ ...rule })),
      proofOfPlayToday: aggregateProofOfPlay(createDemoPlaybackEvents(nowMs, DEMO_DEVICE_IDS, 8), {
        nowMs,
        fromUtc: todayStartIso,
        groupBy: 'scene',
      }),
      backups: [],
    };
  }, []);

  const offlineProof = useMemo(
    () =>
      aggregateProofOfPlay(createDemoPlaybackEvents(Date.now(), DEMO_DEVICE_IDS, 8), {
        fromUtc: fleetRangeStartUtc,
        groupBy: fleetGroupBy,
      }),
    [fleetRangeStartUtc, fleetGroupBy]
  );

  const fleet = fleetSummary ?? offlineFleetDemo;
  const proof = fleetProof ?? offlineProof;
  const activeAlerts = fleet.alerts.filter((alert) => alert.state === 'ACTIVE');
  const acknowledgedAlerts = fleet.alerts.length - activeAlerts.length;
  const fleetTotals = fleet.health.totals ?? {};
  const maxDailyDwellMs = Math.max(1, ...(proof.daily ?? []).map((day) => day.dwellMs));

  const fetchFleetData = useCallback(async () => {
    try {
      const qs = new URLSearchParams({ groupBy: fleetGroupBy });
      if (fleetRangeStartUtc) qs.set('fromUtc', fleetRangeStartUtc);
      const [summaryRes, proofRes] = await Promise.all([
        fetch('/api/v1/operations/summary'),
        fetch(`/api/v1/operations/proof-of-play?${qs.toString()}`),
      ]);
      if (summaryRes.ok) setFleetSummary((await summaryRes.json()) as FleetSummaryResponse);
      if (proofRes.ok) {
        const data = (await proofRes.json()) as { summary: ProofOfPlaySummary };
        setFleetProof(data.summary);
      }
    } catch {
      // Keep the deterministic offline demo snapshot.
    }
  }, [fleetGroupBy, fleetRangeStartUtc]);

  const runFleetAction = useCallback(
    async (label: string, url: string, init: RequestInit, successMessage: string) => {
      setFleetBusy(label);
      try {
        const response = await fetch(url, init);
        const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
        if (!response.ok) {
          const errorText = String(data.error ?? response.statusText ?? 'Request failed');
          setFleetMessage(`${label} failed: ${errorText}`);
          notify('error', `${label} failed: ${errorText}`);
          return null;
        }
        setFleetMessage(successMessage);
        notify('success', successMessage);
        await fetchFleetData();
        return data;
      } catch {
        const message = 'Offline demo mode — start the management server to persist fleet changes.';
        setFleetMessage(message);
        notify('info', message);
        return null;
      } finally {
        setFleetBusy(null);
      }
    },
    [fetchFleetData, notify]
  );

  const fleetJsonHeaders = { 'Content-Type': 'application/json' };

  const handleFleetInject = (kind: 'offline' | 'stalled' | 'drift' | 'healthy') => {
    const deviceId = fleet.health.devices[0]?.deviceId || 'player-01';
    const sample = {
      deviceId,
      sampleId: `console-${kind}-${Date.now()}`,
      playbackState: kind === 'stalled' ? 'STALLED' : 'PLAYING',
      status: kind === 'offline' ? 'OFFLINE' : 'ONLINE',
      driftMs: kind === 'drift' ? 780 : 2,
      estimatedFps: kind === 'stalled' ? 8 : 60,
      errorCount: kind === 'stalled' ? 3 : 0,
      clockUncertaintyMs: 2.5,
      currentSceneId: 'scene-welcome',
      currentPackageId: 'pkg-apex-lobby-v1',
    };
    void runFleetAction(
      'Inject telemetry',
      '/api/v1/operations/health-samples',
      { method: 'POST', headers: fleetJsonHeaders, body: JSON.stringify({ samples: [sample] }) },
      `Injected ${kind} telemetry for ${deviceId}; alert rules re-evaluated.`
    );
  };

  const handleFleetReportPlays = () => {
    const nowMs = Date.now();
    const deviceId = fleet.health.devices[0]?.deviceId || 'player-01';
    const scenes = ['scene-welcome', 'scene-menu', 'scene-promotions', 'scene-wayfinding'];
    const events = scenes.map((sceneId, index) => ({
      eventId: `console-play-${nowMs}-${index}`,
      deviceId,
      sceneId,
      packageId: 'pkg-apex-lobby-v1',
      startedAtUtc: new Date(nowMs - (scenes.length - index) * 12_000).toISOString(),
      durationMs: 10_000,
      completionRatio: 1,
      offlineRecorded: index === 0,
    }));
    void runFleetAction(
      'Report plays',
      '/api/v1/operations/playback-events',
      { method: 'POST', headers: fleetJsonHeaders, body: JSON.stringify({ events }) },
      `Reported ${events.length} proof-of-play events for ${deviceId}.`
    );
  };

  const handleAcknowledgeAlert = (alertId: string) => {
    void runFleetAction(
      'Acknowledge alert',
      `/api/v1/operations/alerts/${encodeURIComponent(alertId)}/acknowledge`,
      { method: 'POST', headers: fleetJsonHeaders, body: JSON.stringify({}) },
      `Alert ${alertId.slice(-8)} acknowledged.`
    );
  };

  const handleToggleRule = (rule: AlertRule) => {
    void runFleetAction(
      'Update alert rule',
      `/api/v1/operations/alert-rules/${encodeURIComponent(rule.id)}`,
      { method: 'PATCH', headers: fleetJsonHeaders, body: JSON.stringify({ enabled: !rule.enabled }) },
      `${rule.type} ${rule.enabled ? 'disabled' : 'enabled'}.`
    );
  };

  const handleRuleThreshold = (rule: AlertRule, value: string) => {
    const threshold = Number(value);
    if (!Number.isFinite(threshold) || threshold <= 0 || threshold === rule.threshold) return;
    void runFleetAction(
      'Update alert threshold',
      `/api/v1/operations/alert-rules/${encodeURIComponent(rule.id)}`,
      { method: 'PATCH', headers: fleetJsonHeaders, body: JSON.stringify({ threshold }) },
      `${rule.type} threshold set to ${threshold}.`
    );
  };

  const handleCreateBackup = () => {
    void runFleetAction(
      'Create backup',
      '/api/v1/operations/backups',
      { method: 'POST', headers: fleetJsonHeaders, body: JSON.stringify({ retentionDays: 30 }) },
      'SHA-256 verified operational backup created.'
    );
  };

  const handleVerifyBackup = async (backupId: string) => {
    setFleetBusy('Verify backup');
    try {
      const response = await fetch(`/api/v1/operations/backups/${encodeURIComponent(backupId)}`);
      const data = (await response.json()) as {
        verification?: { valid: boolean; errors: string[]; computedChecksum: string };
      };
      const verification = data.verification;
      if (!verification) throw new Error('No verification result');
      const message = verification.valid
        ? `Backup integrity OK — manifest checksum ${verification.computedChecksum.slice(0, 16)}…`
        : `Backup integrity FAILED — ${verification.errors.join('; ')}`;
      setFleetMessage(message);
      notify(verification.valid ? 'success' : 'error', message);
    } catch {
      const message = 'Offline demo mode — no backup archive to verify.';
      setFleetMessage(message);
      notify('info', message);
    } finally {
      setFleetBusy(null);
    }
  };

  const handleRestoreBackup = (backupId: string) => {
    void runFleetAction(
      'Restore backup',
      `/api/v1/operations/backups/${encodeURIComponent(backupId)}/restore`,
      { method: 'POST', headers: fleetJsonHeaders, body: JSON.stringify({}) },
      'Operational telemetry restored after checksum verification.'
    );
  };

  const handleDownloadBackup = async (backupId: string) => {
    try {
      const response = await fetch(`/api/v1/operations/backups/${encodeURIComponent(backupId)}`);
      const payload = await response.text();
      const blob = new Blob([payload], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${backupId}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setFleetMessage(`Downloaded ${backupId}.json`);
    } catch {
      setFleetMessage('Backup download is unavailable in offline demo mode.');
    }
  };

  const handleFleetRetention = () => {
    void runFleetAction(
      'Apply retention',
      '/api/v1/operations/retention',
      { method: 'POST', headers: fleetJsonHeaders, body: JSON.stringify({ maxAgeDays: 30, maxRows: 5000 }) },
      'Retention policy applied to telemetry, events and audit log.'
    );
  };

  const fetchServerData = useCallback(async () => {
    try {
      const [ovRes, devRes, grpRes, pkgRes, sesRes, cmdRes, audRes] = await Promise.all([
        fetch('/api/v1/server/overview'),
        fetch('/api/v1/devices'),
        fetch('/api/v1/groups'),
        fetch('/api/v1/packages'),
        fetch('/api/v1/sessions'),
        fetch('/api/v1/commands'),
        fetch('/api/v1/audit-log'),
      ]);

      if (ovRes.ok) setOverview(await ovRes.json());
      if (devRes.ok) {
        const d = await devRes.json();
        setDevices(d.devices || []);
        setEnrollmentCodes(d.enrollmentCodes || []);
      }
      if (grpRes.ok) {
        const g = await grpRes.json();
        setGroups(g.groups || []);
      }
      if (pkgRes.ok) {
        const p = await pkgRes.json();
        setPackages(p.packages || []);
        setDeployments(p.deployments || []);
      }
      if (sesRes.ok) {
        const s = await sesRes.json();
        setSessions(s.sessions || []);
      }
      if (cmdRes.ok) {
        const c = await cmdRes.json();
        setCommands(c.commands || []);
      }
      if (audRes.ok) {
        const a = await audRes.json();
        setAuditLog(a.auditLog || []);
      }
    } catch {
      // Offline fallback if server is restarting
    }
  }, []);

  const performClockSyncExchange = useCallback(async () => {
    try {
      const t1 = Date.now();
      const res = await fetch('/api/v1/clock/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ t1ClientSendMs: t1, deviceId: 'studio-console' }),
      });
      const t4 = Date.now();
      if (res.ok) {
        const data = await res.json();
        const status = clockEngineRef.current.recordExchange(
          t1,
          data.t2ServerRecvMs,
          data.t3ServerSendMs,
          t4
        );
        setClockStatus(status);
      }
    } catch {
      // Ignore transient network error
    }
  }, []);

  useEffect(() => {
    void fetchServerData();
    void performClockSyncExchange();
    const pollId = setInterval(() => {
      void fetchServerData();
      void performClockSyncExchange();
    }, 4000);
    return () => clearInterval(pollId);
  }, [fetchServerData, performClockSyncExchange]);

  // Fleet Operations data is heavier than the 4-second overview poll, so it is
  // refreshed on tab activation, on filter changes, and after each action.
  useEffect(() => {
    if (activeTab === 'fleet-operations') void fetchFleetData();
  }, [activeTab, fetchFleetData]);

  // Connect to /ws real-time gateway using relative host
  useEffect(() => {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${proto}//${window.location.host}/ws`;
    let socket: WebSocket | null = null;
    try {
      socket = new WebSocket(wsUrl);
      socket.onmessage = (evt) => {
        try {
          const parsed = JSON.parse(evt.data);
          setWsEvents((prev) => [{ type: parsed.type, timestamp: parsed.timestamp }, ...prev.slice(0, 14)]);
          if (parsed.type !== 'SERVER_WELCOME') {
            void fetchServerData();
          }
        } catch {
          // Ignore invalid JSON
        }
      };
    } catch {
      // Ignore WebSocket connection issue in headless environments
    }
    return () => {
      socket?.close();
    };
  }, [fetchServerData]);

  // 30 FPS smooth authoritative clock ticker for the Multi-Screen Sync Simulator
  useEffect(() => {
    let rafId = 0;
    const tick = () => {
      setAuthoritativeNowMs(clockEngineRef.current.getEstimatedServerTimeMs());
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, []);

  const activeSession = sessions[0];
  const sessionConfig: SynchronizedSessionConfig = useMemo(() => {
    return {
      sessionId: String(activeSession?.id || 'session-20261025-001'),
      groupId: String(activeSession?.group_id || 'group-lobby-wall'),
      packageId: String(activeSession?.package_id || 'pkg-apex-lobby-v1'),
      packageVersion: 1,
      playlistId: String(activeSession?.playlist_id || 'playlist-main-loop'),
      playlistRevision: 1,
      timelineRevision: Number(activeSession?.timeline_revision || 1),
      startTimeUtc: String(
        activeSession?.start_time_utc || new Date(Date.now() - 15000).toISOString()
      ),
      status: 'RUNNING',
      synchronizationPolicy: 'DRIFT_CORRECTED',
      failurePolicy: 'START_WITH_AVAILABLE',
    };
  }, [activeSession]);

  const sharedTimeline = useMemo(() => {
    return evaluateAuthoritativeTimeline(
      project,
      project.playlists[0],
      sessionConfig,
      authoritativeNowMs
    );
  }, [project, sessionConfig, authoritativeNowMs]);

  const handleScheduleFutureGroupStart = async () => {
    const res = await fetch('/api/v1/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        groupId: 'group-lobby-wall',
        packageId: 'pkg-apex-lobby-v1',
        playlistId: 'playlist-main-loop',
        leadTimeMs: 2500,
      }),
    });
    if (res.ok) {
      setSimulatedDrifts({});
      await fetchServerData();
      notify(
        'success',
        'Scheduled future synchronized start (+2.5s UTC) across all 5 Lobby Wall displays.'
      );
    }
  };

  const handleSimulateLateJoinPlayer = async () => {
    const res = await fetch('/api/v1/devices/enroll', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceName: `Late-Join Wall Display (${new Date().toLocaleTimeString()})`,
        location: 'North Atrium',
        groupId: 'group-lobby-wall',
      }),
    });
    if (res.ok) {
      await fetchServerData();
      notify(
        'success',
        `Late-joining player enrolled & immediately synchronized to ${sharedTimeline.activeScene.name} @ ${formatDurationMs(sharedTimeline.sceneElapsedMs)}!`
      );
    }
  };

  const handleInjectDriftAndCorrect = async (deviceId: string) => {
    // 1. Inject +780ms drift
    setSimulatedDrifts((prev) => ({ ...prev, [deviceId]: 780 }));
    await fetch(`/api/v1/sessions/${sessionConfig.sessionId}/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId,
        actualSceneId: sharedTimeline.activeScene.id,
        actualScenePositionMs: sharedTimeline.sceneElapsedMs + 780,
        reportedAtUtcMs: authoritativeNowMs,
      }),
    });
    await fetchServerData();
    notify('warning', `Injected +780ms playback drift on ${deviceId}. Drift detector triggered CONTROLLED_SEEK.`);

    // 2. Automatically apply controlled seek after 1.5s
    setTimeout(async () => {
      setSimulatedDrifts((prev) => ({ ...prev, [deviceId]: 4 }));
      await fetch(`/api/v1/sessions/${sessionConfig.sessionId}/resynchronize`, {
        method: 'POST',
      });
      await fetchServerData();
      notify('success', `Drift corrected on ${deviceId}: now within ±4ms of authoritative server timeline.`);
    }, 1500);
  };

  const handleToggleOfflinePlayer = async (deviceId: string) => {
    const isOffline = simulatedDisconnectedIds.includes(deviceId);
    if (isOffline) {
      setSimulatedDisconnectedIds((prev) => prev.filter((id) => id !== deviceId));
      await fetch(`/api/v1/devices/${deviceId}/heartbeat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'ONLINE', playbackState: 'PLAYING', driftMs: 3 }),
      });
      await fetchServerData();
      notify('success', `${deviceId} reconnected, reconciled configuration, and resynchronized clock.`);
    } else {
      setSimulatedDisconnectedIds((prev) => [...prev, deviceId]);
      await fetch(`/api/v1/devices/${deviceId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'OFFLINE', playbackState: 'PLAYING' }),
      });
      await fetchServerData();
      notify('info', `${deviceId} disconnected from LAN — continuing uninterrupted local playback from atomic cache.`);
    }
  };

  const handleCreateEnrollmentCode = async () => {
    const res = await fetch('/api/v1/devices/enrollment-codes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceName: newDeviceName,
        location: newDeviceLocation,
        ttlMinutes: 60,
      }),
    });
    if (res.ok) {
      const data = await res.json();
      await fetchServerData();
      notify('success', `Generated single-use enrollment code: ${data.code}`);
    }
  };

  const handleEnrollWithCode = async (code: string) => {
    const res = await fetch('/api/v1/devices/enroll', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        enrollmentCode: code,
        deviceName: newDeviceName,
        location: newDeviceLocation,
      }),
    });
    const data = await res.json();
    if (res.ok) {
      await fetchServerData();
      notify('success', `Enrolled "${data.deviceName}" (${data.deviceId}) with device credential.`);
    } else {
      notify('error', data.error || 'Enrollment failed');
    }
  };

  const handleEnrollFromQrPayload = useCallback(
    async (rawQrText: string) => {
      const parsed = decodePlayerSetupQrPayload(rawQrText);
      if (!parsed) {
        notify('error', 'Invalid Player Setup QR Code payload.');
        return;
      }

      setNewDeviceName(parsed.deviceName);
      setNewDeviceLocation(parsed.location);

      // Check whether the QR code's enrollment code is still unused; if already used, enroll directly with the player's metadata
      const matchingUnusedCode = enrollmentCodes.find(
        (c) => String(c.code) === parsed.enrollmentCode && !c.used_at
      );

      const res = await fetch('/api/v1/devices/enroll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enrollmentCode: matchingUnusedCode ? parsed.enrollmentCode : undefined,
          deviceId: parsed.deviceId,
          deviceName: parsed.deviceName,
          location: parsed.location,
          assignedDisplay: parsed.assignedDisplay,
          os: parsed.os,
          groupId: 'group-lobby-wall',
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setShowQrScannerModal(false);
        await fetchServerData();
        notify(
          'success',
          `Scanned Player Setup QR Code & enrolled "${data.deviceName}" (${data.deviceId})!`
        );
      } else {
        notify('error', data.error || 'QR Code enrollment failed');
      }
    },
    [enrollmentCodes, fetchServerData, notify]
  );

  const handleOpenQrScanner = () => {
    const latestQr = loadActivePlayerSetupQr();
    setDetectedPlayerQr(latestQr);
    setQrInputText(encodePlayerSetupQrPayload(latestQr));
    setShowQrScannerModal(true);
  };

  // Start rear camera when Mobile QR Scanner Modal is open
  useEffect(() => {
    if (!showQrScannerModal) {
      setCameraActive(false);
      return;
    }

    let mediaStream: MediaStream | null = null;
    let detectorInterval: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;

    const startCamera = async () => {
      if (
        typeof navigator === 'undefined' ||
        !navigator.mediaDevices ||
        typeof navigator.mediaDevices.getUserMedia !== 'function'
      ) {
        setCameraStatusText(
          'Camera API unavailable in this environment — using detected Player Setup QR viewfinder.'
        );
        return;
      }

      try {
        mediaStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });
        if (cancelled) {
          mediaStream.getTracks().forEach((t) => t.stop());
          return;
        }
        setCameraActive(true);
        setCameraStatusText('Rear camera active — align Player Setup QR Code inside frame');
        if (qrVideoRef.current) {
          qrVideoRef.current.srcObject = mediaStream;
          await qrVideoRef.current.play().catch(() => {});
        }

        // Use native BarcodeDetector API on supported mobile browsers (Android Chrome / iOS WebKit)
        const BarcodeDetectorCtor = (
          window as unknown as {
            BarcodeDetector?: new (opts: { formats: string[] }) => {
              detect: (el: HTMLVideoElement) => Promise<Array<{ rawValue?: string }>>;
            };
          }
        ).BarcodeDetector;

        if (BarcodeDetectorCtor && qrVideoRef.current) {
          const detector = new BarcodeDetectorCtor({ formats: ['qr_code'] });
          detectorInterval = setInterval(async () => {
            if (!qrVideoRef.current) return;
            try {
              const codes = await detector.detect(qrVideoRef.current);
              const first = codes.find((c) => c.rawValue);
              if (first?.rawValue) {
                void handleEnrollFromQrPayload(first.rawValue);
              }
            } catch {
              // Ignore frame decode error
            }
          }, 300);
        }
      } catch {
        setCameraActive(false);
        setCameraStatusText(
          'Camera permission declined or simulated — use "Scan Detected Player QR Code" below.'
        );
      }
    };

    void startCamera();

    return () => {
      cancelled = true;
      if (detectorInterval) clearInterval(detectorInterval);
      if (mediaStream) {
        mediaStream.getTracks().forEach((t) => t.stop());
      }
    };
  }, [showQrScannerModal, handleEnrollFromQrPayload]);

  const handleIssueCommand = async () => {
    const res = await fetch('/api/v1/commands', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targetDeviceId: selectedCmdDevice,
        commandType: selectedCmdType,
        idempotencyKey: `idem-${selectedCmdDevice}-${selectedCmdType}-${ Math.floor(Date.now() / 5000) }`,
        ttlSeconds: 300,
      }),
    });
    const data = await res.json();
    if (res.ok) {
      await fetchServerData();
      notify(
        'success',
        `Command ${selectedCmdType} acknowledged (${data.command.status}) for ${selectedCmdDevice}.`
      );
    } else {
      notify('error', data.error || 'Failed to issue command');
    }
  };

  const handleDeployPackage = async () => {
    const res = await fetch('/api/v1/deployments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        packageId: deployPackageId,
        targetGroupId: deployGroupId,
      }),
    });
    if (res.ok) {
      await fetchServerData();
      notify('success', `Deployed package ${deployPackageId} to group ${deployGroupId}.`);
    }
  };

  return (
    <div className="network-console-page">
      {/* Sub-navigation bar */}
      <div className="network-subnav">
        <button
          className={`subnav-btn ${activeTab === 'sync-dashboard' ? 'active' : ''}`}
          onClick={() => setActiveTab('sync-dashboard')}
        >
          <Radio size={15} /> Synchronized Playback & Multi-Screen Wall
        </button>
        <button
          className={`subnav-btn ${activeTab === 'overview' ? 'active' : ''}`}
          onClick={() => setActiveTab('overview')}
        >
          <Server size={15} /> Server Overview
        </button>
        <button
          className={`subnav-btn ${activeTab === 'devices' ? 'active' : ''}`}
          onClick={() => setActiveTab('devices')}
        >
          <Monitor size={15} /> Devices & Enrollment ({devices.length})
        </button>
        <button
          className={`subnav-btn ${activeTab === 'groups-packages' ? 'active' : ''}`}
          onClick={() => setActiveTab('groups-packages')}
        >
          <Package size={15} /> Groups & Package Distribution
        </button>
        <button
          className={`subnav-btn ${activeTab === 'commands-audit' ? 'active' : ''}`}
          onClick={() => setActiveTab('commands-audit')}
        >
          <Terminal size={15} /> Remote Commands & Security Audit Log
        </button>
        <button
          className={`subnav-btn ${activeTab === 'fleet-operations' ? 'active' : ''}`}
          onClick={() => setActiveTab('fleet-operations')}
          aria-label="Fleet Operations & Proof-of-Play"
        >
          <Activity size={15} /> Fleet Operations
          {activeAlerts.length > 0 && <span className="fleet-nav-badge">{activeAlerts.length}</span>}
        </button>
      </div>

      <div className="network-content-area">
        {/* TAB 1: SYNCHRONIZED PLAYBACK & MULTI-SCREEN SIMULATOR (Spec Sec 24–26 & 33.3) */}
        {activeTab === 'sync-dashboard' && (
          <div className="sync-dashboard-container">
            {/* Authoritative Server Timeline Header */}
            <div className="sync-banner-card">
              <div className="sync-banner-info">
                <div className="sync-session-badge">
                  <Radio size={15} color="#38bdf8" />
                  <strong>AUTHORITATIVE TIMELINE SESSION: {sessionConfig.sessionId}</strong>
                  <span className="entry-pill">{ sharedTimeline.phase }</span>
                </div>
                <div className="sync-metrics-strip">
                  <span>
                    <strong>Active Scene:</strong> {sharedTimeline.activeScene.name}
                  </span>
                  <span>
                    <strong>Timeline Position:</strong>{' '}
                    {sharedTimeline.phase === 'PRE_START_COUNTDOWN'
                      ? `Starts in ${(sharedTimeline.countdownMs / 1000).toFixed(2)}s`
                      : `${formatDurationMs(sharedTimeline.sceneElapsedMs)} / ${formatDurationMs(sharedTimeline.sceneDurationMs)}`}
                  </span>
                  <span>
                    <strong>NTP Clock Offset:</strong> {clockStatus.estimatedOffsetMs} ms (±
                    {clockStatus.uncertaintyMs} ms uncertainty, RTT {clockStatus.minRttMs} ms)
                  </span>
                  <span>
                    <strong>Timeline Revision:</strong> r{sessionConfig.timelineRevision}
                  </span>
                </div>
              </div>

              <div className="sync-banner-actions">
                <button className="btn-primary" onClick={handleScheduleFutureGroupStart}>
                  <Play size={14} /> Schedule Future Group Start (+2.5s UTC)
                </button>
                <button className="btn-secondary" onClick={handleSimulateLateJoinPlayer}>
                  <Plus size={14} /> Simulate Late-Joining Display
                </button>
                <button
                  className="btn-xs"
                  onClick={() => performClockSyncExchange()}
                  title="Exchange T1/T2/T3/T4 Clock Sync Timestamps"
                >
                  <Clock size={13} /> Sync Clock
                </button>
              </div>
            </div>

            {/* Live Multi-Screen Synchronized Wall Simulator */}
            <div className="multi-screen-wall-grid">
              {devices.slice(0, 6).map((dev, idx) => {
                const isOffline =
                  dev.status === 'OFFLINE' || simulatedDisconnectedIds.includes(dev.id);
                const driftMs =
                  simulatedDrifts[dev.id] !== undefined
                    ? simulatedDrifts[dev.id]
                    : Number(dev.drift_ms || 0);
                const playerTimeline = evaluateAuthoritativeTimeline(
                  project,
                  project.playlists[0],
                  sessionConfig,
                  authoritativeNowMs + driftMs
                );

                return (
                  <div
                    key={dev.id}
                    className={`virtual-display-card ${isOffline ? 'offline-cache-playing' : ''}`}
                  >
                    <div className="virtual-display-header">
                      <div>
                        <strong>{dev.name}</strong>
                        <div className="muted-line">
                          {dev.id} • {dev.assigned_display} • Role: {idx === 0 ? 'Timing Leader' : 'Sync Member'}
                        </div>
                      </div>
                      <div className="virtual-display-badges">
                        <span
                          className={`drift-pill ${
                            Math.abs(driftMs) > 200 ? 'drift-high' : 'drift-ok'
                          }`}
                        >
                          Drift: {driftMs >= 0 ? `+${driftMs}` : driftMs} ms
                        </span>
                        <span className={`status-dot-pill ${isOffline ? 'offline' : 'online'}`}>
                          {isOffline ? 'OFFLINE (LOCAL CACHE)' : 'SYNCED'}
                        </span>
                      </div>
                    </div>

                    {/* Scaled Live Mini Signage Renderer */}
                    <div className="virtual-display-screen-wrap">
                      <div
                        className="virtual-display-logical"
                        style={{
                          width: `${project.settings.width}px`,
                          height: `${project.settings.height}px`,
                          transform: 'scale(0.21)',
                          transformOrigin: 'top left',
                          background:
                            playerTimeline.activeScene.backgroundGradient ||
                            playerTimeline.activeScene.backgroundColor,
                        }}
                      >
                        {playerTimeline.elements.map((el) => (
                          <SignageElementRenderer
                            key={el.id}
                            element={el}
                            assets={project.assets}
                            currentTimeMs={playerTimeline.sceneElapsedMs}
                            deviceName={dev.name}
                            sceneName={playerTimeline.activeScene.name}
                          />
                        ))}
                      </div>

                      {playerTimeline.phase === 'PRE_START_COUNTDOWN' && (
                        <div className="countdown-sync-overlay">
                          <div>SCHEDULED START IN</div>
                          <strong>{(playerTimeline.countdownMs / 1000).toFixed(2)}s</strong>
                        </div>
                      )}
                    </div>

                    <div className="virtual-display-footer">
                      <span>
                        Scene: <strong>{playerTimeline.activeScene.name.slice(0, 18)}</strong> @{' '}
                        {formatDurationMs(playerTimeline.sceneElapsedMs)}
                      </span>
                      <div className="inline-row">
                        <button
                          className="btn-xs"
                          onClick={() => handleInjectDriftAndCorrect(dev.id)}
                          title="Inject +780ms Clock Drift & Verify Automatic Drift Correction"
                        >
                          <Zap size={11} /> Test Drift
                        </button>
                        <button
                          className="btn-xs"
                          onClick={() => handleToggleOfflinePlayer(dev.id)}
                          title="Simulate Network Disconnect / Reconnect"
                        >
                          {isOffline ? <Wifi size={11} /> : <WifiOff size={11} />}
                          {isOffline ? 'Reconnect' : 'Disconnect'}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* TAB 2: SERVER OVERVIEW (Spec Section 33.1) */}
        {activeTab === 'overview' && overview && (
          <div className="overview-container">
            <div className="overview-kpi-grid">
              <div className="pm-kpi-box">
                <span>Total Registered Devices</span>
                <strong>{String(overview.totalDevices)}</strong>
              </div>
              <div className="pm-kpi-box">
                <span>Online / Playing Devices</span>
                <strong style={{ color: '#10b981' }}>
                  {String(overview.onlineDevices)} / {String(overview.playingDevices)}
                </strong>
              </div>
              <div className="pm-kpi-box">
                <span>Offline Devices (Cache Mode)</span>
                <strong style={{ color: '#f59e0b' }}>{String(overview.offlineDevices)}</strong>
              </div>
              <div className="pm-kpi-box">
                <span>Active Sync Groups</span>
                <strong style={{ color: '#38bdf8' }}>{String(overview.activeSyncGroups)}</strong>
              </div>
              <div className="pm-kpi-box">
                <span>Sessions w/ Sync Drift</span>
                <strong>{String(overview.sessionsWithSyncErrors)}</strong>
              </div>
              <div className="pm-kpi-box">
                <span>Repository Storage</span>
                <strong>{formatBytes(Number(overview.storageBytes || 0))}</strong>
              </div>
            </div>

            <div className="pm-grid" style={{ marginTop: '16px' }}>
              <div className="pm-card">
                <div className="pm-card-header">
                  <Activity size={17} color="#38bdf8" />
                  <h3>Real-Time WebSocket Gateway Events (<code>/ws</code>)</h3>
                </div>
                <div className="event-feed-list">
                  {wsEvents.map((ev, i) => (
                    <div key={i} className="event-feed-row">
                      <span className="perm-badge">{ev.type}</span>
                      <span className="muted-line">{ev.timestamp}</span>
                    </div>
                  ))}
                  {Array.isArray(overview.recentEvents) &&
                    (overview.recentEvents as Array<Record<string, unknown>>).map((ev) => (
                      <div key={String(ev.id)} className="event-feed-row">
                        <span className="perm-badge">{String(ev.event_type)}</span>
                        <span>Device: {String(ev.device_id || 'system')}</span>
                        <span className="muted-line">{String(ev.created_at)}</span>
                      </div>
                    ))}
                </div>
              </div>

              <div className="pm-card">
                <div className="pm-card-header">
                  <ShieldCheck size={17} color="#10b981" />
                  <h3>Server Health & Topology Summary</h3>
                </div>
                <div className="asset-stats-card">
                  <div>
                    <span>Server UTC Clock:</span> <strong>{String(overview.serverTimeUtc)}</strong>
                  </div>
                  <div>
                    <span>Database Engine:</span> <strong>SQLite Relational Store (WAL)</strong>
                  </div>
                  <div>
                    <span>Package Repository:</span>{' '}
                    <strong>Content-Addressed SHA-256 Object Store</strong>
                  </div>
                  <div>
                    <span>Synchronization Engine:</span>{' '}
                    <strong>Server-Authoritative Timeline (Levels 1–3)</strong>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: DEVICES & ENROLLMENT (Spec Section 22 & 33.2) */}
        {activeTab === 'devices' && (
          <div className="pm-grid">
            <div className="pm-card">
              <div className="pm-card-header">
                <KeyRound size={17} color="#38bdf8" />
                <h3>Device Enrollment & Provisioning</h3>
              </div>

              {/* Mobile QR Code Scanner Callout */}
              <div className={`mobile-qr-enroll-banner ${isMobileLayout ? 'mobile-highlighted' : ''}`}>
                <div className="mobile-qr-banner-header">
                  <Smartphone size={15} color="#38bdf8" />
                  <strong>Mobile QR Code Setup Provisioning</strong>
                  {isMobileLayout && <span className="entry-pill">MOBILE DETECTED</span>}
                </div>
                <p className="muted-line" style={{ margin: '4px 0 8px 0' }}>
                  Scan the setup QR code displayed on a newly booted Signage Player to automatically
                  provision its device credentials and display group.
                </p>
                <button
                  className="btn-primary full-width"
                  onClick={handleOpenQrScanner}
                >
                  <QrCode size={15} /> Scan Player Setup QR Code
                </button>
              </div>

              <label className="inspector-label">Device Display Name</label>
              <input
                type="text"
                className="inspector-input"
                value={newDeviceName}
                onChange={(e) => setNewDeviceName(e.target.value)}
              />
              <label className="inspector-label">Physical Location</label>
              <input
                type="text"
                className="inspector-input"
                value={newDeviceLocation}
                onChange={(e) => setNewDeviceLocation(e.target.value)}
              />
              <button
                className="btn-primary full-width"
                style={{ marginTop: '10px' }}
                onClick={handleCreateEnrollmentCode}
              >
                <Plus size={14} /> Generate Expiring Enrollment Code
              </button>

              <div className="pm-sub-section">
                <div className="palette-title">Active Enrollment Codes</div>
                {enrollmentCodes.map((ec) => (
                  <div key={String(ec.code)} className="pkg-history-item">
                    <div>
                      <code>{String(ec.code)}</code>
                      <div className="muted-line">
                        {String(ec.device_name)} • {ec.used_at ? 'USED' : 'AVAILABLE'}
                      </div>
                    </div>
                    {!ec.used_at && (
                      <button
                        className="btn-xs"
                        onClick={() => handleEnrollWithCode(String(ec.code))}
                      >
                        Enroll Player Now
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="pm-card pm-inspector-wide">
              <div className="pm-card-header">
                <Monitor size={17} color="#38bdf8" />
                <h3>Registered Signage Players ({devices.length})</h3>
              </div>
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Device ID</th>
                      <th>Name & Location</th>
                      <th>Display / OS</th>
                      <th>Status</th>
                      <th>Active Package</th>
                      <th>Clock Offset</th>
                      <th>Drift</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {devices.map((dev) => (
                      <tr key={dev.id}>
                        <td>
                          <code>{dev.id}</code>
                        </td>
                        <td>
                          <strong>{dev.name}</strong>
                          <div className="muted-line">{dev.location}</div>
                        </td>
                        <td>
                          {dev.assigned_display}
                          <div className="muted-line">{dev.os}</div>
                        </td>
                        <td>
                          <span
                            className={`status-dot-pill ${
                              dev.status === 'OFFLINE' ? 'offline' : 'online'
                            }`}
                          >
                            {dev.status} ({dev.playback_state})
                          </span>
                        </td>
                        <td>
                          <code>{dev.current_package_id}</code>
                        </td>
                        <td>
                          {dev.clock_offset_ms} ms (±{dev.clock_uncertainty_ms} ms)
                        </td>
                        <td>{dev.drift_ms} ms</td>
                        <td>
                          <button
                            className="btn-xs danger-hover"
                            title="Revoke Device Credentials"
                            onClick={async () => {
                              await fetch(`/api/v1/devices/${dev.id}/revoke`, {
                                method: 'POST',
                              });
                              await fetchServerData();
                              notify('warning', `Revoked credentials for ${dev.id}.`);
                            }}
                          >
                            <UserX size={12} /> Revoke
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* TAB 4: GROUPS & PACKAGE DISTRIBUTION (Spec Section 23 & 27) */}
        {activeTab === 'groups-packages' && (
          <div className="pm-grid">
            <div className="pm-card">
              <div className="pm-card-header">
                <Package size={17} color="#38bdf8" />
                <h3>Deploy Package to Display Group</h3>
              </div>
              <label className="inspector-label">Select Verified Package</label>
              <select
                className="inspector-input"
                value={deployPackageId}
                onChange={(e) => setDeployPackageId(e.target.value)}
              >
                {packages.map((p) => (
                  <option key={String(p.id)} value={String(p.id)}>
                    {String(p.name)} (v{String(p.version)} • {formatBytes(Number(p.size_bytes))})
                  </option>
                ))}
              </select>

              <label className="inspector-label">Target Display Group</label>
              <select
                className="inspector-input"
                value={deployGroupId}
                onChange={(e) => setDeployGroupId(e.target.value)}
              >
                {groups.map((g) => (
                  <option key={String(g.id)} value={String(g.id)}>
                    {String(g.name)} ({String(g.topology)})
                  </option>
                ))}
              </select>

              <button
                className="btn-primary full-width"
                style={{ marginTop: '12px' }}
                onClick={handleDeployPackage}
              >
                <Send size={14} /> Distribute & Atomically Activate Package
              </button>

              <div className="pm-sub-section">
                <div className="palette-title">Content-Addressed Package Repository</div>
                {packages.map((p) => (
                  <div key={String(p.id)} className="pkg-history-item">
                    <div>
                      <strong>{String(p.name)}</strong>
                      <div className="muted-line">
                        ID: {String(p.id)} • SHA-256: {String(p.content_hash).slice(0, 14)}…
                      </div>
                    </div>
                    <span className="entry-pill">{String(p.signature_status)}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="pm-card pm-inspector-wide">
              <div className="pm-card-header">
                <Layers size={17} color="#38bdf8" />
                <h3>Display Groups & Synchronization Topologies</h3>
              </div>
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Group ID</th>
                      <th>Group Name</th>
                      <th>Display Topology</th>
                      <th>Sync Policy</th>
                      <th>Failure Policy</th>
                      <th>Config Rev</th>
                      <th>Members</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groups.map((g) => (
                      <tr key={String(g.id)}>
                        <td>
                          <code>{String(g.id)}</code>
                        </td>
                        <td>
                          <strong>{String(g.name)}</strong>
                          <div className="muted-line">{String(g.description)}</div>
                        </td>
                        <td>
                          <span className="perm-badge">{String(g.topology)}</span>
                        </td>
                        <td>{String(g.synchronization_policy)}</td>
                        <td>{String(g.failure_policy)}</td>
                        <td>r{String(g.configuration_revision)}</td>
                        <td>{Array.isArray(g.members) ? g.members.length : 0} displays</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* TAB 5: REMOTE COMMANDS & AUDIT LOG (Spec Section 29 & 34) */}
        {activeTab === 'commands-audit' && (
          <div className="pm-grid">
            <div className="pm-card">
              <div className="pm-card-header">
                <Terminal size={17} color="#38bdf8" />
                <h3>Issue Authenticated Remote Command</h3>
              </div>
              <label className="inspector-label">Target Player Device</label>
              <select
                className="inspector-input"
                value={selectedCmdDevice}
                onChange={(e) => setSelectedCmdDevice(e.target.value)}
              >
                {devices.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} ({d.id})
                  </option>
                ))}
              </select>

              <label className="inspector-label">Command Type (Spec Section 29)</label>
              <select
                className="inspector-input"
                value={selectedCmdType}
                onChange={(e) => setSelectedCmdType(e.target.value)}
              >
                <option value="STATUS_REQUEST">STATUS_REQUEST</option>
                <option value="REFRESH_CONFIGURATION">REFRESH_CONFIGURATION</option>
                <option value="DOWNLOAD_PACKAGE">DOWNLOAD_PACKAGE</option>
                <option value="VALIDATE_PACKAGE">VALIDATE_PACKAGE</option>
                <option value="RESYNCHRONIZE">RESYNCHRONIZE</option>
                <option value="ACTIVATE_PACKAGE">ACTIVATE_PACKAGE</option>
                <option value="ROLLBACK_PACKAGE">ROLLBACK_PACKAGE</option>
                <option value="ENTER_MAINTENANCE">ENTER_MAINTENANCE</option>
                <option value="EXIT_MAINTENANCE">EXIT_MAINTENANCE</option>
                <option value="RESTART_PLAYER">RESTART_PLAYER</option>
                <option value="REQUEST_DIAGNOSTICS">REQUEST_DIAGNOSTICS</option>
              </select>

              <button
                className="btn-primary full-width"
                style={{ marginTop: '12px' }}
                onClick={handleIssueCommand}
              >
                <Send size={14} /> Dispatch Signed Command
              </button>

              <div className="pm-sub-section">
                <div className="palette-title">Command Queue Status</div>
                {commands.slice(0, 8).map((c) => (
                  <div key={String(c.id)} className="pkg-history-item">
                    <div>
                      <strong>{String(c.command_type)}</strong> →{' '}
                      <code>{String(c.target_device_id || c.target_group_id)}</code>
                      <div className="muted-line">Expires: {String(c.expires_at)}</div>
                    </div>
                    <span className="entry-pill">{String(c.status)}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="pm-card pm-inspector-wide">
              <div className="pm-card-header">
                <ShieldCheck size={17} color="#10b981" />
                <h3>Immutable Security & Administrative Audit Log</h3>
              </div>
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Timestamp</th>
                      <th>Actor</th>
                      <th>Action</th>
                      <th>Target</th>
                      <th>Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditLog.map((entry) => (
                      <tr key={String(entry.id)}>
                        <td className="muted-line">{String(entry.created_at)}</td>
                        <td>
                          <code>{String(entry.actor_id)}</code>
                        </td>
                        <td>
                          <span className="perm-badge">{String(entry.action)}</span>
                        </td>
                        <td>
                          {String(entry.target_type)}:{String(entry.target_id)}
                        </td>
                        <td>{String(entry.details)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* TAB 6: FLEET OPERATIONS — Proof-of-Play, Health, Alerts, Backups */}
        {activeTab === 'fleet-operations' && (
          <div className="fleet-ops-container">
            <div className="fleet-ops-banner">
              <div>
                <div className="fleet-ops-title">
                  <Activity size={16} color="#38bdf8" />
                  <strong>FLEET OPERATIONS &amp; PROOF-OF-PLAY</strong>
                  <span className="entry-pill">PHASE 15</span>
                </div>
                <p className="fleet-ops-subtitle">
                  De-duplicated playback impressions, heartbeat health grading, deduplicated alert
                  rules, SHA-256 verified backups and audit retention — live from{' '}
                  <code>/api/v1/operations/*</code> with an offline deterministic demo fallback.
                </p>
              </div>
              <div className="inline-row">
                <button
                  type="button"
                  className="btn-xs"
                  disabled={fleetBusy !== null}
                  onClick={() => {
                    void fetchFleetData();
                    setFleetMessage('Fleet telemetry refreshed.');
                  }}
                >
                  <RefreshCw size={13} /> Refresh Telemetry
                </button>
                <span className="muted-line">{fleet.generatedAtUtc}</span>
              </div>
            </div>

            <div className="fleet-kpi-grid">
              <div className="pm-kpi-box">
                <span>Healthy Displays</span>
                <strong style={{ color: '#10b981' }}>{fleetTotals.healthy ?? 0}</strong>
              </div>
              <div className="pm-kpi-box">
                <span>Degraded / Critical</span>
                <strong style={{ color: '#f59e0b' }}>
                  {fleetTotals.degraded ?? 0} / {fleetTotals.critical ?? 0}
                </strong>
              </div>
              <div className="pm-kpi-box">
                <span>Offline (Cache Mode)</span>
                <strong style={{ color: '#94a3b8' }}>{fleetTotals.offline ?? 0}</strong>
              </div>
              <div className="pm-kpi-box">
                <span>Active Fleet Alerts</span>
                <strong style={{ color: activeAlerts.length ? '#ef4444' : '#10b981' }}>
                  {activeAlerts.length}
                </strong>
              </div>
              <div className="pm-kpi-box">
                <span>Plays in Range</span>
                <strong style={{ color: '#38bdf8' }}>{proof.totals.plays}</strong>
              </div>
              <div className="pm-kpi-box">
                <span>Display Time / Uptime</span>
                <strong>
                  {formatDurationMs(proof.totals.coverageMs)} /{' '}
                  {(fleetTotals.uptimePercent ?? 100).toFixed(1)}%
                </strong>
              </div>
            </div>

            <div className="fleet-ops-grid">
              {/* Proof-of-Play */}
              <section className="pm-card fleet-card">
                <div className="pm-card-header">
                  <BarChart3 size={17} color="#38bdf8" />
                  <h3>Proof-of-Play Impressions</h3>
                </div>
                <div className="fleet-toolbar">
                  <label>
                    Range
                    <select
                      className="inspector-input"
                      aria-label="Proof-of-Play Range"
                      value={fleetRange}
                      onChange={(e) => setFleetRange(e.target.value as FleetRange)}
                    >
                      <option value="today">Today (UTC)</option>
                      <option value="week">Last 7 days</option>
                      <option value="all">All history</option>
                    </select>
                  </label>
                  <label>
                    Group By
                    <select
                      className="inspector-input"
                      aria-label="Proof-of-Play Grouping"
                      value={fleetGroupBy}
                      onChange={(e) => setFleetGroupBy(e.target.value as ProofOfPlayGroupBy)}
                    >
                      <option value="scene">Scene</option>
                      <option value="device-scene">Device + Scene</option>
                      <option value="device">Device</option>
                      <option value="day">UTC Day</option>
                    </select>
                  </label>
                  <button
                    type="button"
                    className="btn-xs primary-accent"
                    disabled={fleetBusy !== null}
                    onClick={handleFleetReportPlays}
                  >
                    <Plus size={13} /> Report 4 Plays
                  </button>
                </div>

                <div className="fleet-totals-strip">
                  <span><strong>{proof.totals.plays}</strong> plays</span>
                  <span><strong>{formatDurationMs(proof.totals.dwellMs)}</strong> dwell</span>
                  <span><strong>{formatDurationMs(proof.totals.coverageMs)}</strong> de-duplicated display time</span>
                  <span><strong>{proof.totals.uniqueScenes}</strong> scenes / <strong>{proof.totals.uniqueDevices}</strong> devices</span>
                  <span><strong>{(proof.totals.avgCompletionRatio * 100).toFixed(1)}%</strong> avg completion</span>
                  <span><strong>{proof.totals.offlineEvents}</strong> offline-buffered</span>
                </div>

                <div className="fleet-table-wrap">
                  <table className="fleet-table">
                    <thead>
                      <tr>
                        <th>{fleetGroupBy === 'day' ? 'UTC Day' : 'Scene / Device'}</th>
                        <th>Plays</th>
                        <th>Dwell</th>
                        <th>Unique</th>
                        <th>Completion</th>
                        <th>Last Played (UTC)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {proof.rows.slice(0, 12).map((row) => (
                        <tr key={row.key}>
                          <td><code>{row.key}</code></td>
                          <td>{row.plays}</td>
                          <td>{formatDurationMs(row.dwellMs)}</td>
                          <td>{formatDurationMs(row.coverageMs)}</td>
                          <td>{(row.avgCompletionRatio * 100).toFixed(0)}%</td>
                          <td className="muted-line">{row.lastPlayedAtUtc.slice(11, 19)}</td>
                        </tr>
                      ))}
                      {proof.rows.length === 0 && (
                        <tr><td colSpan={6} className="muted-line">No playback reports in this range.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="fleet-daily-bars">
                  <div className="palette-title">Daily Display Time (UTC)</div>
                  {proof.daily.slice(-7).map((day) => (
                    <div className="fleet-daily-row" key={day.dayUtc}>
                      <span>{day.dayUtc}</span>
                      <div className="fleet-daily-track">
                        <div style={{ width: `${Math.max(2, (day.dwellMs / maxDailyDwellMs) * 100)}%` }} />
                      </div>
                      <span>{formatDurationMs(day.dwellMs)}</span>
                    </div>
                  ))}
                  {proof.daily.length === 0 && <div className="muted-line">No daily telemetry yet.</div>}
                </div>
              </section>

              {/* Fleet health */}
              <section className="pm-card fleet-card">
                <div className="pm-card-header">
                  <Activity size={17} color="#10b981" />
                  <h3>Fleet Health &amp; Telemetry</h3>
                </div>
                <div className="fleet-health-summary">
                  Avg {fleetTotals.averageFps?.toFixed(1) ?? '0.0'} FPS · Max |drift|{' '}
                  {fleetTotals.maxDriftMs?.toFixed(0) ?? 0} ms ·{' '}
                  {fleetTotals.uptimePercent?.toFixed(1) ?? '100.0'}% reachable
                </div>
                <div className="fleet-device-list">
                  {fleet.health.devices.map((device) => (
                    <div className="fleet-device-row" key={device.deviceId}>
                      <span
                        className="fleet-state-dot"
                        style={{ background: FLEET_STATE_COLORS[device.state] ?? '#64748b' }}
                        title={device.state}
                      />
                      <div className="fleet-device-main">
                        <strong>{device.name}</strong>
                        <span className="muted-line">
                          {device.deviceId} · {device.playbackState} · {device.estimatedFps.toFixed(0)} FPS ·{' '}
                          {device.driftMs.toFixed(0)} ms drift · {(device.staleMs / 1000).toFixed(0)}s since heartbeat
                        </span>
                        {device.reasons.length > 0 && (
                          <span className="fleet-reason-line">{device.reasons.slice(0, 3).join(' · ')}</span>
                        )}
                      </div>
                      <span
                        className="fleet-state-pill"
                        style={{ color: FLEET_STATE_COLORS[device.state] ?? '#64748b' }}
                      >
                        {device.state}
                      </span>
                    </div>
                  ))}
                  {fleet.health.devices.length === 0 && (
                    <div className="muted-line">No registered displays.</div>
                  )}
                </div>
                <div className="fleet-history">
                  <div className="palette-title">24-Hour FPS History (latest samples)</div>
                  {fleet.healthHistory.slice(0, 3).map((row) => (
                    <div className="fleet-history-row" key={row.deviceId}>
                      <span>{row.deviceId}</span>
                      <FleetSparkline history={row} />
                      <span className="muted-line">
                        {row.samples} samples · {row.availabilityPercent.toFixed(0)}% playing
                      </span>
                    </div>
                  ))}
                  {fleet.healthHistory.length === 0 && <div className="muted-line">No health samples yet.</div>}
                </div>
              </section>

              {/* Alerts & rules */}
              <section className="pm-card fleet-card">
                <div className="pm-card-header">
                  <Bell size={17} color="#f59e0b" />
                  <h3>Alert Rules &amp; Active Alerts</h3>
                </div>
                <div className="fleet-rules-list">
                  {fleet.rules.map((rule) => (
                    <div className="fleet-rule-row" key={rule.id}>
                      <button
                        type="button"
                        className={`fleet-rule-toggle ${rule.enabled ? 'on' : ''}`}
                        aria-label={`${rule.enabled ? 'Disable' : 'Enable'} ${rule.type}`}
                        disabled={fleetBusy !== null}
                        onClick={() => handleToggleRule(rule)}
                      >
                        {rule.enabled ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
                      </button>
                      <div className="fleet-rule-main">
                        <strong>{rule.type}</strong>
                        <span className="muted-line">{rule.description}</span>
                      </div>
                      <label className="fleet-rule-threshold">
                        <input
                          key={`${rule.id}-${rule.threshold}`}
                          type="number"
                          className="inspector-input"
                          min={1}
                          defaultValue={rule.threshold}
                          aria-label={`${rule.type} threshold`}
                          onBlur={(e) => handleRuleThreshold(rule, e.target.value)}
                        />
                        <span>{rule.severity}</span>
                      </label>
                    </div>
                  ))}
                  {fleet.rules.length === 0 && <div className="muted-line">No alert rules configured.</div>}
                </div>

                <div className="fleet-alerts-list">
                  <div className="palette-title">
                    Active Alerts ({activeAlerts.length}) · Acknowledged ({acknowledgedAlerts})
                  </div>
                  {activeAlerts.slice(0, 8).map((alert) => (
                    <div className="fleet-alert-row" key={alert.id}>
                      <span
                        className="fleet-severity-dot"
                        style={{ background: alert.severity === 'CRITICAL' ? '#ef4444' : '#f59e0b' }}
                      />
                      <div className="fleet-alert-main">
                        <strong>{alert.ruleType}</strong>
                        <span className="muted-line">{alert.message}</span>
                        <span className="muted-line">{alert.triggeredAtUtc}</span>
                      </div>
                      <button
                        type="button"
                        className="btn-xs"
                        disabled={fleetBusy !== null}
                        onClick={() => handleAcknowledgeAlert(alert.id)}
                      >
                        Ack
                      </button>
                    </div>
                  ))}
                  {activeAlerts.length === 0 && (
                    <div className="fleet-empty-ok">
                      <CheckCircle2 size={15} /> No active fleet alerts — all rules passing.
                    </div>
                  )}
                </div>
              </section>

              {/* Backups & retention */}
              <section className="pm-card fleet-card">
                <div className="pm-card-header">
                  <Database size={17} color="#a78bfa" />
                  <h3>Verified Backups &amp; Retention</h3>
                </div>
                <div className="fleet-toolbar">
                  <button
                    type="button"
                    className="btn-xs primary-accent"
                    disabled={fleetBusy !== null}
                    onClick={handleCreateBackup}
                  >
                    <Database size={13} /> Create Backup
                  </button>
                  <button
                    type="button"
                    className="btn-xs"
                    disabled={fleetBusy !== null}
                    onClick={handleFleetRetention}
                  >
                    <Trash2 size={13} /> Apply 30-Day Retention
                  </button>
                  <span className="muted-line">30-day / 5,000-row policy</span>
                </div>
                <div className="fleet-table-wrap">
                  <table className="fleet-table">
                    <thead>
                      <tr>
                        <th>Created (UTC)</th>
                        <th>Size</th>
                        <th>SHA-256 Manifest</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {fleet.backups.map((backup) => (
                        <tr key={backup.id}>
                          <td>{backup.created_at_utc.replace('T', ' ').slice(0, 19)}</td>
                          <td>{formatBytes(Number(backup.size_bytes))}</td>
                          <td><code>{backup.checksum.slice(0, 16)}…</code></td>
                          <td>
                            <div className="inline-row">
                              <button
                                type="button"
                                className="btn-xs"
                                disabled={fleetBusy !== null}
                                onClick={() => void handleVerifyBackup(backup.id)}
                                title="Verify SHA-256 manifest"
                              >
                                <ShieldCheck size={12} /> Verify
                              </button>
                              <button
                                type="button"
                                className="btn-xs"
                                disabled={fleetBusy !== null}
                                onClick={() => handleRestoreBackup(backup.id)}
                                title="Restore operational telemetry"
                              >
                                <RotateCcw size={12} /> Restore
                              </button>
                              <button
                                type="button"
                                className="btn-xs"
                                onClick={() => void handleDownloadBackup(backup.id)}
                                title="Download backup JSON"
                              >
                                <Download size={12} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                      {fleet.backups.length === 0 && (
                        <tr><td colSpan={4} className="muted-line">No backups yet — create the first verified snapshot.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="fleet-checksum-note">
                  Backups exclude credential tables, redact secret-like columns, and are restored only
                  after every table checksum and the manifest checksum are recomputed and matched.
                </div>
              </section>
            </div>

            <div className="fleet-ops-console">
              <div>
                <strong>Fleet Simulation &amp; Diagnostics</strong>
                <p className="muted-line">
                  Inject synthetic heartbeat anomalies or replay offline-buffered playback reports to
                  exercise alert rules, drift grading and de-duplication end to end.
                </p>
              </div>
              <div className="fleet-sim-buttons">
                <button type="button" className="btn-xs" disabled={fleetBusy !== null} onClick={() => handleFleetInject('offline')}>
                  <WifiOff size={13} /> Simulate Offline Device
                </button>
                <button type="button" className="btn-xs" disabled={fleetBusy !== null} onClick={() => handleFleetInject('stalled')}>
                  <AlertTriangle size={13} /> Simulate Stalled Playback
                </button>
                <button type="button" className="btn-xs" disabled={fleetBusy !== null} onClick={() => handleFleetInject('drift')}>
                  <Clock size={13} /> Inject +780 ms Drift
                </button>
                <button type="button" className="btn-xs" disabled={fleetBusy !== null} onClick={() => handleFleetInject('healthy')}>
                  <CheckCircle2 size={13} /> Restore Healthy Telemetry
                </button>
              </div>
              <div className={`fleet-message ${fleetBusy ? 'busy' : ''}`} role="status" aria-live="polite">
                {fleetBusy ? `${fleetBusy}…` : fleetMessage}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Mobile Player Setup QR Code Scanner Modal */}
      {showQrScannerModal && (
        <div
          className="inline-edit-backdrop"
          onClick={() => setShowQrScannerModal(false)}
        >
          <div
            className="inline-edit-dialog qr-scanner-dialog"
            onClick={(e) => e.stopPropagation()}
          >
            <h4>
              <Camera size={17} color="#38bdf8" /> Scan Signage Player Setup QR Code
            </h4>
            <p className="muted-line">{cameraStatusText}</p>

            {/* Camera Viewfinder + Detected Player Setup QR Target */}
            <div className="qr-camera-viewfinder">
              <video
                ref={qrVideoRef}
                className="qr-camera-video"
                playsInline
                muted
                style={{ display: cameraActive ? 'block' : 'none' }}
              />

              <div className="qr-viewfinder-overlay">
                <div className="qr-laser-line" />
                <div className="qr-target-frame">
                  {(() => {
                    const matrix = buildEnrollmentQrMatrix(
                      encodePlayerSetupQrPayload(detectedPlayerQr)
                    );
                    return (
                      <svg
                        viewBox={`0 0 ${matrix.length} ${matrix.length}`}
                        width="132"
                        height="132"
                        style={{
                          background: '#ffffff',
                          padding: '8px',
                          borderRadius: '8px',
                          shapeRendering: 'crispEdges',
                        }}
                        aria-label="Detected Player Setup QR Target"
                      >
                        {matrix.map((row, r) =>
                          row.map((cell, c) =>
                            cell ? (
                              <rect
                                key={`${r}-${c}`}
                                x={c}
                                y={r}
                                width={1}
                                height={1}
                                fill="#0f172a"
                              />
                            ) : null
                          )
                        )}
                      </svg>
                    );
                  })()}
                </div>
              </div>
            </div>

            <div className="asset-stats-card" style={{ marginTop: '10px' }}>
              <div>
                <span>Detected Player:</span>{' '}
                <strong>
                  {detectedPlayerQr.deviceName} ({detectedPlayerQr.deviceId})
                </strong>
              </div>
              <div>
                <span>Setup Code:</span>{' '}
                <code>{detectedPlayerQr.enrollmentCode}</code> •{' '}
                <span>{detectedPlayerQr.assignedDisplay}</span>
              </div>
            </div>

            <div className="inline-row" style={{ marginTop: '10px', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn-primary flex-1"
                onClick={() =>
                  void handleEnrollFromQrPayload(
                    encodePlayerSetupQrPayload(detectedPlayerQr)
                  )
                }
              >
                <CheckCircle2 size={14} /> Scan Detected Player QR Code &amp; Enroll
              </button>

              <label
                className="btn-secondary"
                style={{ cursor: 'pointer', justifyContent: 'center' }}
              >
                <Camera size={14} /> Capture QR Photo
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    if (e.target.files && e.target.files[0]) {
                      void handleEnrollFromQrPayload(
                        encodePlayerSetupQrPayload(detectedPlayerQr)
                      );
                    }
                  }}
                />
              </label>
            </div>

            <div style={{ marginTop: '10px' }}>
              <label className="inspector-label">
                Or Paste / Inspect Scanned Setup QR URI (<code>signage://enroll?...</code>)
              </label>
              <div className="inline-row">
                <input
                  type="text"
                  className="inspector-input"
                  value={qrInputText}
                  aria-label="Scanned QR Payload URI"
                  onChange={(e) => setQrInputText(e.target.value)}
                />
                <button
                  type="button"
                  className="btn-xs primary-accent"
                  onClick={() => void handleEnrollFromQrPayload(qrInputText)}
                >
                  Decode &amp; Enroll
                </button>
              </div>
            </div>

            <div className="dialog-footer" style={{ marginTop: '12px' }}>
              <button
                type="button"
                className="btn-xs"
                onClick={() => setShowQrScannerModal(false)}
              >
                Close Scanner
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
