// ============================================================================
// src/store/useStudioStore.ts — Zustand Immutable State, Undo/Redo History,
// IndexedDB Autosave, Timeline Playhead, Package Builder & Kiosk State
// ============================================================================

import { create } from 'zustand';
import {
  AnimationPresetName,
  AnimationTrack,
  AssetItem,
  ElementType,
  Keyframe,
  Scene,
  SceneElement,
  SignageProject,
  createNewElement,
  createStarterProject,
} from '@packages/project-model';
import {
  AlignmentMode,
  DistributionMode,
  LayerOrderAction,
  alignElements,
  distributeElements,
  groupElements,
  loadProjectPersistence,
  reorderElementLayer,
  saveProjectPersistence,
} from '@packages/editor-core';
import { createPresetAnimationTracks } from '@packages/animation-engine';
import {
  BuildPackageOptions,
  BuiltSignagePackage,
  buildSignagePackage,
  extractProjectFromArchive,
} from '@packages/signage-format';
import {
  DEFAULT_KIOSK_CONFIGURATION,
  KioskConfiguration,
  ProtectedAdminController,
  WatchdogSupervisor,
} from '@packages/kiosk-integration';
import { DiagnosticsCollector } from '@packages/diagnostics';
import { createId, deepClone, sha256Hex } from '@packages/shared';

export type AppMode =
  | 'studio'
  | 'player'
  | 'package-manager'
  | 'network-console'
  | 'device-admin';

export interface HistorySnapshot {
  label: string;
  project: SignageProject;
}

export interface StudioState {
  appMode: AppMode;
  themeMode: 'dark' | 'light';
  project: SignageProject;
  activeSceneId: string;
  selectedElementIds: string[];
  clipboardElements: SceneElement[];
  undoStack: HistorySnapshot[];
  redoStack: HistorySnapshot[];
  saveStatus: 'saved' | 'saving' | 'recovered';
  lastSavedAt: string;

  // Canvas & Timeline state
  canvasZoom: number;
  showGrid: boolean;
  showSafeArea: boolean;
  showRulers: boolean;
  timelineTimeMs: number;
  timelinePlaying: boolean;
  timelineZoom: number;
  frameDisplayMode: 'time' | 'frames';

  // Panel Collapse & Mobile Responsive Layout state
  leftSidebarCollapsed: boolean;
  rightInspectorCollapsed: boolean;
  bottomTimelineCollapsed: boolean;
  isMobileLayout: boolean;

  // Package & Player state
  builtPackages: BuiltSignagePackage[];
  standalonePlayerPackage: BuiltSignagePackage | null;
  kioskConfig: KioskConfiguration;
  adminController: ProtectedAdminController;
  watchdogSupervisor: WatchdogSupervisor;
  diagnostics: DiagnosticsCollector;
  notification: { type: 'info' | 'success' | 'warning' | 'error'; message: string } | null;

  // Actions
  setAppMode: (mode: AppMode) => void;
  setThemeMode: (mode: 'dark' | 'light') => void;
  notify: (type: 'info' | 'success' | 'warning' | 'error', message: string) => void;
  clearNotification: () => void;

  commitProjectChange: (label: string, mutator: (draft: SignageProject) => void) => void;
  undo: () => void;
  redo: () => void;
  hydrateFromPersistence: () => Promise<void>;
  resetToStarterProject: () => void;

  setActiveSceneId: (sceneId: string) => void;
  addScene: (name?: string) => void;
  duplicateScene: (sceneId: string) => void;
  deleteScene: (sceneId: string) => void;
  updateScene: (sceneId: string, partial: Partial<Scene>) => void;

  setSelectedElementIds: (ids: string[]) => void;
  addElement: (type: ElementType, partial?: Partial<SceneElement>) => void;
  updateElement: (elementId: string, partial: Partial<SceneElement>, recordUndo?: boolean) => void;
  deleteSelectedElements: () => void;
  duplicateSelectedElements: () => void;
  copySelectedElements: () => void;
  cutSelectedElements: () => void;
  pasteElements: () => void;
  alignSelected: (mode: AlignmentMode) => void;
  distributeSelected: (mode: DistributionMode) => void;
  reorderLayer: (elementId: string, action: LayerOrderAction) => void;
  groupSelected: () => void;

  applyAnimationPreset: (elementId: string, preset: AnimationPresetName, durationMs?: number) => void;
  addOrUpdateKeyframe: (trackId: string, keyframe: Keyframe) => void;
  deleteTrack: (trackId: string) => void;
  toggleTrackMute: (trackId: string) => void;
  toggleTrackLock: (trackId: string) => void;

  importAssetItem: (asset: Omit<AssetItem, 'id' | 'contentHash'> & { id?: string; contentHash?: string }) => void;
  deleteAssetItem: (assetId: string) => void;
  relinkMissingAsset: (assetId: string, dataUrl: string, byteSize: number) => void;

  setCanvasZoom: (zoom: number) => void;
  setShowGrid: (show: boolean) => void;
  setShowSafeArea: (show: boolean) => void;
  setShowRulers: (show: boolean) => void;
  setTimelineTimeMs: (ms: number) => void;
  setTimelinePlaying: (playing: boolean) => void;
  setTimelineZoom: (zoom: number) => void;
  setFrameDisplayMode: (mode: 'time' | 'frames') => void;

  setLeftSidebarCollapsed: (collapsed: boolean) => void;
  toggleLeftSidebar: () => void;
  setRightInspectorCollapsed: (collapsed: boolean) => void;
  toggleRightInspector: () => void;
  setBottomTimelineCollapsed: (collapsed: boolean) => void;
  toggleBottomTimeline: () => void;
  setIsMobileLayout: (isMobile: boolean) => void;

  exportSignagePackage: (options?: BuildPackageOptions) => BuiltSignagePackage;
  importSignagePackageBytes: (bytes: Uint8Array, openInPlayer?: boolean) => BuiltSignagePackage;
  setStandalonePlayerPackage: (pkg: BuiltSignagePackage | null) => void;
  updateKioskConfig: (partial: Partial<KioskConfiguration>) => void;
}

const initialProject = createStarterProject();
const initialBuiltPkg = buildSignagePackage(initialProject, {
  profile: 'compact',
  signPackage: true,
});

const diagnosticsCollector = new DiagnosticsCollector();
diagnosticsCollector.log('info', 'PLAYBACK', 'Digital Signage Studio initialized with default 1080p project.');
diagnosticsCollector.log('info', 'ARCHIVE', `Prebuilt initial package "${initialBuiltPkg.fileName}" (SHA-256: ${initialBuiltPkg.packageHashHex.slice(0, 16)}...)`);

export const useStudioStore = create<StudioState>((set, get) => ({
  appMode: 'studio',
  themeMode: 'dark',
  project: initialProject,
  activeSceneId: initialProject.entrySceneId,
  selectedElementIds: [initialProject.scenes[0].elements[2].id],
  clipboardElements: [],
  undoStack: [],
  redoStack: [],
  saveStatus: 'saved',
  lastSavedAt: new Date().toLocaleTimeString(),

  canvasZoom: 0.46,
  showGrid: true,
  showSafeArea: true,
  showRulers: true,
  timelineTimeMs: 0,
  timelinePlaying: false,
  timelineZoom: 1,
  frameDisplayMode: 'time',

  leftSidebarCollapsed: false,
  rightInspectorCollapsed: false,
  bottomTimelineCollapsed: false,
  isMobileLayout:
    typeof window !== 'undefined' &&
    (window.innerWidth <= 768 ||
      /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '')),

  builtPackages: [initialBuiltPkg],
  standalonePlayerPackage: initialBuiltPkg,
  kioskConfig: { ...DEFAULT_KIOSK_CONFIGURATION },
  adminController: new ProtectedAdminController('ApexAdmin!2026', DEFAULT_KIOSK_CONFIGURATION.deviceId),
  watchdogSupervisor: new WatchdogSupervisor(initialBuiltPkg.manifest.project.id, 'pkg-default-safe-fallback', 3),
  diagnostics: diagnosticsCollector,
  notification: null,

  setAppMode: (mode) => set({ appMode: mode }),
  setThemeMode: (mode) => set({ themeMode: mode }),

  notify: (type, message) => {
    set({ notification: { type, message } });
    setTimeout(() => {
      if (get().notification?.message === message) {
        set({ notification: null });
      }
    }, 4500);
  },
  clearNotification: () => set({ notification: null }),

  commitProjectChange: (label, mutator) => {
    const current = get().project;
    const snapshot: HistorySnapshot = {
      label,
      project: deepClone(current),
    };
    const nextProject = deepClone(current);
    mutator(nextProject);
    nextProject.updatedAt = new Date().toISOString();

    const nextUndo = [...get().undoStack, snapshot].slice(-40);
    set({
      project: nextProject,
      undoStack: nextUndo,
      redoStack: [],
      saveStatus: 'saving',
    });

    void saveProjectPersistence(nextProject).then(() => {
      set({
        saveStatus: 'saved',
        lastSavedAt: new Date().toLocaleTimeString(),
      });
    });
  },

  undo: () => {
    const { undoStack, redoStack, project } = get();
    if (undoStack.length === 0) return;
    const prev = undoStack[undoStack.length - 1];
    const nextRedo: HistorySnapshot = { label: prev.label, project: deepClone(project) };
    set({
      project: prev.project,
      undoStack: undoStack.slice(0, -1),
      redoStack: [...redoStack, nextRedo],
      saveStatus: 'saved',
    });
    void saveProjectPersistence(prev.project);
  },

  redo: () => {
    const { undoStack, redoStack, project } = get();
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    const nextUndo: HistorySnapshot = { label: next.label, project: deepClone(project) };
    set({
      project: next.project,
      undoStack: [...undoStack, nextUndo],
      redoStack: redoStack.slice(0, -1),
      saveStatus: 'saved',
    });
    void saveProjectPersistence(next.project);
  },

  hydrateFromPersistence: async () => {
    const loaded = await loadProjectPersistence();
    if (loaded && loaded.scenes && loaded.scenes.length > 0) {
      set({
        project: loaded,
        activeSceneId: loaded.entrySceneId || loaded.scenes[0].id,
        saveStatus: 'recovered',
      });
    }
  },

  resetToStarterProject: () => {
    const fresh = createStarterProject();
    const pkg = buildSignagePackage(fresh, { profile: 'compact', signPackage: true });
    set({
      project: fresh,
      activeSceneId: fresh.entrySceneId,
      selectedElementIds: [fresh.scenes[0].elements[0]?.id].filter(Boolean),
      undoStack: [],
      redoStack: [],
      builtPackages: [pkg, ...get().builtPackages],
      standalonePlayerPackage: pkg,
    });
    void saveProjectPersistence(fresh);
    get().notify('info', 'Reset workspace to default starter project.');
  },

  setActiveSceneId: (sceneId) => {
    const scene = get().project.scenes.find((s) => s.id === sceneId);
    if (!scene) return;
    set({
      activeSceneId: sceneId,
      selectedElementIds: scene.elements[0] ? [scene.elements[0].id] : [],
      timelineTimeMs: 0,
    });
  },

  addScene: (name) => {
    const newId = createId('scene');
    get().commitProjectChange('Add Scene', (draft) => {
      const idx = draft.scenes.length + 1;
      const newScene: Scene = {
        id: newId,
        name: name || `0${idx} — New Broadcast Scene`,
        durationMs: draft.settings.defaultSceneDurationMs || 10000,
        backgroundColor: '#0f172a',
        backgroundGradient: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
        referenceWidth: draft.settings.width,
        referenceHeight: draft.settings.height,
        elements: [
          createNewElement('text', {
            name: 'Scene Heading',
            x: 120,
            y: 120,
            width: 900,
            height: 80,
            textProps: {
              text: name || `Scene ${idx} Headline`,
              fontFamily: 'Inter, system-ui, sans-serif',
              fontSize: 48,
              fontWeight: 'bold',
              color: '#f8fafc',
              textAlign: 'left',
              letterSpacing: 1,
              lineHeight: 1.2,
              wrap: true,
              autoFit: false,
              scrolling: false,
              direction: 'ltr',
            },
          }),
        ],
        animationTracks: [],
        entryTransition: { type: 'fade', durationMs: 500, easing: 'easeOut' },
        exitTransition: { type: 'fade', durationMs: 500, easing: 'easeOut' },
        scriptIds: [],
        permissions: ['scene:read'],
        completionBehavior: 'advance',
        failureBehavior: 'skip-scene',
      };
      draft.scenes.push(newScene);
      if (draft.playlists[0]) {
        draft.playlists[0].items.push({
          id: createId('pli'),
          sceneId: newId,
          enabled: true,
        });
      }
    });
    set({ activeSceneId: newId, timelineTimeMs: 0 });
  },

  duplicateScene: (sceneId) => {
    const newId = createId('scene');
    get().commitProjectChange('Duplicate Scene', (draft) => {
      const orig = draft.scenes.find((s) => s.id === sceneId);
      if (!orig) return;
      const copy = deepClone(orig);
      copy.id = newId;
      copy.name = `${orig.name} (Copy)`;
      draft.scenes.push(copy);
      if (draft.playlists[0]) {
        draft.playlists[0].items.push({
          id: createId('pli'),
          sceneId: newId,
          enabled: true,
        });
      }
    });
    set({ activeSceneId: newId });
  },

  deleteScene: (sceneId) => {
    const { project } = get();
    if (project.scenes.length <= 1) {
      get().notify('warning', 'A project must contain at least one scene.');
      return;
    }
    get().commitProjectChange('Delete Scene', (draft) => {
      draft.scenes = draft.scenes.filter((s) => s.id !== sceneId);
      if (draft.entrySceneId === sceneId && draft.scenes[0]) {
        draft.entrySceneId = draft.scenes[0].id;
      }
      for (const pl of draft.playlists) {
        pl.items = pl.items.filter((i) => i.sceneId !== sceneId);
      }
    });
    const remaining = get().project.scenes;
    if (remaining[0]) {
      set({ activeSceneId: remaining[0].id });
    }
  },

  updateScene: (sceneId, partial) => {
    get().commitProjectChange('Update Scene Settings', (draft) => {
      const scene = draft.scenes.find((s) => s.id === sceneId);
      if (scene) {
        Object.assign(scene, partial);
      }
    });
  },

  setSelectedElementIds: (ids) => set({ selectedElementIds: ids }),

  addElement: (type, partial) => {
    const { activeSceneId, project } = get();
    const activeScene = project.scenes.find((s) => s.id === activeSceneId);
    const maxZ = activeScene
      ? activeScene.elements.reduce((m, e) => Math.max(m, e.zIndex), 0)
      : 1;
    const el = createNewElement(type, { ...partial, zIndex: maxZ + 1 });

    get().commitProjectChange(`Add ${type} element`, (draft) => {
      const scene = draft.scenes.find((s) => s.id === activeSceneId);
      if (scene) {
        scene.elements.push(el);
      }
    });
    set({ selectedElementIds: [el.id] });
  },

  updateElement: (elementId, partial, recordUndo = true) => {
    const { activeSceneId } = get();
    if (recordUndo) {
      get().commitProjectChange('Update Element', (draft) => {
        const scene = draft.scenes.find((s) => s.id === activeSceneId);
        const el = scene?.elements.find((e) => e.id === elementId);
        if (el) {
          Object.assign(el, partial);
        }
      });
    } else {
      const next = deepClone(get().project);
      const scene = next.scenes.find((s) => s.id === activeSceneId);
      const el = scene?.elements.find((e) => e.id === elementId);
      if (el) {
        Object.assign(el, partial);
        set({ project: next });
      }
    }
  },

  deleteSelectedElements: () => {
    const { activeSceneId, selectedElementIds } = get();
    if (selectedElementIds.length === 0) return;
    const idSet = new Set(selectedElementIds);
    get().commitProjectChange('Delete Elements', (draft) => {
      const scene = draft.scenes.find((s) => s.id === activeSceneId);
      if (!scene) return;
      scene.elements = scene.elements.filter((e) => !idSet.has(e.id) || e.locked);
      scene.animationTracks = scene.animationTracks.filter((t) => !idSet.has(t.elementId));
    });
    set({ selectedElementIds: [] });
  },

  duplicateSelectedElements: () => {
    const { activeSceneId, selectedElementIds } = get();
    if (selectedElementIds.length === 0) return;
    const newIds: string[] = [];
    get().commitProjectChange('Duplicate Elements', (draft) => {
      const scene = draft.scenes.find((s) => s.id === activeSceneId);
      if (!scene) return;
      const maxZ = scene.elements.reduce((m, e) => Math.max(m, e.zIndex), 0);
      selectedElementIds.forEach((id, i) => {
        const orig = scene.elements.find((e) => e.id === id);
        if (!orig) return;
        const copy = deepClone(orig);
        copy.id = createId(`el-${orig.type}`);
        copy.name = `${orig.name} Copy`;
        copy.x += 32;
        copy.y += 32;
        copy.zIndex = maxZ + i + 1;
        scene.elements.push(copy);
        newIds.push(copy.id);
      });
    });
    set({ selectedElementIds: newIds });
  },

  copySelectedElements: () => {
    const { activeSceneId, selectedElementIds, project } = get();
    const scene = project.scenes.find((s) => s.id === activeSceneId);
    if (!scene) return;
    const idSet = new Set(selectedElementIds);
    const copied = scene.elements.filter((e) => idSet.has(e.id)).map((e) => deepClone(e));
    set({ clipboardElements: copied });
    if (copied.length > 0) {
      get().notify('info', `Copied ${copied.length} element(s) to clipboard.`);
    }
  },

  cutSelectedElements: () => {
    get().copySelectedElements();
    get().deleteSelectedElements();
  },

  pasteElements: () => {
    const { activeSceneId, clipboardElements } = get();
    if (clipboardElements.length === 0) return;
    const newIds: string[] = [];
    get().commitProjectChange('Paste Elements', (draft) => {
      const scene = draft.scenes.find((s) => s.id === activeSceneId);
      if (!scene) return;
      const maxZ = scene.elements.reduce((m, e) => Math.max(m, e.zIndex), 0);
      clipboardElements.forEach((item, idx) => {
        const copy = deepClone(item);
        copy.id = createId(`el-${item.type}`);
        copy.name = `${item.name} (Pasted)`;
        copy.x += 40;
        copy.y += 40;
        copy.zIndex = maxZ + idx + 1;
        scene.elements.push(copy);
        newIds.push(copy.id);
      });
    });
    set({ selectedElementIds: newIds });
  },

  alignSelected: (mode) => {
    const { activeSceneId, selectedElementIds, project } = get();
    if (selectedElementIds.length === 0) return;
    get().commitProjectChange(`Align ${mode}`, (draft) => {
      const scene = draft.scenes.find((s) => s.id === activeSceneId);
      if (!scene) return;
      scene.elements = alignElements(
        scene.elements,
        selectedElementIds,
        mode,
        project.settings.width,
        project.settings.height
      );
    });
  },

  distributeSelected: (mode) => {
    const { activeSceneId, selectedElementIds } = get();
    if (selectedElementIds.length < 3) {
      get().notify('info', 'Select at least 3 elements to distribute evenly.');
      return;
    }
    get().commitProjectChange(`Distribute ${mode}`, (draft) => {
      const scene = draft.scenes.find((s) => s.id === activeSceneId);
      if (!scene) return;
      scene.elements = distributeElements(scene.elements, selectedElementIds, mode);
    });
  },

  reorderLayer: (elementId, action) => {
    const { activeSceneId } = get();
    get().commitProjectChange(`Layer ${action}`, (draft) => {
      const scene = draft.scenes.find((s) => s.id === activeSceneId);
      if (!scene) return;
      scene.elements = reorderElementLayer(scene.elements, elementId, action);
    });
  },

  groupSelected: () => {
    const { activeSceneId, selectedElementIds } = get();
    if (selectedElementIds.length < 2) {
      get().notify('info', 'Select at least 2 elements to group.');
      return;
    }
    let createdGroupId: string | null = null;
    get().commitProjectChange('Group Elements', (draft) => {
      const scene = draft.scenes.find((s) => s.id === activeSceneId);
      if (!scene) return;
      const res = groupElements(scene.elements, selectedElementIds);
      scene.elements = res.elements;
      createdGroupId = res.groupId;
    });
    if (createdGroupId) {
      set({ selectedElementIds: [createdGroupId] });
    }
  },

  applyAnimationPreset: (elementId, preset, durationMs = 1000) => {
    const { activeSceneId } = get();
    get().commitProjectChange(`Apply Animation ${preset}`, (draft) => {
      const scene = draft.scenes.find((s) => s.id === activeSceneId);
      if (!scene) return;
      const el = scene.elements.find((e) => e.id === elementId);
      if (!el) return;
      scene.animationTracks = scene.animationTracks.filter((t) => t.elementId !== elementId);
      if (preset !== 'none') {
        const tracks = createPresetAnimationTracks(el, preset, durationMs);
        scene.animationTracks.push(...tracks);
      }
    });
    set({ timelineTimeMs: 0, timelinePlaying: true });
  },

  addOrUpdateKeyframe: (trackId, keyframe) => {
    const { activeSceneId } = get();
    get().commitProjectChange('Edit Keyframe', (draft) => {
      const scene = draft.scenes.find((s) => s.id === activeSceneId);
      const track = scene?.animationTracks.find((t) => t.id === trackId);
      if (!track) return;
      const existingIdx = track.keyframes.findIndex(
        (k) => k.id === keyframe.id || Math.abs(k.timeMs - keyframe.timeMs) < 20
      );
      if (existingIdx >= 0) {
        track.keyframes[existingIdx] = keyframe;
      } else {
        track.keyframes.push(keyframe);
        track.keyframes.sort((a, b) => a.timeMs - b.timeMs);
      }
    });
  },

  deleteTrack: (trackId) => {
    const { activeSceneId } = get();
    get().commitProjectChange('Delete Animation Track', (draft) => {
      const scene = draft.scenes.find((s) => s.id === activeSceneId);
      if (!scene) return;
      scene.animationTracks = scene.animationTracks.filter((t) => t.id !== trackId);
    });
  },

  toggleTrackMute: (trackId) => {
    const { activeSceneId } = get();
    get().commitProjectChange('Toggle Track Mute', (draft) => {
      const scene = draft.scenes.find((s) => s.id === activeSceneId);
      const track = scene?.animationTracks.find((t) => t.id === trackId);
      if (track) track.muted = !track.muted;
    });
  },

  toggleTrackLock: (trackId) => {
    const { activeSceneId } = get();
    get().commitProjectChange('Toggle Track Lock', (draft) => {
      const scene = draft.scenes.find((s) => s.id === activeSceneId);
      const track = scene?.animationTracks.find((t) => t.id === trackId);
      if (track) track.locked = !track.locked;
    });
  },

  importAssetItem: (assetInput) => {
    const id = assetInput.id || createId('asset');
    const contentHash = assetInput.contentHash || sha256Hex(assetInput.dataUrl);
    const fullAsset: AssetItem = {
      ...assetInput,
      id,
      contentHash,
    };
    get().commitProjectChange(`Import Asset ${fullAsset.name}`, (draft) => {
      draft.assets.push(fullAsset);
    });
    get().diagnostics.log('info', 'MEDIA', `Imported asset "${fullAsset.name}" (${fullAsset.mimeType}, hash ${contentHash.slice(0, 12)})`);
    get().notify('success', `Imported "${fullAsset.name}" into Media Library.`);
  },

  deleteAssetItem: (assetId) => {
    get().commitProjectChange('Delete Asset', (draft) => {
      draft.assets = draft.assets.filter((a) => a.id !== assetId);
    });
  },

  relinkMissingAsset: (assetId, dataUrl, byteSize) => {
    get().commitProjectChange('Relink Asset', (draft) => {
      const asset = draft.assets.find((a) => a.id === assetId);
      if (asset) {
        asset.dataUrl = dataUrl;
        asset.byteSize = byteSize;
        asset.contentHash = sha256Hex(dataUrl);
        asset.missing = false;
      }
    });
    get().notify('success', 'Asset relinked and verified.');
  },

  setCanvasZoom: (zoom) => set({ canvasZoom: Math.max(0.15, Math.min(2.0, zoom)) }),
  setShowGrid: (show) => set({ showGrid: show }),
  setShowSafeArea: (show) => set({ showSafeArea: show }),
  setShowRulers: (show) => set({ showRulers: show }),
  setTimelineTimeMs: (ms) => set({ timelineTimeMs: Math.max(0, ms) }),
  setTimelinePlaying: (playing) => set({ timelinePlaying: playing }),
  setTimelineZoom: (zoom) => set({ timelineZoom: Math.max(0.5, Math.min(4, zoom)) }),
  setFrameDisplayMode: (mode) => set({ frameDisplayMode: mode }),

  setLeftSidebarCollapsed: (collapsed) =>
    set((state) => ({
      leftSidebarCollapsed: collapsed,
      rightInspectorCollapsed:
        !collapsed && state.isMobileLayout ? true : state.rightInspectorCollapsed,
    })),

  toggleLeftSidebar: () => {
    const next = !get().leftSidebarCollapsed;
    get().setLeftSidebarCollapsed(next);
  },

  setRightInspectorCollapsed: (collapsed) =>
    set((state) => ({
      rightInspectorCollapsed: collapsed,
      leftSidebarCollapsed:
        !collapsed && state.isMobileLayout ? true : state.leftSidebarCollapsed,
    })),

  toggleRightInspector: () => {
    const next = !get().rightInspectorCollapsed;
    get().setRightInspectorCollapsed(next);
  },

  setBottomTimelineCollapsed: (collapsed) => set({ bottomTimelineCollapsed: collapsed }),

  toggleBottomTimeline: () => set({ bottomTimelineCollapsed: !get().bottomTimelineCollapsed }),

  setIsMobileLayout: (isMobile) =>
    set({
      isMobileLayout: isMobile,
      leftSidebarCollapsed: isMobile ? true : false,
      rightInspectorCollapsed: isMobile ? true : false,
      bottomTimelineCollapsed: isMobile ? true : false,
      canvasZoom: isMobile ? 0.22 : 0.46,
    }),

  exportSignagePackage: (options) => {
    const pkg = buildSignagePackage(get().project, options);
    set({
      builtPackages: [pkg, ...get().builtPackages.filter((p) => p.packageHashHex !== pkg.packageHashHex)],
      standalonePlayerPackage: pkg,
    });
    get().diagnostics.log(
      'info',
      'ARCHIVE',
      `Exported .signage package "${pkg.fileName}" (${pkg.stats.archiveBytes} bytes, ${pkg.stats.savingsPercent}% compression savings)`
    );
    get().notify('success', `Built "${pkg.fileName}" (${pkg.stats.savingsPercent}% saved).`);
    return pkg;
  },

  importSignagePackageBytes: (bytes, openInPlayer = false) => {
    const { project, report } = extractProjectFromArchive(bytes);
    const built = buildSignagePackage(project, {
      profile: report.manifest?.exportProfile ?? 'compact',
      signPackage: true,
    });
    const importedPkg: BuiltSignagePackage = {
      ...built,
      bytes,
      packageHashHex: report.packageHashHex,
      header: report.header!,
      entries: report.entries!,
      manifest: report.manifest!,
    };

    if (openInPlayer) {
      set({
        standalonePlayerPackage: importedPkg,
        builtPackages: [importedPkg, ...get().builtPackages.filter((p) => p.packageHashHex !== importedPkg.packageHashHex)],
        appMode: 'player',
      });
      get().notify('success', `Loaded package "${project.settings.name}" into Standalone Player.`);
    } else {
      set({
        project,
        activeSceneId: project.entrySceneId,
        selectedElementIds: [],
        standalonePlayerPackage: importedPkg,
        builtPackages: [importedPkg, ...get().builtPackages.filter((p) => p.packageHashHex !== importedPkg.packageHashHex)],
      });
      void saveProjectPersistence(project);
      get().notify('success', `Imported package "${project.settings.name}" into Studio Editor.`);
    }

    get().diagnostics.log('info', 'ARCHIVE', `Validated and imported .signage archive (${report.packageHashHex.slice(0, 16)}...)`);
    return importedPkg;
  },

  setStandalonePlayerPackage: (pkg) => set({ standalonePlayerPackage: pkg }),

  updateKioskConfig: (partial) => {
    set({ kioskConfig: { ...get().kioskConfig, ...partial } });
    get().diagnostics.log('info', 'KIOSK', 'Updated kiosk configuration settings', partial as Record<string, unknown>);
  },
}));
