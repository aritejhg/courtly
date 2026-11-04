# Contributing

## Setup

Requires Node.js 22.18 or later. No environment variables are needed.

```sh
npm ci
npm run dev
```

## Checks

Run these before opening a pull request. CI runs the same ones.

```sh
npm run lint
npx tsc --noEmit
npm test
npm run build
```

If you change the parser or venue data, also run `npm run venues:verify`.

## Test data must be synthetic

Tests, fixtures, sample data, examples, screenshots, issues, and pull requests must use invented data only.

- Never commit real Telegram messages, names, usernames, phone numbers, message IDs, or chat IDs, even partly anonymised.
- To reproduce a parser bug, write a new message with the same structure. Keep only the venue, date, time, and price strings the test needs.
- Never commit `.env` files, Telegram sessions, or anything under `work/`.

Removing a file later does not remove it from git history. If you commit real data by accident, tell the maintainer privately (see [SECURITY.md](SECURITY.md)).

## Licence

Contributions are licensed under the MIT License. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
