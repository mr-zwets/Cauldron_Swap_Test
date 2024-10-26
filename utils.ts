import { type Utxo } from 'cashscript';
import { CauldronActivePool } from './interfaces';

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