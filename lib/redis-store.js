'use strict';

// Game state in Upstash Redis (used on Vercel, where the filesystem is read-only).
// The whole database is one JSON value plus a version counter: a save only succeeds
// if nobody else saved since it was loaded, otherwise the caller reloads and retries.

const { emptyData } = require('./store');

const KEY = process.env.REDIS_KEY || 'askus:db';
const VERSION_KEY = `${KEY}:version`;

// Atomic compare-and-set: write only if the version is still the one we loaded.
const SAVE_SCRIPT = `
local current = redis.call('GET', KEYS[2]) or '0'
if current ~= ARGV[2] then return 0 end
redis.call('SET', KEYS[1], ARGV[1])
redis.call('SET', KEYS[2], tostring(tonumber(current) + 1))
return 1`;

function credentials() {
  // Vercel's Upstash integration sets the KV_* names; a direct Upstash setup uses UPSTASH_*.
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error('Redis is not configured: set KV_REST_API_URL and KV_REST_API_TOKEN');
  return { url: url.replace(/\/$/, ''), token };
}

async function call(path, body) {
  const { url, token } = credentials();
  const res = await fetch(url + path, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) throw new Error(`Redis error: ${json.error || res.status}`);
  return json;
}

// Returns { data, raw, version }; `raw` is the stored JSON, to detect whether a request changed anything.
async function load() {
  const [db, version] = await call('/pipeline', [['GET', KEY], ['GET', VERSION_KEY]]);
  if (db.error || version.error) throw new Error(`Redis error: ${db.error || version.error}`);
  const raw = db.result ?? null;
  return { data: raw ? JSON.parse(raw) : emptyData(), raw, version: version.result ?? '0' };
}

// Returns false when someone else saved first.
async function save(json, version) {
  const { result } = await call('', ['EVAL', SAVE_SCRIPT, '2', KEY, VERSION_KEY, json, String(version)]);
  return result === 1;
}

module.exports = { load, save };
