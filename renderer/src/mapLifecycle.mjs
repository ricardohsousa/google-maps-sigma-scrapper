export function disposeLeafletMap(map) {
  if (!map) return;
  // Leaflet 1.9.4 deixa um timeout de 250 ms de _onZoomTransitionEnd
  // sem identificador cancelável. remove() interrompe pan/flyTo, mas não
  // limpa esta flag; o callback tenta acessar o pane já destruído.
  map._animatingZoom = false;
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
