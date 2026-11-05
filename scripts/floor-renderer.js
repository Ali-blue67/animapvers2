// Draws one floor of the campus into an <svg>. Shared by the 2D
// navigation tab and the welcome-page preview, so both always show
// the same plan from the same data.
import { appendIconShapes } from './icons.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const CIRCLE_R = 16;
const STUB_MIN = 30; // a circle farther than this from its corridor gets a short connecting line

export function svgEl(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  Object.entries(attrs).forEach(([key, value]) => el.setAttribute(key, value));
  return el;
}

export function computeFloorBounds(floor) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const grow = (x, y, halfW, halfH) => {
    minX = Math.min(minX, x - halfW);
    maxX = Math.max(maxX, x + halfW);
    minY = Math.min(minY, y - halfH);
    maxY = Math.max(maxY, y + halfH);
  };

  [...(floor.rooms || []), ...(floor.connectors || [])].forEach((item) => grow(item.x, item.y, (item.width || 60) / 2, (item.height || 60) / 2));
  // Corridors and decorations also count, so nothing is cropped.
  const hw = (floor.hallWidth || 24) / 2;
  (floor.waypoints || []).forEach((wp) => grow(wp.x, wp.y, hw, hw));
  (floor.decor || []).forEach((d) => grow(d.x, d.y, CIRCLE_R, CIRCLE_R));

  if (!isFinite(minX)) return { x: 0, y: 0, width: 800, height: 500 };

  const pad = 50;
  return { x: minX - pad, y: minY - pad - 20, width: maxX - minX + pad * 2, height: maxY - minY + pad * 2 + 40 };
}

// Breaks a room name into lines that fit its box (never splits a word).
function wrapLabel(text, maxChars) {
  const lines = [];
  let current = '';
  text.split(' ').forEach((word) => {
    if (!current) current = word;
    else if (`${current} ${word}`.length <= maxChars) current += ` ${word}`;
    else {
      lines.push(current);
      current = word;
    }
  });
  if (current) lines.push(current);
  return lines;
}

// Which pictogram a marker gets (data can name one directly via iconName).
function iconNameFor(item) {
  if (item.iconName) return item.iconName;
  const n = item.name.toLowerCase();
  if (n.includes('female')) return 'woman';
  if (n.includes('male')) return 'man';
  if (n.includes('stairs')) return 'stairs';
  if (n.includes('elevator')) return 'elevator';
  return 'map-pin';
}

function placeIcon(parent, name, x, y, scale) {
  const icon = svgEl('g', { class: 'connector-icon', transform: `translate(${x} ${y}) scale(${scale}) translate(-12 -12)` });
  appendIconShapes(icon, name);
  parent.appendChild(icon);
  return icon;
}

// Round marker for stairs, elevator, ramp, restrooms and the gate.
function renderIconMarker(root, item) {
  if (item.hallX !== undefined && Math.hypot(item.x - item.hallX, item.y - item.hallY) > STUB_MIN) {
    root.appendChild(svgEl('line', { x1: item.x, y1: item.y, x2: item.hallX, y2: item.hallY, class: 'room-stub' }));
  }

  const kind = item.kind === 'room' ? 'room connector' : 'connector';
  const group = svgEl('g', { class: `${kind}${item.unavailable ? ' unavailable' : ''}`, 'data-room-id': item.id });
  const title = svgEl('title');
  title.textContent = item.unavailable ? `${item.name} (unavailable)` : item.name;
  group.appendChild(title);
  group.appendChild(svgEl('circle', { cx: item.x, cy: item.y, r: CIRCLE_R, class: 'connector-marker' }));
  placeIcon(group, iconNameFor(item), item.x, item.y, 0.66);

  if (item.unavailable) {
    group.appendChild(svgEl('circle', { cx: item.x, cy: item.y, r: CIRCLE_R, fill: 'url(#hatch)', class: 'unavail-hatch' }));
  }
  root.appendChild(group);
}

function renderRoom(root, r) {
  const w = r.width;
  const h = r.height;
  const gap = Math.hypot(r.doorX - r.hallX0, r.doorY - r.hallY0);
  if (gap > (r.hallHalf || 12) + 2) {
    root.appendChild(svgEl('line', { x1: r.hallX0, y1: r.hallY0, x2: r.doorX, y2: r.doorY, class: 'room-stub' }));
  }

  const group = svgEl('g', { class: `room${r.unavailable ? ' unavailable' : ''}`, 'data-room-id': r.id });
  const title = svgEl('title');
  title.textContent = r.unavailable ? `${r.name} (unavailable)` : r.name;
  group.appendChild(title);
  group.appendChild(svgEl('rect', { x: r.x - w / 2, y: r.y - h / 2, width: w, height: h, rx: 6, class: `room-rect cat-${r.cat || 'gray'}` }));

  // Wrap the name and park it on the side away from the hallway.
  const lineHeight = 13;
  const nameLines = wrapLabel(r.name, Math.max(8, Math.floor((w - 10) / 6)));
  const away = Math.sign(r.y - r.hallY0) || 0;
  const centerY = r.y + away * Math.min(h * 0.12, 14);
  const totalLines = nameLines.length + (r.code ? 1 : 0);
  const firstY = centerY - ((totalLines - 1) * lineHeight) / 2;

  const nameText = svgEl('text', { x: r.x, y: firstY, class: 'room-name' });
  nameLines.forEach((line, i) => {
    const span = svgEl('tspan', { x: r.x, dy: i === 0 ? 0 : lineHeight });
    span.textContent = line;
    nameText.appendChild(span);
  });
  group.appendChild(nameText);

  if (r.code) {
    const codeText = svgEl('text', { x: r.x, y: firstY + nameLines.length * lineHeight, class: 'room-code' });
    codeText.textContent = r.code;
    group.appendChild(codeText);
  }

  if (r.unavailable) {
    group.appendChild(svgEl('rect', { x: r.x - w / 2, y: r.y - h / 2, width: w, height: h, rx: 6, fill: 'url(#hatch)', class: 'unavail-hatch' }));
    const oy = r.y - away * Math.min(h * 0.28, 30);
    const badge = svgEl('g', { class: 'unavail-badge' });
    badge.appendChild(svgEl('rect', { x: r.x - 38, y: oy - 11, width: 76, height: 22, rx: 11 }));
    placeIcon(badge, 'ban', r.x - 26, oy, 0.55);
    const t = svgEl('text', { x: r.x + 6, y: oy });
    t.textContent = 'UNAVAILABLE';
    badge.appendChild(t);
    group.appendChild(badge);
  }
  root.appendChild(group);
}

export function renderFloor(root, floor, graph) {
  root.innerHTML = '';
  const bounds = computeFloorBounds(floor);
  root.setAttribute('viewBox', `${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`);

  // Red diagonal stripes for rooms an admin has closed.
  const defs = svgEl('defs');
  const pattern = svgEl('pattern', { id: 'hatch', width: 10, height: 10, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' });
  pattern.appendChild(svgEl('rect', { width: 10, height: 10, fill: 'rgba(255,255,255,0.55)' }));
  pattern.appendChild(svgEl('rect', { width: 4.5, height: 10, fill: 'rgba(220,38,38,0.55)' }));
  defs.appendChild(pattern);
  root.appendChild(defs);

  (floor.labels || []).forEach((lbl) => {
    const text = svgEl('text', { x: lbl.x, y: lbl.y, class: 'building-label' });
    text.textContent = lbl.text;
    root.appendChild(text);
  });

  // Corridors. Blue = wheelchair accessible, red-ish = steps (shown in PWD mode).
  const hallWidth = floor.hallWidth || 24;
  floor.waypointEdges.forEach(([a, b, pwd]) => {
    const pa = graph.nodes[a];
    const pb = graph.nodes[b];
    if (!pa || !pb) return;
    root.appendChild(
      svgEl('line', { x1: pa.x, y1: pa.y, x2: pb.x, y2: pb.y, class: `hallway-line ${pwd ? 'pwd' : 'no-pwd'}`, 'stroke-width': hallWidth })
    );
  });

  // Display-only landmarks (the fountain). Not searchable, no graph node.
  (floor.decor || []).forEach((d) => {
    const g = svgEl('g', { class: 'decor' });
    const title = svgEl('title');
    title.textContent = d.name || d.type;
    g.appendChild(title);
    g.appendChild(svgEl('circle', { cx: d.x, cy: d.y, r: CIRCLE_R, class: 'decor-marker' }));
    placeIcon(g, d.type, d.x, d.y, 0.66);
    root.appendChild(g);
  });

  floor.rooms.forEach((r) => {
    if (r.icon) return renderIconMarker(root, r);
    const hall = graph.nodes[r.connectsTo];
    renderRoom(root, { ...r, hallX0: hall ? hall.x : r.doorX, hallY0: hall ? hall.y : r.doorY, hallHalf: hallWidth / 2 });
  });
  (floor.connectors || []).forEach((c) => renderIconMarker(root, c));

  // Route layers sit last so the line draws over everything else.
  root.appendChild(svgEl('path', { class: 'route-line', id: 'route-line' }));
  root.appendChild(svgEl('circle', { r: 9, class: 'route-marker start-marker', id: 'start-marker' }));
  root.appendChild(svgEl('circle', { r: 9, class: 'route-marker end-marker', id: 'end-marker' }));

  // Up / down arrow that replaces the red end dot when the route continues to another floor.
  const arrow = svgEl('g', { class: 'end-arrow', id: 'end-arrow' });
  arrow.appendChild(svgEl('circle', { r: 17, class: 'end-arrow-bg' }));
  arrow.appendChild(svgEl('g', { class: 'end-arrow-icon', id: 'end-arrow-icon' }));
  root.appendChild(arrow);

  return bounds;
}

// Swaps the red end dot for an up/down arrow ('arrow-up' | 'arrow-down'), or back to the dot (null).
export function setEndArrow(root, iconName, x, y) {
  const arrow = root.querySelector('#end-arrow');
  const dot = root.querySelector('#end-marker');
  if (!arrow || !dot) return;
  if (!iconName) {
    arrow.classList.remove('visible');
    dot.classList.remove('hidden');
    return;
  }
  const holder = arrow.querySelector('#end-arrow-icon');
  holder.replaceChildren();
  appendIconShapes(holder, iconName);
  holder.setAttribute('transform', `scale(0.8) translate(-12 -12)`);
  arrow.setAttribute('transform', `translate(${x} ${y})`);
  arrow.classList.add('visible');
  dot.classList.add('hidden');
}