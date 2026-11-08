// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
interface ILegacyRegistry {
    function instanceId() external view returns (bytes32);
    function records(bytes32 hash) external view returns (address, bytes32, uint64);
}
/// Version 1 source retained for compatibility and upgrade regression tests. New deployments use version 2.
contract LegacyLicenseMarketplace is EIP712, ReentrancyGuard {
    struct Quote {bytes32 id; address buyer; address seller; bytes32 fileHash; uint8 licenseType; bytes32 termsHash; uint256 amount; uint16 feeBps; uint64 expiresAt; bytes32 instanceId;}
    bytes32 private constant QUOTE_TYPEHASH = keccak256("Quote(bytes32 id,address buyer,address seller,bytes32 fileHash,uint8 licenseType,bytes32 termsHash,uint256 amount,uint16 feeBps,uint64 expiresAt,bytes32 instanceId)");
    ILegacyRegistry public immutable registry;
    address public immutable quoteSigner;
    address public immutable treasury;
    bytes32 public immutable instanceId;
    mapping(bytes32 => bool) public usedQuotes;
    mapping(bytes32 => bool) private ownedLicenses;
    mapping(address => uint256) public balances;
    error InvalidQuote(); error InvalidPayment(); error AlreadyLicensed(); error NothingToWithdraw(); error WithdrawalFailed();
    event LicensePurchased(bytes32 indexed quoteId, address indexed buyer, address indexed seller, bytes32 fileHash, uint8 licenseType, bytes32 termsHash, uint256 amount, uint256 fee, uint64 purchasedAt);
    event ProceedsWithdrawn(address indexed recipient, uint256 amount);
    constructor(address registryAddress, address signer, address feeRecipient) EIP712("ArtGuardLicenses", "1") {
        require(signer != address(0) && feeRecipient != address(0), "Invalid address");
        registry = ILegacyRegistry(registryAddress); instanceId = registry.instanceId(); quoteSigner = signer; treasury = feeRecipient;
    }
    function hasLicense(address buyer, bytes32 fileHash, uint8 licenseType) public view returns (bool) {return ownedLicenses[keccak256(abi.encode(buyer, fileHash, licenseType))];}
    function buyLicenses(Quote[] calldata quotes, bytes[] calldata signatures) external payable nonReentrant {
        if (quotes.length == 0 || quotes.length > 50 || signatures.length != quotes.length) revert InvalidQuote();
        uint256 total;
        for (uint256 i; i < quotes.length; ++i) {
            Quote calldata q = quotes[i];
            if (q.buyer != msg.sender || q.buyer == q.seller || q.seller == address(0) || q.id == bytes32(0) || q.termsHash == bytes32(0) || q.amount == 0 || q.feeBps > 1000 || q.licenseType < 1 || q.licenseType > 3 || q.expiresAt < block.timestamp || q.instanceId != instanceId || usedQuotes[q.id]) revert InvalidQuote();
            (address owner,,) = registry.records(q.fileHash); if (owner != q.seller) revert InvalidQuote();
            if (ECDSA.recover(_hashTypedDataV4(keccak256(abi.encode(QUOTE_TYPEHASH, q))), signatures[i]) != quoteSigner) revert InvalidQuote();
            bytes32 key = keccak256(abi.encode(q.buyer, q.fileHash, q.licenseType)); if (ownedLicenses[key]) revert AlreadyLicensed();
            usedQuotes[q.id] = true; ownedLicenses[key] = true;
            uint256 fee = q.amount * q.feeBps / 10000; balances[q.seller] += q.amount-fee; balances[treasury] += fee; total += q.amount;
            emit LicensePurchased(q.id,q.buyer,q.seller,q.fileHash,q.licenseType,q.termsHash,q.amount,fee,uint64(block.timestamp));
        }
        if (msg.value != total) revert InvalidPayment();
    }
    function withdraw() external nonReentrant {
        uint256 amount=balances[msg.sender]; if (amount==0) revert NothingToWithdraw(); balances[msg.sender]=0;
        (bool success,)=payable(msg.sender).call{value:amount}(""); if (!success) revert WithdrawalFailed(); emit ProceedsWithdrawn(msg.sender,amount);
    }
}
