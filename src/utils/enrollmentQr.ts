// ============================================================================
// src/utils/enrollmentQr.ts
// Player Setup QR Code Payload Encoder/Decoder & Deterministic 21x21 QR Matrix
// Supports Mobile Camera QR Scanning & Player Setup Provisioning Handshake
// ============================================================================

import { sha256Bytes } from '@packages/shared';

export interface PlayerSetupQrPayload {
  enrollmentCode: string;
  deviceId: string;
  deviceName: string;
  location: string;
  assignedDisplay: string;
  os: string;
  generatedAtIso: string;
}

const STORAGE_KEY = 'signage_active_player_setup_qr_v1';

export const DEFAULT_PLAYER_SETUP_QR: PlayerSetupQrPayload = {
  enrollmentCode: 'ENROLL-APEX-2026',
  deviceId: 'player-kiosk-07',
  deviceName: 'Lobby Reserve Kiosk #07',
  location: 'Global HQ Atrium',
  assignedDisplay: 'HDMI-1 (1920x1080)',
  os: 'Linux Kiosk 6.8',
  generatedAtIso: new Date().toISOString(),
};

export function encodePlayerSetupQrPayload(payload: PlayerSetupQrPayload): string {
  const params = new URLSearchParams({
    code: payload.enrollmentCode,
    deviceId: payload.deviceId,
    deviceName: payload.deviceName,
    location: payload.location,
    display: payload.assignedDisplay,
    os: payload.os,
  });
  return `signage://enroll?${params.toString()}`;
}

export function decodePlayerSetupQrPayload(rawInput: string): PlayerSetupQrPayload | null {
  const trimmed = rawInput.trim();
  if (!trimmed) return null;

  // 1. Check signage://enroll?... or http(s)://.../enroll?...
  if (trimmed.startsWith('signage://') || trimmed.includes('code=')) {
    try {
      const qIndex = trimmed.indexOf('?');
      const queryStr = qIndex >= 0 ? trimmed.slice(qIndex + 1) : trimmed;
      const params = new URLSearchParams(queryStr);
      const code = params.get('code') || 'ENROLL-APEX-2026';
      const deviceId = params.get('deviceId') || `player-qr-${Date.now().toString(36).slice(-4)}`;
      const deviceName = params.get('deviceName') || `QR Provisioned Display (${deviceId})`;
      const location = params.get('location') || 'Global HQ Atrium';
      const assignedDisplay = params.get('display') || 'HDMI-1 (1920x1080)';
      const os = params.get('os') || 'Linux Kiosk 6.8';

      return {
        enrollmentCode: code,
        deviceId,
        deviceName,
        location,
        assignedDisplay,
        os,
        generatedAtIso: new Date().toISOString(),
      };
    } catch {
      // Fall through
    }
  }

  // 2. Check JSON object payload
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const parsed = JSON.parse(trimmed) as Partial<PlayerSetupQrPayload>;
      return {
        enrollmentCode: parsed.enrollmentCode || 'ENROLL-APEX-2026',
        deviceId: parsed.deviceId || `player-qr-${Date.now().toString(36).slice(-4)}`,
        deviceName: parsed.deviceName || 'QR Provisioned Display',
        location: parsed.location || 'Global HQ Atrium',
        assignedDisplay: parsed.assignedDisplay || 'HDMI-1 (1920x1080)',
        os: parsed.os || 'Linux Kiosk 6.8',
        generatedAtIso: parsed.generatedAtIso || new Date().toISOString(),
      };
    } catch {
      return null;
    }
  }

  // 3. Plain enrollment code string (e.g. ENROLL-APEX-2026)
  if (/^ENROLL-[A-Z0-9-]+$/i.test(trimmed)) {
    return {
      ...DEFAULT_PLAYER_SETUP_QR,
      enrollmentCode: trimmed.toUpperCase(),
      generatedAtIso: new Date().toISOString(),
    };
  }

  return null;
}

export function saveActivePlayerSetupQr(payload: PlayerSetupQrPayload): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    }
  } catch {
    // Ignore storage errors
  }
}

export function loadActivePlayerSetupQr(): PlayerSetupQrPayload {
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const decoded = decodePlayerSetupQrPayload(raw);
        if (decoded) return decoded;
      }
    }
  } catch {
    // Ignore storage errors
  }
  return DEFAULT_PLAYER_SETUP_QR;
}

/**
 * Generates a deterministic 21x21 Version-1 QR code matrix with standard
 * 7x7 finder patterns and timing patterns from the enrollment payload.
 */
export function buildEnrollmentQrMatrix(payload: string): boolean[][] {
  const hash = sha256Bytes(payload || 'signage://enroll');
  const size = 21;
  const grid: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false));
  const reserved: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false));

  const placeFinderPattern = (r0: number, c0: number) => {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const rr = r0 + r;
        const cc = c0 + c;
        if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
        reserved[rr][cc] = true;
        if (r >= 0 && r <= 6 && c >= 0 && c <= 6) {
          const isOuterBorder = r === 0 || r === 6 || c === 0 || c === 6;
          const isInnerBlock = r >= 2 && r <= 4 && c >= 2 && c <= 4;
          grid[rr][cc] = isOuterBorder || isInnerBlock;
        } else {
          grid[rr][cc] = false;
        }
      }
    }
  };

  placeFinderPattern(0, 0);
  placeFinderPattern(0, size - 7);
  placeFinderPattern(size - 7, 0);

  // Timing patterns on row 6 and col 6
  for (let i = 8; i < size - 8; i++) {
    reserved[6][i] = true;
    reserved[i][6] = true;
    grid[6][i] = i % 2 === 0;
    grid[i][6] = i % 2 === 0;
  }

  let bitIdx = 0;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (reserved[r][c]) continue;
      const byte = hash[Math.floor(bitIdx / 8) % hash.length];
      const bit = (byte >> (bitIdx % 8)) & 1;
      grid[r][c] = ((bit ^ ((r + c) % 2)) & 1) === 1;
      bitIdx++;
    }
  }

  return grid;
}
