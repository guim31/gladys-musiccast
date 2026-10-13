// -----------------------------------------------------------------------------
// A zone added to Gladys: its states, its commands, and its refresh by the
// container's own ticker (the core's poll is only a fallback, Gladys#3198).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RECEIVER,
  SPEAKER,
  create,
  createWorld,
  featureId,
  lastState,
  tick,
} from './helpers/world.js';
import { HEARTBEAT_MS } from '../src/hub.js';
import { NOTHING } from '../src/devices.js';

const setValue = (world, device, key, value) =>
  world.fake.setValue(
    device,
    device.features.find((f) => f.external_id === featureId(device, key)),
    value,
  );

test('the states of a playing zone and of a zone in standby', async () => {
  const world = await createWorld();
  const salon = await create(world, 'Salon');
  const cuisine = await create(world, 'Salon Cuisine');
  assert.equal(lastState(world, salon, 'power'), 1);
  assert.equal(lastState(world, salon, 'volume'), 50); // 81 of 0-161
  assert.equal(lastState(world, salon, 'mute'), 0);
  assert.equal(lastState(world, salon, 'input'), 'spotify');
  assert.equal(lastState(world, salon, 'sound_program'), 'straight');
  assert.equal(lastState(world, salon, 'playback_state'), 1);
  assert.equal(lastState(world, salon, 'title'), 'Chanson d’essai');
  assert.equal(lastState(world, salon, 'artist'), 'Les Exemples');
  assert.equal(lastState(world, salon, 'album'), 'Album de test');
  assert.equal(lastState(world, salon, 'preset'), undefined, 'no preset recalled yet');

  // Zone 2 is in standby on the tuner: nothing plays there.
  assert.equal(lastState(world, cuisine, 'power'), 0);
  assert.equal(lastState(world, cuisine, 'input'), 'tuner');
  assert.equal(lastState(world, cuisine, 'playback_state'), 0);
  assert.equal(lastState(world, cuisine, 'title'), NOTHING);
  world.app.stop();
});

test('the selects carry the options of the device', async () => {
  const world = await createWorld();
  const salon = world.fake.discoveredDevices.find((d) => d.name === 'Salon');
  const options = (key) =>
    salon.features.find((f) => f.external_id === featureId(salon, key)).supported_options;
  assert.deepEqual(options('input').slice(1, 4), [
    { value: 'tuner', label: 'Tuner', sort_order: 1 },
    { value: 'hdmi1', label: 'Apple TV', sort_order: 2 },
    { value: 'hdmi2', label: 'Console', sort_order: 3 },
  ]);
  assert.equal(options('sound_program').length, 20);
  assert.deepEqual(
    options('preset').map((o) => o.label),
    ['1. Radio Exemple', '2. Morning playlist', '4. Jazz (NAS)'],
  );
  world.app.stop();
});

test('nothing is read for a device none of whose zones is added', async () => {
  const world = await createWorld();
  const before = world.network.requests.filter((r) => r.includes('getStatus')).length;
  await tick(world, 60_000);
  assert.equal(world.network.requests.filter((r) => r.includes('getStatus')).length, before);
  assert.equal(before, 0);
  world.app.stop();
});

test('the ticker refreshes the states without any onPoll from the core', async () => {
  const world = await createWorld();
  const salon = await create(world, 'Salon');
  const pollsFromCore = world.fake.wsMessages.filter((m) => m.type === 'device.poll').length;

  const device = world.network.devices[RECEIVER];
  device.zones.main.volume = 161;
  device.playInfo.track = 'Deuxième titre';

  // Not yet: the refresh interval (5 s) is not over.
  await tick(world, 2000);
  assert.equal(lastState(world, salon, 'volume'), 50);
  await tick(world, 3000);
  assert.equal(lastState(world, salon, 'volume'), 100);
  assert.equal(lastState(world, salon, 'title'), 'Deuxième titre');
  assert.equal(world.fake.wsMessages.filter((m) => m.type === 'device.poll').length, pollsFromCore);
  world.app.stop();
});

test('in standby the device is read every 30 seconds, and a playing one every refresh_interval', async () => {
  const world = await createWorld({ config: { refresh_interval: '10' } });
  await create(world, 'Chambre'); // in standby
  const reads = () =>
    world.network.requests.filter((r) => r.startsWith(`${SPEAKER} main/getStatus`)).length;
  const start = reads();
  await tick(world, 10_000);
  assert.equal(reads(), start);
  await tick(world, 20_000);
  assert.equal(reads(), start + 1);

  world.network.devices[SPEAKER].zones.main.power = 'on';
  await tick(world, 30_000);
  assert.equal(reads(), start + 2);
  await tick(world, 10_000);
  assert.equal(reads(), start + 3, 'on: every 10 s');
  // The play info is read only while a zone listens to a network source.
  assert.ok(world.network.requests.some((r) => r.startsWith(`${SPEAKER} netusb/getPlayInfo`)));
  world.app.stop();
});

test('the real ticker runs on its own (mock timers)', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const world = await createWorld({ timers: true });
  const salon = await create(world, 'Salon');
  world.network.devices[RECEIVER].zones.main.mute = true;
  world.clock.advance(5000);
  t.mock.timers.tick(1000);
  // Let the asynchronous read finish.
  for (let i = 0; i < 20 && lastState(world, salon, 'mute') !== 1; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(lastState(world, salon, 'mute'), 1);
  world.app.stop();
});

test("the core's onPoll is a fallback: skipped right after a read, done when the ticker stalls", async () => {
  const world = await createWorld();
  const salon = await create(world, 'Salon');
  const reads = () => world.network.requests.filter((r) => r.includes('main/getStatus')).length;
  const start = reads();
  assert.deepEqual(await world.fake.poll(salon), { success: true });
  assert.equal(reads(), start, 'just read: skipped');
  world.clock.advance(16_000); // the ticker did not run
  await world.fake.poll(salon);
  assert.equal(reads(), start + 1);
  world.app.stop();
});

test('only the changes are published, and a heartbeat every 6 hours', async (t) => {
  // The SDK dates the heartbeat with Date.now(): move it with the manual clock.
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const world = await createWorld();
  const salon = await create(world, 'Salon');
  const step = async (ms) => {
    t.mock.timers.tick(ms);
    await tick(world, ms);
  };
  const count = () => world.fake.states.length;
  const start = count();
  await step(5000);
  assert.equal(count(), start, 'nothing changed, nothing sent');
  for (let elapsed = 5000; elapsed < HEARTBEAT_MS; elapsed += 5 * 60 * 1000) {
    await step(5 * 60 * 1000);
  }
  await step(5000);
  assert.ok(count() > start, 'the unchanged values are sent again');
  assert.equal(lastState(world, salon, 'power'), 1);
  world.app.stop();
});

test('power, volume, mute, input and sound mode commands reach the device and come back', async () => {
  const world = await createWorld();
  const cuisine = await create(world, 'Salon Cuisine');
  const salon = await create(world, 'Salon');

  assert.deepEqual(await setValue(world, cuisine, 'power', 1), { success: true });
  assert.equal(lastState(world, cuisine, 'power'), 1);
  await setValue(world, cuisine, 'volume', 25);
  assert.ok(world.network.commands.includes(`${RECEIVER} zone2/setVolume?volume=40`));
  assert.equal(lastState(world, cuisine, 'volume'), 25);
  await setValue(world, salon, 'mute', 1);
  assert.equal(lastState(world, salon, 'mute'), 1);
  await setValue(world, salon, 'input', 'hdmi1');
  assert.equal(lastState(world, salon, 'input'), 'hdmi1');
  assert.equal(lastState(world, salon, 'title'), NOTHING, 'HDMI is not a network source');
  assert.equal(lastState(world, salon, 'playback_state'), 0);
  await setValue(world, salon, 'sound_program', 'drama');
  assert.equal(lastState(world, salon, 'sound_program'), 'drama');

  const refused = await setValue(world, salon, 'sound_program', 'nope');
  assert.equal(refused.success, false);
  world.app.stop();
});

test('a refused command fails with a readable message', async () => {
  const world = await createWorld({ config: { language: 'en' } });
  const chambre = await create(world, 'Chambre'); // standby: the volume is guarded
  const answer = await setValue(world, chambre, 'volume', 50);
  assert.equal(answer.success, false);
  assert.equal(answer.error, 'The MusicCast device refused the command.');
  world.app.stop();
});

test('playback buttons drive the network module, only on a network source', async () => {
  const world = await createWorld({ config: { language: 'en' } });
  const salon = await create(world, 'Salon');
  const cuisine = await create(world, 'Salon Cuisine');

  await setValue(world, salon, 'pause', 1);
  assert.equal(lastState(world, salon, 'playback_state'), 0);
  await setValue(world, salon, 'play', 1);
  assert.equal(lastState(world, salon, 'playback_state'), 1);
  await setValue(world, salon, 'next', 1);
  assert.equal(lastState(world, salon, 'title'), 'next track');
  await setValue(world, salon, 'previous', 1);
  assert.equal(lastState(world, salon, 'title'), 'previous track');

  // Zone 2 is on the tuner: its pause would stop the music of the main zone.
  const sent = world.network.commands.length;
  const answer = await setValue(world, cuisine, 'pause', 1);
  assert.equal(answer.success, false);
  assert.match(answer.error, /network source/);
  assert.equal(world.network.commands.length, sent, 'nothing sent to the device');
  assert.equal(lastState(world, salon, 'playback_state'), 1);
  world.app.stop();
});

test('pause on a live radio stops it', async () => {
  const world = await createWorld();
  const salon = await create(world, 'Salon');
  await setValue(world, salon, 'input', 'net_radio');
  await setValue(world, salon, 'pause', 1);
  assert.ok(world.network.commands.includes(`${RECEIVER} netusb/setPlayback?playback=stop`));
  assert.equal(lastState(world, salon, 'playback_state'), 0);
  world.app.stop();
});

test('the preset select recalls a preset and shows it until the input changes', async () => {
  const world = await createWorld();
  const cuisine = await create(world, 'Salon Cuisine');
  await setValue(world, cuisine, 'preset', '4');
  assert.ok(world.network.commands.includes(`${RECEIVER} netusb/recallPreset?zone=zone2&num=4`));
  assert.equal(lastState(world, cuisine, 'preset'), '4');
  assert.equal(lastState(world, cuisine, 'power'), 1);
  assert.equal(lastState(world, cuisine, 'input'), 'server');
  assert.equal(lastState(world, cuisine, 'title'), 'Jazz (NAS)');

  world.network.devices[RECEIVER].zones.zone2.input = 'audio1';
  await tick(world, 20_000);
  assert.equal(world.hub.findZone(cuisine.external_id).unit.lastPresets.has('zone2'), false);
  world.app.stop();
});

test('new presets reach the select of the device already added', async () => {
  const world = await createWorld();
  await create(world, 'Salon');
  world.network.devices[RECEIVER].presets.preset_info[2] = { input: 'tuner', text: 'FM Exemple' };
  await tick(world, 5 * 60 * 1000);
  const salon = world.fake.discoveredDevices.find((d) => d.name === 'Salon');
  const preset = salon.features.find((f) => f.external_id === featureId(salon, 'preset'));
  assert.ok(preset.supported_options.some((o) => o.label === '3. FM Exemple'));
  world.app.stop();
});

test('a zone added to Gladys gets its states at once, and the widget is refreshed', async () => {
  const world = await createWorld();
  const refreshes = world.fake.widgetRefreshes.length;
  const chambre = await create(world, 'Chambre');
  assert.equal(lastState(world, chambre, 'power'), 0);
  assert.equal(lastState(world, chambre, 'input'), 'net_radio');
  assert.ok(world.fake.widgetRefreshes.length > refreshes);
  world.app.stop();
});

test('a reconnection to Gladys publishes everything again', async () => {
  const world = await createWorld();
  const salon = await create(world, 'Salon');
  const count = world.fake.states.length;
  await world.gladys.disconnect();
  await world.gladys.connect();
  assert.ok(world.fake.states.length > count);
  assert.equal(lastState(world, salon, 'power'), 1);
  world.app.stop();
});

test('a device that stops answering is marked unreachable, then back', async () => {
  const world = await createWorld();
  const salon = await create(world, 'Salon');
  world.network.offline.add(RECEIVER);
  await tick(world, 5000);
  assert.equal(world.fake.transports.at(-1).transport, 'unreachable');
  const answer = await setValue(world, salon, 'power', 0);
  assert.equal(answer.success, false);
  assert.match(answer.error, /ne répond pas/);
  world.network.offline.delete(RECEIVER);
  await tick(world, 30_000);
  assert.equal(world.fake.transports.at(-1).transport, 'local');
  world.app.stop();
});
