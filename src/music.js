// -----------------------------------------------------------------------------
// The Gladys 5.3 music player panel: the catalog and the artwork.
//
// Catalog (`"music": { "browse": true }`): the presets (favorites) of the
// network module, a flat list at the root, each one played by
// netusb/recallPreset on the zone (it turns the zone on). The device's own
// menus (netusb/getListInfo, setListControl) are not offered: the device keeps
// a single cursor per input, moved by index, shared with the MusicCast app and
// the remote, so an id cannot point at the same entry twice. No search, no
// queue for the same reason.
//
// A preset id carries its number, input and name: a preset moved to another
// slot in the MusicCast app is still found by its input and name (a scene
// keeps playing the right favorite); a renamed one by its slot and input.
//
// Artwork: the key comes from the address the device gives (src/yxc/model.js,
// artworkUrlOf). The device serves its own small copy; a media server may give
// the file as it is on disk: anything over 300 KB is made smaller in plain
// JavaScript (src/artwork-resize.js), anything that is not an image refused.
// -----------------------------------------------------------------------------

import { MUSIC_MEDIA_TYPES } from '@gladysassistant/integration-sdk';
import { MAX_ARTWORK_DOWNLOAD, prepareArtwork, readLimited } from './artwork-resize.js';
import { MESSAGES, UserError } from './i18n.js';

const PRESET_PREFIX = 'preset:';
const ARTWORK_TIMEOUT_MS = 8000;

/** The MediaItem id of a preset. */
export function presetMediaId(preset) {
  return `${PRESET_PREFIX}${preset.num}:${preset.input}:${preset.name}`.slice(0, 512);
}

/** `{ num, input, name }` of a preset MediaItem id, or null. */
export function parsePresetMediaId(id) {
  const match = /^preset:(\d{1,3}):([^:]*):(.*)$/s.exec(String(id ?? ''));
  return match ? { num: Number(match[1]), input: match[2], name: match[3] } : null;
}

/** The MediaItem of a preset. */
export function presetMediaItem(preset) {
  return {
    id: presetMediaId(preset),
    type: preset.input === 'net_radio' ? MUSIC_MEDIA_TYPES.RADIO : MUSIC_MEDIA_TYPES.PLAYLIST,
    title: `${preset.num}. ${preset.name}`,
    subtitle: preset.inputName,
    duration: null,
    browsable: false,
    playable: true,
  };
}

/** onMusicBrowse: the presets, read again from the device, one page. */
export async function browse(hub, device, { parentId, offset = 0, limit = 100 }) {
  const { unit } = hub.requireZone(device.external_id);
  if (parentId !== null && parentId !== undefined && parentId !== '') {
    return { items: [], total: 0 };
  }
  if (!unit.hasNetusb || unit.presetSlots === 0) {
    return { items: [], total: 0 };
  }
  if (await hub.readPresets(unit).catch(() => false)) {
    await hub.publishDiscovered();
  }
  const page = unit.presets.slice(offset, offset + limit);
  return { items: page.map(presetMediaItem), total: unit.presets.length };
}

/** onMusicPlay: recall the preset on the zone (mode is always "replace"). */
export async function play(hub, device, media) {
  const wanted = parsePresetMediaId(media?.id);
  const { unit } = hub.requireZone(device.external_id);
  if (!wanted || !unit.hasNetusb) {
    throw new UserError(MESSAGES.unknownMedia, hub.config.language);
  }
  await hub.readPresets(unit).catch(() => false);
  const preset =
    unit.presets.find((entry) => entry.input === wanted.input && entry.name === wanted.name) ??
    // Renamed in the app: same slot, same input. Anything else in the slot is
    // another favorite, never played in its place.
    unit.presets.find((entry) => entry.num === wanted.num && entry.input === wanted.input);
  if (!preset) {
    throw new UserError(MESSAGES.unknownMedia, hub.config.language);
  }
  await hub.recallPreset(device.external_id, preset.num);
}

/**
 * onMusicGetArtwork: the bytes of a key handed out by publishNowPlaying, made
 * acceptable to the core (PNG / JPEG / WebP, 300 KB, 4096 px), as base64.
 */
export async function artwork(gladys, fetchImpl, key) {
  const url = gladys.artworkUrls.get(key);
  if (!url) {
    throw new Error(`Unknown artwork ${key}`);
  }
  const address = new URL(url);
  // The fragment only made the key unique (src/yxc/model.js).
  address.hash = '';
  const response = await fetchImpl(address.href, {
    signal: AbortSignal.timeout(ARTWORK_TIMEOUT_MS),
    redirect: 'follow',
  });
  if (!response.ok) {
    throw new Error(`Artwork not served (HTTP ${response.status})`);
  }
  const bytes = await readLimited(response.body, MAX_ARTWORK_DOWNLOAD);
  return (await prepareArtwork(bytes)).toString('base64');
}
