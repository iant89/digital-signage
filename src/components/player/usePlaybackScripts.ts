import { useEffect, useRef, useState } from 'react';
import { SignageProject } from '@packages/project-model';
import { EvaluatedTimelineState } from '@packages/playback-engine';
import { computeSceneElementsAtTime } from '@packages/animation-engine';
import { ScriptPlaybackSession } from '@packages/script-runtime/session';
import { ScriptHostMessage, applyScriptMessagesToElements } from '@packages/script-runtime';

export function usePlaybackScripts(project: SignageProject | undefined, timeline: EvaluatedTimelineState | null,
  playing: boolean, command: (message: ScriptHostMessage) => void) {
  const session = useRef<ScriptPlaybackSession | null>(null);
  const commandRef = useRef(command); commandRef.current = command;
  const timelineRef = useRef(timeline); timelineRef.current = timeline;
  const patches = useRef(new Map<string, ScriptHostMessage>());
  const animations = useRef(new Map<string, number>());
  const [revision, setRevision] = useState(0);
  const sceneKey = timeline ? `${timeline.cycleIndex}:${timeline.activeSlotIndex}:${timeline.activeScene.id}` : '';
  const currentKey = useRef('');
  useEffect(() => {
    if (!project) return;
    let stopping = false;
    const controller = new ScriptPlaybackSession(project, messages => {
      if (stopping) return;
      let changed = false;
      for (const m of messages) {
        const scene = timelineRef.current?.activeScene;
        if (['setText', 'setVisibility', 'setOpacity'].includes(m.actionType)) {
          if (!scene?.elements.some(e => e.id === m.elementId)) continue;
          const key = `${m.elementId}:${m.actionType}`;
          if (patches.current.get(key)?.value !== m.value) { patches.current.set(key, m); changed = true; }
        } else if (m.actionType === 'triggerAnimation') {
          if (scene?.animationTracks.some(t => t.elementId === m.elementId && (!m.value || t.id === m.value))) {
            animations.current.set(JSON.stringify([m.elementId, m.value || '']), timelineRef.current?.sceneElapsedMs ?? 0); changed = true;
          }
        } else commandRef.current(m);
      }
      if (changed) setRevision(r => r + 1);
    });
    session.current = controller;
    return () => { stopping = true; controller.dispose(); session.current = null; patches.current.clear(); animations.current.clear(); currentKey.current = ''; };
  }, [project]);
  useEffect(() => {
    if (!timeline || !session.current) return;
    if (currentKey.current !== sceneKey) {
      patches.current.clear(); animations.current.clear(); currentKey.current = sceneKey;
      setRevision(r => r + 1);
    }
    session.current.step(timeline.activeScene, sceneKey, timeline.sceneElapsedMs, playing);
  }, [timeline, sceneKey, playing, project]);
  useEffect(() => {
    const onEvent = (event: Event) => {
      const name = (event as CustomEvent).detail?.name;
      if (typeof name === 'string' && name.length > 0 && name.length <= 128) session.current?.event(name);
    };
    window.addEventListener('signage:script-event', onEvent);
    return () => window.removeEventListener('signage:script-event', onEvent);
  }, []);
  let elements = timeline?.elements ?? [];
  for (const [key, start] of animations.current) {
    const [elementId, trackId] = JSON.parse(key) as [string, string];
    const tracks = timeline?.activeScene.animationTracks.filter(t => t.elementId === elementId && (!trackId || t.id === trackId)) ?? [];
    const authored = timeline?.activeScene.elements.filter(e => e.id === elementId) ?? [];
    const animated = computeSceneElementsAtTime(authored, tracks, Math.max(0, (timeline?.sceneElapsedMs ?? 0) - start));
    elements = elements.map(e => animated.find(a => a.id === e.id) ?? e);
  }
  void revision;
  return { elements: applyScriptMessagesToElements(elements, [...patches.current.values()]),
    event: (name: string) => session.current?.event(name),
    diagnostics: session.current?.diagnostics ?? [] };
}
