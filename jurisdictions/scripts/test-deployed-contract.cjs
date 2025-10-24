const hre = require("hardhat");

async function main() {
    const contractAddress = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512";
    console.log("[FIND] Testing deployed contract at:", contractAddress);

    try {
        const contract = await hre.ethers.getContractAt('Depository', contractAddress);
        console.log("[OK] Contract attached successfully");

        // Test debugBulkFundEntities
        console.log("[FIND] Testing debugBulkFundEntities...");
        await contract.debugBulkFundEntities();
        console.log("[OK] debugBulkFundEntities works");

        // Test _reserves
        console.log("[FIND] Testing _reserves...");
        const balance = await contract._reserves("0x0000000000000000000000000000000000000000000000000000000000000001", 1);
        console.log("[OK] _reserves works, balance:", balance.toString());

        // Check interface
        console.log("[FIND] Contract interface functions:");
        const functions = Object.keys(contract.interface.functions);
        console.log("Available functions:", functions);

        const hasProcessBatch = functions.some(f => f.includes('processBatch'));
        console.log("Has processBatch:", hasProcessBatch ? "[OK] YES" : "[X] NO");

    } catch (error) {
        console.log("[X] Contract test failed:", error.message);
    }
}

main().catch(console.error);