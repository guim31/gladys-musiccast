# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes.

What the integration handles:

- **Stored in `/data`**: nothing. The configuration (optional IP addresses,
  refresh interval, language) is kept by Gladys; the devices found are kept in
  memory and rebuilt at each start.
- **Secrets**: none. The Yamaha Extended Control API has no authentication on
  the local network, and the integration asks for no account, password or
  token.
- **Network**: from its container, HTTP GET requests on port 80 of the
  MusicCast devices (`/YamahaExtendedControl/v1/...`), only towards the
  addresses the user typed or the devices found by the network search; HTTP
  GET of the UPnP description of a device found by the search, only when the
  device serves it from its own address. The SSDP search is sent by the Gladys
  core on the integration's behalf (manifest `network_discovery`), with the
  core's own limits. Nothing leaves the local network unless the user types an
  outside address.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
and the MusicCast devices themselves (their firmware, and the fact that any
client on the local network can drive them).
