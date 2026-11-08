// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
contract SubscriptionPayments is EIP712, ReentrancyGuard {
    struct Quote {bytes32 id; bytes32 accountId; address buyer; uint8 plan; uint256 amount; uint64 expiresAt; uint64 expectedUntil; bytes32 instanceId;}
    struct Subscription {uint8 plan; uint64 validUntil;}
    bytes32 constant TYPEHASH=keccak256("Quote(bytes32 id,bytes32 accountId,address buyer,uint8 plan,uint256 amount,uint64 expiresAt,uint64 expectedUntil,bytes32 instanceId)");
    bytes32 public immutable instanceId;
    address public immutable quoteSigner;
    address public immutable treasury;
    mapping(bytes32=>Subscription) public subscriptions;
    mapping(bytes32=>bool) public usedQuotes;
    mapping(address=>uint256) public balances;
    error InvalidQuote(); error InvalidPayment(); error ActivePlan(); error NothingToWithdraw();
    event SubscriptionPurchased(bytes32 indexed quoteId,bytes32 indexed accountId,address indexed buyer,uint8 plan,uint256 amount,uint64 validUntil);
    constructor(bytes32 instance,address signer,address recipient) EIP712("ArtGuardSubscriptions","1") {
        require(instance!=bytes32(0) && signer!=address(0) && recipient!=address(0));instanceId=instance;quoteSigner=signer;treasury=recipient;
    }
    function purchase(Quote calldata q,bytes calldata signature) external payable nonReentrant {
        if(q.buyer!=msg.sender || q.id==bytes32(0) || q.accountId==bytes32(0) || q.instanceId!=instanceId || q.expiresAt<block.timestamp || usedQuotes[q.id] || q.plan<1 || q.plan>2) revert InvalidQuote();
        if(ECDSA.recover(_hashTypedDataV4(keccak256(abi.encode(TYPEHASH,q))),signature)!=quoteSigner) revert InvalidQuote();
        uint256 price=q.plan==1 ? 0.01 ether : 0.05 ether;
        if(q.amount!=price || msg.value!=price) revert InvalidPayment();
        Subscription storage s=subscriptions[q.accountId];
        if(s.validUntil!=q.expectedUntil) revert InvalidQuote();
        if(s.validUntil>block.timestamp && s.plan!=q.plan) revert ActivePlan();
        usedQuotes[q.id]=true;
        uint64 start=s.validUntil>block.timestamp ? s.validUntil : uint64(block.timestamp);
        s.plan=q.plan;s.validUntil=start+30 days;balances[treasury]+=msg.value;
        emit SubscriptionPurchased(q.id,q.accountId,msg.sender,q.plan,q.amount,s.validUntil);
    }
    function withdraw() external nonReentrant {
        uint256 amount=balances[msg.sender];if(amount==0) revert NothingToWithdraw();balances[msg.sender]=0;
        (bool ok,)=payable(msg.sender).call{value:amount}("");require(ok,"Withdrawal failed");
    }
}
