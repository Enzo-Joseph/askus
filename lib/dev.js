'use strict';

// Dev-mode helpers (npm run dev): fake friends to test a group alone.

const BOT_NAMES = ['Max', 'Lou', 'Sam', 'Noa', 'Kim', 'Eli', 'Jo', 'Ada', 'Tom', 'Zoe'];
const BOT_AVATARS = ['cat', 'frog', 'bunny', 'bear', 'chick', 'ghost', 'slime', 'robot', 'mushroom', 'penguin', 'fox', 'kitty'];
const BOT_COLORS = ['#c9d3e6', '#e2cfdc', '#cfe0d6', '#e6d3c3', '#e3dfc2', '#e6c9c4', '#d6d0e6', '#d9d9d6'];

const pick = (list, random) => list[Math.floor(random() * list.length)];

function groupBots(game, group) {
  return group.members.map((id) => game.db.users[id]).filter((u) => u && u.bot);
}

// Adds a bot to the group, then lets every bot answer today's open questions.
function addBot(game, user, groupId) {
  const group = game.memberGroup(user, groupId);
  const taken = new Set(group.members.map((id) => game.db.users[id]?.name));
  const name = BOT_NAMES.find((n) => !taken.has(n)) || `Bot ${group.members.length}`;
  const bot = game.createUser({ name, avatar: pick(BOT_AVATARS, game.random), color: pick(BOT_COLORS, game.random) });
  bot.bot = true;
  game.joinGroup(bot, group.code);
  botsVote(game, user, groupId);
  return game.groupView(user, groupId);
}

// Every bot votes at random on each of today's questions it hasn't answered yet.
function botsVote(game, user, groupId) {
  const group = game.memberGroup(user, groupId);
  game.ensureDailyPoll(group);
  for (const bot of groupBots(game, group)) {
    for (const poll of game.todayPolls(group)) {
      if (bot.id in poll.votes) continue;
      const choice = game.resolve(poll).type === 'who' ? pick(group.members, game.random) : pick(['a', 'b'], game.random);
      game.vote(bot, poll.id, choice);
    }
  }
  return game.groupView(user, groupId);
}

module.exports = { addBot, botsVote };
