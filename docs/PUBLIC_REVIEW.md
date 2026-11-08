# ArtGuard: public full-stack prototype for review

Use `/llms.txt`, `/code`, `/source-manifest.json` and `/downloads/artguard-source.zip` to inspect the actual source. The manifest contains SHA-256 checksums. This test server runs on the owner's computer behind a temporary HTTPS tunnel; it is shared and changes made by visitors are visible to others. Use fictional information and test ETH only.

## Stack and responsibilities

| Layer            | Implementation                                         | Stores or verifies                                                                                                                        |
| ---------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Browser          | React 19, TypeScript, Vite, TanStack Query, wagmi/viem | Forms, gallery, catalog, license checkout, escrow status, wallet and feedback                                                             |
| Server           | Node 22+, Express 5, SQLite, Zod                       | Users, roles, per-tab sessions, project metadata, file access, quotes, synchronization and reports                                        |
| Blockchain       | Anvil EVM, chain 31337, Solidity, OpenZeppelin         | Registry fingerprints, signed quote validation, escrow balances/deadlines, license ownership/periods, revenue allocations and withdrawals |
| Public transport | HTTPS tunnel to loopback Express                       | Public UI, API, sanitized source; not direct access to unrestricted Anvil                                                                 |

Start inspection at `server/app.ts`, `server/auth.ts`, `server/hosting.ts`, `server/public-demo.ts`, `server/demo.routes.ts`, `server/public-rpc.ts`, `server/chain-records.ts`, `server/chain-purchase.routes.ts`, `server/escrow-records.ts`, `contracts/ArtworkRegistry.sol`, `contracts/EscrowLicenseMarketplace.sol` and their tests. Exact filenames and additional modules are listed in the source manifest.

## Accounts and roles

Open `/#/demo` for the three prepared public identities and their wallet addresses. Each browser tab keeps its own session, so buyer, creator and co-author can be demonstrated at the same time. A regular account can both buy and publish: buyer/creator are demonstration personas, not different permission classes. Shared persona names/emails and wallets are fixed to keep the walkthrough usable. Manager handles finance/reporting and escrow disputes; administrator handles technical management. Their credentials are private to the operator. Guests cannot browse the catalog, but can inspect source and the blockchain demonstration.

Alternatively register a fictional account, open Profile > Security > private demo inbox, verify it, then Profile > Wallet > Create funded test wallet. The inbox is authenticated to the current account, not a real external email service or proof of ownership. OAuth buttons require provider configuration and are disabled without credentials. Built-in test wallets are **custodial**: Anvil holds the private keys, and the server restricts which app actions it will sign. Linking an external wallet instead requires a signed SIWE challenge. Do not use these wallets or seeds on a real network.

## From project to fingerprint

1. A signed-in verified author uploads the original file and optional gallery images, description, prices, permitted license period and co-author shares. The original and previews are stored under the isolated server's uploads directory. SQL stores their metadata.
2. The server calculates the SHA-256 fingerprint from the original file bytes. The same bytes always produce the same fingerprint. Changing even one byte normally produces a different value. This identifies content; it does not prove legal authorship or detect visually similar copies.
3. A separate fingerprint identifies the normalized registered terms snapshot. SIWE links the user's wallet; registration is an actual transaction from that wallet to `ArtworkRegistry`.
4. The server checks the receipt, chain/registry instance, contract address, event and expected fingerprints/wallet before recording confirmation. Neither original file nor full SQL profile is stored on-chain. A matching hash shows that these exact bytes/terms match the registered record.

## License purchase and escrow

1. Buyer selects a project and license. The server prepares a time-limited EIP-712 signed quote containing the buyer wallet, project/terms fingerprints, price, fee, recipients/shares and license duration. Co-authors must approve their configured shares where required.
2. The buyer sends test ETH and the quote to the v4 escrow marketplace. The contract checks signer, buyer (`msg.sender`), quote expiry/replay, registration and terms, amount, fee/shares and duration. It holds the deposit. There is no active license or earned commission at this step.
3. The creator checks delivery and confirms it on-chain within 72 hours. The original must still be available and match its fingerprint. The buyer gets a preview/access flow and has 24 hours to accept or dispute.
4. Buyer acceptance releases payment. After the review deadline, an authorized release transaction is possible; the passing of time alone does not move funds. Release activates the license for the buyer wallet and starts its duration, credits the service fee and net author/co-author balances.
5. With the Free plan, fee is 10%; Premium ($10/month) 5%; top plan ($50/month) 0%. For a 0.012 test ETH Free-plan order with 75% author / 25% co-author shares, fee is 0.0012, author credit 0.0081 and co-author credit 0.0027 test ETH. Gas is paid separately. Subscription/promotion prices are prototype test-network prices.
6. Each recipient must withdraw its balance with another real transaction. A credit inside a smart contract and funds transferred to a wallet are separate events. SQL accounting records only confirmed releases; refunds are handled separately.
7. If no delivery occurs by 72 hours, the buyer can request a full refund credit and withdraw it. A dispute stops ordinary release; the manager decides release/refund through the service arbiter transaction. After 7 days unresolved, refund is available. The manager is a trusted arbiter; this is not decentralized arbitration.

Existing v2/v3 purchases remain readable; new escrow checkout uses v4. Older licenses were perpetual. An active license prevents the same wallet from buying it again; expired timed licenses can be purchased again according to the contract. The UI and server enforce original-file access against the confirmed license/escrow state. A license is a contract record bound to the buyer address, not an NFT transferable by default.

## Demonstrate actual transactions without PowerShell

1. Open buyer, creator and co-author from `/#/demo` in separate tabs. Their wallets are pre-funded. The shared project is “Shared Horizons — demo project.” If the shared buyer already has an active license, create a fresh fictional account and hosted wallet.
2. In the buyer tab, choose Personal license and blockchain checkout. Deposit into escrow. Save the deposit transaction hash.
3. In the creator tab, open escrow orders, verify delivery and confirm the on-chain delivery transaction.
4. In the buyer tab, accept delivery. The release transaction creates the license and allocates proceeds. Open Licenses and check/download the license/original file.
5. In the co-author tab, open Wallet and withdraw available earnings. Save that transaction hash.
6. Open `/#/blockchain-demo` without signing in. Use escrow transaction verification and paste the **deposit** hash. It reads actual receipts, logs, block data, current escrow/license state and related withdrawal events from the node, and shows per-check results. It does not rely on an accounting row to claim a blockchain transaction exists.

For agents, GET `/api/blockchain/escrow-proof?transactionHash=0x…` performs the same proof without authentication. POST `/rpc` with JSON-RPC `eth_getTransactionByHash`, `eth_getTransactionReceipt`, `eth_getBlockByNumber`, `eth_getCode` or `eth_call` can independently inspect the transaction and contract. A release/refund hash is not the deposit hash expected by the escrow proof. Regular earlier non-escrow license proofs are a separate route/flow.

“Real transaction” here means a mined, signed state change in this shared local EVM with transaction hash, successful receipt, block and contract logs. It is not Ethereum mainnet, externally decentralized consensus, a public-chain explorer or proof that real currency was paid. The operator controls the node and can stop or reset it. UI currency conversions are reference market equivalents; purchases settle in test ETH. The original file fingerprint does not certify originality, legal rights or honesty of delivery.

## Review checklist

- Build and tests: `npm ci`, `npm run build`, `npm test`. See `docs/PUBLIC_HOSTING.md` for starting the isolated public stack.
- Test roles, guest catalog restriction, account-bound private data, per-tab sessions and failed/invalid form feedback.
- Upload/edit a project, gallery, co-author approval and fingerprint registration. Check that tampered content/terms or unsigned/replayed quotes fail.
- Complete escrow deposit/delivery/release/withdrawal. Also review timeouts, disputes/refunds, duplicate synchronization and restart persistence in `tests/escrow.test.ts`.
- Confirm SQL stores application/accounting data while the contract independently stores on-chain ownership and balances. Do not infer that a SQL record alone proves payment.
- Inspect public RPC restrictions and source-export allowlist. Keys, cookies, SQLite databases, uploads, logs, `.env` and runtime files must never be in the downloadable snapshot.
- Record the source revision, observation time, test network, demo limitations and transaction hashes in the report. This shared mutable prototype is not a production deployment audit.
