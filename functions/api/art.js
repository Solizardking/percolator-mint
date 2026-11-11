// POST /api/art  -> generates one Percolator / $CLAWD agent image with xAI (key stays server-side).
// GET  /api/art  -> remaining daily budget. Abuse limits: per-IP per-hour, per-IP per-day, global daily cap.
import { bump, peek, utcDay, utcHour, ipKey, sweep } from '../../lib/limits.js';

const STYLE_REF = 'https://trade.percolator.tech/logo-badge.png';
const MODEL = 'grok-imagine-image-2.0';
const BASE = 'Official agent avatar for "Percolator", the $CLAWD perpetual-futures trading agent on Solana. ' +
  'Keep the style, palette and coffee-percolator mascot of the reference badge. Square, centered emblem, bold clean outlines, ' +
  'dark background, warm orange and amber glow. No text, no letters, no ticker symbols, no other coins or logos.';
const PRESETS = {
  badge: BASE + ' A polished circular badge: the percolator brewing glowing green and red candlestick charts as steam.',
  terminal: BASE + ' The percolator mascot in front of a trading terminal with long/short arrows and a funding-rate gauge.',
  claw: BASE + ' The percolator mascot with a stylised lobster claw handle, perps order book lines radiating behind it.',
};
const ALLOWED_ORIGINS = ['https://mint.percolator.tech', 'https://percolator-mint.pages.dev'];
const json = (o, s = 200, h = {}) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...h } });

function originOk(request) {
  const o = request.headers.get('origin') || '';
  return ALLOWED_ORIGINS.includes(o) || /^https:\/\/[a-z0-9]+\.percolator-mint\.pages\.dev$/.test(o);
}

export async function onRequestGet({ env }) {
  const cap = Number(env.DAILY_CAP || 50);
  const used = await peek(env.LIMITS, 'day:' + utcDay());
  return json({ model: MODEL, presets: Object.keys(PRESETS), dailyCap: cap, usedToday: used, remainingToday: Math.max(0, cap - used),
    perIpPerHour: Number(env.IP_PER_HOUR || 3), perIpPerDay: Number(env.IP_PER_DAY || 6), resetsAt: new Date(Date.parse(utcDay()) + 86400000).toISOString() });
}

export async function onRequestPost({ request, env }) {
  if (!originOk(request)) return json({ error: 'origin not allowed' }, 403);
  if (!env.XAI_API_KEY) return json({ error: 'art generation is not configured' }, 503);
  let body = {};
  try { body = await request.json(); } catch {}
  const preset = PRESETS[body.preset] ? body.preset : 'badge';

  if (Math.random() < 0.1) await sweep(env.LIMITS).catch(() => {});
  const ip = await ipKey(request);
  const hour = await bump(env.LIMITS, `ip:${ip}:${utcHour()}`, Number(env.IP_PER_HOUR || 3), 7200);
  if (hour === null) return json({ error: 'rate limited: too many generations from your network this hour' }, 429, { 'retry-after': '3600' });
  const ipday = await bump(env.LIMITS, `ipday:${ip}:${utcDay()}`, Number(env.IP_PER_DAY || 6), 172800);
  if (ipday === null) return json({ error: 'rate limited: daily limit for your network reached' }, 429);
  const day = await bump(env.LIMITS, 'day:' + utcDay(), Number(env.DAILY_CAP || 50), 172800);
  if (day === null) return json({ error: 'daily generation cap reached; try again after 00:00 UTC' }, 429);

  const headers = { 'content-type': 'application/json', authorization: `Bearer ${env.XAI_API_KEY}` };
  const prompt = PRESETS[preset];
  // Prefer an edit with the badge as style reference; fall back to plain generation if edits are refused.
  let r = await fetch('https://api.x.ai/v1/images/edits', { method: 'POST', headers,
    body: JSON.stringify({ model: MODEL, prompt, image: { url: STYLE_REF, type: 'image_url' }, response_format: 'b64_json' }) });
  let mode = 'edit(style-ref)';
  if (!r.ok && r.status >= 400 && r.status < 500 && r.status !== 429) {
    mode = 'generate';
    r = await fetch('https://api.x.ai/v1/images/generations', { method: 'POST', headers,
      body: JSON.stringify({ model: MODEL, prompt, response_format: 'b64_json' }) });
  }
  if (!r.ok) return json({ error: `image API error ${r.status}` }, 502);
  const j = await r.json();
  const d = j.data?.[0] || {};
  let b64 = d.b64_json, mime = 'image/jpeg';
  if (!b64 && d.url) {
    const img = await fetch(d.url);
    if (!img.ok) return json({ error: 'could not fetch generated image' }, 502);
    mime = img.headers.get('content-type') || mime;
    const buf = new Uint8Array(await img.arrayBuffer());
    let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    b64 = btoa(s);
  }
  if (!b64) return json({ error: 'image API returned no image' }, 502);
  return json({ ok: true, model: MODEL, mode, preset, mime, image: b64, revisedPrompt: d.revised_prompt ?? null,
    usedToday: day, dailyCap: Number(env.DAILY_CAP || 50), styleReference: STYLE_REF });
}
