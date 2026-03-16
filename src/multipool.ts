import type { CauldronActivePool, PoolAllocation } from './interfaces.js';

const RATE_DENOMINATOR = 10n ** 13n;

export function isqrt(n: bigint): bigint {
  if (n < 0n) throw new Error('isqrt of negative number');
  if (n === 0n) return 0n;
  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
  }
  return x;
}

export function ceilDiv(a: bigint, b: bigint): bigint {
  return (a + b - 1n) / b;
}

export function calcBuyFromPool(pool: CauldronActivePool, demandTokens: bigint): { supplyAmount: bigint; feeAmount: bigint } {
  if (demandTokens === 0n) return { supplyAmount: 0n, feeAmount: 0n };
  const K = BigInt(pool.tokens) * BigInt(pool.sats);
  const newTokens = BigInt(pool.tokens) - demandTokens;
  if (newTokens <= 0n) throw new Error('Cannot buy more tokens than pool has');
  const newSatsExclFee = ceilDiv(K, newTokens);
  const tradeValue = newSatsExclFee - BigInt(pool.sats);
  const feeAmount = tradeValue * 3n / 1000n;
  const supplyAmount = tradeValue + feeAmount;
  return { supplyAmount, feeAmount };
}

export function calcSellToPool(pool: CauldronActivePool, demandTokens: bigint): { supplyAmount: bigint; feeAmount: bigint } {
  if (demandTokens === 0n) return { supplyAmount: 0n, feeAmount: 0n };
  const K = BigInt(pool.tokens) * BigInt(pool.sats);
  const newTokens = BigInt(pool.tokens) + demandTokens;
  const newSatsExclFee = ceilDiv(K, newTokens);
  const tradeValue = BigInt(pool.sats) - newSatsExclFee;
  if (tradeValue <= 0n) return { supplyAmount: 0n, feeAmount: 0n };
  const feeAmount = tradeValue * 3n / 1000n;
  const supplyAmount = tradeValue - feeAmount;
  return { supplyAmount, feeAmount };
}

function marginalRate(K: bigint, tokens: bigint): bigint {
  return K * RATE_DENOMINATOR / (tokens * tokens);
}

function solveBuyAllocations(
  pools: CauldronActivePool[],
  totalTokensToBuy: bigint
): Array<{ pool: CauldronActivePool; demand: bigint }> {
  const poolData = pools.map(p => ({
    pool: p,
    K: BigInt(p.tokens) * BigInt(p.sats),
    tokens: BigInt(p.tokens),
  }));

  // Check total liquidity (leave at least 1 token in each pool)
  const totalLiquidity = poolData.reduce((sum, pd) => sum + pd.tokens - 1n, 0n);
  if (totalLiquidity < totalTokensToBuy) {
    throw new Error('Insufficient liquidity across all pools');
  }

  // Binary search on target marginal rate
  // At rate r, pool i provides demand = tokens_i - isqrt(K_i * RD / r) (if positive)
  // Higher rate → more demand
  let low = 0n;
  let high = poolData.reduce((max, pd) => {
    const r = pd.K * RATE_DENOMINATOR; // rate when pool has 1 token
    return r > max ? r : max;
  }, 0n);

  while (high - low > 1n) {
    const mid = (low + high) / 2n;
    let totalDemand = 0n;
    for (const pd of poolData) {
      const newTokens = isqrt(pd.K * RATE_DENOMINATOR / mid);
      if (newTokens < pd.tokens) {
        totalDemand += pd.tokens - newTokens;
      }
    }
    if (totalDemand >= totalTokensToBuy) {
      high = mid;
    } else {
      low = mid;
    }
  }

  // Compute allocations at rate = high (gives demand >= target)
  const allocations: Array<{ pool: CauldronActivePool; demand: bigint }> = [];
  for (const pd of poolData) {
    const newTokens = isqrt(pd.K * RATE_DENOMINATOR / high);
    if (newTokens < pd.tokens) {
      allocations.push({ pool: pd.pool, demand: pd.tokens - newTokens });
    }
  }

  // Stepper: adjust total to exactly match target
  let totalDemand = allocations.reduce((sum, a) => sum + a.demand, 0n);

  // If overshot, remove 1 token at a time from pool with highest marginal rate
  while (totalDemand > totalTokensToBuy) {
    let worstIdx = 0;
    let worstRate = -1n;
    for (let i = 0; i < allocations.length; i++) {
      const a = allocations[i];
      const K = BigInt(a.pool.tokens) * BigInt(a.pool.sats);
      const newTokens = BigInt(a.pool.tokens) - a.demand;
      const rate = marginalRate(K, newTokens);
      if (rate > worstRate) {
        worstRate = rate;
        worstIdx = i;
      }
    }
    allocations[worstIdx].demand -= 1n;
    totalDemand -= 1n;
    if (allocations[worstIdx].demand === 0n) {
      allocations.splice(worstIdx, 1);
    }
  }

  // If undershot, add 1 token at a time from pool with lowest next marginal rate
  while (totalDemand < totalTokensToBuy) {
    let bestIdx = -1;
    let bestRate = 2n ** 128n;

    for (let i = 0; i < allocations.length; i++) {
      const a = allocations[i];
      const K = BigInt(a.pool.tokens) * BigInt(a.pool.sats);
      const newTokens = BigInt(a.pool.tokens) - a.demand - 1n;
      if (newTokens <= 0n) continue;
      const rate = marginalRate(K, newTokens);
      if (rate < bestRate) {
        bestRate = rate;
        bestIdx = i;
      }
    }

    // Consider pools not yet in allocations
    for (const pd of poolData) {
      if (allocations.some(a => a.pool === pd.pool)) continue;
      const rate = marginalRate(pd.K, pd.tokens - 1n);
      if (rate < bestRate) {
        bestRate = rate;
        allocations.push({ pool: pd.pool, demand: 0n });
        bestIdx = allocations.length - 1;
      }
    }

    if (bestIdx === -1) throw new Error('Insufficient liquidity across all pools');
    allocations[bestIdx].demand += 1n;
    totalDemand += 1n;
  }

  return allocations.filter(a => a.demand > 0n);
}

function solveSellAllocations(
  pools: CauldronActivePool[],
  totalTokensToSell: bigint
): Array<{ pool: CauldronActivePool; demand: bigint }> {
  const poolData = pools.map(p => ({
    pool: p,
    K: BigInt(p.tokens) * BigInt(p.sats),
    tokens: BigInt(p.tokens),
  }));

  // For selling: at rate r, pool i accepts: isqrt(K_i * RD / r) - tokens_i (if positive)
  // Lower rate → more demand

  // Binary search
  let high = poolData.reduce((max, pd) => {
    const r = marginalRate(pd.K, pd.tokens);
    return r > max ? r : max;
  }, 0n);
  let low = 1n;

  // Check if sufficient liquidity at minimum rate
  let demandAtLow = 0n;
  for (const pd of poolData) {
    const newTokens = isqrt(pd.K * RATE_DENOMINATOR / low);
    if (newTokens > pd.tokens) {
      demandAtLow += newTokens - pd.tokens;
    }
  }
  if (demandAtLow < totalTokensToSell) {
    throw new Error('Insufficient liquidity across all pools');
  }

  while (high - low > 1n) {
    const mid = (low + high) / 2n;
    let totalDemand = 0n;
    for (const pd of poolData) {
      const newTokens = isqrt(pd.K * RATE_DENOMINATOR / mid);
      if (newTokens > pd.tokens) {
        totalDemand += newTokens - pd.tokens;
      }
    }
    if (totalDemand >= totalTokensToSell) {
      low = mid;
    } else {
      high = mid;
    }
  }

  // Compute allocations at rate = low (gives demand >= target)
  const allocations: Array<{ pool: CauldronActivePool; demand: bigint }> = [];
  for (const pd of poolData) {
    const newTokens = isqrt(pd.K * RATE_DENOMINATOR / low);
    if (newTokens > pd.tokens) {
      allocations.push({ pool: pd.pool, demand: newTokens - pd.tokens });
    }
  }

  // Stepper: adjust total to exactly match target
  let totalDemand = allocations.reduce((sum, a) => sum + a.demand, 0n);

  // If overshot, remove 1 token from pool with lowest current marginal rate (worst for seller)
  while (totalDemand > totalTokensToSell) {
    let worstIdx = 0;
    let worstRate = 2n ** 128n;
    for (let i = 0; i < allocations.length; i++) {
      const a = allocations[i];
      const K = BigInt(a.pool.tokens) * BigInt(a.pool.sats);
      const newTokens = BigInt(a.pool.tokens) + a.demand;
      const rate = marginalRate(K, newTokens);
      if (rate < worstRate) {
        worstRate = rate;
        worstIdx = i;
      }
    }
    allocations[worstIdx].demand -= 1n;
    totalDemand -= 1n;
    if (allocations[worstIdx].demand === 0n) {
      allocations.splice(worstIdx, 1);
    }
  }

  // If undershot, add 1 token to pool with highest next marginal rate (best for seller)
  while (totalDemand < totalTokensToSell) {
    let bestIdx = -1;
    let bestRate = -1n;

    for (let i = 0; i < allocations.length; i++) {
      const a = allocations[i];
      const K = BigInt(a.pool.tokens) * BigInt(a.pool.sats);
      const newTokens = BigInt(a.pool.tokens) + a.demand + 1n;
      const rate = marginalRate(K, newTokens);
      if (rate > bestRate) {
        bestRate = rate;
        bestIdx = i;
      }
    }

    // Consider pools not yet in allocations
    for (const pd of poolData) {
      if (allocations.some(a => a.pool === pd.pool)) continue;
      const rate = marginalRate(pd.K, pd.tokens + 1n);
      if (rate > bestRate) {
        bestRate = rate;
        allocations.push({ pool: pd.pool, demand: 0n });
        bestIdx = allocations.length - 1;
      }
    }

    if (bestIdx === -1) throw new Error('Insufficient liquidity across all pools');
    allocations[bestIdx].demand += 1n;
    totalDemand += 1n;
  }

  return allocations.filter(a => a.demand > 0n);
}

export function computeOptimalBuy(
  pools: CauldronActivePool[],
  totalTokensToBuy: bigint,
  txFeePerByte: bigint = 1n
): PoolAllocation[] {
  if (pools.length === 0) throw new Error('No pools provided');

  let allocations = solveBuyAllocations(pools, totalTokensToBuy);

  // Pool elimination: drop pools whose savings < tx byte cost
  if (allocations.length > 1) {
    const poolByteCost = 197n * txFeePerByte;
    let changed = true;
    while (changed && allocations.length > 1) {
      changed = false;
      allocations.sort((a, b) => Number(a.demand - b.demand));

      const smallest = allocations[0];
      if (smallest.demand <= 0n) {
        allocations = allocations.slice(1);
        changed = true;
        continue;
      }

      const currentTotalCost = allocations.reduce(
        (sum, a) => sum + calcBuyFromPool(a.pool, a.demand).supplyAmount, 0n
      );

      const remainingPools = allocations.slice(1).map(a => a.pool);
      try {
        const newAllocations = solveBuyAllocations(remainingPools, totalTokensToBuy);
        const newTotalCost = newAllocations.reduce(
          (sum, a) => sum + calcBuyFromPool(a.pool, a.demand).supplyAmount, 0n
        );

        if (newTotalCost - currentTotalCost < poolByteCost) {
          allocations = newAllocations;
          changed = true;
        }
      } catch {
        // Can't fulfill without this pool, keep it
      }
    }
  }

  return allocations.map(a => {
    const { supplyAmount, feeAmount } = calcBuyFromPool(a.pool, a.demand);
    return { pool: a.pool, demandAmount: a.demand, supplyAmount, feeAmount };
  });
}

export function computeOptimalSell(
  pools: CauldronActivePool[],
  totalTokensToSell: bigint,
  txFeePerByte: bigint = 1n
): PoolAllocation[] {
  if (pools.length === 0) throw new Error('No pools provided');

  let allocations = solveSellAllocations(pools, totalTokensToSell);

  // Pool elimination: drop pools whose savings < tx byte cost
  if (allocations.length > 1) {
    const poolByteCost = 197n * txFeePerByte;
    let changed = true;
    while (changed && allocations.length > 1) {
      changed = false;
      allocations.sort((a, b) => Number(a.demand - b.demand));

      const smallest = allocations[0];
      if (smallest.demand <= 0n) {
        allocations = allocations.slice(1);
        changed = true;
        continue;
      }

      const currentTotalReceived = allocations.reduce(
        (sum, a) => sum + calcSellToPool(a.pool, a.demand).supplyAmount, 0n
      );

      const remainingPools = allocations.slice(1).map(a => a.pool);
      try {
        const newAllocations = solveSellAllocations(remainingPools, totalTokensToSell);
        const newTotalReceived = newAllocations.reduce(
          (sum, a) => sum + calcSellToPool(a.pool, a.demand).supplyAmount, 0n
        );

        if (currentTotalReceived - newTotalReceived < poolByteCost) {
          allocations = newAllocations;
          changed = true;
        }
      } catch {
        // Can't fulfill without this pool, keep it
      }
    }
  }

  return allocations.map(a => {
    const { supplyAmount, feeAmount } = calcSellToPool(a.pool, a.demand);
    return { pool: a.pool, demandAmount: a.demand, supplyAmount, feeAmount };
  });
}
