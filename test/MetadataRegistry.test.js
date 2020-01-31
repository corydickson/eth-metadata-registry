import { expect } from 'chai';
import { BigNumber } from 'bignumber.js';

import { getBytes32FromMultihash, getMultihashFromContractResponse } from '../src/multihash';
import assertRevert from './helpers/assertRevert';
import expectEvent from './helpers/expectEvent';

const MetadataRegistry = artifacts.require('./MetadataRegistry.sol');
const NULL_ADDRESS = '0x0000000000000000000000000000000000000000';
const ANY_ADDRESS = '0xffffffffffffffffffffffffffffffffffffffff';
const DEFAULT_GAS_PRICE = 1e11; // 100 Shannon
const DEFAULT_SALT = '0x00';
const DEFAULT_CODE = '0x0';
const DEFAULT_CATEGORY_STRING= "deployer";
const DEFAULT_CATEGORY_ID = web3.utils.soliditySha3(DEFAULT_CATEGORY_STRING);
const dappCat = web3.utils.soliditySha3('my-dank-dapp');
const INVALID_NONCE = -1;

const CREATE_ENTRY = 'createEntry(address,bytes32,uint8,uint8,int256,bytes32,bytes,bool)';
const UPDATE_ENTRY = 'updateEntry(address,bytes32,uint8,uint8,bytes32)';
const SET_DELEGATE = 'setDelegate(address,address,bytes32)';
const CLEAR_ENTRY = 'clearEntry(address,bytes32)';
const ADD_CATEGORY = 'addCategory(address,bytes32)';
const DELETE_CATEGORY = 'deleteCategory(address,bytes32)';

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

  async function setInitialIPFSHash(contractAddr, account, hash, salt, init_code, create2 = false) {
    const { digest, hashFunction, size } = getBytes32FromMultihash(hash);
    if (create2) {
      return registry.methods[CREATE_ENTRY](
        contractAddr, digest, hashFunction, size, INVALID_NONCE, salt, init_code, true, { from: account }
      );
    }

    else {
      let nonce = await web3.eth.getTransactionCount(account) - 1; // the nonce before the contract was deployed
      return registry.methods[CREATE_ENTRY](
        contractAddr, digest, hashFunction, size, nonce, DEFAULT_SALT, DEFAULT_CODE, false, { from: account }
      );
    }
  }

  async function getIPFSHash(contractAddr, category = DEFAULT_CATEGORY_ID) {
    return getMultihashFromContractResponse(await registry.getIPFSMultihash(contractAddr, category));
  }

  async function getDelegate(contractAddr, category = DEFAULT_CATEGORY_ID) {
    return await registry.getDelegate(contractAddr, category);
  }

  async function getVersion(contractAddr, category = DEFAULT_CATEGORY_ID) {
    return new BigNumber(await registry.getVersion(registry.address, category)).toNumber();
  }

  context('> Verify onlyDeployer create2 modifier', () => {
    it('should calculate the right values', async () => {
      expect(await registry.calculateCreate2Addr(
        "0x0000000000000000000000000000000000000000", "0x0000000000000000000000000000000000000000000000000000000000000000", "0x00", { from: accounts[0] }
      )).to.equal("0x4D1A2e2bB4F88F0250f26Ffff098B0b30B26BF38");

      expect(await registry.calculateCreate2Addr(
        "0xdeadbeef00000000000000000000000000000000", "0x000000000000000000000000feed000000000000000000000000000000000000", "0x00", { from: accounts[0] }
      )).to.equal("0xD04116cDd17beBE565EB2422F2497E06cC1C9833");

      expect(await registry.calculateCreate2Addr(
        "0x0000000000000000000000000000000000000000", "0x0000000000000000000000000000000000000000000000000000000000000", "0xdeadbeef", { from: accounts[0] }
      )).to.equal("0x70f2b2914A2a4b783FaEFb75f459A580616Fcb5e");

      expect(await registry.calculateCreate2Addr(
        "0x00000000000000000000000000000000deadbeef", "0x00000000000000000000000000000000000000000000000000000000cafebabe", "0xdeadbeef", { from: accounts[0] }
      )).to.equal("0x60f3f640a8508fC6a86d45DF051962668E1e8AC7");

      expect(await registry.calculateCreate2Addr(
        "0x00000000000000000000000000000000deadbeef", "0x00000000000000000000000000000000000000000000000000000000cafebabe",
        "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
        { from: accounts[0] }
      )).to.equal("0x1d8bfDC5D46DC4f61D6b6115972536eBE6A8854C");
    });
  });

  context('> Publishing with createEntry() && updateEntry()', () => {
    context('when the transaction succeds', () => {
      it('should get IPFS hash after setting', async () => {
        await setInitialIPFSHash(registry.address, accounts[0], ipfsHashes[0]);
        expect(await getIPFSHash(registry.address)).to.equal(ipfsHashes[0]);
      });

      /*
       * TODO: We need to have a test case that covers an address that has been deployed with create2
       * The problem is that collisions can occur and there is no way to test if that contract has been deployed to the calculated address
       */

      it('should fire event when new entry has been set', async () => {
        await expectEvent(
          await setInitialIPFSHash(registry.address, accounts[0], ipfsHashes[0]),
          'EntrySet',
        );

        const { digest, hashFunction, size } = getBytes32FromMultihash(ipfsHashes[1]);

        await expectEvent(
          registry.methods[UPDATE_ENTRY](
            registry.address, digest, hashFunction, size, DEFAULT_CATEGORY_ID, { from: accounts[0] }
          ),
          'EntrySet',
        );
      });

      it('should allow one to self-attest data to their own address', async () => {
        await setInitialIPFSHash(accounts[0], accounts[0], ipfsHashes[0]);
        expect(await getIPFSHash(accounts[0])).to.equal(ipfsHashes[0]);
      });

      it('should increase the version for that particular contract', async () => {
        expect(await getVersion(registry.address)).to.equal(0);
        await setInitialIPFSHash(registry.address, accounts[0], ipfsHashes[0]);
        expect(await getVersion(registry.address)).to.equal(1);
      });

      it('should get the delegate after setting', async () => {
        expect(await getDelegate(registry.address, DEFAULT_CATEGORY_ID)).to.equal(NULL_ADDRESS);
        await setInitialIPFSHash(registry.address, accounts[0], ipfsHashes[0]);
        expect(await getDelegate(registry.address, DEFAULT_CATEGORY_ID)).to.equal(accounts[0]);
      });

      it('should no longer require nonce after first update', async () => {
        await setInitialIPFSHash(registry.address, accounts[0], ipfsHashes[0]);
        expect(await getDelegate(registry.address)).to.equal(accounts[0]);

        const { digest, hashFunction, size } = getBytes32FromMultihash(ipfsHashes[1]);

        await registry.methods[UPDATE_ENTRY](
          registry.address, digest, hashFunction, size, DEFAULT_CATEGORY_ID, { from: accounts[0] }
        );
        expect(await getVersion(registry.address)).to.equal(2);
        expect(await getIPFSHash(registry.address)).to.equal(ipfsHashes[1]);
      });

      it('should allow the deployer to set any ethereum address to be a valid delegate', async () => {
        await setInitialIPFSHash(registry.address, accounts[0], ipfsHashes[0]);
        await registry.setDelegate(registry.address, ANY_ADDRESS, DEFAULT_CATEGORY_ID, { from: accounts[0] });

        const { digest, hashFunction, size } = getBytes32FromMultihash(ipfsHashes[1]);

        await registry.methods[UPDATE_ENTRY](
          registry.address, digest, hashFunction, size, DEFAULT_CATEGORY_ID, { from: accounts[1] }
        );

        expect(await getIPFSHash(registry.address)).to.equal(ipfsHashes[1]);
        expect(await getVersion(registry.address)).to.equal(2);
      });

      it('should allow non-deployers to add an entry on behalf of an account once deployer has approved', async () => {
        const { digest, hashFunction, size } = getBytes32FromMultihash(ipfsHashes[1]);

        await setInitialIPFSHash(registry.address, accounts[0], ipfsHashes[0]);
        await registry.addCategory(registry.address, dappCat, { from: accounts[0] });

        await registry.methods[UPDATE_ENTRY](
          registry.address, digest, hashFunction, size, dappCat, { from: accounts[1] }
        );

        expect(await getIPFSHash(registry.address, dappCat)).to.equal(ipfsHashes[1]);
        expect(await getVersion(registry.address, dappCat)).to.equal(1);
      });
    });

    context('when the transaction fails', () => {
      it('should revert if supplied address is not a contract', async () => {
        await assertRevert(setInitialIPFSHash(accounts[1], accounts[0], ipfsHashes[0]));
      });

      it('should revert if supplied a bogus nonce', async () => {
        const { digest, hashFunction, size } = getBytes32FromMultihash(ipfsHashes[0]);
        await assertRevert(
          registry.methods[CREATE_ENTRY](registry.address, digest, hashFunction, size, -1, "0x0", "0x0", false, { from: accounts[0]})
        );
      });

      it('should revert if supplied a bogus hash data', async () => {
        const { digest, hashFunction, size } = getBytes32FromMultihash(ipfsHashes[0]);
        let nonce = await web3.eth.getTransactionCount(accounts[0]) - 1;
        await assertRevert(
          registry.methods[CREATE_ENTRY](registry.address, digest, hashFunction, 0, nonce, "0x0", "0x0", false, { from: accounts[0]})
        );
      });

      it('should revert if msg.sender is not the deployer on initialization', async () => {
        await assertRevert(setInitialIPFSHash(registry.address, accounts[1], ipfsHashes[0]));
      });

      it('should revert if msg.sender is not a delegate (deployer) after its been initialized', async () => {
        await setInitialIPFSHash(registry.address, accounts[0], ipfsHashes[0]);
        await assertRevert(setInitialIPFSHash(registry.address, accounts[1], ipfsHashes[1]));

        const { digest, hashFunction, size } = getBytes32FromMultihash(ipfsHashes[1]);

        await assertRevert(
          registry.methods[CREATE_ENTRY](
            registry.address, digest, hashFunction, size, -1, "0x0", "0x0", false, { from: accounts[1] }
          )
        );
        expect(await getIPFSHash(registry.address)).to.equal(ipfsHashes[0]);
        expect(await getDelegate(registry.address)).to.equal(accounts[0]);
      });

      it('should revert if msg.sender tries to update an EOA', async () => {
        await setInitialIPFSHash(accounts[1], accounts[1], ipfsHashes[0]);

        const { digest, hashFunction, size } = getBytes32FromMultihash(ipfsHashes[1]);
        await assertRevert(
          registry.methods[UPDATE_ENTRY](
            accounts[1], digest, hashFunction, size, DEFAULT_CATEGORY_ID, { from: accounts[0] }
          )
        );

        expect(await getIPFSHash(accounts[1])).to.equal(ipfsHashes[0]);
        expect(await getDelegate(accounts[1])).to.equal(accounts[1]);
      });

      it('should revert if not initialized by a valid nonce', async () => {
        const { digest, hashFunction, size } = getBytes32FromMultihash(ipfsHashes[1]);
        await assertRevert(
          registry.methods[CREATE_ENTRY](
            registry.address, digest, hashFunction, size, -1, "0x0", "0x0", false, { from: accounts[0] }
          )
        );
      });

      it('should revert if a non-deployer adds an entry before initialization', async () => {
        const { digest, hashFunction, size } = getBytes32FromMultihash(ipfsHashes[1]);
        await assertRevert(
          registry.methods[UPDATE_ENTRY](
            registry.address, digest, hashFunction, size, dappCat, { from: accounts[1] }
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

        await registry.clearEntry(registry.address, DEFAULT_CATEGORY_ID);
        expect(await getIPFSHash(registry.address)).to.be.a('null');
      });

      it('should fire event when entry is cleared', async () => {
        await setInitialIPFSHash(registry.address, accounts[0], ipfsHashes[0]);

        await expectEvent(
          registry.clearEntry(registry.address, DEFAULT_CATEGORY_ID),
          'EntryDeleted',
        );
      });

      it('should decrease the version number', async () => {
        await setInitialIPFSHash(registry.address, accounts[0], ipfsHashes[0]);
        expect(await getVersion(registry.address)).to.equal(1);

        await registry.clearEntry(registry.address, DEFAULT_CATEGORY_ID);
        expect(await getVersion(registry.address)).to.equal(0);
      });
    });

    context('when the transaction fails', () => {
      it('should prevent clearing non-existant entry', async () => {
        await assertRevert(registry.clearEntry(registry.address, DEFAULT_CATEGORY_ID));
      });

      it('should prevent clearing a non-contract', async () => {
        await assertRevert(registry.clearEntry(accounts[1], DEFAULT_CATEGORY_ID));
      });
    });
  });

  context('> addCategory()', () => {
    context('when the transaction succeds', () => {
      it('should add set new category hash to true and allow a user to update', async () => {
        const { digest, hashFunction, size } = getBytes32FromMultihash(ipfsHashes[1]);

        await setInitialIPFSHash(registry.address, accounts[0], ipfsHashes[0]);
        await expectEvent(
          registry.addCategory(registry.address, dappCat, { from: accounts[0] }),
          'CategoryAdded',
        );
        expect(await registry.getCategoryStatus(registry.address, dappCat)).to.be.true;
      });
    });

    context('when the transaction fails', () => {
      it('should revert if the category is null byteaddress', async () => {
        await setInitialIPFSHash(registry.address, accounts[0], ipfsHashes[0]);
        await assertRevert(
          registry.addCategory(registry.address, NULL_ADDRESS, { from: accounts[0] })
        );
      });

      it('should revert if the category is null byteaddress', async () => {
        await setInitialIPFSHash(registry.address, accounts[0], ipfsHashes[0]);
        await assertRevert(
          registry.addCategory(registry.address, NULL_ADDRESS, { from: accounts[0] })
        );
      });

      it('should revert if you attempt to re-add deployer category', async () => {
        await setInitialIPFSHash(registry.address, accounts[0], ipfsHashes[0]);
        await assertRevert(
          registry.addCategory(registry.address, DEFAULT_CATEGORY_ID, { from: accounts[0] })
        );
      });

      it('should revert if you attempt to add category before initialization', async () => {
        await assertRevert(
          registry.addCategory(registry.address, dappCat, { from: accounts[0] })
        );
      });

      it('should revert if the msg.sender is not the deployer', async () => {
        await setInitialIPFSHash(registry.address, accounts[0], ipfsHashes[0]);
        await assertRevert(
          registry.addCategory(registry.address, dappCat, { from: accounts[1] })
        );
      });
    });
  });

  context('> deleteCategory()', () => {
    context('when the transaction succeds', () => {
      it('should remove entry for a given category and set the status to false', async () => {
        await setInitialIPFSHash(registry.address, accounts[0], ipfsHashes[0]);
        await expectEvent(
          registry.deleteCategory(registry.address, DEFAULT_CATEGORY_ID, { from: accounts[0] }),
          'CategoryDeleted',
        );
        expect(await registry.getCategoryStatus(registry.address, DEFAULT_CATEGORY_ID)).to.be.false;
        expect(await getVersion(registry.address)).to.equal(0);
        expect(await getIPFSHash(registry.address)).to.be.a('null');
      });
    });

    context('when the transaction fails', () => {
      it('should revert if the category does not exist', async () => {
        await setInitialIPFSHash(registry.address, accounts[0], ipfsHashes[0]);
        await assertRevert(
          registry.deleteCategory(registry.address, dappCat, { from: accounts[0] })
        );
      });

      it('should revert if the msg.sender is not a delegate', async () => {
        await setInitialIPFSHash(registry.address, accounts[0], ipfsHashes[0]);
        await assertRevert(
          registry.deleteCategory(registry.address, dappCat, { from: accounts[1] })
        );
      });
    });
  });

  context('> setDelegate()', () => {
    context('when the transaction succeds', () => {
      it('should get the updated delegate for the entry', async () => {
        await setInitialIPFSHash(registry.address, accounts[0], ipfsHashes[0]);
        await registry.setDelegate(registry.address, accounts[1], DEFAULT_CATEGORY_ID, { from: accounts[0] });
        expect(await getDelegate(registry.address)).to.equal(accounts[1]);
      });

      it('should fire event when delegate changes', async () => {
        await setInitialIPFSHash(registry.address, accounts[0], ipfsHashes[0]);
        await expectEvent(
          registry.setDelegate(registry.address, accounts[1], DEFAULT_CATEGORY_ID, { from: accounts[0] }),
          'SetDelegate',
        );
      });
    });

    context('when the transaction fails', () => {
      it('should revert if entry does not exist', async () => {
        await assertRevert(registry.setDelegate(registry.address, accounts[1], DEFAULT_CATEGORY_ID, { from: accounts[0] }));
      });

      it('should revert if msg.sender is not a delegate', async () => {
        await assertRevert(registry.setDelegate(registry.address, accounts[1], DEFAULT_CATEGORY_ID, { from: accounts[2] }));
      });

      it('should allow the deployer to set any ethereum address to be a valid delegate', async () => {
        await setInitialIPFSHash(registry.address, accounts[0], ipfsHashes[0]);
        await registry.setDelegate(registry.address, ANY_ADDRESS, DEFAULT_CATEGORY_ID, { from: accounts[0] });
        await assertRevert(registry.setDelegate(registry.address, accounts[1], DEFAULT_CATEGORY_ID, { from: accounts[2] }));
      });
    });
  });

  context('Estimate gas cost:', () => {
    it('should calculate the gas', async () => {
      let gasCreateEntry, gasCreate2Generation, gasSetEntry, gasClearEntry, gasSetDelegate, gasAddCategory, gasDeleteCategory;
      const { digest, hashFunction, size } = getBytes32FromMultihash(ipfsHashes[0]);
      const nonce = await web3.eth.getTransactionCount(accounts[0]) - 1;
      const gasPrice = await getGasPrice();

      const formatPrice = async (gas, gasPrice) => {
        const total = (gas * gasPrice);
        return { inWei: total, inEth: await web3.utils.fromWei(total.toString(), 'ether') };
      }

      gasCreateEntry = await formatPrice(
        await calculateGas(accounts[0], CREATE_ENTRY, [registry.address, digest, hashFunction, size, nonce, "0x0", "0x0", false]),
        gasPrice
      );

      gasCreate2Generation = await formatPrice(
        await calculateGas(accounts[0], "calculateCreate2Addr(address,bytes32,bytes)", [accounts[0], DEFAULT_SALT, DEFAULT_CODE]),
        gasPrice
      );

      // We need to initialized the entry to prevent reverts on subsequent calls
      await setInitialIPFSHash(registry.address, accounts[0], ipfsHashes[0]);

      gasSetEntry = await formatPrice(
        await calculateGas(accounts[0], UPDATE_ENTRY, [registry.address, digest, hashFunction, size, DEFAULT_CATEGORY_ID]),
        gasPrice
      );

      gasClearEntry = await formatPrice(
        await calculateGas(accounts[0], CLEAR_ENTRY, [registry.address, DEFAULT_CATEGORY_ID]),
        gasPrice
      );

      gasSetDelegate = await formatPrice(
        await calculateGas(accounts[0], SET_DELEGATE, [registry.address, accounts[1], DEFAULT_CATEGORY_ID]),
        gasPrice
      );

      gasAddCategory = await formatPrice(
        await calculateGas(accounts[0], ADD_CATEGORY, [registry.address, dappCat]),
        gasPrice
      );

      gasDeleteCategory = await formatPrice(
        await calculateGas(accounts[0], DELETE_CATEGORY, [registry.address, DEFAULT_CATEGORY_ID]),
        gasPrice
      );

      // assert gas has been calculated
      expect(gasCreateEntry).to.not.equal(undefined);
      expect(gasCreate2Generation).to.not.equal(undefined);
      expect(gasSetEntry).to.not.equal(undefined);
      expect(gasSetDelegate).to.not.equal(undefined);
      expect(gasClearEntry).to.not.equal(undefined);
      expect(gasAddCategory).to.not.equal(undefined);
      expect(gasDeleteCategory).to.not.equal(undefined);

      console.log("         Gas price @ " + gasPrice);
      console.log("         Initializing with createEntry and nonce:");
      console.log("             " + gasCreateEntry.inWei + " wei");
      console.log("             " + gasCreateEntry.inEth + " ether");
      console.log("         Updating existing using updateEntry:");
      console.log("             " + gasSetEntry.inWei + " wei");
      console.log("             " + gasSetEntry.inEth + " ether");
      console.log("         Creating a new delegate with setDelegate:");
      console.log("             " + gasSetDelegate.inWei + " wei");
      console.log("             " + gasSetDelegate.inEth + " ether");
      console.log("         Clear an existing entry with clearEntry:");
      console.log("             " + gasClearEntry.inWei + " wei");
      console.log("             " + gasClearEntry.inEth + " ether");
      console.log("         Calculate create2 address:");
      console.log("             " + gasCreate2Generation.inWei + " wei");
      console.log("             " + gasCreate2Generation.inEth + " ether");
      console.log("         Add a new category:");
      console.log("             " + gasAddCategory.inWei + " wei");
      console.log("             " + gasAddCategory.inEth + " ether");
      console.log("         Remove an existing category:");
      console.log("             " + gasDeleteCategory.inWei + " wei");
      console.log("             " + gasDeleteCategory.inEth + " ether");
    });
  })
});
