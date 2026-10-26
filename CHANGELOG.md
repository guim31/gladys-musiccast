# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- Gladys 5.3 Music player: each zone shows the artwork, title, artist, album,
  duration and position of what its network source plays, with play / pause /
  stop, seek (media server input), shuffle, repeat, mute and volume.
- Net Radio: the station's "Artist - Title" is split into artist and title,
  the station shown as the album (the station alone as the title until the
  song is known). A position the device does not report (Spotify Connect) is
  counted by the integration.
- The device's presets in the player's catalog panel, played on the zone (also
  through the `music.play-media` scene action).

### Changed

- Requires Gladys 5.3.0 (SDK 0.16.0).
- Mute, Title, Artist and Album become music features, with the same ids: open
  the Discovery tab and click **Update** on each zone added with 1.0.
- Playback state is writable (0 pause, 1 play, 2 stop) and is now 2 (IDLE)
  when nothing plays (standby, HDMI, tuner, stopped), no longer 0: a scene
  "playback state = 0" no longer fires on a stop. Nothing loaded clears the
  texts (empty instead of "—").

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
