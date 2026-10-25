// ============================================================================
// src/components/studio/StudioTopToolbar.tsx — Top Studio Authoring Toolbar
// ============================================================================

import React from 'react';
import {
  Undo2,
  Redo2,
  Copy,
  Scissors,
  ClipboardPaste,
  CopyPlus,
  Trash2,
  AlignLeft,
  AlignCenterHorizontal,
  AlignRight,
  AlignStartVertical,
  AlignCenterVertical,
  AlignEndVertical,
  Columns,
  Grid,
  ShieldCheck,
  ZoomIn,
  ZoomOut,
  Play,
  Download,
  Layers,
  RotateCcw,
  PanelLeft,
  PanelRight,
  PanelBottom,
} from 'lucide-react';
import { useStudioStore } from '@/store/useStudioStore';
import { RESOLUTION_PRESETS } from '@packages/project-model';

export const StudioTopToolbar: React.FC = () => {
  const {
    project,
    commitProjectChange,
    undo,
    redo,
    undoStack,
    redoStack,
    saveStatus,
    lastSavedAt,
    selectedElementIds,
    copySelectedElements,
    cutSelectedElements,
    pasteElements,
    duplicateSelectedElements,
    deleteSelectedElements,
    alignSelected,
    distributeSelected,
    groupSelected,
    canvasZoom,
    setCanvasZoom,
    showGrid,
    setShowGrid,
    showSafeArea,
    setShowSafeArea,
    leftSidebarCollapsed,
    toggleLeftSidebar,
    rightInspectorCollapsed,
    toggleRightInspector,
    bottomTimelineCollapsed,
    toggleBottomTimeline,
    isMobileLayout,
    exportSignagePackage,
    setAppMode,
    resetToStarterProject,
  } = useStudioStore();

  const handleResolutionChange = (presetId: string) => {
    const preset = RESOLUTION_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    commitProjectChange(`Change Resolution to ${preset.label}`, (draft) => {
      draft.settings.width = preset.width;
      draft.settings.height = preset.height;
      for (const s of draft.scenes) {
        s.referenceWidth = preset.width;
        s.referenceHeight = preset.height;
      }
    });
  };

  const handleQuickExport = () => {
    const pkg = exportSignagePackage({ profile: 'compact', signPackage: true });
    const blob = new Blob([new Uint8Array(pkg.bytes)], {
      type: 'application/vnd.digital-signage.package',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = pkg.fileName;
    a.click();
    URL.revokeObjectURL(url);
  };

  const currentPreset =
    RESOLUTION_PRESETS.find(
      (p) => p.width === project.settings.width && p.height === project.settings.height
    )?.id ?? 'custom';

  return (
    <div className="studio-toolbar">
      {/* Collapsible Side & Bottom Panel Toggles */}
      <div className="toolbar-group">
        <button
          className={`icon-btn ${!leftSidebarCollapsed ? 'active' : ''}`}
          onClick={toggleLeftSidebar}
          title={leftSidebarCollapsed ? 'Expand Left Sidebar' : 'Collapse Left Sidebar'}
          aria-label="Toggle Left Sidebar"
        >
          <PanelLeft size={15} />
        </button>
        <button
          className={`icon-btn ${!bottomTimelineCollapsed ? 'active' : ''}`}
          onClick={toggleBottomTimeline}
          title={bottomTimelineCollapsed ? 'Expand Bottom Timeline' : 'Collapse Bottom Timeline'}
          aria-label="Toggle Bottom Timeline"
        >
          <PanelBottom size={15} />
        </button>
        <button
          className={`icon-btn ${!rightInspectorCollapsed ? 'active' : ''}`}
          onClick={toggleRightInspector}
          title={rightInspectorCollapsed ? 'Expand Right Inspector' : 'Collapse Right Inspector'}
          aria-label="Toggle Right Inspector"
        >
          <PanelRight size={15} />
        </button>
      </div>

      {/* Project Name & Save Status */}
      <div className="toolbar-group">
        <input
          type="text"
          className="project-name-input"
          value={project.settings.name}
          aria-label="Project Name"
          onChange={(e) =>
            commitProjectChange('Rename Project', (draft) => {
              draft.settings.name = e.target.value;
            })
          }
        />
        <span className={`save-badge save-${saveStatus}`} title={`Last saved at ${lastSavedAt}`}>
          <ShieldCheck size={13} />
          {saveStatus === 'saved'
            ? 'Saved'
            : saveStatus === 'recovered'
              ? 'Recovered'
              : 'Saving...'}
        </span>
      </div>

      {/* Resolution Selector */}
      <div className="toolbar-group">
        <select
          className="toolbar-select"
          value={currentPreset}
          aria-label="Canvas Resolution Preset"
          onChange={(e) => handleResolutionChange(e.target.value)}
        >
          {RESOLUTION_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
          {currentPreset === 'custom' && (
            <option value="custom">
              Custom ({project.settings.width} × {project.settings.height})
            </option>
          )}
        </select>
      </div>

      {/* Undo / Redo / Clipboard */}
      <div className="toolbar-group">
        <button
          className="icon-btn"
          onClick={undo}
          disabled={undoStack.length === 0}
          title={`Undo (${undoStack.length})`}
        >
          <Undo2 size={15} />
        </button>
        <button
          className="icon-btn"
          onClick={redo}
          disabled={redoStack.length === 0}
          title={`Redo (${redoStack.length})`}
        >
          <Redo2 size={15} />
        </button>
        <div className="toolbar-divider" />
        <button
          className="icon-btn"
          onClick={cutSelectedElements}
          disabled={selectedElementIds.length === 0}
          title="Cut"
        >
          <Scissors size={15} />
        </button>
        <button
          className="icon-btn"
          onClick={copySelectedElements}
          disabled={selectedElementIds.length === 0}
          title="Copy"
        >
          <Copy size={15} />
        </button>
        <button className="icon-btn" onClick={pasteElements} title="Paste">
          <ClipboardPaste size={15} />
        </button>
        <button
          className="icon-btn"
          onClick={duplicateSelectedElements}
          disabled={selectedElementIds.length === 0}
          title="Duplicate Selected"
        >
          <CopyPlus size={15} />
        </button>
        <button
          className="icon-btn danger-hover"
          onClick={deleteSelectedElements}
          disabled={selectedElementIds.length === 0}
          title="Delete Selected"
        >
          <Trash2 size={15} />
        </button>
      </div>

      {/* Alignment, Distribution & Grouping */}
      <div className="toolbar-group">
        <button
          className="icon-btn"
          onClick={() => alignSelected('left')}
          disabled={selectedElementIds.length === 0}
          title="Align Left"
        >
          <AlignLeft size={15} />
        </button>
        <button
          className="icon-btn"
          onClick={() => alignSelected('center')}
          disabled={selectedElementIds.length === 0}
          title="Align Horizontal Center"
        >
          <AlignCenterHorizontal size={15} />
        </button>
        <button
          className="icon-btn"
          onClick={() => alignSelected('right')}
          disabled={selectedElementIds.length === 0}
          title="Align Right"
        >
          <AlignRight size={15} />
        </button>
        <button
          className="icon-btn"
          onClick={() => alignSelected('top')}
          disabled={selectedElementIds.length === 0}
          title="Align Top"
        >
          <AlignStartVertical size={15} />
        </button>
        <button
          className="icon-btn"
          onClick={() => alignSelected('middle')}
          disabled={selectedElementIds.length === 0}
          title="Align Vertical Middle"
        >
          <AlignCenterVertical size={15} />
        </button>
        <button
          className="icon-btn"
          onClick={() => alignSelected('bottom')}
          disabled={selectedElementIds.length === 0}
          title="Align Bottom"
        >
          <AlignEndVertical size={15} />
        </button>
        <button
          className="icon-btn"
          onClick={() => distributeSelected('horizontal')}
          disabled={selectedElementIds.length < 3}
          title="Distribute Horizontally (3+ elements)"
        >
          <Columns size={15} />
        </button>
        <button
          className="icon-btn"
          onClick={groupSelected}
          disabled={selectedElementIds.length < 2}
          title="Group Selected Elements"
        >
          <Layers size={15} />
        </button>
      </div>

      {/* Zoom & Guides */}
      <div className="toolbar-group">
        <button
          className="icon-btn"
          onClick={() => setCanvasZoom(canvasZoom - 0.08)}
          title="Zoom Out"
        >
          <ZoomOut size={15} />
        </button>
        <span className="zoom-readout">{Math.round(canvasZoom * 100)}%</span>
        <button
          className="icon-btn"
          onClick={() => setCanvasZoom(canvasZoom + 0.08)}
          title="Zoom In"
        >
          <ZoomIn size={15} />
        </button>
        <button
          className="btn-xs"
          onClick={() => setCanvasZoom(isMobileLayout ? 0.22 : 0.46)}
          title="Fit Canvas to Viewport"
        >
          Fit
        </button>
        <button
          className={`icon-btn ${showGrid ? 'active' : ''}`}
          onClick={() => setShowGrid(!showGrid)}
          title="Toggle Snap Grid"
        >
          <Grid size={15} />
        </button>
        <button
          className={`btn-xs ${showSafeArea ? 'active' : ''}`}
          onClick={() => setShowSafeArea(!showSafeArea)}
          title="Toggle Broadcast Safe Area Overlay"
        >
          Safe Area
        </button>
      </div>

      {/* Playback & Export Actions */}
      <div className="toolbar-group toolbar-actions-right">
        <button
          className="btn-xs"
          onClick={resetToStarterProject}
          title="Reset to Default Project"
        >
          <RotateCcw size={13} /> Reset
        </button>
        <button
          className="btn-secondary"
          onClick={() => {
            exportSignagePackage({ profile: 'compact', signPackage: true });
            setAppMode('player');
          }}
        >
          <Play size={14} /> Launch Player
        </button>
        <button className="btn-primary" onClick={handleQuickExport}>
          <Download size={14} /> Export .signage
        </button>
      </div>
    </div>
  );
};
