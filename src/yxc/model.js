// -----------------------------------------------------------------------------
// What a MusicCast device is, read from its answers: pure functions, no
// network, tested on fixtures (test/fixtures/musiccast/).
//
// - getDeviceInfo: model, `system_id` (the stable identity, the one Home
//   Assistant keys its devices on), `device_id` (a MAC address);
// - getNetworkStatus: `network_name`, the name given in the MusicCast app;
// - getFeatures: the zones (main, zone2, zone3, zone4), their functions
//   (`func_list`), inputs, sound programs and volume range (`range_step`),
//   the inputs of the device with their `play_info_type` (`netusb` for the
//   network sources whose title the device reports), the preset slots;
// - getNameText: the names of the zones, inputs and sound programs, as the
//   user renamed them on the device.
// -----------------------------------------------------------------------------

export const ZONE_IDS = ['main', 'zone2', 'zone3', 'zone4'];

// Inputs that only exist for the multiroom link: shown when a zone follows a
// group, never offered in the input list (selecting them alone does nothing).
export const LINK_INPUTS = ['mc_link', 'main_sync'];

const MAX_TEXT = 200;

/** A text received from the device: no control character, trimmed, bounded. */
export function cleanText(value, max = MAX_TEXT) {
  if (typeof value !== 'string') {
    return '';
  }
  return value
    .replace(/[\p{Cc}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/** The platform id of a device: its system_id, else its device_id, upper-case hex. */
export function platformIdOf(deviceInfo) {
  for (const key of ['system_id', 'device_id']) {
    const value = String(deviceInfo?.[key] ?? '')
      .replace(/[^0-9a-z]/gi, '')
      .toUpperCase();
    if (value.length >= 4) {
      return value.slice(0, 32);
    }
  }
  return null;
}

// A readable name for an input or a program the device does not name.
const KNOWN_LABELS = {
  net_radio: 'Net Radio',
  server: 'Server',
  usb: 'USB',
  bluetooth: 'Bluetooth',
  airplay: 'AirPlay',
  spotify: 'Spotify',
  tidal: 'TIDAL',
  deezer: 'Deezer',
  qobuz: 'Qobuz',
  napster: 'Napster',
  pandora: 'Pandora',
  siriusxm: 'SiriusXM',
  amazon_music: 'Amazon Music',
  alexa: 'Alexa',
  tuner: 'Tuner',
  mc_link: 'MusicCast Link',
  main_sync: 'Main Zone Sync',
  tv: 'TV',
  cd: 'CD',
  phono: 'Phono',
  aux: 'AUX',
  optical: 'Optical',
  coaxial: 'Coaxial',
};

/** `hdmi1` → `HDMI1`, `audio_2` → `Audio 2`, `net_radio` → `Net Radio`. */
export function prettyId(id) {
  if (KNOWN_LABELS[id]) {
    return KNOWN_LABELS[id];
  }
  if (/^(hdmi|av)\d*$/i.test(id)) {
    return id.toUpperCase();
  }
  return String(id)
    .split(/[_-]+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(' ');
}

const namesById = (list) =>
  new Map(
    (Array.isArray(list) ? list : [])
      .filter((entry) => typeof entry?.id === 'string')
      .map((entry) => [entry.id, cleanText(entry.text, 60)]),
  );

const rangeOf = (zone, id) => {
  const range = (zone.range_step ?? []).find((entry) => entry?.id === id);
  if (
    !range ||
    !Number.isFinite(range.min) ||
    !Number.isFinite(range.max) ||
    range.max <= range.min
  ) {
    return null;
  }
  const step = Number.isFinite(range.step) && range.step > 0 ? range.step : 1;
  return { min: range.min, max: range.max, step };
};

/**
 * The model of one MusicCast device.
 * @param {{ deviceInfo: object, network?: object, features: object, names?: object }} answers
 */
export function describeUnit({ deviceInfo, network = {}, features, names = {} }) {
  const platformId = platformIdOf(deviceInfo);
  if (!platformId) {
    throw new Error('the device has neither system_id nor device_id');
  }
  const model = cleanText(deviceInfo.model_name, 40) || 'MusicCast';
  const inputNames = namesById(names.input_list);
  const zoneNames = namesById(names.zone_list);
  const programNames = namesById(names.sound_program_list);

  const inputs = new Map();
  for (const input of features?.system?.input_list ?? []) {
    if (typeof input?.id !== 'string') {
      continue;
    }
    inputs.set(input.id, {
      id: input.id,
      name: inputNames.get(input.id) || prettyId(input.id),
      playInfoType: typeof input.play_info_type === 'string' ? input.play_info_type : 'none',
    });
  }

  const zones = [];
  for (const zone of features?.zone ?? []) {
    if (!ZONE_IDS.includes(zone?.id)) {
      continue;
    }
    const funcs = new Set(Array.isArray(zone.func_list) ? zone.func_list : []);
    const zoneInputs = (Array.isArray(zone.input_list) ? zone.input_list : []).filter(
      (id) => typeof id === 'string',
    );
    for (const id of zoneInputs) {
      if (!inputs.has(id)) {
        inputs.set(id, { id, name: inputNames.get(id) || prettyId(id), playInfoType: 'none' });
      }
    }
    const programs = funcs.has('sound_program')
      ? (Array.isArray(zone.sound_program_list) ? zone.sound_program_list : [])
          .filter((id) => typeof id === 'string')
          .map((id) => ({ id, name: programNames.get(id) || prettyId(id) }))
      : [];
    const volume = funcs.has('volume') ? rangeOf(zone, 'volume') : null;
    zones.push({
      id: zone.id,
      name: zoneNames.get(zone.id) || (zone.id === 'main' ? 'Main' : prettyId(zone.id)),
      hasPower: funcs.has('power'),
      volume,
      hasMute: funcs.has('mute'),
      inputs: zoneInputs,
      soundPrograms: programs,
    });
  }
  if (zones.length === 0) {
    throw new Error('the device declares no zone');
  }

  const netusb = features?.netusb;
  const presetSlots = Number.isInteger(netusb?.preset?.num) ? Math.min(netusb.preset.num, 99) : 0;
  return {
    platformId,
    model,
    name: cleanText(network.network_name, 60) || model,
    deviceId: cleanText(deviceInfo.device_id, 32) || null,
    firmware: cleanText(String(deviceInfo.system_version ?? ''), 16) || null,
    apiVersion: Number.isFinite(deviceInfo.api_version) ? deviceInfo.api_version : null,
    hasNetusb: Boolean(netusb) || [...inputs.values()].some((i) => i.playInfoType === 'netusb'),
    presetSlots: netusb ? presetSlots : 0,
    inputs,
    zones,
  };
}

/** True when the input's title and playback are reported by netusb/getPlayInfo. */
export function isNetworkSource(unit, inputId) {
  return unit.inputs.get(inputId)?.playInfoType === 'netusb';
}

/** Raw device volume → percent (0-100), the scale of the Gladys music widget. */
export function volumeToPercent(raw, range) {
  if (!range || !Number.isFinite(raw)) {
    return null;
  }
  const ratio = (raw - range.min) / (range.max - range.min);
  return Math.round(Math.min(1, Math.max(0, ratio)) * 100);
}

/** Percent → raw device volume, on the device's step. */
export function percentToVolume(percent, range) {
  const ratio = Math.min(100, Math.max(0, Number(percent))) / 100;
  const steps = Math.round((ratio * (range.max - range.min)) / range.step);
  const raw = range.min + steps * range.step;
  // Avoid 80.00000000001 on a 0.5 step.
  return Math.min(range.max, Math.round(raw * 1000) / 1000);
}

/** The state of a zone, from {zone}/getStatus. */
export function zoneStateOf(status) {
  return {
    power: status?.power === 'on',
    volume: Number.isFinite(status?.volume) ? status.volume : null,
    mute: status?.mute === true,
    input: typeof status?.input === 'string' ? status.input : null,
    soundProgram: typeof status?.sound_program === 'string' ? status.sound_program : null,
  };
}

/** What the network module plays, from netusb/getPlayInfo. */
export function playInfoOf(info) {
  return {
    input: typeof info?.input === 'string' ? info.input : null,
    playing: info?.playback === 'play',
    playback: typeof info?.playback === 'string' ? info.playback : 'stop',
    track: cleanText(info?.track),
    artist: cleanText(info?.artist),
    album: cleanText(info?.album),
  };
}

/**
 * The stored presets, from netusb/getPresetInfo: `[{ num, input, name }]`,
 * numbered from 1 like on the remote, empty slots left out.
 */
export function presetsOf(info, unit) {
  const presets = [];
  (Array.isArray(info?.preset_info) ? info.preset_info : []).forEach((entry, index) => {
    const input = typeof entry?.input === 'string' ? entry.input : 'unknown';
    const name = cleanText(entry?.text, 60);
    if (input === 'unknown' || input === '' || !name) {
      return;
    }
    presets.push({
      num: index + 1,
      input,
      name,
      inputName: unit?.inputs.get(input)?.name ?? prettyId(input),
    });
  });
  return presets;
}
