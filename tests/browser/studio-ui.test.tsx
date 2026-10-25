import React from 'react';
import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { App } from '../../src/App';
import {
  buildRichQrMatrix,
  formatQrWidgetPayload,
} from '../../src/utils/qrCodeGenerator';
import {
  combineAudioTracks,
  evaluateAudioTrackAtTime,
} from '../../src/utils/audioEngine';
import { computeSceneElementsAtTime } from '../../packages/animation-engine';
import { useStudioStore } from '../../src/store/useStudioStore';

describe('Digital Signage Studio React UI Integration', () => {
  it('renders Studio Designer, switches across all 5 application modes, and builds .signage packages', () => {
    render(<App />);

    // 1. Studio Designer mode is active by default
    expect(screen.getByText(/DIGITAL SIGNAGE STUDIO/i)).toBeTruthy();
    expect(screen.getByLabelText(/Project Name/i)).toBeTruthy();

    // 2. Switch to Package Manager (.signage) mode
    fireEvent.click(screen.getByRole('button', { name: /Package Manager/i }));
    expect(screen.getByText(/Build & Export `.signage` Binary Package/i)).toBeTruthy();
    expect(screen.getByText(/64-Byte Little-Endian Binary Header Dump/i)).toBeTruthy();

    // 3. Switch to Signage Player mode
    fireEvent.click(screen.getByRole('button', { name: /Signage Player/i }));
    expect(screen.getByText(/Engage Kiosk Lockout/i)).toBeTruthy();

    // 4. Switch to Network & Sync Server mode
    fireEvent.click(screen.getByRole('button', { name: /Network & Sync Server/i }));
    expect(screen.getByText(/AUTHORITATIVE TIMELINE SESSION/i)).toBeTruthy();

    // 5. Switch to Device Admin & Kiosk mode
    fireEvent.click(screen.getByRole('button', { name: /Device Admin & Kiosk/i }));
    expect(screen.getByText(/Kiosk & Display Lockout Configuration/i)).toBeTruthy();
  });

  it('supports collapsible side/bottom panels, inside-edge resize bars, mobile layout mode, and mobile player setup QR code enrollment', () => {
    render(<App />);

    // Return to Studio mode
    fireEvent.click(screen.getByRole('button', { name: /Studio Designer/i }));

    // Verify inside-edge vertical title & resize bars exist on both panels
    const leftEdgeBar = screen.getByLabelText(/Resize Left Sidebar/i);
    const rightEdgeBar = screen.getByLabelText(/Resize Right Inspector/i);
    expect(leftEdgeBar).toBeTruthy();
    expect(rightEdgeBar).toBeTruthy();
    expect(screen.getByText(/PALETTE & ASSETS/i)).toBeTruthy();
    expect(screen.getByText(/INSPECTOR — PROPERTIES/i)).toBeTruthy();

    // Drag-resize left sidebar via inside-edge bar (starts at 295px + 60px delta = 355px)
    fireEvent.mouseDown(leftEdgeBar, { clientX: 280 });
    fireEvent.mouseMove(window, { clientX: 340 });
    fireEvent.mouseUp(window);
    expect(useStudioStore.getState().leftSidebarWidth).toBe(355);

    // 1. Collapse & expand Left Sidebar and Right Inspector via inside-edge chevron
    const collapseLeftBtn = screen.getByLabelText(/Collapse Left Sidebar/i);
    fireEvent.click(collapseLeftBtn);
    expect(screen.getByLabelText(/Collapsed Left Sidebar/i)).toBeTruthy();

    const expandLeftBtn = screen.getByLabelText(/Expand Left Sidebar/i);
    fireEvent.click(expandLeftBtn);
    expect(screen.getByText(/Typography & Text/i)).toBeTruthy();

    const collapseRightBtn = screen.getByLabelText(/Collapse Right Inspector/i);
    fireEvent.click(collapseRightBtn);
    expect(screen.getByLabelText(/Collapsed Right Inspector/i)).toBeTruthy();

    const expandRightBtn = screen.getByLabelText(/Expand Right Inspector/i);
    fireEvent.click(expandRightBtn);

    // 2. Toggle Mobile Phone Layout mode
    const mobileToggle = screen.getByLabelText(/Toggle Mobile Layout/i);
    fireEvent.click(mobileToggle);
    expect(screen.getByRole('navigation', { name: /Mobile Studio Panels/i })).toBeTruthy();
    fireEvent.click(mobileToggle); // return to desktop mode

    // 3. Open Signage Player and display the Player Setup QR Code
    fireEvent.click(screen.getByRole('button', { name: /Signage Player/i }));
    fireEvent.click(screen.getByRole('button', { name: /Setup QR Code/i }));
    expect(screen.getByText(/Player Setup & Mobile Provisioning QR Code/i)).toBeTruthy();
    expect(screen.getByLabelText(/Player Setup Enrollment QR Code/i)).toBeTruthy();

    // 4. Jump from Player Setup QR modal to Network Console and open Mobile QR Scanner
    fireEvent.click(screen.getByRole('button', { name: /Open Mobile Enrollment Scanner/i }));
    fireEvent.click(screen.getByRole('button', { name: /Devices & Enrollment/i }));
    expect(screen.getByText(/Mobile QR Code Setup Provisioning/i)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Scan Player Setup QR Code/i }));
    expect(screen.getByText(/Scan Signage Player Setup QR Code/i)).toBeTruthy();
    expect(screen.getByLabelText(/Detected Player Setup QR Target/i)).toBeTruthy();
    expect(screen.getByLabelText(/Scanned QR Payload URI/i)).toBeTruthy();
  });

  it('supports rich QR Code widget types (Wi-Fi, vCard, Email, SMS, Geo, Event), error correction levels, and center logo', () => {
    // 1. Test payload formatters across QR content types
    const wifiPayload = formatQrWidgetPayload({
      widgetKind: 'qrcode',
      qrContentType: 'wifi',
      qrWifiSsid: 'Apex-Guest-5G',
      qrWifiPassword: 'secretpassword',
      qrWifiEncryption: 'WPA',
    });
    expect(wifiPayload).toBe('WIFI:T:WPA;S:Apex-Guest-5G;P:secretpassword;H:false;;');

    const contactPayload = formatQrWidgetPayload({
      widgetKind: 'qrcode',
      qrContentType: 'contact',
      qrContactName: 'Elena Vance',
      qrContactOrg: 'Apex Digital',
      qrContactPhone: '+14125550199',
      qrContactEmail: 'elena@apex.io',
    });
    expect(contactPayload).toContain('BEGIN:VCARD');
    expect(contactPayload).toContain('FN:Elena Vance');
    expect(contactPayload).toContain('TEL;TYPE=CELL:+14125550199');

    const emailPayload = formatQrWidgetPayload({
      widgetKind: 'qrcode',
      qrContentType: 'email',
      qrEmailTo: 'concierge@apex.io',
      qrEmailSubject: 'VIP Inquiry',
    });
    expect(emailPayload).toContain('MATMSG:TO:concierge@apex.io;SUB:VIP Inquiry;');

    // 2. Test error correction matrix generation (L=21, M=25, Q=29, H=33)
    expect(buildRichQrMatrix(wifiPayload, 'L').length).toBe(21);
    expect(buildRichQrMatrix(wifiPayload, 'M').length).toBe(25);
    expect(buildRichQrMatrix(wifiPayload, 'Q').length).toBe(29);
    expect(buildRichQrMatrix(wifiPayload, 'H').length).toBe(33);

    // 3. Render Studio, select QR code widget, and configure it in Right Inspector
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /Studio Designer/i }));
    act(() => {
      useStudioStore.getState().setSelectedElementIds(['el-qr-checkin']);
    });

    const qrTypeSelect = screen.getByLabelText(/QR Code Content Type/i);
    fireEvent.change(qrTypeSelect, { target: { value: 'wifi' } });
    expect(screen.getByLabelText(/Wi-Fi SSID/i)).toBeTruthy();

    const ecSelect = screen.getByLabelText(/QR Error Correction Level/i);
    fireEvent.change(ecSelect, { target: { value: 'H' } });
    expect(
      useStudioStore
        .getState()
        .project.scenes[0].elements.find((e) => e.id === 'el-qr-checkin')?.widgetProps
        ?.qrErrorCorrection
    ).toBe('H');
  });

  it('supports Background & Scene Audio Playback, cropping, fade-in/out, deleting sections, and combining tracks in the Simple Audio Editor', () => {
    const sampleTrack = useStudioStore.getState().project.audioTracks![0];

    // 1. Evaluate audio track during fade-in, steady state, and deleted cut region
    const evalStart = evaluateAudioTrackAtTime(
      {
        ...sampleTrack,
        startAtMs: 0,
        stopAtMs: 0,
        fadeInMs: 2000,
        fadeOutMs: 2000,
        volume: 0.8,
        deletedRegions: [{ id: 'cut-1', startMs: 4000, endMs: 6000 }],
      },
      'scene-welcome',
      1000,
      10000
    );
    expect(evalStart.playing).toBe(true);
    expect(evalStart.instantGain).toBeCloseTo(0.4, 1);

    const evalDeletedCut = evaluateAudioTrackAtTime(
      {
        ...sampleTrack,
        startAtMs: 0,
        stopAtMs: 0,
        deletedRegions: [{ id: 'cut-1', startMs: 4000, endMs: 6000 }],
      },
      'scene-welcome',
      5000,
      10000
    );
    expect(evalDeletedCut.playing).toBe(false);
    expect(evalDeletedCut.inDeletedRegion).toBe(true);

    // 2. Combine two tracks into a merged master track
    const tracks = useStudioStore.getState().project.audioTracks!;
    const combined = combineAudioTracks(tracks, 'Combined Lobby Mix');
    expect(combined.name).toBe('Combined Lobby Mix');
    expect(combined.durationMs).toBeGreaterThanOrEqual(10000);

    // 3. Open the Simple Audio Editor modal from the Studio Timeline and test interactive waveform selection & preview playhead
    render(<App />);
    fireEvent.click(screen.getAllByRole('button', { name: /Audio Editor/i })[0]);
    expect(screen.getByText(/Studio Audio Editor & Background Music Mixer/i)).toBeTruthy();

    const waveformSelector = screen.getByLabelText(/Audio Waveform Selector/i);
    const wfBars = waveformSelector.querySelectorAll('.audio-wf-bar');
    expect(wfBars.length).toBe(64);

    // Double-click unselects everything
    fireEvent.doubleClick(waveformSelector);
    expect(screen.getByText(/None \(Click & drag to select\)/i)).toBeTruthy();
    expect(waveformSelector.querySelectorAll('.audio-wf-bar.in-selection').length).toBe(0);

    // Click and drag from bar #10 to bar #30 to select a section
    fireEvent.mouseDown(wfBars[10]);
    fireEvent.mouseMove(wfBars[30]);
    fireEvent.mouseUp(window);
    const bar10Ms = Number(wfBars[10].getAttribute('data-bar-time-ms'));
    const bar30Ms = Number(wfBars[30].getAttribute('data-bar-time-ms'));
    expect((screen.getByLabelText(/Selection Start \(ms\)/i) as HTMLInputElement).value).toBe(
      String(bar10Ms)
    );
    expect((screen.getByLabelText(/Selection End \(ms\)/i) as HTMLInputElement).value).toBe(
      String(bar30Ms)
    );

    // Click on the right side of the selection (bar #26) and drag to bar #44 to move the end of the selection
    fireEvent.mouseDown(wfBars[26]);
    fireEvent.mouseMove(wfBars[44]);
    fireEvent.mouseUp(window);
    const bar44Ms = Number(wfBars[44].getAttribute('data-bar-time-ms'));
    expect((screen.getByLabelText(/Selection Start \(ms\)/i) as HTMLInputElement).value).toBe(
      String(bar10Ms)
    );
    expect((screen.getByLabelText(/Selection End \(ms\)/i) as HTMLInputElement).value).toBe(
      String(bar44Ms)
    );

    // Click on the left side of the selection (bar #14) and drag to bar #4 to move the start of the selection
    fireEvent.mouseDown(wfBars[14]);
    fireEvent.mouseMove(wfBars[4]);
    fireEvent.mouseUp(window);
    const bar4Ms = Number(wfBars[4].getAttribute('data-bar-time-ms'));
    expect((screen.getByLabelText(/Selection Start \(ms\)/i) as HTMLInputElement).value).toBe(
      String(bar4Ms)
    );
    expect((screen.getByLabelText(/Selection End \(ms\)/i) as HTMLInputElement).value).toBe(
      String(bar44Ms)
    );

    // Click outside the selection (bar #58) without dragging to unselect everything
    fireEvent.mouseDown(wfBars[58]);
    fireEvent.mouseUp(window);
    expect(screen.getByText(/None \(Click & drag to select\)/i)).toBeTruthy();

    // Re-select a range and test Delete Selected Section + Combine Tracks
    fireEvent.mouseDown(wfBars[12]);
    fireEvent.mouseMove(wfBars[28]);
    fireEvent.mouseUp(window);

    // Preview the audio and verify the current position bar changes color to red (.current-playhead-bar)
    fireEvent.click(screen.getByRole('button', { name: /Play Audio Preview/i }));
    const playheadBar = waveformSelector.querySelector(
      '.audio-wf-bar.current-playhead-bar'
    ) as HTMLElement | null;
    expect(playheadBar).toBeTruthy();
    expect(playheadBar?.style.backgroundColor).toBe('rgb(239, 68, 68)');
    fireEvent.click(screen.getByRole('button', { name: /Stop Preview/i }));

    const deleteSectionBtn = screen.getByRole('button', { name: /Delete Selected Section/i });
    fireEvent.click(deleteSectionBtn);

    const combineBtn = screen.getByRole('button', { name: /Combine Tracks into Single Mix/i });
    fireEvent.click(combineBtn);
    expect(
      useStudioStore.getState().project.audioTracks!.some((t) => t.name.includes('Combined Mix'))
    ).toBe(true);
  });

  it('supports extended widget types (KPI, Chart, Wayfinding, Queue, Gauge, Social, Calendar, Alert) and multi-motion sequencing per object with rotation angle and timeline frame/time start controls', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /Studio Designer/i }));

    // 1. Add new widget types from Left Sidebar palette
    fireEvent.click(screen.getByRole('button', { name: /KPI Metric/i }));
    const kpiTitleInput = screen.getByLabelText(/KPI Metric Title/i);
    fireEvent.change(kpiTitleInput, { target: { value: 'DAILY REVENUE' } });

    fireEvent.click(screen.getByRole('button', { name: /Wayfinding/i }));
    const wayfindingDir = screen.getByLabelText(/Wayfinding Direction/i);
    fireEvent.change(wayfindingDir, { target: { value: 'elevator' } });

    const activeSceneBefore = useStudioStore.getState().project.scenes[0];
    const wayfindingEl =
      activeSceneBefore.elements[activeSceneBefore.elements.length - 1];
    expect(wayfindingEl.widgetProps?.widgetKind).toBe('wayfinding');
    expect(wayfindingEl.widgetProps?.wayfindingDirection).toBe('elevator');

    // 2. Switch Right Inspector to Motion tab and add MULTIPLE motions to the same object
    fireEvent.click(screen.getByRole('button', { name: /^Motion/i }));

    // Clear any existing motions on this element first
    act(() => {
      useStudioStore.getState().clearElementTracks(wayfindingEl.id);
    });

    // Motion #1: Spin Clockwise starting at 0ms (Frame 0), duration 1000ms, rotation angle 90°
    fireEvent.change(screen.getByLabelText(/New Motion Start Time \(ms\)/i), {
      target: { value: '0' },
    });
    fireEvent.change(screen.getByLabelText(/New Motion Duration \(ms\)/i), {
      target: { value: '1000' },
    });
    fireEvent.change(screen.getByLabelText(/New Motion Rotation Angle/i), {
      target: { value: '90' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Spin Clockwise/i }));

    // Motion #2 on the SAME object: Spin Clockwise starting at Frame 60 (2000ms @ 30 FPS), rotation angle 180°
    fireEvent.change(screen.getByLabelText(/New Motion Start Frame/i), {
      target: { value: '60' },
    });
    fireEvent.change(screen.getByLabelText(/New Motion Rotation Angle/i), {
      target: { value: '180' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Spin Clockwise/i }));

    // Verify both tracks exist on the same object with their respective start times
    let sceneNow = useStudioStore.getState().project.scenes[0];
    let elTracks = sceneNow.animationTracks.filter((t) => t.elementId === wayfindingEl.id);
    expect(elTracks.length).toBe(2);
    expect(elTracks[0].delayMs).toBe(0);
    expect(elTracks[0].rotationAngleDeg).toBe(90);
    expect(elTracks[1].delayMs).toBe(2000);
    expect(elTracks[1].rotationAngleDeg).toBe(180);

    // Modify Track #2's rotation angle to 270° and Start Frame to 45 (1500ms) in the Track Inspector
    const track2AngleInput = screen.getByLabelText(/Track 2 Rotation Angle/i);
    fireEvent.change(track2AngleInput, { target: { value: '270' } });

    const track2StartFrameInput = screen.getByLabelText(/Track 2 Start Frame/i);
    fireEvent.change(track2StartFrameInput, { target: { value: '45' } });

    sceneNow = useStudioStore.getState().project.scenes[0];
    elTracks = sceneNow.animationTracks.filter((t) => t.elementId === wayfindingEl.id);
    expect(elTracks[1].delayMs).toBe(1500);
    expect(elTracks[1].rotationAngleDeg).toBe(270);
    expect(elTracks[1].keyframes[1].value).toBe(270);

    // Evaluate timeline at t=1000ms (end of Motion #1 -> 90°) and t=2500ms (end of Motion #2 -> 270°)
    const computedAt1000 = computeSceneElementsAtTime(
      sceneNow.elements,
      sceneNow.animationTracks,
      1000
    ).find((e) => e.id === wayfindingEl.id);
    expect(computedAt1000?.rotation).toBeCloseTo(90, 1);

    const computedAt2500 = computeSceneElementsAtTime(
      sceneNow.elements,
      sceneNow.animationTracks,
      2500
    ).find((e) => e.id === wayfindingEl.id);
    expect(computedAt2500?.rotation).toBeCloseTo(270, 1);
  });

  it('keeps slide-in animated objects in their actual position in the Scene Designer and synchronizes grouped components on move/resize/rotate', () => {
    act(() => {
      useStudioStore.getState().resetToStarterProject();
      useStudioStore.getState().setAppMode('studio');
    });
    render(<App />);

    const state0 = useStudioStore.getState();
    expect(state0.timelinePlaying).toBe(false);
    const firstEl = state0.project.scenes[0].elements[0];
    const secondEl = state0.project.scenes[0].elements[1];
    expect(firstEl).toBeTruthy();
    expect(secondEl).toBeTruthy();

    const actualFirstX = firstEl.x;
    act(() => {
      useStudioStore.getState().applyAnimationPreset(firstEl.id, 'slide-left', 1000, {
        distancePx: 420,
        replaceExisting: true,
      });
    });

    // Ensure applying an animation preset does NOT force timelinePlaying on in the designer
    expect(useStudioStore.getState().timelinePlaying).toBe(false);

    // Select the first element and verify its rendered DOM selection box on the canvas is at actualFirstX
    act(() => {
      useStudioStore.getState().setSelectedElementIds([firstEl.id]);
    });
    const selectionBox = document.querySelector('.selection-bounding-box') as HTMLElement;
    expect(selectionBox).toBeTruthy();
    expect(selectionBox.style.left).toBe(`${actualFirstX}px`);

    // Group firstEl and secondEl
    const origX1 = firstEl.x;
    const origY1 = firstEl.y;
    const origW1 = firstEl.width;
    const origH1 = firstEl.height;
    const origX2 = secondEl.x;
    const origY2 = secondEl.y;
    const origW2 = secondEl.width;
    const origH2 = secondEl.height;

    act(() => {
      useStudioStore.getState().groupSelected([firstEl.id, secondEl.id]);
    });

    let scene = useStudioStore.getState().project.scenes[0];
    let c1 = scene.elements.find((e) => e.id === firstEl.id)!;
    let c2 = scene.elements.find((e) => e.id === secondEl.id)!;
    expect(c1.parentGroupId).toBeTruthy();
    expect(c1.parentGroupId).toBe(c2.parentGroupId);

    // Move c1 by +80px X and +40px Y via updateElement -> c2 must also move by +80px X and +40px Y
    act(() => {
      useStudioStore.getState().updateElement(firstEl.id, {
        x: origX1 + 80,
        y: origY1 + 40,
      });
    });
    scene = useStudioStore.getState().project.scenes[0];
    c1 = scene.elements.find((e) => e.id === firstEl.id)!;
    c2 = scene.elements.find((e) => e.id === secondEl.id)!;
    expect(c1.x).toBe(origX1 + 80);
    expect(c1.y).toBe(origY1 + 40);
    expect(c2.x).toBe(origX2 + 80);
    expect(c2.y).toBe(origY2 + 40);

    // Resize c1 to 0.5x -> c2 must also resize to 0.5x
    act(() => {
      useStudioStore.getState().updateElement(firstEl.id, {
        width: Math.round(origW1 * 0.5),
        height: Math.round(origH1 * 0.5),
      });
    });
    scene = useStudioStore.getState().project.scenes[0];
    c2 = scene.elements.find((e) => e.id === secondEl.id)!;
    expect(c2.width).toBe(Math.round(origW2 * 0.5));
    expect(c2.height).toBe(Math.round(origH2 * 0.5));

    // Rotate c1 to 15 deg -> c2 must also rotate by +15 deg
    const prevRot2 = c2.rotation || 0;
    const prevRot1 = c1.rotation || 0;
    act(() => {
      useStudioStore.getState().updateElement(firstEl.id, {
        rotation: prevRot1 + 15,
      });
    });
    scene = useStudioStore.getState().project.scenes[0];
    c2 = scene.elements.find((e) => e.id === secondEl.id)!;
    expect(c2.rotation).toBe(prevRot2 + 15);
  });

  it('auto-scales the Signage Player scene to the viewport and unlocks kiosk lockout via Maintenance Key Sequence', () => {
    act(() => {
      useStudioStore.getState().resetToStarterProject();
      useStudioStore.getState().setAppMode('player');
    });
    render(<App />);

    // 1. Verify player aspect frame renders and auto-scales to viewport dimensions
    const aspectFrame = document.querySelector('.player-aspect-frame') as HTMLElement;
    expect(aspectFrame).toBeTruthy();
    expect(aspectFrame.getAttribute('data-scale-mode')).toBe('auto-fit');
    const initialScaleX = Number(aspectFrame.getAttribute('data-scale-x'));
    expect(initialScaleX).toBeGreaterThan(0);

    // Simulate resizing window to 960x540 and verify scene scale updates dynamically
    act(() => {
      Object.defineProperty(window, 'innerWidth', {
        writable: true,
        configurable: true,
        value: 960,
      });
      Object.defineProperty(window, 'innerHeight', {
        writable: true,
        configurable: true,
        value: 540,
      });
      window.dispatchEvent(new Event('resize'));
    });

    const updatedScaleX = Number(aspectFrame.getAttribute('data-scale-x'));
    expect(updatedScaleX).toBeLessThan(1);
    expect(updatedScaleX).toBeGreaterThan(0.15);

    // 2. Engage Kiosk Lockout -> hides HUD bar and sets body.kiosk-lockout-active
    const lockBtn = screen.getByRole('button', { name: /Engage Kiosk Lockout/i });
    fireEvent.click(lockBtn);
    expect(document.body.classList.contains('kiosk-lockout-active')).toBe(true);
    expect(screen.queryByRole('button', { name: /Engage Kiosk Lockout/i })).toBeNull();

    // 3. Trigger Protected Maintenance Auth Modal using Hotkey Chord (Ctrl+Shift+M)
    fireEvent.keyDown(window, { key: 'M', ctrlKey: true, shiftKey: true });
    expect(
      screen.getByText(/Protected Kiosk Maintenance Authentication/i)
    ).toBeTruthy();

    // Close modal and trigger via Sequential Remote Key Sequence (↑ ↑ ↓ ↓ ← →)
    fireEvent.click(screen.getByRole('button', { name: /Cancel/i }));
    expect(
      screen.queryByText(/Protected Kiosk Maintenance Authentication/i)
    ).toBeNull();

    const seqKeys = [
      'ArrowUp',
      'ArrowUp',
      'ArrowDown',
      'ArrowDown',
      'ArrowLeft',
      'ArrowRight',
    ];
    for (const k of seqKeys) {
      fireEvent.keyDown(window, { key: k });
    }
    expect(
      screen.getByText(/Protected Kiosk Maintenance Authentication/i)
    ).toBeTruthy();

    // 4. Authenticate with default admin passphrase (ApexAdmin!2026) -> unlocks kiosk lockout
    const passInput = screen.getByLabelText(/Administrator Passphrase/i);
    fireEvent.change(passInput, { target: { value: 'ApexAdmin!2026' } });
    fireEvent.click(
      screen.getByRole('button', { name: /Verify & Unlock Maintenance/i })
    );

    expect(document.body.classList.contains('kiosk-lockout-active')).toBe(false);
    expect(screen.getByRole('button', { name: /Engage Kiosk Lockout/i })).toBeTruthy();
  });
});

