'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createStore } = require('../lib/store');
const { Game } = require('../lib/game');
const { dispatch } = require('../lib/api');

function setup() {
  let clock = new Date(2026, 9, 30, 12).getTime();
  const store = createStore(null);
  const game = new Game(store, { now: () => new Date(clock) });
  const advance = (minutes) => (clock += minutes * 60000);
  return { game, store, advance };
}

const signUp = (game, username = 'enzo.j', password = 'secret123') =>
  game.createUser({ name: 'Enzo', username, password }, { withCredentials: true });

test('sign-up needs a valid, unique pseudo and a long enough password', () => {
  const { game } = setup();
  const user = signUp(game, '  Enzo.J ');
  assert.equal(user.username, 'enzo.j', 'pseudos are trimmed and lower-cased');
  assert.ok(user.passwordHash.startsWith('scrypt$'));
  assert.ok(!JSON.stringify(user).includes('secret123'), 'the password itself is never stored');

  assert.throws(() => signUp(game, 'ENZO.J'), /déjà pris/);
  assert.throws(() => signUp(game, 'ab'), /3 à 20 caractères/);
  assert.throws(() => signUp(game, 'avec espace'), /3 à 20 caractères/);
  assert.throws(() => signUp(game, 'lea', '12345'), /6 caractères minimum/);
});

test('login works from several devices, each with its own session', () => {
  const { game } = setup();
  const user = signUp(game);
  const phone = game.login({ username: 'Enzo.J', password: 'secret123' }).token;
  const laptop = game.login({ username: 'enzo.j', password: 'secret123' }).token;
  assert.notEqual(phone, laptop);
  assert.equal(game.userByToken(phone), user);
  assert.equal(game.userByToken(laptop), user);

  game.logout(user, phone);
  assert.equal(game.userByToken(phone), null, 'signing out closes only that device');
  assert.equal(game.userByToken(laptop), user);
});

test('wrong pseudo and wrong password give the same answer', () => {
  const { game } = setup();
  signUp(game);
  assert.throws(() => game.login({ username: 'enzo.j', password: 'nope-nope' }), /Pseudo ou mot de passe incorrect/);
  assert.throws(() => game.login({ username: 'personne', password: 'secret123' }), /Pseudo ou mot de passe incorrect/);
});

test('5 wrong passwords lock the account for 5 minutes', () => {
  const { game, advance } = setup();
  signUp(game);
  for (let i = 0; i < 5; i++) assert.throws(() => game.login({ username: 'enzo.j', password: 'wrong-pass' }), /incorrect/);
  assert.throws(() => game.login({ username: 'enzo.j', password: 'secret123' }), /Trop d’essais/, 'even the right password waits');
  advance(5);
  assert.ok(game.login({ username: 'enzo.j', password: 'secret123' }).token);
});

test('sessions survive a reload of the stored data', () => {
  const { game, store } = setup();
  const user = signUp(game);
  const token = game.openSession(user);
  const reloaded = new Game(createStore(null), {});
  Object.assign(reloaded.db, JSON.parse(JSON.stringify(store.data)));
  const fresh = new Game({ data: reloaded.db, save() {} });
  assert.equal(fresh.userByToken(token).id, user.id);
});

test('players from before logins keep their token and add a pseudo and password once', () => {
  const { game } = setup();
  // an old account: a single token, no pseudo or password
  const old = game.createUser({ name: 'Ana' });
  old.token = 'legacy-token';
  const g2 = new Game({ data: game.db, save() {} });
  const ana = g2.userByToken('legacy-token');
  assert.equal(g2.me(ana).needsCredentials, true);

  assert.throws(() => g2.setCredentials(ana, { password: 'secret123' }), /3 à 20 caractères/, 'a pseudo is required');
  const me = g2.setCredentials(ana, { username: 'ana', password: 'secret123' });
  assert.equal(me.needsCredentials, false);
  assert.equal(me.username, 'ana');
  assert.equal(g2.userByToken('legacy-token'), ana, 'still signed in on the original device');
  assert.ok(g2.login({ username: 'ana', password: 'secret123' }).token);
});

test('changing the password needs the current one', () => {
  const { game } = setup();
  const user = signUp(game);
  assert.throws(() => game.setCredentials(user, { password: 'newpass123' }), /actuel incorrect/);
  game.setCredentials(user, { currentPassword: 'secret123', password: 'newpass123' });
  assert.ok(game.login({ username: 'enzo.j', password: 'newpass123' }).token);
  assert.throws(() => game.login({ username: 'enzo.j', password: 'secret123' }), /incorrect/);
});

test('an admin reset sets a new password and signs out every device', () => {
  const { game } = setup();
  const user = signUp(game);
  const token = game.openSession(user);
  game.resetPassword('ENZO.J', 'fresh-pass');
  assert.equal(game.userByToken(token), null);
  assert.ok(game.login({ username: 'enzo.j', password: 'fresh-pass' }).token);
  assert.throws(() => game.resetPassword('nobody', 'fresh-pass'), /Aucun compte/);
});

test('API: sign up, log in elsewhere, log out', () => {
  const { game } = setup();
  const call = (method, pathname, body, token) => dispatch(game, { method, pathname, body, token });
  assert.equal(call('POST', '/api/users', { name: 'Léa' }).status, 400, 'pseudo and password are required');
  const created = call('POST', '/api/users', { name: 'Léa', username: 'lea', password: 'secret123' });
  assert.equal(created.status, 200);
  assert.equal(created.payload.user.username, 'lea');
  assert.equal(created.payload.user.needsCredentials, false);

  const bad = call('POST', '/api/login', { username: 'lea', password: 'nope-nope' });
  assert.equal(bad.status, 403, 'not 401, so the browser does not drop whoever is signed in');
  const other = call('POST', '/api/login', { username: 'lea', password: 'secret123' });
  assert.equal(call('GET', '/api/me', null, other.payload.token).payload.name, 'Léa');

  assert.equal(call('POST', '/api/logout', {}, other.payload.token).status, 200);
  assert.equal(call('GET', '/api/me', null, other.payload.token).status, 401);
  assert.equal(call('GET', '/api/me', null, created.payload.token).status, 200, 'the first device is still signed in');
});
