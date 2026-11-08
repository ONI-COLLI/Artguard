// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// Records a wallet's claim about a file and a snapshot of its licensing terms.
/// A record does not independently establish authorship or transfer copyright.
contract ArtworkRegistry {
    struct Record { address registrant; bytes32 termsHash; uint64 registeredAt; }
    bytes32 public immutable instanceId;
    mapping(bytes32 => Record) public records;
    error InvalidHash();
    error AlreadyRegistered();
    event ArtworkRegistered(bytes32 indexed fileHash, address indexed registrant, bytes32 termsHash, uint64 registeredAt);
    constructor(bytes32 instance) { instanceId = instance; }
    function registerArtwork(bytes32 fileHash, bytes32 termsHash) external {
        if (fileHash == bytes32(0) || termsHash == bytes32(0)) revert InvalidHash();
        if (records[fileHash].registrant != address(0)) revert AlreadyRegistered();
        uint64 registeredAt = uint64(block.timestamp);
        records[fileHash] = Record(msg.sender, termsHash, registeredAt);
        emit ArtworkRegistered(fileHash, msg.sender, termsHash, registeredAt);
    }
}
