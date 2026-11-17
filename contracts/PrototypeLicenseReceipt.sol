// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";

interface IArtGuardLicenseStatus {
    function hasLicense(address buyer, bytes32 fileHash, uint8 licenseType) external view returns (bool);
}

/// Optional coursework example for a local Anvil chain.
/// The marketplace remains the source of truth for expiry and access.
contract PrototypeLicenseReceipt is ERC721 {
    IArtGuardLicenseStatus public immutable marketplace;

    error LocalChainOnly();
    error InvalidMarketplace();
    error InactiveLicense();
    error ReceiptAlreadyClaimed();
    error NonTransferable();

    constructor(address marketplaceAddress) ERC721("ArtGuard Prototype Receipt", "AG-TEST") {
        if (block.chainid != 31337) revert LocalChainOnly();
        if (marketplaceAddress.code.length == 0) revert InvalidMarketplace();
        marketplace = IArtGuardLicenseStatus(marketplaceAddress);
    }

    function claim(bytes32 fileHash, uint8 licenseType) external returns (uint256 tokenId) {
        address buyer = msg.sender;
        if (!marketplace.hasLicense(buyer, fileHash, licenseType)) revert InactiveLicense();

        tokenId = uint256(keccak256(abi.encode(buyer, fileHash, licenseType)));
        if (_ownerOf(tokenId) != address(0)) revert ReceiptAlreadyClaimed();
        _safeMint(buyer, tokenId);
    }

    function approve(address, uint256) public pure override {
        revert NonTransferable();
    }

    function setApprovalForAll(address, bool) public pure override {
        revert NonTransferable();
    }

    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        if (_ownerOf(tokenId) != address(0)) revert NonTransferable();
        return super._update(to, tokenId, auth);
    }
}
