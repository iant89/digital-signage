import { AssetItem, AudioClipConfig, Scene, ScriptModule, SignageProject } from '@packages/project-model';
import { createId, deepClone } from '@packages/shared';

export interface SavedSceneTemplate {
  format: 'digital-signage-scene-template';
  version: 1;
  id: string;
  name: string;
  category: 'My Templates';
  description: string;
  width: number;
  height: number;
  createdAt: string;
  scene: Scene;
  assets: AssetItem[];
  scripts: ScriptModule[];
  audioTracks: AudioClipConfig[];
}

export function exportSceneTemplate(project: SignageProject, sceneId: string): SavedSceneTemplate {
  const scene = project.scenes.find(s => s.id === sceneId);
  if (!scene) throw new Error('Select a scene before exporting a template.');
  const audioTracks = (project.audioTracks ?? []).filter(t => t.scope !== 'environment' && t.sceneIds.includes(scene.id));
  const referenced = new Set(scene.elements.flatMap(e => e.mediaProps ? [e.mediaProps.assetId] : []));
  if (scene.backgroundAudioAssetId) referenced.add(scene.backgroundAudioAssetId);
  audioTracks.filter(t => !t.synthPreset).forEach(t => referenced.add(t.assetId));
  const missing = [...referenced].filter(id => !project.assets.some(a => a.id === id && !a.missing));
  if (missing.length) throw new Error(`Cannot export: missing media assets (${missing.join(', ')}).`);
  const assets = project.assets.filter(a => referenced.has(a.id) || a.type === 'font');
  if (assets.some(a => !a.dataUrl.startsWith('data:') || a.optimizedDataUrl && !a.optimizedDataUrl.startsWith('data:'))) {
    throw new Error('Template media must be embedded data URLs. Re-import externally linked media before exporting.');
  }
  return deepClone({ format: 'digital-signage-scene-template', version: 1, id: createId('template'), name: scene.name,
    category: 'My Templates', description: `Saved from ${project.settings.name}`, width: project.settings.width,
    height: project.settings.height, createdAt: new Date().toISOString(), scene: { ...scene,
      referenceWidth: project.settings.width, referenceHeight: project.settings.height }, assets,
    scripts: project.scripts.filter(s => scene.scriptIds.includes(s.id)), audioTracks });
}

/** Reusable instances own all IDs; navigation outside this scene is not portable. */
export function instantiateSavedTemplate(template: SavedSceneTemplate, width: number, height: number) {
  const copy = deepClone(template);
  const sceneId = createId('scene');
  const ids = new Map<string, string>([[copy.scene.id, sceneId]]);
  copy.scene.elements.forEach(e => ids.set(e.id, createId(`el-${e.type}`)));
  copy.scene.animationTracks.forEach(t => ids.set(t.id, createId('track')));
  copy.assets.forEach(a => ids.set(a.id, createId('asset')));
  copy.scripts.forEach(s => ids.set(s.id, createId('script')));
  const remap = (id: string) => ids.get(id) ?? id;
  const scale = Math.min(width / copy.width, height / copy.height);
  const dx = (width - copy.width * scale) / 2, dy = (height - copy.height * scale) / 2;
  copy.scene.id = sceneId;
  copy.scene.referenceWidth = width; copy.scene.referenceHeight = height;
  copy.scene.elements.forEach(e => {
    e.id = remap(e.id); e.x = dx + e.x * scale; e.y = dy + e.y * scale; e.width *= scale; e.height *= scale;
    if (e.textProps) e.textProps.fontSize *= scale;
    if (e.groupChildrenIds) e.groupChildrenIds = e.groupChildrenIds.map(remap);
    if (e.parentGroupId) e.parentGroupId = remap(e.parentGroupId);
    if (e.mediaProps) e.mediaProps.assetId = remap(e.mediaProps.assetId);
  });
  copy.scene.animationTracks.forEach(t => {
    t.id = remap(t.id); t.elementId = remap(t.elementId);
    t.keyframes.forEach(k => {
      k.id = createId('keyframe');
      if (typeof k.value === 'number' && ['x', 'y', 'width', 'height'].includes(t.property)) {
        k.value = k.value * scale + (t.property === 'x' ? dx : t.property === 'y' ? dy : 0);
      }
    });
    if (t.distancePx !== undefined) t.distancePx *= scale;
  });
  if (copy.scene.backgroundAudioAssetId) copy.scene.backgroundAudioAssetId = remap(copy.scene.backgroundAudioAssetId);
  copy.scene.scriptIds = copy.scene.scriptIds.map(remap);
  copy.assets.forEach(a => { a.id = remap(a.id); a.logicalPath = `templates/${sceneId}/${a.id}`; });
  copy.audioTracks.forEach(t => { t.id = createId('audio-track'); t.scope = 'scene'; t.assetId = remap(t.assetId); t.sceneIds = [sceneId]; });
  copy.scripts.forEach(s => {
    s.id = remap(s.id);
    s.rules.forEach(r => {
      r.id = createId('rule');
      if (r.eventName?.startsWith('click:')) r.eventName = `click:${remap(r.eventName.slice(6))}`;
      // Cross-scene/playlist navigation depends on the source project, so omit it.
      r.actions = r.actions.filter(a => a.type !== 'selectPlaylist' && (a.type !== 'transitionToScene' || ids.has(a.sceneId ?? '')));
      r.actions.forEach(a => {
        if (a.elementId) a.elementId = remap(a.elementId);
        if (a.sceneId) a.sceneId = remap(a.sceneId);
        if (a.type === 'triggerAnimation' && typeof a.value === 'string') a.value = remap(a.value);
      });
    });
  });
  return { scene: copy.scene, assets: copy.assets, scripts: copy.scripts, audioTracks: copy.audioTracks };
}
