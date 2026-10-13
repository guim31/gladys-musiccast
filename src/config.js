// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with strings, blanks or `undefined`.
// -----------------------------------------------------------------------------

import { isIP } from 'node:net';

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

// Seconds between two reads of a device while one of its zones is on. A select
// (the manifest renders `number` fields without `step`), stored as a string.
export const REFRESH_INTERVALS = ['5', '10', '15', '30'];

// Seconds between two reads while every zone is in standby, or while the
// device does not answer: nothing moves, the device is left alone.
export const IDLE_INTERVAL_SECONDS = 30;

export const MAX_HOSTS = 16;

export const DEFAULT_CONFIG = {
  hosts: '',
  refresh_interval: '5',
  language: 'fr',
};

// A host name or an IPv4/IPv6 address, no scheme, no port, no path: the
// Extended Control API always listens on port 80.
const HOSTNAME =
  /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i;

/**
 * The addresses typed in the configuration: separated by commas, semicolons
 * or spaces, duplicates removed. Returns the valid ones and the rejected ones
 * (reported by the "Search" action, never logged with anything else).
 * @param {unknown} text
 */
export function parseHosts(text) {
  const valid = [];
  const invalid = [];
  for (const raw of String(text ?? '').split(/[\s,;]+/)) {
    const host = raw.trim().replace(/^\[(.*)\]$/, '$1');
    if (!host) {
      continue;
    }
    if (isIP(host) || HOSTNAME.test(host)) {
      const normalized = host.toLowerCase();
      if (!valid.includes(normalized) && valid.length < MAX_HOSTS) {
        valid.push(normalized);
      }
    } else {
      invalid.push(raw.slice(0, 60));
    }
  }
  return { valid, invalid };
}

/**
 * @param {Record<string, unknown>} raw the configuration returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const { valid, invalid } = parseHosts(source.hosts);
  const refresh = REFRESH_INTERVALS.includes(String(source.refresh_interval))
    ? Number(source.refresh_interval)
    : Number(DEFAULT_CONFIG.refresh_interval);
  return {
    hosts: valid,
    invalidHosts: invalid,
    refreshSeconds: refresh,
    language: LANGUAGES.includes(source.language) ? source.language : DEFAULT_CONFIG.language,
  };
}
