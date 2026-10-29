'use strict';

// JSON API shared by the local server (server.js) and the Vercel function (api/index.js).

const { HttpError } = require('./game');
const dev = require('./dev');

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

route('GET', '/api/config', (game, ctx) => ({ dev: ctx.dev, minMembers: game.minMembers, today: game.today() }));
route('POST', '/api/users', (game, ctx) => {
  const user = game.createUser(ctx.body);
  return { token: user.token, user: game.me(user) };
});
route('GET', '/api/me', (game, ctx) => game.me(auth(ctx)));
route('PATCH', '/api/me', (game, ctx) => game.updateUser(auth(ctx), ctx.body));

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
route('POST', '/api/dev/groups/:id/bots', (game, ctx) => {
  devOnly(ctx);
  return dev.addBot(game, auth(ctx), ctx.params.id);
});
route('POST', '/api/dev/groups/:id/bots/vote', (game, ctx) => {
  devOnly(ctx);
  return dev.botsVote(game, auth(ctx), ctx.params.id);
});

// Runs one API request against a Game. Returns { status, payload }.
function dispatch(game, { method, pathname, token = '', body = {}, dev: isDev = false }) {
  const match = routes.filter((r) => r.method === method).map((r) => ({ r, m: r.re.exec(pathname) })).find((x) => x.m);
  if (!match) return { status: 404, payload: { error: 'Introuvable' } };
  try {
    const ctx = { params: match.m.groups || {}, body, dev: isDev, user: game.userByToken(token) };
    return { status: 200, payload: match.r.handler(game, ctx) };
  } catch (err) {
    if (err instanceof HttpError) return { status: err.status, payload: { error: err.message } };
    console.error(err);
    return { status: 500, payload: { error: 'Une erreur est survenue' } };
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
