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
  // The hash of the string calculated by keccak256('deployer')
  bytes32 constant DEPLOYER_CATEGORY = 0xdbe2b933bb7d57444cdba9c71b5ceb79b60dc455ad691d856e6e4025cf542caa;
  address constant ANY_ADDRESS = 0xFFfFfFffFFfffFFfFFfFFFFFffFFFffffFfFFFfF;

  struct Entry {
    bool selfAttested;
    address delegate;
    bytes32 digest;
    uint8 hashFunction;
    uint8 size;
  }

  mapping (address => mapping (bytes32 => Entry)) private entries;
  mapping (address => mapping (bytes32 => uint)) private versions;
  mapping (address => mapping(bytes32 => bool)) private approvedCategories;
  mapping (address => address) private deployers;

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

  event SetDelegate (
    address indexed contractAddress,
    address indexed delegate
  );

  event CategoryAdded (
    address indexed contractAddress,
    bytes32 indexed category,
    address delegate
  );

  event CategoryDeleted (
    address indexed contractAddress,
    bytes32 indexed category
  );

  modifier onlyDelegate(address _contract, bytes32 _categoryID) {
    if (msg.sender != _contract) {
      if (entries[_contract][_categoryID].delegate != ANY_ADDRESS && entries[_contract][_categoryID].delegate != address(0x0)) {
        require(msg.sender == entries[_contract][_categoryID].delegate, "Error: msg.sender is not a delegate");
      }
    }
    _;
  }

  modifier onlyDeployer(address _contract, bool _create2, int _nonce, bytes32 _salt, bytes memory _code) {
    require(entries[_contract][DEPLOYER_CATEGORY].delegate == address(0), "Error: contract entry has already been initialized");
    if (_contract != msg.sender) {
      address _res = address(0);
      if (_create2) {
        _res = calculateCreate2Addr(msg.sender, _salt, _code);
      } else {
        require(_nonce > 0, "Error: invalid nonce provided");
        _res = addressFrom(msg.sender, _nonce);
      }
      require(_res == _contract, "Error: msg.sender must be the deployment key");
      deployers[_contract] = msg.sender;
    }
    _;
  }

  /**
   * @dev Initialize association of a multihash with a contract if the deployer sends a tx
   * @param _contract address of the associated contract
   * @param _digest hash digest produced by hashing content using hash function
   * @param _hashFunction hashFunction code for the hash function used
   * @param _size length of the digest
   * @param _nonce number of tx of deployment key
   * @param _salt vanity bytes used to generate the contract address
   * @param _code initialization bytecode used to the logic in the contract
   * @param _opcode represents which opcode used to calculate the contract address, where create2 = true and create = false
   */
  function createEntry(
    address _contract,
    bytes32 _digest,
    uint8 _hashFunction,
    uint8 _size,
    int _nonce,
    bytes32 _salt,
    bytes memory _code,
    bool _opcode
  )
  public
  onlyDeployer(_contract, _opcode, _nonce, _salt, _code)
  {
    _setEntry(_contract, _digest, _hashFunction, _size, DEPLOYER_CATEGORY);

    emit EntrySet(
      _contract,
      msg.sender,
      _digest,
      _hashFunction,
      _size
    );
  }

  /**
   * @dev Update an associated multihash with a contract if sender has delegate permissions
   * @param _contract address of the associated contract
   * @param _digest hash digest produced by hashing content using hash function
   * @param _hashFunction hashFunction code for the hash function used
   * @param _size length of the digest
   * @param _categoryID The keccak256 hash of the string representing the category
   */
  function updateEntry (
    address _contract,
    bytes32 _digest,
    uint8 _hashFunction,
    uint8 _size,
    bytes32 _categoryID
  )
  public
  onlyDelegate(_contract, _categoryID)
  {
    require(approvedCategories[_contract][_categoryID], "Error: deployer must consent to category update");
    _setEntry(_contract, _digest, _hashFunction, _size, _categoryID);

    emit EntrySet(
      _contract,
      msg.sender,
      _digest,
      _hashFunction,
      _size
    );
  }

  /**
  * @dev Deassociate a multihash entry of a contract address if one exists and sender is a delegate(deployer)
  * @param _contract address of the deassociated contract
  * @param _categoryID The keccak256 hash of the string representing the category
  */
  function clearEntry(address _contract, bytes32 _categoryID)
  public
  onlyDelegate(_contract, _categoryID)
  {
    require(entries[_contract][_categoryID].digest != 0, "Error: missing entry");
    delete entries[_contract][_categoryID];

    versions[_contract][_categoryID] -= 1;
    emit EntryDeleted(msg.sender, versions[_contract][_categoryID]);
  }

  /**
  * @dev Deassociate a multihash entry of a contract address if one exists and sender is a delegate(or original deployer)
  * @param _contract address of the deassociated contract
  * @param _categoryID The keccak256 hash of the string representing the category
  */
  function setDelegate(address _contract, address _delegate, bytes32 _categoryID)
  public
  onlyDelegate(_contract, _categoryID)
  {
    require(entries[_contract][_categoryID].delegate != ANY_ADDRESS, "Error: Deployer made all ethereum addresses' delegates");
    entries[_contract][_categoryID].delegate = _delegate;
    emit SetDelegate(_contract, _delegate);
  }

  /**
  * @dev Deployer can approve a category hash for a particular contract
  * @param _contract Address of the contract used in the registry
  * @param _categoryID The keccak256 hash of the string representing the category
  */
  function addCategory(address _contract, bytes32 _categoryID)
  public
  {
    require(deployers[_contract] == msg.sender || msg.sender == _contract, "Error: you do not have permission to add a category");
    require(_categoryID != DEPLOYER_CATEGORY, "Error: default category already initialized");
    require(_categoryID != bytes32(0), "Error: valid category hash must not be zero");
    approvedCategories[_contract][_categoryID] = true;

    emit CategoryAdded(_contract, _categoryID, msg.sender);
  }

  /**
  * @dev Deletes a category as well as the corresponding entry
  * @param _contract Address of the contract used in the registry
  * @param _categoryID The keccak256 hash of the string representing the category
  */
  function deleteCategory(address _contract, bytes32 _categoryID)
  public
  onlyDelegate(_contract, _categoryID)
  {
    require(approvedCategories[_contract][_categoryID], "Error: provided category must exist");
    approvedCategories[_contract][_categoryID] = false;
    clearEntry(_contract, _categoryID);

    emit CategoryDeleted(_contract, _categoryID);
  }

  /**
  * @dev Gets the status of valid categories for a particular contract
  * @param _contract Address of the contract used in the registry
  * @param _categoryID The keccak256 hash of the string representing the category
  */
  function getCategoryStatus(address _contract, bytes32 _categoryID)
  public
  view
  returns(bool)
  {
    return approvedCategories[_contract][_categoryID];
  }

  /**
  * @dev Retrieve multihash entry associated with an address
  * @param _address Contract address used in the registry
  * @param _categoryID The keccak256 hash of the string representing the category
  */
  function getIPFSMultihash(address _address, bytes32 _categoryID)
  public
  view
  returns(bytes32 digest, uint8 hashFunction, uint8 size)
  {
    Entry storage entry = entries[_address][_categoryID];
    return (entry.digest, entry.hashFunction, entry.size);
  }

  /**
  * @dev Retrieve delegate address associated with a contract
  * @param _address address used as key
  * @param _categoryID The keccak256 hash of the string representing the category
  */
  function getDelegate(address _address, bytes32 _categoryID)
  public
  view
  returns(address delegate)
  {
    Entry storage entry = entries[_address][_categoryID];
    return (entry.delegate);
  }

  /**
  * @dev Retrieve number of versions published for a contract
  * @param _address address used as key
  * @param _categoryID The keccak256 hash of the string representing the category
  */
  function getVersion(address _address, bytes32 _categoryID)
  public
  view
  returns(uint)
  {
    uint version = versions[_address][_categoryID];
    return version;
  }

  /**
  * @dev Retrieves the address of the deployment key for a particular contract in the registry
  * @param _contract address of the contract with an entry in the registry
  */
  function getRegisteredDeployer(address _contract)
  public
  view
  returns(address)
  {
    return deployers[_contract];
  }

  /**
  * @dev Calculates the address generated using the create2 opcode. For testing purposes only...
  * @return calculated Address
  */
  function calculateCreate2Addr(address _origin, bytes32 _salt, bytes memory _code) public pure returns (address) {
    // Assumes no memory expansion
    // keccak256( 0xff ++ address ++ salt ++ keccak256(init_code))[12:]
    return address(keccak256(byte(0xff), _origin, _salt, keccak256(_code)));
  }

  function _setEntry(
    address _contract,
    bytes32 _digest,
    uint8 _hashFunction,
    uint8 _size,
    bytes32 _categoryID
  )
  private
  {
    require(_size != uint8(0), "Error: a size must be given");

    bool selfAttested = _contract == msg.sender;

    if (!selfAttested) {
      uint size;
      assembly {
        size := extcodesize(_contract)
      }
      require(size > 0, "Error: code must be deployed at contract address");
    }

    Entry memory entry = Entry(
      selfAttested,
      msg.sender,
      _digest,
      _hashFunction,
      _size
    );
    entries[_contract][_categoryID] = entry;
    versions[_contract][_categoryID] += 1;
    approvedCategories[_contract][_categoryID] = true;
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
