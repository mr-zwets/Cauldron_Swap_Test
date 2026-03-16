import type { Artifact, Utxo } from 'cashscript';
import { decodeCashAddress } from '@bitauth/libauth';
import cauldronSwapArtifact from './artifact/swap_artifact.json' with { type: 'json' };
import cauldronManagePoolArtifact from './artifact/managepool_artifact.json' with { type: 'json' };
import { type CauldronActivePool } from './interfaces.js';

// The cauldronArtifact contains a template variable <withdraw_pkh>
// which we need to replace with the actual pkh of the pool owner
// There is a separate artifact for swapping and managing pools
export function cauldronArtifactWithPkh(pkhHex:string, swapArtifact:boolean=true){
  const cauldronArtifact = swapArtifact ? cauldronSwapArtifact : cauldronManagePoolArtifact;
  const strigifiedCauldronArtifact = JSON.stringify(cauldronArtifact);
  const constructedArtifact = JSON.parse(strigifiedCauldronArtifact.replace('<withdraw_pkh>', pkhHex)) as Artifact
  // different contracts should have unique names
  constructedArtifact.contractName = swapArtifact ? `CauldronSwap ${pkhHex}` : `CauldronManagePool ${pkhHex}`;
  return constructedArtifact
}

export function validateTokenAddress(address:string):void {
  const decoded = decodeCashAddress(address)
  if(typeof decoded === 'string') throw new Error(`Invalid CashAddress: ${decoded}`)
  const tokenTypes = ['p2pkhWithTokens', 'p2shWithTokens']
  if(!tokenTypes.includes(decoded.type)){
    throw new Error('Address is not a token-aware address')
  }
}

/* UTXO Selection */

export function gatherBchUtxos(userBchUtxos: Utxo[], requiredAmountSats: bigint){
  // Sort in descending order (highest to lowest)
  userBchUtxos.sort((utxo1, utxo2) => Number(utxo2.satoshis) - Number(utxo1.satoshis))

  const bchInputUtxos:Utxo[] = []
  const feePerUserInput = 180n
  let userBchInputTotal = 0n
  for(const userBchUtxo of userBchUtxos){
    if(userBchInputTotal >= requiredAmountSats) break
    bchInputUtxos.push(userBchUtxo)
    userBchInputTotal += userBchUtxo.satoshis
    requiredAmountSats += feePerUserInput
  }
  if(userBchInputTotal < requiredAmountSats) throw new Error("Insufficient BCH to cover the required amount")
  return { userBchInputTotal, bchInputUtxos }
}

export function gatherTokenUtxos(userTokenUtxos: Utxo[], requiredAmountTokens: bigint){
  // Sort in descending order (highest to lowest)
  userTokenUtxos.sort((utxo1, utxo2) => Number(utxo2!.token!.amount) - Number(utxo1!.token!.amount))

  const userTokenInputs:Utxo[] = []
  let userTokenInputTotal = 0n
  for(const utxo of userTokenUtxos){
    if(userTokenInputTotal >= requiredAmountTokens) break
    userTokenInputTotal += utxo!.token!.amount
    userTokenInputs.push(utxo)
  }
  if(userTokenInputTotal < requiredAmountTokens) throw new Error("Insufficient tokens to cover the required amount")
  return { userTokenInputTotal, userTokenInputs }
}

export function convertPoolToUtxo(pool: CauldronActivePool):Utxo{
  return {
    txid: pool.txid,
    vout: pool.tx_pos,
    satoshis: BigInt(pool.sats),
    token: {
      category: pool.token_id,
      amount: BigInt(pool.tokens)
    }
  }
}