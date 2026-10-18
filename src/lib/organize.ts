import { normalizeRotation, type Rotation } from "./pageGeometry";
import type { OrganizeItem } from "./pageTools";

/** One card in the Organize grid. `key` is stable across edits for React. */
export type OrganizeCard = { key: string; source: number; rotate: Rotation } | { key: string; blank: true };

let nextKey = 0;
const newKey = () => `card-${nextKey++}`;

export function initialCards(pageCount: number): OrganizeCard[] {
  return Array.from({ length: pageCount }, (_, source) => ({ key: newKey(), source, rotate: 0 as Rotation }));
}

function indexOf(cards: readonly OrganizeCard[], key: string): number {
  return cards.findIndex((card) => card.key === key);
}

export function moveCard(cards: readonly OrganizeCard[], key: string, offset: number): OrganizeCard[] {
  const from = indexOf(cards, key);
  const to = from + offset;
  if (from < 0 || to < 0 || to >= cards.length) return [...cards];
  const next = [...cards];
  const [card] = next.splice(from, 1);
  next.splice(to, 0, card);
  return next;
}

export function rotateCard(cards: readonly OrganizeCard[], key: string, by: number): OrganizeCard[] {
  return cards.map((card) => (card.key === key && "source" in card ? { ...card, rotate: normalizeRotation(card.rotate + by) } : card));
}

export function removeCard(cards: readonly OrganizeCard[], key: string): OrganizeCard[] {
  return cards.filter((card) => card.key !== key);
}

export function duplicateCard(cards: readonly OrganizeCard[], key: string): OrganizeCard[] {
  const index = indexOf(cards, key);
  if (index < 0) return [...cards];
  const next = [...cards];
  next.splice(index + 1, 0, { ...cards[index], key: newKey() });
  return next;
}

export function insertBlankAfter(cards: readonly OrganizeCard[], key: string): OrganizeCard[] {
  const index = indexOf(cards, key);
  const next = [...cards];
  next.splice(index + 1, 0, { key: newKey(), blank: true });
  return next;
}

export function toOrganizeItems(cards: readonly OrganizeCard[]): OrganizeItem[] {
  return cards.map((card) => ("blank" in card ? { blank: true } : { source: card.source, rotate: card.rotate }));
}

/** True when the cards describe the original document unchanged. */
export function isUnchanged(cards: readonly OrganizeCard[], pageCount: number): boolean {
  return cards.length === pageCount && cards.every((card, index) => "source" in card && card.source === index && card.rotate === 0);
}
