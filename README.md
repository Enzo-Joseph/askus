# askUs (web remake)

A web version of the **askUs** mobile game: one question a day for your friend group,
in the style of "Who's most likely to…". Everyone votes, and the results unlock once you've voted.

## Run it

Requires Node.js 18+. There are no dependencies to install.

```bash
npm start          # http://localhost:3000
npm run dev        # dev mode for testing on your own (see below)
npm test           # game-logic unit tests
```

To play with friends, they need to reach the server. Use your LAN IP, or expose the port with a
tunnel (e.g. `ngrok http 3000`). Then share a group's invite link (`/#/join/CODE`).
Several players can also share one device: **Profile → Add another player**.

### Dev mode

`npm run dev` lets you test the whole game alone:

- Groups start with a single member, so the daily question appears as soon as you create one.
- **Friends tab → Dev tools**: *Add bot* adds a fake friend who answers every open question at
  random; *Bots vote* makes all bots answer questions posted since (e.g. one you just asked).
- **Profile → Dev tools → Skip to next day** moves the game forward a day, to test history and streaks.
- Data goes to `data/dev-db.json`, separate from the real game in `data/db.json`.
  Delete that file to start over.

Environment variables: `PORT` (default 3000), `DB_FILE` (default `data/db.json`, or
`data/dev-db.json` in dev mode), `MIN_MEMBERS` (default 3, or 1 in dev mode), `DEV=1` (same as `--dev`),
`APP_TIMEZONE` (default `Europe/Paris`: the daily question changes at midnight in this timezone).

## Deploy on Vercel (free)

Vercel runs `api/index.js` as a serverless function for every `/api/*` request and serves
`public/` as static files (see `vercel.json`). Its filesystem is read-only, so the game state is
kept in **Upstash Redis** instead of `data/db.json`.

1. On [vercel.com/new](https://vercel.com/new), import this GitHub repository. Keep the defaults
   (framework: *Other*, no build command) and deploy.
2. In the project, open **Storage → Create Database → Upstash for Redis** (free plan), and connect
   it to the project. This adds the `KV_REST_API_URL` and `KV_REST_API_TOKEN` environment variables.
3. **Deployments → ⋯ → Redeploy** so the function picks up the new variables.

Every push to `main` then redeploys automatically. The whole game state is a single Redis value
with a version number: concurrent saves are detected and replayed, so simultaneous votes are not
lost. Dev mode (bots, skip day) is only available locally.

## Gameplay

| Feature | How it works |
| --- | --- |
| Groups | Create a group, then invite friends with a 6-character code or a link. Questions start at 3 members. |
| Daily question | A new question each day, drawn without repeats from all 8 packs. It closes at midnight, Paris time. |
| Question types | **Vote for a friend** (anonymous) or **This or that** (everyone sees which side you picked). |
| Your own questions | Anyone can post a question to the group at any time. It's open until midnight like the daily one. |
| Results | Hidden until you vote. Closed questions move to **History**, with results visible to all. |
| Streaks | Answer the daily question on consecutive days. Missing a day resets it. |
| Comments | Each question has a comment thread with replies, open once you've voted. |
| Share | **Save image** renders the results as a PNG and shares or downloads it. |
| Friends tab | Questions won (crown) and current streak (flame) for each member. |

## Structure

```
server.js            local HTTP server: JSON API + static files (no framework)
api/index.js         Vercel serverless function (same API, data in Redis)
lib/api.js           API routes shared by both
lib/game.js          game rules (groups, polls, votes, streaks, packs, comments)
lib/questions.js     question packs (8 packs, 180 questions)
lib/store.js         JSON-file persistence (debounced writes)
lib/redis-store.js   Upstash Redis persistence with compare-and-set saves (Vercel)
lib/dev.js           dev-mode bots (only reachable with --dev)
public/              single-page app (vanilla JS, mobile-first)
public/sprites.js    hand-drawn pixel sprites (avatars + icons), drawn as SVG and on the share-image canvas
test/                node:test unit tests (game rules, dev bots, Vercel function)
```

Accounts are lightweight: there is no password. Each account's token is stored in the browser's
localStorage, so signing out of a device means losing that account. This fits a friends-only game;
add real auth before exposing it publicly.
