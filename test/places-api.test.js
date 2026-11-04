const assert = require('node:assert/strict');
const test = require('node:test');

const { searchPlacesApi, testPlacesApiKey, MAX_API_RESULTS } = require('../places-api');

function mockFetch(pages) {
  const calls = [];
  global.fetch = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    const page = pages[calls.length - 1] || { places: [] };
    if (page.status) {
      return { ok: false, status: page.status, json: async () => ({ error: { message: page.message } }) };
    }
    return { ok: true, status: 200, json: async () => page };
  };
  return calls;
}

function place(i, extra = {}) {
  return {
    id: `place-${i}`,
    displayName: { text: `Clínica ${i}` },
    primaryTypeDisplayName: { text: 'Dentista' },
    formattedAddress: `Rua ${i}, 100 - Centro, Campinas - SP, 13010-000, Brasil`,
    location: { latitude: -22.9 - i / 1000, longitude: -47.06 },
    nationalPhoneNumber: '(19) 3232-0000',
    rating: 4.7,
    userRatingCount: 120,
    googleMapsUri: `https://maps.google.com/?cid=${i}`,
    ...extra,
  };
}

test('maps Places API results to the scraper lead shape', async () => {
  const calls = mockFetch([{ places: [place(1)] }]);
  const res = await searchPlacesApi('dentista Campinas', 10, () => {}, null, { apiKey: 'k' });

  assert.equal(res.success, true);
  assert.equal(res.count, 1);
  const lead = res.data[0];
  assert.equal(lead.name, 'Clínica 1');
  assert.equal(lead.category, 'Dentista');
  assert.equal(lead.placeId, 'place-1');
  assert.equal(lead.reviewCount, 120);
  assert.equal(lead.rating, 4.7);
  assert.equal(lead.coordSource, 'places-api');
  assert.ok(lead.phone);
  assert.equal(calls[0].init.headers['X-Goog-Api-Key'], 'k');
  assert.equal(calls[0].body.textQuery, 'dentista Campinas');
});

test('follows nextPageToken and caps at the API maximum', async () => {
  const pageOf = (start, token) => ({
    places: Array.from({ length: 20 }, (_, i) => place(start + i)),
    ...(token ? { nextPageToken: token } : {}),
  });
  const calls = mockFetch([pageOf(0, 't1'), pageOf(20, 't2'), pageOf(40, 't3'), pageOf(60)]);
  const res = await searchPlacesApi('dentista', 1000, () => {}, null, { apiKey: 'k' });

  assert.equal(res.count, MAX_API_RESULTS);
  assert.equal(calls.length, 3);
  assert.equal(calls[1].body.pageToken, 't1');
});

test('skips permanently closed businesses', async () => {
  mockFetch([{ places: [place(1), place(2, { businessStatus: 'CLOSED_PERMANENTLY' })] }]);
  const res = await searchPlacesApi('dentista', 10, () => {}, null, { apiKey: 'k' });
  assert.deepEqual(res.data.map((l) => l.placeId), ['place-1']);
});

test('moves an Instagram website into the instagram field', async () => {
  mockFetch([{ places: [place(1, { websiteUri: 'https://www.instagram.com/clinica1/' })] }]);
  const res = await searchPlacesApi('dentista', 10, () => {}, null, { apiKey: 'k' });
  assert.ok(res.data[0].instagram.includes('clinica1'));
  assert.ok(!res.data[0].website);
});

test('reports API errors and a missing key without throwing', async () => {
  mockFetch([{ status: 403, message: 'API key not valid' }]);
  const denied = await searchPlacesApi('dentista', 10, () => {}, null, { apiKey: 'bad' });
  assert.equal(denied.success, false);
  assert.match(denied.error, /API key not valid/);

  const noKey = await searchPlacesApi('dentista', 10, () => {}, null, {});
  assert.equal(noKey.success, false);

  mockFetch([{ status: 400, message: 'bad key' }]);
  assert.deepEqual(await testPlacesApiKey('bad'), { success: false, error: 'bad key' });
});

test('stops when cancelled', async () => {
  mockFetch([{ places: [place(1)] }]);
  await assert.rejects(
    searchPlacesApi('dentista', 10, () => {}, { cancelled: true }, { apiKey: 'k' }),
    (err) => err.code === 'SCRAPE_CANCELLED',
  );
});
