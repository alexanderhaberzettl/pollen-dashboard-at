// ── Allergen Configuration ──────────────────────────────────────────

const ALLERGENS = {
  alder_pollen: {
    name: 'Erle',
    latin: 'Alnus',
    thresholds: [0, 10, 50, 200],
  },
  birch_pollen: {
    name: 'Birke',
    latin: 'Betula',
    thresholds: [0, 10, 50, 200],
  },
  grass_pollen: {
    name: 'Gräser',
    latin: 'Poaceae',
    thresholds: [0, 5, 20, 50],
  },
  mugwort_pollen: {
    name: 'Beifuß',
    latin: 'Artemisia',
    thresholds: [0, 5, 15, 30],
  },
  olive_pollen: {
    name: 'Olive',
    latin: 'Olea',
    thresholds: [0, 10, 50, 200],
  },
  ragweed_pollen: {
    name: 'Ragweed',
    latin: 'Ambrosia',
    thresholds: [0, 5, 15, 30],
  },
};

const SEVERITY_LABELS = {
  none: 'Keine',
  low: 'Gering',
  moderate: 'Mäßig',
  high: 'Hoch',
  very_high: 'Sehr hoch',
};

const DAY_LABELS = ['Heute', 'Morgen', 'Übermorgen', 'In 3 Tagen'];

// ── Polleninformation.at Config ─────────────────────────────────────

const POLLEN_PROXY_URL = 'https://pollen-trmnl.pollenapp-trmnl.workers.dev/api/pollen';

// Contamination level 0–4 mapped to our severity scale
const CONTAMINATION_SEVERITY = ['none', 'low', 'moderate', 'high', 'very_high'];
const CONTAMINATION_LABELS = ['Keine', 'Gering', 'Mäßig', 'Hoch', 'Sehr hoch'];

// ── ORF State Mapping ───────────────────────────────────────────────

const ORF_STATES = {
  wien:               { label: 'Wien',               slug: 'wien' },
  niederoesterreich:  { label: 'Niederösterreich',   slug: 'niederoesterreich' },
  oberoesterreich:    { label: 'Oberösterreich',     slug: 'oberoesterreich' },
  salzburg:           { label: 'Salzburg',            slug: 'salzburg' },
  tirol:              { label: 'Tirol',               slug: 'tirol' },
  vorarlberg:         { label: 'Vorarlberg',          slug: 'vorarlberg' },
  burgenland:         { label: 'Burgenland',          slug: 'burgenland' },
  steiermark:         { label: 'Steiermark',          slug: 'steiermark' },
  kaernten:           { label: 'Kärnten',             slug: 'kaernten' },
};

function zipToState(zip) {
  const num = parseInt(zip, 10);
  if (num >= 1000 && num <= 1999) return 'wien';
  if (num >= 2000 && num <= 3999) return 'niederoesterreich';
  if (num >= 4000 && num <= 4999) return 'oberoesterreich';
  if (num >= 5000 && num <= 5999) return 'salzburg';
  if (num >= 6000 && num <= 6599) return 'tirol';
  if (num >= 6600 && num <= 6999) return 'vorarlberg';
  if (num >= 7000 && num <= 7999) return 'burgenland';
  if (num >= 8000 && num <= 8999) return 'steiermark';
  if (num >= 9000 && num <= 9999) return 'kaernten';
  return null;
}

// ── Hidden Allergens (localStorage) ─────────────────────────────────

function getHiddenAllergens() {
  try {
    return JSON.parse(localStorage.getItem('hiddenAllergens')) || [];
  } catch { return []; }
}

function setHiddenAllergens(names) {
  localStorage.setItem('hiddenAllergens', JSON.stringify(names));
}

function hideAllergen(name) {
  const hidden = getHiddenAllergens();
  if (!hidden.includes(name)) {
    hidden.push(name);
    setHiddenAllergens(hidden);
  }
}

function unhideAllergen(name) {
  setHiddenAllergens(getHiddenAllergens().filter((n) => n !== name));
}

function renderHiddenSection(container, hiddenNames) {
  container.innerHTML = '';
  if (hiddenNames.length === 0) return;

  const toggle = document.createElement('button');
  toggle.className = 'hidden-allergens-toggle';
  toggle.innerHTML = `<span class="chevron">&#9654;</span> ${hiddenNames.length} Allergen${hiddenNames.length > 1 ? 'e' : ''} ausgeblendet`;

  const list = document.createElement('div');
  list.className = 'hidden-allergens-list';

  hiddenNames.forEach((name) => {
    const chip = document.createElement('span');
    chip.className = 'hidden-allergen-chip';
    chip.innerHTML = `${escapeHtml(name)} <button title="Wieder einblenden">+</button>`;
    chip.querySelector('button').addEventListener('click', () => {
      unhideAllergen(name);
      reRender();
    });
    list.appendChild(chip);
  });

  toggle.addEventListener('click', () => {
    toggle.classList.toggle('expanded');
    list.classList.toggle('visible');
  });

  container.appendChild(toggle);
  container.appendChild(list);
}

// ── DOM References ──────────────────────────────────────────────────

const zipInput = document.getElementById('zip-input');
const searchBtn = document.getElementById('search-btn');
const locationInfo = document.getElementById('location-info');
const errorMessage = document.getElementById('error-message');
const loading = document.getElementById('loading');
const results = document.getElementById('results');
const resultsTitle = document.getElementById('results-title');
const resultsDate = document.getElementById('results-date');
const openMeteoGrid = document.getElementById('open-meteo-grid');

// Cache last data for re-rendering after hide/unhide
let lastLocation = null;
let lastPollenData = null;
let lastPollenInfoData = null;

// ── Event Listeners ─────────────────────────────────────────────────

searchBtn.addEventListener('click', handleSearch);
zipInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') handleSearch();
});

// Only allow digits in ZIP input
zipInput.addEventListener('input', () => {
  zipInput.value = zipInput.value.replace(/\D/g, '').slice(0, 4);
});

// Auto-search if ?zip= URL parameter is present
(function checkUrlParams() {
  const params = new URLSearchParams(window.location.search);
  const zip = params.get('zip') || params.get('ZIP') || params.get('plz') || params.get('PLZ');
  if (zip && /^\d{4}$/.test(zip.trim())) {
    zipInput.value = zip.trim();
    handleSearch();
  }
})();

// ── Main Search Handler ─────────────────────────────────────────────

async function handleSearch() {
  const zip = zipInput.value.trim();

  if (!/^\d{4}$/.test(zip)) {
    showError('Bitte eine gültige 4-stellige österreichische Postleitzahl eingeben.');
    return;
  }

  hideError();
  hideResults();
  showLoading();
  searchBtn.disabled = true;

  try {
    // Step 1: Geocode ZIP to coordinates
    const location = await geocodeZip(zip);
    locationInfo.textContent = `📍 ${location.display} (${location.lat.toFixed(4)}°N, ${location.lon.toFixed(4)}°E)`;

    // Step 2: Fetch pollen data from all sources in parallel
    const [pollenData, orfData, pollenInfoData] = await Promise.all([
      fetchOpenMeteoPollen(location.lat, location.lon),
      fetchOrfPollen(zip).catch((err) => ({ error: err.message })),
      fetchPollenInfo(location.lat, location.lon).catch((err) => ({ error: err.message })),
    ]);

    // Cache data for re-rendering
    lastLocation = location;
    lastPollenData = pollenData;
    lastPollenInfoData = pollenInfoData;

    // Step 3: Render results
    renderResults(location, pollenData);
    renderPollenInfoResults(pollenInfoData);
    renderOrfResults(orfData, zip);
  } catch (err) {
    showError(err.message);
  } finally {
    hideLoading();
    searchBtn.disabled = false;
  }
}

function reRender() {
  if (lastLocation && lastPollenData) renderResults(lastLocation, lastPollenData);
  if (lastPollenInfoData) renderPollenInfoResults(lastPollenInfoData);
}

// ── Geocoding ───────────────────────────────────────────────────────

async function geocodeZip(zip) {
  const url = `https://nominatim.openstreetmap.org/search?postalcode=${zip}&country=AT&format=json&limit=1`;

  const response = await fetch(url, {
    headers: { 'Accept': 'application/json' },
  });

  if (!response.ok) {
    throw new Error('Geocoding-Dienst nicht erreichbar. Bitte später erneut versuchen.');
  }

  const data = await response.json();

  if (!data.length) {
    throw new Error(`Postleitzahl ${zip} wurde nicht gefunden. Bitte eine gültige österreichische PLZ eingeben.`);
  }

  const result = data[0];
  // Extract a readable place name, skipping the ZIP code and cadastral prefixes
  const parts = result.display_name.split(',').map((s) => s.trim());
  const nameParts = parts
    .filter((p) => p !== zip && !/^\d{4}$/.test(p))
    .map((p) => p.replace(/^KG\s+/, ''));
  const placeName = nameParts.slice(0, 2).join(', ');

  return {
    lat: parseFloat(result.lat),
    lon: parseFloat(result.lon),
    display: placeName,
    zip: zip,
  };
}

// ── Open-Meteo API ──────────────────────────────────────────────────

async function fetchOpenMeteoPollen(lat, lon) {
  const params = new URLSearchParams({
    latitude: lat,
    longitude: lon,
    hourly: Object.keys(ALLERGENS).join(','),
    timezone: 'Europe/Vienna',
    forecast_days: 4,
  });

  const url = `https://air-quality-api.open-meteo.com/v1/air-quality?${params}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error('Pollendaten konnten nicht geladen werden. Bitte später erneut versuchen.');
  }

  const data = await response.json();
  return processOpenMeteoData(data);
}

function processOpenMeteoData(data) {
  const hourly = data.hourly;
  const times = hourly.time.map((t) => new Date(t));
  const now = new Date();

  // Find the index of the current hour
  const currentHourIndex = times.findIndex(
    (t) => t.getFullYear() === now.getFullYear() &&
           t.getMonth() === now.getMonth() &&
           t.getDate() === now.getDate() &&
           t.getHours() === now.getHours()
  );

  // Group data by day
  const days = {};
  times.forEach((t, i) => {
    const dayKey = t.toISOString().split('T')[0];
    if (!days[dayKey]) days[dayKey] = [];
    days[dayKey].push(i);
  });

  const dayKeys = Object.keys(days).sort();
  const allergenResults = {};

  for (const [key, config] of Object.entries(ALLERGENS)) {
    const values = hourly[key];
    if (!values) continue;

    // Current value (or latest available)
    const currentIdx = currentHourIndex >= 0 ? currentHourIndex : times.length - 1;
    const currentValue = values[currentIdx] ?? 0;

    // Daily max for each forecast day
    const dailyMax = dayKeys.slice(0, 4).map((dayKey) => {
      const indices = days[dayKey];
      const dayValues = indices.map((i) => values[i] ?? 0);
      return Math.max(...dayValues);
    });

    // Daily average for today
    const todayKey = dayKeys[0];
    const todayIndices = days[todayKey] || [];
    const todayValues = todayIndices.map((i) => values[i] ?? 0);
    const todayAvg = todayValues.reduce((a, b) => a + b, 0) / todayValues.length;

    allergenResults[key] = {
      current: Math.round(currentValue),
      todayAvg: Math.round(todayAvg),
      todayMax: Math.round(dailyMax[0] ?? 0),
      dailyMax: dailyMax.map(Math.round),
      severity: classifySeverity(dailyMax[0] ?? 0, config.thresholds),
      dailySeverity: dailyMax.map((v) => classifySeverity(v, config.thresholds)),
    };
  }

  return {
    allergens: allergenResults,
    generatedAt: new Date(),
  };
}

// ── Severity Classification ─────────────────────────────────────────

function classifySeverity(value, thresholds) {
  if (value <= 0) return 'none';
  if (value < thresholds[1]) return 'low';
  if (value < thresholds[2]) return 'moderate';
  if (value < thresholds[3]) return 'high';
  return 'very_high';
}

// ── Rendering ───────────────────────────────────────────────────────

function renderResults(location, pollenData) {
  resultsTitle.textContent = `Pollenbelastung für ${location.zip} ${location.display}`;

  const dateStr = pollenData.generatedAt.toLocaleDateString('de-AT', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  resultsDate.textContent = `Stand: ${dateStr}`;

  openMeteoGrid.innerHTML = '';

  // Check if any pollen data is available
  const hasData = Object.values(pollenData.allergens).some(
    (a) => a.todayMax > 0 || a.dailyMax.some((v) => v > 0)
  );

  if (!hasData) {
    openMeteoGrid.innerHTML = `
      <div class="no-data-message" style="grid-column: 1 / -1;">
        Derzeit keine Pollenbelastung in dieser Region.
        Pollendaten sind hauptsächlich während der Pollensaison (Februar–September) verfügbar.
      </div>`;
  } else {
    const hidden = getHiddenAllergens();
    const hiddenInSection = [];

    // Sort: active allergens first, then by severity
    const severityOrder = { very_high: 4, high: 3, moderate: 2, low: 1, none: 0 };
    const sortedKeys = Object.keys(pollenData.allergens).sort((a, b) => {
      return severityOrder[pollenData.allergens[b].severity] -
             severityOrder[pollenData.allergens[a].severity];
    });

    for (const key of sortedKeys) {
      const data = pollenData.allergens[key];
      const config = ALLERGENS[key];
      if (hidden.includes(config.name)) {
        hiddenInSection.push(config.name);
        continue;
      }
      openMeteoGrid.appendChild(createAllergenCard(config, data));
    }

    renderHiddenSection(document.getElementById('open-meteo-hidden'), hiddenInSection);
  }

  showResults();
}

function createAllergenCard(config, data) {
  const card = document.createElement('div');
  card.className = 'allergen-card';

  const severityClass = `severity-${data.severity.replace('_', '-')}`;
  const severityLabel = SEVERITY_LABELS[data.severity];

  // Forecast dots
  const forecastHTML = data.dailySeverity
    .map((sev, i) => {
      const dotColor = getSeverityColor(sev);
      return `
        <div class="forecast-day">
          <span class="forecast-day-label">${DAY_LABELS[i] || `Tag ${i}`}</span>
          <span class="forecast-dot" style="background:${dotColor}" title="${SEVERITY_LABELS[sev]}"></span>
        </div>`;
    })
    .join('');

  card.innerHTML = `
    <div class="allergen-card-header">
      <div>
        <div class="allergen-name">${config.name}</div>
        <div class="allergen-name-latin">${config.latin}</div>
      </div>
      <div class="allergen-card-actions">
        <span class="severity-badge ${severityClass}">${severityLabel}</span>
        <button class="allergen-card-hide-btn" title="Ausblenden">&times;</button>
      </div>
    </div>
    <div class="allergen-value">
      Aktuell: ${data.current} grains/m³ · Tageshoch: ${data.todayMax} grains/m³
    </div>
    <div class="severity-bar-container">
      <div class="severity-bar level-${data.severity.replace('_', '-')}"></div>
    </div>
    <div class="forecast-row">
      ${forecastHTML}
    </div>`;

  card.querySelector('.allergen-card-hide-btn').addEventListener('click', () => {
    hideAllergen(config.name);
    reRender();
  });

  return card;
}

function getSeverityColor(severity) {
  const colors = {
    none: '#4caf50',
    low: '#8bc34a',
    moderate: '#ffc107',
    high: '#ff9800',
    very_high: '#f44336',
  };
  return colors[severity] || '#e5e7eb';
}

// ── Polleninformation.at API ─────────────────────────────────────────

async function fetchPollenInfo(lat, lon) {
  const params = new URLSearchParams({ lat, lon });
  const url = `${POLLEN_PROXY_URL}?${params}`;

  const fetchOpts = {};
  if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) {
    fetchOpts.signal = AbortSignal.timeout(10000);
  }

  const response = await fetch(url, fetchOpts);

  if (!response.ok) {
    throw new Error(`Polleninformation.at: HTTP ${response.status}`);
  }

  const data = await response.json();
  return processPollenInfoData(data);
}

function processPollenInfoData(data) {
  const allergens = (data.contamination || []).map((item) => {
    const levels = [
      item.contamination_1 ?? 0,
      item.contamination_2 ?? 0,
      item.contamination_3 ?? 0,
      item.contamination_4 ?? 0,
    ];

    // Parse title: "Erle (Alnus)" → name="Erle", latin="Alnus"
    const titleMatch = item.poll_title.match(/^(.+?)\s*\((.+)\)$/);
    const name = titleMatch ? titleMatch[1].trim() : item.poll_title;
    const latin = titleMatch ? titleMatch[2].trim() : '';

    return {
      pollId: item.poll_id,
      name: name,
      latin: latin,
      levels: levels,
      todayLevel: levels[0],
      severity: CONTAMINATION_SEVERITY[levels[0]] || 'none',
      dailySeverity: levels.map((l) => CONTAMINATION_SEVERITY[l] || 'none'),
    };
  });

  // Sort by today's level descending
  allergens.sort((a, b) => b.todayLevel - a.todayLevel);

  return {
    allergens: allergens,
    allergyRisk: data.allergyrisk || {},
    allergyRiskHourly: data.allergyrisk_hourly || {},
  };
}

function renderPollenInfoResults(data) {
  const section = document.getElementById('polleninfo-section');
  const grid = document.getElementById('polleninfo-grid');

  if (data.error) {
    section.hidden = false;
    grid.innerHTML = `<p class="orf-error" style="grid-column:1/-1">⚠ ${escapeHtml(data.error)}</p>`;
    return;
  }

  if (!data.allergens || data.allergens.length === 0) {
    section.hidden = false;
    grid.innerHTML = `<div class="no-data-message" style="grid-column:1/-1">
      Derzeit keine Daten von Polleninformation.at verfügbar.
    </div>`;
    return;
  }

  section.hidden = false;
  grid.innerHTML = '';

  // Allergy risk summary
  const risk = data.allergyRisk;
  if (risk.allergyrisk_1 != null) {
    const riskBar = document.createElement('div');
    riskBar.className = 'allergy-risk-summary';
    const riskToday = risk.allergyrisk_1;
    const riskColor = riskToday <= 2 ? 'var(--color-none)' :
                      riskToday <= 4 ? 'var(--color-low)' :
                      riskToday <= 6 ? 'var(--color-moderate)' :
                      riskToday <= 8 ? 'var(--color-high)' :
                                       'var(--color-very-high)';

    riskBar.innerHTML = `
      <div class="risk-header">Allergierisiko heute</div>
      <div class="risk-meter">
        <div class="risk-meter-fill" style="width:${riskToday * 10}%; background:${riskColor}"></div>
      </div>
      <div class="risk-values">
        ${[risk.allergyrisk_1, risk.allergyrisk_2, risk.allergyrisk_3, risk.allergyrisk_4]
          .map((v, i) => `<span class="risk-day">${DAY_LABELS[i]}: <strong>${v ?? '–'}</strong>/10</span>`)
          .join('')}
      </div>`;
    grid.appendChild(riskBar);
  }

  // Allergen cards
  const hidden = getHiddenAllergens();
  const hiddenInSection = [];

  for (const allergen of data.allergens) {
    if (hidden.includes(allergen.name)) {
      hiddenInSection.push(allergen.name);
      continue;
    }
    grid.appendChild(createPollenInfoCard(allergen));
  }

  renderHiddenSection(document.getElementById('polleninfo-hidden'), hiddenInSection);
}

function createPollenInfoCard(allergen) {
  const card = document.createElement('div');
  card.className = 'allergen-card';

  const severityClass = `severity-${allergen.severity.replace('_', '-')}`;
  const severityLabel = CONTAMINATION_LABELS[allergen.todayLevel] || 'Keine';

  const forecastHTML = allergen.dailySeverity
    .map((sev, i) => {
      const dotColor = getSeverityColor(sev);
      return `
        <div class="forecast-day">
          <span class="forecast-day-label">${DAY_LABELS[i] || `Tag ${i}`}</span>
          <span class="forecast-dot" style="background:${dotColor}" title="${SEVERITY_LABELS[sev]}"></span>
        </div>`;
    })
    .join('');

  card.innerHTML = `
    <div class="allergen-card-header">
      <div>
        <div class="allergen-name">${escapeHtml(allergen.name)}</div>
        ${allergen.latin ? `<div class="allergen-name-latin">${escapeHtml(allergen.latin)}</div>` : ''}
      </div>
      <div class="allergen-card-actions">
        <span class="severity-badge ${severityClass}">${severityLabel}</span>
        <button class="allergen-card-hide-btn" title="Ausblenden">&times;</button>
      </div>
    </div>
    <div class="allergen-value">
      Belastungsstufe: ${allergen.todayLevel}/4
    </div>
    <div class="severity-bar-container">
      <div class="severity-bar level-${allergen.severity.replace('_', '-')}"></div>
    </div>
    <div class="forecast-row">
      ${forecastHTML}
    </div>`;

  card.querySelector('.allergen-card-hide-btn').addEventListener('click', () => {
    hideAllergen(allergen.name);
    reRender();
  });

  return card;
}

// ── ORF Wetter Pollen ───────────────────────────────────────────────

// CORS proxies to try in order (Safari blocks some proxies)
const CORS_PROXIES = [
  {
    name: 'allorigins',
    buildUrl: (url) => `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`,
    extractHtml: (data) => data.contents,
  },
  {
    name: 'corsproxy.io',
    buildUrl: (url) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
    extractHtml: (text) => text, // returns raw HTML
    isRaw: true,
  },
  {
    name: 'corsproxy.org',
    buildUrl: (url) => `https://corsproxy.org/?${encodeURIComponent(url)}`,
    extractHtml: (text) => text,
    isRaw: true,
  },
];

async function fetchOrfPollen(zip) {
  const stateKey = zipToState(zip);
  if (!stateKey) {
    throw new Error('Bundesland konnte nicht ermittelt werden.');
  }

  const state = ORF_STATES[stateKey];
  const orfUrl = `https://wetter.orf.at/${state.slug}/pollen`;

  let lastError = null;

  for (const proxy of CORS_PROXIES) {
    try {
      const proxyUrl = proxy.buildUrl(orfUrl);
      // AbortSignal.timeout may not exist in older Safari
      const fetchOpts = {};
      if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) {
        fetchOpts.signal = AbortSignal.timeout(10000);
      }
      const response = await fetch(proxyUrl, fetchOpts);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      let html;
      if (proxy.isRaw) {
        html = await response.text();
      } else {
        const data = await response.json();
        html = proxy.extractHtml(data);
      }

      if (!html || html.length < 100) {
        throw new Error('Leere Antwort');
      }

      return parseOrfHtml(html, state, orfUrl);
    } catch (err) {
      lastError = err;
      // Try the next proxy
    }
  }

  throw new Error(`ORF Wetter konnte nicht geladen werden: ${lastError?.message || 'Alle Proxies fehlgeschlagen'}`);
}

function parseOrfHtml(html, state, sourceUrl) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  // Extract main pollen text from fulltextWrapper or storyText
  const fulltext = doc.querySelector('.fulltextWrapper') ||
                   doc.querySelector('#ss-storyText') ||
                   doc.querySelector('.storyText');

  let paragraphs = [];
  let title = '';
  let publishDate = '';

  // Get the heading
  const h1 = doc.querySelector('h1');
  if (h1) {
    title = h1.textContent.trim();
  }

  // Get the publication date
  const dateEl = doc.querySelector('.date');
  if (dateEl) {
    publishDate = dateEl.textContent.trim();
  }

  // Words/patterns to skip in extracted paragraphs
  const skipPatterns = [
    /^Quelle:/i,
    /^Publiziert am/i,
    /^Seitenanfang$/i,
    /^Zum Inhalt/i,
    /^Navigation$/i,
    /^Wetter$/i,
    /^\d{2}\.\d{2}\.\d{4}$/,
  ];

  function isUsefulText(text) {
    if (!text || text.length < 20) return false;
    return !skipPatterns.some((re) => re.test(text));
  }

  if (fulltext) {
    // Extract all paragraph text
    const pElements = fulltext.querySelectorAll('p');
    if (pElements.length > 0) {
      pElements.forEach((p) => {
        const text = p.textContent.trim();
        if (isUsefulText(text)) {
          paragraphs.push(text);
        }
      });
    }

    // Fallback: if no <p> tags, get the textContent directly
    if (paragraphs.length === 0) {
      const rawText = fulltext.textContent.trim();
      if (rawText) {
        paragraphs = rawText
          .split(/\n\n+/)
          .map((s) => s.trim())
          .filter(isUsefulText);
      }
    }
  }

  // If fulltextWrapper parsing failed, try a broader approach
  if (paragraphs.length === 0) {
    const allParagraphs = doc.querySelectorAll('p');
    allParagraphs.forEach((p) => {
      const text = p.textContent.trim();
      if (text.length > 50 && /pollen|allergen|blüte|belastung|konzentration/i.test(text)) {
        paragraphs.push(text);
      }
    });
  }

  // Remove paragraphs that duplicate the title
  if (title) {
    paragraphs = paragraphs.filter((p) => p !== title);
  }

  return {
    state: state,
    title: title,
    publishDate: publishDate,
    paragraphs: paragraphs,
    sourceUrl: sourceUrl,
  };
}

function renderOrfResults(orfData, zip) {
  const orfSection = document.getElementById('orf-section');
  const orfContent = document.getElementById('orf-content');
  const orfStateLabel = document.getElementById('orf-state-label');
  const orfLink = document.getElementById('orf-link');

  if (orfData.error) {
    orfSection.hidden = false;
    orfStateLabel.textContent = '';
    orfContent.innerHTML = `<p class="orf-error">⚠ ${orfData.error}</p>`;
    return;
  }

  orfSection.hidden = false;
  orfStateLabel.textContent = `Bundesland: ${orfData.state.label}`;
  orfLink.href = orfData.sourceUrl;

  if (orfData.paragraphs.length === 0) {
    orfContent.innerHTML = '<p class="orf-error">Kein Pollentext auf der ORF-Seite gefunden.</p>';
    return;
  }

  let html = '';

  if (orfData.title) {
    html += `<p><strong>${orfData.title}</strong></p>`;
  }

  orfData.paragraphs.forEach((p) => {
    html += `<p>${escapeHtml(p)}</p>`;
  });

  if (orfData.publishDate) {
    html += `<p class="orf-date">${escapeHtml(orfData.publishDate)}</p>`;
  }

  orfContent.innerHTML = html;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ── UI Helpers ──────────────────────────────────────────────────────

function showError(msg) {
  errorMessage.textContent = msg;
  errorMessage.hidden = false;
}

function hideError() {
  errorMessage.hidden = true;
}

function showLoading() {
  loading.hidden = false;
}

function hideLoading() {
  loading.hidden = true;
}

function showResults() {
  results.hidden = false;
}

function hideResults() {
  results.hidden = true;
}
