// Simulate-only (sigVerify:false), unsigned: $CLAWD Attributes mirror on the devnet rehearsal asset, plus
// API + direct mints carrying the tokens list. Never signs with a wallet, never sends.
import { CLUSTERS, URI_V3, DEVNET_REHEARSAL_ASSET as ASSET, CLAWD_ATTRIBUTES, agentMetadata } from '../src/agent-config.js';
import { simulate, assertCluster } from '../src/txsim.js';
import * as F from '../src/flows.js';
const DEV = 'GKKmEVjHbAp4jePLJRqALYLjTLbT4rHNQA6c394dKC91';
const RPC = CLUSTERS.devnet.rpc;
await assertCluster(RPC, 'devnet');
const umi = F.makeUmi(RPC, DEV);
const out = { asset: ASSET, payer: DEV };
out.before = await F.attributesStatus(umi, { asset: ASSET });
const wire = await F.buildAttributesMirror(umi, { asset: ASSET });
const s = await simulate(RPC, wire, [DEV, ASSET]);
const dec = s.ok ? F.decodeAttributes(ASSET, s.accounts[1].postAccount) : null;
out.attributes = { ok: s.ok, err: s.err, cu: s.unitsConsumed, feeLamports: s.feeLamports, programs: s.programs, feePayer: s.feePayer,
  signers: s.signersRequired, assetBytesBefore: null, assetLamports: [s.accounts[1].pre, s.accounts[1].post],
  walletDelta: s.accounts[0].pre - s.accounts[0].post, totalLamports: s.accounts[0].pre - s.accounts[0].post + (s.feeLamports || 0),
  decoded: dec, allClawdKeys: !!dec && CLAWD_ATTRIBUTES.every((c) => dec.attributes.some((a) => a.key === c.key && a.value === c.value)),
  logsTail: s.ok ? undefined : s.logs.slice(-8) };
try {
  const m = await F.buildApiMint(umi, { wallet: DEV, cluster: 'devnet', uri: URI_V3 });
  const sm = await simulate(RPC, m.wire, [DEV, m.assetAddress, m.identityPda]);
  out.apiMint = { ok: sm.ok, err: sm.err, cu: sm.unitsConsumed, tokensSent: m.input.agentMetadata.tokens, total: sm.accounts[0].pre - sm.accounts[0].post + (sm.feeLamports || 0) };
} catch (e) { out.apiMint = { error: e.message }; }
const d = await F.buildDirectMint(umi, { wallet: DEV, uri: URI_V3 });
const sd = await simulate(RPC, d.wire, [DEV, d.assetAddress, d.identityPda]);
const dd = sd.ok ? F.decodeAsset(d.assetAddress, sd.accounts[1].postAccount) : null;
out.directMint = { ok: sd.ok, err: sd.err, uri: dd?.uri, identityUri: dd?.agentIdentities?.[0]?.uri, total: sd.accounts[0].pre - sd.accounts[0].post + (sd.feeLamports || 0) };
out.agentMetadataTokens = agentMetadata().tokens;
console.log(JSON.stringify(out, null, 1));
