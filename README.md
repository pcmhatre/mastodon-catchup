# 🐘 Mastodon Catchup

A web app that reads your Mastodon home timeline and uses Claude AI to generate a colorful, narrative summary of what everyone's been talking about — links, images, and all.

## Features

- **Narrative summaries** — Claude writes a vivid, friendly recap in 4–6 short paragraphs, not a dry bullet list
- **Link context** — fetches OG previews for shared URLs so the summary includes what the links are actually about
- **Image alt text** — pulls descriptions from attached images and folds them into the narrative
- **Time range toggle** — choose the last 6h, 12h, or 24h of posts
- **Full timeline pagination** — fetches your entire timeline for the selected window, not just the first page
- **Copy as Markdown or Plain Text** — one-click copy in either format

## Setup

### 1. Clone and install

```bash
git clone https://github.com/pcmhatre/mastodon-catchup.git
cd mastodon-catchup
npm install
```

### 2. Configure environment variables

```bash
cp .env.example .env
```

Edit `.env` with your values:

```
MASTODON_INSTANCE=your.instance.social
MASTODON_ACCESS_TOKEN=your_access_token_here
ANTHROPIC_API_KEY=your_anthropic_api_key_here
```

**Getting a Mastodon access token:**
1. Go to `https://<your-instance>/settings/applications`
2. Create a new application with `read` scope
3. Copy the access token from the app detail page

**Getting an Anthropic API key:**
- Sign up at [console.anthropic.com](https://console.anthropic.com)
- Note: the Anthropic API requires separate credits from a Claude Pro subscription

### 3. Run locally

```bash
npm run dev   # runs with --watch on http://localhost:3000
```

## Deploy to Vercel

The repo includes a `vercel.json` config. Connect it to Vercel via the dashboard or CLI, then add the three environment variables under **Project Settings → Environment Variables**.

Any push to `main` triggers an automatic redeployment.

## Tech stack

- **Backend:** Node.js + Express (ES modules)
- **AI:** [Anthropic SDK](https://github.com/anthropic-ai/anthropic-sdk-js) — `claude-sonnet-4-6`
- **Scraping:** [Cheerio](https://cheerio.js.org/) for HTML parsing and link preview extraction
- **Frontend:** Vanilla HTML/CSS/JS, no framework
- **Hosting:** Vercel (`@vercel/node`)
