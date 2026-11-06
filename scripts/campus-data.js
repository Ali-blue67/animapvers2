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
const CAT_BLUE = /css lab|tesda/i;
const CAT_ORANGE = /food lab|science laboratory \d|computer laboratory/i;
const CAT_YELLOW =
  /registrar|principal|coordinator|student life|lmo|student council|viridescent|comelec|lev office|resilience|animo|swc|conference|prefect|clinic/i;
const CAT_PURPLE = /^LSH 21[2-5]$/; // faculty offices
const NOT_CLASSROOM = ['221', '231', '241']; // small rooms the brief leaves out
export function categoryFor(name) {
  if (CAT_BLUE.test(name)) return 'blue';
  if (CAT_ORANGE.test(name)) return 'orange';
  if (CAT_PURPLE.test(name)) return 'purple';
  if (CAT_YELLOW.test(name)) return 'yellow';
  const m = /^LSH (\d{3})$/.exec(name);
  if (m && !NOT_CLASSROOM.includes(m[1])) return 'green';
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
    for (let i = 0; i < pts.length - 1; i++) segs.push({ a: pts[i], b: pts[i + 1], pwd: c.pwd !== false, splits: [] });
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
      const pair = [keys[i], keys[i + 1]].sort().join('|') + (s.pwd ? 'p' : 'n');
      if (seen.has(pair)) continue;
      seen.add(pair);
      waypointEdges.push([keys[i], keys[i + 1], s.pwd]);
    }
  });

  const rooms = [];
  const connectors = [];
  placed.forEach((p) => {
    const it = p.it;
    const connectsTo = p.hall ? nid(p.hall.pt) : null;
    if (it.t === 'room') {
      rooms.push({
        id: `${id}-${it.id}`, name: it.name, defaultName: it.name, code: it.code || '', defaultCode: it.code || '', cat: categoryFor(it.name),
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
    return { type: d.type, x: c[0], y: c[1], name: d.name };
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

// ===================== LOWER GROUND =====================
const FY = (y) => y - 60; // Food Labs sit well below the CSS labs, like the cafeteria below Building 1 on the UG
const lowerGround = buildFloor({
  id: 'lower-ground', label: 'Lower Ground (LG)', hallWidth: 24,
  corridors: [
    { pts: [[502, 103], [211, 103], [211, 303], [482, 303]] },
    { pts: [[340, FY(684)], [680, FY(684)]] },
    { pts: [[537, FY(568)], [537, FY(684)]], pwd: false }, // stairs up (red)
    { pts: [[675, FY(568)], [675, FY(661)], [576, FY(661)], [576, FY(684)]] }, // ramp (blue)
  ],
  items: [
    S('stairs-1', 252, 126), F('female-restroom', 232, 195, 'Building 2'),
    S('stairs-2', 247, 277), M('male-restroom', 281, 277, 'Building 1'), E(187, 297),
    R('staff-room', 'Staff Room / Storage', '', 377, 428, 112, 182),
    R('lrc-basement', 'Learning Resource Center Basement', '', 439, 565, 112, 182),
    R('css-lab-1', 'CSS Laboratory 1', '', 302, 387, 243, 291),
    R('css-lab-2', 'CSS Laboratory 2', '', 395, 480, 243, 291),
    R('css-lab-3', 'CSS Laboratory 3', '', 487, 556, 243, 340, { door: 'left' }),
    F('female-restroom-food', 336, FY(681), 'Food Labs'), M('male-restroom-food', 679, FY(681), 'Food Labs'),
    C('S', 'cafe-stairs', 537, FY(568), 'Stairs'),
    C('RAMP', 'cafe-ramp', 675, FY(568), 'Ramp'),
    R('food-lab-2', 'Food Lab 2', '', 340, 503, FY(692), FY(753)),
    R('food-lab-1', 'Food Lab 1', '', 511, 670, FY(692), FY(753)),
  ],
  labels: [
    { text: 'HS Building 2', x: 309, y: 78 }, { text: 'HS Building 1', x: 346, y: 340 },
    { text: 'Below HS Cafeteria', x: 520, y: FY(790) },
  ],
  panZoom: true,
});

// ===================== UPPER GROUND =====================
const upperGround = buildFloor({
  id: 'ground', label: 'Upper Ground (UG)', k: 1.6, hallWidth: 30, panZoom: true,
  corridors: [
    { pts: [[218, 103], [758, 103], [758, 352], [218, 352], [218, 103]] },
    { pts: [[510, 352], [510, 668]] },
    { pts: [[384, 583], [510, 583]] }, // to the HS Chapel
    { pts: [[311, 668], [510, 668]] }, // hallway hugging the cafeteria roof
    { pts: [[311, 668], [311, 678]] }, // short stub toward the roof (left end)
    { pts: [[488, 668], [488, 678]] }, // short stub toward the roof (right end)
    { pts: [[398, 668], [398, 686]], pwd: false }, // stairs down to the Food Labs (red)
    { pts: [[637, 352], [637, 417]], pwd: false }, // red: steps
    { pts: [[588, 352], [588, 417], [637, 417]] }, // blue: ramp
    { pts: [[637, 417], [637, 767]] },
    { pts: [[510, 517], [637, 517]], pwd: false }, // red: steps
    { pts: [[637, 467], [760, 467]] }, // Gate 2.5
  ],
  items: [
    // Building 2 (top)
    S('stairs-lrc', 262, 119), M('malebath-ug2', 476, 119, 'Building 2'), S('stairs-4', 503, 119), S('stairs-5', 733, 119),
    R('lrc', 'Learning Resource Center', 'LRC', 287, 458, 112, 205),
    R('lsh215', 'LSH 215', '', 545, 587, 112, 170), R('lsh214', 'LSH 214', '', 589, 630, 112, 170),
    R('lsh213', 'LSH 213', '', 632, 673, 112, 170), R('lsh212', 'LSH 212', '', 675, 717, 112, 170),
    R('hs-court', 'HS Court', '', 553, 813, 18, 87, { door: 'bottom' }),
    // Building 1 (bottom)
    S('stairs-1', 257, 337), M('malebath', 281, 337, 'Building 1'), E(203, 352),
    F('femalebath', 486, 337, 'Building 1'), S('stairs-2', 511, 337), S('stairs-3', 733, 337),
    R('lsh111', 'Registrar Office', 'LSH 111', 297, 339, 279, 336), R('lsh112', 'TESDA Office', 'LSH 112', 341, 383, 279, 336),
    R('lsh113', 'Principal Office', 'LSH 113', 385, 427, 279, 336), R('lsh114', 'Academic Coordinator Office', 'LSH 114', 429, 470, 279, 336),
    R('lsh115', 'Computer Laboratory 1', 'LSH 115', 528, 570, 279, 336), R('lsh116', 'Computer Laboratory 2', 'LSH 116', 572, 614, 279, 336),
    R('lsh117', 'Students Hive', 'LSH 117', 616, 657, 279, 336), R('lsh118', 'Sports Coordinator Office', 'LSH 118', 659, 701, 279, 336),
    // Gate 2.5 and the right-hand column
    C('GATE', 'gate-2-5', 637, 467, 'Gate 2.5 (Entrance)', { pinned: true, noStub: true }), // the EN circle: where the gate path meets the corridor
    R('hs-clinic', 'HS Clinic', '', 550, 628, 426, 454, { door: 'right' }),
    R('prefect', 'SDFO Prefect', '', 550, 630, 456, 498, { door: 'right' }),
    R('bookstore', 'National Bookstore', '', 562, 628, 526, 571), R('resilience', 'Office of Resilience and Sustainability', '', 562, 628, 575, 621),
    R('animo-lounge', 'Animo Lounge', '', 562, 628, 625, 669), R('swc', 'SWC', '', 562, 628, 673, 718),
    R('conference-room', 'Conference Room', '', 562, 628, 721, 767),
    // Chapel and cafeteria (1st floor)
    R('hs-chapel', 'HS Chapel', '', 277, 382, 515, 606, { doorAt: [382, 583], door: 'right' }),
    R('hs-cafeteria', 'HS Cafeteria', '', 282, 515, 680, 767, { doorAt: [488, 680], door: 'top' }),
    C('S', 'cafe-stairs-l', 297, 695, 'Stairs', { noStub: true }), F('cafe-femalebath', 297, 718, 'Cafeteria', { noStub: true }),
    C('S', 'cafe-stairs-r', 500, 695, 'Stairs', { noStub: true }), M('cafe-malebath', 500, 718, 'Cafeteria', { noStub: true }),
    C('S', 'cafe-stairs-down', 398, 695, 'Stairs', { noStub: true }),
    C('RAMP', 'cafe-ramp-down', 510, 648, 'Ramp', { noStub: true }), // on the straight path at the right of the cafeteria
  ],
  decor: [{ type: 'fountain', x: 432, y: 555, name: 'Fountain' }],
  labels: [{ text: 'HS Building 2', x: 488, y: 88 }, { text: 'HS Building 1', x: 440, y: 388 }, { text: 'Gate 2.5 (Entrance)', x: 712, y: 452 }],
  focus: (y) => y > 90 && y < 380,
});

// ===================== 2nd / 3rd / 4th FLOOR =====================
const upperCorridors = [{ pts: [[1037, 230], [173, 230], [173, 645], [1037, 645]] }];
const upperCircles = () => [
  S('stairs-b2-1', 246, 254), F('femalebath-b2', 600, 254, 'Building 2'), S('stairs-b2-2', 642, 254),
  S('stairs-b2-3', 979, 254), M('malebath-b2', 197, 436, 'Building 2'),
  S('stairs-b1-1', 238, 621), M('malebath-b1', 277, 621, 'Building 1'), F('femalebath-b1', 600, 621, 'Building 1'),
  S('stairs-b1-2', 634, 621), S('stairs-b1-3', 967, 621), E(150, 634),
];
const T = [248, 342]; // top-row room height
const B = [530, 627]; // bottom-row room height
const lsh = (n, x1, x2, y) => R(`lsh${n}`, `LSH ${n}`, '', x1, x2, y[0], y[1]);
const upperLabels = [{ text: 'HS Building 2', x: 605, y: 212 }, { text: 'HS Building 1', x: 605, y: 692 }];

const CF = (y) => y + 190; // HS Cafeteria (2nd floor) sits well below Building 1 and 2
const floor2 = buildFloor({
  id: 'level-2', label: '2nd Floor', hallWidth: 24,
  corridors: [
    ...upperCorridors,
    // HS Cafeteria 2nd floor: its own loop, NOT joined to Building 1/2
    // one hallway along the roof of the cafeteria with two short stubs, like the UG
    { pts: [[300, CF(731)], [915, CF(731)]], pwd: false },
    { pts: [[420, CF(709)], [420, CF(731)]], pwd: false },
    { pts: [[765, CF(709)], [765, CF(731)]], pwd: false },
    { pts: [[915, CF(731)], [915, CF(1000)]], pwd: false }, // reaches the Student Council office
  ],
  items: [
    ...upperCircles(),
    R('unnamed-1', 'Unnamed Room 1', '', 291, 363, T[0], T[1]), lsh(228, 365, 432, T), lsh(227, 434, 502, T), lsh(226, 504, 571, T),
    lsh(225, 670, 740, T), lsh(224, 742, 810, T), lsh(223, 812, 880, T), lsh(222, 882, 950, T), R('lsh221', 'LSH 221', '', 1008, 1053, 244, 298),
    lsh(121, 298, 367, B), lsh(122, 370, 438, B), lsh(123, 440, 507, B), lsh(124, 509, 577, B),
    lsh(125, 659, 728, B), lsh(126, 732, 800, B), lsh(127, 802, 870, B), lsh(128, 872, 938, B),
    R('lsh129', 'Viridescent Office', 'LSH 129', 984, 1052, 537, 629),
    // HS Cafeteria 2nd floor: bigger, with the icons tucked inside the top corners and spaced apart
    R('hs-cafeteria-2f', 'HS Cafeteria (2nd Floor)', '', 372, 815, CF(742), CF(1050), { door: 'top' }),
    C('S', 'cafe-stairs-l', 398, CF(772), 'Stairs', { noStub: true }), F('cafe-femalebath', 398, CF(822), 'Cafeteria 2nd floor', { noStub: true }),
    C('S', 'cafe-stairs-r', 789, CF(772), 'Stairs', { noStub: true }), M('cafe-malebath', 789, CF(822), 'Cafeteria 2nd floor', { noStub: true }),
    R('osl-space', 'OSL Space', '', 307, 364, CF(759), CF(974), { door: 'top' }),
    R('osl-lmo', 'Office of Student Life / LMO Office', '', 825, 900, CF(742), CF(868), { door: 'top' }),
    R('student-council', 'HS Student Council Office', '', 825, 900, CF(872), CF(1000), { door: 'right' }),
  ],
  labels: [...upperLabels, { text: 'HS Cafeteria (2nd floor)', x: 594, y: CF(1074) }],
  panZoom: true,
  focus: (y) => y < 700, // opens on Building 1 and 2; pan down to reach the HS Cafeteria
});

const floor3 = buildFloor({
  id: 'level-3', label: '3rd Floor', hallWidth: 24, corridors: upperCorridors,
  items: [
    ...upperCircles(),
    R('unnamed-2', 'Unnamed Room 2', '', 291, 363, T[0], T[1]), lsh(238, 365, 432, T), lsh(237, 434, 502, T), lsh(236, 504, 571, T),
    lsh(235, 670, 740, T), lsh(234, 742, 810, T), lsh(233, 812, 880, T), lsh(232, 882, 950, T), R('lsh231', 'LSH 231', '', 1008, 1053, 244, 298),
    lsh(131, 298, 367, B), lsh(132, 370, 438, B), lsh(133, 440, 507, B), lsh(134, 509, 577, B),
    lsh(135, 659, 728, B), lsh(136, 732, 800, B), lsh(137, 802, 870, B), lsh(138, 872, 938, B),
    R('lsh139', 'COMELEC Office', 'LSH 139', 984, 1052, 537, 629),
  ],
  labels: upperLabels,
});

const floor4 = buildFloor({
  id: 'level-4', label: '4th Floor', hallWidth: 24, corridors: upperCorridors,
  items: [
    ...upperCircles(),
    R('scilab4', 'Science Laboratory 4', 'LSH 248', 293, 435, T[0], T[1]), R('scilab3', 'Science Laboratory 3', 'LSH 247', 437, 564, T[0], T[1]),
    lsh(246, 670, 740, T), R('mmh', 'Mutien Marie Hall (MMH)', '', 748, 949, T[0], T[1]), R('lsh241', 'LSH 241', '', 1008, 1053, 244, 298),
    R('scilab1', 'Science Laboratory 1', '', 298, 407, B[0], B[1]), R('scilab2', 'Science Laboratory 2', '', 409, 507, B[0], B[1]),
    R('scistock', 'Science Lab Stock Room', 'LSH 144', 509, 577, B[0], B[1]),
    lsh(145, 659, 728, B), lsh(146, 732, 800, B), lsh(147, 802, 870, B), lsh(148, 872, 938, B),
    R('lsh149', 'LEV Office', 'LSH 149', 984, 1052, 537, 629),
  ],
  labels: upperLabels,
});

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
  const addEdge = (a, b, weight, pwd) => {
    if (!nodes[a] || !nodes[b]) return;
    (edges[a] = edges[a] || []).push({ to: b, weight, pwd });
    (edges[b] = edges[b] || []).push({ to: a, weight, pwd });
  };

  floor.waypoints.forEach((wp) => addNode(wp.id, wp.x, wp.y));
  floor.waypointEdges.forEach(([a, b, pwd]) => addEdge(a, b, euclidean(nodes[a], nodes[b]), pwd));
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

// ---------- Admin overrides (names + unavailable flags from the database) ----------
// overrides = { "<room id>": { name?: string, description?: string, unavailable?: boolean } }
export function applyOverrides(overrides = {}) {
  Object.values(floors).forEach((floor) => {
    floor.rooms.forEach((r) => {
      const o = overrides[r.id] || {};
      r.name = typeof o.name === 'string' && o.name.trim() ? o.name.trim() : r.defaultName;
      // description empty -> fall back to the room number
      r.code = typeof o.description === 'string' && o.description.trim() ? o.description.trim() : r.defaultCode;
      r.unavailable = !!o.unavailable;
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