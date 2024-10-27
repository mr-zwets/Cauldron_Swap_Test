# Cauldron Swap Test

Cauldron Swap Test using the CashScript SDK

**NOTE**: the code is currently untest so proceed with great caution!

## Usage

```ts
import { getCauldronPools, buyTokensPool } from "./index"
import { userAddress, privateKeyWif } from "./somewhere"

const furuTokenId = "d9ab24ed15a7846cc3d9e004aa5cb976860f13dac1ead05784ee4f4622af96ea"
const cauldronPools = await getCauldronPools(furuTokenId)

// select a cauldron pool based on price/pool size
const poolTosUse = cauldronPools[0]
const txid = await buyTokensPool(
  pool: poolTosUse,
  amountToBuy: 100n,
  userAddress,
  privateKeyWif
)
```

## Difficulties

- CashScript doesn't currently support the `<withdraw_pkh>` templated variables in the middle of the contract code
-> solved: replace the template string in the Artifact's `bytecode` before initalizing contract

- How to find all Cauldron contracts when they are all at unique addresses?
-> solved: use their centralized endpoint for info for now