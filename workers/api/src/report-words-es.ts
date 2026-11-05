import type { Band, Concept } from "@emberwalk/shared";
import { feetSaid, type FeetSaid, type GapKind, type RecheckResult, type ReportWords } from "./report-words.ts";

const LONG_DATE = new Intl.DateTimeFormat("es-US", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

const partsOf = (iso: string): number[] => iso.split("-").map(Number);

export const longDayEs = (iso: string): string => {
  const [year = 0, month = 1, day = 1] = partsOf(iso);
  return LONG_DATE.format(new Date(Date.UTC(year, month - 1, day, 12)));
};

export const shortDayEs = (iso: string): string => {
  const [year = 0, month = 1, day = 1] = partsOf(iso);
  return `${day} de ${MONTHS[month - 1] ?? ""} de ${year}`;
};

const feet = (count: number): string => (count === 1 ? "pie" : "pies");

const distanceLine = (said: FeetSaid): string => {
  switch (said.kind) {
    case "against":
      return "Tocando la casa.";
    case "within":
      return `A ${said.high} ${feet(said.high)} o menos de la casa.`;
    case "about":
      return `A más o menos ${said.feet} ${feet(said.feet)} de la casa.`;
    case "range":
      return `Aproximadamente de ${said.low} a ${said.high} pies de la casa.`;
  }
};

const conceptWords: Record<Concept, string> = {
  dry_brush: "maleza seca",
  wood_pile: "pilas de leña",
  wooden_fence: "cercas de madera",
  roof_debris: "hojas y agujas en el techo",
  foundation_vent: "rejillas de ventilación",
  house_wall: "las paredes de la casa",
  tree_branch_over_roof: "ramas sobre el techo",
  chimney: "la chimenea",
  shrub: "arbustos",
  tree: "árboles",
  dry_grass: "pasto seco",
  propane_tank: "tanques de propano",
  shed: "cobertizos",
  trash_can: "botes de basura",
  patio_furniture: "muebles de patio",
  gas_can: "bidones de gasolina",
  stored_fuel: "combustible almacenado",
  lawn_mower: "cortadoras de pasto",
  grill: "parrillas",
  propane_cylinder: "cilindros pequeños de propano",
  vehicle: "vehículos",
  lumber_pile: "pilas de madera",
  tarp: "lonas",
  doormat: "tapetes de entrada",
  boat_or_trailer: "botes y remolques",
  wood_deck: "terrazas de madera",
};

const conceptSaid = (concept: string): string => (Object.hasOwn(conceptWords, concept) ? conceptWords[concept as Concept] : concept.replaceAll("_", " "));

const SIDES: Record<string, string> = { front: "frontal", right: "derecho", back: "trasero", left: "izquierdo" };

const sideSaid = (side: string): string => SIDES[side] ?? side;

const CORNERS: Record<string, string> = {
  front_right: "frontal derecha",
  back_right: "trasera derecha",
  back_left: "trasera izquierda",
  front_left: "frontal izquierda",
};

const cornerSaid = (corner: string): string => CORNERS[corner] ?? corner;

const NOT_INSPECTION = "EmberWalk no es una inspección ni una certificación.";

// Lines also in apps/web/src/copy-es.ts keep their reviewed words exactly; the rest are listed for their own review.
export const reportWordsEs: ReportWords & { conceptWords: Record<Concept, string> } = {
  conceptWords,
  longDay: longDayEs,
  shortDay: shortDayEs,
  htmlLang: "es",
  quoteLabel: "Texto oficial de la regla, solo en inglés:",
  title: "Registro de espacio defendible",
  made: "Hecho por la persona propietaria de la casa con EmberWalk",
  lockupAlt: "EmberWalk, revisión de la casa contra incendios forestales",
  walked: (iso) => `Recorrido hecho el ${longDayEs(iso)}.`,
  walkedLabel: "Recorrido hecho",
  approvedLabel: "Aprobado por la persona propietaria de la casa",
  notInspectionShort: NOT_INSPECTION,
  notInspection: `${NOT_INSPECTION} La agencia local de bomberos da la aprobación oficial.`,
  page: "Página",
  pageOf: "de",
  caption: { band: "Zona", label: "Regla", status: "Estado" },
  approximate: "Las distancias son aproximadas.",
  zoneZero: "Las reglas de la Zona 0 para los primeros 5 pies todavía no son ley.",
  approved: (iso) => `Se mostraron las fotos difuminadas a la persona propietaria de la casa, que aprobó este registro el ${shortDayEs(iso)}.`,
  removed: "Quitado por la persona propietaria de la casa",
  removedLead: "La persona propietaria de la casa marcó estos puntos como incorrectos, así que no aparecen en las listas de arriba.",
  removedItem: (concept, low, high) => {
    const named = conceptSaid(concept);
    const where = distanceLine(feetSaid({ low, high }));
    return `${named.charAt(0).toUpperCase()}${named.slice(1)}, ${where.charAt(0).toLowerCase()}${where.slice(1)}`;
  },
  lead: "Empiece lo más cerca de su casa: los primeros 5 pies importan más, luego hasta 30 pies, luego hasta 100.",
  fixFirst: (count) => (count === 1 ? "Arregle esto primero" : `Arregle estas ${count} cosas primero`),
  bands: { zone_0: "Primeros 5 pies", zone_1: "De 5 a 30 pies", zone_2: "De 30 a 100 pies" } satisfies Record<Band, string>,
  label: { required_now: "Obligatorio ahora", recommended: "Recomendado" },
  status: { needs_fixing: "Por arreglar", fix_planned: "Arreglo planeado", done: "Listo" },
  rechecked: "Revisado de nuevo",
  notRechecked: "Todavía no se revisa de nuevo",
  doneOn: (iso) => `Listo el ${shortDayEs(iso)}.`,
  recheckedOn: (iso) => `Revisado de nuevo el ${shortDayEs(iso)}.`,
  distance: (low, high) => distanceLine(feetSaid({ low, high })),
  source: "De dónde viene esto",
  advice: "Nuestro consejo, no una regla",
  retrieved: (iso) => `Reglas leídas el ${shortDayEs(iso)}.`,
  rules: "Reglas usadas",
  coverage: "Lo que se revisó",
  allChecked: "Se revisaron todos los lados de la casa en este recorrido.",
  gap: {
    missing: (side) => `El lado ${sideSaid(side)} todavía no está en su video.`,
    dark: (side) => `El lado ${sideSaid(side)} está demasiado oscuro para revisarlo.`,
    first_five_feet: (side) => `Los primeros cinco pies del lado ${sideSaid(side)} todavía no se ven.`,
    not_checked: (side) => `Todavía falta revisar el lado ${sideSaid(side)}.`,
  } satisfies Record<GapKind, (side: string) => string>,
  cornerGap: {
    missing: (corner) => `La esquina ${cornerSaid(corner)} todavía no está en su video.`,
    dark: (corner) => `La esquina ${cornerSaid(corner)} está demasiado oscura para revisarla.`,
    first_five_feet: (corner) => `Los primeros cinco pies de la esquina ${cornerSaid(corner)} todavía no se ven.`,
    not_checked: (corner) => `Todavía falta revisar la esquina ${cornerSaid(corner)}.`,
  } satisfies Record<GapKind, (corner: string) => string>,
  notChecked: (concept) => `Sin revisar en este recorrido: ${conceptSaid(concept)}.`,
  unplaced: (side, concepts) => {
    const things = concepts.map(conceptSaid).join(", ");
    const base = concepts.length === 1 ? "su base" : "sus bases";
    return side === null
      ? `Sin medir en este recorrido: ${things}. La próxima vez, manténgase unos pasos más lejos de la casa para que se vea el suelo junto a ${base}.`
      : `Sin medir en el lado ${sideSaid(side)}: ${things}. Recorra ese lado otra vez unos pasos más lejos de la casa, para que se vea el suelo junto a ${base}.`;
  },
  record: "Registro con fechas",
  mark: (status, iso, instruction) => `${status} el ${shortDayEs(iso)}: ${instruction}`,
  recheck: {
    cleared: (iso, instruction) => `Revisado de nuevo el ${shortDayEs(iso)}, parece despejado en la foto nueva: ${instruction}`,
    still_there: (iso, instruction) => `Revisado de nuevo el ${shortDayEs(iso)}, todavía aparece en la foto nueva: ${instruction}`,
    unsure: (iso, instruction) => `Revisado de nuevo el ${shortDayEs(iso)}, la foto nueva no era lo bastante clara para mostrarlo: ${instruction}`,
  } satisfies Record<RecheckResult, (iso: string, instruction: string) => string>,
  photo: (instruction) => `Foto del recorrido: ${instruction}`,
  shareWaits: "Este informe cambió y espera la aprobación de la persona propietaria de la casa.",
};
