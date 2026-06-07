/**
 * src/main/license-manager.ts
 *
 * Core license engine. Lives in main process only — never imported by renderer.
 * Keys are validated via HMAC-SHA256; raw strings never leave this file.
 */

import { app } from 'electron';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { LicenseTier, LicenseFile, LicenseStatus } from '../shared/license';

// ---------------------------------------------------------------------------
// Build-time pepper (must match scripts/hash-license-keys.ts)
// ---------------------------------------------------------------------------
const LICENSE_PEPPER = process.env.LICENSE_SECRET || 'cullai-license-pepper-v1-2024';

// ---------------------------------------------------------------------------
// From Project Root i.e `\CullAI`
// Pre-computed hashes (run `npx ts-node --project tsconfig.main.json src/scripts/hash-license-keys.ts` to regen)
// ---------------------------------------------------------------------------
// NOTE: Replace these placeholders with real hashes from the build script.
const FREE_KEY_HASH     = '8a697e0c9133bd08594eece0e853b2dfae4eb930c206b31de225b165ba2acb4a';
const PRO_KEY_HASH      = '0211897a95a06046474ed2a61812fef002b5e0caef7a28cd9713e53fc85c3981';
const LIFETIME_KEY_HASH = 'aaf2a3f55e93bd59373023f0d6186d8124451d7d0772a507a1af34396e9ef843';

const VALID_KEY_HASHES: Record<string, LicenseTier> = {
  [FREE_KEY_HASH]: 'free',
  [PRO_KEY_HASH]: 'pro',
  [LIFETIME_KEY_HASH]: 'lifetime',
};

// ---------------------------------------------------------------------------
// Crypto helpers
// ---------------------------------------------------------------------------
function hashKey(rawKey: string): string {
  return crypto.createHmac('sha256', LICENSE_PEPPER).update(rawKey).digest('hex');
}

function hashFileContent(file: Omit<LicenseFile, 'signature'>): string {
  const payload = `${file.tier}:${file.issuedAt}:${file.deviceId}`;
  return crypto.createHmac('sha256', LICENSE_PEPPER).update(payload).digest('hex');
}

// ---------------------------------------------------------------------------
// Device fingerprint
// ---------------------------------------------------------------------------
export function getMachineId(): string {
  try {
    const hostname = os.hostname();
    const interfaces = os.networkInterfaces();
    let mac = '';
    for (const key of Object.keys(interfaces)) {
      const iface = interfaces[key];
      if (!iface) continue;
      for (const entry of iface) {
        if (!entry.internal && entry.mac && entry.mac !== '00:00:00:00:00:00') {
          mac = entry.mac;
          break;
        }
      }
      if (mac) break;
    }
    const cpu = os.cpus()[0]?.model || 'unknown';
    const payload = `${hostname}:${mac}:${cpu}`;
    return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 32);
  } catch {
    return crypto.randomBytes(16).toString('hex');
  }
}

// ---------------------------------------------------------------------------
// Key validation
// ---------------------------------------------------------------------------
export function validateKey(rawKey: string): { tier: LicenseTier; valid: boolean } {
  const keyHash = hashKey(rawKey.trim().toLowerCase());
  const tier = VALID_KEY_HASHES[keyHash];
  if (tier) return { tier, valid: true };
  return { tier: 'free', valid: false };
}

// ---------------------------------------------------------------------------
// License file I/O
// ---------------------------------------------------------------------------
function getLicensePath(): string {
  return path.join(app.getPath('userData'), '.cullai-license');
}

let cachedLicense: LicenseFile | null = null;

export function loadLicense(): LicenseFile | null {
  if (cachedLicense) return cachedLicense;
  try {
    const filePath = getLicensePath();
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf8');
    const file: LicenseFile = JSON.parse(raw);
    if (!verifyLicenseFile(file)) {
      console.warn('[license] Signature mismatch');
      return null;
    }
    if (file.deviceId !== getMachineId()) {
      console.warn('[license] Device mismatch');
      return null;
    }
    cachedLicense = file;
    return file;
  } catch (err) {
    console.warn('[license] Load failed:', err);
    return null;
  }
}

export function verifyLicenseFile(file: LicenseFile): boolean {
  if (!file?.signature) return false;
  return file.signature === hashFileContent(file);
}

export function generateLicenseFile(tier: LicenseTier, deviceId: string): LicenseFile {
  const issuedAt = new Date().toISOString();
  const file: LicenseFile = { tier, issuedAt, deviceId, signature: '' };
  file.signature = hashFileContent(file);
  return file;
}

export function saveLicense(rawKey: string): { success: boolean; tier?: LicenseTier; error?: string } {
  try {
    const validation = validateKey(rawKey.trim());
    if (!validation.valid) return { success: false, error: 'Invalid key' };

    const deviceId = getMachineId();
    const file = generateLicenseFile(validation.tier, deviceId);
    const filePath = getLicensePath();
    const tmpPath = `${filePath}.tmp`;

    fs.writeFileSync(tmpPath, JSON.stringify(file, null, 2));
    fs.renameSync(tmpPath, filePath);

    cachedLicense = file;
    return { success: true, tier: validation.tier };
  } catch (err: any) {
    return { success: false, error: err.message || 'Save failed' };
  }
}

export function deleteLicense(): void {
  try {
    const filePath = getLicensePath();
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (err) {
    console.warn('[license] Delete failed:', err);
  }
  cachedLicense = null;
}

export function getLicenseTier(): LicenseTier {
  return loadLicense()?.tier ?? 'free';
}

export function getLicenseStatus(): LicenseStatus {
  const file = loadLicense();
  const deviceId = getMachineId();
  if (!file) {
    return { tier: 'free', valid: true, deviceBound: true, checksumOk: true };
  }
  const checksumOk = verifyLicenseFile(file);
  const deviceBound = file.deviceId === deviceId;
  return {
    tier: file.tier,
    valid: checksumOk && deviceBound,
    deviceBound,
    checksumOk,
  };
}

export function clearLicenseCache(): void {
  cachedLicense = null;
}