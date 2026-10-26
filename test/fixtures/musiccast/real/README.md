# Real `netusb/getPlayInfo` answers

Answers of real MusicCast devices, copied from public pages (no device was available for this
integration). Unchanged, except the indentation.

| File                     | Source                                                                                                                                                 | What it shows                                                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `spotify.json`           | [FoxxMD/multi-scrobbler#274](https://github.com/FoxxMD/multi-scrobbler/issues/274)                                                                     | Spotify Connect: `play_time` -60000 (unknown), `total_time` 0, empty `*_available`                            |
| `net_radio_song.json`    | same issue                                                                                                                                             | Net Radio: the station in `artist`, the song in `track`, a PNG artwork                                        |
| `mc_link.json`           | same issue                                                                                                                                             | a zone following another device (multiroom): stopped, nothing loaded                                          |
| `net_radio_station.json` | [neutmute/swimbait](https://github.com/neutmute/swimbait/tree/master/doc/caps) (captures)                                                              | Net Radio before the song is known: the station alone, older firmware without `*_available`                   |
| `server_ymf.json`        | same captures                                                                                                                                          | media server: the same `AlbumART.ymf` path for every track (`albumart_id` changes), Yamaha's own image format |
| `qobuz_stopped.json`     | [research-yxc-api.md](https://github.com/LongTermSupport/fedora-desktop/blob/main/CLAUDE/Plan/00038-musiccast-controller/research-yxc-api.md) (WXA-50) | Qobuz stopped with its track still loaded, shuffle on, `total_time` 1293                                      |
