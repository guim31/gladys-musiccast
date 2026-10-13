#!/usr/bin/env node
// -----------------------------------------------------------------------------
// Read-only probe of a real MusicCast device, through the integration's own
// client and model (src/yxc/). It only calls get* endpoints: nothing changes
// on the device.
//
//   node scripts/probe.mjs 192.168.1.40
//   node scripts/probe.mjs 192.168.1.40 --save test/fixtures/musiccast/my-model
//
// Prints what the integration understands of the device (zones, inputs, sound
// programs, presets, what plays). With --save, writes the raw answers as
// fixtures, ANONYMIZED: addresses, MAC addresses, serial numbers, system and
// device ids, Wi-Fi name and keys are replaced. Check the files before
// committing them anyway.
// -----------------------------------------------------------------------------

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createClient } from '../src/yxc/client.js';
import { describeUnit, playInfoOf, presetsOf, zoneStateOf } from '../src/yxc/model.js';

const [host, flag, dir] = process.argv.slice(2);
if (!host || (flag && (flag !== '--save' || !dir))) {
  console.error('usage: node scripts/probe.mjs <ip-address> [--save <directory>]');
  process.exit(2);
}

const client = createClient(host);
const answers = {};
const read = async (name, call) => {
  try {
    answers[name] = await call();
  } catch (err) {
    answers[name] = { error: err.message };
  }
  return answers[name];
};

const deviceInfo = await read('system_getDeviceInfo', () => client.deviceInfo());
if (deviceInfo.error) {
  console.error(`No MusicCast answer: ${deviceInfo.error}`);
  process.exit(1);
}
const network = await read('system_getNetworkStatus', () => client.networkStatus());
const features = await read('system_getFeatures', () => client.features());
const names = await read('system_getNameText', () => client.nameText());
const unit = describeUnit({ deviceInfo, network, features, names });
for (const zone of unit.zones) {
  await read(`${zone.id}_getStatus`, () => client.zoneStatus(zone.id));
}
if (unit.hasNetusb) {
  await read('netusb_getPlayInfo', () => client.playInfo());
  await read('netusb_getPresetInfo', () => client.presetInfo());
}

console.log(`Model: ${unit.model}, firmware ${unit.firmware}, API ${unit.apiVersion}`);
console.log(`Network module: ${unit.hasNetusb ? 'yes' : 'no'}, preset slots: ${unit.presetSlots}`);
for (const zone of unit.zones) {
  const state = zoneStateOf(answers[`${zone.id}_getStatus`]);
  console.log(`\nZone ${zone.id} ("${zone.name}")`);
  console.log(
    `  functions: power=${zone.hasPower} mute=${zone.hasMute} volume=${JSON.stringify(zone.volume)}`,
  );
  console.log(
    `  inputs: ${zone.inputs.map((id) => `${id}=${unit.inputs.get(id).name}`).join(', ')}`,
  );
  console.log(`  sound programs: ${zone.soundPrograms.map((p) => p.id).join(', ') || '(none)'}`);
  console.log(`  now: ${JSON.stringify(state)}`);
}
if (unit.hasNetusb) {
  const info = playInfoOf(answers.netusb_getPlayInfo);
  console.log(
    `\nNetwork module: ${info.input} ${info.playback} (${info.track ? 'a title' : 'no title'})`,
  );
  console.log(`Presets: ${presetsOf(answers.netusb_getPresetInfo, unit).length} stored`);
}

if (flag === '--save') {
  // Replace every identifying value, keeping the shapes.
  const secrets = new Map();
  const fake = (value, kind) => {
    if (!secrets.has(value)) {
      const n = secrets.size + 1;
      secrets.set(
        value,
        kind === 'ip'
          ? `192.0.2.${100 + n}`
          : kind === 'hex'
            ? String(n).padStart(String(value).length, '0').slice(-String(value).length)
            : `example-${n}`,
      );
    }
    return secrets.get(value);
  };
  const IP = /\b\d{1,3}(?:\.\d{1,3}){3}\b/g;
  const scrub = (value, key = '') => {
    if (Array.isArray(value)) {
      return value.map((item) => scrub(item, key));
    }
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrub(v, k)]));
    }
    if (typeof value !== 'string') {
      return value;
    }
    if (
      /^(device_id|system_id|serial_number|vtuner_id|wired_lan|wireless_lan|wireless_direct|netmodule_checksum)$/.test(
        key,
      )
    ) {
      return fake(value, 'hex');
    }
    if (/^(ssid|key|network_name)$/.test(key)) {
      return value ? fake(value, 'text') : value;
    }
    return value.replace(IP, (ip) => (ip === '0.0.0.0' ? ip : fake(ip, 'ip')));
  };
  await mkdir(dir, { recursive: true });
  for (const [name, body] of Object.entries(answers)) {
    await writeFile(join(dir, `${name}.json`), `${JSON.stringify(scrub(body), null, 2)}\n`);
  }
  console.log(`\nSaved ${Object.keys(answers).length} anonymized answers in ${dir}`);
}
