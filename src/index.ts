import {
  Contract,
  ElectrumNetworkProvider,
  SignatureTemplate,
  TransactionBuilder,
  type NetworkProvider,
  type Recipient,
  type Utxo,
} from 'cashscript';
import { binToHex, hash160 } from '@bitauth/libauth'
import type { CauldronActivePool, CauldronGetActivePools } from './interfaces.js';
import { cauldronArtifactWithPkh, convertPoolToUtxo } from './utils.js';

export type CauldronNetwork = 'mainnet' | 'chipnet';

export const CAULDRON_INDEXER_URLS: Record<CauldronNetwork, string> = {
  mainnet: 'https://indexer.cauldron.quest/cauldron',
  chipnet: 'https://indexer-chipnet.riften.net/cauldron',
};

export async function getCauldronPools(tokenId:string, network:CauldronNetwork = 'mainnet'){
  const indexerUrl = CAULDRON_INDEXER_URLS[network];
  const result = await fetch(`${indexerUrl}/pool/active?token=${tokenId}`)
  const data = await result.json() as CauldronGetActivePools
  return data.active
}

export async function parsePoolPrices(pools:CauldronActivePool[]){
  return pools.map(pool => {
    const { tokens, sats } = pool;
    const priceSatsPerToken = tokens / sats;
    return { ...pool, price: priceSatsPerToken };
  })
}

export async function buyTokensPool(
  pool:CauldronActivePool,
  amountToBuy:number,
  userTokenAddress:string,
  privateKeyWif:string,
  provider:NetworkProvider = new ElectrumNetworkProvider('mainnet')
){
  // convert pool object to UTXO format
  const cauldronUtxo = convertPoolToUtxo(pool);

  // Does not explicitly validate user address to be a token address, but will fail later if not

  // fetch user UTXOs
  const userUtxos = await provider.getUtxos(userTokenAddress);
  const userBchUtxos = userUtxos.filter(utxo => !utxo.token)
  const userBalanceSats = userBchUtxos.reduce((total, utxo) => total += utxo.satoshis, 0n);

  // Get the specific cauldron contract for the selected pool (based on owner pkh)
  const cauldronArtifact = cauldronArtifactWithPkh(pool.owner_pkh)
  const options = { provider, addressType:'p2sh32' as const };
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
  let userInputs:Utxo[] = []
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
  const userChangeOutput:Recipient = {
    to: userTokenAddress,
    amount: userSatsInInputs - userInputAmountNeeded - minerFee
  }

  const userTemplate = new SignatureTemplate(privateKeyWif)

  const txDetails = await new TransactionBuilder({ provider })
    .addInput(cauldronUtxo, cauldronContract.unlock.swap())
    .addInputs(userInputs, userTemplate.unlockP2PKH())
    .addOutputs([cauldronOuput, boughtTokensOutput, userChangeOutput])
    .send()
  return txDetails
}

export async function sellTokensPool(
  pool:CauldronActivePool,
  amountToSell:number,
  userTokenAddress:string,
  privateKeyWif:string,
  provider:NetworkProvider = new ElectrumNetworkProvider('mainnet')
){
  // convert pool object to UTXO format
  const cauldronUtxo = convertPoolToUtxo(pool);

  // fetch user UTXOs
  const userUtxos = await provider.getUtxos(userTokenAddress);
  const userTokenUtxos = userUtxos.filter(utxo => utxo.token?.category === pool.token_id)
  const userBchUtxos = userUtxos.filter(utxo => !utxo.token)
  const userTokenBalance = userTokenUtxos.reduce((total, utxo) => total += utxo.token!.amount, 0n);

  if(userTokenBalance < BigInt(amountToSell)) throw new Error('Insufficient tokens to sell')

  // Get the specific cauldron contract for the selected pool (based on owner pkh)
  const cauldronArtifact = cauldronArtifactWithPkh(pool.owner_pkh)
  const options = { provider, addressType:'p2sh32' as const };
  const cauldronContract = new Contract(cauldronArtifact, [], options);

  // calculate tradeValue and poolFee
  const poolConstant = pool.tokens * pool.sats
  const cauldronNewAmountSatsExcludingFee = Math.ceil(poolConstant / (pool.tokens + amountToSell))
  const tradeValue = Math.abs(pool.sats - cauldronNewAmountSatsExcludingFee)
  const poolFee = Math.floor(tradeValue / 1000 * 3)

  // select token inputs
  let userTokensInInputs = 0n
  let tokenInputs:Utxo[] = []
  let satsFromTokenInputs = 0n
  for(const utxo of userTokenUtxos){
    userTokensInInputs += utxo.token!.amount
    satsFromTokenInputs += utxo.satoshis
    tokenInputs.push(utxo)
    if(userTokensInInputs >= BigInt(amountToSell)) break
  }

  // select BCH inputs for miner fee
  const minerFee = 500n + 200n * BigInt(tokenInputs.length)
  const bchNeededForFee = minerFee + 1000n // buffer for dust outputs
  let userSatsInBchInputs = 0n
  let bchInputs:Utxo[] = []
  for(const utxo of userBchUtxos){
    userSatsInBchInputs += utxo.satoshis
    bchInputs.push(utxo)
    if(userSatsInBchInputs >= bchNeededForFee) break
  }
  if(userSatsInBchInputs < bchNeededForFee) throw new Error('Insufficient funds for miner fee')

  const newCauldronAmountSats = cauldronNewAmountSatsExcludingFee + poolFee
  const newCauldronAmountTokens = Math.ceil(poolConstant / cauldronNewAmountSatsExcludingFee)

  const tokenChange = userTokensInInputs - BigInt(amountToSell)
  const totalMinerFee = minerFee + 200n * BigInt(bchInputs.length)
  const tokenChangeDust = tokenChange > 0n ? 1000n : 0n

  const cauldronOutput:Recipient = {
    to: cauldronContract.tokenAddress,
    amount: BigInt(newCauldronAmountSats),
    token: {
      category: pool.token_id,
      amount: BigInt(newCauldronAmountTokens)
    }
  }

  // user receives BCH from selling tokens
  const userReceiveSats = BigInt(tradeValue - poolFee)
  const userBchOutput:Recipient = {
    to: userTokenAddress,
    amount: userReceiveSats + satsFromTokenInputs - tokenChangeDust
  }

  const outputs:Recipient[] = [cauldronOutput, userBchOutput]

  // token change output if user had more tokens than sold
  if(tokenChange > 0n){
    outputs.push({
      to: userTokenAddress,
      amount: tokenChangeDust,
      token: {
        category: pool.token_id,
        amount: tokenChange
      }
    })
  }

  // BCH change output
  const bchChange = userSatsInBchInputs - totalMinerFee
  if(bchChange > 546n){
    outputs.push({
      to: userTokenAddress,
      amount: bchChange
    })
  }

  const userTemplate = new SignatureTemplate(privateKeyWif)

  const txDetails = await new TransactionBuilder({ provider })
    .addInput(cauldronUtxo, cauldronContract.unlock.swap())
    .addInputs(tokenInputs, userTemplate.unlockP2PKH())
    .addInputs(bchInputs, userTemplate.unlockP2PKH())
    .addOutputs(outputs)
    .send()
  return txDetails
}

export async function withdrawAllFromPool(
  pool:CauldronActivePool,
  userTokenAddress:string,
  privateKeyWif:string,
  provider:NetworkProvider = new ElectrumNetworkProvider('mainnet')
){
  // convert pool object to UTXO format
  const cauldronUtxo = convertPoolToUtxo(pool);

  // Does not explicitly validate user address to be a token address, but will fail later if not

  const ownerTemplate = new SignatureTemplate(privateKeyWif)
  const ownerPk = ownerTemplate.getPublicKey()

  // Derive owner pkh from provided private key and compare to pool owner pkh
  const ownerPkh = binToHex(hash160((ownerPk)))
  if(pool.owner_pkh !== ownerPkh){
    throw new Error('Provided private key does not match pool owner')
  }

  // Get the specific cauldron contract for the selected pool (based on owner pkh)
  // add 'false' to use the managePool artifact
  const cauldronArtifact = cauldronArtifactWithPkh(pool.owner_pkh, false)
  const options = { provider, addressType:'p2sh32' as const };
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
  
  const txDetails = await new TransactionBuilder({ provider })
    .addInput(cauldronUtxo, cauldronContract.unlock.managePool(ownerPk, ownerTemplate))
    .addOutputs([userBchOutput, userTokenOutput])
    .send()
  return txDetails
}