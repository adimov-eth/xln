// SPDX-License-Identifier: unknown
pragma solidity ^0.8.24;
import {MessageHashUtils} from "openzeppelin-contracts/contracts/utils/cryptography/MessageHashUtils.sol";
import {ECDSA} from "openzeppelin-contracts/contracts/utils/cryptography/ECDSA.sol";
import {ReentrancyGuard} from "openzeppelin-contracts/contracts/utils/ReentrancyGuard.sol";

import {SubcontractProvider} from "./SubcontractProvider.sol";

// Add necessary interfaces
interface IERC20 {
    function transfer(address to, uint256 value) external returns (bool);
    function transferFrom(
        address from,
        address to,
        uint256 value
    ) external returns (bool);
}
interface IERC721 {
    function transferFrom(address from, address to, uint256 tokenId) external;
}
interface IERC1155 {
    function safeTransferFrom(
        address from,
        address to,
        uint256 id,
        uint256 amount,
        bytes calldata data
    ) external;
}

// Custom errors
error InsufficientReserve();
error InvalidSigner();
error DisputeAlreadyOpen();
error DisputeNotFound();
error InvalidNonce();
error WaitingDisputePeriod();
error InvalidFinalProofBody();
error InvalidSignature();
error Unauthorized();
error TransferFailed();
error NotEnoughPeerReserve();
error NotEnoughSenderReserve();
error NotEnoughCollateral();
error NonceMismatch();
error InvalidProofBody();
error InvalidTokenType();

/**
 * @title Depository
 * @notice Manages reserves, channels, disputes, and subcontracts.
 */
contract Depository is ReentrancyGuard {
    using MessageHashUtils for bytes32;
    using ECDSA for bytes32;

    // Reserve mappins: entity -> (tokenId -> balance)
    mapping(address => mapping(uint256 => uint256)) public reserves;

    // Channel data for each pair of entities and each token
    mapping(bytes => ChannelInfo) public channels;
    mapping(bytes => mapping(uint256 => ChannelCollateral)) public collaterals;

    // Accumulates debts (entity -> tokenId -> Debt[]).
    // Entities pay from their reserves in a FIFO manner.
    mapping(address => mapping(uint256 => Debt[])) public debts;
    mapping(address => mapping(uint256 => uint256)) public debtIndex; // Current pointer to an unpaid debt
    mapping(address => uint256) public activeDebts;

    struct Hub {
        address addr;
        uint256 gasUsed;
        string uri;
    }
    Hub[] public hubs;

    event TransferReserveToCollateral(
        address indexed receiver,
        address indexed addr,
        uint256 collateral,
        int256 onDelta,
        uint256 tokenId
    );
    event DisputeStarted(
        address indexed sender,
        address indexed peer,
        uint256 indexed disputeNonce,
        bytes initialArguments
    );
    event CooperativeClose(
        address indexed sender,
        address indexed peer,
        uint256 indexed cooperativeNonce
    );

    // Token type identifiers
    uint8 private constant TYPE_ERC20 = 0;
    uint8 private constant TYPE_ERC721 = 1;
    uint8 private constant TYPE_ERC1155 = 2;

    bytes32[] public tokens;

    constructor() {
        tokens.push(bytes32(0));
        // Initialize with dummy empty hub
        hubs.push(Hub({addr: address(0), uri: "", gasUsed: 0}));
    }

    function getTokensLength() public view returns (uint256) {
        return tokens.length;
    }

    // ---------------------------------------
    // Batch / Channel Management
    // ---------------------------------------

    struct Batch {
        ReserveToExternalToken[] reserveToExternalToken;
        ExternalTokenToReserve[] externalTokenToReserve;
        ReserveToReserve[] reserveToReserve;
        ReserveToCollateral[] reserveToCollateral;
        CooperativeUpdate[] cooperativeUpdate;
        CooperativeDisputeProof[] cooperativeDisputeProof;
        InitialDisputeProof[] initialDisputeProof;
        FinalDisputeProof[] finalDisputeProof;
        TokenAmountPair[] flashloans;
        uint256 hubId;
    }

    function processBatch(
        Batch calldata batch
    ) public nonReentrant returns (bool completeSuccess) {
        return _processBatch(msg.sender, batch);
    }

    function _processBatch(
        address msgSender,
        Batch memory batch
    ) private returns (bool completeSuccess) {
        uint256 startGas = gasleft();
        completeSuccess = true;

        // 1. Cooperative updates
        for (uint256 i = 0; i < batch.cooperativeUpdate.length; i++) {
            if (!(cooperativeUpdate(batch.cooperativeUpdate[i]))) {
                completeSuccess = false;
            }
        }
        // 2. Cooperative dispute proofs
        for (uint256 i = 0; i < batch.cooperativeDisputeProof.length; i++) {
            if (!(cooperativeDisputeProof(batch.cooperativeDisputeProof[i]))) {
                completeSuccess = false;
            }
        }
        // 3. Initial dispute proofs
        for (uint256 i = 0; i < batch.initialDisputeProof.length; i++) {
            if (!(initialDisputeProof(batch.initialDisputeProof[i]))) {
                completeSuccess = false;
            }
        }
        // 4. Final dispute proofs
        for (uint256 i = 0; i < batch.finalDisputeProof.length; i++) {
            if (!(finalDisputeProof(batch.finalDisputeProof[i]))) {
                completeSuccess = false;
            }
        }
        // 5. Reserve -> Collateral
        for (uint256 i = 0; i < batch.reserveToCollateral.length; i++) {
            if (!(reserveToCollateral(batch.reserveToCollateral[i]))) {
                completeSuccess = false;
            }
        }

        // Update hub gas usage if valid
        if (batch.hubId != 0 && msgSender == hubs[batch.hubId].addr) {
            hubs[batch.hubId].gasUsed += (startGas - gasleft());
        }
        return completeSuccess;
    }

    enum MessageType {
        CooperativeUpdate,
        CooperativeDisputeProof,
        DisputeProof
    }

    struct TokenAmountPair {
        uint256 tokenId;
        uint256 amount;
    }

    struct AddrAmountPair {
        address addr;
        uint256 amount;
    }

    struct ReserveToCollateral {
        uint256 tokenId;
        address receiver;
        AddrAmountPair[] pairs;
    }

    struct Diff {
        uint256 tokenId;
        int256 peerReserveDiff;
        int256 collateralDiff;
        int256 onDeltaDiff;
    }

    struct CooperativeUpdate {
        address peer;
        Diff[] diffs;
        uint256[] forgiveDebtsInTokenIds;
        bytes sig;
    }

    struct Allowence {
        uint256 deltaIndex;
        uint256 rightAllowence;
        uint256 leftAllowence;
    }

    struct SubcontractClause {
        address subcontractProviderAddress;
        bytes encodedBatch;
        Allowence[] allowences;
    }

    struct ProofBody {
        int256[] offdeltas;
        uint256[] tokenIds;
        SubcontractClause[] subcontracts;
    }

    struct CooperativeDisputeProof {
        address peer;
        ProofBody proofbody;
        bytes initialArguments;
        bytes finalArguments;
        bytes sig;
    }

    struct InitialDisputeProof {
        address peer;
        uint256 cooperativeNonce;
        uint256 disputeNonce;
        bytes32 proofbodyHash;
        bytes sig;
        bytes initialArguments;
    }

    struct FinalDisputeProof {
        address peer;
        uint256 initialCooperativeNonce;
        uint256 initialDisputeNonce;
        uint256 disputeUntilBlock;
        bytes32 initialProofbodyHash;
        bytes initialArguments;
        bool startedByLeft;
        uint256 finalCooperativeNonce;
        uint256 finalDisputeNonce;
        ProofBody finalProofbody;
        bytes finalArguments;
        bytes sig;
    }

    struct Debt {
        uint256 amount;
        address creditor;
    }

    struct ChannelCollateral {
        uint256 collateral;
        int256 onDelta;
    }

    struct ChannelInfo {
        uint256 cooperativeNonce;
        bytes32 disputeHash;
    }

    // ---------------------------------------
    // External Token Wrappers
    // ---------------------------------------

    function packTokenReference(
        uint8 tokenType,
        address contractAddress,
        uint96 externalTokenId
    ) public pure returns (bytes32) {
        if (tokenType > 255) revert InvalidTokenType();
        bytes32 packed = bytes32(uint256(uint160(contractAddress)) << 96);
        packed |= bytes32(uint256(externalTokenId) << 8);
        packed |= bytes32(uint256(tokenType));
        return packed;
    }

    function unpackTokenReference(
        bytes32 packed
    )
        public
        pure
        returns (
            address contractAddress,
            uint96 externalTokenId,
            uint8 tokenType
        )
    {
        contractAddress = address(uint160(uint256(packed) >> 96));
        externalTokenId = uint96(
            (uint256(packed) >> 8) & 0xFFFFFFFFFFFFFFFFFFFFFF
        );
        tokenType = uint8(uint256(packed) & 0xFF);
        return (contractAddress, externalTokenId, tokenType);
    }

    function registerHub(
        uint256 hubId,
        string memory newUri
    ) public returns (uint256) {
        if (hubId == 0) {
            hubs.push(Hub({addr: msg.sender, uri: newUri, gasUsed: 0}));
            return hubs.length - 1;
        } else {
            if (msg.sender != hubs[hubId].addr) revert Unauthorized();
            hubs[hubId].uri = newUri;
            return hubId;
        }
    }

    struct ExternalTokenToReserve {
        bytes32 packedToken;
        uint256 internalTokenId;
        uint256 amount;
    }

    function externalTokenToReserve(
        ExternalTokenToReserve memory params
    ) public nonReentrant {
        if (params.internalTokenId == 0) {
            tokens.push(params.packedToken);
            params.internalTokenId = tokens.length - 1;
        } else {
            params.packedToken = tokens[params.internalTokenId];
        }

        (
            address contractAddress,
            uint96 tokenRefId,
            uint8 tokenType
        ) = unpackTokenReference(params.packedToken);
        if (tokenType == TYPE_ERC20) {
            if (
                !IERC20(contractAddress).transferFrom(
                    msg.sender,
                    address(this),
                    params.amount
                )
            ) revert TransferFailed();
        } else if (tokenType == TYPE_ERC721) {
            IERC721(contractAddress).transferFrom(
                msg.sender,
                address(this),
                uint256(tokenRefId)
            );
        } else if (tokenType == TYPE_ERC1155) {
            IERC1155(contractAddress).safeTransferFrom(
                msg.sender,
                address(this),
                uint256(tokenRefId),
                params.amount,
                ""
            );
        }
        reserves[msg.sender][params.internalTokenId] += params.amount;
    }

    struct ReserveToExternalToken {
        address receiver;
        uint256 tokenId;
        uint256 amount;
    }

    function reserveToExternalToken(
        ReserveToExternalToken memory params
    ) public nonReentrant {
        enforceDebts(msg.sender, params.tokenId);
        (
            address contractAddress,
            uint96 tokenRefId,
            uint8 tokenType
        ) = unpackTokenReference(tokens[params.tokenId]);

        if (reserves[msg.sender][params.tokenId] < params.amount) {
            revert InsufficientReserve();
        }
        reserves[msg.sender][params.tokenId] -= params.amount;

        if (tokenType == TYPE_ERC20) {
            if (
                !IERC20(contractAddress).transfer(
                    params.receiver,
                    params.amount
                )
            ) revert TransferFailed();
        } else if (tokenType == TYPE_ERC721) {
            IERC721(contractAddress).transferFrom(
                address(this),
                params.receiver,
                uint256(tokenRefId)
            );
        } else if (tokenType == TYPE_ERC1155) {
            IERC1155(contractAddress).safeTransferFrom(
                address(this),
                params.receiver,
                uint256(tokenRefId),
                params.amount,
                ""
            );
        }
    }

    struct ReserveToReserve {
        address receiver;
        uint256 tokenId;
        uint256 amount;
    }

    function reserveToReserve(ReserveToReserve memory params) public {
        enforceDebts(msg.sender, params.tokenId);
        if (reserves[msg.sender][params.tokenId] < params.amount) {
            revert InsufficientReserve();
        }
        reserves[msg.sender][params.tokenId] -= params.amount;
        reserves[params.receiver][params.tokenId] += params.amount;
    }

    // ---------------------------------------
    // Debt Management
    // ---------------------------------------

    function getDebts(
        address account,
        uint256 tokenId
    ) public view returns (Debt[] memory allDebts, uint256 currentDebtIndex) {
        currentDebtIndex = debtIndex[account][tokenId];
        allDebts = debts[account][tokenId];
    }

    function enforceDebts(
        address account,
        uint256 tokenId
    ) public returns (uint256 totalDebts) {
        uint256 debtsLength = debts[account][tokenId].length;
        if (debtsLength == 0) {
            return 0;
        }
        uint256 availableReserve = reserves[account][tokenId];
        uint256 currentDebtIndex = debtIndex[account][tokenId];

        if (availableReserve == 0) {
            return (debtsLength - currentDebtIndex);
        }

        while (true) {
            Debt storage debt = debts[account][tokenId][currentDebtIndex];
            if (availableReserve >= debt.amount) {
                availableReserve -= debt.amount;
                reserves[debt.creditor][tokenId] += debt.amount;
                delete debts[account][tokenId][currentDebtIndex];
                if (currentDebtIndex + 1 == debtsLength) {
                    currentDebtIndex = 0;
                    delete debts[account][tokenId];
                    debtsLength = 0;
                    break;
                }
                currentDebtIndex++;
                activeDebts[account]--;
            } else {
                reserves[debt.creditor][tokenId] += availableReserve;
                debt.amount -= availableReserve;
                availableReserve = 0;
                break;
            }
        }
        reserves[account][tokenId] = availableReserve;
        debtIndex[account][tokenId] = currentDebtIndex;
        return (debtsLength - currentDebtIndex);
    }

    // Deterministic channel key
    function channelKey(
        address a1,
        address a2
    ) public pure returns (bytes memory) {
        return a1 < a2 ? abi.encodePacked(a1, a2) : abi.encodePacked(a2, a1);
    }

    function reserveToCollateral(
        ReserveToCollateral memory params
    ) public nonReentrant returns (bool) {
        uint256 tokenId = params.tokenId;
        address rcv = params.receiver;
        enforceDebts(msg.sender, tokenId);

        for (uint256 i = 0; i < params.pairs.length; i++) {
            address pairAddr = params.pairs[i].addr;
            uint256 amount = params.pairs[i].amount;
            bytes memory chKey = channelKey(rcv, pairAddr);

            if (reserves[msg.sender][tokenId] >= amount) {
                ChannelCollateral storage col = collaterals[chKey][tokenId];
                reserves[msg.sender][tokenId] -= amount;
                col.collateral += amount;
                if (rcv < pairAddr) {
                    col.onDelta += int256(amount);
                }
                emit TransferReserveToCollateral(
                    rcv,
                    pairAddr,
                    col.collateral,
                    col.onDelta,
                    tokenId
                );
            } else {
                return false;
            }
        }
        return true;
    }

    function cooperativeUpdate(
        CooperativeUpdate memory params
    ) public returns (bool) {
        bytes memory chKey = channelKey(msg.sender, params.peer);
        bytes memory encodedMsg = abi.encode(
            MessageType.CooperativeUpdate,
            chKey,
            channels[chKey].cooperativeNonce,
            params.diffs,
            params.forgiveDebtsInTokenIds
        );
        bytes32 hash = keccak256(encodedMsg).toEthSignedMessageHash();
        address signer = hash.recover(params.sig);

        if (params.peer != signer) {
            revert InvalidSigner();
        }

        for (uint256 i = 0; i < params.diffs.length; i++) {
            Diff memory diff = params.diffs[i];
            if (diff.peerReserveDiff < 0) {
                enforceDebts(params.peer, diff.tokenId);
                if (
                    reserves[params.peer][diff.tokenId] <
                    uint256(-diff.peerReserveDiff)
                ) {
                    revert NotEnoughPeerReserve();
                }
                reserves[params.peer][diff.tokenId] -= uint256(
                    -diff.peerReserveDiff
                );
            } else {
                reserves[params.peer][diff.tokenId] += uint256(
                    diff.peerReserveDiff
                );
            }

            int256 totalDiff = diff.peerReserveDiff + diff.collateralDiff;
            if (totalDiff > 0) {
                enforceDebts(msg.sender, diff.tokenId);
                if (reserves[msg.sender][diff.tokenId] < uint256(totalDiff)) {
                    revert NotEnoughSenderReserve();
                }
                reserves[msg.sender][diff.tokenId] -= uint256(totalDiff);
            } else {
                reserves[msg.sender][diff.tokenId] += uint256(-totalDiff);
            }

            if (diff.collateralDiff < 0) {
                if (
                    collaterals[chKey][diff.tokenId].collateral <
                    uint256(-diff.collateralDiff)
                ) {
                    revert NotEnoughCollateral();
                }
                collaterals[chKey][diff.tokenId].collateral -= uint256(
                    -diff.collateralDiff
                );
            } else {
                collaterals[chKey][diff.tokenId].collateral += uint256(
                    diff.collateralDiff
                );
            }
            collaterals[chKey][diff.tokenId].onDelta += diff.onDeltaDiff;
        }
        channels[chKey].cooperativeNonce++;
        return true;
    }

    function finalizeChannel(
        address entity1,
        address entity2,
        ProofBody memory proofBody,
        bytes memory arguments1,
        bytes memory arguments2
    ) public returns (bool) {
        address leftAddress;
        address rightAddress;
        bytes memory leftArguments;
        bytes memory rightArguments;

        if (entity1 < entity2) {
            leftAddress = entity1;
            rightAddress = entity2;
            leftArguments = arguments1;
            rightArguments = arguments2;
        } else {
            leftAddress = entity2;
            rightAddress = entity1;
            leftArguments = arguments2;
            rightArguments = arguments1;
        }

        bytes memory chKey = abi.encodePacked(leftAddress, rightAddress);

        // 1. create deltas
        int256[] memory deltas = new int256[](proofBody.offdeltas.length);
        for (uint256 i = 0; i < deltas.length; i++) {
            deltas[i] =
                collaterals[chKey][proofBody.tokenIds[i]].onDelta +
                proofBody.offdeltas[i];
        }

        // 2. process subcontracts
        bytes[] memory decodedLeftArguments = abi.decode(
            leftArguments,
            (bytes[])
        );
        bytes[] memory decodedRightArguments = abi.decode(
            rightArguments,
            (bytes[])
        );

        for (uint256 i = 0; i < proofBody.subcontracts.length; i++) {
            SubcontractClause memory sc = proofBody.subcontracts[i];
            int256[] memory newDeltas = SubcontractProvider(
                sc.subcontractProviderAddress
            ).applyBatch(
                    deltas,
                    sc.encodedBatch,
                    decodedLeftArguments[i],
                    decodedRightArguments[i]
                );
            if (newDeltas.length != deltas.length) {
                revert InvalidProofBody();
            }
            for (uint256 j = 0; j < sc.allowences.length; j++) {
                Allowence memory allowence = sc.allowences[j];
                int256 difference = newDeltas[allowence.deltaIndex] -
                    deltas[allowence.deltaIndex];
                if (
                    (difference > 0 &&
                        uint(difference) > allowence.rightAllowence) ||
                    (difference < 0 &&
                        uint(-difference) > allowence.leftAllowence) ||
                    difference == 0
                ) {
                    continue;
                }
                deltas[allowence.deltaIndex] = newDeltas[allowence.deltaIndex];
            }
            deltas = newDeltas;
        }

        // 3. split collateral
        for (uint256 i = 0; i < deltas.length; i++) {
            uint256 tId = proofBody.tokenIds[i];
            int256 delta = deltas[i];
            ChannelCollateral storage col = collaterals[chKey][tId];
            if (delta >= 0 && uint(delta) <= col.collateral) {
                reserves[leftAddress][tId] += uint256(delta);
                reserves[rightAddress][tId] += (col.collateral -
                    uint256(delta));
            } else {
                address getsCollateral = (delta < 0)
                    ? rightAddress
                    : leftAddress;
                address getsDebt = (delta < 0) ? leftAddress : rightAddress;
                uint256 debtAmount = (delta < 0)
                    ? uint256(-delta)
                    : (uint256(delta) - col.collateral);
                reserves[getsCollateral][tId] += col.collateral;

                if (reserves[getsDebt][tId] >= debtAmount) {
                    reserves[getsCollateral][tId] += debtAmount;
                    reserves[getsDebt][tId] -= debtAmount;
                } else {
                    if (reserves[getsDebt][tId] > 0) {
                        reserves[getsCollateral][tId] += reserves[getsDebt][
                            tId
                        ];
                        debtAmount -= reserves[getsDebt][tId];
                        reserves[getsDebt][tId] = 0;
                    }
                    debts[getsDebt][tId].push(
                        Debt({creditor: getsCollateral, amount: debtAmount})
                    );
                    activeDebts[getsDebt]++;
                }
            }
            delete collaterals[chKey][tId];
        }

        delete channels[chKey].disputeHash;
        channels[chKey].cooperativeNonce++;
        return true;
    }

    function cooperativeDisputeProof(
        CooperativeDisputeProof memory params
    ) public returns (bool) {
        bytes memory chKey = channelKey(msg.sender, params.peer);
        bytes memory encodedMsg = abi.encode(
            MessageType.CooperativeDisputeProof,
            chKey,
            channels[chKey].cooperativeNonce,
            keccak256(abi.encode(params.proofbody)),
            keccak256(params.initialArguments)
        );

        bytes32 finalHash = keccak256(encodedMsg).toEthSignedMessageHash();
        if (finalHash.recover(params.sig) != params.peer) {
            revert InvalidSigner();
        }
        if (channels[chKey].disputeHash != bytes32(0)) {
            revert DisputeAlreadyOpen();
        }

        delete channels[chKey].disputeHash;
        finalizeChannel(
            msg.sender,
            params.peer,
            params.proofbody,
            params.finalArguments,
            params.initialArguments
        );
        emit CooperativeClose(
            msg.sender,
            params.peer,
            channels[chKey].cooperativeNonce
        );
        return true;
    }

    function initialDisputeProof(
        InitialDisputeProof memory params
    ) public returns (bool) {
        bytes memory chKey = channelKey(msg.sender, params.peer);
        if (channels[chKey].cooperativeNonce > params.cooperativeNonce) {
            revert NonceMismatch();
        }

        bytes memory encodedMsg = abi.encode(
            MessageType.DisputeProof,
            chKey,
            params.cooperativeNonce,
            params.disputeNonce,
            params.proofbodyHash
        );

        bytes32 finalHash = keccak256(encodedMsg).toEthSignedMessageHash();
        if (finalHash.recover(params.sig) != params.peer) {
            revert InvalidSigner();
        }
        if (channels[chKey].disputeHash != bytes32(0)) {
            revert DisputeAlreadyOpen();
        }

        bytes memory encodedDispute = abi.encodePacked(
            params.cooperativeNonce,
            params.disputeNonce,
            (msg.sender < params.peer),
            block.number + 20,
            params.proofbodyHash,
            keccak256(abi.encodePacked(params.initialArguments))
        );
        channels[chKey].disputeHash = keccak256(encodedDispute);

        emit DisputeStarted(
            msg.sender,
            params.peer,
            params.disputeNonce,
            params.initialArguments
        );
        return true;
    }

    function finalDisputeProof(
        FinalDisputeProof memory params
    ) public returns (bool) {
        bytes memory chKey = channelKey(msg.sender, params.peer);
        bytes memory encodedDispute = abi.encodePacked(
            params.initialCooperativeNonce,
            params.initialDisputeNonce,
            params.startedByLeft,
            params.disputeUntilBlock,
            params.initialProofbodyHash,
            keccak256(params.initialArguments)
        );
        if (channels[chKey].disputeHash != keccak256(encodedDispute)) {
            revert DisputeNotFound();
        }

        if (params.sig.length != 0) {
            bytes32 finalProofbodyHash = keccak256(
                abi.encode(params.finalProofbody)
            );
            bytes memory encodedMsg = abi.encode(
                MessageType.DisputeProof,
                chKey,
                params.finalCooperativeNonce,
                params.finalDisputeNonce,
                finalProofbodyHash
            );
            bytes32 finalHash = keccak256(encodedMsg).toEthSignedMessageHash();
            if (finalHash.recover(params.sig) != params.peer) {
                revert InvalidSigner();
            }
            if (params.initialDisputeNonce >= params.finalDisputeNonce) {
                revert InvalidNonce();
            }
        } else {
            // If no signature, counterparty is not responding or agrees
            bool senderIsCounterparty = (params.startedByLeft !=
                (msg.sender < params.peer));
            if (
                !senderIsCounterparty && block.number < params.disputeUntilBlock
            ) {
                revert WaitingDisputePeriod();
            }
            if (
                params.initialProofbodyHash !=
                keccak256(abi.encode(params.finalProofbody))
            ) {
                revert InvalidFinalProofBody();
            }
        }

        finalizeChannel(
            msg.sender,
            params.peer,
            params.finalProofbody,
            params.finalArguments,
            params.initialArguments
        );
        return true;
    }

    // ---------------------------------------
    // View Functions
    // ---------------------------------------

    struct TokenReserveDebts {
        uint256 reserve;
        uint256 debtIndex;
        Debt[] debts;
    }

    struct UserReturn {
        uint256 ethBalance;
        TokenReserveDebts[] tokens;
    }

    struct ChannelReturn {
        ChannelInfo channel;
        ChannelCollateral[] collaterals;
    }

    function getUsers(
        address[] memory accounts,
        uint256[] memory tokenIds
    ) external view returns (UserReturn[] memory response) {
        response = new UserReturn[](accounts.length);
        for (uint256 i = 0; i < accounts.length; i++) {
            address account = accounts[i];
            response[i] = UserReturn({
                ethBalance: account.balance,
                tokens: new TokenReserveDebts[](tokenIds.length)
            });
            for (uint256 j = 0; j < tokenIds.length; j++) {
                response[i].tokens[j] = TokenReserveDebts({
                    reserve: reserves[account][tokenIds[j]],
                    debtIndex: debtIndex[account][tokenIds[j]],
                    debts: debts[account][tokenIds[j]]
                });
            }
        }
        return response;
    }

    function getChannels(
        address account,
        address[] memory peers,
        uint256[] memory tokenIds
    ) public view returns (ChannelReturn[] memory response) {
        response = new ChannelReturn[](peers.length);
        for (uint256 i = 0; i < peers.length; i++) {
            bytes memory chKey = channelKey(account, peers[i]);
            response[i] = ChannelReturn({
                channel: channels[chKey],
                collaterals: new ChannelCollateral[](tokenIds.length)
            });
            for (uint256 j = 0; j < tokenIds.length; j++) {
                response[i].collaterals[j] = collaterals[chKey][tokenIds[j]];
            }
        }
        return response;
    }

    // Safe transfer acceptance for ERC1155
    function onERC1155Received(
        address, // operator
        address, // from
        uint256, // id
        uint256, // value
        bytes calldata // data
    ) external pure returns (bytes4) {
        return this.onERC1155Received.selector;
    }
}
