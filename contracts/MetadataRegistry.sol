pragma solidity >=0.4.22 < 0.4.25;
pragma experimental ABIEncoderV2;

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

  address constant ANY_ADDRESS = 0xFFfFfFffFFfffFFfFFfFFFFFffFFFffffFfFFFfF;
  int constant INVALID_NONCE = -1;

  struct Entry {
    bool selfAttested;
    address delegate;
    bytes32 digest;
    uint8 hashFunction;
    uint8 size;
  }

  mapping (address => Entry) private entries;
  mapping (address => uint) private versions;

  event EntrySet (
    address indexed contractAddress,
    address indexed delegate,
    bytes32 digest,
    uint8 hashFunction,
    uint8 size,
    bool selfAttested,
    uint latest
  );

  event EntryDeleted (
    address indexed contractAddress,
    uint latest
  );

  event SetDelegate (
    address indexed contractAddress,
    address indexed delegate
  );

  modifier onlyDelegate(address _contract) {
    require(entries[_contract].delegate != address(0), "Error: delegate cannot be empty");
    if (entries[_contract].delegate != ANY_ADDRESS)
      require(msg.sender == entries[_contract].delegate, "Error: msg.sender is not a delegate");
    _;
  }

  /**
   * @dev Initialize association of a multihash with a contract if the deployer sends a tx
   * @param _contract address of the associated contract
   * @param _digest hash digest produced by hashing content using hash function
   * @param _hashFunction hashFunction code for the hash function used
   * @param _size length of the digest
   * @param _nonce number of tx of deployment key;
   */
  function createEntry(
    address _contract,
    bytes32 _digest,
    uint8 _hashFunction,
    uint8 _size,
    int _nonce
  )
  public
  {
    require(_size != uint8(0), "Error: a size must be given");
    require(_nonce > 0, "Error: invalid nonce provided");
    require(entries[_contract].delegate == address(0), "Error: contract entry has already been initialized");
    _setEntry(_contract, _digest, _hashFunction, _size, _nonce);
  }

  /**
   * @dev associate a multihash with a contract if sender has delegate permissions
   * @param _contract address of the associated contract
   * @param _digest hash digest produced by hashing content using hash function
   * @param _hashFunction hashFunction code for the hash function used
   * @param _size length of the digest
   */

  function updateEntry(
    address _contract,
    bytes32 _digest,
    uint8 _hashFunction,
    uint8 _size
  )
  public
  onlyDelegate(_contract)
  {
    _setEntry(_contract, _digest, _hashFunction, _size, INVALID_NONCE);
  }

  /**
  * @dev deassociate a multihash entry of a contract address if one exists and sender is a delegate(deployer)
  * @param _contract address of the deassociated contract
  */
  function clearEntry(address _contract)
  public
  onlyDelegate(_contract)
  {
    require(entries[_contract].digest != 0, "Error: missing entry");
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
  onlyDelegate(_contract)
  {
    require(entries[_contract].delegate != ANY_ADDRESS, "Error: Deployer made all ethereum addresses' delegates");
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
  returns(bytes32 digest, uint8 hashFunction, uint8 size)
  {
    Entry storage entry = entries[_address];
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
    Entry storage entry = entries[_address];
    return (entry.delegate);
  }

  /**
  * @dev retrieve number of versions published for a contract
  * @param _address address used as key
  */
  function getVersion(address _address)
  public
  view
  returns(uint)
  {
    uint version = versions[_address];
    return version;
  }

  function _setEntry(
    address _contract,
    bytes32 _digest,
    uint8 _hashFunction,
    uint8 _size,
    int _nonce
  )
  private
  {
    bool selfAttested = _contract == msg.sender;

    if (!selfAttested && _nonce != INVALID_NONCE) { // we should never get here with user input
      require(isContract(_contract), "Error: address provided is not a contract");
      require(isDeployer(msg.sender, _contract, _nonce), "Error: msg.sender is not contract deployer");
    }

    Entry memory entry = Entry(
      selfAttested,
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
      _size,
      selfAttested,
      versions[_contract]
    );
  }

  function isContract(address _addr) private returns (bool valid) {
    uint32 size;
    assembly {
      size := extcodesize(_addr)
    }

    return (size > 0);
  }

  function isDeployer(address _sender, address _contract, int _nonce) private returns (bool valid) {
    return addressFrom(_sender, _nonce) == _contract;
  }

  function addressFrom(address _origin, int _nonce) private pure returns (address) {
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
