import { expect } from 'chai';
import { BigNumber } from 'bignumber.js';

import { getBytes32FromMultihash, getMultihashFromContractResponse } from '../src/multihash';
import assertRevert from './helpers/assertRevert';
import expectEvent from './helpers/expectEvent';

const MetadataRegistry = artifacts.require('./MetadataRegistry.sol');
const NULL_ADDRESS = '0x0000000000000000000000000000000000000000';

contract('MetadataRegistry', (accounts) => {
  let registry;

  beforeEach(async () => {
    registry = await MetadataRegistry.new({ from: accounts[0] });
  });

  const ipfsHashes = [
    'QmahqCsAUAw7zMv6P6Ae8PjCTck7taQA6FgGQLnWdKG7U8',
    'Qmb4atcgbbN5v4CDJ8nz5QG5L2pgwSTLd3raDrnyhLjnUH',
  ];

  async function setInitialIPFSHash(contractAddr, account, hash) {
    const { digest, hashFunction, size } = getBytes32FromMultihash(hash);
    let nonce = await web3.eth.getTransactionCount(account) - 1; // the nonce before the contract was deployed

    return registry.methods['setEntry(address,bytes32,uint8,uint8,uint256)'](
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

        await registry.methods['setEntry(address,bytes32,uint8,uint8)'](
          registry.address, digest, hashFunction, size, { from: accounts[0] }
        );
        expect(await getVersion(registry.address)).to.equal(2);
      });
    });

    context('when the transaction fails', () => {
      it('should revert if supplied address is not a contract', async () => {
        await assertRevert(setInitialIPFSHash(accounts[1], accounts[0], ipfsHashes[0]));
      });

      it('should revert if msg.sender is not a delegate (deployer)', async () => {
        await assertRevert(setInitialIPFSHash(registry.address, accounts[1], ipfsHashes[0]));
      });

      it('should revert if msg.sender is not a delegate (deployer) after its been initialized', async () => {
        await setInitialIPFSHash(registry.address, accounts[0], ipfsHashes[0]);
        await assertRevert(setInitialIPFSHash(registry.address, accounts[1], ipfsHashes[1]));

        const { digest, hashFunction, size } = getBytes32FromMultihash(ipfsHashes[1]);

        await assertRevert(
          registry.methods['setEntry(address,bytes32,uint8,uint8)'](
            registry.address, digest, hashFunction, size, { from: accounts[1] }
          )
        );
        expect(await getIPFSHash(registry.address)).to.equal(ipfsHashes[0]);
      });

      it('should revert if not initialized by a nonce', async () => {
        const { digest, hashFunction, size } = getBytes32FromMultihash(ipfsHashes[1]);
        await assertRevert(
          registry.methods['setEntry(address,bytes32,uint8,uint8)'](
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
});
