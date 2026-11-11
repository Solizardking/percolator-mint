// Generic simulate-first quoting for ANY transaction bytes before the wallet sees them.
import { VersionedTransaction } from '@solana/web3.js';
import { CLUSTERS } from './agent-config.js';

export async function rpc(url, method, params) {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const j = await r.json();
  if (j.error) throw new Error(`${method}: ${j.error.message}`);
  return j.result;
}
export const b64 = (u8) => (typeof Buffer !== 'undefined' ? Buffer.from(u8).toString('base64') : btoa(Array.from(u8, (c) => String.fromCharCode(c)).join('')));
export const unb64 = (s) => (typeof Buffer !== 'undefined' ? new Uint8Array(Buffer.from(s, 'base64')) : Uint8Array.from(atob(s), (c) => c.charCodeAt(0)));

export async function assertCluster(rpcUrl, cluster) {
  const g = await rpc(rpcUrl, 'getGenesisHash', []);
  if (g !== CLUSTERS[cluster].genesis) throw new Error(`RPC genesis ${g} does not match ${cluster}. Refusing.`);
  return g;
}

/** Simulate wire bytes; report fee payer, programs, fee, CU, lamport deltas of watched accounts. */
export async function simulate(rpcUrl, wire, watch = []) {
  const vtx = VersionedTransaction.deserialize(wire);
  const msg = vtx.message;
  const keys = msg.staticAccountKeys.map((k) => k.toBase58());
  const programs = [...new Set(msg.compiledInstructions.map((ix) => keys[ix.programIdIndex]))];
  const usesLookupTables = (msg.addressTableLookups || []).length > 0;
  const signersRequired = keys.slice(0, msg.header.numRequiredSignatures);
  const presentSigs = vtx.signatures.map((s) => s.some((b) => b !== 0));
  const watchList = [...new Set(watch.filter(Boolean))];
  const pre = watchList.length ? (await rpc(rpcUrl, 'getMultipleAccounts', [watchList, { encoding: 'base64', commitment: 'confirmed' }])).value : [];
  const sim = (await rpc(rpcUrl, 'simulateTransaction', [b64(wire), { encoding: 'base64', sigVerify: false, replaceRecentBlockhash: true,
    commitment: 'confirmed', accounts: { encoding: 'base64', addresses: watchList } }])).value;
  const fee = (await rpc(rpcUrl, 'getFeeForMessage', [b64(msg.serialize()), { commitment: 'confirmed' }])).value;
  const accounts = watchList.map((a, i) => ({ address: a, pre: pre[i]?.lamports ?? 0, post: sim.accounts?.[i]?.lamports ?? 0,
    existedBefore: !!pre[i], existsAfter: !!(sim.accounts?.[i] && sim.accounts[i].lamports > 0), postAccount: sim.accounts?.[i] || null }));
  return { ok: !sim.err, err: sim.err, logs: sim.logs || [], unitsConsumed: sim.unitsConsumed, feeLamports: fee,
    feePayer: keys[0], programs, usesLookupTables, signersRequired, presentSigs, accounts };
}

export async function sendSigned(rpcUrl, signedBytes) {
  return rpc(rpcUrl, 'sendTransaction', [b64(signedBytes), { encoding: 'base64', skipPreflight: false, preflightCommitment: 'confirmed' }]);
}
export async function confirm(rpcUrl, sig, tries = 40) {
  for (let i = 0; i < tries; i++) {
    const s = (await rpc(rpcUrl, 'getSignatureStatuses', [[sig]])).value[0];
    if (s?.err) throw new Error('tx failed: ' + JSON.stringify(s.err));
    if (s && (s.confirmationStatus === 'confirmed' || s.confirmationStatus === 'finalized')) return s;
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error('not confirmed in time');
}
