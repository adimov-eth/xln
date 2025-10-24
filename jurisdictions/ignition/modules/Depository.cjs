const { buildModule } = require("@nomicfoundation/hardhat-ignition/modules");

const DepositoryModule = buildModule("DepositoryModule", (m) => {
  console.log("[FIND] IGNITION: Starting Depository deployment...");
  console.log("[FIND] IGNITION: About to deploy Depository contract...");

  const depository = m.contract('Depository', [], { id: 'Depository' })

  console.log("[FIND] IGNITION: Depository contract deployed, address will be available after execution");
  const subcontractProvider = m.contract('SubcontractProvider')
  const entityProvider = m.contract('EntityProvider')

  const erc20Mock = m.contract('ERC20Mock', ["ERC20Mock", "ERC20", 1000000])
  const erc721Mock = m.contract('ERC721Mock', ["ERC721Mock", "ERC721"])
  const erc1155Mock = m.contract('ERC1155Mock')

  // Approve EntityProvider in Depository
  m.call(depository, "addEntityProvider", [entityProvider]);

  return { depository, subcontractProvider, entityProvider, erc20Mock, erc721Mock, erc1155Mock  };
});

module.exports = DepositoryModule;
