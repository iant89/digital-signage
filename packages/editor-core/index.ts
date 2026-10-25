// ============================================================================
// @packages/editor-core — Immutable Canvas Transforms, Alignment/Distribution,
// Grouping, Layer Ordering, Snap Guides & IndexedDB Crash Recovery Persistence
// ============================================================================

import { AnimationTrack, SceneElement, SignageProject } from '@packages/project-model';
import { createId, deepClone } from '@packages/shared';

export type AlignmentMode = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';
export type DistributionMode = 'horizontal' | 'vertical';
export type LayerOrderAction = 'front' | 'back' | 'forward' | 'backward';

export function alignElements(
  elements: SceneElement[],
  selectedIds: string[],
  mode: AlignmentMode,
  canvasWidth = 1920,
  canvasHeight = 1080
): SceneElement[] {
  const idSet = new Set(selectedIds);
  const selected = elements.filter((e) => idSet.has(e.id) && !e.locked);
  if (selected.length === 0) return elements;

  // If a single element is selected, align relative to canvas bounds
  const minX = selected.length === 1 ? 0 : Math.min(...selected.map((e) => e.x));
  const maxX = selected.length === 1 ? canvasWidth : Math.max(...selected.map((e) => e.x + e.width));
  const minY = selected.length === 1 ? 0 : Math.min(...selected.map((e) => e.y));
  const maxY = selected.length === 1 ? canvasHeight : Math.max(...selected.map((e) => e.y + e.height));
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;

  return elements.map((el) => {
    if (!idSet.has(el.id) || el.locked) return el;
    const copy = { ...el };
    switch (mode) {
      case 'left':
        copy.x = Math.round(minX);
        break;
      case 'center':
        copy.x = Math.round(centerX - copy.width / 2);
        break;
      case 'right':
        copy.x = Math.round(maxX - copy.width);
        break;
      case 'top':
        copy.y = Math.round(minY);
        break;
      case 'middle':
        copy.y = Math.round(centerY - copy.height / 2);
        break;
      case 'bottom':
        copy.y = Math.round(maxY - copy.height);
        break;
    }
    return copy;
  });
}

export function distributeElements(
  elements: SceneElement[],
  selectedIds: string[],
  mode: DistributionMode
): SceneElement[] {
  const idSet = new Set(selectedIds);
  const selected = elements.filter((e) => idSet.has(e.id) && !e.locked);
  if (selected.length < 3) return elements;

  const sorted =
    mode === 'horizontal'
      ? [...selected].sort((a, b) => a.x - b.x)
      : [...selected].sort((a, b) => a.y - b.y);

  const posMap = new Map<string, number>();
  if (mode === 'horizontal') {
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const span = last.x - first.x;
    const step = span / (sorted.length - 1);
    sorted.forEach((el, idx) => {
      posMap.set(el.id, Math.round(first.x + step * idx));
    });
  } else {
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const span = last.y - first.y;
    const step = span / (sorted.length - 1);
    sorted.forEach((el, idx) => {
      posMap.set(el.id, Math.round(first.y + step * idx));
    });
  }

  return elements.map((el) => {
    if (!posMap.has(el.id)) return el;
    const val = posMap.get(el.id)!;
    return mode === 'horizontal' ? { ...el, x: val } : { ...el, y: val };
  });
}

export function reorderElementLayer(
  elements: SceneElement[],
  elementId: string,
  action: LayerOrderAction
): SceneElement[] {
  const sorted = [...elements].sort((a, b) => a.zIndex - b.zIndex);
  const idx = sorted.findIndex((e) => e.id === elementId);
  if (idx === -1) return elements;

  const [item] = sorted.splice(idx, 1);
  if (action === 'front') {
    sorted.push(item);
  } else if (action === 'back') {
    sorted.unshift(item);
  } else if (action === 'forward') {
    sorted.splice(Math.min(sorted.length, idx + 1), 0, item);
  } else if (action === 'backward') {
    sorted.splice(Math.max(0, idx - 1), 0, item);
  }

  const zMap = new Map<string, number>();
  sorted.forEach((el, i) => zMap.set(el.id, i + 1));
  return elements.map((el) => ({
    ...el,
    zIndex: zMap.get(el.id) ?? el.zIndex,
  }));
}

export function groupElements(
  elements: SceneElement[],
  selectedIds: string[]
): { elements: SceneElement[]; groupId: string | null } {
  const idSet = new Set(selectedIds);
  const targets = elements.filter((e) => idSet.has(e.id));
  if (targets.length < 2) return { elements, groupId: null };

  const minX = Math.min(...targets.map((e) => e.x));
  const minY = Math.min(...targets.map((e) => e.y));
  const maxX = Math.max(...targets.map((e) => e.x + e.width));
  const maxY = Math.max(...targets.map((e) => e.y + e.height));
  const maxZ = Math.max(...targets.map((e) => e.zIndex));

  const groupId = createId('el-group');
  const groupEl: SceneElement = {
    id: groupId,
    name: `Group (${targets.length} items)`,
    type: 'group',
    x: minX,
    y: minY,
    width: Math.max(20, maxX - minX),
    height: Math.max(20, maxY - minY),
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    opacity: 1,
    zIndex: maxZ + 1,
    locked: false,
    visible: true,
    aspectRatioLocked: false,
    groupChildrenIds: targets.map((e) => e.id),
    border: { width: 1, color: '#38bdf8', style: 'dashed', radius: 12 },
  };

  const updated = elements.map((el) =>
    idSet.has(el.id) ? { ...el, parentGroupId: groupId } : el
  );
  return { elements: [...updated, groupEl], groupId };
}

export function ungroupElements(
  elements: SceneElement[],
  selectedIds: string[]
): SceneElement[] {
  const idSet = new Set(selectedIds);
  const groupIdsToDissolve = new Set<string>();

  for (const el of elements) {
    if (idSet.has(el.id)) {
      if (el.type === 'group') {
        groupIdsToDissolve.add(el.id);
      } else if (el.parentGroupId) {
        groupIdsToDissolve.add(el.parentGroupId);
      }
    }
  }

  if (groupIdsToDissolve.size === 0) return elements;

  return elements
    .filter((el) => !(el.type === 'group' && groupIdsToDissolve.has(el.id)))
    .map((el) =>
      el.parentGroupId && groupIdsToDissolve.has(el.parentGroupId)
        ? { ...el, parentGroupId: undefined }
        : el
    );
}

/**
 * Updates a target element's properties and, if it belongs to a group (`parentGroupId`
 * or `type === 'group'`), propagates position (`x`, `y`), size (`width`, `height`), and
 * rotation (`rotation`) changes across all components in the group.
 * Also shifts any position/rotation animation keyframes on moved/rotated elements by their
 * spatial delta so slide-in / entrance animations always land at the actual authored position
 * without affecting other objects in the group.
 */
export function applyElementOrGroupUpdate(
  elements: SceneElement[],
  animationTracks: AnimationTrack[],
  elementId: string,
  partial: Partial<SceneElement>
): { elements: SceneElement[]; animationTracks: AnimationTrack[] } {
  const target = elements.find((e) => e.id === elementId);
  if (!target) {
    return { elements, animationTracks };
  }

  const groupId = target.type === 'group' ? target.id : target.parentGroupId;
  const oldX = target.x;
  const oldY = target.y;
  const oldW = Math.max(1, target.width);
  const oldH = Math.max(1, target.height);
  const oldRot = target.rotation || 0;

  const newX = partial.x ?? oldX;
  const newY = partial.y ?? oldY;
  const newW = Math.max(1, partial.width ?? oldW);
  const newH = Math.max(1, partial.height ?? oldH);
  const newRot = partial.rotation ?? oldRot;

  const dx = newX - oldX;
  const dy = newY - oldY;
  const scaleW = newW / oldW;
  const scaleH = newH / oldH;
  const dRot = newRot - oldRot;

  const isResizing =
    (partial.width !== undefined && partial.width !== oldW) ||
    (partial.height !== undefined && partial.height !== oldH);
  const isMovingOnly = !isResizing && (dx !== 0 || dy !== 0);
  const isRotating = partial.rotation !== undefined && dRot !== 0;
  const hasSpatialChange = isResizing || isMovingOnly || isRotating;

  const elementDeltas = new Map<
    string,
    { dx: number; dy: number; dRot: number }
  >();

  let nextElements: SceneElement[];

  if (!groupId || !hasSpatialChange) {
    nextElements = elements.map((el) =>
      el.id === elementId ? { ...el, ...partial } : el
    );
    if (dx !== 0 || dy !== 0 || dRot !== 0) {
      elementDeltas.set(elementId, { dx, dy, dRot });
    }
  } else {
    // Propagate spatial changes across all members of `groupId`
    nextElements = elements.map((el) => {
      if (el.id === elementId) {
        elementDeltas.set(el.id, { dx, dy, dRot });
        return { ...el, ...partial };
      }

      const isGroupMember =
        el.parentGroupId === groupId && el.type !== 'group';
      if (!isGroupMember) {
        return el;
      }

      const mOldX = el.x;
      const mOldY = el.y;
      const mOldRot = el.rotation || 0;
      let mNextX = el.x;
      let mNextY = el.y;
      let mNextW = el.width;
      let mNextH = el.height;
      let mNextRot = el.rotation || 0;

      if (isMovingOnly) {
        mNextX = Math.round(el.x + dx);
        mNextY = Math.round(el.y + dy);
      } else if (isResizing) {
        mNextW = Math.max(20, Math.round(el.width * scaleW));
        mNextH = Math.max(20, Math.round(el.height * scaleH));
        mNextX = Math.round(newX + (el.x - oldX) * scaleW);
        mNextY = Math.round(newY + (el.y - oldY) * scaleH);
      }

      if (isRotating) {
        mNextRot = Math.round((el.rotation || 0) + dRot);
      }

      elementDeltas.set(el.id, {
        dx: mNextX - mOldX,
        dy: mNextY - mOldY,
        dRot: mNextRot - mOldRot,
      });

      return {
        ...el,
        x: mNextX,
        y: mNextY,
        width: mNextW,
        height: mNextH,
        rotation: mNextRot,
      };
    });

    // Recompute the bounding box of the group container element so it stays in sync
    const updatedMembers = nextElements.filter(
      (e) => e.parentGroupId === groupId && e.type !== 'group'
    );
    if (updatedMembers.length > 0) {
      const minX = Math.min(...updatedMembers.map((e) => e.x));
      const minY = Math.min(...updatedMembers.map((e) => e.y));
      const maxX = Math.max(...updatedMembers.map((e) => e.x + e.width));
      const maxY = Math.max(...updatedMembers.map((e) => e.y + e.height));
      nextElements = nextElements.map((el) => {
        if (el.id === groupId && el.type === 'group') {
          return {
            ...el,
            x: minX,
            y: minY,
            width: Math.max(20, maxX - minX),
            height: Math.max(20, maxY - minY),
            rotation: isRotating ? Math.round((el.rotation || 0) + dRot) : el.rotation,
          };
        }
        return el;
      });
    }
  }

  // Shift individual elements' own animation track keyframes by their spatial delta
  // so slide-in / move / rotate animations stay anchored to each element's new actual position
  // without affecting any other element in the group.
  if (elementDeltas.size === 0 || animationTracks.length === 0) {
    return { elements: nextElements, animationTracks };
  }

  const nextTracks = animationTracks.map((track) => {
    const delta = elementDeltas.get(track.elementId);
    if (!delta) return track;

    if (track.property === 'x' && delta.dx !== 0) {
      return {
        ...track,
        keyframes: track.keyframes.map((kf) =>
          typeof kf.value === 'number'
            ? { ...kf, value: Math.round(kf.value + delta.dx) }
            : kf
        ),
      };
    }
    if (track.property === 'y' && delta.dy !== 0) {
      return {
        ...track,
        keyframes: track.keyframes.map((kf) =>
          typeof kf.value === 'number'
            ? { ...kf, value: Math.round(kf.value + delta.dy) }
            : kf
        ),
      };
    }
    if (track.property === 'rotation' && delta.dRot !== 0) {
      return {
        ...track,
        keyframes: track.keyframes.map((kf) =>
          typeof kf.value === 'number'
            ? { ...kf, value: Math.round(kf.value + delta.dRot) }
            : kf
        ),
      };
    }
    return track;
  });

  return { elements: nextElements, animationTracks: nextTracks };
}

export interface SnapGuide {
  orientation: 'vertical' | 'horizontal';
  position: number;
  label?: string;
}

export function computeSnappedPosition(
  movingEl: { id: string; x: number; y: number; width: number; height: number },
  otherElements: SceneElement[],
  options: {
    snapToGrid: boolean;
    gridSizePx: number;
    snapToElements: boolean;
    canvasWidth: number;
    canvasHeight: number;
    thresholdPx?: number;
  }
): { x: number; y: number; guides: SnapGuide[] } {
  const threshold = options.thresholdPx ?? 8;
  let nextX = movingEl.x;
  let nextY = movingEl.y;
  const guides: SnapGuide[] = [];

  if (options.snapToElements) {
    const vTargets: number[] = [0, options.canvasWidth / 2, options.canvasWidth];
    const hTargets: number[] = [0, options.canvasHeight / 2, options.canvasHeight];

    for (const other of otherElements) {
      if (other.id === movingEl.id || !other.visible) continue;
      vTargets.push(other.x, other.x + other.width / 2, other.x + other.width);
      hTargets.push(other.y, other.y + other.height / 2, other.y + other.height);
    }

    const xCandidates = [
      { edge: movingEl.x, offset: 0 },
      { edge: movingEl.x + movingEl.width / 2, offset: -movingEl.width / 2 },
      { edge: movingEl.x + movingEl.width, offset: -movingEl.width },
    ];
    for (const cand of xCandidates) {
      for (const target of vTargets) {
        if (Math.abs(cand.edge - target) <= threshold) {
          nextX = Math.round(target + cand.offset);
          guides.push({ orientation: 'vertical', position: target });
          break;
        }
      }
      if (guides.some((g) => g.orientation === 'vertical')) break;
    }

    const yCandidates = [
      { edge: movingEl.y, offset: 0 },
      { edge: movingEl.y + movingEl.height / 2, offset: -movingEl.height / 2 },
      { edge: movingEl.y + movingEl.height, offset: -movingEl.height },
    ];
    for (const cand of yCandidates) {
      for (const target of hTargets) {
        if (Math.abs(cand.edge - target) <= threshold) {
          nextY = Math.round(target + cand.offset);
          guides.push({ orientation: 'horizontal', position: target });
          break;
        }
      }
      if (guides.some((g) => g.orientation === 'horizontal')) break;
    }
  }

  if (options.snapToGrid && options.gridSizePx > 1) {
    if (!guides.some((g) => g.orientation === 'vertical')) {
      nextX = Math.round(nextX / options.gridSizePx) * options.gridSizePx;
    }
    if (!guides.some((g) => g.orientation === 'horizontal')) {
      nextY = Math.round(nextY / options.gridSizePx) * options.gridSizePx;
    }
  }

  return { x: nextX, y: nextY, guides };
}

// ============================================================================
// IndexedDB + LocalStorage Persistence & Crash Recovery (Spec Section 6.2)
// ============================================================================

const IDB_NAME = 'DigitalSignageStudioDB';
const IDB_STORE = 'projects';
const FALLBACK_STORAGE_KEY = 'dss:active-project-v1';
const SNAPSHOT_STORAGE_KEY = 'dss:recovery-snapshot-v1';

export async function saveProjectPersistence(project: SignageProject): Promise<void> {
  const clone = deepClone(project);
  clone.updatedAt = new Date().toISOString();

  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(FALLBACK_STORAGE_KEY, JSON.stringify(clone));
      localStorage.setItem(
        SNAPSHOT_STORAGE_KEY,
        JSON.stringify({ savedAt: clone.updatedAt, project: clone })
      );
    }
  } catch {
    // Ignore quota errors in localStorage fallback
  }

  if (typeof indexedDB === 'undefined') return;

  await new Promise<void>((resolve) => {
    try {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).put({ id: 'active', project: clone, updatedAt: clone.updatedAt });
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => {
          db.close();
          resolve();
        };
      };
      req.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function loadProjectPersistence(): Promise<SignageProject | null> {
  if (typeof indexedDB !== 'undefined') {
    const fromIdb = await new Promise<SignageProject | null>((resolve) => {
      try {
        const req = indexedDB.open(IDB_NAME, 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(IDB_STORE)) {
            db.createObjectStore(IDB_STORE, { keyPath: 'id' });
          }
        };
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction(IDB_STORE, 'readonly');
          const getReq = tx.objectStore(IDB_STORE).get('active');
          getReq.onsuccess = () => {
            db.close();
            resolve(getReq.result?.project ?? null);
          };
          getReq.onerror = () => {
            db.close();
            resolve(null);
          };
        };
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
    if (fromIdb) return fromIdb;
  }

  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(FALLBACK_STORAGE_KEY);
      if (raw) return JSON.parse(raw) as SignageProject;
    }
  } catch {
    // Ignore parse error
  }
  return null;
}
