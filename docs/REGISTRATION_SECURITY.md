# Registration contract verification and threat analysis

## Changes for the Final Project

- Added five automated contract tests to verify registration and duplicate protection on a local Anvil network.
- Analysed three threats and documented the controls and remaining limitations of each.

These points cover the registration and security work. They can be included in
the opening change list of the Final Project report.

## Registration contract and test evidence

[`ArtworkRegistry.sol`](../contracts/ArtworkRegistry.sol) stores a file
fingerprint, the fingerprint of a licensing-terms snapshot, the calling wallet
and the block timestamp. It emits the same fields in `ArtworkRegistered`. The
registry records a wallet's claim about a specific file. Establishing authorship,
rights to the content and the identity of the person behind the wallet requires
evidence outside the registry.

```sh
npm run test:registration
```

The [test suite](../tests/artwork-registry.test.ts) compiles the Solidity
contract, starts its own loopback Anvil node (chain ID 31337), and deploys a
fresh registry for each case. Successful registrations are mined and inspected
through RPC. Rejection tests assert the named Solidity error in the local EVM
and read the registry to check that its state was preserved.

| Test                       | Assertion                                                                                                                                                      |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Successful registration | The registry stores the calling wallet, the terms hash and the mined block timestamp. The emitted event matches those fields and the submitted file hash.      |
| 2. Zero file hash          | The call reverts with `InvalidHash`. No registry entry appears at the zero key.                                                                                |
| 3. Zero terms hash         | The call reverts with `InvalidHash`. The file stays unregistered.                                                                                              |
| 4. Repeat registration     | The call reverts with `AlreadyRegistered`. The original registrant, terms hash and timestamp remain in storage.                                                |
| 5. Independent records     | Two wallets register distinct file hashes using the same terms hash. Each file retains its own registrant and the second registration leaves the first intact. |

## Three security threats

### 1. Someone without the rights registers a file first

**Impact.** A misleading provenance claim can be recorded. The first entry for
that exact fingerprint can also prevent the rightful author from registering
the same bytes in this registry.

**Existing controls.** The contract records the caller as the registrant and
rejects any later attempt to overwrite the same fingerprint. ArtGuard's
registration flow requires ownership of the uploaded project within ArtGuard
and a linked wallet. Tests 1, 4 and 5 cover the contract's storage protections.
The [server integration tests](../tests/blockchain.test.ts) cover the conditions
for preparing and confirming a registration through ArtGuard.

**Remaining risk.** An account's ownership of a project in ArtGuard establishes
control of the listing. The contract itself accepts a claim from any wallet.
Rights disputes still require off-chain evidence such as original project
files, contracts or publication records. Any proposed first-publication or
creator-verification control must be evaluated separately from the current
wallet-based fingerprint record.

### 2. A listing's file or licensing terms change after registration

**Impact.** A buyer could mistake an older on-chain record for proof of the
file or terms currently displayed. A material terms change could alter what
the buyer believes they are licensed to do.

**Existing controls.** ArtGuard computes SHA-256 over the original uploaded file
bytes and separately hashes the saved terms snapshot. The
[registration status endpoint](../server/blockchain.routes.ts) compares the
stored registrant and terms fingerprint with the current registry and reports a
terms change when the current listing differs from the registration snapshot.
Test 4 verifies the original record cannot be overwritten. Tests 2 and 3
verify that empty fingerprints cannot be recorded as evidence.

**Remaining risk.** Proof of a particular file requires hashing the file
actually presented and comparing it with the record. The blockchain does not
monitor storage. Even an innocuous re-export may produce different bytes, so
the check is for the exact file, with the registered terms snapshot clearly
identified.

### 3. A transaction ID is submitted as proof for an unrelated registration

**Impact.** Accepting a transaction ID without checking its contents could
mark a different project, wallet or set of terms as verified.

**Existing controls.** The server binds the prepared registration to the
authenticated account and the current deployment. It requires a successful
receipt from the expected registry and submitting wallet and checks that the
registry's event matches the expected file fingerprint, terms fingerprint and
registrant. Test 1 checks what the real contract emits. The existing
[registration API integration tests](../tests/blockchain.test.ts) separately
check that a successful unrelated transaction does not confirm the registration.

**Remaining risk.** The evidence is specific to the Anvil instance that was
queried. For local demonstrations the operator controls that network and its
stored state. Anyone relying on a receipt should identify the network and
contract used for the verification.
