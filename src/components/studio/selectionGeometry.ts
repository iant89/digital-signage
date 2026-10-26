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
