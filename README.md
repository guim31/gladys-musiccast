# Yamaha MusicCast for Gladys Assistant

Control your **Yamaha MusicCast** AV receivers, soundbars, network speakers and streamers from
[Gladys Assistant](https://gladysassistant.com), **locally**, through the official Yamaha Extended
Control API: no account, no cloud.

> **Developed without the hardware: feedback welcome.** The integration was written from the
> public Yamaha Extended Control specification and from the open-source projects that drive these
> devices, and tested against recorded-shape fixtures, not against a real device. If your model
> behaves differently, please [open an issue](https://github.com/guim31/gladys-musiccast/issues)
> with its name (and, if you can, the output of `node scripts/probe.mjs <address>`).

This project is not affiliated with Yamaha Corporation. MusicCast is a trademark of Yamaha
Corporation.

## Features

- **One Gladys device per zone** (main, zone 2, zone 3, zone 4): power, volume (in percent of the
  zone's range), mute, input (a list with the names given on the device), sound mode (DSP) where
  available.
- **Network sources** (Spotify, Net Radio, AirPlay, server, Bluetooth...): play, pause, previous,
  next, playback state, title, artist and album. The zones work with the **Music** box of the Gladys
  dashboard.
- **Presets** (favorites) stored on the device: a list to recall one.
- **Discovery** through the network search of Gladys (SSDP, mediated by the core), or by IP
  address.
- **Dashboard widget** "MusicCast": what plays, the input, the live volume, and buttons for
  power, play/pause, next and mute.
- **Scene trigger** "a track starts" (title, artist, album and input as variables).
- **Scene actions** "recall a preset" and "choose an input".
- Four languages: English, French, German, Spanish.

## Requirements

- Gladys Assistant **5.1.0** or later.
- A Yamaha MusicCast device on the same local network, with **Network Standby** enabled to be
  controlled while in standby.

## Installation

In Gladys: **Integrations → Install from GitHub**, then paste the URL of this repository
(or install it from the integration store once it is listed). Then:

1. open the configuration page of the integration: the devices are searched on the network;
   type the IP address of the ones that are not found;
2. in the **Discovery** tab, add the zones you want to Gladys.

The full user documentation is in [English](docs/en.md), [French](docs/fr.md),
[German](docs/de.md) and [Spanish](docs/es.md).

## How it works

- Every request is a plain HTTP GET on port 80 of the device,
  `/YamahaExtendedControl/v1/...`, answered in JSON with a `response_code` (0 = success).
- The devices can push their changes in UDP to a port the client announces, but the integration
  container sits on a bridge network with no published port: nothing would reach it. The
  integration therefore **polls**: every 5 s (configurable: 5, 10, 15 or 30 s) while a zone is on,
  every 30 s in standby or while the device does not answer. Only the zones added to Gladys are
  read: one `getStatus` per zone, plus `netusb/getPlayInfo` when a zone listens to a network
  source, and the presets every 5 minutes.
- The refresh runs on the container's own timer: Gladys does not reliably poll external devices
  (GladysAssistant/Gladys#3198); the devices still carry `should_poll` with a 30 s frequency, and
  the core's poll is a fallback.
- Only changed states are sent to Gladys (with a 6-hour heartbeat). A device that stops answering
  gets the "unreachable" transport badge, and the network is searched again every 10 minutes at
  most, to follow a DHCP address change (the device is identified by its `system_id`).

## Limitations

- **Multiroom groups (MusicCast Link)** are out of scope for this first version: they are created
  and left in the MusicCast app. A zone following a group shows the "MusicCast Link" input.
- Changes are seen at the next read, not pushed instantly (see above).
- The tuner is selectable as an input and through presets only; its station is not shown.
- The device does not report which preset plays: the Preset list shows the last one recalled from
  Gladys.
- Not tested on a real device yet (see the warning above).

## Development

Node.js 22+, ESM, no build step. The only runtime dependency is
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js).

```bash
npm install
npm test              # node --test: the SDK's fake Gladys and a simulated MusicCast network
npm run lint
npm run format:check
npx github:GladysAssistant/integration-store --skip-image-check .   # store validator
node scripts/probe.mjs 192.168.1.40 [--save dir]   # read-only check of a real device
```

```
index.js              SDK wiring (src/app.js registers the handlers)
src/app.js            handlers → hub, configuration action
src/hub.js            devices known, discovery, refresh ticker, commands, scene trigger
src/yxc/client.js     Yamaha Extended Control HTTP client
src/yxc/model.js      what a device is, read from its answers (pure functions)
src/discovery.js      SSDP answers and UPnP descriptions
src/devices.js        Gladys device of a zone (features, states)
src/scenes.js         scene actions
src/widgets.js        dashboard widget
src/i18n.js           texts produced by the container, four languages
src/config.js         configuration defaults and normalization
scripts/probe.mjs     read-only probe of a real device, anonymized fixtures
```

## Credits

- [Home Assistant](https://www.home-assistant.io/integrations/yamaha_musiccast/)
  (`yamaha_musiccast`, Apache-2.0) and its library
  [aiomusiccast](https://github.com/vigonotion/aiomusiccast) (MIT, Tom Schneider and
  contributors), itself based on [pyamaha](https://github.com/rsc-dev/pyamaha) (MIT): the
  endpoints, the identification of a MusicCast device by its UPnP description, the use of
  `system_id` as the device identity, the conversion of the volume range.
- Yamaha's public **Extended Control API specification** (Basic and Advanced) for the shapes of
  the answers, from which the test fixtures were written (anonymized).
- [async_upnp_client](https://github.com/StevenLooman/async_upnp_client) (Apache-2.0, Steven
  Looman): the non-Yamaha UPnP description used as a fixture.

## License

Apache-2.0, see [LICENSE](LICENSE).
