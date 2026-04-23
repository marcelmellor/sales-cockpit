// Simple localStorage cache for pipeline data

const CACHE_PREFIX = 'pipeline-cache-';
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

export function getCachedData<T>(key: string): T | null {
  if (typeof window === 'undefined') return null;

  try {
    const cached = localStorage.getItem(CACHE_PREFIX + key);
    if (!cached) return null;

    const entry: CacheEntry<T> = JSON.parse(cached);
    const age = Date.now() - entry.timestamp;

    if (age > CACHE_DURATION) {
      localStorage.removeItem(CACHE_PREFIX + key);
      return null;
    }

    return entry.data;
  } catch {
    return null;
  }
}

export function setCachedData<T>(key: string, data: T): void {
  if (typeof window === 'undefined') return;

  try {
    const entry: CacheEntry<T> = {
      data,
      timestamp: Date.now(),
    };
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(entry));
  } catch {
    // Ignore storage errors
  }
}

export function clearPipelineCache(pipelineId?: string, produkt?: string): void {
  if (typeof window === 'undefined') return;

  try {
    if (pipelineId) {
      // Clear specific pipeline cache. `pipelineId` ist hier tatsächlich der
      // zusammengesetzte cache-Key (z.B. "<id>-<produkt>") — historisch
      // gewachsen, Name unverändert gelassen.
      localStorage.removeItem(CACHE_PREFIX + `overview-${pipelineId}`);
      localStorage.removeItem(CACHE_PREFIX + `meetings-${pipelineId}`);
      localStorage.removeItem(CACHE_PREFIX + `stage-history-${pipelineId}`);
      // Leads sind nur nach Produkt gekeyt (Leads-Endpoint kennt keine
      // Pipeline-Auswahl), deshalb explizit übergeben.
      if (produkt) {
        localStorage.removeItem(CACHE_PREFIX + `leads-overview-${produkt}`);
      }
    } else {
      // Clear all pipeline caches
      const keys = Object.keys(localStorage).filter(k => k.startsWith(CACHE_PREFIX));
      keys.forEach(k => localStorage.removeItem(k));
    }
  } catch {
    // Ignore storage errors
  }
}
