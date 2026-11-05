// Só a aba ativa fica montada: um evento disparado junto com a troca de rota
// chegaria antes da Base existir. O pedido fica aqui até a Base consumi-lo.
let pending = false;

export function requestGroupsManager() {
  pending = true;
  window.location.hash = '#base';
}

export function consumeGroupsManagerRequest() {
  const requested = pending;
  pending = false;
  return requested;
}
