// Usage:  node worker/hash-password.mjs "your-long-admin-password"
// Prints the value to store as the ADMIN_PASSWORD_HASH secret.
import { pbkdf2Sync, randomBytes } from 'node:crypto';

const password = process.argv[2];
if (!password || password.length < 12) {
  console.error('Give a password of at least 12 characters, e.g. node worker/hash-password.mjs "my long passphrase"');
  process.exit(1);
}
const iterations = 100000; // the maximum Cloudflare Workers allows
const salt = randomBytes(16);
const hash = pbkdf2Sync(password, salt, iterations, 32, 'sha256');
console.log(`pbkdf2$${iterations}$${salt.toString('base64url')}$${hash.toString('base64url')}`);
