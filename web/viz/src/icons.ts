/** A small set of 16x16 icons drawn for this app. They take their colour from the text (currentColor). */

const NS = 'http://www.w3.org/2000/svg';

type Shape = { d: string; fill?: boolean };

const ICONS = {
  play: { d: 'M4.5 2.5v11l8.5-5.5z', fill: true },
  playBack: { d: 'M11.5 2.5v11L3 8z', fill: true },
  pause: { d: 'M4 3h3v10H4zM9 3h3v10H9z', fill: true },
  stop: { d: 'M3.5 3.5h9v9h-9z', fill: true },
  step: { d: 'M3 2.5v11l7.5-5.5zM11.5 2.5h2v11h-2z', fill: true },
  stepBack: { d: 'M13 2.5v11L5.5 8zM2.5 2.5h2v11h-2z', fill: true },
  reverse: { d: 'M2 5.5h10M9 2.5l3 3-3 3M14 10.5H4M7 7.5l-3 3 3 3' },
  sidebar: { d: 'M2 3h12v10H2zM6 3v10' },
  check: { d: 'M3 8.5l3.5 3.5L13 4.5' },
  cross: { d: 'M4 4l8 8M12 4l-8 8' },
  warn: { d: 'M8 2.5l6 10.5H2zM8 7v3M8 11.6v.4' },
  fork: { d: 'M5 2.5v11M5 9c0-3 6-1.5 6-6' },
  build: { d: 'M3 13.5h10M8 2.5v8M4.8 7.5L8 10.7l3.2-3.2' },
  halt: { d: 'M3.5 3.5h9v9h-9z' },
  chevronDown: { d: 'M4 6l4 4 4-4' },
} as const satisfies Record<string, Shape>;

export type IconName = keyof typeof ICONS;

export function icon(name: IconName, size = 16): SVGSVGElement {
  const spec: Shape = ICONS[name];
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('class', 'icon');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', spec.d);
  if (spec.fill) {
    path.setAttribute('fill', 'currentColor');
  } else {
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '1.5');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
  }
  svg.append(path);
  return svg;
}
