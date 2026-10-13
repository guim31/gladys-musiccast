// -----------------------------------------------------------------------------
// Scene actions (recall a preset, choose an input) and the "a track starts"
// scene trigger.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RECEIVER, SPEAKER, create, createWorld, lastState, tick } from './helpers/world.js';
import { SCENE_TRIGGER } from '../src/hub.js';

test('recall_preset plays a preset on a zone and returns its name', async () => {
  const world = await createWorld();
  const salon = await create(world, 'Salon');
  const answer = await world.fake.sceneAction('recall_preset', {
    device: salon.external_id,
    preset: 2,
  });
  assert.deepEqual(answer, {
    success: true,
    data: { outputs: { preset_name: 'Morning playlist' } },
  });
  assert.ok(world.network.commands.includes(`${RECEIVER} netusb/recallPreset?zone=main&num=2`));
  assert.equal(lastState(world, salon, 'preset'), '2');
  world.app.stop();
});

test('recall_preset fails on an empty slot, in the configured language', async () => {
  const world = await createWorld({ config: { language: 'de' } });
  const salon = await create(world, 'Salon');
  const answer = await world.fake.sceneAction('recall_preset', {
    device: salon.external_id,
    preset: 3,
  });
  assert.equal(answer.success, false);
  assert.equal(answer.error, 'Favorit 3 ist auf diesem Gerät leer.');
  const speaker = await create(world, 'Chambre');
  const empty = await world.fake.sceneAction('recall_preset', {
    device: speaker.external_id,
    preset: 1,
  });
  assert.equal(empty.success, false);
  world.app.stop();
});

test('select_input accepts the id or the name shown by the device, and turns the zone on', async () => {
  const world = await createWorld();
  const cuisine = await create(world, 'Salon Cuisine');
  const answer = await world.fake.sceneAction('select_input', {
    device: cuisine.external_id,
    input: ' cd ',
  });
  assert.deepEqual(answer, { success: true, data: { outputs: { input_name: 'CD' } } });
  assert.deepEqual(world.network.commands.slice(-2), [
    `${RECEIVER} zone2/setPower?power=on`,
    `${RECEIVER} zone2/setInput?input=audio1`,
  ]);
  assert.equal(lastState(world, cuisine, 'power'), 1);
  assert.equal(lastState(world, cuisine, 'input'), 'audio1');

  const byId = await world.fake.sceneAction('select_input', {
    device: cuisine.external_id,
    input: 'SPOTIFY',
  });
  assert.equal(byId.data.outputs.input_name, 'Spotify');
  world.app.stop();
});

test('select_input lists the inputs of the zone when the one asked does not exist', async () => {
  const world = await createWorld({ config: { language: 'en' } });
  const cuisine = await create(world, 'Salon Cuisine');
  const answer = await world.fake.sceneAction('select_input', {
    device: cuisine.external_id,
    input: 'hdmi1',
  });
  assert.equal(answer.success, false);
  assert.match(answer.error, /^Unknown input "hdmi1"\. Available: Tuner \(tuner\), CD \(audio1\)/);
  assert.ok(!answer.error.includes('mc_link'));
  world.app.stop();
});

test('a scene action on a zone the integration does not know fails clearly', async () => {
  const world = await createWorld({ config: { language: 'es' } });
  const answer = await world.fake.sceneAction('recall_preset', {
    device: 'ext:test-integration:zone:X-main',
    preset: 1,
  });
  assert.equal(answer.success, false);
  assert.match(answer.error, /^Zona MusicCast desconocida/);
  world.app.stop();
});

test('track_started fires when playback starts and when the track changes, not at startup', async () => {
  const world = await createWorld();
  const chambre = await create(world, 'Chambre');
  const salon = await create(world, 'Salon');
  assert.deepEqual(world.fake.sceneEvents, [], 'what already played is not news');

  const speaker = world.network.devices[SPEAKER];
  speaker.zones.main.power = 'on';
  Object.assign(speaker.playInfo, {
    playback: 'play',
    track: 'Journal',
    artist: 'Radio Exemple',
    album: '',
  });
  await tick(world, 30_000);
  assert.deepEqual(world.fake.sceneEvents, [
    {
      key: SCENE_TRIGGER,
      data: {
        device: chambre.external_id,
        title: 'Journal',
        artist: 'Radio Exemple',
        album: null,
        input: 'Net Radio',
      },
    },
  ]);

  // Same track at the next read: nothing new.
  await tick(world, 5000);
  assert.equal(world.fake.sceneEvents.length, 1);

  // The receiver changes track.
  world.network.devices[RECEIVER].playInfo.track = 'Titre suivant';
  await tick(world, 5000);
  assert.equal(world.fake.sceneEvents.length, 2);
  assert.equal(world.fake.sceneEvents[1].data.device, salon.external_id);
  assert.equal(world.fake.sceneEvents[1].data.title, 'Titre suivant');

  // Paused, then playing again: the track starts again.
  world.network.devices[RECEIVER].playInfo.playback = 'pause';
  await tick(world, 5000);
  world.network.devices[RECEIVER].playInfo.playback = 'play';
  await tick(world, 5000);
  assert.equal(world.fake.sceneEvents.length, 3);
  world.app.stop();
});
