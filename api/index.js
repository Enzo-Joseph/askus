'use strict';

// Vercel serverless entry point: every /api/* request is rewritten here (see vercel.json).
// Each request loads the game state from Redis, runs, and saves it back if it changed.

const { Game, HttpError } = require('../lib/game');
const { dispatch, readBody, bearer, send } = require('../lib/api');
const redis = require('../lib/redis-store');

const MAX_ATTEMPTS = 5;

// vercel.json routes /api/<path> here as /api/index.js?path=<path>; depending on the runtime,
// req.url is either that rewritten URL or the original one, so accept both.
function apiPath(url) {
  const { pathname, searchParams } = new URL(url, 'http://localhost');
  const routed = searchParams.get('path');
  return routed !== null && pathname.startsWith('/api/index') ? `/api/${routed}` : pathname;
}

module.exports = async (req, res) => {
  const pathname = apiPath(req.url);
  let body = {};
  if (req.method !== 'GET') {
    try {
      body = await readBody(req);
    } catch (err) {
      return send(res, err instanceof HttpError ? err.status : 400, { error: err.message });
    }
  }

  try {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const { data, raw, version } = await redis.load();
      const game = new Game({ data, save() {} }, { minMembers: Number(process.env.MIN_MEMBERS) || 3 });
      const { status, payload } = dispatch(game, { method: req.method, pathname, token: bearer(req), body });
      const json = JSON.stringify(data);
      // Reads usually change nothing; the first visit of the day also creates the daily question.
      if (json === raw || (await redis.save(json, version))) return send(res, status, payload);
      // Someone saved in between (e.g. two friends voting at once): reload and replay.
    }
    send(res, 503, { error: 'Trop de monde en même temps, réessaie' });
  } catch (err) {
    console.error(err);
    send(res, 500, { error: 'Une erreur est survenue' });
  }
};
