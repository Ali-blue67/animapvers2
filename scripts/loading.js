const loadingScreen = document.getElementById('loading-screen');
const loadingFill = document.getElementById('loading-fill');
let finished = false;

// Show movement straight away; real download progress (when the
// browser can report it) takes over from model-viewer.js.
requestAnimationFrame(() => {
  if (!finished) loadingFill.style.width = '40%';
});

window.setLoadingProgress = function (percent) {
  if (!finished) loadingFill.style.width = `${Math.max(40, Math.min(percent, 100))}%`;
};

window.finishLoading = function () {
  if (finished) return;
  finished = true;
  loadingFill.style.width = '100%';
  setTimeout(() => {
    loadingScreen.classList.add('fade-out');
    setTimeout(() => {
      loadingScreen.hidden = true;
    }, 600);
  }, 300);
};

// Safety net: never leave a visitor on the loading screen, even if
// every model fails to load.
setTimeout(window.finishLoading, 4000);