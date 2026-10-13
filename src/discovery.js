// -----------------------------------------------------------------------------
// Network search for MusicCast devices.
//
// The integration container sits on a bridge network and never sees SSDP: the
// core sends the M-SEARCH for the MediaRenderer devices (manifest
// `network_discovery`) and relays the raw answers (mediated discovery). Each
// answer points to a UPnP description served over HTTP by the device itself
// (unicast crosses the bridge): a MusicCast device declares the Extended
// Control API there (`<yamaha:X_yxcControlURL>`, the test Home Assistant
// does too). Other renderers (TVs, Sonos...) are ignored.
// -----------------------------------------------------------------------------

import { isIP } from 'node:net';

export const SSDP_SEARCH_TARGET = 'urn:schemas-upnp-org:device:MediaRenderer:1';
export const SCAN_TIMEOUT_SECONDS = 5;
export const MAX_CANDIDATES = 32;
const DESCRIPTION_TIMEOUT_MS = 3000;
const DESCRIPTION_MAX_BYTES = 64 * 1024;
const DESCRIPTION_CONCURRENCY = 4;

/** Headers of one raw SSDP answer, keys lower-cased. */
export function parseSsdpHeaders(text) {
  const headers = {};
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const at = line.indexOf(':');
    if (at > 0) {
      const key = line.slice(0, at).trim().toLowerCase();
      if (!(key in headers)) {
        headers[key] = line.slice(at + 1).trim();
      }
    }
  }
  return headers;
}

/** The description URL, only when the answering address serves it over http. */
function sameHostLocation(location, address) {
  try {
    const url = new URL(location);
    return url.protocol === 'http:' && url.hostname === address ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * One candidate per answering IPv4 address, from `scanNetwork('ssdp')`.
 * @param {Array<{ source_ip: string, headers: string }>} results
 * @returns {Array<{ address: string, location: string }>}
 */
export function ssdpCandidates(results) {
  const byAddress = new Map();
  for (const result of Array.isArray(results) ? results : []) {
    const address = result?.source_ip;
    if (typeof address !== 'string' || isIP(address) !== 4 || byAddress.has(address)) {
      continue;
    }
    const headers = parseSsdpHeaders(result.headers);
    const location = headers.location ? sameHostLocation(headers.location, address) : null;
    if (location && byAddress.size < MAX_CANDIDATES) {
      byAddress.set(address, { address, location });
    }
  }
  return [...byAddress.values()];
}

/** True when a UPnP description declares the Yamaha Extended Control API. */
export function isMusicCastDescription(xml) {
  return /<(?:\w+:)?X_yxcControlURL>\s*\/YamahaExtendedControl\/v1\/?\s*<\/(?:\w+:)?X_yxcControlURL>/i.test(
    String(xml ?? ''),
  );
}

/**
 * Fetch the description of each candidate (a few at a time) and keep the
 * MusicCast devices. A failure just leaves the candidate out.
 * @param {Array<{ address, location }>} candidates
 * @param {Function} fetchImpl
 * @returns {Promise<string[]>} the addresses of the MusicCast devices
 */
export async function musicCastAddresses(candidates, fetchImpl) {
  const found = [];
  let next = 0;
  const worker = async () => {
    while (next < candidates.length) {
      const candidate = candidates[next];
      next += 1;
      try {
        const response = await fetchImpl(candidate.location, {
          signal: AbortSignal.timeout(DESCRIPTION_TIMEOUT_MS),
          redirect: 'error',
        });
        if (!response.ok) {
          continue;
        }
        const text = (await response.text()).slice(0, DESCRIPTION_MAX_BYTES);
        if (isMusicCastDescription(text)) {
          found.push(candidate.address);
        }
      } catch {
        // Not reachable in unicast: not a device the integration could drive.
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(DESCRIPTION_CONCURRENCY, candidates.length) }, worker),
  );
  // Scan order, whatever the order the descriptions answered in.
  return candidates.map((c) => c.address).filter((address) => found.includes(address));
}
