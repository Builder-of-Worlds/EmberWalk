import { landingEs, ridgeAltEs } from "./landing-es";

export type Language = "en" | "es";

// Lines split around a tag on the page. Each Spanish part is cut from the reviewed line, never rewritten.
export const SPLITS = [
  { en: "3.7 million", es: "3.7 millones", join: " ", enParts: ["3.7", "million"], esParts: ["3.7", "millones"] },
  {
    en: "EmberWalk drafts your inspection request, with every fix listed and links to the CAL FIRE pages where you can request an inspection and find your local fire agency.",
    es: "EmberWalk prepara un borrador de su solicitud de inspección, con cada arreglo en la lista y enlaces a las páginas de CAL FIRE donde puede pedir una inspección y ubicar a su agencia local de bomberos.",
    join: " ",
    enParts: ["EmberWalk drafts your inspection request,", "with every fix listed and links to the CAL FIRE pages where you can request an inspection and find your local fire agency."],
    esParts: ["EmberWalk prepara un borrador de su solicitud de inspección,", "con cada arreglo en la lista y enlaces a las páginas de CAL FIRE donde puede pedir una inspección y ubicar a su agencia local de bomberos."],
  },
  {
    en: "EmberWalk launches Nov. 4th, 2026. Preparation starts here:",
    es: "EmberWalk sale el 4 de noviembre de 2026. La preparación empieza aquí:",
    join: " ",
    enParts: ["EmberWalk launches Nov. 4th, 2026.", "Preparation starts here:"],
    esParts: ["EmberWalk sale el 4 de noviembre de 2026.", "La preparación empieza aquí:"],
  },
  {
    en: "We'll email you about EmberWalk's launch and updates. Privacy Policy",
    es: "Le enviaremos correos sobre el lanzamiento y las novedades de EmberWalk. Política de privacidad",
    join: " ",
    enParts: ["We'll email you about EmberWalk's launch and updates.", "Privacy Policy"],
    esParts: ["Le enviaremos correos sobre el lanzamiento y las novedades de EmberWalk.", "Política de privacidad"],
  },
  { en: "Questions: hello@emberwalk.app", es: "Preguntas: hello@emberwalk.app", join: " ", enParts: ["Questions:", "hello@emberwalk.app"], esParts: ["Preguntas:", "hello@emberwalk.app"] },
];

export const SHOWN_FROM_HELD = {
  held: "No calling around. No chasing quotes. EmberWalk finds licensed crews near you, sends them exactly what needs doing, and keeps following up until the work gets done. Nothing goes out without your okay.",
  en: "No calling around. Nothing goes out without your okay.",
  es: "Sin llamar a todos lados. Nada sale sin su aprobación.",
};

const NOT_IN_SPANISH = "(en inglés)";

// The Spanish written after the reviewed set: each of these is listed for its own review.
export const newLandingEs: Readonly<Record<string, string>> = {
  "Play the EmberWalk film": "Reproducir la película de EmberWalk",
  "Crews near you": "Cuadrillas cerca de usted",
  "Requests with your photos": "Solicitudes con sus fotos",
  Step: "Paso",
  "of 7:": "de 7:",
  "Follow ups": "Seguimientos",
  "Work done": "Trabajo hecho",
  "Inspection request": "Solicitud de inspección",
  "EmberWalk | Get your home ready for wildfire season": "EmberWalk | Prepare su casa para la temporada de incendios forestales",
  "EmberWalk launches Nov. 4th, 2026. Take one walk around your house with your phone and see what could catch, what to fix first, and what California requires.":
    "EmberWalk sale el 4 de noviembre de 2026. Dé una vuelta alrededor de su casa con su teléfono y vea qué podría prenderse, qué arreglar primero y qué exige California.",
  "Take one walk around your house with your phone and see what could catch, what to fix first, and what California requires.":
    "Dé una vuelta alrededor de su casa con su teléfono y vea qué podría prenderse, qué arreglar primero y qué exige California.",
  "The EmberWalk shield and house mark with the words Wildfire Home Check, and the question: When the next wildfire comes, will your home be ready?":
    "El escudo y la casa de EmberWalk con las palabras en inglés Wildfire Home Check y la pregunta en inglés When the next wildfire comes, will your home be ready?",
  "EmberWalk, Wildfire Home Check": "EmberWalk, revisión de la casa contra incendios forestales",
  "A ranch house in the pines with needles on the roof, open eaves, a coarse gable vent, firewood on the wall, a wood fence touching the house and dry leaves piled along the walls.":
    "Una casa de rancho entre pinos, con agujas en el techo, aleros abiertos, una rejilla de ventilación con aberturas grandes en el hastial, leña contra la pared, una cerca de madera que toca la casa y hojas secas amontonadas junto a las paredes.",
  "The same house made ready: a clean roof with guarded gutters, boxed eaves, a fine mesh vent, bare walls and a band of gravel along the walls.":
    "La misma casa ya preparada: un techo limpio con canaletas con protector, aleros cerrados, una rejilla de ventilación con malla de aberturas pequeñas, paredes despejadas y una franja de grava junto a las paredes.",
  "A house with an attached garage seen from above, with three zones following its outline: 0 to 5 feet, 5 to 30 feet and 30 to 100 feet.":
    "Una casa con garaje adjunto vista desde arriba, con tres zonas que siguen su contorno: de 0 a 5 pies, de 5 a 30 pies y de 30 a 100 pies.",
  "0 to 5 ft": "0 a 5 pies",
  "5 to 30 ft": "5 a 30 pies",
  "30 to 100 ft": "30 a 100 pies",
  "A clean strip of gravel along the wall of a house, with low plants spaced apart and an empty gutter.":
    "Una franja limpia de grava junto a la pared de una casa, con plantas bajas y separadas y una canaleta vacía.",
  "An overhead view of a house and its yard, with a walking path drawn around it.": "Una vista desde arriba de una casa y su patio, con un camino dibujado a su alrededor.",
  "The EmberWalk record screen, filming one slow walk around the house.": "La pantalla de grabación de EmberWalk, grabando una vuelta lenta alrededor de la casa.",
  "The EmberWalk results screen, listing what was found in the first five feet.": "La pantalla de resultados de EmberWalk, con lo que se encontró en los primeros cinco pies.",
  "An EmberWalk finding screen: move the wood pile more than 30 feet from the house.": "Una pantalla de hallazgo de EmberWalk: mueva la pila de leña a más de 30 pies de la casa.",
  "Film one walk: EmberWalk guides you around the house": "Grabe un recorrido: EmberWalk le guía alrededor de la casa",
  "A fire inspector, seen from behind, looking over a house made ready for wildfire.": "Una persona inspectora de incendios, vista de espaldas, mirando una casa ya preparada para los incendios forestales.",
  "A three story apartment community with a gravel strip along every wall, widely spaced trees and a mowed lawn.":
    "Un complejo de apartamentos de tres pisos con una franja de grava a lo largo de cada pared, árboles bien separados y pasto cortado.",
  "Open the App": "Abrir la aplicación",
  Language: "Idioma",
  Site: "Sitio",
  "Privacy Policy": `Política de privacidad ${NOT_IN_SPANISH}`,
  Pricing: `Precios ${NOT_IN_SPANISH}`,
  "Plans and Pricing": `Planes y precios ${NOT_IN_SPANISH}`,
  "Two yearly EmberWalk plans: $12.99 for individuals and $39.99 for landlords and property managers, with extra walks at $2.99 each.":
    "Dos planes anuales de EmberWalk: $12.99 para personas y $39.99 para quienes administran viviendas de alquiler y propiedades, con recorridos adicionales a $2.99 cada uno.",
  Terms: `Términos ${NOT_IN_SPANISH}`,
  Refunds: `Reembolsos ${NOT_IN_SPANISH}`,
  About: `Acerca de EmberWalk ${NOT_IN_SPANISH}`,
  Contact: `Contacto ${NOT_IN_SPANISH}`,
  Security: `Seguridad ${NOT_IN_SPANISH}`,
  Accessibility: `Accesibilidad ${NOT_IN_SPANISH}`,
  "EmberWalk is a product of The Arbiter Bibendi LLC.": "EmberWalk es un producto de The Arbiter Bibendi LLC.",
};

export const NO_SPANISH_NOTE = "Esta página está disponible solo en inglés.";
export const BACK_TO_SPANISH = "Volver a EmberWalk en español";

const pieces = Object.fromEntries(SPLITS.flatMap(({ enParts, esParts }) => enParts.map((en, n) => [en, esParts[n]!])));

const WORDS = new Map<string, string>(
  Object.entries({ ...landingEs, ...pieces, [SHOWN_FROM_HELD.en]: SHOWN_FROM_HELD.es, [ridgeAltEs.en]: ridgeAltEs.es, ...newLandingEs }),
);

const KEPT = new Set(["EmberWalk", "hello@emberwalk.app", "English", "Español"]);

const TEXT_NODE = />([^<>]*\p{L}[^<>]*)</gu;
const READ_ALOUD = /\b(?:alt|aria-label)="([^"]+)"/g;
const SHARE_LINE = /<meta (?:name|property)="[^"]*(?:description|title|image:alt)"[^>]*content="([^"]+)"/g;

export function untranslatedLines(html: string): string[] {
  const body = [...html.matchAll(TEXT_NODE)].map((m) => m[1]!.trim());
  const attributes = [...html.matchAll(READ_ALOUD), ...html.matchAll(SHARE_LINE)].map((m) => m[1]!);
  return [...new Set([...body, ...attributes])].filter((line) => !WORDS.has(line) && !KEPT.has(line));
}

const PAGE_LINK = /href="\/(pricing|terms|privacy|refunds|about|contact|security|accessibility)"/g;
const PHONE_SCREEN = /src="\/landing\/synthetic-app-(record|results|finding)\.webp"/g;

export function spanishLanding(html: string): string {
  return html
    .replace('<html lang="en">', '<html lang="es">')
    .replace(TEXT_NODE, (whole, line: string) => {
      const said = WORDS.get(line.trim());
      return said === undefined ? whole : `>${line.replace(line.trim(), () => said)}<`;
    })
    .replace(/\b(alt|aria-label|content)="([^"]+)"/g, (whole, name: string, value: string) => {
      const said = WORDS.get(value);
      return said === undefined ? whole : `${name}="${said}"`;
    })
    .replaceAll(' lang="en" aria-current="true">', ' lang="en">')
    .replaceAll('<a href="/?lang=es" lang="es">', '<a href="/?lang=es" lang="es" aria-current="true">')
    .replace(PAGE_LINK, 'href="/$1?lang=es"')
    .replace(PHONE_SCREEN, 'src="/landing/synthetic-app-$1-es.webp"');
}

function spanishNote(html: string): string {
  return html.replace(/<main[^>]*>/, (main) => `${main}<p class="language-note" lang="es">${NO_SPANISH_NOTE} <a href="/?lang=es">${BACK_TO_SPANISH}</a></p>`);
}

export function languageNamed(value: unknown): Language | null {
  return value === "es" || value === "en" ? value : null;
}

const phoneLanguages = (header: string): string[] =>
  header
    .split(",")
    .map((part) => {
      const [tag = "", ...settings] = part.trim().split(";");
      const weight = settings.map((s) => /^q=([\d.]+)$/.exec(s.trim())?.[1]).find((q) => q !== undefined);
      return { tag: tag.toLowerCase(), weight: weight === undefined ? 1 : Number(weight) };
    })
    .filter(({ weight }) => weight > 0)
    .sort((a, b) => b.weight - a.weight)
    .map(({ tag }) => tag);

export function languageOf(request: Request): Language {
  const chosen = languageNamed(new URL(request.url).searchParams.get("lang"));
  if (chosen !== null) return chosen;
  for (const tag of phoneLanguages(request.headers.get("accept-language") ?? "")) {
    const named = languageNamed(tag.split("-")[0]);
    if (named !== null) return named;
  }
  return "en";
}

const LANDING = new Set(["/", "/index.html"]);

export async function applyLanguage(response: Response, request: Request): Promise<Response> {
  if (response.body === null || !(response.headers.get("content-type") ?? "").includes("text/html")) return response;
  const spanish = languageOf(request) === "es";
  const landing = LANDING.has(new URL(request.url).pathname);
  const page = spanish ? (landing ? spanishLanding : spanishNote)(await response.text()) : response.body;
  const out = new Response(page, response);
  out.headers.append("vary", "accept-language");
  if (spanish) {
    out.headers.delete("etag");
    out.headers.delete("content-length");
  }
  return out;
}
