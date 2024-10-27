import type { Artifact, Utxo } from 'cashscript';
import cauldronArtifact from './artifact.json' with { type: 'json' };
import { CauldronActivePool } from './interfaces';

export function cauldronContractWithPkh(pkhHex:string){
  const strigifiedCauldronArtifact = JSON.stringify(cauldronArtifact);
  return JSON.parse(strigifiedCauldronArtifact.replace('<withdraw_pkh>', pkhHex)) as Artifact
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