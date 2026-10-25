// ============================================================================
// src/App.tsx — Digital Signage Studio Main Application Shell
// Integrates Studio Mode, Standalone Player, Package Manager, Network Console,
// and Device Administration with Keyboard Shortcuts & Theme Switching
// ============================================================================

import React, { useEffect } from 'react';
import {
  Palette,
  PlayCircle,
  Package,
  Radio,
  Shield,
  Sun,
  Moon,
  X,
} from 'lucide-react';
import { useStudioStore } from '@/store/useStudioStore';
import { StudioTopToolbar } from '@/components/studio/StudioTopToolbar';
import { StudioLeftSidebar } from '@/components/studio/StudioLeftSidebar';
import { StudioCanvasWorkspace } from '@/components/studio/StudioCanvasWorkspace';
import { StudioRightInspector } from '@/components/studio/StudioRightInspector';
import { StudioBottomTimeline } from '@/components/studio/StudioBottomTimeline';
import { StandaloneSignagePlayer } from '@/components/player/StandaloneSignagePlayer';
import { PackageManagerView } from '@/components/package-manager/PackageManagerView';
import { NetworkManagementView } from '@/components/network/NetworkManagementView';
import { DeviceAdminView } from '@/components/admin/DeviceAdminView';

export const App: React.FC = () => {
  const {
    appMode,
    setAppMode,
    themeMode,
    setThemeMode,
    hydrateFromPersistence,
    undo,
    redo,
    deleteSelectedElements,
    copySelectedElements,
    pasteElements,
    duplicateSelectedElements,
    notification,
    clearNotification,
  } = useStudioStore();

  useEffect(() => {
    void hydrateFromPersistence();
  }, [hydrateFromPersistence]);

  // Global keyboard shortcuts (Spec Section 14 & 17)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isInput =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);

      if (isInput) return;

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        copySelectedElements();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        pasteElements();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        duplicateSelectedElements();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        deleteSelectedElements();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    undo,
    redo,
    copySelectedElements,
    pasteElements,
    duplicateSelectedElements,
    deleteSelectedElements,
  ]);

  return (
    <div className={`app-root theme-${themeMode}`}>
      {/* Primary Mode Navigation Header */}
      <header className="app-global-nav">
        <div className="brand-title">
          <div className="brand-dot" />
          <strong>DIGITAL SIGNAGE STUDIO</strong>
          <span className="version-tag">v1.0 • .signage Binary Container & Sync Engine</span>
        </div>

        <nav className="mode-switcher" aria-label="Application Modes">
          <button
            className={`mode-btn ${appMode === 'studio' ? 'active' : ''}`}
            onClick={() => setAppMode('studio')}
          >
            <Palette size={15} /> Studio Designer
          </button>
          <button
            className={`mode-btn ${appMode === 'player' ? 'active' : ''}`}
            onClick={() => setAppMode('player')}
          >
            <PlayCircle size={15} /> Signage Player
          </button>
          <button
            className={`mode-btn ${appMode === 'package-manager' ? 'active' : ''}`}
            onClick={() => setAppMode('package-manager')}
          >
            <Package size={15} /> Package Manager (.signage)
          </button>
          <button
            className={`mode-btn ${appMode === 'network-console' ? 'active' : ''}`}
            onClick={() => setAppMode('network-console')}
          >
            <Radio size={15} /> Network & Sync Server
          </button>
          <button
            className={`mode-btn ${appMode === 'device-admin' ? 'active' : ''}`}
            onClick={() => setAppMode('device-admin')}
          >
            <Shield size={15} /> Device Admin & Kiosk
          </button>
        </nav>

        <div className="global-nav-right">
          <button
            className="icon-btn"
            onClick={() => setThemeMode(themeMode === 'dark' ? 'light' : 'dark')}
            title={`Switch to ${themeMode === 'dark' ? 'Light' : 'Dark'} Theme`}
          >
            {themeMode === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
          </button>
        </div>
      </header>

      {/* Non-intrusive Toast Notification */}
      {notification && (
        <div className={`toast-notification toast-${notification.type}`} role="status">
          <span>{notification.message}</span>
          <button className="icon-btn-sm" onClick={clearNotification}>
            <X size={13} />
          </button>
        </div>
      )}

      {/* Main Mode Workspace */}
      <main className="app-workspace">
        {appMode === 'studio' && (
          <div className="studio-layout">
            <StudioTopToolbar />
            <div className="studio-middle-split">
              <StudioLeftSidebar />
              <StudioCanvasWorkspace />
              <StudioRightInspector />
            </div>
            <StudioBottomTimeline />
          </div>
        )}

        {appMode === 'player' && <StandaloneSignagePlayer />}
        {appMode === 'package-manager' && <PackageManagerView />}
        {appMode === 'network-console' && <NetworkManagementView />}
        {appMode === 'device-admin' && <DeviceAdminView />}
      </main>
    </div>
  );
};
