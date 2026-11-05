export function disposeLeafletMap(map) {
  if (!map) return;
  // Leaflet 1.9.4 deixa um timeout de 250 ms de _onZoomTransitionEnd
  // sem identificador cancelável. remove() interrompe pan/flyTo, mas não
  // limpa esta flag; o callback tenta acessar o pane já destruído.
  map._animatingZoom = false;
  // O debounce da roda do mouse também sobrevive a remove(): disable() só
  // retira o listener, e _performZoom acessaria o pane já destruído.
  clearTimeout(map.scrollWheelZoom?._timer);
  map.remove();
}

export async function canLocateAutomatically(permissions) {
  if (!permissions?.query) return false;
  try {
    return (await permissions.query({ name: 'geolocation' })).state === 'granted';
  } catch {
    return false;
  }
}
