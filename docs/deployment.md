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

## 5. Scheduling

> **There is no cron setup any more.** Scheduling used to live in `ansel`'s
> crontab; it now runs inside the `wemo-server` service and is configured from
> the web UI at the site root. If you are upgrading an older install, **delete
> the wemo lines from `crontab -e`** — leaving them means cron *and* the
> in-process scheduler both fire and every event runs twice.

Nothing to install: `src/scheduler.ts` starts with the server, checks the
schedule every 30s, and applies it in local time (so the Pi's timezone must be
right — see `timedatectl`). Times are stored in `schedule.json` next to
`devices.json` and are editable at `/` or via `GET`/`POST /schedule`. See the
[Schedule section of the README](../README.md#schedule) for the semantics.

Verify no stale cron entries remain:

```bash
crontab -l
```

`on.ts` and `off.ts` are still there for manual runs, and `log-errors.sh` still
wraps a command to log only its error lines with timestamps — but the scheduled
path no longer uses either, so failures appear in the journal instead of
`~/lights.log`:

```bash
journalctl -u wemo-server | grep -iE 'error|failed'
```

## 6. Install and configure Caddy

Caddy reverse proxies to the Express server on port 3000. TLS is handled by the Cloudflare Tunnel, so Caddy serves plain HTTP.

### Install Caddy

```bash
sudo apt install -y caddy
```

### Configure Caddy

Copy the example Caddyfile:

```bash
sudo cp /home/ansel/dev/wemo-cli/Caddyfile.example /etc/caddy/Caddyfile
```

The Caddyfile listens on HTTP port 8081 and proxies to the Express server:

```
http://homeware.anselbrandt.net:8081 {
    reverse_proxy localhost:3000
}
```

No TLS configuration is needed — the Cloudflare Tunnel terminates TLS at the edge and forwards traffic to Caddy over HTTP.

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
| homeware.anselbrandt.net    | http://localhost:8081  |

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
Internet (HTTPS)
  → Cloudflare CDN (homeware.anselbrandt.net)
    → Cloudflare Tunnel (cloudflared on Pi)
      → Caddy (http://localhost:8081)
        → Express server (http://localhost:3000)
```

## Updating the code

```bash
cd ~/dev/wemo-cli
git pull
npm install
sudo systemctl restart wemo-server
```

The restart is required for scheduler and server changes, since both now live in
the long-running service. `schedule.json` and `devices.json` are gitignored, so a
pull never clobbers your schedule or the device registry.

## Troubleshooting

### Server won't start

```bash
journalctl -u wemo-server -n 50
```

Common issues:
- Wrong Node.js path in the service file after an nvm upgrade
- Port 3000 already in use

### Lights not switching on schedule

```bash
# Is the scheduler running at all? Expect "Scheduler started" at boot.
journalctl -u wemo-server | grep -iE 'scheduler|schedule|error|failed'

# What does the server think the schedule is?
curl -s localhost:3000/schedule

# Is the clock/timezone right? Times are applied in LOCAL time.
timedatectl

# Test the control path manually
tsx /home/ansel/dev/wemo-cli/on.ts
```

If an event fires **twice**, stale cron entries are still present — check
`crontab -l` and remove any `on.ts`/`off.ts` lines.

### Devices not discovered

Wemo devices use SSDP multicast on the local network. Ensure:
- Pi and Wemo plugs are on the same network/VLAN
- No firewall blocking UDP multicast (port 1900)

### Cloudflare Tunnel not connecting

```bash
journalctl -u cloudflared -n 50
```

Check that the tunnel token is correct and the tunnel is active in the Cloudflare dashboard.
