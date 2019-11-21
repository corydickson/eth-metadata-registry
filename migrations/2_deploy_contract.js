const MetadataRegistry = artifacts.require('./MetadataRegistry.sol');

module.exports = (deployer) => {
  deployer.deploy(MetadataRegistry);
};
