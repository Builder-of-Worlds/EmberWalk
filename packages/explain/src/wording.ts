export const CODE_WORDS = {
  en: ["woody", "combustible", "combustibles", "fuel", "fuels", "aerial", "vegetation", "vegetative", "forbs", "flammable", "fire resistant", "fire retardant", "mineral soil"],
  es: ["leñoso", "leñosa", "leñosos", "leñosas", "aéreo", "aérea", "aéreos", "aéreas", "vegetación", "inflamable", "inflamables", "resistente al fuego", "resistentes al fuego", "ignífugo", "ignífuga", "suelo mineral"],
} as const;

export const URGENT_WORDS = {
  en: ["right away", "now", "immediately", "urgent", "urgently", "soon", "asap", "at once", "at all times", "before it is too late", "today", "quickly", "hurry", "danger", "dangerous", "deadly", "emergency", "risk", "fatal", "disaster"],
  es: ["de inmediato", "inmediatamente", "ahora", "enseguida", "cuanto antes", "lo antes posible", "urgente", "urgentemente", "pronto", "en todo momento", "antes de que sea tarde", "hoy", "rápido", "rápidamente", "peligro", "peligroso", "peligrosa", "emergencia", "riesgo", "mortal", "desastre"],
} as const;

const EDGE_BEFORE = "(?<![\\p{L}\\p{N}])";
const EDGE_AFTER = "(?![\\p{L}\\p{N}])";

const pattern = (phrase: string) => new RegExp(`${EDGE_BEFORE}${phrase.replaceAll(" ", "[\\s-]+")}${EDGE_AFTER}`, "iu");

const LISTED = [...new Set([...CODE_WORDS.en, ...CODE_WORDS.es, ...URGENT_WORDS.en, ...URGENT_WORDS.es])].map((word) => ({ word, re: pattern(word) }));

const word = (alternatives: string) => `${EDGE_BEFORE}(?:${alternatives})${EDGE_AFTER}`;

const NOT_FOUND = [
  `${word("no|not|never|nothing")}[^.;]*?${word("seen|found|visible|show|shows|showed|shown|spotted|detected")}`,
  `${word("no")}(?:\\s+[\\p{L}-]+){0,4}\\s+(?:is|are)\\s+(?:needed|necessary|required)${EDGE_AFTER}`,
  `${word("not")}\\s+(?:needed|necessary|required)${EDGE_AFTER}`,
  `${word("nothing\\s+to\\s+do")}`,
  `${word("no\\s+se\\s+(?:vio|ve|ven|vieron|encontró|encontraron|observó|observa|detectó|muestra|muestran)")}`,
  `${word("no\\s+hay")}`,
  `${word("no\\s+(?:hace\\s+falta|es\\s+necesari[oa]|se\\s+necesita)")}`,
  `${word("nada\\s+que\\s+hacer")}`,
].map((source) => new RegExp(source, "iu"));

export function wordingProblems(text: string): string[] {
  const listed = LISTED.filter(({ re }) => re.test(text)).map(({ word: w }) => `uses "${w}"; use plain, calm words, colour shows urgency`);
  const notFound = NOT_FOUND.some((re) => re.test(text)) ? ["speaks of a thing not found; write only about what the walk found"] : [];
  return [...listed, ...notFound];
}
