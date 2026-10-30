'use strict';

// JSON API shared by the local server (server.js) and the Vercel function (api/index.js).

const crypto = require('crypto');
const { HttpError } = require('./game');
const dev = require('./dev');
const push = require('./push');

const MAX_BODY = 16 * 1024;

const routes = [];
const route = (method, pattern, handler) => {
  const re = new RegExp(`^${pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)')}$`);
  routes.push({ method, re, handler });
};

const auth = (ctx) => {
  if (!ctx.user) throw new HttpError(401, 'Connecte-toi pour continuer');
  return ctx.user;
};

const devOnly = (ctx) => {
  if (!ctx.dev) throw new HttpError(404, 'Introuvable');
};

const requirePush = () => {
  if (!push.isConfigured()) throw new HttpError(503, 'Les notifications ne sont pas configurées sur le serveur');
};

// Constant-time comparison, so the secret can't be guessed character by character.
const sameSecret = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

route('GET', '/api/config', (game, ctx) => ({
  dev: ctx.dev,
  minMembers: game.minMembers,
  today: game.today(),
  nextDayAt: game.nextDayAt(),
  pushKey: push.publicKey(),
}));
route('POST', '/api/users', (game, ctx) => {
  const user = game.createUser(ctx.body, { withCredentials: true });
  return { token: game.openSession(user), user: game.me(user) };
});
route('POST', '/api/login', (game, ctx) => {
  const { user, token } = game.login(ctx.body);
  return { token, user: game.me(user) };
});
route('POST', '/api/logout', (game, ctx) => game.logout(auth(ctx), ctx.token, ctx.body.endpoint));
route('GET', '/api/me', (game, ctx) => game.me(auth(ctx)));
route('PATCH', '/api/me', (game, ctx) => game.updateUser(auth(ctx), ctx.body));
route('POST', '/api/me/credentials', (game, ctx) => game.setCredentials(auth(ctx), ctx.body));

route('POST', '/api/push/subscribe', (game, ctx) => {
  requirePush();
  return game.addPushSubscription(auth(ctx), ctx.body.subscription);
});
route('POST', '/api/push/unsubscribe', (game, ctx) => game.removePushSubscription(auth(ctx), ctx.body.endpoint));
route('POST', '/api/push/test', (game, ctx) => {
  requirePush();
  ctx.notify = game.testNotifications(auth(ctx));
  return { devices: ctx.notify.length };
});

// Called by Vercel Cron (see vercel.json) with "Authorization: Bearer $CRON_SECRET".
// It runs twice each morning (7:00 and 8:00 UTC = 9:00 Paris in summer and winter);
// the game day only starts at 9:00 Paris and each day is notified once, so one run sends.
const dailyCron = (game, ctx) => {
  const secret = process.env.CRON_SECRET;
  if (!ctx.dev && !(secret && sameSecret(ctx.token, secret))) throw new HttpError(403, 'Accès refusé');
  ctx.notify = game.dailyNotifications();
  return { day: game.today(), notifications: ctx.notify.length };
};
route('GET', '/api/cron/daily/:slot', dailyCron);
route('POST', '/api/cron/daily/:slot', dailyCron);

route('GET', '/api/groups', (game, ctx) => game.listGroups(auth(ctx)));
route('POST', '/api/groups', (game, ctx) => game.createGroup(auth(ctx), ctx.body));
route('POST', '/api/groups/join', (game, ctx) => game.joinGroup(auth(ctx), ctx.body.code));
route('GET', '/api/groups/:id', (game, ctx) => game.groupView(auth(ctx), ctx.params.id));
route('POST', '/api/groups/:id/leave', (game, ctx) => game.leaveGroup(auth(ctx), ctx.params.id));
route('GET', '/api/groups/:id/history', (game, ctx) => game.history(auth(ctx), ctx.params.id));
route('POST', '/api/groups/:id/ask', (game, ctx) => game.ask(auth(ctx), ctx.params.id, ctx.body));

route('POST', '/api/polls/:id/vote', (game, ctx) => game.vote(auth(ctx), ctx.params.id, ctx.body.choice));
route('GET', '/api/polls/:id/comments', (game, ctx) => game.listComments(auth(ctx), ctx.params.id));
route('POST', '/api/polls/:id/comments', (game, ctx) => game.addComment(auth(ctx), ctx.params.id, ctx.body));

route('POST', '/api/dev/next-day', (game, ctx) => {
  devOnly(ctx);
  return { today: game.advanceDay(1) };
});
route('POST', '/api/dev/notify-now', (game, ctx) => {
  devOnly(ctx);
  ctx.notify = game.dailyNotifications({ force: true });
  return { notifications: ctx.notify.length };
});
route('POST', '/api/dev/groups/:id/bots', (game, ctx) => {
  devOnly(ctx);
  return dev.addBot(game, auth(ctx), ctx.params.id);
});
route('POST', '/api/dev/groups/:id/bots/vote', (game, ctx) => {
  devOnly(ctx);
  return dev.botsVote(game, auth(ctx), ctx.params.id);
});

// Runs one API request against a Game. Returns { status, payload, notify }: `notify` lists push
// messages to send once the game state is saved (lib/push.js), so a replayed request never sends twice.
function dispatch(game, { method, pathname, token = '', body = {}, dev: isDev = false }) {
  const match = routes.filter((r) => r.method === method).map((r) => ({ r, m: r.re.exec(pathname) })).find((x) => x.m);
  if (!match) return { status: 404, payload: { error: 'Introuvable' }, notify: [] };
  try {
    const ctx = { params: match.m.groups || {}, body, dev: isDev, token, user: game.userByToken(token) };
    const payload = match.r.handler(game, ctx);
    return { status: 200, payload, notify: ctx.notify || [] };
  } catch (err) {
    if (err instanceof HttpError) return { status: err.status, payload: { error: err.message }, notify: [] };
    console.error(err);
    return { status: 500, payload: { error: 'Une erreur est survenue' }, notify: [] };
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new HttpError(413, 'Requête trop volumineuse'));
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        resolve(body && typeof body === 'object' ? body : {});
      } catch {
        reject(new HttpError(400, 'JSON invalide'));
      }
    });
    req.on('error', reject);
  });
}

const bearer = (req) => (req.headers.authorization || '').replace(/^Bearer\s+/i, '');

function send(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(payload));
}

module.exports = { dispatch, readBody, bearer, send };
