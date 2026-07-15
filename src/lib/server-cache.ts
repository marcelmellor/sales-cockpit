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
  /** Which storage backend served/stored this entry. Purely diagnostic. */
  backend?: CacheBackend;
}

export type CacheBackend = 'blobs' | 'fs';

// Runtime detection — DO NOT gate on `process.env.NETLIFY`. That variable is
// set during the Netlify *build*, but is NOT reliably present at function
// *runtime*. Gating cache storage on it made every production request use the
// ephemeral fs fallback below (writes vanish between invocations), so the
// server cache never persisted and the slow overview endpoints rebuilt on
// every call → Netlify timeout → 502. Instead we probe the real capability:
// getStore() succeeds only when a Netlify Blobs context is injected (deployed
// Functions), and throws under local `next dev`.
let cachedStore: ReturnType<typeof getStore> | null | undefined;
function getBlobStore(): ReturnType<typeof getStore> | null {
  if (cachedStore !== undefined) return cachedStore;
  try {
    cachedStore = getStore(STORE_NAME);
  } catch (err) {
    console.warn(
      '[server-cache] Netlify Blobs unavailable, using fs fallback:',
      err instanceof Error ? err.message : err,
    );
    cachedStore = null;
  }
  return cachedStore;
}

/** True when the shared Netlify Blobs cache is reachable (deployed runtime). */
export function isBlobsAvailable(): boolean {
  return getBlobStore() !== null;
}

/** Which backend the cache is currently using. Diagnostic only. */
export function cacheBackend(): CacheBackend {
  return isBlobsAvailable() ? 'blobs' : 'fs';
}

/**
 * True in a deployed (serverless) build, false under local `next dev`. On
 * Netlify `NODE_ENV=production`; `next dev` sets `development`. Used to decide
 * whether the slow overview builds may run synchronously (dev only) or must be
 * served exclusively from the warm cache (prod — a sync build there would
 * exceed the function timeout and 502).
 */
export function isProdRuntime(): boolean {
  return process.env.NODE_ENV === 'production';
}

function localPath(key: string): string {
  // Key kann Slashes/Doppelpunkte enthalten — als einzelne Datei encodieren.
  return path.join(LOCAL_DIR, encodeURIComponent(key) + '.json');
}

async function readEntry<T>(key: string): Promise<CacheEntry<T> | null> {
  const store = getBlobStore();
  if (store) {
    try {
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
  const store = getBlobStore();
  if (store) {
    try {
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
  const backend = cacheBackend();
  if (!options.forceRefresh) {
    const cached = await readEntry<T>(key);
    if (cached) {
      const ageMs = Date.now() - cached.timestamp;
      if (ageMs <= ttlSeconds * 1000) {
        return {
          data: cached.data,
          meta: { hit: true, cachedAt: cached.timestamp, ageMs, ttlSeconds, backend },
        };
      }
    }
  }
  const data = await fetcher();
  const entry: CacheEntry<T> = { data, timestamp: Date.now() };
  await writeEntry(key, entry);
  return {
    data,
    meta: { hit: false, cachedAt: entry.timestamp, ageMs: 0, ttlSeconds, backend },
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
 * Stabiler Hash über eine Liste von Strings (z.B. dealIds), damit die
 * Reihenfolge im Cache-Key egal ist.
 */
export function hashIdList(ids: readonly string[]): string {
  const sorted = [...ids].sort();
  return createHash('sha1').update(sorted.join(',')).digest('hex').slice(0, 16);
}
