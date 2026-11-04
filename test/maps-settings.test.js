const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const mapsSettings = require('../utils/maps-settings');

function useTempFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maps-settings-'));
  const file = path.join(dir, 'maps-settings.json');
  mapsSettings.setPath(file);
  return file;
}

test('defaults to the scraper with no key', () => {
  useTempFile();
  assert.deepEqual(mapsSettings.getPublic(), { defaultSource: 'scraper', hasPlacesApiKey: false, placesApiKeyMask: '' });
});

test('stores the key but only exposes a mask', () => {
  useTempFile();
  const pub = mapsSettings.update({ placesApiKey: 'AIzaSyEXAMPLEKEY1234', defaultSource: 'places-api' });
  assert.equal(pub.hasPlacesApiKey, true);
  assert.equal(pub.defaultSource, 'places-api');
  assert.ok(!pub.placesApiKeyMask.includes('EXAMPLE'));
  assert.equal(mapsSettings.load().placesApiKey, 'AIzaSyEXAMPLEKEY1234');
});

test('keeps the key when omitted, removes it when empty, ignores unknown sources', () => {
  useTempFile();
  mapsSettings.update({ placesApiKey: 'AIzaSyEXAMPLEKEY1234' });
  mapsSettings.update({ defaultSource: 'nope' });
  assert.equal(mapsSettings.load().placesApiKey, 'AIzaSyEXAMPLEKEY1234');
  assert.equal(mapsSettings.load().defaultSource, 'scraper');
  mapsSettings.update({ placesApiKey: '' });
  assert.equal(mapsSettings.getPublic().hasPlacesApiKey, false);
});
