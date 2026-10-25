// ============================================================================
// src/utils/audioEngine.ts
// Background Music, Scene/Multi-Scene/Environment Audio Playback Engine,
// Waveform & Envelope Calculator, Track Combiner & Web Audio API Synthesizer
// ============================================================================

import { AudioClipConfig } from '@packages/project-model';
import { createId, sha256Bytes } from '@packages/shared';

/**
 * Checks whether an audio track is active on a given scene and timeline position (ms).
 */
export function isAudioTrackActiveOnScene(
  track: AudioClipConfig,
  sceneId: string
): boolean {
  if (!track.enabled) return false;
  if (track.scope === 'environment') return true;
  if (track.scope === 'multi-scene') {
    return track.sceneIds.length === 0 || track.sceneIds.includes(sceneId);
  }
  return track.sceneIds.includes(sceneId);
}

/**
 * Evaluates whether the track is currently playing at `timelineTimeMs` and computes
 * its instantaneous gain (0..1) and mapped source file offset (ms), taking into account:
 * - startAtMs / stopAtMs timeline window
 * - trimStartMs / trimEndMs crop bounds
 * - loop behavior
 * - deletedRegions (spliced/muted sections)
 * - fadeInMs / fadeOutMs envelope and volume level
 */
export function evaluateAudioTrackAtTime(
  track: AudioClipConfig,
  sceneId: string,
  timelineTimeMs: number,
  sceneDurationMs = 10000
): {
  playing: boolean;
  sourceOffsetMs: number;
  instantGain: number;
  channelPan: number; // -1 left, 0 stereo/mono, +1 right
  inDeletedRegion: boolean;
} {
  const channelPan =
    track.channel === 'left' ? -1 : track.channel === 'right' ? 1 : 0;

  if (!isAudioTrackActiveOnScene(track, sceneId)) {
    return {
      playing: false,
      sourceOffsetMs: 0,
      instantGain: 0,
      channelPan,
      inDeletedRegion: false,
    };
  }

  const startAt = Math.max(0, track.startAtMs || 0);
  const stopAt =
    track.stopAtMs && track.stopAtMs > startAt ? track.stopAtMs : sceneDurationMs;

  if (timelineTimeMs < startAt || timelineTimeMs > stopAt) {
    return {
      playing: false,
      sourceOffsetMs: 0,
      instantGain: 0,
      channelPan,
      inDeletedRegion: false,
    };
  }

  const elapsedInWindow = timelineTimeMs - startAt;
  const trimStart = Math.max(0, track.trimStartMs || 0);
  const trimEnd =
    track.trimEndMs && track.trimEndMs > trimStart
      ? track.trimEndMs
      : Math.max(trimStart + 500, track.durationMs || 10000);
  const croppedDuration = Math.max(200, trimEnd - trimStart);

  if (!track.loop && elapsedInWindow > croppedDuration) {
    return {
      playing: false,
      sourceOffsetMs: trimEnd,
      instantGain: 0,
      channelPan,
      inDeletedRegion: false,
    };
  }

  const offsetInCrop = track.loop
    ? elapsedInWindow % croppedDuration
    : Math.min(croppedDuration, elapsedInWindow);
  const sourceOffsetMs = trimStart + offsetInCrop;

  // Check if sourceOffsetMs falls inside a deleted region
  for (const reg of track.deletedRegions || []) {
    if (sourceOffsetMs >= reg.startMs && sourceOffsetMs <= reg.endMs) {
      return {
        playing: false,
        sourceOffsetMs,
        instantGain: 0,
        channelPan,
        inDeletedRegion: true,
      };
    }
  }

  // Compute fade-in and fade-out envelope within the active playback window
  const activeWindowDuration = Math.min(
    stopAt - startAt,
    track.loop ? stopAt - startAt : croppedDuration
  );
  let fadeMultiplier = 1;
  if (track.fadeInMs > 0 && elapsedInWindow < track.fadeInMs) {
    fadeMultiplier = Math.min(1, elapsedInWindow / track.fadeInMs);
  }
  const remainingInWindow = activeWindowDuration - elapsedInWindow;
  if (track.fadeOutMs > 0 && remainingInWindow < track.fadeOutMs) {
    fadeMultiplier = Math.min(
      fadeMultiplier,
      Math.max(0, remainingInWindow / track.fadeOutMs)
    );
  }

  const instantGain = Math.max(0, Math.min(1, (track.volume ?? 0.8) * fadeMultiplier));
  return {
    playing: instantGain > 0.001,
    sourceOffsetMs,
    instantGain: Math.round(instantGain * 1000) / 1000,
    channelPan,
    inDeletedRegion: false,
  };
}

/**
 * Generates deterministic normalized waveform bars (0.1 .. 1.0) for the Audio Editor
 * and Timeline lane, reflecting cropped bounds, deleted sections, and fade ramps.
 */
export function generateTrackWaveformBars(
  track: AudioClipConfig,
  barCount = 64
): Array<{
  index: number;
  timeMs: number;
  amplitude: number;
  inCropRange: boolean;
  isDeleted: boolean;
  envelopeMultiplier: number;
}> {
  const duration = Math.max(1000, track.durationMs || 10000);
  const trimStart = Math.max(0, track.trimStartMs || 0);
  const trimEnd =
    track.trimEndMs && track.trimEndMs > trimStart ? track.trimEndMs : duration;
  const seed = sha256Bytes(`${track.id}:${track.assetId}:${track.synthPreset || 'ambient'}`);

  return Array.from({ length: barCount }, (_, idx) => {
    const ratio = idx / Math.max(1, barCount - 1);
    const timeMs = Math.round(ratio * duration);
    const inCropRange = timeMs >= trimStart && timeMs <= trimEnd;
    const isDeleted = (track.deletedRegions || []).some(
      (r) => timeMs >= r.startMs && timeMs <= r.endMs
    );

    let envelopeMultiplier = 1;
    if (inCropRange) {
      const offsetFromTrimStart = timeMs - trimStart;
      const offsetFromTrimEnd = trimEnd - timeMs;
      if (track.fadeInMs > 0 && offsetFromTrimStart < track.fadeInMs) {
        envelopeMultiplier = Math.min(1, offsetFromTrimStart / track.fadeInMs);
      }
      if (track.fadeOutMs > 0 && offsetFromTrimEnd < track.fadeOutMs) {
        envelopeMultiplier = Math.min(
          envelopeMultiplier,
          Math.max(0, offsetFromTrimEnd / track.fadeOutMs)
        );
      }
    }

    const b = seed[idx % seed.length];
    const wave =
      0.22 +
      0.45 * Math.abs(Math.sin(idx * 0.42 + (b % 7))) +
      0.3 * ((b % 100) / 100);
    const rawAmp = Math.min(1, wave * (track.volume ?? 0.8));

    return {
      index: idx,
      timeMs,
      amplitude: isDeleted ? 0.06 : inCropRange ? rawAmp * envelopeMultiplier : rawAmp * 0.25,
      inCropRange,
      isDeleted,
      envelopeMultiplier,
    };
  });
}

/**
 * Combines two or more AudioClipConfigs into a single mixed composite track.
 */
export function combineAudioTracks(
  tracks: AudioClipConfig[],
  combinedName?: string
): AudioClipConfig {
  if (tracks.length === 0) {
    throw new Error('Select at least one audio track to combine.');
  }

  const maxDuration = Math.max(...tracks.map((t) => t.durationMs || 10000));
  const avgVolume =
    Math.round(
      (tracks.reduce((acc, t) => acc + (t.volume ?? 0.8), 0) / tracks.length) * 100
    ) / 100;
  const maxFadeIn = Math.max(...tracks.map((t) => t.fadeInMs || 0));
  const maxFadeOut = Math.max(...tracks.map((t) => t.fadeOutMs || 0));
  const mergedSceneIds = Array.from(
    new Set(tracks.flatMap((t) => t.sceneIds || []))
  );
  const hasEnv = tracks.some((t) => t.scope === 'environment');

  return {
    id: createId('audio-combined'),
    name:
      combinedName ||
      `Combined Mix (${tracks.map((t) => t.name.split(' ')[0]).join(' + ')})`,
    assetId: `asset-combined-${Date.now().toString(36)}`,
    scope: hasEnv
      ? 'environment'
      : mergedSceneIds.length > 1
        ? 'multi-scene'
        : 'scene',
    sceneIds: mergedSceneIds,
    enabled: true,
    loop: tracks.some((t) => t.loop),
    volume: Math.min(1, avgVolume),
    channel: tracks[0].channel || 'stereo',
    startAtMs: Math.min(...tracks.map((t) => t.startAtMs || 0)),
    stopAtMs: Math.max(...tracks.map((t) => t.stopAtMs || 0)),
    trimStartMs: 0,
    trimEndMs: maxDuration,
    durationMs: maxDuration,
    fadeInMs: maxFadeIn,
    fadeOutMs: maxFadeOut,
    deletedRegions: [],
    combinedTrackIds: tracks.map((t) => t.id),
    synthPreset: 'upbeat-pulse',
  };
}

/**
 * Generates a real playable 16-bit PCM WAV data URL for a track (with crop, deleted
 * sections, fade-in/out, volume, and stereo channel routing baked in).
 */
export function buildWavDataUrlForTrack(
  track: AudioClipConfig,
  previewDurationSec = 2.5
): string {
  const sampleRate = 8000;
  const numChannels = 2;
  const trimStart = Math.max(0, track.trimStartMs || 0);
  const trimEnd =
    track.trimEndMs && track.trimEndMs > trimStart
      ? track.trimEndMs
      : track.durationMs || 6000;
  const effectiveSec = Math.min(
    previewDurationSec,
    Math.max(0.5, (trimEnd - trimStart) / 1000)
  );
  const numSamples = Math.floor(sampleRate * effectiveSec);
  const dataSize = numSamples * numChannels * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) {
      view.setUint8(offset + i, s.charCodeAt(i));
    }
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * 2, true);
  view.setUint16(32, numChannels * 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);

  const baseFreq =
    track.synthPreset === 'corporate-chime'
      ? 523.25 // C5
      : track.synthPreset === 'upbeat-pulse'
        ? 440.0 // A4
        : track.synthPreset === 'lofi-drone'
          ? 196.0 // G3
          : 261.63; // C4 ambient pad

  const fadeInSec = (track.fadeInMs || 0) / 1000;
  const fadeOutSec = (track.fadeOutMs || 0) / 1000;

  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    const tSec = i / sampleRate;
    const sourceMs = trimStart + tSec * 1000;
    const isDeleted = (track.deletedRegions || []).some(
      (r) => sourceMs >= r.startMs && sourceMs <= r.endMs
    );

    let env = track.volume ?? 0.75;
    if (fadeInSec > 0 && tSec < fadeInSec) {
      env *= tSec / fadeInSec;
    }
    if (fadeOutSec > 0 && effectiveSec - tSec < fadeOutSec) {
      env *= Math.max(0, (effectiveSec - tSec) / fadeOutSec);
    }
    if (isDeleted) env = 0;

    // Harmonic chord synthesis
    const sampleVal =
      0.5 * Math.sin(2 * Math.PI * baseFreq * tSec) +
      0.3 * Math.sin(2 * Math.PI * (baseFreq * 1.25) * tSec) +
      0.2 * Math.sin(2 * Math.PI * (baseFreq * 1.5) * tSec);

    const pcm = Math.max(-1, Math.min(1, sampleVal * env)) * 18000;
    const leftSample = track.channel === 'right' ? 0 : Math.round(pcm);
    const rightSample = track.channel === 'left' ? 0 : Math.round(pcm);

    view.setInt16(offset, leftSample, true);
    view.setInt16(offset + 2, rightSample, true);
    offset += 4;
  }

  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const b64 =
    typeof btoa === 'function'
      ? btoa(binary)
      : Buffer.from(bytes).toString('base64');
  return `data:audio/wav;base64,${b64}`;
}
