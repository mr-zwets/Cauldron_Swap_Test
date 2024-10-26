import { Artifact, Contract, ElectrumNetworkProvider, Utxo } from 'cashscript';
// The cauldronArtifact contains a template variable <withdraw_pkh>
import cauldronArtifact from './artifact.json' with { type: 'json' };

function cauldronContractWithPkh(pkhHex:string){
  const strigifiedCauldronArtifact = JSON.stringify(cauldronArtifact);
  return JSON.parse(strigifiedCauldronArtifact.replace('<withdraw_pkh>', pkhHex)) as Artifact
}

const provider = new ElectrumNetworkProvider('mainnet');
const options = { provider, addressType:'p2sh32' as const };
const pkhHex = "0204ccd5b8cdecbd68083a16284b5d2b9af1c4138250d548660c2c5c3b514f4ca5";
const cauldronContract = new Contract(cauldronContractWithPkh(pkhHex), [], options);

console.log(`Cauldron contract address for pkh${pkhHex}:`, cauldronContract.address);

export async function getCauldronUtxos(tokenId:string){
  // How to find all Cauldron contracts when they are all at unique addresses? 
}

export async function parsePriceCauldronUtxos(utxos:Utxo[]){
  return utxos.map(utxo => {
    const { token, satoshis } = utxo;
    const priceSatsPerToken = Number(token?.amount as bigint) / Number(satoshis);
    return { price: priceSatsPerToken, utxo };
  })
}