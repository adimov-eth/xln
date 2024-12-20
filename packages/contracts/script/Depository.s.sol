// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {Depository} from "../src/Depository.sol";
import {SubcontractProvider} from "../src/SubcontractProvider.sol";
import {EntityProvider} from "../src/EntityProvider.sol";

// Import mock contracts from test
import {ERC20Mock, ERC721Mock, ERC1155Mock} from "../test/Depository.t.sol";

contract DeployModule is Script {
    struct DeployedContracts {
        address depository;
        address subcontractProvider;
        address entityProvider;
        address erc20Mock;
        address erc721Mock;
        address erc1155Mock;
    }

    function setUp() public {}

    function run() public returns (DeployedContracts memory) {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(deployerPrivateKey);

        // Deploy core contracts
        SubcontractProvider scProvider = new SubcontractProvider();
        console2.log("SubcontractProvider deployed at:", address(scProvider));

        EntityProvider entityProvider = new EntityProvider();
        console2.log("EntityProvider deployed at:", address(entityProvider));

        Depository depository = new Depository();
        console2.log("Depository deployed at:", address(depository));

        // Deploy mock tokens (only if we're not in production)
        ERC20Mock erc20Mock = new ERC20Mock("ERC20Mock", "ERC20", 1000000);
        console2.log("ERC20Mock deployed at:", address(erc20Mock));

        ERC721Mock erc721Mock = new ERC721Mock("ERC721Mock", "ERC721");
        console2.log("ERC721Mock deployed at:", address(erc721Mock));

        ERC1155Mock erc1155Mock = new ERC1155Mock();
        console2.log("ERC1155Mock deployed at:", address(erc1155Mock));

        vm.stopBroadcast();

        // Log deployment summary
        console2.log("\nDeployment Summary:");
        console2.log("-------------------");
        console2.log("Core Contracts:");
        console2.log("SubcontractProvider:", address(scProvider));
        console2.log("EntityProvider:", address(entityProvider));
        console2.log("Depository:", address(depository));
        console2.log("\nMock Tokens:");
        console2.log("ERC20Mock:", address(erc20Mock));
        console2.log("ERC721Mock:", address(erc721Mock));
        console2.log("ERC1155Mock:", address(erc1155Mock));

        // Return all deployed contract addresses
        return
            DeployedContracts({
                depository: address(depository),
                subcontractProvider: address(scProvider),
                entityProvider: address(entityProvider),
                erc20Mock: address(erc20Mock),
                erc721Mock: address(erc721Mock),
                erc1155Mock: address(erc1155Mock)
            });
    }
}

// For production deployments without mock tokens
contract DeployProd is Script {
    struct DeployedProdContracts {
        address depository;
        address subcontractProvider;
        address entityProvider;
    }

    function run() public returns (DeployedProdContracts memory) {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(deployerPrivateKey);

        SubcontractProvider scProvider = new SubcontractProvider();
        console2.log("SubcontractProvider deployed at:", address(scProvider));

        EntityProvider entityProvider = new EntityProvider();
        console2.log("EntityProvider deployed at:", address(entityProvider));

        Depository depository = new Depository();
        console2.log("Depository deployed at:", address(depository));

        vm.stopBroadcast();

        return
            DeployedProdContracts({
                depository: address(depository),
                subcontractProvider: address(scProvider),
                entityProvider: address(entityProvider)
            });
    }
}

// Individual deployment scripts remain available
contract DeploySubcontractProvider is Script {
    function run() public returns (address) {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(deployerPrivateKey);

        SubcontractProvider scProvider = new SubcontractProvider();
        console2.log("SubcontractProvider deployed at:", address(scProvider));

        vm.stopBroadcast();
        return address(scProvider);
    }
}

contract DeployEntityProvider is Script {
    function run() public returns (address) {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(deployerPrivateKey);

        EntityProvider entityProvider = new EntityProvider();
        console2.log("EntityProvider deployed at:", address(entityProvider));

        vm.stopBroadcast();
        return address(entityProvider);
    }
}

contract DeployDepository is Script {
    function run() public returns (address) {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(deployerPrivateKey);

        Depository depository = new Depository();
        console2.log("Depository deployed at:", address(depository));

        vm.stopBroadcast();
        return address(depository);
    }
}
