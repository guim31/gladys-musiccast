// -----------------------------------------------------------------------------
// What the integration reads in the answers of a MusicCast device, and how the
// YXC client handles the device's refusals and silences.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadDevice } from './helpers/world.js';
import { UnreachableError, YxcError, baseUrl, createClient } from '../src/yxc/client.js';
import {
  cleanText,
  describeUnit,
  isNetworkSource,
  percentToVolume,
  platformIdOf,
  playInfoOf,
  presetsOf,
  prettyId,
  volumeToPercent,
  zoneStateOf,
} from '../src/yxc/model.js';

const unitOf = (name) => {
  const device = loadDevice(name);
  return describeUnit(device);
};

test('a receiver: identity, zones, inputs named by the user, sound programs, volume range', () => {
  const unit = unitOf('receiver');
  assert.equal(unit.platformId, '0B000001');
  assert.equal(unit.model, 'RX-V6A');
  assert.equal(unit.name, 'Salon');
  assert.equal(unit.hasNetusb, true);
  assert.equal(unit.presetSlots, 40);
  assert.deepEqual(
    unit.zones.map((zone) => [zone.id, zone.name]),
    [
      ['main', 'Main'],
      ['zone2', 'Cuisine'],
    ],
  );
  const [main, zone2] = unit.zones;
  assert.deepEqual(main.volume, { min: 0, max: 161, step: 1 });
  assert.equal(main.hasPower, true);
  assert.equal(main.hasMute, true);
  assert.equal(main.inputs.length, 19);
  assert.equal(unit.inputs.get('hdmi1').name, 'Apple TV');
  assert.equal(unit.inputs.get('spotify').playInfoType, 'netusb');
  assert.equal(unit.inputs.get('tuner').playInfoType, 'tuner');
  assert.equal(main.soundPrograms.length, 20);
  assert.deepEqual(main.soundPrograms[0], { id: 'munich', name: 'Hall in Munich' });
  // Zone 2 has no HDMI and no sound program.
  assert.ok(!zone2.inputs.includes('hdmi1'));
  assert.deepEqual(zone2.soundPrograms, []);
});

test('a speaker: one zone, 0-60 volume, no sound program', () => {
  const unit = unitOf('speaker');
  assert.equal(unit.platformId, '0B000010');
  assert.equal(unit.name, 'Chambre');
  assert.equal(unit.zones.length, 1);
  assert.deepEqual(unit.zones[0].volume, { min: 0, max: 60, step: 1 });
  assert.deepEqual(unit.zones[0].soundPrograms, []);
});

test('a device without network name or names keeps readable defaults', () => {
  const device = loadDevice('receiver');
  const unit = describeUnit({ deviceInfo: device.deviceInfo, features: device.features });
  assert.equal(unit.name, 'RX-V6A');
  assert.equal(unit.zones[1].name, 'Zone2');
  assert.equal(unit.inputs.get('hdmi1').name, 'HDMI1');
  assert.equal(unit.inputs.get('net_radio').name, 'Net Radio');
  assert.equal(unit.zones[0].soundPrograms[0].name, 'Munich');
});

test('the platform id comes from system_id, else device_id; none is an error', () => {
  assert.equal(platformIdOf({ system_id: '0b5870a3' }), '0B5870A3');
  assert.equal(platformIdOf({ device_id: 'ac:44:f2:00:00:01' }), 'AC44F2000001');
  assert.equal(platformIdOf({}), null);
  assert.throws(() => describeUnit({ deviceInfo: {}, features: {} }), /system_id/);
  assert.throws(
    () => describeUnit({ deviceInfo: { system_id: '0B000001' }, features: { zone: [] } }),
    /no zone/,
  );
});

test('the volume is published in percent of the zone range, and set back on its step', () => {
  const range = { min: 0, max: 161, step: 1 };
  assert.equal(volumeToPercent(81, range), 50);
  assert.equal(volumeToPercent(0, range), 0);
  assert.equal(volumeToPercent(161, range), 100);
  assert.equal(volumeToPercent(200, range), 100);
  assert.equal(volumeToPercent(null, range), null);
  assert.equal(percentToVolume(50, range), 81);
  assert.equal(percentToVolume(100, range), 161);
  assert.equal(percentToVolume(-5, range), 0);
  const halfSteps = { min: -80.5, max: 16.5, step: 0.5 };
  assert.equal(percentToVolume(50, halfSteps), -32);
  assert.equal(percentToVolume(33, halfSteps), -48.5);
  // Round trip within one percent on a speaker's 0-60 range.
  const speaker = { min: 0, max: 60, step: 1 };
  for (let percent = 0; percent <= 100; percent += 1) {
    const back = volumeToPercent(percentToVolume(percent, speaker), speaker);
    assert.ok(Math.abs(back - percent) <= 1, `${percent} → ${back}`);
  }
});

test('zone status and play info are read defensively', () => {
  const device = loadDevice('receiver');
  assert.deepEqual(zoneStateOf(device.zones.main), {
    power: true,
    volume: 81,
    mute: false,
    input: 'spotify',
    soundProgram: 'straight',
  });
  assert.deepEqual(zoneStateOf({}), {
    power: false,
    volume: null,
    mute: false,
    input: null,
    soundProgram: null,
  });
  const info = playInfoOf(device.playInfo);
  assert.equal(info.playing, true);
  assert.equal(info.track, 'Chanson d’essai');
  assert.equal(playInfoOf({ playback: 'pause', track: 'A\u0000\tB  ' }).track, 'A B');
  assert.equal(cleanText('x'.repeat(300)).length, 200);
  const unit = describeUnit(device);
  assert.equal(isNetworkSource(unit, 'spotify'), true);
  assert.equal(isNetworkSource(unit, 'hdmi1'), false);
});

test('presets are numbered from 1, empty slots left out', () => {
  const device = loadDevice('receiver');
  const unit = describeUnit(device);
  assert.deepEqual(presetsOf(device.presets, unit), [
    { num: 1, input: 'net_radio', name: 'Radio Exemple', inputName: 'Net Radio' },
    { num: 2, input: 'spotify', name: 'Morning playlist', inputName: 'Spotify' },
    { num: 4, input: 'server', name: 'Jazz (NAS)', inputName: 'Server' },
  ]);
  assert.deepEqual(presetsOf(loadDevice('speaker').presets, unit), []);
  assert.deepEqual(presetsOf({}, unit), []);
});

test('unknown ids get a readable name', () => {
  assert.equal(prettyId('hdmi3'), 'HDMI3');
  assert.equal(prettyId('audio_2'), 'Audio 2');
  assert.equal(prettyId('amazon_music'), 'Amazon Music');
});

// --- Client -------------------------------------------------------------------

const respond = (body, { status = 200 } = {}) => ({
  ok: status === 200,
  status,
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});

test('the client builds the YXC URLs and parameters', async () => {
  const urls = [];
  const client = createClient('192.0.2.40', {
    fetch: async (url) => {
      urls.push(url);
      return respond({ response_code: 0 });
    },
  });
  await client.setVolume('main', 81);
  await client.setMute('zone2', true);
  await client.setInput('main', 'hdmi1');
  await client.recallPreset('main', 3);
  await client.setPlayback('next');
  assert.deepEqual(urls, [
    'http://192.0.2.40/YamahaExtendedControl/v1/main/setVolume?volume=81',
    'http://192.0.2.40/YamahaExtendedControl/v1/zone2/setMute?enable=true',
    'http://192.0.2.40/YamahaExtendedControl/v1/main/setInput?input=hdmi1',
    'http://192.0.2.40/YamahaExtendedControl/v1/netusb/recallPreset?zone=main&num=3',
    'http://192.0.2.40/YamahaExtendedControl/v1/netusb/setPlayback?playback=next',
  ]);
  assert.equal(baseUrl('fd00::40'), 'http://[fd00::40]/YamahaExtendedControl/v1');
});

test('a non-zero response_code is a refusal, a silence or a foreign answer is unreachable', async () => {
  const answering = (body, options) =>
    createClient('192.0.2.40', { fetch: async () => respond(body, options) });
  await assert.rejects(answering({ response_code: 5 }).setPower('main', true), (err) => {
    assert.ok(err instanceof YxcError);
    assert.equal(err.code, 5);
    assert.match(err.message, /guarded/);
    return true;
  });
  await assert.rejects(answering('<html>').deviceInfo(), UnreachableError);
  await assert.rejects(answering({ hello: 1 }).deviceInfo(), UnreachableError);
  await assert.rejects(answering({}, { status: 404 }).deviceInfo(), /HTTP 404/);
  await assert.rejects(answering('x'.repeat(600 * 1024)).deviceInfo(), /oversized/);
  const silent = createClient('192.0.2.99', {
    fetch: async () => {
      throw new TypeError('fetch failed');
    },
  });
  await assert.rejects(silent.deviceInfo(), /192\.0\.2\.99 did not answer/);
  const slow = createClient('192.0.2.98', {
    fetch: async () => {
      throw new DOMException('timeout', 'TimeoutError');
    },
  });
  await assert.rejects(slow.deviceInfo(), /timed out/);
});
