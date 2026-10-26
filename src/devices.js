// -----------------------------------------------------------------------------
// One Gladys device per zone of a MusicCast device (main, zone2...): what the
// user powers, turns up and switches input independently.
//
// Couples chosen among those the Gladys front knows (test/gladys-rules.test.js):
// - power: switch/binary, a toggle with its state;
// - volume, mute, play, pause, previous, next, playback_state and, since
//   1.1.0, the "now playing" of Gladys 5.3 (title, artist, album, artwork,
//   duration, position, shuffle, repeat): the `music` category, the one the
//   core's Music player reads. The volume is published in percent of the
//   zone's range (the player's slider is 0-100), not in raw steps. Mute was a
//   switch/binary in 1.0: same id, converted by "Update" in Discovery;
// - input, sound mode, preset: text/select, the dynamic select of Gladys 5.2
//   whose options the integration declares per device (`supported_options`,
//   string values: the input ids of the device, `hdmi1`, `spotify`...);
// - title, artist, album were text/text in 1.0: same ids, now music/*.
//
// The playback features exist only on a device with a network module
// (`netusb`), shared by all its zones. Feature keys are part of the external
// ids: frozen once published.
// -----------------------------------------------------------------------------

import {
  MUSIC_PLAYBACK_STATE,
  MUSIC_REPEAT_MODE,
  DEVICE_FEATURE_CATEGORIES as CAT,
  DEVICE_FEATURE_TYPES as TYPE,
  DEVICE_FEATURE_UNITS as UNIT,
  DEVICE_POLL_FREQUENCIES,
} from '@gladysassistant/integration-sdk';
import { NAMES } from './i18n.js';
import { MAX_SECONDS, artworkUrlOf, isNetworkSource, volumeToPercent } from './yxc/model.js';

export const DEVICE_TYPE = 'zone';

export const FEATURES = {
  POWER: 'power',
  VOLUME: 'volume',
  MUTE: 'mute',
  INPUT: 'input',
  SOUND_PROGRAM: 'sound_program',
  PRESET: 'preset',
  PLAY: 'play',
  PAUSE: 'pause',
  PREVIOUS: 'previous',
  NEXT: 'next',
  PLAYBACK_STATE: 'playback_state',
  TITLE: 'title',
  ARTIST: 'artist',
  ALBUM: 'album',
  ARTWORK: 'artwork',
  DURATION: 'duration',
  POSITION: 'position',
  SHUFFLE: 'shuffle',
  REPEAT: 'repeat',
};

// The playback buttons and the netusb command each one sends.
export const PLAYBACK_COMMANDS = {
  [FEATURES.PLAY]: 'play',
  [FEATURES.PAUSE]: 'pause',
  [FEATURES.PREVIOUS]: 'previous',
  [FEATURES.NEXT]: 'next',
};

// playback_state written by Gladys → netusb/setPlayback.
export const PLAYBACK_STATE_COMMANDS = {
  [MUSIC_PLAYBACK_STATE.PAUSED]: 'pause',
  [MUSIC_PLAYBACK_STATE.PLAYING]: 'play',
  [MUSIC_PLAYBACK_STATE.IDLE]: 'stop',
};

// netusb `repeat` ↔ MUSIC_REPEAT_MODE.
export const REPEAT_MODES = {
  off: MUSIC_REPEAT_MODE.OFF,
  all: MUSIC_REPEAT_MODE.ALL,
  one: MUSIC_REPEAT_MODE.ONE,
};

// A text state is never empty, or the core ignores it (input, sound mode).
export const NOTHING = '—';

// The core polls only at these paces; the container refreshes by itself
// (src/hub.js), the core's poll is a fallback (Gladys#3198).
export const CORE_POLL_FREQUENCY = DEVICE_POLL_FREQUENCIES.EVERY_30_SECONDS;

/** The ids of the Gladys device of one zone. */
export function zoneIds(gladys, platformId, zoneId) {
  return gladys.externalIds(DEVICE_TYPE, `${platformId}-${zoneId}`);
}

/** Name of the zone's device: the device name, followed by the zone name for a sub-zone. */
export function zoneDeviceName(unit, zone) {
  return (zone.id === 'main' ? unit.name : `${unit.name} ${zone.name}`).slice(0, 60);
}

const toggle = { category: CAT.SWITCH, type: TYPE.SWITCH.BINARY, min: 0, max: 1 };
const button = (type) => ({ category: CAT.MUSIC, type, min: 0, max: 1, has_feedback: false });
const music = (type, min, max, fields = {}) => ({ category: CAT.MUSIC, type, min, max, ...fields });
const shown = { read_only: true, has_feedback: false };
const select = (options) => ({
  category: CAT.TEXT,
  type: TYPE.TEXT.SELECT,
  min: 0,
  max: 0,
  supported_options: options.map(({ value, label }, index) => ({
    value,
    label,
    sort_order: index,
  })),
});

/** The options of the input select of a zone: its inputs, as the device names them. */
export function inputOptions(unit, zone) {
  return zone.inputs.map((id) => ({ value: id, label: unit.inputs.get(id)?.name ?? id }));
}

/** The options of the preset select: `"<num>"`, labelled "1. Name". */
export function presetOptions(presets) {
  return presets.map((preset) => ({
    value: String(preset.num),
    label: `${preset.num}. ${preset.name}`,
  }));
}

/**
 * The discovery payload of one zone.
 * @param {object} gladys
 * @param {object} unit from describeUnit, with `host` and `presets`
 * @param {object} zone one of `unit.zones`
 * @param {string} language feature names
 */
export function buildZoneDevice(gladys, unit, zone, language) {
  const ids = zoneIds(gladys, unit.platformId, zone.id);
  const names = NAMES[language] ?? NAMES.en;
  const features = [];
  const add = (key, fields) =>
    features.push({
      name: names[key],
      external_id: ids.feature(key),
      read_only: false,
      has_feedback: true,
      keep_history: false,
      ...fields,
    });

  if (zone.hasPower) {
    add(FEATURES.POWER, { ...toggle, keep_history: true });
  }
  if (zone.volume) {
    add(FEATURES.VOLUME, {
      category: CAT.MUSIC,
      type: TYPE.MUSIC.VOLUME,
      unit: UNIT.PERCENT,
      min: 0,
      max: 100,
    });
  }
  if (zone.hasMute) {
    add(FEATURES.MUTE, music(TYPE.MUSIC.MUTE, 0, 1));
  }
  add(FEATURES.INPUT, select(inputOptions(unit, zone)));
  if (zone.soundPrograms.length > 0) {
    add(
      FEATURES.SOUND_PROGRAM,
      select(zone.soundPrograms.map((program) => ({ value: program.id, label: program.name }))),
    );
  }
  if (unit.hasNetusb) {
    if (unit.presetSlots > 0) {
      // The device does not say which preset plays: the select shows the last
      // one recalled from Gladys.
      add(FEATURES.PRESET, { ...select(presetOptions(unit.presets ?? [])), has_feedback: false });
    }
    add(FEATURES.PLAY, button(TYPE.MUSIC.PLAY));
    add(FEATURES.PAUSE, button(TYPE.MUSIC.PAUSE));
    add(FEATURES.PREVIOUS, button(TYPE.MUSIC.PREVIOUS));
    add(FEATURES.NEXT, button(TYPE.MUSIC.NEXT));
    // Writable since 1.1.0: 0 pause, 1 play, 2 stop (IDLE).
    add(FEATURES.PLAYBACK_STATE, music(TYPE.MUSIC.PLAYBACK_STATE, 0, 2));
    add(FEATURES.TITLE, music(TYPE.MUSIC.TITLE, 0, 0, shown));
    add(FEATURES.ARTIST, music(TYPE.MUSIC.ARTIST, 0, 0, shown));
    add(FEATURES.ALBUM, music(TYPE.MUSIC.ALBUM, 0, 0, shown));
    add(FEATURES.ARTWORK, music(TYPE.MUSIC.ARTWORK, 0, 0, shown));
    add(
      FEATURES.DURATION,
      music(TYPE.MUSIC.DURATION, 0, MAX_SECONDS, { ...shown, unit: UNIT.SECONDS }),
    );
    // A seek (netusb/setPlayPosition): the media server input only, the
    // others refuse it with a message.
    add(FEATURES.POSITION, music(TYPE.MUSIC.POSITION, 0, MAX_SECONDS, { unit: UNIT.SECONDS }));
    add(FEATURES.SHUFFLE, music(TYPE.MUSIC.SHUFFLE, 0, 1));
    add(FEATURES.REPEAT, music(TYPE.MUSIC.REPEAT, 0, 2));
  }

  return {
    name: zoneDeviceName(unit, zone),
    external_id: ids.device,
    model: `Yamaha ${unit.model}`.slice(0, 60),
    should_poll: true,
    poll_frequency: CORE_POLL_FREQUENCY,
    params: [
      { name: 'HOST', value: unit.host },
      { name: 'SYSTEM_ID', value: unit.platformId },
      { name: 'ZONE', value: zone.id },
    ],
    features,
  };
}

/**
 * What a zone plays, or null: its input is a network source, the network
 * module plays that input, and the zone is on.
 */
export function nowPlaying(unit, zoneState, playInfo) {
  if (
    !zoneState?.power ||
    !playInfo ||
    !isNetworkSource(unit, zoneState.input) ||
    playInfo.input !== zoneState.input
  ) {
    return null;
  }
  return playInfo;
}

/**
 * The states of a zone that are not `music` (power, input, sound mode,
 * preset), in the publishStates format.
 * @param {object} ids from zoneIds
 * @param {object} unit
 * @param {object} zone
 * @param {object} zoneState from zoneStateOf
 * @param {number|null} lastPreset the preset last recalled from Gladys on this zone
 */
export function buildZoneStates(ids, unit, zone, zoneState, lastPreset = null) {
  const states = [];
  const label = (key, value) =>
    states.push({ device_feature_external_id: ids.feature(key), text: value || NOTHING });

  if (zone.hasPower) {
    states.push({
      device_feature_external_id: ids.feature(FEATURES.POWER),
      state: zoneState.power ? 1 : 0,
    });
  }
  if (zoneState.input) {
    label(FEATURES.INPUT, zoneState.input);
  }
  if (zone.soundPrograms.length > 0 && zoneState.soundProgram) {
    label(FEATURES.SOUND_PROGRAM, zoneState.soundProgram);
  }
  if (unit.hasNetusb && unit.presetSlots > 0 && lastPreset !== null) {
    label(FEATURES.PRESET, String(lastPreset));
  }
  return states;
}

/**
 * The `music` states of a zone, for publishNowPlaying (which diffs them):
 * volume and mute always, the "now playing" on a device with a network
 * module. A zone that is off or listens to another input (HDMI, tuner) plays
 * nothing: IDLE, the texts and the artwork cleared.
 * @param {object} unit
 * @param {object} zone
 * @param {object} zoneState from zoneStateOf
 * @param {object|null} playInfo from playInfoOf
 */
export function buildNowPlaying(unit, zone, zoneState, playInfo) {
  const values = {};
  const percent = volumeToPercent(zoneState.volume, zone.volume);
  if (zone.volume && percent !== null) {
    values.volume = percent;
  }
  if (zone.hasMute) {
    values.mute = zoneState.mute ? 1 : 0;
  }
  if (!unit.hasNetusb) {
    return values;
  }
  const playing = nowPlaying(unit, zoneState, playInfo);
  if (!playing) {
    return {
      ...values,
      playback_state: MUSIC_PLAYBACK_STATE.IDLE,
      title: '',
      artist: '',
      album: '',
      artwork_url: null,
      duration: 0,
      position: 0,
    };
  }
  const state =
    playing.playback === 'pause'
      ? MUSIC_PLAYBACK_STATE.PAUSED
      : playing.playback === 'stop'
        ? MUSIC_PLAYBACK_STATE.IDLE
        : MUSIC_PLAYBACK_STATE.PLAYING; // play, fast forward / reverse
  // A radio gives its station in `artist` and the song, when it knows it,
  // in `track`, as "Artist - Title": split it, the station as the album
  // (the show the track belongs to); the station is the title until then.
  let { track: title, artist, album } = playing;
  if (playing.input === 'net_radio') {
    const station = playing.artist;
    const dash = title.indexOf(' - ');
    if (!title) {
      [title, artist, album] = [station, '', ''];
    } else if (dash > 0) {
      [artist, title, album] = [title.slice(0, dash), title.slice(dash + 3), station];
    } else {
      [artist, album] = ['', station];
    }
  }
  Object.assign(values, {
    playback_state: state,
    title,
    artist,
    album,
    artwork_url: artworkUrlOf(unit.host, playing),
    duration: playing.totalTime,
    // null: the device does not know it (Spotify Connect: -60000), the hub
    // counts it (src/hub.js, positionOf).
    position: state === MUSIC_PLAYBACK_STATE.IDLE ? 0 : playing.playTime,
  });
  if (playing.shuffle !== null) {
    values.shuffle = playing.shuffle === 'off' ? 0 : 1;
  }
  if (REPEAT_MODES[playing.repeat] !== undefined) {
    values.repeat = REPEAT_MODES[playing.repeat];
  }
  return values;
}

/** The feature key of one of our feature external_ids, or null. */
export function featureKeyOf(deviceExternalId, featureExternalId) {
  const prefix = `${deviceExternalId}:`;
  return featureExternalId?.startsWith(prefix) ? featureExternalId.slice(prefix.length) : null;
}
