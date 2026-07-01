# wemo-cli

Control Wemo smart plugs from the command line and over the web.

## Scripts

| Script      | Description                  |
| ----------- | ---------------------------- |
| `on.ts`     | Turn all devices on          |
| `off.ts`    | Turn all devices off         |
| `status.ts` | Print status of all devices  |
| `server.ts` | Web server for remote control |

## Reliability

Wemo switches are on WiFi and their tiny embedded HTTP servers handle one
connection at a time, so two requests sent back-to-back get the second reset
(`socket hang up` — measured ~50% loss with no gap, 0% loss at a ~300ms gap).
SSDP discovery over multicast WiFi is also lossy, so any single discovery pass
typically finds only a random subset of the switches. Together these caused the
cron job to silently toggle only some of the switches.

The control path is now built to turn **all** switches on/off every run:

- **Persistent registry** (`devices.json`): every switch seen is remembered by
  name → last-known address. Each run still discovers to refresh addresses, but
  it commands **every known device** — falling back to the cached address for any
  switch that misses a discovery pass.
- **Request pacing** (`src/pace.ts`): all requests to a given device are
  serialised and spaced ≥350ms apart, eliminating the `socket hang up` drops.
- **Timeouts + retries + verification**: each set is retried and confirmed with
  `GetBinaryState`; a stale cached IP (DHCP reuse) is detected by name check.
- **Loud failures**: `on.ts`/`off.ts` print an `Error:` line and exit non-zero
  for any switch that could not be set, so `log-errors.sh` records it.

### First-time setup (seed the registry)

The IPs are DHCP-reserved on the router, so the registry can be seeded once from
the checked-in `devices.seed.json` (all 6 switches):

```bash
cp devices.seed.json devices.json
```

`devices.json` is the live registry (gitignored — it's machine state that
discovery keeps fresh). If you ever add/replace a switch, update
`devices.seed.json`, or just run `npx tsx status.ts` a few times and let
discovery repopulate `devices.json`.

### Tuning (environment variables)

| Variable            | Default        | Purpose                                            |
| ------------------- | -------------- | -------------------------------------------------- |
| `WEMO_GAP_MS`       | `350`          | Minimum gap between requests to the same device.   |
| `WEMO_ATTEMPTS`     | `5`            | Retry attempts per device.                         |
| `WEMO_REGISTRY`     | `./devices.json` | Path to the persisted device registry.           |
| `WEMO_NO_DISCOVERY` | unset          | Set to `1` to skip multicast and use only the registry (fastest, fully deterministic once all switches are known). |

> **DHCP reservations are in place** for all 6 switches, so cached IPs never go
> stale. Keep discovery **on** for cron, though: a Wemo can come back on a
> different *port* (e.g. `49152`/`49154`) after a power cycle, and a normal run's
> discovery pass relocates it and rewrites `devices.json` automatically.
> `WEMO_NO_DISCOVERY=1` is fastest and fully deterministic, but skips that
> self-healing — use it only if you don't mind re-seeding after a switch reboots.

## Web Server

`server.ts` runs an Express server on port 3000 with three routes:

| Route          | Method | Description                     |
| -------------- | ------ | ------------------------------- |
| `/on`          | GET    | Turn all devices on             |
| `/off`         | GET    | Turn all devices off            |
| `/status`      | GET    | Get status of all devices       |

### Usage

```bash
curl https://homeware.anselbrandt.net/on
curl https://homeware.anselbrandt.net/off
curl https://homeware.anselbrandt.net/status
```

## Deployment

### Crontab

Scheduled on/off via cron. Edit with `crontab -e`:

```crontab
PATH=/home/ansel/.nvm/versions/node/v24.12.0/bin:/usr/bin:/bin

# Turn on lights at 8:45am on weekdays
45 8 * * 1-5 /home/ansel/dev/wemo-cli/log-errors.sh /home/ansel/.nvm/versions/node/v24.12.0/bin/tsx /home/ansel/dev/wemo-cli/on.ts >> /home/ansel/lights.log

# Turn on lights at 10am on weekends
0 10 * * 0,6 /home/ansel/dev/wemo-cli/log-errors.sh /home/ansel/.nvm/versions/node/v24.12.0/bin/tsx /home/ansel/dev/wemo-cli/on.ts >> /home/ansel/lights.log

# Turn off lights at 11pm
0 23 * * * /home/ansel/dev/wemo-cli/log-errors.sh /home/ansel/.nvm/versions/node/v24.12.0/bin/tsx /home/ansel/dev/wemo-cli/off.ts >> /home/ansel/lights.log
```

### Systemd

The web server runs as a systemd service. To install:

```bash
sudo cp wemo-server.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable wemo-server
sudo systemctl start wemo-server
```

Check status and logs:

```bash
sudo systemctl status wemo-server
journalctl -u wemo-server -f
```

### Caddy

Caddy reverse proxies to the web server. See `Caddyfile.example` for a sample config.

Copy to Caddy config directory:

```bash
sudo cp Caddyfile.example /etc/caddy/Caddyfile
```

Reload Caddy:

```bash
sudo systemctl reload caddy
```

---

## Controlling Wemo Switches Over HTTP with SOAP XML

#### Perform Discovery using SSDP (Simple Service Discovery Protocol)

With the following URN (Uniform Resource Name)

```
urn:Belkin:device:controllee:1
```

Device addresses will be located in the device response `LOCATION` header.

```
LOCATION: 'http://10.0.1.74:49153/setup.xml'
```

## Actions

Actions, services, and device attributes are exposed at each device's XML entrypoint.

### \* Important - SOAPACTION header MUST include double quotes (" ") around action

### GetFriendlyName

Submit an HTTP Post request to `/upnp/control/basicevent1` with the following headers:

```
POST "http://10.0.1.74:49153/upnp/control/basicevent1"
"Content-type": 'text/xml; charset="utf-8"'
SOAPACTION: '"urn:Belkin:service:basicevent:1#GetFriendlyName"'
```

and the following body:

```
`<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:GetFriendlyName xmlns:u="urn:Belkin:service:basicevent:1"></u:GetFriendlyName>
  </s:Body>
</s:Envelope>`
```

Response:

```
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
    <s:Body>
        <u:GetFriendlyNameResponse xmlns:u="urn:Belkin:service:basicevent:1">
            <FriendlyName>Nightlight</FriendlyName>
        </u:GetFriendlyNameResponse>
    </s:Body>
</s:Envelope>
```

### GetBinaryState (On/Off Status)

Submit an HTTP Post request to `/upnp/control/basicevent1` with the following headers:

```
POST "http://10.0.1.74:49153/upnp/control/basicevent1"
"Content-type": 'text/xml; charset="utf-8"'
SOAPACTION: '"urn:Belkin:service:basicevent:1#GetBinaryState"'
```

and the following body:

```
`<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:GetBinaryState xmlns:u="urn:Belkin:service:basicevent:1"></u:GetBinaryState>
  </s:Body>
</s:Envelope>`
```

Response:

```
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
    <s:Body>
        <u:GetBinaryStateResponse xmlns:u="urn:Belkin:service:basicevent:1">
            <BinaryState>1</BinaryState>
        </u:GetBinaryStateResponse>
    </s:Body>
</s:Envelope>
```

### SetBinaryState (Turn Wemo On/Off)

Submit an HTTP Post request to `upnp/control/basicevent1` with the following headers:

```
POST "http://10.0.1.74:49153/upnp/control/basicevent1"
Content-type: 'text/xml; charset="utf-8"'
SOAPACTION: '"urn:Belkin:service:basicevent:1#SetBinaryState"'
```

and the following body:

```
`<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:SetBinaryState xmlns:u="urn:Belkin:service:basicevent:1">
      <BinaryState>1</BinaryState>
    </u:SetBinaryState>
  </s:Body>
</s:Envelope>`
```

Response:

```
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
    <s:Body>
        <u:SetBinaryStateResponse xmlns:u="urn:Belkin:service:basicevent:1">
            <BinaryState>1</BinaryState>
            <CountdownEndTime>0</CountdownEndTime>
            <deviceCurrentTime>1595917072</deviceCurrentTime>
        </u:SetBinaryStateResponse>
    </s:Body>
</s:Envelope>
```

Or to turn the Wemo off:

```
`<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:SetBinaryState xmlns:u="urn:Belkin:service:basicevent:1">
      <BinaryState>0</BinaryState>
    </u:SetBinaryState>
  </s:Body>
</s:Envelope>`
```

### Subscribe to Device Events

Once subscribed to, a device will emit changes in state (on/off) to a callback URL. Subsequent notifications must receive a an HTTP status code 200, otherwise further notifications will not be sent.

Upon subscription, the device will respond with a subscription/session ID (sid). This will be in the event message body in subsequent messages.

Node.js example:

```
const fetch = require("node-fetch");

async function subscribe({ address: deviceAddress, ip: localIP, port: localPort }) {
  try {
    const response = await fetch(`${deviceAddress}/upnp/event/basicevent1`, {
      method: "SUBSCRIBE",
      headers: {
        CALLBACK: `<http://${localIP}:${localPort}/>`,
        NT: "upnp:event",
        TIMEOUT: "Second-600",
      },
    });
    return response.headers.get("sid");
  } catch (error) {
    console.log(error);
  }
}
```

Others who have reverse engineered the Wemo API seem to have maxed out at a 600s subscription timeout, which must then be renewed. I have not bothered to confirm this.

Devices will emit an XML message on on state change, and the request body must be parsed by an XML parser.

Express.js example:

```
const express = require("express");
const bodyParser = require("body-parser");
require("body-parser-xml")(bodyParser);

const eventListener = express();

eventListener
  .use(bodyParser.xml())
  .all("/", (request, response) => {
    const sid = request.headers.sid;
    const binaryState =
      request.body["e:propertyset"]["e:property"][0];
    console.log(sid, binaryState);
    }
    response.sendStatus(200);
  })
  .listen(port, () =>
    console.log(`Event listener running on ${port}`)
  );
```

[Wemo Hacking](http://mattenoble.com/2013/08/07/wemo-hacking/)

[Wemo API Documentation](https://npmdoc.github.io/node-npmdoc-wemo-client/build/apidoc.html)

[Wemo Event Notifications](https://www.hardill.me.uk/wordpress/2015/01/14/wemo-event-notifications/)

[A Groovy Time with UPnP and WeMo](https://objectpartners.com/2014/03/25/a-groovy-time-with-upnp-and-wemo/)

[SOAP Calls for UPnP Services in WeMo Devices](https://gist.github.com/nstarke/018cd98d862afe0a7cda17bc20f31a1e)
