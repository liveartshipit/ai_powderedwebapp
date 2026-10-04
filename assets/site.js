// Shared by every page: colour theme, mobile menu, footer year, analytics consent.
(() => {
  // Google Analytics 4 Measurement ID. Leave empty to turn analytics (and the banner) off.
  const GA_ID = 'G-ZFN1DT0BP6';

  const $ = s => document.querySelector(s);
  const root = document.documentElement;
  const store = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };

  const t = store.get('news-theme'); if (t) root.dataset.theme = t;
  $('#theme').onclick = () => {
    const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    root.dataset.theme = dark ? 'light' : 'dark';
    store.set('news-theme', root.dataset.theme);
  };
  $('#menu').onclick = () => { const open = $('#nav').classList.toggle('open'); $('#menu').setAttribute('aria-expanded', open); };
  $('#year').textContent = new Date().getFullYear();

  /* Analytics: the Google tag is in every page's <head> with consent denied by default
     (so Google can detect it). Measurement starts only after the visitor accepts. */
  if (!/^G-[A-Z0-9]+$/.test(GA_ID) || typeof window.gtag !== 'function') return;
  const KEY = 'news-consent';
  const grant = () => {
    gtag('consent', 'update', { analytics_storage: 'granted' });
    // Cookies stay on this subdomain, so a choice here never touches worksmarto.com's own consent/cookies.
    if (!window.__gaConfigured) { gtag('config', GA_ID, { cookie_domain: location.hostname }); window.__gaConfigured = true; }
  };
  const clearGA = () => {
    // Remove this site's Google Analytics cookies (set on this host only).
    const host = location.hostname;
    document.cookie.split(';').map(c => c.split('=')[0].trim()).filter(n => /^_ga/.test(n)).forEach(n => {
      for (const d of ['', `; domain=${host}`, `; domain=.${host}`]) document.cookie = `${n}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/${d}`;
    });
  };

  const banner = document.createElement('div');
  banner.className = 'consent'; banner.setAttribute('role', 'dialog'); banner.setAttribute('aria-label', 'Cookie consent'); banner.hidden = true;
  banner.innerHTML = `<p>We use Google Analytics cookies to see which stories are read, so we can make the news more useful. No ads, and nothing is sold. <a href="privacy.html#analytics">Privacy Policy</a></p>
    <div class="consent-btns"><button class="btn-outline consent-no" type="button">Reject</button><button class="btn consent-yes" type="button">Accept</button></div>`;
  document.body.appendChild(banner);
  const choose = v => {
    store.set(KEY, v); banner.hidden = true;
    if (v === 'granted') grant();
    else { gtag('consent', 'update', { analytics_storage: 'denied' }); clearGA(); }
  };
  banner.querySelector('.consent-yes').onclick = () => choose('granted');
  banner.querySelector('.consent-no').onclick = () => choose('denied');

  // "Cookie settings" in the footer reopens the choice.
  const base = $('.foot-base');
  if (base) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'cookie-link'; b.textContent = 'Cookie settings';
    b.onclick = () => { banner.hidden = false; banner.querySelector('.consent-yes').focus(); };
    base.append(' · ', b);
  }

  const saved = store.get(KEY);
  if (saved === 'granted') grant();
  else if (saved !== 'denied') banner.hidden = false;
})();
