// Shared builder: Metaplex Core asset + Agent Identity (ERC-8004) registration in ONE tx.
// No server, no keys: the only private key is the throwaway asset keypair generated in the browser,
// which signs only its own account creation. The connected wallet is payer, owner and authority.
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { generateSigner, createNoopSigner, publicKey as pk } from '@metaplex-foundation/umi';
import { mplCore, create, deserializeAssetV1 } from '@metaplex-foundation/mpl-core';
import { mplAgentIdentity, registerIdentityV1, findAgentIdentityV2Pda } from '@metaplex-foundation/mpl-agent-registry';
import { toWeb3JsTransaction } from '@metaplex-foundation/umi-web3js-adapters';

export const NAME = 'Percolator';
export const URI = 'https://arweave.net/4ZnXT2_B59DsyQzuV-SouhvhBqxeIVY1Rp6goUvwn78';
export const PROGRAMS = {
  core: 'CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d',
  agentIdentity: '1DREGFgysWYxLnRnKQnwrxnJQeSMk2HmGaC6whw2B2p',
};
export const CLUSTERS = {
  'mainnet-beta': { rpc: 'https://solana-rpc.publicnode.com', explorer: '', genesis: '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d' },
  devnet: { rpc: 'https://api.devnet.solana.com', explorer: '?cluster=devnet', genesis: 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG' },
};

async function rpc(url, method, params) {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const j = await r.json();
  if (j.error) throw new Error(`${method}: ${j.error.message}`);
  return j.result;
}
const b64 = (u8) => (typeof Buffer !== 'undefined' ? Buffer.from(u8).toString('base64')
  : btoa(String.fromCharCode(...u8)));
const unb64 = (s) => (typeof Buffer !== 'undefined' ? new Uint8Array(Buffer.from(s, 'base64'))
  : Uint8Array.from(atob(s), (c) => c.charCodeAt(0)));

/** Build the unsigned-by-wallet tx (asset keypair already signed) and a simulated quote. */
export async function buildAndQuote({ rpcUrl, wallet, cluster }) {
  const genesis = await rpc(rpcUrl, 'getGenesisHash', []);
  if (cluster && CLUSTERS[cluster] && genesis !== CLUSTERS[cluster].genesis)
    throw new Error(`RPC genesis ${genesis} does not match ${cluster}. Refusing.`);
  const umi = createUmi(rpcUrl).use(mplCore()).use(mplAgentIdentity());
  const payer = createNoopSigner(pk(wallet));     // wallet signs later, in the wallet UI
  umi.identity = payer; umi.payer = payer;
  const asset = generateSigner(umi);              // ephemeral, browser-only, signs its own creation
  const identityPda = findAgentIdentityV2Pda(umi, { asset: asset.publicKey })[0];

  // No updateAuthority, no collection, no plugins beyond AgentIdentity: owner = update authority = wallet.
  const builder = create(umi, { asset, name: NAME, uri: URI, owner: pk(wallet) })
    .add(registerIdentityV1(umi, { asset: asset.publicKey, agentRegistrationUri: URI }));

  const built = await builder.buildWithLatestBlockhash(umi);
  const signed = await asset.signTransaction(built);   // partial: asset signature only
  const wire = umi.transactions.serialize(signed);
  const msgB64 = b64(signed.serializedMessage);

  const preBal = await rpc(rpcUrl, 'getBalance', [wallet, { commitment: 'confirmed' }]);
  const sim = await rpc(rpcUrl, 'simulateTransaction', [b64(wire), {
    encoding: 'base64', sigVerify: false, replaceRecentBlockhash: true, commitment: 'confirmed',
    accounts: { encoding: 'base64', addresses: [wallet, asset.publicKey.toString(), identityPda.toString()] },
  }]);
  const fee = (await rpc(rpcUrl, 'getFeeForMessage', [msgB64, { commitment: 'confirmed' }])).value;
  const v = sim.value;
  const quote = {
    ok: !v.err, err: v.err, logs: v.logs, unitsConsumed: v.unitsConsumed,
    cluster: cluster ?? null, genesis, wallet, asset: asset.publicKey.toString(), agentIdentityPda: identityPda.toString(),
    walletBalanceLamports: preBal.value, feeLamports: fee,
  };
  if (!v.err && v.accounts) {
    const [w, a, p] = v.accounts;
    quote.assetRentLamports = a?.lamports ?? 0;
    quote.identityRentLamports = p?.lamports ?? 0;
    quote.rentLamports = quote.assetRentLamports + quote.identityRentLamports;
    // total = new-account rent + network fee (balance delta of a busy wallet can race, so it is informational only)
    quote.totalLamports = quote.rentLamports + (fee ?? 0);
    quote.payerDeltaSimulatedLamports = preBal.value - (w?.lamports ?? preBal.value);
    try {
      const decoded = deserializeAssetV1({ publicKey: asset.publicKey, executable: false,
        owner: pk(PROGRAMS.core), lamports: { basisPoints: BigInt(a.lamports), identifier: 'SOL', decimals: 9 },
        data: unb64(a.data[0]) });
      quote.decoded = {
        name: decoded.name, uri: decoded.uri, owner: decoded.owner.toString(),
        updateAuthority: { type: decoded.updateAuthority.type, address: decoded.updateAuthority.address?.toString() ?? null },
        agentIdentities: (decoded.agentIdentities || []).map((x) => ({ uri: x.uri, lifecycleChecks: x.lifecycleChecks })),
        pluginKeys: Object.keys(decoded).filter((k) => !['publicKey','header','key','owner','updateAuthority','name','uri','seq'].includes(k)),
      };
    } catch (e) { quote.decodeError = String(e); }
  }
  return { quote, wire, web3Tx: () => toWeb3JsTransaction(signed) };
}

export async function sendSigned(rpcUrl, signedBytes) {
  const sig = await rpc(rpcUrl, 'sendTransaction', [b64(signedBytes), { encoding: 'base64', skipPreflight: false, preflightCommitment: 'confirmed' }]);
  return sig;
}
export async function confirm(rpcUrl, sig, tries = 40) {
  for (let i = 0; i < tries; i++) {
    const s = (await rpc(rpcUrl, 'getSignatureStatuses', [[sig]])).value[0];
    if (s && (s.confirmationStatus === 'confirmed' || s.confirmationStatus === 'finalized')) return s;
    if (s?.err) throw new Error('tx failed: ' + JSON.stringify(s.err));
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error('not confirmed in time');
}
