Educational project for the course Introduction to Finance. Not a real product, service or investment offer. Do not use with real funds.

# ArtGuard

[![Prototype checks](https://github.com/ONI-COLLI/Artguard/actions/workflows/ci.yml/badge.svg)](https://github.com/ONI-COLLI/Artguard/actions/workflows/ci.yml)

ArtGuard is Team 03's local digital-art licensing prototype. Creators register a
file fingerprint, buyers fund an escrow order, and acceptance activates a
wallet-bound licence and allocates proceeds to the creator, co-authors and service.
All demonstration accounts, balances and transactions use fictional data and
local test ETH.

**Repository:** <https://github.com/ONI-COLLI/Artguard>

## Course deliverables

| Item                                     | Link or status                                                                                                                                                                                                                       |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Report                                   | [Team03_FP_Report.pdf](deliverables/final-project/Team03_FP_Report.pdf): 15 main-text pages; title, contents, references and appendices are separate                                                                                 |
| Presentation                             | [PDF for Moodle](deliverables/final-project/Team03_FP_Presentation.pdf) · [Editable PowerPoint](deliverables/final-project/Team03_FP_Presentation.pptx)                                                                              |
| Defence speech                           | [English speaker text](deliverables/final-project/Team03_FP_Speech.pdf), with financial figures from the same unpaid-founder model                                                                                                   |
| Demo video                               | [Download Team03_FP_Demo.mp4](deliverables/three-minute/Team03_FP_Demo.mp4): exactly 3:00 with English on-screen explanations                                                                                                        |
| Required university OneDrive sharing URL | **Pending upload by the team.** The GitHub MP4 is a convenient copy, not the required institutional sharing URL.                                                                                                                     |
| Video evidence                           | [Saved run and test scope](deliverables/three-minute/Team03_FP_Demo_evidence.json) · [Media validation](deliverables/three-minute/Team03_FP_Demo_validation.json) · [English captions](deliverables/three-minute/Team03_FP_Demo.srt) |
| Submission checklist                     | [Remaining access, contribution and self-evaluation requirements](docs/FINAL_SUBMISSION.md)                                                                                                                                          |

The video shows actual local contract deployment, escrow deposit, seller delivery,
buyer acceptance, an active licence, a co-author withdrawal, direct chain checks,
and test execution. That recorded run passed **21 selected application tests and
10 EVM escrow tests**. It is separate from later complete test runs and CI.
Seven labelled reading pauses explain the recorded evidence; they do not replace
transaction results or imply additional test execution.

Upload the MP4 through the university OneDrive account, share with **People in
Astana IT University**, set **Can view**, and leave expiry unset. If the audience
option is unavailable, use **People you choose** with the instructor address in
the assignment. Add the same real sharing URL here, on the report title and on
the presentation title. Keep the file and link available until final grades.

## Requirements

- Node.js **22.13 or newer**; the local review used Node 22.22.2.
- npm and Git. Install dependencies with `npm ci` using the committed lockfile.
- Anvil is installed through the platform-specific optional npm dependency. Keep
  optional dependencies enabled; no global Foundry installation is required.
- A browser. Prepared test wallets work without MetaMask. Never connect a wallet
  containing real assets.

No OAuth client credentials, paid services, public testnet or real assets are
needed for the core demonstration. `.env.example` documents optional OAuth
configuration; copy it to `.env` only if required and keep secrets out of Git.

## Quick start for the actual local demonstration

```powershell
git clone https://github.com/ONI-COLLI/Artguard.git
cd Artguard
npm ci
npm run build
npm run demo:defense
```

Open **http://127.0.0.1:3600/#/defense** and choose **Start real demonstration**.
This starts fixed deployment and test commands and drives the actual React
checkout and wallet pages. The stand uses an isolated `runtime/defense-*` data
directory, app port **3600**, Anvil RPC port **8665**, and chain ID **31337**.
It preserves existing private/public site data. Technical proof is available
without signing in. Prepared fictional personas handle the role-specific pages.

After completion, **Review this verified run** opens deployment, purchase,
licence, creator/co-author wallet, EVM proof and test-result views without
repeating the purchase. If a port is already occupied, review the existing stand
or deliberately stop that stand. Do not reset a network or kill an unknown process.

The illustrated `/#/presentation` walkthrough sends no transactions. Use
`/#/defense`, the actual account workflows, or the recorded MP4 to demonstrate
execution. On PowerShell systems that block the npm wrapper, use `npm.cmd`.

## Regular site and development

For the built application, use separate terminals:

```powershell
# Terminal 1: local blockchain and contract deployment
npm run chain
```

```powershell
# Terminal 2: create fictional demo accounts/wallets, then start the app
npm run demo:setup
npm start
```

Open **http://localhost:3000/#/demo**. Buyer, creator and co-author can use
separate tabs with independent sessions. One regular account can both buy and
publish; those personas are not separate permission classes. Manager handles
finance and disputes; administrator handles technical site controls.

For development, keep the chain running and use `npm run dev`. Vite serves
**http://localhost:5173** and proxies to the API on port **3000**. See the
[architecture and transaction guide](docs/PUBLIC_REVIEW.md) for detailed
upload, registration, checkout, dispute, refund and withdrawal flows.

## Tests and reproducibility

The tests create their own temporary accounts, servers and local chains. They do
not need real credentials or payments. Run these after `npm ci`:

```powershell
npm run build
npm run test:unit -- --maxWorkers=2
npm run test:api
npm run test:blockchain
npm run test:finance-model
node --import tsx --test tests/deployment.test.ts
```

`npm test` runs the complete configured sequence, including a build in the
deployment checks. For the core contract scenario alone, run
**`npm run test:defense:contracts`**. Its ten EVM cases cover quote validation,
exact commissions and shares, delivery/review timeouts, disputes, refunds,
withdrawals, persistence and reconciliation. They exceed the five-test course
minimum. No measured code-coverage percentage or external security audit is claimed.

[GitHub Actions](https://github.com/ONI-COLLI/Artguard/actions/workflows/ci.yml)
performs a clean install, build and the configured test suites. Its badge and
logs show the result of that particular revision. The saved video describes its
own historical test run. Do not treat an old receipt or local test count as proof
that a new CI run passed.

## Stack and contract responsibilities

| Layer       | Implementation                                                       | Responsibility                                                                            |
| ----------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Client      | React 19, TypeScript, Vite, React Router, TanStack Query, wagmi/viem | Project forms, catalogue, licence checkout, wallet and feedback                           |
| Server      | Node.js, Express 5, SQLite, Zod                                      | Accounts, per-tab sessions, files, signed quotes, access checks and accounting copies     |
| Local chain | Anvil EVM, chain 31337, Solidity, OpenZeppelin                       | Fingerprints, escrow conditions, wallet licence validity, revenue credits and withdrawals |

- [`ArtworkRegistry.sol`](contracts/ArtworkRegistry.sol) records file/terms hashes,
  the registering wallet and time. Original files and account profiles stay off-chain.
- [`EscrowLicenseMarketplace.sol`](contracts/EscrowLicenseMarketplace.sol) is the
  core v4 purchase contract. It validates the EIP-712 quote, holds deposits,
  enforces settlement conditions and records licence validity and recipient credits.
- Subscription, promotion and older licence contracts support additional features;
  new licence purchases use v4 escrow. Existing earlier records remain readable.

The seller has **72 hours** to confirm delivery, followed by **24 hours** for
buyer acceptance or dispute. A trusted platform arbiter resolves disputes; after
**7 unresolved days**, a refund becomes available. A timer permits an action;
someone must still submit a transaction. A deposit issues no active licence or
earned sales commission. Release activates the licence and allocates revenue;
withdrawal is a separate transaction.

Creator plans are Free **$0 / 10%**, Premium **$10 / 5%**, and Business **$50 / 0%**
per month. Co-author shares apply after commission. For a Free-plan payment of
**0.012 test ETH** with a 75/25 net split, the contract credits **0.0012** to the
platform, **0.0081** to the creator and **0.0027** to the co-author. Gas is separate.

## Technical walkthrough with source code

Open **`/#/blockchain-demo`**, without signing in. The normal site page has four
blocks across the top: startup, wallet/file, escrow/license and payouts/proof.
The selected block shows source code and output together. Code has syntax
highlighting, filenames, directories and original line numbers, without IDE chrome
or a fullscreen overlay. Code and output scroll inside their panels so the page
fits the viewport. Use the top tabs or arrow keys to change blocks.
`?block=1` through `?block=4` opens a specific block. Select **RU** for Russian.
Terminal and HTTP/RPC examples use placeholders and are explicitly labelled;
the separate live node result reads the actual running network.

The storage map distinguishes SQLite rows, original files, Anvil contract storage
and signing-key locations, and explains generated TXT license records. It documents paths and
formats without displaying runtime database contents or private keys. The
diagrams explain the implementation and do not connect a wallet,
sign or send a transaction. The separate live verification panel reads RPC.

## Verify a blockchain purchase

Open **`/#/blockchain-demo?block=4`** and use **Live node result** in the terminal. Paste the
**deposit** hash, or leave it empty for the latest deposit. Verification reads
Anvil JSON-RPC: successful receipt, canonical block, deployed code, decoded input,
events, escrow state, licence validity and revenue allocations. Deposit, release
and withdrawal are distinct transactions. Earlier direct-payment proofs are in
`/#/blockchain-demo?legacy=1` verifier. Failed checks stay failed and are not
replaced with the expected output examples. Technical admin tools remain
role-gated on `/#/blockchain-demo?tools=1`.

The saved recording's [canonical receipts](deliverables/three-minute/canonical-receipts.json)
and [on-chain proof](deliverables/three-minute/on-chain-proof.json) identify its
original network run. A new local deployment has different history. Historical
hashes are not expected to exist on a fresh node.

## Boundaries and security

The local operator controls Anvil. Built-in test wallets are custodial and use a
restricted server signer. The quote signer and dispute arbiter are trusted;
multisig, emergency pause and signer rotation are not implemented in v4. The
contract uses signature/replay checks, address/state checks, pull payments and
OpenZeppelin reentrancy protection.

A matching SHA-256 identifies exact bytes and a registration claim; it does not
independently prove copyright ownership or detect visually similar copies. A
licence is a wallet-bound contract record, not an NFT. Expiry can stop new access
through ArtGuard but cannot recall an already downloaded copy. The report
separates these limitations from future public-network and commercial proposals.

Only fictional data and tool-created test wallets are used. Keys, seeds, `.env`,
SQLite databases, uploads, node state and dependency folders must stay out of the
repository. Runtime directories are ignored. Source code and synthetic fixtures
are sufficient to reproduce the prototype. Public hosting is optional and does
not replace the required GitHub repository or institutional video link.

## Financial model, AI and team contribution

`npm run finance:model` reproduces the educational three-year forecast;
`npm run test:finance-model` checks its calculations. The frozen **447.94 KZT/USD**
planning rate is separate from live UI conversions. Test ETH and locked customer
escrow funds are not real revenue or startup capital. The Endterm's unpaid founder
development is preserved: cash payroll is zero, with no employee hiring assumed.
The correction of 9 November removes the previously added salaries; other forecast
inputs remain unchanged. Three-year cash NPV is KZT 24.97m, cumulative cash recovery
is Month 19 and peak cash need is KZT 7.52m. These are conditional estimates that
exclude founder opportunity cost, not proven demand or guaranteed returns.
See the report and [model snapshot](submission/financial-model.json).

AI assistance: **Codex, GPT-6.1 Sol**, including code, tests, demonstration tooling,
captions, report editing and financial-model work. See [AI Disclosure](docs/AI_DISCLOSURE.md).
Every member must review and explain the design, calculations, conclusions and
code and document actual work in their own self-evaluation.

See [Contributing](CONTRIBUTING.md) for individual branches, commits and review.
Publishing this repository does not establish that all four students have already
contributed commits. Do not fabricate author names, dates or percentages of work.

## Licence and third-party attribution

Project source is under the [MIT licence](LICENSE). OpenZeppelin Contracts supplies
EIP712, ECDSA and ReentrancyGuard. Its MIT notice is retained in
[`third-party/OpenZeppelin-MIT.txt`](third-party/OpenZeppelin-MIT.txt).
Other packages retain their own licences; see [third-party notices](THIRD_PARTY_NOTICES.md).
The university logo appears only on the report title and presentation title and
is not part of the product's MIT licence.
