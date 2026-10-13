// -----------------------------------------------------------------------------
// The "MusicCast" widget: content within the core budget, bound to features
// that exist, localized, and its buttons.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { RECEIVER, create, createWorld, lastState, tick } from './helpers/world.js';

const content = async (world, device, language = 'fr') => {
  const answer = await world.fake.widgetGet('player', {
    settings: device ? { device: device.external_id } : {},
    language,
    units: 'metric',
  });
  assert.equal(answer.success, true);
  return answer.data.content;
};

const buttons = (c) => c.components.filter((x) => x.type === 'button');

test('a playing zone: track, live volume, status rows, four buttons, within the budget', async () => {
  const world = await createWorld();
  const salon = await create(world, 'Salon');
  const c = await content(world, salon);
  assert.deepEqual(validateWidgetContent(c), []);
  assert.ok(c.components.length <= 8);
  assert.deepEqual(c.components[0], {
    type: 'text',
    variant: 'body',
    text: 'Chanson d’essai\nLes Exemples · Album de test',
  });
  const tile = c.components.find((x) => x.type === 'value');
  // The tile is bound to a feature that the device really has.
  assert.ok(salon.features.some((f) => f.external_id === tile.device_feature));
  const status = c.components.find((x) => x.type === 'status');
  assert.deepEqual(
    status.items.map((item) => [item.label, item.value]),
    [
      ['Alimentation', 'Allumé'],
      ['Entrée', 'Spotify'],
      ['Mode son', 'Straight'],
    ],
  );
  assert.deepEqual(
    buttons(c).map((b) => [b.label, b.icon, b.action.key, b.style]),
    [
      ['Veille', 'power', 'power', 'secondary'],
      ['Pause', 'pause', 'play_pause', 'secondary'],
      ['Suivant', 'skip-forward', 'next', 'secondary'],
      ['Couper le son', 'volume-x', 'mute', 'secondary'],
    ],
  );
  world.app.stop();
});

test('a zone in standby, in German: nothing playing, one button to turn it on', async () => {
  const world = await createWorld();
  const cuisine = await create(world, 'Salon Cuisine');
  const c = await content(world, cuisine, 'de');
  assert.deepEqual(validateWidgetContent(c), []);
  assert.deepEqual(c.components[0], { type: 'text', variant: 'caption', text: 'Keine Wiedergabe' });
  assert.deepEqual(
    buttons(c).map((b) => b.label),
    ['Einschalten'],
  );
  world.app.stop();
});

test('an unreachable zone says so', async () => {
  const world = await createWorld();
  const salon = await create(world, 'Salon');
  world.network.offline.add(RECEIVER);
  await tick(world, 5000);
  const c = await content(world, salon, 'es');
  assert.deepEqual(validateWidgetContent(c), []);
  const status = c.components.find((x) => x.type === 'status');
  assert.deepEqual(status.items[0], { label: 'Encendido', value: 'Inaccesible', color: 'danger' });
  world.app.stop();
});

test('without a zone, or with a zone unknown, the widget explains what to do', async () => {
  const world = await createWorld();
  const none = await content(world, null, 'en');
  assert.match(none.components[0].text, /Choose a MusicCast zone/);
  const unknown = await content(world, { external_id: 'ext:test-integration:zone:X-main' }, 'fr');
  assert.match(unknown.components[0].text, /Zone MusicCast inconnue/);
  assert.deepEqual(validateWidgetContent(unknown), []);
  world.app.stop();
});

test('the buttons drive the zone; a problem comes back as a toast', async () => {
  const world = await createWorld();
  const salon = await create(world, 'Salon');
  const press = (actionKey) =>
    world.fake.widgetAction('player', actionKey, {}, { settings: { device: salon.external_id } });

  assert.equal((await press('play_pause')).success, true);
  assert.equal(lastState(world, salon, 'playback_state'), 0);
  await press('play_pause');
  assert.equal(lastState(world, salon, 'playback_state'), 1);
  await press('next');
  assert.equal(lastState(world, salon, 'title'), 'next track');
  await press('mute');
  assert.equal(lastState(world, salon, 'mute'), 1);
  await press('mute');
  assert.equal(lastState(world, salon, 'mute'), 0);
  await press('power');
  assert.equal(lastState(world, salon, 'power'), 0);

  world.network.offline.add(RECEIVER);
  const answer = await press('power');
  assert.equal(answer.success, true);
  assert.match(answer.data.message.fr, /ne répond pas/);
  assert.match(answer.data.message.de, /antwortet nicht/);
  world.app.stop();
});

test('a change of what plays asks the core to refresh the widget', async () => {
  const world = await createWorld();
  await create(world, 'Salon');
  const before = world.fake.widgetRefreshes.length;
  await tick(world, 5000);
  assert.equal(world.fake.widgetRefreshes.length, before, 'nothing changed');
  world.network.devices[RECEIVER].playInfo.track = 'Autre';
  await tick(world, 5000);
  assert.equal(world.fake.widgetRefreshes.length, before + 1);
  world.app.stop();
});
