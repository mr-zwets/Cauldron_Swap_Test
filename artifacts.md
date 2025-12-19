# Artifacts

## Need for custom artifacts

The Cauldron contract doesn't have a CashScript Artifact as it's written in raw BCH Script
-> converted the whitepaper opcodes to CashScript asm (note the encoding of OP_2 & OP_3 and a missing OP_EQUALVERIFY opcode in the whitepaper)

## Difficulties

- CashScript Artifacts currently don't support the `<withdraw_pkh>` templated variables in the middle of the contract code
-> solved: replace the template string in the Artifact's `bytecode` before initalizing contract

- Artifact expects to use a `FunctionIndex` argument when there more than 1 `abi` function
-> solved: use 2 separate Artifacts to represent the Cauldron contract
