# Tornado Pool [![Build Status](https://github.com/tornadocash/tornado-pool/workflows/build/badge.svg)](https://github.com/tornadocash/tornado-pool/actions)

This an experimental version of tornado.cash that allows to deposit arbitrary amounts and make internal(shielded) transfers.

Other facts about this version:

1. It uses L2 (xdai). Xdai has a ETH(mainnet)<>WETH(xdai) bridge that will be used under hood.
2. Contracts will be upgradable by tornado-cash governance! xdai bridge supports transferring messages from L1 to L2 and vise versa, so community can always upgrade tornado-pool to a new version in case of an issue.
3. Since it's a beta version, deposits are limited by 1ETH. Governance can always increase the limit.
4. Withdrawal amount from pool to L1 has to be larger than 0.05 ETH to prevent spam attack on the bridge.
5. The code was [audited](./resources/Zeropool-Tornado.pool-audit.pdf) by Igor Gulamov from Zeropool.

## Usage

```shell
yarn
yarn download
yarn build
yarn test
```
