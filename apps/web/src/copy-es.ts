import { DEFAULT_LIMITS } from "@emberwalk/shared";
import type { Concept, Corner, FixedRouteCode, WalkState } from "@emberwalk/shared";
import type { Failure } from "./api.ts";
import { clockText } from "./clock-text.ts";
import type { copyEn as copy, draftEn as draft, unbackedEn as unbacked } from "./copy.ts";
import type { FeetSaid } from "./distance.ts";
import type { FixedFailure, JobStatus, Message, Trade } from "./fixed-api.ts";
import { localDay } from "./mark-sync.ts";
import type { Gap, Side } from "./results.ts";

export type Spanish<T> = T extends string
  ? string
  : T extends (...args: infer A) => string
    ? (...args: A) => string
    : { readonly [K in keyof T]: Spanish<T[K]> };

const LIMIT_MINUTES = Math.floor(DEFAULT_LIMITS.maxWalkSeconds / 60);
const SEND = "Enviar mi recorrido";
const STAYS = "Su recorrido sigue guardado en este teléfono.";
const START_AGAIN = `Se detuvo el envío. ${STAYS} Toque ${SEND} para empezar a enviarlo de nuevo.`;
const TRY_AGAIN = `El envío está en pausa. ${STAYS} Toque ${SEND} para intentarlo de nuevo.`;
const AGAIN = "Grabe el recorrido de nuevo.";
const SHORTER = "Este recorrido dura más de lo que se permite. Grabe un recorrido más corto.";
const ALREADY_SENT = "Este recorrido ya se envió.";

export const sidesEs: Record<Side, string> = { front: "frontal", right: "derecho", back: "trasero", left: "izquierdo" };

const cornersEs: Record<Corner, string> = {
  front_right: "frontal derecha",
  back_right: "trasera derecha",
  back_left: "trasera izquierda",
  front_left: "frontal izquierda",
};

const theSide = (side: Side): string => `el lado ${sidesEs[side]}`;

const capital = (line: string): string => `${line[0]!.toUpperCase()}${line.slice(1)}`;

const WALK_DATE = new Intl.DateTimeFormat("es-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export const walkDateEs = (ms: number): string => WALK_DATE.format(ms);

const LONG_DATE = new Intl.DateTimeFormat("es-US", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

export const longDateEs = (day: Date): string => LONG_DATE.format(day);

const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

export const shortDayEs = (iso: string): string => {
  const [year, month, day] = iso.split("-").map(Number);
  return `${day ?? 1} de ${MONTHS[(month ?? 1) - 1] ?? ""} de ${year}`;
};

const GAP_LINES: Record<Gap["kind"], (side: Side) => string> = {
  missing: (side) => `${capital(theSide(side))} todavía no está en su video.`,
  dark: (side) => `${capital(theSide(side))} está demasiado oscuro para revisarlo.`,
  first_five_feet: (side) => `Los primeros cinco pies del lado ${sidesEs[side]} todavía no se ven.`,
  not_checked: (side) => `Todavía falta revisar ${theSide(side)}.`,
};

const stepLine = (state: WalkState): string => {
  if (state.name !== "processing" || state.step === "prepare") return "Preparando su recorrido para revisarlo.";
  if (state.step === "explain") return "Anotando qué hacer con cada cosa encontrada.";
  return "Buscando lo que hay que despejar.";
};

const MILES = (miles: number): string => {
  const said = Number(miles.toFixed(1));
  return `${said} ${said === 1 ? "milla" : "millas"} de distancia`;
};

const TRADE_NAMES: Record<Trade, string> = {
  tree_service: "Poda y retiro de árboles",
  brush_clearing: "Despeje de maleza",
  debris_hauling: "Retiro de desechos",
  roofing_gutters: "Techos y canaletas",
  fencing: "Cercas",
  handyman: "Reparaciones generales",
};

const JOB_LINES: Record<JobStatus, string> = {
  planning: "Se están eligiendo cuadrillas para este trabajo.",
  waiting_on_homeowner: "Esperando su aprobación.",
  waiting_on_crew: "Esperando respuesta de las cuadrillas.",
  scheduled: "Una cuadrilla ya tiene una hora acordada con usted.",
  done: "Este trabajo está terminado.",
  closed: "Este trabajo está cerrado.",
};

const SOMETHING_WRONG = "Eso no terminó. Intente de nuevo en un minuto.";

const PROBLEMS: Record<FixedRouteCode | "offline", string> = {
  offline: "Sin señal. Intente de nuevo cuando tenga señal.",
  rate_limited: "EmberWalk ya hizo eso todas las veces que permite por ahora.",
  invalid_request: "Eso no llegó con claridad. Revíselo e intente de nuevo.",
  not_found: "Eso no está aquí. Regrese y ábralo de nuevo.",
  method_not_allowed: SOMETHING_WRONG,
  conflict: "Eso todavía no está disponible.",
  not_ready: "Primero marque como Listo cada punto Obligatorio ahora.",
  send_failed: "El correo todavía no ha salido. Intente de nuevo.",
  server_error: SOMETHING_WRONG,
};

const problemFor = (code: FixedFailure): string => (code in PROBLEMS ? PROBLEMS[code as keyof typeof PROBLEMS] : SOMETHING_WRONG);

const messageLine = (message: Pick<Message, "status" | "channel" | "outbox" | "sentAt">): string => {
  const sent = message.sentAt === null ? "" : ` el ${shortDayEs(localDay(Date.parse(message.sentAt)))}`;
  switch (message.status) {
    case "draft":
      return "Escrita y esperando su aprobación.";
    case "approved":
      if (message.channel === "text") return "Aprobada. Esperando que usted envíe el mensaje de texto.";
      return message.outbox?.state === "failed" ? "Aprobada. El correo todavía no ha salido." : "Aprobada. El correo va en camino.";
    case "sent":
      return `Enviada${sent}.`;
    case "sent_by_phone":
      return `Enviada desde su teléfono${sent}.`;
    case "replied":
      return "La cuadrilla respondió.";
  }
};

export const draftEs: Spanish<typeof draft> = {
  detail: {
    mapTitle: "Su casa vista desde arriba",
    mapEmpty: "Todavía no hay nada que ubicar en el mapa.",
    backToResults: "Volver a sus resultados",
  },
  fixed: {
    title: "Haga que lo arreglen",
    nothingGoesOut: "No se envía nada sin su aprobación.",
    zipLabel: "Su código postal",
    zipButton: "Buscar cuadrillas con licencia",
    zipInvalid: "Escriba un código postal de 5 dígitos, como 95969.",
    zipOutside: (zip: string) => `El código postal ${zip} está fuera de California. La lista de cuadrillas de EmberWalk cubre solo California.`,
    zipRetry: "Revise el código postal o pruebe uno cercano.",
    finding: "Buscando cuadrillas con licencia cerca de su casa.",
    trade: TRADE_NAMES,
    job: JOB_LINES,
    itemsOnList: (count: number) => `Para ${count} ${count === 1 ? "punto" : "puntos"} de su lista.`,
    noCrews: "No se encontraron cuadrillas con licencia cerca de su casa para este tipo de trabajo.",
    yourself: "Le toca a usted",
    yourselfLine: "Ninguna cuadrilla de la lista cubre esto. Le toca a usted hacerlo.",
    distance: (miles: number, approximate: boolean) => (approximate ? `aproximadamente ${MILES(miles)}` : MILES(miles)),
    license: (status: string, listedOn: string | null) =>
      listedOn === null ? `Estado de la licencia: ${status}` : `Estado de la licencia: ${status}, en la lista estatal del ${shortDayEs(listedOn)}`,
    text: "Mensaje de texto",
    sample: "Cuadrilla de ejemplo",
    emailOf: (email: string) => `Correo: ${email}`,
    addEmail: "Agregar correo",
    emailLabel: (name: string) => `Correo de ${name}`,
    emailLocked: "Ya hay una solicitud escrita para este negocio, así que no se puede cambiar su correo.",
    writeRequests: "Escribir mis solicitudes",
    writing: "Escribiendo sus solicitudes.",
    requests: "Solicitudes",
    message: messageLine,
    review: "Revisar y aprobar",
    replies: "Respuestas",
    replyVia: { email: "Respuesta por correo", homeowner: "Respuesta que usted agregó" },
    read: "Lo que EmberWalk leyó en ella",
    price: (price: string) => `Precio que mencionaron: ${price}`,
    date: (date: string) => `Fecha que mencionaron: ${date}`,
    questions: "Preguntas que hicieron",
    declined: "Esta cuadrilla dijo que no.",
    logReply: "Anotar una respuesta",
    replyLabel: "Lo que dijo la cuadrilla",
    replyHelp: "Escriba o pegue una respuesta que llegó por mensaje de texto o por teléfono.",
    replyEmpty: "Primero escriba lo que dijeron.",
    reminders: "Recordatorios",
    reminderReady: (day: string) => `Hay un recordatorio listo. Vencía el ${day}.`,
    reminderDue: (day: string) => `Vence el ${day}.`,
    reviewReminder: "Revisar el recordatorio",
    writeReminders: "Escribir mis recordatorios",
    remindersChecked: "Revisado. Los recordatorios, si hay alguno, aparecen debajo de las solicitudes.",
    inspection: "Redactar mi solicitud de inspección",
    inspectionLine: "Cuando cada punto Obligatorio ahora esté Listo, EmberWalk redacta una solicitud de inspección para que usted la envíe.",
    loading: "Obteniendo esto de EmberWalk.",
    tryAgain: "Intentar de nuevo",
    backToFix: "Volver a «Haga que lo arreglen»",
    backToResults: "Volver a sus resultados",
    problem: problemFor,
  },
  approve: {
    title: "Apruebe esta solicitud",
    byEmail: (email: string | null) => (email === null ? "Esto se envía por correo." : `Esto se envía por correo a ${email}.`),
    byText: (phone: string) => `Esto se envía por mensaje de texto desde su teléfono a ${phone}.`,
    textLink: "Cuando usted lo apruebe, EmberWalk crea un enlace privado a esta solicitud y estas fotos. La cuadrilla lo abre desde su mensaje sin iniciar sesión. Borrar todo lo elimina.",
    subject: (subject: string) => `Asunto: ${subject}`,
    photos: "Fotos que van con ella",
    nothingSent: "No se envía nada hasta que toque el botón de abajo.",
    email: "Aprobar y enviar",
    text: "Aprobar este mensaje de texto",
    openText: "Abrir el mensaje de texto",
    approvedText: "Aprobado. Todavía no se ha enviado nada. Toque «Abrir el mensaje de texto» para enviarlo desde su teléfono.",
    again: "Intentar enviar de nuevo",
    sentEmail: "Su correo se envió.",
    sentPhone: "Marcada como enviada desde su teléfono.",
    sendFailed: "El correo todavía no ha salido. No se perdió nada. Toque Intentar enviar de nuevo.",
    notSent: "El mensaje de texto no se envió. Toque «Abrir el mensaje de texto» cuando esté listo.",
    markAgain: "Avisar a EmberWalk que se envió",
    missing: "Esta solicitud no está en su lista. Regrese a Haga que lo arreglen.",
  },
  history: {
    intro: "Cada recorrido que ha hecho y cada marca que ha puesto en su lista, con el día.",
    empty: "Todavía no hay recorridos en su registro.",
    sample: "Esta es la casa de ejemplo. Estas marcas se quedan en este teléfono.",
    noMarks: "Todavía no hay marcas en este recorrido.",
    mark: (kind: string, day: string) => `${kind} el ${day}`,
  },
  inspection: {
    title: "Su solicitud de inspección",
    intro: "Este es un borrador para que usted lo lea y lo envíe. EmberWalk no programa ni hace la inspección.",
    subject: (subject: string) => `Asunto: ${subject}`,
    copy: "Copiar",
    copied: "Copiado.",
    copyFailed: "Mantenga presionado el texto para copiarlo usted.",
    links: "Enlaces para incluir",
    writing: "Escribiendo su solicitud.",
    notReady: "Todavía no está lista",
    noRequired: "Este recorrido no tiene ningún punto Obligatorio ahora, así que no hay nada que poner en una solicitud de inspección.",
  },
  status: {
    doneDay: "El día en que se hizo",
    doneOn: (iso: string) => `Listo el ${shortDayEs(iso)}.`,
    willSave: "Guardado en este teléfono. Se guardará en EmberWalk cuando tenga señal.",
    refused: "Esta marca se guarda solo en este teléfono por ahora.",
    futureDay: "Elija hoy o un día anterior.",
  },
  home: { lead: "Grabe un recorrido alrededor de su casa. EmberWalk revisa lo que podría llevar el fuego hasta ella." },
  record: {
    corners: [
      "Empiece en la puerta principal.",
      "Doble en la primera esquina.",
      "Doble en la siguiente esquina.",
      "Falta una esquina.",
      "Ya está de vuelta en el frente. Toque Detener grabación.",
    ],
    propertyLine: "Apunte el teléfono hacia el límite de su propiedad y toque Límite de propiedad.",
    pan: (side: Side) =>
      `Párese en ${theSide(side)}, mire hacia el patio y gire despacio de un extremo al otro. Toque Panorámica del patio otra vez al terminar.`,
  },
  guided: {
    now: (side: Side) => `Ahora ${theSide(side)}. Toque Siguiente en la esquina.`,
    next: "Siguiente",
    back: "Ya está de vuelta en el frente. Toque Panorámica del patio en cada esquina, o Detener grabación.",
  },
  results: {
    confidence: (share: number) => `EmberWalk está ${Math.round(share * 100)}% seguro de esto.`,
  },
  corners: {
    gap: {
      missing: (corner: Corner) => `La esquina ${cornersEs[corner]} todavía no está en su video.`,
      dark: (corner: Corner) => `La esquina ${cornersEs[corner]} está demasiado oscura para revisarla.`,
      first_five_feet: (corner: Corner) => `Los primeros cinco pies de la esquina ${cornersEs[corner]} todavía no se ven.`,
      not_checked: (corner: Corner) => `Todavía falta revisar la esquina ${cornersEs[corner]}.`,
    },
    hint: (corner: Corner) => `Párese en la esquina ${cornersEs[corner]} y haga una panorámica del patio, girando despacio de un lado al otro.`,
    panCorner: (corner: Corner) => `Panorámica de la esquina ${cornersEs[corner]}`,
    pan: (corner: Corner) =>
      `Párese en la esquina ${cornersEs[corner]}, mire hacia el patio y gire despacio de un lado al otro. Toque Panorámica del patio otra vez al terminar.`,
    oneCorner: (corner: Corner) =>
      `Párese en la esquina ${cornersEs[corner]} y mire hacia el patio. Toque Panorámica del patio, gire despacio de un lado al otro y luego tóquelo otra vez.`,
  },
};

const CONCEPT_WORDS: Record<Concept, string> = {
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

const thingsToClear = (count: number): string => (count === 0 ? "no se encontró nada." : `${count} ${count === 1 ? "cosa" : "cosas"} que retirar.`);

export const unbackedEs: Spanish<typeof unbacked> = {
  leaves: {
    location:
      "Ubicación: se lee una vez en su teléfono para encontrar sus reglas contra incendios. Solo se guarda y se envía el área de las reglas, nunca sus coordenadas. Su dirección nunca se envía.",
  },
  pin: { side: (side: Side) => `${capital(theSide(side))}.` },
};

export const conceptLabelEs = (concept: string): string => capital(CONCEPT_WORDS[concept as Concept] ?? concept.replaceAll("_", " "));

export const copyEs: Spanish<typeof copy> = {
  app: { name: "EmberWalk", mark: "EmberWalk, revisión de la casa contra incendios forestales", offline: "Sin señal. EmberWalk sigue funcionando en este teléfono." },
  home: {
    title: "EmberWalk",
    walk: "Recorrer mi casa",
    walks: "Sus recorridos",
    send: SEND,
    sample: "Ver una casa de ejemplo",
    progress: "Ver avances",
  },
  results: {
    ready: "Lista para la inspección",
    allClear: "Todo despejado en lo que EmberWalk pudo ver.",
    insurance: "California exige que las aseguradoras ofrezcan descuentos por algunos de estos trabajos. Pregunte a la suya qué comprobante necesita.",
    incomplete: "Recorrido incompleto",
    gap: ({ side, kind }) => GAP_LINES[kind](side),
    hint: {
      walk_side: (side) => `Recorra ${theSide(side)}, de una esquina a la siguiente.`,
      more_light: (side) => `Recorra ${theSide(side)} otra vez cuando haya más luz del día.`,
      tilt_down: (side) => `Recorra ${theSide(side)} otra vez con el teléfono un poco inclinado hacia abajo, para que se vea el suelo junto a la pared.`,
      step_back: (side) => `Recorra ${theSide(side)} otra vez un paso más lejos de la pared, para que se vea el suelo junto a la pared.`,
      again: (side) => `Recorra ${theSide(side)} una vez más. Su video estaba bien; EmberWalk necesita verlo otra vez.`,
    },
    walkSide: (side: Side) => `Recorrer ${theSide(side)}`,
    soFar: "Lo que encontramos hasta ahora",
    fixFirst: (count: number) => (count === 1 ? "Arregle esto primero" : `Arregle estas ${count} cosas primero`),
    lead: "Empiece lo más cerca de su casa: los primeros 5 pies importan más, luego hasta 30 pies, luego hasta 100.",
    distance: distanceLine,
    inside: (count: number) => `En los primeros 5 pies: ${thingsToClear(count)}`,
    close: (count: number) => `Cerca de la casa: ${count} ${count === 1 ? "cosa" : "cosas"} por despejar.`,
    out: (count: number) => `De 5 a 30 pies: ${thingsToClear(count)}`,
    notChecked: (concept: Concept) => `Sin revisar en este recorrido: ${CONCEPT_WORDS[concept]}.`,
    unplaced: (side: Side | null, concepts: Concept[]) => {
      const things = concepts.map((c) => CONCEPT_WORDS[c]).join(", ");
      const base = concepts.length === 1 ? "su base" : "sus bases";
      return side === null
        ? `Sin medir en este recorrido: ${things}. La próxima vez, manténgase unos pasos más lejos de la casa para que se vea el suelo junto a ${base}.`
        : `Sin medir en ${theSide(side)}: ${things}. Recorra ese lado otra vez unos pasos más lejos de la casa, para que se vea el suelo junto a ${base}.`;
    },
    bands: { zone_0: "Primeros 5 pies", zone_1: "De 5 a 30 pies", zone_2: "De 30 a 100 pies" },
    simple: "Sencillo",
    detailed: "Detallado",
    views: "Sencillo · Detallado",
    walked: (day: Date) => `Recorrido hecho el ${longDateEs(day)}.`,
    old: "Tiene más de un año. Haga otro recorrido para actualizarlo.",
    label: { required_now: "Obligatorio ahora", recommended: "Recomendado" },
  },
  fixed: {
    honest: "Todas las empresas con licencia de la lista pública de contratistas de California, de la más cercana a la más lejana. EmberWalk no las clasifica ni las recomienda.",
    call: "Llamar",
    checkLicense: "Verificar esta licencia",
  },
  map: {
    button: "Ver el mapa",
    noPins: "Estas cosas no se pudieron ubicar en el mapa, así que no hay marcadores que mostrar. Todo aparece en la lista de abajo.",
    somePlaced: "Lo que no tiene número no se pudo ubicar en el mapa.",
  },
  sample: {
    label: "Esta es la casa de ejemplo.",
    partial: "Casa de ejemplo, recorrido parcial",
    partialLine: "Este recorrido de ejemplo graba solo una parte de la casa, así que el resto no está revisado.",
  },
  history: { title: "Registro de espacio defendible" },
  status: {
    kind: { needs_fixing: "Por arreglar", fix_planned: "Arreglo planeado", done: "Listo" },
    rechecked: "Revisado de nuevo",
    notRechecked: "Todavía no se revisa de nuevo",
    note: "Agregar una nota (opcional)",
    example: "Por ejemplo: la cuadrilla de poda viene el sábado.",
    save: "Guardar",
  },
  finding: {
    more: "Más",
    source: "De dónde viene esto",
    said: "Lo que usted dijo",
    seeFixed: "Ver cómo queda arreglado",
    aiPreview: "Vista previa de IA, no una foto",
    secondCheck: (reason: string) => `La segunda revisión no coincide: ${reason}`,
    secondCheckAgrees: "La segunda revisión coincide.",
    sides: (sides: Side[]) => {
      const named = sides.map((s) => sidesEs[s]);
      if (new Set(sides).size === 4) return "Se vio en todos los lados.";
      return named.length === 1 ? `Se vio en el lado ${named[0]}.` : `Se vio en los lados ${named.slice(0, -1).join(", ")} y ${named.at(-1)}.`;
    },
    notRight: "Esto no está bien",
    removed: "Se quitó de su lista.",
    undo: "Deshacer",
  },
  how: {
    title: "Cómo funciona su recorrido",
    walk: "Dé una vuelta alrededor de su casa con el teléfono en alto, a unos tres pasos largos de la pared. EmberWalk le guía esquina por esquina.",
    asks: "Le pedirá cuatro cosas, cada una solo cuando haga falta:",
    camera: "Cámara, para grabar su recorrido.",
    microphone: "Micrófono, para que pueda decir lo que ve. Puede apagar el sonido cuando quiera.",
    motion: "Movimiento, para saber en qué parte del recorrido va.",
    location: "Ubicación, para que EmberWalk sepa qué reglas contra incendios aplican a su casa.",
    continue: "Continuar",
  },
  record: {
    title: "Grabe su recorrido",
    back: "Atrás",
    ready: "Empiece en la puerta principal, a unos tres pasos largos de la pared. Dé toda la vuelta a la casa.",
    oneSide: (side: Side) => `Párese en la esquina donde empieza ${theSide(side)}. Camine hasta la siguiente esquina y toque Detener grabación.`,
    limit: `Un recorrido puede durar hasta ${LIMIT_MINUTES} minutos.`,
    start: "Empezar a grabar",
    opening: "Abriendo la cámara.",
    location: {
      finding: "Buscando dónde está su casa.",
      found: "Su casa está en California, así que EmberWalk usa las reglas contra incendios del estado.",
      outside: "Hoy EmberWalk cubre las reglas contra incendios de California y revisa su recorrido según ellas. Vienen más estados en camino.",
      refused: "Su recorrido se revisa según las reglas contra incendios de California.",
    },
    stop: "Detener grabación",
    soundOff: "Sin sonido",
    pause: "Pausa",
    propertyLine: "Límite de propiedad",
    panYard: "Panorámica del patio",
    timeLeft: (ms: number) => `Quedan ${clockText(ms)}`,
    saved: "Hay un recorrido guardado en este teléfono que todavía no se ha enviado.",
    sendSaved: SEND,
    recordAgain: "Borrarlo y grabar de nuevo",
    denied:
      "EmberWalk no puede usar la cámara porque el permiso está desactivado. Permita el acceso a la cámara para este sitio web en la configuración de su teléfono y luego toque Intentar de nuevo.",
    unsupported: "Este navegador no puede grabar un recorrido para EmberWalk. Pruebe Safari en iPhone o Chrome en Android.",
    failed: "La cámara no se encendió. Toque Intentar de nuevo.",
    tryAgain: "Intentar de nuevo",
  },
  leaves: {
    title: "Lo que sale de su teléfono",
    sent: "Se envía: el video de su recorrido, y su sonido si el sonido estaba encendido. Va al almacenamiento de EmberWalk y a la IA de Meta, que busca lo que hay que despejar.",
    never: "Nunca se envía: su nombre, su dirección ni sus contactos.",
    meta: "Meta no usa su recorrido para entrenar su IA. EmberWalk programa su archivo en Meta para que se borre automáticamente en un plazo máximo de una hora y le pide a Meta que no guarde sus respuestas.",
    send: SEND,
    notNow: "Ahora no",
    later: "Su recorrido se queda en este teléfono. Puede enviarlo después desde Sus recorridos.",
  },
  send: {
    title: "Envíe su recorrido",
    back: "Atrás",
    saved: "Su recorrido está guardado en este teléfono.",
    limitReached: `La grabación se detuvo al llegar al límite de ${LIMIT_MINUTES} minutos.`,
    cameraStopped: "La grabación se detuvo antes de tiempo porque la cámara se detuvo. Lo que se grabó está guardado.",
    none: "No hay ningún recorrido en este teléfono para enviar.",
    recordWalk: "Grabar un recorrido",
    sending: (sentBytes: number, totalBytes: number) =>
      `Enviando su recorrido. ${totalBytes > 0 ? Math.floor((100 * sentBytes) / totalBytes) : 0}% enviado.`,
    sent: "Su recorrido se envió.",
    lost: "EmberWalk ya no encuentra este recorrido. Por favor, grábelo de nuevo.",
    held: "EmberWalk sigue trabajando en su recorrido. Esta página se actualiza sola.",
    reported: "EmberWalk recibió aviso del problema. Esta página se actualiza sola.",
    step: (state: WalkState) => stepLine(state),
    stages: { sent: "Enviado", ready: "Preparado", looking: "Buscando", writing: "Escribiendo", done: "Listo" },
    counted: (done: number, total: number) => `${done} de ${total} pasos listos`,
    checked: "Revisado. Abriendo lo que encontró EmberWalk.",
    savedMinutes: (minutes: number) => `${minutes} ${minutes === 1 ? "minuto guardado" : "minutos guardados"} en este teléfono.`,
    signIn: "Iniciar sesión",
    unreachable: `Este teléfono tiene señal, pero EmberWalk no respondió. ${STAYS} EmberWalk lo intenta de nuevo cada 30 segundos, o toque ${SEND}.`,
    checkUnreachable: "Este teléfono tiene señal, pero EmberWalk no respondió. Esta página lo intenta de nuevo sola.",
    checkSignIn: "Este teléfono no ha iniciado sesión, así que EmberWalk no puede mostrar cómo va la revisión. Toque Iniciar sesión.",
    refused: {
      offline: "Esperando señal.",
      sign_in_needed: `Este teléfono no ha iniciado sesión, así que EmberWalk no pudo recibir su recorrido. ${STAYS} Toque Iniciar sesión y luego toque ${SEND}.`,
      storage_blocked: `Este teléfono tiene señal, pero el almacenamiento de EmberWalk no recibió su recorrido. ${STAYS} EmberWalk lo intenta de nuevo cada 30 segundos, o toque ${SEND}.`,
      invalid_size: `Este recorrido no tiene video. ${AGAIN}`,
      too_large: SHORTER,
      too_many_parts: SHORTER,
      invalid_part_number: START_AGAIN,
      too_many_tries: `Una parte de su recorrido no se envió después de varios intentos. ${STAYS} Toque ${SEND} para empezar a enviarlo de nuevo.`,
      upload_expired: `El envío tardó demasiado y se detuvo. ${STAYS} Toque ${SEND} para empezar a enviarlo de nuevo.`,
      upload_completed: ALREADY_SENT,
      upload_aborted: START_AGAIN,
      unknown_upload: START_AGAIN,
      walk_not_uploading: ALREADY_SENT,
      parts_invalid: `Una parte de su recorrido no llegó completa. ${STAYS} Toque ${SEND} para empezar a enviarlo de nuevo.`,
      invalid_request: TRY_AGAIN,
      body_too_large: TRY_AGAIN,
      unknown_walk: `Este recorrido ya no se puede enviar. ${AGAIN}`,
      upload_in_progress: `Este recorrido ya se está enviando. ${STAYS} Intente de nuevo más tarde.`,
      not_mp4: `Este video no se puede revisar. ${AGAIN}`,
      not_found: TRY_AGAIN,
      method_not_allowed: TRY_AGAIN,
      conflict: TRY_AGAIN,
      not_ready: TRY_AGAIN,
      send_failed: TRY_AGAIN,
      spend_cap_reached: `EmberWalk ya revisó todos los recorridos que puede hoy. ${STAYS} Intente de nuevo mañana.`,
      walk_limit_reached: `Ya envió todos los recorridos que EmberWalk permite por hoy. ${STAYS} Intente de nuevo mañana.`,
      walk_not_done: "Este recorrido todavía se está revisando.",
      rate_limited: `Demasiados intentos en poco tiempo. ${STAYS} Espere un minuto y luego toque ${SEND}.`,
      plan_needed: `Un recorrido necesita un plan. ${STAYS}`,
      walks_used: `Ya usó los recorridos de este año del plan. ${STAYS}`,
      server_error: TRY_AGAIN,
    } satisfies Record<Failure, string>,
  },
};
