import React from 'react';

/** Normalize clockwise degrees and magnetize inclusive ±5° bands around each 45°. */
export function snapRotation(degrees: number): number {
  const angle = ((degrees % 360) + 360) % 360;
  const nearest = Math.round(angle / 45) * 45;
  return Math.abs(angle - nearest) <= 5 + 1e-8 ? nearest % 360 : Math.round(angle) % 360;
}

export const RotationGuide: React.FC<{ x: number; y: number; angle: number; zoom: number }> = ({ x, y, angle, zoom }) => {
  const point = (degrees: number, radius: number) => {
    const radians = (degrees - 90) * Math.PI / 180;
    return { x: 150 + Math.cos(radians) * radius, y: 150 + Math.sin(radians) * radius };
  };
  const end = point(angle, 113);
  return <div className="rotation-angle-guide" role="img" aria-label={`Rotation guide: ${angle} degrees`}
    style={{ left: x, top: y, width: 300 / zoom, height: 300 / zoom }}>
    <svg viewBox="0 0 300 300" aria-hidden="true">
      <circle className="rotation-guide-disc" cx="150" cy="150" r="146" />
      <circle cx="150" cy="150" r="113" fill="none" stroke="rgba(186,230,253,.25)" />
      {Array.from({ length: 72 }, (_, i) => {
        const degree = i * 5;
        const a = point(degree, degree % 45 === 0 ? 97 : degree % 15 === 0 ? 105 : 109);
        const b = point(degree, 115);
        return <line key={degree} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
          stroke={degree % 45 === 0 ? '#e0f2fe' : '#7a9eb4'} strokeWidth={degree % 45 === 0 ? 2 : 1} />;
      })}
      {Array.from({ length: 8 }, (_, i) => {
        const degree = i * 45, p = point(degree, 131);
        return <text key={degree} x={p.x} y={p.y} textAnchor="middle" dominantBaseline="central" className="rotation-guide-label">{degree}°</text>;
      })}
      <line x1="150" y1="150" x2="150" y2="37" stroke="#7dd3fc" strokeDasharray="3 5" opacity=".45" />
      <line x1="150" y1="150" x2={end.x} y2={end.y} stroke="#38bdf8" strokeWidth="3" />
      <circle cx={end.x} cy={end.y} r="5" fill="#7dd3fc" />
      <circle cx="150" cy="150" r="53" fill="#10243deb" stroke="#7dd3fc66" />
      <text x="150" y="150" textAnchor="middle" dominantBaseline="central" className="rotation-guide-value">{angle}°</text>
      <text x="150" y="177" textAnchor="middle" className="rotation-guide-caption">ROTATION</text>
    </svg>
  </div>;
};
