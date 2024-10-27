import { Artifact, Contract, ElectrumNetworkProvider, Output, TransactionBuilder } from 'cashscript';
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
    return { price: priceSatsPerToken, ...pool };
  })
}

export async function buyTokensPool(
  pool:CauldronActivePool,
  amountToBuy:number,
  userAddress:string
){
  const cauldronUtxo = convertPoolToUtxo(pool);
  const UserUtxos = await provider.getUtxos(userAddress);
  const userBalanceSats = UserUtxos.reduce((total, utxo) => 
    utxo?.token? total : total += utxo.satoshis
  , 0n);

  const transactionBuilder = new TransactionBuilder({ provider });

  // Add the cauldron pool as an input to the transactionBuilder
  const options = { provider, addressType:'p2sh32' as const };
  const cauldronContract = new Contract(cauldronContractWithPkh(pool.owner_pkh), [], options);
  transactionBuilder.addInput(cauldronUtxo, cauldronContract.unlock.swap())

  const poolConstant = pool.tokens * pool.sats
  const cauldronAmountExludingFee = Math.ceil(poolConstant / (pool.tokens - amountToBuy))
  const tradeValue = Math.abs(cauldronAmountExludingFee - pool.sats)
  const poolFee = 0.3 * tradeValue
  const newCauldronAmountSats = cauldronAmountExludingFee + poolFee
  const newCauldronAmountTokens = poolConstant / newCauldronAmountSats

  const cauldronOuput: Output = {
    to: cauldronContract.address,
    amount: BigInt(newCauldronAmountSats),
    token: {
      category: pool.token_id,
      amount: BigInt(newCauldronAmountTokens)
    }
  }
  transactionBuilder.addOutput(cauldronOuput)

  const boughtTokensOutput:Output = {
    to: userAddress,
    amount: 1000n,
    token: {
      category: pool.token_id,
      amount: BigInt(amountToBuy)
    }
  }
  transactionBuilder.addOutput(boughtTokensOutput)

  // TODO: add user inputs and change output
}