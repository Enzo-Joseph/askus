'use strict';

// Sends Web Push notifications. Keys come from VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY
// (create them with `npm run vapid-keys`); VAPID_SUBJECT identifies who sends them.

const webpush = require('web-push');

const publicKey = () => process.env.VAPID_PUBLIC_KEY || null;
const isConfigured = () => Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);

// Sends every message; returns the endpoints the push service says no longer exist,
// so the caller can forget them.
async function sendAll(messages) {
  if (!messages.length || !isConfigured()) return [];
  const vapidDetails = {
    subject: process.env.VAPID_SUBJECT || 'mailto:askus@example.com',
    publicKey: process.env.VAPID_PUBLIC_KEY,
    privateKey: process.env.VAPID_PRIVATE_KEY,
  };
  const results = await Promise.allSettled(
    messages.map(({ subscription, payload }) =>
      webpush.sendNotification(subscription, JSON.stringify(payload), { vapidDetails, TTL: 6 * 3600, urgency: 'normal' })),
  );
  const gone = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') return;
    if (r.reason?.statusCode === 404 || r.reason?.statusCode === 410) gone.push(messages[i].subscription.endpoint);
    else console.error('push failed:', r.reason?.statusCode || '', r.reason?.body || r.reason?.message);
  });
  return gone;
}

module.exports = { publicKey, isConfigured, sendAll };
