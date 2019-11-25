import { expect } from 'chai';
import { BigNumber } from 'bignumber.js';

import { getBytes32FromMultihash, getMultihashFromContractResponse } from '../src/multihash';
import assertRevert from './helpers/assertRevert';
import expectEvent from './helpers/expectEvent';

const MetadataRegistry = artifacts.require('./MetadataRegistry.sol');
const NULL_ADDRESS = '0x0000000000000000000000000000000000000000';
const DEFAULT_GAS_PRICE = 1e11; // 100 Shannon

const SET_ENTRY_INITIAL = 'setEntry(address,bytes32,uint8,uint8,uint256)';
const SET_ENTRY = 'setEntry(address,bytes32,uint8,uint8)';
const SET_DELEGATE = 'setDelegate(address,address)';
const CLEAR_ENTRY = 'clearEntry(address)';

contract('MetadataRegistry', (accounts) => {
  let registry;

  beforeEach(async () => {
    registry = await MetadataRegistry.new({ from: accounts[0] });
  });

  const ipfsHashes = [
    'QmahqCsAUAw7zMv6P6Ae8PjCTck7taQA6FgGQLnWdKG7U8',
    'Qmb4atcgbbN5v4CDJ8nz5QG5L2pgwSTLd3raDrnyhLjnUH',
  ];

  async function calculateGas(account, method, params) {
    return registry.methods[method].estimateGas(
      ...params, { from: account }
    ).then(res => {
      return Number(res);
    });
  }

  async function getGasPrice() {
    return web3.eth.getGasPrice( (err, res) => {
      let gasPrice = Number(res);
      return gasPrice;
    });
  }

  async function setInitialIPFSHash(contractAddr, account, hash) {
    const { digest, hashFunction, size } = getBytes32FromMultihash(hash);
    let nonce = await web3.eth.getTransactionCount(account) - 1; // the nonce before the contract was deployed

    return registry.methods[SET_ENTRY_INITIAL](
      contractAddr, digest, hashFunction, size, nonce, { from: account }
    );
  }

  async function getIPFSHash(contractAddr) {
    return getMultihashFromContractResponse(await registry.getIPFSMultihash(contractAddr));
  }

  async function getDelegate(contractAddr) {
    return await registry.getDelegate(contractAddr);
  }

  async function getVersion(contractAddr) {
    return new BigNumber(await registry.getVersion(registry.address)).toNumber();
  }

  context('> setEntry()', () => {
    context('when the transaction succeds', () => {
      it('should get IPFS hash after setting', async () => {
        await setInitialIPFSHash(registry.address, accounts[0], ipfsHashes[0]);
        expect(await getIPFSHash(registry.address)).to.equal(ipfsHashes[0]);
      });

      it('should fire event when new has is set', async () => {
        await expectEvent(
          setInitialIPFSHash(registry.address, accounts[0], ipfsHashes[0]),
          'EntrySet',
        );
      });

      it('should increase the version for that particular contract', async () => {
        expect(await getVersion(registry.address)).to.equal(0);
        await setInitialIPFSHash(registry.address, accounts[0], ipfsHashes[0]);
        expect(await getVersion(registry.address)).to.equal(1);
      });

      it('should get the delegate after setting', async () => {
        expect(await getDelegate(registry.address)).to.equal(NULL_ADDRESS);
        await setInitialIPFSHash(registry.address, accounts[0], ipfsHashes[0]);
        expect(await getDelegate(registry.address)).to.equal(accounts[0]);
      });

      it('should no longer require nonce after first update', async () => {
        await setInitialIPFSHash(registry.address, accounts[0], ipfsHashes[0]);
        expect(await getDelegate(registry.address)).to.equal(accounts[0]);

        const { digest, hashFunction, size } = getBytes32FromMultihash(ipfsHashes[1]);

        await registry.methods[SET_ENTRY](
          registry.address, digest, hashFunction, size, { from: accounts[0] }
        );
        expect(await getVersion(registry.address)).to.equal(2);
        expect(await getIPFSHash(registry.address)).to.equal(ipfsHashes[1]);
      });
    });

    context('when the transaction fails', () => {
      it('should revert if supplied address is not a contract', async () => {
        await assertRevert(setInitialIPFSHash(accounts[1], accounts[0], ipfsHashes[0]));
      });

      it('should revert if msg.sender is not the deployer on initialization', async () => {
        await assertRevert(setInitialIPFSHash(registry.address, accounts[1], ipfsHashes[0]));
      });

      it('should revert if msg.sender is not a delegate (deployer) after its been initialized', async () => {
        await setInitialIPFSHash(registry.address, accounts[0], ipfsHashes[0]);
        await assertRevert(setInitialIPFSHash(registry.address, accounts[1], ipfsHashes[1]));

        const { digest, hashFunction, size } = getBytes32FromMultihash(ipfsHashes[1]);

        await assertRevert(
          registry.methods[SET_ENTRY](
            registry.address, digest, hashFunction, size, { from: accounts[1] }
          )
        );
        expect(await getIPFSHash(registry.address)).to.equal(ipfsHashes[0]);
        expect(await getDelegate(registry.address)).to.equal(accounts[0]);
      });

      it('should revert if not initialized by a nonce', async () => {
        const { digest, hashFunction, size } = getBytes32FromMultihash(ipfsHashes[1]);
        await assertRevert(
          registry.methods[SET_ENTRY](
            registry.address, digest, hashFunction, size, { from: accounts[0] }
          )
        );
      });
    });
  });

  context('> clearEntry()', () => {
    context('when the transaction succeds', () => {
      it('should clear IPFS hash after set', async () => {
        await setInitialIPFSHash(registry.address, accounts[0], ipfsHashes[0]);
        expect(await getIPFSHash(registry.address)).to.equal(ipfsHashes[0]);

        await registry.clearEntry(registry.address);
        expect(await getIPFSHash(registry.address)).to.be.a('null');
      });

      it('should fire event when entry is cleared', async () => {
        await setInitialIPFSHash(registry.address, accounts[0], ipfsHashes[0]);

        await expectEvent(
          registry.clearEntry(registry.address),
          'EntryDeleted',
        );
      });

      it('should decrease the version number', async () => {
        await setInitialIPFSHash(registry.address, accounts[0], ipfsHashes[0]);
        expect(await getVersion(registry.address)).to.equal(1);

        await registry.clearEntry(registry.address);
        expect(await getVersion(registry.address)).to.equal(0);
      });
    });

    context('when the transaction fails', () => {
      it('should prevent clearing non-existant entry', async () => {
        await assertRevert(registry.clearEntry(registry.address));
      });

      it('should prevent clearing a non-contract', async () => {
        await assertRevert(registry.clearEntry(accounts[1]));
      });
    });
  });

  context('> setDelegate()', () => {
    context('when the transaction succeds', () => {
      it('should get the updated delegate for the entry', async () => {
        await setInitialIPFSHash(registry.address, accounts[0], ipfsHashes[0]);
        await registry.setDelegate(registry.address, accounts[1], { from: accounts[0] });
        expect(await getDelegate(registry.address)).to.equal(accounts[1]);
      });

      it('should fire event when delegate changes', async () => {
        await setInitialIPFSHash(registry.address, accounts[0], ipfsHashes[0]);
        await expectEvent(
          registry.setDelegate(registry.address, accounts[1], { from: accounts[0] }),
          'SetDelegate',
        );
      });
    });

    context('when the transaction fails', () => {
      it('should revert if entry does not exist', async () => {
        await assertRevert(registry.setDelegate(registry.address, accounts[1], { from: accounts[0] }));
      });

      it('should revert if msg.sender is not a delegate', async () => {
        await assertRevert(registry.setDelegate(registry.address, accounts[1], { from: accounts[2] }));
      });
    });
  });

  context('Estimate gas cost:', () => {
    it('should calculate the gas', async () => {
      let gasSetEntryInitial, gasSetEntry, gasClearEntry, gasSetDelegate;
      const {digest, hashFunction, size } = getBytes32FromMultihash(ipfsHashes[0]);
      const nonce = await web3.eth.getTransactionCount(accounts[0]) - 1;
      const gasPrice = await getGasPrice();

      const formatPrice = async (gas, gasPrice) => {
        const total = (gas * gasPrice);
        return { inWei: total, inEth: await web3.utils.fromWei(total.toString(), 'ether') };
      }

      gasSetEntryInitial = await formatPrice(
        await calculateGas(accounts[0], SET_ENTRY_INITIAL, [registry.address, digest, hashFunction, size, nonce]),
        gasPrice
      );

      // We need to initialized the entry to prevent reverts on subsequent calls
      await setInitialIPFSHash(registry.address, accounts[0], ipfsHashes[0]);

      gasSetEntry = await formatPrice(
        await calculateGas(accounts[0], SET_ENTRY, [registry.address, digest, hashFunction, size]),
        gasPrice
      );

      gasClearEntry = await formatPrice(
        await calculateGas(accounts[0], CLEAR_ENTRY, [registry.address]),
        gasPrice
      );

      gasSetDelegate = await formatPrice(
        await calculateGas(accounts[0], SET_DELEGATE, [registry.address, accounts[1]]),
        gasPrice
      );

      // assert gas has been calculated
      expect(gasSetEntryInitial).to.not.equal(undefined);
      expect(gasSetEntry).to.not.equal(undefined);
      expect(gasSetDelegate).to.not.equal(undefined);
      expect(gasClearEntry).to.not.equal(undefined);

      console.log("         Gas price @ " + gasPrice);
      console.log("         Initializing with setEntry and nonce:");
      console.log("             " + gasSetEntryInitial.inWei + " wei");
      console.log("             " + gasSetEntryInitial.inEth + " ether");
      console.log("         Updating existing using setEntry:");
      console.log("             " + gasSetEntry.inWei + " wei");
      console.log("             " + gasSetEntry.inEth + " ether");
      console.log("         Creating a new delegate with setDelegate:");
      console.log("             " + gasSetDelegate.inWei + " wei");
      console.log("             " + gasSetDelegate.inEth + " ether");
      console.log("         Clear an existing entry with clearEntry:");
      console.log("             " + gasClearEntry.inWei + " wei");
      console.log("             " + gasClearEntry.inEth + " ether");
    });
  })
});
