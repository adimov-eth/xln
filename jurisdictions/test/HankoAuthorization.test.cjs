const { loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Hanko Authorization", function () {
  async function deployFixture() {
    const [admin, entity1, entity2] = await ethers.getSigners();

    const EntityProviderFactory = await ethers.getContractFactory("EntityProvider");
    const entityProvider = await EntityProviderFactory.deploy();
    await entityProvider.waitForDeployment();

    const AccountFactory = await ethers.getContractFactory("Account");
    const account = await AccountFactory.deploy();
    await account.waitForDeployment();

    const DepositoryFactory = await ethers.getContractFactory("Depository", {
      libraries: {
        Account: await account.getAddress(),
      },
    });
    const depository = await DepositoryFactory.deploy(await entityProvider.getAddress());
    await depository.waitForDeployment();

    return { depository, entityProvider, admin, entity1, entity2 };
  }

  it("reserveToReserve authorizes fromEntity signer", async function () {
    const { depository, entity1, entity2 } = await loadFixture(deployFixture);
    const entity1Id = ethers.zeroPadValue(entity1.address, 32);
    const entity2Id = ethers.zeroPadValue(entity2.address, 32);

    await depository.mintToReserve(entity1Id, 1, 1000n);
    await expect(
      depository.connect(entity1).reserveToReserve(entity1Id, entity2Id, 1, 250n),
    ).to.not.be.reverted;
  });

  it("processBatch rejects invalid Hanko", async function () {
    const { depository, entityProvider } = await loadFixture(deployFixture);

    const coder = ethers.AbiCoder.defaultAbiCoder();
    const emptyHanko = coder.encode(
      [
        "tuple(bytes32[] placeholders, bytes packedSignatures, tuple(bytes32 entityId, uint256[] entityIndexes, uint256[] weights, uint256 threshold)[] claims)",
      ],
      [
        {
          placeholders: [],
          packedSignatures: "0x",
          claims: [],
        },
      ],
    );

    await expect(
      depository.processBatch("0x", await entityProvider.getAddress(), emptyHanko, 1),
    ).to.be.revertedWithCustomError(depository, "E4");
  });

  it("unsafeProcessBatch requires admin + enable flag", async function () {
    const { depository, admin, entity1, entity2 } = await loadFixture(deployFixture);
    const entity1Id = ethers.zeroPadValue(entity1.address, 32);
    const entity2Id = ethers.zeroPadValue(entity2.address, 32);

    await depository.mintToReserve(entity1Id, 1, 1000n);

    const batch = {
      flashloans: [],
      reserveToReserve: [{ receivingEntity: entity2Id, tokenId: 1, amount: 100n }],
      reserveToCollateral: [],
      collateralToReserve: [],
      settlements: [],
      disputeStarts: [],
      disputeFinalizations: [],
      externalTokenToReserve: [],
      reserveToExternalToken: [],
      revealSecrets: [],
      hub_id: 0,
    };

    await expect(depository.unsafeProcessBatch(entity1Id, batch)).to.be.reverted;
    await expect(depository.connect(admin).setUnsafeBatchEnabled(true)).to.not.be.reverted;
    await expect(
      depository.connect(entity1).unsafeProcessBatch(entity1Id, batch),
    ).to.be.reverted;
    await expect(
      depository.connect(admin).unsafeProcessBatch(entity1Id, batch),
    ).to.not.be.reverted;
  });
});
