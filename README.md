# Courtly

Courtly shows badminton court listings in Singapore on a map. It reads court swap messages from a Telegram group, parses them into structured listings, matches each venue to known coordinates, and shows them with filters, search, MRT lines, and travel times from saved locations.

It runs on [vinext](https://github.com/cloudflare/vinext) on Cloudflare Workers.

## Quick start

Requires Node.js 22.18 or later. You do not need environment variables, a Telegram account, or a Cloudflare account.

```sh
git clone https://github.com/aritejhg/courtly.git
cd courtly
npm ci
npm run dev
```

Open the URL printed by the dev server. It serves invented sample listings from `data/telegram-listings.json`. Most are dated 2036 and show as active; one is dated 2026 and marked `expired`. The Telegram group button and exact message links stay hidden until you configure a source. Owner contact links still appear for listings that have an owner username.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Dev server with sample data |
| `npm run build` | Writes `data/build-info.json`, then builds to `dist/` |
| `npm start` | Runs the built Worker locally with Wrangler. Run the build first. |
| `npm run lint` | oxlint |
| `npm run format` | oxfmt |
| `npm test` | Unit tests with `node --test` |
| `npm run test:responsive` | Browser layout check. Needs Chrome; starts its own dev server. |
| `npm run test:mrt` | MRT overlay check. Needs Chrome and `npm run dev -- --port 3100` running. |
| `npm run venues:refresh` | Refetches ActiveSG venues into `data/badminton-venues.json` |
| `npm run venues:verify` | Validates venue data and mappings |
| `npm run ingest:telegram` | Parses `data/telegram-messages.json` into listings. No network access. Overwrites the listing files unless given `--output`, `--unmatched`, and `--ambiguities` paths. |
| `npm run query:listings` | Prints active future listings. Options: `--date YYYY-MM-DD`, `--from HH:MM`, `--to HH:MM` |
| `npm run telegram:setup` | Interactive Telegram login that saves a session to `work/telegram-client.json` |
| `npm run publish:cloudflare` | Deploys the built Worker. `publish:cloudflare:dry` is a dry run. |
| `npm run publish:feed` | Writes the listing feed to KV. Refuses empty, malformed, or sample feeds. |

## Architecture

| Path | Contents |
| --- | --- |
| `app/` | Page, `/api/listings` (feed), and `/api/build` (deployed commit) |
| `components/` | UI components |
| `lib/` | Filtering, search syntax, access gate, feed handling, MRT layer, travel status |
| `middleware.ts` | Access gate in front of the app |
| `scripts/` | Ingestion, parser, venue tools, publishing |
| `data/` | Venue catalog and invented sample data |
| `test/` | Unit tests and synthetic parser fixtures |
| `docs/operations.md` | Production operation and UI behaviour to preserve |
| `design.md` | Visual design notes |

The parser is deterministic and lives in `scripts/lib/telegram-parser.mjs`.

## Data flow

```text
Telegram group
  -> scripts/run-local-ingestion.mjs     data/telegram-messages.json
  -> scripts/ingest-telegram.mjs         data/telegram-listings.json
       + data/badminton-venues.json, data/venue-overrides.json
  -> scripts/publish-feed-to-kv.mjs      Cloudflare KV, key courtly:listings
  -> /api/listings                       browser
```

- The Worker and the feed deploy separately, so new listings do not require a Worker deploy.
- The dev server falls back to sample data. A built Worker never does: without a usable feed, `/api/listings` returns 503.
- Unknown venues never get guessed coordinates. They are recorded for review.
- Browser-side services: OpenStreetMap tiles, Nominatim for saved locations, sgraildata for the MRT overlay, and OneMap routing if a token is set. Without a token, travel times are estimates.
- If `VITE_CLOUDFLARE_ANALYTICS_TOKEN` is set, the page also loads the Cloudflare Web Analytics beacon.

## Environment variables

All are optional for local development. See [.env.example](.env.example).

### Browser (build time)

These are embedded in client JavaScript, so treat them as public.

| Variable | Purpose |
| --- | --- |
| `VITE_ONEMAP_TOKEN` | OneMap token for public transport routing. Not set by the deploy workflow. |
| `VITE_CLOUDFLARE_ANALYTICS_TOKEN` | Cloudflare Web Analytics token. If unset, the beacon is not loaded. |

### Worker runtime

| Name | Purpose |
| --- | --- |
| `COURTLY_ACCESS_CODE` | Secret access code. If unset, a built Worker returns 503 on every host. The dev server runs without it. |
| `COURTLY_TELEGRAM_SOURCE_URL` | Secret. Invite link for the Telegram group button, served only by the gated `/api/telegram-config`. If unset, the button is hidden. |
| `COURTLY_TELEGRAM_CHAT_ID` | Secret. Chat ID for exact message links, served the same way. If unset, message links are hidden. |
| `COURTLY_FEED` | KV binding, created from `COURTLY_FEED_KV_NAMESPACE_ID` at build time |

### Build and deploy

| Variable | Purpose |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Used by Wrangler to deploy and to write the feed |
| `COURTLY_FEED_KV_NAMESPACE_ID` | KV namespace for the feed |
| `COURTLY_REQUIRE_FEED_BINDING` | `1` fails the build if the namespace ID is missing |
| `COURTLY_WORKER_NAME` | Worker name. Default `courtly-sg`. |
| `COURTLY_BUILD_COMMIT` | Overrides the commit reported by `/api/build`. Otherwise the build uses `GITHUB_SHA`, then `.courtly-source-commit`, then the git HEAD. |

### Ingestion

| Variable | Default | Purpose |
| --- | --- | --- |
| `COURTLY_TELEGRAM_CHAT_ID` | required | `-100`-prefixed source chat ID |
| `COURTLY_TELEGRAM_SOURCE_URL` | required | `https://t.me/` link to the source |
| `COURTLY_TELEGRAM_SOURCE` | `client` | Only `client` is accepted. The runner fails on any other value. |
| `COURTLY_RUNTIME` | unset | Must be `hermes` or the runner exits. A safety guard against accidental runs. |
| `COURTLY_PUBLISH` | unset | `1` is the same as `--publish` |
| `COURTLY_ENABLE_LLM_REPAIR` | unset | `1` opts in to automated repair. See [operations](docs/operations.md#automated-parser-repair). |
| `COURTLY_DISABLE_LLM` | unset | `1` disables repair even if opted in, as does `--no-llm` |
| `COURTLY_REPAIR_COMMAND` | `codex` | Repair agent: `codex` or `agy` |
| `COURTLY_REPAIR_MODEL` | see `scripts/lib/llm-repair-config.mjs` | Model for the `codex` repair agent |
| `COURTLY_MAX_LLM_REPAIRS` | `2` | Repair limit per run |
| `COURTLY_CODEX_BIN`, `COURTLY_AGY_BIN` | auto, `agy` | Repair agent binaries |
| `COURTLY_TELEGRAM_CONFIG` | `work/telegram-client.json` | Credentials file |
| `COURTLY_TELEGRAM_API_ID`, `COURTLY_TELEGRAM_API_HASH`, `COURTLY_TELEGRAM_SESSION` | from file | Override the credentials file |
| `COURTLY_TELEGRAM_STATE` | `work/telegram-client-state.json` | Read cursor |
| `COURTLY_TELEGRAM_HISTORY_LIMIT` | `5000` | Maximum messages per read |
| `COURTLY_TELEGRAM_OVERLAP` | `500` | Recent messages reread to catch edits and deletions |
| `INGEST_NOW` | current time | Fixed clock for the parser and query scripts |

### Tests and VM sync

`COURTLY_TEST_URL` and `COURTLY_SCREENSHOT_DIR` configure the browser checks. The VM sync variables are in [docs/operations.md](docs/operations.md#source-sync-on-the-vm).

## Bringing your own Telegram source

Read [Responsible use](#responsible-use) first. Do these steps on the host that will run ingestion.

1. Get permission from the group's admins.
2. Create API credentials at <https://my.telegram.org> using a dedicated account that has joined the group.
3. Run `npm run telegram:setup`. This asks for your credentials and login code, then writes the session to `work/telegram-client.json` (git-ignored, mode `0600` where supported).
4. Set the source in `.env`:

   ```sh
   COURTLY_TELEGRAM_CHAT_ID=-1001234567890
   COURTLY_TELEGRAM_SOURCE_URL=https://t.me/your_group_invite
   ```

5. Do a dry run. The runner treats `hermes` as its production flag, so this reads Telegram for real, but it writes only logs under `work/`:

   ```sh
   COURTLY_RUNTIME=hermes node scripts/run-local-ingestion.mjs --dry-run
   ```

6. Adapt the venue data if you need venues outside the catalog, by adding verified entries to `data/venue-overrides.json`.
7. Remove `--dry-run` to write listings. Add `--publish` once deployment is set up.

Keep real data out of git. `data/telegram-messages.json` and `data/telegram-listings.json` are tracked sample files, so `git status` will show them as changed on an ingestion host. Do not commit them.

On the first real run (not a dry run), ingestion empties those two files if they hold exactly the checked-in sample records (source URL `https://t.me/your_group_invite`), so samples never reach the live feed. If either file holds any other record, nothing is changed.

## Deployment

1. Create a KV namespace:

   ```sh
   npx wrangler kv namespace create courtly-feed
   ```

2. Build and deploy with the namespace ID. Use `COURTLY_WORKER_NAME` to choose a Worker name:

   ```sh
   export COURTLY_FEED_KV_NAMESPACE_ID=<namespace-id>
   export COURTLY_REQUIRE_FEED_BINDING=1
   export CLOUDFLARE_API_TOKEN=<token>
   npm run build
   npm run publish:cloudflare
   ```

3. Set the access code:

   ```sh
   npx wrangler secret put COURTLY_ACCESS_CODE --name <worker-name>
   ```

   Optionally, set the Telegram links. Without them, the group button and message links are hidden. Each command prompts for the value, so it stays out of your shell history and logs. Secrets persist across deploys, and the deploy workflow never sets them.

   ```sh
   npx wrangler secret put COURTLY_TELEGRAM_SOURCE_URL --name <worker-name>
   npx wrangler secret put COURTLY_TELEGRAM_CHAT_ID --name <worker-name>
   ```

   If you set these as GitHub secrets or `VITE_`-prefixed build variables before, remove them. Anything in a build-time client bundle is public, even behind the access gate.

4. Publish a real feed from your ingestion host with `npm run publish:feed`, or use `--publish` on the runner. See [docs/operations.md](docs/operations.md).

### GitHub Actions

`.github/workflows/ci.yml` runs on pull requests and pushes to `main`, and needs no secrets. `.github/workflows/deploy-cloudflare.yml` deploys from `main` and runs only in `aritejhg/courtly`. In a fork, change its `if:` condition and configure the following:

| Type | Name | Required | Purpose |
| --- | --- | --- | --- |
| Secret | `CLOUDFLARE_API_TOKEN` | Yes | Worker deploy |
| Variable | `COURTLY_FEED_KV_NAMESPACE_ID` | Yes | Feed binding |
| Variable | `COURTLY_PRODUCTION_URL` | No | Worker URL, which must return 401 to anonymous requests. If unset, the check is skipped with a warning. |
| Variable | `VITE_CLOUDFLARE_ANALYTICS_TOKEN` | No | Without it, the analytics beacon is not loaded |

## Responsible use

This project processes messages that other people wrote. You are responsible for how you run it, and this section is not legal advice.

- **Get permission.** Get the group admins' permission before ingesting a group, and tell members if the admins agree that is appropriate. Do not ingest a group that forbids it.
- **Use a dedicated Telegram account.** Do not use your personal account. Automated use can get an account limited or banned.
- **Protect the session string.** A session string gives **full access to the Telegram account**, including its messages and contacts, with no further login or two-step password. Never commit, print, or share it. If it leaks, terminate the session in Telegram under Settings > Devices.
- **Follow Telegram's terms.** See the [Telegram API terms of service](https://core.telegram.org/api/terms). Keep to read-only use and modest polling.
- **Comply with the PDPA.** Listings can include names, usernames, and message text, which may be personal data under Singapore's [Personal Data Protection Act](https://www.pdpc.gov.sg/). Consider your purpose and any notice or consent needed, collect no more than you need, keep it no longer than needed, and secure it. Keep the access gate on, since the feed exposes this data to anyone who gets past it.
- **Honour removal requests.** Publish a way to contact you. When someone asks to be removed, delete their data from `data/telegram-messages.json` and `data/telegram-listings.json` on the ingestion host, and republish the feed. Check that the next run will not restore it. Deleted Telegram messages are only detected within the overlap window of recent messages.
- **Follow third-party usage policies.** The public [OpenStreetMap tile](https://operations.osmfoundation.org/policies/tiles/) and [Nominatim](https://operations.osmfoundation.org/policies/nominatim/) services are donated resources with usage limits and attribution requirements. If your deployment gets significant traffic, switch to a commercial or self-hosted provider. Respect the terms of OneMap and of the sites behind the venue data.
- **Understand automated repair before enabling it.** It is off by default. When enabled, it sends message text to a third-party LLM provider. Keep it disabled unless it runs in a credential-free checkout, under a restricted identity, with an environment allowlist. See [what it does](docs/operations.md#automated-parser-repair).

## Licence

Code is under the [MIT License](LICENSE). Third-party data and services stay under their own terms; see [NOTICE](NOTICE). To contribute, see [CONTRIBUTING.md](CONTRIBUTING.md). To report a vulnerability, see [SECURITY.md](SECURITY.md).
