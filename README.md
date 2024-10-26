# Cauldron Swap Test

## Difficulties

- CashScript doesn't currently support the `<withdraw_pkh>` templated variables in the middle of the contract code
-> workaround: manually replace the template string in the Artifact's `bytecode`

- How to find all Cauldron contracts when they are all at unique addresses?