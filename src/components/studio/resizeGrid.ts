/** Snap only the actively resized edges; keep the opposite edges anchored. */
export function snapResizeToGrid(
  rect: { x: number; y: number; width: number; height: number },
  handle: string,
  grid: number,
  aspectLocked = false
) {
  const step = Math.max(1, grid || 24);
  const round = (n: number) => Math.round(n / step) * step;
  let { x, y, width, height } = rect;
  const right = x + width;
  const bottom = y + height;
  if (handle.includes('w')) { x = Math.min(right - 24, round(x)); width = right - x; }
  if (handle.includes('e')) width = Math.max(24, round(right) - x);
  if (handle.includes('n')) { y = Math.min(bottom - 24, round(y)); height = bottom - y; }
  if (handle.includes('s')) height = Math.max(24, round(bottom) - y);
  if (aspectLocked && rect.height > 0) {
    const ratio = rect.width / rect.height;
    if (handle.includes('e') || handle.includes('w')) {
      height = width / ratio;
      if (height < 24) { height = 24; width = height * ratio; }
    } else {
      width = height * ratio;
      if (width < 24) { width = 24; height = width / ratio; }
    }
    if (handle.includes('w')) x = right - width;
    if (handle.includes('n')) y = bottom - height;
  }
  return { x, y, width, height };
}
