// -----------------------------------------------------------------------------
// One Gladys device per zone of a MusicCast device (main, zone2...): what the
// user powers, turns up and switches input independently.
//
// Couples chosen among those the Gladys front knows (test/gladys-rules.test.js):
// - power, mute: switch/binary, a toggle with its state (the television
//   "mute" is a push button that cannot show whether the sound is cut);
// - volume, play, pause, previous, next, playback_state: the `music`
//   category, the one the core's "Music" dashboard box reads (it needs the
//   six of them, with a 0-100 volume slider), like gladys-dlna. The volume is
//   therefore published in percent of the zone's range, not in raw steps;
// - input, sound mode, preset: text/select, the dynamic select of Gladys 5.2
//   whose options the integration declares per device (`supported_options`,
//   string values: the input ids of the device, `hdmi1`, `spotify`...);
// - title, artist, album: text/text (three of them: the dashboard shows
//   their names).
//
// The playback features exist only on a device with a network module
// (`netusb`), shared by all its zones. Feature keys are part of the external
// ids: frozen once published.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as CAT,
  DEVICE_FEATURE_TYPES as TYPE,
  DEVICE_FEATURE_UNITS as UNIT,
  DEVICE_POLL_FREQUENCIES,
} from '@gladysassistant/integration-sdk';
import { NAMES } from './i18n.js';
import { isNetworkSource, volumeToPercent } from './yxc/model.js';

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
};

// The playback buttons and the netusb command each one sends.
export const PLAYBACK_COMMANDS = {
  [FEATURES.PLAY]: 'play',
  [FEATURES.PAUSE]: 'pause',
  [FEATURES.PREVIOUS]: 'previous',
  [FEATURES.NEXT]: 'next',
};

// MUSIC_PLAYBACK_STATE of the core: 1 playing, 0 anything else.
export const PLAYBACK_STATE = { PLAYING: 1, NOT_PLAYING: 0 };

// A text state is never empty, or the core ignores it.
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
const text = { category: CAT.TEXT, type: TYPE.TEXT.TEXT, min: 0, max: 0, read_only: true };
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
    add(FEATURES.MUTE, toggle);
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
    add(FEATURES.PLAYBACK_STATE, {
      category: CAT.MUSIC,
      type: TYPE.MUSIC.PLAYBACK_STATE,
      min: 0,
      max: 1,
      read_only: true,
      has_feedback: false,
      keep_history: true,
    });
    add(FEATURES.TITLE, text);
    add(FEATURES.ARTIST, text);
    add(FEATURES.ALBUM, text);
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
 * The feature states of a zone, in the publishStates format.
 * @param {object} ids from zoneIds
 * @param {object} unit
 * @param {object} zone
 * @param {object} zoneState from zoneStateOf
 * @param {object|null} playInfo from playInfoOf (null without netusb)
 * @param {number|null} lastPreset the preset last recalled from Gladys on this zone
 */
export function buildZoneStates(ids, unit, zone, zoneState, playInfo, lastPreset = null) {
  const states = [];
  const number = (key, state) =>
    states.push({ device_feature_external_id: ids.feature(key), state });
  const label = (key, value) =>
    states.push({ device_feature_external_id: ids.feature(key), text: value || NOTHING });

  if (zone.hasPower) {
    number(FEATURES.POWER, zoneState.power ? 1 : 0);
  }
  const percent = volumeToPercent(zoneState.volume, zone.volume);
  if (zone.volume && percent !== null) {
    number(FEATURES.VOLUME, percent);
  }
  if (zone.hasMute) {
    number(FEATURES.MUTE, zoneState.mute ? 1 : 0);
  }
  if (zoneState.input) {
    label(FEATURES.INPUT, zoneState.input);
  }
  if (zone.soundPrograms.length > 0 && zoneState.soundProgram) {
    label(FEATURES.SOUND_PROGRAM, zoneState.soundProgram);
  }
  if (unit.hasNetusb) {
    if (unit.presetSlots > 0 && lastPreset !== null) {
      label(FEATURES.PRESET, String(lastPreset));
    }
    const playing = nowPlaying(unit, zoneState, playInfo);
    number(
      FEATURES.PLAYBACK_STATE,
      playing?.playing ? PLAYBACK_STATE.PLAYING : PLAYBACK_STATE.NOT_PLAYING,
    );
    label(FEATURES.TITLE, playing?.track);
    label(FEATURES.ARTIST, playing?.artist);
    label(FEATURES.ALBUM, playing?.album);
  }
  return states;
}

/** The feature key of one of our feature external_ids, or null. */
export function featureKeyOf(deviceExternalId, featureExternalId) {
  const prefix = `${deviceExternalId}:`;
  return featureExternalId?.startsWith(prefix) ? featureExternalId.slice(prefix.length) : null;
}
