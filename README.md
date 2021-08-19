# Tornado Pool [![Build Status](https://github.com/tornadocash/tornado-pool/workflows/build/badge.svg)](https://github.com/tornadocash/tornado-pool/actions)

## Usage

```shell
yarn
yarn download
yarn build
yarn test
```

TODO

1. deposit from mainnet to the pool on optimism in one tx

## Useful

How we do transaction inside pool of A amount.

1. sort inputs by amount
2. try to take 1 or 2 smallest inputs to satisfy A amount. Get 16 inputs if it's not possible using the same way
3. Also you can always use transaction to merge your inputs with change (especially in 16 inputs case)
