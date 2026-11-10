// One page, two views of the same map. The slide switch flips between the 2D plan and the 3D model;
// every flip lands on Upper Ground (UG), so nobody ends up lost on another floor.
const sw = document.getElementById('view-switch');
const label2d = document.getElementById('view-label-2d');
const label3d = document.getElementById('view-label-3d');

export function setView(mode) {
  document.body.dataset.view = mode;
  const is3d = mode === '3d';
  sw.setAttribute('aria-checked', String(is3d));
  sw.setAttribute('aria-label', is3d ? 'Back to 2D navigation' : 'Show the 3D view');
  label2d.classList.toggle('on', !is3d);
  label3d.classList.toggle('on', is3d);
  window.dispatchEvent(new CustomEvent('animap:viewmode', { detail: { mode } }));
}

sw.addEventListener('click', () => setView(document.body.dataset.view === '3d' ? '2d' : '3d'));
label2d.addEventListener('click', () => setView('2d'));
label3d.addEventListener('click', () => setView('3d'));
label2d.classList.add('on');