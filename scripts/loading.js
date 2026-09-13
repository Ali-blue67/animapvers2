const loadingScreen = document.getElementById('loading-screen');
const loadingFill = document.getElementById('loading-fill');

const ringCircumference = 176;
const startTime = Date.now(); // Record when the loading screen starts
const MIN_DURATION = 1000;   // 2.5 seconds in milliseconds

window.setLoadingProgress = function (percent) {
  const safePercent = Math.min(percent, 100);
  const offset = ringCircumference - (safePercent / 100) * ringCircumference;
  loadingFill.style.strokeDashoffset = offset;
};

window.finishLoading = function () {
  loadingFill.style.strokeDashoffset = 0;
  
  // Calculate how much time has passed since loading started
  const elapsedTime = Date.now() - startTime;
  const remainingTime = Math.max(MIN_DURATION - elapsedTime, 0);

  // Wait for the remaining time before triggering the fade-out
  setTimeout(() => {
    loadingScreen.classList.add('fade-out');
  }, remainingTime + 200); // added the original 200ms buffer
};

// Safety net: forces completion if models take too long or fail
setTimeout(() => {
  if (loadingScreen && !loadingScreen.classList.contains('fade-out')) {
    window.finishLoading();
  }
}, 5000); // Increased safety net slightly past 3s