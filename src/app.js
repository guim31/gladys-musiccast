// -----------------------------------------------------------------------------
// Registers every SDK handler on a GladysIntegration (or the SDK's fake Gladys)
// and returns the hub, so index.js stays a few lines and the tests drive the
// very same wiring.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './config.js';
import { Hub } from './hub.js';
import { artwork, browse, play } from './music.js';
import { UserError } from './i18n.js';
import { SCENE_ACTIONS } from './scenes.js';
import { WIDGETS } from './widgets.js';

const logger = createLogger({ name: 'musiccast-app' });

/**
 * @param {object} gladys GladysIntegration instance
 * @param {object} [options] test seams: fetch, timers, now
 */
export function registerHandlers(gladys, options = {}) {
  const hub = new Hub({
    gladys,
    fetch: options.fetch,
    timers: options.timers ?? true,
    now: options.now,
  });

  // Resolved once the hub has started; every handler waits for it, so a
  // command arriving during the start is not lost.
  let resolveReady;
  const ready = new Promise((resolve) => {
    resolveReady = resolve;
  });
  let started = false;
  const whenReady =
    (fn) =>
    async (...args) => {
      await ready;
      return fn(...args);
    };

  gladys.on('connected', async () => {
    try {
      const config = normalizeConfig(await gladys.getConfig());
      if (started) {
        // A reconnection (Gladys restarted): publish everything again.
        await hub.resync(config);
        return;
      }
      started = true;
      await hub.start(config);
      logger.info(`Started with ${hub.units.size} MusicCast device(s)`);
    } catch (err) {
      logger.error(`Initialization failed (${err.message})`);
    } finally {
      resolveReady();
    }
  });

  gladys.onScanRequest(whenReady(() => hub.search({ publish: true })));
  gladys.onSetValue(whenReady((device, feature, value) => hub.setValue(device, feature, value)));
  // Devices carry should_poll: the core's poll is a fallback of the ticker.
  gladys.onPoll(whenReady((device) => hub.poll(device)));
  gladys.onDeviceCreated(whenReady((device) => hub.onDeviceCreated(device)));
  gladys.onDeviceUpdated(whenReady((device) => hub.onDeviceCreated(device)));
  // The Gladys 5.3 music player: the presets as a catalog, the artwork.
  gladys.onMusicBrowse(whenReady((device, request) => browse(hub, device, request)));
  gladys.onMusicPlay(whenReady((device, media) => play(hub, device, media)));
  gladys.onMusicGetArtwork(
    whenReady((key) => artwork(gladys, options.fetch ?? globalThis.fetch, key)),
  );
  gladys.onConfigUpdated(whenReady((config) => hub.reconfigure(normalizeConfig(config))));

  // The configuration page shows what an action resolves, in the user's
  // language: the problems of the user are answered, not thrown.
  gladys.onAction(
    'search',
    whenReady(async () => {
      try {
        return await hub.searchReport();
      } catch (err) {
        if (err instanceof UserError) {
          return err.messages;
        }
        throw err;
      }
    }),
  );

  for (const [key, handler] of Object.entries(SCENE_ACTIONS)) {
    gladys.onSceneAction(
      key,
      whenReady((fields) => handler(hub, fields)),
    );
  }

  for (const [key, widget] of Object.entries(WIDGETS)) {
    gladys.onWidgetGet(
      key,
      whenReady(async (request) => widget.get(hub, request)),
    );
    gladys.onWidgetAction(
      key,
      whenReady((actionKey, _params, context = {}) => widget.action(hub, actionKey, context)),
    );
  }

  return { hub, ready, stop: () => hub.stop() };
}
