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
import { ceilDiv, computeOptimalBuy, computeOptimalSell } from './multipool.js';

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

function buildCauldronInputsOutputs(
  allocations: { pool: CauldronActivePool; demandAmount: bigint }[],
  direction: 'buy' | 'sell',
  options: { provider: NetworkProvider; addressType: 'p2sh32' }
) {
  const cauldronInputs: { utxo: Utxo; contract: Contract }[] = [];
  const cauldronOutputs: Recipient[] = [];
  let totalUserReceive = 0n;

  for (const alloc of allocations) {
    const pool = alloc.pool
    const cauldronUtxo = convertPoolToUtxo(pool)
    const cauldronArtifact = cauldronArtifactWithPkh(pool.owner_pkh)
    const cauldronContract = new Contract(cauldronArtifact, [], options)

    // calculate new pool state after trade
    const K = BigInt(pool.tokens) * BigInt(pool.sats)
    let newTokens:bigint
    let tradeValue:bigint
    if(direction === 'buy'){
      newTokens = BigInt(pool.tokens) - alloc.demandAmount
      tradeValue = ceilDiv(K, newTokens) - BigInt(pool.sats)
    } else {
      newTokens = BigInt(pool.tokens) + alloc.demandAmount
      tradeValue = BigInt(pool.sats) - ceilDiv(K, newTokens)
    }
    // apply 0.3% swap fee
    const newSatsExclFee = ceilDiv(K, newTokens)
    const feeAmount = tradeValue * 3n / 1000n
    const newSats = newSatsExclFee + feeAmount
    const newTokensOutput = ceilDiv(K, newSatsExclFee)

    if (direction === 'sell') {
      totalUserReceive += tradeValue - feeAmount
    }

    cauldronInputs.push({ utxo: cauldronUtxo, contract: cauldronContract })
    cauldronOutputs.push({
      to: cauldronContract.tokenAddress,
      amount: newSats,
      token: {
        category: pool.token_id,
        amount: newTokensOutput,
      },
    });
  }

  return { cauldronInputs, cauldronOutputs, totalUserReceive };
}

export async function prepareBuyTokens(
  pools:CauldronActivePool[],
  amountToBuy:number,
  userTokenAddress:string,
  privateKeyWif:string,
  provider:NetworkProvider = new ElectrumNetworkProvider('mainnet')
){
  validateTokenAddress(userTokenAddress)

  const allocations = computeOptimalBuy(pools, BigInt(amountToBuy), 2n);
  const options = { provider, addressType:'p2sh32' as const };

  const { cauldronInputs, cauldronOutputs } = buildCauldronInputsOutputs(allocations, 'buy', options)

  // fetch user UTXOs
  const userUtxos = await provider.getUtxos(userTokenAddress);
  const userBchUtxos = userUtxos.filter(utxo => !utxo.token)

  // calculate required bch input amount
  const totalSupply = allocations.reduce((sum, a) => sum + a.supplyAmount, 0n)
  const tokenOutputDust = 1000n
  const baseFee = 2000n + 600n * BigInt(allocations.length - 1)
  const requiredBchAmount = totalSupply + tokenOutputDust + baseFee

  const { userBchInputTotal, bchInputUtxos } = gatherBchUtxos(userBchUtxos, requiredBchAmount)

  const tokenId = allocations[0].pool.token_id
  const changeAmount = userBchInputTotal - requiredBchAmount

  const boughtTokensOutput:Recipient = {
    to: userTokenAddress,
    amount: tokenOutputDust,
    token: {
      category: tokenId,
      amount: BigInt(amountToBuy)
    }
  }

  const userChangeOutput:Recipient = {
    to: userTokenAddress,
    amount: changeAmount
  }

  const userTemplate = new SignatureTemplate(privateKeyWif)

  // build transaction — cauldron inputs/outputs first (OP_INPUTINDEX constraint)
  const transactionBuilder = new TransactionBuilder({ provider, maximumFeeSatsPerByte: 5 })
  for (const ci of cauldronInputs) {
    transactionBuilder.addInput(ci.utxo, ci.contract.unlock.swap())
  }
  transactionBuilder.addInputs(bchInputUtxos, userTemplate.unlockP2PKH())
    .addOutputs([...cauldronOutputs, boughtTokensOutput, userChangeOutput])

  // all input utxos for external fee calculation
  const inputUtxos = [...cauldronInputs.map(ci => ci.utxo), ...bchInputUtxos]
  const totalFees = allocations.reduce((sum, a) => sum + a.feeAmount, 0n)
  return { transactionBuilder, inputUtxos, totalSatsCost: totalSupply, totalFees, effectivePricePerToken: totalSupply / BigInt(amountToBuy) }
}

export async function prepareSellTokens(
  pools:CauldronActivePool[],
  amountToSell:number,
  userTokenAddress:string,
  privateKeyWif:string,
  provider:NetworkProvider = new ElectrumNetworkProvider('mainnet')
){
  validateTokenAddress(userTokenAddress)

  const allocations = computeOptimalSell(pools, BigInt(amountToSell), 2n);
  const tokenId = allocations[0].pool.token_id;
  const options = { provider, addressType:'p2sh32' as const };

  const { cauldronInputs, cauldronOutputs, totalUserReceive } = buildCauldronInputsOutputs(allocations, 'sell', options)

  // fetch user UTXOs
  const userUtxos = await provider.getUtxos(userTokenAddress);
  const userTokenUtxos = userUtxos.filter(utxo => utxo.token?.category === tokenId)
  const userBchUtxos = userUtxos.filter(utxo => !utxo.token)

  // select token inputs
  const { userTokenInputTotal, userTokenInputs } = gatherTokenUtxos(userTokenUtxos, BigInt(amountToSell))

  // calculate transaction fee
  const tokenChangeAmount = userTokenInputTotal - BigInt(amountToSell)
  const feePerUserInput = 180n
  let requiredFee = 2000n + 600n * BigInt(allocations.length - 1)
  requiredFee += feePerUserInput * BigInt(userTokenInputs.length)

  // calculate required bch input amount
  const tokenChangeDust = tokenChangeAmount > 0n ? 1000n : 0n
  const requiredBchAmount = requiredFee + tokenChangeDust

  const userBchFeeInput = userBchUtxos.find(utxo => utxo.satoshis > requiredBchAmount)
  if(!userBchFeeInput){
    throw new Error(`missing userBchFeeInput with atleast requiredFee amount (${requiredBchAmount} sats)`)
  }

  // calculate change output
  const bchOnTokenInputs = userTokenInputs.reduce((sum, utxo) => sum + utxo.satoshis, 0n)
  const changeAmount = userBchFeeInput.satoshis - requiredFee - tokenChangeDust + bchOnTokenInputs

  const userBchOutput:Recipient = {
    to: userTokenAddress,
    amount: totalUserReceive + changeAmount
  }

  const tokenChangeOutput:Recipient = {
    to: userTokenAddress,
    amount: tokenChangeDust,
    token: {
      category: tokenId,
      amount: tokenChangeAmount
    }
  }

  const userTemplate = new SignatureTemplate(privateKeyWif)

  // build transaction — cauldron inputs/outputs first (OP_INPUTINDEX constraint)
  const outputs:Recipient[] = [...cauldronOutputs, userBchOutput]
  if(tokenChangeAmount > 0n) outputs.push(tokenChangeOutput)

  const transactionBuilder = new TransactionBuilder({ provider, maximumFeeSatsPerByte: 5 })
  for (const ci of cauldronInputs) {
    transactionBuilder.addInput(ci.utxo, ci.contract.unlock.swap())
  }
  transactionBuilder.addInputs(userTokenInputs, userTemplate.unlockP2PKH())
    .addInput(userBchFeeInput, userTemplate.unlockP2PKH())
    .addOutputs(outputs)

  // all input utxos for external fee calculation
  const inputUtxos = [...cauldronInputs.map(ci => ci.utxo), ...userTokenInputs, userBchFeeInput]
  const totalFees = allocations.reduce((sum, a) => sum + a.feeAmount, 0n)
  return { transactionBuilder, inputUtxos, totalSatsReceived: totalUserReceive, totalFees, effectivePricePerToken: totalUserReceive / BigInt(amountToSell) }
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
