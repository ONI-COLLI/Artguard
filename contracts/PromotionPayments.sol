// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract PromotionPayments is EIP712, ReentrancyGuard {
    struct Quote {bytes32 id; bytes32 projectId; address buyer; uint256 amount; uint64 expiresAt; uint64 expectedUntil; bytes32 instanceId;}
    bytes32 constant TYPEHASH=keccak256("Quote(bytes32 id,bytes32 projectId,address buyer,uint256 amount,uint64 expiresAt,uint64 expectedUntil,bytes32 instanceId)");
    bytes32 public immutable instanceId;
    address public immutable quoteSigner;
    address public immutable treasury;
    mapping(bytes32=>uint64) public promotedUntil;
    mapping(bytes32=>bool) public usedQuotes;
    mapping(address=>uint256) public balances;
    error InvalidQuote(); error InvalidPayment(); error NothingToWithdraw();
    event PromotionPurchased(bytes32 indexed quoteId,bytes32 indexed projectId,address indexed buyer,uint256 amount,uint64 startsAt,uint64 validUntil);
    constructor(bytes32 instance,address signer,address recipient) EIP712("ArtGuardPromotions","1") {
        require(instance!=bytes32(0) && signer!=address(0) && recipient!=address(0));
        instanceId=instance;quoteSigner=signer;treasury=recipient;
    }
    function purchase(Quote calldata q,bytes calldata signature) external payable nonReentrant {
        if(q.buyer!=msg.sender || q.id==bytes32(0) || q.projectId==bytes32(0) || q.instanceId!=instanceId || q.expiresAt<block.timestamp || usedQuotes[q.id] || promotedUntil[q.projectId]!=q.expectedUntil) revert InvalidQuote();
        if(ECDSA.recover(_hashTypedDataV4(keccak256(abi.encode(TYPEHASH,q))),signature)!=quoteSigner) revert InvalidQuote();
        if(q.amount!=0.005 ether || msg.value!=q.amount) revert InvalidPayment();
        usedQuotes[q.id]=true;
        uint64 start=q.expectedUntil>block.timestamp ? q.expectedUntil : uint64(block.timestamp);
        uint64 until=start+7 days;
        promotedUntil[q.projectId]=until;balances[treasury]+=msg.value;
        emit PromotionPurchased(q.id,q.projectId,msg.sender,q.amount,start,until);
    }
    function withdraw() external nonReentrant {
        uint256 amount=balances[msg.sender];if(amount==0) revert NothingToWithdraw();balances[msg.sender]=0;
        (bool ok,)=payable(msg.sender).call{value:amount}("");require(ok,"Withdrawal failed");
    }
}
