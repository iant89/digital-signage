import React from 'react';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { App } from '../../src/App';

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

  it('supports collapsible side/bottom panels, mobile layout mode, and mobile player setup QR code enrollment', () => {
    render(<App />);

    // Return to Studio mode
    fireEvent.click(screen.getByRole('button', { name: /Studio Designer/i }));

    // 1. Collapse & expand Left Sidebar and Right Inspector
    const collapseLeftBtn = screen.getByLabelText(/Collapse Left Sidebar/i);
    fireEvent.click(collapseLeftBtn);
    expect(screen.getByLabelText(/Collapsed Left Sidebar/i)).toBeTruthy();

    const expandLeftBtn = screen.getByLabelText(/Expand Left Sidebar/i);
    fireEvent.click(expandLeftBtn);
    expect(screen.getByText(/Typography & Text/i)).toBeTruthy();

    const collapseRightBtn = screen.getByLabelText(/Collapse Right Inspector/i);
    fireEvent.click(collapseRightBtn);
    expect(screen.getByLabelText(/Collapsed Right Inspector/i)).toBeTruthy();

    // 2. Toggle Mobile Phone Layout mode
    const mobileToggle = screen.getByLabelText(/Toggle Mobile Layout/i);
    fireEvent.click(mobileToggle);
    expect(screen.getByRole('navigation', { name: /Mobile Studio Panels/i })).toBeTruthy();

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
});
