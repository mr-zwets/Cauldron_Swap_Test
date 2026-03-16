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
import { cauldronArtifactWithPkh, convertPoolToUtxo, gatherBchUtxos, gatherTokenUtxos, validateTokenAddress } from './utils.js';

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

export async function prepareBuyTokens(
  pool:CauldronActivePool,
  amountToBuy:number,
  userTokenAddress:string,
  privateKeyWif:string,
  provider:NetworkProvider = new ElectrumNetworkProvider('mainnet')
){
  validateTokenAddress(userTokenAddress)

  // convert pool object to UTXO format
  const cauldronUtxo = convertPoolToUtxo(pool);

  // fetch user UTXOs
  const userUtxos = await provider.getUtxos(userTokenAddress);
  const userBchUtxos = userUtxos.filter(utxo => !utxo.token)

  // Get the specific cauldron contract for the selected pool (based on owner pkh)
  const cauldronArtifact = cauldronArtifactWithPkh(pool.owner_pkh)
  const options = { provider, addressType:'p2sh32' as const };
  const cauldronContract = new Contract(cauldronArtifact, [], options);

  // calculate tradeValue and poolFee
  const poolConstant = pool.tokens * pool.sats
  const cauldronNewAmountSatsExcludingFee = Math.ceil(poolConstant / (pool.tokens - amountToBuy))
  const tradeValue = Math.abs(cauldronNewAmountSatsExcludingFee - pool.sats)
  const poolFee = Math.floor(tradeValue / 1000 * 3)

  // calculate required bch input amount
  const tradeAmount = BigInt(tradeValue + poolFee)
  const tokenOutputDust = 1000n
  const requiredFee = 2000n
  const requiredBchAmount = tradeAmount + tokenOutputDust + requiredFee

  const { userBchInputTotal, bchInputUtxos } = gatherBchUtxos(userBchUtxos, requiredBchAmount)

  const newCauldronAmountSats = cauldronNewAmountSatsExcludingFee + poolFee
  const newCauldronAmountTokens = Math.ceil(poolConstant / cauldronNewAmountSatsExcludingFee)

  const cauldronOutput:Recipient = {
    to: cauldronContract.tokenAddress,
    amount: BigInt(newCauldronAmountSats),
    token: {
      category: pool.token_id,
      amount: BigInt(newCauldronAmountTokens)
    }
  }

  const boughtTokensOutput:Recipient = {
    to: userTokenAddress,
    amount: tokenOutputDust,
    token: {
      category: pool.token_id,
      amount: BigInt(amountToBuy)
    }
  }

  const changeAmount = userBchInputTotal - requiredBchAmount
  const userChangeOutput:Recipient = {
    to: userTokenAddress,
    amount: changeAmount
  }

  const userTemplate = new SignatureTemplate(privateKeyWif)

  const transactionBuilder = new TransactionBuilder({ provider, maximumFeeSatsPerByte: 5 })
    .addInput(cauldronUtxo, cauldronContract.unlock.swap())
    .addInputs(bchInputUtxos, userTemplate.unlockP2PKH())
    .addOutputs([cauldronOutput, boughtTokensOutput, userChangeOutput])

  // all input utxos for external fee calculation
  const inputUtxos = [cauldronUtxo, ...bchInputUtxos]
  return { transactionBuilder, inputUtxos }
}

export async function prepareSellTokens(
  pool:CauldronActivePool,
  amountToSell:number,
  userTokenAddress:string,
  privateKeyWif:string,
  provider:NetworkProvider = new ElectrumNetworkProvider('mainnet')
){
  validateTokenAddress(userTokenAddress)

  // convert pool object to UTXO format
  const cauldronUtxo = convertPoolToUtxo(pool);

  // fetch user UTXOs
  const userUtxos = await provider.getUtxos(userTokenAddress);
  const userTokenUtxos = userUtxos.filter(utxo => utxo.token?.category === pool.token_id)
  const userBchUtxos = userUtxos.filter(utxo => !utxo.token)

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
  const { userTokenInputTotal, userTokenInputs } = gatherTokenUtxos(userTokenUtxos, BigInt(amountToSell))

  // calculate transaction fee
  const tokenChangeAmount = userTokenInputTotal - BigInt(amountToSell)
  let requiredFee = 2000n
  const feePerUserInput = 180n
  requiredFee += feePerUserInput * BigInt(userTokenInputs.length)

  // calculate required bch input amount
  const tokenChangeDust = tokenChangeAmount > 0n ? 1000n : 0n
  const requiredBchAmount = requiredFee + tokenChangeDust

  const userBchFeeInput = userBchUtxos.find(utxo => utxo.satoshis > requiredBchAmount)
  if(!userBchFeeInput){
    throw new Error(`missing userBchFeeInput with atleast requiredFee amount (${requiredBchAmount} sats)`)
  }

  const newCauldronAmountSats = cauldronNewAmountSatsExcludingFee + poolFee
  const newCauldronAmountTokens = Math.ceil(poolConstant / cauldronNewAmountSatsExcludingFee)

  const cauldronOutput:Recipient = {
    to: cauldronContract.tokenAddress,
    amount: BigInt(newCauldronAmountSats),
    token: {
      category: pool.token_id,
      amount: BigInt(newCauldronAmountTokens)
    }
  }

  // calculate change output
  const bchOnTokenInputs = userTokenInputs.reduce((sum, utxo) => sum + utxo.satoshis, 0n)
  const userReceiveSats = BigInt(tradeValue - poolFee)
  const changeAmount = userBchFeeInput.satoshis - requiredFee - tokenChangeDust + bchOnTokenInputs

  const userBchOutput:Recipient = {
    to: userTokenAddress,
    amount: userReceiveSats + changeAmount
  }

  const outputs:Recipient[] = [cauldronOutput, userBchOutput]

  // token change output if user had more tokens than sold
  if(tokenChangeAmount > 0n){
    outputs.push({
      to: userTokenAddress,
      amount: tokenChangeDust,
      token: {
        category: pool.token_id,
        amount: tokenChangeAmount
      }
    })
  }

  const userTemplate = new SignatureTemplate(privateKeyWif)

  const transactionBuilder = new TransactionBuilder({ provider, maximumFeeSatsPerByte: 5 })
    .addInput(cauldronUtxo, cauldronContract.unlock.swap())
    .addInputs(userTokenInputs, userTemplate.unlockP2PKH())
    .addInput(userBchFeeInput, userTemplate.unlockP2PKH())
    .addOutputs(outputs)

  // all input utxos for external fee calculation
  const inputUtxos = [cauldronUtxo, ...userTokenInputs, userBchFeeInput]
  return { transactionBuilder, inputUtxos }
}

export async function prepareWithdrawAll(
  pool:CauldronActivePool,
  userTokenAddress:string,
  privateKeyWif:string,
  provider:NetworkProvider = new ElectrumNetworkProvider('mainnet')
){
  validateTokenAddress(userTokenAddress)

  // convert pool object to UTXO format
  const cauldronUtxo = convertPoolToUtxo(pool);

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

  const requiredFee = 800n
  const bchOutputAmount = BigInt(pool.sats) - 1000n - requiredFee

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

  const transactionBuilder = new TransactionBuilder({ provider, maximumFeeSatsPerByte: 5 })
    .addInput(cauldronUtxo, cauldronContract.unlock.managePool(ownerPk, ownerTemplate))
    .addOutputs([userBchOutput, userTokenOutput])

  // all input utxos for external fee calculation
  const inputUtxos = [cauldronUtxo]
  return { transactionBuilder, inputUtxos }
}
