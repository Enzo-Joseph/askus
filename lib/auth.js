'use strict';

// Password hashing and login helpers (Node's built-in scrypt, no dependencies).

const crypto = require('crypto');

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
const USERNAME_RE = /^[a-z0-9._-]{3,20}$/;
const PASSWORD_MIN = 6;
const PASSWORD_MAX = 100;

// Stored as "scrypt$<salt>$<hash>" so the format can evolve later.
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, SCRYPT.keylen, SCRYPT);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

function verifyPassword(password, stored) {
  const [scheme, salt, hash] = String(stored || '').split('$');
  if (scheme !== 'scrypt' || !salt || !hash || typeof password !== 'string') return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = crypto.scryptSync(password, Buffer.from(salt, 'base64'), expected.length, SCRYPT);
  return crypto.timingSafeEqual(actual, expected);
}

// A hash of nothing in particular, checked when the pseudo doesn't exist so that
// "unknown pseudo" and "wrong password" take the same time to answer.
const DUMMY_HASH = hashPassword(crypto.randomBytes(16).toString('hex'));

const normalizeUsername = (value) => (typeof value === 'string' ? value.trim().toLowerCase() : '');

const newToken = () => crypto.randomBytes(24).toString('hex');

module.exports = { hashPassword, verifyPassword, DUMMY_HASH, normalizeUsername, newToken, USERNAME_RE, PASSWORD_MIN, PASSWORD_MAX };
