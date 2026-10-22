# Private Cloudflare hosting (experimental)

Status: implementation and local tests are ready. The personal account
`rgerkin@gmail.com` has been verified in Chrome; the intended URL is
`https://contra-browser-private.rgerkin.workers.dev`. The code was deployed through the dashboard (version `58aeb62f`), but the two Durable Object namespaces/bindings and secret bindings are still missing. The app fails closed while secrets are absent. It is **not ready to play**.
Actual browser and multi-device network verification remain outstanding.

## How it works

A Worker serves the browser code behind a shared-password login. A successful login
sets a signed, secure, HttpOnly cookie valid for eight hours. Login attempts are
limited per IP. The Worker fails closed until both secret bindings are configured.

Room introductions use SQLite Durable Objects with hashed participant credentials,
bounded connection descriptions, and a 30-minute inactivity expiry. Two-, three-, and
four-player rooms all use direct encrypted WebRTC channels. Player 1 connects to each
guest and forwards their controller messages to the other guests. The host must stay
connected. There is no Cloudflare gameplay relay endpoint, no STUN/TURN service, and
no automatic cloud fallback. Connection setup can fail across isolated Wi-Fi networks,
VPNs, firewalls, or separate internet connections. Direct connectivity must be tested
on the intended subnet; disabling STUN does not prove packets stay within a subnet.

The host selects an original US ROM. The host browser transfers it to each guest over
its direct data channel; every receiver verifies the same pinned SHA-512 as local
play. Cloudflare never receives the cartridge, controller inputs, or state checksums.
Guests need a browser, password, and room invitation; no emulator installation or
separate ROM file picker is needed. Everyone clicks Ready after verification.

## Build and test

Normal local play still has no npm dependencies. Deployment additionally needs a
current Node.js release and Cloudflare Wrangler CLI, authenticated to the personal
account, with permission to deploy Workers and SQLite Durable Objects.

From the repository root:

```sh
python3 scripts/prepare-cloudflare.py
npm run test:cloudflare
npx wrangler deploy --config cloudflare/wrangler.jsonc --dry-run
```

The preparation script verifies the bundled emulator and copies an explicit allowlist
of browser code and license notices into ignored `build/` outputs, including an inline
asset map for the Worker. It excludes ROMs, `web/game/`, disassembly, screenshots,
credentials, and ROM-containing standalone HTML. Never upload the repository or the
entire `web/` directory as assets.

To finish the deployment from a terminal with working internet access:

```sh
sh scripts/deploy-cloudflare.sh --login
```

Open the printed login URL only in the personal `rgerkin@gmail.com` Chrome profile.
The script prepares the allowed assets, runs tests, and deploys the configured SQLite
migrations, bindings, and secrets together. For subsequent deployments, omit `--login`.
This agent environment currently cannot resolve the Cloudflare API hostname, and
Chrome blocks the live workers.dev URL with `ERR_BLOCKED_BY_CLIENT`, so live verification
remains outstanding.

Set `SITE_PASSWORD` and `SESSION_SECRET` as Worker **secrets**, never source variables.
For this checkout, their generated values are stored in the owner-readable,
Git-ignored `.env.cloudflare.local`. Do not upload that file as an asset or include it
in commits. Rotating `SESSION_SECRET` invalidates all existing login sessions.
Wrangler can prompt securely for each value:

```sh
npx wrangler secret put SITE_PASSWORD --config cloudflare/wrangler.jsonc
npx wrangler secret put SESSION_SECRET --config cloudflare/wrangler.jsonc
npx wrangler deploy --config cloudflare/wrangler.jsonc
```

The configuration declares both Durable Object bindings and their initial SQLite
migration. It disables preview URLs and observability logs. Use the password flow;
no account-wide Access policy change is required.

Local automated coverage includes cookie signatures/tampering/expiry, streamed body
limits, durable room-state serialization and participant authorization, and four
simulated direct peers transferring a bounded cartridge and controller messages
without using a cloud relay. These tests do not replace a deployed test in real
browsers. Before claiming readiness, verify login restrictions, missing-ROM URLs,
four-client startup/checksums, pause/reset/disconnect, and actual WebRTC route stats
on separate devices. Background browser tabs can throttle simulation.
