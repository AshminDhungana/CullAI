/**
 * scripts/hash-license-keys.ts
 * 
 * Run: npx ts-node scripts/hash-license-keys.ts or 
 * From Project Root i.e `\CullAI`
 * Pre-computed hashes (run `npx ts-node --project tsconfig.main.json src/scripts/hash-license-keys.ts` to regen)
 * Paste the output into src/main/license-manager.ts
 */

import * as crypto from 'crypto';

const PEPPER = 'cullai-license-pepper-v1-2024'; // Must match license-manager.ts

function hash(key: string): string {
  return crypto.createHmac('sha256', PEPPER).update(key).digest('hex');
}

const KEYS = [
  { name: 'FREE_KEY_HASH',     value: 'dhunganafree' },
  { name: 'PRO_KEY_HASH',      value: 'dhunganapro' },
  { name: 'LIFETIME_KEY_HASH', value: 'dhunganalifetime' },
];

console.log('// Paste these into src/main/license-manager.ts\n');
for (const k of KEYS) {
  console.log(`const ${k.name} = '${hash(k.value)}';`);
}