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
