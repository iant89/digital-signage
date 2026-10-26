import React, { useState } from 'react';
import { useStudioStore } from '@/store/useStudioStore';
import { ScriptModule } from '@packages/project-model';
import { createId } from '@packages/shared';
import { parseScriptModule, SCRIPT_PERMISSIONS } from '@packages/script-runtime/session';
import { RestrictedScriptRuntime, applyScriptMessagesToElements } from '@packages/script-runtime';

export const StudioScriptEditor: React.FC = () => {
  const { project, activeSceneId, commitProjectChange } = useStudioStore();
  const scene = project.scenes.find(s => s.id === activeSceneId);
  const [id, setId] = useState('');
  const [source, setSource] = useState('');
  const [status, setStatus] = useState('');
  const [event, setEvent] = useState('click');
  const [elapsed, setElapsed] = useState(5000);
  const select = (s: ScriptModule) => { setId(s.id); setSource(JSON.stringify(s, null, 2)); setStatus(''); };
  const execute = (preview: boolean) => {
    try {
      const script = parseScriptModule(source);
      if (script.id !== id) throw new Error('The script id cannot be changed.');
      if (!scene) return;
      if (!preview) {
        commitProjectChange('Save script', draft => {
          const index = draft.scripts.findIndex(s => s.id === id);
          if (index < 0) throw new Error('Script no longer exists.');
          draft.scripts[index] = script;
        });
        setStatus('Script saved.'); return;
      }
      const runtime = new RestrictedScriptRuntime(project.permissions.filter(p => scene.permissions.includes(p)), script.permissions);
      try {
        const results = [runtime.invokeHook(script, 'initialize', { elapsedMs: 0 }),
          runtime.invokeHook(script, 'onSceneEnter', { elapsedMs: 0 }),
          runtime.invokeHook(script, 'onTick', { elapsedMs: elapsed }),
          runtime.invokeHook(script, 'onEvent', { elapsedMs: elapsed, eventName: event })];
        const messages = results.flatMap(r => r.emittedMessages);
        commitProjectChange('Preview script output', draft => {
          const target = draft.scenes.find(s => s.id === scene.id)!;
          target.elements = applyScriptMessagesToElements(target.elements, messages);
        });
        setStatus(JSON.stringify({ messages, denied: results.flatMap(r => r.deniedActions), errors: results.flatMap(r => r.errors), note: 'Only element output is applied in editor preview; navigation is player-only.' }, null, 2));
      } finally { runtime.invokeHook(script, 'onSceneExit', { elapsedMs: elapsed }); runtime.invokeHook(script, 'dispose', { elapsedMs: elapsed }); }
    } catch (error) { setStatus((error as Error).message); }
  };
  if (!scene) return null;
  return <div className="inspector-section">
    <div className="palette-title">Script authoring</div>
    <p className="muted-line">Restricted JSON rules, not JavaScript. Events: click, click:element-id, or a named host event. Actions need project AND scene permissions.</p>
    <button className="btn-secondary" onClick={() => {
      const script: ScriptModule = { id: createId('script'), name: 'New script', description: 'Scene automation', enabled: true,
        permissions: ['diagnostics:log'], rules: [{ id: 'enter', hook: 'onSceneEnter', actions: [{ type: 'log', level: 'info', message: 'Scene entered' }] }] };
      commitProjectChange('Create script', draft => { draft.scripts.push(script); }); select(script);
    }}>New script</button>
    <label className="inspector-label">Edit script<select className="inspector-select" value={id} onChange={e => {
      const script = project.scripts.find(s => s.id === e.target.value); if (script) select(script);
    }}><option value="">Choose script</option>{project.scripts.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
    {project.scripts.some(s => s.id === id) && <>
      <label className="inspector-label"><input type="checkbox" checked={scene.scriptIds.includes(id)} onChange={e => {
        const enabled = e.target.checked;
        commitProjectChange('Bind script to scene', draft => {
          const s = draft.scenes.find(s => s.id === scene.id)!;
          s.scriptIds = enabled ? [...new Set([...s.scriptIds, id])] : s.scriptIds.filter(sid => sid !== id);
        });
      }} />Run in this scene</label>
      <label className="inspector-label"><input type="checkbox" checked={project.scripts.find(s => s.id === id)?.enabled ?? false}
        onChange={e => { const enabled = e.target.checked;
          commitProjectChange('Toggle script', draft => { draft.scripts.find(s => s.id === id)!.enabled = enabled; });
          try { const edited = JSON.parse(source); edited.enabled = enabled; setSource(JSON.stringify(edited, null, 2)); } catch { /* Preserve invalid draft for correction. */ }
        }} />Script enabled</label>
      <label className="inspector-label">Script JSON<textarea aria-label="Script JSON" className="inspector-textarea" rows={18} value={source} onChange={e => setSource(e.target.value)} /></label>
      <button className="btn-primary" onClick={() => execute(false)}>Validate &amp; save script</button>
      <button className="btn-secondary" onClick={() => {
        commitProjectChange('Delete script', draft => { draft.scripts = draft.scripts.filter(s => s.id !== id); draft.scenes.forEach(s => { s.scriptIds = s.scriptIds.filter(sid => sid !== id); }); });
        setId(''); setSource(''); setStatus('Script deleted.');
      }}>Delete script</button>
      <label className="inspector-label">Preview elapsed (ms)<input type="number" min="0" value={elapsed} onChange={e => setElapsed(Math.max(0, Number(e.target.value)))} /></label>
      <label className="inspector-label">Preview event<input value={event} onChange={e => setEvent(e.target.value)} /></label>
      <button className="btn-secondary" onClick={() => execute(true)}>Test selected script</button>
    </>}
    <details><summary>Project &amp; scene permissions</summary>
      {SCRIPT_PERMISSIONS.map(permission => <div key={permission}>
        <strong>{permission}</strong>
        {(['project', 'scene'] as const).map(scope => <label key={scope} style={{ display: 'inline-flex', margin: 6, gap: 4 }}>
          <input type="checkbox" aria-label={`${scope} ${permission}`} checked={(scope === 'project' ? project.permissions : scene.permissions).includes(permission)}
            onChange={e => { const checked = e.target.checked; commitProjectChange('Change script permissions', draft => {
              const target = scope === 'project' ? draft : draft.scenes.find(s => s.id === scene.id)!;
              target.permissions = checked ? [...new Set([...target.permissions, permission])] : target.permissions.filter(p => p !== permission);
            }); }} />{scope}</label>)}
      </div>)}
    </details>
    {status && <pre role="status" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 11 }}>{status}</pre>}
  </div>;
};
