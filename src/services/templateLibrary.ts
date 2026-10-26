import { create } from 'zustand';
import { SavedSceneTemplate } from '@packages/scene-templates/export';

export const TEMPLATE_LIBRARY_KEY = 'digital-signage:scene-templates:v1';
export function loadTemplateLibrary(): SavedSceneTemplate[] {
  try {
    const stored = JSON.parse(localStorage.getItem(TEMPLATE_LIBRARY_KEY) ?? '[]');
    if (!Array.isArray(stored)) return [];
    return stored.filter(t => t?.format === 'digital-signage-scene-template' && t.version === 1 &&
      typeof t.id === 'string' && typeof t.name === 'string' && t.width > 0 && t.height > 0 &&
      Array.isArray(t.scene?.elements) && Array.isArray(t.assets) && Array.isArray(t.scripts) && Array.isArray(t.audioTracks));
  } catch { return []; }
}
export const useTemplateLibrary = create<{
  templates: SavedSceneTemplate[];
  save: (template: SavedSceneTemplate) => void;
}>(set => ({
  templates: loadTemplateLibrary(),
  save: template => {
    // Persist first so quota/disabled-storage errors never silently lose a saved template.
    const templates = [...loadTemplateLibrary().filter(t => t.id !== template.id), template];
    try { localStorage.setItem(TEMPLATE_LIBRARY_KEY, JSON.stringify(templates)); }
    catch { throw new Error('Template library storage is full or unavailable. Free browser storage and try again.'); }
    set({ templates });
  },
}));
