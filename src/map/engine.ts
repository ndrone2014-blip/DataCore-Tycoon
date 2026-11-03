// Map engine abstraction. Two implementations: MapLibre GL (online, real
// geography) and a Canvas2D fallback (works fully offline).

export type LngLat = [number, number];
export type FC = { type: 'FeatureCollection'; features: any[] };

export interface CityData {
  plates: FC;
  streets: FC;
  parcels: FC;
  buildings: FC;
  zones: FC;
}

export interface MapHit {
  type: 'country' | 'parcel' | 'zone' | 'none';
  id?: string;
  lngLat: LngLat;
}

export interface MarkerHandle {
  setLngLat(ll: LngLat): void;
  setVisible(v: boolean): void;
  remove(): void;
  el: HTMLElement;
}

export interface CameraOpts {
  center: LngLat;
  zoom: number;
  pitch?: number;
  bearing?: number;
  duration?: number;
}

export interface MapEngine {
  kind: 'maplibre' | 'canvas';
  attribution: string;
  flyTo(c: CameraOpts): void;
  fitBounds(b: [number, number, number, number], opts?: { padding?: number; pitch?: number; duration?: number; maxZoom?: number }): void;
  getZoom(): number;
  getCenter(): LngLat;
  zoomBy(delta: number): void;
  setCountries(fc: FC): void;
  setHighlightCountry(iso: string | null): void;
  setCityData(d: CityData): void;
  /** Static decorative city (ground, parks, skyline buildings) around every district. */
  setCityscape(d: { ground: FC; parks: FC; buildings: FC }): void;
  setSelectedParcel(id: string | null): void;
  /** Fiber routes drawn on the world view. */
  setFiber?(fc: FC): void;
  setHoverInfo?(cb: (hit: MapHit | null) => void): void;
  addMarker(el: HTMLElement, ll: LngLat): MarkerHandle;
  onClick(cb: (hit: MapHit) => void): void;
  onMove(cb: () => void): void;
  resize(): void;
  setSensitivity(v: number, invert: boolean): void;
  setEffects?(o: { glow: boolean; timeOfDay: string }): void;
  destroy(): void;
}

export const empty = (): FC => ({ type: 'FeatureCollection', features: [] });
