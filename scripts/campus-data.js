// =====================================================================
// CAMPUS DATA - rebuilt from "new_2D_MAP_UPDATED.pdf".
//
// Every floor is described with the coordinates read off the PDF
// (green = walkable corridor, blue = PWD-accessible corridor, red = stairs,
// not PWD accessible). A small builder (buildFloor) turns those numbers into
// the rooms, corridor waypoints and graph edges the rest of the app uses.
//
// HS Cafeteria is its own building: it is NOT joined to Building 1/2 on the
// 2nd floor. You reach it from the Upper Ground (past the HS Chapel).
// =====================================================================

// ---------- Room colour categories ----------
// blue = CSS labs + TESDA, orange = food / science / computer labs, yellow = offices & services,
// green = classrooms, purple = faculty offices, gray = everything else (stock rooms, storage, housekeeper...).
const CAT_GRAY = /stock ?room|storage|housekeeper/i;
const CAT_BLUE = /css lab|tesda|bkp room/i;
const CAT_ORANGE = /food lab|science lab|computer lab|robotics lab/i;
const CAT_YELLOW =
  /registrar|principal|coordinator|student life|lmo|student council|viridescent|comelec|la estrella|resilience|animo|swc|conference|prefect|clinic|bookstore|association/i;
export function categoryFor(name) {
  if (CAT_GRAY.test(name)) return 'gray';
  if (CAT_BLUE.test(name)) return 'blue';
  if (CAT_ORANGE.test(name)) return 'orange';
  if (CAT_YELLOW.test(name)) return 'yellow';
  if (/^(LSH|MTH|CTH) \d{3}$/.test(name) || /classroom/i.test(name)) return 'green';
  return 'gray';
}

// ---------- Item constructors (source = PDF pixel coordinates) ----------
const R = (id, name, code, x1, x2, y1, y2, opts = {}) => ({ t: 'room', id, name, code, x1, x2, y1, y2, ...opts });
const C = (t, id, x, y, name, extra = {}) => ({ t, id, x, y, name, ...extra });
const S = (id, x, y) => C('S', id, x, y, 'Stairs');
const E = (x, y) => C('E', 'elevator', x, y, 'Elevator');
const M = (id, x, y, where, extra = {}) => C('M', id, x, y, `Male Bathroom (${where})`, extra);
const F = (id, x, y, where, extra = {}) => C('F', id, x, y, `Female Bathroom (${where})`, extra);

const ICON_OF = { S: 'stairs', E: 'elevator', M: 'man', F: 'woman', RAMP: 'wheelchair', GATE: 'door-enter' };
const ROOM_LIKE = new Set(['M', 'F', 'GATE']); // circles that are real, searchable destinations

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function project(p, s) {
  const dx = s.b[0] - s.a[0];
  const dy = s.b[1] - s.a[1];
  const l2 = dx * dx + dy * dy;
  if (!l2) return null;
  const t = Math.max(0, Math.min(1, ((p[0] - s.a[0]) * dx + (p[1] - s.a[1]) * dy) / l2));
  const pt = [s.a[0] + t * dx, s.a[1] + t * dy];
  return { pt, d: dist(p, pt) };
}

function nearest(p, segs) {
  let best = null;
  segs.forEach((s) => {
    const r = project(p, s);
    if (r && (!best || r.d < best.d)) best = { ...r, seg: s };
  });
  return best;
}

// ---------- Floor builder ----------
function buildFloor(spec) {
  const { id, label, k = 1, dx = 0, dy = 0, hallWidth = 24, corridors, items, decor = [], labels = [], panZoom = false, focus } = spec;
  const P = (x, y) => [x * k + dx, y * k + dy];
  const nid = (pt) => `${id}-n${Math.round(pt[0])}_${Math.round(pt[1])}`;

  const segs = [];
  const verts = [];
  corridors.forEach((c) => {
    const pts = c.pts.map(([x, y]) => P(x, y));
    pts.forEach((p) => verts.push(p));
    for (let i = 0; i < pts.length - 1; i++) segs.push({ a: pts[i], b: pts[i + 1], pwd: c.pwd !== false, pwdOnly: !!c.pwdOnly, curve: !!c.curve, w: c.w || 1, splits: [] });
  });

  // Place every item and find the corridor point it plugs into.
  const placed = items.map((it) => {
    if (it.t === 'room') {
      const x1 = it.x1 * k + dx, x2 = it.x2 * k + dx, y1 = it.y1 * k + dy, y2 = it.y2 * k + dy;
      const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
      const sides = { top: [cx, y1], bottom: [cx, y2], left: [x1, cy], right: [x2, cy] };
      const inward = { top: [0, 1], bottom: [0, -1], left: [1, 0], right: [-1, 0] };
      let side = it.door;
      let door;
      if (it.doorAt) {
        door = P(it.doorAt[0], it.doorAt[1]);
        side = side || 'top';
      } else if (side) {
        door = sides[side];
      } else {
        let bestD = Infinity;
        Object.entries(sides).forEach(([sd, pt]) => {
          const n = nearest(pt, segs);
          if (n && n.d < bestD) { bestD = n.d; side = sd; door = pt; }
        });
      }
      const hall = nearest(door, segs);
      const off = Math.min(12, (side === 'top' || side === 'bottom' ? y2 - y1 : x2 - x1) / 2);
      const node = [door[0] + inward[side][0] * off, door[1] + inward[side][1] * off];
      return { it, x: cx, y: cy, width: x2 - x1, height: y2 - y1, door, node, hall };
    }
    const c = P(it.x, it.y);
    return { it, x: c[0], y: c[1], node: c, hall: nearest(c, segs) };
  });

  // Every point that has to exist on a corridor segment.
  placed.forEach((p) => p.hall && p.hall.seg.splits.push(p.hall.pt));
  segs.forEach((s) => {
    s.splits.push(s.a, s.b);
    verts.forEach((v) => {
      const r = project(v, s);
      if (r && r.d < 0.75) s.splits.push(v);
    });
  });

  const waypoints = {};
  const waypointEdges = [];
  const seen = new Set();
  segs.forEach((s) => {
    const sorted = s.splits.slice().sort((p, q) => dist(s.a, p) - dist(s.a, q));
    const keys = [];
    sorted.forEach((pt) => {
      const key = nid(pt);
      if (!waypoints[key]) waypoints[key] = { id: key, x: pt[0], y: pt[1] };
      if (keys[keys.length - 1] !== key) keys.push(key);
    });
    for (let i = 0; i < keys.length - 1; i++) {
      const pair = [keys[i], keys[i + 1]].sort().join('|') + (s.pwd ? 'p' : 'n') + (s.pwdOnly ? 'o' : '');
      if (seen.has(pair)) continue;
      seen.add(pair);
      waypointEdges.push([keys[i], keys[i + 1], s.pwd, s.curve, s.w, s.pwdOnly]);
    }
  });

  const rooms = [];
  const connectors = [];
  placed.forEach((p) => {
    const it = p.it;
    const connectsTo = p.hall ? nid(p.hall.pt) : null;
    if (it.t === 'room') {
      rooms.push({
        id: `${id}-${it.id}`, name: it.name, defaultName: it.name, code: it.code || '', defaultCode: it.code || '', cat: it.cat || categoryFor(it.name),
        x: p.x, y: p.y, width: p.width, height: p.height, nodeX: p.node[0], nodeY: p.node[1],
        doorX: p.door[0], doorY: p.door[1], connectsTo, kind: 'room',
      });
      return;
    }
    const entry = {
      id: `${id}-${it.id}`, name: it.name, defaultName: it.name, code: '', x: p.x, y: p.y, nodeX: p.x, nodeY: p.y,
      width: 32, height: 32, connectsTo, iconName: ICON_OF[it.t], hallX: p.hall ? p.hall.pt[0] : p.x,
      hallY: p.hall ? p.hall.pt[1] : p.y, icon: true, pinned: !!it.pinned, noStub: !!it.noStub,
    };
    if (ROOM_LIKE.has(it.t)) rooms.push({ ...entry, kind: 'room', cat: 'gray' });
    else connectors.push({ ...entry, kind: 'connector' });
  });

  const decorOut = decor.map((d) => {
    const c = P(d.x, d.y);
    const out = { ...d, x: c[0], y: c[1] };
    ['w', 'h', 'rx', 'ry', 'span', 'len'].forEach((key) => { if (d[key] !== undefined) out[key] = d[key] * k; });
    return out;
  });
  const labelsOut = labels.map((l) => {
    const c = P(l.x, l.y);
    return { text: l.text, x: c[0], y: c[1], small: !!l.small };
  });

  const floor = {
    id, label, hallWidth, waypoints: Object.values(waypoints), waypointEdges, rooms, connectors,
    decor: decorOut, labels: labelsOut, panZoom,
  };
  if (focus) {
    const inFocus = (e) => focus(e.y / k - dy / k, e.x / k - dx / k);
    floor.homeFocus = { rooms: rooms.filter(inFocus), connectors: connectors.filter(inFocus) };
  }
  return floor;
}

// ---------- Helpers for the HS complex + MTH / CTH on the Upper Ground ----------
const rnd = (n) => Math.round(n * 10) / 10;
// A drawing "frame": a separate page of the PDF placed onto the Upper Ground at the right spot.
// (ax, ay) is a point on that page, (ux, uy) is where it lands on the Upper Ground, s is a scale.
function frame(ax, ay, ux, uy, s = 1) {
  const p = (x, y) => [rnd(ux + (x - ax) * s), rnd(uy + (y - ay) * s)];
  return {
    p,
    pts: (a) => a.map(([x, y]) => p(x, y)),
    room: (id, name, code, x1, x2, y1, y2, o) => {
      const [a, b] = p(x1, y1);
      const [c, d] = p(x2, y2);
      return R(id, name, code, a, c, b, d, o);
    },
    c: (t, id, x, y, name, o) => { const [a, b] = p(x, y); return C(t, id, a, b, name, o); },
  };
}
// Points along a quarter-circle, so bends in the paths are smooth.
const arc = (cx, cy, r, a0, a1, n = 6) =>
  Array.from({ length: n + 1 }, (_, i) => {
    const a = ((a0 + ((a1 - a0) * i) / n) * Math.PI) / 180;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  });

// ===================== LOWER GROUND =====================
const lowerGround = buildFloor({
  id: 'lower-ground', label: 'Lower Ground (LG)', k: 1.3, hallWidth: 24,
  corridors: [
    { pts: [[394, 85], [194, 85], [194, 269], [500, 269]] },
    { pts: [[302, 616], [617, 616]] },
    { pts: [[490, 505], [490, 616]], pwd: false }, // stairs up to the HS Cafeteria (red)
    { pts: [[622, 505], [622, 595], [526, 595], [526, 616]] }, // ramp up (blue)
  ],
  items: [
    S('stairs-1', 250, 105), F('female-restroom', 214, 168, 'Building 2'),
    S('stairs-2', 285, 240), M('male-restroom', 316, 240, 'Building 1'), E(173, 261),
    R('housekeeper', 'Housekeeper’s Quarters', '', 303, 396, 92, 158),
    R('lrc-basement', 'Learning Resource Center Basement', '', 402, 521, 58, 158),
    R('dtac-storage', 'DTAC Storage Room', '', 232, 268, 207, 253),
    R('css-lab-1', 'CSS Laboratory 1', 'LSH 101', 335, 415, 207, 254),
    R('bkp-room-1', 'BKP Room 1', 'LSH 102', 420, 500, 207, 254),
    R('css-lab-2', 'CSS Laboratory 2', 'LSH 103', 505, 571, 207, 300, { door: 'left' }),
    F('female-restroom-food', 298, 613, 'Food Labs'), M('male-restroom-food', 625, 613, 'Food Labs'),
    C('S', 'cafe-stairs', 490, 509, 'Stairs'),
    C('RAMP', 'cafe-ramp', 622, 509, 'Ramp'),
    R('food-lab-2', 'Food Laboratory 2', '', 302, 458, 622, 682),
    R('food-lab-1', 'Food Laboratory 1', '', 465, 617, 622, 682),
  ],
  labels: [
    { text: 'HS Building 2', x: 354, y: 78 }, { text: 'HS Building 1', x: 349, y: 289 },
    { text: 'Below HS Cafeteria', x: 470, y: 720 },
  ],
  panZoom: true,
});

// ===================== UPPER GROUND =====================
// The Upper Ground holds the HS complex, and (further up and to the right) the walkway
// past the road and the oval to Mariano Trias Hall (MTH) and Candido Tirona Hall (CTH).
const path_ = frame(52, 706, 592, 419, 1); // "Pathways going to MTH/CTH" page
const mth = frame(554, 749, 1134, -261, 0.6); // Mariano Trias Hall page
const cth = frame(621, 749, 1063.2, -694.8, 0.6); // Candido Tirona Hall page
const mthWalk = [[436, 26], [436, 546], ...arc(461, 546, 25, 180, 90, 10), ...arc(528, 596, 25, 270, 360, 10)];
const pathWalk = [[52, 706], [459, 706], [459, 187], ...arc(478, 187, 19, 180, 270, 5), [594, 168], [594, 26]];

const upperGround = buildFloor({
  id: 'ground', label: 'Upper Ground (UG)', k: 2, hallWidth: 24, panZoom: true,
  corridors: [
    // HS Building 1 + 2 loop
    { pts: [[200, 84], [768, 84], [768, 314], [200, 314], [200, 84]] },
    { pts: [[542, 314], [542, 376]] },
    { pts: [[469, 376], [586, 376]] },
    { pts: [[586, 314], [586, 376]], pwd: false }, // red: steps
    { pts: [[586, 376], [586, 695]] },
    { pts: [[469, 465], [586, 465]], pwd: false }, // red: steps
    { pts: [[469, 314], [469, 607]] },
    { pts: [[353, 526], [469, 526]] }, // to the HS Chapel
    // hall along the cafeteria roof with two short stubs and the red stairs down
    { pts: [[285, 584], [453, 584], [469, 584]] },
    { pts: [[285, 577], [285, 605]] },
    { pts: [[453, 579], [453, 607]] },
    { pts: [[366, 584], [366, 610]], pwd: false },
    // Gate 2.5 -> road -> MTH/CTH
    { pts: [[586, 419], ...path_.pts(pathWalk).map(([x, y]) => [x, y])] },
    // Mariano Trias Hall: right-hand walkway along the rooms, the left walkway to CTH, and the links between them
    { pts: mth.pts([[554, 114], [554, 749]]) },
    { pts: mth.pts([...mthWalk, [554, 596]]), curve: true },
    { pts: mth.pts([[436, 47], [529, 47], ...arc(529, 72, 25, 270, 360, 4), [554, 114]]), pwd: false, w: 1.8, curve: true },
    { pts: mth.pts([[436, 141], [453, 141], ...arc(453, 131, 10, 90, 0, 3), [463, 125], ...arc(479, 125, 16, 180, 270, 4), [554, 109]]), w: 1.8, curve: true },
    // Candido Tirona Hall
    { pts: cth.pts([[420, 16], [420, 657]]) },
    { pts: cth.pts([[479, 16], [478.5, 650]]) },
    // the curved side path from the road: wheelchair users take it, everyone else walks straight in
    { pts: cth.pts([[478.5, 650], [478.5, 716], ...arc(495.5, 716, 17, 180, 90, 4), [621, 733]]), curve: true, pwdOnly: true },
    { pts: cth.pts([[420, 614], [479, 614]]) },
    { pts: cth.pts([[420, 327], [466, 327], ...arc(466, 340, 13, 270, 360, 3), [479, 346]]), pwd: false, curve: true },
    { pts: cth.pts([[420, 656], [478.5, 656.5]]) },
    // short cut at the bottom: walkers go up the hallway beside CTH 104/105 instead
    { pts: cth.pts([[478.5, 656.5], [621, 657]]), pwdOnly: true },
    { pts: cth.pts([[621, 657], [623, 657]]) },
    { pts: cth.pts([[479, 397], [623, 397]]) },
    { pts: cth.pts([[623, 334], [623, 657]]) },
    { pts: cth.pts([[621, 657], [621, 733]]), pwd: false },
    { pts: cth.pts([[621, 733], [621, 749]]) },
  ],
  items: [
    // Building 2 (top)
    S('stairs-lrc', 241, 105), M('malebath-ug2', 436, 104, 'Building 2'), S('stairs-4', 460, 104), S('stairs-5', 725, 107),
    R('lrc', 'Learning Resource Center UG', '', 254, 423, 90, 178),
    R('stock-room-2', 'Stock Room 2', '', 475, 513, 92, 146),
    R('lsh215', 'Junior High School Faculty Department', 'LSH 215', 513, 554, 92, 146, { cat: 'purple' }),
    R('lsh214', 'LSHF Faculty Department', 'LSH 214', 554, 594, 92, 146, { cat: 'purple' }),
    R('lsh213', 'ASET Faculty Department', 'LSH 213', 593, 633, 92, 146, { cat: 'purple' }),
    R('lsh212', 'Patriot’s Lounge / Sports Equipment Stock Room', 'LSH 212', 633, 673, 92, 146, { cat: 'purple' }),
    R('lsh211', 'Parent’s Association Office', 'LSH 211', 673, 714, 92, 146),
    R('hs-court', 'HS Court', '', 509, 750, 6, 70, { door: 'bottom' }),
    // Building 1 (bottom)
    S('stairs-1', 228, 291), M('malebath', 250, 291, 'Building 1'), E(171, 309),
    F('femalebath', 439, 287, 'Building 1'), S('stairs-2', 462, 287), S('stairs-3', 690, 288),
    R('lsh111', 'Registrar’s Office', 'LSH 111', 264, 304, 247, 300),
    R('lsh112', 'Principal’s Office & TESDA Office', 'LSH 112', 304, 345, 247, 300),
    R('lsh113', 'Associate Principal’s Office', 'LSH 113', 345, 385, 247, 300),
    R('lsh114', 'Academic Coordinator’s Office', 'LSH 114', 385, 425, 247, 300),
    R('lsh115', 'IT Server Room', 'LSH 115', 481, 516, 247, 301),
    R('lsh116', 'Computer Laboratory 1', 'LSH 116', 514, 554, 247, 301),
    R('lsh117', 'Computer Laboratory 2', 'LSH 117', 554, 594, 247, 301),
    R('lsh118', 'Student’s HIVE', 'LSH 118', 594, 634, 247, 301),
    R('lsh119', 'Global Classroom', 'LSH 119', 634, 674, 247, 301),
    R('stock-room-1', 'Stock Room 1', '', 705, 746, 245, 299),
    // Gate 2.5 and the right-hand column
    C('GATE', 'gate-2-5', 590, 416, 'Gate 2.5 (Entrance)', { pinned: true, noStub: true }), // the EN circle: where the gate path meets the corridor
    R('hs-clinic', 'HS Clinic', '', 505, 579, 381, 407, { door: 'right' }),
    R('prefect', 'SDFO Prefect', '', 505, 579, 409, 449, { door: 'right' }),
    R('bookstore', 'National Bookstore', '', 516, 579, 473, 515, { door: 'right' }),
    R('resilience', 'Office of Resilience and Sustainability', '', 516, 579, 518, 560, { door: 'right' }),
    R('animo-lounge', 'Animo Lounge', '', 516, 579, 563, 605, { door: 'right' }),
    R('swc', 'SWC Office', '', 516, 579, 607, 650, { door: 'right' }),
    R('conference-room', 'Conference Room', '', 516, 579, 652, 695, { door: 'right' }),
    // Chapel and cafeteria (1st floor)
    R('hs-chapel', 'HS Chapel', '', 253, 352, 462, 548, { door: 'right', doorAt: [352, 526] }),
    R('hs-cafeteria', 'HS Cafeteria', '', 259, 475, 610, 695, { doorAt: [453, 610], door: 'top' }),
    C('S', 'cafe-stairs-l', 272, 626, 'Stairs', { noStub: true }), F('cafe-femalebath', 272, 652, 'Cafeteria', { noStub: true }),
    C('S', 'cafe-stairs-r', 462, 626, 'Stairs', { noStub: true }), M('cafe-malebath', 462, 652, 'Cafeteria', { noStub: true }),
    C('S', 'cafe-stairs-down', 366, 596, 'Stairs', { noStub: true }),
    C('RAMP', 'cafe-ramp-down', 468, 590, 'Ramp', { noStub: true }), // on the straight path at the right of the cafeteria
    // ---- Mariano Trias Hall (MTH) ----
    mth.room('mth101', 'MTH 101', '', 562, 661, 73, 146, { door: 'left' }),
    mth.room('mth102', 'MTH 102', '', 562, 661, 146, 218, { door: 'left' }),
    mth.room('mth103', 'MTH 103', '', 562, 661, 218, 291, { door: 'left' }),
    mth.room('mth104', 'MTH 104', '', 562, 661, 291, 364, { door: 'left' }),
    mth.room('mth105', 'MTH 105', '', 562, 661, 364, 436, { door: 'left' }),
    mth.room('mth106', 'MTH 106', '', 562, 661, 436, 509, { door: 'left' }),
    mth.c('F', 'mth-femalebath', 577, 525, 'Female Bathroom (Mariano Trias Hall)'), mth.c('M', 'mth-malebath', 576, 559, 'Male Bathroom (Mariano Trias Hall)'),
    // ---- Candido Tirona Hall (CTH) ----
    ...[[115, 9, 66], [114, 66, 123], [113, 123, 181], [112, 181, 238], [111, 238, 295]]
      .map(([n, y1, y2]) => cth.room(`cth${n}`, `CTH ${n}`, '', 337, 415, y1, y2, { door: 'right' })),
    ...[[110, 366, 423], [109, 423, 480], [108, 480, 538], [107, 538, 595], [106, 595, 652]]
      .map(([n, y1, y2]) => cth.room(`cth${n}`, `CTH ${n}`, '', 337, 415, y1, y2, { door: 'right' })),
    ...[[101, 397, 460], [102, 460, 523], [103, 523, 587], [104, 587, 650], [105, 650, 713]]
      .map(([n, y1, y2]) => cth.room(`cth${n}`, `CTH ${n}`, '', 626, 712, y1, y2, { door: 'left' })),
    cth.room('hesm-faculty', 'HESM Faculty', '', 411, 472, 655, 700, { door: 'top', cat: 'purple' }),
    cth.c('S', 'cth-stairs-1', 403, 317, 'Stairs'), cth.c('F', 'cth-femalebath-1', 403, 343, 'Female Bathroom (Candido Tirona Hall, left)'),
    cth.c('F', 'cth-femalebath-2', 612, 340, 'Female Bathroom (Candido Tirona Hall, right)'), cth.c('M', 'cth-malebath', 611, 371, 'Male Bathroom (Candido Tirona Hall)'),
    cth.c('S', 'cth-stairs-2', 547, 376, 'Stairs'), cth.c('S', 'cth-stairs-3', 545, 675, 'Stairs'),
  ],
  decor: [
    { type: 'fountain', x: 398, y: 501, name: 'Fountain' },
    // the road that crosses the walkway, the one to MTH/CTH, and the oval
    { type: 'road', x: 919.5, y: 130, w: 77, h: 706, dir: 'v', name: 'Road' },
    { type: 'road', x: 1126, y: -167.5, w: 344, h: 27, dir: 'h', name: 'Road' },
    { type: 'oval', x: 1174, y: 157, rx: 143, ry: 250, name: 'University Oval' },
    { type: 'crosswalk', x: 919.5, y: 419, span: 77, len: 30, dir: 'ew' },
    { type: 'crosswalk', x: 1134, y: -167.5, span: 27, len: 30, dir: 'ns' },
  ],
  labels: [
    { text: 'HS Building 2', x: 438, y: 74 }, { text: 'HS Building 1', x: 429, y: 330 }, { text: 'Gate 2.5 (Entrance)', x: 680, y: 408 },
    { text: 'Mariano Trias Hall (MTH)', x: 1325, y: -640 }, { text: 'Candido Tirona Hall (CTH)', x: 1235, y: -820 },
  ],
});

// ===================== 2nd / 3rd / 4th FLOOR =====================
const floor2 = buildFloor({
  id: 'level-2', label: '2nd Floor', k: 2, hallWidth: 24, panZoom: true,
  corridors: [
    { pts: [[906, 34], [396, 34], [396, 276], [915, 276]] },
    { pts: [[901, 34], [901, 73]] },
    // HS Cafeteria 2nd floor: its own loop (green on the PDF = not wheelchair accessible), NOT joined to Building 1/2
    { pts: [[339, 502], [729, 502], [729, 744], [339, 744], [339, 502]], pwd: false },
  ],
  items: [
    S('stairs-b2-1', 439, 57), F('femalebath-b2', 644, 53, 'Building 2'), S('stairs-b2-2', 669, 53), S('stairs-b2-3', 866, 53),
    M('malebath-b2', 416, 154, 'Building 2'),
    S('stairs-b1-1', 434, 250), M('malebath-b1', 457, 250, 'Building 1'), S('stairs-b1-3', 859, 253),
    F('femalebath-b1', 645, 256, 'Building 1'), S('stairs-b1-2', 665, 256), E(365, 269),
    R('lsh229', 'TPS Lab 2 & TESDA Registrar and Processing Office & Audit Room', 'LSH 229', 452, 507, 45, 101),
    R('bkp-room-2', 'BKP Room 2', 'LSH 228', 507, 548, 45, 101),
    R('lsh227', 'LSH 227', '', 548, 588, 45, 101), R('lsh226', 'LSH 226', '', 588, 629, 45, 101),
    R('lsh225', 'LSH 225', '', 685, 727, 42, 98), R('lsh224', 'LSH 224', '', 727, 768, 42, 98),
    R('lsh223', 'LSH 223', '', 768, 809, 42, 98), R('lsh222', 'LSH 222', '', 809, 849, 42, 98),
    R('lsh221', 'LSH 221', '', 881, 921, 73, 127, { door: 'top' }),
    R('lsh121', 'LSH 121', '', 468, 510, 208, 264), R('lsh122', 'LSH 122', '', 510, 551, 208, 264),
    R('lsh123', 'LSH 123', '', 551, 591, 208, 264), R('lsh124', 'LSH 124', '', 591, 632, 208, 264),
    R('lsh125', 'LSH 125', '', 679, 721, 211, 267), R('lsh126', 'LSH 126', '', 721, 761, 211, 267),
    R('lsh127', 'LSH 127', '', 761, 802, 211, 267), R('lsh128', 'LSH 128', '', 802, 843, 211, 267),
    R('lsh129', 'Viridescent Office', 'LSH 129', 875, 915, 212, 266),
    // HS Cafeteria 2nd floor
    R('hs-cafeteria-2f', 'HS Cafeteria (2nd Floor)', '', 347, 721, 510, 737, { door: 'top' }),
    C('S', 'cafe-stairs-l', 325, 500, 'Stairs'), F('cafe-femalebath', 325, 522, 'Cafeteria 2nd floor'),
    C('S', 'cafe-stairs-r', 738, 502, 'Stairs'), M('cafe-malebath', 739, 522, 'Cafeteria 2nd floor'),
    R('osl-space', 'OSL Space', '', 282, 337, 534, 751, { door: 'right' }),
    R('osl-lmo', 'Lasallian Mission Office & Student Life Office', '', 731, 811, 534, 648, { door: 'left' }),
    R('student-council', 'Student Council Office', '', 731, 811, 648, 743, { door: 'left' }),
  ],
  labels: [{ text: 'HS Building 2', x: 661, y: 26 }, { text: 'HS Building 1', x: 653, y: 294 }],
});

const floor3 = buildFloor({
  id: 'level-3', label: '3rd Floor', k: 1.25, hallWidth: 24,
  corridors: [
    { pts: [[989, 202], [160, 202], [160, 583], [983, 583]] },
    { pts: [[979, 202], [979, 256]] },
  ],
  items: [
    S('stairs-b2-1', 202, 239), S('stairs-b2-2', 573, 233), F('femalebath-b2', 613, 234, 'Building 2'), S('stairs-b2-3', 925, 229),
    M('malebath-b2', 190, 390, 'Building 2'),
    S('stairs-b1-1', 201, 538), M('malebath-b1', 236, 538, 'Building 1'), F('femalebath-b1', 553, 552, 'Building 1'),
    S('stairs-b1-2', 584, 552), S('stairs-b1-3', 891, 548), E(111, 572),
    R('stock-room-4', 'Stock Room 4', '', 236, 292, 217, 305), R('lsh239', 'LSH 239', '', 292, 359, 217, 305),
    R('lsh238', 'LSH 238', '', 359, 423, 217, 305), R('lsh237', 'LSH 237', '', 423, 487, 217, 305), R('lsh236', 'LSH 236', '', 487, 551, 217, 305),
    R('lsh235', 'LSH 235', '', 640, 707, 212, 300), R('lsh234', 'LSH 234', '', 707, 771, 212, 300),
    R('lsh233', 'LSH 233', '', 771, 835, 212, 300), R('lsh232', 'LSH 232', '', 835, 899, 212, 300),
    R('lsh231', 'LSH 231', '', 946, 1010, 256, 344, { door: 'top' }),
    R('lsh131', 'LSH 131', '', 273, 339, 476, 565), R('lsh132', 'LSH 132', '', 339, 403, 476, 565),
    R('lsh133', 'LSH 133', '', 403, 468, 476, 565), R('lsh134', 'LSH 134', '', 468, 532, 476, 565),
    R('lsh135', 'LSH 135', '', 606, 672, 480, 569), R('lsh136', 'LSH 136', '', 672, 736, 480, 569),
    R('lsh137', 'LSH 137', '', 736, 801, 480, 569), R('lsh138', 'LSH 138', '', 801, 865, 480, 569),
    R('lsh139', 'COMELEC Office', 'LSH 139', 916, 983, 482, 568),
  ],
  labels: [{ text: 'HS Building 2', x: 565, y: 185 }, { text: 'HS Building 1', x: 553, y: 608 }],
});

const floor4 = buildFloor({
  id: 'level-4', label: '4th Floor', k: 1.25, hallWidth: 24,
  corridors: [
    { pts: [[970, 201], [125, 201], [125, 585], [1007, 585]] },
    { pts: [[961, 201], [961, 244]] },
  ],
  items: [
    S('stairs-b2-1', 185, 238), F('femalebath-b2', 550, 233, 'Building 2'), S('stairs-b2-2', 588, 233), S('stairs-b2-3', 901, 233),
    M('malebath-b2', 149, 393, 'Building 2'),
    S('stairs-b1-1', 178, 543), M('malebath-b1', 214, 543, 'Building 1'), F('femalebath-b1', 552, 553, 'Building 1'),
    S('stairs-b1-2', 582, 553), S('stairs-b1-3', 891, 550), E(70, 575),
    R('stock-room-5', 'Stock Room 5', '', 211, 265, 220, 307),
    R('scilab4', 'Science Lab 4', 'LSH 248 - 249', 265, 359, 220, 307),
    R('scilab3', 'Science Lab 3', 'LSH 247 - 248', 359, 448, 220, 307),
    R('lsh246', 'Robotics Laboratory', 'LSH 246', 448, 513, 220, 307),
    R('mmh', 'Mutien Marie Hall (MMH)', '', 619, 874, 215, 301),
    R('vip-room', 'VIP Room', '', 931, 992, 246, 316, { door: 'top' }),
    R('scilab1', 'Science Laboratory 1', '', 243, 355, 478, 565), R('scilab2', 'Science Laboratory 2', '', 357, 464, 478, 565),
    R('scistock', 'Science Laboratory Stockroom', '', 466, 529, 478, 565),
    R('lsh145', 'LSH 145', '', 605, 670, 482, 569), R('lsh146', 'LSH 146', '', 672, 735, 482, 569),
    R('lsh147', 'LSH 147', '', 737, 800, 482, 569), R('lsh148', 'LSH 148', '', 801, 863, 482, 569),
    R('lsh149', 'La Estrella Verde Office', 'LSH 149', 917, 1007, 484, 568),
  ],
  labels: [{ text: 'HS Building 2', x: 565, y: 185 }, { text: 'HS Building 1', x: 553, y: 608 }],
});

// ---------- Upper Ground "zones" ----------
// The Upper Ground is huge, so a route there is shown one zone at a time (like floors):
// the HS complex, the walkway out to the road, Mariano Trias Hall, then Candido Tirona Hall.
export const GROUND_ZONES = {
  hs: 'HS Complex',
  path: 'Pathway to MTH & CTH',
  mth: 'Mariano Trias Hall (MTH)',
  cth: 'Candido Tirona Hall (CTH)',
};
export function groundZoneOf(x, y) {
  if (y > -530) {
    if (y < 700) return x < 1700 ? 'hs' : 'path';
    return x > 1175 || (Math.abs(x - 1172) < 2 && Math.abs(y - 838) < 2) ? 'path' : 'hs'; // the Gate 2.5 junction starts the walkway
  }
  if (y > -1395) return 'mth';
  return 'cth';
}

export const floors = {
  'lower-ground': lowerGround,
  ground: upperGround,
  'level-2': floor2,
  'level-3': floor3,
  'level-4': floor4,
};

export const floorLevels = [
  { id: 'lower-ground', label: 'Lower Ground (LG)' },
  { id: 'ground', label: 'Upper Ground (UG)' },
  { id: 'level-2', label: '2nd Floor' },
  { id: 'level-3', label: '3rd Floor' },
  { id: 'level-4', label: '4th Floor' },
];

// ---------- Vertical links between floors ----------
// Each chain lists the same stairwell on successive floors.
const STAIR_CHAINS = [
  ['lower-ground-stairs-1', 'ground-stairs-lrc', 'level-2-stairs-b2-1', 'level-3-stairs-b2-1', 'level-4-stairs-b2-1'],
  ['lower-ground-stairs-2', 'ground-stairs-1', 'level-2-stairs-b1-1', 'level-3-stairs-b1-1', 'level-4-stairs-b1-1'],
  ['ground-stairs-2', 'level-2-stairs-b1-2', 'level-3-stairs-b1-2', 'level-4-stairs-b1-2'],
  ['ground-stairs-3', 'level-2-stairs-b1-3', 'level-3-stairs-b1-3', 'level-4-stairs-b1-3'],
  ['ground-stairs-4', 'level-2-stairs-b2-2', 'level-3-stairs-b2-2', 'level-4-stairs-b2-2'],
  ['ground-stairs-5', 'level-2-stairs-b2-3', 'level-3-stairs-b2-3', 'level-4-stairs-b2-3'],
  // HS Cafeteria: its own stairs, separate from Building 1/2
  ['lower-ground-cafe-stairs', 'ground-cafe-stairs-down'],
  ['ground-cafe-stairs-l', 'level-2-cafe-stairs-l'],
  ['ground-cafe-stairs-r', 'level-2-cafe-stairs-r'],
];
const ELEVATOR_CHAIN = ['lower-ground-elevator', 'ground-elevator', 'level-2-elevator', 'level-3-elevator', 'level-4-elevator'];
const RAMP_CHAINS = [['lower-ground-cafe-ramp', 'ground-cafe-ramp-down']];

const euclidean = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function buildFloorGraph(floor) {
  const nodes = {};
  const edges = {};
  const nodeFloor = {};

  const addNode = (id, x, y) => { nodes[id] = { x, y }; nodeFloor[id] = floor.id; };
  const addEdge = (a, b, weight, pwd, pwdOnly) => {
    if (!nodes[a] || !nodes[b]) return;
    (edges[a] = edges[a] || []).push({ to: b, weight, pwd, pwdOnly });
    (edges[b] = edges[b] || []).push({ to: a, weight, pwd, pwdOnly });
  };

  floor.waypoints.forEach((wp) => addNode(wp.id, wp.x, wp.y));
  floor.waypointEdges.forEach(([a, b, pwd, , w, pwdOnly]) => addEdge(a, b, euclidean(nodes[a], nodes[b]) * (w || 1), pwd, pwdOnly));
  [...floor.rooms, ...floor.connectors].forEach((r) => {
    addNode(r.id, r.nodeX, r.nodeY);
    if (nodes[r.connectsTo]) addEdge(r.id, r.connectsTo, euclidean(nodes[r.id], nodes[r.connectsTo]), true);
  });
  return { nodes, edges, nodeFloor };
}

const CONNECTOR_WEIGHT = 150;

export function buildCampusGraph() {
  const combined = { nodes: {}, edges: {}, nodeFloor: {} };
  Object.values(floors).forEach((floor) => {
    const g = buildFloorGraph(floor);
    Object.assign(combined.nodes, g.nodes);
    Object.assign(combined.nodeFloor, g.nodeFloor);
    for (const id in g.edges) combined.edges[id] = (combined.edges[id] || []).concat(g.edges[id]);
  });

  function chainLink(chain, kind, pwd) {
    for (let i = 0; i < chain.length - 1; i++) {
      const a = chain[i];
      const b = chain[i + 1];
      if (!combined.nodes[a] || !combined.nodes[b]) continue;
      (combined.edges[a] = combined.edges[a] || []).push({ to: b, weight: CONNECTOR_WEIGHT, kind, pwd });
      (combined.edges[b] = combined.edges[b] || []).push({ to: a, weight: CONNECTOR_WEIGHT, kind, pwd });
    }
  }
  STAIR_CHAINS.forEach((c) => chainLink(c, 'stairs', false)); // stairs are never PWD accessible
  chainLink(ELEVATOR_CHAIN, 'elevator', true);
  RAMP_CHAINS.forEach((c) => chainLink(c, 'ramp', true));
  return combined;
}

// ---------- Legends (colour groups) ----------
// The six built-in legends keep their colours in CSS (class cat-<id>); legends the admin adds carry their own hex colour.
export const DEFAULT_LEGENDS = [
  { id: 'blue', label: 'CSS labs & TESDA' },
  { id: 'orange', label: 'Science, food & computer labs' },
  { id: 'yellow', label: 'Offices & services' },
  { id: 'green', label: 'Classrooms' },
  { id: 'purple', label: 'Faculty offices' },
  { id: 'gray', label: 'Other rooms' },
];
let customLegends = []; // [{ id, label, color }]

export function getLegends() {
  return [...DEFAULT_LEGENDS.map((l) => ({ ...l, custom: false })), ...customLegends.map((l) => ({ ...l, custom: true }))];
}

// "#rrggbb" -> the soft fill used inside a room
export function legendFill(hex) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, 0.16)`;
}

// The legend a room is really drawn with: the admin's choice if it still exists, otherwise its normal colour.
export function legendOf(room) {
  const custom = customLegends.find((l) => l.id === room.legendId);
  if (custom) return { id: custom.id, label: custom.label, color: custom.color, custom: true };
  const id = DEFAULT_LEGENDS.some((l) => l.id === room.legendId) ? room.legendId : room.cat || 'gray';
  const d = DEFAULT_LEGENDS.find((l) => l.id === id) || DEFAULT_LEGENDS[5];
  return { id: d.id, label: d.label, custom: false };
}

// ---------- Admin overrides (names, descriptions, colours and unavailable flags from the database) ----------
// overrides = { "<room id>": { name?, description?, unavailable?, legend? } }
export function applyOverrides(overrides = {}, legends = []) {
  customLegends = Array.isArray(legends)
    ? legends.filter((l) => l && /^c-[a-z0-9]+$/.test(l.id) && /^#[0-9a-f]{6}$/i.test(l.color)).map((l) => ({ id: l.id, label: String(l.label || ''), color: l.color }))
    : [];
  Object.values(floors).forEach((floor) => {
    floor.rooms.forEach((r) => {
      const o = overrides[r.id] || {};
      r.name = typeof o.name === 'string' && o.name.trim() ? o.name.trim() : r.defaultName;
      // description empty -> fall back to the room number
      r.code = typeof o.description === 'string' && o.description.trim() ? o.description.trim() : r.defaultCode;
      r.unavailable = !!o.unavailable;
      r.legendId = typeof o.legend === 'string' && o.legend ? o.legend : null;
    });
  });
}

export function getAllRooms() {
  const all = [];
  Object.values(floors).forEach((floor) => {
    floor.rooms.forEach((r) => all.push({ ...r, floorId: floor.id, floorLabel: floor.label }));
  });
  return all;
}

export function getFloorsById() {
  return floors;
}