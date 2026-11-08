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
    function licenseExpiry(address buyer, bytes32 fileHash, uint8 licenseType) external view returns (uint64);
}

/// Local-testnet marketplace. The platform signs short-lived quotes; users authorize payment.
contract EscrowLicenseMarketplace is EIP712, ReentrancyGuard {
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
        uint64 durationSeconds;
    }
    bytes32 private constant QUOTE_TYPEHASH = keccak256("Quote(bytes32 id,address buyer,address seller,bytes32 fileHash,uint8 licenseType,bytes32 termsHash,uint256 amount,uint16 feeBps,uint64 expiresAt,bytes32 instanceId,address[] recipients,uint16[] shares,uint64 durationSeconds)");
    IArtworkRegistry public immutable registry;
    address public immutable quoteSigner;
    address public immutable treasury;
    bytes32 public immutable instanceId;
    IPreviousMarketplace public immutable previousMarketplace;
    uint256 public constant version = 4;
    mapping(bytes32 => bool) public usedQuotes;
    mapping(bytes32 => uint64) private validUntil;
    mapping(address => uint256) public balances;

    struct Escrow {
        address buyer; address seller; bytes32 fileHash; uint8 licenseType;
        uint256 amount; uint256 fee; uint64 durationSeconds; uint8 state;
        uint64 deliveryDeadline; uint64 reviewDeadline; uint64 disputeDeadline;
    }
    mapping(bytes32 => Escrow) private escrows;
    mapping(bytes32 => Quote) private offers;
    mapping(bytes32 => bytes32) public pendingLicenses;
    mapping(address => uint256) public refundBalances;
    uint64 public constant deliveryPeriod = 72 hours;
    uint64 public constant reviewPeriod = 24 hours;
    uint64 public constant disputePeriod = 7 days;
    address public immutable arbiter;
    error InvalidState(); error Unauthorized(); error TooEarly();
    event EscrowFunded(bytes32 indexed quoteId, address indexed buyer, address indexed seller, bytes32 fileHash, uint8 licenseType, bytes32 termsHash, uint256 amount, uint256 fee, uint64 durationSeconds, uint64 deliveryDeadline);
    event EscrowDelivered(bytes32 indexed quoteId, uint64 reviewDeadline);
    event EscrowDisputed(bytes32 indexed quoteId, uint64 disputeDeadline);
    event EscrowReleased(bytes32 indexed quoteId, uint64 releasedAt);
    event EscrowRefunded(bytes32 indexed quoteId, address indexed buyer, uint256 amount);
    event RefundWithdrawn(address indexed buyer, uint256 amount);
    event DisputeResolved(bytes32 indexed quoteId, bool refunded);
    error InvalidQuote();
    error InvalidPayment();
    error AlreadyLicensed();
    error NothingToWithdraw();
    error WithdrawalFailed();
    error InvalidShares();
    event LicensePurchased(bytes32 indexed quoteId, address indexed buyer, address indexed seller, bytes32 fileHash, uint8 licenseType, bytes32 termsHash, uint256 amount, uint256 fee, uint64 purchasedAt);
    event ProceedsWithdrawn(address indexed recipient, uint256 amount);
    event RevenueAllocated(bytes32 indexed quoteId, address indexed recipient, uint256 amount, uint16 shareBps);

    constructor(address registryAddress, address signer, address feeRecipient, address previous) EIP712("ArtGuardLicenses", "4") {
        require(signer != address(0) && feeRecipient != address(0), "Invalid address");
        arbiter = signer;
        registry = IArtworkRegistry(registryAddress);
        instanceId = registry.instanceId();
        quoteSigner = signer;
        treasury = feeRecipient;
        previousMarketplace = IPreviousMarketplace(previous);
    }
    function hasLicense(address buyer, bytes32 fileHash, uint8 licenseType) public view returns (bool) {
        return validUntil[keccak256(abi.encode(buyer, fileHash, licenseType))] > block.timestamp ||
            (address(previousMarketplace) != address(0) && previousMarketplace.hasLicense(buyer, fileHash, licenseType));
    }
    function licenseExpiry(address buyer, bytes32 fileHash, uint8 licenseType) external view returns (uint64) {
        if (address(previousMarketplace) != address(0) && previousMarketplace.hasLicense(buyer, fileHash, licenseType)) return previousMarketplace.licenseExpiry(buyer, fileHash, licenseType);
        return validUntil[keccak256(abi.encode(buyer, fileHash, licenseType))];
    }
    event LicenseValidity(bytes32 indexed quoteId, uint64 validFrom, uint64 validUntil);
    function buyLicenses(Quote[] calldata quotes, bytes[] calldata signatures) external payable nonReentrant {
        if (quotes.length == 0 || quotes.length > 50 || signatures.length != quotes.length) revert InvalidQuote();
        uint256 total;
        for (uint256 i; i < quotes.length; ++i) {
            Quote calldata q = quotes[i];
            if ((q.durationSeconds != 0 && q.durationSeconds != 30 days && q.durationSeconds != 90 days && q.durationSeconds != 365 days) || q.buyer != msg.sender || q.buyer == q.seller || q.seller == address(0) || q.id == bytes32(0) || q.termsHash == bytes32(0) || q.amount == 0 || q.feeBps > 1000 || q.licenseType < 1 || q.licenseType > 3 || q.expiresAt < block.timestamp || q.instanceId != instanceId || usedQuotes[q.id]) revert InvalidQuote();
            (address registeredOwner,,) = registry.records(q.fileHash);
            if (registeredOwner != q.seller) revert InvalidQuote();
            if (ECDSA.recover(_hashTypedDataV4(keccak256(abi.encode(QUOTE_TYPEHASH, q.id, q.buyer, q.seller, q.fileHash, q.licenseType, q.termsHash, q.amount, q.feeBps, q.expiresAt, q.instanceId, keccak256(abi.encodePacked(q.recipients)), keccak256(abi.encodePacked(q.shares)), q.durationSeconds))), signatures[i]) != quoteSigner) revert InvalidQuote();
            bytes32 key = keccak256(abi.encode(q.buyer, q.fileHash, q.licenseType));
            if (hasLicense(q.buyer, q.fileHash, q.licenseType) || pendingLicenses[key] != bytes32(0)) revert AlreadyLicensed();
            if (q.recipients.length != q.shares.length || q.recipients.length > 10) revert InvalidShares();
            uint16 totalShares;
            for (uint256 j; j < q.recipients.length; ++j) {
                if (q.recipients[j] == address(0) || q.recipients[j] == q.seller || q.shares[j] == 0) revert InvalidShares();
                for (uint256 k; k < j; ++k) if (q.recipients[k] == q.recipients[j]) revert InvalidShares();
                totalShares += q.shares[j];
            }
            if (totalShares > 9900) revert InvalidShares();
            usedQuotes[q.id] = true;
            pendingLicenses[key] = q.id;
            uint256 fee = q.amount * q.feeBps / 10000;
            uint64 deadline = uint64(block.timestamp) + deliveryPeriod;
            escrows[q.id] = Escrow(q.buyer, q.seller, q.fileHash, q.licenseType, q.amount, fee, q.durationSeconds, 1, deadline, 0, 0);
            offers[q.id] = q;
            emit EscrowFunded(q.id, q.buyer, q.seller, q.fileHash, q.licenseType, q.termsHash, q.amount, fee, q.durationSeconds, deadline);
            total += q.amount;
        }
        if (msg.value != total) revert InvalidPayment();
    }

    function getEscrow(bytes32 id) external view returns (Escrow memory) { return escrows[id]; }
    function markDelivered(bytes32 id) external {
        Escrow storage e = escrows[id];
        if (msg.sender != e.seller) revert Unauthorized();
        if (e.state != 1) revert InvalidState();
        if (block.timestamp >= e.deliveryDeadline) revert InvalidState();
        e.state = 2;
        e.reviewDeadline = uint64(block.timestamp) + reviewPeriod;
        emit EscrowDelivered(id, e.reviewDeadline);
    }
    function dispute(bytes32 id) external {
        Escrow storage e = escrows[id];
        if (msg.sender != e.buyer) revert Unauthorized();
        if (e.state != 2 || block.timestamp >= e.reviewDeadline) revert InvalidState();
        e.state = 3;
        e.disputeDeadline = uint64(block.timestamp) + disputePeriod;
        emit EscrowDisputed(id, e.disputeDeadline);
    }
    function release(bytes32 id) external nonReentrant {
        Escrow storage e = escrows[id];
        if (e.state != 2) revert InvalidState();
        if (msg.sender != e.buyer && block.timestamp < e.reviewDeadline) revert TooEarly();
        _release(id);
    }
    function refund(bytes32 id) external nonReentrant {
        Escrow storage e = escrows[id];
        if (e.state != 1 && e.state != 2 && e.state != 3) revert InvalidState();
        bool expired = (e.state == 1 && block.timestamp >= e.deliveryDeadline) || (e.state == 3 && block.timestamp >= e.disputeDeadline);
        if (msg.sender != e.seller && !expired && !hasLicense(e.buyer, e.fileHash, e.licenseType)) revert TooEarly();
        _refund(id);
    }
    function resolveDispute(bytes32 id, bool refundBuyer) external nonReentrant {
        Escrow storage e = escrows[id];
        if (msg.sender != arbiter) revert Unauthorized();
        if (e.state != 3 || block.timestamp >= e.disputeDeadline) revert InvalidState();
        if (refundBuyer) _refund(id); else _release(id);
        emit DisputeResolved(id, refundBuyer);
    }
    function _refund(bytes32 id) private {
        Escrow storage e = escrows[id];
        e.state = 5;
        delete pendingLicenses[keccak256(abi.encode(e.buyer, e.fileHash, e.licenseType))];
        refundBalances[e.buyer] += e.amount;
        emit EscrowRefunded(id, e.buyer, e.amount);
    }
    function _release(bytes32 id) private {
        Escrow storage e = escrows[id];
        Quote storage q = offers[id];
        // A previously signed legacy quote can still issue a license. In that case the escrow is refundable.
        if (hasLicense(q.buyer, q.fileHash, q.licenseType)) revert AlreadyLicensed();
        e.state = 4;
        bytes32 key = keccak256(abi.encode(q.buyer, q.fileHash, q.licenseType));
        delete pendingLicenses[key];
        uint64 expiry = q.durationSeconds == 0 ? type(uint64).max : uint64(block.timestamp) + q.durationSeconds;
        validUntil[key] = expiry;
        emit LicenseValidity(id, uint64(block.timestamp), expiry);
        uint256 fee = e.fee;
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

        emit LicensePurchased(id, q.buyer, q.seller, q.fileHash, q.licenseType, q.termsHash, q.amount, fee, uint64(block.timestamp));
        emit EscrowReleased(id, uint64(block.timestamp));
    }
    function withdrawRefund() external nonReentrant {
        uint256 amount = refundBalances[msg.sender];
        if (amount == 0) revert NothingToWithdraw();
        refundBalances[msg.sender] = 0;
        (bool success,) = payable(msg.sender).call{value: amount}("");
        if (!success) revert WithdrawalFailed();
        emit RefundWithdrawn(msg.sender, amount);
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
