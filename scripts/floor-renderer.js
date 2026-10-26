// Draws one floor of the campus into an <svg>. Shared by the 2D
// navigation tab and the welcome-page preview, so both always show
// the same plan from the same data.
import { appendIconShapes } from './icons.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

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

  [...floor.rooms, ...(floor.connectors || [])].forEach((item) => {
    const halfW = (item.width || 60) / 2;
    const halfH = (item.height || 60) / 2;
    minX = Math.min(minX, item.x - halfW);
    maxX = Math.max(maxX, item.x + halfW);
    minY = Math.min(minY, item.y - halfH);
    maxY = Math.max(maxY, item.y + halfH);
  });

  if (!isFinite(minX)) {
    return { x: 0, y: 0, width: 800, height: 500 };
  }

  const pad = 50;
  return {
    x: minX - pad,
    y: minY - pad - 20,
    width: maxX - minX + pad * 2,
    height: maxY - minY + pad * 2 + 40,
  };
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

// The floor is already shown in the floor switcher, so drop "(2nd floor)",
// "(LG)", "(UG)" from marker labels. "(UG2)" stays, it tells two rooms apart.
const shortLabel = (name) => name.replace(/\s*\((?:\d+(?:st|nd|rd|th)\s*floor|LG|UG)\)/i, '');

// Which pictogram a stairs / restroom / elevator marker gets.
function iconNameFor(name) {
  const n = name.toLowerCase();
  if (n.includes('female')) return 'woman';
  if (n.includes('male')) return 'man';
  if (n.includes('stairs')) return 'stairs';
  if (n.includes('elevator')) return 'elevator';
  return 'map-pin';
}

function renderIconMarker(root, item, graph) {
  const pos = graph.nodes[item.id];
  const wp = graph.nodes[item.connectsTo];
  if (!pos) return;

  if (wp) {
    root.appendChild(svgEl('line', { x1: pos.x, y1: pos.y, x2: wp.x, y2: wp.y, class: 'room-stub' }));
  }

  const group = svgEl('g', { class: 'room connector', 'data-room-id': item.id });
  group.appendChild(svgEl('circle', { cx: pos.x, cy: pos.y, r: 16, class: 'connector-marker' }));

  // Tabler icons live on a 24x24 grid: scale down and centre on the marker.
  const icon = svgEl('g', {
    class: 'connector-icon',
    transform: `translate(${pos.x} ${pos.y}) scale(0.66) translate(-12 -12)`,
  });
  appendIconShapes(icon, iconNameFor(item.name));
  group.appendChild(icon);

  const label = svgEl('text', { x: pos.x, y: pos.y + 31, class: 'connector-label' });
  label.textContent = shortLabel(item.name);
  group.appendChild(label);
  root.appendChild(group);
}

export function renderFloor(root, floor, graph) {
  root.innerHTML = '';
  const bounds = computeFloorBounds(floor);
  root.setAttribute('viewBox', `${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`);

  (floor.labels || []).forEach((lbl) => {
    const text = svgEl('text', { x: lbl.x, y: lbl.y, class: 'building-label' });
    text.textContent = lbl.text;
    root.appendChild(text);
  });

  floor.waypointEdges.forEach(([a, b]) => {
    const pa = graph.nodes[a];
    const pb = graph.nodes[b];
    if (!pa || !pb) return;
    root.appendChild(svgEl('line', { x1: pa.x, y1: pa.y, x2: pb.x, y2: pb.y, class: 'hallway-line' }));
  });

  floor.rooms.forEach((r) => {
    // Restrooms are real searchable rooms, drawn as a round marker like stairs.
    if (r.icon) {
      renderIconMarker(root, r, graph);
      return;
    }

    const pos = graph.nodes[r.id];
    const wp = graph.nodes[r.connectsTo];
    if (!pos) return;

    if (wp) {
      root.appendChild(svgEl('line', { x1: pos.x, y1: pos.y, x2: wp.x, y2: wp.y, class: 'room-stub' }));
    }

    const w = r.width || 90;
    const h = r.height || 130;
    const group = svgEl('g', { class: 'room', 'data-room-id': r.id });
    group.appendChild(
      svgEl('rect', { x: pos.x - w / 2, y: pos.y - h / 2, width: w, height: h, rx: 8, class: 'room-rect' })
    );

    // Wrap the name, and park the label on the side away from the hallway
    // so the route line and its dots never sit on top of the text.
    const lineHeight = 13;
    const nameLines = wrapLabel(r.name, Math.max(8, Math.floor((w - 12) / 6)));
    const away = wp ? Math.sign(pos.y - wp.y) : 0;
    const centerY = pos.y + away * Math.min(h * 0.18, 22);
    const totalLines = nameLines.length + (r.code ? 1 : 0);
    const firstY = centerY - ((totalLines - 1) * lineHeight) / 2;

    const nameText = svgEl('text', { x: pos.x, y: firstY, class: 'room-name' });
    nameLines.forEach((line, i) => {
      const span = svgEl('tspan', { x: pos.x, dy: i === 0 ? 0 : lineHeight });
      span.textContent = line;
      nameText.appendChild(span);
    });
    group.appendChild(nameText);

    if (r.code) {
      const codeText = svgEl('text', { x: pos.x, y: firstY + nameLines.length * lineHeight, class: 'room-code' });
      codeText.textContent = r.code;
      group.appendChild(codeText);
    }
    root.appendChild(group);
  });

  (floor.connectors || []).forEach((c) => renderIconMarker(root, c, graph));

  // Route layers sit last so the line draws over everything else.
  root.appendChild(svgEl('path', { class: 'route-line', id: 'route-line' }));
  root.appendChild(svgEl('circle', { r: 9, class: 'route-marker start-marker', id: 'start-marker' }));
  root.appendChild(svgEl('circle', { r: 9, class: 'route-marker end-marker', id: 'end-marker' }));

  return bounds;
}