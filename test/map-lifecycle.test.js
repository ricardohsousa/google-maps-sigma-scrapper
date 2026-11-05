const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('callback real de zoom do Leaflet pendente não acessa o pane após descarte', async () => {
  const { disposeLeafletMap } = await import('../renderer/src/mapLifecycle.mjs');
  const source = fs.readFileSync(path.join(path.dirname(require.resolve('leaflet/package.json')), 'src/map/Map.js'), 'utf8');
  const method = source.match(/_onZoomTransitionEnd: (function \(\) \{[\s\S]*?\n\t\})\r?\n\}\);/)[1];
  const finishZoom = vm.runInNewContext(`(${method})`, { DomUtil: { removeClass() {} } });
  const map = {
    _animatingZoom: true, _mapPane: { _leaflet_pos: { x: 1 } },
    remove() { delete this._mapPane; },
    _move() { return this._mapPane._leaflet_pos; },
    fire() {}, _moveEnd() {},
  };
  const pendingCallback = finishZoom.bind(map);
  map.remove();
  assert.throws(pendingCallback, /_leaflet_pos/);
  map._animatingZoom = true;
  disposeLeafletMap(map);
  assert.doesNotThrow(pendingCallback);
  assert.doesNotThrow(pendingCallback);
});

test('zoom pendente da roda do mouse é cancelado ao descartar o mapa', async () => {
  const { disposeLeafletMap } = await import('../renderer/src/mapLifecycle.mjs');
  const source = fs.readFileSync(path.join(path.dirname(require.resolve('leaflet/package.json')), 'src/map/handler/Map.ScrollWheelZoom.js'), 'utf8');
  assert.match(source, /this\._timer = setTimeout\(Util\.bind\(this\._performZoom, this\)/);

  let performed = false;
  const map = {
    scrollWheelZoom: { _timer: setTimeout(() => { performed = true; }, 0) },
    remove() {},
  };
  disposeLeafletMap(map);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(performed, false);
});

test('localização automática só usa permissão já concedida', async () => {
  const { canLocateAutomatically } = await import('../renderer/src/mapLifecycle.mjs');
  for (const state of ['granted', 'prompt', 'denied']) {
    assert.equal(await canLocateAutomatically({ query: async options => {
      assert.deepEqual(options, { name: 'geolocation' });
      return { state };
    } }), state === 'granted');
  }
  assert.equal(await canLocateAutomatically(undefined), false);
  assert.equal(await canLocateAutomatically({ query: async () => { throw new Error('unsupported'); } }), false);
});
