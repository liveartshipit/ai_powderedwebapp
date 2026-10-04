# Worksmarto AI News — news.worksmarto.com

OpenAI news in two minutes a day. Static site on GitHub Pages; a GitHub Actions cron (06:00 IST) fetches OpenAI's public RSS feed, summarises only new items with a free OpenRouter model (one batched request per run), commits `data/news.json`, and redeploys.

## Setup (one time)
1. Settings → Secrets and variables → Actions → New secret: `OPENROUTER_API_KEY`
2. Settings → Pages → Source: **GitHub Actions**
3. Actions → "Daily AI News update" → **Run workflow** (first edition)
4. DNS: CNAME `news` → `liveartshipit.github.io`, then Settings → Pages → custom domain `news.worksmarto.com` + Enforce HTTPS

## Stack
- Backend: GitHub Actions (free cron) + JSON in repo
- AI: OpenRouter `:free` models, auto-fallback across 6 models
- Frontend: vanilla HTML/CSS/JS, no build step
