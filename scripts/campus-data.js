// =====================================================================
// CAMPUS DATA — rebuilt from the annotated PDF (2D_MAP_UPDATED_WITH_NODES).
//
// Each floor is now ONE unified layout (Building 1's row + Building 2's
// row + one shared perimeter hallway) rather than two separate
// buildings joined by a bridge - that's what your PDF actually shows.
//
// Confidence notes:
//  - Room codes for LG, UG, 2nd, 3rd, 4th all come straight off your
//    PDF and should be accurate.
//  - Exact stairwell-to-stairwell alignment between floors is my best
//    reading of the diagrams, not guaranteed pixel-perfect - if a
//    route takes the "wrong" stairs, that's the easiest thing to flag.
//  - HS Court / Chapel / Cafeteria / Clinic / Prefect / Animo Lounge /
//    unnamed rooms are folded into Upper Ground, matching how your
//    PDF draws them on that same page connected by the same red path.
// =====================================================================

const UNIT = 90;
const GAP = 8;
const ROW_HEIGHT = 130;

// Lays out a row of cells (rooms or connectors) left to right.
// cells: [{ id, name, code, span }] - span 1/2/4 controls width.
function layoutRow(cells, startX, y) {
  const positioned = [];
  let cursor = startX;
  cells.forEach((cell) => {
    const span = cell.span || 1;
    const width = span * UNIT + (span - 1) * GAP;
    const centerX = cursor + width / 2;
    positioned.push({ ...cell, x: centerX, y, width, height: ROW_HEIGHT });
    cursor += width + GAP;
  });
  return { positioned, endX: cursor - GAP };
}

// A "room" object as used everywhere else in the app
function room(id, name, code, span) {
  return { id, name, code: code || '', span: span || 1, kind: 'room' };
}
// A "connector" object (stairs / elevator) - same shape, tagged so we
// know not to treat it as a searchable destination room.
function connector(id, name, span) {
  return { id, name, code: '', span: span || 1, kind: 'connector' };
}

// ---- Builds a floor from a top row and bottom row of cells, joined
// by a hallway strip above the top row, a hallway strip below the
// bottom row, and a connector down the left side (matching the red
// path in the PDF, which runs along the outside and down near the
// elevator) ----
function makeTwoRowFloor({ id, label, topCells, bottomCells }) {
  const topHallwayY = 40;
  const bottomHallwayY = topHallwayY + ROW_HEIGHT + 260 + ROW_HEIGHT;
  const topRowY = topHallwayY + 70;
  const bottomRowY = bottomHallwayY - 70;

  const top = layoutRow(topCells, 60, topRowY);
  const bottom = layoutRow(bottomCells, 60, bottomRowY);

  const waypoints = [];
  const waypointEdges = [];

  top.positioned.forEach((cell, i) => {
    const wpId = `${id}-top-w${i}`;
    waypoints.push({ id: wpId, x: cell.x, y: topHallwayY });
    if (i > 0) waypointEdges.push([`${id}-top-w${i - 1}`, wpId]);
  });
  bottom.positioned.forEach((cell, i) => {
    const wpId = `${id}-bottom-w${i}`;
    waypoints.push({ id: wpId, x: cell.x, y: bottomHallwayY });
    if (i > 0) waypointEdges.push([`${id}-bottom-w${i - 1}`, wpId]);
  });

  // Left-side connector linking the two hallways (this is the descending
  // segment of red dotted line next to the elevator in the PDF)
  waypointEdges.push([`${id}-top-w0`, `${id}-bottom-w0`]);

  const rooms = [];
  const connectors = [];

  top.positioned.forEach((cell, i) => {
    const entry = { id: `${id}-${cell.id}`, name: cell.name, code: cell.code, x: cell.x, y: cell.y, width: cell.width, height: cell.height, connectsTo: `${id}-top-w${i}` };
    (cell.kind === 'connector' ? connectors : rooms).push(entry);
  });
  bottom.positioned.forEach((cell, i) => {
    const entry = { id: `${id}-${cell.id}`, name: cell.name, code: cell.code, x: cell.x, y: cell.y, width: cell.width, height: cell.height, connectsTo: `${id}-bottom-w${i}` };
    (cell.kind === 'connector' ? connectors : rooms).push(entry);
  });

  // Elevator - a single point near the bottom-left, matching the PDF
  const elevatorId = `${id}-elevator`;
  connectors.push({
    id: elevatorId, name: 'Elevator', code: '', x: 0, y: bottomRowY + 40,
    width: 60, height: 60, connectsTo: `${id}-bottom-w0`,
  });

  return {
    id, label, waypoints, waypointEdges, rooms, connectors,
    bounds: { width: Math.max(top.endX, bottom.endX) + 60, height: bottomHallwayY + 80 },
  };
}

// ---- 2nd, 3rd, and 4th floor share a similar shape, but each floor's
// room list is written out explicitly rather than sliced from a
// generic pattern - the 4th floor has a different room count (Science
// Labs and Mutien Marie Hall take up different amounts of space than
// a run of numbered classrooms), so forcing it through the same slicing
// logic as 2nd/3rd was a bug in an earlier draft of this file. ----

const floor2 = makeTwoRowFloor({
  id: 'level-2', label: '2nd Floor',
  bottomCells: [
    connector('malebath-b1', 'Male Bathroom (2nd floor)'),
    connector('stairs-b1-1', 'Stairs'),
    room('lsh121', 'LSH 121'), room('lsh122', 'LSH 122'),
    room('lsh123', 'LSH 123'), room('lsh124', 'LSH 124'),
    connector('femalebath-b1', 'Female Bathroom (2nd floor)'),
    connector('stairs-b1-2', 'Stairs'),
    room('lsh125', 'LSH 125'), room('lsh126', 'LSH 126'), room('lsh127', 'LSH 127'),
    room('lsh128', 'LSH 128', '', 2),
    connector('stairs-b1-3', 'Stairs'),
    room('lsh129', 'LSH 129'),
  ],
  topCells: [
    connector('malebath-b2', 'Male Bathroom (2nd floor)'),
    connector('stairs-b2-1', 'Stairs'),
    room('lsh228', 'LSH 228'), room('lsh227', 'LSH 227'),
    room('lsh226', 'LSH 226'), room('lsh225', 'LSH 225'),
    connector('stairs-b2-2', 'Stairs'),
    connector('femalebath-b2', 'Female Bathroom (2nd floor)'),
    room('lsh224', 'LSH 224'), room('lsh223', 'LSH 223'),
    room('lsh222', 'LSH 222', '', 2),
    room('lsh221', 'LSH 221'),
    connector('stairs-b2-3', 'Stairs'),
    room('unnamed-4', 'Unnamed Room 4'),
  ],
});

const floor3 = makeTwoRowFloor({
  id: 'level-3', label: '3rd Floor',
  bottomCells: [
    connector('malebath-b1', 'Male Bathroom (3rd floor)'),
    connector('stairs-b1-1', 'Stairs'),
    room('lsh131', 'LSH 131'), room('lsh132', 'LSH 132'),
    room('lsh133', 'LSH 133'), room('lsh134', 'LSH 134'),
    connector('femalebath-b1', 'Female Bathroom (3rd floor)'),
    connector('stairs-b1-2', 'Stairs'),
    room('lsh135', 'LSH 135'), room('lsh136', 'LSH 136'), room('lsh137', 'LSH 137'),
    room('lsh138', 'LSH 138', '', 2),
    connector('stairs-b1-3', 'Stairs'),
    room('lsh139', 'LSH 139'),
  ],
  topCells: [
    connector('malebath-b2', 'Male Bathroom (3rd floor)'),
    connector('stairs-b2-1', 'Stairs'),
    room('lsh238', 'LSH 238'), room('lsh237', 'LSH 237'),
    room('lsh236', 'LSH 236'), room('lsh235', 'LSH 235'),
    connector('stairs-b2-2', 'Stairs'),
    connector('femalebath-b2', 'Female Bathroom (3rd floor)'),
    room('lsh234', 'LSH 234'), room('lsh233', 'LSH 233'),
    room('lsh232', 'LSH 232', '', 2),
    room('lsh231', 'LSH 231'),
    connector('stairs-b2-3', 'Stairs'),
    room('unnamed-5', 'Unnamed Room 5'),
  ],
});

const floor4 = makeTwoRowFloor({
  id: 'level-4', label: '4th Floor',
  bottomCells: [
    connector('malebath-b1', 'Male Bathroom (4th floor)'),
    connector('stairs-b1-1', 'Stairs'),
    room('scilab1', 'Science Laboratory 1'),
    room('scilab2', 'Science Laboratory 2'),
    room('scistock', 'Science Lab Stock Room'),
    connector('femalebath-b1', 'Female Bathroom (4th floor)'),
    connector('stairs-b1-2', 'Stairs'),
    room('lsh145', 'LSH 145'), room('lsh146', 'LSH 146'), room('lsh147', 'LSH 147'),
    room('lsh148', 'LSH 148', '', 2),
    connector('stairs-b1-3', 'Stairs'),
    room('lsh149', 'LSH 149'),
  ],
  topCells: [
    connector('malebath-b2', 'Male Bathroom (4th floor)'),
    connector('stairs-b2-1', 'Stairs'),
    room('scilab4', 'Science Laboratory 4'),
    room('scilab3', 'Science Laboratory 3'),
    room('lsh246', 'LSH 246'),
    connector('stairs-b2-2', 'Stairs'),
    connector('femalebath-b2', 'Female Bathroom (4th floor)'),
    room('mmh', 'Mutien Marie Hall (MMH)', '', 4),
    connector('stairs-b2-3', 'Stairs'),
    room('unnamed-6', 'Unnamed Room 6'),
  ],
});

// ---- Lower Ground (LG) - irregular shape, hand-placed ----
const lowerGround = (() => {
  const id = 'lower-ground';
  const waypoints = [
    { id: `${id}-w0`, x: 150, y: 130 },
    { id: `${id}-w1`, x: 420, y: 130 },
    { id: `${id}-w2`, x: 680, y: 130 },
    { id: `${id}-w3`, x: 150, y: 300 },
    { id: `${id}-w4`, x: 150, y: 470 },
    { id: `${id}-w5`, x: 330, y: 470 },
    { id: `${id}-w6`, x: 490, y: 470 },
    { id: `${id}-w7`, x: 650, y: 470 },
  ];
  const waypointEdges = [
    [`${id}-w0`, `${id}-w1`], [`${id}-w1`, `${id}-w2`],
    [`${id}-w0`, `${id}-w3`], [`${id}-w3`, `${id}-w4`],
    [`${id}-w4`, `${id}-w5`], [`${id}-w5`, `${id}-w6`], [`${id}-w6`, `${id}-w7`],
  ];
  const rooms = [
    { id: `${id}-lrc-basement`, name: 'Learning Resource Center Basement', code: '', x: 680, y: 90, width: 320, height: 140, connectsTo: `${id}-w2` },
    { id: `${id}-css-lab-1`, name: 'CSS Laboratory 1', code: '', x: 330, y: 560, width: UNIT, height: ROW_HEIGHT, connectsTo: `${id}-w5` },
    { id: `${id}-css-lab-2`, name: 'CSS Laboratory 2', code: '', x: 490, y: 560, width: UNIT, height: ROW_HEIGHT, connectsTo: `${id}-w6` },
    { id: `${id}-css-lab-3`, name: 'CSS Laboratory 3', code: '', x: 650, y: 560, width: UNIT, height: ROW_HEIGHT, connectsTo: `${id}-w7` },
  ];
  const connectors = [
    { id: `${id}-stairs-1`, name: 'Stairs', x: 90, y: 90, width: 60, height: 60, connectsTo: `${id}-w0` },
    { id: `${id}-female-restroom`, name: 'Female Restroom (LG)', code: '', x: 90, y: 300, width: 60, height: 60, connectsTo: `${id}-w3`, isRoom: true },
    { id: `${id}-staff-room`, name: 'Staff Room / Storage', code: '', x: 420, y: 90, width: 100, height: 100, connectsTo: `${id}-w1`, isRoom: true },
    { id: `${id}-male-restroom`, name: 'Male Restroom (LG)', code: '', x: 90, y: 470, width: 60, height: 60, connectsTo: `${id}-w4`, isRoom: true },
    { id: `${id}-stairs-2`, name: 'Stairs', x: 90, y: 560, width: 60, height: 60, connectsTo: `${id}-w4` },
    { id: `${id}-elevator`, name: 'Elevator', x: 0, y: 560, width: 60, height: 60, connectsTo: `${id}-w4` },
  ];
  // Female/Male Restroom and Staff Room are real destinations, not
  // just connectors - move them into `rooms` so they're searchable.
  const realRoomIds = ['female-restroom', 'staff-room', 'male-restroom'];
  const trueConnectors = connectors.filter((c) => !realRoomIds.some((r) => c.id.endsWith(r)));
  const extraRooms = connectors.filter((c) => realRoomIds.some((r) => c.id.endsWith(r)));

  return {
    id, label: 'Lower Ground (LG)',
    waypoints, waypointEdges,
    rooms: [...rooms, ...extraRooms],
    connectors: trueConnectors,
    bounds: { width: 1050, height: 650 },
  };
})();

// ---- Upper Ground (UG) - the big, irregular one. Includes HS Court,
// Chapel, Cafeteria, Clinic, Prefect, Animo Lounge, and unnamed rooms,
// since your PDF draws these on the same page connected by the same
// red path. This is the floor the app zooms/pans instead of auto-fitting. ----
const upperGround = (() => {
  const id = 'ground';

  const bottomCells = [
    connector('malebath', 'Male Bathroom (UG)'),
    connector('stairs-1', 'Stairs'),
    room('lsh111', 'Registrar Office', 'LSH 111'),
    room('lsh112', 'TESDA Office', 'LSH 112'),
    room('lsh113', 'Associate Principal Office', 'LSH 113'),
    room('lsh114', 'Academic Administrators Office', 'LSH 114'),
    connector('femalebath', 'Female Bathroom (UG)'),
    connector('stairs-2', 'Stairs'),
    room('lsh115', 'Computer Laboratory 1', 'LSH 115'),
    room('lsh116', 'Computer Laboratory 2', 'LSH 116'),
    room('lsh117', 'Academic Coordinator Office', 'LSH 117'),
    room('lsh118', 'Sports Coordinator Office', 'LSH 118'),
    connector('stairs-3', 'Stairs'),
  ];

  const topCells = [
    connector('stairs-lrc', 'Stairs'),
    room('lrc', 'Learning Resource Center', 'LRC', 2),
    connector('malebath-ug2', 'Male Bathroom (UG2)'),
    connector('femalebath-ug2', 'Female Bathroom (UG2)'),
    connector('stairs-4', 'Stairs'),
    room('lsh215', 'LSH 215'),
    room('lsh214', 'LSH 214'),
    room('lsh213', 'LSH 213'),
    room('lsh212', 'LSH 212'),
    room('lsh211', 'LSH 211'),
    connector('stairs-5', 'Stairs'),
  ];

  const base = makeTwoRowFloor({ id, label: 'Upper Ground (UG)', topCells, bottomCells });

  // ---- Extra facilities below the main hallway, matching the red
  // path that continues down from the Building 1 side to the Chapel,
  // then across to the Clinic / Prefect / Animo Lounge cluster ----
  const dropWaypoint = `${id}-bottom-w5`; // near Academic Admin Office / Female Bathroom
  const facilityHallwayY = 560;

  const extraWaypoints = [
    { id: `${id}-fac-w0`, x: 260, y: facilityHallwayY },
    { id: `${id}-fac-w1`, x: 620, y: facilityHallwayY },
    { id: `${id}-fac-w2`, x: 900, y: facilityHallwayY },
  ];
  const extraEdges = [
    [dropWaypoint, `${id}-fac-w0`],
    [`${id}-fac-w0`, `${id}-fac-w1`],
    [`${id}-fac-w1`, `${id}-fac-w2`],
  ];

  const extraRooms = [
    { id: `${id}-hs-chapel`, name: 'HS Chapel', code: '', x: 260, y: 660, width: 260, height: 130, connectsTo: `${id}-fac-w0` },
    { id: `${id}-hs-cafeteria`, name: 'HS Cafeteria', code: '', x: 260, y: 820, width: 300, height: 130, connectsTo: `${id}-fac-w0` },
    { id: `${id}-hs-clinic`, name: 'HS Clinic', code: '', x: 620, y: 660, width: 180, height: 110, connectsTo: `${id}-fac-w1` },
    { id: `${id}-prefect`, name: 'Prefect', code: '', x: 900, y: 660, width: 120, height: 90, connectsTo: `${id}-fac-w2` },
    { id: `${id}-animo-lounge`, name: 'Animo Lounge', code: '', x: 900, y: 760, width: 120, height: 90, connectsTo: `${id}-fac-w2` },
    { id: `${id}-unnamed-1`, name: 'Unnamed Room 1', code: '', x: 900, y: 850, width: 120, height: 80, connectsTo: `${id}-fac-w2` },
    { id: `${id}-unnamed-2`, name: 'Unnamed Room 2', code: '', x: 1030, y: 760, width: 120, height: 80, connectsTo: `${id}-fac-w2` },
    { id: `${id}-unnamed-3`, name: 'Unnamed Room 3', code: '', x: 1030, y: 850, width: 120, height: 80, connectsTo: `${id}-fac-w2` },
    { id: `${id}-hs-court`, name: 'HS Court', code: '', x: 500, y: -140, width: 700, height: 160, connectsTo: `${id}-top-w1` },
  ];

  return {
    ...base,
    waypoints: [...base.waypoints, ...extraWaypoints],
    waypointEdges: [...base.waypointEdges, ...extraEdges],
    rooms: [...base.rooms, ...extraRooms],
    bounds: { width: 1250, height: 1000 },
    panZoom: true,
  };
})();

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

// Stairs are matched between adjacent floors by position (1st stairs
// on one floor links to the 1st stairs on the next, etc). Given how
// many stairwells exist per floor, treat this as a best-effort
// approximation rather than a guaranteed exact physical match.
const STAIR_CHAINS = [
  ['lower-ground-stairs-1', 'ground-stairs-lrc', 'level-2-stairs-b2-1', 'level-3-stairs-b2-1', 'level-4-stairs-b2-1'],
  ['lower-ground-stairs-2', 'ground-stairs-1', 'level-2-stairs-b1-1', 'level-3-stairs-b1-1', 'level-4-stairs-b1-1'],
  ['ground-stairs-2', 'level-2-stairs-b1-2', 'level-3-stairs-b1-2', 'level-4-stairs-b1-2'],
  ['ground-stairs-3', 'level-2-stairs-b1-3', 'level-3-stairs-b1-3', 'level-4-stairs-b1-3'],
  ['ground-stairs-4', 'level-2-stairs-b2-2', 'level-3-stairs-b2-2', 'level-4-stairs-b2-2'],
  ['ground-stairs-5', 'level-2-stairs-b2-3', 'level-3-stairs-b2-3', 'level-4-stairs-b2-3'],
];
const ELEVATOR_CHAIN = ['lower-ground-elevator', 'ground-elevator', 'level-2-elevator', 'level-3-elevator', 'level-4-elevator'];

function euclidean(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function buildFloorGraph(floor) {
  const nodes = {};
  const edges = {};
  const nodeFloor = {};

  function addNode(id, x, y) {
    nodes[id] = { x, y };
    nodeFloor[id] = floor.id;
  }
  function addEdge(a, b, weight) {
    if (!nodes[a] || !nodes[b]) return;
    edges[a] = edges[a] || [];
    edges[b] = edges[b] || [];
    edges[a].push({ to: b, weight });
    edges[b].push({ to: a, weight });
  }

  floor.waypoints.forEach((wp) => addNode(wp.id, wp.x, wp.y));
  floor.waypointEdges.forEach(([a, b]) => addEdge(a, b, euclidean(nodes[a] || { x: 0, y: 0 }, nodes[b] || { x: 0, y: 0 })));

  floor.rooms.forEach((r) => {
    addNode(r.id, r.x, r.y);
    if (nodes[r.connectsTo]) addEdge(r.id, r.connectsTo, euclidean(nodes[r.id], nodes[r.connectsTo]));
  });
  (floor.connectors || []).forEach((c) => {
    addNode(c.id, c.x, c.y);
    if (nodes[c.connectsTo]) addEdge(c.id, c.connectsTo, euclidean(nodes[c.id], nodes[c.connectsTo]));
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
    for (const id in g.edges) {
      combined.edges[id] = (combined.edges[id] || []).concat(g.edges[id]);
    }
  });

  function chainLink(chain) {
    for (let i = 0; i < chain.length - 1; i++) {
      const a = chain[i];
      const b = chain[i + 1];
      if (!combined.nodes[a] || !combined.nodes[b]) continue;
      combined.edges[a] = combined.edges[a] || [];
      combined.edges[b] = combined.edges[b] || [];
      combined.edges[a].push({ to: b, weight: CONNECTOR_WEIGHT });
      combined.edges[b].push({ to: a, weight: CONNECTOR_WEIGHT });
    }
  }

  STAIR_CHAINS.forEach(chainLink);
  chainLink(ELEVATOR_CHAIN);

  return combined;
}

export function getAllRooms() {
  const all = [];
  Object.values(floors).forEach((floor) => {
    floor.rooms.forEach((r) => {
      all.push({ ...r, floorId: floor.id, floorLabel: floor.label });
    });
  });
  return all;
}

export function getFloorsById() {
  return floors;
}