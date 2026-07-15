// Server-seitiger TTL-Cache vor den HubSpot-Routes. Hält die fertig
// aggregierten Responses kurz (5 Min) zwischen, damit pro Page-Load nicht
// jedesmal HubSpot getroffen wird und so später eine Public-API dieselben
// Daten ohne zusätzlichen Quota-Verbrauch ausliefern kann. Übergangslösung —
// sobald BigQuery-Replikation da ist, fliegt der Wrapper raus und der
// `fetcher` wird gegen einen BQ-Query getauscht.
//
// Storage:
//   - Production (Netlify Lambda): `@netlify/blobs` Store `hubspot-cache`.
//   - Lokal (`next dev`, kein Netlify-Context): File-System in `.cache/blobs/`.
//
// Lokaler Fallback ist nötig weil das Dev-Setup `next dev` direkt aufruft
// (siehe `scripts/dev-prep.sh`), nicht `netlify dev` — ohne Netlify-Context
// hätten `getStore()`-Calls keine Credentials.

import { getStore } from '@netlify/blobs';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const STORE_NAME = 'hubspot-cache';
const LOCAL_DIR = path.resolve(process.cwd(), '.cache/blobs');

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

export interface CacheMeta {
  hit: boolean;
  cachedAt: number;
  ageMs: number;
  ttlSeconds: number;
}

function isNetlifyEnv(): boolean {
  // Netlify Functions setzen NETLIFY=true. Lokales `next dev` nicht.
  return process.env.NETLIFY === 'true';
}

function localPath(key: string): string {
  // Key kann Slashes/Doppelpunkte enthalten — als einzelne Datei encodieren.
  return path.join(LOCAL_DIR, encodeURIComponent(key) + '.json');
}

async function readEntry<T>(key: string): Promise<CacheEntry<T> | null> {
  if (isNetlifyEnv()) {
    try {
      const store = getStore(STORE_NAME);
      const raw = await store.get(key, { type: 'json' });
      return (raw as CacheEntry<T> | null) ?? null;
    } catch (err) {
      console.warn(`[server-cache] blob read failed for ${key}:`, err);
      return null;
    }
  }
  try {
    const raw = await fs.readFile(localPath(key), 'utf8');
    return JSON.parse(raw) as CacheEntry<T>;
  } catch {
    return null;
  }
}

async function writeEntry<T>(key: string, entry: CacheEntry<T>): Promise<void> {
  if (isNetlifyEnv()) {
    try {
      const store = getStore(STORE_NAME);
      await store.setJSON(key, entry);
    } catch (err) {
      console.warn(`[server-cache] blob write failed for ${key}:`, err);
    }
    return;
  }
  try {
    await fs.mkdir(LOCAL_DIR, { recursive: true });
    await fs.writeFile(localPath(key), JSON.stringify(entry));
  } catch (err) {
    console.warn(`[server-cache] local write failed for ${key}:`, err);
  }
}

/**
 * Holt `key` aus dem Cache wenn jünger als `ttlSeconds`, sonst ruft `fetcher`
 * und persistiert das Ergebnis. Setze `forceRefresh: true` (z.B. aus einem
 * `?refresh=1`-Query-Param) um den Cache zu umgehen und neu zu füllen.
 *
 * Schreibfehler werden geschluckt — der Caller bekommt immer ein gültiges
 * Ergebnis. Lesefehler ebenso (Treat-as-miss).
 */
export async function getOrFetch<T>(
  key: string,
  ttlSeconds: number,
  fetcher: () => Promise<T>,
  options: { forceRefresh?: boolean } = {},
): Promise<{ data: T; meta: CacheMeta }> {
  if (!options.forceRefresh) {
    const cached = await readEntry<T>(key);
    if (cached) {
      const ageMs = Date.now() - cached.timestamp;
      if (ageMs <= ttlSeconds * 1000) {
        return {
          data: cached.data,
          meta: { hit: true, cachedAt: cached.timestamp, ageMs, ttlSeconds },
        };
      }
    }
  }
  const data = await fetcher();
  const entry: CacheEntry<T> = { data, timestamp: Date.now() };
  await writeEntry(key, entry);
  return {
    data,
    meta: { hit: false, cachedAt: entry.timestamp, ageMs: 0, ttlSeconds },
  };
}

/**
 * Liest einen Cache-Eintrag ROH aus — ohne TTL-Prüfung. Der Warmer-Read-Pfad
 * (`serveWarmBacked`) entscheidet selbst über Staleness und serviert bewusst
 * auch abgelaufene Einträge, statt synchron neu zu bauen. Gibt `null` bei Miss.
 */
export async function readCacheEntry<T>(
  key: string,
): Promise<{ data: T; timestamp: number } | null> {
  return readEntry<T>(key);
}

/**
 * Schreibt `data` mit aktuellem Timestamp in den Cache. Benutzt vom
 * Background-Warmer, der die teuren Builds außerhalb des Request-Pfads
 * berechnet und die fertigen Responses hier ablegt.
 */
export async function writeCacheEntry<T>(key: string, data: T): Promise<void> {
  await writeEntry<T>(key, { data, timestamp: Date.now() });
}

/**
 * True, wenn wir im Netlify-Function-Runtime laufen (nicht lokales `next dev`).
 * Steuert, ob der Warmer-Pfad aktiv ist oder auf synchrones Inline-Build
 * zurückfällt.
 */
export function isNetlifyRuntime(): boolean {
  return isNetlifyEnv();
}

/**
 * Stabiler Hash über eine Liste von Strings (z.B. dealIds), damit die
 * Reihenfolge im Cache-Key egal ist.
 */
export function hashIdList(ids: readonly string[]): string {
  const sorted = [...ids].sort();
  return createHash('sha1').update(sorted.join(',')).digest('hex').slice(0, 16);
}
