import {
  Contract,
  MockNetworkProvider,
  randomUtxo,
} from 'cashscript';
import { buyTokensPool, getCauldronPools } from '../src/index.js';
import { cauldronContractWithPkh, convertPoolToUtxo } from '../src/utils.js';

describe('Cauldron Swap Test', () => {
  it('Simulate buying 100 FURU tokens', async() => {
    const provider = new MockNetworkProvider();
    const furuTokenId = "d9ab24ed15a7846cc3d9e004aa5cb976860f13dac1ead05784ee4f4622af96ea"

    // fake user address and wif
    const testUserTokenAddress = "bitcoincash:zps99uejnueu4dsv0dd2m9u9uzxntg66nymvueqaan"
    const testUserWif = "cP6D14xYyNxXNRA6Lszwa8YU6R8woCsAj4PUZeTtXdW3uHtDVMYm"

    // emulate user having some BCH
    provider.addUtxo(testUserTokenAddress, randomUtxo())

    // get real FURU pool
    const cauldronPools = await getCauldronPools(furuTokenId)
    const poolTosUse = cauldronPools?.[0]

    // emulate FURU pool
    const options = { provider, addressType:'p2sh32' as const };
    const cauldronContract = new Contract(cauldronContractWithPkh(poolTosUse.owner_pkh), [], options);
    provider.addUtxo(cauldronContract.address, convertPoolToUtxo(poolTosUse))

    await expect(buyTokensPool(
      poolTosUse,
      100,
      testUserTokenAddress,
      testUserWif,
      provider
    )).resolves.not.toThrow();
  });
});
