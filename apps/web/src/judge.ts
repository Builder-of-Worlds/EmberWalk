import { follow } from "./language.ts";

declare const __EMBERWALK_JUDGE__: boolean;

export const JUDGE = typeof __EMBERWALK_JUDGE__ === "boolean" && __EMBERWALK_JUDGE__;

export const JUDGE_MEDIA = {
  video: "film/master.m3u8",
  poster: "judges-video-poster.jpg",
  walk: "walk/desktop/master.m3u8",
  walkPhone: "walk/phone/master.m3u8",
  hls: "hls.light.min.js",
  walkPoster: "walk-poster.jpg",
  stills: "stills/",
  pdf: "report.pdf",
} as const;

export const TRUTH_SAMPLE_ID = "sample-hero-walk";

const SIDES_ES: Record<string, string> = { left: "izquierdo", back: "trasero", right: "derecho", front: "delantero" };

const judgeEs = {
  label: "Casa de muestra sintética",
  title: "EmberWalk",
  lead: "Filme un recorrido alrededor de una casa. EmberWalk revisa lo que podría llevar el fuego hasta ella.",
  video: "Ver el Video para el Jurado",
  close: "Cerrar el Video",
  walkHeading: "Vea un Recorrido Alrededor de una Casa de Muestra",
  walkLine: "Esta casa es inventada. Un recorrido completo toma unos cinco minutos, así que este video está acortado a cerca de un minuto y cuarto. Conserva la parada en cada esquina, donde la persona recorre el patio con la cámara. Al terminar, verá los resultados del recorrido completo.",
  walkButton: "Ver el Recorrido de Muestra",
  resultsButton: "Ir a los Resultados",
  appHeading: "Pruebe la Aplicación",
  appLine: "Sin iniciar sesión. Todo aquí funciona con la casa de muestra, y nada sale de este navegador.",
  screens: {
    how: "Cómo Funciona un Recorrido Real",
    results: "Ver los Resultados",
    fix: "Get It Fixed",
    report: "Ver el Informe",
    history: "El Registro de Muestra",
    homes: "Casas de Muestra",
    about: "Acerca de y Privacidad",
  },
  fullScreen: "Pantalla Completa",
  walkFailed: "Este video no se cargó. Aun así puede ir directo a los resultados.",
  filmFailed: "Este video no se cargó. Ciérrelo e inténtelo de nuevo.",
  walking: (side: string) => `Caminando hacia el lado ${SIDES_ES[side]}`,
  panning: (side: string) => `Parada en el lado ${SIDES_ES[side]}, recorriendo el patio con la cámara`,
  arriving: "De vuelta al inicio",
  truth: "Estos puntos son los peligros conocidos construidos en esta casa inventada, usados como datos de prueba.",
  crews: "Estas cuadrillas son inventadas. En un recorrido real, aquí aparecen cuadrillas con licencia cerca de usted, de la lista pública de contratistas de California, primero las más cercanas.",
  inbox: "Respuesta de muestra. En esta casa de muestra, las solicitudes van a una bandeja de demostración y no se envía nada a nadie.",
  recheckLead: "En un recorrido real, usted toma una foto nueva del lugar. Aquí, una foto de muestra del mismo lugar la reemplaza.",
  recheckUse: "Revisar la Foto de Muestra",
  recheckAnswer: "Respuesta de muestra, inventada para esta casa de muestra.",
  recheckCleared: "Este punto parece despejado en la foto de muestra.",
  markAll: "Marcar Todos los Puntos Como Hechos en Esta Muestra",
};

export const judgeWords = follow({
  label: "Synthetic sample house",
  title: "EmberWalk",
  lead: "Film one walk around a house. EmberWalk checks what could carry fire to it.",
  video: "Watch the Judges' Video",
  close: "Close Video",
  walkHeading: "Watch a Walk Around a Sample House",
  walkLine: "This house is made up. A full walk takes about five minutes, so this video is shortened to about a minute and a quarter. It keeps the stop at each corner, where the walker pans the yard. When it ends, you see the results of the full walk.",
  walkButton: "Watch the Sample Walk",
  resultsButton: "Skip to the Results",
  appHeading: "Try the App",
  appLine: "No sign-in. Everything here runs on the sample house, and nothing leaves this browser.",
  screens: {
    how: "How a Real Walk Works",
    results: "See the Results",
    fix: "Get It Fixed",
    report: "See the Report",
    history: "The Sample Record",
    homes: "Sample Homes",
    about: "About and Privacy",
  },
  fullScreen: "Full Screen",
  walkFailed: "This video did not load. You can still go straight to the results.",
  filmFailed: "This video did not load. Close it and try again.",
  walking: (side: string) => `Walking to the ${side} side`,
  panning: (side: string) => `Stopped at the ${side} side, panning the yard`,
  arriving: "Back at the start",
  truth: "These items are the known hazards built into this made-up house, used as test data.",
  crews: "These crews are made up. On a real walk, this lists licensed crews near you from California's public contractor list, closest first.",
  inbox: "Sample reply. On this sample house, requests go to a demo inbox and nothing is sent to anyone.",
  recheckLead: "On a real walk you take a new photo of the spot. Here, a sample photo of the same spot stands in.",
  recheckUse: "Check the Sample Photo",
  recheckAnswer: "Sample answer, made up for this sample house.",
  recheckCleared: "This item looks cleared in the sample photo.",
  markAll: "Mark Every Item Done on This Sample",
}, judgeEs);
