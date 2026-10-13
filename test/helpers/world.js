// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys, a simulated network of
// MusicCast devices answering from the fixtures (and changing state on the
// commands they receive), a manual clock, and the integration wired on top
// through registerHandlers. Nothing touches the network.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';

process.env.LOG_LEVEL ??= 'silent';

const read = (path) => readFileSync(new URL(`../fixtures/${path}`, import.meta.url), 'utf8');
const json = (path) => JSON.parse(read(path));

/** Raw answers of the core to an SSDP scan (anonymized addresses). */
export const SSDP_RESULTS = json('ssdp-results.json');

export const RECEIVER = '192.0.2.40';
export const SPEAKER = '192.0.2.41';

/** UPnP descriptions served on the network, by URL. */
export const DESCRIPTIONS = {
  [`http://${RECEIVER}:49154/MediaRenderer/desc.xml`]: read('upnp/receiver.xml'),
  [`http://${SPEAKER}:49154/MediaRenderer/desc.xml`]: read('upnp/speaker.xml'),
  'http://192.0.2.30:1400/xml/device_description.xml': read('upnp/other-renderer.xml'),
};

/** The answers of one fixture device, as a mutable state. */
export function loadDevice(name) {
  const file = (path) => json(`musiccast/${name}/${path}.json`);
  const features = file('system_getFeatures');
  const zones = {};
  for (const zone of features.zone) {
    zones[zone.id] = file(`${zone.id}_getStatus`);
  }
  return {
    deviceInfo: file('system_getDeviceInfo'),
    network: file('system_getNetworkStatus'),
    features,
    names: file('system_getNameText'),
    zones,
    playInfo: file('netusb_getPlayInfo'),
    presets: file('netusb_getPresetInfo'),
  };
}

const ok = (body) => ({ ok: true, status: 200, text: async () => JSON.stringify(body) });
const refused = (code) => ok({ response_code: code });

/**
 * A simulated LAN: `devices[address] = name of a fixture directory`.
 * `network.offline.add(address)` makes a device stop answering.
 */
export function createNetwork(devices = { [RECEIVER]: 'receiver', [SPEAKER]: 'speaker' }) {
  const network = {
    devices: Object.fromEntries(
      Object.entries(devices).map(([address, name]) => [address, loadDevice(name)]),
    ),
    offline: new Set(),
    requests: [],
    /** Commands (set*, recall*) received, as "address path?query". */
    get commands() {
      return network.requests.filter((r) => /\/(set|recall)/.test(r));
    },
    async fetch(url) {
      const parsed = new URL(url);
      const address = parsed.hostname;
      if (network.offline.has(address)) {
        throw new TypeError('fetch failed');
      }
      if (DESCRIPTIONS[url] !== undefined && !network.offline.has(address)) {
        return { ok: true, status: 200, text: async () => DESCRIPTIONS[url] };
      }
      const device = network.devices[address];
      const prefix = '/YamahaExtendedControl/v1/';
      if (!device || !parsed.pathname.startsWith(prefix)) {
        throw new TypeError('fetch failed');
      }
      const path = parsed.pathname.slice(prefix.length);
      network.requests.push(`${address} ${path}${parsed.search}`);
      return answer(device, path, Object.fromEntries(parsed.searchParams));
    },
  };
  return network;
}

function answer(device, path, query) {
  const [group, method] = path.split('/');
  const zone = device.zones[group];
  const netusbInputs = new Set(
    device.features.system.input_list.filter((i) => i.play_info_type === 'netusb').map((i) => i.id),
  );
  switch (path) {
    case 'system/getDeviceInfo':
      return ok(device.deviceInfo);
    case 'system/getNetworkStatus':
      return ok(device.network);
    case 'system/getFeatures':
      return ok(device.features);
    case 'system/getNameText':
      return ok(device.names);
    case 'netusb/getPlayInfo':
      return ok(device.playInfo);
    case 'netusb/getPresetInfo':
      return ok(device.presets);
    case 'netusb/setPlayback': {
      const { playback } = query;
      if (playback === 'pause' && device.playInfo.input === 'net_radio') {
        return refused(3); // a live radio has no pause
      }
      if (playback === 'next' || playback === 'previous') {
        device.playInfo.track = `${playback} track`;
        device.playInfo.playback = 'play';
      } else {
        device.playInfo.playback = playback;
      }
      return ok({ response_code: 0 });
    }
    case 'netusb/recallPreset': {
      const preset = device.presets.preset_info[Number(query.num) - 1];
      const target = device.zones[query.zone];
      if (!preset || preset.input === 'unknown' || !target) {
        return refused(4);
      }
      target.power = 'on';
      target.input = preset.input;
      Object.assign(device.playInfo, {
        input: preset.input,
        playback: 'play',
        track: preset.text,
        artist: '',
        album: '',
      });
      return ok({ response_code: 0 });
    }
    default:
      break;
  }
  if (!zone) {
    return refused(3);
  }
  switch (method) {
    case 'getStatus':
      return ok(zone);
    case 'setPower':
      zone.power = query.power === 'on' ? 'on' : 'standby';
      return ok({ response_code: 0 });
    case 'setVolume':
      if (zone.power !== 'on') {
        return refused(5); // guarded in standby
      }
      zone.volume = Number(query.volume);
      return ok({ response_code: 0 });
    case 'setMute':
      zone.mute = query.enable === 'true';
      return ok({ response_code: 0 });
    case 'setInput':
      zone.input = query.input;
      if (netusbInputs.has(query.input)) {
        device.playInfo.input = query.input;
      }
      return ok({ response_code: 0 });
    case 'setSoundProgram':
      zone.sound_program = query.program;
      return ok({ response_code: 0 });
    default:
      return refused(3);
  }
}

/** A manual clock. */
export function createClock(start = 1_700_000_000_000) {
  const clock = {
    time: start,
    now: () => clock.time,
    advance(ms) {
      clock.time += ms;
    },
  };
  return clock;
}

/**
 * @param {object} [options]
 * @param {object} [options.config] raw integration config
 * @param {object} [options.network] from createNetwork
 * @param {Array} [options.devices] devices already created in Gladys
 * @param {Array|null} [options.ssdp] raw SSDP results, null: no capture declared
 * @param {boolean} [options.connect]
 * @param {boolean} [options.timers] the hub's own ticker runs (use mock timers)
 */
export async function createWorld({
  config = {},
  network = createNetwork(),
  devices = [],
  ssdp = SSDP_RESULTS,
  connect = true,
  timers = false,
} = {}) {
  const gladys = createFakeGladys({
    config,
    devices,
    scanResults: ssdp === null ? {} : { ssdp },
  });
  const clock = createClock();
  const app = registerHandlers(gladys, { fetch: network.fetch, timers, now: clock.now });
  if (connect) {
    await gladys.connect();
    await app.ready;
  }
  return { gladys, fake: gladys.fake, app, hub: app.hub, network, clock };
}

/** The discovered device whose name is `name`. */
export const discovered = (world, name) =>
  world.fake.discoveredDevices.find((device) => device.name === name);

/** Add a discovered zone to Gladys, as the user would. */
export async function create(world, name) {
  const device = discovered(world, name);
  if (!device) {
    throw new Error(`${name} is not in the discovered devices`);
  }
  await world.fake.deviceCreated(device);
  return device;
}

/** External id of one feature of a device. */
export const featureId = (device, key) =>
  device.features.find((feature) => feature.external_id === `${device.external_id}:${key}`)
    ?.external_id;

/** The last state Gladys received for a feature of a device. */
export const lastState = (world, device, key) => world.fake.lastState(featureId(device, key));

/** Move the clock forward and run one beat of the hub's ticker. */
export async function tick(world, ms) {
  world.clock.advance(ms);
  await world.hub.tick();
}

/**
 * Capture the integration's log lines at `level` and above (LOG_LEVEL is read
 * at every call). Returns the lines as `{ level, text }`.
 */
export function captureLogs(t, level = 'info') {
  const previous = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = level;
  const lines = [];
  const record = (...args) => {
    const text = args.map((arg) => (arg instanceof Error ? arg.message : String(arg))).join(' ');
    const match = /^\[[^\]]+\] \[(\w+)\]/.exec(text);
    lines.push({ level: match ? match[1].toLowerCase() : 'raw', text });
  };
  t.mock.method(console, 'log', record);
  t.mock.method(console, 'error', record);
  t.after(() => {
    process.env.LOG_LEVEL = previous;
  });
  return lines;
}
