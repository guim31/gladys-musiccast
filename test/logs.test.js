// -----------------------------------------------------------------------------
// Quiet logs (CLAUDE.md): nothing at info for a normal cycle, one line per
// user action, one warning when a device stops answering and one line when it
// is back — not one per attempt.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RECEIVER, captureLogs, create, createWorld, featureId, tick } from './helpers/world.js';

test('a normal cycle writes nothing at info', async (t) => {
  const world = await createWorld();
  const salon = await create(world, 'Salon');
  await create(world, 'Chambre');
  const lines = captureLogs(t, 'info');
  for (let i = 0; i < 20; i += 1) {
    world.network.devices[RECEIVER].playInfo.track = `Titre ${i}`;
    await tick(world, 5000);
  }
  await world.fake.poll(salon);
  await world.fake.widgetGet('player', { settings: { device: salon.external_id }, language: 'fr' });
  assert.deepEqual(lines, []);
  world.app.stop();
});

test('a user action writes one info line', async (t) => {
  const world = await createWorld();
  const salon = await create(world, 'Salon');
  const lines = captureLogs(t, 'info');
  const feature = salon.features.find((f) => f.external_id === featureId(salon, 'volume'));
  await world.fake.setValue(salon, feature, 30);
  assert.deepEqual(
    lines.map((line) => line.text.replace(/^\[[^\]]+\] /, '')),
    ['[INFO] [musiccast] Salon: volume 30 %'],
  );
  world.app.stop();
});

test('a device that stops answering: one warning, one line when it is back', async (t) => {
  const world = await createWorld();
  await create(world, 'Salon');
  const lines = captureLogs(t, 'info');
  world.network.offline.add(RECEIVER);
  for (let i = 0; i < 10; i += 1) {
    await tick(world, 30_000);
  }
  world.network.offline.delete(RECEIVER);
  await tick(world, 30_000);
  const texts = lines.map(
    (line) => `${line.level} ${line.text.replace(/^\[[^\]]+\] \[\w+\] /, '')}`,
  );
  assert.deepEqual(texts, [
    'warn [musiccast] MusicCast "Salon" at 192.0.2.40 does not answer (192.0.2.40 did not answer)',
    'info [musiccast] MusicCast "Salon" at 192.0.2.40 answers again',
  ]);
  world.app.stop();
});

test('the debug level shows the cycle, without any URL', async (t) => {
  const lines = captureLogs(t, 'debug');
  const world = await createWorld();
  await create(world, 'Salon');
  await tick(world, 5000);
  assert.ok(lines.some((line) => line.level === 'debug'));
  assert.ok(!lines.some((line) => /https?:\/\//.test(line.text)), 'no URL in the logs');
  world.app.stop();
});
