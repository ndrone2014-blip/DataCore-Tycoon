# AI Data Center Empire

A browser-based 3D business and city-building simulator. Start a tiny AI infrastructure company with one run-down property, then buy land in real cities around the world, demolish what's there, build data centers (up to gigawatt-class AI campuses), fill them with GPUs, sign customers and outgrow five AI-controlled rivals.

*Developed by Drone Hive Studios | Developer @ndrone40*

## Play

The game is fully static — no server code, no paid APIs.

**Option 1: just open it.** Double-click `index.html`. The pre-built bundle in `dist/` runs straight from disk.

**Option 2: local server** (recommended, needs Node 18+):

```bash
npm start            # serves the folder at http://localhost:8080
```

or `python3 -m http.server 8080` and open http://localhost:8080.

**Option 3: GitHub Pages.** In the repository's **Settings → Pages**, choose *Deploy from a branch*, branch `main`, folder `/ (root)`. The game will be live at `https://<user>.github.io/<repo>/`.

An internet connection is used for real map tiles, the 3D engine and charts. Without it the game still runs fully using built-in offline fallbacks (simplified world map, isometric property view, built-in charts).

## Develop

```bash
npm install          # esbuild, typescript, tsx
npm run build        # bundles src/ → dist/game.js
npm run dev          # rebuild on change + local server
npm run typecheck    # strict TypeScript check
npm test             # headless simulation test (buy → demolish → build → servers → contracts → save → offline)
npx tsx tests/bot.test.ts 3   # a scripted player plays 3 real-time hours (balance check)
```

## How to play

1. **World Map** — the globe shows every market. Click a highlighted country, then a city.
2. **City** — each city has a fictional tech district laid over the real map: individual lots and dashed **development zones**. Click any lot.
3. **Property view** — buy it, **demolish** the old building, then **Build data center**: pick a premade blueprint or design a **custom building** (floors, footprint, exterior, colors, cooling, electrical, generators, security).
4. **Construction** runs through 8 visible stages. Pay to speed it up (or finish instantly).
5. **Data Centers** — install servers, GPUs, accelerators, networking, cooling, power and generators. Watch power, cooling, temperature and performance.
6. **Customers & Contracts** — sign customers for premium rates. Idle capacity earns spot-market prices.
7. Hire **employees**, run **research**, unlock new **regions**, buy whole **zones** and consolidate them into mega campus sites, and climb to **level 100**.

The current story mission is always shown at the bottom of the sidebar.

### Controls

| Action | Input |
|---|---|
| Pan / zoom map | Drag / mouse wheel |
| Orbit / pan / zoom 3D view | Drag / right-drag / wheel |
| Pause | Space |
| Game speed 1×/2×/4× | 1 / 2 / 3 |
| World map | M |
| Back / close dialog | Esc |
| Save | Ctrl+S |

## Features

- **Cinematic visuals** — dynamic sky with sun, stars and a day/night cycle (or lock it to day, golden hour or night); image-based reflections on glass and metal; living streets with moving traffic, headlights, street lamps, trees and sidewalks; lit windows at night; glowing facility accent bands and logo plaques; rooftop chillers with steam; aviation lights; construction scaffolding, netting and site trucks; an animated isometric title scene; glowing map markers and pulsing parcel outlines.
- **Real interactive map** — MapLibre GL JS with OpenFreeMap / OpenStreetMap vector tiles (dark-themed at runtime), globe projection at world zoom, country boundaries from Natural Earth (world-atlas), smooth fly-to transitions, breadcrumbs, zoom/reset/back controls.
- **Four zoom levels** — world → country → city → property. Property view is a Three.js scene with the neighborhood, the existing building, demolition (dust, excavator, debris), every construction stage (crane, steel frame, floors, transformers, rooftop chillers, cladding), and the finished facility with X-ray mode showing one rack per installed server with blinking LEDs.
- **Property system** — ~2,000 procedurally generated parcels across 16 real cities, 10 property types, zoning codes, restrictions, development potential, demolition costs and location-driven prices. Buy individual lots or entire development zones (15% bundle discount), then consolidate zones into single campus sites.
- **8 data center classes** from $250K modular units to the $500M Mega AI Campus, plus a full custom-building designer.
- **18 equipment types** with purchase/installation cost, power draw, capacity, maintenance, ratings and upgrade paths; rack-slot, bay, power and cooling limits.
- **Financial simulation** — contracts and spot market revenue; electricity, cooling, salaries, maintenance, building upkeep, property tax, insurance, connectivity and interest expenses; hourly/daily/monthly reports, charts, transaction history, valuation and bank loans. Every number on screen is driven by the simulation.
- **Power & cooling** — overloads reduce performance; facility temperature, PUE, backup generators for grid outages, campus synergy between neighboring facilities.
- **9 employee departments** with real bonuses, hiring, firing, promotions and per-facility assignment; headquarters with 5 tiers on the world map.
- **21-node research tree** across AI computing, cooling, electricity, networking and automation.
- **5 AI competitors** with distinct personalities (aggressive, conservative, technology, budget). They buy real parcels and whole zones, demolish, build, install capacity, research, win the contracts you pass on, and depress city spot prices.
- **Progression** — levels 1–100 with titles, unlockable buildings/equipment/regions, 32 achievements (some with permanent bonuses), 19 story missions and daily missions.
- **World events** — heat waves, grid outages, GPU shortages, hardware sales, AI booms, tax breaks, energy spikes.
- **Saves** — IndexedDB autosave with localStorage backup, manual save, export/import, validation and repair, offline progression with an upgradable cap, and protection against clock changes.
- **Settings** — graphics quality, UI scale, reduced motion, camera sensitivity/invert, sound and generative music volumes, offline map mode, save management.

## Project structure

```
src/
  config/      economy.ts (all balancing numbers), world.ts, buildings.ts, research.ts, content.ts
  core/        state model, RNG, formatting, event bus
  world/       procedural parcel & development-zone generation
  systems/     property, construction, equipment, derive (facility stats), contracts,
               employees, research, competitors, events, progression, ledger, sim (tick + offline)
  save/        IndexedDB / localStorage persistence, validation, export/import
  map/         MapLibre engine, Canvas fallback engine, map controller (levels, layers, markers)
  three/       Three.js property view, isometric fallback
  ui/          app shell, DOM morphing, components, charts, pages/
  audio/       procedural Web Audio sound effects & music
styles/main.css
dist/game.js   pre-built bundle
```

All prices, rates, timers and costs live in `src/config/economy.ts` and the other config files.

## Credits

Map data © OpenStreetMap contributors, tiles by OpenFreeMap / OpenMapTiles. Country boundaries from Natural Earth via world-atlas. 3D by Three.js, charts by Chart.js. Properties, companies and customers are fictional.
