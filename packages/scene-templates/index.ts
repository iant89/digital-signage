import { Scene, SceneElement, createNewElement } from '@packages/project-model';
import { createId } from '@packages/shared';

export interface SceneTemplate {
  id: string;
  name: string;
  category: string;
  description: string;
  width: number;
  height: number;
  background: string;
  accent: string;
}
export const SCENE_TEMPLATES: readonly SceneTemplate[] = [
  { id: 'welcome', name: 'Corporate Welcome', category: 'Business', description: 'A bold welcome screen with a visitor information panel.', width: 1920, height: 1080, background: '#101c35', accent: '#38bdf8' },
  { id: 'menu', name: 'Café Menu', category: 'Food & drink', description: 'A warm two-column menu with editable items and prices.', width: 1920, height: 1080, background: '#261b18', accent: '#fbbf24' },
  { id: 'event', name: 'Event Spotlight', category: 'Events', description: 'Portrait event announcement with date and venue details.', width: 1080, height: 1920, background: '#24143e', accent: '#c4b5fd' },
  { id: 'sale', name: 'Retail Promotion', category: 'Retail', description: 'A high-impact square promotional offer.', width: 1080, height: 1080, background: '#103b34', accent: '#a3e635' },
  { id: 'directory', name: 'Building Directory', category: 'Business', description: 'Clear floor listings for lobby and wayfinding displays.', width: 1080, height: 1920, background: '#f1f5f9', accent: '#0369a1' },
  { id: 'notice', name: 'Team Announcement', category: 'Business', description: 'A clean broadcast layout for news and important notices.', width: 1920, height: 1080, background: '#172033', accent: '#fb923c' },
];

export function createBlankScene(width: number, height: number, name = 'Blank Scene', durationMs = 10000): Scene {
  return { id: createId('scene'), name, durationMs, backgroundColor: '#0f172a', referenceWidth: width, referenceHeight: height,
    elements: [], animationTracks: [], entryTransition: { type: 'fade', durationMs: 500, easing: 'easeOut' },
    exitTransition: { type: 'fade', durationMs: 500, easing: 'easeOut' }, scriptIds: [], permissions: ['scene:read'],
    completionBehavior: 'advance', failureBehavior: 'skip-scene' };
}

/** Editable, asset-free layouts; every call allocates fresh scene and component IDs. */
export function instantiateSceneTemplate(id: string, targetWidth?: number, targetHeight?: number): Scene {
  const t = SCENE_TEMPLATES.find(t => t.id === id);
  if (!t) throw new Error(`Unknown scene template: ${id}`);
  const width = targetWidth ?? t.width, height = targetHeight ?? t.height;
  if (![width, height].every(n => Number.isFinite(n) && n > 0)) throw new Error('Invalid template target size.');
  const scene = createBlankScene(width, height, t.name);
  scene.backgroundColor = t.background;
  const elements: SceneElement[] = [];
  const color = id === 'directory' ? '#0f172a' : '#f8fafc';
  // Layout coordinates are percentages of native template dimensions.
  const text = (name: string, value: string, x: number, y: number, w: number, h: number, font: number, ink = color) => {
    const e = createNewElement('text', { name, x: x * t.width, y: y * t.height, width: w * t.width, height: h * t.height, zIndex: elements.length + 1 });
    e.textProps = { ...e.textProps!, text: value, fontSize: font, color: ink, letterSpacing: 0, autoFit: true };
    elements.push(e);
  };
  const box = (name: string, x: number, y: number, w: number, h: number, fill: string) => {
    elements.push(createNewElement('shape', { name, x: x * t.width, y: y * t.height, width: w * t.width, height: h * t.height,
      zIndex: elements.length + 1, shapeProps: { shapeKind: 'rectangle', fillColor: fill, strokeColor: fill, strokeWidth: 0 } }));
  };
  box('Accent bar', .06, .08, .12, .012, t.accent);
  if (id === 'welcome') {
    box('Information panel', .66, .16, .28, .68, '#1e3354');
    text('Eyebrow', 'WELCOME TO OUR CAMPUS', .06, .16, .56, .08, 30, t.accent);
    text('Headline', 'Great ideas\nstart here.', .06, .29, .56, .32, 100);
    text('Subtitle', 'Connect. Collaborate. Create.', .06, .69, .56, .09, 34);
    text('Panel title', 'VISITING TODAY?', .69, .23, .22, .1, 28, t.accent);
    text('Visitor details', 'Check in at reception\n\nGuest Wi-Fi: Welcome\n\nEnjoy your visit', .69, .38, .22, .39, 30);
  } else if (id === 'menu') {
    text('Heading', 'THE DAILY CAFÉ', .06, .15, .88, .14, 80, t.accent);
    text('Menu subtitle', 'Freshly made. Thoughtfully served.', .06, .31, .88, .07, 30);
    box('Menu divider', .49, .45, .002, .39, '#7c6655');
    text('Drinks', 'COFFEE & TEA\n\nEspresso       $3.00\nCappuccino     $4.50\nMatcha latte   $5.00', .06, .46, .39, .39, 36);
    text('Food', 'FRESH FAVORITES\n\nAvocado toast  $8.50\nGarden bowl    $9.00\nDaily pastry   $4.00', .55, .46, .39, .39, 36);
  } else if (id === 'event') {
    text('Event label', 'YOU ARE INVITED', .08, .15, .84, .08, 32, t.accent);
    text('Event title', 'Ideas\nafter\nhours.', .08, .28, .84, .32, 116);
    box('Event band', .08, .68, .84, .2, '#3a235b');
    text('Event details', 'FRIDAY · 6:00 PM\nThe Atrium\nTalks, connections & inspiration', .12, .71, .76, .14, 32);
  } else if (id === 'sale') {
    text('Promotion label', 'THIS WEEK ONLY', .08, .16, .84, .1, 32, t.accent);
    text('Offer', '30%\nOFF', .08, .31, .84, .39, 150);
    text('Offer details', 'Your next favorite is waiting.\nSelected items · In store now', .08, .77, .84, .13, 30);
  } else if (id === 'directory') {
    text('Heading', 'Find your\nway.', .08, .15, .84, .18, 86);
    ['04   MEETING ROOMS', '03   DESIGN STUDIO', '02   WORKSPACES', '01   CAFÉ & LOUNGE', 'G     RECEPTION'].forEach((row, i) => {
      const y = .4 + i * .095;
      box(`Floor divider ${i}`, .08, y + .065, .84, .002, '#cbd5e1');
      text(`Floor ${i}`, row, .08, y, .84, .06, 32, t.accent);
    });
  } else {
    text('Announcement label', 'THE LATEST FROM OUR TEAM', .06, .17, .88, .08, 30, t.accent);
    text('Headline', 'Something great\nis happening.', .06, .33, .88, .27, 90);
    box('Notice band', .06, .69, .88, .17, '#26364d');
    text('Details', 'Share your news here.\nAdd a date, location, and the details your audience needs.', .09, .72, .82, .12, 32);
  }
  const scale = Math.min(width / t.width, height / t.height);
  const offsetX = (width - t.width * scale) / 2, offsetY = (height - t.height * scale) / 2;
  scene.elements = elements.map(e => ({ ...e, x: offsetX + e.x * scale, y: offsetY + e.y * scale,
    width: e.width * scale, height: e.height * scale,
    textProps: e.textProps ? { ...e.textProps, fontSize: e.textProps.fontSize * scale } : undefined }));
  return scene;
}
