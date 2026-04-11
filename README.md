# Pollenflug Austria

A personal pollen dashboard for Austria. Vibecoded for my own use — no guarantees, no support.

## What it does

Enter an Austrian ZIP code and get the current pollen situation from multiple sources:

- **Polleninformation.at (MedUni Wien)** — contamination levels 0–4 per allergen, 4-day forecast
- **Open-Meteo** — hourly pollen concentration in grains/m³ for common allergens
- **ORF Wetter** — regional pollen text forecast

Allergens can be hidden individually and the preference is saved in localStorage. The page also auto-loads if a ZIP is passed via URL (`?zip=1150`).

## TRMNL e-ink display

`trmnl.html` is a stripped-down view for [TRMNL](https://usetrmnl.com/) e-ink screens. It shows only the allergy risk summary and active allergens (sorted strongest-first), with a 4-day forecast table. Access it via:

```
/trmnl.html?zip=1150
```

Auto-refreshes every 30 minutes.

## Cloudflare Worker caching proxy

The `worker/` directory contains a Cloudflare Worker that acts as a caching proxy in front of the polleninformation.at API. Both the main app and `trmnl.html` call the worker instead of hitting the upstream API directly. This dramatically reduces load on the upstream API: regardless of how many users visit, the worker only forwards a request to polleninformation.at once per location every **6 hours**.

### Endpoints

- `GET /?zip=1150` — server-rendered HTML for TRMNL devices
- `GET /api/pollen?lat=…&lon=…` — JSON proxy used by the main dashboard
- `GET /api/pollen-by-zip?zip=…` — JSON proxy with built-in geocoding (used by `trmnl.html`)

### Two-layer cache

The worker uses two independent caches so that repeat visits make **zero** outbound subrequests:

1. **Geocode cache** — `zip → lat/lon`, 30-day TTL. Zip centroids are effectively permanent, so a long TTL is safe and also respects [Nominatim's usage policy](https://operations.osmfoundation.org/policies/nominatim/) that asks clients to cache results.
2. **Pollen cache** — `rounded lat/lon → API response`, 6-hour TTL. Coordinates are rounded to 2 decimal places (~1 km) so that nearby visitors share the same cache entry.

Effective API load per location (worst case):
- **polleninformation.at:** once every 6 hours
- **Nominatim:** once every 30 days per unique postal code

### Observability

Every JSON response includes cache status headers:

- `X-Cache: HIT | MISS` — combined (HIT only if both layers hit → zero subrequests)
- `X-Cache-Geocode: HIT | MISS` — was Nominatim called?
- `X-Cache-Pollen: HIT | MISS` — was polleninformation.at called?

The worker logs `GEOCODE_CACHE_HIT` / `GEOCODE_CACHE_MISS` / `POLLEN_CACHE_HIT` / `POLLEN_CACHE_MISS` lines that can be tailed live via `npx wrangler tail` or searched in the Cloudflare dashboard (Workers & Pages → `pollen-trmnl` → Observability → Logs). Workers Observability is enabled in `wrangler.toml` with full (100 %) sampling.

### Deploy

```bash
cd worker && npx wrangler deploy
```

## Running locally

Requires [Node.js](https://nodejs.org/). Then:

```bash
npx http-server -p 8080 -c-1
```

Open `http://localhost:8080`.

## Data sources

- [Polleninformation.at API](https://www.polleninformation.at) (MedUni Wien)
- [Open-Meteo Air Quality API](https://open-meteo.com/en/docs/air-quality-api)
- [ORF Wetter](https://wetter.orf.at)
- Geocoding via [OpenStreetMap Nominatim](https://nominatim.org)
