// Draws one floor of the campus into an <svg>. Shared by the 2D
// navigation tab and the welcome-page preview, so both always show
// the same plan from the same data.
import { appendIconShapes } from './icons.js';
import { legendOf, legendFill } from './campus-data.js';

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
  (floor.decor || []).forEach((d) => {
    if (d.type === 'oval') grow(d.x, d.y, d.rx, d.ry);
    else if (d.type === 'road') grow(d.x, d.y, d.w / 2, d.h / 2);
    else if (d.type !== 'crosswalk') grow(d.x, d.y, CIRCLE_R, CIRCLE_R);
  });

  if (!isFinite(minX)) return { x: 0, y: 0, width: 800, height: 500 };

  const pad = 50;
  return { x: minX - pad, y: minY - pad - 20, width: maxX - minX + pad * 2, height: maxY - minY + pad * 2 + 40 };
}

// Breaks a room name into lines that fit its box. Words longer than a line are cut.
function wrapLabel(text, maxChars) {
  const lines = [];
  let current = '';
  const push = (word) => {
    while (word.length > maxChars) {
      if (current) { lines.push(current); current = ''; }
      lines.push(`${word.slice(0, maxChars - 1)}-`); // a word that cannot fit is split with a hyphen
      word = word.slice(maxChars - 1);
    }
    if (!current) current = word;
    else if (`${current} ${word}`.length <= maxChars) current += ` ${word}`;
    else { lines.push(current); current = word; }
  };
  String(text).split(/\s+/).filter(Boolean).forEach(push);
  if (current) lines.push(current);
  return lines;
}

// Every room name uses the SAME size. Only a room that is clearly larger than the usual
// classroom gets bigger writing (never smaller than the standard). The text is wrapped to the
// room and, only as a last resort for a very long name, nudged down so it still stays INSIDE the box.
const BASE_FONT = 10.5;
const STD_AREA = 64 * 86; // a typical classroom box
export function fontFor(w, h) {
  const scale = Math.min(1.5, Math.max(1, Math.sqrt((w * h) / STD_AREA) * 0.8));
  return Math.round(BASE_FONT * scale * 2) / 2;
}

export function fitText(name, code, w, h) {
  const padX = 6;
  const padY = 5;
  const longestWord = Math.max(...String(name).split(/\s+/).map((x) => x.length));
  const measure = (size) => {
    const charW = size * 0.58; // average glyph width of the UI font
    const maxChars = Math.max(2, Math.floor((w - padX * 2) / charW));
    const lines = wrapLabel(name, maxChars);
    const codeSize = Math.max(7, size * 0.86);
    const codeFits = !code || String(code).length * codeSize * 0.58 <= w - padX * 2;
    const total = lines.length * size * 1.18 + (code ? codeSize * 1.3 : 0);
    return { size, codeSize, lines, lineHeight: size * 1.18, total, maxChars, ok: total <= h - padY * 2 && codeFits };
  };
  const start = fontFor(w, h);
  const floorSize = Math.max(6.5, start * 0.78);
  for (const allowCut of [false, true]) {
    for (let size = start; size >= floorSize; size -= 0.5) {
      const m = measure(size);
      if (m.ok && (allowCut || longestWord <= m.maxChars)) return m;
    }
  }
  for (let size = floorSize; size >= 5.5; size -= 0.5) {
    const m = measure(size);
    if (m.ok) return m;
  }
  return measure(5.5);
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
  if (!item.noStub && item.hallX !== undefined && Math.hypot(item.x - item.hallX, item.y - item.hallY) > STUB_MIN) {
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
  const lg = legendOf(r);
  const rectAttrs = { x: r.x - w / 2, y: r.y - h / 2, width: w, height: h, rx: 6, class: `room-rect cat-${lg.custom ? 'custom' : lg.id}` };
  if (lg.custom) rectAttrs.style = `--room-line:${lg.color};--room-fill:${legendFill(lg.color)}`;
  group.appendChild(svgEl('rect', rectAttrs));

  // Title (bigger) + description (smaller, usually the room number), always inside the box.
  const fit = fitText(r.name, r.code, w, h);
  const away = Math.sign(r.y - r.hallY0) || 0;
  let top = r.y - fit.total / 2 + away * Math.min(h * 0.08, 8);
  top = Math.max(r.y - h / 2 + 5, Math.min(top, r.y + h / 2 - 5 - fit.total));

  const nameText = svgEl('text', { x: r.x, y: top + fit.lineHeight / 2, class: 'room-name', style: `font-size:${fit.size}px` });
  fit.lines.forEach((line, i) => {
    const span = svgEl('tspan', { x: r.x, dy: i === 0 ? 0 : fit.lineHeight });
    span.textContent = line;
    nameText.appendChild(span);
  });
  group.appendChild(nameText);

  if (r.code) {
    const codeText = svgEl('text', {
      x: r.x, y: top + fit.lines.length * fit.lineHeight + fit.codeSize * 0.7, class: 'room-code', style: `font-size:${fit.codeSize}px`,
    });
    codeText.textContent = r.code;
    group.appendChild(codeText);
  }

  if (r.unavailable) {
    group.appendChild(svgEl('rect', { x: r.x - w / 2, y: r.y - h / 2, width: w, height: h, rx: 6, fill: 'url(#hatch)', class: 'unavail-hatch' }));
    const oy = r.y - away * Math.min(h * 0.28, 30);
    const badge = svgEl('g', { class: 'unavail-badge' });
    if (w >= 96) {
      badge.appendChild(svgEl('rect', { x: r.x - 38, y: oy - 11, width: 76, height: 22, rx: 11 }));
      placeIcon(badge, 'ban', r.x - 26, oy, 0.55);
      const t = svgEl('text', { x: r.x + 6, y: oy });
      t.textContent = 'UNAVAILABLE';
      badge.appendChild(t);
    } else {
      // Narrow room: just the "no entry" icon so nothing sticks out of the box.
      badge.appendChild(svgEl('circle', { cx: r.x, cy: oy, r: 11 }));
      placeIcon(badge, 'ban', r.x, oy, 0.6);
    }
    group.appendChild(badge);
  }
  root.appendChild(group);
}

// Roads: dark asphalt with light curbs and a dashed centre line, so they read as roads at a glance.
function drawScenery(root, d) {
  const g = svgEl('g', { class: d.type === 'oval' ? 'scenery oval' : 'scenery road' });
  const title = svgEl('title');
  title.textContent = d.name || d.type;
  g.appendChild(title);

  if (d.type === 'road') {
    const x = d.x - d.w / 2;
    const y = d.y - d.h / 2;
    g.appendChild(svgEl('rect', { x, y, width: d.w, height: d.h, rx: 5, class: 'road-curb' }));
    g.appendChild(svgEl('rect', { x: x + 4, y: y + 4, width: d.w - 8, height: d.h - 8, rx: 3, class: 'road-surface' }));
    const lane = d.dir === 'v'
      ? { x1: d.x, y1: y + 12, x2: d.x, y2: y + d.h - 12 }
      : { x1: x + 12, y1: d.y, x2: x + d.w - 12, y2: d.y };
    g.appendChild(svgEl('line', { ...lane, class: 'road-lane' }));
  } else {
    // Running track: brick-red ring, lane lines, and a grass field with its centre marking.
    g.appendChild(svgEl('ellipse', { cx: d.x, cy: d.y, rx: d.rx, ry: d.ry, class: 'oval-track' }));
    [0.93, 0.86].forEach((f) => g.appendChild(svgEl('ellipse', { cx: d.x, cy: d.y, rx: d.rx * f, ry: d.ry * f, class: 'oval-lane' })));
    g.appendChild(svgEl('ellipse', { cx: d.x, cy: d.y, rx: d.rx * 0.8, ry: d.ry * 0.8, class: 'oval-grass' }));
    g.appendChild(svgEl('rect', { x: d.x - d.rx * 0.5, y: d.y - d.ry * 0.62, width: d.rx, height: d.ry * 1.24, rx: 8, class: 'oval-field' }));
    g.appendChild(svgEl('line', { x1: d.x - d.rx * 0.5, y1: d.y, x2: d.x + d.rx * 0.5, y2: d.y, class: 'oval-field' }));
    const label = svgEl('text', { x: d.x, y: d.y, class: 'oval-label' });
    ['University Oval', 'Track Court'].forEach((t, i) => {
      const span = svgEl('tspan', { x: d.x, dy: i === 0 ? '-0.2em' : '1.25em' });
      span.textContent = t;
      label.appendChild(span);
    });
    g.appendChild(label);
  }
  root.appendChild(g);
}

// Zebra stripes: walking 'ew' (east-west) across a north-south road, or 'ns' across an east-west road.
function drawCrosswalk(root, d) {
  const g = svgEl('g', { class: 'crosswalk' });
  const bar = 4.5;
  const gap = 4.5;
  const count = Math.max(2, Math.floor((d.span - 6) / (bar + gap)));
  const used = count * bar + (count - 1) * gap;
  for (let i = 0; i < count; i++) {
    const off = -used / 2 + i * (bar + gap);
    if (d.dir === 'ew') g.appendChild(svgEl('rect', { x: d.x + off, y: d.y - d.len / 2, width: bar, height: d.len, rx: 1 }));
    else g.appendChild(svgEl('rect', { x: d.x - d.len / 2, y: d.y + off, width: d.len, height: bar, rx: 1 }));
  }
  root.appendChild(g);
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

  const decor = floor.decor || [];
  // Ground-level scenery first (roads, the oval) so the walkways draw on top of it.
  decor.filter((d) => d.type === 'road' || d.type === 'oval').forEach((d) => drawScenery(root, d));

  (floor.labels || []).forEach((lbl) => {
    const text = svgEl('text', { x: lbl.x, y: lbl.y, class: lbl.small ? 'map-note' : 'building-label' });
    text.textContent = lbl.text;
    root.appendChild(text);
  });

  // Corridors. Blue = wheelchair accessible, red-ish = steps (shown in PWD mode).
  const hallWidth = floor.hallWidth || 24;
  // Each straight corridor is a flat-ended bar. Where two bars meet and have the same colour the bar is
  // lengthened by half its width so corners and T-junctions fill in square (no round blobs);
  // where the colour changes (blue ramp meets a red step) it stops exactly at the junction.
  // Bends (curves) are drawn with round ends so they stay smooth.
  const classesAt = {};
  const curveNodes = new Set();
  floor.waypointEdges.forEach(([a, b, pwd, curve]) => {
    [a, b].forEach((n) => {
      (classesAt[n] = classesAt[n] || new Set()).add(!!pwd);
      if (curve) curveNodes.add(n);
    });
  });
  const half = hallWidth / 2;
  floor.waypointEdges.forEach(([a, b, pwd, curve]) => {
    const pa = graph.nodes[a];
    const pb = graph.nodes[b];
    if (!pa || !pb) return;
    const len = Math.hypot(pb.x - pa.x, pb.y - pa.y) || 1;
    const ux = (pb.x - pa.x) / len;
    const uy = (pb.y - pa.y) / len;
    const extA = !curve && !curveNodes.has(a) && classesAt[a].size === 1 ? half : 0;
    const extB = !curve && !curveNodes.has(b) && classesAt[b].size === 1 ? half : 0;
    root.appendChild(
      svgEl('line', {
        x1: pa.x - ux * extA, y1: pa.y - uy * extA, x2: pb.x + ux * extB, y2: pb.y + uy * extB,
        class: `hallway-line ${pwd ? 'pwd' : 'no-pwd'}${curve ? ' round' : ''}`, 'stroke-width': hallWidth,
      })
    );
  });

  // Zebra crossings where a walkway crosses a road.
  decor.filter((d) => d.type === 'crosswalk').forEach((d) => drawCrosswalk(root, d));

  // Display-only landmarks (the fountain). Not searchable, no graph node.
  decor.filter((d) => !['road', 'oval', 'crosswalk'].includes(d.type)).forEach((d) => {
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
export function setEndArrow(root, iconName, x, y, angle = 0) {
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
  holder.setAttribute('transform', `rotate(${angle}) scale(0.8) translate(-12 -12)`);
  arrow.setAttribute('transform', `translate(${x} ${y})`);
  arrow.classList.add('visible');
  dot.classList.add('hidden');
}