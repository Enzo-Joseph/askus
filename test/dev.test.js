'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createStore } = require('../lib/store');
const { Game } = require('../lib/game');
const dev = require('../lib/dev');

function soloGame() {
  const game = new Game(createStore(null), { now: () => new Date(2026, 9, 29, 12), minMembers: 1, random: () => 0 });
  const me = game.createUser({ name: 'Ana' });
  const group = game.createGroup(me, { name: 'Test' });
  return { game, me, group };
}

test('with minMembers 1 a solo group gets its daily question right away', () => {
  const { group } = soloGame();
  assert.equal(group.waiting, false);
  assert.equal(group.polls.length, 1);
});

test('bots join with distinct names and vote on open questions', () => {
  const { game, me, group } = soloGame();
  dev.addBot(game, me, group.id);
  const view = dev.addBot(game, me, group.id);
  assert.equal(view.members.length, 3);
  assert.equal(new Set(view.members.map((m) => m.name)).size, 3);
  assert.equal(view.polls[0].voteCount, 2, 'both bots answered the daily question');
  assert.equal(view.polls[0].results, null, 'my own results stay hidden until I vote');
});

test('bots answer questions asked after they joined', () => {
  const { game, me, group } = soloGame();
  dev.addBot(game, me, group.id);
  const { poll } = game.ask(me, group.id, { type: 'wyr', text: 'Tea or coffee?', a: 'Tea', b: 'Coffee' });
  assert.equal(poll.voteCount, 0);
  const view = dev.botsVote(game, me, group.id);
  assert.equal(view.polls.find((p) => p.id === poll.id).voteCount, 1);
  // voting again is a no-op rather than an error
  dev.botsVote(game, me, group.id);
});
