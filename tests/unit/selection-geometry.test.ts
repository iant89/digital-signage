import { describe, it, expect } from 'vitest';
import { getSelectionBounds, resizeFromSelectionBounds, getOrientedSelectionBounds, resizeOrientedElement } from '../../src/components/studio/selectionGeometry';

describe('upright selection envelope', () => {
  it('pads an oriented rectangle and resizes in its rotated axes', () => {
    const original = { x: 100, y: 100, width: 200, height: 100, rotation: 90 };
    expect(getOrientedSelectionBounds(original)).toEqual({ x: 96, y: 96, width: 208, height: 108 });
    const resized = resizeOrientedElement(original, 0, 50, 'e', false);
    expect(resized.width).toBeCloseTo(250);
    expect(resized.height).toBeCloseTo(100);
    expect(resized.x + resized.width / 2).toBeCloseTo(200);
    expect(resized.y + resized.height / 2).toBeCloseTo(175);
  });
  it('encloses all four transformed corners at arbitrary angles and scales', () => {
    for (const rotation of [0, 30, 45, 90, 135, 180, 225, 270, 315, -25, 359]) {
      const rect = { x: 100, y: 70, width: 240, height: 80, rotation, scaleX: -1.3, scaleY: .8 };
      const b = getSelectionBounds(rect), r = rotation * Math.PI / 180;
      const corners = [-1, 1].flatMap(x => [-1, 1].map(y => {
        const dx = x * rect.width * rect.scaleX / 2, dy = y * rect.height * rect.scaleY / 2;
        return { x: rect.x + rect.width / 2 + dx * Math.cos(r) - dy * Math.sin(r),
          y: rect.y + rect.height / 2 + dx * Math.sin(r) + dy * Math.cos(r) };
      }));
      expect(b.x).toBeCloseTo(Math.min(...corners.map(p => p.x)));
      expect(b.y).toBeCloseTo(Math.min(...corners.map(p => p.y)));
      expect(b.x + b.width).toBeCloseTo(Math.max(...corners.map(p => p.x)));
      expect(b.y + b.height).toBeCloseTo(Math.max(...corners.map(p => p.y)));
    }
  });
  it('maps a 90 degree screen-right resize onto local height and anchors the left envelope', () => {
    const rect = { x: 100, y: 100, width: 200, height: 100, rotation: 90 };
    const b = getSelectionBounds(rect);
    const resized = resizeFromSelectionBounds(rect, { ...b, width: b.width + 50 }, 'e', false);
    expect(resized.width).toBeCloseTo(200);
    expect(resized.height).toBeCloseTo(150);
    const after = getSelectionBounds({ ...rect, ...resized });
    expect(after.x).toBeCloseTo(b.x);
    expect(after.width).toBeCloseTo(b.width + 50);
  });
  it('is stable at diagonal rotations and anchors opposite edges for each corner', () => {
    for (const rotation of [44.99, 45, 135, 225, 315]) {
      for (const handle of ['nw', 'ne', 'sw', 'se']) {
        const rect = { x: 50, y: 60, width: 200, height: 100, rotation };
        const before = getSelectionBounds(rect);
        const desired = { ...before, width: before.width * 1.2, height: before.height * 1.2 };
        const resized = resizeFromSelectionBounds(rect, desired, handle, false);
        expect(resized.width / resized.height).toBeCloseTo(2);
        const after = getSelectionBounds({ ...rect, ...resized });
        expect(handle.includes('w') ? after.x + after.width : after.x)
          .toBeCloseTo(handle.includes('w') ? before.x + before.width : before.x);
        expect(handle.includes('n') ? after.y + after.height : after.y)
          .toBeCloseTo(handle.includes('n') ? before.y + before.height : before.y);
      }
    }
  });
});
