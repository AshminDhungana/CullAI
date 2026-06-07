/**
 * src/main/time-sync.ts
 *
 * Trusted time source with web fallback and clock-rollback detection.
 */

import * as https from 'https';

interface TimeResult {
  date: Date;
  source: 'web' | 'system' | 'cached';
}

let cachedWebTime: Date | null = null;
let cachedAt = 0;

export async function fetchWebTime(): Promise<Date | null> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(null), 5000);

    const req = https.get('https://worldtimeapi.org/api/ip', (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        clearTimeout(timeout);
        try {
          const json = JSON.parse(data);
          if (json.datetime) {
            const d = new Date(json.datetime);
            cachedWebTime = d;
            cachedAt = Date.now();
            resolve(d);
            return;
          }
        } catch { /* ignore */ }
        resolve(null);
      });
    });

    req.on('error', () => {
      clearTimeout(timeout);
      resolve(null);
    });
  });
}

export async function getTrustedTime(): Promise<TimeResult> {
  const web = await fetchWebTime();
  const sys = new Date();

  if (web) {
    const drift = Math.abs(sys.getTime() - web.getTime());
    if (drift > 60000) {
      console.warn(`[time-sync] System drift ${drift}ms — trusting web time`);
    }
    return { date: web, source: 'web' };
  }

  if (cachedWebTime && Date.now() - cachedAt < 3600000) {
    return { date: cachedWebTime, source: 'cached' };
  }

  return { date: sys, source: 'system' };
}

export function getCurrentMonthKeyFromDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function getCurrentMonthKey(): string {
  return getCurrentMonthKeyFromDate(new Date());
}