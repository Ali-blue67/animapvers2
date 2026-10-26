// Pan and zoom for an <svg> via its viewBox. Works with mouse (wheel +
// drag), touch (drag + pinch) and keyboard (arrows, + / -, 0), and hands
// back zoomIn / zoomOut / reset / fitTo so on-screen buttons and route
// framing never depend on a pinch gesture.
//
//   homeRect  - the view to open on (and return to on reset)
//   worldRect - everything on the floor; limits how far you can pan/zoom out

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function enablePanZoom(svg, homeRect, worldRect = homeRect) {
  const frame = svg.getBoundingClientRect();
  const frameAspect =
    frame.width && frame.height ? frame.width / frame.height : homeRect.width / homeRect.height;

  // Grow a rectangle to the frame's aspect ratio (centred), so the
  // pixel-to-map maths below stays exact with no letterboxing.
  function fit(rect) {
    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;
    let w = rect.width;
    let h = rect.height;
    if (w / h < frameAspect) w = h * frameAspect;
    else h = w / frameAspect;
    return { x: cx - w / 2, y: cy - h / 2, width: w, height: h };
  }

  const home = fit(homeRect);
  const viewBox = { ...home };
  const minWidth = home.width * 0.12;
  const maxWidth = Math.max(fit(worldRect).width, home.width) * 1.05;

  const pointers = new Map();
  let lastPanPoint = null;
  let lastPinchDistance = null;

  function apply() {
    // Keep the view's centre inside the floor so you can't drift into empty space.
    const cx = clamp(viewBox.x + viewBox.width / 2, worldRect.x, worldRect.x + worldRect.width);
    const cy = clamp(viewBox.y + viewBox.height / 2, worldRect.y, worldRect.y + worldRect.height);
    viewBox.x = cx - viewBox.width / 2;
    viewBox.y = cy - viewBox.height / 2;
    svg.setAttribute('viewBox', `${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`);
  }

  const pixelToSvgScale = () => {
    const rect = svg.getBoundingClientRect();
    return rect.width ? viewBox.width / rect.width : 1;
  };

  function zoomAt(clientX, clientY, factor) {
    const rect = svg.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    const scale = pixelToSvgScale();
    const svgX = viewBox.x + px * scale;
    const svgY = viewBox.y + py * scale;

    const newWidth = clamp(viewBox.width * factor, minWidth, maxWidth);
    const newHeight = viewBox.height * (newWidth / viewBox.width);

    viewBox.x = svgX - (px / rect.width) * newWidth;
    viewBox.y = svgY - (py / rect.height) * newHeight;
    viewBox.width = newWidth;
    viewBox.height = newHeight;
    apply();
  }

  function zoomBy(factor) {
    const rect = svg.getBoundingClientRect();
    zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, factor);
  }

  function panBy(dxFraction, dyFraction) {
    viewBox.x += viewBox.width * dxFraction;
    viewBox.y += viewBox.height * dyFraction;
    apply();
  }

  function reset() {
    Object.assign(viewBox, home);
    apply();
  }

  // Frame a rectangle (e.g. a route) in the view.
  function fitTo(rect) {
    Object.assign(viewBox, fit(rect));
    apply();
  }

  const pinchDistance = () => {
    const [a, b] = Array.from(pointers.values());
    return Math.hypot(a.x - b.x, a.y - b.y);
  };
  const pinchCenter = () => {
    const [a, b] = Array.from(pointers.values());
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  };

  function onWheel(event) {
    event.preventDefault();
    zoomAt(event.clientX, event.clientY, event.deltaY > 0 ? 1.12 : 0.89);
  }

  function onPointerDown(event) {
    svg.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 1) {
      lastPanPoint = { x: event.clientX, y: event.clientY };
      svg.style.cursor = 'grabbing';
    } else if (pointers.size === 2) {
      lastPinchDistance = pinchDistance();
    }
  }

  function onPointerMove(event) {
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointers.size === 1 && lastPanPoint) {
      const scale = pixelToSvgScale();
      viewBox.x -= (event.clientX - lastPanPoint.x) * scale;
      viewBox.y -= (event.clientY - lastPanPoint.y) * scale;
      lastPanPoint = { x: event.clientX, y: event.clientY };
      apply();
    } else if (pointers.size === 2) {
      const distance = pinchDistance();
      const center = pinchCenter();
      if (lastPinchDistance) zoomAt(center.x, center.y, lastPinchDistance / distance);
      lastPinchDistance = distance;
    }
  }

  function onPointerUp(event) {
    pointers.delete(event.pointerId);
    if (pointers.size < 2) lastPinchDistance = null;
    if (pointers.size === 1) {
      const remaining = Array.from(pointers.values())[0];
      lastPanPoint = { x: remaining.x, y: remaining.y };
    } else {
      lastPanPoint = null;
      svg.style.cursor = 'grab';
    }
  }

  function onKeyDown(event) {
    const step = 0.1;
    const action = {
      ArrowLeft: () => panBy(-step, 0),
      ArrowRight: () => panBy(step, 0),
      ArrowUp: () => panBy(0, -step),
      ArrowDown: () => panBy(0, step),
      '+': () => zoomBy(0.8),
      '=': () => zoomBy(0.8),
      '-': () => zoomBy(1.25),
      0: reset,
    }[event.key];
    if (action) {
      event.preventDefault();
      action();
    }
  }

  svg.addEventListener('wheel', onWheel, { passive: false });
  svg.addEventListener('pointerdown', onPointerDown);
  svg.addEventListener('pointermove', onPointerMove);
  svg.addEventListener('pointerup', onPointerUp);
  svg.addEventListener('pointercancel', onPointerUp);
  svg.addEventListener('keydown', onKeyDown);
  svg.style.cursor = 'grab';
  svg.style.touchAction = 'none';
  svg.tabIndex = 0;

  apply();

  return {
    zoomIn: () => zoomBy(0.8),
    zoomOut: () => zoomBy(1.25),
    reset,
    fitTo,
    destroy() {
      svg.removeEventListener('wheel', onWheel);
      svg.removeEventListener('pointerdown', onPointerDown);
      svg.removeEventListener('pointermove', onPointerMove);
      svg.removeEventListener('pointerup', onPointerUp);
      svg.removeEventListener('pointercancel', onPointerUp);
      svg.removeEventListener('keydown', onKeyDown);
      svg.style.cursor = '';
      svg.style.touchAction = '';
      svg.removeAttribute('tabindex');
    },
  };
}