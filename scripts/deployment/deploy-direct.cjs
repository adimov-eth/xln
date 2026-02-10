const { ethers } = require('hardhat');
const fs = require('fs');
const path = require('path');

/**
 * Full-stack deployment: Account lib → EntityProvider → Depository → DeltaTransformer → Mock tokens
 *
 * Usage:
 *   cd jurisdictions && DEPLOYER_PRIVATE_KEY=<key> bunx hardhat run ../scripts/deployment/deploy-direct.cjs --network sepolia
 *
 * Mirrors the BrowserVM deployment sequence in runtime/jadapter/browservm-provider.ts
 */
async function deploy() {
  const network = await ethers.provider.getNetwork();
  const networkName = network.name === 'unknown' ? `chain-${network.chainId}` : network.name;
  console.log(`\n🚀 Full-stack deployment to ${networkName} (chainId ${network.chainId})\n`);

  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`📍 Deployer: ${deployer.address}`);
  console.log(`💰 Balance: ${ethers.formatEther(balance)} ETH\n`);

  if (balance === 0n) {
    throw new Error('Deployer has zero balance — fund it first');
  }

  // ── 1. Account library ──────────────────────────────────────────────
  console.log('🔧 [1/4] Deploying Account library...');
  const Account = await ethers.getContractFactory('Account');
  const account = await Account.deploy();
  await account.waitForDeployment();
  const accountAddr = await account.getAddress();
  console.log(`   ✅ Account library: ${accountAddr}`);

  // ── 2. EntityProvider ───────────────────────────────────────────────
  console.log('🔧 [2/4] Deploying EntityProvider...');
  const EntityProvider = await ethers.getContractFactory('EntityProvider');
  const entityProvider = await EntityProvider.deploy();
  await entityProvider.waitForDeployment();
  const epAddr = await entityProvider.getAddress();
  console.log(`   ✅ EntityProvider: ${epAddr}`);

  // ── 3. Depository (linked to Account library, constructor takes EntityProvider) ──
  console.log('🔧 [3/4] Deploying Depository (Account library linking)...');
  const Depository = await ethers.getContractFactory('Depository', {
    libraries: { Account: accountAddr },
  });
  const depository = await Depository.deploy(epAddr);
  await depository.waitForDeployment();
  const depAddr = await depository.getAddress();
  console.log(`   ✅ Depository: ${depAddr}`);

  // ── 4. DeltaTransformer ─────────────────────────────────────────────
  console.log('🔧 [4/4] Deploying DeltaTransformer...');
  const DeltaTransformer = await ethers.getContractFactory('DeltaTransformer');
  const deltaTransformer = await DeltaTransformer.deploy();
  await deltaTransformer.waitForDeployment();
  const dtAddr = await deltaTransformer.getAddress();
  console.log(`   ✅ DeltaTransformer: ${dtAddr}`);

  // ── 5. Deploy mock ERC20 tokens + register with Depository ──────────
  console.log('\n🪙  Deploying mock tokens...');
  const ERC20Mock = await ethers.getContractFactory('ERC20Mock');
  const SUPPLY = ethers.parseEther('1000000000'); // 1B tokens
  const REGISTRATION_AMOUNT = 1000000n; // minimal amount for registration

  const tokens = [
    { name: 'USD Coin', symbol: 'USDC', decimals: 18 },
    { name: 'Wrapped Ether', symbol: 'WETH', decimals: 18 },
    { name: 'Tether USD', symbol: 'USDT', decimals: 18 },
  ];

  const dep = await ethers.getContractAt('Depository', depAddr);
  const tokenResults = [];

  for (const tok of tokens) {
    const erc20 = await ERC20Mock.deploy(tok.name, tok.symbol, SUPPLY);
    await erc20.waitForDeployment();
    const tokenAddr = await erc20.getAddress();

    // Approve Depository to pull registration amount
    const approveTx = await erc20.approve(depAddr, REGISTRATION_AMOUNT);
    await approveTx.wait();

    // Register token via externalTokenToReserve (struct fields match Types.sol)
    const regTx = await dep.externalTokenToReserve({
      entity: ethers.ZeroHash,
      contractAddress: tokenAddr,
      externalTokenId: 0,
      tokenType: 0, // TypeERC20
      internalTokenId: 0, // 0 = auto-assign
      amount: REGISTRATION_AMOUNT,
    });
    await regTx.wait();

    // Read back tokenId: packedToken = keccak256(abi.encode(tokenType, address, externalTokenId))
    const packedToken = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(['uint8', 'address', 'uint96'], [0, tokenAddr, 0]),
    );
    const tokenId = await dep.tokenToId(packedToken);

    tokenResults.push({
      ...tok,
      address: tokenAddr,
      tokenId: Number(tokenId),
    });
    console.log(`   ✅ ${tok.symbol} (id=${tokenId}): ${tokenAddr}`);
  }

  // ── Write deployment artifact ───────────────────────────────────────
  const artifact = {
    network: networkName,
    chainId: Number(network.chainId),
    deployer: deployer.address,
    deployedAt: new Date().toISOString(),
    contracts: {
      account: accountAddr,
      entityProvider: epAddr,
      depository: depAddr,
      deltaTransformer: dtAddr,
    },
    tokens: tokenResults,
  };

  const deploymentsDir = path.join(__dirname, '..', '..', 'jurisdictions', 'deployments');
  fs.mkdirSync(deploymentsDir, { recursive: true });

  const filename = networkName === 'sepolia' ? 'sepolia.json' : `${networkName}.json`;
  const outPath = path.join(deploymentsDir, filename);
  fs.writeFileSync(outPath, JSON.stringify(artifact, null, 2));
  console.log(`\n📁 Deployment artifact: ${outPath}`);

  // ── Summary ─────────────────────────────────────────────────────────
  const endBalance = await ethers.provider.getBalance(deployer.address);
  const spent = balance - endBalance;
  console.log(`\n💸 Gas spent: ${ethers.formatEther(spent)} ETH`);
  console.log(`💰 Remaining: ${ethers.formatEther(endBalance)} ETH`);
  console.log('\n🎯 Deployment complete!\n');
}

deploy().catch(err => {
  console.error('\n❌ Deployment failed:', err.message || err);
  process.exit(1);
});
