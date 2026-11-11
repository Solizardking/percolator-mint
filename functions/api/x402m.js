// Read-only proxy for Musebook x402m public discovery (musebook.trade only allows its own origin via CORS).
// Never sends, registers, links or reads a private inbox.
const SOURCES = {
  discovery: 'https://musebook.trade/api/x402m/discovery',
  agents: 'https://musebook.trade/api/x402m/agents',
  tracking: 'https://musebook.trade/api/v1/x402m/tracking?limit=30',
};
export async function onRequestGet({ request }) {
  const what = new URL(request.url).searchParams.get('what') || 'agents';
  const src = SOURCES[what];
  if (!src) return new Response(JSON.stringify({ error: 'unknown view' }), { status: 400, headers: { 'content-type': 'application/json' } });
  const r = await fetch(src, { headers: { accept: 'application/json' }, cf: { cacheTtl: 60 } });
  return new Response(await r.text(), { status: r.status, headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=60', 'x-source': src } });
}
