// Minimal ANS-104 data item (signature type 2 = ed25519) + ArDrive Turbo free-tier upload.
// The signer is a FRESH THROWAWAY ed25519 key generated per upload, held only in memory,
// never funded and discarded after use. Turbo uploads under ~105 KiB are free, so no funds are needed.
import { ed25519 } from '@noble/curves/ed25519';
import { sha256, sha384 } from '@noble/hashes/sha2';

export const TURBO_UPLOAD = 'https://upload.ardrive.io/v1/tx/solana';
export const FREE_LIMIT = 105 * 1024; // keep under Turbo's 107,520-byte free limit with headroom
const te = new TextEncoder();
const cat = (...a) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of a) { o.set(x, i); i += x.length; } return o; };
const u16le = (n) => new Uint8Array([n & 255, (n >> 8) & 255]);
const u64le = (n) => { const o = new Uint8Array(8); let v = BigInt(n); for (let i = 0; i < 8; i++) { o[i] = Number(v & 255n); v >>= 8n; } return o; };
const b64url = (u8) => { let s = ''; for (const c of u8) s += String.fromCharCode(c); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };

function deepHash(d) {
  if (Array.isArray(d)) {
    let acc = sha384(cat(te.encode('list'), te.encode(String(d.length))));
    for (const c of d) acc = sha384(cat(acc, deepHash(c)));
    return acc;
  }
  const tag = cat(te.encode('blob'), te.encode(String(d.length)));
  return sha384(cat(sha384(tag), sha384(d)));
}
// Avro array<record{name:bytes,value:bytes}> encoding used by ANS-104 tags
function zz(n) { let v = BigInt(n) << 1n; const out = []; while (v >= 0x80n) { out.push(Number((v & 0x7fn) | 0x80n)); v >>= 7n; } out.push(Number(v)); return new Uint8Array(out); }
function avroTags(tags) {
  if (!tags.length) return new Uint8Array(0);
  const parts = [zz(tags.length)];
  for (const { name, value } of tags) { const n = te.encode(name), v = te.encode(value); parts.push(zz(n.length), n, zz(v.length), v); }
  parts.push(new Uint8Array([0]));
  return cat(...parts);
}

/** Build + sign a data item with a brand-new throwaway key. Returns { id, bytes, owner }. */
export function buildDataItem(data, tags) {
  const sk = ed25519.utils.randomPrivateKey();
  const owner = ed25519.getPublicKey(sk);
  const tagBytes = avroTags(tags);
  const msg = deepHash([te.encode('dataitem'), te.encode('1'), te.encode('2'), owner, new Uint8Array(0), new Uint8Array(0), tagBytes, data]);
  const sig = ed25519.sign(msg, sk);
  sk.fill(0); // discard the throwaway key
  const bytes = cat(u16le(2), sig, owner, new Uint8Array([0]), new Uint8Array([0]), u64le(tags.length), u64le(tagBytes.length), tagBytes, data);
  return { id: b64url(sha256(sig)), bytes, owner: b64url(owner) };
}

export async function turboUpload(data, contentType, extraTags = []) {
  if (data.length > FREE_LIMIT) throw new Error(`File is ${data.length} bytes; Turbo free tier is under ${FREE_LIMIT}. Compress it first.`);
  const item = buildDataItem(data, [{ name: 'Content-Type', value: contentType }, { name: 'App-Name', value: 'percolator-mint' }, ...extraTags]);
  const r = await fetch(TURBO_UPLOAD, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: item.bytes });
  const t = await r.text();
  if (!r.ok) throw new Error(`Turbo upload failed ${r.status}: ${t.slice(0, 300)}`);
  const j = JSON.parse(t);
  if (j.id !== item.id) throw new Error(`Turbo returned id ${j.id}, expected ${item.id}`);
  return { id: j.id, url: `https://arweave.net/${j.id}`, receipt: j };
}
