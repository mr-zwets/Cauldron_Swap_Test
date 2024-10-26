import { Artifact, Contract, ElectrumNetworkProvider, TransactionBuilder } from 'cashscript';
// The cauldronArtifact contains a template variable <withdraw_pkh>
import cauldronArtifact from './artifact.json' with { type: 'json' };
import { CauldronActivePool, CauldronGetActivePools } from './interfaces';
import { convertPoolToUtxo } from './utils';

const provider = new ElectrumNetworkProvider('mainnet');

export function cauldronContractWithPkh(pkhHex:string){
  const strigifiedCauldronArtifact = JSON.stringify(cauldronArtifact);
  return JSON.parse(strigifiedCauldronArtifact.replace('<withdraw_pkh>', pkhHex)) as Artifact
}

export async function getCauldronUtxos(tokenId:string){ 
  const result = await fetch(`https://indexer.cauldron.quest/cauldron/pool/active?token=${tokenId}`)
  const jsonResult = await result.json() as CauldronGetActivePools
  return jsonResult
}

export async function parsePoolPrices(pools:CauldronActivePool[]){
  return pools.map(pool => {
    const { tokens, sats } = pool;
    const priceSatsPerToken = tokens / sats;
    return { price: priceSatsPerToken, pool };
  })
}

export async function buyTokensPool(pool:CauldronActivePool){
  const transactionBuilder = new TransactionBuilder({ provider });

  // Add the cauldron pool as an input to the transactionBuilder
  const cauldronUtxo = convertPoolToUtxo(pool);
  const options = { provider, addressType:'p2sh32' as const };
  const cauldronContract = new Contract(cauldronContractWithPkh(pool.owner_pkh), [], options);
  transactionBuilder.addInput(cauldronUtxo, cauldronContract.unlock.swap())

  // TODO: add other inputs and outputs
  // including the user input to pay for the bought tokens
}