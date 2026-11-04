const STATES = new Set('AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' '));

const text = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

// Só interpreta o trecho explícito Cidade - UF do endereço brasileiro.
// A cidade pesquisada não determina a localização de todos os resultados.
export function leadLocation(lead = {}) {
  const company = lead.company && typeof lead.company === 'object' ? lead.company : {};
  const city = text(lead.city || lead.cidade || company.city || company.cidade);
  const state = text(lead.state || lead.uf || company.state || company.uf);
  const neighborhood = text(lead.neighborhood || lead.bairro || lead.hood || company.neighborhood || company.bairro);
  const address = text(lead.address || company.address);
  let inferredCity = '';
  let inferredState = '';
  let inferredNeighborhood = '';
  for (const match of address.matchAll(/(?:^|,)\s*([^,]+?)\s*[-/]\s*([A-Za-z]{2})(?=\s*(?:,|$|\d{5}-?\d{3}))/g)) {
    const uf = match[2].toUpperCase();
    const candidate = text(match[1].split(/\s+[-–—]\s+/).at(-1));
    if (!STATES.has(uf) || !candidate || /\d/.test(candidate) || /^(?:rua|r\.|avenida|av\.|rodovia)\s/i.test(candidate)) continue;
    inferredCity = candidate;
    inferredState = uf;
    const prefix = address.slice(0, match.index);
    inferredNeighborhood = text(prefix.match(/\s+-\s+([^,]+)$/)?.[1]);
  }
  return {
    city: city || inferredCity,
    state: STATES.has(state.toUpperCase()) ? state.toUpperCase() : (state || inferredState),
    neighborhood: neighborhood || inferredNeighborhood,
  };
}
