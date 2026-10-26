import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Grid } from 'lucide-react';
import { ProjectSettings } from '@packages/project-model';
import { useStudioStore } from '@/store/useStudioStore';

export const StudioGridSettings: React.FC = () => {
  const { project, showGrid, setShowGrid, commitProjectChange } = useStudioStore();
  const settings = project.settings;
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const update = (patch: Partial<ProjectSettings>) => commitProjectChange('Change grid settings', draft => {
    Object.assign(draft.settings, patch);
  });
  useEffect(() => {
    if (!position) return;
    panel.current?.focus();
    const outside = (e: PointerEvent) => {
      if (!panel.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node)) setPosition(null);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setPosition(null); button.current?.focus(); }
    };
    const close = () => setPosition(null);
    window.addEventListener('pointerdown', outside);
    window.addEventListener('keydown', escape);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('pointerdown', outside);
      window.removeEventListener('keydown', escape);
      window.removeEventListener('resize', close);
    };
  }, [position]);
  const visible = settings.gridVisible ?? showGrid;
  return <>
    <button ref={button} className={`icon-btn ${visible ? 'active' : ''}`} title="Grid settings"
      aria-label="Grid settings" aria-haspopup="dialog" aria-expanded={!!position}
      aria-controls={position ? 'studio-grid-settings' : undefined}
      onClick={() => {
        const rect = button.current!.getBoundingClientRect();
        setPosition(position ? null : {
          left: Math.max(8, Math.min(rect.left, window.innerWidth - 296)),
          top: Math.max(8, Math.min(rect.bottom + 8, window.innerHeight - 440)),
        });
      }}><Grid size={15} /></button>
    {position && createPortal(<div ref={panel} id="studio-grid-settings" role="dialog"
      aria-label="Grid settings" tabIndex={-1} className="grid-settings-dropdown" style={position}>
      <h4>Grid settings</h4>
      <label>Grid spacing (px)<input type="number" min="4" max="256" step="1"
        value={settings.gridSizePx} onChange={e => {
          const value = Number(e.target.value);
          if (Number.isFinite(value) && value >= 4 && value <= 256) update({ gridSizePx: Math.round(value) });
        }} /></label>
      <label>Grid color<input type="color" value={settings.gridColor ?? '#94a3b8'}
        onChange={e => update({ gridColor: e.target.value })} /></label>
      <label>Grid line style<select value={settings.gridLineStyle ?? 'solid'}
        onChange={e => update({ gridLineStyle: e.target.value as NonNullable<ProjectSettings['gridLineStyle']> })}>
        <option value="solid">Solid</option><option value="dashed">Dashed</option><option value="dotted">Dotted</option>
      </select></label>
      {[
        { label: 'Show grid', checked: visible, change: (value: boolean) => { setShowGrid(value); update({ gridVisible: value }); } },
        { label: 'Show grid while resizing', checked: settings.gridShowDuringResize ?? true, change: (value: boolean) => update({ gridShowDuringResize: value }) },
        { label: 'Show grid while moving', checked: settings.gridShowDuringMove ?? true, change: (value: boolean) => update({ gridShowDuringMove: value }) },
        { label: 'Snap to grid', checked: settings.snapToGrid, change: (value: boolean) => update({ snapToGrid: value }) },
        { label: 'Snap to other components', checked: settings.snapToElements, change: (value: boolean) => update({ snapToElements: value }) },
      ].map(item => <label key={item.label} className="grid-setting-checkbox"><input type="checkbox"
        checked={item.checked} onChange={e => item.change(e.target.checked)} />{item.label}</label>)}
      <p>Resize: hold steady for 1.8 seconds to snap. Moving snaps immediately. Visibility does not affect snapping.</p>
    </div>, document.body)}
  </>;
};
