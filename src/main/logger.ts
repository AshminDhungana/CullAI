import { app } from 'electron';

function isDev(): boolean {
  try {
    return (
      !app.isPackaged ||
      process.env.NODE_ENV === 'development' ||
      !!process.env.VITE_DEV_SERVER_URL
    );
  } catch {
    return (
      process.env.NODE_ENV === 'development' ||
      !!process.env.VITE_DEV_SERVER_URL
    );
  }
}

export function log(...args: unknown[]): void {
  if (isDev()) console.log(...args);
}

export function warn(...args: unknown[]): void {
  if (isDev()) console.warn(...args);
}

export function error(...args: unknown[]): void {
  if (isDev()) console.error(...args);
}
