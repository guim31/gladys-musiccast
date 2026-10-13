// -----------------------------------------------------------------------------
// Finding the MusicCast devices: the mediated SSDP search (only the Yamaha
// descriptions are kept), the typed addresses, the zones already added, and
// a device that changed address.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RECEIVER,
  SPEAKER,
  SSDP_RESULTS,
  create,
  createNetwork,
  createWorld,
  tick,
} from './helpers/world.js';
import {
  isMusicCastDescription,
  musicCastAddresses,
  parseSsdpHeaders,
  ssdpCandidates,
} from '../src/discovery.js';
import { RESEARCH_EVERY_MS } from '../src/hub.js';

test('SSDP answers: one candidate per IPv4 address serving its own description', () => {
  assert.deepEqual(ssdpCandidates(SSDP_RESULTS), [
    { address: RECEIVER, location: `http://${RECEIVER}:49154/MediaRenderer/desc.xml` },
    { address: SPEAKER, location: `http://${SPEAKER}:49154/MediaRenderer/desc.xml` },
    { address: '192.0.2.30', location: 'http://192.0.2.30:1400/xml/device_description.xml' },
  ]);
  assert.deepEqual(ssdpCandidates(null), []);
  assert.equal(
    parseSsdpHeaders('HTTP/1.1 200 OK\r\nLOCATION: http://x/\r\n').location,
    'http://x/',
  );
});

test('only the descriptions declaring the Extended Control API are MusicCast devices', async () => {
  const network = createNetwork();
  const addresses = await musicCastAddresses(ssdpCandidates(SSDP_RESULTS), network.fetch);
  assert.deepEqual(addresses, [RECEIVER, SPEAKER]);
  assert.equal(isMusicCastDescription('<root><device/></root>'), false);
});

test('the zones of the devices found are proposed in the Discovery tab', async () => {
  const world = await createWorld();
  const devices = world.fake.discoveredDevices;
  assert.deepEqual(
    devices.map((device) => [device.name, device.model, device.external_id]),
    [
      ['Salon', 'Yamaha RX-V6A', 'ext:test-integration:zone:0B000001-main'],
      ['Salon Cuisine', 'Yamaha RX-V6A', 'ext:test-integration:zone:0B000001-zone2'],
      ['Chambre', 'Yamaha WX-021', 'ext:test-integration:zone:0B000010-main'],
    ],
  );
  assert.deepEqual(devices[0].params, [
    { name: 'HOST', value: RECEIVER },
    { name: 'SYSTEM_ID', value: '0B000001' },
    { name: 'ZONE', value: 'main' },
  ]);
  assert.deepEqual(world.fake.scans.at(-1)?.type ?? world.fake.scans[0].type, 'ssdp');
  world.app.stop();
});

test('without SSDP (capture refused), the typed addresses are read', async () => {
  const world = await createWorld({ ssdp: null, config: { hosts: `${SPEAKER}, 192.0.2.99` } });
  assert.deepEqual(
    world.fake.discoveredDevices.map((device) => device.name),
    ['Chambre'],
  );
  const { data } = await world.fake.action('search', {});
  assert.match(data.message.en, /1 MusicCast device\(s\) found: Chambre \(WX-021, 192\.0\.2\.41\)/);
  assert.match(data.message.en, /Not answering: 192\.0\.2\.99\./);
  assert.match(data.message.fr, /Sans réponse : 192\.0\.2\.99\./);
  world.app.stop();
});

test('the search reports an empty network and the addresses that are not addresses', async () => {
  const world = await createWorld({
    ssdp: [],
    network: createNetwork({}),
    config: { hosts: 'http://ampli' },
  });
  const { data } = await world.fake.action('search', {});
  assert.match(data.message.en, /^No MusicCast device found\./);
  assert.match(data.message.de, /Ignoriert, keine Adresse: http:\/\/ampli\./);
  assert.deepEqual(world.fake.discoveredDevices, []);
  world.app.stop();
});

test('a zone added to Gladys is found again at its stored address, without SSDP', async () => {
  const first = await createWorld();
  const salon = await create(first, 'Salon');
  first.app.stop();

  const world = await createWorld({ ssdp: null, devices: [salon] });
  assert.ok(world.fake.discoveredDevices.some((device) => device.name === 'Salon'));
  assert.equal(world.fake.lastState(`${salon.external_id}:power`), 1);
  world.app.stop();
});

test('a device that changed address (DHCP) is found again by its system_id', async () => {
  const world = await createWorld();
  const salon = await create(world, 'Salon');

  // The receiver moves to 192.0.2.60: the old address stops answering.
  const moved = '192.0.2.60';
  world.network.devices[moved] = world.network.devices[RECEIVER];
  world.network.offline.add(RECEIVER);
  world.fake.scanResults.ssdp = [
    {
      source_ip: moved,
      source_port: 1900,
      headers: `HTTP/1.1 200 OK\r\nLOCATION: http://${moved}:49154/MediaRenderer/desc.xml\r\nST: urn:schemas-upnp-org:device:MediaRenderer:1\r\n\r\n`,
    },
  ];
  const { DESCRIPTIONS } = await import('./helpers/world.js');
  DESCRIPTIONS[`http://${moved}:49154/MediaRenderer/desc.xml`] =
    DESCRIPTIONS[`http://${RECEIVER}:49154/MediaRenderer/desc.xml`];

  await tick(world, 30_000);
  assert.equal(world.hub.findZone(salon.external_id).unit.reachable, false);
  assert.deepEqual(world.fake.transports.at(-1), {
    device_external_id: salon.external_id,
    transport: 'unreachable',
  });

  // The next search, at most every 10 minutes, finds it again.
  await tick(world, RESEARCH_EVERY_MS);
  const { unit } = world.hub.findZone(salon.external_id);
  assert.equal(unit.host, moved);
  const params = world.fake.discoveredDevices.find((d) => d.name === 'Salon').params;
  assert.deepEqual(params[0], { name: 'HOST', value: moved });
  assert.equal(world.hub.units.size, 2, 'the same device, not a new one');

  await tick(world, 30_000);
  assert.equal(unit.reachable, true);
  assert.deepEqual(world.fake.transports.at(-1), {
    device_external_id: salon.external_id,
    transport: 'local',
  });
  world.app.stop();
});
