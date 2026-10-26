// -----------------------------------------------------------------------------
// The Gladys 5.3 music player (1.1.0), on the SDK's fake Gladys and the
// simulated network: the features of a zone, the "now playing" published from
// REAL answers of netusb/getPlayInfo (test/fixtures/musiccast/real/, copied
// from public captures and issues), the playback state, seek, shuffle and
// repeat commands, the presets as a catalog, and the artwork.
// No MusicCast device behind any of this.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import jpeg from 'jpeg-js';
import { validateMediaItems, validateWidgetImage } from '@gladysassistant/integration-sdk';
import {
  RECEIVER,
  create,
  createNetwork,
  createWorld,
  featureId,
  lastState,
} from './helpers/world.js';
import { parsePresetMediaId } from '../src/music.js';

const real = (name) =>
  JSON.parse(readFileSync(new URL(`./fixtures/musiccast/real/${name}.json`, import.meta.url)));
const COVER = readFileSync(new URL('./fixtures/artwork/baseline-420.jpg', import.meta.url));

const setValue = (world, device, key, value) =>
  world.fake.setValue(
    device,
    device.features.find((f) => f.external_id === featureId(device, key)),
    value,
  );

/** The receiver of the fixtures playing a real answer on its main zone. */
async function playing(name, { apiVersion, inputs = [] } = {}) {
  const network = createNetwork();
  const device = network.devices[RECEIVER];
  for (const id of inputs) {
    device.features.system.input_list.push({ id, play_info_type: 'netusb' });
    device.features.zone[0].input_list.push(id);
  }
  if (apiVersion !== undefined) {
    device.deviceInfo.api_version = apiVersion;
  }
  device.playInfo = real(name);
  device.zones.main.input = device.playInfo.input;
  const world = await createWorld({ network });
  const salon = await create(world, 'Salon');
  const state = (key) => lastState(world, salon, key);
  return { world, salon, state, device };
}

test('a zone carries the music features of Gladys 5.3, with the 1.0 ids', async () => {
  const world = await createWorld();
  const salon = world.fake.discoveredDevices.find((d) => d.name === 'Salon');
  const feature = (key) => salon.features.find((f) => f.external_id === featureId(salon, key));
  const types = ['title', 'artist', 'album', 'artwork', 'duration', 'position', 'shuffle'];
  for (const type of [...types, 'repeat', 'mute', 'playback_state', 'volume']) {
    // The SDK convention of publishNowPlaying, `${device}:${type}`: the 1.0
    // keys already followed it (title, artist, album, mute, playback_state).
    assert.equal(feature(type).external_id, `${salon.external_id}:${type}`, type);
    assert.equal(feature(type).category, 'music', type);
    assert.equal(feature(type).type, type, type);
  }
  for (const type of ['title', 'artist', 'album', 'artwork', 'duration']) {
    assert.equal(feature(type).read_only, true, type);
  }
  for (const type of ['playback_state', 'position', 'shuffle', 'repeat', 'mute', 'volume']) {
    assert.equal(feature(type).read_only, false, type);
    assert.equal(feature(type).has_feedback, true, type);
  }
  assert.equal(feature('playback_state').max, 2);
  assert.equal(feature('repeat').max, 2);
  assert.equal(feature('position').unit, 'seconds');
  assert.equal(feature('duration').unit, 'seconds');
  // Power stays a switch.
  assert.equal(feature('power').category, 'switch');
  world.app.stop();
});

test('Spotify Connect (real answer): unknown position published as 0, artwork keyed by its id', async () => {
  const { world, state } = await playing('spotify');
  assert.equal(state('playback_state'), 1);
  assert.equal(state('title'), 'Got My Mind Set On You - Extended Version');
  assert.equal(state('artist'), 'George Harrison');
  assert.equal(state('album'), 'Cloud Nine');
  assert.equal(state('duration'), 0);
  assert.equal(state('position'), 0, 'play_time -60000 means unknown');
  assert.equal(state('shuffle'), 0);
  assert.equal(state('repeat'), 0);
  const key = state('artwork');
  assert.match(key, /^art-[0-9a-f]{12}$/);
  assert.equal(
    world.gladys.artworkUrls.get(key),
    `http://${RECEIVER}/YamahaRemoteControl/AlbumART/AlbumART7781.jpg#id-7781`,
  );
  world.app.stop();
});

test('Net Radio (real answers): the station is the title until the song is known', async () => {
  const station = await playing('net_radio_station');
  assert.equal(station.state('title'), 'ABC Classic FM 92.9 Sydney');
  assert.equal(station.state('artist'), '');
  assert.equal(station.state('artwork'), '');
  station.world.app.stop();

  const song = await playing('net_radio_song');
  assert.equal(song.state('title'), 'Avec - Home');
  assert.equal(song.state('artist'), 'Hitradio Ö3 (Vienna/German)');
  assert.match(song.state('artwork'), /^art-/, 'a PNG of the device');
  assert.equal(song.state('position'), 177);
  song.world.app.stop();
});

test('media server (real answer): a .ymf artwork is not offered, the same path per track is told apart', async () => {
  const { world, state, device } = await playing('server_ymf');
  assert.equal(state('title'), 'Bouree In E Minor');
  assert.equal(state('artwork'), '', 'Yamaha format, no browser reads it');
  // A firmware serving JPEG under one path: the id makes the keys differ.
  device.playInfo.albumart_url = '/YamahaRemoteControl/AlbumART/AlbumART.jpg';
  await world.hub.refresh([...world.hub.units.values()][0], { force: true });
  const first = state('artwork');
  device.playInfo.albumart_id = 140;
  device.playInfo.track = 'Next one';
  await world.hub.refresh([...world.hub.units.values()][0], { force: true });
  assert.notEqual(state('artwork'), first);
  world.app.stop();
});

test('Qobuz stopped with its track (real answer): IDLE, the track kept, shuffle on', async () => {
  const { world, state } = await playing('qobuz_stopped', { inputs: ['qobuz'] });
  assert.equal(state('playback_state'), 2);
  assert.equal(state('title'), 'A Pox On Your Upstairs Neighbors');
  assert.equal(state('duration'), 1293);
  assert.equal(state('position'), 0);
  assert.equal(state('shuffle'), 1);
  world.app.stop();
});

test('a zone following a multiroom link (real answer) plays nothing of its own', async () => {
  const { world, state } = await playing('mc_link');
  assert.equal(state('playback_state'), 2);
  assert.equal(state('title'), '');
  assert.equal(state('artwork'), '');
  world.app.stop();
});

test('playback_state written by Gladys: 0 pause, 1 play, 2 stop', async () => {
  const world = await createWorld();
  const salon = await create(world, 'Salon');
  await setValue(world, salon, 'playback_state', 0);
  assert.equal(lastState(world, salon, 'playback_state'), 0);
  await setValue(world, salon, 'playback_state', 1);
  assert.equal(lastState(world, salon, 'playback_state'), 1);
  await setValue(world, salon, 'playback_state', 2);
  assert.equal(lastState(world, salon, 'playback_state'), 2);
  const sent = world.network.commands.filter((c) => c.includes('setPlayback'));
  assert.deepEqual(sent, [
    `${RECEIVER} netusb/setPlayback?playback=pause`,
    `${RECEIVER} netusb/setPlayback?playback=play`,
    `${RECEIVER} netusb/setPlayback?playback=stop`,
  ]);
  world.app.stop();
});

test('seek: on the media server, refused elsewhere with a message', async () => {
  const server = await playing('server_ymf');
  await setValue(server.world, server.salon, 'position', 95);
  assert.ok(
    server.world.network.commands.includes(`${RECEIVER} netusb/setPlayPosition?position=95`),
  );
  assert.equal(server.state('position'), 95);
  server.world.app.stop();

  const spotify = await playing('spotify');
  const answer = await setValue(spotify.world, spotify.salon, 'position', 30);
  assert.equal(answer.success, false);
  assert.match(answer.error, /serveur multimédia/);
  spotify.world.app.stop();
});

test('shuffle and repeat: setShuffle / setRepeat, refused without sending when the source has none', async () => {
  const world = await createWorld();
  const salon = await create(world, 'Salon');
  await setValue(world, salon, 'shuffle', 1);
  await setValue(world, salon, 'repeat', 2);
  assert.ok(world.network.commands.includes(`${RECEIVER} netusb/setShuffle?mode=on`));
  assert.ok(world.network.commands.includes(`${RECEIVER} netusb/setRepeat?mode=one`));
  assert.equal(lastState(world, salon, 'shuffle'), 1);
  assert.equal(lastState(world, salon, 'repeat'), 2);
  world.app.stop();

  // Spotify Connect: `shuffle_available: []`.
  const spotify = await playing('spotify');
  const sent = spotify.world.network.commands.length;
  const answer = await setValue(spotify.world, spotify.salon, 'shuffle', 1);
  assert.equal(answer.success, false);
  assert.equal(spotify.world.network.commands.length, sent);
  spotify.world.app.stop();
});

test('before API 1.19 the modes are toggled until reached', async () => {
  const { world, salon, state } = await playing('net_radio_station', { apiVersion: 1.17 });
  await setValue(world, salon, 'repeat', 1); // all: off → one → all
  assert.equal(world.network.commands.filter((c) => c.endsWith('netusb/toggleRepeat')).length, 2);
  assert.equal(state('repeat'), 1);
  await setValue(world, salon, 'shuffle', 1);
  assert.equal(state('shuffle'), 1);
  assert.ok(!world.network.commands.some((c) => c.includes('setShuffle')));
  world.app.stop();
});

test('the presets are the catalog, played on the zone, found again after a move', async () => {
  const world = await createWorld();
  const cuisine = await create(world, 'Salon Cuisine');
  const ack = await world.fake.musicBrowse(cuisine);
  assert.equal(ack.success, true);
  const { items, total } = ack.data;
  assert.equal(total, 3);
  assert.deepEqual(validateMediaItems(items), []);
  assert.deepEqual(
    items.map((item) => [item.title, item.type, item.subtitle, item.playable, item.browsable]),
    [
      ['1. Radio Exemple', 'radio', 'Net Radio', true, false],
      ['2. Morning playlist', 'playlist', 'Spotify', true, false],
      ['4. Jazz (NAS)', 'playlist', 'Server', true, false],
    ],
  );
  assert.deepEqual(
    (await world.fake.musicBrowse(cuisine, { offset: 2, limit: 5 })).data.items.length,
    1,
  );

  assert.equal((await world.fake.musicPlay(cuisine, items[2])).success, true);
  assert.ok(world.network.commands.includes(`${RECEIVER} netusb/recallPreset?zone=zone2&num=4`));
  assert.equal(lastState(world, cuisine, 'power'), 1);

  // Moved from slot 4 to slot 3 in the MusicCast app: a scene still plays it.
  const presets = world.network.devices[RECEIVER].presets.preset_info;
  [presets[2], presets[3]] = [presets[3], presets[2]];
  assert.equal((await world.fake.musicPlay(cuisine, { id: items[2].id })).success, true);
  assert.ok(world.network.commands.includes(`${RECEIVER} netusb/recallPreset?zone=zone2&num=3`));
  assert.deepEqual(parsePresetMediaId(items[2].id), {
    num: 4,
    input: 'server',
    name: 'Jazz (NAS)',
  });

  const unknown = await world.fake.musicPlay(cuisine, { id: 'spotify:track:1' });
  assert.equal(unknown.success, false);
  world.app.stop();
});

test('the artwork is served by the device, a large one made smaller', async () => {
  const { world, state } = await playing('spotify');
  const url = `http://${RECEIVER}/YamahaRemoteControl/AlbumART/AlbumART7781.jpg`;
  world.network.files[url] = COVER;
  const ack = await world.fake.musicGetArtwork(state('artwork'));
  assert.equal(ack.success, true);
  assert.equal(Buffer.from(ack.data.image, 'base64').compare(COVER), 0, 'small: as it is');

  // A media server cover as it is on disk (noise: ~1 MB of JPEG).
  const side = 1000;
  const pixels = Buffer.alloc(side * side * 4);
  for (let i = 0; i < pixels.length; i += 1) pixels[i] = (i * 7919) % 251;
  world.network.files[url] = jpeg.encode({ data: pixels, width: side, height: side }, 95).data;
  assert.ok(world.network.files[url].length > 300 * 1024);
  const large = await world.fake.musicGetArtwork(world.gladys.artworkKey(`${url}#large`));
  assert.equal(large.success, true);
  assert.deepEqual(validateWidgetImage(large.data.image), []);
  world.app.stop();
});
