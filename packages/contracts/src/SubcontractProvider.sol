// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title SubcontractProvider
 * @notice Responsible for applying batched Payment and Swap updates to user deltas.
 */
contract SubcontractProvider {
    mapping(bytes32 => uint256) public hashToBlock;
    uint256 private constant MAXUINT32 = type(uint32).max;

    struct Batch {
        Payment[] payment;
        Swap[] swap;
    }

    // Actual subcontract structs
    struct Payment {
        uint256 deltaIndex;
        int256 amount;
        uint256 revealedUntilBlock;
        bytes32 hash;
    }

    struct Swap {
        bool ownerIsLeft;
        uint256 addDeltaIndex;
        uint256 addAmount;
        uint256 subDeltaIndex;
        uint256 subAmount;
    }

    // https://en.wikipedia.org/wiki/Credit_default_swap
    struct CreditDefaultSwap {
        uint256 deltaIndex;
        int256 amount;
        address referenceEntity;
        uint256 tokenId;
        uint256 exerciseUntilBlock;
    }

    /**
     * @dev Constructor calls revealSecret with empty bytes32(0) by default.
     */
    constructor() {
        revealSecret(bytes32(0));
    }

    /**
     * @notice Encodes a batch struct into bytes
     */
    function encodeBatch(Batch memory b) public pure returns (bytes memory) {
        return abi.encode(b);
    }

    /**
     * @notice Applies an encoded batch of payments and swaps to the given deltas array.
     */
    function applyBatch(
        int256[] memory deltas,
        bytes calldata encodedBatch,
        bytes calldata leftArguments,
        bytes calldata rightArguments
    ) public view returns (int256[] memory) {
        Batch memory decodedBatch = abi.decode(encodedBatch, (Batch));

        // decode arguments if needed (unused in the current code)
        uint256[] memory lArgs = abi.decode(leftArguments, (uint256[]));
        uint256[] memory rArgs = abi.decode(rightArguments, (uint256[]));

        // Payments
        for (uint256 i = 0; i < decodedBatch.payment.length; i++) {
            applyPayment(deltas, decodedBatch.payment[i]);
        }

        // Swaps
        uint256 leftSwaps = 0;
        for (uint256 i = 0; i < decodedBatch.swap.length; i++) {
            Swap memory swap = decodedBatch.swap[i];
            uint32 fillRatio = uint32(
                swap.ownerIsLeft ? lArgs[leftSwaps] : rArgs[i - leftSwaps]
            );
            applySwap(deltas, swap, fillRatio);
            if (swap.ownerIsLeft) {
                leftSwaps++;
            }
        }
        return deltas;
    }

    /**
     * @notice A Payment is only applied if it has already been revealed before revealedUntilBlock.
     */
    function applyPayment(
        int256[] memory deltas,
        Payment memory payment
    ) private view {
        uint256 revealedAt = hashToBlock[payment.hash];
        if (revealedAt == 0 || revealedAt > payment.revealedUntilBlock) {
            return;
        }
        deltas[payment.deltaIndex] += payment.amount;
    }

    /**
     * @notice A Swap trades addAmount for subAmount within the provided ratio.
     */
    function applySwap(
        int256[] memory deltas,
        Swap memory swap,
        uint32 fillRatio
    ) private pure {
        deltas[swap.addDeltaIndex] += int256(
            (swap.addAmount * fillRatio) / MAXUINT32
        );
        deltas[swap.subDeltaIndex] -= int256(
            (swap.subAmount * fillRatio) / MAXUINT32
        );
    }

    /**
     * @notice Reveal a hashed secret for an HTLC-like mechanism. This sets the block number at which it was revealed.
     */
    function revealSecret(bytes32 secret) public {
        hashToBlock[keccak256(abi.encode(secret))] = block.number;
    }

    /**
     * @notice Allow anyone to clean up old revealed secrets to reclaim storage gas if their reveal is ancient.
     */
    function cleanSecret(bytes32 hash) public {
        if (
            hashToBlock[hash] != 0 && hashToBlock[hash] < block.number - 100000
        ) {
            delete hashToBlock[hash];
        }
    }
}
