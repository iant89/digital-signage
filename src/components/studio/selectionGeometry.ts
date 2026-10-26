export interface SelectionRect { x: number; y: number; width: number; height: number }
export interface SelectionTransform extends SelectionRect { rotation?: number; scaleX?: number; scaleY?: number }

/** Axis-aligned envelope of the rendered rectangle, transformed about its center. */
export function getSelectionBounds(rect: SelectionTransform): SelectionRect {
  const radians = (rect.rotation ?? 0) * Math.PI / 180;
  const c = Math.abs(Math.cos(radians)), s = Math.abs(Math.sin(radians));
  const w = rect.width * Math.abs(rect.scaleX ?? 1), h = rect.height * Math.abs(rect.scaleY ?? 1);
  const width = c * w + s * h, height = s * w + c * h;
  return { x: rect.x + rect.width / 2 - width / 2, y: rect.y + rect.height / 2 - height / 2, width, height };
}

/** Convert an upright selection-box resize back to authored dimensions/position. */
export function resizeFromSelectionBounds(original: SelectionTransform, desired: SelectionRect, handle: string, locked: boolean): SelectionRect {
  const before = getSelectionBounds(original);
  const r = (original.rotation ?? 0) * Math.PI / 180;
  const c = Math.abs(Math.cos(r)), s = Math.abs(Math.sin(r));
  const sx = Math.max(.000001, Math.abs(original.scaleX ?? 1)), sy = Math.max(.000001, Math.abs(original.scaleY ?? 1));
  let width: number, height: number;
  // Near 45° the envelope equations are singular: proportional resize is stable.
  if (locked || Math.abs(c * c - s * s) < .1) {
    const horizontal = handle.includes('e') || handle.includes('w');
    const vertical = handle.includes('n') || handle.includes('s');
    const rw = desired.width / Math.max(.000001, before.width), rh = desired.height / Math.max(.000001, before.height);
    const factor = Math.max(24 / original.width, 24 / original.height,
      horizontal && (!vertical || Math.abs(rw - 1) >= Math.abs(rh - 1)) ? rw : rh);
    width = original.width * factor; height = original.height * factor;
  } else {
    const determinant = c * c - s * s;
    width = Math.max(24, (c * desired.width - s * desired.height) / (sx * determinant));
    height = Math.max(24, (c * desired.height - s * desired.width) / (sy * determinant));
  }
  const actual = getSelectionBounds({ ...original, width, height });
  const centerX = handle.includes('w') ? before.x + before.width - actual.width / 2
    : handle.includes('e') ? before.x + actual.width / 2 : before.x + before.width / 2;
  const centerY = handle.includes('n') ? before.y + before.height - actual.height / 2
    : handle.includes('s') ? before.y + actual.height / 2 : before.y + before.height / 2;
  return { x: centerX - width / 2, y: centerY - height / 2, width, height };
}

/** A snug oriented outline with a small canvas-pixel gap around the rendered edges. */
export function getOrientedSelectionBounds(rect: SelectionTransform, padding = 4): SelectionRect {
  const width = rect.width * Math.abs(rect.scaleX ?? 1) + padding * 2;
  const height = rect.height * Math.abs(rect.scaleY ?? 1) + padding * 2;
  return { x: rect.x + rect.width / 2 - width / 2, y: rect.y + rect.height / 2 - height / 2, width, height };
}

/** Resize in the object's rotated axes while holding the opposite oriented edge/corner. */
export function resizeOrientedElement(original: SelectionTransform, dx: number, dy: number, handle: string, locked: boolean): SelectionRect {
  const r = (original.rotation ?? 0) * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
  const sx = Math.max(.000001, Math.abs(original.scaleX ?? 1)), sy = Math.max(.000001, Math.abs(original.scaleY ?? 1));
  const localX = (c * dx + s * dy) / sx, localY = (-s * dx + c * dy) / sy;
  const desired = { ...original };
  if (handle.includes('e')) desired.width = Math.max(24, original.width + localX);
  if (handle.includes('w')) desired.width = Math.max(24, original.width - localX);
  if (handle.includes('s')) desired.height = Math.max(24, original.height + localY);
  if (handle.includes('n')) desired.height = Math.max(24, original.height - localY);
  const local = resizeFromSelectionBounds({ ...original, rotation: 0, scaleX: 1, scaleY: 1 }, desired, handle, locked);
  const cx = (local.x + local.width / 2 - original.x - original.width / 2) * sx;
  const cy = (local.y + local.height / 2 - original.y - original.height / 2) * sy;
  return { x: original.x + original.width / 2 + c * cx - s * cy - local.width / 2,
    y: original.y + original.height / 2 + s * cx + c * cy - local.height / 2,
    width: local.width, height: local.height };
}
