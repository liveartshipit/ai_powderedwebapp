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

async function freeModels() {
  try {
    const r = await fetch('https://openrouter.ai/api/v1/models');
    const { data } = await r.json();
    return data.filter(m => m.id.endsWith(':free')).map(m => m.id);
  } catch { return []; }
}

async function summarise(items) {
  if (!KEY) { console.warn('OPENROUTER_API_KEY missing — using feed text'); return { model: null, out: {} }; }
  const available = await freeModels();
  const order = [...PREFERRED.filter(m => !available.length || available.includes(m)), ...available.filter(m => !PREFERRED.includes(m))].slice(0, 6);
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
        body: JSON.stringify({ model, temperature: 0.3, max_tokens: Math.min(250 * items.length + 200, 3000), messages: [{ role: 'user', content: prompt }] }),
      });
      const j = await r.json();
      if (!r.ok) { console.warn(`${model} -> ${r.status} ${JSON.stringify(j.error || j).slice(0, 200)}`); continue; }
      let txt = j.choices?.[0]?.message?.content || '';
      txt = txt.replace(/```json|```/g, '').trim();
      const arr = JSON.parse(txt.slice(txt.indexOf('['), txt.lastIndexOf(']') + 1));
      const out = Object.fromEntries(arr.filter(o => o && o.id).map(o => [o.id, o]));
      console.log(`summarised ${Object.keys(out).length}/${items.length} with ${model}`);
      return { model, out };
    } catch (e) { console.warn(`${model} failed: ${e.message}`); }
  }
  return { model: null, out: {} };
}

const clip = (s, n) => { const w = (s || '').split(' '); return w.length > n ? w.slice(0, n).join(' ') + '…' : s; };

const prev = JSON.parse(await readFile(DATA, 'utf8').catch(() => '{"items":[]}'));
const known = new Map((prev.items || []).map(i => [i.id, i]));
const feed = await fetchFeed();
const fresh = feed.filter(i => !known.has(i.id)).slice(0, MAX_NEW);
console.log(`${fresh.length} new item(s)`);

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
