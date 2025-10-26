const { expect } = require("chai");
const hre = require("hardhat");

describe("Populate Test Data", function () {
  let depository, entityProvider;
  let deployer;

  before(async function () {
    // Get deployed contracts
    depository = await hre.ethers.getContractAt("Depository", "0x5FbDB2315678afecb367f032d93F642f64180aa3");
    entityProvider = await hre.ethers.getContractAt("EntityProvider", "0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9");

    [deployer] = await hre.ethers.getSigners();

    console.log("\n═══════════════════════════════════════════════════════════");
    console.log("  Populating Test Data via Hardhat Test");
    console.log("═══════════════════════════════════════════════════════════\n");
    console.log(`[OK] Deployer: ${deployer.address}`);
    console.log(`[OK] Depository: ${await depository.getAddress()}`);
    console.log(`[OK] EntityProvider: ${await entityProvider.getAddress()}\n`);
  });

  it("Should register test entities", async function () {
    console.log("=== Step 1: Register Test Entities ===");

    const boardHashes = [
      hre.ethers.zeroPadValue("0x2a", 32), // 42
      hre.ethers.zeroPadValue("0x45", 32), // 69
      hre.ethers.zeroPadValue("0xaa", 32), // 170
    ];

    for (let i = 0; i < boardHashes.length; i++) {
      console.log(`[FIND] Registering entity ${i + 1}...`);

      const tx = await entityProvider.registerNumberedEntity(boardHashes[i]);
      const receipt = await tx.wait();

      console.log(`[OK] Entity ${i + 1} registered (tx: ${receipt.hash.slice(0,10)}...)`);
    }

    console.log("");
  });

  it("Should fund reserves", async function () {
    console.log("=== Step 2: Fund Reserves ===");

    const fundingPlan = [
      { entity: hre.ethers.zeroPadValue("0x01", 32), token: 1, amount: hre.ethers.parseEther("1000") },
      { entity: hre.ethers.zeroPadValue("0x01", 32), token: 2, amount: hre.ethers.parseEther("500") },
      { entity: hre.ethers.zeroPadValue("0x02", 32), token: 1, amount: hre.ethers.parseEther("2000") },
      { entity: hre.ethers.zeroPadValue("0x02", 32), token: 2, amount: hre.ethers.parseEther("750") },
      { entity: hre.ethers.zeroPadValue("0x03", 32), token: 1, amount: hre.ethers.parseEther("1500") },
    ];

    for (const { entity, token, amount } of fundingPlan) {
      console.log(`[FIND] Funding entity ${entity}, token ${token} with ${hre.ethers.formatEther(amount)} units...`);

      const tx = await depository.debugFundReserves(entity, token, amount);
      await tx.wait();

      console.log(`[OK] Funded successfully`);
    }

    console.log("");
  });

  it("Should verify reserves", async function () {
    console.log("=== Step 3: Verify Reserves ===");

    const checks = [
      { entity: hre.ethers.zeroPadValue("0x01", 32), token: 1, expected: "1000.0" },
      { entity: hre.ethers.zeroPadValue("0x01", 32), token: 2, expected: "500.0" },
      { entity: hre.ethers.zeroPadValue("0x02", 32), token: 1, expected: "2000.0" },
      { entity: hre.ethers.zeroPadValue("0x02", 32), token: 2, expected: "750.0" },
      { entity: hre.ethers.zeroPadValue("0x03", 32), token: 1, expected: "1500.0" },
    ];

    for (const { entity, token, expected } of checks) {
      const reserve = await depository._reserves(entity, token);
      const formatted = hre.ethers.formatEther(reserve);

      console.log(`[OK] Entity ${entity}, Token ${token}: ${formatted} units`);
      expect(formatted).to.equal(expected);
    }

    console.log("\n[OK] Test data populated successfully!");
    console.log("\n=== Ready for Racket RPC Testing ===");
    console.log("Run: racket examples/simple-query-demo.rkt\n");
    console.log("λ.\n");
  });
});
