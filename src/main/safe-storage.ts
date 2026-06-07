/**
 * safe-storage.ts
 *
 * Secure API key vault using Electron's safeStorage API (OS keychain /
 * libsecret / Keychain Access). Encrypted blobs are stored in a dedicated
 * electron-store file ("secure") so they are physically separate from the
 * main settings JSON and never appear in its logs.
 *
 * ── Security guarantees ────────────────────────────────────────────────────
 *  • Raw key strings are never written to disk, any log, or any IPC reply
 *    that isn't in direct response to an explicit 'api-key-get' call.
 *  • Encryption is performed by the OS (DPAPI on Windows, Keychain on macOS,
 *    libsecret/kwallet on Linux). The app itself never holds the encryption
 *    key — it is bound to the OS user session.
 *  • If safeStorage is unavailable (headless CI, broken keychain) all
 *    operations degrade gracefully: store/get/delete are no-ops that return
 *    null, so the renderer can still run without crashing.
 *
 * ── Storage layout ─────────────────────────────────────────────────────────
 *  electron-store file: "secure.json"   (next to the main settings file)
 *  key path:            apiKeys.<provider>
 *  value:               base64-encoded Buffer from safeStorage.encryptString()
 */

import { safeStorage } from 'electron';
import type { AIProvider } from '../shared/types';

// ---------------------------------------------------------------------------
// Structural interface — mirrors the subset of electron-store we actually use.
// (We cannot import electron-store directly here; see the note in ipc-handlers.ts.)
// ---------------------------------------------------------------------------
interface SecureStore {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  delete(key: string): void;
}

// Module-level reference — populated once by init() before any handler fires.
let _store: SecureStore | null = null;

/**
 * Must be called once from index.ts, inside the electron-store dynamic import
 * callback, before registerIpcHandlers(). Receives a pre-constructed
 * electron-store instance configured for the secure store file.
 */
export function initSecureStore(store: SecureStore): void {
  _store = store;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function storeKey(provider: AIProvider): string {
  return `apiKeys.${provider}`;
}

function isAvailable(): boolean {
  return !!_store && safeStorage.isEncryptionAvailable();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Encrypts `key` with the OS keychain and stores it under apiKeys.<provider>.
 * The raw key string is never written to disk — only the encrypted Buffer
 * (base64-encoded) reaches electron-store.
 *
 * @throws if safeStorage encryption is not available on this system.
 */
export function storeApiKey(provider: AIProvider, key: string): void {
  if (!_store) throw new Error('safe-storage: store not initialised');
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
      'safe-storage: OS keychain encryption is not available on this system. ' +
      'Your API key cannot be stored securely.',
    );
  }

  const encrypted = safeStorage.encryptString(key); // → Buffer
  _store.set(storeKey(provider), encrypted.toString('base64'));
  // `key` goes out of scope here — never touches a file or log in plaintext.
}

/**
 * Decrypts and returns the stored API key for `provider`, or null if no key
 * is stored or decryption fails (e.g. different OS user, corrupt data).
 *
 * The returned string is only passed directly to the IPC reply; the main
 * process never logs it.
 */
export function getApiKey(provider: AIProvider): string | null {
  if (!isAvailable()) return null;

  const b64 = _store!.get(storeKey(provider)) as string | undefined;
  if (!b64 || typeof b64 !== 'string') return null;

  try {
    return safeStorage.decryptString(Buffer.from(b64, 'base64'));
  } catch {
    // Corrupt blob, keychain unavailable, or OS user changed.
    return null;
  }
}

/**
 * Removes the stored key for `provider`. No-op if nothing is stored.
 */
export function deleteApiKey(provider: AIProvider): void {
  if (!_store) return;
  _store.delete(storeKey(provider));
}