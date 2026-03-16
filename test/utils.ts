import { decodeTransactionUnsafe, encodeTransaction, hexToBin } from '@bitauth/libauth';
import type { Utxo } from 'cashscript';

export function calculateTransactionFee(txHex: string, inputUtxos: Utxo[]) {
  const decodedTransaction = decodeTransactionUnsafe(hexToBin(txHex));
  const totalInputAmount = inputUtxos.reduce((acc, input) => acc + input.satoshis, 0n);
  const totalOutputAmount = decodedTransaction.outputs.reduce(
    (acc, output) => acc + BigInt(output.valueSatoshis), 0n
  );
  const txFeeSats = totalInputAmount - totalOutputAmount;
  const encodedTx = encodeTransaction(decodedTransaction);
  const txFeeRate = Number(txFeeSats) / encodedTx.byteLength;
  return { txFeeSats, txFeeRate };
}
