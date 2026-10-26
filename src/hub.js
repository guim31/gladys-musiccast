// -----------------------------------------------------------------------------
// The MusicCast devices known to the integration, their refresh and their
// commands.
//
// Where devices come from: the addresses typed in the configuration, the
// mediated SSDP search (src/discovery.js), and the HOST parameter of the zones
// already added to Gladys. A device is identified by its system_id, so a new
// DHCP address found by a later search updates the device instead of creating
// another one.
//
// Refresh: the core cannot be trusted to poll external devices
// (GladysAssistant/Gladys#3198), and the device's UDP events cannot reach a
// bridge container. So a one-second ticker reads every device whose zones are
// added to Gladys, every `refresh_interval` seconds while a zone is on, every
// 30 s in standby or while it does not answer. The core's onPoll is a
// fallback: it reads a device the ticker has left alone for half its period.
// Each read is one getStatus per added zone, plus one netusb/getPlayInfo when
// an added zone listens to a network source.
// -----------------------------------------------------------------------------

import {
  DEVICE_TRANSPORTS,
  MUSIC_PLAYBACK_STATE,
  createLogger,
} from '@gladysassistant/integration-sdk';
import { IDLE_INTERVAL_SECONDS } from './config.js';
import {
  CORE_POLL_FREQUENCY,
  FEATURES,
  PLAYBACK_COMMANDS,
  PLAYBACK_STATE_COMMANDS,
  REPEAT_MODES,
  buildNowPlaying,
  buildZoneDevice,
  buildZoneStates,
  featureKeyOf,
  nowPlaying,
  zoneDeviceName,
  zoneIds,
} from './devices.js';
import { SCAN_TIMEOUT_SECONDS, musicCastAddresses, ssdpCandidates } from './discovery.js';
import { FORMATS, MESSAGES, UserError, format, lang } from './i18n.js';
import { createIssueLog } from './issues.js';
import { UnreachableError, YxcError, createClient } from './yxc/client.js';
import {
  LINK_INPUTS,
  describeUnit,
  isNetworkSource,
  percentToVolume,
  playInfoOf,
  presetsOf,
  zoneStateOf,
} from './yxc/model.js';

const logger = createLogger({ name: 'musiccast' });

export const SCENE_TRIGGER = 'track_started';
export const WIDGET_KEY = 'player';
// An unchanged value is published again after this delay, so Gladys never
// shows "no recent value" (it does past 48 h).
export const HEARTBEAT_MS = 6 * 60 * 60 * 1000;
// The presets change rarely: read again every 5 minutes.
export const PRESETS_EVERY_MS = 5 * 60 * 1000;
// A device the integration has lost is searched again on the network (new
// DHCP address?) at most this often.
export const RESEARCH_EVERY_MS = 10 * 60 * 1000;
const TICK_MS = 1000;
// Before reading back a shuffle / repeat toggle (firmwares before API 1.19).
export const TOGGLE_SETTLE_MS = 300;

/**
 * @param {object} options
 * @param {object} options.gladys GladysIntegration (or the SDK's fake Gladys)
 * @param {Function} [options.fetch] HTTP implementation (tests: a fake network)
 * @param {boolean} [options.timers] run the ticker (tests drive `tick()`)
 * @param {() => number} [options.now]
 */
export class Hub {
  constructor({ gladys, fetch = globalThis.fetch, timers = true, now = () => Date.now() }) {
    this.gladys = gladys;
    this.fetch = fetch;
    this.timers = timers;
    this.now = now;
    this.config = null;
    /** platformId → unit */
    this.units = new Map();
    /** Addresses that did not answer yet (configured or from Gladys), retried on idle pace. */
    this.pending = new Map();
    this.issues = createIssueLog(logger);
    this.ticker = null;
    this.lastResearchAt = -Infinity;
    this.searching = null;
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(config) {
    this.config = config;
    await this.search({ publish: true });
    this.startTicker();
    await this.refreshAll({ force: true });
  }

  /** A reconnection to Gladys: everything is published again. */
  async resync(config) {
    this.config = config;
    this.gladys.forgetPublishedStates();
    await this.publishDiscovered();
    await this.refreshAll({ force: true });
  }

  async reconfigure(config) {
    const previous = this.config;
    this.config = config;
    const hostsChanged = JSON.stringify(previous?.hosts) !== JSON.stringify(config.hosts);
    if (hostsChanged) {
      await this.search({ publish: false });
    }
    // The language changes the feature names of the devices not added yet.
    await this.publishDiscovered();
    await this.refreshAll({ force: true });
  }

  startTicker() {
    if (!this.timers || this.ticker) {
      return;
    }
    this.ticker = setInterval(() => {
      this.tick().catch((err) => logger.error(`Refresh cycle failed (${err.message})`));
    }, TICK_MS);
    this.ticker.unref?.();
  }

  stop() {
    clearInterval(this.ticker);
    this.ticker = null;
  }

  // --- Discovery -------------------------------------------------------------

  /** Addresses of the zones already added to Gladys. */
  createdHosts() {
    const hosts = [];
    for (const device of this.gladys.devices ?? []) {
      const host = device.params?.find((param) => param.name === 'HOST')?.value;
      if (typeof host === 'string' && host && !hosts.includes(host)) {
        hosts.push(host);
      }
    }
    return hosts;
  }

  /** The mediated SSDP search; [] when the core refuses or does not support it. */
  async ssdpAddresses() {
    let results;
    try {
      results = await this.gladys.scanNetwork('ssdp', { timeoutSeconds: SCAN_TIMEOUT_SECONDS });
    } catch (err) {
      this.issues.fail('ssdp', `Network search unavailable (${err.message})`);
      return { addresses: [], available: false };
    }
    this.issues.ok('ssdp', 'Network search works again');
    const addresses = await musicCastAddresses(ssdpCandidates(results), this.fetch);
    return { addresses, available: true };
  }

  /**
   * Search the network, read every address, publish the zones in the
   * Discovery tab. Concurrent calls share the same search.
   * @returns {Promise<{ found: object[], failed: string[], ssdp: boolean }>}
   */
  search({ publish = true } = {}) {
    if (!this.searching) {
      this.searching = this.runSearch().finally(() => {
        this.searching = null;
      });
    }
    return this.searching.then(async (report) => {
      if (publish) {
        await this.publishDiscovered();
      }
      return report;
    });
  }

  async runSearch() {
    this.lastResearchAt = this.now();
    const { addresses, available } = await this.ssdpAddresses();
    const hosts = [...new Set([...this.config.hosts, ...addresses, ...this.createdHosts()])];
    const found = [];
    const failed = [];
    for (const host of hosts) {
      try {
        found.push(await this.describe(host));
        this.pending.delete(host);
      } catch (err) {
        // A known device answering elsewhere now is not a failure.
        if (![...this.units.values()].some((unit) => unit.host === host && unit.reachable)) {
          failed.push(host);
          this.pending.set(host, { lastTryAt: this.now() });
          this.issues.fail(
            `host:${host}`,
            `MusicCast device at ${host} does not answer (${err.message})`,
          );
        }
      }
    }
    return { found: [...new Set(found)], failed, ssdp: available };
  }

  /**
   * Read what a device is (model, zones, inputs, presets) and remember it.
   * @returns {Promise<object>} the unit
   */
  async describe(host) {
    const client = createClient(host, { fetch: this.fetch });
    const deviceInfo = await client.deviceInfo();
    const [network, features, names] = await Promise.all([
      client.networkStatus().catch(() => ({})),
      client.features(),
      client.nameText().catch(() => ({})),
    ]);
    const model = describeUnit({ deviceInfo, network, features, names });
    let unit = this.units.get(model.platformId);
    if (!unit) {
      unit = {
        zones: new Map(),
        presets: [],
        presetsAt: -Infinity,
        playInfo: null,
        lastRefreshAt: -Infinity,
        reachable: null,
        refreshing: null,
        trackKey: undefined,
      };
      this.units.set(model.platformId, unit);
      logger.info(
        `MusicCast ${model.model} "${model.name}" found at ${host} (${model.zones.length} zone(s))`,
      );
    } else if (unit.host !== host) {
      logger.info(`MusicCast "${model.name}" now answers at ${host}`);
    }
    Object.assign(unit, model, { host, client });
    if (unit.hasNetusb && unit.presetSlots > 0) {
      await this.readPresets(unit).catch(() => {});
    }
    this.issues.ok(`host:${host}`, `MusicCast device at ${host} answers again`);
    return unit;
  }

  /** @returns {Promise<boolean>} whether the presets changed */
  async readPresets(unit) {
    unit.presetsAt = this.now();
    const presets = presetsOf(await unit.client.presetInfo(), unit);
    const changed = JSON.stringify(presets) !== JSON.stringify(unit.presets);
    unit.presets = presets;
    return changed;
  }

  /** Every zone of every known device, in the Discovery tab. */
  async publishDiscovered() {
    const language = this.config.language;
    const devices = [];
    for (const unit of this.units.values()) {
      for (const zone of unit.zones) {
        devices.push(buildZoneDevice(this.gladys, unit, zone, language));
      }
    }
    await this.gladys.publishDiscoveredDevices(devices);
  }

  // --- Lookups ---------------------------------------------------------------

  createdIds() {
    return new Set((this.gladys.devices ?? []).map((device) => device.external_id));
  }

  /** The added zones of a unit. */
  createdZones(unit, created = this.createdIds()) {
    return unit.zones.filter((zone) =>
      created.has(zoneIds(this.gladys, unit.platformId, zone.id).device),
    );
  }

  /**
   * The unit and zone of a zone device external_id.
   * @returns {{ unit, zone, ids } | null}
   */
  findZone(deviceExternalId) {
    for (const unit of this.units.values()) {
      for (const zone of unit.zones) {
        const ids = zoneIds(this.gladys, unit.platformId, zone.id);
        if (ids.device === deviceExternalId) {
          return { unit, zone, ids };
        }
      }
    }
    return null;
  }

  requireZone(deviceExternalId) {
    const found = this.findZone(deviceExternalId);
    if (!found) {
      throw new UserError(MESSAGES.unknownDevice, this.config.language);
    }
    return found;
  }

  // --- Refresh ---------------------------------------------------------------

  intervalMs(unit) {
    const anyOn = [...unit.zones].some((zone) => unit.zoneStates?.get(zone.id)?.power);
    const seconds = unit.reachable && anyOn ? this.config.refreshSeconds : IDLE_INTERVAL_SECONDS;
    return seconds * 1000;
  }

  /** One ticker beat: every due device, the pending addresses, a new search if one is lost. */
  async tick() {
    if (this.gladys.connected === false || !this.config) {
      return;
    }
    const created = this.createdIds();
    const due = [...this.units.values()].filter(
      (unit) =>
        this.createdZones(unit, created).length > 0 &&
        this.now() - unit.lastRefreshAt >= this.intervalMs(unit),
    );
    await Promise.all(due.map((unit) => this.refresh(unit).catch(() => {})));
    await this.retryPending();
  }

  /** Addresses not described yet (a device off at start), tried again on idle pace. */
  async retryPending() {
    let lost = false;
    for (const [host, entry] of this.pending) {
      if (this.now() - entry.lastTryAt < IDLE_INTERVAL_SECONDS * 1000) {
        continue;
      }
      entry.lastTryAt = this.now();
      try {
        await this.describe(host);
        this.pending.delete(host);
        await this.publishDiscovered();
      } catch {
        lost = true;
      }
    }
    const created = this.createdIds();
    lost ||= [...this.units.values()].some(
      (unit) => unit.reachable === false && this.createdZones(unit, created).length > 0,
    );
    if (lost && this.now() - this.lastResearchAt >= RESEARCH_EVERY_MS) {
      await this.search({ publish: true }).catch(() => {});
    }
  }

  async refreshAll({ force = false } = {}) {
    const created = this.createdIds();
    await Promise.all(
      [...this.units.values()]
        .filter((unit) => this.createdZones(unit, created).length > 0)
        .map((unit) => this.refresh(unit, { force }).catch(() => {})),
    );
  }

  /**
   * The core's onPoll (fallback): reads the device of the zone unless the
   * ticker did within half the core's poll period.
   */
  async poll(device) {
    const found = this.findZone(device.external_id);
    if (!found) {
      return;
    }
    if (this.now() - found.unit.lastRefreshAt < CORE_POLL_FREQUENCY / 2) {
      return;
    }
    await this.refresh(found.unit).catch(() => {});
  }

  /** A zone was just added (or updated) in Gladys: send its states now. */
  async onDeviceCreated(device) {
    const found = this.findZone(device.external_id);
    if (!found) {
      return;
    }
    await this.refresh(found.unit, { force: true }).catch(() => {});
    this.gladys.requestWidgetRefresh(WIDGET_KEY);
  }

  /**
   * Read the added zones of a device and publish what changed. Concurrent
   * calls share one read; a forced one waits for it, then reads again.
   */
  async refresh(unit, { force = false } = {}) {
    while (unit.refreshing && force) {
      await unit.refreshing.catch(() => {});
    }
    if (unit.refreshing) {
      return unit.refreshing;
    }
    unit.refreshing = this.read(unit).finally(() => {
      unit.refreshing = null;
    });
    return unit.refreshing;
  }

  async read(unit) {
    unit.lastRefreshAt = this.now();
    const zones = this.createdZones(unit);
    if (zones.length === 0) {
      return;
    }
    const key = `host:${unit.host}`;
    try {
      const statuses = await Promise.all(zones.map((zone) => unit.client.zoneStatus(zone.id)));
      unit.zoneStates ??= new Map();
      zones.forEach((zone, index) => unit.zoneStates.set(zone.id, zoneStateOf(statuses[index])));
      const listening = zones.some((zone) => {
        const state = unit.zoneStates.get(zone.id);
        return state.power && isNetworkSource(unit, state.input);
      });
      unit.playInfo = unit.hasNetusb && listening ? playInfoOf(await unit.client.playInfo()) : null;
      if (
        unit.hasNetusb &&
        unit.presetSlots > 0 &&
        this.now() - unit.presetsAt >= PRESETS_EVERY_MS &&
        (await this.readPresets(unit).catch(() => false))
      ) {
        await this.publishDiscovered();
      }
    } catch (err) {
      this.issues.fail(
        key,
        `MusicCast "${unit.name}" at ${unit.host} does not answer (${err.message})`,
      );
      await this.setReachable(unit, false);
      throw err;
    }
    this.issues.ok(key, `MusicCast "${unit.name}" at ${unit.host} answers again`);
    await this.setReachable(unit, true);
    await this.publish(unit, zones);
  }

  async setReachable(unit, reachable) {
    if (unit.reachable === reachable) {
      return;
    }
    unit.reachable = reachable;
    const transports = this.createdZones(unit).map((zone) => ({
      external_id: zoneIds(this.gladys, unit.platformId, zone.id).device,
      transport: reachable ? DEVICE_TRANSPORTS.LOCAL : DEVICE_TRANSPORTS.UNREACHABLE,
    }));
    if (transports.length > 0) {
      await this.gladys.publishTransports(transports).catch((err) => {
        logger.debug(`Transport badge not published (${err.message})`);
      });
    }
    this.gladys.requestWidgetRefresh(WIDGET_KEY);
  }

  async publish(unit, zones) {
    const states = [];
    let musicCount = 0;
    let widgetChanged = false;
    unit.widgetKeys ??= new Map();
    unit.lastPresets ??= new Map();
    for (const zone of zones) {
      const ids = zoneIds(this.gladys, unit.platformId, zone.id);
      const zoneState = unit.zoneStates.get(zone.id);
      // The preset select shows the last recall until the zone changes input.
      // (the device takes a few seconds to switch: a fresh recall is kept).
      const last = unit.lastPresets.get(zone.id);
      const recalled = last && unit.presets.find((preset) => preset.num === last.num);
      if (last && recalled?.input !== zoneState.input && this.now() - last.at > 15_000) {
        unit.lastPresets.delete(zone.id);
      }
      states.push(
        ...buildZoneStates(ids, unit, zone, zoneState, unit.lastPresets.get(zone.id)?.num ?? null),
      );
      // One channel per feature: the music ones through publishNowPlaying,
      // which diffs them and samples the position. It has no heartbeat: its
      // snapshot is forgotten every HEARTBEAT_MS, so a stable value is sent
      // again like the others.
      const values = buildNowPlaying(unit, zone, zoneState, unit.playInfo);
      this.positionOf(unit, zone, values);
      unit.nowPlayingAt ??= new Map();
      const sentAt = unit.nowPlayingAt.get(zone.id);
      if (sentAt === undefined || this.now() - sentAt >= HEARTBEAT_MS) {
        if (sentAt !== undefined) {
          this.gladys.forgetPublishedStates(ids.device);
        }
        unit.nowPlayingAt.set(zone.id, this.now());
      }
      const { count } = await this.gladys.publishNowPlaying(ids.device, values);
      musicCount += count;
      const playing = nowPlaying(unit, zoneState, unit.playInfo);
      const widgetKey = JSON.stringify([
        zoneState.power,
        zoneState.input,
        zoneState.mute,
        zoneState.soundProgram,
        playing?.playing,
        playing?.track,
        playing?.artist,
      ]);
      if (unit.widgetKeys.get(zone.id) !== widgetKey) {
        widgetChanged ||= unit.widgetKeys.has(zone.id);
        unit.widgetKeys.set(zone.id, widgetKey);
      }
    }
    const { count } = await this.gladys.publishChangedStates(states, { heartbeat: HEARTBEAT_MS });
    if (count + musicCount > 0) {
      logger.debug(`${unit.name}: ${count + musicCount} state(s) published`);
    }
    await this.detectTrack(unit, zones);
    if (widgetChanged) {
      this.gladys.requestWidgetRefresh(WIDGET_KEY);
    }
  }

  /**
   * A position the device does not give (Spotify Connect says -60000, an old
   * firmware leaves a live radio at 0): the seconds since this track started
   * playing here, counted by the integration. A fixed 0 would drift from what
   * the dashboard extrapolates and be sent again at every read.
   */
  positionOf(unit, zone, values) {
    if (
      values.position === undefined ||
      values.playback_state === MUSIC_PLAYBACK_STATE.IDLE ||
      (values.position !== null && !(values.position === 0 && values.duration === 0))
    ) {
      unit.counters?.delete(zone.id);
      return;
    }
    unit.counters ??= new Map();
    const key = `${values.title}|${values.playback_state}`;
    let counter = unit.counters.get(zone.id);
    if (counter?.key !== key) {
      // A pause freezes the count, a resume goes on from there.
      const elapsed = counter ? counter.elapsed(this.now()) : 0;
      const sameTrack = counter?.title === values.title;
      const start = sameTrack ? elapsed : 0;
      const at = this.now();
      counter = {
        key,
        title: values.title,
        elapsed:
          values.playback_state === MUSIC_PLAYBACK_STATE.PLAYING
            ? (now) => start + Math.floor((now - at) / 1000)
            : () => start,
      };
      unit.counters.set(zone.id, counter);
    }
    values.position = counter.elapsed(this.now());
  }

  /**
   * Fire `track_started` when a track starts playing on a network source, or
   * when the track changes while playing. Not on the first read after a
   * start: what already played is not news.
   */
  async detectTrack(unit, zones) {
    const info = unit.playInfo;
    const key =
      info?.playing && (info.track || info.artist)
        ? `${info.input}|${info.track}|${info.artist}`
        : null;
    const previous = unit.trackKey;
    unit.trackKey = key;
    if (key === null || key === previous || previous === undefined) {
      return;
    }
    for (const zone of zones) {
      const zoneState = unit.zoneStates.get(zone.id);
      if (!nowPlaying(unit, zoneState, info)) {
        continue;
      }
      await this.gladys
        .publishSceneEvent(SCENE_TRIGGER, {
          device: zoneIds(this.gladys, unit.platformId, zone.id).device,
          title: info.track || null,
          artist: info.artist || null,
          album: info.album || null,
          input: unit.inputs.get(info.input)?.name ?? info.input,
        })
        .catch((err) => logger.warn(`Scene trigger not sent (${err.message})`));
    }
  }

  // --- Commands --------------------------------------------------------------

  /** Run a command on a zone, turning the device's refusals into readable errors. */
  async command(unit, zone, description, run, refusal = MESSAGES.refused) {
    const language = this.config.language;
    try {
      await run();
    } catch (err) {
      if (err instanceof UnreachableError) {
        throw new UserError(MESSAGES.unreachable, language);
      }
      if (err instanceof YxcError) {
        logger.warn(`${zoneDeviceName(unit, zone)}: ${description} refused (${err.message})`);
        throw new UserError(refusal, language);
      }
      throw err;
    }
    logger.info(`${zoneDeviceName(unit, zone)}: ${description}`);
    // Read back right away: the state follows the command, not the next tick.
    await this.refresh(unit, { force: true }).catch(() => {});
  }

  /** onSetValue of a zone device. */
  async setValue(device, feature, value) {
    const { unit, zone, ids } = this.requireZone(device.external_id);
    const key = featureKeyOf(ids.device, feature.external_id);
    const client = unit.client;
    switch (key) {
      case FEATURES.POWER:
        return this.command(unit, zone, `power ${value ? 'on' : 'standby'}`, () =>
          client.setPower(zone.id, Boolean(Number(value))),
        );
      case FEATURES.VOLUME: {
        const raw = percentToVolume(value, zone.volume);
        return this.command(unit, zone, `volume ${Math.round(Number(value))} %`, () =>
          client.setVolume(zone.id, raw),
        );
      }
      case FEATURES.MUTE:
        return this.command(unit, zone, value ? 'mute' : 'unmute', () =>
          client.setMute(zone.id, Boolean(Number(value))),
        );
      case FEATURES.INPUT:
        return this.selectInput(device.external_id, String(value));
      case FEATURES.SOUND_PROGRAM: {
        const program = zone.soundPrograms.find((entry) => entry.id === String(value));
        if (!program) {
          throw new Error(`Unknown sound program "${value}"`);
        }
        return this.command(unit, zone, `sound mode ${program.name}`, () =>
          client.setSoundProgram(zone.id, program.id),
        );
      }
      case FEATURES.PRESET:
        return this.recallPreset(device.external_id, Number(value));
      case FEATURES.PLAYBACK_STATE: {
        const playback = PLAYBACK_STATE_COMMANDS[Number(value)];
        if (!playback) {
          throw new Error(`Playback state ${value} cannot be set`);
        }
        return this.playback(device.external_id, playback);
      }
      case FEATURES.POSITION:
        return this.seek(device.external_id, Number(value));
      case FEATURES.SHUFFLE:
        return this.setShuffle(device.external_id, Boolean(Number(value)));
      case FEATURES.REPEAT:
        return this.setRepeat(device.external_id, Number(value));
      default:
        if (PLAYBACK_COMMANDS[key]) {
          return this.playback(device.external_id, PLAYBACK_COMMANDS[key]);
        }
        throw new Error(`Feature ${feature.external_id} cannot be controlled`);
    }
  }

  /**
   * Play, pause, previous, next on the network module, only while the zone
   * listens to a network source: the module is shared by all the zones, a
   * zone on the tuner would otherwise pause another one's music.
   */
  async playback(deviceExternalId, playback) {
    const { unit, zone } = await this.listeningZone(deviceExternalId);
    return this.command(unit, zone, playback, async () => {
      try {
        await unit.client.setPlayback(playback);
      } catch (err) {
        // A live radio has no pause: stop it.
        if (playback === 'pause' && err instanceof YxcError) {
          await unit.client.setPlayback('stop');
          return;
        }
        throw err;
      }
    });
  }

  /**
   * The zone of a device external_id, when it listens to a network source:
   * the network module is shared by all the zones, a zone on the tuner would
   * otherwise pause another one's music.
   */
  async listeningZone(deviceExternalId) {
    const found = this.requireZone(deviceExternalId);
    const { unit, zone } = found;
    // Read now: the zone may have changed input since the last read.
    await this.refresh(unit, { force: true }).catch(() => {});
    const zoneState = unit.zoneStates?.get(zone.id);
    // On, on a network input, and that input is what the module plays: a zone
    // in standby or on another source must not stop the music of another one.
    if (!unit.hasNetusb || !zoneState || !nowPlaying(unit, zoneState, unit.playInfo)) {
      throw new UserError(MESSAGES.notNetworkSource, this.config.language);
    }
    return found;
  }

  /** Jump within the track: the media server input only (YXC Advanced). */
  async seek(deviceExternalId, position) {
    const { unit, zone } = await this.listeningZone(deviceExternalId);
    const seconds = Math.max(0, Math.round(Number(position) || 0));
    await this.command(
      unit,
      zone,
      `position ${seconds} s`,
      () => unit.client.setPlayPosition(seconds),
      MESSAGES.noSeek,
    );
  }

  /** Shuffle on or off; `setShuffle` from API 1.19, a toggle before. */
  async setShuffle(deviceExternalId, enable) {
    const { unit, zone } = await this.listeningZone(deviceExternalId);
    const available = unit.playInfo?.shuffleAvailable ?? null;
    // "on" on most sources, "songs" / "albums" on some (the device's own list).
    const mode = enable
      ? (['on', 'songs', 'albums'].find((m) => available === null || available.includes(m)) ?? null)
      : 'off';
    if (mode === null || (available !== null && !available.includes(mode))) {
      throw new UserError(MESSAGES.noMode, this.config.language);
    }
    await this.command(
      unit,
      zone,
      `shuffle ${mode}`,
      () =>
        this.setMode(unit, 'shuffle', mode, (info) => (info.shuffle === 'off') !== enable, {
          set: () => unit.client.setShuffle(mode),
          toggle: () => unit.client.toggleShuffle(),
        }),
      MESSAGES.noMode,
    );
  }

  /** Repeat off / all / one (MUSIC_REPEAT_MODE); `setRepeat` from API 1.19, a toggle before. */
  async setRepeat(deviceExternalId, value) {
    const { unit, zone } = await this.listeningZone(deviceExternalId);
    const mode = Object.keys(REPEAT_MODES).find((key) => REPEAT_MODES[key] === value);
    if (!mode) {
      throw new Error(`Repeat mode ${value} cannot be set`);
    }
    const available = unit.playInfo?.repeatAvailable ?? null;
    if (available !== null && !available.includes(mode)) {
      throw new UserError(MESSAGES.noMode, this.config.language);
    }
    await this.command(
      unit,
      zone,
      `repeat ${mode}`,
      () =>
        this.setMode(unit, 'repeat', mode, (info) => info.repeat === mode, {
          set: () => unit.client.setRepeat(mode),
          toggle: () => unit.client.toggleRepeat(),
        }),
      MESSAGES.noMode,
    );
  }

  /**
   * Set a shuffle or repeat mode. Before API 1.19 the device only toggles
   * (off → on for shuffle, off → one → all for repeat, depending on the
   * source): toggle and read back until the mode is reached, three times at
   * most.
   */
  async setMode(unit, name, mode, reached, { set, toggle }) {
    if (unit.apiVersion === null || unit.apiVersion >= 1.19) {
      await set();
      return;
    }
    for (let i = 0; i < 3; i += 1) {
      // Give the device time to show the previous toggle, or it would be
      // toggled past the mode.
      if (i > 0) {
        await new Promise((resolve) => setTimeout(resolve, TOGGLE_SETTLE_MS));
      }
      const info = playInfoOf(await unit.client.playInfo());
      if (reached(info)) {
        return;
      }
      await toggle();
    }
    await new Promise((resolve) => setTimeout(resolve, TOGGLE_SETTLE_MS));
    if (!reached(playInfoOf(await unit.client.playInfo()))) {
      throw new YxcError(4, `netusb/${name === 'shuffle' ? 'toggleShuffle' : 'toggleRepeat'}`);
    }
  }

  /** Switch a zone to an input, by id (`hdmi1`) or by the name the device shows. */
  async selectInput(deviceExternalId, wanted) {
    const { unit, zone } = this.requireZone(deviceExternalId);
    const text = String(wanted ?? '').trim();
    const lower = text.toLowerCase();
    const id =
      zone.inputs.find((input) => input.toLowerCase() === lower) ??
      zone.inputs.find((input) => unit.inputs.get(input)?.name.toLowerCase() === lower);
    if (!id) {
      const list = zone.inputs
        .filter((input) => !LINK_INPUTS.includes(input))
        .map((input) => `${unit.inputs.get(input)?.name ?? input} (${input})`)
        .join(', ');
      throw new UserError(
        format('unknownInput', text.slice(0, 40), list.slice(0, 120)),
        this.config.language,
      );
    }
    const name = unit.inputs.get(id)?.name ?? id;
    await this.command(unit, zone, `input ${name}`, async () => {
      // Choosing what to listen to means listening: wake the zone first.
      if (zone.hasPower && !unit.zoneStates?.get(zone.id)?.power) {
        await unit.client.setPower(zone.id, true);
      }
      await unit.client.setInput(zone.id, id);
    });
    return { input: id, name };
  }

  /** Recall a preset (favorite) of the network module on a zone; the zone turns on. */
  async recallPreset(deviceExternalId, num) {
    const { unit, zone } = this.requireZone(deviceExternalId);
    if (!unit.hasNetusb || unit.presetSlots === 0) {
      throw new UserError(format('unknownPreset', num), this.config.language);
    }
    // Read them again: the list may have changed in the MusicCast app.
    if (await this.readPresets(unit).catch(() => false)) {
      await this.publishDiscovered();
    }
    const preset = unit.presets.find((entry) => entry.num === Number(num));
    if (!preset) {
      throw new UserError(format('unknownPreset', num), this.config.language);
    }
    unit.lastPresets ??= new Map();
    await this.command(unit, zone, `preset ${preset.num} (${preset.name})`, async () => {
      await unit.client.recallPreset(zone.id, preset.num);
      unit.lastPresets.set(zone.id, { num: preset.num, at: this.now() });
    });
    return preset;
  }

  // --- Reports ---------------------------------------------------------------

  /** The "Search" action: what was found, in the four languages. */
  async searchReport() {
    const report = await this.search({ publish: true });
    const parts = [];
    if (report.found.length === 0) {
      parts.push(MESSAGES.noDevice);
    } else {
      const list = report.found
        .map((unit) => `${unit.name} (${unit.model}, ${unit.host})`)
        .join(', ');
      parts.push(format('found', report.found.length, list));
    }
    if (report.failed.length > 0) {
      parts.push(format('failed', report.failed.join(', ')));
    }
    if (this.config.invalidHosts.length > 0) {
      parts.push(format('invalid', this.config.invalidHosts.join(', ')));
    }
    return Object.fromEntries(
      Object.keys(FORMATS.found).map((l) => [l, parts.map((part) => part[lang(l)]).join(' ')]),
    );
  }
}
