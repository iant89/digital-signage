import { describe, expect, it } from 'vitest';
import {
  analyzeProjectAssets,
  createNewElement,
  createStarterProject,
  migrateProjectSchema,
  validateProject,
} from '@packages/project-model';
import {
  alignElements,
  computeSnappedPosition,
  distributeElements,
  groupElements,
  reorderElementLayer,
} from '@packages/editor-core';
import {
  computeSceneElementsAtTime,
  computeSceneTransitionStyle,
  createPresetAnimationTracks,
  evaluateEasing,
  evaluateTrackAtTime,
  interpolateValue,
} from '@packages/animation-engine';
import { buildPlaylistTimeline, resolveActivePlaylist } from '@packages/playlist-engine';
import { DiagnosticsCollector } from '@packages/diagnostics';

describe('Project Model, Editor Core, Animation Engine & Playlist Scheduling', () => {
  it('validates starter project and analyzes assets accurately', () => {
    const project = createStarterProject();
    const validation = validateProject(project);
    expect(validation.valid).toBe(true);
    expect(validation.issues.filter((i) => i.severity === 'error')).toHaveLength(0);

    const analysis = analyzeProjectAssets(project);
    expect(analysis.totalAssets).toBeGreaterThanOrEqual(3);
    expect(analysis.missingAssets).toHaveLength(0);
    expect(analysis.totalByteSize).toBeGreaterThan(500);
  });

  it('migrates legacy v0 project schemas to v1 safely', () => {
    const migrated = migrateProjectSchema({
      schemaVersion: 0,
      settings: {
        id: 'legacy-1',
        name: 'Legacy Sign',
        description: '',
        width: 1920,
        height: 1080,
        frameRate: 30,
        scalingMode: 'contain',
        safeAreaPercent: 90,
        gridSizePx: 20,
        snapToGrid: true,
        snapToElements: true,
        defaultSceneDurationMs: 8000,
      },
    });
    expect(migrated.schemaVersion).toBe(1);
    expect(migrated.scenes.length).toBeGreaterThan(0);
  });

  it('performs alignment, distribution, layer ordering, grouping, and snapping', () => {
    const el1 = createNewElement('shape', { id: 'e1', x: 100, y: 100, width: 100, height: 50, zIndex: 1 });
    const el2 = createNewElement('shape', { id: 'e2', x: 300, y: 220, width: 100, height: 50, zIndex: 2 });
    const el3 = createNewElement('shape', { id: 'e3', x: 700, y: 340, width: 100, height: 50, zIndex: 3 });

    const alignedLeft = alignElements([el1, el2, el3], ['e1', 'e2', 'e3'], 'left');
    expect(alignedLeft.every((e) => e.x === 100)).toBe(true);

    const distributed = distributeElements([el1, el2, el3], ['e1', 'e2', 'e3'], 'horizontal');
    expect(distributed.find((e) => e.id === 'e2')?.x).toBe(400);

    const reordered = reorderElementLayer([el1, el2, el3], 'e1', 'front');
    expect(reordered.find((e) => e.id === 'e1')?.zIndex).toBe(3);

    const grouped = groupElements([el1, el2], ['e1', 'e2']);
    expect(grouped.groupId).toBeTruthy();
    expect(grouped.elements).toHaveLength(3);

    const snapped = computeSnappedPosition(
      { id: 'moving', x: 103, y: 97, width: 100, height: 50 },
      [el1],
      {
        snapToGrid: true,
        gridSizePx: 24,
        snapToElements: true,
        canvasWidth: 1920,
        canvasHeight: 1080,
      }
    );
    expect(snapped.x).toBe(100);
    expect(snapped.y).toBe(100);
    expect(snapped.guides.length).toBeGreaterThan(0);
  });

  it('evaluates easing, color/number interpolation, keyframes, and scene transitions deterministically', () => {
    expect(evaluateEasing(0, 'easeInOut')).toBe(0);
    expect(evaluateEasing(1, 'bounce')).toBeCloseTo(1, 3);
    expect(interpolateValue(0, 100, 0.5, 'linear')).toBe(50);
    expect(interpolateValue('#000000', '#ffffff', 0.5, 'linear')).toBe('#808080');

    const textEl = createNewElement('text', { id: 't1', x: 200, y: 150, opacity: 1 });
    const tracks = createPresetAnimationTracks(textEl, 'fade-in', 1000);
    expect(tracks).toHaveLength(1);
    expect(evaluateTrackAtTime(tracks[0], 0)).toBe(0);
    expect(evaluateTrackAtTime(tracks[0], 500)).toBeGreaterThan(0.4);
    expect(evaluateTrackAtTime(tracks[0], 1000)).toBe(1);

    const computed = computeSceneElementsAtTime([textEl], tracks, 0);
    expect(computed[0].opacity).toBe(0);

    const trans = computeSceneTransitionStyle(
      { type: 'fade', durationMs: 500, easing: 'linear' },
      { type: 'slide-left', durationMs: 500, easing: 'linear' },
      250,
      5000
    );
    expect(trans.opacity).toBeCloseTo(0.5, 2);
  });

  it('resolves schedules with deterministic priority & tie-breaking and falls back safely', () => {
    const project = createStarterProject();
    const plA = { ...project.playlists[0], id: 'pl-low', name: 'Low Priority Playlist' };
    const plB = { ...project.playlists[0], id: 'pl-high', name: 'High Priority Playlist' };
    const plOverride = { ...project.playlists[0], id: 'pl-override', name: 'Date Override Playlist' };

    const schedules = [
      {
        ...project.schedules[0],
        id: 'sched-1',
        playlistId: 'pl-low',
        priority: 10,
        startDate: '2026-01-01',
        endDate: '2026-12-31',
      },
      {
        ...project.schedules[0],
        id: 'sched-2',
        playlistId: 'pl-high',
        priority: 50,
        startDate: '2026-01-01',
        endDate: '2026-12-31',
      },
    ];

    const match = resolveActivePlaylist(
      [plA, plB, plOverride],
      schedules,
      new Date('2026-10-25T14:00:00.000Z')
    );
    expect(match.activePlaylist.id).toBe('pl-high');
    expect(match.usedFallback).toBe(false);

    // Date-specific override wins
    schedules[0].dateOverrides = [{ date: '2026-10-25', playlistId: 'pl-override' }];
    const overrideMatch = resolveActivePlaylist(
      [plA, plB, plOverride],
      schedules,
      new Date('2026-10-25T14:00:00.000Z')
    );
    expect(overrideMatch.activePlaylist.id).toBe('pl-override');

    // Out-of-range date uses fallback playlist
    const fallbackMatch = resolveActivePlaylist(
      [plA, plB],
      schedules,
      new Date('2030-05-01T12:00:00.000Z'),
      'pl-low'
    );
    expect(fallbackMatch.usedFallback).toBe(true);
    expect(fallbackMatch.activePlaylist.id).toBe('pl-low');

    const timeline = buildPlaylistTimeline(plA, project.scenes);
    expect(timeline.slots.length).toBe(2);
    expect(timeline.totalCycleDurationMs).toBe(22000);
  });

  it('redacts sensitive tokens and passwords from diagnostic logs (Spec Section 12)', () => {
    const collector = new DiagnosticsCollector();
    const entry = collector.log(
      'info',
      'ADMIN',
      'Request with Bearer eyJhbGciOiJIUzI1NiJ9.secret',
      {
        adminPassword: 'MySecretPassword',
        apiToken: 'tok_12345',
        safeField: '1920x1080',
      }
    );
    expect(entry.message).toContain('Bearer [REDACTED]');
    expect(entry.metadata?.adminPassword).toBe('[REDACTED]');
    expect(entry.metadata?.apiToken).toBe('[REDACTED]');
    expect(entry.metadata?.safeField).toBe('1920x1080');
  });
});
