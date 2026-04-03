import {
  Contract,
  ElectrumNetworkProvider,
  SignatureTemplate,
  TransactionBuilder,
  type NetworkProvider,
  type Recipient,
  type Utxo,
} from 'cashscript';
import { binToHex, hash160, encodeCashAddress, CashAddressType, CashAddressNetworkPrefix } from '@bitauth/libauth'
import type { CauldronActivePool, CauldronGetActivePools } from './interfaces.js';
import { cauldronArtifactWithPkh, convertPoolToUtxo, gatherBchUtxos, gatherTokenUtxos, validateTokenAddress } from './utils.js';
import { ceilDiv, computeOptimalBuy, computeOptimalSell } from './multipool.js';

// re-export types and multipool functions from the library
export type { CauldronActivePool, PoolAllocation } from './interfaces.js';
export { computeBuyAmountBelowRate, computeSellAmountAboveRate, computeOptimalBuy, computeOptimalSell, calcBuyFromPool, calcSellToPool } from './multipool.js';

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

  for (const allocation of allocations) {
    const pool = allocation.pool
    const cauldronUtxo = convertPoolToUtxo(pool)
    const cauldronArtifact = cauldronArtifactWithPkh(pool.owner_pkh)
    const cauldronContract = new Contract(cauldronArtifact, [], options)

    // calculate new pool state after trade
    const poolConstantK = BigInt(pool.tokens) * BigInt(pool.sats)
    let newTokens:bigint
    let tradeValue:bigint
    if(direction === 'buy'){
      newTokens = BigInt(pool.tokens) - allocation.demandAmount
      tradeValue = ceilDiv(poolConstantK, newTokens) - BigInt(pool.sats)
    } else {
      newTokens = BigInt(pool.tokens) + allocation.demandAmount
      tradeValue = BigInt(pool.sats) - ceilDiv(poolConstantK, newTokens)
    }
    // apply 0.3% swap fee
    // For buys: the contract computes fee on the total sats delta (which includes the fee),
    // so we solve the circular dependency: fee = ceil(3 * tradeValue / 997)
    // For sells: tradeValue * 3 / 1000 is conservative (overpays slightly), which is fine
    const newSatsExclFee = ceilDiv(poolConstantK, newTokens)
    const feeAmount = direction === 'buy'
      ? ceilDiv(tradeValue * 3n, 997n)
      : tradeValue * 3n / 1000n
    const newSats = newSatsExclFee + feeAmount
    const newTokensOutput = ceilDiv(poolConstantK, newSatsExclFee)

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
  amountToBuy:bigint,
  userTokenAddress:string,
  signer:string | Uint8Array,
  provider:NetworkProvider = new ElectrumNetworkProvider('mainnet')
){
  validateTokenAddress(userTokenAddress)
  if(amountToBuy <= 0n) throw new Error('amountToBuy must be a positive number')
  if(!pools.every(p => p.token_id === pools[0].token_id)) throw new Error('All pools must share the same token_id')

  const allocations = computeOptimalBuy(pools, amountToBuy, 2n);
  const options = { provider, addressType:'p2sh32' as const };

  const { cauldronInputs, cauldronOutputs } = buildCauldronInputsOutputs(allocations, 'buy', options)

  // fetch user UTXOs
  const userUtxos = await provider.getUtxos(userTokenAddress);
  const userBchUtxos = userUtxos.filter(utxo => !utxo.token)

  // calculate required bch input amount
  const totalSupply = allocations.reduce((sum, allocation) => sum + allocation.supplyAmount, 0n)
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
      amount: amountToBuy
    }
  }

  const userChangeOutput:Recipient = {
    to: userTokenAddress,
    amount: changeAmount
  }

  const userTemplate = new SignatureTemplate(signer)

  // build transaction — cauldron inputs/outputs first (OP_INPUTINDEX constraint)
  const transactionBuilder = new TransactionBuilder({ provider, maximumFeeSatsPerByte: 5 })
  for (const cauldronInput of cauldronInputs) {
    transactionBuilder.addInput(cauldronInput.utxo, cauldronInput.contract.unlock.swap())
  }
  transactionBuilder.addInputs(bchInputUtxos, userTemplate.unlockP2PKH())
    .addOutputs([...cauldronOutputs, boughtTokensOutput, userChangeOutput])

  // all input utxos for external fee calculation
  const inputUtxos = [...cauldronInputs.map(cauldronInput => cauldronInput.utxo), ...bchInputUtxos]
  const totalFees = allocations.reduce((sum, allocation) => sum + allocation.feeAmount, 0n)
  return { transactionBuilder, inputUtxos, totalSatsCost: totalSupply, totalFees, effectivePricePerToken: totalSupply / amountToBuy }
}

export async function prepareSellTokens(
  pools:CauldronActivePool[],
  amountToSell:bigint,
  userTokenAddress:string,
  signer:string | Uint8Array,
  provider:NetworkProvider = new ElectrumNetworkProvider('mainnet')
){
  validateTokenAddress(userTokenAddress)
  if(amountToSell <= 0n) throw new Error('amountToSell must be a positive number')
  if(!pools.every(p => p.token_id === pools[0].token_id)) throw new Error('All pools must share the same token_id')

  const allocations = computeOptimalSell(pools, amountToSell, 2n);
  const tokenId = allocations[0].pool.token_id;
  const options = { provider, addressType:'p2sh32' as const };

  const { cauldronInputs, cauldronOutputs, totalUserReceive } = buildCauldronInputsOutputs(allocations, 'sell', options)

  // fetch user UTXOs
  const userUtxos = await provider.getUtxos(userTokenAddress);
  const userTokenUtxos = userUtxos.filter(utxo => utxo.token?.category === tokenId)
  const userBchUtxos = userUtxos.filter(utxo => !utxo.token)

  // select token inputs
  const { userTokenInputTotal, userTokenInputs } = gatherTokenUtxos(userTokenUtxos, amountToSell)

  // calculate transaction fee
  const tokenChangeAmount = userTokenInputTotal - amountToSell
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

  const userTemplate = new SignatureTemplate(signer)

  // build transaction — cauldron inputs/outputs first (OP_INPUTINDEX constraint)
  const outputs:Recipient[] = [...cauldronOutputs, userBchOutput]
  if(tokenChangeAmount > 0n) outputs.push(tokenChangeOutput)

  const transactionBuilder = new TransactionBuilder({ provider, maximumFeeSatsPerByte: 5 })
  for (const cauldronInput of cauldronInputs) {
    transactionBuilder.addInput(cauldronInput.utxo, cauldronInput.contract.unlock.swap())
  }
  transactionBuilder.addInputs(userTokenInputs, userTemplate.unlockP2PKH())
    .addInput(userBchFeeInput, userTemplate.unlockP2PKH())
    .addOutputs(outputs)

  // all input utxos for external fee calculation
  const inputUtxos = [...cauldronInputs.map(cauldronInput => cauldronInput.utxo), ...userTokenInputs, userBchFeeInput]
  const totalFees = allocations.reduce((sum, allocation) => sum + allocation.feeAmount, 0n)
  return { transactionBuilder, inputUtxos, totalSatsReceived: totalUserReceive, totalFees, effectivePricePerToken: totalUserReceive / amountToSell }
}

export async function prepareWithdrawAll(
  pool:CauldronActivePool,
  userTokenAddress:string,
  signer:string | Uint8Array,
  provider:NetworkProvider = new ElectrumNetworkProvider('mainnet')
){
  validateTokenAddress(userTokenAddress)

  // convert pool object to UTXO format
  const cauldronUtxo = convertPoolToUtxo(pool);

  const ownerTemplate = new SignatureTemplate(signer)
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

export async function prepareCreatePool(
  tokenId:string,
  satsAmount:bigint,
  tokenAmount:bigint,
  signer:string | Uint8Array,
  network:CauldronNetwork = 'mainnet',
  provider:NetworkProvider = new ElectrumNetworkProvider(network)
){
  if(satsAmount <= 0n) throw new Error('satsAmount must be a positive number')
  if(tokenAmount <= 0n) throw new Error('tokenAmount must be a positive number')

  // Derive owner address and PKH from signer
  const signerTemplate = new SignatureTemplate(signer)
  const ownerPk = signerTemplate.getPublicKey()
  const ownerPkh = binToHex(hash160(ownerPk))
  const addressPrefix = network === 'mainnet' ? CashAddressNetworkPrefix.mainnet : CashAddressNetworkPrefix.testnet;
  const userTokenAddress = encodeCashAddress({ prefix: addressPrefix, type: CashAddressType.p2pkhWithTokens, payload: hash160(ownerPk) }).address

  // Build the Cauldron contract for this owner
  const cauldronArtifact = cauldronArtifactWithPkh(ownerPkh)
  const options = { provider, addressType:'p2sh32' as const };
  const cauldronContract = new Contract(cauldronArtifact, [], options)

  // Fetch user UTXOs
  const userUtxos = await provider.getUtxos(userTokenAddress)
  const userBchUtxos = userUtxos.filter(utxo => !utxo.token)
  const userTokenUtxos = userUtxos.filter(utxo => utxo.token?.category === tokenId)

  // Select token inputs
  const { userTokenInputTotal, userTokenInputs } = gatherTokenUtxos(userTokenUtxos, tokenAmount)

  // Calculate fees and required BCH
  const tokenChangeAmount = userTokenInputTotal - tokenAmount
  const tokenChangeDust = tokenChangeAmount > 0n ? 1000n : 0n
  const feePerUserInput = 180n
  const baseFee = 2000n + feePerUserInput * BigInt(userTokenInputs.length)
  const requiredBchAmount = satsAmount + tokenChangeDust + baseFee

  // Select BCH inputs
  const { userBchInputTotal, bchInputUtxos } = gatherBchUtxos(userBchUtxos, requiredBchAmount)

  // BCH sitting on token input UTXOs
  const bchOnTokenInputs = userTokenInputs.reduce((sum, utxo) => sum + utxo.satoshis, 0n)
  const bchChange = userBchInputTotal + bchOnTokenInputs - requiredBchAmount

  // Build outputs
  const poolOutput:Recipient = {
    to: cauldronContract.tokenAddress,
    amount: satsAmount,
    token: {
      category: tokenId,
      amount: tokenAmount,
    },
  }

  const changeOutputs:Recipient[] = []

  if(bchChange > 0n){
    changeOutputs.push({ to: userTokenAddress, amount: bchChange })
  }

  if(tokenChangeAmount > 0n){
    changeOutputs.push({
      to: userTokenAddress,
      amount: tokenChangeDust,
      token: {
        category: tokenId,
        amount: tokenChangeAmount,
      },
    })
  }

  // Build transaction: pool output → OP_RETURN → change outputs
  const transactionBuilder = new TransactionBuilder({ provider, maximumFeeSatsPerByte: 5 })
  transactionBuilder.addInputs(userTokenInputs, signerTemplate.unlockP2PKH())
    .addInputs(bchInputUtxos, signerTemplate.unlockP2PKH())
    .addOutput(poolOutput)
    .addOpReturnOutput(['SUMMON', '0x' + ownerPkh])
    .addOutputs(changeOutputs)

  const inputUtxos = [...userTokenInputs, ...bchInputUtxos]
  return { transactionBuilder, inputUtxos, poolContractAddress: cauldronContract.tokenAddress, ownerPkh }
}
