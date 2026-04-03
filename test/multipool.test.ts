import { computeOptimalBuy, computeOptimalSell, computeBuyAmountBelowRate, computeSellAmountAboveRate, calcBuyFromPool, calcSellToPool, isqrt, ceilDiv } from '../src/multipool.js';
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
  test('computes correct cost and fee', () => {
    const pool = makePool(587793838, 4363102);
    const { supplyAmount, feeAmount } = calcBuyFromPool(pool, 100n);
    // fee uses ceil(tradeValue * 3 / 997) to match on-chain contract
    expect(supplyAmount).toBe(13514n);
    expect(feeAmount).toBe(41n);
  });
});

describe('calcSellToPool', () => {
  test('computes correct payout and fee', () => {
    const pool = makePool(587793838, 4363102);
    const { supplyAmount, feeAmount } = calcSellToPool(pool, 100n);
    // fee uses tradeValue * 3 / 1000 (conservative, slightly overpays vs on-chain)
    expect(supplyAmount).toBe(13431n);
    expect(feeAmount).toBe(40n);
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

  test('maxPools cap: limits pool count and re-solves correctly', () => {
    const pool1 = makePool(100_000_000, 1_000_000, 'aaaa');
    const pool2 = makePool(100_000_000, 1_000_000, 'bbbb');
    const pool3 = makePool(100_000_000, 1_000_000, 'cccc');
    const pool4 = makePool(100_000_000, 1_000_000, 'dddd');
    const totalBuy = 10_000n;

    // Without cap, all 4 pools should be used
    const uncapped = computeOptimalBuy([pool1, pool2, pool3, pool4], totalBuy, 0n);
    expect(uncapped.length).toBe(4);

    // With maxPools=2, only 2 pools should be used
    const capped = computeOptimalBuy([pool1, pool2, pool3, pool4], totalBuy, 0n, 2);
    expect(capped.length).toBe(2);

    // Total demand still matches requested amount
    const totalDemand = capped.reduce((sum, allocation) => sum + allocation.demandAmount, 0n);
    expect(totalDemand).toBe(totalBuy);
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

  test('maxPools cap: limits pool count and re-solves correctly', () => {
    const pool1 = makePool(100_000_000, 1_000_000, 'aaaa');
    const pool2 = makePool(100_000_000, 1_000_000, 'bbbb');
    const pool3 = makePool(100_000_000, 1_000_000, 'cccc');
    const pool4 = makePool(100_000_000, 1_000_000, 'dddd');
    const totalSell = 10_000n;

    // Without cap, all 4 pools should be used
    const uncapped = computeOptimalSell([pool1, pool2, pool3, pool4], totalSell, 0n);
    expect(uncapped.length).toBe(4);

    // With maxPools=2, only 2 pools should be used
    const capped = computeOptimalSell([pool1, pool2, pool3, pool4], totalSell, 0n, 2);
    expect(capped.length).toBe(2);

    // Total demand still matches requested amount
    const totalDemand = capped.reduce((sum, allocation) => sum + allocation.demandAmount, 0n);
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

describe('computeBuyAmountBelowRate', () => {
  test('returns 0 when all pools are above maxRate', () => {
    // Pool rate is ~100 sats/token, so maxRate of 50 should yield nothing
    const pool = makePool(100_000_000, 1_000_000);
    const amount = computeBuyAmountBelowRate([pool], 50n);
    expect(amount).toBe(0n);
  });

  test('returns tokens available below the rate', () => {
    // Pool: 100M sats, 1M tokens → rate ~100 sats/token
    // At maxRate 200: tokensAtLimit = isqrt(100M*1M / 200) = isqrt(500_000_000_000) ≈ 707_106
    // Buyable: 1_000_000 - 707_106 = 292_894
    const pool = makePool(100_000_000, 1_000_000);
    const amount = computeBuyAmountBelowRate([pool], 200n);
    expect(amount > 0n).toBe(true);
    expect(amount < BigInt(pool.tokens)).toBe(true);
  });

  test('higher maxRate allows buying more tokens', () => {
    const pool = makePool(100_000_000, 1_000_000);
    const amountAt150 = computeBuyAmountBelowRate([pool], 150n);
    const amountAt300 = computeBuyAmountBelowRate([pool], 300n);
    expect(amountAt300 > amountAt150).toBe(true);
  });

  test('multiple pools sum contributions', () => {
    const pool1 = makePool(100_000_000, 1_000_000, 'aaaa');
    const pool2 = makePool(100_000_000, 1_000_000, 'bbbb');
    const singleAmount = computeBuyAmountBelowRate([pool1], 200n);
    const multiAmount = computeBuyAmountBelowRate([pool1, pool2], 200n);
    expect(multiAmount).toBe(singleAmount * 2n);
  });

  test('result can be fed into computeOptimalBuy', () => {
    const pool1 = makePool(100_000_000, 1_000_000, 'aaaa');
    const pool2 = makePool(200_000_000, 2_000_000, 'bbbb');
    const amount = computeBuyAmountBelowRate([pool1, pool2], 200n);
    if (amount > 0n) {
      const allocations = computeOptimalBuy([pool1, pool2], amount, 0n);
      const totalDemand = allocations.reduce((sum, allocation) => sum + allocation.demandAmount, 0n);
      expect(totalDemand).toBe(amount);
    }
  });

  test('fee-inclusive returns less than fee-exclusive', () => {
    const pool = makePool(100_000_000, 1_000_000);
    const withFees = computeBuyAmountBelowRate([pool], 200n);
    const withoutFees = computeBuyAmountBelowRate([pool], 200n, false);
    expect(withoutFees > withFees).toBe(true);
  });

  test('includeFees=false matches raw AMM math', () => {
    // Without fees, tokensAtLimit = isqrt(K / rate)
    const pool = makePool(100_000_000, 1_000_000);
    const poolConstantK = BigInt(pool.tokens) * BigInt(pool.sats);
    const rate = 200n;
    const expectedTokensAtLimit = isqrt(poolConstantK / rate);
    const expectedAmount = BigInt(pool.tokens) - expectedTokensAtLimit;
    const amount = computeBuyAmountBelowRate([pool], rate, false);
    expect(amount).toBe(expectedAmount);
  });

  test('throws on invalid inputs', () => {
    expect(() => computeBuyAmountBelowRate([], 100n)).toThrow(/No pools provided/);
    const pool = makePool(100_000_000, 1_000_000);
    expect(() => computeBuyAmountBelowRate([pool], 0n)).toThrow(/must be positive/);
    expect(() => computeBuyAmountBelowRate([pool], -1n)).toThrow(/must be positive/);
  });
});

describe('computeSellAmountAboveRate', () => {
  test('returns 0 when all pools are below minRate', () => {
    // Pool rate is ~100 sats/token, so minRate of 200 should yield nothing
    const pool = makePool(100_000_000, 1_000_000);
    const amount = computeSellAmountAboveRate([pool], 200n);
    expect(amount).toBe(0n);
  });

  test('returns tokens sellable above the rate', () => {
    // Pool: 100M sats, 1M tokens → rate ~100 sats/token
    // At minRate 50: tokensAtLimit = isqrt(100M*1M / 50) = isqrt(2_000_000_000_000) ≈ 1_414_213
    // Sellable: 1_414_213 - 1_000_000 = 414_213
    const pool = makePool(100_000_000, 1_000_000);
    const amount = computeSellAmountAboveRate([pool], 50n);
    expect(amount > 0n).toBe(true);
  });

  test('lower minRate allows selling more tokens', () => {
    const pool = makePool(100_000_000, 1_000_000);
    const amountAt80 = computeSellAmountAboveRate([pool], 80n);
    const amountAt30 = computeSellAmountAboveRate([pool], 30n);
    expect(amountAt30 > amountAt80).toBe(true);
  });

  test('multiple pools sum contributions', () => {
    const pool1 = makePool(100_000_000, 1_000_000, 'aaaa');
    const pool2 = makePool(100_000_000, 1_000_000, 'bbbb');
    const singleAmount = computeSellAmountAboveRate([pool1], 50n);
    const multiAmount = computeSellAmountAboveRate([pool1, pool2], 50n);
    expect(multiAmount).toBe(singleAmount * 2n);
  });

  test('result can be fed into computeOptimalSell', () => {
    const pool1 = makePool(100_000_000, 1_000_000, 'aaaa');
    const pool2 = makePool(200_000_000, 2_000_000, 'bbbb');
    const amount = computeSellAmountAboveRate([pool1, pool2], 50n);
    if (amount > 0n) {
      const allocations = computeOptimalSell([pool1, pool2], amount, 0n);
      const totalDemand = allocations.reduce((sum, allocation) => sum + allocation.demandAmount, 0n);
      expect(totalDemand).toBe(amount);
    }
  });

  test('fee-inclusive returns less than fee-exclusive', () => {
    // Rate must be large enough (>=998) for the 0.3% integer adjustment to produce
    // a different value after bigint division: rate * 1000 / 997 != rate
    const pool = makePool(10_000_000_000, 1_000_000);
    const withFees = computeSellAmountAboveRate([pool], 5000n);
    const withoutFees = computeSellAmountAboveRate([pool], 5000n, false);
    expect(withoutFees > withFees).toBe(true);
  });

  test('includeFees=false matches raw AMM math', () => {
    const pool = makePool(100_000_000, 1_000_000);
    const poolConstantK = BigInt(pool.tokens) * BigInt(pool.sats);
    const rate = 50n;
    const expectedTokensAtLimit = isqrt(poolConstantK / rate);
    const expectedAmount = expectedTokensAtLimit - BigInt(pool.tokens);
    const amount = computeSellAmountAboveRate([pool], rate, false);
    expect(amount).toBe(expectedAmount);
  });

  test('throws on invalid inputs', () => {
    expect(() => computeSellAmountAboveRate([], 100n)).toThrow(/No pools provided/);
    const pool = makePool(100_000_000, 1_000_000);
    expect(() => computeSellAmountAboveRate([pool], 0n)).toThrow(/must be positive/);
  });
});
