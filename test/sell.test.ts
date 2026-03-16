import {
  Contract,
  MockNetworkProvider,
  randomUtxo,
} from 'cashscript';
import { sellTokensPool } from '../src/index.js';
import { cauldronArtifactWithPkh, convertPoolToUtxo } from '../src/utils.js';
import type { CauldronActivePool } from '../src/interfaces.js';

// shared test pool and user details
const testUserTokenAddress = "bitcoincash:zps99uejnueu4dsv0dd2m9u9uzxntg66nymvueqaan"
const testUserWif = "KxjDY9xhYKGGCygpxUBpCp3QUBqY8kmUf2F1TE1P2Wr3eYuNWwjD"

const testFuruPool: CauldronActivePool = {
  owner_p2pkh_addr: "bitcoincash:zr8g5yrw0vzdc2evjgpjfwlsrn67d5wtqcjhnwf345",
  owner_pkh: "ce8a106e7b04dc2b2c920324bbf01cf5e6d1cb06",
  sats: 587793838,
  token_id: "d9ab24ed15a7846cc3d9e004aa5cb976860f13dac1ead05784ee4f4622af96ea",
  tokens: 4363102,
  tx_pos: 0,
  txid: "aa183eb292e7b0c733988e931286bb0f47cf01cec12bd1b6d9c850def024e4bb"
}

function setupProvider() {
  const provider = new MockNetworkProvider();
  const options = { provider, addressType:'p2sh32' as const };
  const cauldronContract = new Contract(cauldronArtifactWithPkh(testFuruPool.owner_pkh), [], options);
  provider.addUtxo(cauldronContract.address, convertPoolToUtxo(testFuruPool))
  return provider
}

describe('Cauldron Sell Test', () => {
  it('Simulate selling 100 FURU tokens', async() => {
    const provider = setupProvider();

    // user has tokens to sell
    provider.addUtxo(testUserTokenAddress, randomUtxo({
      token: {
        category: testFuruPool.token_id,
        amount: 500n
      }
    }))
    // user has BCH for miner fee
    provider.addUtxo(testUserTokenAddress, randomUtxo())

    await expect(sellTokensPool(
      testFuruPool,
      100,
      testUserTokenAddress,
      testUserWif,
      provider
    )).resolves.not.toThrow();
  });

  it('Simulate selling exact token balance (no token change)', async() => {
    const provider = setupProvider();

    provider.addUtxo(testUserTokenAddress, randomUtxo({
      token: {
        category: testFuruPool.token_id,
        amount: 200n
      }
    }))
    provider.addUtxo(testUserTokenAddress, randomUtxo())

    await expect(sellTokensPool(
      testFuruPool,
      200,
      testUserTokenAddress,
      testUserWif,
      provider
    )).resolves.not.toThrow();
  });

  it('Should throw with insufficient tokens', async() => {
    const provider = setupProvider();

    provider.addUtxo(testUserTokenAddress, randomUtxo({
      token: {
        category: testFuruPool.token_id,
        amount: 50n
      }
    }))
    provider.addUtxo(testUserTokenAddress, randomUtxo())

    await expect(sellTokensPool(
      testFuruPool,
      100,
      testUserTokenAddress,
      testUserWif,
      provider
    )).rejects.toThrow('Insufficient tokens to sell');
  });

  it('Should throw with insufficient BCH for miner fee', async() => {
    const provider = setupProvider();

    // user has tokens but no BCH
    provider.addUtxo(testUserTokenAddress, randomUtxo({
      token: {
        category: testFuruPool.token_id,
        amount: 500n
      }
    }))

    await expect(sellTokensPool(
      testFuruPool,
      100,
      testUserTokenAddress,
      testUserWif,
      provider
    )).rejects.toThrow('Insufficient funds for miner fee');
  });
});
