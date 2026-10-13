import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, MAX_HOSTS, normalizeConfig, parseHosts } from '../src/config.js';

test('the defaults: no address, 5 s refresh, French names', () => {
  assert.deepEqual(normalizeConfig(DEFAULT_CONFIG), {
    hosts: [],
    invalidHosts: [],
    refreshSeconds: 5,
    language: 'fr',
  });
  assert.deepEqual(normalizeConfig(undefined), normalizeConfig(DEFAULT_CONFIG));
});

test('addresses: commas, semicolons or spaces, duplicates removed, invalid ones kept apart', () => {
  assert.deepEqual(parseHosts(' 192.0.2.40, 192.0.2.41;ampli.local  192.0.2.40 '), {
    valid: ['192.0.2.40', '192.0.2.41', 'ampli.local'],
    invalid: [],
  });
  assert.deepEqual(parseHosts('http://192.0.2.40, 192.0.2.40:80, [fd00::40], bad_name!'), {
    valid: ['fd00::40'],
    invalid: ['http://192.0.2.40', '192.0.2.40:80', 'bad_name!'],
  });
  const many = Array.from({ length: 40 }, (_, i) => `192.0.2.${i + 1}`).join(',');
  assert.equal(parseHosts(many).valid.length, MAX_HOSTS);
  assert.deepEqual(parseHosts(null), { valid: [], invalid: [] });
});

test('unknown select values fall back to the defaults', () => {
  const config = normalizeConfig({ refresh_interval: '3', language: 'it' });
  assert.equal(config.refreshSeconds, 5);
  assert.equal(config.language, 'fr');
  assert.equal(normalizeConfig({ refresh_interval: '30', language: 'de' }).refreshSeconds, 30);
});
