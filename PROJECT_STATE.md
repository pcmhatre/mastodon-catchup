# Mastodon Catchup — Project State

## What This Is
A web app that reads your Mastodon home timeline, fetches link previews for shared URLs, and uses Claude to generate a colorful narrative summary. Output is shown in a copyable text box (plain text or Markdown).

## Live URLs
- **Production:** https://mastodon-catchup.vercel.app
- **GitHub:** https://github.com/pcmhatre/mastodon-catchup
- **Vercel project:** pcmhatres-projects/mastodon-catchup
- **Vercel project ID:** `prj_XeH62mzOk8gGMnlBhpNctLOZPCiO`
- **Vercel team ID:** `team_V6Uh8abBy4UH30JiiR8dEsmY`

## Stack
- **Backend:** Node.js + Express (ES modules, `"type": "module"`)
- **Frontend:** Single `public/index.html`, no framework
- **AI:** Anthropic SDK (`@anthropic-ai/sdk`), model `claude-sonnet-4-6`
- **Hosting:** Vercel via `@vercel/node` builder (legacy `builds` config in `vercel.json`)
- **Deployment:** Auto-deploys from `main` branch on GitHub push

## File Structure
```
mastodon-catchup/
├── server.js          # Express backend (all API routes)
├── public/
│   ├── index.html     # Full frontend (HTML + CSS + JS in one file)
│   └── favicon.svg    # Official Mastodon logo SVG
├── vercel.json        # Vercel deployment config, maxDuration: 60
├── package.json       # ES module, node --watch for dev
├── .env               # Local only (gitignored)
└── .env.example       # Template for env vars
```

## Environment Variables (set in Vercel dashboard)
| Variable | Description |
|---|---|
| `MASTODON_INSTANCE` | e.g. `mastodon.social` — no `https://` prefix |
| `MASTODON_ACCESS_TOKEN` | OAuth token with `read:statuses` scope |
| `ANTHROPIC_API_KEY` | Must be from the same Anthropic workspace that has billing credits |

## API Endpoints
| Method | Path | Description |
|---|---|---|
| `GET` | `/api/health` | Returns config status (bool flags per env var) |
| `GET` | `/api/timeline?hours=N` | Fetches all home timeline posts in last N hours, plus link previews |
| `POST` | `/api/summarize` | Sends posts + previews to Claude, returns `{ narrative: "..." }` |

## Current Features
- **Time range toggle:** 6h / 12h / 24h buttons (default: 12h), passed as `?hours=N` to `/api/timeline`
- **Full pagination:** Fetches all posts in the selected window (no post count cap)
- **Link previews:** Fetches OG title + description for up to 40 unique URLs (parallel, 6s timeout each)
- **Alt text:** Extracts `description` from Mastodon media attachments
- **Boosts:** Resolved to original post content; boost author noted in digest
- **Content warnings:** Prepended as `[CW: ...]` to post text
- **Narrative format:** 4–6 short paragraphs (2–4 sentences each) + "**Key topics:**" line
- **Copy buttons:** Copy Markdown (raw) or Plain Text (strips `**`, `*`, headers, etc.)
- **Digest truncation:** Claude prompt capped at 120,000 chars to stay within context limits
- **Favicon:** Official Mastodon SVG logo (purple gradient)
- **Config card hidden:** Health check still runs on load to enable/disable the button, but UI is not shown

## Known Issues / Open Questions
- **Post count caps at ~318:** Even with no code-side limit, the timeline stops at ~318 posts. Believed to be a Mastodon server-side home feed storage cap (many instances cache only ~400 recent statuses in Redis). No workaround found yet — pagination logging added to confirm the cause (`[timeline] stopped: empty batch` vs `hit cutoff`).

## Constraints & Gotchas

### Vercel / Serverless
- **No SSE streaming.** `@vercel/node` serverless functions buffer all `res.write()` calls; the entire response is sent at once when `res.end()` is called. SSE-style streaming silently produces a blank result on the client. Use plain `res.json()` instead.
- **`maxDuration` placement.** Set inside `builds[].config` in `vercel.json`, not at the top level. Effective value is 60s.
- **Env vars need redeployment.** Adding/changing env vars in the Vercel dashboard does not apply to existing deployments. A new push (or manual redeploy) is required.
- **`node` not in shell PATH.** On this machine, `/usr/local/bin/node` exists but `#!/usr/bin/env node` shebangs fail unless `$HOME/.local/bin/node` is symlinked. The Vercel CLI was installed with `npm install -g vercel --ignore-scripts` and run as `PATH="$HOME/.local/bin:$PATH" $HOME/.npm-global/bin/vercel`.

### Anthropic API
- **Separate billing from Claude Pro.** The claude.ai Pro subscription does not cover API usage. Credits must be purchased at console.anthropic.com under the same workspace as the API key in use.
- **Workspace mismatch.** If the API key belongs to a different Anthropic workspace than where credits were purchased, calls fail with a "credit balance too low" 400 error even if billing shows a balance.

### Mastodon API
- **No handle needed.** The access token is tied to the account; `/api/v1/timelines/home` returns that account's home timeline automatically.
- **Boosts use `status.created_at`** (the boost time), not `status.reblog.created_at` (original post time), for the 24h cutoff check. This is intentional.
- **Link extraction skips hashtags/mentions** by checking the `class` attribute on `<a>` tags (`hashtag`, `mention`).
- **Some instances cap home timeline depth** server-side (often ~400 statuses in Redis), so pagination stops before the 24h cutoff is reached. This is not a code bug.

### Claude Prompt
- **Digest size.** With many posts, the prompt can get large. Truncation at 120,000 chars is applied before sending to Claude.
- **Model:** `claude-sonnet-4-6` — update here if migrating to a newer version.

## Local Dev
```bash
cp .env.example .env   # fill in your values
node --watch server.js # runs on http://localhost:3000
```
