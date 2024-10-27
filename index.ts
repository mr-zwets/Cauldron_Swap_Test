import {
  Contract,
  ElectrumNetworkProvider,
  Output,
  SignatureTemplate,
  TransactionBuilder
} from 'cashscript';
// The cauldronArtifact contains a template variable <withdraw_pkh>
import { CauldronActivePool, CauldronGetActivePools } from './interfaces';
import { cauldronContractWithPkh, convertPoolToUtxo } from './utils';

const provider = new ElectrumNetworkProvider('mainnet');

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
  userAddress:string,
  privateKeyWif:string
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

  // calculate tradeValue and poolFee
  const poolConstant = pool.tokens * pool.sats
  const cauldronAmountExludingFee = Math.ceil(poolConstant / (pool.tokens - amountToBuy))
  const tradeValue = Math.abs(cauldronAmountExludingFee - pool.sats)
  const poolFee = 0.3 * tradeValue

  // calculate user input amount
  const userInputAmountNeeded = BigInt(tradeValue + poolFee) + 1000n
  if(userBalanceSats < userInputAmountNeeded) throw new Error('Insufficient funds to buy tokens')
  const sortedUserUtxos = UserUtxos.sort((a, b) => Number(a.satoshis) - Number(b.satoshis))

  // add needed userInputs to the transactionBuilder
  const userTemplate = new SignatureTemplate(privateKeyWif)
  let userSatsInInputs = 0n
  for(const userUtxo of sortedUserUtxos){
    userSatsInInputs += userUtxo.satoshis
    transactionBuilder.addInput(userUtxo, userTemplate.unlockP2PKH())
    if(userSatsInInputs >= userInputAmountNeeded) break
  }

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

  const userChangeOutput: Output = {
    to: userAddress,
    amount: userSatsInInputs - userInputAmountNeeded,
  }
  transactionBuilder.addOutput(userChangeOutput)

  return await transactionBuilder.send()
}