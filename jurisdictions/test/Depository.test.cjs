const { loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Depository", function () {
  async function deployFixture() {
    const [user0, user1] = await ethers.getSigners();

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

    const ERC20Mock = await ethers.getContractFactory("ERC20Mock");
    const erc20 = await ERC20Mock.deploy("ERC20Mock", "ERC20", 1_000_000);
    await erc20.waitForDeployment();

    return { depository, erc20, user0, user1 };
  }

  it("ERC20 deposit to reserve", async function () {
    const { depository, erc20, user0 } = await loadFixture(deployFixture);

    await erc20.approve(await depository.getAddress(), 10_000);
    await depository.externalTokenToReserve({
      entity: ethers.ZeroHash,
      contractAddress: await erc20.getAddress(),
      externalTokenId: 0,
      tokenType: 0,
      internalTokenId: 0,
      amount: 10_000,
    });

    const tokenId = (await depository.getTokensLength()) - 1n;
    const entityId = ethers.zeroPadValue(user0.address, 32);
    expect(await depository._reserves(entityId, tokenId)).to.equal(10_000);
  });

  it("reserveToReserve moves reserves between entities", async function () {
    const { depository, user0, user1 } = await loadFixture(deployFixture);

    const fromEntity = ethers.zeroPadValue(user0.address, 32);
    const toEntity = ethers.zeroPadValue(user1.address, 32);
    await depository.mintToReserve(fromEntity, 1, 1_000n);

    await expect(
      depository.connect(user0).reserveToReserve(fromEntity, toEntity, 1, 250n),
    ).to.not.be.reverted;

    expect(await depository._reserves(fromEntity, 1)).to.equal(750n);
    expect(await depository._reserves(toEntity, 1)).to.equal(250n);
  });
});
