import { fold } from './leadMatch.mjs';

// O mesmo número aparece com e sem DDI: "+55 21 9…" e "(21) 9…".
const phoneKey = (value) => {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits.startsWith('55') && digits.length >= 12 ? digits.slice(2) : digits;
};

/** Card do quadro que representa o lead: id da fonte, nome + endereço ou telefone. */
export function findKanbanCard(cards, lead) {
  const list = Array.isArray(cards) ? cards : [];
  const id = String(lead?.id ?? '');
  if (id) {
    const byId = list.find((card) => {
      const refs = card.entity?.sourceRefs || {};
      return [...(refs.mapsIds || []), ...(refs.scoringIds || [])].map(String).includes(id);
    });
    if (byId) return byId;
  }
  const name = fold(lead?.name);
  const address = fold(lead?.address);
  if (name && address.length > 4) {
    const byPlace = list.find((card) => {
      const profile = card.entity?.profile || {};
      return fold(profile.name) === name && fold(profile.address) === address;
    });
    if (byPlace) return byPlace;
  }
  const phone = phoneKey(lead?.phone);
  if (phone.length < 8) return null;
  return list.find((card) => phoneKey(card.entity?.profile?.phone) === phone) || null;
}

/** O que mudar de etapa exige: etapas de desfecho registram o negócio, como no quadro. */
export function stageAction(card, column) {
  if (card.columnId === column.id) return 'none';
  if (column.dealOutcome && card.dealStatus !== column.dealOutcome) return column.dealOutcome;
  return 'move';
}

export function parseDealValue(value) {
  const normalized = String(value ?? '').replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, '');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}
