import type { Spanish } from "./copy-es.ts";
import type { billingEn, crewEn, dashboardEn, deleteEverythingEn, demoEn, findingEn, inspectionEn, inviteEn, movedEn, portfolioEn, recheckEn, reportEn, settingsEn, shellEn, signInEn, welcomeEn } from "./draft-words.ts";
import type { RecheckResult } from "./finding-marks.ts";
import type { RecheckCode } from "./recheck-api.ts";
import type { ReportCode } from "./report-api.ts";

export const shellEs: Spanish<typeof shellEn> = {
  nav: "Principal",
  home: "Inicio",
  walks: "Recorridos",
  fixes: "Arreglos",
  homes: "Casas",
  settings: "Ajustes",
};

export const welcomeEs: Spanish<typeof welcomeEn> = {
  lead: "Un recorrido alrededor de su casa con su teléfono. EmberWalk revisa los 100 pies alrededor de ella en busca de lo que podría llevarle el fuego, y muestra qué arreglar primero.",
  sample: "Ver una casa de muestra",
  installTitle: "Agregue EmberWalk a su pantalla de inicio",
  installIos: "Toque el botón Compartir y luego Agregar a inicio. EmberWalk se abrirá como una aplicación.",
  installOther: "Abra esta página en Safari, toque el botón Compartir y luego Agregar a inicio.",
  install: "Agregar a inicio",
  gotIt: "Entendido",
};

export const dashboardEs: Spanish<typeof dashboardEn> = {
  greeting: (hour) => (hour < 12 ? "Buenos días" : hour < 18 ? "Buenas tardes" : "Buenas noches"),
  yourHome: "Su casa",
  lastWalk: (day) => `Último recorrido: ${day}`,
  noWalk: "Todavía no hay recorridos. Un recorrido alrededor de su casa revisa los 100 pies que más importan.",
  toFix: (n) => (n === 1 ? "1 por arreglar" : `${n} por arreglar`),
  done: (n) => (n === 1 ? "1 hecho" : `${n} hechos`),
  nextTitle: "Próximo recorrido",
  nextAfterFixes: "Recorra de nuevo cuando termine sus tres primeros arreglos.",
  nextAfterWalk: "Sus primeros arreglos están hechos. Recorra de nuevo ahora para registrar su recorrido de después.",
  nextYearly: (day) => `Su recorrido anual vence el ${day}.`,
  yearRound: "Mantenga despejado el espacio alrededor de su casa todo el año.",
  results: "Ver resultados",
  fix: "Haga que lo arreglen",
  walkAgain: "Recorrer mi casa de nuevo",
};

export const settingsEs: Spanish<typeof settingsEn> = {
  title: "Ajustes",
  account: "Su cuenta",
  notSignedIn: "No ha iniciado sesión. Sus recorridos se quedan en este teléfono.",
  changeEmail: "Cambiar correo",
  newEmail: "Correo nuevo",
  sendCode: "Enviar código",
  codeSent: (email) => `Enviamos un código de 6 dígitos a ${email}. Escríbalo aquí para pasar su cuenta a ese correo.`,
  confirm: "Cambiar mi correo",
  changed: (email) => `Su cuenta ahora usa ${email}.`,
  taken: "Otra cuenta de EmberWalk usa ese correo.",
  cancel: "Cancelar",
  language: "Idioma",
  privacy: "Privacidad",
  install: "Agregar a inicio",
  walk: "Durante su recorrido",
  readAloud: "Leer cada paso en voz alta mientras sostiene el teléfono. Cuando su recorrido graba sonido, los pasos se quedan en la pantalla para que sus propias notas se oigan claras.",
  on: "Sí",
  off: "No",
  reminders: "Correos de recordatorio",
  remindersLine: "Un correo cada año antes de la temporada de incendios, cuando vence su recorrido anual, y uno después de un recorrido cuando estén hechos sus primeros arreglos, para registrar su recorrido de después.",
  remindersFailed: "No se guardó. Revise su señal e intente de nuevo.",
  help: "Ayuda",
  contact: "Contáctenos",
};

export const deleteEverythingEs: Spanish<typeof deleteEverythingEn> = {
  entry: "Información y privacidad",
  title: "Información y privacidad",
  notInspection: "Esta revisión no es una inspección y no reemplaza a una.",
  rulesRead: (first, last) =>
    first === last
      ? `Las reglas de los recorridos de muestra se tomaron de sus fuentes el ${first}.`
      : `Las reglas de los recorridos de muestra se tomaron de sus fuentes entre el ${first} y el ${last}.`,
  heading: "Borrar todo",
  lead: "Borrar todo elimina los recorridos que EmberWalk guarda de este teléfono y borra las copias que hay en este teléfono.",
  kept: "Después de Borrar todo, guardamos sus registros de plan y de pago, la lista de inscripción, la lista de cuadrillas que pidieron no recibir más correos, y un registro de lo que costó cada revisión, sin ningún vínculo con usted ni con su recorrido.",
  start: "Borrar todo",
  confirm:
    "Esto elimina los recorridos que EmberWalk guarda de este teléfono, con sus fotos y resultados. Las grabaciones que aún no se han enviado se quedan en este teléfono, excepto los lados y las esquinas grabados para esos recorridos, que se eliminan con ellos. No se puede deshacer.",
  yes: "Sí, borrar todo",
  no: "Regresar",
  working: "Borrando sus recorridos.",
  done: "Listo. Se eliminaron los recorridos que EmberWalk guardaba de este teléfono. Las grabaciones que aún no se han enviado se quedan en este teléfono, excepto los lados y las esquinas grabados para esos recorridos.",
  busy: "Todavía se está enviando o revisando un recorrido. Toque Borrar todo de nuevo cuando termine.",
  offline: "No hay señal ahora. Toque Borrar todo de nuevo cuando tenga señal.",
  failed: "Borrar todo todavía no ha terminado. Toque Borrar todo de nuevo para terminar.",
  doneAccountKept:
    "Listo. Se eliminaron los recorridos que EmberWalk guardaba de este teléfono. Los recorridos, el plan y el correo de su cuenta se siguen guardando. Para borrarlos también, inicie sesión con su correo, abra el enlace en este teléfono y toque Borrar todo de nuevo. Si ya no tiene ese correo, escriba a hello@emberwalk.app.",
  signIn: "Iniciar sesión",
  signInFirst: "Primero inicie sesión y luego toque Borrar todo de nuevo. Todavía no se ha borrado nada.",
  back: "Volver al inicio",
};

export const movedEs: Spanish<typeof movedEn> = {
  signInAgain: "Sus recorridos están en su cuenta, y la sesión de este teléfono terminó. Inicie sesión de nuevo para verlos.",
  signIn: "Iniciar sesión",
};

const TRY_LATER = "Esta foto todavía no se ha revisado. Puede intentarlo de nuevo en un rato.";

export const recheckEs: Spanish<typeof recheckEn> = {
  entry: "Volver a revisar este punto",
  title: "Volver a revisar este punto",
  lead: "Párese donde se tomó la primera foto y alinee la imagen tenue con lo que ve ahora. Luego toque Tomar foto.",
  take: "Tomar foto",
  checking: "Revisando su foto nueva.",
  back: "Volver a los resultados",
  sample: "Este es un recorrido de ejemplo, así que no hay nada que volver a revisar.",
  useSample: "Usar la foto de después de ejemplo",
  sampleLead: "Esta es una casa inventada, así que no hay nada que fotografiar. Esta es su imagen de después.",
  sampleNote: "Esta es una respuesta de muestra. Una revisión real envía su foto a la revisión de EmberWalk y muestra lo que encontró.",
  notDone: "Primero marque este punto como Listo. Luego puede volver a revisarlo aquí.",
  noCamera: "La cámara no está abierta. Permita la cámara para este sitio en los ajustes de su navegador y abra esta pantalla de nuevo.",
  noPhoto: "Todavía no hay foto. Toque Tomar foto para intentarlo de nuevo.",
  answer: {
    cleared: "Este punto parece despejado en su foto nueva.",
    still_there: "Este punto todavía aparece en su foto nueva. Puede volver a revisarlo después del próximo arreglo.",
    unsure: "Esta foto no es lo bastante clara para saberlo. Una foto más de cerca y con luz de día suele ayudar.",
  } satisfies Record<RecheckResult, string>,
  failed: {
    offline: "No hay señal ahora. Su foto no se envió. Toque Tomar foto de nuevo cuando tenga señal.",
    not_done: "Primero marque este punto como Listo. Luego puede volver a revisarlo aquí.",
    no_photo: "La foto todavía no ha llegado. Toque Tomar foto para enviarla de nuevo.",
    too_large: "Esta foto es demasiado grande para enviarla. Toque Tomar foto para probar con una nueva.",
    too_many_rechecks: "Este punto ya usó todas sus revisiones.",
    not_found: "Este punto no está en su registro.",
    invalid_request: TRY_LATER,
    method_not_allowed: TRY_LATER,
    server_error: TRY_LATER,
  } satisfies Record<RecheckCode, string>,
};

const REPORT_LATER = "Su informe no está listo en este momento. Puede abrirlo de nuevo en un rato.";

const NOT_A_REPORT = "Este enlace no abre un informe. Vuelva a sus resultados para encontrar el suyo.";

const reportFailed = {
  offline: "No hay señal ahora. Abra su informe de nuevo cuando tenga señal.",
  timeout: "Su informe está tardando más de lo normal. Ábralo de nuevo en un rato.",
  walk_not_done: "Este recorrido todavía se está revisando. Su informe estará aquí cuando termine.",
  conflict: "Primero apruebe abajo las fotos difuminadas. Luego puede descargar su informe.",
  body_too_large: "Este recorrido tiene más fotos de las que caben en un informe.",
  invalid_request: NOT_A_REPORT,
  unknown_walk: "Este recorrido no está en su registro en este teléfono.",
  not_found: "Los informes todavía no están abiertos.",
  method_not_allowed: NOT_A_REPORT,
  server_error: REPORT_LATER,
} satisfies Record<ReportCode, string>;

const BLURRED = "Las caras, las placas de los vehículos, los números de las casas, los letreros de las calles y los buzones deben verse difuminados. Apruebe solo cuando lo estén.";

export const reportEs: Spanish<typeof reportEn> = {
  entry: "Su informe",
  title: "Su informe",
  lead: "Este es el registro de este recorrido, con las mismas páginas que el PDF.",
  loading: "Preparando su informe.",
  preview: "Vista previa del informe",
  checkPhotos: `Mire cada foto de su informe. ${BLURRED}`,
  checkAgain: `Su informe cambió después de que lo aprobó. Mire cada foto de nuevo. ${BLURRED}`,
  approve: "Aprobar fotos difuminadas",
  approving: "Guardando su aprobación.",
  approved: (on) => `Aprobó las fotos difuminadas el ${on}. Ya puede descargar su informe.`,
  download: "Descargar PDF",
  making: "Creando su PDF.",
  back: "Volver a los resultados",
  failed: reportFailed,
  pdfFailed: {
    ...reportFailed,
    offline: "No hay señal ahora. Toque Descargar PDF de nuevo cuando tenga señal.",
    timeout: "Su PDF está tardando más de lo normal. Toque Descargar PDF para intentarlo de nuevo.",
    server_error: "Su PDF no está listo en este momento. Toque Descargar PDF para intentarlo de nuevo en un rato.",
  } satisfies Record<ReportCode, string>,
  approveFailed: {
    ...reportFailed,
    offline: "No hay señal ahora. Toque Aprobar fotos difuminadas de nuevo cuando tenga señal.",
    timeout: "Su aprobación está tardando más de lo normal. Toque Aprobar fotos difuminadas para intentarlo de nuevo.",
    server_error: "Su aprobación todavía no se ha guardado. Toque Aprobar fotos difuminadas para intentarlo de nuevo en un rato.",
  } satisfies Record<ReportCode, string>,
  share: {
    title: "Compartir enlace",
    lead: "Cualquier persona con este enlace puede abrir el PDF del informe que aprobó. Si su recorrido recibe fotos nuevas, o si marca o vuelve a revisar un punto, el enlace espera hasta que apruebe su informe de nuevo. Nada más de su recorrido se abre con él. El enlace deja de funcionar cuando lo desactiva o cuando usa Borrar todo.",
    readFailed: "Su enlace todavía no se ha comprobado. Toque Crear enlace para compartir para intentarlo de nuevo. Un enlace que ya tiene sigue igual.",
    make: "Crear enlace para compartir",
    making: "Creando su enlace.",
    copy: "Copiar enlace",
    copied: "Enlace copiado.",
    copyFailed: "Mantenga presionado el enlace para copiarlo.",
    stop: "Desactivar enlace",
    stopping: "Desactivando su enlace.",
    stopped: "Su enlace está desactivado. Ya no abre su informe.",
    makeFailed: {
      ...reportFailed,
      offline: "No hay señal ahora. Toque Crear enlace para compartir de nuevo cuando tenga señal.",
      timeout: "Su enlace está tardando más de lo normal. Toque Crear enlace para compartir para intentarlo de nuevo.",
      server_error: "Su enlace todavía no se ha creado. Toque Crear enlace para compartir para intentarlo de nuevo en un rato.",
    } satisfies Record<ReportCode, string>,
    stopFailed: {
      ...reportFailed,
      offline: "No hay señal ahora. Toque Desactivar enlace de nuevo cuando tenga señal.",
      timeout: "Desactivar su enlace está tardando más de lo normal. Toque Desactivar enlace para intentarlo de nuevo.",
      server_error: "Su enlace todavía no está desactivado. Toque Desactivar enlace para intentarlo de nuevo en un rato.",
    } satisfies Record<ReportCode, string>,
  },
};

export const inspectionEs: Spanish<typeof inspectionEn> = {
  openForm: "Abrir el formulario de CAL FIRE",
  goesTo: (agency, email) => `Esto va a ${agency} en ${email}, la dirección que tenemos de ellos.`,
  source: "Fuente",
  readOn: (day) => `Leído el ${day}.`,
  nothingSent: "No se envía nada hasta que toque Enviar correo al departamento.",
  email: "Enviar correo al departamento",
  sending: "Enviando su correo.",
  sent: (agency) => `Enviado a ${agency}. Su respuesta llega aquí.`,
  replied: "Lo que respondieron",
};

export const crewEs: Spanish<typeof crewEn> = {
  entry: "Registre su cuadrilla",
  title: "Registre su cuadrilla",
  lead: "Las cuadrillas con licencia C-27 y C-49 pueden registrarse aquí gratis. Las personas propietarias cercanas podrán enviarle por correo solicitudes de presupuesto, cada una aprobada por la persona propietaria de la casa.",
  name: "Nombre del negocio",
  license: "Número de licencia de California",
  licenseClass: "Clase de licencia",
  classes: { "C-27": "C-27 Jardinería y paisajismo", "C-49": "C-49 Árboles y palmeras" },
  email: "Correo para solicitudes",
  phone: "Teléfono (opcional)",
  zip: "Su código postal",
  agree: "Quiero que las personas propietarias cercanas envíen solicitudes de presupuesto a esta cuadrilla por correo a través de EmberWalk. Cada correo tiene una forma de salir de la lista.",
  submit: "Registrar mi cuadrilla",
  sending: "Comprobando su licencia.",
  checkEmail: "Revise su correo. Abra el enlace que le enviamos para terminar de registrar su cuadrilla.",
  licenseListed: "Esta licencia ya está registrada en EmberWalk. Si esa no es su cuadrilla, escriba a hello@emberwalk.app.",
  licenseWaiting: "Alguien empezó a registrar esta licencia en el último día y no la ha confirmado. Si no fue usted, inténtelo de nuevo mañana o escriba a hello@emberwalk.app.",
  mustAgree: "Marque la casilla para registrar su cuadrilla.",
  badPhone: "Escriba un número de teléfono de 10 dígitos, o déjelo vacío.",
  notListed: "La lista estatal de licencias no muestra este número y clase en regla. También puede que esta dirección haya pedido salir de nuestra lista.",
  back: "Volver a Información y privacidad",
  nameYours: "Nombre su propia cuadrilla",
  crewName: "Nombre de la cuadrilla",
  crewContact: "Su correo o teléfono",
  addCrew: "Agregar esta cuadrilla",
  needContact: "Escriba un correo o un teléfono de 10 dígitos.",
  crewRefused: "Este trabajo no puede aceptar otra cuadrilla.",
};

export const findingEs: Spanish<typeof findingEn> = {
  hear: "Escucharlo",
  help: "Ayuda cerca de usted",
  cannotHear: "La lectura en voz alta no está disponible en este teléfono.",
  advice: "Nuestro consejo, no una regla",
};

export const demoEs: Spanish<typeof demoEn> = {
  inboxTitle: "Buzón de demostración",
  inboxLead: "Esta es una casa de muestra, así que las solicitudes se detienen aquí. Ninguna cuadrilla real las recibe.",
  to: (address) => `Para ${address}`,
};

const NO_SIGNAL_ES = "No hay señal ahora. Inténtelo de nuevo cuando tenga señal.";

export const signInEs: Spanish<typeof signInEn> = {
  entry: "Iniciar sesión",
  title: "Iniciar sesión",
  lead: "Inicie sesión con un código enviado a su correo. Sin contraseña. Inicia sesión una vez en este teléfono y la sesión sigue abierta, y sus recorridos y su plan lo acompañan a un teléfono nuevo.",
  notLinked: "Los recorridos y el plan hechos en este teléfono todavía no son parte de su cuenta. Para agregarlos, pida un enlace en este teléfono y ábralo aquí.",
  heldPhone: "Los recorridos y el plan hechos en este teléfono quedan fuera de su cuenta, porque este teléfono ya inició sesión en otra cuenta.",
  signOutEverywhere: "Cerrar sesión en todos los teléfonos",
  walkBusy: "Todavía se está enviando o revisando un recorrido. Cierre sesión cuando termine.",
  afterPurchase: "Su plan está en este teléfono. Inicie sesión si quiere conservarlo cuando cambie de teléfono.",
  emailLabel: "Su correo",
  send: "Enviar mi código",
  waitForCheck: "Un momento. EmberWalk todavía está revisando este teléfono. Inténtelo de nuevo en unos segundos.",
  checkFailed: "EmberWalk necesita comprobar que una persona está pidiendo este enlace. Inténtelo de nuevo.",
  signedInAs: (email) => `Sesión iniciada como ${email}`,
  signOut: "Cerrar sesión",
  codeSent: (email) => `Enviamos un código de 6 dígitos a ${email}. Escríbalo aquí. Termina en 15 minutos.`,
  codeLabel: "Su código",
  enterCode: "Iniciar sesión",
  codeWrong: "Ese código no coincide. Revise el correo e inténtelo de nuevo.",
  codeTries: "Ese código se intentó demasiadas veces. Pida uno nuevo.",
  codeEnded: "Ese código ya terminó. Pida uno nuevo.",
  newCode: "Enviar un código nuevo",
  checking: "Iniciando su sesión.",
  notSetUp: "El inicio de sesión todavía no está configurado.",
  mailFailed: "El correo todavía no ha salido. Inténtelo de nuevo.",
  tooMany: "EmberWalk ya envió todos los enlaces que permite por ahora. Inténtelo de nuevo en una hora.",
  badEmail: "Ese correo no parece correcto. Revíselo e inténtelo de nuevo.",
  linkExpired: "Este enlace ya terminó. Pida uno nuevo.",
  linkUsed: "Este enlace ya se usó. Pida uno nuevo.",
  linkInvalid: "Este enlace no funciona. Pida uno nuevo.",
  askAgain: "Pedir un enlace nuevo",
  failed: "Inténtelo de nuevo.",
  noSignal: NO_SIGNAL_ES,
  back: "Volver al inicio",
};

export const portfolioEs: Spanish<typeof portfolioEn> = {
  entry: "Sus casas",
  title: "Sus casas",
  sampleLine: "Estas casas son de muestra y son inventadas.",
  empty: "Todavía no hay casas. Agregue la primera abajo.",
  status: { not_walked: "Sin recorrer todavía", needs_work: "Puntos por arreglar", ready: "Listo" },
  openItems: (n) => (n === 0 ? "Sin puntos abiertos" : `${n} ${n === 1 ? "punto abierto" : "puntos abiertos"}`),
  lastWalk: (day) => `Último recorrido ${day}`,
  noWalkYet: "Todavía sin recorrido",
  open: "Abrir esta casa",
  addLabel: "Ponga nombre a esta casa",
  add: "Agregar casa",
  planNeeded: "Más de una casa requiere el plan para quienes administran viviendas de alquiler.",
  addFailed: "Esa casa todavía no se ha agregado. Inténtelo de nuevo.",
  walks: "Recorridos",
  noWalks: "Todavía no hay recorridos. Invite a una persona inquilina o recorra la casa por su cuenta.",
  walkedOn: (day) => `Recorrida el ${day}`,
  byTenant: "Recorrida por una persona inquilina",
  byYou: "Recorrida por usted",
  stillChecking: "Todavía se está revisando.",
  notFinished: "Recorra esta casa de nuevo para obtener resultados.",
  openHeading: "Puntos abiertos",
  doneHeading: "Arreglados",
  requiredNow: "Obligatorio ahora",
  recommended: "Recomendado",
  markDone: "Marcar como hecho",
  doneOn: (concept, day) => `${concept}: hecho el ${day}`,
  markFailed: "Eso todavía no se ha guardado. Inténtelo de nuevo.",
  results: "Ver resultados",
  getItFixed: "Haga que lo arreglen",
  invite: "Invitar a una persona inquilina",
  walkIt: "Recorrer esta casa",
  record: "Descargar registro con fechas",
  notFound: "Esta casa no está en su lista.",
  noSignal: NO_SIGNAL_ES,
  failed: "Sus casas todavía no se muestran. Inténtelo de nuevo.",
  backHomes: "Volver a Sus casas",
  backHome: "Volver al inicio",
};

export const inviteEs: Spanish<typeof inviteEn> = {
  title: "Invitar a una persona inquilina",
  lead: "Cree un enlace y envíelo por su cuenta a la persona inquilina. EmberWalk no se comunica con esa persona y no le pide su nombre, correo ni teléfono. Sirve para un recorrido, durante 7 días.",
  make: "Crear enlace de invitación",
  ready: "Su enlace de invitación",
  copy: "Copiar enlace",
  copied: "Copiado.",
  share: "Compartir enlace",
  ends: (day) => `Vale hasta el ${day}.`,
  tenantTitle: "Tiene una invitación para recorrer esta casa",
  tenantLead: "La persona que le alquila esta casa o quien la administra le pidió revisar el espacio alrededor de esta casa. No necesita una cuenta. Camine por afuera con su teléfono y EmberWalk revisa lo que ve.",
  tenantShare: "El recorrido va a la persona que le envió la invitación, y usted también verá los resultados aquí.",
  start: "Comenzar el recorrido",
  expired: "Esta invitación terminó. Pida una nueva.",
  used: "Esta invitación ya se usó. Pida una nueva.",
  removed: "Esta casa ya no está en la lista. Pregunte a la persona que le envió la invitación.",
  unknown: "Esta invitación no funciona. Pida una nueva.",
  noSignal: NO_SIGNAL_ES,
  back: "Volver al inicio",
};

export const billingEs: Spanish<typeof billingEn> = {
  entry: "Su plan",
  title: "Su plan",
  loading: "Cargando su plan.",
  notOpen: "Los planes todavía no están a la venta.",
  noSignal: "No hay señal ahora. Intente de nuevo cuando tenga señal.",
  failed: "Su plan todavía no se muestra. Toque Intentar de nuevo.",
  tryAgain: "Intentar de nuevo",
  home: "Regresar al inicio",
  lead: "Cada recorrido de una casa real necesita un plan. El plan se renueva cada año hasta que lo cancele. Usted paga en la página de Stripe.",
  sampleFree: "El recorrido de muestra es gratis, y un recorrido que no termina nunca cuenta.",
  name: { individual: "Individual", landlord: "Personas propietarias y administradoras de propiedades" },
  price: (amount) => `${amount} al año`,
  walksAYear: (n) => `${n} recorridos al año`,
  buyPlan: (amount) => `Comprar por ${amount} al año`,
  leaving: "Abriendo Stripe.",
  cancelled: "Salió de la página de Stripe. Si no terminó de pagar, no se le cobró nada.",
  done: "Gracias. Su plan está listo.",
  doneExtra: "Gracias. Ya se agregaron sus recorridos adicionales.",
  confirming: "Stripe está confirmando su pago. Esto puede tardar un minuto.",
  stillConfirming: "Stripe todavía no ha confirmado su pago. No hace falta comprar de nuevo. Toque Revisar de nuevo en unos minutos.",
  checkAgain: "Revisar de nuevo",
  notHere: "EmberWalk no ve un plan aquí. Si acaba de pagar, abra EmberWalk en el navegador o la aplicación donde empezó, y ahí está su plan. Si no pagó, puede elegir un plan abajo.",
  countUnread: "EmberWalk no puede leer su cuenta de recorridos en este momento. No hace falta comprar de nuevo. Toque Revisar de nuevo en unos minutos.",
  extraOnWay: "Gracias. Sus recorridos adicionales aparecen en su cuenta cuando Stripe los confirme.",
  toLandlord: "Más de una casa necesita el plan para personas propietarias y administradoras de propiedades. Para cambiar a ese plan, escriba a hello@emberwalk.app.",
  walksLine: (used, left) => {
    const spent = used === 1 ? "1 recorrido usado" : `${used} recorridos usados`;
    return left === 1 ? `${spent}, queda 1 en este año del plan.` : `${spent}, quedan ${left} en este año del plan.`;
  },
  yearEnds: (day) => `Este año del plan termina el ${day}.`,
  pastDue: "Su último pago necesita que actualice su tarjeta. Toque Administrar o cancelar para actualizar su tarjeta.",
  onHold: "Este plan está en pausa. Toque Administrar o cancelar para ver qué necesita.",
  refunded: "Este plan se reembolsó, así que no puede iniciar recorridos nuevos. Toque Administrar o cancelar para verlo.",
  ended: "Su plan terminó. Elija un plan para hacer otro recorrido.",
  manage: "Administrar o cancelar",
  extraHeading: "Recorridos adicionales",
  extraLead: (amount) => `${amount} cada uno. Los recorridos adicionales sin usar pasan al año siguiente.`,
  extraCount: "Cuántos",
  buyExtra: (n, amount) => `Comprar ${n} por ${amount}`,
  stripeDown: "Stripe todavía no responde. Intente de nuevo.",
  notAvailable: "Comprar no está disponible en este momento.",
  already: "Usted ya tiene un plan.",
  didNotWork: "Eso no funcionó. Intente de nuevo.",
  choosePlan: "Elegir un plan",
  seePlan: "Ver su plan",
};
