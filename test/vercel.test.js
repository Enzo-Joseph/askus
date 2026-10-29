'use strict';

// Runs the Vercel function against an in-memory imitation of Upstash's REST API.

const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('stream');

process.env.KV_REST_API_URL = 'https://fake-upstash.test';
process.env.KV_REST_API_TOKEN = 'secret';
process.env.MIN_MEMBERS = '3';

const handler = require('../api/index');

// --- fake Upstash: GET/pipeline and the compare-and-set EVAL, each answered after a tick
// so that concurrent requests genuinely interleave.
const redis = new Map();
let saves = 0;
const tick = () => new Promise((r) => setImmediate(r));
function run([cmd, ...args]) {
  if (cmd === 'GET') return { result: redis.has(args[0]) ? redis.get(args[0]) : null };
  if (cmd === 'EVAL') {
    const [, , key, versionKey, json, expected] = args;
    const current = redis.get(versionKey) ?? '0';
    if (current !== expected) return { result: 0 };
    redis.set(key, json);
    redis.set(versionKey, String(Number(current) + 1));
    saves++;
    return { result: 1 };
  }
  return { error: `unsupported ${cmd}` };
}
global.fetch = async (url, { headers, body }) => {
  await tick();
  assert.equal(headers.Authorization, 'Bearer secret');
  const parsed = JSON.parse(body);
  const result = url.endsWith('/pipeline') ? parsed.map(run) : run(parsed);
  return { ok: true, json: async () => result };
};

function call(method, path, { token, body } = {}) {
  const req = Readable.from(body ? [Buffer.from(JSON.stringify(body))] : []);
  Object.assign(req, { method, url: path, headers: token ? { authorization: `Bearer ${token}` } : {} });
  return new Promise((resolve) => {
    const res = {
      writeHead(status) {
        this.status = status;
        return this;
      },
      end(payload) {
        resolve({ status: this.status, body: JSON.parse(payload) });
      },
    };
    handler(req, res);
  });
}

test('the API works end to end with data kept in Redis', async () => {
  const players = [];
  for (const name of ['Ana', 'Ben', 'Cléo']) {
    const { status, body } = await call('POST', '/api/users', { body: { name } });
    assert.equal(status, 200);
    players.push(body);
  }
  const [ana, ben, cleo] = players;
  const group = (await call('POST', '/api/groups', { token: ana.token, body: { name: 'Crew' } })).body;
  for (const p of [ben, cleo]) await call('POST', '/api/groups/join', { token: p.token, body: { code: group.code } });

  const view = (await call('GET', `/api/groups/${group.id}`, { token: ana.token })).body;
  assert.equal(view.polls.length, 1, 'daily question was created and saved by a GET');
  const again = (await call('GET', `/api/groups/${group.id}`, { token: ben.token })).body;
  assert.equal(again.polls[0].id, view.polls[0].id, 'same daily question on the next request');

  // two friends vote at the same moment: both votes must survive
  const poll = view.polls[0];
  const choose = (who) => (poll.type === 'who' ? ana.user.id : 'a');
  const before = saves;
  const results = await Promise.all([
    call('POST', `/api/polls/${poll.id}/vote`, { token: ben.token, body: { choice: choose(ben) } }),
    call('POST', `/api/polls/${poll.id}/vote`, { token: cleo.token, body: { choice: choose(cleo) } }),
  ]);
  assert.deepEqual(results.map((r) => r.status), [200, 200]);
  assert.equal(saves - before, 2);
  const after = (await call('GET', `/api/groups/${group.id}`, { token: ana.token })).body;
  assert.equal(after.polls[0].voteCount, 2);
});

test('errors come back as JSON with the right status', async () => {
  assert.equal((await call('GET', '/api/me')).status, 401);
  assert.equal((await call('GET', '/api/nope')).status, 404);
  assert.equal((await call('POST', '/api/dev/next-day')).status, 404, 'dev routes are off on Vercel');
});
