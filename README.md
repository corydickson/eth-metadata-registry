[![Build Status](https://travis-ci.com/corydickson/eth-metadata-registry.svg?branch=master)](https://travis-ci.com/corydickson/eth-metadata-registry)
# On-chain IPFS Metadata Registry

Just like it sounds! Use your deployment keys to link metadata stored on IPFS to your contracts. Add categories to allow dapps to publish data about your own address or contracts you've deployed.

v0.0.2 Rinkeby: 0x9E9461B6a1A18df1eCe033d66E615d1eF7222113

v0.0.1 Mainnet: 0xa23E8B119A26D36099ee97F0c7dFb8DB20B50D7D (⚠️  use at your own risk)

## Overview

This registry allows deployment keys to submit an IPFS [multihash](https://github.com/multiformats/multihash) containing metadata (in any format the
author wishes) that will be associated with their given contract. After the first successful submission, the `msg.sender` assumes the delegate role.
A delegate can update a multihash for a particular contract, as well as remove any given entry from the registry associated with their particular account.

Delegates can replace themselves with any other ethereum address using the `setDelegate` method. Once this transaction is mined, they revoke all
publishing ability for that given category (including the deployment key) for that particular entry. However, deployers and EOA retain the right to remove entries from
the registry regardless of delegate status.

Deployers can add categories, stored as the keccak256 hash of a string representing the `categoryID`. Once permission is granted other ethereum accounts can submit data on 
behalf of the deployer. This is useful for dapps that want to have their own hash associated with an address. Next steps for dapp developers would be to create a proxy contract
that leverages meta transactions to add a category and submit some initial data in a single transaction using the `updateEntry` method.

## Implementation

IPFS hash is often represented using 46 character long Base58 encoding(e.g. `QmahqCsAUAw7zMv6P6Ae8PjCTck7taQA6FgGQLnWdKG7U8`). We use the approach
layed out [here](https://github.com/saurfang/ipfs-multihash-on-solidity) to make storing hashes less expensive. Furthermore, we have two main methods, `createEntry` which is only
used for initialization; requiring the nonce of the deployment key or a user can provide the `salt` and `init_code` if the contract uses the create2 opcode. All updates to
the registry can rely on the other method signature: `updateEntry(address,bytes32,uint8,uint8,bytes32)` that *does not* require the nonce. Once an initial entry is set the
`msg.sender` becomes the delegate. Anyone can commit metadata about their own address making them the default delegate for the `deployer` category.

Deployers can use `addCategory(address,bytes32,address)` to permission new entries allowing accounts to publish an entry at a particular `categoryID` on their behalf and specify an `initalDelegate`.
Also, both deployers and EOA retain the right to revoke publishing priviliges by deleteing a particular category from their approved list by using the
`deleteCategory(address,bytes32)` method which also removes that corresponding entry from the registry.

### Usage Notes

- Use null address `0x0000000000000000000000000000000000000000` for the initial delegate when calling `addCategory` to give `msg.sender` permissions for a particular `categoryID`
- The delegate `0xffffffffffffffffffffffffffffffffffffffff` allows all ethereum addresses to update the IPFS hash for a given entry
- For `createEntry` a boolean represents which opcode was used to deploy the contract: `create2 === true` && `create === false`

![Image of UMLDiagram](http://www.plantuml.com/plantuml/png/jP91QiCm44NtEiKi4wXxW61Ce0bqtT9LAK5Olwv1bemaf_ZsLGGU72etXEAL6MQUvtr9Un-a2qEdXQo3TNH0h-q8nwL68mE4c1fKLFI2flN1ZRIZsY6sZoPM5wGznuhxWWTdq8vErkYH5otCU8HfEMqwtpnw60MtlR4bcYIlifohqQQsyHlHarJAFL3RV_fdwR-sL5NCbqNn4T54l2BGyGmJXCBlZUzbCNCzM0EHyMB_woCRUdNRww-Zuql91-S5zmP_IvnAu5hXQmtfSch_IhpyrwNxVReGK6l5l7gz1j-PY4aZsMU6y-RJrFsFSm-ZXax_0000)

## Gas Estimates

Gas price @ 2000000000 gwei

| Method | gas (wei) | gas (ether) |
--- | --- | ---
createEntry (nonce) | 234592000000000 | 0.000234592
updateEntry | 113896000000000 | 0.000113896
setDelegate | 64582000000000 | 0.000064582
clearEntry | 172312000000000 | 0.000172312
addCategory |  96508000000000 | 0.000096508
deleteCategory | 220250000000000 | 0.00022025

## Install

`yarn install`

## Testing

`yarn run test`
