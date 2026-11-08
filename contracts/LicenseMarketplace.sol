// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IArtworkRegistry {
    function instanceId() external view returns (bytes32);
    function records(bytes32 hash) external view returns (address registrant, bytes32 termsHash, uint64 registeredAt);
}
interface IPreviousMarketplace {
    function hasLicense(address buyer, bytes32 fileHash, uint8 licenseType) external view returns (bool);
}

/// Local-testnet marketplace. The platform signs short-lived quotes; users authorize payment.
contract LicenseMarketplace is EIP712, ReentrancyGuard {
    struct Quote {
        bytes32 id;
        address buyer;
        address seller;
        bytes32 fileHash;
        uint8 licenseType;
        bytes32 termsHash;
        uint256 amount;
        uint16 feeBps;
        uint64 expiresAt;
        bytes32 instanceId;
        address[] recipients;
        uint16[] shares;
    }
    bytes32 private constant QUOTE_TYPEHASH = keccak256("Quote(bytes32 id,address buyer,address seller,bytes32 fileHash,uint8 licenseType,bytes32 termsHash,uint256 amount,uint16 feeBps,uint64 expiresAt,bytes32 instanceId,address[] recipients,uint16[] shares)");
    IArtworkRegistry public immutable registry;
    address public immutable quoteSigner;
    address public immutable treasury;
    bytes32 public immutable instanceId;
    IPreviousMarketplace public immutable previousMarketplace;
    uint256 public constant version = 2;
    mapping(bytes32 => bool) public usedQuotes;
    mapping(bytes32 => bool) private ownedLicenses;
    mapping(address => uint256) public balances;

    error InvalidQuote();
    error InvalidPayment();
    error AlreadyLicensed();
    error NothingToWithdraw();
    error WithdrawalFailed();
    error InvalidShares();
    event LicensePurchased(bytes32 indexed quoteId, address indexed buyer, address indexed seller, bytes32 fileHash, uint8 licenseType, bytes32 termsHash, uint256 amount, uint256 fee, uint64 purchasedAt);
    event ProceedsWithdrawn(address indexed recipient, uint256 amount);
    event RevenueAllocated(bytes32 indexed quoteId, address indexed recipient, uint256 amount, uint16 shareBps);

    constructor(address registryAddress, address signer, address feeRecipient, address previous) EIP712("ArtGuardLicenses", "2") {
        require(signer != address(0) && feeRecipient != address(0), "Invalid address");
        registry = IArtworkRegistry(registryAddress);
        instanceId = registry.instanceId();
        quoteSigner = signer;
        treasury = feeRecipient;
        previousMarketplace = IPreviousMarketplace(previous);
    }
    function hasLicense(address buyer, bytes32 fileHash, uint8 licenseType) public view returns (bool) {
        return ownedLicenses[keccak256(abi.encode(buyer, fileHash, licenseType))] ||
            (address(previousMarketplace) != address(0) && previousMarketplace.hasLicense(buyer, fileHash, licenseType));
    }
    function buyLicenses(Quote[] calldata quotes, bytes[] calldata signatures) external payable nonReentrant {
        if (quotes.length == 0 || quotes.length > 50 || signatures.length != quotes.length) revert InvalidQuote();
        uint256 total;
        for (uint256 i; i < quotes.length; ++i) {
            Quote calldata q = quotes[i];
            if (q.buyer != msg.sender || q.buyer == q.seller || q.seller == address(0) || q.id == bytes32(0) || q.termsHash == bytes32(0) || q.amount == 0 || q.feeBps > 1000 || q.licenseType < 1 || q.licenseType > 3 || q.expiresAt < block.timestamp || q.instanceId != instanceId || usedQuotes[q.id]) revert InvalidQuote();
            (address registeredOwner,,) = registry.records(q.fileHash);
            if (registeredOwner != q.seller) revert InvalidQuote();
            if (ECDSA.recover(_hashTypedDataV4(keccak256(abi.encode(QUOTE_TYPEHASH, q.id, q.buyer, q.seller, q.fileHash, q.licenseType, q.termsHash, q.amount, q.feeBps, q.expiresAt, q.instanceId, keccak256(abi.encodePacked(q.recipients)), keccak256(abi.encodePacked(q.shares))))), signatures[i]) != quoteSigner) revert InvalidQuote();
            bytes32 key = keccak256(abi.encode(q.buyer, q.fileHash, q.licenseType));
            if (hasLicense(q.buyer, q.fileHash, q.licenseType)) revert AlreadyLicensed();
            usedQuotes[q.id] = true;
            ownedLicenses[key] = true;
            uint256 fee = q.amount * q.feeBps / 10000;
            if (q.recipients.length != q.shares.length || q.recipients.length > 10) revert InvalidShares();
            uint256 net = q.amount - fee;
            uint256 allocated;
            uint16 totalShares;
            for (uint256 j; j < q.recipients.length; ++j) {
                address recipient = q.recipients[j];
                if (recipient == address(0) || recipient == q.seller || q.shares[j] == 0) revert InvalidShares();
                for (uint256 k; k < j; ++k) if (recipient == q.recipients[k]) revert InvalidShares();
                totalShares += q.shares[j];
                if (totalShares > 9900) revert InvalidShares();
                uint256 share = net * q.shares[j] / 10000;
                allocated += share;
                balances[recipient] += share;
                emit RevenueAllocated(q.id, recipient, share, q.shares[j]);
            }
            // Integer rounding stays with the creator; the full payment is always accounted for.
            balances[q.seller] += net - allocated;
            emit RevenueAllocated(q.id, q.seller, net - allocated, 10000 - totalShares);
            balances[treasury] += fee;
            total += q.amount;
            emit LicensePurchased(q.id, q.buyer, q.seller, q.fileHash, q.licenseType, q.termsHash, q.amount, fee, uint64(block.timestamp));
        }
        if (msg.value != total) revert InvalidPayment();
    }
    function withdraw() external nonReentrant {
        uint256 amount = balances[msg.sender];
        if (amount == 0) revert NothingToWithdraw();
        balances[msg.sender] = 0;
        (bool success,) = payable(msg.sender).call{value: amount}("");
        if (!success) revert WithdrawalFailed();
        emit ProceedsWithdrawn(msg.sender, amount);
    }
}
