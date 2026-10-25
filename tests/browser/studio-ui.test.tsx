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

    // 3. Open the Simple Audio Editor modal from the Studio Timeline and delete a selected section
    render(<App />);
    fireEvent.click(screen.getAllByRole('button', { name: /Audio Editor/i })[0]);
    expect(screen.getByText(/Studio Audio Editor & Background Music Mixer/i)).toBeTruthy();

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
});

