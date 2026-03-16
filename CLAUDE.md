# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

TypeScript SDK for interacting with Cauldron liquidity pools on Bitcoin Cash (BCH). Uses CashScript SDK to build and sign swap/withdrawal transactions, and the Cauldron indexer API to discover pools.

**Status**: Early development (v0.1.0) with limited test coverage.

## Commands

```bash
pnpm install          # install dependencies
pnpm test             # run all tests (vitest in watch mode)
pnpm test -- --run    # run tests once without watch
pnpm test -- --run test/swap.test.ts  # run a single test file
```

## Architecture

**Core flow**: Fetch pools from indexer → select a pool → build a CashScript transaction → sign and broadcast.

### Key modules

- `src/index.ts` — Exported API: `getCauldronPools`, `parsePoolPrices`, `prepareBuyTokens`, `prepareSellTokens`, `prepareWithdrawAll`
- `src/utils.ts` — `cauldronArtifactWithPkh()` patches a `<withdraw_pkh>` placeholder in artifact bytecode at runtime; `convertPoolToUtxo()` adapts pool data to CashScript UTXO format; `validateTokenAddress()` validates CashAddress is token-aware; `gatherBchUtxos()` / `gatherTokenUtxos()` for UTXO selection
- `src/interfaces.ts` — `CauldronActivePool` type definition
- `src/artifact/` — Two custom CashScript JSON artifacts (swap and managePool) since the Cauldron contract is raw BCH Script, not CashScript (see `artifacts.md` for rationale)

### Why two artifacts

CashScript doesn't support multi-function contracts with proper function indexing for raw script contracts. `swap_artifact.json` has a no-arg `swap()` function; `managepool_artifact.json` has `managePool(pubkey, sig)`. The `<withdraw_pkh>` template variable in the bytecode is replaced at runtime with the actual pool owner's public key hash.

### Transaction building

All prepare functions (`prepareBuyTokens`, `prepareSellTokens`, `prepareWithdrawAll`) return `{ transactionBuilder, inputUtxos }` instead of broadcasting directly. Consumers call `.send()` on the builder to broadcast, or `.build()` to get the raw hex. The `inputUtxos` array is provided for external fee calculation.

Transactions use CashScript's `TransactionBuilder` (not the contract's higher-level `.functions` API) to manually compose inputs/outputs with `maximumFeeSatsPerByte: 5`. Contracts use `p2sh32` address type. The swap fee is 0.3% (`tradeValue / 1000 * 3`).

UTXO selection: `prepareBuyTokens` uses `gatherBchUtxos` (multi-input, since trade amounts can be large). `prepareSellTokens` uses `gatherTokenUtxos` (multi-input for tokens) + a single BCH fee UTXO. Fee calculation uses a base fee + 180 sats per additional user input.

### Dependencies

- `cashscript` — CashScript SDK for contract interaction and transaction building
- `@bitauth/libauth` — Crypto primitives (hash160, binToHex, decodeCashAddress)

### Testing

Tests use `MockNetworkProvider` from CashScript to avoid real blockchain calls. Test files are in `test/` and mirror the main API functions. Tests verify transaction validity via `.build()` and validate fee rates (1-5 sat/byte) using `test/utils.ts:calculateTransactionFee()`. Sell tests cover single token input, multiple small token inputs, exact balance (no change), and combined BCH+tokens on a single input.
