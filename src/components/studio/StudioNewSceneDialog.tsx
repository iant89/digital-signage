import { SavedSceneTemplate } from '@packages/scene-templates/export';
import { useTemplateLibrary } from '@/services/templateLibrary';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { SCENE_TEMPLATES, SceneTemplate, instantiateSceneTemplate } from '@packages/scene-templates';
import { computeSceneElementsAtTime } from '@packages/animation-engine';
import { SignageElementRenderer } from '@/components/shared/SignageElementRenderer';
import { useStudioStore } from '@/store/useStudioStore';

const TemplatePreview: React.FC<{ template: SceneTemplate | SavedSceneTemplate }> = ({ template }) => {
  const scene = useMemo(() => 'scene' in template ? template.scene : instantiateSceneTemplate(template.id), [template]);
  const elements = useMemo(() => computeSceneElementsAtTime(scene.elements, [], 0), [scene]);
  const previewRef = useRef<HTMLDivElement>(null);
  const [bounds, setBounds] = useState({ width: 260, height: 190 });
  useEffect(() => {
    const node = previewRef.current;
    if (!node) return;
    const measure = () => {
      const rect = node.getBoundingClientRect();
      if (rect.width && rect.height) setBounds({ width: rect.width, height: rect.height });
    };
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const scale = Math.min((bounds.width - 24) / template.width, (bounds.height - 24) / template.height);
  return <div ref={previewRef} className="scene-template-preview" role="img" aria-label={`${template.name} preview`}>
    <div aria-hidden="true" style={{ position: 'absolute', width: template.width, height: template.height,
      left: (bounds.width - template.width * scale) / 2, top: (bounds.height - template.height * scale) / 2,
      transform: `scale(${scale})`, transformOrigin: 'top left',
      background: scene.backgroundGradient || scene.backgroundColor, overflow: 'hidden', pointerEvents: 'none' }}>
      {elements.map(element => <SignageElementRenderer key={element.id} element={element}
        assets={'assets' in template ? template.assets : []} currentTimeMs={0} sceneName={template.name} interactive={false} />)}
    </div>
  </div>;
};

export const StudioNewSceneDialog: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [step, setStep] = useState<'choice' | 'templates'>('choice');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All');
  const panel = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose); closeRef.current = onClose;
  const savedTemplates = useTemplateLibrary(state => state.templates);
  const allTemplates = useMemo(() => [...SCENE_TEMPLATES, ...savedTemplates], [savedTemplates]);
  const { addScene, addSceneFromSavedTemplate, project } = useStudioStore();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); closeRef.current(); }
      if (e.key === 'Tab') {
        const controls = Array.from(panel.current?.querySelectorAll<HTMLElement>('button,input,select,[tabindex="0"]') ?? []);
        const first = controls[0], last = controls[controls.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    };
    window.addEventListener('keydown', key);
    return () => { window.removeEventListener('keydown', key); document.body.style.overflow = oldOverflow; previous?.focus(); };
  }, []);
  useEffect(() => { panel.current?.focus(); }, [step]);
  const templates = allTemplates.filter(t => (category === 'All' || t.category === category) &&
    `${t.name} ${t.description} ${t.category}`.toLowerCase().includes(search.toLowerCase()));
  const create = (id?: string) => {
    try {
      const saved = savedTemplates.find(t => t.id === id);
      if (saved) addSceneFromSavedTemplate(saved); else addScene(undefined, id);
      onClose();
    } catch (error) { useStudioStore.getState().notify('error', `Cannot use template: ${(error as Error).message}`); }
  };
  return createPortal(<div className="scene-dialog-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="new-scene-heading"
      onPointerDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}
      className={`scene-dialog ${step === 'templates' ? 'scene-template-browser' : ''}`}>
      <header className="scene-dialog-header">
        <div><h2 id="new-scene-heading">{step === 'choice' ? 'Create a new scene' : 'Choose a scene template'}</h2>
          <p>{step === 'choice' ? 'Start with a clean canvas or an editable, ready-made layout.' :
            `Layouts fit proportionally to your ${project.settings.width} × ${project.settings.height} px canvas. Your project resolution stays unchanged.`}</p></div>
        <button className="icon-btn" aria-label="Close new scene dialog" onClick={onClose}>✕</button>
      </header>
      {step === 'choice' ? <div className="scene-choice-grid">
        <button className="scene-choice-card" onClick={() => create()}>
          <span className="scene-choice-symbol" aria-hidden="true">＋</span><strong>Blank scene</strong>
          <span>An empty canvas at your project’s current resolution.</span>
        </button>
        <button className="scene-choice-card" onClick={() => setStep('templates')}>
          <span className="scene-choice-symbol" aria-hidden="true">▦</span><strong>Choose a template</strong>
          <span>Browse editable layouts for welcome screens, menus, events, and more.</span>
        </button>
      </div> : <>
        <div className="scene-template-filters">
          <button className="btn-secondary" onClick={() => setStep('choice')}>Back</button>
          <input aria-label="Search templates" placeholder="Search templates…" value={search} onChange={e => setSearch(e.target.value)} />
          <select aria-label="Template category" value={category} onChange={e => setCategory(e.target.value)}>
            <option>All</option>{[...new Set(allTemplates.map(t => t.category))].map(c => <option key={c}>{c}</option>)}
          </select>
        </div>
        <div className="scene-template-grid">
          {templates.map(template => <article key={template.id} className="scene-template-card" aria-label={template.name}>
            <TemplatePreview template={template} />
            <div className="scene-template-card-info"><span className="scene-template-category">{template.category}</span>
              <h3>{template.name}</h3><p>{template.description}</p>
              <span className="scene-template-size">{template.width} × {template.height} px · {template.width === template.height ? 'Square' : template.width > template.height ? 'Landscape' : 'Portrait'}</span>
            </div>
            <button className="btn-primary" aria-label={`Select ${template.name}`} onClick={() => create(template.id)}>Select</button>
          </article>)}
          {templates.length === 0 && <p role="status">No templates match your search.</p>}
        </div>
      </>}
    </div>
  </div>, document.body);
};
