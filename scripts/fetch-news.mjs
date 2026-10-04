// Worksmarto AI News — daily updater. Node 20+, zero dependencies.
// Safe mode: AI-written hooks, summaries and takeaways only for OFFICIAL company sources
// (company blogs, SEC EDGAR filings). News publishers appear as their own headline + link
// only ("Elsewhere in AI"), never rewritten. Adds a short daily brief; writes data/news.json.
import { readFile, writeFile } from 'node:fs/promises';

const DATA = new URL('../data/news.json', import.meta.url);
const SCHEMA = 2;           // bump to re-summarise stored stories in a new format
const KEEP = 150;           // stories kept on the page
const MAX_NEW = 20;         // new stories summarised per run (free tier: ~50 requests/day)
const MAX_REDO = 20;        // stored stories re-summarised per run (failed before, or older format)
const BATCH = 10;           // stories per model request
const PER_SOURCE = 3;       // max new stories per source per run, so no site dominates
const MAX_AGE_DAYS = 4;     // ignore feed items older than this (first run / slow feeds)
const FILING_AGE_DAYS = 10; // SEC filings are rarer, so look further back
const SECTIONS = ['Models', 'Products', 'Companies', 'Stocks & Markets', 'Research', 'Policy & Safety'];
const IMPACT = ['big', 'notable', 'fyi'];

// Official sources: AI summaries allowed. [name, url, default section (a hint; the model decides)]
const OFFICIAL = [
  ['OpenAI', 'https://openai.com/news/rss.xml', 'Models'],
  ['Google DeepMind', 'https://deepmind.google/blog/rss.xml', 'Research'],
  ['Google AI', 'https://blog.google/technology/ai/rss/', 'Products'],
  ['Microsoft', 'https://blogs.microsoft.com/feed/', 'Products'],
  ['NVIDIA', 'https://blogs.nvidia.com/feed/', 'Companies'],
  ['Hugging Face', 'https://huggingface.co/blog/feed.xml', 'Models'],
  ['AWS Machine Learning', 'https://aws.amazon.com/blogs/machine-learning/feed/', 'Products'],
];
// SEC EDGAR 8-K filings (US public data) for Stocks & Markets. [ticker, display name]
const EDGAR = [['NVDA', 'NVIDIA'], ['MSFT', 'Microsoft'], ['GOOGL', 'Alphabet'], ['META', 'Meta'], ['AMZN', 'Amazon'], ['AMD', 'AMD'], ['AVGO', 'Broadcom'], ['PLTR', 'Palantir']];
// SEC asks automated clients to identify themselves with a contact email (repo variable SEC_CONTACT_EMAIL).
const SEC_UA = `Worksmarto AI News ${process.env.SEC_CONTACT_EMAIL || 'https://news.worksmarto.com'}`;
// News publishers: shown as their own headline + source + link only. No AI, no rewriting.
const PUBLISHERS = [
  ['TechCrunch', 'https://techcrunch.com/category/artificial-intelligence/feed/'],
  ['The Verge', 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml'],
  ['VentureBeat', 'https://venturebeat.com/category/ai/feed/'],
  ['Ars Technica', 'https://arstechnica.com/ai/feed/'],
];
const HEADLINES_KEEP = 16;  // headlines shown in "Elsewhere in AI"
const HEADLINES_PER_SOURCE = 4;
const ALLOWED = new Set([...OFFICIAL.map(f => f[0]), 'SEC EDGAR']);
// Preferred free models, tried first when available. OPENROUTER_MODEL (repo variable) overrides.
const PREFERRED = ['qwen/qwen3.8-27b:free'];
const KEY = process.env.OPENROUTER_API_KEY;

const decode = s => (s || '')
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0*39;|&apos;|&#8217;|&rsquo;/g, "'")
  .replace(/&#8216;|&lsquo;/g, "'").replace(/&#822[01];|&[lr]dquo;/g, '"').replace(/&#8211;|&ndash;/g, '–').replace(/&#8212;|&mdash;/g, '—')
  .replace(/&nbsp;|&#160;/g, ' ').replace(/&#8230;|&hellip;/g, '…').replace(/&amp;/g, '&')
  .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const tag = (xml, t) => { const m = xml.match(new RegExp(`<${t}(?:\\s[^>]*)?>([\\s\\S]*?)</${t}>`, 'i')); return m ? decode(m[1]) : ''; };
const atomLink = xml => (xml.match(/<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)/i) || xml.match(/<link[^>]*href=["']([^"']+)/i) || [])[1] || '';
const idOf = link => link.replace(/^https?:\/\/(www\.)?/, '').replace(/[?#].*$/, '').replace(/\/+$/, '');
const STOP = new Set('a an the and or but for with from that this into over its it is are was be has have how why what new now your you our will can just more than about after on in at to of as by'.split(' '));
const words = s => new Set(s.toLowerCase().replace(/[^a-z0-9.]+/g, ' ').replace(/\.(?!\d)/g, ' ').split(' ').filter(w => w && (/\d/.test(w) || w.length > 1) && !STOP.has(w)));
// Same story from two outlets: nearly all of the shorter title's words appear in the longer one.
const nums = S => [...S].filter(w => /\d/.test(w)).sort().join();
const similar = (a, b) => { const A = words(a), B = words(b); if (nums(A) !== nums(B)) return false; const min = Math.min(A.size, B.size); if (min < 2) return false; let n = 0; for (const w of A) if (B.has(w)) n++; return n / min >= (min < 4 ? 1 : 0.8); };

async function fetchFeed([source, url, hint], ua = 'Worksmarto-AI-News/2.0 (+https://news.worksmarto.com)') {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': ua, Accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.8' }, signal: AbortSignal.timeout(20000) });
    if (!r.ok) { console.warn(`feed ${source} -> ${r.status}`); return []; }
    const xml = await r.text();
    const rss = [...xml.matchAll(/<item[\s>][\s\S]*?<\/item>/gi)].map(m => m[0]);
    const atom = rss.length ? [] : [...xml.matchAll(/<entry[\s>][\s\S]*?<\/entry>/gi)].map(m => m[0]);
    const items = [...rss, ...atom].map(x => {
      const link = (rss.length ? (tag(x, 'link') || tag(x, 'guid')) : atomLink(x)).trim();
      const when = tag(x, 'pubDate') || tag(x, 'published') || tag(x, 'updated') || tag(x, 'dc:date');
      const d = new Date(when || Date.now());
      return { id: idOf(link), source, hint, title: tag(x, 'title'), link, date: (isNaN(d) ? new Date() : d).toISOString(),
        raw: (tag(x, 'description') || tag(x, 'summary') || tag(x, 'content')).slice(0, 600) };
    }).filter(i => i.title && /^https?:\/\//.test(i.link));
    console.log(`feed ${source}: ${items.length} items`);
    return items;
  } catch (e) { console.warn(`feed ${source} failed: ${e.message}`); return []; }
}

// Recent 8-K filings for one company, titled from the filing's own item list.
async function fetchEdgar([ticker, name]) {
  const url = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${ticker}&type=8-K&dateb=&owner=include&count=5&output=atom`;
  const items = await fetchFeed(['SEC EDGAR', url, 'Stocks & Markets'], SEC_UA);
  return items.map(i => {
    const parts = [...i.raw.matchAll(/Item \d+\.\d+:\s*([^<]+?)(?=\s*Item \d+\.\d+:|$)/g)].map(m => m[1].trim()).filter(t => !/Financial Statements and Exhibits/i.test(t));
    return { ...i, company: name, ticker, title: `${name} files 8-K${parts.length ? ': ' + parts.slice(0, 2).join('; ') : ''}`, raw: `${name} (${ticker}) SEC Form 8-K current report. ${i.raw}`.slice(0, 600) };
  });
}

// Free models, best candidates first: JSON-capable, non-reasoning, larger context.
async function freeModels() {
  try {
    const r = await fetch('https://openrouter.ai/api/v1/models');
    const { data } = await r.json();
    const score = m => {
      const p = m.supported_parameters || [];
      return (p.includes('structured_outputs') || p.includes('response_format') ? 2 : 0) + (p.includes('reasoning') ? 0 : 1);
    };
    return data
      .filter(m => m.id.endsWith(':free') && (m.context_length || 0) >= 32000)
      .sort((a, b) => score(b) - score(a) || (b.context_length || 0) - (a.context_length || 0))
      .map(m => m.id);
  } catch { return []; }
}

// Pull the JSON array/object out of a model reply, tolerating fences, wrappers and trailing text.
function parseJson(txt, want = 'array') {
  txt = txt.replace(/```(?:json)?/g, '').trim();
  try {
    const v = JSON.parse(txt);
    if (want === 'object') return v;
    if (Array.isArray(v)) return v;
    const a = Object.values(v || {}).find(Array.isArray); if (a) return a;
  } catch {}
  const [open, close] = want === 'array' ? ['[', ']'] : ['{', '}'];
  const start = txt.indexOf(open);
  if (start < 0) throw new Error(`no JSON ${want} in reply`);
  for (let end = txt.lastIndexOf(close); end > start; end = txt.lastIndexOf(close, end - 1)) {
    try { return JSON.parse(txt.slice(start, end + 1)); } catch {}
  }
  throw new Error(`could not parse JSON ${want} from reply`);
}

let modelOrder = null;
async function ask(prompt, want, accept) {
  if (!modelOrder) {
    const available = await freeModels();
    const pinned = (process.env.OPENROUTER_MODEL || '').split(',').map(s => s.trim()).filter(Boolean);
    const wanted = [...pinned, ...PREFERRED.filter(m => !available.length || available.includes(m))];
    modelOrder = [...new Set([...wanted, ...available])].slice(0, 8);
    console.log(`models to try: ${modelOrder.join(', ') || '(none)'}`);
  }
  for (const model of modelOrder) {
    try {
      const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://news.worksmarto.com', 'X-Title': 'Worksmarto AI News' },
        body: JSON.stringify({ model, temperature: 0.4, max_tokens: 7000, reasoning: { effort: 'low', exclude: true }, messages: [{ role: 'user', content: prompt }] }),
        signal: AbortSignal.timeout(240000),
      });
      const j = await r.json();
      if (!r.ok) { console.warn(`${model} -> ${r.status} ${JSON.stringify(j.error || j).slice(0, 200)}`); continue; }
      const choice = j.choices?.[0] || {};
      const txt = choice.message?.content || '';
      if (!txt.trim()) { console.warn(`${model} returned no text (finish_reason: ${choice.finish_reason || 'unknown'})`); continue; }
      let out;
      try { out = parseJson(txt, want); } catch (e) { console.warn(`${model} failed: ${e.message} (finish_reason: ${choice.finish_reason || 'unknown'}) reply starts: ${JSON.stringify(txt.slice(0, 160))}`); continue; }
      if (!accept(out)) { console.warn(`${model} reply had no usable entries`); continue; }
      // Keep the model that worked at the front for the rest of this run.
      modelOrder = [model, ...modelOrder.filter(m => m !== model)];
      return { model, out };
    } catch (e) { console.warn(`${model} failed: ${e.message}`); }
  }
  return { model: null, out: null };
}

async function summarise(items) {
  const prompt = `You are the editor of "Worksmarto AI News", a daily AI news page for busy freelancers, founders and small-business owners.
For EACH item return an object with:
"id": same id,
"relevant": false if the item is not really about AI (e.g. a stock story with no AI angle), else true,
"section": one of ${JSON.stringify(SECTIONS)},
"hook": one curiosity-sparking line, max 14 words, that makes a busy reader want the story. Must be true to the item: no invented numbers, no clickbait, no emojis, not a repeat of the title,
"summary": what happened, plain English, max 40 words, no hype,
"why": why it matters to a freelancer or small business, max 22 words,
"takeaway": one practical next step or thing to watch, max 18 words, starting with a verb. For stock or market items never give buy/sell advice; say what to watch instead,
"impact": "big" (changes how many people work, or a major market move), "notable", or "fyi",
"forYou": true if a freelancer could use or act on this within a week,
"company": main company involved, or "",
"ticker": its US stock ticker if it is a listed company and the item is about markets or business, else "",
"tags": up to 3 short lowercase tags.
Use only facts in the item. Paraphrase; never copy sentences.
Respond with ONLY a JSON array, no markdown.

ITEMS:
${JSON.stringify(items.map(({ id, title, source, hint, raw }) => ({ id, source, title, section_hint: hint, text: raw })))}`;
  const { model, out } = await ask(prompt, 'array', a => Array.isArray(a) && a.some(o => o && o.id));
  const map = Object.fromEntries((out || []).filter(o => o && o.id).map(o => [o.id, o]));
  if (model) console.log(`summarised ${Object.keys(map).length}/${items.length} with ${model}`);
  return { model, map };
}

async function brief(items) {
  const prompt = `Write today's 3-bullet brief for "Worksmarto AI News" (readers: freelancers, founders, small businesses).
Each bullet: max 22 words, plain English, the most important AI developments from the stories below, no hype, no emojis, only facts given.
Respond with ONLY JSON: {"headline": "max 9 words", "bullets": ["three", "short", "strings"]}

STORIES:
${JSON.stringify(items.map(i => ({ title: i.title, summary: i.summary, impact: i.impact, section: i.section })))}`;
  const { model, out } = await ask(prompt, 'object', o => o && Array.isArray(o.bullets) && o.bullets.length);
  return model ? { date: new Date().toISOString(), model, headline: String(out.headline || 'Today in AI'), bullets: out.bullets.slice(0, 3).map(String) } : null;
}

const clip = (s, n) => { const w = (s || '').split(' '); return w.length > n ? w.slice(0, n).join(' ') + '…' : s; };
const readMins = s => Math.max(1, Math.round((s || '').split(' ').length / 200 + 2));

// ---- run ----
const prev = JSON.parse(await readFile(DATA, 'utf8').catch(() => '{"items":[]}'));
// v1 stored OpenAI stories with path-only ids; move them to host+path ids.
const known = new Map((prev.items || []).map(i => {
  if (i.id.startsWith('/')) i = { ...i, id: idOf(i.link), source: i.source || 'OpenAI' };
  return [i.id, i];
}));
const skipped = new Set(prev.skipped || []);

// Drop stories stored from sources that are no longer summarised (news publishers etc.).
for (const [id, i] of known) if (!ALLOWED.has(i.source || 'OpenAI')) known.delete(id);

const all = [...(await Promise.all(OFFICIAL.map(f => fetchFeed(f)))).flat(), ...(await Promise.all(EDGAR.map(fetchEdgar))).flat()];
const cutoff = Date.now() - MAX_AGE_DAYS * 864e5, filingCutoff = Date.now() - FILING_AGE_DAYS * 864e5;
const perSource = {};
const fresh = [];
for (const i of all.sort((a, b) => b.date.localeCompare(a.date))) {
  if (known.has(i.id) || skipped.has(i.id) || Date.parse(i.date) < (i.source === 'SEC EDGAR' ? filingCutoff : cutoff)) continue;
  if (fresh.some(f => f.id === i.id || similar(f.title, i.title)) || [...known.values()].some(k => similar(k.title, i.title))) continue;
  if ((perSource[i.source] || 0) >= PER_SOURCE) continue;
  perSource[i.source] = (perSource[i.source] || 0) + 1;
  fresh.push(i);
}
// Stored stories that still need (re)summarising: failed before, or older format.
const redo = [...known.values()].filter(i => !i.ai || (i.v || 1) < SCHEMA)
  .map(i => ({ id: i.id, source: i.source || 'OpenAI', hint: SECTIONS.includes(i.section) ? i.section : 'Models', title: i.title, link: i.link, date: i.date, raw: i.raw || i.summary || '' }));
const queue = [...fresh.slice(0, MAX_NEW), ...redo.slice(0, MAX_REDO)];
console.log(`${fresh.length} new, ${redo.length} to redo, ${queue.length} queued`);

let model = prev.model || null;
if (!KEY) console.warn('OPENROUTER_API_KEY missing — storing feed text without summaries');
for (let b = 0; KEY && b < queue.length; b += BATCH) {
  const batch = queue.slice(b, b + BATCH);
  const { model: m, map } = await summarise(batch);
  if (m) model = m;
  for (const i of batch) {
    const s = map[i.id];
    if (s && s.relevant === false) { known.delete(i.id); skipped.add(i.id); continue; }
    if (!s && known.has(i.id)) continue; // keep the stored version, retry next run
    known.set(i.id, story(i, s));
  }
}
if (!KEY) for (const i of fresh) known.set(i.id, story(i, null));

function story(i, s) {
  return {
    id: i.id, title: i.title, link: i.link, date: i.date, source: i.source,
    section: SECTIONS.includes(s?.section) ? s.section : i.hint,
    hook: s?.hook || '', summary: s?.summary || clip(i.raw, 40), why: s?.why || '', takeaway: s?.takeaway || '',
    impact: IMPACT.includes(s?.impact) ? s.impact : 'fyi', forYou: Boolean(s?.forYou),
    company: s?.company || i.company || '', ticker: /^[A-Z.]{1,6}$/.test(s?.ticker || '') ? s.ticker : (i.ticker || ''),
    tags: Array.isArray(s?.tags) ? s.tags.slice(0, 3).map(String) : [],
    readMins: readMins(i.raw), ...(s ? {} : { raw: i.raw }), ai: Boolean(s?.summary), v: s ? SCHEMA : 1,
  };
}

const items = [...known.values()].sort((a, b) => b.date.localeCompare(a.date)).slice(0, KEEP);

let daily = prev.brief || null;
if (KEY && queue.length) {
  const recent = items.filter(i => i.ai && Date.parse(i.date) > Date.now() - 2 * 864e5);
  const pool = (recent.length >= 3 ? recent : items.filter(i => i.ai)).slice(0, 15);
  if (pool.length) daily = (await brief(pool)) || daily;
}

// "Elsewhere in AI": publisher headlines exactly as published, with source and link.
const fresh_h = (await Promise.all(PUBLISHERS.map(f => fetchFeed([f[0], f[1], ''])))).flat()
  .map(({ source, title, link, date }) => ({ source, title, link, date }));
const per = {};
const headlines = [...fresh_h, ...(prev.headlines || [])]
  .filter(h => Date.parse(h.date) > Date.now() - 3 * 864e5)
  .sort((a, b) => b.date.localeCompare(a.date))
  .filter((h, n, arr) => arr.findIndex(x => x.link === h.link || similar(x.title, h.title)) === n)
  .filter(h => (per[h.source] = (per[h.source] || 0) + 1) <= HEADLINES_PER_SOURCE)
  .slice(0, HEADLINES_KEEP);
console.log(`${headlines.length} publisher headlines`);

await writeFile(DATA, JSON.stringify({ updated: new Date().toISOString(), model, brief: daily, items, headlines, skipped: [...skipped].slice(-500) }, null, 2) + '\n');
console.log(`wrote ${items.length} items (${items.filter(i => i.ai).length} with AI summaries)`);
