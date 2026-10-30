'use strict';

const crypto = require('crypto');
const { PACKS, findPack, findQuestion, fr } = require('./questions');
const auth = require('./auth');

const LIMITS = Object.freeze({ name: 20, groupName: 30, question: 140, option: 40, comment: 300, members: 30 });
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const COLOR_RE = /^#[0-9a-f]{6}$/i;
const MAX_SESSIONS = 10; // devices logged in at once, per account
const LOGIN_LOCK = Object.freeze({ attempts: 5, minutes: 5 });

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const fail = (status, message) => {
  throw new HttpError(status, message);
};

const newId = () => crypto.randomBytes(8).toString('hex');

// The calendar day (YYYY-MM-DD) in the game's timezone, so "today" doesn't depend on where the server runs.
function dayKey(d, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
  const get = (type) => parts.find((p) => p.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function addDays(key, n) {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function cleanText(value, max, field, min = 1) {
  if (typeof value !== 'string') fail(400, `${field} : champ obligatoire`);
  const text = value.replace(/\s+/g, ' ').trim();
  if (text.length < min) fail(400, min > 1 ? `${field} : texte trop court` : `${field} : champ obligatoire`);
  if (text.length > max) fail(400, `${field} : ${max} caractères maximum`);
  return text;
}

// Avatars and group icons are sprite ids (older data may still hold an emoji).
const cleanIcon = (value, fallback) =>
  typeof value === 'string' && value.trim() && value.length <= 16 ? value.trim() : fallback;

const pct = (n, total) => (total ? Math.round((n / total) * 100) : 0);

class Game {
  constructor(store, { now = () => new Date(), minMembers = 3, random = Math.random, timeZone = process.env.APP_TIMEZONE || 'Europe/Paris' } = {}) {
    this.store = store;
    this.db = store.data;
    this.now = now;
    this.minMembers = minMembers;
    this.random = random;
    this.timeZone = timeZone;
    for (const key of ['users', 'groups', 'polls', 'comments', 'streaks']) this.db[key] ??= {};
    this.db.meta ??= { dayOffset: 0 };
    this.tokens = new Map();
    for (const u of Object.values(this.db.users)) {
      if (u.token) this.tokens.set(u.token, u.id); // accounts created before logins existed
      for (const s of u.sessions || []) this.tokens.set(s.token, u.id);
    }
  }

  // ---- time -------------------------------------------------------------

  today() {
    return addDays(dayKey(this.now(), this.timeZone), this.db.meta.dayOffset || 0);
  }

  advanceDay(n = 1) {
    this.db.meta.dayOffset = (this.db.meta.dayOffset || 0) + n;
    return this.today();
  }

  // ---- users ------------------------------------------------------------

  // Players sign up with a pseudo and password (withCredentials); dev bots and tests may skip them.
  createUser({ name, avatar, color, username, password } = {}, { withCredentials = false } = {}) {
    const user = {
      id: newId(),
      name: cleanText(name, LIMITS.name, 'Nom'),
      avatar: cleanIcon(avatar, 'cat'),
      color: COLOR_RE.test(color) ? color : '#c9d3e6',
      sessions: [],
      createdAt: Date.now(),
    };
    if (withCredentials) {
      user.username = this.availableUsername(username);
      user.passwordHash = auth.hashPassword(this.checkPassword(password));
    }
    this.db.users[user.id] = user;
    return user;
  }

  // ---- accounts ---------------------------------------------------------

  findByUsername(username) {
    const wanted = auth.normalizeUsername(username);
    return (wanted && Object.values(this.db.users).find((u) => u.username === wanted)) || null;
  }

  availableUsername(value, self = null) {
    const username = auth.normalizeUsername(value);
    if (!auth.USERNAME_RE.test(username)) fail(400, 'Pseudo : 3 à 20 caractères, lettres, chiffres, point, tiret ou _');
    const owner = this.findByUsername(username);
    if (owner && owner !== self) fail(409, 'Ce pseudo est déjà pris');
    return username;
  }

  checkPassword(password) {
    if (typeof password !== 'string' || password.length < auth.PASSWORD_MIN) fail(400, `Mot de passe : ${auth.PASSWORD_MIN} caractères minimum`);
    if (password.length > auth.PASSWORD_MAX) fail(400, `Mot de passe : ${auth.PASSWORD_MAX} caractères maximum`);
    return password;
  }

  // A new device session; the oldest ones are dropped beyond MAX_SESSIONS.
  openSession(user) {
    user.sessions ??= [];
    const token = auth.newToken();
    user.sessions.push({ token, createdAt: Date.now() });
    while (user.sessions.length > MAX_SESSIONS) this.tokens.delete(user.sessions.shift().token);
    this.tokens.set(token, user.id);
    return token;
  }

  login({ username, password } = {}) {
    const user = this.findByUsername(username);
    const now = this.now().getTime();
    if (user?.loginLock?.until > now) fail(429, 'Trop d’essais. Réessaie dans quelques minutes.');
    const ok = auth.verifyPassword(password, user?.passwordHash || auth.DUMMY_HASH) && Boolean(user?.passwordHash);
    if (!ok) {
      if (user) {
        const failures = (user.loginLock?.failures || 0) + 1;
        user.loginLock = failures >= LOGIN_LOCK.attempts ? { failures: 0, until: now + LOGIN_LOCK.minutes * 60000 } : { failures };
      }
      // 403 rather than 401: a wrong password must not sign out the player already using this device
      fail(403, 'Pseudo ou mot de passe incorrect');
    }
    delete user.loginLock;
    return { user, token: this.openSession(user) };
  }

  logout(user, token) {
    user.sessions = (user.sessions || []).filter((s) => s.token !== token);
    if (user.token === token) delete user.token;
    this.tokens.delete(token);
    return { ok: true };
  }

  // Sets a pseudo/password (accounts made before logins existed) or changes them.
  setCredentials(user, { username, password, currentPassword } = {}) {
    if (user.passwordHash && !auth.verifyPassword(currentPassword, user.passwordHash)) fail(403, 'Mot de passe actuel incorrect');
    if (username !== undefined || !user.username) user.username = this.availableUsername(username, user);
    if (password !== undefined || !user.passwordHash) user.passwordHash = auth.hashPassword(this.checkPassword(password));
    return this.me(user);
  }

  // Admin reset (scripts/reset-password.js): new password, every device signed out.
  resetPassword(username, password) {
    const user = this.findByUsername(username);
    if (!user) fail(404, `Aucun compte avec le pseudo « ${auth.normalizeUsername(username)} »`);
    user.passwordHash = auth.hashPassword(this.checkPassword(password));
    for (const s of user.sessions || []) this.tokens.delete(s.token);
    if (user.token) this.tokens.delete(user.token);
    user.sessions = [];
    delete user.token;
    delete user.loginLock;
    return user;
  }

  userByToken(token) {
    const id = token && this.tokens.get(token);
    return (id && this.db.users[id]) || null;
  }

  updateUser(user, { name, avatar, color } = {}) {
    if (name !== undefined) user.name = cleanText(name, LIMITS.name, 'Nom');
    if (avatar !== undefined) user.avatar = cleanIcon(avatar, user.avatar);
    if (color !== undefined && COLOR_RE.test(color)) user.color = color;
    return this.me(user);
  }

  me(user) {
    return { ...this.publicUser(user), username: user.username || null, needsCredentials: !user.passwordHash };
  }

  publicUser(user) {
    if (!user) return { id: null, name: 'Ancien membre', avatar: 'ghost', color: '#d9d9d6' };
    return { id: user.id, name: user.name, avatar: user.avatar, color: user.color };
  }

  // ---- groups -----------------------------------------------------------

  uniqueCode() {
    const taken = new Set(Object.values(this.db.groups).map((g) => g.code));
    let code;
    do {
      code = Array.from(crypto.randomBytes(6), (b) => CODE_CHARS[b % CODE_CHARS.length]).join('');
    } while (taken.has(code));
    return code;
  }

  memberGroup(user, groupId) {
    const group = this.db.groups[groupId];
    if (!group || !group.members.includes(user.id)) fail(404, 'Groupe introuvable');
    return group;
  }

  createGroup(user, { name, icon } = {}) {
    const group = {
      id: newId(),
      code: this.uniqueCode(),
      name: cleanText(name, LIMITS.groupName, 'Nom du groupe'),
      icon: cleanIcon(icon, 'chat'),
      members: [user.id],
      used: [],
      daily: {},
      polls: [],
      createdBy: user.id,
      createdAt: Date.now(),
      lastActivity: Date.now(),
    };
    this.db.groups[group.id] = group;
    return this.groupView(user, group.id);
  }

  joinGroup(user, code) {
    const wanted = String(code || '').trim().toUpperCase();
    const group = Object.values(this.db.groups).find((g) => g.code === wanted);
    if (!group) fail(404, 'Aucun groupe avec ce code');
    if (!group.members.includes(user.id)) {
      if (group.members.length >= LIMITS.members) fail(409, 'Ce groupe est complet');
      group.members.push(user.id);
      group.lastActivity = Date.now();
    }
    return this.groupView(user, group.id);
  }

  leaveGroup(user, groupId) {
    const group = this.memberGroup(user, groupId);
    group.members = group.members.filter((id) => id !== user.id);
    return { ok: true };
  }

  listGroups(user) {
    return Object.values(this.db.groups)
      .filter((g) => g.members.includes(user.id))
      .map((g) => {
        const daily = this.ensureDailyPoll(g);
        const pending = this.todayPolls(g).filter((p) => !(user.id in p.votes)).length;
        return {
          id: g.id,
          name: g.name,
          icon: g.icon ?? g.emoji,
          memberCount: g.members.length,
          members: g.members.slice(0, 5).map((id) => this.publicUser(this.db.users[id])),
          waiting: g.members.length < this.minMembers,
          pending,
          question: daily ? this.resolve(daily) : null,
          streak: this.streakInfo(g.id, user.id),
          lastActivity: g.lastActivity,
        };
      })
      .sort((a, b) => b.pending - a.pending || b.lastActivity - a.lastActivity);
  }

  groupView(user, groupId) {
    const group = this.memberGroup(user, groupId);
    this.ensureDailyPoll(group);
    return {
      id: group.id,
      name: group.name,
      icon: group.icon ?? group.emoji,
      code: group.code,
      today: this.today(),
      minMembers: this.minMembers,
      waiting: group.members.length < this.minMembers,
      members: this.memberStats(group, user),
      polls: this.todayPolls(group).map((p) => this.pollView(user, p, group)),
      streak: this.streakInfo(group.id, user.id),
      packs: this.packCatalog(),
    };
  }

  memberStats(group, viewer) {
    const today = this.today();
    const wins = {};
    for (const poll of this.groupPolls(group)) {
      if (poll.date === today) continue; // no spoilers for questions still open
      const q = this.resolve(poll);
      if (q.type !== 'who') continue;
      const counts = this.countVotes(poll);
      const max = Math.max(0, ...Object.values(counts));
      if (!max) continue;
      for (const [id, n] of Object.entries(counts)) if (n === max) wins[id] = (wins[id] || 0) + 1;
    }
    return group.members
      .map((id) => ({
        ...this.publicUser(this.db.users[id]),
        me: id === viewer.id,
        streak: this.streakInfo(group.id, id).current,
        wins: wins[id] || 0,
      }))
      .sort((a, b) => b.wins - a.wins || b.streak - a.streak || a.name.localeCompare(b.name));
  }

  // ---- packs ------------------------------------------------------------

  packCatalog() {
    return PACKS.map((p) => ({
      id: p.id,
      name: p.name,
      icon: p.icon,
      color: p.color,
      description: p.description,
      count: p.questions.length,
      samples: p.questions.slice(0, 3).map((q) => (q.type === 'who' ? `${p.prefix} ${q.text}` : q.text)),
    }));
  }

  // ---- polls ------------------------------------------------------------

  groupPolls(group) {
    return group.polls.map((id) => this.db.polls[id]).filter(Boolean);
  }

  todayPolls(group) {
    const today = this.today();
    return this.groupPolls(group)
      .filter((p) => p.date === today)
      .sort((a, b) => Number(b.daily) - Number(a.daily) || a.createdAt - b.createdAt);
  }

  createPoll(group, { qid = null, custom = null, daily = false, authorId = null }) {
    const poll = {
      id: newId(),
      groupId: group.id,
      date: this.today(),
      daily,
      qid,
      custom,
      authorId,
      votes: {},
      createdAt: Date.now(),
    };
    this.db.polls[poll.id] = poll;
    group.polls.push(poll.id);
    group.lastActivity = Date.now();
    return poll;
  }

  ensureDailyPoll(group) {
    if (group.members.length < this.minMembers) return null;
    const today = this.today();
    const existing = this.db.polls[group.daily[today]];
    if (existing) return existing;
    const question = this.pickQuestion(group);
    const poll = this.createPoll(group, { qid: question.id, daily: true });
    group.daily[today] = poll.id;
    this.store.save();
    return poll;
  }

  // Every pack is in the rotation; questions don't repeat until the whole pool is used.
  pickQuestion(group) {
    const pool = PACKS.flatMap((p) => p.questions);
    let fresh = pool.filter((q) => !group.used.includes(q.id));
    if (!fresh.length) {
      group.used = [];
      fresh = pool;
    }
    const question = fresh[Math.floor(this.random() * fresh.length)];
    group.used.push(question.id);
    return question;
  }

  resolve(poll) {
    // Players write their whole question themselves, so only this-or-that gets a prompt above it.
    if (poll.custom) return { ...poll.custom, prefix: poll.custom.type === 'who' ? '' : fr('Tu es de quel côté ?'), pack: null };
    const q = findQuestion(poll.qid);
    if (!q) return { type: 'who', prefix: 'Qui a le plus de chances de…', text: fr('être le meilleur pote du monde ?'), pack: null };
    const pack = findPack(q.packId);
    return {
      type: q.type,
      prefix: pack.prefix,
      text: q.text,
      a: q.a,
      b: q.b,
      pack: { id: pack.id, name: pack.name, icon: pack.icon, color: pack.color },
    };
  }

  countVotes(poll) {
    const counts = {};
    for (const choice of Object.values(poll.votes)) counts[choice] = (counts[choice] || 0) + 1;
    return counts;
  }

  results(poll, q, group) {
    const total = Object.keys(poll.votes).length;
    const counts = this.countVotes(poll);
    const votersFor = (choice) =>
      Object.entries(poll.votes)
        .filter(([, c]) => c === choice)
        .map(([id]) => this.publicUser(this.db.users[id]));
    if (q.type === 'wyr') {
      const side = (key) => ({ votes: counts[key] || 0, pct: pct(counts[key] || 0, total), voters: votersFor(key) });
      return { total, a: side('a'), b: side('b') };
    }
    const ids = new Set([...group.members, ...Object.keys(counts)]);
    const max = Math.max(0, ...Object.values(counts));
    const rows = [...ids]
      .map((id) => ({
        ...this.publicUser(this.db.users[id]),
        votes: counts[id] || 0,
        pct: pct(counts[id] || 0, total),
        top: max > 0 && counts[id] === max,
        voters: votersFor(id),
      }))
      .sort((a, b) => b.votes - a.votes || a.name.localeCompare(b.name));
    return { total, rows };
  }

  pollView(user, poll, group) {
    const q = this.resolve(poll);
    const open = poll.date === this.today();
    const myVote = poll.votes[user.id] ?? null;
    const canSee = myVote !== null || !open;
    return {
      id: poll.id,
      date: poll.date,
      daily: poll.daily,
      open,
      type: q.type,
      prefix: q.prefix,
      text: q.text,
      a: q.a,
      b: q.b,
      pack: q.pack,
      author: poll.authorId ? this.publicUser(this.db.users[poll.authorId]) : null,
      voteCount: Object.keys(poll.votes).length,
      memberCount: group.members.length,
      myVote,
      results: canSee ? this.results(poll, q, group) : null,
      commentCount: (this.db.comments[poll.id] || []).length,
    };
  }

  pollFor(user, pollId) {
    const poll = this.db.polls[pollId];
    if (!poll) fail(404, 'Question introuvable');
    return { poll, group: this.memberGroup(user, poll.groupId) };
  }

  vote(user, pollId, choice) {
    const { poll, group } = this.pollFor(user, pollId);
    if (poll.date !== this.today()) fail(409, 'Cette question est fermée');
    if (user.id in poll.votes) fail(409, 'Tu as déjà voté');
    const q = this.resolve(poll);
    if (q.type === 'who' ? !group.members.includes(choice) : choice !== 'a' && choice !== 'b') {
      fail(400, q.type === 'who' ? 'Choisis quelqu’un du groupe' : 'Choisis une des deux options');
    }
    poll.votes[user.id] = choice;
    group.lastActivity = Date.now();
    if (poll.daily) this.bumpStreak(group.id, user.id);
    return { poll: this.pollView(user, poll, group), streak: this.streakInfo(group.id, user.id) };
  }

  ask(user, groupId, { type = 'who', text, a, b } = {}) {
    const group = this.memberGroup(user, groupId);
    if (group.members.length < this.minMembers) fail(409, `Il faut au moins ${this.minMembers} membres pour jouer`);
    if (type !== 'who' && type !== 'wyr') fail(400, 'Type de question inconnu');
    const custom = { type, text: fr(cleanText(text, LIMITS.question, 'Question', 5)) };
    if (type === 'wyr') {
      custom.a = fr(cleanText(a, LIMITS.option, 'Option A'));
      custom.b = fr(cleanText(b, LIMITS.option, 'Option B'));
    }
    const poll = this.createPoll(group, { custom, authorId: user.id });
    return { poll: this.pollView(user, poll, group) };
  }

  history(user, groupId) {
    const group = this.memberGroup(user, groupId);
    const today = this.today();
    return this.groupPolls(group)
      .filter((p) => p.date !== today)
      .sort((a, b) => b.date.localeCompare(a.date) || Number(b.daily) - Number(a.daily) || a.createdAt - b.createdAt)
      .slice(0, 60)
      .map((p) => this.pollView(user, p, group));
  }

  // ---- comments ---------------------------------------------------------

  commentsFor(user, pollId) {
    const { poll } = this.pollFor(user, pollId);
    if (poll.date === this.today() && !(user.id in poll.votes)) fail(403, 'Vote d’abord pour rejoindre la discussion');
    return poll;
  }

  listComments(user, pollId) {
    const poll = this.commentsFor(user, pollId);
    return (this.db.comments[poll.id] || []).map((c) => ({
      id: c.id,
      text: c.text,
      replyTo: c.replyTo,
      createdAt: c.createdAt,
      author: this.publicUser(this.db.users[c.userId]),
      mine: c.userId === user.id,
    }));
  }

  addComment(user, pollId, { text, replyTo = null } = {}) {
    const poll = this.commentsFor(user, pollId);
    const thread = (this.db.comments[poll.id] ??= []);
    if (replyTo) {
      const parent = thread.find((c) => c.id === replyTo);
      if (!parent) fail(404, 'Le message auquel tu réponds n’existe plus');
      replyTo = parent.replyTo || parent.id; // keep threads one level deep
    }
    thread.push({ id: newId(), userId: user.id, text: cleanText(text, LIMITS.comment, 'Message'), replyTo, createdAt: Date.now() });
    this.db.groups[poll.groupId].lastActivity = Date.now();
    return this.listComments(user, pollId);
  }

  // ---- streaks ----------------------------------------------------------

  streakInfo(groupId, userId) {
    const rec = this.db.streaks[`${groupId}:${userId}`];
    const today = this.today();
    if (!rec) return { current: 0, best: 0, doneToday: false };
    const alive = rec.last === today || rec.last === addDays(today, -1);
    return { current: alive ? rec.count : 0, best: rec.best, doneToday: rec.last === today };
  }

  bumpStreak(groupId, userId) {
    const key = `${groupId}:${userId}`;
    const today = this.today();
    const rec = (this.db.streaks[key] ??= { count: 0, best: 0, last: null });
    if (rec.last === today) return rec.count;
    rec.count = rec.last === addDays(today, -1) ? rec.count + 1 : 1;
    rec.best = Math.max(rec.best, rec.count);
    rec.last = today;
    return rec.count;
  }
}

module.exports = { Game, HttpError, LIMITS, addDays };
