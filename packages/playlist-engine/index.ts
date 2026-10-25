// ============================================================================
// @packages/playlist-engine — Playlist Sequencing, Deterministic Schedule
// Resolution, Priority Tie-Breaking & Fallback Handling
// ============================================================================

import { PlaybackSchedule, Playlist, Scene } from '@packages/project-model';

export interface ResolvedScheduleMatch {
  activePlaylist: Playlist;
  matchedSchedule?: PlaybackSchedule;
  usedFallback: boolean;
  reason: string;
}

function parseTimeMinutes(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec((hhmm || '').trim());
  if (!m) return null;
  const h = Number.parseInt(m[1], 10);
  const min = Number.parseInt(m[2], 10);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

/**
 * Evaluates active schedules at `nowUtc` using documented priority rules
 * and deterministic tie-breaking (Spec Section 9 & Section 28):
 * 1. Date-specific override matches take highest precedence within matching schedules
 * 2. Highest numerical `priority` wins
 * 3. Highest `revision` breaks ties
 * 4. Lexicographically smallest `id` breaks remaining ties deterministically
 * If no schedule matches or data is invalid, returns the configured fallback playlist.
 */
export function resolveActivePlaylist(
  playlists: Playlist[],
  schedules: PlaybackSchedule[],
  nowUtc: Date = new Date(),
  fallbackPlaylistId?: string,
  targetGroupId?: string
): ResolvedScheduleMatch {
  if (!Array.isArray(playlists) || playlists.length === 0) {
    throw new Error('At least one playlist must be available for playback.');
  }

  const playlistMap = new Map(playlists.map((p) => [p.id, p]));
  const fallback =
    (fallbackPlaylistId ? playlistMap.get(fallbackPlaylistId) : undefined) ?? playlists[0];

  if (!Array.isArray(schedules) || schedules.length === 0) {
    return {
      activePlaylist: fallback,
      usedFallback: true,
      reason: 'No schedules configured; using default fallback playlist.',
    };
  }

  const dateIso = nowUtc.toISOString().slice(0, 10); // YYYY-MM-DD
  const dayOfWeek = nowUtc.getUTCDay(); // 0..6
  const minutesOfDay = nowUtc.getUTCHours() * 60 + nowUtc.getUTCMinutes();

  const candidates: Array<{
    schedule: PlaybackSchedule;
    playlist: Playlist;
    hasDateOverride: boolean;
  }> = [];

  for (const sched of schedules) {
    if (!sched || !sched.enabled) continue;
    if (targetGroupId && sched.groupId && sched.groupId !== targetGroupId) continue;

    // Check date range
    if (sched.startDate && dateIso < sched.startDate) continue;
    if (sched.endDate && dateIso > sched.endDate) continue;

    // Check date-specific override first
    const override = sched.dateOverrides?.find((o) => o.date === dateIso);
    if (override) {
      const overridePl = playlistMap.get(override.playlistId);
      if (overridePl) {
        candidates.push({ schedule: sched, playlist: overridePl, hasDateOverride: true });
        continue;
      }
    }

    // Check day of week
    if (Array.isArray(sched.daysOfWeek) && sched.daysOfWeek.length > 0) {
      if (!sched.daysOfWeek.includes(dayOfWeek)) continue;
    }

    // Check time of day window
    const startMin = parseTimeMinutes(sched.startTime);
    const endMin = parseTimeMinutes(sched.endTime);
    if (startMin === null || endMin === null) continue;

    const inWindow =
      startMin <= endMin
        ? minutesOfDay >= startMin && minutesOfDay <= endMin
        : minutesOfDay >= startMin || minutesOfDay <= endMin;

    if (!inWindow) continue;

    const targetPl = playlistMap.get(sched.playlistId);
    if (!targetPl) continue;

    candidates.push({ schedule: sched, playlist: targetPl, hasDateOverride: false });
  }

  if (candidates.length === 0) {
    return {
      activePlaylist: fallback,
      usedFallback: true,
      reason: 'No active schedule matched current date/time; using fallback playlist.',
    };
  }

  // Deterministic sort:
  // 1. Date override first
  // 2. Higher priority
  // 3. Higher revision
  // 4. Alphabetical ID tie-breaker
  candidates.sort((a, b) => {
    if (a.hasDateOverride !== b.hasDateOverride) {
      return a.hasDateOverride ? -1 : 1;
    }
    if (b.schedule.priority !== a.schedule.priority) {
      return b.schedule.priority - a.schedule.priority;
    }
    if ((b.schedule.revision ?? 1) !== (a.schedule.revision ?? 1)) {
      return (b.schedule.revision ?? 1) - (a.schedule.revision ?? 1);
    }
    return a.schedule.id.localeCompare(b.schedule.id);
  });

  const winner = candidates[0];
  return {
    activePlaylist: winner.playlist,
    matchedSchedule: winner.schedule,
    usedFallback: false,
    reason: winner.hasDateOverride
      ? `Matched date override on schedule "${winner.schedule.name}".`
      : `Matched schedule "${winner.schedule.name}" (priority ${winner.schedule.priority}).`,
  };
}

export interface TimelineSlot {
  slotIndex: number;
  playlistItemId: string;
  scene: Scene;
  startOffsetMs: number;
  durationMs: number;
  endOffsetMs: number;
}

export function buildPlaylistTimeline(playlist: Playlist, scenes: Scene[]): {
  slots: TimelineSlot[];
  totalCycleDurationMs: number;
} {
  const sceneMap = new Map(scenes.map((s) => [s.id, s]));
  const slots: TimelineSlot[] = [];
  let cursorMs = 0;

  // If priority announcement is set, prepend it
  if (playlist.priorityAnnouncementSceneId) {
    const annScene = sceneMap.get(playlist.priorityAnnouncementSceneId);
    if (annScene) {
      const dur = Math.max(1000, annScene.durationMs || 10000);
      slots.push({
        slotIndex: 0,
        playlistItemId: 'priority-announcement',
        scene: annScene,
        startOffsetMs: 0,
        durationMs: dur,
        endOffsetMs: dur,
      });
      cursorMs += dur;
    }
  }

  for (const item of playlist.items) {
    if (!item.enabled) continue;
    const scene = sceneMap.get(item.sceneId);
    if (!scene) continue;
    const dur = Math.max(500, item.durationOverrideMs ?? scene.durationMs ?? 10000);
    slots.push({
      slotIndex: slots.length,
      playlistItemId: item.id,
      scene,
      startOffsetMs: cursorMs,
      durationMs: dur,
      endOffsetMs: cursorMs + dur,
    });
    cursorMs += dur;
  }

  if (slots.length === 0 && scenes.length > 0) {
    const first = scenes[0];
    const dur = Math.max(1000, first.durationMs || 10000);
    slots.push({
      slotIndex: 0,
      playlistItemId: 'fallback-slot',
      scene: first,
      startOffsetMs: 0,
      durationMs: dur,
      endOffsetMs: dur,
    });
    cursorMs = dur;
  }

  return {
    slots,
    totalCycleDurationMs: Math.max(1, cursorMs),
  };
}
