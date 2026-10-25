// ============================================================================
// @packages/diagnostics — Structured Diagnostic Logger with Automatic
// Sensitive Credential/Token Redaction & Playback Health Telemetry
// ============================================================================

export type DiagnosticCategory =
  | 'PLAYBACK'
  | 'ARCHIVE'
  | 'SCRIPT'
  | 'NETWORK'
  | 'KIOSK'
  | 'MEDIA'
  | 'ADMIN';

export interface DiagnosticLogEntry {
  id: string;
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  category: DiagnosticCategory;
  message: string;
  metadata?: Record<string, unknown>;
}

const SENSITIVE_KEY_PATTERN = /password|secret|token|credential|authorization|apikey|pin|privatekey/i;

export function sanitizeDiagnosticMetadata(
  input?: Record<string, unknown>
): Record<string, unknown> | undefined {
  if (!input) return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(input)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      out[key] = '[REDACTED]';
    } else if (typeof val === 'string' && /Bearer\s+[A-Za-z0-9._-]+/i.test(val)) {
      out[key] = val.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]');
    } else if (val && typeof val === 'object' && !Array.isArray(val)) {
      out[key] = sanitizeDiagnosticMetadata(val as Record<string, unknown>);
    } else {
      out[key] = val;
    }
  }
  return out;
}

export class DiagnosticsCollector {
  private entries: DiagnosticLogEntry[] = [];
  private maxEntries = 300;

  public log(
    level: DiagnosticLogEntry['level'],
    category: DiagnosticCategory,
    message: string,
    metadata?: Record<string, unknown>
  ): DiagnosticLogEntry {
    const cleanMsg = message.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]');
    const entry: DiagnosticLogEntry = {
      id: `diag-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toISOString(),
      level,
      category,
      message: cleanMsg,
      metadata: sanitizeDiagnosticMetadata(metadata),
    };
    this.entries.unshift(entry);
    if (this.entries.length > this.maxEntries) {
      this.entries.length = this.maxEntries;
    }
    return entry;
  }

  public getEntries(category?: DiagnosticCategory): DiagnosticLogEntry[] {
    if (!category) return [...this.entries];
    return this.entries.filter((e) => e.category === category);
  }

  public clear(): void {
    this.entries = [];
  }
}
