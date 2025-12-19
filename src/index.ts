import {
  Contract,
  ElectrumNetworkProvider,
  type NetworkProvider,
  type Recipient,
  SignatureTemplate,
  TransactionBuilder,
  type Utxo,
} from 'cashscript';
import type { CauldronActivePool, CauldronGetActivePools } from './interfaces.js';
import { cauldronArtifactWithPkh, convertPoolToUtxo } from './utils.js';

export const CAULDRON_INDEXER_URL = 'https://indexer.cauldron.quest/cauldron';

export async function getCauldronPools(tokenId:string){ 
  const result = await fetch(`${CAULDRON_INDEXER_URL}/active?token=${tokenId}`)
  return (await result.json() as CauldronGetActivePools).active
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
  userTokenAddress:string,
  privateKeyWif:string,
  provider:NetworkProvider = new ElectrumNetworkProvider('mainnet')
){
  const cauldronUtxo = convertPoolToUtxo(pool);
  const userUtxos = await provider.getUtxos(userTokenAddress);
  const userBchUtxos = userUtxos.filter(utxo => !utxo.token)
  const userBalanceSats = userBchUtxos.reduce((total, utxo) => total += utxo.satoshis, 0n);

  // Add the cauldron pool as an input to the transactionBuilder
  // The cauldronArtifact contains a template variable <withdraw_pkh> which we need to replace
  const options = { provider, addressType:'p2sh32' as const };
  const cauldronArtifact = cauldronArtifactWithPkh(pool.owner_pkh)
  const cauldronContract = new Contract(cauldronArtifact, [], options);

  // calculate tradeValue and poolFee
  const poolConstant = pool.tokens * pool.sats
  const cauldronNewAmountSatsExludingFee = Math.ceil(poolConstant / (pool.tokens - amountToBuy))
  const tradeValue = Math.abs(cauldronNewAmountSatsExludingFee - pool.sats)
  const poolFee = Math.floor(tradeValue / 1000 * 3)

  // calculate user input amount
  const userInputAmountNeeded = BigInt(tradeValue + poolFee) + 1000n
  if(userBalanceSats < userInputAmountNeeded) throw new Error('Insufficient funds to buy tokens')
  const sortedUserBchUtxos = userBchUtxos.sort((a, b) => Number(a.satoshis) - Number(b.satoshis))

  // add needed userInputs to the transactionBuilder
  let userSatsInInputs = 0n
  let userInputs:Utxo[]= []
  for(const userUtxo of sortedUserBchUtxos){
    userSatsInInputs += userUtxo.satoshis
    userInputs.push(userUtxo)
    if(userSatsInInputs >= userInputAmountNeeded) break
  }

  const newCauldronAmountSats = cauldronNewAmountSatsExludingFee + poolFee
  const newCauldronAmountTokens = Math.ceil(poolConstant / cauldronNewAmountSatsExludingFee)

  const cauldronOuput:Recipient = {
    to: cauldronContract.tokenAddress,
    amount: BigInt(newCauldronAmountSats),
    token: {
      category: pool.token_id,
      amount: BigInt(newCauldronAmountTokens)
    }
  }

  const boughtTokensOutput:Recipient = {
    to: userTokenAddress,
    amount: 1000n,
    token: {
      category: pool.token_id,
      amount: BigInt(amountToBuy)
    }
  }

  const minerFee = 400n + 200n * BigInt(userInputs.length)
  const userChangeOutput:Recipient  = {
    to: userTokenAddress,
    amount: userSatsInInputs - userInputAmountNeeded - minerFee
  }

  const userTemplate = new SignatureTemplate(privateKeyWif)

  // Transaction builiding with the simple transaction builder to enable debugging
  const txid = await new TransactionBuilder({provider})
    .addInput(cauldronUtxo, cauldronContract.unlock.swap())
    .addInputs(userInputs, userTemplate.unlockP2PKH())
    .addOutputs([cauldronOuput, boughtTokensOutput, userChangeOutput])
    .send()
  return txid
}

export async function withdrawAllFromPool(
  pool:CauldronActivePool,
  userTokenAddress:string,
  privateKeyWif:string,
  provider:NetworkProvider = new ElectrumNetworkProvider('mainnet')
){
  const cauldronUtxo = convertPoolToUtxo(pool);

  // Add the cauldron pool as an input to the transactionBuilder
  // The cauldronArtifact contains a template variable <withdraw_pkh> which we need to replace
  // add 'false' to use the managePool artifact
  const options = { provider, addressType:'p2sh32' as const };
  const cauldronArtifact = cauldronArtifactWithPkh(pool.owner_pkh, false)
  const cauldronContract = new Contract(cauldronArtifact, [], options);

  const minerFee = 500n
  const bchOutputAmount = BigInt(pool.sats) - 1000n - minerFee

  const userBchOutput:Recipient = {
    to: userTokenAddress,
    amount: bchOutputAmount
  }

  const userTokenOutput:Recipient = {
    to: userTokenAddress,
    amount: 1000n,
    token: {
      category: pool.token_id,
      amount: BigInt(pool.tokens)
    }
  }
  
  const ownerTemplate = new SignatureTemplate(privateKeyWif)
  const ownerPk = ownerTemplate.getPublicKey()
  
  const txid = await new TransactionBuilder({provider})
    .addInput(cauldronUtxo, cauldronContract.unlock.managePool(ownerPk, ownerTemplate))
    .addOutputs([userBchOutput, userTokenOutput])
    .send()
  return txid
}