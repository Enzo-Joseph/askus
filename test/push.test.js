'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const webpush = require('web-push');
const { createStore } = require('../lib/store');
const { Game } = require('../lib/game');
const { dispatch } = require('../lib/api');
const push = require('../lib/push');

const sub = (n) => ({ endpoint: `https://push.example/${n}`, keys: { p256dh: `p256dh-${n}`, auth: `auth-${n}` } });

// clock in UTC; October 2026 is winter time, so Paris = UTC+1
function setup(iso = '2026-10-30T10:00:00Z') {
  let now = new Date(iso);
  const game = new Game(createStore(null), { now: () => now, random: () => 0 });
  const [ana, ben, cleo] = ['Ana', 'Ben', 'Cléo'].map((name) => game.createUser({ name }));
  const group = game.createGroup(ana, { name: 'Crew' });
  game.joinGroup(ben, group.code);
  game.joinGroup(cleo, group.code);
  return { game, ana, ben, cleo, group, setNow: (s) => (now = new Date(s)) };
}

test('the game day starts at 9:00 Paris time', () => {
  const { game, setNow } = setup('2026-10-30T07:59:00Z'); // 08:59 in Paris
  assert.equal(game.today(), '2026-10-29');
  setNow('2026-10-30T08:00:00Z'); // 09:00 in Paris
  assert.equal(game.today(), '2026-10-30');
  setNow('2026-07-01T07:00:00Z'); // 09:00 in Paris, summer time
  assert.equal(game.today(), '2026-07-01');
});

test('the next question time is always 9:00 in Paris', () => {
  const { game, setNow } = setup('2026-10-30T07:30:00Z');
  assert.equal(new Date(game.nextDayAt()).toISOString(), '2026-10-30T08:00:00.000Z');
  setNow('2026-10-30T08:00:00Z');
  assert.equal(new Date(game.nextDayAt()).toISOString(), '2026-10-31T08:00:00.000Z');
  setNow('2026-10-24T20:00:00Z'); // clocks go back overnight
  assert.equal(new Date(game.nextDayAt()).toISOString(), '2026-10-25T08:00:00.000Z');
});

test('daily notifications: today’s question to every subscribed member, once per day', () => {
  const { game, ana, ben, group, setNow } = setup();
  game.addPushSubscription(ana, sub(1));
  game.addPushSubscription(ana, sub(2)); // a second device
  game.addPushSubscription(ben, sub(3));

  const messages = game.dailyNotifications();
  assert.equal(messages.length, 3);
  const poll = game.groupView(ana, group.id).polls[0];
  assert.deepEqual(messages[0].payload, {
    title: 'Crew',
    body: `${poll.prefix} ${poll.text}`,
    url: `/#/g/${group.id}`,
    tag: `daily-${group.id}`,
  });
  assert.deepEqual(game.dailyNotifications(), [], 'not twice the same day');

  setNow('2026-10-31T07:30:00Z'); // 8:30 next morning: still yesterday's game day
  assert.deepEqual(game.dailyNotifications(), []);
  setNow('2026-10-31T08:05:00Z'); // 9:05
  const next = game.dailyNotifications();
  assert.equal(next.length, 3);
  assert.notEqual(next[0].payload.body, messages[0].payload.body, 'a new question');
});

test('groups still waiting for players get no notification', () => {
  const game = new Game(createStore(null), { now: () => new Date('2026-10-30T10:00:00Z') });
  const solo = game.createUser({ name: 'Solo' });
  game.createGroup(solo, { name: 'Alone' });
  game.addPushSubscription(solo, sub(1));
  assert.deepEqual(game.dailyNotifications(), []);
});

test('a device belongs to one player; dead and signed-out devices are dropped', () => {
  const { game, ana, ben } = setup();
  game.addPushSubscription(ana, sub(1));
  game.addPushSubscription(ben, sub(1)); // Ben takes over the shared phone
  assert.deepEqual(game.me(ana).push, []);
  assert.deepEqual(game.me(ben).push, [sub(1).endpoint]);

  assert.throws(() => game.addPushSubscription(ana, { endpoint: 'http://insecure', keys: {} }), /invalide/);

  game.addPushSubscription(ana, sub(2));
  game.removePushEndpoints([sub(2).endpoint]);
  assert.deepEqual(game.me(ana).push, []);

  const token = game.openSession(ben);
  game.logout(ben, token, sub(1).endpoint);
  assert.deepEqual(game.me(ben).push, []);
});

test('sendAll reports subscriptions the push service says are gone', async (t) => {
  const keys = webpush.generateVAPIDKeys();
  process.env.VAPID_PUBLIC_KEY = keys.publicKey;
  process.env.VAPID_PRIVATE_KEY = keys.privateKey;
  const sent = [];
  t.mock.method(webpush, 'sendNotification', async (subscription, body) => {
    sent.push(JSON.parse(body));
    if (subscription.endpoint.endsWith('/gone')) throw Object.assign(new Error('Gone'), { statusCode: 410 });
    return { statusCode: 201 };
  });
  const gone = await push.sendAll([
    { subscription: sub('ok'), payload: { title: 'A' } },
    { subscription: sub('gone'), payload: { title: 'B' } },
  ]);
  assert.deepEqual(gone, [sub('gone').endpoint]);
  assert.deepEqual(sent.map((p) => p.title), ['A', 'B']);
});

test('the cron route needs the secret (except in dev mode)', () => {
  const { game, ana } = setup();
  game.addPushSubscription(ana, sub(1));
  process.env.CRON_SECRET = 'cron-secret-123';
  const call = (token, dev = false) => dispatch(game, { method: 'GET', pathname: '/api/cron/daily/winter', token, dev });

  assert.equal(call('').status, 403);
  assert.equal(call('wrong-secret-123').status, 403);
  const ok = call('cron-secret-123');
  assert.equal(ok.status, 200);
  assert.equal(ok.notify.length, 1);
  assert.equal(call('cron-secret-123').notify.length, 0, 'the second morning run sends nothing');
  assert.equal(call('', true).status, 200, 'dev mode can trigger it without the secret');
  delete process.env.CRON_SECRET;
});
