// Atomic counters in D1. A row at its limit is not updated, so RETURNING yields nothing => limited.
export async function bump(db, key, limit, ttlSec) {
  const now = Math.floor(Date.now() / 1000);
  const row = await db.prepare(
    `INSERT INTO counters (k, n, exp) VALUES (?1, 1, ?2)
     ON CONFLICT(k) DO UPDATE SET n = n + 1 WHERE n < ?3 RETURNING n`
  ).bind(key, now + ttlSec, limit).first();
  return row ? row.n : null;
}
export async function peek(db, key) {
  const row = await db.prepare('SELECT n FROM counters WHERE k = ?1').bind(key).first();
  return row ? row.n : 0;
}
export const utcDay = () => new Date().toISOString().slice(0, 10);
export const utcHour = () => new Date().toISOString().slice(0, 13);
export async function ipKey(request) {
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('percolator-mint:' + ip));
  return [...new Uint8Array(d)].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('');
}
export async function sweep(db) {
  await db.prepare('DELETE FROM counters WHERE exp < ?1').bind(Math.floor(Date.now() / 1000)).run();
}
