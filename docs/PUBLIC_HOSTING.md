# Public server on this computer

This is the complete Node/SQLite/Anvil application behind an outbound Cloudflare Quick Tunnel. It is not a static site. No port forwarding or Cloudflare account is required. Only fictional information and test ETH should be used.

## Start and stop

Requirements: Windows x64, Node 22.13 or newer, installed dependencies (`npm ci`), and an Internet connection. In the ArtGuard project directory, run:

```
npm run public:start
```

The launcher verifies/downloads the official cloudflared executable using the release SHA-256 digest, builds the app, exports source, starts the isolated chain, prepares demo accounts, and creates a public HTTPS address. It prints the address and saves it to `runtime/public-demo/runtime.json`. Keep the terminal open. Stop with Ctrl+C. The launcher owns and stops only the processes it started. On the next launch the HTTPS hostname usually changes; the database, wallets and chain state stay in the same directory.

Do not run a second launcher while ports 3300 or 8555 are occupied. If the app was started in the background, stop its supervisor process tree first. Never stop an unrelated service to free a port.

## Isolation and persistence

- Normal local app: port 3000, chain 8545, `data/`.
- Shared public app: port 3300, chain 8555, `runtime/public-demo/`.
- Anvil and Express bind to loopback; the tunnel publishes Express only.
- A random private mnemonic is generated for this chain. Its first account signs service quotes and receives service fees. Five accounts belong to prepared personas; 250 further accounts can be allocated to verified demo users.
- `chain/state.json` is persisted once per second. Back up the **entire** `runtime/public-demo/` directory together, including SQLite WAL files if the server is running. Prefer stopping it before backup. Losing the private mnemonic can make the hosted wallets inaccessible; the launcher refuses to replace a saved mismatching registry.
- `chain/accounts.private.json` contains private keys. `staff-credentials.private.json` contains operator-only administrator/manager passwords. Do not share either file. These are excluded from source export and HTTP serving.
- Runtime logs are `runtime/public-demo/{build,source-export,chain,setup,tunnel,app}.log`.

## Public capabilities

Visitors can open the home page, demonstration, source and documentation without an account. Catalog browsing requires login, as requested for the product. `/#/demo` exposes only the shared buyer, creator and co-author personas. They can modify shared demo projects and spend their fictional balances. Staff identities are not listed and have generated private passwords.

A new visitor can register with fictional details, open Profile > Security and their private demo inbox, confirm the verification link, then open Profile > Wallet > Create funded test wallet. This inbox is an account-bound demonstration flow, **not proof of real email ownership**. No external email is sent. Password reset delivery for logged-out users requires operator assistance until an email provider is configured. Google/Facebook/GitHub login remains disabled until real OAuth credentials and the current callback origin are configured. Use public demo wallets for a zero-install walkthrough.

`/rpc` accepts reads and raw, signed transactions to the known ArtGuard contracts, from wallets linked to verified accounts. It does not expose unlocked signing, arbitrary native transfers or Anvil administration. Browser wallets can use the displayed HTTPS RPC URL and chain ID 31337; an existing wallet configuration for another chain with the same ID may need its RPC updated. The built-in hosted demo wallet works without an extension.

## Code and agent access

- `/code`: readable file index.
- `/downloads/artguard-source.zip`: source snapshot.
- `/source-manifest.json`: paths, SHA-256 for every file, snapshot revision and archive checksum.
- `/source/<path>`: exact allowlisted raw files, without login.
- `/llms.txt`: entry point for agents.
- `/docs/report.md`: architecture and functional review guide.

The export includes application sources, Solidity contracts, tests and build scripts. Databases, runtime configuration, keys, uploads, logs, dependencies and unrelated 3D demo assets are excluded. This publishes code directly from the server; it does not create a GitHub repository. After source changes, rebuild, run `npm run public:source`, and restart the app if its server code changed.

## Availability

The computer, Node processes, Anvil and cloudflared must stay running. Sleep, loss of Internet or stopping the tunnel makes the site unavailable. Quick Tunnels are temporary testing infrastructure with no uptime guarantee, a 200 concurrent request limit and no SSE support. For a permanent shared service, move this isolated native stack to a persistent server, configure a stable domain/tunnel, backups, outbound mail and OAuth. Keep the Anvil node private and continue to identify its tokens as test funds.

Official tunnel limitations: https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/
