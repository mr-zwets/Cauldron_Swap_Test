import type { Artifact, Utxo } from 'cashscript';
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