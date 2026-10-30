'use strict';

// Local server: static files + the JSON API, with data kept in a JSON file.
// On Vercel, api/index.js serves the API instead (see README).

const http = require('http');
const fs = require('fs');
const path = require('path');
const { createStore } = require('./lib/store');
const { Game, HttpError } = require('./lib/game');
const { dispatch, readBody, bearer, send } = require('./lib/api');
const push = require('./lib/push');

const PORT = Number(process.env.PORT) || 3000;
const DEV = process.argv.includes('--dev') || process.env.DEV === '1';
// Dev mode gets its own database so bots and skipped days never touch the real game.
const DB_FILE = process.env.DB_FILE || path.join(__dirname, 'data', DEV ? 'dev-db.json' : 'db.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

// Push keys: from the environment (as on Vercel), or generated once and kept next to the data.
function ensurePushKeys() {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) return;
  const file = path.join(path.dirname(DB_FILE), 'vapid.json');
  let keys;
  try {
    keys = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    keys = require('web-push').generateVAPIDKeys();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(keys));
  }
  process.env.VAPID_PUBLIC_KEY = keys.publicKey;
  process.env.VAPID_PRIVATE_KEY = keys.privateKey;
}
ensurePushKeys();

const store = createStore(DB_FILE);
const game = new Game(store, { minMembers: Number(process.env.MIN_MEMBERS) || (DEV ? 1 : 3) });

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
};

async function handleApi(req, res, pathname) {
  let body = {};
  if (req.method !== 'GET') {
    try {
      body = await readBody(req);
    } catch (err) {
      return send(res, err instanceof HttpError ? err.status : 400, { error: err.message });
    }
  }
  const { status, payload, notify } = dispatch(game, { method: req.method, pathname, token: bearer(req), body, dev: DEV });
  if (req.method !== 'GET') store.save();
  await sendPushes(notify);
  send(res, status, payload);
}

async function sendPushes(messages) {
  const gone = await push.sendAll(messages);
  if (gone.length) {
    game.removePushEndpoints(gone);
    store.save();
  }
}

// What Vercel Cron does in production: once the game day starts (9:00 Paris), notify everyone once.
async function dailyJob() {
  const messages = game.dailyNotifications();
  store.save();
  await sendPushes(messages).catch((err) => console.error('daily notifications failed:', err));
}

function serveStatic(req, res, pathname) {
  let file;
  try {
    file = path.normalize(path.join(PUBLIC_DIR, decodeURIComponent(pathname)));
  } catch {
    res.writeHead(400).end();
    return;
  }
  if (file !== PUBLIC_DIR && !file.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403).end();
    return;
  }
  if (pathname === '/' || !path.extname(file)) file = path.join(PUBLIC_DIR, 'index.html');
  fs.readFile(file, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Introuvable');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(content);
  });
}

const server = http.createServer((req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  if (pathname.startsWith('/api/')) handleApi(req, res, pathname);
  else if (req.method === 'GET' || req.method === 'HEAD') serveStatic(req, res, pathname);
  else res.writeHead(405).end();
});

setInterval(dailyJob, 60 * 1000);
dailyJob();

server.listen(PORT, () => {
  console.log(`askUs running on http://localhost:${PORT}`);
  if (DEV) console.log(`dev mode: solo groups allowed, bots and "next day" enabled, data in ${path.relative(__dirname, DB_FILE)}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    store.flush();
    process.exit(0);
  });
}
