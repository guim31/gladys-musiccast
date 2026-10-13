// -----------------------------------------------------------------------------
// The "MusicCast" dashboard widget: one zone at a glance — what plays, the
// input, the sound mode, the live volume — and four buttons: power, play or
// pause, next track, mute.
//
// Core rules (CLAUDE.md): 8 components at most, 2 texts, 4 buttons; the
// `primary` style does not show in dark mode, so every button is
// `secondary` and the state is told by the label and the icon. The content
// is cached per language by the core and refreshed on change
// (requestWidgetRefresh, src/hub.js); the volume tile is bound to the
// feature, so it follows the states with no refresh at all.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { FEATURES, nowPlaying } from './devices.js';
import { MESSAGES, TEXT, UserError, lang, pick } from './i18n.js';
import { WIDGET_KEY } from './hub.js';
import { isNetworkSource } from './yxc/model.js';

export const ACTIONS = {
  POWER: 'power',
  PLAY_PAUSE: 'play_pause',
  NEXT: 'next',
  MUTE: 'mute',
};

const hint = (messages, language) => ({
  ttl_seconds: 60,
  components: [{ type: 'text', variant: 'body', text: pick(messages, language) }],
});

const button = (label, icon, key, language) => ({
  type: 'button',
  label: pick(label, language),
  icon,
  style: 'secondary',
  action: { key },
});

/** The content of the widget for one zone, in the viewer's language. */
export function playerContent(hub, { settings = {}, language } = {}) {
  const l = lang(language);
  if (!settings.device) {
    return hint(MESSAGES.pickDevice, l);
  }
  const found = hub.findZone(settings.device);
  if (!found) {
    return hint(MESSAGES.unknownDevice, l);
  }
  const { unit, zone, ids } = found;
  const state = unit.zoneStates?.get(zone.id);
  const components = [];

  const playing = state && unit.reachable !== false ? nowPlaying(unit, state, unit.playInfo) : null;
  if (playing?.track || playing?.artist) {
    const second = [playing.artist, playing.album].filter(Boolean).join(' · ');
    components.push({
      type: 'text',
      variant: 'body',
      text: [playing.track, second].filter(Boolean).join('\n').slice(0, 300),
    });
  } else if (unit.hasNetusb) {
    components.push({ type: 'text', variant: 'caption', text: pick(TEXT.nothing, l) });
  }

  if (zone.volume) {
    components.push({
      type: 'value',
      label: pick(TEXT.volume, l),
      icon: 'volume-2',
      device_feature: ids.feature(FEATURES.VOLUME),
    });
  }

  const items = [];
  if (unit.reachable === false || !state) {
    items.push({
      label: pick(TEXT.power, l),
      value: pick(TEXT.unreachable, l),
      color: WIDGET_COLORS.DANGER,
    });
  } else {
    items.push({
      label: pick(TEXT.power, l),
      value: pick(state.power ? TEXT.on : TEXT.standby, l),
      color: state.power ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.NEUTRAL,
    });
    if (state.input) {
      items.push({
        label: pick(TEXT.input, l),
        value: (unit.inputs.get(state.input)?.name ?? state.input).slice(0, 40),
        icon: 'log-in',
      });
    }
    const program = zone.soundPrograms.find((entry) => entry.id === state.soundProgram);
    if (program) {
      items.push({
        label: pick(TEXT.soundMode, l),
        value: program.name.slice(0, 40),
        icon: 'sliders',
      });
    }
    if (state.mute) {
      items.push({
        label: pick(TEXT.volume, l),
        value: pick(TEXT.muted, l),
        icon: 'volume-x',
        color: WIDGET_COLORS.WARNING,
      });
    }
  }
  components.push({ type: 'status', items });

  if (zone.hasPower) {
    components.push(
      state?.power
        ? button(TEXT.turnOff, 'power', ACTIONS.POWER, l)
        : button(TEXT.turnOn, 'power', ACTIONS.POWER, l),
    );
  }
  if (unit.hasNetusb && state?.power && isNetworkSource(unit, state.input)) {
    components.push(
      playing?.playing
        ? button(TEXT.pause, 'pause', ACTIONS.PLAY_PAUSE, l)
        : button(TEXT.play, 'play', ACTIONS.PLAY_PAUSE, l),
    );
    components.push(button(TEXT.next, 'skip-forward', ACTIONS.NEXT, l));
  }
  if (zone.hasMute && state?.power) {
    components.push(
      state.mute
        ? button(TEXT.unmute, 'volume-2', ACTIONS.MUTE, l)
        : button(TEXT.mute, 'volume-x', ACTIONS.MUTE, l),
    );
  }
  return { ttl_seconds: 30, components };
}

/**
 * A button of the widget. The answer is a toast in the viewer's language:
 * the user's problems (device off the network...) are answered, not thrown.
 */
export async function playerAction(hub, actionKey, { settings = {} } = {}) {
  try {
    const { unit, zone, ids } = hub.requireZone(settings.device);
    const state = unit.zoneStates?.get(zone.id);
    const set = (key, value) =>
      hub.setValue({ external_id: ids.device }, { external_id: ids.feature(key) }, value);
    switch (actionKey) {
      case ACTIONS.POWER:
        await set(FEATURES.POWER, state?.power ? 0 : 1);
        return undefined;
      case ACTIONS.PLAY_PAUSE: {
        const playing = state ? nowPlaying(unit, state, unit.playInfo) : null;
        await hub.playback(ids.device, playing?.playing ? 'pause' : 'play');
        return undefined;
      }
      case ACTIONS.NEXT:
        await hub.playback(ids.device, 'next');
        return undefined;
      case ACTIONS.MUTE:
        await set(FEATURES.MUTE, state?.mute ? 0 : 1);
        return undefined;
      default:
        throw new Error(`Unknown widget action "${actionKey}"`);
    }
  } catch (err) {
    if (err instanceof UserError) {
      return err.messages;
    }
    throw err;
  }
}

export const WIDGETS = {
  [WIDGET_KEY]: { get: playerContent, action: playerAction },
};
