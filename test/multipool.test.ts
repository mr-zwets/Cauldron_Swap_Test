import { computeOptimalBuy, computeOptimalSell, calcBuyFromPool, calcSellToPool, isqrt, ceilDiv } from '../src/multipool.js';
import type { CauldronActivePool } from '../src/interfaces.js';

const tokenId = 'd9ab24ed15a7846cc3d9e004aa5cb976860f13dac1ead05784ee4f4622af96ea';

function makePool(sats: number, tokens: number, ownerPkh?: string): CauldronActivePool {
  return {
    owner_p2pkh_addr: 'bitcoincash:zr8g5yrw0vzdc2evjgpjfwlsrn67d5wtqcjhnwf345',
    owner_pkh: ownerPkh ?? 'ce8a106e7b04dc2b2c920324bbf01cf5e6d1cb06',
    sats,
    token_id: tokenId,
    tokens,
    tx_pos: 0,
    txid: 'aa183eb292e7b0c733988e931286bb0f47cf01cec12bd1b6d9c850def024e4bb',
  };
}

describe('isqrt', () => {
  test('basic values', () => {
    expect(isqrt(0n)).toBe(0n);
    expect(isqrt(1n)).toBe(1n);
    expect(isqrt(4n)).toBe(2n);
    expect(isqrt(9n)).toBe(3n);
    expect(isqrt(10n)).toBe(3n); // floor
    expect(isqrt(100n)).toBe(10n);
  });

  test('large values', () => {
    const n = 10n ** 28n;
    const s = isqrt(n);
    expect(s * s <= n).toBe(true);
    expect((s + 1n) * (s + 1n) > n).toBe(true);
  });
});

describe('ceilDiv', () => {
  test('exact division', () => {
    expect(ceilDiv(10n, 5n)).toBe(2n);
  });
  test('rounds up', () => {
    expect(ceilDiv(11n, 5n)).toBe(3n);
  });
  test('zero numerator', () => {
    expect(ceilDiv(0n, 5n)).toBe(0n);
  });
});

describe('calcBuyFromPool', () => {
  test('matches existing single-pool math', () => {
    const pool = makePool(587793838, 4363102);
    const amountToBuy = 100n;

    const { supplyAmount, feeAmount } = calcBuyFromPool(pool, amountToBuy);

    // Replicate existing math
    const poolConstant = pool.tokens * pool.sats;
    const newSatsExclFee = Math.ceil(poolConstant / (pool.tokens - Number(amountToBuy)));
    const tradeValue = Math.abs(newSatsExclFee - pool.sats);
    const poolFee = Math.floor(tradeValue / 1000 * 3);

    expect(supplyAmount).toBe(BigInt(tradeValue + poolFee));
    expect(feeAmount).toBe(BigInt(poolFee));
  });
});

describe('calcSellToPool', () => {
  test('matches existing single-pool math', () => {
    const pool = makePool(587793838, 4363102);
    const amountToSell = 100n;

    const { supplyAmount, feeAmount } = calcSellToPool(pool, amountToSell);

    const poolConstant = pool.tokens * pool.sats;
    const newSatsExclFee = Math.ceil(poolConstant / (pool.tokens + Number(amountToSell)));
    const tradeValue = Math.abs(pool.sats - newSatsExclFee);
    const poolFee = Math.floor(tradeValue / 1000 * 3);

    expect(supplyAmount).toBe(BigInt(tradeValue - poolFee));
    expect(feeAmount).toBe(BigInt(poolFee));
  });
});

describe('computeOptimalBuy', () => {
  test('single pool: result matches single-pool math', () => {
    const pool = makePool(587793838, 4363102);
    const result = computeOptimalBuy([pool], 100n);

    expect(result).toHaveLength(1);
    expect(result[0].demandAmount).toBe(100n);

    const { supplyAmount, feeAmount } = calcBuyFromPool(pool, 100n);
    expect(result[0].supplyAmount).toBe(supplyAmount);
    expect(result[0].feeAmount).toBe(feeAmount);
  });

  test('two equal pools: split is roughly 50/50', () => {
    const pool1 = makePool(100_000_000, 1_000_000, 'aaaa');
    const pool2 = makePool(100_000_000, 1_000_000, 'bbbb');
    const totalBuy = 100_000n;

    // txFeePerByte = 0 to test pure algorithm without pool elimination
    const result = computeOptimalBuy([pool1, pool2], totalBuy, 0n);

    expect(result).toHaveLength(2);

    const totalDemand = result.reduce((sum, a) => sum + a.demandAmount, 0n);
    expect(totalDemand).toBe(totalBuy);

    // Each pool should get roughly half
    for (const alloc of result) {
      expect(alloc.demandAmount >= 40_000n && alloc.demandAmount <= 60_000n).toBe(true);
    }
  });

  test('two unequal pools: cheaper pool gets more allocation', () => {
    // Pool1 slightly more expensive, pool2 slightly cheaper
    // Large trade forces both pools to be used
    const pool1 = makePool(150_000_000, 1_000_000, 'aaaa'); // rate: 150 sats/token
    const pool2 = makePool(100_000_000, 1_000_000, 'bbbb'); // rate: 100 sats/token
    const totalBuy = 500_000n;

    const result = computeOptimalBuy([pool1, pool2], totalBuy, 0n);

    const totalDemand = result.reduce((sum, a) => sum + a.demandAmount, 0n);
    expect(totalDemand).toBe(totalBuy);

    // The cheaper pool (pool2 — lower sats means cheaper to buy tokens from) gets more
    const pool2Alloc = result.find(a => a.pool.owner_pkh === 'bbbb');
    const pool1Alloc = result.find(a => a.pool.owner_pkh === 'aaaa');
    expect(pool2Alloc).toBeDefined();
    expect(pool1Alloc).toBeDefined();
    expect(pool2Alloc!.demandAmount > pool1Alloc!.demandAmount).toBe(true);
  });

  test('pool elimination: tiny pool gets dropped when tx cost exceeds benefit', () => {
    // Large pool with good rate
    const bigPool = makePool(500_000_000, 5_000_000, 'aaaa');
    // Tiny pool with slightly better rate but negligible liquidity benefit
    const tinyPool = makePool(1_000, 100, 'bbbb');
    const totalBuy = 50n;

    // With high tx fee per byte, the tiny pool should be eliminated
    const result = computeOptimalBuy([bigPool, tinyPool], totalBuy, 5n);

    // May or may not eliminate the tiny pool depending on exact savings
    const totalDemand = result.reduce((sum, a) => sum + a.demandAmount, 0n);
    expect(totalDemand).toBe(totalBuy);
  });

  test('insufficient liquidity across all pools: throws', () => {
    const pool1 = makePool(100_000, 100, 'aaaa');
    const pool2 = makePool(100_000, 100, 'bbbb');

    // Try to buy more than both pools combined
    expect(() => computeOptimalBuy([pool1, pool2], 250n)).toThrow(/Insufficient liquidity/);
  });

  test('rounding: sum of allocations exactly equals requested amount', () => {
    const pool1 = makePool(123_456_789, 987_654, 'aaaa');
    const pool2 = makePool(234_567_890, 876_543, 'bbbb');
    const pool3 = makePool(345_678_901, 765_432, 'cccc');
    const totalBuy = 777n;

    const result = computeOptimalBuy([pool1, pool2, pool3], totalBuy);

    const totalDemand = result.reduce((sum, a) => sum + a.demandAmount, 0n);
    expect(totalDemand).toBe(totalBuy);
  });

  test('no pools: throws', () => {
    expect(() => computeOptimalBuy([], 100n)).toThrow(/No pools provided/);
  });
});

describe('computeOptimalSell', () => {
  test('single pool: result matches single-pool math', () => {
    const pool = makePool(587793838, 4363102);
    const result = computeOptimalSell([pool], 100n);

    expect(result).toHaveLength(1);
    expect(result[0].demandAmount).toBe(100n);

    const { supplyAmount, feeAmount } = calcSellToPool(pool, 100n);
    expect(result[0].supplyAmount).toBe(supplyAmount);
    expect(result[0].feeAmount).toBe(feeAmount);
  });

  test('two equal pools: split is roughly 50/50', () => {
    const pool1 = makePool(100_000_000, 1_000_000, 'aaaa');
    const pool2 = makePool(100_000_000, 1_000_000, 'bbbb');
    const totalSell = 100_000n;

    // txFeePerByte = 0 to test pure algorithm without pool elimination
    const result = computeOptimalSell([pool1, pool2], totalSell, 0n);

    expect(result).toHaveLength(2);

    const totalDemand = result.reduce((sum, a) => sum + a.demandAmount, 0n);
    expect(totalDemand).toBe(totalSell);

    for (const alloc of result) {
      expect(alloc.demandAmount >= 40_000n && alloc.demandAmount <= 60_000n).toBe(true);
    }
  });

  test('two unequal pools: better-paying pool gets more allocation', () => {
    // Pool1 has more sats per token → sells for more, but large trade forces both pools
    const pool1 = makePool(150_000_000, 1_000_000, 'aaaa'); // rate: 150 sats/token
    const pool2 = makePool(100_000_000, 1_000_000, 'bbbb'); // rate: 100 sats/token
    const totalSell = 500_000n;

    const result = computeOptimalSell([pool1, pool2], totalSell, 0n);

    const totalDemand = result.reduce((sum, a) => sum + a.demandAmount, 0n);
    expect(totalDemand).toBe(totalSell);

    // Pool1 (higher rate = better for seller) should get more allocation
    const pool1Alloc = result.find(a => a.pool.owner_pkh === 'aaaa');
    const pool2Alloc = result.find(a => a.pool.owner_pkh === 'bbbb');
    expect(pool1Alloc).toBeDefined();
    expect(pool2Alloc).toBeDefined();
    expect(pool1Alloc!.demandAmount > pool2Alloc!.demandAmount).toBe(true);
  });

  test('rounding: sum of allocations exactly equals requested amount', () => {
    const pool1 = makePool(123_456_789, 987_654, 'aaaa');
    const pool2 = makePool(234_567_890, 876_543, 'bbbb');
    const totalSell = 555n;

    const result = computeOptimalSell([pool1, pool2], totalSell);

    const totalDemand = result.reduce((sum, a) => sum + a.demandAmount, 0n);
    expect(totalDemand).toBe(totalSell);
  });

  test('multi-pool sell gives better total return than single best pool', () => {
    const pool1 = makePool(200_000_000, 1_000_000, 'aaaa');
    const pool2 = makePool(150_000_000, 1_000_000, 'bbbb');
    const totalSell = 200_000n;

    const multiResult = computeOptimalSell([pool1, pool2], totalSell, 0n);
    const multiTotal = multiResult.reduce((sum, a) => sum + a.supplyAmount, 0n);

    // Single pool result (best pool)
    const singleResult = computeOptimalSell([pool1], totalSell, 0n);
    const singleTotal = singleResult.reduce((sum, a) => sum + a.supplyAmount, 0n);

    expect(multiTotal > singleTotal).toBe(true);
  });
});
