const API_KEY = 'vZgxd0kWcGaEcYnzMRPpqRFGVcn6NDh26fcvnNEzquq0RGHgRqxg9lG8oW8JZXrt';
const DAY_LABELS = ['Heute', 'Morgen', 'Überm.', 'In 3 T.'];
const SEVERITY_LABELS = ['Keine', 'Gering', 'Mäßig', 'Hoch', 'Sehr hoch'];
const POLLEN_CACHE_TTL = 6 * 60 * 60;        // 6 hours
const GEOCODE_CACHE_TTL = 30 * 24 * 60 * 60; // 30 days (zip centroids are ~permanent)

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS headers for JSON API
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // JSON API endpoint: /api/pollen?lat=...&lon=...
    if (path === '/api/pollen') {
      return handleApiPollen(url, corsHeaders);
    }

    // JSON API endpoint: /api/pollen-by-zip?zip=...
    if (path === '/api/pollen-by-zip') {
      return handleApiPollenByZip(url, corsHeaders);
    }

    // Original TRMNL HTML endpoint: /?zip=...
    const zip = url.searchParams.get('zip') || url.searchParams.get('ZIP')
              || url.searchParams.get('plz') || url.searchParams.get('PLZ');

    if (!zip) {
      return html(renderError('Keine PLZ angegeben. Nutzung: ?zip=1150'));
    }

    try {
      const loc = await geocodeCached(zip);
      const { data } = await fetchPollenCached(loc.lat, loc.lon);
      return html(render(data));
    } catch (e) {
      return html(renderError(e.message));
    }
  },
};

// ── JSON API handlers ───────────────────────────────────────────────

async function handleApiPollen(url, corsHeaders) {
  const lat = parseFloat(url.searchParams.get('lat'));
  const lon = parseFloat(url.searchParams.get('lon'));

  if (isNaN(lat) || isNaN(lon)) {
    return jsonResponse({ error: 'Missing lat/lon parameters' }, 400, corsHeaders);
  }

  try {
    const { data, cacheStatus } = await fetchPollenCached(lat, lon);
    return jsonResponse(data, 200, corsHeaders, cacheStatus);
  } catch (e) {
    return jsonResponse({ error: e.message }, 502, corsHeaders);
  }
}

async function handleApiPollenByZip(url, corsHeaders) {
  const zip = url.searchParams.get('zip') || url.searchParams.get('ZIP')
            || url.searchParams.get('plz') || url.searchParams.get('PLZ');

  if (!zip) {
    return jsonResponse({ error: 'Missing zip parameter' }, 400, corsHeaders);
  }

  try {
    const { lat, lon, cacheStatus: geoStatus } = await geocodeCached(zip);
    const { data, cacheStatus: pollenStatus } = await fetchPollenCached(lat, lon);
    // Combined status: HIT only if BOTH layers hit cache (= zero subrequests)
    const combined = geoStatus === 'HIT' && pollenStatus === 'HIT' ? 'HIT' : 'MISS';
    return jsonResponse(data, 200, corsHeaders, combined, { geoStatus, pollenStatus });
  } catch (e) {
    return jsonResponse({ error: e.message }, 502, corsHeaders);
  }
}

function jsonResponse(data, status, corsHeaders, cacheStatus, detail) {
  const headers = {
    'Content-Type': 'application/json;charset=UTF-8',
    'Cache-Control': `public, max-age=${POLLEN_CACHE_TTL}`,
    ...corsHeaders,
  };
  if (cacheStatus) headers['X-Cache'] = cacheStatus;
  if (detail) {
    if (detail.geoStatus) headers['X-Cache-Geocode'] = detail.geoStatus;
    if (detail.pollenStatus) headers['X-Cache-Pollen'] = detail.pollenStatus;
  }
  return new Response(JSON.stringify(data), { status, headers });
}

// ── Caching layer: pollen data (6h TTL, keyed by rounded lat/lon) ──

async function fetchPollenCached(lat, lon) {
  // Round coordinates to 2 decimal places for cache key grouping
  // (≈1km precision — close enough for pollen forecasts)
  const rlat = Math.round(lat * 100) / 100;
  const rlon = Math.round(lon * 100) / 100;
  const cacheKey = new Request(`https://pollen-cache/v1/${rlat}/${rlon}`);

  const cache = caches.default;
  let response = await cache.match(cacheKey);

  if (response) {
    console.log(`POLLEN_CACHE_HIT lat=${rlat} lon=${rlon}`);
    return { data: await response.json(), cacheStatus: 'HIT' };
  }

  // Cache miss — fetch from upstream API
  console.log(`POLLEN_CACHE_MISS lat=${rlat} lon=${rlon} — fetching upstream`);
  const data = await fetchPollenUpstream(lat, lon);

  // Store in cache with 6-hour TTL
  const cacheResponse = new Response(JSON.stringify(data), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': `public, max-age=${POLLEN_CACHE_TTL}`,
    },
  });
  await cache.put(cacheKey, cacheResponse.clone());

  return { data, cacheStatus: 'MISS' };
}

// ── Caching layer: zip → lat/lon (30d TTL, centroids are ~permanent) ──

function normalizeZip(zip) {
  return String(zip).trim();
}

async function geocodeCached(zip) {
  const normZip = normalizeZip(zip);
  const cacheKey = new Request(`https://pollen-cache/v1/geocode/AT/${normZip}`);

  const cache = caches.default;
  const response = await cache.match(cacheKey);

  if (response) {
    const loc = await response.json();
    console.log(`GEOCODE_CACHE_HIT zip=${normZip}`);
    return { ...loc, cacheStatus: 'HIT' };
  }

  console.log(`GEOCODE_CACHE_MISS zip=${normZip} — calling Nominatim`);
  const loc = await geocodeUpstream(normZip);

  const cacheResponse = new Response(JSON.stringify(loc), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': `public, max-age=${GEOCODE_CACHE_TTL}`,
    },
  });
  await cache.put(cacheKey, cacheResponse.clone());

  return { ...loc, cacheStatus: 'MISS' };
}

// ── Upstream API calls ──────────────────────────────────────────────

async function geocodeUpstream(zip) {
  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?postalcode=${zip}&country=AT&format=json&limit=1`,
    { headers: { 'Accept': 'application/json', 'User-Agent': 'pollen-trmnl-worker' } }
  );
  if (!res.ok) throw new Error('Geocoding fehlgeschlagen.');
  const data = await res.json();
  if (!data.length) throw new Error(`PLZ ${zip} nicht gefunden.`);
  return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
}

async function fetchPollenUpstream(lat, lon) {
  const params = new URLSearchParams({
    country: 'AT', lang: 'de', latitude: lat, longitude: lon, apikey: API_KEY,
  });
  const res = await fetch(`https://www.polleninformation.at/api/forecast/public?${params}`);
  if (!res.ok) throw new Error(`API-Fehler: HTTP ${res.status}`);
  return await res.json();
}

// ── TRMNL HTML rendering ────────────────────────────────────────────

function render(data) {
  const risk = data.allergyrisk || {};
  const riskToday = risk.allergyrisk_1 ?? null;
  const hourly = data.allergyrisk_hourly && data.allergyrisk_hourly.allergyrisk_hourly_1;

  const summaryRow = `
    <div class="risk-values">
      ${[risk.allergyrisk_1, risk.allergyrisk_2, risk.allergyrisk_3, risk.allergyrisk_4]
        .map((v, i) => `<span class="risk-day">${DAY_LABELS[i]}: <strong>${v ?? '–'}</strong>/10</span>`)
        .join('')}
    </div>`;

  let riskSection = '';
  if (riskToday != null) {
    if (Array.isArray(hourly) && hourly.length === 24) {
      const peak = Math.max(...hourly);
      const peakHour = hourly.indexOf(peak);
      const bars = hourly.map((v) => {
        const heightPct = Math.max(v * 10, v > 0 ? 4 : 0);
        return `<div class="hourly-bar"><div class="hourly-bar-fill" style="height:${heightPct}%"></div></div>`;
      }).join('');
      riskSection = `
        <div class="risk-box">
          <div class="risk-header">Allergierisiko heute — Höchstwert ${peak}/10 um ${peakHour}:00</div>
          <div class="hourly-chart">
            <div class="hourly-bars">${bars}</div>
            <div class="hourly-axis"><span>0</span><span>6</span><span>12</span><span>18</span><span>24</span></div>
          </div>
          ${summaryRow}
        </div>`;
    } else {
      riskSection = `
        <div class="risk-box">
          <div class="risk-header">Allergierisiko heute: ${riskToday}/10</div>
          <div class="risk-meter">
            <div class="risk-meter-fill" style="width:${riskToday * 10}%"></div>
          </div>
          ${summaryRow}
        </div>`;
    }
  }

  const allergens = (data.contamination || [])
    .map(item => {
      const levels = [
        item.contamination_1 ?? 0,
        item.contamination_2 ?? 0,
        item.contamination_3 ?? 0,
        item.contamination_4 ?? 0,
      ];
      const match = item.poll_title.match(/^(.+?)\s*\((.+)\)$/);
      return {
        name: match ? match[1].trim() : item.poll_title,
        latin: match ? match[2].trim() : '',
        levels,
        maxLevel: Math.max(...levels),
      };
    })
    .filter(a => a.maxLevel > 0)
    .sort((a, b) => b.levels[0] - a.levels[0] || b.maxLevel - a.maxLevel);

  const tableBody = allergens.length === 0
    ? '<tr><td colspan="5" style="text-align:center;padding:2rem;color:#555">Derzeit keine Pollenbelastung.</td></tr>'
    : allergens.map(a => `
        <tr>
          <td>
            <div class="allergen-name-cell">${esc(a.name)}</div>
            ${a.latin ? `<div class="allergen-latin-cell">${esc(a.latin)}</div>` : ''}
          </td>
          ${a.levels.map(l => `<td><span class="level-pip pip-${l}">${l}</span></td>`).join('')}
        </tr>`).join('');

  return `
    ${riskSection}
    <table class="allergen-table">
      <thead>
        <tr>
          <th></th>
          ${DAY_LABELS.map(l => `<th>${l}</th>`).join('')}
        </tr>
      </thead>
      <tbody>${tableBody}</tbody>
    </table>`;
}

function renderError(msg) {
  return `<div class="error">${esc(msg)}</div>`;
}

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function html(body) {
  const page = `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Pollenflug – TRMNL</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #fff;
      color: #000;
      padding: 12px;
      max-width: 800px;
    }
    .error { font-size: 1.1rem; padding: 2rem; text-align: center; }
    .risk-box { border: 2px solid #000; padding: 10px 14px; margin-bottom: 12px; }
    .risk-header { font-weight: 700; font-size: 1rem; margin-bottom: 6px; }
    .risk-meter { height: 14px; background: #e0e0e0; border: 1px solid #000; margin-bottom: 8px; }
    .risk-meter-fill { height: 100%; background: #000; }
    .risk-values { display: flex; gap: 12px; flex-wrap: wrap; font-size: 0.85rem; }
    .risk-day strong { font-weight: 700; }
    .hourly-chart { margin-bottom: 8px; }
    .hourly-bars { display: flex; align-items: flex-end; gap: 2px; height: 56px; border-bottom: 1px solid #000; padding: 0 1px; }
    .hourly-bar { flex: 1; height: 100%; display: flex; align-items: flex-end; }
    .hourly-bar-fill { width: 100%; background: #000; min-height: 1px; }
    .hourly-axis { display: flex; justify-content: space-between; font-size: 0.7rem; padding-top: 2px; }
    .allergen-table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
    .allergen-table th { text-align: center; font-weight: 600; font-size: 0.75rem; padding: 4px 6px 6px; border-bottom: 2px solid #000; color: #333; }
    .allergen-table th:first-child { text-align: left; }
    .allergen-table td { padding: 7px 6px; border-bottom: 1px solid #ccc; text-align: center; vertical-align: middle; }
    .allergen-table td:first-child { text-align: left; }
    .allergen-table tr:last-child td { border-bottom: none; }
    .allergen-name-cell { font-weight: 700; font-size: 0.9rem; white-space: nowrap; }
    .allergen-latin-cell { font-size: 0.7rem; font-style: italic; color: #666; }
    .level-pip { display: inline-block; width: 22px; height: 22px; border-radius: 50%; border: 1.5px solid #000; line-height: 22px; font-size: 0.7rem; font-weight: 700; text-align: center; }
    .pip-0 { background: #fff; color: #999; border-color: #ccc; }
    .pip-1 { background: #ddd; color: #000; }
    .pip-2 { background: #999; color: #fff; }
    .pip-3 { background: #444; color: #fff; }
    .pip-4 { background: #000; color: #fff; }
  </style>
</head>
<body>${body}</body>
</html>`;
  return new Response(page, { headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
}
