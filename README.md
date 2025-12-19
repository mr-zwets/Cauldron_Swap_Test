# Cauldron Swap Test

Cauldron Swap Test using the CashScript SDK

Relies on the Cauldron indexer and public API to find the Cauldron contracts.

**NOTE**: the code is still in development with very limited tests so proceed with great caution!

## Swap Usage

```ts
import { getCauldronPools, buyTokensPool } from "./index"
import { userTokenAddress, privateKeyWif } from "./somewhere"

const furuTokenId = "d9ab24ed15a7846cc3d9e004aa5cb976860f13dac1ead05784ee4f4622af96ea"
const amountToBuy = 100n

// fetch pools for tokenId
const cauldronPools = await getCauldronPools(furuTokenId) 

// select a cauldron pool to trade with
const poolToUse = cauldronPools[0]

// buy tokens from pool
const txid = await buyTokensPool(
  poolToUse,
  amountToBuy,
  userTokenAddress,
  privateKeyWif
)
```

## ManagePool Usage

```ts
import { getCauldronPools, withdrawAllFromPool } from "./index"
import { userTokenAddress, privateKeyWif } from "./somewhere"

const furuTokenId = "d9ab24ed15a7846cc3d9e004aa5cb976860f13dac1ead05784ee4f4622af96ea"
const poolOwnerAddress = "bitcoincash:qps99uejnueu4dsv0dd2m9u9uzxntg66nyux08wmzq" 
const cauldronPools = await getCauldronPools(furuTokenId)

// filter your pool
const poolToUse = cauldronPools.find(pool => pool.owner_p2pkh_addr == poolOwnerAddress)

// withdraw liquidity from your pool
const txid = await withdrawAllFromPool(
  poolToUse,
  userTokenAddress,
  privateKeyWif,
)
```

## Custom Arifacts

The Cauldron contract does not have a ready-to-go CashScript artifact, so custom artifacts were created to be able to use the CashScript SDK tooling.

You can see the JSON artifacts in `src/artifact` and find and explanation of this in `artifacts.md`

## Run the Tests

```
npm i
npm run test
```

or using pnpm:

```
pnpm i
pnpm run test
```

## Future Extensions

- add a `sellTokensPool` function
- allow for aggregating acorss multiple pools
- allow to find the the contracts on-chain with op_returns instead of through a trusted API
