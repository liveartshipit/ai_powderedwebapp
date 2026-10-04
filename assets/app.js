(() => {
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const SECTIONS = { 'Models': 'models', 'Products': 'products', 'Companies': 'companies', 'Stocks & Markets': 'stocks', 'Research': 'research', 'Policy & Safety': 'policy' };
  const YOU = 'Tools for You';
  // v1 stories used OpenAI-only categories.
  const LEGACY = { 'Product': 'Products', 'API & Developers': 'Products', 'Company': 'Companies', 'Safety': 'Policy & Safety', 'Policy': 'Policy & Safety', 'Research': 'Research' };
  const IMPACT = { big: ['🔥', 'Big story', 3], notable: ['⚡', 'Notable', 2], fyi: ['💡', 'Worth knowing', 1] };
  const dot = s => `var(--s-${SECTIONS[s] || 'companies'})`;
  const dayKey = d => new Date(d).toLocaleDateString('en-CA');
  const state = { items: [], sec: 'All', q: '', day: null, top: null };

  /* Theme */
  const root = document.documentElement;
  try { const t = localStorage.getItem('news-theme'); if (t) root.dataset.theme = t; } catch {}
  $('#theme').onclick = () => {
    const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    root.dataset.theme = dark ? 'light' : 'dark';
    try { localStorage.setItem('news-theme', root.dataset.theme); } catch {}
  };

  /* Mobile menu */
  $('#menu').onclick = () => { const open = $('#nav').classList.toggle('open'); $('#menu').setAttribute('aria-expanded', open); };
  $('#year').textContent = new Date().getFullYear();

  let tt; const toast = m => { const t = $('#toast'); t.textContent = m; t.classList.add('on'); clearTimeout(tt); tt = setTimeout(() => t.classList.remove('on'), 1800); };

  const ago = iso => {
    const m = Math.round((Date.now() - new Date(iso)) / 60000);
    if (m < 60) return `${Math.max(m, 1)} min ago`;
    const h = Math.round(m / 60); if (h < 24) return `${h} h ago`;
    return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  };
  const isToday = iso => Date.now() - new Date(iso) < 36 * 3600e3;
  const weight = i => (IMPACT[i.impact] || IMPACT.fyi)[2];
  // Market stories never lead; real AI developments do.
  const rank = i => weight(i) * 2 - (i.section === 'Stocks & Markets' ? 3 : 0) + (i.forYou ? 0.5 : 0);

  /* Scroll reveal: cards rise in one by one as they enter the viewport */
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const pending = new Set();
  const sweep = () => {
    let n = 0;
    for (const el of pending) {
      const r = el.getBoundingClientRect();
      if (r.top > innerHeight * 0.92) continue;
      // Cards already scrolled past (fast scroll or jump) appear at once; on-screen ones rise in turn.
      el.style.transitionDelay = r.bottom < 0 ? '0ms' : `${Math.min(n++, 5) * 90}ms`;
      el.classList.add('in');
      pending.delete(el);
    }
  };
  let ticking = false;
  addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(() => { ticking = false; sweep(); }); } }, { passive: true });
  addEventListener('resize', sweep, { passive: true });
  const reveal = scope => {
    pending.clear();
    scope.querySelectorAll('.reveal:not(.in)').forEach(el => calm ? el.classList.add('in') : pending.add(el));
    requestAnimationFrame(sweep);
  };

  const impactBadge = i => { const [icon, label] = IMPACT[i.impact] || IMPACT.fyi; return `<span class="impact impact-${esc(i.impact || 'fyi')}"><span aria-hidden="true">${icon}</span> ${label}</span>`; };
  const secBadge = s => `<span class="sec" style="--dot:${dot(s)}"><i></i>${esc(s)}</span>`;

  /* Today's brief */
  function renderBrief(b) {
    if (!b || !b.bullets?.length || Date.now() - new Date(b.date) > 48 * 3600e3) return;
    $('#brief').innerHTML = `
      <div class="brief-head"><span class="brief-label">Today’s Brief</span><span class="brief-date">${new Date(b.date).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</span></div>
      <h2>${esc(b.headline)}</h2>
      <ol>${b.bullets.map(x => `<li>${esc(x)}</li>`).join('')}</ol>`;
    $('#brief').hidden = false;
  }

  /* Top story: the highest-impact story from the latest day and a half */
  function pickTop() {
    const pool = state.items.filter(i => isToday(i.date));
    return (pool.length ? pool : state.items.slice(0, 8)).slice().sort((a, b) => rank(b) - rank(a) || b.date.localeCompare(a.date))[0] || null;
  }
  function renderLead() {
    const l = state.top;
    if (!l) {
      $('#lead').innerHTML = `<div><h1>Today’s first edition is on its way.</h1><p class="sum">Worksmarto AI News publishes every morning at 6:00 IST with plain-English summaries of the day in AI. Check back after the first run.</p></div>`;
      return;
    }
    $('#lead').innerHTML = `
      <div class="reveal">
        <p class="lead-kicker">${impactBadge(l)}${secBadge(l.section)}<span>${esc(l.source || '')} · ${ago(l.date)}</span></p>
        ${l.hook ? `<p class="lead-hook">${esc(l.hook)}</p>` : ''}
        <h1${l.title.length > 70 ? ' class="long"' : ''}><a href="${esc(l.link)}" target="_blank" rel="noopener">${esc(l.title)}</a></h1>
        <p class="sum">${esc(l.summary)}</p>
      </div>
      <aside class="why reveal">
        <h2>Why it matters to you</h2>
        <p>${esc(l.why || 'Read the full story for details and timing.')}</p>
        ${l.takeaway ? `<p class="take"><span>Your move</span>${esc(l.takeaway)}</p>` : ''}
        <a class="btn" href="${esc(l.link)}" target="_blank" rel="noopener">Read the full story »</a>
      </aside>`;
  }

  /* Pulse strip: last 30 days */
  function renderPulse() {
    const days = [...Array(30)].map((_, i) => { const d = new Date(); d.setDate(d.getDate() - 29 + i); return dayKey(d); });
    const counts = days.map(k => state.items.filter(i => dayKey(i.date) === k).length);
    const max = Math.max(1, ...counts), W = 600, H = 90, step = W / 30;
    let d = `M0 ${H * .7}`;
    counts.forEach((c, i) => {
      const x = i * step, mid = x + step / 2;
      if (!c) { d += ` L${x + step} ${H * .7}`; return; }
      const peak = H * .7 - (c / max) * H * .62;
      d += ` L${mid - 6} ${H * .7} L${mid - 3} ${H * .82} L${mid} ${peak} L${mid + 4} ${H * .9} L${mid + 7} ${H * .7} L${x + step} ${H * .7}`;
    });
    $('#pulseSvg').innerHTML = `<line class="base" x1="0" x2="${W}" y1="${H * .7}" y2="${H * .7}"/><path class="beat" d="${d}"/>`;
    $('#pulseDays').innerHTML = days.map((k, i) => {
      const lbl = new Date(k + 'T12:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
      return `<button class="dayhit" style="left:${i / 30 * 100}%;width:${100 / 30}%" data-day="${k}" aria-pressed="${state.day === k}" ${counts[i] ? '' : 'disabled'} aria-label="${lbl}: ${counts[i]} stor${counts[i] === 1 ? 'y' : 'ies'}" title="${lbl}: ${counts[i]}"></button>`;
    }).join('');
    $('#clearDay').hidden = !state.day;
  }
  $('#pulseDays').onclick = e => { const b = e.target.closest('[data-day]'); if (!b || b.disabled) return; state.day = state.day === b.dataset.day ? null : b.dataset.day; renderAll(); $('#feed').scrollIntoView({ behavior: 'smooth' }); };
  $('#clearDay').onclick = () => { state.day = null; renderAll(); };

  /* Section tabs */
  const inSec = (i, s) => s === 'All' || (s === YOU ? i.forYou : i.section === s);
  function renderChips() {
    const tabs = ['All', ...Object.keys(SECTIONS), YOU].filter(s => s === 'All' || state.items.some(i => inSec(i, s)));
    $('#chips').innerHTML = tabs.map(s => {
      const n = state.items.filter(i => inSec(i, s)).length;
      const mark = s === 'All' ? '' : s === YOU ? '<i class="star" aria-hidden="true">★</i>' : '<i></i>';
      return `<button class="chip" style="--dot:${s === YOU ? 'var(--s-you)' : dot(s)}" aria-pressed="${state.sec === s}" data-sec="${esc(s)}">${mark}${esc(s)}<span class="n">${n}</span></button>`;
    }).join('');
  }
  $('#chips').onclick = e => { const b = e.target.closest('[data-sec]'); if (!b) return; state.sec = b.dataset.sec; renderAll(); };
  $('#q').oninput = e => { state.q = e.target.value.trim().toLowerCase(); renderFeed(); };

  /* Feed */
  function renderFeed() {
    const filtering = state.sec !== 'All' || state.q || state.day;
    const list = state.items
      .filter(i => filtering || i !== state.top)
      .filter(i => inSec(i, state.sec))
      .filter(i => !state.day || dayKey(i.date) === state.day)
      .filter(i => !state.q || [i.title, i.hook, i.summary, i.company, i.ticker, i.source, ...(i.tags || [])].join(' ').toLowerCase().includes(state.q));
    if (!state.items.length) { $('#feed').innerHTML = ''; return; }
    if (!list.length) { $('#feed').innerHTML = `<div class="empty"><h3>No stories match.</h3><p>Try another word or pick All to see every story.</p></div>`; return; }
    const groups = {};
    list.forEach(i => (groups[dayKey(i.date)] ||= []).push(i));
    $('#feed').innerHTML = Object.entries(groups).map(([k, items]) => {
      const d = new Date(k + 'T12:00');
      items.sort((a, b) => rank(b) - rank(a) || b.date.localeCompare(a.date));
      return `<div class="day"><div class="day-label"><b>${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</b><span>${d.toLocaleDateString(undefined, { weekday: 'long' })}</span></div>
        <div class="stories">${items.map(story).join('')}</div></div>`;
    }).join('');
    reveal($('#feed'));
  }
  const story = i => `<article class="story reveal is-${esc(i.impact || 'fyi')}">
      <div class="story-top">${impactBadge(i)}${isToday(i.date) ? '<span class="new">New</span>' : ''}</div>
      <div class="story-meta">${secBadge(i.section)}<span>${esc(i.source || '')}${i.source ? ' · ' : ''}${ago(i.date)}</span></div>
      ${i.hook ? `<p class="hook">${esc(i.hook)}</p>` : ''}
      <h3><a href="${esc(i.link)}" target="_blank" rel="noopener">${esc(i.title)}</a></h3>
      <p class="sum">${esc(i.summary)}</p>
      ${i.why ? `<p class="w"><b>Why it matters:</b> ${esc(i.why)}</p>` : ''}
      ${i.takeaway ? `<p class="take"><span>Your move</span>${esc(i.takeaway)}</p>` : ''}
      ${i.section === 'Stocks & Markets' ? '<p class="nfa">Market news, not financial advice.</p>' : ''}
      <div class="tags">${i.ticker ? `<span class="tag ticker">$${esc(i.ticker)}</span>` : ''}${i.company && !i.ticker ? `<span class="tag co">${esc(i.company)}</span>` : ''}${(i.tags || []).map(t => `<span class="tag">#${esc(t)}</span>`).join('')}</div>
      <div class="story-foot"><a class="more" href="${esc(i.link)}" target="_blank" rel="noopener">Read More →</a><span class="mins">${i.readMins || 2} min read</span><button class="share" data-link="${esc(i.link)}" data-title="${esc(i.title)}">Share</button></div>
    </article>`;
  $('#feed').onclick = async e => {
    const b = e.target.closest('.share'); if (!b) return;
    const data = { title: b.dataset.title, text: `${b.dataset.title} (via Worksmarto AI News)`, url: b.dataset.link };
    try { if (navigator.share) await navigator.share(data); else { await navigator.clipboard.writeText(data.url); toast('Link copied'); } } catch {}
  };

  function renderAll() { renderLead(); renderPulse(); renderChips(); renderFeed(); reveal(document); }

  /* Load */
  $('#feed').innerHTML = '<div class="skel"></div><div class="skel" style="margin-top:14px"></div>';
  fetch('data/news.json?v=' + Date.now()).then(r => r.json()).then(d => {
    state.items = (d.items || []).map(i => ({ ...i, section: SECTIONS[i.section] ? i.section : (LEGACY[i.category] || 'Companies') }))
      .sort((a, b) => b.date.localeCompare(a.date));
    state.top = pickTop();
    $('#stamp').innerHTML = d.updated ? `Updated <b>${ago(d.updated)}</b> · next edition 6:00 IST` : 'First edition publishes at 6:00 IST';
    if (d.model) $('#modelNote').textContent = `Summaries by ${d.model.replace(/:free$/, '')} via OpenRouter.`;
    renderBrief(d.brief);
    renderAll();
  }).catch(() => {
    $('#stamp').textContent = 'Couldn’t load the latest edition';
    $('#feed').innerHTML = '<div class="empty"><h3>The news file didn’t load.</h3><p>Refresh the page. If it keeps happening, the daily update may have failed.</p></div>';
  });
})();
