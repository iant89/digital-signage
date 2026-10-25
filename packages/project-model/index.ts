// ============================================================================
// @packages/project-model — Pure TypeScript Project, Scene, Element & Schedule
// Schemas, Validators, Migrations & Starter Templates (No React dependency)
// ============================================================================

import { createId, sha256Hex, stringToBytes } from '@packages/shared';

export const CURRENT_PROJECT_SCHEMA_VERSION = 1;

export type ScalingMode = 'fit' | 'fill' | 'stretch' | 'contain' | 'crop';
export type OrientationMode = 'landscape' | 'portrait' | 'square';

export interface ResolutionPreset {
  id: string;
  label: string;
  width: number;
  height: number;
  orientation: OrientationMode;
}

export const RESOLUTION_PRESETS: ResolutionPreset[] = [
  { id: 'fhd-landscape', label: 'Full HD Landscape (1920 × 1080)', width: 1920, height: 1080, orientation: 'landscape' },
  { id: 'uhd-4k', label: '4K UHD Landscape (3840 × 2160)', width: 3840, height: 2160, orientation: 'landscape' },
  { id: 'hd-portrait', label: 'HD Portrait (1080 × 1920)', width: 1080, height: 1920, orientation: 'portrait' },
  { id: 'square-1080', label: 'Square Display (1080 × 1080)', width: 1080, height: 1080, orientation: 'square' },
  { id: 'ultrawide-ribbon', label: 'Ultra-Wide Header (2560 × 720)', width: 2560, height: 720, orientation: 'landscape' },
];

export type ElementType =
  | 'text'
  | 'image'
  | 'video'
  | 'audio'
  | 'shape'
  | 'widget'
  | 'group'
  | 'scripted';

export type ShapeKind = 'rectangle' | 'roundedRect' | 'circle' | 'ellipse' | 'line' | 'polygon' | 'diamond';

export type WidgetKind =
  | 'clock'
  | 'date'
  | 'countdown'
  | 'qrcode'
  | 'ticker'
  | 'datafeed'
  | 'weather'
  | 'kpi'
  | 'chart'
  | 'wayfinding'
  | 'queue'
  | 'progress'
  | 'social'
  | 'calendar'
  | 'alert'
  | 'custom';

export type AnimatableProperty =
  | 'x'
  | 'y'
  | 'width'
  | 'height'
  | 'scaleX'
  | 'scaleY'
  | 'rotation'
  | 'opacity'
  | 'backgroundColor'
  | 'color'
  | 'borderRadius'
  | 'textReveal'
  | 'cropProgress'
  | 'volume';

export type EasingFunction =
  | 'linear'
  | 'easeIn'
  | 'easeOut'
  | 'easeInOut'
  | 'bounce'
  | 'elastic'
  | 'step';

export type AnimationPresetName =
  | 'none'
  | 'fade-in'
  | 'fade-out'
  | 'slide-left'
  | 'slide-right'
  | 'slide-up'
  | 'slide-down'
  | 'zoom-in'
  | 'zoom-out'
  | 'pan-drift'
  | 'bounce'
  | 'rotate'
  | 'spin-cw'
  | 'spin-ccw'
  | 'swing'
  | 'pulse'
  | 'float'
  | 'shake'
  | 'flip'
  | 'flip-y'
  | 'skew-slide'
  | 'drop-in'
  | 'spiral-in'
  | 'flash'
  | 'rubber-band'
  | 'typewriter'
  | 'ticker'
  | 'wipe'
  | 'reveal'
  | 'ken-burns';

export type TransitionType = 'none' | 'fade' | 'slide-left' | 'slide-right' | 'slide-up' | 'zoom' | 'wipe';

export type ScriptPermission =
  | 'scene:read'
  | 'element:read'
  | 'text:write'
  | 'visibility:write'
  | 'animation:control'
  | 'scene:transition'
  | 'playlist:select'
  | 'timer:use'
  | 'datafeed:read'
  | 'diagnostics:log';

export interface Keyframe {
  id: string;
  timeMs: number; // Position within scene timeline (ms)
  value: number | string;
  easing: EasingFunction;
  interpolation?: 'linear' | 'smooth' | 'step';
}

export interface AnimationTrack {
  id: string;
  elementId: string;
  property: AnimatableProperty;
  preset?: AnimationPresetName;
  label?: string;
  keyframes: Keyframe[];
  durationMs: number;
  delayMs: number;
  repeatCount: number; // 1 = once, -1 = infinite
  reverse: boolean;
  fillMode: 'none' | 'forwards' | 'backwards' | 'both';
  rotationAngleDeg?: number;
  distancePx?: number;
  scaleFactor?: number;
  locked?: boolean;
  muted?: boolean;
  visible?: boolean;
}

export interface ElementShadow {
  enabled: boolean;
  color: string;
  blur: number;
  offsetX: number;
  offsetY: number;
}

export interface ElementBorder {
  width: number;
  color: string;
  style: 'solid' | 'dashed' | 'dotted';
  radius: number;
}

export interface ElementFilters {
  brightness: number; // 100 default
  contrast: number;   // 100 default
  blur: number;       // 0 default (px)
  grayscale: number;  // 0 default (%)
}

export interface TextProperties {
  text: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: number | 'normal' | 'bold';
  fontStyle?: 'normal' | 'italic';
  color: string;
  gradient?: string;
  textAlign: 'left' | 'center' | 'right' | 'justify';
  verticalAlign?: 'top' | 'middle' | 'bottom';
  letterSpacing: number;
  lineHeight: number;
  outlineColor?: string;
  outlineWidth?: number;
  wrap: boolean;
  autoFit: boolean;
  scrolling: boolean;
  scrollSpeed?: number;
  direction: 'ltr' | 'rtl';
}

export interface MediaProperties {
  assetId: string;
  objectFit: 'contain' | 'cover' | 'fill' | 'none';
  crop?: { x: number; y: number; width: number; height: number };
  maskShape?: 'none' | 'circle' | 'rounded' | 'diamond';
  // Video / Audio specific
  loop?: boolean;
  muted?: boolean;
  volume?: number; // 0..1
  playbackRate?: number;
  trimStartMs?: number;
  trimEndMs?: number;
  startAtMs?: number;
  stopAtMs?: number;
  posterAssetId?: string;
  fadeInMs?: number;
  fadeOutMs?: number;
  audioChannel?: 'stereo' | 'left' | 'right' | 'mono';
  audioScope?: 'scene' | 'multi-scene' | 'environment';
  altText?: string;
}

export type QrContentType =
  | 'link'
  | 'wifi'
  | 'contact'
  | 'email'
  | 'sms'
  | 'phone'
  | 'geo'
  | 'event'
  | 'text';

export type QrErrorCorrectionLevel = 'L' | 'M' | 'Q' | 'H';
export type QrDotStyle = 'square' | 'rounded' | 'dots';

export interface AudioDeletedRegion {
  id: string;
  startMs: number;
  endMs: number;
}

export interface AudioClipConfig {
  id: string;
  name: string;
  assetId: string;
  scope: 'scene' | 'multi-scene' | 'environment';
  sceneIds: string[];
  enabled: boolean;
  loop: boolean;
  volume: number; // 0..1
  channel: 'stereo' | 'left' | 'right' | 'mono';
  startAtMs: number; // timeline start time (ms)
  stopAtMs: number;  // timeline stop time (ms, 0 = until end)
  trimStartMs: number; // crop start within audio file (ms)
  trimEndMs: number;   // crop end within audio file (ms, 0 = full file)
  durationMs: number;  // total source duration (ms)
  fadeInMs: number;
  fadeOutMs: number;
  deletedRegions: AudioDeletedRegion[];
  combinedTrackIds?: string[];
  synthPreset?: 'ambient-pad' | 'corporate-chime' | 'upbeat-pulse' | 'lofi-drone' | 'uploaded';
}

export interface ShapeProperties {
  shapeKind: ShapeKind;
  fillColor: string;
  gradient?: string;
  strokeColor: string;
  strokeWidth: number;
  points?: number; // For polygon
}

export interface WidgetProperties {
  widgetKind: WidgetKind;
  timezone?: string;
  timeFormat?: '12h' | '24h';
  showSeconds?: boolean;
  dateFormat?: string;
  countdownTargetIso?: string;
  countdownLabel?: string;
  qrPayload?: string;
  qrContentType?: QrContentType;
  qrErrorCorrection?: QrErrorCorrectionLevel;
  qrForeground?: string;
  qrBackground?: string;
  qrEyeColor?: string;
  qrDotStyle?: QrDotStyle;
  qrQuietZone?: number;
  qrLabelText?: string;
  qrLogoEnabled?: boolean;
  qrLogoAssetId?: string;
  qrLogoText?: string;
  qrLogoUrl?: string;
  qrLogoSizePercent?: number;
  // Structured QR type fields
  qrWifiSsid?: string;
  qrWifiPassword?: string;
  qrWifiEncryption?: 'WPA' | 'WEP' | 'nopass';
  qrWifiHidden?: boolean;
  qrContactName?: string;
  qrContactOrg?: string;
  qrContactTitle?: string;
  qrContactPhone?: string;
  qrContactEmail?: string;
  qrContactUrl?: string;
  qrEmailTo?: string;
  qrEmailSubject?: string;
  qrEmailBody?: string;
  qrSmsPhone?: string;
  qrSmsMessage?: string;
  qrPhone?: string;
  qrGeoLat?: string;
  qrGeoLng?: string;
  qrEventTitle?: string;
  qrEventLocation?: string;
  qrEventStartIso?: string;
  qrEventEndIso?: string;
  tickerItems?: string[];
  tickerSpeedPxPerSec?: number;
  weatherLocation?: string;
  weatherTempC?: number;
  weatherCondition?: 'Sunny' | 'Partly Cloudy' | 'Rain' | 'Clear Night' | 'Windy';
  dataFeedRows?: Array<{ label: string; value: string; status?: 'normal' | 'highlight' | 'alert' }>;
  // KPI Metric & Sparkline Widget
  kpiTitle?: string;
  kpiValue?: string;
  kpiUnit?: string;
  kpiDelta?: string;
  kpiTrend?: 'up' | 'down' | 'neutral';
  kpiSparklinePoints?: number[];
  // Bar / Line / Donut Chart Widget
  chartType?: 'bar' | 'horizontal-bar' | 'line' | 'donut';
  chartTitle?: string;
  chartShowValues?: boolean;
  chartShowGrid?: boolean;
  // Wayfinding & Directional Sign Widget
  wayfindingDirection?: 'up' | 'up-right' | 'right' | 'down-right' | 'down' | 'left' | 'up-left' | 'elevator' | 'accessible';
  wayfindingDestination?: string;
  wayfindingSubtext?: string;
  wayfindingDistance?: string;
  wayfindingStatus?: string;
  // Queue / Now Serving Ticket Widget
  queueTitle?: string;
  queueCurrentTicket?: string;
  queueCounterLabel?: string;
  queueWaitingTickets?: string[];
  // Progress / Capacity Gauge Widget
  progressStyle?: 'radial' | 'linear';
  progressTitle?: string;
  progressValue?: number;
  progressMax?: number;
  progressUnit?: string;
  progressSubtitle?: string;
  // Social Wall / Spotlight Card Widget
  socialHandle?: string;
  socialAuthor?: string;
  socialPostText?: string;
  socialPlatform?: 'x' | 'linkedin' | 'instagram' | 'announcement';
  socialTimestamp?: string;
  socialLikes?: string;
  // Calendar / Room Booking Schedule Widget
  calendarRoomName?: string;
  calendarRoomStatus?: 'available' | 'occupied' | 'upcoming';
  calendarCurrentEvent?: string;
  calendarOrganizer?: string;
  // CAP Emergency / Safety Alert Widget
  alertSeverity?: 'info' | 'warning' | 'critical';
  alertTitle?: string;
  alertMessage?: string;
  alertZone?: string;
  accentColor?: string;
  customConfigJson?: string;
}

export interface SceneElement {
  id: string;
  name: string;
  type: ElementType;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  opacity: number;
  zIndex: number;
  locked: boolean;
  visible: boolean;
  aspectRatioLocked: boolean;
  backgroundColor?: string;
  border?: ElementBorder;
  shadow?: ElementShadow;
  filters?: ElementFilters;
  responsiveRule?: {
    anchorHorizontal: 'left' | 'center' | 'right' | 'stretch';
    anchorVertical: 'top' | 'middle' | 'bottom' | 'stretch';
  };
  textProps?: TextProperties;
  mediaProps?: MediaProperties;
  shapeProps?: ShapeProperties;
  widgetProps?: WidgetProperties;
  groupChildrenIds?: string[];
  parentGroupId?: string;
  componentId?: string;
  scriptId?: string;
}

export interface TransitionConfig {
  type: TransitionType;
  durationMs: number;
  easing: EasingFunction;
}

export interface Scene {
  id: string;
  name: string;
  durationMs: number; // 0 = indefinite
  indefinite?: boolean;
  backgroundColor: string;
  backgroundGradient?: string;
  referenceWidth: number;
  referenceHeight: number;
  elements: SceneElement[];
  animationTracks: AnimationTrack[];
  entryTransition: TransitionConfig;
  exitTransition: TransitionConfig;
  backgroundAudioAssetId?: string;
  scriptIds: string[];
  permissions: ScriptPermission[];
  completionBehavior: 'advance' | 'loop-scene' | 'hold-last-frame';
  failureBehavior: 'skip-scene' | 'fallback-scene' | 'retry';
}

export interface AssetItem {
  id: string;
  name: string;
  type: 'image' | 'video' | 'audio' | 'font' | 'other';
  mimeType: string;
  logicalPath: string;
  dataUrl: string; // Data URL or SVG/binary encoded representation
  optimizedDataUrl?: string;
  byteSize: number;
  contentHash: string; // SHA-256 hex of content
  width?: number;
  height?: number;
  durationMs?: number;
  codec?: string;
  tags: string[];
  folder: string;
  missing?: boolean;
}

export interface PlaylistItem {
  id: string;
  sceneId: string;
  externalPackageId?: string;
  durationOverrideMs?: number;
  transitionOverride?: TransitionConfig;
  enabled: boolean;
}

export interface Playlist {
  id: string;
  name: string;
  revision: number;
  items: PlaylistItem[];
  loop: boolean;
  shuffle: boolean;
  priorityAnnouncementSceneId?: string;
  fallbackPlaylistId?: string;
  failureBehavior: 'skip-item' | 'use-fallback' | 'restart-playlist';
}

export interface PlaybackSchedule {
  id: string;
  name: string;
  revision: number;
  playlistId: string;
  groupId?: string;
  deviceIds?: string[];
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
  startTime: string; // HH:MM (24h)
  endTime: string;   // HH:MM (24h)
  daysOfWeek: number[]; // 0=Sun..6=Sat
  dateOverrides?: Array<{ date: string; playlistId: string }>;
  priority: number; // Higher wins
  timezone: string;
  recurrence: 'daily' | 'weekly' | 'once';
  enabled: boolean;
}

export interface ScriptAction {
  type:
    | 'setText'
    | 'setVisibility'
    | 'setOpacity'
    | 'triggerAnimation'
    | 'transitionToScene'
    | 'selectPlaylist'
    | 'log';
  elementId?: string;
  value?: string | number | boolean;
  sceneId?: string;
  playlistId?: string;
  level?: 'info' | 'warn' | 'error';
  message?: string;
}

export interface ScriptRule {
  id: string;
  hook: 'initialize' | 'onSceneEnter' | 'onTick' | 'onEvent' | 'onSceneExit' | 'dispose';
  eventName?: string;
  condition?: {
    field: 'elapsedMs' | 'tickCount';
    operator: 'gte' | 'lte' | 'eq' | 'mod';
    value: number;
  };
  actions: ScriptAction[];
}

export interface ScriptModule {
  id: string;
  name: string;
  description: string;
  permissions: ScriptPermission[];
  rules: ScriptRule[];
  enabled: boolean;
}

export interface ProjectTheme {
  id: string;
  name: string;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  backgroundColor: string;
  textColor: string;
  headingFont: string;
  bodyFont: string;
}

export interface ReusableComponent {
  id: string;
  name: string;
  category: string;
  rootElements: SceneElement[];
  parameters: Array<{ key: string; label: string; defaultValue: string }>;
}

export interface ProjectSettings {
  id: string;
  name: string;
  description: string;
  width: number;
  height: number;
  frameRate: number;
  scalingMode: ScalingMode;
  safeAreaPercent: number;
  gridSizePx: number;
  snapToGrid: boolean;
  snapToElements: boolean;
  defaultSceneDurationMs: number;
}

export interface SignageProject {
  schemaVersion: number;
  updatedAt: string;
  settings: ProjectSettings;
  theme: ProjectTheme;
  entrySceneId: string;
  scenes: Scene[];
  assets: AssetItem[];
  playlists: Playlist[];
  schedules: PlaybackSchedule[];
  scripts: ScriptModule[];
  permissions: ScriptPermission[];
  components: ReusableComponent[];
  audioTracks?: AudioClipConfig[];
}

export interface ProjectValidationIssue {
  severity: 'error' | 'warning' | 'info';
  code: string;
  message: string;
  sceneId?: string;
  elementId?: string;
  assetId?: string;
}

export interface AssetAnalysisReport {
  totalAssets: number;
  totalByteSize: number;
  estimatedCompactSize: number;
  missingAssets: AssetItem[];
  unusedAssets: AssetItem[];
  duplicateGroups: Array<{ contentHash: string; assets: AssetItem[] }>;
}

export function validateProject(project: SignageProject): {
  valid: boolean;
  issues: ProjectValidationIssue[];
} {
  const issues: ProjectValidationIssue[] = [];

  if (!project || typeof project !== 'object') {
    return {
      valid: false,
      issues: [{ severity: 'error', code: 'INVALID_ROOT', message: 'Project root must be an object.' }],
    };
  }

  if (!project.settings?.name?.trim()) {
    issues.push({ severity: 'error', code: 'MISSING_PROJECT_NAME', message: 'Project name is required.' });
  }

  if (
    !project.settings ||
    project.settings.width < 120 ||
    project.settings.width > 15360 ||
    project.settings.height < 120 ||
    project.settings.height > 15360
  ) {
    issues.push({
      severity: 'error',
      code: 'INVALID_DIMENSIONS',
      message: 'Canvas dimensions must be between 120px and 15360px.',
    });
  }

  if (!Array.isArray(project.scenes) || project.scenes.length === 0) {
    issues.push({ severity: 'error', code: 'NO_SCENES', message: 'Project must contain at least one scene.' });
  } else {
    const entryExists = project.scenes.some((s) => s.id === project.entrySceneId);
    if (!entryExists) {
      issues.push({
        severity: 'error',
        code: 'MISSING_ENTRY_SCENE',
        message: `Entry scene "${project.entrySceneId}" does not exist in scene collection.`,
      });
    }
  }

  const assetMap = new Map((project.assets ?? []).map((a) => [a.id, a]));
  const scriptMap = new Map((project.scripts ?? []).map((s) => [s.id, s]));

  for (const scene of project.scenes ?? []) {
    if (scene.durationMs < 0) {
      issues.push({
        severity: 'error',
        code: 'NEGATIVE_DURATION',
        message: `Scene "${scene.name}" has negative duration.`,
        sceneId: scene.id,
      });
    }

    for (const scriptId of scene.scriptIds ?? []) {
      const script = scriptMap.get(scriptId);
      if (!script) {
        issues.push({
          severity: 'error',
          code: 'MISSING_SCRIPT_REF',
          message: `Scene "${scene.name}" references missing script "${scriptId}".`,
          sceneId: scene.id,
        });
      } else {
        for (const perm of script.permissions) {
          if (!project.permissions.includes(perm)) {
            issues.push({
              severity: 'warning',
              code: 'UNDECLARED_SCRIPT_PERMISSION',
              message: `Script "${script.name}" requests permission "${perm}" not enabled at project level.`,
              sceneId: scene.id,
            });
          }
        }
      }
    }

    for (const el of scene.elements ?? []) {
      if ((el.type === 'image' || el.type === 'video' || el.type === 'audio') && el.mediaProps?.assetId) {
        const asset = assetMap.get(el.mediaProps.assetId);
        if (!asset || asset.missing) {
          issues.push({
            severity: 'error',
            code: 'MISSING_ASSET_REF',
            message: `Element "${el.name}" in scene "${scene.name}" references missing asset "${el.mediaProps.assetId}".`,
            sceneId: scene.id,
            elementId: el.id,
            assetId: el.mediaProps.assetId,
          });
        }
      }
    }
  }

  return {
    valid: !issues.some((i) => i.severity === 'error'),
    issues,
  };
}

export function analyzeProjectAssets(project: SignageProject): AssetAnalysisReport {
  const referencedIds = new Set<string>();
  for (const scene of project.scenes) {
    if (scene.backgroundAudioAssetId) referencedIds.add(scene.backgroundAudioAssetId);
    for (const el of scene.elements) {
      if (el.mediaProps?.assetId) referencedIds.add(el.mediaProps.assetId);
      if (el.mediaProps?.posterAssetId) referencedIds.add(el.mediaProps.posterAssetId);
    }
  }

  const missingAssets = project.assets.filter((a) => Boolean(a.missing));
  const unusedAssets = project.assets.filter((a) => !referencedIds.has(a.id));

  const hashGroups = new Map<string, AssetItem[]>();
  for (const asset of project.assets) {
    const list = hashGroups.get(asset.contentHash) ?? [];
    list.push(asset);
    hashGroups.set(asset.contentHash, list);
  }

  const duplicateGroups: Array<{ contentHash: string; assets: AssetItem[] }> = [];
  for (const [contentHash, assets] of hashGroups.entries()) {
    if (assets.length > 1) {
      duplicateGroups.push({ contentHash, assets });
    }
  }

  const totalByteSize = project.assets.reduce((acc, a) => acc + (a.byteSize || 0), 0);
  const compressibleSavings = project.assets.reduce((acc, a) => {
    if (a.mimeType.includes('svg') || a.mimeType.includes('json') || a.mimeType.includes('text')) {
      return acc + Math.round(a.byteSize * 0.55);
    }
    return acc;
  }, 0);

  return {
    totalAssets: project.assets.length,
    totalByteSize,
    estimatedCompactSize: Math.max(2048, totalByteSize - compressibleSavings + 4096),
    missingAssets,
    unusedAssets,
    duplicateGroups,
  };
}

export function migrateProjectSchema(raw: Record<string, unknown>): SignageProject {
  const version = typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 0;
  const starter = createStarterProject();

  if (version < 1) {
    return {
      ...starter,
      ...raw,
      schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
      updatedAt: new Date().toISOString(),
      permissions: Array.isArray(raw.permissions)
        ? (raw.permissions as ScriptPermission[])
        : starter.permissions,
      components: Array.isArray(raw.components)
        ? (raw.components as ReusableComponent[])
        : starter.components,
    };
  }

  return raw as unknown as SignageProject;
}

// Helper to create inline SVG data URLs for crisp vector signage graphics
export function createSvgDataUrl(svgString: string): { dataUrl: string; byteSize: number; contentHash: string } {
  const clean = svgString.trim();
  const bytes = stringToBytes(clean);
  const contentHash = sha256Hex(bytes);
  const encoded = encodeURIComponent(clean);
  return {
    dataUrl: `data:image/svg+xml;utf8,${encoded}`,
    byteSize: bytes.byteLength,
    contentHash,
  };
}

export function createStarterProject(): SignageProject {
  const brandHeroSvg = createSvgDataUrl(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 500">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#0f172a"/>
          <stop offset="50%" stop-color="#1e3a8a"/>
          <stop offset="100%" stop-color="#0ea5e9"/>
        </linearGradient>
        <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="#38bdf8"/>
          <stop offset="100%" stop-color="#818cf8"/>
        </linearGradient>
      </defs>
      <rect width="800" height="500" rx="24" fill="url(#bg)"/>
      <circle cx="650" cy="120" r="180" fill="#38bdf8" opacity="0.14"/>
      <circle cx="140" cy="400" r="210" fill="#6366f1" opacity="0.18"/>
      <path d="M80 360 L260 220 L420 310 L620 140 L730 210" fill="none" stroke="url(#accent)" stroke-width="8" stroke-linecap="round"/>
      <circle cx="260" cy="220" r="10" fill="#38bdf8"/>
      <circle cx="420" cy="310" r="10" fill="#818cf8"/>
      <circle cx="620" cy="140" r="12" fill="#22d3ee"/>
      <text x="75" y="110" fill="#f8fafc" font-family="sans-serif" font-size="34" font-weight="bold">APEX GLOBAL CAMPUS</text>
      <text x="75" y="155" fill="#94a3b8" font-family="sans-serif" font-size="20">LIVE DIGITAL TELEMETRY &amp; VISITOR CONCOURSE</text>
    </svg>
  `);

  const culinaryPromoSvg = createSvgDataUrl(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 700 460">
      <defs>
        <linearGradient id="warm" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#7c2d12"/>
          <stop offset="55%" stop-color="#c2410c"/>
          <stop offset="100%" stop-color="#f59e0b"/>
        </linearGradient>
      </defs>
      <rect width="700" height="460" rx="28" fill="url(#warm)"/>
      <circle cx="530" cy="230" r="155" fill="#fef3c7" opacity="0.16"/>
      <circle cx="530" cy="230" r="115" fill="#fffbeb" opacity="0.22"/>
      <text x="55" y="120" fill="#fef3c7" font-family="sans-serif" font-size="22" font-weight="bold" letter-spacing="3">CHEF'S SPECIAL</text>
      <text x="55" y="185" fill="#ffffff" font-family="sans-serif" font-size="44" font-weight="bold">Artisan Espresso</text>
      <text x="55" y="240" fill="#ffffff" font-family="sans-serif" font-size="44" font-weight="bold">&amp; Brioche Combo</text>
      <rect x="55" y="290" width="210" height="64" rx="32" fill="#ffffff"/>
      <text x="160" y="332" fill="#9a3412" font-family="sans-serif" font-size="28" font-weight="bold" text-anchor="middle">$8.50 TODAY</text>
    </svg>
  `);

  const logoBadgeSvg = createSvgDataUrl(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240">
      <rect width="240" height="240" rx="48" fill="#0284c7"/>
      <polygon points="120,36 196,184 44,184" fill="none" stroke="#e0f2fe" stroke-width="16" stroke-linejoin="round"/>
      <circle cx="120" cy="136" r="22" fill="#38bdf8"/>
    </svg>
  `);

  const assets: AssetItem[] = [
    {
      id: 'asset-hero-campus',
      name: 'Apex Campus Graphic.svg',
      type: 'image',
      mimeType: 'image/svg+xml',
      logicalPath: 'assets/apex-campus-graphic.svg',
      dataUrl: brandHeroSvg.dataUrl,
      byteSize: brandHeroSvg.byteSize,
      contentHash: brandHeroSvg.contentHash,
      width: 800,
      height: 500,
      tags: ['hero', 'corporate', 'vector'],
      folder: 'Brand Graphics',
    },
    {
      id: 'asset-cafe-promo',
      name: 'Culinary Cafe Promo.svg',
      type: 'image',
      mimeType: 'image/svg+xml',
      logicalPath: 'assets/culinary-cafe-promo.svg',
      dataUrl: culinaryPromoSvg.dataUrl,
      byteSize: culinaryPromoSvg.byteSize,
      contentHash: culinaryPromoSvg.contentHash,
      width: 700,
      height: 460,
      tags: ['promo', 'menu', 'hospitality'],
      folder: 'Promotions',
    },
    {
      id: 'asset-brand-logo',
      name: 'Apex Brand Emblem.svg',
      type: 'image',
      mimeType: 'image/svg+xml',
      logicalPath: 'assets/apex-brand-emblem.svg',
      dataUrl: logoBadgeSvg.dataUrl,
      byteSize: logoBadgeSvg.byteSize,
      contentHash: logoBadgeSvg.contentHash,
      width: 240,
      height: 240,
      tags: ['logo', 'badge'],
      folder: 'Brand Graphics',
    },
  ];

  const sceneWelcome: Scene = {
    id: 'scene-welcome',
    name: '01 — Executive Lobby Welcome',
    durationMs: 12000,
    backgroundColor: '#090d16',
    backgroundGradient: 'linear-gradient(135deg, #090d16 0%, #0f172a 55%, #1e1b4b 100%)',
    referenceWidth: 1920,
    referenceHeight: 1080,
    entryTransition: { type: 'fade', durationMs: 600, easing: 'easeOut' },
    exitTransition: { type: 'slide-left', durationMs: 600, easing: 'easeInOut' },
    scriptIds: ['script-lobby-welcome'],
    permissions: ['scene:read', 'text:write', 'visibility:write', 'diagnostics:log'],
    completionBehavior: 'advance',
    failureBehavior: 'skip-scene',
    elements: [
      {
        id: 'el-welcome-card',
        name: 'Header Backdrop Panel',
        type: 'shape',
        x: 72,
        y: 64,
        width: 1776,
        height: 150,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
        opacity: 0.92,
        zIndex: 1,
        locked: false,
        visible: true,
        aspectRatioLocked: false,
        shapeProps: {
          shapeKind: 'roundedRect',
          fillColor: '#111827',
          gradient: 'linear-gradient(90deg, rgba(15,23,42,0.95), rgba(30,41,59,0.85))',
          strokeColor: '#334155',
          strokeWidth: 2,
        },
        border: { width: 2, color: '#334155', style: 'solid', radius: 20 },
      },
      {
        id: 'el-logo',
        name: 'Brand Logo Badge',
        type: 'image',
        x: 104,
        y: 88,
        width: 102,
        height: 102,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
        opacity: 1,
        zIndex: 2,
        locked: false,
        visible: true,
        aspectRatioLocked: true,
        mediaProps: {
          assetId: 'asset-brand-logo',
          objectFit: 'contain',
          altText: 'Apex Brand Logo',
        },
      },
      {
        id: 'el-heading',
        name: 'Main Welcome Title',
        type: 'text',
        x: 234,
        y: 86,
        width: 980,
        height: 64,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
        opacity: 1,
        zIndex: 3,
        locked: false,
        visible: true,
        aspectRatioLocked: false,
        textProps: {
          text: 'WELCOME TO APEX INNOVATION HQ',
          fontFamily: 'Inter, system-ui, sans-serif',
          fontSize: 44,
          fontWeight: 'bold',
          color: '#f8fafc',
          textAlign: 'left',
          letterSpacing: 1.5,
          lineHeight: 1.2,
          wrap: true,
          autoFit: false,
          scrolling: false,
          direction: 'ltr',
        },
      },
      {
        id: 'el-subheading',
        name: 'Dynamic Subtitle Banner',
        type: 'text',
        x: 236,
        y: 148,
        width: 960,
        height: 44,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
        opacity: 0.9,
        zIndex: 3,
        locked: false,
        visible: true,
        aspectRatioLocked: false,
        textProps: {
          text: 'North Concourse Display Wall • Live Building Telemetry & Keynote Schedule',
          fontFamily: 'Inter, system-ui, sans-serif',
          fontSize: 22,
          fontWeight: 'normal',
          color: '#38bdf8',
          textAlign: 'left',
          letterSpacing: 0.4,
          lineHeight: 1.3,
          wrap: true,
          autoFit: false,
          scrolling: false,
          direction: 'ltr',
        },
      },
      {
        id: 'el-clock-widget',
        name: 'Lobby Live Clock',
        type: 'widget',
        x: 1450,
        y: 82,
        width: 360,
        height: 114,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
        opacity: 1,
        zIndex: 4,
        locked: false,
        visible: true,
        aspectRatioLocked: false,
        widgetProps: {
          widgetKind: 'clock',
          timezone: 'America/New_York',
          timeFormat: '12h',
          showSeconds: true,
          accentColor: '#38bdf8',
        },
      },
      {
        id: 'el-hero-visual',
        name: 'Campus Telemetry Visual',
        type: 'image',
        x: 72,
        y: 252,
        width: 1060,
        height: 660,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
        opacity: 1,
        zIndex: 2,
        locked: false,
        visible: true,
        aspectRatioLocked: false,
        mediaProps: {
          assetId: 'asset-hero-campus',
          objectFit: 'cover',
          altText: 'Campus Telemetry Graphic',
        },
        border: { width: 2, color: '#1e293b', style: 'solid', radius: 24 },
      },
      {
        id: 'el-schedule-feed',
        name: 'Keynote & Room Schedule Feed',
        type: 'widget',
        x: 1168,
        y: 252,
        width: 680,
        height: 410,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
        opacity: 1,
        zIndex: 3,
        locked: false,
        visible: true,
        aspectRatioLocked: false,
        widgetProps: {
          widgetKind: 'datafeed',
          accentColor: '#38bdf8',
          dataFeedRows: [
            { label: '09:30 AM • Auditorium A', value: 'AI Systems Keynote', status: 'highlight' },
            { label: '11:00 AM • Executive Lab', value: 'Cloud Architecture Summit', status: 'normal' },
            { label: '01:30 PM • West Atrium', value: 'Robotics Live Demo', status: 'highlight' },
            { label: '03:15 PM • Boardroom 4B', value: 'Global Partner Briefing', status: 'normal' },
            { label: '05:00 PM • Sky Lounge', value: 'Networking Reception', status: 'normal' },
          ],
        },
      },
      {
        id: 'el-weather-widget',
        name: 'Campus Weather Card',
        type: 'widget',
        x: 1168,
        y: 686,
        width: 430,
        height: 226,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
        opacity: 1,
        zIndex: 3,
        locked: false,
        visible: true,
        aspectRatioLocked: false,
        widgetProps: {
          widgetKind: 'weather',
          weatherLocation: 'Pittsburgh, PA',
          weatherTempC: 19,
          weatherCondition: 'Partly Cloudy',
          accentColor: '#38bdf8',
        },
      },
      {
        id: 'el-qr-checkin',
        name: 'Visitor Express Pass QR',
        type: 'widget',
        x: 1622,
        y: 686,
        width: 226,
        height: 226,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
        opacity: 1,
        zIndex: 3,
        locked: false,
        visible: true,
        aspectRatioLocked: true,
        widgetProps: {
          widgetKind: 'qrcode',
          qrPayload: 'https://apex-campus.example/visitor-checkin',
          qrForeground: '#0f172a',
          qrBackground: '#f8fafc',
        },
      },
      {
        id: 'el-bottom-ticker',
        name: 'Live Concourse News Ticker',
        type: 'widget',
        x: 72,
        y: 944,
        width: 1776,
        height: 76,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
        opacity: 1,
        zIndex: 5,
        locked: false,
        visible: true,
        aspectRatioLocked: false,
        widgetProps: {
          widgetKind: 'ticker',
          tickerSpeedPxPerSec: 90,
          accentColor: '#0ea5e9',
          tickerItems: [
            'WELCOME VISITORS: Complimentary Guest Wi-Fi available on network "Apex-Guest-5G"',
            'SHUTTLE UPDATE: Autonomous Campus Shuttle departs North Gate every 8 minutes',
            'SUSTAINABILITY: Building A is operating on 94% solar & geothermal microgrid power today',
          ],
        },
      },
    ],
    animationTracks: [
      {
        id: 'anim-heading-fade',
        elementId: 'el-heading',
        property: 'opacity',
        preset: 'fade-in',
        durationMs: 1200,
        delayMs: 0,
        repeatCount: 1,
        reverse: false,
        fillMode: 'both',
        keyframes: [
          { id: 'kf-1', timeMs: 0, value: 0, easing: 'easeOut' },
          { id: 'kf-2', timeMs: 1200, value: 1, easing: 'easeOut' },
        ],
      },
      {
        id: 'anim-hero-slide',
        elementId: 'el-hero-visual',
        property: 'x',
        preset: 'slide-right',
        durationMs: 1000,
        delayMs: 100,
        repeatCount: 1,
        reverse: false,
        fillMode: 'both',
        keyframes: [
          { id: 'kf-3', timeMs: 0, value: -120, easing: 'easeOut' },
          { id: 'kf-4', timeMs: 1000, value: 72, easing: 'easeOut' },
        ],
      },
      {
        id: 'anim-logo-scale',
        elementId: 'el-logo',
        property: 'scaleX',
        preset: 'zoom-in',
        durationMs: 900,
        delayMs: 0,
        repeatCount: 1,
        reverse: false,
        fillMode: 'both',
        keyframes: [
          { id: 'kf-5', timeMs: 0, value: 0.6, easing: 'bounce' },
          { id: 'kf-6', timeMs: 900, value: 1, easing: 'bounce' },
        ],
      },
    ],
  };

  const scenePromo: Scene = {
    id: 'scene-promotion',
    name: '02 — Sky Café & Hospitality Spotlight',
    durationMs: 10000,
    backgroundColor: '#18100c',
    backgroundGradient: 'linear-gradient(135deg, #1c1917 0%, #431407 60%, #7c2d12 100%)',
    referenceWidth: 1920,
    referenceHeight: 1080,
    entryTransition: { type: 'slide-left', durationMs: 600, easing: 'easeInOut' },
    exitTransition: { type: 'fade', durationMs: 600, easing: 'easeOut' },
    scriptIds: [],
    permissions: ['scene:read'],
    completionBehavior: 'advance',
    failureBehavior: 'skip-scene',
    elements: [
      {
        id: 'el-promo-image',
        name: 'Culinary Featured Graphic',
        type: 'image',
        x: 96,
        y: 110,
        width: 980,
        height: 860,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
        opacity: 1,
        zIndex: 2,
        locked: false,
        visible: true,
        aspectRatioLocked: false,
        mediaProps: {
          assetId: 'asset-cafe-promo',
          objectFit: 'cover',
          altText: 'Artisan Espresso & Brioche Special',
        },
        border: { width: 3, color: '#f59e0b', style: 'solid', radius: 28 },
      },
      {
        id: 'el-promo-title',
        name: 'Sky Café Headline',
        type: 'text',
        x: 1136,
        y: 130,
        width: 688,
        height: 120,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
        opacity: 1,
        zIndex: 3,
        locked: false,
        visible: true,
        aspectRatioLocked: false,
        textProps: {
          text: 'SKY ATRIUM ROASTERY & BISTRO',
          fontFamily: 'Inter, system-ui, sans-serif',
          fontSize: 48,
          fontWeight: 'bold',
          color: '#fef3c7',
          textAlign: 'left',
          letterSpacing: 1,
          lineHeight: 1.15,
          wrap: true,
          autoFit: false,
          scrolling: false,
          direction: 'ltr',
        },
      },
      {
        id: 'el-promo-price-card',
        name: 'Menu Board Pricing Table',
        type: 'widget',
        x: 1136,
        y: 280,
        width: 688,
        height: 430,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
        opacity: 1,
        zIndex: 3,
        locked: false,
        visible: true,
        aspectRatioLocked: false,
        widgetProps: {
          widgetKind: 'datafeed',
          accentColor: '#f59e0b',
          dataFeedRows: [
            { label: 'Single-Origin Cortado', value: '$4.75 • 90 Cal', status: 'highlight' },
            { label: 'Matcha Oat Latte', value: '$5.50 • 140 Cal', status: 'normal' },
            { label: 'Warm Almond Croissant', value: '$4.95 • 310 Cal', status: 'normal' },
            { label: 'Avocado Sourdough Toast', value: '$9.50 • 420 Cal', status: 'highlight' },
            { label: 'Cold-Pressed Citrus Tonic', value: '$6.25 • 110 Cal', status: 'normal' },
          ],
        },
      },
      {
        id: 'el-promo-countdown',
        name: 'Happy Hour Countdown',
        type: 'widget',
        x: 1136,
        y: 744,
        width: 688,
        height: 226,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
        opacity: 1,
        zIndex: 4,
        locked: false,
        visible: true,
        aspectRatioLocked: false,
        widgetProps: {
          widgetKind: 'countdown',
          countdownLabel: 'AFTERNOON PASTRY HAPPY HOUR BEGINS IN',
          countdownTargetIso: '2026-10-25T23:59:59.000Z',
          accentColor: '#f59e0b',
        },
      },
    ],
    animationTracks: [
      {
        id: 'anim-promo-fade',
        elementId: 'el-promo-title',
        property: 'opacity',
        preset: 'fade-in',
        durationMs: 900,
        delayMs: 0,
        repeatCount: 1,
        reverse: false,
        fillMode: 'both',
        keyframes: [
          { id: 'kf-p1', timeMs: 0, value: 0, easing: 'easeOut' },
          { id: 'kf-p2', timeMs: 900, value: 1, easing: 'easeOut' },
        ],
      },
    ],
  };

  const defaultPlaylist: Playlist = {
    id: 'playlist-main-loop',
    name: 'All-Day Lobby & Hospitality Loop',
    revision: 1,
    loop: true,
    shuffle: false,
    failureBehavior: 'skip-item',
    items: [
      { id: 'pli-1', sceneId: 'scene-welcome', enabled: true },
      { id: 'pli-2', sceneId: 'scene-promotion', enabled: true },
    ],
  };

  const defaultSchedule: PlaybackSchedule = {
    id: 'schedule-business-hours',
    name: 'Standard Daily Broadcast Schedule',
    revision: 1,
    playlistId: 'playlist-main-loop',
    groupId: 'group-lobby-wall',
    startDate: '2026-01-01',
    endDate: '2027-12-31',
    startTime: '00:00',
    endTime: '23:59',
    daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
    priority: 10,
    timezone: 'UTC',
    recurrence: 'daily',
    enabled: true,
  };

  const defaultScript: ScriptModule = {
    id: 'script-lobby-welcome',
    name: 'Lobby Dynamic Telemetry Updater',
    description: 'Updates welcome banner status and logs scene entry diagnostics inside restricted sandbox.',
    permissions: ['scene:read', 'text:write', 'visibility:write', 'diagnostics:log'],
    enabled: true,
    rules: [
      {
        id: 'rule-enter',
        hook: 'onSceneEnter',
        actions: [
          {
            type: 'log',
            level: 'info',
            message: 'Scene 01 (Executive Lobby Welcome) initialized in restricted script sandbox.',
          },
        ],
      },
      {
        id: 'rule-tick-5s',
        hook: 'onTick',
        condition: { field: 'elapsedMs', operator: 'gte', value: 4000 },
        actions: [
          {
            type: 'setText',
            elementId: 'el-subheading',
            value: 'North Concourse Display Wall • Synchronized Multi-Screen Broadcast Active',
          },
        ],
      },
    ],
  };

  return {
    schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    settings: {
      id: 'project-apex-lobby-001',
      name: 'Apex Global Campus — Lobby & Café Signage',
      description: 'Multi-scene 1080p digital signage presentation with live widgets, animations, and sync playlist.',
      width: 1920,
      height: 1080,
      frameRate: 30,
      scalingMode: 'contain',
      safeAreaPercent: 90,
      gridSizePx: 24,
      snapToGrid: true,
      snapToElements: true,
      defaultSceneDurationMs: 10000,
    },
    theme: {
      id: 'theme-apex-dark',
      name: 'Apex Midnight Slate',
      primaryColor: '#0ea5e9',
      secondaryColor: '#6366f1',
      accentColor: '#38bdf8',
      backgroundColor: '#090d16',
      textColor: '#f8fafc',
      headingFont: 'Inter, system-ui, sans-serif',
      bodyFont: 'Inter, system-ui, sans-serif',
    },
    entrySceneId: 'scene-welcome',
    scenes: [sceneWelcome, scenePromo],
    assets,
    playlists: [defaultPlaylist],
    schedules: [defaultSchedule],
    scripts: [defaultScript],
    permissions: [
      'scene:read',
      'element:read',
      'text:write',
      'visibility:write',
      'animation:control',
      'scene:transition',
      'timer:use',
      'diagnostics:log',
    ],
    components: [
      {
        id: 'comp-kpi-badge',
        name: 'Metric KPI Callout Card',
        category: 'Corporate Cards',
        rootElements: [],
        parameters: [
          { key: 'title', label: 'Metric Title', defaultValue: 'SYSTEM UPTIME' },
          { key: 'value', label: 'Metric Value', defaultValue: '99.98%' },
        ],
      },
    ],
    audioTracks: [
      {
        id: 'audio-track-ambient-env',
        name: 'Atrium Ambient Soundscape (Continuous Environment)',
        assetId: 'asset-audio-ambient',
        scope: 'environment',
        sceneIds: ['scene-welcome', 'scene-promo'],
        enabled: true,
        loop: true,
        volume: 0.72,
        channel: 'stereo',
        startAtMs: 0,
        stopAtMs: 0,
        trimStartMs: 0,
        trimEndMs: 10000,
        durationMs: 10000,
        fadeInMs: 1200,
        fadeOutMs: 1200,
        deletedRegions: [],
        synthPreset: 'ambient-pad',
      },
      {
        id: 'audio-track-scene-chime',
        name: 'Welcome Keynote Chime (Scene Specific)',
        assetId: 'asset-audio-chime',
        scope: 'scene',
        sceneIds: ['scene-welcome'],
        enabled: true,
        loop: false,
        volume: 0.85,
        channel: 'stereo',
        startAtMs: 500,
        stopAtMs: 6500,
        trimStartMs: 0,
        trimEndMs: 6000,
        durationMs: 6000,
        fadeInMs: 400,
        fadeOutMs: 800,
        deletedRegions: [],
        synthPreset: 'corporate-chime',
      },
    ],
  };
}

export function createNewElement(type: ElementType, partial?: Partial<SceneElement>): SceneElement {
  const id = createId(`el-${type}`);
  const base: SceneElement = {
    id,
    name: partial?.name ?? `New ${type.charAt(0).toUpperCase() + type.slice(1)}`,
    type,
    x: partial?.x ?? 240,
    y: partial?.y ?? 200,
    width: partial?.width ?? 420,
    height: partial?.height ?? 180,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    opacity: 1,
    zIndex: partial?.zIndex ?? 10,
    locked: false,
    visible: true,
    aspectRatioLocked: type === 'image' || type === 'video',
    ...partial,
  };

  if (type === 'text' && !base.textProps) {
    base.width = partial?.width ?? 560;
    base.height = partial?.height ?? 80;
    base.textProps = {
      text: 'Double-click or use Inspector to edit text',
      fontFamily: 'Inter, system-ui, sans-serif',
      fontSize: 36,
      fontWeight: 'bold',
      color: '#f8fafc',
      textAlign: 'left',
      letterSpacing: 0.5,
      lineHeight: 1.25,
      wrap: true,
      autoFit: false,
      scrolling: false,
      direction: 'ltr',
    };
  } else if (type === 'shape' && !base.shapeProps) {
    base.width = partial?.width ?? 360;
    base.height = partial?.height ?? 220;
    base.shapeProps = {
      shapeKind: 'roundedRect',
      fillColor: '#0284c7',
      gradient: 'linear-gradient(135deg, #0284c7, #4f46e5)',
      strokeColor: '#38bdf8',
      strokeWidth: 2,
    };
    base.border = { width: 2, color: '#38bdf8', style: 'solid', radius: 16 };
  } else if (type === 'widget' && !base.widgetProps) {
    base.width = partial?.width ?? 360;
    base.height = partial?.height ?? 140;
    base.widgetProps = {
      widgetKind: 'clock',
      timezone: 'UTC',
      timeFormat: '24h',
      showSeconds: true,
      accentColor: '#38bdf8',
    };
  } else if ((type === 'image' || type === 'video' || type === 'audio') && !base.mediaProps) {
    base.mediaProps = {
      assetId: 'asset-hero-campus',
      objectFit: 'cover',
      loop: true,
      muted: true,
      volume: 0.8,
      playbackRate: 1,
    };
  }

  return base;
}
