'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createStore } = require('../lib/store');
const { Game } = require('../lib/game');
const { PACKS } = require('../lib/questions');

function setup({ random = () => 0 } = {}) {
  const game = new Game(createStore(null), { now: () => new Date(2026, 9, 29, 12), random });
  const [ana, ben, cleo] = ['Ana', 'Ben', 'Cléo'].map((name) => game.createUser({ name }));
  const group = game.createGroup(ana, { name: 'Crew' });
  return { game, ana, ben, cleo, group };
}

const fill = ({ game, ben, cleo, group }) => {
  game.joinGroup(ben, group.code);
  game.joinGroup(cleo, group.code.toLowerCase());
};

test('a group waits for 3 members before the daily question drops', () => {
  const ctx = setup();
  assert.equal(ctx.group.waiting, true);
  assert.equal(ctx.group.polls.length, 0);
  fill(ctx);
  const view = ctx.game.groupView(ctx.ana, ctx.group.id);
  assert.equal(view.waiting, false);
  assert.equal(view.polls.length, 1);
  assert.equal(view.polls[0].daily, true);
  // the same question is returned on every request of the day
  assert.equal(ctx.game.groupView(ctx.ben, ctx.group.id).polls[0].id, view.polls[0].id);
});

test('results stay hidden until you vote', () => {
  const ctx = setup();
  fill(ctx);
  const { game, ana, ben, group } = ctx;
  const poll = game.groupView(ana, group.id).polls[0];
  assert.equal(poll.type, 'who');
  assert.equal(poll.results, null);

  const res = game.vote(ana, poll.id, ben.id);
  assert.equal(res.poll.results.rows[0].id, ben.id);
  assert.equal(res.poll.results.rows[0].pct, 100);
  assert.deepEqual(res.poll.results.rows[0].voters.map((v) => v.id), [ana.id], 'each row lists who voted for that person');
  assert.ok(res.poll.results.rows.slice(1).every((row) => row.voters.length === 0));
  assert.equal(game.groupView(ben, group.id).polls[0].results, null);

  assert.throws(() => game.vote(ana, poll.id, ben.id), /déjà voté/);
  assert.throws(() => game.vote(ben, poll.id, 'stranger'), /Choisis quelqu’un/);
});

test('questions close at the end of the day and move to history', () => {
  const ctx = setup();
  fill(ctx);
  const { game, ana, cleo, group } = ctx;
  const poll = game.groupView(ana, group.id).polls[0];
  game.advanceDay();
  assert.throws(() => game.vote(cleo, poll.id, ana.id), /fermée/);
  const history = game.history(cleo, group.id);
  assert.equal(history[0].id, poll.id);
  assert.ok(history[0].results, 'closed questions show results to everyone');
  assert.notEqual(game.groupView(ana, group.id).polls[0].id, poll.id);
});

test('streaks grow daily and reset after a missed day', () => {
  const ctx = setup();
  fill(ctx);
  const { game, ana, ben, group } = ctx;
  const voteToday = () => game.vote(ana, game.groupView(ana, group.id).polls[0].id, ben.id);

  voteToday();
  game.advanceDay();
  voteToday();
  assert.equal(game.streakInfo(group.id, ana.id).current, 2);

  game.advanceDay(2); // missed one day
  assert.equal(game.streakInfo(group.id, ana.id).current, 0);
  voteToday();
  const info = game.streakInfo(group.id, ana.id);
  assert.equal(info.current, 1);
  assert.equal(info.best, 2);
});

test('daily questions are drawn from every pack', () => {
  // random() = 0.999 always picks the last unused question in the pool
  const ctx = setup({ random: () => 0.999 });
  fill(ctx);
  const { game, ana, group } = ctx;
  const lastPack = PACKS.at(-1);
  assert.equal(game.groupView(ana, group.id).polls[0].pack.id, lastPack.id);
  assert.ok(game.groupView(ana, group.id).packs.every((p) => !('price' in p)));
});

test('anyone can ask their own question, as often as they like', () => {
  const ctx = setup();
  fill(ctx);
  const { game, ana, ben, group } = ctx;
  for (let i = 0; i < 3; i++) game.ask(ben, group.id, { text: `Who would win round ${i}?` });
  const poll = game.ask(ana, group.id, { type: 'wyr', text: 'Best weekend?', a: 'Beach', b: 'Mountains' }).poll;
  assert.equal(game.groupView(ana, group.id).polls.length, 5);
  const res = game.vote(ben, poll.id, 'b');
  assert.deepEqual(res.poll.results.b.voters.map((v) => v.id), [ben.id]);
  assert.throws(() => game.vote(ana, poll.id, 'c'), /Choisis une/);
  assert.throws(() => game.ask(ana, group.id, { text: 'Hi' }), /trop court/);
});

test('players have no coins', () => {
  const { game, ana } = setup();
  assert.ok(!('coins' in game.me(ana)));
  assert.ok(!('coins' in ana));
});

test('comments require a vote and keep replies one level deep', () => {
  const ctx = setup();
  fill(ctx);
  const { game, ana, ben, group } = ctx;
  const poll = game.groupView(ana, group.id).polls[0];
  assert.throws(() => game.addComment(ana, poll.id, { text: 'hi' }), /Vote d’abord/);
  game.vote(ana, poll.id, ben.id);
  game.vote(ben, poll.id, ana.id);
  const [first] = game.addComment(ana, poll.id, { text: 'Called it' });
  const second = game.addComment(ben, poll.id, { text: 'No way', replyTo: first.id })[1];
  const third = game.addComment(ana, poll.id, { text: 'Yes way', replyTo: second.id })[2];
  assert.equal(second.replyTo, first.id);
  assert.equal(third.replyTo, first.id);
});

test('non-members cannot see a group', () => {
  const { game, group } = setup();
  const outsider = game.createUser({ name: 'Eve' });
  assert.throws(() => game.groupView(outsider, group.id), /introuvable/);
});
