// Shared by every page: colour theme, mobile menu, footer year.
(() => {
  const $ = s => document.querySelector(s);
  const root = document.documentElement;
  try { const t = localStorage.getItem('news-theme'); if (t) root.dataset.theme = t; } catch {}
  $('#theme').onclick = () => {
    const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    root.dataset.theme = dark ? 'light' : 'dark';
    try { localStorage.setItem('news-theme', root.dataset.theme); } catch {}
  };
  $('#menu').onclick = () => { const open = $('#nav').classList.toggle('open'); $('#menu').setAttribute('aria-expanded', open); };
  $('#year').textContent = new Date().getFullYear();
})();
