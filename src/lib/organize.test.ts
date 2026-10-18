import { describe, expect, it } from "vitest";
import { duplicateCard, initialCards, insertBlankAfter, isUnchanged, moveCard, removeCard, rotateCard, toOrganizeItems } from "./organize";

describe("organize cards", () => {
  it("starts with one card per page and reports unchanged", () => {
    const cards = initialCards(3);
    expect(toOrganizeItems(cards)).toEqual([{ source: 0, rotate: 0 }, { source: 1, rotate: 0 }, { source: 2, rotate: 0 }]);
    expect(isUnchanged(cards, 3)).toBe(true);
  });

  it("moves, rotates, duplicates, inserts blanks and removes", () => {
    let cards = initialCards(3);
    cards = moveCard(cards, cards[2].key, -2);
    cards = rotateCard(cards, cards[0].key, -90);
    cards = duplicateCard(cards, cards[1].key);
    cards = insertBlankAfter(cards, cards[0].key);
    cards = removeCard(cards, cards[cards.length - 1].key);
    expect(toOrganizeItems(cards)).toEqual([{ source: 2, rotate: 270 }, { blank: true }, { source: 0, rotate: 0 }, { source: 0, rotate: 0 }]);
    expect(isUnchanged(cards, 3)).toBe(false);
    expect(new Set(cards.map((card) => card.key)).size).toBe(cards.length);
  });

  it("ignores moves past either end and rotating blank pages", () => {
    const cards = initialCards(2);
    expect(toOrganizeItems(moveCard(cards, cards[0].key, -1))).toEqual(toOrganizeItems(cards));
    const withBlank = insertBlankAfter(cards, cards[1].key);
    expect(toOrganizeItems(rotateCard(withBlank, withBlank[2].key, 90))[2]).toEqual({ blank: true });
  });
});
