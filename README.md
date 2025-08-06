# Cauldron Swap Test

Cauldron Swap Test using the CashScript SDK

**NOTE**: the code is still in development with very limited tests so proceed with great caution!

## Swap Usage

```ts
import { getCauldronPools, buyTokensPool } from "./index"
import { userTokenAddress, privateKeyWif } from "./somewhere"

const furuTokenId = "d9ab24ed15a7846cc3d9e004aa5cb976860f13dac1ead05784ee4f4622af96ea"
const cauldronPools = await getCauldronPools(furuTokenId)

// select a cauldron pool based on price/pool size
const poolToUse = cauldronPools[0]
const txid = await buyTokensPool(
  pool: poolToUse,
  amountToBuy: 100n,
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
const myPool = cauldronPools.filter(pool => pool.owner_p2pkh_addr == poolOwnerAddress)
const txid = await withdrawAllFromPool(
  pool: myPool,
  userTokenAddress,
  privateKeyWif,
)
```

## Run the Tests

```
npm i
npm run test
```

or using pnpm:

```
pnpm
pnpm run test
```

## Difficulties

- The Cauldron contract doesn't have a CashScript Artifact as it's written in raw BCH Script
-> solution convert the whitepaper opcodes to CashScript asm (note the encoding of OP_2 & OP_3 and a missing OP_EQUALVERIFY opcode in the whitepaper)

- CashScript Artifacts currently don't support the `<withdraw_pkh>` templated variables in the middle of the contract code
-> solved: replace the template string in the Artifact's `bytecode` before initalizing contract

- Artifact expects to use a `FunctionIndex` argument when there more than 1 `abi` function
-> solved: use 2 separate Artifacts to represent the Cauldron contract

- How to find all Cauldron contracts when they are all at unique addresses?
-> solved: use the Cauldron centralized endpoint for info for now
other solution: Caulron txs are marked on-chain with OPRETURN `SUMMON <PKH>`