// ============================================================================
// src/components/studio/StudioLeftSidebar.tsx — Asset Library, Element Palette,
// Scene/Playlist Manager & Layer Hierarchy Tree
// ============================================================================

import React, { useEffect, useMemo, useState } from 'react';
import {
  Type,
  Image as ImageIcon,
  Film,
  Music,
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
  ChevronLeft,
  ChevronRight,
  GripVertical,
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
  const [resizingDrag, setResizingDrag] = useState<{
    startX: number;
    startWidth: number;
  } | null>(null);

  const {
    project,
    activeSceneId,
    setActiveSceneId,
    selectedElementIds,
    setSelectedElementIds,
    addElement,
    updateElement,
    reorderLayer,
    groupSelected,
    ungroupSelected,
    addScene,
    duplicateScene,
    deleteScene,
    importAssetItem,
    deleteAssetItem,
    commitProjectChange,
    leftSidebarCollapsed,
    setLeftSidebarCollapsed,
    toggleLeftSidebar,
    leftSidebarWidth,
    setLeftSidebarWidth,
    setShowAudioEditorModal,
  } = useStudioStore();

  useEffect(() => {
    if (!resizingDrag) return;
    const onMove = (e: PointerEvent | MouseEvent) => {
      e.preventDefault();
      const clientX = typeof e.clientX === 'number' ? e.clientX : resizingDrag.startX;
      const delta = clientX - resizingDrag.startX;
      setLeftSidebarWidth(resizingDrag.startWidth + delta);
    };
    const onUp = () => setResizingDrag(null);
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('mousemove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [resizingDrag, setLeftSidebarWidth]);

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
    const isWide = widgetKind === 'ticker' || widgetKind === 'wayfinding' || widgetKind === 'alert';
    const isSquare = widgetKind === 'qrcode';
    addElement('widget', {
      name: label,
      width: isWide ? (widgetKind === 'ticker' ? 1200 : 620) : isSquare ? 220 : 440,
      height: widgetKind === 'ticker' ? 76 : isSquare ? 220 : 230,
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
          { label: '08:00 • Main Stage', value: '45', status: 'highlight' },
          { label: '10:00 • Workshop B', value: '78', status: 'normal' },
          { label: '12:00 • Networking', value: '94', status: 'normal' },
          { label: '14:00 • Expo Hall', value: '66', status: 'normal' },
        ],
        kpiTitle: 'LIVE CAMPUS VISITORS',
        kpiValue: '14,820',
        kpiUnit: 'active guests',
        kpiDelta: '+18.4%',
        kpiTrend: 'up',
        kpiSparklinePoints: [28, 42, 36, 58, 52, 76, 94],
        chartType: 'bar',
        chartTitle: 'HOURLY CAMPUS ENERGY LOAD (MW)',
        chartShowValues: true,
        wayfindingDirection: 'up-right',
        wayfindingDestination: 'GRAND KEYNOTE AUDITORIUM',
        wayfindingSubtext: 'Level 3 • East Concourse',
        wayfindingDistance: '120m (2 min)',
        wayfindingStatus: 'DOORS OPEN',
        queueTitle: 'NOW SERVING',
        queueCurrentTicket: 'A-204',
        queueCounterLabel: 'DESK 03',
        queueWaitingTickets: ['A-205', 'A-206', 'B-104', 'C-019'],
        progressStyle: 'radial',
        progressTitle: 'PARKING GARAGE CAPACITY',
        progressValue: 76,
        progressMax: 100,
        progressUnit: '%',
        progressSubtitle: '240 EV & standard spaces available on Level P2',
        socialAuthor: 'Apex Innovation Summit',
        socialHandle: '@ApexGlobalHQ',
        socialPostText:
          'Welcome to the 2026 Digital Signage & Spatial Display Keynote! Tag #Apex2026 to appear on the atrium wall.',
        socialPlatform: 'announcement',
        socialTimestamp: 'Just now',
        socialLikes: '1.4K',
        calendarRoomName: 'BOARDROOM 4B — SKYLINE SUITE',
        calendarRoomStatus: 'available',
        calendarCurrentEvent: 'Q4 Product Architecture Review',
        calendarOrganizer: '10:00 AM – 11:30 AM • Hosted by Executive Engineering',
        alertSeverity: 'warning',
        alertTitle: 'FACILITY & TRANSIT NOTICE',
        alertMessage: 'North Shuttle Boarding moved to Covered Concourse B due to high winds.',
        alertZone: 'ALL CAMPUS ZONES',
        accentColor: '#38bdf8',
      },
    });
  };

  if (leftSidebarCollapsed) {
    return (
      <aside className="studio-left-sidebar collapsed" aria-label="Collapsed Left Sidebar">
        <div
          className="panel-inside-edge-bar left-panel-edge collapsed-edge"
          title="Click chevron to expand Left Sidebar"
        >
          <button
            className="inside-edge-chevron-btn"
            onClick={() => setLeftSidebarCollapsed(false)}
            title="Expand Left Sidebar"
            aria-label="Expand Left Sidebar"
          >
            <ChevronRight size={15} />
          </button>
          <span
            className="inside-edge-vertical-title"
            onClick={() => setLeftSidebarCollapsed(false)}
          >
            PALETTE &amp; ASSETS
          </span>
          <button
            className={`collapsed-rail-btn ${activeTab === 'elements' ? 'active' : ''}`}
            onClick={() => {
              setActiveTab('elements');
              setLeftSidebarCollapsed(false);
            }}
            title="Elements & Widgets Palette"
          >
            <Sparkles size={14} />
          </button>
          <button
            className={`collapsed-rail-btn ${activeTab === 'media' ? 'active' : ''}`}
            onClick={() => {
              setActiveTab('media');
              setLeftSidebarCollapsed(false);
            }}
            title={`Media Library (${project.assets.length})`}
          >
            <FolderOpen size={14} />
          </button>
          <button
            className={`collapsed-rail-btn ${activeTab === 'scenes' ? 'active' : ''}`}
            onClick={() => {
              setActiveTab('scenes');
              setLeftSidebarCollapsed(false);
            }}
            title={`Scenes & Playlists (${project.scenes.length})`}
          >
            <CalendarClock size={14} />
          </button>
          <button
            className={`collapsed-rail-btn ${activeTab === 'layers' ? 'active' : ''}`}
            onClick={() => {
              setActiveTab('layers');
              setLeftSidebarCollapsed(false);
            }}
            title={`Scene Layers (${activeScene?.elements.length ?? 0})`}
          >
            <Layers size={14} />
          </button>
        </div>
      </aside>
    );
  }

  return (
    <aside
      className="studio-left-sidebar has-inside-edge-bar"
      style={{ width: `${leftSidebarWidth}px` }}
    >
      <div className="sidebar-main-column">
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
                <div className="palette-title">Background Music &amp; Scene Audio</div>
                <button
                  className="btn-primary full-width"
                  onClick={() => setShowAudioEditorModal(true)}
                >
                  <Music size={14} /> Open Audio Editor &amp; Music Mixer (
                  {project.audioTracks?.length ?? 0})
                </button>
              </div>
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
                <button
                  className="palette-btn"
                  onClick={() => addWidgetPreset('kpi', 'KPI Metric & Sparkline')}
                >
                  <Sparkles size={16} /> KPI Metric
                </button>
                <button
                  className="palette-btn"
                  onClick={() => addWidgetPreset('chart', 'Telemetry Bar Chart')}
                >
                  <Layers size={16} /> Bar / H-Chart
                </button>
                <button
                  className="palette-btn"
                  onClick={() => addWidgetPreset('wayfinding', 'Directional Wayfinding')}
                >
                  <ArrowUp size={16} /> Wayfinding
                </button>
                <button
                  className="palette-btn"
                  onClick={() => addWidgetPreset('queue', 'Now Serving Queue')}
                >
                  <ListFilter size={16} /> Queue Ticket
                </button>
                <button
                  className="palette-btn"
                  onClick={() => addWidgetPreset('progress', 'Capacity Gauge Meter')}
                >
                  <Clock size={16} /> Gauge Meter
                </button>
                <button
                  className="palette-btn"
                  onClick={() => addWidgetPreset('social', 'Social Wall Post')}
                >
                  <Type size={16} /> Social Card
                </button>
                <button
                  className="palette-btn"
                  onClick={() => addWidgetPreset('calendar', 'Room Booking Schedule')}
                >
                  <CalendarClock size={16} /> Room Schedule
                </button>
                <button
                  className="palette-btn"
                  onClick={() => addWidgetPreset('alert', 'Emergency Advisory Alert')}
                >
                  <Lock size={16} /> Safety Alert
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
            <div className="section-header-row" style={{ flexWrap: 'wrap', gap: '6px' }}>
              <span>Scene Layers (Top → Bottom)</span>
              <div style={{ display: 'flex', gap: '4px' }}>
                <button
                  className="btn-xs"
                  disabled={selectedElementIds.length < 2}
                  onClick={() => groupSelected()}
                  title="Group selected layers so they move, resize, and rotate together"
                >
                  Group ({selectedElementIds.length})
                </button>
                <button
                  className="btn-xs"
                  disabled={
                    !selectedElementIds.some((id) => {
                      const found = activeScene.elements.find((e) => e.id === id);
                      return Boolean(found && (found.parentGroupId || found.type === 'group'));
                    })
                  }
                  onClick={() => ungroupSelected()}
                  title="Ungroup selected layers"
                >
                  Ungroup
                </button>
              </div>
            </div>
            <div className="layer-list">
              {[...activeScene.elements]
                .filter((el) => el.type !== 'group')
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
                      <input
                        type="checkbox"
                        checked={isSelected}
                        title="Toggle multi-select for grouping"
                        onClick={(e) => e.stopPropagation()}
                        onChange={() => {
                          setSelectedElementIds(
                            isSelected
                              ? selectedElementIds.filter((id) => id !== el.id)
                              : [...selectedElementIds, el.id]
                          );
                        }}
                      />
                      <span className="layer-type-badge">{el.type.slice(0, 3).toUpperCase()}</span>
                      <span className="layer-name">
                        {el.parentGroupId ? `🔗 ${el.name}` : el.name}
                      </span>
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
      </div>

      {/* Inside-Edge Vertical Title Bar & Drag-to-Resize Handle (Right Edge of Left Sidebar) */}
      <div
        className="panel-inside-edge-bar left-panel-edge"
        title="Drag horizontally to resize Left Panel, or click chevron to collapse"
        aria-label="Resize Left Sidebar"
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest('button')) return;
          e.preventDefault();
          e.stopPropagation();
          setResizingDrag({
            startX: typeof e.clientX === 'number' ? e.clientX : leftSidebarWidth,
            startWidth: leftSidebarWidth,
          });
        }}
        onMouseDown={(e) => {
          if ((e.target as HTMLElement).closest('button')) return;
          e.preventDefault();
          e.stopPropagation();
          setResizingDrag({
            startX: typeof e.clientX === 'number' ? e.clientX : leftSidebarWidth,
            startWidth: leftSidebarWidth,
          });
        }}
      >
        <button
          className="inside-edge-chevron-btn"
          onClick={toggleLeftSidebar}
          title="Collapse Left Sidebar"
          aria-label="Collapse Left Sidebar"
        >
          <ChevronLeft size={14} />
        </button>
        <span className="inside-edge-vertical-title">
          PALETTE &amp; ASSETS — {activeTab.toUpperCase()}
        </span>
        <GripVertical size={13} className="inside-edge-grip-icon" />
      </div>
    </aside>
  );
};
