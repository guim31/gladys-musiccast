// -----------------------------------------------------------------------------
// Every text the integration produces, in the four languages of the Gladys
// interface (English, French, German, Spanish). German says "du", Spanish
// "usted" (test/i18n.test.js). Brand names (MusicCast, Spotify...) and the
// names the device gives its inputs and sound programs are never translated.
//
// A device integration does not receive the user's language: the feature
// names, the scene action errors and the search report follow the `language`
// field of the configuration; a widget receives the viewer's language.
// -----------------------------------------------------------------------------

import { LANGUAGES } from './config.js';

/** The text of a multi-language object in a language, English as fallback. */
export function pick(texts, language) {
  return texts[language] ?? texts.en;
}

export const lang = (language) => (LANGUAGES.includes(language) ? language : 'en');

// Feature names, frozen by Gladys once the device is added.
export const NAMES = {
  en: {
    power: 'Power',
    volume: 'Volume',
    mute: 'Mute',
    input: 'Input',
    sound_program: 'Sound mode',
    preset: 'Preset',
    play: 'Play',
    pause: 'Pause',
    previous: 'Previous',
    next: 'Next',
    playback_state: 'Playback state',
    title: 'Title',
    artist: 'Artist',
    album: 'Album',
    artwork: 'Artwork',
    duration: 'Duration',
    position: 'Position',
    shuffle: 'Shuffle',
    repeat: 'Repeat',
  },
  fr: {
    power: 'Alimentation',
    volume: 'Volume',
    mute: 'Sourdine',
    input: 'Entrée',
    sound_program: 'Mode son',
    preset: 'Favori',
    play: 'Lecture',
    pause: 'Pause',
    previous: 'Précédent',
    next: 'Suivant',
    playback_state: 'État de lecture',
    title: 'Titre',
    artist: 'Artiste',
    album: 'Album',
    artwork: 'Pochette',
    duration: 'Durée',
    position: 'Position',
    shuffle: 'Lecture aléatoire',
    repeat: 'Répétition',
  },
  de: {
    power: 'Betrieb',
    volume: 'Lautstärke',
    mute: 'Stumm',
    input: 'Eingang',
    sound_program: 'Klangprogramm',
    preset: 'Favorit',
    play: 'Wiedergabe',
    pause: 'Pause',
    previous: 'Vorheriger Titel',
    next: 'Nächster Titel',
    playback_state: 'Wiedergabestatus',
    title: 'Titel',
    artist: 'Interpret',
    album: 'Album',
    artwork: 'Cover',
    duration: 'Dauer',
    position: 'Position',
    shuffle: 'Zufallswiedergabe',
    repeat: 'Wiederholung',
  },
  es: {
    power: 'Encendido',
    volume: 'Volumen',
    mute: 'Silencio',
    input: 'Entrada',
    sound_program: 'Modo de sonido',
    preset: 'Favorito',
    play: 'Reproducir',
    pause: 'Pausa',
    previous: 'Anterior',
    next: 'Siguiente',
    playback_state: 'Estado de reproducción',
    title: 'Título',
    artist: 'Artista',
    album: 'Álbum',
    artwork: 'Carátula',
    duration: 'Duración',
    position: 'Posición',
    shuffle: 'Reproducción aleatoria',
    repeat: 'Repetición',
  },
};

// Short texts: widget labels, values and buttons (24 characters at most).
export const TEXT = {
  on: { en: 'On', fr: 'Allumé', de: 'An', es: 'Encendido' },
  standby: { en: 'Standby', fr: 'Veille', de: 'Standby', es: 'En espera' },
  unreachable: { en: 'Unreachable', fr: 'Injoignable', de: 'Nicht erreichbar', es: 'Inaccesible' },
  power: { en: 'Power', fr: 'Alimentation', de: 'Betrieb', es: 'Encendido' },
  input: { en: 'Input', fr: 'Entrée', de: 'Eingang', es: 'Entrada' },
  soundMode: { en: 'Sound mode', fr: 'Mode son', de: 'Klangprogramm', es: 'Modo de sonido' },
  volume: { en: 'Volume', fr: 'Volume', de: 'Lautstärke', es: 'Volumen' },
  muted: { en: 'Muted', fr: 'Sourdine', de: 'Stumm', es: 'Silenciado' },
  turnOn: { en: 'Turn on', fr: 'Allumer', de: 'Einschalten', es: 'Encender' },
  turnOff: { en: 'Standby', fr: 'Veille', de: 'Standby', es: 'En espera' },
  play: { en: 'Play', fr: 'Lecture', de: 'Wiedergabe', es: 'Reproducir' },
  pause: { en: 'Pause', fr: 'Pause', de: 'Pause', es: 'Pausa' },
  next: { en: 'Next', fr: 'Suivant', de: 'Weiter', es: 'Siguiente' },
  mute: { en: 'Mute', fr: 'Couper le son', de: 'Stumm', es: 'Silenciar' },
  unmute: { en: 'Unmute', fr: 'Remettre le son', de: 'Ton an', es: 'Activar sonido' },
  nothing: {
    en: 'Nothing playing',
    fr: 'Aucune lecture',
    de: 'Keine Wiedergabe',
    es: 'Nada en reproducción',
  },
};

// Longer messages: widget hints, toasts, action answers (200 characters at most).
export const MESSAGES = {
  pickDevice: {
    en: 'Choose a MusicCast zone in the settings of this widget.',
    fr: 'Choisissez une zone MusicCast dans les réglages de ce widget.',
    de: 'Wähle in den Einstellungen dieses Widgets eine MusicCast-Zone.',
    es: 'Elija una zona MusicCast en los ajustes de este widget.',
  },
  unknownDevice: {
    en: 'This MusicCast zone is unknown: search for devices again from the integration page.',
    fr: 'Zone MusicCast inconnue : relancez la recherche depuis la page de l’intégration.',
    de: 'Diese MusicCast-Zone ist unbekannt: Starte die Suche auf der Seite der Integration erneut.',
    es: 'Zona MusicCast desconocida: vuelva a buscar los dispositivos desde la página de la integración.',
  },
  unreachable: {
    en: 'The MusicCast device does not answer: check that it is plugged in and on the network.',
    fr: 'L’appareil MusicCast ne répond pas : vérifiez qu’il est branché et sur le réseau.',
    de: 'Das MusicCast-Gerät antwortet nicht: Prüfe, ob es eingesteckt und im Netzwerk ist.',
    es: 'El dispositivo MusicCast no responde: compruebe que está enchufado y en la red.',
  },
  refused: {
    en: 'The MusicCast device refused the command.',
    fr: 'L’appareil MusicCast a refusé la commande.',
    de: 'Das MusicCast-Gerät hat den Befehl abgelehnt.',
    es: 'El dispositivo MusicCast rechazó la orden.',
  },
  notNetworkSource: {
    en: 'Playback can only be controlled on a network source (Spotify, Net Radio, AirPlay...).',
    fr: 'La lecture ne se pilote que sur une source réseau (Spotify, Net Radio, AirPlay...).',
    de: 'Die Wiedergabe lässt sich nur bei einer Netzwerkquelle steuern (Spotify, Net Radio, AirPlay...).',
    es: 'La reproducción solo se controla en una fuente de red (Spotify, Net Radio, AirPlay...).',
  },
  noSeek: {
    en: 'This source cannot jump within the track: only the media server (Server input) can.',
    fr: 'Cette source ne permet pas de se déplacer dans le morceau : seul le serveur multimédia (entrée Server) le peut.',
    de: 'Diese Quelle kann nicht im Titel springen: Das kann nur der Medienserver (Eingang Server).',
    es: 'Esta fuente no permite moverse dentro de la pista: solo el servidor multimedia (entrada Server) puede.',
  },
  noMode: {
    en: 'This source has no such shuffle or repeat mode.',
    fr: 'Cette source n’a pas ce mode de lecture aléatoire ou de répétition.',
    de: 'Diese Quelle hat diesen Zufalls- oder Wiederholungsmodus nicht.',
    es: 'Esta fuente no tiene ese modo de reproducción aleatoria o de repetición.',
  },
  unknownMedia: {
    en: 'This favorite no longer exists on the MusicCast device: choose it again.',
    fr: 'Ce favori n’existe plus sur l’appareil MusicCast : choisissez-le à nouveau.',
    de: 'Dieser Favorit existiert auf dem MusicCast-Gerät nicht mehr: Wähle ihn erneut.',
    es: 'Este favorito ya no existe en el dispositivo MusicCast: elíjalo de nuevo.',
  },
  done: { en: 'Done', fr: 'C’est fait', de: 'Erledigt', es: 'Hecho' },
  noDevice: {
    en: 'No MusicCast device found. Type its IP address in the configuration if the search misses it.',
    fr: 'Aucun appareil MusicCast trouvé. Saisissez son adresse IP dans la configuration si la recherche le manque.',
    de: 'Kein MusicCast-Gerät gefunden. Trag seine IP-Adresse in der Konfiguration ein, falls die Suche es nicht findet.',
    es: 'No se encontró ningún dispositivo MusicCast. Introduzca su dirección IP en la configuración si la búsqueda no lo encuentra.',
  },
};

// Messages with values, one function per language.
export const FORMATS = {
  unknownPreset: {
    en: (num) => `Preset ${num} is empty on this device.`,
    fr: (num) => `Le favori ${num} est vide sur cet appareil.`,
    de: (num) => `Favorit ${num} ist auf diesem Gerät leer.`,
    es: (num) => `El favorito ${num} está vacío en este dispositivo.`,
  },
  unknownInput: {
    en: (input, list) => `Unknown input "${input}". Available: ${list}.`,
    fr: (input, list) => `Entrée « ${input} » inconnue. Disponibles : ${list}.`,
    de: (input, list) => `Unbekannter Eingang „${input}“. Verfügbar: ${list}.`,
    es: (input, list) => `Entrada «${input}» desconocida. Disponibles: ${list}.`,
  },
  presetRecalled: {
    en: (name) => `Preset recalled: ${name}`,
    fr: (name) => `Favori rappelé : ${name}`,
    de: (name) => `Favorit aufgerufen: ${name}`,
    es: (name) => `Favorito recuperado: ${name}`,
  },
  found: {
    en: (count, list) =>
      `${count} MusicCast device(s) found: ${list}. Their zones are in the Discovery tab.`,
    fr: (count, list) =>
      `${count} appareil(s) MusicCast trouvé(s) : ${list}. Leurs zones sont dans l’onglet Découverte.`,
    de: (count, list) =>
      `${count} MusicCast-Gerät(e) gefunden: ${list}. Die Zonen stehen im Tab „Entdecken“.`,
    es: (count, list) =>
      `${count} dispositivo(s) MusicCast encontrado(s): ${list}. Sus zonas están en la pestaña Descubrir.`,
  },
  failed: {
    en: (list) => `Not answering: ${list}.`,
    fr: (list) => `Sans réponse : ${list}.`,
    de: (list) => `Keine Antwort: ${list}.`,
    es: (list) => `Sin respuesta: ${list}.`,
  },
  invalid: {
    en: (list) => `Ignored, not an address: ${list}.`,
    fr: (list) => `Ignoré, pas une adresse : ${list}.`,
    de: (list) => `Ignoriert, keine Adresse: ${list}.`,
    es: (list) => `Ignorado, no es una dirección: ${list}.`,
  },
};

/** A FORMATS entry rendered in every language, as a multi-language object. */
export function format(key, ...args) {
  return Object.fromEntries(LANGUAGES.map((l) => [l, FORMATS[key][l](...args)]));
}

/** An error whose message is in the configured language, carrying all four. */
export class UserError extends Error {
  constructor(messages, language) {
    super(pick(messages, lang(language)));
    this.name = 'UserError';
    this.messages = messages;
  }
}
