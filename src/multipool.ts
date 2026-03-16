import type { CauldronActivePool, PoolAllocation } from './interfaces.js';

const RATE_DENOMINATOR = 10n ** 13n;

export function isqrt(value: bigint): bigint {
  if (value < 0n) throw new Error('isqrt of negative number');
  if (value === 0n) return 0n;
  let current = value;
  let next = (current + 1n) / 2n;
  while (next < current) {
    current = next;
    next = (current + value / current) / 2n;
  }
  return current;
}

export function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator - 1n) / denominator;
}

export function calcBuyFromPool(pool: CauldronActivePool, demandTokens: bigint): { supplyAmount: bigint; feeAmount: bigint } {
  if (demandTokens === 0n) return { supplyAmount: 0n, feeAmount: 0n };
  const poolConstantK = BigInt(pool.tokens) * BigInt(pool.sats);
  const newTokens = BigInt(pool.tokens) - demandTokens;
  if (newTokens <= 0n) throw new Error('Cannot buy more tokens than pool has');
  const newSatsExclFee = ceilDiv(poolConstantK, newTokens);
  const tradeValue = newSatsExclFee - BigInt(pool.sats);
  const feeAmount = tradeValue * 3n / 1000n;
  const supplyAmount = tradeValue + feeAmount;
  return { supplyAmount, feeAmount };
}

export function calcSellToPool(pool: CauldronActivePool, demandTokens: bigint): { supplyAmount: bigint; feeAmount: bigint } {
  if (demandTokens === 0n) return { supplyAmount: 0n, feeAmount: 0n };
  const poolConstantK = BigInt(pool.tokens) * BigInt(pool.sats);
  const newTokens = BigInt(pool.tokens) + demandTokens;
  const newSatsExclFee = ceilDiv(poolConstantK, newTokens);
  const tradeValue = BigInt(pool.sats) - newSatsExclFee;
  if (tradeValue <= 0n) return { supplyAmount: 0n, feeAmount: 0n };
  const feeAmount = tradeValue * 3n / 1000n;
  const supplyAmount = tradeValue - feeAmount;
  return { supplyAmount, feeAmount };
}

function marginalRate(poolConstantK: bigint, tokens: bigint): bigint {
  return poolConstantK * RATE_DENOMINATOR / (tokens * tokens);
}

function solveBuyAllocations(
  pools: CauldronActivePool[],
  totalTokensToBuy: bigint
): Array<{ pool: CauldronActivePool; demand: bigint }> {
  const poolData = pools.map(pool => ({
    pool,
    poolConstantK: BigInt(pool.tokens) * BigInt(pool.sats),
    tokens: BigInt(pool.tokens),
  }));

  // Check total liquidity (leave at least 1 token in each pool)
  const totalLiquidity = poolData.reduce((sum, poolInfo) => sum + poolInfo.tokens - 1n, 0n);
  if (totalLiquidity < totalTokensToBuy) {
    throw new Error('Insufficient liquidity across all pools');
  }

  // Binary search on target marginal rate
  // At rate r, pool i provides demand = tokens_i - isqrt(K_i * RD / r) (if positive)
  // Higher rate → more demand
  let low = 0n;
  let high = poolData.reduce((maxRate, poolInfo) => {
    const rate = poolInfo.poolConstantK * RATE_DENOMINATOR; // rate when pool has 1 token
    return rate > maxRate ? rate : maxRate;
  }, 0n);

  while (high - low > 1n) {
    const mid = (low + high) / 2n;
    let totalDemand = 0n;
    for (const poolInfo of poolData) {
      const newTokens = isqrt(poolInfo.poolConstantK * RATE_DENOMINATOR / mid);
      if (newTokens < poolInfo.tokens) {
        totalDemand += poolInfo.tokens - newTokens;
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
  for (const poolInfo of poolData) {
    const newTokens = isqrt(poolInfo.poolConstantK * RATE_DENOMINATOR / high);
    if (newTokens < poolInfo.tokens) {
      allocations.push({ pool: poolInfo.pool, demand: poolInfo.tokens - newTokens });
    }
  }

  // Stepper: adjust total to exactly match target
  let totalDemand = allocations.reduce((sum, allocation) => sum + allocation.demand, 0n);

  // If overshot, remove 1 token at a time from pool with highest marginal rate
  while (totalDemand > totalTokensToBuy) {
    let worstIdx = 0;
    let worstRate = -1n;
    for (let idx = 0; idx < allocations.length; idx++) {
      const allocation = allocations[idx];
      const poolConstantK = BigInt(allocation.pool.tokens) * BigInt(allocation.pool.sats);
      const newTokens = BigInt(allocation.pool.tokens) - allocation.demand;
      const rate = marginalRate(poolConstantK, newTokens);
      if (rate > worstRate) {
        worstRate = rate;
        worstIdx = idx;
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

    for (let idx = 0; idx < allocations.length; idx++) {
      const allocation = allocations[idx];
      const poolConstantK = BigInt(allocation.pool.tokens) * BigInt(allocation.pool.sats);
      const newTokens = BigInt(allocation.pool.tokens) - allocation.demand - 1n;
      if (newTokens <= 0n) continue;
      const rate = marginalRate(poolConstantK, newTokens);
      if (rate < bestRate) {
        bestRate = rate;
        bestIdx = idx;
      }
    }

    // Consider pools not yet in allocations
    for (const poolInfo of poolData) {
      if (allocations.some(allocation => allocation.pool === poolInfo.pool)) continue;
      const rate = marginalRate(poolInfo.poolConstantK, poolInfo.tokens - 1n);
      if (rate < bestRate) {
        bestRate = rate;
        allocations.push({ pool: poolInfo.pool, demand: 0n });
        bestIdx = allocations.length - 1;
      }
    }

    if (bestIdx === -1) throw new Error('Insufficient liquidity across all pools');
    allocations[bestIdx].demand += 1n;
    totalDemand += 1n;
  }

  return allocations.filter(allocation => allocation.demand > 0n);
}

function solveSellAllocations(
  pools: CauldronActivePool[],
  totalTokensToSell: bigint
): Array<{ pool: CauldronActivePool; demand: bigint }> {
  const poolData = pools.map(pool => ({
    pool,
    poolConstantK: BigInt(pool.tokens) * BigInt(pool.sats),
    tokens: BigInt(pool.tokens),
  }));

  // For selling: at rate r, pool i accepts: isqrt(K_i * RD / r) - tokens_i (if positive)
  // Lower rate → more demand

  // Binary search
  let high = poolData.reduce((maxRate, poolInfo) => {
    const rate = marginalRate(poolInfo.poolConstantK, poolInfo.tokens);
    return rate > maxRate ? rate : maxRate;
  }, 0n);
  let low = 1n;

  // Check if sufficient liquidity at minimum rate
  let demandAtLow = 0n;
  for (const poolInfo of poolData) {
    const newTokens = isqrt(poolInfo.poolConstantK * RATE_DENOMINATOR / low);
    if (newTokens > poolInfo.tokens) {
      demandAtLow += newTokens - poolInfo.tokens;
    }
  }
  if (demandAtLow < totalTokensToSell) {
    throw new Error('Insufficient liquidity across all pools');
  }

  while (high - low > 1n) {
    const mid = (low + high) / 2n;
    let totalDemand = 0n;
    for (const poolInfo of poolData) {
      const newTokens = isqrt(poolInfo.poolConstantK * RATE_DENOMINATOR / mid);
      if (newTokens > poolInfo.tokens) {
        totalDemand += newTokens - poolInfo.tokens;
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
  for (const poolInfo of poolData) {
    const newTokens = isqrt(poolInfo.poolConstantK * RATE_DENOMINATOR / low);
    if (newTokens > poolInfo.tokens) {
      allocations.push({ pool: poolInfo.pool, demand: newTokens - poolInfo.tokens });
    }
  }

  // Stepper: adjust total to exactly match target
  let totalDemand = allocations.reduce((sum, allocation) => sum + allocation.demand, 0n);

  // If overshot, remove 1 token from pool with lowest current marginal rate (worst for seller)
  while (totalDemand > totalTokensToSell) {
    let worstIdx = 0;
    let worstRate = 2n ** 128n;
    for (let idx = 0; idx < allocations.length; idx++) {
      const allocation = allocations[idx];
      const poolConstantK = BigInt(allocation.pool.tokens) * BigInt(allocation.pool.sats);
      const newTokens = BigInt(allocation.pool.tokens) + allocation.demand;
      const rate = marginalRate(poolConstantK, newTokens);
      if (rate < worstRate) {
        worstRate = rate;
        worstIdx = idx;
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

    for (let idx = 0; idx < allocations.length; idx++) {
      const allocation = allocations[idx];
      const poolConstantK = BigInt(allocation.pool.tokens) * BigInt(allocation.pool.sats);
      const newTokens = BigInt(allocation.pool.tokens) + allocation.demand + 1n;
      const rate = marginalRate(poolConstantK, newTokens);
      if (rate > bestRate) {
        bestRate = rate;
        bestIdx = idx;
      }
    }

    // Consider pools not yet in allocations
    for (const poolInfo of poolData) {
      if (allocations.some(allocation => allocation.pool === poolInfo.pool)) continue;
      const rate = marginalRate(poolInfo.poolConstantK, poolInfo.tokens + 1n);
      if (rate > bestRate) {
        bestRate = rate;
        allocations.push({ pool: poolInfo.pool, demand: 0n });
        bestIdx = allocations.length - 1;
      }
    }

    if (bestIdx === -1) throw new Error('Insufficient liquidity across all pools');
    allocations[bestIdx].demand += 1n;
    totalDemand += 1n;
  }

  return allocations.filter(allocation => allocation.demand > 0n);
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
        (sum, allocation) => sum + calcBuyFromPool(allocation.pool, allocation.demand).supplyAmount, 0n
      );

      const remainingPools = allocations.slice(1).map(allocation => allocation.pool);
      try {
        const newAllocations = solveBuyAllocations(remainingPools, totalTokensToBuy);
        const newTotalCost = newAllocations.reduce(
          (sum, allocation) => sum + calcBuyFromPool(allocation.pool, allocation.demand).supplyAmount, 0n
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

  return allocations.map(allocation => {
    const { supplyAmount, feeAmount } = calcBuyFromPool(allocation.pool, allocation.demand);
    return { pool: allocation.pool, demandAmount: allocation.demand, supplyAmount, feeAmount };
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
        (sum, allocation) => sum + calcSellToPool(allocation.pool, allocation.demand).supplyAmount, 0n
      );

      const remainingPools = allocations.slice(1).map(allocation => allocation.pool);
      try {
        const newAllocations = solveSellAllocations(remainingPools, totalTokensToSell);
        const newTotalReceived = newAllocations.reduce(
          (sum, allocation) => sum + calcSellToPool(allocation.pool, allocation.demand).supplyAmount, 0n
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

  return allocations.map(allocation => {
    const { supplyAmount, feeAmount } = calcSellToPool(allocation.pool, allocation.demand);
    return { pool: allocation.pool, demandAmount: allocation.demand, supplyAmount, feeAmount };
  });
}
