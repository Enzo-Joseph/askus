# askUs (web remake)

A web version of the **askUs** mobile game: one question a day for your friend group,
in the style of "Who's most likely to…". Everyone votes, and the results unlock once you've voted.

## Run it

Requires Node.js 18+. Run `npm install` once (one dependency: `web-push`).

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
`APP_TIMEZONE` (default `Europe/Paris`) and `APP_DAY_START_HOUR` (default `9`): the daily question
changes at that hour in that timezone. Push keys are generated automatically in `data/vapid.json` when
running locally, and the local server sends the morning notifications itself.

## Deploy on Vercel (free)

Vercel runs `api/index.js` as a serverless function for every `/api/*` request and serves
`public/` as static files (see `vercel.json`). Its filesystem is read-only, so the game state is
kept in **Upstash Redis** instead of `data/db.json`.

1. On [vercel.com/new](https://vercel.com/new), import this GitHub repository. Keep the defaults
   (framework: *Other*, no build command) and deploy.
2. In the project, open **Storage → Create Database → Upstash for Redis** (free plan), and connect
   it to the project. This adds the `KV_REST_API_URL` and `KV_REST_API_TOKEN` environment variables.
3. **Push notifications:** run `npm run vapid-keys` and add the four printed values
   (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` with your email, `CRON_SECRET`) in
   **Settings → Environment Variables**.
4. **Deployments → ⋯ → Redeploy** so the function picks up the new variables.

Every push to `main` then redeploys automatically. The whole game state is a single Redis value
with a version number: concurrent saves are detected and replayed, so simultaneous votes are not
lost. Dev mode (bots, skip day) is only available locally.

### Morning notifications

Vercel Cron calls `/api/cron/daily/*` at 7:00 and 8:00 UTC (see `vercel.json`), i.e. 9:00 Paris in
summer and in winter. The game day only starts at 9:00 Paris and each day is notified once, so exactly
one run sends today's question to every subscribed device. On the free plan Vercel may run a cron
job at any minute within its hour, so notifications arrive between 9:00 and 10:00. Vercel signs these
calls with `CRON_SECRET`; the route refuses anyone else.

Players turn notifications on in **Profil → Notifications** (one subscription per device). On iPhone
this needs iOS 16.4+ and askUs added to the home screen (Share → *Sur l'écran d'accueil*).

## Gameplay

| Feature | How it works |
| --- | --- |
| Groups | Create a group, then invite friends with a 6-character code or a link. Questions start at 3 members. |
| Daily question | A new question every morning at 9:00 Paris time, drawn without repeats from all 8 packs, with a push notification. |
| Question types | **Vote for a friend** or **This or that**. Votes are public: results show who voted for whom. |
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
lib/auth.js          password hashing (scrypt) and pseudo rules
lib/store.js         JSON-file persistence (debounced writes)
lib/redis-store.js   Upstash Redis persistence with compare-and-set saves (Vercel)
lib/push.js          Web Push sending (web-push library)
lib/dev.js           dev-mode bots (only reachable with --dev)
public/              single-page app (vanilla JS, mobile-first)
public/sprites.js    hand-drawn pixel sprites (avatars + icons), drawn as SVG and on the share-image canvas
public/sw.js         service worker: shows notifications, opens the group when tapped
scripts/             admin commands (reset-password, vapid-keys, make-icons)
test/                node:test unit tests (game rules, accounts, dev bots, Vercel function)
```

## Accounts

Players sign up with a display name (what friends see), a unique **pseudo** and a **password**,
and can log in from any device (*J'ai déjà un compte*). Each device gets its own session token;
signing out only closes that device. Passwords are hashed with scrypt (Node's built-in crypto),
and 5 wrong passwords lock the account for 5 minutes. Accounts created before logins existed are
asked to choose a pseudo and password the next time they open the app.

There is no email, so a forgotten password is reset by whoever runs the game:

```bash
npm run reset-password -- <pseudo> <nouveau-mot-de-passe>
```

This signs the player out everywhere. It edits `data/db.json` (stop the local server first, or
set `DB_FILE`), or the Vercel database if `KV_REST_API_URL` and `KV_REST_API_TOKEN` are set
(copy them from Vercel → Storage → your database → *.env.local*), e.g. in PowerShell:

```powershell
$env:KV_REST_API_URL="https://..."; $env:KV_REST_API_TOKEN="..."; npm run reset-password -- enzo.j nouveau-mdp
```
