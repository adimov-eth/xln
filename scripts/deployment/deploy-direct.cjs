const { ethers } = require('hardhat');
const fs = require('fs');

async function deployDirect() {
  console.log('[LAUNCH] DIRECT deployment bypassing ignition...');
  
  const [deployer] = await ethers.getSigners();
  console.log(`[PIN] Deploying with: ${deployer.address}`);
  
  // Deploy contracts directly
  console.log('[TOOL] Deploying EntityProvider...');
  const EntityProvider = await ethers.getContractFactory("EntityProvider");
  const entityProvider = await EntityProvider.deploy();
  await entityProvider.waitForDeployment();
  const epAddress = await entityProvider.getAddress();
  console.log(`[OK] EntityProvider: ${epAddress}`);
  
  console.log('[TOOL] Deploying Depository...');
  const Depository = await ethers.getContractFactory("Depository");
  const depository = await Depository.deploy(); // Constructor will run debugBulkFundEntities!
  await depository.waitForDeployment();
  const depAddress = await depository.getAddress();
  console.log(`[OK] Depository: ${depAddress}`);
  
  console.log('[TOOL] Adding EntityProvider to Depository...');
  const tx = await depository.addEntityProvider(epAddress);
  await tx.wait();
  console.log('[OK] EntityProvider approved');
  
  // TEST: Check if our function works
  console.log('[FIND] Testing our debug function...');
  try {
    const testTx = await depository.debugBulkFundEntities();
    await testTx.wait();
    console.log('[OK] debugBulkFundEntities works!');
    
    const balance = await depository._reserves("0x0000000000000000000000000000000000000000000000000000000000000001", 1);
    console.log(`[$] Entity 1 has: ${ethers.formatEther(balance)} ETH`);
  } catch (error) {
    console.log('[X] Function test failed:', error.message);
  }
  
  // Update jurisdictions.json
  const jurisdictions = JSON.parse(fs.readFileSync('jurisdictions.json', 'utf8'));
  jurisdictions.jurisdictions.ethereum.contracts.entityProvider = epAddress;
  jurisdictions.jurisdictions.ethereum.contracts.depository = depAddress;
  jurisdictions.lastUpdated = new Date().toISOString();
  
  fs.writeFileSync('jurisdictions.json', JSON.stringify(jurisdictions, null, 2));
  console.log('[OK] Updated jurisdictions.json');
  
  console.log(`[GOAL] SUCCESS! Depository with pre-funding: ${depAddress}`);
}

deployDirect().catch(console.error);
