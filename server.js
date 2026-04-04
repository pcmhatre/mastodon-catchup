import Anthropic from '@anthropic-ai/sdk';
import axios from 'axios';
import * as cheerio from 'cheerio';
import dotenv from 'dotenv';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = Number(process.env.PORT || 3000);

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Strip HTML tags to plain text
function stripHtml(html) {
  const $ = cheerio.load(html);
  $('br').replaceWith('\n');
  $('p').after('\n');
  return $.text().replace(/\n{3,}/g, '\n\n').trim();
}

// Extract outbound links from post HTML (skip hashtags and mentions)
function extractLinks(html) {
  const $ = cheerio.load(html);
  const links = new Set();
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const cls = $(el).attr('class') || '';
    // Skip hashtag links, mention links, and Mastodon-internal links
    if (
      href.startsWith('http') &&
      !cls.includes('hashtag') &&
      !cls.includes('mention') &&
      !$(el).find('.mention').length
    ) {
      links.add(href);
    }
  });
  return [...links];
}

// Fetch a link and return its title + description for context
async function fetchLinkPreview(url) {
  try {
    const response = await axios.get(url, {
      timeout: 6000,
      maxContentLength: 300_000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; MastodonCatchup/1.0; +https://github.com/mastodon-catchup)',
        'Accept': 'text/html,application/xhtml+xml'
      },
      responseType: 'text'
    });

    const contentType = response.headers['content-type'] || '';
    if (!contentType.includes('text/html')) return null;

    const $ = cheerio.load(response.data);

    const title = (
      $('meta[property="og:title"]').attr('content') ||
      $('meta[name="twitter:title"]').attr('content') ||
      $('title').text()
    ).trim();

    const description = (
      $('meta[property="og:description"]').attr('content') ||
      $('meta[name="twitter:description"]').attr('content') ||
      $('meta[name="description"]').attr('content') ||
      ''
    ).trim();

    // Grab some body text if description is missing
    let bodyText = '';
    if (!description) {
      $('article p, main p, .content p').each((_, el) => {
        const t = $(el).text().trim();
        if (t.length > 50) {
          bodyText += t + ' ';
          if (bodyText.length > 400) return false;
        }
      });
    }

    return {
      url,
      title: title.slice(0, 200),
      description: (description || bodyText).slice(0, 400)
    };
  } catch {
    return null;
  }
}

// GET /api/health
app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    config: {
      hasMastodonInstance: Boolean(process.env.MASTODON_INSTANCE),
      hasMastodonToken: Boolean(process.env.MASTODON_ACCESS_TOKEN),
      hasAnthropicKey: Boolean(process.env.ANTHROPIC_API_KEY)
    }
  });
});

// GET /api/timeline — fetch home timeline posts from the last 24 hours
app.get('/api/timeline', async (req, res) => {
  const instance = process.env.MASTODON_INSTANCE;
  const token = process.env.MASTODON_ACCESS_TOKEN;

  if (!instance || !token) {
    return res.status(400).json({ error: 'MASTODON_INSTANCE and MASTODON_ACCESS_TOKEN are required in .env' });
  }

  try {
    const cutoffMs = Date.now() - 24 * 60 * 60 * 1000;
    const posts = [];
    let maxId = null;
    let reachedCutoff = false;

    // Paginate until we've fetched all posts in the last 24h
    while (!reachedCutoff) {
      const params = { limit: 40 };
      if (maxId) params.max_id = maxId;

      const { data: batch } = await axios.get(
        `https://${instance}/api/v1/timelines/home`,
        {
          headers: { Authorization: `Bearer ${token}` },
          params,
          timeout: 12000
        }
      );

      if (!batch.length) break;

      for (const status of batch) {
        const createdMs = new Date(status.created_at).getTime();
        if (createdMs < cutoffMs) {
          reachedCutoff = true;
          break;
        }

        // Resolve boosts to the original post for content
        const original = status.reblog || status;
        const isBoosted = Boolean(status.reblog);

        const text = stripHtml(original.content);
        if (!text) continue; // skip empty posts

        const links = extractLinks(original.content);
        const altTexts = (original.media_attachments || [])
          .filter(m => m.description && m.description.trim())
          .map(m => m.description.trim());

        const cw = original.spoiler_text ? `[CW: ${original.spoiler_text}] ` : '';

        posts.push({
          id: original.id,
          author: original.account.acct,
          displayName: original.account.display_name || original.account.acct,
          boostedBy: isBoosted ? status.account.acct : null,
          text: cw + text,
          links: links.slice(0, 3), // max 3 links per post
          altTexts,
          createdAt: original.created_at,
          url: original.url
        });
      }

      maxId = batch[batch.length - 1].id;
    }

    // Fetch link previews for unique links (cap at 40 to avoid overload)
    const allLinks = [...new Set(posts.flatMap(p => p.links))].slice(0, 40);
    const linkPreviews = {};

    await Promise.allSettled(
      allLinks.map(async url => {
        const preview = await fetchLinkPreview(url);
        if (preview) linkPreviews[url] = preview;
      })
    );

    res.json({ posts, linkPreviews, count: posts.length });
  } catch (err) {
    const status = err.response?.status || 500;
    res.status(status).json({ error: err.response?.data?.error || err.message });
  }
});

// POST /api/summarize — stream a Claude narrative of the timeline
app.post('/api/summarize', async (req, res) => {
  const { posts, linkPreviews } = req.body;

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(400).json({ error: 'ANTHROPIC_API_KEY is required in .env' });
  }

  if (!posts || !posts.length) {
    return res.status(400).json({ error: 'No posts to summarize' });
  }

  // Build a structured digest for Claude
  const digest = posts.map((p, i) => {
    const who = p.boostedBy
      ? `@${p.boostedBy} boosted @${p.author} (${p.displayName})`
      : `@${p.author} (${p.displayName})`;

    let entry = `[${i + 1}] ${who}:\n${p.text}`;

    if (p.altTexts.length) {
      entry += `\n  📷 Image descriptions: ${p.altTexts.join(' | ')}`;
    }

    if (p.links.length) {
      const linkLines = p.links.map(url => {
        const preview = linkPreviews[url];
        if (preview?.title || preview?.description) {
          return `  🔗 ${preview.title || url}${preview.description ? ' — ' + preview.description : ''}`;
        }
        return `  🔗 ${url}`;
      });
      entry += '\n' + linkLines.join('\n');
    }

    return entry;
  }).join('\n\n---\n\n');

  // Claude's context window is large but the digest can get huge with many posts.
  // Truncate at ~120k chars (well within the 200k token limit) to stay safe.
  const truncatedDigest = digest.length > 120000
    ? digest.slice(0, 120000) + '\n\n[digest truncated due to length]'
    : digest;

  const systemPrompt = `You are a warm, witty, and enthusiastic narrator who recaps social media timelines. Your style is like a clever friend catching you up over coffee — colorful, vivid, occasionally funny, and genuinely engaged with the content. You notice patterns, highlight interesting links, quote memorable lines, and capture the overall vibe of the conversation. You use concrete names and topics, never vague summaries.`;

  const userPrompt = `Here are ${posts.length} posts from my Mastodon home timeline in the last 24 hours. Write a fun, colorful narrative summary broken into **4–6 short paragraphs** (2–4 sentences each) that captures:
- The main topics and vibes people are discussing
- Any notable links or articles being shared (with context)
- Interesting images or visual content (from alt text)
- The overall energy and mood of the timeline

Keep the total length the same as you would for a 1–2 paragraph summary — just split it into more, shorter paragraphs so it's easier to read. Make it feel alive and personal. Use specific names, quote fun phrases, and be descriptive. Then add a final "**Key topics:**" line with the main themes as a comma-separated list.

Here's the timeline:

${truncatedDigest}`;

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    console.log(`[summarize] calling Claude with ${posts.length} posts`);
    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1200,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    console.log(`[summarize] stop_reason=${message.stop_reason} content_blocks=${message.content.length}`);
    const narrative = message.content[0]?.text || '';
    console.log(`[summarize] narrative length=${narrative.length}`);
    res.json({ narrative });
  } catch (err) {
    console.error(`[summarize] error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

app.listen(port, () => {
  console.log(`\n🐘 Mastodon Catchup running at http://localhost:${port}\n`);
});
