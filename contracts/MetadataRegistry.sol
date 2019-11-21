pragma solidity >=0.4.18 < 0.6.0;

/**
 * @title MetadataRegistry
 * @author Cory Dickson (@gh1dra)
 * @dev On-chain registry that stores IPFS (multihash) hash for contract addresses. A multihash entry is in the format
 * of <varint hash function code><varint digest size in bytes><hash function output>
 * See https://github.com/multiformats/multihash
 *
 * Currently IPFS hash is 34 bytes long with first two segments represented as a single byte (uint8)
 * The digest is 32 bytes long and can be stored using bytes32 efficiently.
 *
 * Only deployment keys can set an initial entry for a contract. From that point on,
 * they can delegate that ability to another address. Delegates then become sole owners
 * of publishing permissions for specified contract in the registry.
 * Inspired by: https://github.com/saurfang/ipfs-multihash-on-solidity
 */


contract MetadataRegistry {
  struct Multihash {
    address delegate;
    bytes32 digest;
    uint8 hashFunction;
    uint8 size;
  }

  mapping (address => Multihash) private entries;
  mapping (address => uint) private versions;

  event EntrySet (
    address indexed contractAddress,
    address indexed delegate,
    bytes32 digest,
    uint8 hashFunction,
    uint8 size
  );

  event EntryDeleted (
    address indexed contractAddress,
    uint latest
  );

  event SetDelegate(address indexed key, address indexed delegate);

  /**
   * @dev associate a multihash with a contract if a delegate or deployer sends a tx
   * @param _contract address of the associated contract
   * @param _digest hash digest produced by hashing content using hash function
   * @param _hashFunction hashFunction code for the hash function used
   * @param _size length of the digest
   * @param _nonce number of tx of deployment key, value ignored after first entry;
   */
  function setEntry(
    address _contract,
    bytes32 _digest,
    uint8 _hashFunction,
    uint8 _size,
    uint _nonce
  )
  public
  {
    require(isContract(_contract), "Error: address provided is not a contract");
    if (entries[_contract].delegate == address(0)) {
      // checks to ensure delegate is posting the update
      require(isDeployer(msg.sender, _contract, _nonce), "Error: msg.sender is not contract deployer");
    } else {
      require(msg.sender == entries[_contract].delegate, "Error: msg.sender is not a delegate");
    }

    Multihash memory entry = Multihash(
      msg.sender,
      _digest,
      _hashFunction,
      _size
    );

    entries[_contract] = entry;
    versions[_contract] += 1;

    emit EntrySet(
      _contract,
      msg.sender,
      _digest,
      _hashFunction,
      _size
    );
  }

  /**
  * @dev deassociate a multihash entry of a contract address if one exists and sender is a delegate(deployer)
  * @param _contract address of the deassociated contract
  */
  function clearEntry(address _contract)
  public
  {
    require(entries[_contract].digest != 0, "Error: missing entry");
    require(entries[_contract].delegate == msg.sender, "Error: msg.sender is not a delegate");
    delete entries[_contract];

    versions[_contract] -= 1;
    emit EntryDeleted(msg.sender, versions[_contract]);
  }

  /**
  * @dev deassociate a multihash entry of a contract address if one exists and sender is a delegate(deployer)
  * @param _contract address of the deassociated contract
  */
  function setDelegate(address _contract, address _delegate)
  public
  {
    // checks if sender is current delegate, if true then update delgate
    require(entries[_contract].delegate != address(0), "Error: delegate cannot be empty");
    require(entries[_contract].delegate == msg.sender, "Error: msg.sender is not a delegate");
    entries[_contract].delegate = _delegate;

    emit SetDelegate(_contract, _delegate);
  }

  /**
  * @dev retrieve multihash entry associated with an address
  * @param _address address used as key
  */
  function getIPFSMultihash(address _address)
  public
  view
  returns(bytes32 digest, uint8 hashfunction, uint8 size)
  {
    Multihash storage entry = entries[_address];
    return (entry.digest, entry.hashFunction, entry.size);
  }

  /**
  * @dev retrieve delegate address associated with a contract
  * @param _address address used as key
  */
  function getDelegate(address _address)
  public
  view
  returns(address delegate)
  {
    Multihash storage entry = entries[_address];
    return (entry.delegate);
  }

  /**
  * @dev retrieve number of versions published for a contract
  * @param _address address used as key
  */
  function getVersion(address _address)
  public
  view
  returns(uint latest)
  {
    uint version = versions[_address];
    return version;
  }

  function isContract(address _addr) private returns (bool valid) {
    uint32 size;
    assembly {
      size := extcodesize(_addr)
    }

    return (size > 0);
  }

  function isDeployer(address _sender, address _contract, uint _nonce) private returns (bool valid) {
    return addressFrom(_sender, _nonce) == _contract;
  }

  function addressFrom(address _origin, uint _nonce) private pure returns (address) {
    // https://ethereum.stackexchange.com/a/47083
    if (_nonce == 0x00)
      return address(keccak256(byte(0xd6), byte(0x94), _origin, byte(0x80)));
    if (_nonce <= 0x7f)
      return address(keccak256(byte(0xd6), byte(0x94), _origin, byte(_nonce)));
    if (_nonce <= 0xff)
      return address(keccak256(byte(0xd7), byte(0x94), _origin, byte(0x81), uint8(_nonce)));
    if (_nonce <= 0xffff)
      return address(keccak256(byte(0xd8), byte(0x94), _origin, byte(0x82), uint16(_nonce)));
    if (_nonce <= 0xffffff)
      return address(keccak256(byte(0xd9), byte(0x94), _origin, byte(0x83), uint24(_nonce)));

    return address(keccak256(byte(0xda), byte(0x94), _origin, byte(0x84), uint32(_nonce))); // more than 2^32 nonces not realistic
  }
}
