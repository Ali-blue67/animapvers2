const tabButtons = document.querySelectorAll('.sidebar-tab');
const tabPanels = document.querySelectorAll('.tab-panel');
const sidebar = document.getElementById('sidebar');
const hamburgerBtn = document.getElementById('hamburger-btn');
const backdrop = document.getElementById('sidebar-backdrop');
const isMobile = window.matchMedia('(max-width: 860px)');

// A closed drawer sits off-screen, so keep it out of the tab order too.
function syncInert() {
  sidebar.inert = isMobile.matches && !sidebar.classList.contains('open');
}

function setSidebarOpen(open) {
  sidebar.classList.toggle('open', open);
  backdrop.classList.toggle('visible', open);
  hamburgerBtn.setAttribute('aria-expanded', String(open));
  hamburgerBtn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  syncInert();
}

tabButtons.forEach((button) => {
  button.addEventListener('click', () => {
    tabButtons.forEach((btn) => {
      if (btn === button) btn.setAttribute('aria-current', 'page');
      else btn.removeAttribute('aria-current');
    });
    tabPanels.forEach((panel) => panel.classList.toggle('active', panel.id === button.dataset.tab));
    setSidebarOpen(false);
  });
});

hamburgerBtn.addEventListener('click', () => setSidebarOpen(!sidebar.classList.contains('open')));
backdrop.addEventListener('click', () => setSidebarOpen(false));

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && sidebar.classList.contains('open')) {
    setSidebarOpen(false);
    hamburgerBtn.focus();
  }
});

isMobile.addEventListener('change', () => setSidebarOpen(false));
syncInert();