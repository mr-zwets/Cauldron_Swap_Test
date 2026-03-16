# Cauldron Swap Test

Cauldron Swap Test using the CashScript SDK

Relies on the Cauldron indexer and public API to find the Cauldron contracts.

**NOTE**: the code is still in development with very limited tests so proceed with great caution!

## Buy Tokens

```ts
import { getCauldronPools, prepareBuyTokens } from "./index"
import { userTokenAddress, privateKeyWif } from "./somewhere"

const furuTokenId = "d9ab24ed15a7846cc3d9e004aa5cb976860f13dac1ead05784ee4f4622af96ea"
const amountToBuy = 100

// fetch pools for tokenId
const cauldronPools = await getCauldronPools(furuTokenId)

// select a cauldron pool to trade with
const poolToUse = cauldronPools[0]

// prepare buy transaction
const { transactionBuilder } = await prepareBuyTokens(
  poolToUse,
  amountToBuy,
  userTokenAddress,
  privateKeyWif
)

// broadcast the transaction
const txDetails = await transactionBuilder.send()
```

## Sell Tokens

```ts
import { getCauldronPools, prepareSellTokens } from "./index"
import { userTokenAddress, privateKeyWif } from "./somewhere"

const furuTokenId = "d9ab24ed15a7846cc3d9e004aa5cb976860f13dac1ead05784ee4f4622af96ea"
const amountToSell = 100

const cauldronPools = await getCauldronPools(furuTokenId)
const poolToUse = cauldronPools[0]

// prepare sell transaction
const { transactionBuilder } = await prepareSellTokens(
  poolToUse,
  amountToSell,
  userTokenAddress,
  privateKeyWif
)

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
const amountToBuy = 100

// fetch pools from chipnet indexer
const cauldronPools = await getCauldronPools(chipnetTokenId, 'chipnet')

const poolToUse = cauldronPools[0]

// use a chipnet provider for the transaction
const provider = new ElectrumNetworkProvider('chipnet')
const { transactionBuilder } = await prepareBuyTokens(
  poolToUse,
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

- allow for aggregating across multiple pools for buy and sell
- allow to find the the contracts on-chain with op_returns instead of through a trusted API
