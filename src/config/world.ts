// Countries and cities available in the game. Coordinates are real.
// `district` is where the fictional tech-district parcel grid is laid out
// (placed in real data-center hubs around each metro).

export interface CountryDef {
  id: string; // ISO alpha-2
  isoNum: string; // world-atlas numeric id
  name: string;
  flag: string;
  bbox: [number, number, number, number];
  center: [number, number];
}

export interface CityDef {
  id: string;
  name: string;
  country: string;
  region: 'North America' | 'Europe' | 'Asia' | 'Oceania';
  center: [number, number];
  district: [number, number];
  districtName: string;
  landMult: number;
  powerPrice: number; // $/kWh
  constructionMult: number;
  demand: number; // base market demand in compute units (CU)
  tax: number; // annual property tax rate
  grid: number; // 0..1 grid reliability / infrastructure availability
  unlockLevel: number;
  license: number; // one-time market-entry license fee
  blurb: string;
  /** Small town: its own street plan, low-rise buildings and farmland instead of a metro grid. */
  town?: boolean;
}

export const COUNTRIES: CountryDef[] = [
  { id: 'US', isoNum: '840', name: 'United States', flag: '🇺🇸', bbox: [-125, 24, -66, 50], center: [-97, 39] },
  { id: 'CA', isoNum: '124', name: 'Canada', flag: '🇨🇦', bbox: [-128, 41.5, -60, 60], center: [-96, 56] },
  { id: 'GB', isoNum: '826', name: 'United Kingdom', flag: '🇬🇧', bbox: [-8.6, 49.8, 1.9, 59], center: [-2, 54] },
  { id: 'DE', isoNum: '276', name: 'Germany', flag: '🇩🇪', bbox: [5.8, 47.2, 15.1, 55.1], center: [10.4, 51.1] },
  { id: 'FR', isoNum: '250', name: 'France', flag: '🇫🇷', bbox: [-5, 42.3, 8.3, 51.1], center: [2.4, 46.6] },
  { id: 'NL', isoNum: '528', name: 'Netherlands', flag: '🇳🇱', bbox: [3.3, 50.7, 7.3, 53.6], center: [5.3, 52.2] },
  { id: 'JP', isoNum: '392', name: 'Japan', flag: '🇯🇵', bbox: [129.4, 31, 145.8, 45.5], center: [138, 37] },
  { id: 'KR', isoNum: '410', name: 'South Korea', flag: '🇰🇷', bbox: [125.9, 33.1, 129.6, 38.6], center: [127.8, 36.3] },
  { id: 'SG', isoNum: '702', name: 'Singapore', flag: '🇸🇬', bbox: [103.6, 1.2, 104.1, 1.48], center: [103.82, 1.35] },
  { id: 'AU', isoNum: '036', name: 'Australia', flag: '🇦🇺', bbox: [113, -44, 154, -10], center: [134, -25] },
];

export const CITIES: CityDef[] = [
  // ---- United States ----
  { id: 'chicago', name: 'Chicago', country: 'US', region: 'North America', center: [-87.63, 41.88], district: [-87.975, 42.004], districtName: 'Elk Grove Tech District', landMult: 0.9, powerPrice: 0.11, constructionMult: 1.0, demand: 9000, tax: 0.021, grid: 0.92, unlockLevel: 1, license: 0, blurb: 'Fiber crossroads of the Midwest with cheap land and cold winters.' },
  { id: 'dallas', name: 'Dallas', country: 'US', region: 'North America', center: [-96.8, 32.78], district: [-96.885, 32.93], districtName: 'Carrollton Data Corridor', landMult: 0.75, powerPrice: 0.09, constructionMult: 0.9, demand: 8000, tax: 0.019, grid: 0.86, unlockLevel: 1, license: 0, blurb: 'Cheap power and land. Hot summers stress your cooling.' },
  { id: 'nova', name: 'Northern Virginia', country: 'US', region: 'North America', center: [-77.49, 39.04], district: [-77.465, 39.017], districtName: 'Ashburn Data Alley', landMult: 1.25, powerPrice: 0.1, constructionMult: 1.1, demand: 16000, tax: 0.011, grid: 0.95, unlockLevel: 1, license: 0, blurb: 'The densest data-center market on Earth. Huge demand, fierce competition.' },
  { id: 'phoenix', name: 'Phoenix', country: 'US', region: 'North America', center: [-112.07, 33.45], district: [-111.885, 33.3], districtName: 'Chandler Compute Park', landMult: 0.7, powerPrice: 0.1, constructionMult: 0.92, demand: 7000, tax: 0.016, grid: 0.88, unlockLevel: 3, license: 150_000, blurb: 'Fast-growing desert hub. Cheap land, brutal heat.' },
  { id: 'newyork', name: 'New York', country: 'US', region: 'North America', center: [-74.006, 40.713], district: [-74.065, 40.786], districtName: 'Secaucus Interconnect Zone', landMult: 2.1, powerPrice: 0.17, constructionMult: 1.35, demand: 13000, tax: 0.024, grid: 0.9, unlockLevel: 4, license: 600_000, blurb: 'Financial capital. Premium prices, premium customers.' },
  { id: 'losangeles', name: 'Los Angeles', country: 'US', region: 'North America', center: [-118.24, 34.05], district: [-118.395, 33.922], districtName: 'El Segundo Edge District', landMult: 1.9, powerPrice: 0.19, constructionMult: 1.3, demand: 11000, tax: 0.012, grid: 0.85, unlockLevel: 4, license: 550_000, blurb: 'Media and Pacific cable landing hub.' },
  { id: 'carmi', name: 'Carmi', country: 'US', region: 'North America', center: [-88.172, 38.0861], district: [-88.172, 38.0861], districtName: 'White County, Illinois', landMult: 0.42, powerPrice: 0.085, constructionMult: 0.82, demand: 900, tax: 0.024, grid: 0.84, unlockLevel: 1, license: 0, town: true, blurb: 'A small Illinois town on the Little Wabash River. Dirt-cheap land and low-cost power, but a tiny local market that fills up fast.' },
  // ---- Canada ----
  { id: 'toronto', name: 'Toronto', country: 'CA', region: 'North America', center: [-79.38, 43.65], district: [-79.33, 43.856], districtName: 'Markham Server Park', landMult: 1.1, powerPrice: 0.08, constructionMult: 1.05, demand: 7500, tax: 0.015, grid: 0.95, unlockLevel: 5, license: 900_000, blurb: 'Clean hydro power and a cool climate.' },
  // ---- Europe ----
  { id: 'amsterdam', name: 'Amsterdam', country: 'NL', region: 'Europe', center: [4.9, 52.37], district: [4.765, 52.29], districtName: 'Schiphol-Rijk Campus', landMult: 1.5, powerPrice: 0.21, constructionMult: 1.2, demand: 10000, tax: 0.01, grid: 0.97, unlockLevel: 6, license: 1_800_000, blurb: 'One of Europe’s four big interconnection hubs.' },
  { id: 'frankfurt', name: 'Frankfurt', country: 'DE', region: 'Europe', center: [8.68, 50.11], district: [8.735, 50.118], districtName: 'Hanauer Landstraße Cluster', landMult: 1.6, powerPrice: 0.24, constructionMult: 1.25, demand: 12500, tax: 0.009, grid: 0.98, unlockLevel: 7, license: 2_400_000, blurb: 'Home to the world’s busiest internet exchange.' },
  { id: 'london', name: 'London', country: 'GB', region: 'Europe', center: [-0.1276, 51.507], district: [-0.268, 51.528], districtName: 'Park Royal Data Quarter', landMult: 2.3, powerPrice: 0.25, constructionMult: 1.4, demand: 14000, tax: 0.014, grid: 0.94, unlockLevel: 8, license: 3_500_000, blurb: 'Europe’s largest market. Expensive and power constrained.' },
  { id: 'paris', name: 'Paris', country: 'FR', region: 'Europe', center: [2.3522, 48.8566], district: [2.36, 48.925], districtName: 'Saint-Denis Digital Park', landMult: 1.8, powerPrice: 0.16, constructionMult: 1.25, demand: 10500, tax: 0.012, grid: 0.96, unlockLevel: 9, license: 3_000_000, blurb: 'Nuclear-backed grid with stable, low-carbon power.' },
  // ---- Asia ----
  { id: 'singapore', name: 'Singapore', country: 'SG', region: 'Asia', center: [103.82, 1.352], district: [103.72, 1.335], districtName: 'Jurong Data Hub', landMult: 3.2, powerPrice: 0.2, constructionMult: 1.3, demand: 13000, tax: 0.01, grid: 0.99, unlockLevel: 11, license: 6_000_000, blurb: 'Land-scarce, sky-high prices, gateway to Southeast Asia.' },
  { id: 'tokyo', name: 'Tokyo', country: 'JP', region: 'Asia', center: [139.69, 35.69], district: [139.81, 35.65], districtName: 'Koto Bay Compute Zone', landMult: 2.8, powerPrice: 0.22, constructionMult: 1.4, demand: 17000, tax: 0.014, grid: 0.97, unlockLevel: 12, license: 8_000_000, blurb: 'Massive demand from Japan’s tech giants.' },
  { id: 'seoul', name: 'Seoul', country: 'KR', region: 'Asia', center: [126.978, 37.566], district: [126.885, 37.48], districtName: 'Gasan Digital Complex', landMult: 2.2, powerPrice: 0.12, constructionMult: 1.15, demand: 12000, tax: 0.012, grid: 0.96, unlockLevel: 13, license: 7_000_000, blurb: 'Hyper-connected market with affordable power.' },
  // ---- Oceania ----
  { id: 'sydney', name: 'Sydney', country: 'AU', region: 'Oceania', center: [151.21, -33.87], district: [151.12, -33.775], districtName: 'Macquarie Park Precinct', landMult: 1.9, powerPrice: 0.2, constructionMult: 1.3, demand: 9500, tax: 0.013, grid: 0.92, unlockLevel: 15, license: 9_000_000, blurb: 'Australia’s cloud capital.' },
  { id: 'melbourne', name: 'Melbourne', country: 'AU', region: 'Oceania', center: [144.96, -37.81], district: [144.92, -37.83], districtName: 'Port Melbourne Tech Park', landMult: 1.6, powerPrice: 0.19, constructionMult: 1.25, demand: 8000, tax: 0.013, grid: 0.92, unlockLevel: 16, license: 7_500_000, blurb: 'Growing southern hub with strong research customers.' },
];

const CITY_MAP = new Map(CITIES.map((c) => [c.id, c]));
const COUNTRY_MAP = new Map(COUNTRIES.map((c) => [c.id, c]));
export const cityById = (id: string): CityDef => CITY_MAP.get(id)!;
export const countryById = (id: string): CountryDef => COUNTRY_MAP.get(id)!;
export const citiesInCountry = (id: string): CityDef[] => CITIES.filter((c) => c.country === id);
