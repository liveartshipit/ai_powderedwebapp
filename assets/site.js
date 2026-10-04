// Shared by every page: colour theme, mobile menu, footer year, analytics consent.
(() => {
  // Google Analytics 4 Measurement ID. Leave empty to turn analytics (and the banner) off.
  const GA_ID = '';

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

  /* Analytics: Google Analytics loads only after the visitor accepts. */
  if (!/^G-[A-Z0-9]+$/.test(GA_ID)) return;
  const KEY = 'news-consent';
  let loaded = false;
  const loadGA = () => {
    if (loaded) return; loaded = true;
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { dataLayer.push(arguments); };
    gtag('consent', 'default', { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'granted' });
    gtag('js', new Date());
    // Cookies stay on this subdomain, so a choice here never touches worksmarto.com's own consent/cookies.
    gtag('config', GA_ID, { cookie_domain: location.hostname });
    const s = document.createElement('script');
    s.async = true; s.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`;
    document.head.appendChild(s);
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
    if (v === 'granted') loadGA();
    else if (loaded) { gtag('consent', 'update', { analytics_storage: 'denied' }); clearGA(); }
    else clearGA();
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
  if (saved === 'granted') loadGA();
  else if (saved !== 'denied') banner.hidden = false;
})();
