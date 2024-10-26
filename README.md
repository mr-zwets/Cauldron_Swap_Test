# Cauldron Swap Test

 Cauldron Swap Test using the CashScript SDK

## Difficulties

- CashScript doesn't currently support the `<withdraw_pkh>` templated variables in the middle of the contract code
-> solved: replace the template string in the Artifact's `bytecode` before initalizing contract

- How to find all Cauldron contracts when they are all at unique addresses?
-> solved: use their centralized endpoint for info for now