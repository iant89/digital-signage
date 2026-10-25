// ============================================================================
// @packages/animation-engine — Shared Timeline Math, Keyframe Interpolation,
// Easing Functions, Built-in Animation Presets & Scene Transitions
// ============================================================================

import {
  AnimatableProperty,
  AnimationPresetName,
  AnimationTrack,
  EasingFunction,
  SceneElement,
  TransitionConfig,
} from '@packages/project-model';
import { clamp, createId } from '@packages/shared';

export function evaluateEasing(t: number, easing: EasingFunction): number {
  const x = clamp(t, 0, 1);
  switch (easing) {
    case 'linear':
      return x;
    case 'easeIn':
      return x * x * x;
    case 'easeOut':
      return 1 - Math.pow(1 - x, 3);
    case 'easeInOut':
      return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
    case 'bounce': {
      const n1 = 7.5625;
      const d1 = 2.75;
      let v = x;
      if (v < 1 / d1) {
        return n1 * v * v;
      } else if (v < 2 / d1) {
        v -= 1.5 / d1;
        return n1 * v * v + 0.75;
      } else if (v < 2.5 / d1) {
        v -= 2.25 / d1;
        return n1 * v * v + 0.9375;
      } else {
        v -= 2.625 / d1;
        return n1 * v * v + 0.984375;
      }
    }
    case 'elastic': {
      if (x === 0 || x === 1) return x;
      const c4 = (2 * Math.PI) / 3;
      return Math.pow(2, -10 * x) * Math.sin((x * 10 - 0.75) * c4) + 1;
    }
    case 'step':
      return x < 1 ? 0 : 1;
    default:
      return x;
  }
}

function parseHexColor(color: string): [number, number, number] | null {
  const clean = color.trim().replace(/^#/, '');
  if (clean.length === 3) {
    const r = Number.parseInt(clean[0] + clean[0], 16);
    const g = Number.parseInt(clean[1] + clean[1], 16);
    const b = Number.parseInt(clean[2] + clean[2], 16);
    if (!Number.isNaN(r) && !Number.isNaN(g) && !Number.isNaN(b)) return [r, g, b];
  } else if (clean.length === 6) {
    const r = Number.parseInt(clean.slice(0, 2), 16);
    const g = Number.parseInt(clean.slice(2, 4), 16);
    const b = Number.parseInt(clean.slice(4, 6), 16);
    if (!Number.isNaN(r) && !Number.isNaN(g) && !Number.isNaN(b)) return [r, g, b];
  }
  return null;
}

export function interpolateValue(
  startVal: number | string,
  endVal: number | string,
  progress: number,
  easing: EasingFunction
): number | string {
  const eased = evaluateEasing(progress, easing);
  if (typeof startVal === 'number' && typeof endVal === 'number') {
    return startVal + (endVal - startVal) * eased;
  }
  if (typeof startVal === 'string' && typeof endVal === 'string') {
    const c1 = parseHexColor(startVal);
    const c2 = parseHexColor(endVal);
    if (c1 && c2) {
      const r = Math.round(c1[0] + (c2[0] - c1[0]) * eased);
      const g = Math.round(c1[1] + (c2[1] - c1[1]) * eased);
      const b = Math.round(c1[2] + (c2[2] - c1[2]) * eased);
      return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
    }
    return eased < 0.5 ? startVal : endVal;
  }
  return endVal;
}

/**
 * Spec Section 26.4:
 * Calculate normalized track progress from shared timeline position:
 * Progress = (CurrentTimelinePosition - A) / Duration
 * Clamped or wrapped according to repeatCount, reverse, and fillMode.
 */
export function computeTrackLocalTimeMs(
  track: AnimationTrack,
  currentTimelineMs: number
): number | null {
  const duration = Math.max(1, track.durationMs);
  const startA = Math.max(0, track.delayMs || 0);
  const elapsed = currentTimelineMs - startA;

  if (elapsed < 0) {
    if (track.fillMode === 'backwards' || track.fillMode === 'both') {
      return track.reverse ? duration : 0;
    }
    return null;
  }

  const rawCycle = elapsed / duration;
  const infinite = track.repeatCount < 0;
  const maxCycles = infinite ? Number.POSITIVE_INFINITY : Math.max(1, track.repeatCount || 1);

  if (rawCycle >= maxCycles) {
    if (track.fillMode === 'forwards' || track.fillMode === 'both') {
      const isReversedEnd = track.reverse
        ? maxCycles % 2 === 1
          ? false
          : true
        : false;
      return isReversedEnd ? 0 : duration;
    }
    return null;
  }

  const cycleIndex = Math.floor(rawCycle);
  let cycleProgress = rawCycle - cycleIndex;
  if (track.reverse && cycleIndex % 2 === 1) {
    cycleProgress = 1 - cycleProgress;
  }

  return cycleProgress * duration;
}

export function evaluateTrackAtTime(
  track: AnimationTrack,
  currentTimelineMs: number
): number | string | null {
  if (track.muted || !track.keyframes || track.keyframes.length === 0) {
    return null;
  }

  const localTime = computeTrackLocalTimeMs(track, currentTimelineMs);
  if (localTime === null) return null;

  const sorted = [...track.keyframes].sort((a, b) => a.timeMs - b.timeMs);
  if (localTime <= sorted[0].timeMs) {
    return sorted[0].value;
  }
  const last = sorted[sorted.length - 1];
  if (localTime >= last.timeMs) {
    return last.value;
  }

  for (let i = 0; i < sorted.length - 1; i++) {
    const k1 = sorted[i];
    const k2 = sorted[i + 1];
    if (localTime >= k1.timeMs && localTime <= k2.timeMs) {
      const span = Math.max(1, k2.timeMs - k1.timeMs);
      const segProgress = (localTime - k1.timeMs) / span;
      const easing = k2.interpolation === 'step' ? 'step' : k2.easing;
      return interpolateValue(k1.value, k2.value, segProgress, easing);
    }
  }

  return last.value;
}

export interface ComputedElementState extends SceneElement {
  textRevealRatio?: number;
  cropProgress?: number;
}

export function computeSceneElementsAtTime(
  elements: SceneElement[],
  tracks: AnimationTrack[],
  currentTimelineMs: number
): ComputedElementState[] {
  const tracksByElement = new Map<string, AnimationTrack[]>();
  for (const track of tracks) {
    if (track.muted) continue;
    const list = tracksByElement.get(track.elementId) ?? [];
    list.push(track);
    tracksByElement.set(track.elementId, list);
  }

  return elements.map((el) => {
    const elTracks = tracksByElement.get(el.id);
    if (!elTracks || elTracks.length === 0) {
      return { ...el };
    }

    const computed: ComputedElementState = {
      ...el,
      textProps: el.textProps ? { ...el.textProps } : undefined,
      mediaProps: el.mediaProps ? { ...el.mediaProps } : undefined,
      border: el.border ? { ...el.border } : undefined,
    };

    // Group tracks by property and sort by delayMs ascending so multiple motions
    // on the same object & property execute in timeline sequence without later
    // tracks' backwards-fill overwriting earlier tracks before their delayMs start time.
    const byProp = new Map<AnimatableProperty, AnimationTrack[]>();
    for (const tr of elTracks) {
      const list = byProp.get(tr.property) ?? [];
      list.push(tr);
      byProp.set(tr.property, list);
    }

    for (const [prop, propTracks] of byProp.entries()) {
      const sortedTracks = [...propTracks].sort((a, b) => (a.delayMs || 0) - (b.delayMs || 0));
      for (let idx = 0; idx < sortedTracks.length; idx++) {
        const track = sortedTracks[idx];
        // If this is a subsequent track on the same property (idx > 0), only apply it
        // once the timeline has reached its start time (`delayMs`).
        if (idx > 0 && currentTimelineMs < (track.delayMs || 0)) {
          continue;
        }
        const val = evaluateTrackAtTime(track, currentTimelineMs);
        if (val === null) continue;

        switch (prop) {
          case 'x':
            if (typeof val === 'number') computed.x = val;
            break;
          case 'y':
            if (typeof val === 'number') computed.y = val;
            break;
          case 'width':
            if (typeof val === 'number') computed.width = Math.max(1, val);
            break;
          case 'height':
            if (typeof val === 'number') computed.height = Math.max(1, val);
            break;
          case 'scaleX':
            if (typeof val === 'number') computed.scaleX = val;
            break;
          case 'scaleY':
            if (typeof val === 'number') computed.scaleY = val;
            break;
          case 'rotation':
            if (typeof val === 'number') computed.rotation = val;
            break;
          case 'opacity':
            if (typeof val === 'number') computed.opacity = clamp(val, 0, 1);
            break;
          case 'backgroundColor':
            if (typeof val === 'string') computed.backgroundColor = val;
            break;
          case 'color':
            if (typeof val === 'string' && computed.textProps) computed.textProps.color = val;
            break;
          case 'borderRadius':
            if (typeof val === 'number' && computed.border) computed.border.radius = Math.max(0, val);
            break;
          case 'textReveal':
            if (typeof val === 'number') computed.textRevealRatio = clamp(val, 0, 1);
            break;
          case 'cropProgress':
            if (typeof val === 'number') computed.cropProgress = clamp(val, 0, 1);
            break;
          case 'volume':
            if (typeof val === 'number' && computed.mediaProps) {
              computed.mediaProps.volume = clamp(val, 0, 1);
            }
            break;
        }
      }
    }

    return computed;
  });
}

export interface PresetAnimationOptions {
  delayMs?: number;
  rotationAngleDeg?: number;
  distancePx?: number;
  scaleFactor?: number;
  easing?: EasingFunction;
  repeatCount?: number;
  reverse?: boolean;
  label?: string;
}

export function createPresetAnimationTracks(
  element: SceneElement,
  preset: AnimationPresetName,
  durationMs = 1000,
  options: PresetAnimationOptions = {}
): AnimationTrack[] {
  const delayMs = Math.max(0, options.delayMs ?? 0);
  const makeTrack = (
    property: AnimatableProperty,
    startVal: number | string,
    endVal: number | string,
    easing: EasingFunction = options.easing ?? 'easeOut',
    repeatCount = options.repeatCount ?? 1,
    reverse = options.reverse ?? false,
    extra: Partial<AnimationTrack> = {}
  ): AnimationTrack => ({
    id: createId('track'),
    elementId: element.id,
    property,
    preset,
    label: options.label || `${preset} (${property})`,
    durationMs,
    delayMs,
    repeatCount,
    reverse,
    fillMode: 'both',
    ...extra,
    keyframes: [
      { id: createId('kf'), timeMs: 0, value: startVal, easing },
      { id: createId('kf'), timeMs: durationMs, value: endVal, easing },
    ],
  });

  const dist = options.distancePx ?? 260;
  const vDist = options.distancePx ?? 200;
  const angle = options.rotationAngleDeg ?? 180;
  const scaleIn = options.scaleFactor ?? 0.4;
  const scaleOut = options.scaleFactor ?? 1.35;

  switch (preset) {
    case 'fade-in':
      return [makeTrack('opacity', 0, element.opacity || 1, 'easeOut')];
    case 'fade-out':
      return [makeTrack('opacity', element.opacity || 1, 0, 'easeIn')];
    case 'slide-left':
      return [
        makeTrack('x', element.x + dist, element.x, 'easeOut', 1, false, { distancePx: dist }),
        makeTrack('opacity', 0, element.opacity || 1, 'easeOut'),
      ];
    case 'slide-right':
      return [
        makeTrack('x', element.x - dist, element.x, 'easeOut', 1, false, { distancePx: dist }),
        makeTrack('opacity', 0, element.opacity || 1, 'easeOut'),
      ];
    case 'slide-up':
      return [
        makeTrack('y', element.y + vDist, element.y, 'easeOut', 1, false, { distancePx: vDist }),
        makeTrack('opacity', 0, element.opacity || 1, 'easeOut'),
      ];
    case 'slide-down':
      return [
        makeTrack('y', element.y - vDist, element.y, 'easeOut', 1, false, { distancePx: vDist }),
        makeTrack('opacity', 0, element.opacity || 1, 'easeOut'),
      ];
    case 'zoom-in':
      return [
        makeTrack('scaleX', scaleIn, element.scaleX || 1, 'easeOut', 1, false, { scaleFactor: scaleIn }),
        makeTrack('scaleY', scaleIn, element.scaleY || 1, 'easeOut', 1, false, { scaleFactor: scaleIn }),
        makeTrack('opacity', 0, element.opacity || 1, 'easeOut'),
      ];
    case 'zoom-out':
      return [
        makeTrack('scaleX', scaleOut, element.scaleX || 1, 'easeOut', 1, false, { scaleFactor: scaleOut }),
        makeTrack('scaleY', scaleOut, element.scaleY || 1, 'easeOut', 1, false, { scaleFactor: scaleOut }),
      ];
    case 'bounce': {
      const bDist = options.distancePx ?? 120;
      return [makeTrack('y', element.y - bDist, element.y, 'bounce', 1, false, { distancePx: bDist })];
    }
    case 'drop-in': {
      const dDist = options.distancePx ?? 240;
      return [
        makeTrack('y', element.y - dDist, element.y, 'bounce', 1, false, { distancePx: dDist }),
        makeTrack('opacity', 0, element.opacity || 1, 'easeOut'),
      ];
    }
    case 'rotate':
      return [
        makeTrack('rotation', element.rotation - angle, element.rotation, 'easeOut', 1, false, {
          rotationAngleDeg: angle,
        }),
      ];
    case 'spin-cw': {
      const cwAngle = options.rotationAngleDeg ?? 360;
      return [
        makeTrack(
          'rotation',
          element.rotation,
          element.rotation + cwAngle,
          options.easing ?? 'linear',
          options.repeatCount ?? 1,
          false,
          { rotationAngleDeg: cwAngle }
        ),
      ];
    }
    case 'spin-ccw': {
      const ccwAngle = options.rotationAngleDeg ?? -360;
      const signedAngle = ccwAngle > 0 ? -ccwAngle : ccwAngle;
      return [
        makeTrack(
          'rotation',
          element.rotation,
          element.rotation + signedAngle,
          options.easing ?? 'linear',
          options.repeatCount ?? 1,
          false,
          { rotationAngleDeg: signedAngle }
        ),
      ];
    }
    case 'swing': {
      const swingAngle = options.rotationAngleDeg ?? 18;
      return [
        makeTrack(
          'rotation',
          element.rotation - swingAngle,
          element.rotation + swingAngle,
          'easeInOut',
          options.repeatCount ?? -1,
          true,
          { rotationAngleDeg: swingAngle }
        ),
      ];
    }
    case 'spiral-in': {
      const spAngle = options.rotationAngleDeg ?? 360;
      return [
        makeTrack('rotation', element.rotation - spAngle, element.rotation, 'easeOut', 1, false, {
          rotationAngleDeg: spAngle,
        }),
        makeTrack('scaleX', 0.25, element.scaleX || 1, 'easeOut', 1, false, { scaleFactor: 0.25 }),
        makeTrack('scaleY', 0.25, element.scaleY || 1, 'easeOut', 1, false, { scaleFactor: 0.25 }),
        makeTrack('opacity', 0, element.opacity || 1, 'easeOut'),
      ];
    }
    case 'pulse': {
      const pScale = options.scaleFactor ?? 1.12;
      return [
        makeTrack('scaleX', element.scaleX || 1, pScale, 'easeInOut', options.repeatCount ?? -1, true, {
          scaleFactor: pScale,
        }),
        makeTrack('scaleY', element.scaleY || 1, pScale, 'easeInOut', options.repeatCount ?? -1, true, {
          scaleFactor: pScale,
        }),
      ];
    }
    case 'float': {
      const fDist = options.distancePx ?? 24;
      return [
        makeTrack('y', element.y, element.y - fDist, 'easeInOut', options.repeatCount ?? -1, true, {
          distancePx: fDist,
        }),
      ];
    }
    case 'shake': {
      const sDist = options.distancePx ?? 16;
      return [
        makeTrack('x', element.x - sDist, element.x + sDist, 'elastic', options.repeatCount ?? 2, true, {
          distancePx: sDist,
        }),
      ];
    }
    case 'flip':
      return [makeTrack('scaleX', -1, element.scaleX || 1, 'easeInOut')];
    case 'flip-y':
      return [makeTrack('scaleY', -1, element.scaleY || 1, 'easeInOut')];
    case 'skew-slide': {
      const skAngle = options.rotationAngleDeg ?? 14;
      const skDist = options.distancePx ?? 220;
      return [
        makeTrack('x', element.x - skDist, element.x, 'easeOut', 1, false, { distancePx: skDist }),
        makeTrack('rotation', element.rotation - skAngle, element.rotation, 'easeOut', 1, false, {
          rotationAngleDeg: skAngle,
        }),
      ];
    }
    case 'flash':
      return [
        makeTrack('opacity', 1, 0.15, 'easeInOut', options.repeatCount ?? 3, true),
      ];
    case 'rubber-band': {
      const rbScale = options.scaleFactor ?? 1.25;
      return [
        makeTrack('scaleX', rbScale, element.scaleX || 1, 'elastic', 1, false, { scaleFactor: rbScale }),
        makeTrack('scaleY', 0.78, element.scaleY || 1, 'elastic', 1, false, { scaleFactor: rbScale }),
      ];
    }
    case 'typewriter':
      return [makeTrack('textReveal', 0, 1, 'linear')];
    case 'wipe':
    case 'reveal':
      return [makeTrack('cropProgress', 0, 1, 'easeInOut')];
    case 'ken-burns': {
      const kbScale = options.scaleFactor ?? 1.14;
      return [
        makeTrack('scaleX', 1, kbScale, 'easeInOut', -1, true, { scaleFactor: kbScale }),
        makeTrack('scaleY', 1, kbScale, 'easeInOut', -1, true, { scaleFactor: kbScale }),
      ];
    }
    case 'pan-drift': {
      const pDist = options.distancePx ?? 25;
      return [makeTrack('x', element.x - pDist, element.x + pDist, 'easeInOut', -1, true, { distancePx: pDist })];
    }
    case 'ticker': {
      const tDist = options.distancePx ?? 400;
      return [makeTrack('x', element.x + tDist, element.x - tDist, 'linear', -1, false, { distancePx: tDist })];
    }
    default:
      return [];
  }
}

export interface SceneTransitionStyle {
  opacity: number;
  transform: string;
  clipPath?: string;
}

export function computeSceneTransitionStyle(
  entryTransition: TransitionConfig,
  exitTransition: TransitionConfig,
  sceneElapsedMs: number,
  sceneDurationMs: number
): SceneTransitionStyle {
  let opacity = 1;
  let transform = 'none';
  let clipPath: string | undefined;

  if (entryTransition && entryTransition.type !== 'none' && entryTransition.durationMs > 0) {
    if (sceneElapsedMs < entryTransition.durationMs) {
      const p = evaluateEasing(sceneElapsedMs / entryTransition.durationMs, entryTransition.easing);
      switch (entryTransition.type) {
        case 'fade':
          opacity = p;
          break;
        case 'slide-left':
          transform = `translateX(${(1 - p) * 100}%)`;
          break;
        case 'slide-right':
          transform = `translateX(${-(1 - p) * 100}%)`;
          break;
        case 'slide-up':
          transform = `translateY(${(1 - p) * 100}%)`;
          break;
        case 'zoom':
          opacity = p;
          transform = `scale(${0.85 + 0.15 * p})`;
          break;
        case 'wipe':
          clipPath = `inset(0 ${(1 - p) * 100}% 0 0)`;
          break;
      }
      return { opacity, transform, clipPath };
    }
  }

  if (
    exitTransition &&
    exitTransition.type !== 'none' &&
    exitTransition.durationMs > 0 &&
    sceneDurationMs > exitTransition.durationMs
  ) {
    const remaining = sceneDurationMs - sceneElapsedMs;
    if (remaining >= 0 && remaining < exitTransition.durationMs) {
      const p = evaluateEasing(1 - remaining / exitTransition.durationMs, exitTransition.easing);
      switch (exitTransition.type) {
        case 'fade':
          opacity = 1 - p;
          break;
        case 'slide-left':
          transform = `translateX(${-p * 100}%)`;
          break;
        case 'slide-right':
          transform = `translateX(${p * 100}%)`;
          break;
        case 'slide-up':
          transform = `translateY(${-p * 100}%)`;
          break;
        case 'zoom':
          opacity = 1 - p;
          transform = `scale(${1 + 0.15 * p})`;
          break;
        case 'wipe':
          clipPath = `inset(0 0 0 ${p * 100}%)`;
          break;
      }
    }
  }

  return { opacity, transform, clipPath };
}
