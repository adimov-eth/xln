// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {ECDSA} from "openzeppelin-contracts/contracts/utils/cryptography/ECDSA.sol";
import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "openzeppelin-contracts/contracts/access/Ownable.sol";

error InvalidBoardHash();
error InvalidSignatureLength();
error InvalidSignerAddress();
error InvalidTokenHolderSignature();
error SignatureLengthMismatch();
error TokenHolderNoBalance();
error InvalidDelegateEntityId();
error BoardNotFound();
error EntityNotFound();
error InvalidBoardData();
error InvalidTokenAddress();

contract EntityProvider is Ownable {
    // ----------------------------------------
    // Data Structures
    // ----------------------------------------

    struct Entity {
        address tokenAddress;
        string name;
        bytes32 currentBoardHash; // The hash of the currently active board
        bytes32 proposedAuthenticatorHash; // The hash of a proposed board, awaiting activation
        bool exists;
    }

    struct Delegate {
        bytes entityId; // If length == 20 => EOA; otherwise an entity ID
        uint16 votingPower;
    }

    struct Board {
        uint16 votingThreshold;
        Delegate[] delegates;
    }

    struct BoardData {
        bool exists;
        uint16 votingThreshold;
        Delegate[] delegates;
    }

    // EIP-712 Typed Data Definition
    // We sign over VoteMessage(messageHash)
    bytes32 private constant _EIP712_DOMAIN_TYPEHASH =
        keccak256(
            "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
        );
    bytes32 private constant _VOTEMESSAGE_TYPEHASH =
        keccak256("VoteMessage(bytes32 messageHash)");

    // Storage
    Entity[] public entities;
    mapping(bytes32 => BoardData) public boards;
    mapping(uint256 => uint256) public activateAtBlock;

    // Domain Separator for EIP-712
    bytes32 private immutable _DOMAIN_SEPARATOR;

    // ----------------------------------------
    // Events
    // ----------------------------------------
    event EntityCreated(
        uint256 indexed entityId,
        address tokenAddress,
        string name
    );
    event BoardProposed(uint256 indexed entityId, bytes32 boardHash);
    event BoardActivated(uint256 indexed entityId, bytes32 boardHash);

    // ----------------------------------------
    // Constructor
    // ----------------------------------------
    constructor() {
        _DOMAIN_SEPARATOR = _buildDomainSeparator(
            _EIP712_DOMAIN_TYPEHASH,
            keccak256("EntityProvider"),
            keccak256("1")
        );
    }

    // ----------------------------------------
    // Public/External Functions
    // ----------------------------------------

    /**
     * @notice Creates a new entity that can have boards proposed and activated
     * @param tokenAddress The token that represents membership or stakes in the entity
     * @param name The entity's name
     * @return entityId The ID of the newly created entity
     */
    function createEntity(
        address tokenAddress,
        string calldata name
    ) external onlyOwner returns (uint256 entityId) {
        if (tokenAddress == address(0)) revert InvalidTokenAddress();
        entityId = entities.length;
        entities.push(
            Entity({
                tokenAddress: tokenAddress,
                name: name,
                currentBoardHash: bytes32(0),
                proposedAuthenticatorHash: bytes32(0),
                exists: true
            })
        );
        emit EntityCreated(entityId, tokenAddress, name);
    }

    /**
     * @notice Proposes a new board for an entity
     * @param entityId The entity's ID
     * @param proposedAuthenticator Encoded board data (abi.encode(Board))
     * @param tokenHolders A list of addresses (each as `bytes`) that must have nonzero token balance
     * @param signatures Corresponding signatures from these token holders
     */
    function proposeBoard(
        uint256 entityId,
        bytes calldata proposedAuthenticator,
        bytes[] calldata tokenHolders,
        bytes[] calldata signatures
    ) external {
        if (!_entityExists(entityId)) revert EntityNotFound();
        if (tokenHolders.length != signatures.length)
            revert SignatureLengthMismatch();

        // Decode the proposed board
        Board memory newBoard = abi.decode(proposedAuthenticator, (Board));
        if (newBoard.delegates.length == 0 || newBoard.votingThreshold == 0)
            revert InvalidBoardData();

        bytes32 proposedHash = keccak256(proposedAuthenticator);

        // Verify token holders' signatures
        // They sign the raw proposedAuthenticator under EIP-712
        bytes32 typedDataHash = _hashTypedData(
            keccak256(proposedAuthenticator)
        );
        address tokenAddress = entities[entityId].tokenAddress;

        for (uint256 i = 0; i < tokenHolders.length; i++) {
            address holder = abi.decode(tokenHolders[i], (address));
            if (IERC20(tokenAddress).balanceOf(holder) == 0) {
                revert TokenHolderNoBalance();
            }

            address recovered = ECDSA.recover(typedDataHash, signatures[i]);
            if (recovered != holder) {
                revert InvalidTokenHolderSignature();
            }
        }

        // Store the proposed board
        BoardData storage bd = boards[proposedHash];
        bd.exists = true;
        bd.votingThreshold = newBoard.votingThreshold;

        // Clear any existing delegates data for this hash before re-storing
        delete bd.delegates;
        for (uint256 i = 0; i < newBoard.delegates.length; i++) {
            bd.delegates.push(newBoard.delegates[i]);
        }

        entities[entityId].proposedAuthenticatorHash = proposedHash;
        emit BoardProposed(entityId, proposedHash);
    }

    /**
     * @notice Activates a previously proposed board for the entity
     * @param entityId The entity's ID
     */
    function activateAuthenticator(uint256 entityId) external onlyOwner {
        if (!_entityExists(entityId)) revert EntityNotFound();
        bytes32 proposedHash = entities[entityId].proposedAuthenticatorHash;
        if (!boards[proposedHash].exists) revert BoardNotFound();

        activateAtBlock[entityId] = block.number;
        entities[entityId].currentBoardHash = proposedHash;
        // Optional: clear out the proposed hash to indicate finalization
        entities[entityId].proposedAuthenticatorHash = bytes32(0);
        emit BoardActivated(entityId, proposedHash);
    }

    /**
     * @notice Verifies signatures from delegates according to the entity's current board configuration.
     *         This is a view function that can be called by external contracts or off-chain clients.
     * @param messageHash The message hash delegates are signing (not pre-signed with EIP-191)
     * @param entityParams If it's a known entity ID (32 bytes), fetches that entity's currentBoardHash.
     *        Otherwise, treats it as a direct board hash.
     * @param delegateSignatures Signatures from each delegate in order. Each must have a corresponding signature.
     * @param entityStack Used for recursion detection if nested entities exist
     * @return uint16 The voting ratio (0 if invalid or not meeting threshold)
     */
    function isValidSignature(
        bytes32 messageHash,
        bytes calldata entityParams,
        bytes[] calldata delegateSignatures,
        bytes32[] calldata entityStack
    ) external view returns (uint16) {
        bytes32 epHash = bytes32(entityParams);
        bytes32 boardHash;
        uint256 entityId;

        if (_entityExists(uint256(epHash))) {
            // Interprets epHash as entityId
            entityId = uint256(epHash);
            boardHash = entities[entityId].currentBoardHash;
            if (boardHash == bytes32(0)) revert InvalidBoardHash();
        } else {
            // Treat entityParams as boardHash directly
            boardHash = epHash;
        }

        BoardData storage bd = boards[boardHash];
        if (!bd.exists) revert BoardNotFound();

        if (delegateSignatures.length != bd.delegates.length)
            revert SignatureLengthMismatch();

        bytes32 typedDataHash = _hashTypedData(messageHash);

        uint16 voteYes = 0;
        uint16 voteNo = 0;

        for (uint256 i = 0; i < bd.delegates.length; i++) {
            Delegate memory delegate = bd.delegates[i];
            bytes memory sig = delegateSignatures[i];

            if (delegate.entityId.length == 20) {
                // EOA delegate
                address delegateAddress = address(
                    uint160(bytes20(delegate.entityId))
                );
                address recovered = ECDSA.recover(typedDataHash, sig);
                if (recovered == delegateAddress) {
                    voteYes += delegate.votingPower;
                } else {
                    voteNo += delegate.votingPower;
                }
            } else {
                // Nested entity
                bytes32 delegateHash = keccak256(delegate.entityId);
                bool isRecursive = _isEntityInStack(delegateHash, entityStack);

                if (isRecursive) {
                    // If recursive, count as yes to break loops
                    voteYes += delegate.votingPower;
                } else {
                    uint256 nestedEntityId = _bytesToUint(delegate.entityId);
                    if (!_entityExists(nestedEntityId))
                        revert InvalidDelegateEntityId();

                    // Recurse with updated stack
                    bytes32[] memory newStack = new bytes32[](
                        entityStack.length + 1
                    );
                    for (uint256 j = 0; j < entityStack.length; j++) {
                        newStack[j] = entityStack[j];
                    }
                    newStack[entityStack.length] = delegateHash;

                    uint16 nestedResult = this.isValidSignature(
                        messageHash,
                        abi.encodePacked(bytes32(nestedEntityId)),
                        delegateSignatures, // reuse same signatures array
                        newStack
                    );

                    if (nestedResult > 0) {
                        voteYes += delegate.votingPower;
                    } else {
                        voteNo += delegate.votingPower;
                    }
                }
            }
        }

        if (voteYes == 0) return 0;
        uint16 ratio = uint16((uint256(voteYes) * 100) / (voteYes + voteNo));
        return (ratio >= bd.votingThreshold) ? ratio : 0;
    }

    // ----------------------------------------
    // Internal/Private Functions
    // ----------------------------------------

    function _isEntityInStack(
        bytes32 delegateHash,
        bytes32[] calldata entityStack
    ) private pure returns (bool) {
        for (uint256 i = 0; i < entityStack.length; i++) {
            if (entityStack[i] == delegateHash) {
                return true;
            }
        }
        return false;
    }

    function _bytesToUint(
        bytes memory b
    ) private pure returns (uint256 number) {
        if (b.length > 32) revert InvalidDelegateEntityId();
        for (uint256 i = 0; i < b.length; i++) {
            number = (number << 8) | uint8(b[i]);
        }
    }

    function _entityExists(uint256 id) private view returns (bool) {
        return (id < entities.length && entities[id].exists);
    }

    function _buildDomainSeparator(
        bytes32 typeHash,
        bytes32 name,
        bytes32 version
    ) private view returns (bytes32) {
        return
            keccak256(
                abi.encode(
                    typeHash,
                    name,
                    version,
                    block.chainid,
                    address(this)
                )
            );
    }

    function _hashTypedData(
        bytes32 structHash
    ) internal view returns (bytes32) {
        return
            keccak256(
                abi.encodePacked(
                    "\x19\x01",
                    _DOMAIN_SEPARATOR,
                    keccak256(abi.encode(_VOTEMESSAGE_TYPEHASH, structHash))
                )
            );
    }
}
