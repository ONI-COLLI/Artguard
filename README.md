Educational project for the course Introduction to Finance. Not a real product, service or investment offer. Do not use with real funds.

# ArtGuard

[![Prototype checks](https://github.com/ONI-COLLI/Artguard/actions/workflows/ci.yml/badge.svg)](https://github.com/ONI-COLLI/Artguard/actions/workflows/ci.yml)

ArtGuard is Team 03's local digital-art licensing prototype. Creators register a
file fingerprint, buyers fund an escrow order, and acceptance activates a
wallet-bound licence and allocates proceeds to the creator, co-authors and service.
All demonstration accounts, balances and transactions use fictional data and
local test ETH.

**Repository:** <https://github.com/ONI-COLLI/Artguard>

**Running it for the first time?** See [Local setup](#local-setup) for everything
from installing Node.js to opening the demo accounts.

**Verifying the smart contract?** Use [the five registration unit tests](#five-registration-unit-tests).

## Course deliverables

| Item                                     | Link or status                                                                                                                                                                                                                       |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Report                                   | [Team03_FP_Report.pdf](deliverables/final-project/Team03_FP_Report.pdf): 15 main-text pages; title, contents, references and appendices are separate                                                                                 |
| Presentation                             | [Current PDF for Moodle](deliverables/final-project/Team03_FP_Presentation.pdf) · [Earlier PowerPoint draft](deliverables/final-project/Team03_FP_Presentation.pptx) |
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

## Local setup

### 1. Install the tools and download the project

Install [Node.js 22 LTS](https://nodejs.org/en/download) and
[Git](https://git-scm.com/downloads/). Use **Node.js 22.22.2 or a newer 22.x
release** to match the locked dependencies and GitHub Actions. npm comes with
Node.js. VS Code is optional.

Open a new terminal after installation. On Windows, run these commands in
PowerShell or in **Terminal → New Terminal** in VS Code:

```powershell
node --version
npm --version
git --version
git clone https://github.com/ONI-COLLI/Artguard.git
cd Artguard
npm ci --include=optional --include=dev
```

If you already have a Git checkout, open its folder and run `git pull --ff-only`
before installing. You can also use **Code → Download ZIP** on GitHub, extract it,
and open the folder containing `package.json`. In that case, start with `npm ci`.

`npm ci` installs the versions from `package-lock.json`, including the
platform-specific Anvil binary. There is no separate installation for React,
Express, SQLite or Foundry on a supported platform. The standard local demo
runs with the built-in test wallets, without MetaMask or an `.env` file.

### 2. Start the blockchain and site

Open two terminals in the **same project folder**. In the first, start Anvil
and deploy the contracts. Leave this terminal open:

```powershell
npm run chain
```

Wait for the deployment messages through **Promotion payments**. The default
RPC address is `http://127.0.0.1:8545` and the chain ID is **31337**.

In the second terminal, prepare the fictional accounts and wallets, then build
and start the application:

```powershell
npm run demo:setup
npm run build
npm start
```

When the API prints its URL, open [ArtGuard](http://localhost:3000/#/home).
Use the **Guest workspace** menu in the header to switch test profiles in the
same tab, or open [Demo studio](http://localhost:3000/#/demo) to give each role
its own tab. Creator, Buyer and Co-author cover an escrow purchase. Manager
handles reporting and disputes, and Administrator manages site settings.
Use the [blockchain walkthrough](http://localhost:3000/#/blockchain-demo)
to inspect deployments and verify an escrow payment.

Stop the site and Anvil with **Ctrl+C** in their respective terminals. On later
runs, start the chain and site again. Run the setup command on a new data
directory and rebuild the client after changes to the source.

### 3. Development and troubleshooting

For live editing, keep Anvil running and use `npm run dev` in the second
terminal instead of `npm start`. Open [Vite](http://localhost:5173). It proxies
requests to the API on port **3000**.

| Symptom | What to do |
| --- | --- |
| `node`, `npm` or `git` is not recognized | Check installation and open a new terminal. Run the three version checks above. |
| PowerShell blocks `npm.ps1` | Use `npm.cmd` in the same commands, for example `npm.cmd ci --include=optional --include=dev`, or use Command Prompt. |
| `Cannot find module` or Anvil binary missing | In the folder with `package.json`, run `npm ci --include=optional --include=dev` again and read the first install error. The lockfile supplies Anvil for Windows x64 and Linux/macOS x64 or ARM64. |
| `.env not found. Continuing without it.` | Expected for the default local demo. Optional OAuth configuration is listed in `.env.example`. |
| Port 8545 is in use | If the project's Anvil is already running, use that instance. Otherwise stop the specific service that owns the port before starting the chain. |
| Port 3000 is in use | Check whether ArtGuard is already at `http://localhost:3000/api/health`. Reuse its server or stop the old ArtGuard process before starting another one. |
| The API is up but the interface is missing | Run `npm run build` in the project folder, then reload the page at port 3000. |
| Demo profiles show `Unavailable` | Check that Anvil finished deploying all contracts and run `npm run demo:setup` in the second terminal. |

Local accounts, uploads and chain state live under `data/`. Keep that directory
when restarting the demo or updating the checkout.

## Guided defence demonstration

After installing the dependencies, run:

```powershell
npm run build
npm run demo:defense
```

Open [the live defence demo](http://127.0.0.1:3600/#/defense) and choose
**Start real demonstration**. It uses its own `runtime/defense-*` data directory,
app port **3600** and Anvil port **8665**. **Review this verified run** opens the
evidence from a completed run. The illustrated [walkthrough](http://localhost:3000/#/presentation)
shows the same steps and uses no live payments. See the
[architecture and transaction guide](docs/PUBLIC_REVIEW.md) for the full flow.

### Local ERC-20 and ERC-721 lab

On the running local site, use **Demo Administrator** and open the
[token lab](http://localhost:3000/#/admin/blockchain-demo?view=token).
Choose **Issue both test tokens** to release a sample escrow order, issue 100 AGP
(ERC-20) and claim a non-transferable licence receipt (ERC-721). The lab reads the
balance, NFT owner and mint events from Anvil, then shows the contract addresses,
token ID, block numbers and transaction hashes.

For the same run from the repository root:

```powershell
npm run demo:tokens
```

Each run starts and stops its own temporary Anvil node. ArtGuard checkout uses
native test ETH. See [the ERC-20 contract](contracts/PrototypePoints.sol),
[the ERC-721 contract](contracts/PrototypeLicenseReceipt.sol) and
[the verification script](scripts/token-demo.mjs).

## Tests and reproducibility

### Five registration unit tests

From the repository root, install the locked dependencies and run the test command.

```powershell
npm ci --include=optional --include=dev
npm run test:registration
```

[`tests/artwork-registry.test.ts`](tests/artwork-registry.test.ts) starts its own
temporary local Anvil node and deploys `ArtworkRegistry` for each test.

1. Registers the file and emits matching evidence
2. Rejects a zero file hash
3. Rejects a zero licence terms hash
4. Rejects duplicate registration and preserves the original record
5. Keeps records from two wallets separate

A successful run ends with `# tests 5`, `# pass 5` and `# fail 0`. See the
[registration test matrix and three security threats](docs/REGISTRATION_SECURITY.md).

### Full prototype checks

The suites use temporary data and test accounts. Run `npm test` for the complete
local sequence, or run the build and suites individually.

```powershell
npm run build
npm run test:registration
npm run test:unit -- --maxWorkers=2
npm run test:api
npm run test:blockchain
npm run test:finance-model
node --import tsx --test tests/deployment.test.ts
```

For the core escrow scenario alone, run
**`npm run test:defense:contracts`**. Its ten EVM cases cover quote validation,
exact commissions and shares, delivery/review timeouts, disputes, refunds,
withdrawals, persistence and reconciliation. They exceed the five-test course
minimum. No measured code-coverage percentage or external security audit is claimed.

The guided defence demonstration is backed by five unit-test files, run together
by **`npm run test:defense:unit`**: `tests/demo-session.test.tsx` (per-tab demo
profiles), `tests/blockchain-checkout.test.tsx` (chain checkout flow),
`tests/revenue-sharing.test.tsx` (co-author share editor),
`tests/buyer-license.test.tsx` (licence terms shown to the buyer) and
`tests/escrow-ui.test.tsx` (escrow status and actions).

[GitHub Actions](https://github.com/ONI-COLLI/Artguard/actions/workflows/ci.yml)
performs a clean install, build and the configured test suites. Its badge and
logs show the result of that particular revision. The saved video describes its
own historical test run. Do not treat an old receipt or local test count as proof
that a new CI run passed.

In the current prototype, a prepared but unpaid subscription can block choosing
a different plan until the quote expires. The creator link and the Favorites
page are unfinished.

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
Terminal and HTTP/RPC examples are labelled. The startup panel reads the
six deployed contract addresses and transaction hashes from the running local
network. The payout panel checks the selected escrow transaction live.

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
