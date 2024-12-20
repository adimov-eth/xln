// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Depository} from "../src/Depository.sol";
import {SubcontractProvider} from "../src/SubcontractProvider.sol";
import {TestERC20} from "./helpers/TestERC20.sol";
import {TestERC721} from "./helpers/TestERC721.sol";
import {TestERC1155} from "./helpers/TestERC1155.sol";

contract DepositoryTest is Test {
    Depository public depository;
    SubcontractProvider public scProvider;

    TestERC20 public erc20;
    TestERC721 public erc721;
    TestERC1155 public erc1155;

    uint256 public erc20id;
    uint256 public erc721id;
    uint256 public erc1155id;

    address public user0;
    address public user1;
    address public user2;

    function setUp() public {
        // Setup users
        user0 = address(this);
        user1 = makeAddr("user1");
        user2 = makeAddr("user2");

        // Deploy mock tokens
        erc20 = new TestERC20();
        erc721 = new TestERC721();
        erc1155 = new TestERC1155();

        // Setup initial token states
        erc721.mint(user0, 1);
        erc1155.mint(user0, 0, 100);

        // Deploy main contracts
        depository = new Depository();
        scProvider = new SubcontractProvider();
    }

    function testTransferERC20ToReserve() public {
        bytes32 packedToken = depository.packTokenReference(
            0,
            address(erc20),
            0
        );
        erc20.approve(address(depository), 10000);

        assertEq(erc20.balanceOf(user0), 1000000);

        Depository.ExternalTokenToReserve memory params = Depository
            .ExternalTokenToReserve({
                packedToken: packedToken,
                internalTokenId: 0,
                amount: 10000
            });
        depository.externalTokenToReserve(params);

        erc20id = depository.getTokensLength() - 1;

        uint256 reserve = depository.reserves(user0, erc20id);
        assertEq(reserve, 10000);
        assertEq(erc20.balanceOf(user0), 990000);
    }

    function testTransferERC721ToReserve() public {
        bytes32 packedToken = depository.packTokenReference(
            1,
            address(erc721),
            1
        );
        erc721.approve(address(depository), 1);
        assertEq(erc721.ownerOf(1), user0);

        Depository.ExternalTokenToReserve memory params = Depository
            .ExternalTokenToReserve({
                packedToken: packedToken,
                internalTokenId: 0,
                amount: 1
            });
        depository.externalTokenToReserve(params);

        erc721id = depository.getTokensLength() - 1;
        uint256 reserve = depository.reserves(user0, erc721id);

        assertEq(erc721.ownerOf(1), address(depository));
        assertEq(reserve, 1);
    }

    function testTransferERC1155ToReserve() public {
        bytes32 packedToken = depository.packTokenReference(
            2,
            address(erc1155),
            0
        );
        erc1155.setApprovalForAll(address(depository), true);

        assertEq(erc1155.balanceOf(user0, 0), 100);

        Depository.ExternalTokenToReserve memory params = Depository
            .ExternalTokenToReserve({
                packedToken: packedToken,
                internalTokenId: 0,
                amount: 50
            });
        depository.externalTokenToReserve(params);

        erc1155id = depository.getTokensLength() - 1;
        uint256 reserve = depository.reserves(user0, erc1155id);

        assertEq(reserve, 50);
        assertEq(erc1155.balanceOf(user0, 0), 50);
    }

    function testTransferERC20FromReserveToReserve() public {
        testTransferERC20ToReserve();

        Depository.ReserveToReserve memory params = Depository
            .ReserveToReserve({receiver: user1, tokenId: erc20id, amount: 50});
        depository.reserveToReserve(params);

        uint256 reserveUser1 = depository.reserves(user1, erc20id);
        uint256 reserveUser0 = depository.reserves(user0, erc20id);

        assertEq(reserveUser1, 50);
        assertEq(reserveUser0, 9950);
    }

    function testTransferERC20FromReserveToCollateral() public {
        testTransferERC20ToReserve();

        Depository.AddrAmountPair[]
            memory pairs = new Depository.AddrAmountPair[](1);
        pairs[0] = Depository.AddrAmountPair({addr: user1, amount: 50});

        Depository.ReserveToCollateral memory params = Depository
            .ReserveToCollateral({
                tokenId: erc20id,
                receiver: user0,
                pairs: pairs
            });

        depository.reserveToCollateral(params);

        bytes memory chKey = depository.channelKey(user0, user1);
        (uint256 collateral, ) = depository.collaterals(chKey, erc20id);
        uint256 reserve = depository.reserves(user0, erc20id);

        assertEq(collateral, 50);
        assertEq(reserve, 9900);
    }

    function testTransferERC20Back() public {
        testTransferERC20ToReserve();

        Depository.ReserveToExternalToken memory params = Depository
            .ReserveToExternalToken({
                receiver: user0,
                tokenId: erc20id,
                amount: 100
            });

        depository.reserveToExternalToken(params);

        uint256 balance = erc20.balanceOf(user0);
        assertEq(balance, 990100);
    }

    function testTransferERC721Back() public {
        testTransferERC721ToReserve();

        Depository.ReserveToExternalToken memory params = Depository
            .ReserveToExternalToken({
                receiver: user0,
                tokenId: erc721id,
                amount: 1
            });

        depository.reserveToExternalToken(params);

        address ownerOfToken = erc721.ownerOf(1);
        assertEq(ownerOfToken, user0);
    }

    function testTransferERC1155Back() public {
        testTransferERC1155ToReserve();

        Depository.ReserveToExternalToken memory params = Depository
            .ReserveToExternalToken({
                receiver: user0,
                tokenId: erc1155id,
                amount: 50
            });

        depository.reserveToExternalToken(params);

        uint256 balance = erc1155.balanceOf(user0, 0);
        assertEq(balance, 100);
    }
}
