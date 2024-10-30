# Cauldron Swap Test

Cauldron Swap Test using the CashScript SDK

**NOTE**: the code is currently only has a single test case so proceed with great caution!

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

## Run the Tests

```
npm i
npm run test
```

or using yarn:

```
yarn
yarn test
```

## Difficulties

- Cauldron contract doesn't have an official CashScript Artifact
-> solution convert the whitepaper opcodes to CashScript asm (note the encoding of OP_2 & OP_3 and a missing OP_EQUALVERIFY opcode in the whitepaper)

- CashScript doesn't currently support the `<withdraw_pkh>` templated variables in the middle of the contract code
-> solved: replace the template string in the Artifact's `bytecode` before initalizing contract

- How to find all Cauldron contracts when they are all at unique addresses?
-> solved: use their centralized endpoint for info for now