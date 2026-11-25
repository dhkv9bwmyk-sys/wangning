(() => {
 'use strict';
 const copyStatus = document.getElementById('contact-copy-status');
 let copyStatusTimer;
 document.querySelectorAll('.contact-copy').forEach(button => {
  button.addEventListener('click', async () => {
   let message;
   try {
    await navigator.clipboard.writeText(button.dataset.copy);
    message = button.dataset.copyLabel + '已复制';
   } catch {
    message = '复制失败，请选择联系方式后手动复制';
   }
   clearTimeout(copyStatusTimer);
   copyStatus.textContent = message;
   copyStatusTimer = setTimeout(() => { copyStatus.textContent = ''; }, 3000);
  });
 });
 const tabs = [...document.querySelectorAll('[role="tab"]')];
 function activateTab(tab, focus = false) {
  tabs.forEach(item => {
   const active = item === tab;
   item.setAttribute('aria-selected', String(active));
   item.tabIndex = active ? 0 : -1;
   const panel = document.getElementById(item.getAttribute('aria-controls'));
   if (panel) panel.hidden = !active;
  });
  if (focus) tab.focus();
 }
 tabs.forEach((tab, index) => {
  tab.addEventListener('click', () => activateTab(tab));
  tab.addEventListener('keydown', event => {
   let next;
   if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
   if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
   if (event.key === 'Home') next = 0;
   if (event.key === 'End') next = tabs.length - 1;
   if (next !== undefined) { event.preventDefault(); activateTab(tabs[next], true); }
  });
 });
 const indexLinks = [...document.querySelectorAll('.case-index nav a')];
 if (indexLinks.length) {
  const sections = indexLinks.map(link => document.querySelector(link.getAttribute('href'))).filter(Boolean);
  const progress = document.querySelector('.reading-progress');
  let scheduled = false;
  const update = () => {
   const y = window.scrollY + 170;
   let current = sections[0];
   sections.forEach(section => { if (section.offsetTop <= y) current = section; });
   indexLinks.forEach(link => {
    const active = link.hash === '#' + current.id;
    link.classList.toggle('active', active);
    if (active) link.setAttribute('aria-current', 'location'); else link.removeAttribute('aria-current');
   });
   const range = document.documentElement.scrollHeight - window.innerHeight;
   if (progress) progress.style.width = (range > 0 ? Math.min(100, window.scrollY / range * 100) : 0) + '%';
   scheduled = false;
  };
  window.addEventListener('scroll', () => { if (!scheduled) { scheduled = true; requestAnimationFrame(update); } }, { passive: true });
  window.addEventListener('resize', update);
  update();
 }
})();
