# Cauldron Swap Test

Cauldron Swap Test using the CashScript SDK

Relies on the Cauldron indexer and public API to find the Cauldron contracts.

## Overview

`prepareBuyTokens` and `prepareSellTokens` accept an array of pools and optimally split the trade across them using binary search on the marginal rate of the constant product curve, so each pool ends up at the same marginal cost — minimizing total price impact. Pools that don't save enough to justify their extra transaction bytes are automatically dropped. See [multi-pool.md](multi-pool.md) for details on the algorithm.

## Buy Tokens

```ts
import { getCauldronPools, prepareBuyTokens } from "./index"
import { userTokenAddress, privateKeyWif } from "./somewhere"

const furuTokenId = "d9ab24ed15a7846cc3d9e004aa5cb976860f13dac1ead05784ee4f4622af96ea"
const amountToBuy = 100_000n

const cauldronPools = await getCauldronPools(furuTokenId)

// pass all pools — the SDK optimally splits the trade across pools
const { transactionBuilder, totalSatsCost, totalFees, effectivePricePerToken } = await prepareBuyTokens(
  cauldronPools,
  amountToBuy,
  userTokenAddress,
  privateKeyWif
)

// review the effective price before broadcasting
console.log(`Cost: ${totalSatsCost} sats (${totalFees} fees), ${effectivePricePerToken} sats/token`)

const txDetails = await transactionBuilder.send()
```

## Sell Tokens

```ts
import { getCauldronPools, prepareSellTokens } from "./index"
import { userTokenAddress, privateKeyWif } from "./somewhere"

const furuTokenId = "d9ab24ed15a7846cc3d9e004aa5cb976860f13dac1ead05784ee4f4622af96ea"
const amountToSell = 100_000n

const cauldronPools = await getCauldronPools(furuTokenId)

// pass all pools — the SDK optimally splits the trade across pools
const { transactionBuilder, totalSatsReceived, totalFees, effectivePricePerToken } = await prepareSellTokens(
  cauldronPools,
  amountToSell,
  userTokenAddress,
  privateKeyWif
)

// review the effective price before broadcasting
console.log(`Receive: ${totalSatsReceived} sats (${totalFees} fees), ${effectivePricePerToken} sats/token`)

const txDetails = await transactionBuilder.send()
```

## Withdraw Liquidity

```ts
import { getCauldronPools, prepareWithdrawAll } from "./index"
import { userTokenAddress, privateKeyWif } from "./somewhere"

const furuTokenId = "d9ab24ed15a7846cc3d9e004aa5cb976860f13dac1ead05784ee4f4622af96ea"
const poolOwnerAddress = "bitcoincash:qps99uejnueu4dsv0dd2m9u9uzxntg66nyux08wmzq"
const cauldronPools = await getCauldronPools(furuTokenId)

// filter your pool
const poolToUse = cauldronPools.find(pool => pool.owner_p2pkh_addr == poolOwnerAddress)

// prepare withdraw transaction
const { transactionBuilder } = await prepareWithdrawAll(
  poolToUse,
  userTokenAddress,
  privateKeyWif,
)

const txDetails = await transactionBuilder.send()
```

## Chipnet Usage

```ts
import { ElectrumNetworkProvider } from 'cashscript';
import { getCauldronPools, prepareBuyTokens } from "./index"
import { userTokenAddress, privateKeyWif } from "./somewhere"

const chipnetTokenId = "53636bc8c1afbe35a7ba169eadfac0aebadeacf96954a9a066a483e885580ed4"
const amountToBuy = 100n

// fetch pools from chipnet indexer
const cauldronPools = await getCauldronPools(chipnetTokenId, 'chipnet')

// use a chipnet provider for the transaction
const provider = new ElectrumNetworkProvider('chipnet')
const { transactionBuilder } = await prepareBuyTokens(
  cauldronPools,
  amountToBuy,
  userTokenAddress,
  privateKeyWif,
  provider
)

const txDetails = await transactionBuilder.send()
```

## Custom Arifacts

The Cauldron contract does not have a ready-to-go CashScript artifact, so custom artifacts were created to be able to use the CashScript SDK tooling.

You can see the JSON artifacts in `src/artifact` and find an explanation of this in `artifacts.md`

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

### BCMR token metadata

The trading logic currently operates on base token units (the raw on-chain amount). The BCMR standard allows tokens to define a ticker symbol and decimal places for a higher-level display unit, but this SDK does not yet support that abstraction. Token amounts passed to `prepareBuyTokens`/`prepareSellTokens` must be in base units (and hence are BigInt type).

### On-chain pool discovery

Currently pool discovery relies on the Cauldron indexer API, which is a trusted third party. Ideally pools could be discovered directly on-chain. The challenge is that Cauldron pools use P2SH, so the contract code is hidden behind a hash — you can't identify them by script fingerprinting alone. However, new pools can be discovered by their OP_RETURN marker `SUMMON` in the creation transaction. BCHN's [bytecode pattern RPC](https://gitlab.com/bitcoin-cash-node/bitcoin-cash-node/-/merge_requests/1958) (`redeemBytecodePattern` with fingerprint matching) could help identify existing pools when they are spent, since the redeem script is revealed at spend time.
