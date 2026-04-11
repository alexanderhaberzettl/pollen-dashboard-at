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

The `worker/` directory contains a Cloudflare Worker that acts as a caching proxy in front of the polleninformation.at API. Both the main app and `trmnl.html` call the worker instead of hitting the upstream API directly. This dramatically reduces load on the upstream API: regardless of how many users visit, the worker only forwards a request to polleninformation.at once per location every **6 hours**. Coordinates are rounded to ~1km precision so nearby visitors share the same cache entry.

The worker exposes three endpoints:

- `GET /?zip=1150` — server-rendered HTML for TRMNL devices
- `GET /api/pollen?lat=…&lon=…` — JSON proxy used by the main dashboard
- `GET /api/pollen-by-zip?zip=…` — JSON proxy with built-in geocoding (used by `trmnl.html`)

Cache behaviour is observable: every JSON response includes an `X-Cache: HIT|MISS` header, and the worker logs `CACHE_HIT` / `CACHE_MISS` lines to `wrangler tail` and the Cloudflare Logs dashboard.

Deploy with:

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
