// Welcome-page preview: draws a real floor from the campus data and
// animates a real route across it, so the hero always matches the app.
import { buildCampusGraph, getFloorsById, getAllRooms, floorLevels } from './campus-data.js';
import { renderFloor, computeFloorBounds } from './floor-renderer.js';
import { findShortestPath } from './pathfinding.js';

const graph = buildCampusGraph();
const floor = getFloorsById()['level-2'];
const svg = document.getElementById('hero-plan');

renderFloor(svg, floor, graph);

const FROM = 'level-2-lsh124';
const TO = 'level-2-lsh226';
const path = findShortestPath(graph, FROM, TO);

if (path) {
  const line = svg.querySelector('#route-line');
  line.setAttribute('d', path.map((id, i) => `${i ? 'L' : 'M'} ${graph.nodes[id].x} ${graph.nodes[id].y}`).join(' '));
  line.setAttribute('pathLength', '1'); // lets the CSS draw animation work at any size

  const start = graph.nodes[FROM];
  const end = graph.nodes[TO];
  const startMarker = svg.querySelector('#start-marker');
  const endMarker = svg.querySelector('#end-marker');
  startMarker.setAttribute('cx', start.x);
  startMarker.setAttribute('cy', start.y);
  endMarker.setAttribute('cx', end.x);
  endMarker.setAttribute('cy', end.y);

  [FROM, TO].forEach((id) => {
    const room = svg.querySelector(`.room[data-room-id="${id}"]`);
    if (room) room.classList.add('highlight');
  });

  // Crop to the left part of the floor, where the route happens.
  const b = computeFloorBounds(floor);
  const width = Math.max(b.height * 1.125, start.x + 45 + 50 - b.x); // keep the start room fully in view
  svg.setAttribute('viewBox', `${b.x} ${b.y} ${width} ${b.height}`);
}

const meta = document.getElementById('hero-meta');
if (meta) {
  meta.textContent = `${floorLevels.length} levels and ${getAllRooms().length} searchable rooms`;
}