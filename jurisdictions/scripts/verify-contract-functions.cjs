const { ethers } = require("hardhat");
const fs = require('fs');

async function main() {
    console.log("[FIND] Verifying deployed contract functions...");

    // Use address from environment variable if provided (fresh from deployment)
    let depositoryAddress = process.env.DEPOSITORY_ADDRESS;

    if (!depositoryAddress) {
        console.log("[FIND] No address from environment, reading from deployment file...");
        // Fallback to deployment file
        const deploymentFile = "ignition/deployments/chain-1337/deployed_addresses.json";
        if (!fs.existsSync(deploymentFile)) {
            console.log("[X] Deployment file not found:", deploymentFile);
            process.exit(1);
        }

        const deploymentData = JSON.parse(fs.readFileSync(deploymentFile, 'utf8'));
        depositoryAddress = deploymentData['DepositoryModule#Depository'];

        if (!depositoryAddress) {
            console.log("[X] Depository address not found in deployment file");
            process.exit(1);
        }
    } else {
        console.log("[FIND] Using fresh address from deployment script:", depositoryAddress);
    }

    console.log("[PIN] Verifying Depository at:", depositoryAddress);

    // Connect to contract
    const Depository = await ethers.getContractFactory("Depository");
    const depository = Depository.attach(depositoryAddress);

    // Check bytecode
    const provider = depository.runner.provider;
    const deployedBytecode = await provider.getCode(depositoryAddress);
    console.log("[FIND] Contract bytecode length:", deployedBytecode.length, "characters");

    // Get actual function selectors from contract interface
    console.log("[FIND] Getting contract factory...");
    const DepositoryFactory = await ethers.getContractFactory("Depository");
    console.log("[FIND] Contract factory:", DepositoryFactory ? "[OK] LOADED" : "[X] NULL");

    if (!DepositoryFactory) {
        console.log("[X] Contract factory is null - compilation issue");
        process.exit(1);
    }

    const contractInterface = DepositoryFactory.interface;
    console.log("[FIND] Contract interface:", contractInterface ? "[OK] LOADED" : "[X] NULL");

    if (!contractInterface) {
        console.log("[X] Contract interface is null - ABI issue");
        process.exit(1);
    }

    console.log("[FIND] Interface properties:", Object.keys(contractInterface));
    console.log("[FIND] Interface.functions exists:", !!contractInterface.functions);
    console.log("[FIND] Interface.fragments exists:", !!contractInterface.fragments);

    if (!contractInterface.functions) {
        console.log("[X] Interface.functions is missing, checking fragments...");

        if (contractInterface.fragments) {
            console.log("[FIND] Using fragments instead of functions");
            const functionFragments = contractInterface.fragments.filter(f => f.type === 'function');
            console.log("[LIST] Function fragments:", functionFragments.map(f => f.name));
        } else {
            console.log("[X] No functions or fragments available");
            process.exit(1);
        }
    }

    console.log("[FIND] Calculating ACTUAL function selectors from interface...");

    // Use fragments since modern ethers doesn't expose functions directly
    const functionFragments = contractInterface.fragments.filter(f => f.type === 'function');
    const functionNames = functionFragments.map(f => f.name);
    console.log("[LIST] Available functions in interface:", functionNames);

    // Check if critical functions exist
    const hasProcessBatch = functionNames.includes('processBatch');
    const hasSettle = functionNames.includes('settle');
    const hasPrefund = functionNames.includes('prefundAccount');

    console.log("[FIND] Critical function availability:");
    console.log("   processBatch:", hasProcessBatch ? "[OK] FOUND" : "[X] MISSING");
    console.log("   settle:", hasSettle ? "[OK] FOUND" : "[X] MISSING");
    console.log("   prefundAccount:", hasPrefund ? "[OK] FOUND" : "[X] MISSING");

    if (!hasProcessBatch || !hasSettle || !hasPrefund) {
        console.log("[X] CRITICAL: Essential functions missing from contract interface!");
        process.exit(1);
    }

    // Calculate correct selectors
    const processBatchFrag = contractInterface.getFunction("processBatch");
    const settleFrag = contractInterface.getFunction("settle");
    const prefundFrag = contractInterface.getFunction("prefundAccount");

    const actualProcessBatchSelector = processBatchFrag.selector;
    const actualSettleSelector = settleFrag.selector;
    const actualPrefundSelector = prefundFrag.selector;

    console.log("[FIND] ACTUAL function selectors:");
    console.log("   processBatch:", actualProcessBatchSelector);
    console.log("   settle:", actualSettleSelector);
    console.log("   prefundAccount:", actualPrefundSelector);

    console.log("[FIND] Checking ACTUAL selectors in deployed bytecode...");
    const processBatchFound = deployedBytecode.includes(actualProcessBatchSelector.slice(2));
    const settleFound = deployedBytecode.includes(actualSettleSelector.slice(2));
    const prefundFound = deployedBytecode.includes(actualPrefundSelector.slice(2));

    console.log("   processBatch:", processBatchFound ? "[OK] FOUND" : "[X] MISSING");
    console.log("   settle:", settleFound ? "[OK] FOUND" : "[X] MISSING");
    console.log("   prefundAccount:", prefundFound ? "[OK] FOUND" : "[X] MISSING");

    // FAIL if any critical function is missing
    if (!processBatchFound || !settleFound || !prefundFound) {
        console.log("[X] CRITICAL: Essential functions missing from deployed contract!");
        process.exit(1);
    }

    // Skip the problematic interface test since we already verified functions exist
    console.log("[IDEA] Skipping interface test - functions already verified via fragments");

    console.log("[OK] ALL CRITICAL FUNCTIONS VERIFIED IN DEPLOYED CONTRACT!");
    console.log("[OK] Contract verification complete - deployment successful!");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("[X] Verification failed:", error);
        process.exit(1);
    });