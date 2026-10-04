// Worksmarto AI News — daily updater. Node 20+, zero dependencies.
// Fetches OpenAI's public news feed, summarises only NEW items with a free
// OpenRouter model (one batched request per run), and writes data/news.json.
import { readFile, writeFile } from 'node:fs/promises';

const DATA = new URL('../data/news.json', import.meta.url);
const FEEDS = ['https://openai.com/news/rss.xml', 'https://openai.com/blog/rss.xml'];
const KEEP = 60;          // items kept on the page
const MAX_NEW = 10;       // items summarised per run (free tier: ~50 req/day)
const CATEGORIES = ['Product', 'Research', 'Safety', 'API & Developers', 'Company', 'Policy'];
// Preferred free models, tried in order. If all fail, any other :free model is tried.
const PREFERRED = [
  'meta-llama/llama-3.3-70b-instruct:free',
  'deepseek/deepseek-chat-v3-0324:free',
  'google/gemma-3-27b-it:free',
  'mistralai/mistral-small-3.2-24b-instruct:free',
];
const KEY = process.env.OPENROUTER_API_KEY;

const decode = s => (s || '')
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ')
  .replace(/\s+/g, ' ').trim();
const tag = (xml, t) => { const m = xml.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`, 'i')); return m ? decode(m[1]) : ''; };
const idOf = link => link.replace(/^https?:\/\/[^/]+/, '').replace(/\/+$/, '') || link;

async function fetchFeed() {
  for (const url of FEEDS) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'Worksmarto-AI-News/1.0 (+https://news.worksmarto.com)', Accept: 'application/rss+xml, application/xml' } });
      if (!r.ok) { console.warn(`feed ${url} -> ${r.status}`); continue; }
      const xml = await r.text();
      const items = [...xml.matchAll(/<item[\s>][\s\S]*?<\/item>/gi)].map(([x]) => {
        const link = tag(x, 'link') || tag(x, 'guid');
        return { id: idOf(link), title: tag(x, 'title'), link, date: new Date(tag(x, 'pubDate') || Date.now()).toISOString(),
          feedCategory: tag(x, 'category'), raw: tag(x, 'description').slice(0, 700) };
      }).filter(i => i.title && i.link);
      if (items.length) { console.log(`feed ok: ${url} (${items.length} items)`); return items; }
    } catch (e) { console.warn(`feed ${url} failed: ${e.message}`); }
  }
  throw new Error('No feed reachable');
}

// Free models, best candidates first: ones that support JSON output and don't
// spend the token budget on hidden reasoning, then larger context windows.
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

// Pull the JSON array out of a model reply, tolerating fences, wrapper objects and trailing text.
function parseArray(txt) {
  txt = txt.replace(/```(?:json)?/g, '').trim();
  try { const v = JSON.parse(txt); if (Array.isArray(v)) return v; const a = Object.values(v || {}).find(Array.isArray); if (a) return a; } catch {}
  const start = txt.indexOf('[');
  if (start < 0) throw new Error('no JSON array in reply');
  for (let end = txt.lastIndexOf(']'); end > start; end = txt.lastIndexOf(']', end - 1)) {
    try { return JSON.parse(txt.slice(start, end + 1)); } catch {}
  }
  throw new Error('could not parse JSON array from reply');
}

async function summarise(items) {
  if (!KEY) { console.warn('OPENROUTER_API_KEY missing — using feed text'); return { model: null, out: {} }; }
  const available = await freeModels();
  // OPENROUTER_MODEL (repo variable, comma-separated) pins models to try first.
  const pinned = (process.env.OPENROUTER_MODEL || '').split(',').map(s => s.trim()).filter(Boolean);
  const wanted = [...pinned, ...PREFERRED.filter(m => !available.length || available.includes(m))];
  const order = [...new Set([...wanted, ...available])].slice(0, 8);
  console.log(`models to try: ${order.join(', ') || '(none)'}`);
  const prompt = `You write for "Worksmarto AI News", a news page for busy freelancers and founders.
For EACH item return an object: {"id": same id, "summary": plain-English summary, max 45 words, no hype,
"why": one line on why it matters to a freelancer or small business, max 20 words,
"category": one of ${JSON.stringify(CATEGORIES)}, "tags": up to 3 short lowercase tags}.
Use only facts in the item. Do not invent numbers, dates or quotes. Paraphrase; never copy sentences.
Respond with ONLY a JSON array, no markdown.

ITEMS:
${JSON.stringify(items.map(({ id, title, raw, feedCategory }) => ({ id, title, category_hint: feedCategory, text: raw })))}`;

  for (const model of order) {
    try {
      const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://news.worksmarto.com', 'X-Title': 'Worksmarto AI News' },
        body: JSON.stringify({ model, temperature: 0.3, max_tokens: 6000, reasoning: { effort: 'low', exclude: true }, messages: [{ role: 'user', content: prompt }] }),
        signal: AbortSignal.timeout(120000),
      });
      const j = await r.json();
      if (!r.ok) { console.warn(`${model} -> ${r.status} ${JSON.stringify(j.error || j).slice(0, 200)}`); continue; }
      const choice = j.choices?.[0] || {};
      const txt = choice.message?.content || '';
      if (!txt.trim()) { console.warn(`${model} returned no text (finish_reason: ${choice.finish_reason || 'unknown'})`); continue; }
      let arr;
      try { arr = parseArray(txt); } catch (e) { console.warn(`${model} failed: ${e.message} (finish_reason: ${choice.finish_reason || 'unknown'}) reply starts: ${JSON.stringify(txt.slice(0, 160))}`); continue; }
      const out = Object.fromEntries(arr.filter(o => o && o.id).map(o => [o.id, o]));
      console.log(`summarised ${Object.keys(out).length}/${items.length} with ${model}`);
      if (!Object.keys(out).length) continue;
      return { model, out };
    } catch (e) { console.warn(`${model} failed: ${e.message}`); }
  }
  return { model: null, out: {} };
}

const clip = (s, n) => { const w = (s || '').split(' '); return w.length > n ? w.slice(0, n).join(' ') + '…' : s; };

const prev = JSON.parse(await readFile(DATA, 'utf8').catch(() => '{"items":[]}'));
const known = new Map((prev.items || []).map(i => [i.id, i]));
const feed = await fetchFeed();
// New items, plus earlier ones still showing feed text because summarising failed.
const fresh = feed.filter(i => !known.has(i.id) || known.get(i.id).ai === false).slice(0, MAX_NEW);
console.log(`${fresh.length} item(s) to summarise`);

let model = prev.model || null;
if (fresh.length) {
  const res = await summarise(fresh);
  if (res.model) model = res.model;
  for (const i of fresh) {
    const s = res.out[i.id] || {};
    known.set(i.id, {
      id: i.id, title: i.title, link: i.link, date: i.date,
      category: CATEGORIES.includes(s.category) ? s.category : (i.feedCategory || 'Company'),
      summary: s.summary || clip(i.raw, 45),
      why: s.why || '',
      tags: Array.isArray(s.tags) ? s.tags.slice(0, 3).map(String) : [],
      ai: Boolean(s.summary),
    });
  }
}

const items = [...known.values()].sort((a, b) => b.date.localeCompare(a.date)).slice(0, KEEP);
await writeFile(DATA, JSON.stringify({ updated: new Date().toISOString(), model, source: 'openai.com/news', items }, null, 2) + '\n');
console.log(`wrote ${items.length} items`);
