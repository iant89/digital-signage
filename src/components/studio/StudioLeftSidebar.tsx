// ============================================================================
// src/components/studio/StudioLeftSidebar.tsx — Asset Library, Element Palette,
// Scene/Playlist Manager & Layer Hierarchy Tree
// ============================================================================

import React, { useMemo, useState } from 'react';
import {
  Type,
  Image as ImageIcon,
  Film,
  Square,
  Clock,
  QrCode,
  CloudSun,
  ListFilter,
  Layers,
  FolderOpen,
  Plus,
  Copy,
  Trash2,
  Eye,
  EyeOff,
  Lock,
  Unlock,
  ArrowUp,
  ArrowDown,
  AlertTriangle,
  Upload,
  Sparkles,
  CalendarClock,
} from 'lucide-react';
import { useStudioStore } from '@/store/useStudioStore';
import {
  analyzeProjectAssets,
  createSvgDataUrl,
  ShapeKind,
  WidgetKind,
} from '@packages/project-model';
import { formatBytes } from '@packages/shared';

type LeftTab = 'elements' | 'media' | 'scenes' | 'layers';

export const StudioLeftSidebar: React.FC = () => {
  const [activeTab, setActiveTab] = useState<LeftTab>('elements');
  const [mediaSearch, setMediaSearch] = useState('');

  const {
    project,
    activeSceneId,
    setActiveSceneId,
    selectedElementIds,
    setSelectedElementIds,
    addElement,
    updateElement,
    reorderLayer,
    addScene,
    duplicateScene,
    deleteScene,
    importAssetItem,
    deleteAssetItem,
    commitProjectChange,
  } = useStudioStore();

  const activeScene =
    project.scenes.find((s) => s.id === activeSceneId) ?? project.scenes[0];

  const assetReport = useMemo(() => analyzeProjectAssets(project), [project]);

  const filteredAssets = useMemo(() => {
    const q = mediaSearch.trim().toLowerCase();
    if (!q) return project.assets;
    return project.assets.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        a.folder.toLowerCase().includes(q) ||
        a.tags.some((t) => t.toLowerCase().includes(q))
    );
  }, [project.assets, mediaSearch]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    Array.from(files).forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = String(reader.result || '');
        const assetType = file.type.startsWith('video/')
          ? 'video'
          : file.type.startsWith('audio/')
            ? 'audio'
            : 'image';
        importAssetItem({
          name: file.name,
          type: assetType,
          mimeType: file.type || 'application/octet-stream',
          logicalPath: `assets/${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`,
          dataUrl,
          byteSize: file.size,
          tags: ['uploaded'],
          folder: 'Uploads',
        });
      };
      reader.readAsDataURL(file);
    });
    e.target.value = '';
  };

  const handleCreateCustomVectorAsset = () => {
    const colors = ['#0ea5e9', '#10b981', '#8b5cf6', '#f59e0b', '#ec4899'];
    const c = colors[project.assets.length % colors.length];
    const svg = createSvgDataUrl(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 360">
        <rect width="600" height="360" rx="24" fill="#0f172a"/>
        <circle cx="480" cy="90" r="140" fill="${c}" opacity="0.22"/>
        <rect x="44" y="48" width="160" height="36" rx="18" fill="${c}"/>
        <text x="124" y="72" fill="#090d16" font-family="sans-serif" font-size="15" font-weight="bold" text-anchor="middle">FEATURED</text>
        <text x="44" y="160" fill="#f8fafc" font-family="sans-serif" font-size="38" font-weight="bold">Signage Graphic #${project.assets.length + 1}</text>
        <text x="44" y="210" fill="#94a3b8" font-family="sans-serif" font-size="20">High-Contrast Vector Signage Card</text>
      </svg>
    `);
    importAssetItem({
      name: `Vector Promo Card ${project.assets.length + 1}.svg`,
      type: 'image',
      mimeType: 'image/svg+xml',
      logicalPath: `assets/vector-card-${project.assets.length + 1}.svg`,
      dataUrl: svg.dataUrl,
      byteSize: svg.byteSize,
      contentHash: svg.contentHash,
      width: 600,
      height: 360,
      tags: ['generated', 'vector'],
      folder: 'Generated',
    });
  };

  const addShapePreset = (shapeKind: ShapeKind, label: string) => {
    addElement('shape', {
      name: label,
      width: 320,
      height: shapeKind === 'line' ? 24 : 220,
      shapeProps: {
        shapeKind,
        fillColor: '#0284c7',
        strokeColor: '#38bdf8',
        strokeWidth: 2,
      },
    });
  };

  const addWidgetPreset = (widgetKind: WidgetKind, label: string) => {
    addElement('widget', {
      name: label,
      width: widgetKind === 'ticker' ? 1200 : widgetKind === 'qrcode' ? 220 : 420,
      height: widgetKind === 'ticker' ? 76 : widgetKind === 'qrcode' ? 220 : 220,
      widgetProps: {
        widgetKind,
        timezone: 'UTC',
        timeFormat: '12h',
        showSeconds: true,
        countdownLabel: 'NEXT KEYNOTE SESSION',
        countdownTargetIso: '2026-10-25T23:59:59.000Z',
        qrPayload: 'https://digital-signage.local/pass',
        qrForeground: '#0f172a',
        qrBackground: '#f8fafc',
        tickerSpeedPxPerSec: 90,
        tickerItems: [
          'BREAKING: Welcome to Digital Signage Studio',
          'ALL DISPLAYS SYNCHRONIZED VIA SERVER TIMELINE',
        ],
        weatherLocation: 'Pittsburgh, PA',
        weatherTempC: 21,
        weatherCondition: 'Sunny',
        dataFeedRows: [
          { label: 'Item 01 • Main Stage', value: '10:00 AM', status: 'highlight' },
          { label: 'Item 02 • Workshop B', value: '11:30 AM', status: 'normal' },
          { label: 'Item 03 • Networking', value: '02:00 PM', status: 'normal' },
        ],
        accentColor: '#38bdf8',
      },
    });
  };

  return (
    <aside className="studio-left-sidebar">
      <div className="sidebar-tabs">
        <button
          className={`sidebar-tab ${activeTab === 'elements' ? 'active' : ''}`}
          onClick={() => setActiveTab('elements')}
        >
          <Sparkles size={14} /> Elements
        </button>
        <button
          className={`sidebar-tab ${activeTab === 'media' ? 'active' : ''}`}
          onClick={() => setActiveTab('media')}
        >
          <FolderOpen size={14} /> Media ({project.assets.length})
        </button>
        <button
          className={`sidebar-tab ${activeTab === 'scenes' ? 'active' : ''}`}
          onClick={() => setActiveTab('scenes')}
        >
          <CalendarClock size={14} /> Scenes ({project.scenes.length})
        </button>
        <button
          className={`sidebar-tab ${activeTab === 'layers' ? 'active' : ''}`}
          onClick={() => setActiveTab('layers')}
        >
          <Layers size={14} /> Layers ({activeScene?.elements.length ?? 0})
        </button>
      </div>

      <div className="sidebar-body">
        {/* TAB 1: ELEMENTS & WIDGETS */}
        {activeTab === 'elements' && (
          <div className="palette-container">
            <div className="palette-section">
              <div className="palette-title">Typography & Text</div>
              <div className="palette-grid">
                <button
                  className="palette-btn"
                  onClick={() =>
                    addElement('text', {
                      name: 'Hero Headline',
                      width: 780,
                      height: 84,
                      textProps: {
                        text: 'HERO DISPLAY HEADLINE',
                        fontFamily: 'Inter, system-ui, sans-serif',
                        fontSize: 48,
                        fontWeight: 'bold',
                        color: '#f8fafc',
                        textAlign: 'left',
                        letterSpacing: 1.2,
                        lineHeight: 1.15,
                        wrap: true,
                        autoFit: false,
                        scrolling: false,
                        direction: 'ltr',
                      },
                    })
                  }
                >
                  <Type size={16} /> Heading Text
                </button>
                <button
                  className="palette-btn"
                  onClick={() =>
                    addElement('text', {
                      name: 'Dynamic Info Text',
                      width: 640,
                      height: 64,
                      textProps: {
                        text: 'Live Time: {{time}} • {{date}}',
                        fontFamily: 'Inter, system-ui, sans-serif',
                        fontSize: 26,
                        fontWeight: 'normal',
                        color: '#38bdf8',
                        textAlign: 'left',
                        letterSpacing: 0.4,
                        lineHeight: 1.3,
                        wrap: true,
                        autoFit: false,
                        scrolling: false,
                        direction: 'ltr',
                      },
                    })
                  }
                >
                  <Type size={16} /> Dynamic {'{{}}'} Text
                </button>
              </div>
            </div>

            <div className="palette-section">
              <div className="palette-title">Media & Vector Shapes</div>
              <div className="palette-grid">
                <button
                  className="palette-btn"
                  onClick={() =>
                    addElement('image', {
                      name: 'Featured Graphic',
                      width: 640,
                      height: 400,
                      mediaProps: {
                        assetId: project.assets[0]?.id || 'asset-hero-campus',
                        objectFit: 'cover',
                      },
                    })
                  }
                >
                  <ImageIcon size={16} /> Image Layer
                </button>
                <button
                  className="palette-btn"
                  onClick={() =>
                    addElement('video', {
                      name: 'HD Video Stream',
                      width: 640,
                      height: 360,
                    })
                  }
                >
                  <Film size={16} /> Video Stream
                </button>
                <button
                  className="palette-btn"
                  onClick={() => addShapePreset('roundedRect', 'Rounded Card')}
                >
                  <Square size={16} /> Rounded Box
                </button>
                <button
                  className="palette-btn"
                  onClick={() => addShapePreset('circle', 'Circle Badge')}
                >
                  <Square size={16} /> Circle / Ellipse
                </button>
                <button
                  className="palette-btn"
                  onClick={() => addShapePreset('diamond', 'Polygon Diamond')}
                >
                  <Square size={16} /> Polygon Shape
                </button>
                <button
                  className="palette-btn"
                  onClick={() => addShapePreset('line', 'Divider Line')}
                >
                  <Square size={16} /> Divider Line
                </button>
              </div>
            </div>

            <div className="palette-section">
              <div className="palette-title">Signage Live Widgets</div>
              <div className="palette-grid">
                <button
                  className="palette-btn"
                  onClick={() => addWidgetPreset('clock', 'Live Digital Clock')}
                >
                  <Clock size={16} /> Clock & Date
                </button>
                <button
                  className="palette-btn"
                  onClick={() => addWidgetPreset('countdown', 'Event Countdown')}
                >
                  <Clock size={16} /> Countdown
                </button>
                <button
                  className="palette-btn"
                  onClick={() => addWidgetPreset('qrcode', 'Visitor Pass QR')}
                >
                  <QrCode size={16} /> QR Code
                </button>
                <button
                  className="palette-btn"
                  onClick={() => addWidgetPreset('ticker', 'Scrolling News Ticker')}
                >
                  <ListFilter size={16} /> News Ticker
                </button>
                <button
                  className="palette-btn"
                  onClick={() => addWidgetPreset('datafeed', 'Live Data Feed Board')}
                >
                  <Layers size={16} /> Data Feed
                </button>
                <button
                  className="palette-btn"
                  onClick={() => addWidgetPreset('weather', 'Local Weather Card')}
                >
                  <CloudSun size={16} /> Weather
                </button>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: MEDIA LIBRARY */}
        {activeTab === 'media' && (
          <div className="media-library-panel">
            <div className="media-actions-row">
              <label className="btn-secondary full-width" style={{ cursor: 'pointer', justifyContent: 'center' }}>
                <Upload size={14} /> Import Media
                <input
                  type="file"
                  multiple
                  accept="image/*,video/*,audio/*"
                  style={{ display: 'none' }}
                  onChange={handleFileUpload}
                />
              </label>
              <button className="btn-xs" onClick={handleCreateCustomVectorAsset}>
                + SVG Card
              </button>
            </div>

            <input
              type="text"
              className="inspector-input"
              placeholder="Search assets by name, folder, tag..."
              value={mediaSearch}
              onChange={(e) => setMediaSearch(e.target.value)}
            />

            <div className="asset-stats-card">
              <div>
                <span>Total Assets:</span> <strong>{assetReport.totalAssets}</strong>
              </div>
              <div>
                <span>Raw Size:</span> <strong>{formatBytes(assetReport.totalByteSize)}</strong>
              </div>
              <div>
                <span>Est. .signage:</span>{' '}
                <strong style={{ color: '#38bdf8' }}>
                  {formatBytes(assetReport.estimatedCompactSize)}
                </strong>
              </div>
              {assetReport.duplicateGroups.length > 0 && (
                <div className="warning-line">
                  <AlertTriangle size={12} /> {assetReport.duplicateGroups.length} duplicate hash group(s)
                </div>
              )}
              {assetReport.unusedAssets.length > 0 && (
                <div className="muted-line">
                  {assetReport.unusedAssets.length} unused asset(s) in registry
                </div>
              )}
            </div>

            <div className="asset-list">
              {filteredAssets.map((asset) => (
                <div key={asset.id} className="asset-card">
                  <div className="asset-thumb">
                    {asset.type === 'image' && !asset.missing ? (
                      <img src={asset.dataUrl} alt={asset.name} />
                    ) : (
                      <span>{asset.type.toUpperCase()}</span>
                    )}
                  </div>
                  <div className="asset-meta">
                    <div className="asset-name">{asset.name}</div>
                    <div className="asset-sub">
                      {formatBytes(asset.byteSize)} • SHA-256: {asset.contentHash.slice(0, 8)}
                    </div>
                    <div className="asset-sub">{asset.folder}</div>
                  </div>
                  <div className="asset-card-actions">
                    <button
                      className="btn-xs"
                      title="Insert onto Canvas"
                      onClick={() =>
                        addElement('image', {
                          name: asset.name.replace(/\.[^.]+$/, ''),
                          width: asset.width ? Math.min(800, asset.width) : 500,
                          height: asset.height ? Math.min(500, asset.height) : 340,
                          mediaProps: { assetId: asset.id, objectFit: 'cover' },
                        })
                      }
                    >
                      + Add
                    </button>
                    <button
                      className="icon-btn danger-hover"
                      title="Remove Asset"
                      onClick={() => deleteAssetItem(asset.id)}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TAB 3: SCENES & PLAYLISTS */}
        {activeTab === 'scenes' && (
          <div className="scenes-panel">
            <div className="section-header-row">
              <span>Presentation Scenes</span>
              <button className="btn-xs" onClick={() => addScene()}>
                <Plus size={12} /> New Scene
              </button>
            </div>

            <div className="scene-list">
              {project.scenes.map((scene, idx) => {
                const isEntry = project.entrySceneId === scene.id;
                const isActive = scene.id === activeSceneId;
                return (
                  <div
                    key={scene.id}
                    className={`scene-card ${isActive ? 'active' : ''}`}
                    onClick={() => setActiveSceneId(scene.id)}
                  >
                    <div className="scene-card-main">
                      <div className="scene-index">#{idx + 1}</div>
                      <div>
                        <div className="scene-title">
                          {scene.name}
                          {isEntry && <span className="entry-pill">ENTRY</span>}
                        </div>
                        <div className="scene-meta">
                          {(scene.durationMs / 1000).toFixed(1)}s • {scene.elements.length} layers •{' '}
                          {scene.entryTransition.type}
                        </div>
                      </div>
                    </div>
                    <div
                      className="scene-card-actions"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        className="icon-btn"
                        title="Duplicate Scene"
                        onClick={() => duplicateScene(scene.id)}
                      >
                        <Copy size={13} />
                      </button>
                      <button
                        className="icon-btn danger-hover"
                        title="Delete Scene"
                        onClick={() => deleteScene(scene.id)}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {project.playlists[0] && (
              <div className="playlist-config-box">
                <div className="palette-title">Active Playlist Configuration</div>
                <label className="inspector-label">Playlist Name</label>
                <input
                  type="text"
                  className="inspector-input"
                  value={project.playlists[0].name}
                  onChange={(e) =>
                    commitProjectChange('Rename Playlist', (draft) => {
                      draft.playlists[0].name = e.target.value;
                    })
                  }
                />
                <div className="checkbox-row">
                  <label>
                    <input
                      type="checkbox"
                      checked={project.playlists[0].loop}
                      onChange={(e) =>
                        commitProjectChange('Toggle Playlist Loop', (draft) => {
                          draft.playlists[0].loop = e.target.checked;
                        })
                      }
                    />{' '}
                    Loop Continuously
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={project.playlists[0].shuffle}
                      onChange={(e) =>
                        commitProjectChange('Toggle Playlist Shuffle', (draft) => {
                          draft.playlists[0].shuffle = e.target.checked;
                        })
                      }
                    />{' '}
                    Shuffle
                  </label>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 4: LAYER HIERARCHY */}
        {activeTab === 'layers' && activeScene && (
          <div className="layers-panel">
            <div className="section-header-row">
              <span>Scene Layers (Top → Bottom)</span>
            </div>
            <div className="layer-list">
              {[...activeScene.elements]
                .sort((a, b) => b.zIndex - a.zIndex)
                .map((el) => {
                  const isSelected = selectedElementIds.includes(el.id);
                  return (
                    <div
                      key={el.id}
                      className={`layer-row ${isSelected ? 'selected' : ''}`}
                      onClick={(e) => {
                        if (e.shiftKey || e.metaKey || e.ctrlKey) {
                          setSelectedElementIds(
                            isSelected
                              ? selectedElementIds.filter((id) => id !== el.id)
                              : [...selectedElementIds, el.id]
                          );
                        } else {
                          setSelectedElementIds([el.id]);
                        }
                      }}
                    >
                      <span className="layer-type-badge">{el.type.slice(0, 3).toUpperCase()}</span>
                      <span className="layer-name">{el.name}</span>
                      <div
                        className="layer-controls"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          className="icon-btn-sm"
                          title="Bring Forward"
                          onClick={() => reorderLayer(el.id, 'forward')}
                        >
                          <ArrowUp size={12} />
                        </button>
                        <button
                          className="icon-btn-sm"
                          title="Send Backward"
                          onClick={() => reorderLayer(el.id, 'backward')}
                        >
                          <ArrowDown size={12} />
                        </button>
                        <button
                          className="icon-btn-sm"
                          title={el.visible ? 'Hide Layer' : 'Show Layer'}
                          onClick={() => updateElement(el.id, { visible: !el.visible })}
                        >
                          {el.visible ? <Eye size={12} /> : <EyeOff size={12} />}
                        </button>
                        <button
                          className="icon-btn-sm"
                          title={el.locked ? 'Unlock Layer' : 'Lock Layer'}
                          onClick={() => updateElement(el.id, { locked: !el.locked })}
                        >
                          {el.locked ? <Lock size={12} /> : <Unlock size={12} />}
                        </button>
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
};
