# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [1.0.1] - 2026-10-13

### Added

- Local control of Yamaha MusicCast amplifiers, soundbars and speakers through
  the Yamaha Extended Control API, with no account and no cloud.
- One Gladys device per zone (main, zone 2, 3, 4): power, volume in percent,
  mute, input and sound mode (lists with the names given on the device).
- Network sources: play, pause, previous, next, playback state, title, artist
  and album; the zones work with the Music box of the dashboard.
- Presets (favorites) stored on the device, in a list to recall one.
- Devices found by the network search of Gladys (SSDP), or by IP address; a
  device that changes address is found again.
- Refresh by the integration itself: every 5 seconds (5 to 30, configurable)
  while a zone is on, every 30 seconds in standby; only the changes are sent.
- "MusicCast" dashboard widget: what plays, input, live volume, and buttons
  for power, play/pause, next and mute.
- Scene trigger "a track starts", with the title, artist, album and input.
- Scene actions "recall a preset" and "choose an input".
- "Search for MusicCast devices" button on the configuration page.
- Texts and documentation in English, French, German and Spanish.

[Unreleased]: https://github.com/guim31/gladys-musiccast/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/guim31/gladys-musiccast/releases/tag/v1.0.1
