(() => {
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const CATS = { 'Product': 'product', 'Research': 'research', 'Safety': 'safety', 'API & Developers': 'api', 'Company': 'company', 'Policy': 'policy' };
  const dot = c => `var(--c-${CATS[c] || 'company'})`;
  const dayKey = d => new Date(d).toLocaleDateString('en-CA');
  const state = { items: [], cat: 'All', q: '', day: null };

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

  /* Lead */
  function renderLead() {
    const l = state.items[0];
    if (!l) {
      $('#lead').innerHTML = `<div><h1>Today’s first edition is on its way.</h1><p class="sum">Worksmarto AI News publishes every morning at 6:00 IST with plain-English summaries of OpenAI news. Check back after the first run.</p></div>`;
      return;
    }
    $('#lead').innerHTML = `
      <div>
        <p class="lead-kicker">${isToday(l.date) ? '<span class="new">New today</span>' : ''}<span class="cat" style="--dot:${dot(l.category)}"><i></i>${esc(l.category)}</span><span>${ago(l.date)}</span></p>
        <h1><a href="${esc(l.link)}" target="_blank" rel="noopener">${esc(l.title)}</a></h1>
        <p class="sum">${esc(l.summary)}</p>
      </div>
      <aside class="why">
        <h2>Why it matters to you</h2>
        <p>${esc(l.why || 'Read the full announcement for details and timing.')}</p>
        <a class="btn" href="${esc(l.link)}" target="_blank" rel="noopener">Read on openai.com »</a>
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

  /* Chips */
  function renderChips() {
    const present = ['All', ...Object.keys(CATS).filter(c => state.items.some(i => i.category === c))];
    $('#chips').innerHTML = present.map(c => `<button class="chip" style="--dot:${c === 'All' ? 'var(--ink)' : dot(c)}" aria-pressed="${state.cat === c}" data-cat="${esc(c)}">${c === 'All' ? '' : '<i></i>'}${esc(c)}</button>`).join('');
  }
  $('#chips').onclick = e => { const b = e.target.closest('[data-cat]'); if (!b) return; state.cat = b.dataset.cat; renderAll(); };
  $('#q').oninput = e => { state.q = e.target.value.trim().toLowerCase(); renderFeed(); };

  /* Feed */
  function renderFeed() {
    const list = state.items.slice(1).concat(state.cat !== 'All' || state.q || state.day ? state.items.slice(0, 1) : [])
      .filter(i => state.cat === 'All' || i.category === state.cat)
      .filter(i => !state.day || dayKey(i.date) === state.day)
      .filter(i => !state.q || (i.title + ' ' + i.summary + ' ' + (i.tags || []).join(' ')).toLowerCase().includes(state.q))
      .sort((a, b) => b.date.localeCompare(a.date));
    if (!state.items.length) { $('#feed').innerHTML = ''; return; }
    if (!list.length) { $('#feed').innerHTML = `<div class="empty"><h3>No stories match.</h3><p>Try another word or pick All to see every story.</p></div>`; return; }
    const groups = {};
    list.forEach(i => (groups[dayKey(i.date)] ||= []).push(i));
    $('#feed').innerHTML = Object.entries(groups).map(([k, items]) => {
      const d = new Date(k + 'T12:00');
      return `<div class="day"><div class="day-label"><b>${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</b><span>${d.toLocaleDateString(undefined, { weekday: 'long' })}</span></div>
        <div class="stories">${items.map(story).join('')}</div></div>`;
    }).join('');
  }
  const story = i => `<article class="story">
      <div class="story-meta"><span class="cat" style="--dot:${dot(i.category)}"><i></i>${esc(i.category)}</span>${isToday(i.date) ? '<span class="new">New</span>' : ''}</div>
      <h3><a href="${esc(i.link)}" target="_blank" rel="noopener">${esc(i.title)}</a></h3>
      <p>${esc(i.summary)}</p>
      ${i.why ? `<p class="w"><b>Why it matters:</b> ${esc(i.why)}</p>` : ''}
      <div class="tags">${(i.tags || []).map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>
      <div class="story-foot"><a class="more" href="${esc(i.link)}" target="_blank" rel="noopener">Read More →</a><button class="share" data-link="${esc(i.link)}" data-title="${esc(i.title)}">Share</button></div>
    </article>`;
  $('#feed').onclick = async e => {
    const b = e.target.closest('.share'); if (!b) return;
    const data = { title: b.dataset.title, text: `${b.dataset.title} (via Worksmarto AI News)`, url: b.dataset.link };
    try { if (navigator.share) await navigator.share(data); else { await navigator.clipboard.writeText(data.url); toast('Link copied'); } } catch {}
  };

  function renderAll() { renderLead(); renderPulse(); renderChips(); renderFeed(); }

  /* Load */
  $('#feed').innerHTML = '<div class="skel"></div><div class="skel" style="margin-top:14px"></div>';
  fetch('data/news.json?v=' + Date.now()).then(r => r.json()).then(d => {
    state.items = (d.items || []).sort((a, b) => b.date.localeCompare(a.date));
    $('#stamp').innerHTML = d.updated ? `Updated <b>${ago(d.updated)}</b> · next edition 6:00 IST` : 'First edition publishes at 6:00 IST';
    if (d.model) $('#modelNote').textContent = `Summaries by ${d.model.replace(/:free$/, '')} via OpenRouter.`;
    renderAll();
  }).catch(() => {
    $('#stamp').textContent = 'Couldn’t load the latest edition';
    $('#feed').innerHTML = '<div class="empty"><h3>The news file didn’t load.</h3><p>Refresh the page. If it keeps happening, the daily update may have failed.</p></div>';
  });
})();
