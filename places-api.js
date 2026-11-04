const { chromium } = require('playwright');
const CONFIG = require('./config');
const {
  scrapeEmails,
  normalizePlaceText,
  describeExtractedPlace,
  checkCancelled,
} = require('./scraper');
const { isSocialUrl, isAggregatorUrl } = require('./utils/lead-links');

// Places API (New) — Text Search. Cada página traz até 20 lugares e o Google
// limita a busca a 3 páginas (60 resultados); para ir além, divida por bairro.
const SEARCH_URL = 'https://places.googleapis.com/v1/places:searchText';
const PAGE_SIZE = 20;
const MAX_API_RESULTS = 60;
const FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.primaryTypeDisplayName',
  'places.formattedAddress',
  'places.location',
  'places.nationalPhoneNumber',
  'places.internationalPhoneNumber',
  'places.websiteUri',
  'places.rating',
  'places.userRatingCount',
  'places.googleMapsUri',
  'places.businessStatus',
  'nextPageToken',
].join(',');

async function requestPage(apiKey, body) {
  const resp = await fetch(SEARCH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': FIELD_MASK,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(CONFIG.PAGE_TIMEOUT),
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const reason = json?.error?.message || `HTTP ${resp.status}`;
    const err = new Error(`Places API: ${reason}`);
    err.status = resp.status;
    throw err;
  }
  return json;
}

function toPlace(p = {}) {
  const lat = Number(p.location?.latitude);
  const lng = Number(p.location?.longitude);
  const hasCoord = Number.isFinite(lat) && Number.isFinite(lng);
  const reviewCount = Number(p.userRatingCount) || 0;
  return normalizePlaceText({
    name: p.displayName?.text || '',
    rating: Number(p.rating) || 0,
    totalReviews: String(reviewCount),
    reviewCount,
    category: p.primaryTypeDisplayName?.text || '',
    address: p.formattedAddress || '',
    phone: p.nationalPhoneNumber || p.internationalPhoneNumber || null,
    website: p.websiteUri || null,
    instagram: '',
    priceRange: null,
    plusCode: null,
    description: '',
    openingHours: '',
    photos: { main: '', thumbnail: '', all: [], count: 0 },
    latitude: hasCoord ? lat : '',
    longitude: hasCoord ? lng : '',
    coordSource: hasCoord ? 'places-api' : 'none',
    placeId: p.id || '',
    googleMapsUrl: p.googleMapsUri || '',
    source: 'places-api',
  });
}

async function launchBrowserForEmails(onProgress) {
  for (const opts of [{ headless: true, channel: 'chrome' }, { headless: true }]) {
    try {
      return await chromium.launch(opts);
    } catch {}
  }
  onProgress('Navegador indisponível: os e-mails dos sites não serão coletados nesta busca.');
  return null;
}

/**
 * Busca empresas pela Places API oficial e devolve o mesmo formato de
 * `scrapeGoogleMaps`, para o restante do app não precisar distinguir a origem.
 */
async function searchPlacesApi(searchQuery, maxResults = 60, onProgress = console.log, cancelToken = null, { apiKey } = {}) {
  if (!apiKey) {
    return { success: false, error: 'Configure a chave da Google Places API em Configurações.', data: [], count: 0, statistics: {} };
  }
  const limit = Math.min(Math.max(1, Number(maxResults) || MAX_API_RESULTS), MAX_API_RESULTS);
  const statistics = { withPhone: 0, withWebsite: 0, withInstagram: 0, withEmail: 0, withRating: 0, withPhotos: 0 };
  const raw = [];

  onProgress('Consultando a Google Places API…');
  let pageToken = '';
  try {
    do {
      checkCancelled(cancelToken);
      const json = await requestPage(apiKey, {
        textQuery: searchQuery,
        languageCode: 'pt-BR',
        regionCode: 'BR',
        pageSize: PAGE_SIZE,
        ...(pageToken ? { pageToken } : {}),
      });
      const batch = (json.places || []).filter((p) => p.businessStatus !== 'CLOSED_PERMANENTLY');
      raw.push(...batch);
      pageToken = json.nextPageToken || '';
      onProgress({
        type: 'listing-count',
        found: raw.length,
        message: `${raw.length} empresa${raw.length === 1 ? '' : 's'} encontrada${raw.length === 1 ? '' : 's'} pela Places API.`,
      });
    } while (pageToken && raw.length < limit);
  } catch (e) {
    if (e.code === 'SCRAPE_CANCELLED') throw e;
    if (!raw.length) return { success: false, error: e.message, data: [], count: 0, statistics };
    onProgress(`A busca parou antes do fim: ${e.message}`);
  }

  if (!raw.length) {
    return { success: false, error: 'Nenhum resultado encontrado.', data: [], count: 0, statistics };
  }

  const places = raw.slice(0, limit).map(toPlace).filter((p) => p.name);
  const total = places.length;
  const needsEmail = places.some((p) => p.website && !isSocialUrl(p.website) && !isAggregatorUrl(p.website));
  const browser = needsEmail ? await launchBrowserForEmails(onProgress) : null;

  try {
    for (let i = 0; i < total; i++) {
      checkCancelled(cancelToken);
      const place = places[i];
      place.email = browser && place.website && !isSocialUrl(place.website) && !isAggregatorUrl(place.website)
        ? await scrapeEmails(browser, place.website, onProgress, cancelToken)
        : '';

      if (place.phone) statistics.withPhone++;
      if (place.website) statistics.withWebsite++;
      if (place.instagram) statistics.withInstagram++;
      if (place.email) statistics.withEmail++;
      if (place.rating) statistics.withRating++;

      onProgress({
        type: 'lead',
        current: i + 1,
        total,
        found: i + 1,
        lead: place,
        message: describeExtractedPlace(place, i + 1, total),
      });
    }
  } catch (e) {
    if (e.code === 'SCRAPE_CANCELLED') onProgress('Extração cancelada.');
    throw e;
  } finally {
    await browser?.close().catch(() => {});
  }

  onProgress(`Extração concluída: ${total} empresa${total === 1 ? '' : 's'} pela Places API.`);
  statistics.total = total;
  return { success: true, data: places, count: total, statistics };
}

/** Faz uma consulta mínima para validar a chave sem gastar a cota de detalhes. */
async function testPlacesApiKey(apiKey) {
  try {
    const resp = await fetch(SEARCH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'places.id',
      },
      body: JSON.stringify({ textQuery: 'padaria São Paulo', pageSize: 1 }),
      signal: AbortSignal.timeout(15000),
    });
    if (resp.ok) return { success: true };
    const json = await resp.json().catch(() => ({}));
    return { success: false, error: json?.error?.message || `HTTP ${resp.status}` };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

module.exports = { searchPlacesApi, testPlacesApiKey, MAX_API_RESULTS };
