# Deploying wemo-cli to a Raspberry Pi

Complete guide to setting up the Wemo smart plug server on a fresh Raspberry Pi.

## Prerequisites

- Raspberry Pi running Debian/Raspberry Pi OS (tested on arm64)
- Pi connected to the same local network as the Wemo smart plugs
- SSH access to the Pi
- A Cloudflare account with a domain (for public access)

## 1. Install Node.js via nvm

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.bashrc
nvm install 24
```

Note the installed path (e.g. `/home/ansel/.nvm/versions/node/v24.12.0/bin`) — it's needed for systemd and cron since they don't load your shell profile.

## 2. Install tsx globally

```bash
npm install -g tsx
```

## 3. Clone and install the project

```bash
mkdir -p ~/dev
cd ~/dev
git clone <repo-url> wemo-cli
cd wemo-cli
npm install
```

## 4. Set up the systemd service

The web server runs as a systemd service so it starts on boot and restarts on failure.

Copy the service file:

```bash
sudo cp wemo-server.service /etc/systemd/system/
```

If your Node.js path differs from the one in `wemo-server.service`, edit the file:

```bash
sudo nano /etc/systemd/system/wemo-server.service
```

Update the `Environment=PATH=...` and `ExecStart=...` lines to match your nvm Node.js path.

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable wemo-server
sudo systemctl start wemo-server
```

Verify it's running:

```bash
sudo systemctl status wemo-server
journalctl -u wemo-server -f
```

The server listens on port 3000.

### Service file reference

```ini
[Unit]
Description=Wemo light control web server
After=network.target

[Service]
Type=simple
User=ansel
WorkingDirectory=/home/ansel/dev/wemo-cli
Environment=PATH=/home/ansel/.nvm/versions/node/v24.12.0/bin:/usr/bin:/bin
ExecStart=/home/ansel/.nvm/versions/node/v24.12.0/bin/tsx /home/ansel/dev/wemo-cli/server.ts
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

## 5. Set up cron jobs

The cron jobs run `on.ts` and `off.ts` on a schedule to automatically turn lights on and off.

A helper script `log-errors.sh` wraps the commands to capture only error output with timestamps.

Edit your crontab:

```bash
crontab -e
```

Add the following (adjust the nvm Node.js path if needed):

```crontab
PATH=/home/ansel/.nvm/versions/node/v24.12.0/bin:/usr/bin:/bin

# Turn on lights at 8:45am on weekdays
45 8 * * 1-5 /home/ansel/dev/wemo-cli/log-errors.sh /home/ansel/.nvm/versions/node/v24.12.0/bin/tsx /home/ansel/dev/wemo-cli/on.ts >> /home/ansel/lights.log

# Turn on lights at 10am on weekends
0 10 * * 0,6 /home/ansel/dev/wemo-cli/log-errors.sh /home/ansel/.nvm/versions/node/v24.12.0/bin/tsx /home/ansel/dev/wemo-cli/on.ts >> /home/ansel/lights.log

# Turn off lights at 11pm
0 23 * * * /home/ansel/dev/wemo-cli/log-errors.sh /home/ansel/.nvm/versions/node/v24.12.0/bin/tsx /home/ansel/dev/wemo-cli/off.ts >> /home/ansel/lights.log
```

### log-errors.sh

This script is included in the repo. It runs the given command and only logs lines containing "Error", prefixed with a timestamp:

```bash
#!/bin/bash
"$@" 2>&1 | grep Error | while read line; do
    echo "$(date '+%Y-%m-%d %H:%M:%S') $line"
done
```

Make sure it's executable:

```bash
chmod +x /home/ansel/dev/wemo-cli/log-errors.sh
```

### Cron notes

- The `PATH` line at the top is required because cron doesn't source your shell profile, so nvm-installed Node.js won't be on the path otherwise.
- Full absolute paths are used for `tsx` and the scripts for the same reason.
- Logs append to `~/lights.log`. Check this file to debug cron issues.

## 6. Install and configure Caddy

Caddy provides HTTPS reverse proxying to the Express server on port 3000.

### Install Caddy

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudflare.com/cloudflared-stable-linux-arm64.deb' -o /tmp/cloudflared.deb
```

For Caddy with Cloudflare DNS plugin (needed for TLS certificate provisioning via Cloudflare):

```bash
sudo apt install -y caddy
```

Or install a custom build with the Cloudflare DNS module from [caddyserver.com/download](https://caddyserver.com/download).

### Configure Caddy

Copy the example Caddyfile:

```bash
sudo cp /home/ansel/dev/wemo-cli/Caddyfile.example /etc/caddy/Caddyfile
```

Edit `/etc/caddy/Caddyfile` and replace `{env.CF_API_TOKEN}` with your actual Cloudflare API token:

```
homeware.anselbrandt.net {
    reverse_proxy localhost:3000

    tls {
        dns cloudflare "YOUR_CLOUDFLARE_API_TOKEN"
    }
}
```

The `tls` block uses the Cloudflare DNS challenge for automatic HTTPS certificates. This is needed because the Pi isn't directly reachable from the internet (traffic goes through the Cloudflare Tunnel).

Reload Caddy:

```bash
sudo systemctl reload caddy
```

## 7. Set up Cloudflare Tunnel

Cloudflare Tunnel makes `homeware.anselbrandt.net` publicly accessible without opening any ports on the router.

### Install cloudflared

```bash
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64.deb -o /tmp/cloudflared.deb
sudo dpkg -i /tmp/cloudflared.deb
```

### Create a tunnel

1. Log in to the [Cloudflare Zero Trust dashboard](https://one.dash.cloudflare.com/)
2. Go to **Networks > Tunnels**
3. Create a new tunnel and copy the tunnel token

### Configure the tunnel

The tunnel runs as a remotely-managed tunnel (configured in the Cloudflare dashboard, not via local config files). Set the ingress rule in the dashboard:

| Hostname                    | Service                |
| --------------------------- | ---------------------- |
| homeware.anselbrandt.net    | https://localhost:443  |

Set **Origin Server Name** to `homeware.anselbrandt.net` in the origin configuration so cloudflared validates Caddy's TLS certificate.

The catch-all rule should return HTTP 404.

### Install as a systemd service

Create `/etc/systemd/system/cloudflared.service`:

```ini
[Unit]
Description=cloudflared
After=network-online.target
Wants=network-online.target

[Service]
TimeoutStartSec=15
Type=notify
ExecStart=/usr/bin/cloudflared --no-autoupdate tunnel run --token YOUR_TUNNEL_TOKEN
Restart=on-failure
RestartSec=5s

[Install]
WantedBy=multi-user.target
```

Replace `YOUR_TUNNEL_TOKEN` with the token from the Cloudflare dashboard.

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable cloudflared
sudo systemctl start cloudflared
```

Verify:

```bash
sudo systemctl status cloudflared
```

## Traffic flow

```
Internet
  → Cloudflare CDN (homeware.anselbrandt.net)
    → Cloudflare Tunnel (cloudflared on Pi)
      → Caddy (https://localhost:443)
        → Express server (http://localhost:3000)
```

## Updating the code

```bash
cd ~/dev/wemo-cli
git pull
npm install
sudo systemctl restart wemo-server
```

Cron jobs use `tsx` to run TypeScript directly, so they pick up changes from the working directory on the next scheduled run — no restart needed.

## Troubleshooting

### Server won't start

```bash
journalctl -u wemo-server -n 50
```

Common issues:
- Wrong Node.js path in the service file after an nvm upgrade
- Port 3000 already in use

### Cron jobs not running

```bash
# Check cron logs
grep CRON /var/log/syslog

# Check error log
cat ~/lights.log

# Test manually
tsx /home/ansel/dev/wemo-cli/on.ts
```

### Devices not discovered

Wemo devices use SSDP multicast on the local network. Ensure:
- Pi and Wemo plugs are on the same network/VLAN
- No firewall blocking UDP multicast (port 1900)

### Caddy certificate issues

```bash
journalctl -u caddy -n 50
```

The Cloudflare API token needs the **Zone > DNS > Edit** permission for certificate DNS challenges.

### Cloudflare Tunnel not connecting

```bash
journalctl -u cloudflared -n 50
```

Check that the tunnel token is correct and the tunnel is active in the Cloudflare dashboard.
