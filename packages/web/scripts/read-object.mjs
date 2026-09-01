// Read one on-chain object over gRPC. The desk's own read path — JSON-RPC on public fullnodes is
// deprecated ("Method not found") and the Master's standing order is gRPC only. Read-only: no key,
// no signing, no side effects. Usage: node read-object.mjs <objectId> [network]
import { SuiGrpcClient } from '@mysten/sui/grpc';
const [id, network = 'mainnet'] = process.argv.slice(2);
if (!id) { console.error('usage: read-object.mjs <objectId> [network]'); process.exit(2); }
const baseUrl = { mainnet: 'https://fullnode.mainnet.sui.io:443', testnet: 'https://fullnode.testnet.sui.io:443' }[network];
if (!baseUrl) { console.error(`unknown network ${network}`); process.exit(2); }
const client = new SuiGrpcClient({ network, baseUrl });
const res = await client.core.getObject({ objectId: id, include: ['json'] });
const o = res.object;
console.log(JSON.stringify({ objectId: o.id ?? id, version: o.version, type: o.type, owner: o.owner, fields: o.json ?? null }, (_k, v) => typeof v === 'bigint' ? v.toString() : v, 2));
