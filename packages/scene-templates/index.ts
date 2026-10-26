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
    e.textProps = { ...e.textProps!, text: value, fontSize: font, color: ink, letterSpacing: 0, autoFit: false, verticalAlign: 'top', lineHeight: 1.12 };
    elements.push(e);
  };
  const box = (name: string, x: number, y: number, w: number, h: number, fill: string, radius = 0, ellipse = false) => {
    elements.push(createNewElement('shape', { name, x: x * t.width, y: y * t.height, width: w * t.width, height: h * t.height,
      zIndex: elements.length + 1, border: { width: 0, color: fill, style: 'solid', radius },
      shapeProps: { shapeKind: ellipse ? 'ellipse' : 'rectangle', fillColor: fill, strokeColor: fill, strokeWidth: 0 } }));
  };
  const label = (name: string, value: string, x: number, y: number, w: number, ink = t.accent) => {
    text(name, value, x, y, w, .035, t.width > t.height ? 23 : 25, ink);
    elements[elements.length - 1].textProps!.letterSpacing = 3;
  };
  const rule = (y: number, ink: string) => box('Fine rule', .06, y, .88, .0015, ink);
  if (id === 'welcome') {
    scene.backgroundGradient = 'linear-gradient(125deg, #080e1d 0%, #152e52 65%, #123c51 100%)';
    box('Ambient blue disc', .68, .06, .27, .48, '#163f60', 0, true);
    label('Brand', 'APEX / GLOBAL CAMPUS', .06, .07, .6, '#d9e8f7');
    label('Live status', '●  LIVE / CONNECTED', .72, .07, .23, '#67e8d1');
    rule(.145, '#31516d');
    label('Welcome label', 'A PLACE FOR POSSIBILITY', .06, .24, .52);
    text('Headline', 'Great ideas.\nShared futures.', .055, .33, .59, .29, 112);
    text('Subtitle', 'Welcome to the campus. Your next connection starts here.', .06, .66, .51, .09, 30, '#b8cce0');
    box('Visitor panel', .69, .25, .25, .5, '#10233a', 24);
    label('Visitor heading', 'YOUR VISIT', .715, .29, .2);
    text('Reception', 'Hello, guest.', .715, .37, .2, .075, 36);
    text('Visitor guidance', 'Check in at reception\nGround floor · East entrance', .715, .46, .2, .12, 25, '#bfd0e2');
    box('Visitor divider', .715, .6, .2, .0015, '#36536c');
    text('Guest network', 'GUEST WI-FI\nAPEX Welcome', .715, .64, .2, .09, 23, '#67e8d1');
    rule(.84, '#31516d');
    label('Footer', 'CONNECT  /  COLLABORATE  /  CREATE', .06, .89, .65, '#9ab4cb');
    label('Location', 'PITTSBURGH, PA', .77, .89, .19, '#9ab4cb');
  } else if (id === 'menu') {
    scene.backgroundGradient = 'linear-gradient(120deg, #241a16, #493025)';
    label('Brand', 'THE DAILY / CAFÉ', .055, .06, .5, '#f8dfb3');
    label('Opening hours', 'FRESH DAILY · 7 AM — 4 PM', .65, .06, .3, '#e8c598');
    rule(.13, '#80644b');
    text('Heading', 'A little ritual. A better day.', .055, .19, .88, .12, 76, '#fff4dd');
    text('Menu subtitle', 'Small-batch coffee. Seasonal ingredients. Made with care.', .06, .32, .84, .055, 27, '#d8bfa1');
    box('Coffee menu card', .055, .44, .28, .39, '#35251d', 18);
    box('Kitchen menu card', .355, .44, .28, .39, '#35251d', 18);
    label('Coffee heading', '01 / COFFEE BAR', .075, .47, .25, '#f5ce8a');
    label('Kitchen heading', '02 / THE KITCHEN', .375, .47, .25, '#f5ce8a');
    ['Espresso|3.00', 'Flat white|4.50', 'Matcha latte|5.00'].forEach((row, i) => {
      const [name, price] = row.split('|');
      text('Drink', name, .075, .55 + i * .082, .18, .05, 29, '#fff4dd');
      text('Drink price', price, .27, .55 + i * .082, .05, .05, 27, '#f5ce8a');
    });
    ['Avocado toast|8.50', 'Garden bowl|9.00', 'Daily pastry|4.00'].forEach((row, i) => {
      const [name, price] = row.split('|');
      text('Dish', name, .375, .55 + i * .082, .18, .05, 29, '#fff4dd');
      text('Dish price', price, .57, .55 + i * .082, .05, .05, 27, '#f5ce8a');
    });
    box('Special card', .66, .44, .285, .39, '#e5bb7b', 18);
    label('Special label', 'THE PERFECT PAIR', .685, .48, .24, '#593620');
    text('Special title', 'Espresso\n& brioche', .685, .55, .24, .15, 48, '#2f2119');
    text('Special price', '$8.50', .685, .73, .24, .075, 48, '#2f2119');
    label('Footer', 'GOOD COFFEE. GOOD COMPANY.', .06, .9, .7, '#d8bfa1');
  } else if (id === 'event') {
    scene.backgroundGradient = 'linear-gradient(160deg, #21153b 0%, #3c2160 70%, #17142b 100%)';
    box('Orbit outer', .39, .27, .54, .304, '#664594', 0, true);
    box('Orbit inner', .46, .31, .4, .225, '#362452', 0, true);
    box('Orbit core', .54, .355, .24, .135, '#cfb7fa', 0, true);
    label('Event series', 'THE AFTER HOURS SERIES / 004', .08, .06, .84, '#d9c9f1');
    box('Top divider', .08, .12, .84, .001, '#70558d');
    label('Event type', 'TALKS. PEOPLE. POSSIBILITIES.', .08, .18, .84);
    text('Event title', 'Ideas\nafter\nhours.', .07, .28, .86, .34, 142);
    box('Event detail panel', .08, .7, .84, .19, '#e7d9ff', 22);
    label('Date', 'FRIDAY / OCT 30', .12, .73, .76, '#50316e');
    text('Event venue', '6:00 PM · The Atrium', .12, .78, .76, .05, 38, '#26173c');
    text('Event invitation', 'Meet curious minds. Leave inspired.', .12, .84, .76, .035, 26, '#50316e');
    label('Event footer', 'OPEN TO EVERYONE   ↗', .08, .94, .84, '#cdb7e6');
  } else if (id === 'sale') {
    scene.backgroundColor = '#e8efdb';
    box('Retail green panel', .51, 0, .49, 1, '#173d35');
    box('Retail disc', .59, .27, .34, .34, '#285849', 0, true);
    box('Retail inner disc', .65, .33, .22, .22, '#9bba75', 0, true);
    // A light brand strip keeps the masthead legible across both halves.
    box('Masthead background', .51, 0, .49, .13, '#e8efdb');
    label('Retail brand', 'FORM / EVERYDAY ESSENTIALS', .06, .055, .88, '#173d35');
    label('Retail collection', 'THE AUTUMN EDIT', .06, .21, .43, '#42604e');
    text('Retail headline', 'Less,\nbut\nbetter.', .05, .3, .45, .42, 92, '#173d35');
    label('Retail offer label', 'A LITTLE THANK YOU', .56, .68, .39, '#c9e7ab');
    text('Offer', '30% OFF', .55, .74, .4, .11, 69, '#f0f7df');
    text('Offer details', 'Selected favorites.\nThis week, in store.', .56, .86, .38, .08, 27, '#c9dcc7');
    text('Retail footer', 'Thoughtful design.\nMade for your everyday.', .06, .83, .4, .1, 27, '#42604e');
  } else if (id === 'directory') {
    scene.backgroundColor = '#f1f2ec';
    box('Directory header', 0, 0, 1, .32, '#123e43');
    label('Directory brand', 'NORTH / CAMPUS', .08, .05, .84, '#b3dbca');
    text('Heading', 'Find your\nnext stop.', .075, .12, .85, .15, 86, '#f1f2ec');
    label('Directory label', 'BUILDING A / FLOOR DIRECTORY', .08, .36, .84, '#587369');
    const floors = [['04', 'Meeting rooms', 'BOARDROOMS / CONFERENCE SUITES'], ['03', 'Design studio', 'CREATIVE TEAMS / PROJECT SPACES'], ['02', 'Workspaces', 'COLLABORATION / PRIVATE OFFICES'], ['01', 'Café & lounge', 'COFFEE / GOOD CONVERSATION'], ['G', 'Reception', 'WELCOME DESK / VISITOR CHECK-IN']];
    floors.forEach(([floor, name, sub], i) => {
      const y = .43 + i * .09;
      text('Floor number', floor, .08, y, .13, .055, 52, '#23604f');
      text('Floor name', name, .26, y, .62, .035, 34, '#18352e');
      text('Floor description', sub, .26, y + .035, .64, .025, 17, '#647b70');
      box('Floor rule', .08, y + .07, .84, .001, '#cbd5c8');
    });
    box('Location marker', .08, .925, .025, .014, '#23604f', 0, true);
    label('Location footer', 'YOU ARE HERE / GROUND FLOOR', .135, .923, .8, '#587369');
  } else {
    scene.backgroundGradient = 'linear-gradient(120deg, #101b30, #243f58)';
    label('News masthead', 'INSIDE / APEX', .06, .06, .5, '#e4edf6');
    label('News edition', 'TEAM NEWS / ISSUE 026', .68, .06, .28, '#a1bcd2');
    rule(.135, '#3c5871');
    box('Feature panel', .64, .22, .3, .56, '#e2a575', 24);
    label('Feature label', 'BETTER TOGETHER', .67, .27, .24, '#523a2a');
    text('Feature number', '01', .66, .39, .25, .19, 160, '#243b46');
    text('Feature note', 'One team.\nA world of possibilities.', .67, .64, .24, .1, 30, '#523a2a');
    label('News label', 'PEOPLE / PROGRESS / PURPOSE', .06, .23, .55, '#f7b98a');
    text('Headline', 'Good things\nare happening.', .055, .34, .56, .26, 94);
    text('News details', 'Join us for our next all-hands gathering.\nNew ideas, shared wins, and what comes next.', .06, .66, .55, .12, 30, '#c2d4e3');
    rule(.85, '#3c5871');
    label('News footer', 'THURSDAY / 10:00 AM / THE ATRIUM', .06, .9, .8, '#a1bcd2');
  }
  const scale = Math.min(width / t.width, height / t.height);
  const offsetX = (width - t.width * scale) / 2, offsetY = (height - t.height * scale) / 2;
  scene.elements = elements.map(e => ({ ...e, x: offsetX + e.x * scale, y: offsetY + e.y * scale,
    width: e.width * scale, height: e.height * scale,
    border: e.border ? { ...e.border, radius: (e.border.radius ?? 0) * scale } : undefined,
    textProps: e.textProps ? { ...e.textProps, fontSize: e.textProps.fontSize * scale } : undefined }));
  return scene;
}
