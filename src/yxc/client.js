// -----------------------------------------------------------------------------
// Yamaha Extended Control (YXC) client: plain HTTP GET requests answered in
// JSON, on port 80 of the device, under /YamahaExtendedControl/v1/.
//
// Every answer carries a `response_code`: 0 is a success, anything else a
// refusal (3 "invalid request" on a model without the function, 4 "invalid
// parameter", 5 "guarded" while the zone is in standby...). The HTTP status is
// 200 either way, so the code is what decides.
//
// No event subscription: the device pushes its changes in UDP to the port the
// client announces (X-AppPort header), but the integration container sits on
// a bridge network with no published port, so nothing would arrive. The
// integration polls instead (src/hub.js).
// -----------------------------------------------------------------------------

import { isIPv6 } from 'node:net';

export const API_PATH = '/YamahaExtendedControl/v1';
export const REQUEST_TIMEOUT_MS = 5000;
// The largest answer is getFeatures on a receiver (~20 KB): anything far
// bigger is not a MusicCast device.
const MAX_BYTES = 512 * 1024;

export const RESPONSE_CODES = {
  0: 'success',
  1: 'initializing',
  2: 'internal error',
  3: 'invalid request',
  4: 'invalid parameter',
  5: 'guarded',
  6: 'time out',
  99: 'firmware updating',
};

/** A refusal of the device (non-zero `response_code`). */
export class YxcError extends Error {
  constructor(code, path) {
    super(
      `MusicCast refused ${path.split('?')[0]} (code ${code}: ${RESPONSE_CODES[code] ?? 'error'})`,
    );
    this.name = 'YxcError';
    this.code = code;
  }
}

/** The device did not answer (network error, timeout, not a MusicCast device). */
export class UnreachableError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UnreachableError';
  }
}

/** Base URL of the API on a host (IPv6 addresses between brackets). */
export function baseUrl(host) {
  return `http://${isIPv6(host) ? `[${host}]` : host}${API_PATH}`;
}

const query = (params) =>
  new URLSearchParams(
    Object.entries(params).map(([key, value]) => [key, String(value)]),
  ).toString();

/**
 * @param {string} host address of the device
 * @param {object} [options]
 * @param {Function} [options.fetch] fetch implementation (tests inject a fake device)
 * @param {number} [options.timeoutMs]
 */
export function createClient(
  host,
  { fetch: fetchImpl = globalThis.fetch, timeoutMs = REQUEST_TIMEOUT_MS } = {},
) {
  const root = baseUrl(host);

  async function get(path, params) {
    const url = `${root}/${path}${params ? `?${query(params)}` : ''}`;
    let response;
    let text;
    try {
      response = await fetchImpl(url, {
        signal: AbortSignal.timeout(timeoutMs),
        redirect: 'error',
        headers: { accept: 'application/json' },
      });
      text = await response.text();
    } catch (err) {
      const reason = err?.name === 'TimeoutError' ? 'timed out' : 'did not answer';
      throw new UnreachableError(`${host} ${reason}`);
    }
    if (!response.ok) {
      throw new UnreachableError(`${host} answered HTTP ${response.status}`);
    }
    if (text.length > MAX_BYTES) {
      throw new UnreachableError(`${host} sent an oversized answer`);
    }
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      throw new UnreachableError(`${host} is not a MusicCast device (no JSON)`);
    }
    if (!body || typeof body !== 'object' || typeof body.response_code !== 'number') {
      throw new UnreachableError(`${host} is not a MusicCast device`);
    }
    if (body.response_code !== 0) {
      throw new YxcError(body.response_code, path);
    }
    return body;
  }

  return {
    host,
    get,
    deviceInfo: () => get('system/getDeviceInfo'),
    networkStatus: () => get('system/getNetworkStatus'),
    features: () => get('system/getFeatures'),
    nameText: () => get('system/getNameText'),
    zoneStatus: (zone) => get(`${zone}/getStatus`),
    playInfo: () => get('netusb/getPlayInfo'),
    presetInfo: () => get('netusb/getPresetInfo'),
    setPower: (zone, on) => get(`${zone}/setPower`, { power: on ? 'on' : 'standby' }),
    setVolume: (zone, volume) => get(`${zone}/setVolume`, { volume }),
    setMute: (zone, enable) => get(`${zone}/setMute`, { enable: Boolean(enable) }),
    setInput: (zone, input) => get(`${zone}/setInput`, { input }),
    setSoundProgram: (zone, program) => get(`${zone}/setSoundProgram`, { program }),
    // play / pause / stop / previous / next: the network module is shared by
    // every zone of the device.
    setPlayback: (playback) => get('netusb/setPlayback', { playback }),
    recallPreset: (zone, num) => get('netusb/recallPreset', { zone, num }),
  };
}
