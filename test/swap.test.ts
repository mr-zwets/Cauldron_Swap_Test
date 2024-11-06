import {
  Contract,
  MockNetworkProvider,
  randomUtxo,
} from 'cashscript';
import { buyTokensPool } from '../src/index.js';
import { cauldronArtifactWithPkh, convertPoolToUtxo } from '../src/utils.js';
import type { CauldronActivePool } from '../src/interfaces.js';

describe('Cauldron Swap Test', () => {
  it('Simulate buying 100 FURU tokens', async() => {
    const provider = new MockNetworkProvider();

    // fake user address and wif
    const testUserTokenAddress = "bitcoincash:zps99uejnueu4dsv0dd2m9u9uzxntg66nymvueqaan"
    const testUserWif = "cP6D14xYyNxXNRA6Lszwa8YU6R8woCsAj4PUZeTtXdW3uHtDVMYm"

    // emulate user having some BCH (single utxo)
    provider.addUtxo(testUserTokenAddress, randomUtxo())

    // create test furu pool
    const testFuruPool: CauldronActivePool = {
      owner_p2pkh_addr: "bitcoincash:zr8g5yrw0vzdc2evjgpjfwlsrn67d5wtqcjhnwf345",
      owner_pkh: "ce8a106e7b04dc2b2c920324bbf01cf5e6d1cb06",
      sats: 587793838,
      token_id: "d9ab24ed15a7846cc3d9e004aa5cb976860f13dac1ead05784ee4f4622af96ea",
      tokens: 4363102,
      tx_pos: 0,
      txid: "aa183eb292e7b0c733988e931286bb0f47cf01cec12bd1b6d9c850def024e4bb"
    }

    // emulate the furu pool utxo
    const options = { provider, addressType:'p2sh32' as const };
    const cauldronContract = new Contract(cauldronArtifactWithPkh(testFuruPool.owner_pkh), [], options);
    provider.addUtxo(cauldronContract.address, convertPoolToUtxo(testFuruPool))

    await expect(buyTokensPool(
      testFuruPool,
      100,
      testUserTokenAddress,
      testUserWif,
      provider
    )).resolves.not.toThrow();
  });
});
