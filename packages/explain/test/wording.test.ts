import { describe, expect, it } from "vitest";
import { RULES } from "@emberwalk/rules";
import { CODE_WORDS, URGENT_WORDS, wordingProblems } from "../src/index.ts";

describe("wordingProblems, normal", () => {
  it("passes a calm sentence that gives a concrete way to do it", () => {
    expect(wordingProblems("Replace the part of the wooden fence within 5 feet of the house with metal or brick.")).toEqual([]);
    expect(wordingProblems("Cambie la parte de la cerca de madera a menos de 5 pies de la casa por metal o ladrillo.")).toEqual([]);
  });

  it("passes every rule's plain text, in English and Spanish", () => {
    for (const row of RULES) for (const text of [row.plain.en, row.plain.es]) expect(wordingProblems(text), `${row.id}: ${text}`).toEqual([]);
  });

  it("does not mistake a listed word inside a longer word", () => {
    expect(wordingProblems("You know the snow line on the roof; sweep the needles off it.")).toEqual([]);
    expect(wordingProblems("Use the fuel-free gravel path.")).not.toEqual([]);
  });
});

describe("wordingProblems, invalid", () => {
  it.each([...CODE_WORDS.en, ...CODE_WORDS.es])("refuses the code word %s", (word) => {
    expect(wordingProblems(`Move the ${word} pile 30 feet from the house.`)).toEqual([expect.stringContaining(`"${word}"`)]);
  });

  it.each([...URGENT_WORDS.en, ...URGENT_WORDS.es])("refuses the urgent word %s", (word) => {
    expect(wordingProblems(`Move the pile 30 feet from the house ${word}.`)).toEqual([expect.stringContaining(`"${word}"`)]);
  });

  it("refuses the words whatever their case or hyphen", () => {
    expect(wordingProblems("Use Fire-Resistant material.")).not.toEqual([]);
    expect(wordingProblems("RIGHT AWAY, clear it.")).not.toEqual([]);
    expect(wordingProblems("Quítela Ahora.")).not.toEqual([]);
  });
});

describe("wordingProblems, refused: a sentence about a thing not found", () => {
  it.each([
    "No fence was seen, so no fence work is needed.",
    "No dry brush was seen, so no clearing is needed.",
    "The frames do not show a fence.",
    "Nothing to do here.",
    "No work is needed for this.",
    "No se vio ninguna cerca, así que no hace falta trabajo.",
    "No se ve maleza seca.",
    "No hay leña junto a la casa.",
    "No es necesario hacer nada.",
  ])("refuses %s", (text) => {
    expect(wordingProblems(text)).toEqual([expect.stringContaining("not found")]);
  });
});
