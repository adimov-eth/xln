const hre = require("hardhat");
const fs = require("fs");

async function main() {
  console.log("\n[TEST] Testing Reserve-to-Reserve functionality (Post-Deployment)...");

  // Read deployed contract address from ignition
  const deployedAddressesPath = "ignition/deployments/chain-1337/deployed_addresses.json";
  
  if (!fs.existsSync(deployedAddressesPath)) {
    throw new Error(`[X] Deployed addresses file not found: ${deployedAddressesPath}`);
  }

  const deployedAddresses = JSON.parse(fs.readFileSync(deployedAddressesPath, "utf8"));
  const depositoryAddress = deployedAddresses["DepositoryModule#Depository"];
  
  if (!depositoryAddress) {
    throw new Error("[X] Depository address not found in deployed addresses");
  }

  console.log(`[PIN] Using deployed Depository at: ${depositoryAddress}`);

  // Connect to the deployed contract
  const Depository = await hre.ethers.getContractFactory("Depository");
  const depository = Depository.attach(depositoryAddress);

  // Get signers
  const [owner] = await hre.ethers.getSigners();
  console.log(`[USER] Testing with account: ${owner.address}`);

  // Use pre-funded entity IDs from constructor
  const entity1 = "0x0000000000000000000000000000000000000000000000000000000000000001";
  const entity2 = "0x0000000000000000000000000000000000000000000000000000000000000002"; 
  const tokenId = 1; // Pre-funded token ID from constructor

  console.log("\n[STATS] Initial balances from pre-funded entities:");
  const initialBalance1 = await depository._reserves(entity1, tokenId);
  const initialBalance2 = await depository._reserves(entity2, tokenId);
  console.log(`   Entity1: ${hre.ethers.formatEther(initialBalance1)} ETH`);
  console.log(`   Entity2: ${hre.ethers.formatEther(initialBalance2)} ETH`);

  // Verify pre-funding worked
  const expectedBalance = hre.ethers.parseEther("1"); // 1M tokens = 1e18
  if (initialBalance1 < expectedBalance || initialBalance2 < expectedBalance) {
    throw new Error("[X] Entities are not properly pre-funded from constructor");
  }
  console.log("[OK] Pre-funding verification passed");

  // Create batch for reserve-to-reserve transfer
  const transferAmount = hre.ethers.parseEther("0.1"); // 0.1 tokens
  const batch = {
    reserveToExternalToken: [],
    externalTokenToReserve: [],
    reserveToReserve: [{
      receivingEntity: entity2,
      tokenId: tokenId,
      amount: transferAmount
    }],
    reserveToCollateral: [],
    settlements: [],
    cooperativeUpdate: [],
    cooperativeDisputeProof: [],
    initialDisputeProof: [],
    finalDisputeProof: [],
    flashloans: [],
    hub_id: 0
  };

  console.log("\n[LAUNCH] Executing reserve-to-reserve transfer...");
  console.log(`   Transfer: ${hre.ethers.formatEther(transferAmount)} ETH from Entity1 to Entity2`);
  
  // Listen for events
  const transferFilter = depository.filters.ReserveTransferred();
  const updateFilter = depository.filters.ReserveUpdated();
  
  const tx = await depository.processBatch(entity1, batch);
  const receipt = await tx.wait();
  
  console.log(`[OK] Transfer successful! TX: ${receipt.hash}`);

  // Check events
  const transferEvents = await depository.queryFilter(transferFilter, receipt.blockNumber, receipt.blockNumber);
  const updateEvents = await depository.queryFilter(updateFilter, receipt.blockNumber, receipt.blockNumber);
  
  console.log("\n[ANTENNA] Events emitted:");
  console.log(`   ReserveTransferred: ${transferEvents.length}`);
  console.log(`   ReserveUpdated: ${updateEvents.length}`);
  
  if (transferEvents.length > 0) {
    const event = transferEvents[0];
    console.log(`   [OUT] Transfer event: ${event.args.from} [RIGHTWARDS] ${event.args.to}`);
    console.log(`      Token: ${event.args.tokenId}, Amount: ${hre.ethers.formatEther(event.args.amount)}`);
  }

  // Check final balances
  console.log("\n[STATS] Final balances:");
  const finalBalance1 = await depository._reserves(entity1, tokenId);
  const finalBalance2 = await depository._reserves(entity2, tokenId);
  console.log(`   Entity1: ${hre.ethers.formatEther(finalBalance1)} ETH`);
  console.log(`   Entity2: ${hre.ethers.formatEther(finalBalance2)} ETH`);

  // Verify transfer worked
  const expectedBalance1 = initialBalance1 - transferAmount;
  const expectedBalance2 = initialBalance2 + transferAmount;
  
  console.log("\n[OK] Verification:");
  const balanceCheck1 = finalBalance1 === expectedBalance1;
  const balanceCheck2 = finalBalance2 === expectedBalance2;
  const eventCheck = transferEvents.length > 0;
  
  console.log(`   Entity1 balance correct: ${balanceCheck1}`);
  console.log(`   Entity2 balance correct: ${balanceCheck2}`);
  console.log(`   ReserveTransferred event emitted: ${eventCheck}`);
  
  if (balanceCheck1 && balanceCheck2 && eventCheck) {
    console.log("\n[DONE] ALL RESERVE-TO-RESERVE TESTS PASSED!");
    console.log("[OK] Depository contract is working correctly in the deployment cycle");
    return true;
  } else {
    console.log("\n[X] RESERVE-TO-RESERVE TESTS FAILED!");
    console.log("   The deployed contract is not working as expected");
    throw new Error("R2R test failure");
  }
}

main()
  .then((success) => {
    if (success) {
      process.exit(0);
    } else {
      process.exit(1);
    }
  })
  .catch((error) => {
    console.error("\n[X] R2R Test Error:", error.message);
    process.exit(1);
  });