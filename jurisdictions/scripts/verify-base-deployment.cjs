/**
 * Verify Base deployment contracts on BaseScan.
 *
 * Usage:
 *   cd jurisdictions && npx hardhat run scripts/verify-base-deployment.cjs --network base-sepolia
 */
const fs = require('fs');
const path = require('path');
const hre = require('hardhat');

async function verifyOne(address, constructorArguments = [], contract) {
  if (!address) return;
  try {
    await hre.run('verify:verify', {
      address,
      constructorArguments,
      contract,
    });
    console.log(`✅ Verified ${address}`);
  } catch (err) {
    const msg = (err && err.message) || String(err);
    if (msg.includes('Already Verified')) {
      console.log(`ℹ️ Already verified ${address}`);
      return;
    }
    throw err;
  }
}

async function main() {
  const network = hre.network.name;
  const file = path.join(__dirname, `../deployments/${network}.json`);
  if (!fs.existsSync(file)) {
    throw new Error(`Missing deployment file: ${file}`);
  }

  const dep = JSON.parse(fs.readFileSync(file, 'utf8'));
  const c = dep.contracts || {};
  if (!c.entityProvider || !c.depository || !c.deltaTransformer || !c.token || !c.account) {
    throw new Error('Deployment file missing required contract addresses');
  }

  await verifyOne(c.account, [], 'contracts/Account.sol:Account');
  await verifyOne(c.entityProvider, [], 'contracts/EntityProvider.sol:EntityProvider');
  await verifyOne(c.depository, [c.entityProvider], 'contracts/Depository.sol:Depository');
  await verifyOne(c.deltaTransformer, [c.depository], 'contracts/DeltaTransformer.sol:DeltaTransformer');
  await verifyOne(c.token, ['USD Coin', 'USDC', 18], 'contracts/Token.sol:Token');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
