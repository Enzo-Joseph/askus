'use strict';

// Prints a new key pair for push notifications, plus a random CRON_SECRET,
// to paste into Vercel → Settings → Environment Variables.
//
//   npm run vapid-keys

const crypto = require('crypto');
const webpush = require('web-push');

const { publicKey, privateKey } = webpush.generateVAPIDKeys();

console.log(`VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${privateKey}`);
console.log('VAPID_SUBJECT=mailto:you@example.com   <- your email, used by push services to reach you');
console.log(`CRON_SECRET=${crypto.randomBytes(24).toString('hex')}`);
console.log('\nKeep the private key and the cron secret private. Changing the keys later means everyone has to turn notifications on again.');
