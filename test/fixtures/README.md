# Test fixtures

- `gladys-feature-table.json`: category/type couples, units and poll frequencies the Gladys core
  knows, extracted from its code (see its `source` field).
- `musiccast/receiver/`, `musiccast/speaker/`: the answers of two MusicCast devices to the Yamaha
  Extended Control API (`system/getDeviceInfo`, `system/getNetworkStatus`, `system/getFeatures`,
  `system/getNameText`, `<zone>/getStatus`, `netusb/getPlayInfo`, `netusb/getPresetInfo`), one file
  per endpoint: an AV receiver with two zones (RX-V6A-like: tuner, HDMI, sound programs, three
  presets) and a network speaker (WX-021-like: one zone, 0-60 volume, no sound program, no
  preset). **They were not recorded on hardware**: they follow the shapes of the Yamaha Extended
  Control specification (Basic and Advanced) and the fields read by
  [aiomusiccast](https://github.com/vigonotion/aiomusiccast) (MIT). Identifiers are invented
  (`0B0000xx`, `02A0DE0000xx`), addresses in 192.0.2.0/24 (TEST-NET-1). Replace or complete them
  with real answers captured by `scripts/probe.mjs <address> --save <dir>` (anonymized).
- `upnp/receiver.xml`, `upnp/speaker.xml`: the UPnP description of a MusicCast device, with the
  `yamaha:X_device` block declaring the Extended Control API (the test Home Assistant makes).
  `upnp/other-renderer.xml`: a non-Yamaha media renderer, from the async_upnp_client test fixtures
  (Apache-2.0).
- `ssdp-results.json`: raw results of the core's SSDP scan (`scanNetwork('ssdp')`) for
  `urn:schemas-upnp-org:device:MediaRenderer:1`: the two MusicCast devices (one answering twice),
  a non-Yamaha renderer, a device whose description is served from another address, and an IPv6
  answer, all to be handled.
