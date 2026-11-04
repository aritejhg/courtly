# Operations

How to run Courtly in production, and the behaviour changes must preserve. The [README](../README.md) covers setup and environment variables.

## Runtimes

| Runtime | Job | Must not |
| --- | --- | --- |
| GitHub Actions | Tests, verifies, builds, and publishes the Worker on each push to `main` | Hold Telegram sessions or runtime data |
| Ingestion host (a small VM) | Reads Telegram, parses, and writes the feed to Cloudflare KV | Publish frontend code |
| Developer machine | Edits source and runs sample data | Run the production pipeline |

## Ingestion

`scripts/run-local-ingestion.mjs` is the runner, despite its name. It exits unless `COURTLY_RUNTIME=hermes`, which guards against accidental runs on a workstation.

Each run does the following:

1. Reads new messages, then merges them into `data/telegram-messages.json`.
2. Audits venue coordinates through OneMap, parses messages into `data/telegram-listings.json`, and repairs persisted listing coordinates.
3. Blocks publishing if a message touched in this run still has a parser ambiguity. The last published feed stays live.
4. If state changed, builds. If publishing is enabled, writes the feed to KV under `courtly:listings`.

Useful flags: `--dry-run`, `--publish`, `--force-build`, `--no-llm`, `--skip-telegram`.

Ingestion fails closed. Malformed JSON, a missing Telegram source, and an empty, malformed, or sample feed all stop the run before publishing. Runtime logs and the session live in the git-ignored `work/` directory.

The runner reads only `COURTLY_TELEGRAM_CHAT_ID` and `COURTLY_TELEGRAM_SOURCE_URL` from `.env`. Provide everything else, including `CLOUDFLARE_API_TOKEN` and `COURTLY_FEED_KV_NAMESPACE_ID`, through the process environment, for example with a systemd `EnvironmentFile=`.

Schedule the runner with a systemd timer or similar. Choose an interval that keeps within Telegram's rate limits.

### Automated parser repair

**Keep repair disabled unless the agent runs in a credential-free checkout, under a restricted OS identity, with an environment allowlist.** The agent runs with reduced permission checks and reads text that anyone in the group can write, so a successful prompt injection acts with everything that identity can reach. The checkout, identity, and environment must give it no access to the Telegram session, `.env`, Cloudflare tokens, deploy keys, or other credentials. Nothing in this repository sets up that isolation for you.

Repair is off by default. With `COURTLY_ENABLE_LLM_REPAIR=1`, when a parser ambiguity remains, the runner starts a coding agent CLI (`COURTLY_REPAIR_COMMAND`, `codex` or `agy`) with permission checks disabled or reduced, and gives it the ambiguous message. `--no-llm` and `COURTLY_DISABLE_LLM=1` override the opt-in. **Enable it only if you accept these consequences:**

- Message text, which anyone in the group can write, reaches the agent and its provider. The prompt marks it as untrusted, which reduces prompt injection risk but does not eliminate it.
- The agent can change code on the ingestion host, and the sync script will then refuse to overwrite those changes until they are resolved.

If used, a repair may change only deterministic parser code, a synthetic regression fixture, and a strict alias or coordinate mapping for a verified venue. It must pass the tests, and must not touch sessions, credentials, access controls, or generated data.

## Worker secrets

The Worker reads `COURTLY_ACCESS_CODE`, `COURTLY_TELEGRAM_SOURCE_URL`, and `COURTLY_TELEGRAM_CHAT_ID` at runtime. They are not in the Wrangler config, the build, or the deploy workflow. `wrangler deploy` keeps them, so set each one once, and again only to change it:

```sh
npx wrangler secret put COURTLY_TELEGRAM_SOURCE_URL --name <worker-name>
npx wrangler secret put COURTLY_TELEGRAM_CHAT_ID --name <worker-name>
```

Each command prompts for the value and takes effect without a rebuild. Delete any GitHub Actions secrets or `VITE_`-prefixed build variables that held these values. The ingestion host still reads the same names from its own `.env`.

## Source sync on the VM

`scripts/deploy-from-github-oracle.sh` is an example that keeps a VM on the latest `main`, and `ops/courtly-ingest.service.d/github-deploy.conf` runs it before each ingestion. Its paths have generic example defaults under `/opt/courtly`. Set each one for your host in `Environment=` lines of the drop-in, before a sync can deliver a new script. The drop-in's `ExecStartPre` path must match too:

| Variable | Purpose |
| --- | --- |
| `COURTLY_GITHUB_REPOSITORY` | `owner/name` to pull |
| `COURTLY_GITHUB_SOURCE_DIR` | Clean checkout |
| `COURTLY_APP_DIR` | Directory that ingestion runs from |
| `COURTLY_GITHUB_KEY` | Read-only deploy key |
| `COURTLY_GITHUB_KNOWN_HOSTS` | Pinned GitHub host keys |

The script preserves `.env`, `work/`, `node_modules/`, `dist/`, and runtime data, including `data/telegram-messages.json` and `data/telegram-listings.json`. The checked-in samples therefore never replace real data on the VM.

`scripts/lib/source-sync-guard.mjs` refuses to sync over uncommitted edits, unpushed commits, or drift from the recorded commit. Commit a blocked repair through GitHub rather than bypassing the guard. Edits made only on the VM are otherwise lost at the next sync.

### Moving a VM to rewritten history

The guard's ancestor check blocks a checkout whose history was rewritten, and an old `.courtly-source-commit` no longer exists in the new history. Do not weaken or bypass the guard. Migrate once, by re-cloning:

1. Stop the ingestion timer and wait for any running service to finish.
2. Back up the app directory, including `.env`, `work/`, and runtime data under `data/`.
3. In the old checkout, save local commits and uncommitted edits as patches. Compare the app directory with the old checkout, and save any edits made only there. Reapply these repairs through the new repository, then wait for them to reach `main`.
4. Set the variables above and the `ExecStartPre` path in the drop-in, then reload systemd.
5. Move the old checkout aside and clone the new `main` to `COURTLY_GITHUB_SOURCE_DIR`.
6. Copy the new source into the app directory with the same `rsync` options and excludes as the sync script, so `.env`, `work/`, and runtime data stay in place. Run `npm ci` there.
7. Write the new commit SHA to `.courtly-source-commit` in the app directory. This only records the baseline you just copied.
8. Run the sync script once, confirm it exits cleanly, then start the timer.

Keep the backup and the old checkout until a full run has succeeded.

## Runtime data

- Never commit real `data/telegram-*.json` content. In this repository those files hold invented samples, marked by the source URL `https://t.me/your_group_invite`.
- `data/parser-ambiguities.json`, `data/unmatched-venue-candidates.json`, and `data/ambiguity-review-history.json` are git-ignored runtime state, and can contain message text.
- Verified venues live in `data/badminton-venues.json` and `data/venue-overrides.json`. Unmatched venues are recorded for review. Never attach coordinates to an unverified venue.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Site returns 503 "Access gate is not configured" | Set the `COURTLY_ACCESS_CODE` Worker secret. Built Workers fail closed without it. |
| `/api/listings` returns 503 | The KV binding is missing or the feed has not been published. |
| Listings are stale | Check the ingestion timer, logs in `work/production-ingestion.jsonl`, and any `publish_blocked` events. |
| Code on the site is stale | Confirm the commit is on `main` and the deploy workflow passed. `/api/build` returns the deployed commit. |
| Deploy says no `workers.dev` subdomain exists | Register one under Workers & Pages in Cloudflare, then retry. |
| No Telegram links in the UI | The Worker has no `COURTLY_TELEGRAM_SOURCE_URL` or `COURTLY_TELEGRAM_CHAT_ID` secret, or the source URL is not an `https://t.me/` link. Set them with `wrangler secret put`. No rebuild is needed. |

## UI behaviour to preserve

### Data and privacy

- Saved locations are device-local: `localStorage` keys `courtly-locations` and `courtly-origin-id`. Load them in an effect, and do not write defaults until hydration completes, or startup can overwrite them.
- Never hardcode a home address, postal code, or other user origin.
- The Telegram source is configuration, never source code. Exact message links use `https://t.me/c/<chat-id-without-100-prefix>/<message-id>`. The browser gets these values only from the gated `/api/telegram-config`, and links are hidden without them. Never expose them through a `VITE_` variable: static client assets bypass the access gate.
- An owner action links to `https://t.me/<username>` only when `ownerUsername` exists. Otherwise it links to the message and must not imply a direct message.

### Product

- The product is badminton-only. Keep other sports out of the UI and filters.
- Directions use the selected origin and the venue's exact `lat,lng`.
- Date filtering uses a calendar with Singapore-local dates. Time filtering takes optional `HH:MM` start and end values, including overnight ranges, with no presets.
- The location dropdown and adjacent Edit locations button are the only saved-location controls.

### MRT overlay

- It is a native Leaflet overlay, fetched on demand. The network is cached per device for 24 hours under `courtly-mrt-network-v1`, and failed refreshes keep the saved network and back off for five minutes. The preference is stored under `courtly-mrt-overlay`.
- Court pins stay above rail lines and station labels. Toggling MRT must not recenter the map.
- The mobile control is one icon-only toggle, green when on, reachable above expanded sheets. The desktop legend appears on hover or keyboard focus of the toggle.

### Mobile

- The flow is map-first: search on row one, area, date, and time filters on row two, listings in a bottom sheet.
- The sheet's drag surface is the handle and the full listings header. Do not attach drawer gestures to the card list or sort control.
- A selected pin or card opens a compact, opaque details sheet below the filters.
- Show the compact `Updated …` timestamp. Do not add an inert menu icon.
- The initial fit shows all filtered pins with an edge buffer. Do not refit when a pin is selected.
- Route controls wrap without horizontal overflow.

[design.md](../design.md) records the visual design.

## UI verification checklist

Check in a real browser after UI changes. `npm run test:responsive` and `npm run test:mrt` automate part of this.

- Test at 320×667 and 375×812: timestamp visible, search and filters fit, all initial pins visible, map primary.
- Tap and swipe the listings header. The sheet expands and collapses, the sort button works, and the card list scrolls independently.
- Tap a pin and a card. Details are opaque and below the filters, and closing restores state. Repeat on desktop.
- Add a named location with a postal code, select it, reload, and confirm it stays selected.
- Confirm the Directions link has the selected origin and exact venue coordinates.
- Edit, delete, and add a location, then confirm the dropdown updates.
