// Simulate-only, unsigned devnet E2E for v2 flows. Never signs with a wallet, never sends.
import { CLUSTERS, URI_V2 as URI_V1, DEVNET_REHEARSAL_ASSET as ASSET, PROGRAMS } from '../src/agent-config.js';
import { simulate, assertCluster } from '../src/txsim.js';
import * as F from '../src/flows.js';
const DEV = 'GKKmEVjHbAp4jePLJRqALYLjTLbT4rHNQA6c394dKC91';
const RPC = CLUSTERS.devnet.rpc;
const SOL = (l) => (l / 1e9).toFixed(9) + ' SOL';
const out = {};
await assertCluster(RPC, 'devnet');
const umi = F.makeUmi(RPC, DEV);
const short = (s) => ({ ok: s.ok, err: s.err, fee: s.feeLamports, cu: s.unitsConsumed, feePayer: s.feePayer, programs: s.programs, lut: s.usesLookupTables,
  signers: s.signersRequired.map((k, i) => `${k}${s.presentSigs[i] ? ' (pre-signed)' : ' (needs wallet)'}`),
  deltas: s.accounts.map((a) => `${a.address}: ${a.existedBefore ? 'exists' : 'new'} ${SOL(a.pre)} -> ${SOL(a.post)}`), tail: s.ok ? undefined : s.logs.slice(-6) });

// 1. Metaplex API mint (mintAgent) on devnet
try {
  const m = await F.buildApiMint(umi, { wallet: DEV, cluster: 'devnet', uri: URI_V1 });
  const s = await simulate(RPC, m.wire, [DEV, m.assetAddress, m.identityPda]);
  const dec = F.decodeAsset(m.assetAddress, s.accounts[1].postAccount);
  out.apiMint = { assetAddress: m.assetAddress, ...short(s), decoded: dec,
    rentLamports: s.accounts[1].post + s.accounts[2].post, totalLamports: s.accounts[1].post + s.accounts[2].post + s.feeLamports };
} catch (e) { out.apiMint = { error: e.message, body: e.responseBody }; }

// 2. Status + executive/delegate/revoke against the existing rehearsal asset, executive = dev wallet
out.statusBefore = await F.delegationStatus(RPC, umi, { asset: ASSET, executiveAuthority: DEV });
const reg = await simulate(RPC, await F.buildRegisterExecutive(umi), [DEV, out.statusBefore.executiveProfile]);
out.registerExecutive = short(reg);
// delegate needs the executive profile to exist; simulate register+delegate as one bundle is not possible, so
// we report delegate's simulation (expected to fail with "profile missing" until dev registers the profile).
const del = await simulate(RPC, await F.buildDelegate(umi, { asset: ASSET, executiveAuthority: DEV }), [DEV, out.statusBefore.delegateRecord]);
out.delegate = short(del);
const rev = await simulate(RPC, await F.buildRevoke(umi, { asset: ASSET, executiveAuthority: DEV }), [DEV, out.statusBefore.delegateRecord]);
out.revoke = short(rev);

// 3. x402 panel reads
out.signer = await F.signerBalances(RPC, umi, { asset: ASSET, cluster: 'devnet' });
try { out.mechStatus = await F.fetchMechStatus(ASSET); } catch (e) { out.mechStatus = { error: e.message }; }
try { await F.buildMech('approve', { asset: ASSET, owner: DEV }); out.mechApproveBuild = 'built'; } catch (e) { out.mechApproveBuild = { error: e.message }; }
console.log(JSON.stringify(out, null, 1));
