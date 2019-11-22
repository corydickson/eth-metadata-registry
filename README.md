# On-chain IPFS Metadata Registry

Just like it sounds! Use your deployment keys to link metadata stored on IPFS to your contracts.

Live on mainnet @ 0xb0a93fa2a87b3abf1f2cdf9dc2a266dc6bf30482 (⚠️  use at your own risk)

## Overview

This registry allows deployment keys to submit an IPFS [multihash](https://github.com/multiformats/multihash) containing metadata (in any format the
author wishes) that will be associated with their given contract. After the first successful submission, the `msg.sender` assumes the delegate role.
A delegate can update a multihash for a particular contract, as well as remove said entry from the registry.

Delegates can replace themselves with any other ethereum address using the `setDelegate` method. Once this transaction is mined, they revoke all
publishing ability for that given contract (including the deployment key).

## Implementation

IPFS hash is often represented using 46 character long Base58 encoding(e.g. `QmahqCsAUAw7zMv6P6Ae8PjCTck7taQA6FgGQLnWdKG7U8`). We use the approach
layed out [here](https://github.com/saurfang/ipfs-multihash-on-solidity) to make storing hashes less expensive. Furthermore, `setEntry` relies on
the nonce of the deployment key for the first transaction only. This parameter becomes negligable for all subsequent calls since the deployment check
happens only once, then relying on the delegate role for all further permissions.

## Install

`npm install`

## Testing

`npm run test`
