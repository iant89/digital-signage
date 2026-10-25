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
});
