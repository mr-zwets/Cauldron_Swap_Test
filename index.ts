import { Contract, ElectrumNetworkProvider, TransactionBuilder, Utxo } from 'cashscript';
// The cauldronArtifact contains a template variable <withdraw_pkh>
import cauldronArtifact from './artifact.json' with { type: 'json' }; 

const provider = new ElectrumNetworkProvider('mainnet');
const options = { provider, addressType:'p2sh32' as const };
const cauldronContract = new Contract(cauldronArtifact, [], options);

console.log('Cauldron contract address:', cauldronContract.address);

export async function getCauldronUtxos(tokenId:string){
  const allCauldronUtxos = await cauldronContract.getUtxos();
  return allCauldronUtxos.filter(utxo => utxo?.token?.category === tokenId); 
}

export async function parsePriceCauldronUtxos(utxos:Utxo[]){
  return utxos.map(utxo => {
    const { token, satoshis } = utxo;
    const priceSatsPerToken = Number(token?.amount as bigint) / Number(satoshis);
    return { price: priceSatsPerToken, utxo };
  })
}

const transactionBuilder = new TransactionBuilder({ provider });