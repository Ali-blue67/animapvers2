const tabButtons = document.querySelectorAll('.sidebar-tab');
const tabPanels = document.querySelectorAll('.tab-panel');
const sidebar = document.getElementById('sidebar');
const hamburgerBtn = document.getElementById('hamburger-btn');
const backdrop = document.getElementById('sidebar-backdrop');

tabButtons.forEach((button) => {
  button.addEventListener('click', () => {
    const targetId = button.dataset.tab;
    tabButtons.forEach((btn) => btn.classList.remove('active'));
    tabPanels.forEach((panel) => panel.classList.remove('active'));
    button.classList.add('active');
    document.getElementById(targetId).classList.add('active');
    closeSidebar();
  });
});

function openSidebar() {
  sidebar.classList.add('open');
  backdrop.classList.add('visible');
}

function closeSidebar() {
  sidebar.classList.remove('open');
  backdrop.classList.remove('visible');
}

hamburgerBtn.addEventListener('click', () => {
  if (sidebar.classList.contains('open')) {
    closeSidebar();
  } else {
    openSidebar();
  }
});

backdrop.addEventListener('click', closeSidebar);