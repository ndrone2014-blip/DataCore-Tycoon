# AI Data Center Empire

A browser-based 3D business and city-building simulator. Start in a rented garage with almost no money, earn your first property, then buy land in real cities around the world, demolish what's there, build data centers (up to gigawatt-class AI campuses), fill them with GPUs, sign customers, lay fiber across oceans and outgrow, or buy out, five AI-controlled rivals.

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

**Option 4: Netlify.** Connect the repository; `netlify.toml` tells Netlify to publish the folder as-is (no build step). Note that on Netlify's credit-based Free plan every production deploy uses credits, so each push to `main` counts.

The current build version is shown at the bottom of the title screen and in Settings → About, so you can confirm which version a site is serving.

An internet connection is used for real map tiles and charts. The street-level city needs no downloads at all. Without a connection the game still runs fully using built-in fallbacks (simplified world map, built-in charts).

## Develop

```bash
npm install          # esbuild, typescript, tsx
npm run build        # bundles src/ → dist/game.js
npm run dev          # rebuild on change + local server
npm run typecheck    # strict TypeScript check
npm test             # headless simulation tests, every expansion system, company progression and a real v2.0 save
npx tsx tests/bot.test.ts 3   # a scripted player plays 3 real-time hours (balance check)
```

## How a company grows

New companies climb through five stages: **Garage Startup**, **Growing Business**, **Established Company**, **Major Corporation** and **Global Empire**. The **Company Progress** page shows what you have unlocked, what to do next and what is still ahead.

1. You start with one home town, about $6,000 and one property on the market. Take freelance jobs from the **Founder's Desk** and consider used servers for the garage rack.
2. Owning land earns a **construction loan**. A finished building earns **equipment financing**, but needs **power and internet hookups** before it can earn anything.
3. Staying profitable for four game days makes you a Growing Business and opens employees, headquarters and the property market. Research, suppliers, networks, new cities, zones, campuses and takeovers follow as you hit goals.

Expansion gets easier through what you build up, not through cheaper hardware: better market rates and leaner staffing at each stage, crews that get faster with every site, cheaper utility work in towns you already serve, and research and staff bonuses. Saves from before v2.3 load as they were: everything stays unlocked and their economy is unchanged.

A scripted player reports the pacing with `npx tsx tests/careerbot.test.ts [hours] [city] [difficulty]`.

### Carmi, Illinois

The developer's home town is a full market with its own street plan. The named streets and their directions come from local addresses, and the Little Wabash runs along the east side, but it is a game-scale plan rather than a survey, and every business is fictional. Land and power are cheap, the local market is tiny, and two farmland tracts at the edge of town can eventually hold a full campus.

### Thanksgiving

Fall trees, leaf drifts, pumpkins, hay bales and warmer colors appear in November. Settings → Graphics → **Seasonal decorations** switches them on or off at any time.

## How to play

0. **Start screen** — choose **PC** or **Mobile**. This sets the controls, layout and graphics limits (tick *Remember my choice* to skip it; change it any time in Settings).
1. **World Map** — the globe shows every market. Click a highlighted country, then a city. **To unlock a new city**, reach its company level, then buy its market license; the World Map panel lists what's next with one-tap Unlock buttons.
2. **City** — zoom in and the map hands over to a full 3D city. Every lot is a real building. Click any one; dashed outlines mark **development zones**, and name tags float over your own properties.
3. **Property view** — buy it, **demolish** the old building, then **Build data center**: pick a premade blueprint or design a **custom building** (floors, footprint, exterior, colors, cooling, electrical, generators, security).
4. **Construction** runs through 8 visible stages. Pay to speed it up (or finish instantly).
5. **Data Centers** — install servers, GPUs, accelerators, networking, cooling, power and generators. Watch power, cooling, temperature and performance.
6. **Customers & Contracts** — sign customers for premium rates. Idle capacity earns spot-market prices.
7. Hire **employees**, run **research**, unlock new **regions**, buy whole **zones** and consolidate them into mega campus sites, and climb to **level 100**.
8. As you grow: choose **suppliers**, lay **fiber** between markets, give cities a **focus**, set **company policies**, and **buy rivals** or individual data centers from them.

The current story mission is always shown at the bottom of the sidebar.

### Stress-free tools

- **⏸ Stop time** (top bar or Space) freezes the economy — no income, expenses, rivals or events — while construction and research keep going. Buy, build and upgrade at your own pace.
- **⚡ Auto-equip** fills a facility with a balanced mix of servers and adds the power, cooling and networking it needs, at any budget, and tells you exactly why if it has to stop.
- **Auto-sign contracts** (Contracts page or Settings) accepts every offer that fits.
- **Contract notifications** can be set to All, Problems only or Off (Contracts page or Settings).
- **⚡ Auto-assign staff** works out the best placement for everyone, and can keep doing it as you hire and build.
- **Find what needs attention**: the top-bar chip jumps to the next data center needing servers, the Data Centers page filters and sorts by need, and city name tags glow amber.
- **🤝 Make takeover offers** from the Competitors & Deals page: a lowball, a fair price or a premium. You get the rival's land, running data centers, fiber, cash and debts. You can also buy a single data center. Integration costs money for 10 days, and acquired sites run at 85% until it finishes.
- **Overdraft protection** covers shortfalls with a bank loan, and being away can never cost more than a quarter of your cash.
- **Opportunity cards** pop up now and then with choices: investors, GPU rentals, press features, bulk deals, gambles and more. Ignore them and nothing bad happens.

### Controls

| Action | Input |
|---|---|
| Pan / zoom map | Drag / mouse wheel |
| City: pan / rotate / zoom (PC) | Drag or WASD / right-drag or Q E / wheel |
| City: pan / rotate / zoom (Mobile) | One finger / two-finger twist / pinch (slide two fingers to tilt) |
| Stop / resume time | Space |
| Game speed 1×/2×/4× | 1 / 2 / 3 |
| World map | M |
| Back / close dialog | Esc |
| Save | Ctrl+S |

## Features

- **Realistic street-level city** — custom WebGL2 renderer with procedural architecture: glass towers with setbacks, concrete offices, brick terraces, apartments, shops with parking, malls, warehouses with loading docks, factories, houses and parks; reflective glass, real-time sun shadows, day/night with lit windows, street lights, moving traffic, and detailed data centers with chillers, generators, construction stages and an X-ray rack view. Off-screen parts of the city are skipped, only lots that changed get rebuilt, and resolution adapts up and down to hold a smooth frame rate.
- **Real interactive map** — MapLibre GL JS with OpenFreeMap / OpenStreetMap vector tiles (dark-themed at runtime), globe projection at world zoom, country boundaries from Natural Earth (world-atlas), smooth fly-to transitions, breadcrumbs, zoom/reset/back controls.
- **Four zoom levels** — world → country → city → property, the last two in one continuous 3D scene.
- **Living cities** — every district sits inside a procedurally generated city of ~1,500 buildings: downtown towers rise toward each real city's centre, with mid-rise offices, apartments, brick walk-ups, suburbs, parks and continuous streets. The skyline appears on the map, in the 3D property view (lit windows and aviation lights at night) and in the offline view.
- **Property system** — ~7,000 parcels across 17 real cities, including the small town of Carmi, Illinois, 10 property types, zoning codes, restrictions, development potential, demolition costs and location-driven prices. Buy individual lots or entire development zones (15% bundle discount), then consolidate zones into single campus sites.
- **8 data center classes** from $250K modular units to the $500M Mega AI Campus, plus a full custom-building designer.
- **18 equipment types** with purchase/installation cost, power draw, capacity, maintenance, ratings and upgrade paths; rack-slot, bay, power and cooling limits.
- **Financial simulation** — contracts and spot market revenue; electricity, cooling, salaries, maintenance, building upkeep, property tax, insurance, connectivity and interest expenses; hourly/daily/monthly reports, charts, transaction history, valuation and bank loans. Every number on screen is driven by the simulation.
- **Power & cooling** — overloads reduce performance; facility temperature, PUE, backup generators for grid outages, campus synergy between neighboring facilities.
- **9 employee departments** with real bonuses, hiring, firing, promotions and per-facility assignment; headquarters with 5 tiers on the world map.
- **21-node research tree** across AI computing, cooling, electricity, networking and automation.
- **5 AI competitors** with distinct personalities (aggressive, conservative, technology, budget). They buy real parcels and whole zones, demolish, build, install capacity, research, win the contracts you pass on, and depress city spot prices.
- **Progression** — levels 1–100 with titles, unlockable buildings/equipment/regions, 32 achievements (some with permanent bonuses), 19 story missions and daily missions.
- **World events** — heat waves, grid outages, GPU shortages, hardware sales, AI booms, tax breaks, energy spikes, recessions, trade disputes, energy crises, supply crunches, chip breakthroughs, government programs and new laws. Rivals feel them too.
- **Corporate strategy** — four long-term policies (compute focus, pricing, growth, capital), each with a real downside and a cooldown on changing it.
- **Reputation** — measured from service, contract record, uptime, building quality, network and compliance, with history. It affects offers, contract rates, which customers will talk to you, supplier prices and valuation.
- **Global fiber network** — 26 regional, long-haul and undersea routes on the globe, with capacity upgrades, exchanges and internet hubs. They earn transit income and give connected cities better prices. Rivals build their own and split the income on shared links.
- **Hardware suppliers** — 18 fictional vendors across 6 categories, differing in price, performance, upkeep and delivery time. Includes shortages, new hardware generations and long-term supply contracts.
- **Regional focus** — make a city an AI hub, cloud region, finance center, hyperscale campus or network hub. Matching what a city is known for makes the upside stronger.
- **Country rules** — taxes, permits, efficiency limits, privacy tiers and government demand differ by country, and events change them over time.
- **Industry news and rankings** — a live news feed, ten global leaderboards, market share by country and city, and head-to-head comparison.
- **Saves** — IndexedDB autosave with localStorage backup, manual save, export/import, validation and repair, offline progression with an upgradable cap, and protection against clock changes.
- **Settings** — graphics quality, UI scale, reduced motion, camera sensitivity/invert, sound and generative music volumes, offline map mode, save management.

## Project structure

```
src/
  config/      economy.ts (all balancing numbers), expansion.ts, world.ts, buildings.ts, research.ts, content.ts
  core/        state model, RNG, formatting, event bus
  world/       procedural parcel & development-zone generation
  systems/     property, construction, equipment, derive (facility stats), contracts,
               employees, research, competitors, events, progression, ledger, sim (tick + offline),
               fiber, suppliers, reputation, regulation, strategy, rankings
  save/        IndexedDB / localStorage persistence, validation, export/import
  map/         MapLibre engine, Canvas fallback engine, map controller (levels, layers, markers)
  city/        street-level WebGL2 city: renderer, shaders, mesh builder, building models
  three/       isometric fallback for devices without WebGL2
  ui/          app shell, DOM morphing, components, charts, pages/
  audio/       procedural Web Audio sound effects & music
styles/main.css
dist/game.js   pre-built bundle
```

All prices, rates, timers and costs live in `src/config/economy.ts` and the other config files.

## Developer tools

Tap the version number under Settings → About five times, then enter the password. The dashboard covers money and prices, unlocks, construction, progression, rivals, time, events, saves and debugging. To clear a forgotten password, run `localStorage.removeItem('aidce-dev-auth')` in the browser console to go back to the default. This lock only keeps out casual access, because the game runs entirely in the browser.

## Credits

Map data © OpenStreetMap contributors, tiles by OpenFreeMap / OpenMapTiles. Country boundaries from Natural Earth via world-atlas. Charts by Chart.js. Properties, companies and customers are fictional.
