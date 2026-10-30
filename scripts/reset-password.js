'use strict';

// Resets a player's password and signs them out everywhere.
//
//   npm run reset-password -- <pseudo> <nouveau-mot-de-passe>
//
// Uses the Vercel database (Upstash Redis) when KV_REST_API_URL / KV_REST_API_TOKEN are set,
// otherwise the local file (DB_FILE, default data/db.json).

const path = require('path');
const { Game, HttpError } = require('../lib/game');
const { createStore } = require('../lib/store');

const [username, password] = process.argv.slice(2);

async function main() {
  if (!username || !password) {
    console.error('Usage: npm run reset-password -- <pseudo> <nouveau-mot-de-passe>');
    process.exit(1);
  }

  if (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL) {
    const redis = require('../lib/redis-store');
    for (let attempt = 0; attempt < 5; attempt++) {
      const { data, version } = await redis.load();
      const user = new Game({ data, save() {} }).resetPassword(username, password);
      if (await redis.save(JSON.stringify(data), version)) return done(user, 'Redis (Vercel)');
    }
    throw new Error('The database kept changing during the reset; try again.');
  }

  const file = process.env.DB_FILE || path.join(__dirname, '..', 'data', 'db.json');
  const store = createStore(file);
  const user = new Game(store).resetPassword(username, password);
  store.flush();
  done(user, file);
}

function done(user, where) {
  console.log(`Password reset for "${user.username}" (${user.name}) in ${where}. They are signed out on every device.`);
}

main().catch((err) => {
  console.error(err instanceof HttpError ? err.message : err);
  process.exit(1);
});
