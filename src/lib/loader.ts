// Runtime loader for third-party libraries served from public CDNs.
// The game degrades gracefully if any of them can't be loaded (offline play).

export const CDN = {
  maplibreJs: 'https://cdn.jsdelivr.net/npm/maplibre-gl@5/dist/maplibre-gl.js',
  maplibreCss: 'https://cdn.jsdelivr.net/npm/maplibre-gl@5/dist/maplibre-gl.css',
  chartJs: 'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.js',
  topojson: 'https://cdn.jsdelivr.net/npm/topojson-client@3.1.0/dist/topojson-client.min.js',
  worldAtlas: 'https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json',
  mapStyle: 'https://tiles.openfreemap.org/styles/positron',
};

const scriptCache = new Map<string, Promise<boolean>>();

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([p, new Promise<T>((r) => setTimeout(() => r(fallback), ms))]);
}

export function loadScript(url: string, timeout = 12000): Promise<boolean> {
  if (!scriptCache.has(url)) {
    scriptCache.set(
      url,
      withTimeout(
        new Promise<boolean>((resolve) => {
          const el = document.createElement('script');
          el.src = url;
          el.async = true;
          el.crossOrigin = 'anonymous';
          el.onload = () => resolve(true);
          el.onerror = () => resolve(false);
          document.head.appendChild(el);
        }),
        timeout,
        false,
      ),
    );
  }
  return scriptCache.get(url)!;
}

export function loadCss(url: string) {
  if (document.querySelector(`link[href="${url}"]`)) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = url;
  document.head.appendChild(l);
}

export async function fetchJson<T = any>(url: string, timeout = 10000, cacheKey?: string): Promise<T | null> {
  // Cache API keeps geographic data for offline sessions.
  const key = cacheKey ?? url;
  try {
    if ('caches' in window) {
      const cache = await caches.open('aidce-geo-v1');
      const hit = await cache.match(key);
      if (hit) return (await hit.json()) as T;
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), timeout);
      const res = await fetch(url, { signal: ctl.signal });
      clearTimeout(t);
      if (!res.ok) return null;
      await cache.put(key, res.clone());
      return (await res.json()) as T;
    }
  } catch {
    /* fall through */
  }
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeout);
    const res = await fetch(url, { signal: ctl.signal });
    clearTimeout(t);
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

let chartPromise: Promise<any | null> | null = null;
export function loadChart(): Promise<any | null> {
  if (!chartPromise) chartPromise = loadScript(CDN.chartJs).then((ok) => (ok ? (window as any).Chart ?? null : null));
  return chartPromise;
}

export async function loadMapLibre(): Promise<any | null> {
  loadCss(CDN.maplibreCss);
  const ok = await loadScript(CDN.maplibreJs, 15000);
  return ok ? (window as any).maplibregl ?? null : null;
}

let worldPromise: Promise<any | null> | null = null;
/** Country polygons (GeoJSON FeatureCollection) from world-atlas, or null. */
export function loadWorldGeo(): Promise<any | null> {
  if (!worldPromise) {
    worldPromise = (async () => {
      const [topo, ok] = await Promise.all([fetchJson(CDN.worldAtlas), loadScript(CDN.topojson)]);
      const tj = (window as any).topojson;
      if (!topo || !ok || !tj) return null;
      try {
        return tj.feature(topo, topo.objects.countries);
      } catch {
        return null;
      }
    })();
  }
  return worldPromise;
}
