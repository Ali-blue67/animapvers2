// Pure pathfinding helpers - no DOM, so they can be reused (and tested) anywhere.

const defaultWeight = (edge) => edge.weight;

// Dijkstra from one start node. Returns distances/previous for every
// reachable node, so callers can read one distance or scan for the
// nearest of several candidates (used for "nearest restroom").
export function runDijkstra(graph, startId, edgeWeight = defaultWeight) {
  const distances = {};
  const previous = {};
  const unvisited = new Set(Object.keys(graph.nodes));

  unvisited.forEach((id) => {
    distances[id] = Infinity;
  });
  distances[startId] = 0;

  while (unvisited.size > 0) {
    let currentId = null;
    let smallest = Infinity;
    unvisited.forEach((id) => {
      if (distances[id] < smallest) {
        smallest = distances[id];
        currentId = id;
      }
    });

    if (currentId === null) break;
    unvisited.delete(currentId);

    (graph.edges[currentId] || []).forEach((edge) => {
      if (!unvisited.has(edge.to)) return;
      const next = distances[currentId] + edgeWeight(edge);
      if (next < distances[edge.to]) {
        distances[edge.to] = next;
        previous[edge.to] = currentId;
      }
    });
  }

  return { distances, previous };
}

export function reconstructPath(previous, startId, endId) {
  const path = [];
  let step = endId;
  while (step !== undefined) {
    path.unshift(step);
    if (step === startId) break;
    step = previous[step];
  }
  return path[0] === startId ? path : null;
}

export function findShortestPath(graph, startId, endId, edgeWeight = defaultWeight) {
  const { distances, previous } = runDijkstra(graph, startId, edgeWeight);
  if (distances[endId] === Infinity) return null;
  return reconstructPath(previous, startId, endId);
}

// Splits a full path into one leg per floor, breaking wherever the
// path crosses a stairs/elevator link onto another floor's nodes.
export function splitPathIntoLegs(path, nodeFloorMap) {
  const legs = [];
  let currentFloor = nodeFloorMap[path[0]];
  let currentNodes = [path[0]];

  for (let i = 1; i < path.length; i++) {
    const floorId = nodeFloorMap[path[i]];
    if (floorId === currentFloor) {
      currentNodes.push(path[i]);
    } else {
      legs.push({ floorId: currentFloor, nodeIds: currentNodes });
      currentFloor = floorId;
      currentNodes = [path[i]];
    }
  }
  legs.push({ floorId: currentFloor, nodeIds: currentNodes });
  return legs;
}