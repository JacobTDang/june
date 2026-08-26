# Audio downloads: the residential tunnel

How june's audio server gets music, why it breaks, and how to set up the
Proxmox tunnel that stops it breaking.

## The problem

mp3server runs on an Oracle Cloud box. Its IP is **flagged by YouTube**, so
yt-dlp there cannot extract anything at all:

```
ERROR: [youtube] <id>: Sign in to confirm you're not a bot.
```

The documented workaround is to give it exported YouTube cookies, which makes
it look like a signed-in browser. That works, but the session behind those
cookies lapses every few weeks with no warning, and the only symptom inside
june is **a track sitting at 0:00** while previously-downloaded tracks keep
playing. The room's clock only starts once a stream link mints, so a failed
download leaves it null and the progress bar reads a literal zero.

A residential IP extracts the same video with **no cookies at all**. So rather
than refreshing an expiring credential forever, the box borrows a home IP
through a reverse SOCKS tunnel.

```
mp3server worker (Oracle)  ──socks5h──▶  tunnel host (home)  ──▶  YouTube
        │                                        ▲
        └── falls back to cookies ───────────────┘  when the tunnel is down
```

### Things that do NOT fix it

All tested against the flagged IP — don't spend time re-trying these:

| Attempt | Result |
| --- | --- |
| Newer yt-dlp | A version six weeks newer failed identically. |
| PO token provider (`bgutil-ytdlp-pot-provider`) | Plugin registered, provider healthy, **zero token requests logged** — YouTube rejects before a PO token is relevant. Also failed on the `tv`, `android_vr`, `web_embedded`, `mweb`, `tv_embedded` and `ios` clients. |
| Harvesting cookies from a live browser (`--cookies-from-browser`) | Rejected with "The page needs to be reloaded" — Chrome rotates the session out from under the snapshot. The export step cannot be automated. |

## Why Proxmox rather than a laptop

The tunnel was first run from a MacBook via launchd. It worked, but a laptop
sleeps, and the log tells the story:

```
[08-24 18:21] ok          — working (via the home-IP tunnel)
[08-25 01:48] blocked     — YouTube is blocking downloads
[08-25 13:44] unreachable — can't reach the box over SSH
```

Overnight the tunnel went away with the lid, and the fallback was a dead cookie
jar. An always-on box at home has the same residential IP and doesn't sleep, so
it turns a daytime fix into a real one.

## Setup

### 1. Create the container

A minimal Debian or Ubuntu LXC is plenty — this is a single `ssh` process.

- **Cores** 1, **RAM** 512 MB, **Disk** 4 GB
- Unprivileged, start at boot, static IP or DHCP reservation
- Install `openssh-client` if the template lacks it

### 2. Install the tunnel

Copy the three files below onto the container, then:

```bash
chmod +x install.sh clear-stale-forward.sh
./install.sh
```

`install.sh` creates an unprivileged `tunnel` user, generates an SSH key, and
prints the public key. Authorise it on the audio box:

```bash
ssh ubuntu@147.224.213.182 'echo "<the printed key>" >> ~/.ssh/authorized_keys'
```

Re-run `./install.sh`. It installs and starts the service.

### 3. Retire the laptop tunnel

Both machines share one public IP, so leaving the old one running means they
fight over port 1080 and produce exactly the orphaned-forward failure described
below. On the Mac:

```bash
launchctl bootout gui/$UID/com.jacobdang.june-audio-tunnel
rm ~/Library/LaunchAgents/com.jacobdang.june-audio-tunnel.plist
```

### 4. Verify

```bash
# on the Proxmox container
systemctl status june-audio-tunnel

# on the audio box — should show 172.18.0.1:1080, not 127.0.0.1
ssh ubuntu@147.224.213.182 'sudo ss -tlnp | grep 1080'

# end to end: should print a title, with no cookies involved
ssh ubuntu@147.224.213.182 'cd ~/mp3server && sudo docker compose exec -T worker python -c "
from mp3server import ytdl
from mp3server.config import get_settings
s = get_settings()
print(ytdl.probe(\"https://youtu.be/jNQXAC9IVRw\", None, ytdl.proxy_if_reachable(s.ytdl_proxy)).title)
"'
```

## Host configuration this depends on

Both already applied to the Oracle box, with backups. Listed because they are
invisible until something breaks, and neither is obvious.

**1. sshd must permit non-loopback binds.** Otherwise the tunnel silently binds
`127.0.0.1` regardless of what the client asks for, and containers can't reach
it.

```
GatewayPorts clientspecified     # /etc/ssh/sshd_config
```

**2. The firewall must allow the Docker bridge to reach port 1080.** Oracle's
default INPUT chain ends in `REJECT --reject-with icmp-host-prohibited`, which
surfaces inside the worker as `OSError: [Errno 113] No route to host`.

```bash
sudo iptables -I INPUT 1 -i br-<id> -s 172.18.0.0/16 -p tcp --dport 1080 -j ACCEPT
sudo netfilter-persistent save        # or it's gone on reboot
```

**3. mp3server needs the proxy configured** in its `.env`:

```
YTDL_PROXY=socks5h://172.18.0.1:1080
```

## The orphaned-forward failure

Worth understanding, because it looks like everything is fine.

If the tunnel drops badly, the remote `sshd` can keep port 1080 bound after its
client is gone. That socket **still accepts TCP connections** but carries no
traffic. A liveness check that only opens a socket therefore reports a dead
tunnel as healthy, every job goes through it and times out, and the cookie
fallback never engages.

Two defences, both in place:

- `ytdl.proxy_if_reachable` completes the **SOCKS5 greeting** and requires a
  version byte back, which an abandoned forward cannot produce.
- `clear-stale-forward.sh` runs before each dial and kills any leftover holder.

Symptom if you ever see it: `Unable to download API page: timed out` rather
than the usual bot-check message, plus `remote port forwarding failed for
listen port 1080` in the tunnel's own log.

## Cookies are still the fallback

Keep a valid jar on the box. When the tunnel is down — home internet out, LXC
stopped — downloads fall back to it. Refresh with
`mp3server/scripts/refresh-cookies.sh`, which validates the new jar against the
**server's** IP before installing it; validating locally proves nothing,
because a home IP extracts fine with no cookies at all.

Export from an **incognito window** and close it **without signing out** —
signing out invalidates the session server-side and kills the file you just
saved.

## Monitoring

`~/.claude/automations/mp3server-cookies/check.sh` probes four times a day and
notifies only on change, distinguishing `(via the home-IP tunnel)` from
`(tunnel down, using cookies)`. Once the tunnel lives on Proxmox an alert is
real signal rather than "laptop closed".

---

## Appendix: the files

### `june-audio-tunnel.service`

```ini
[Unit]
Description=Reverse SOCKS tunnel lending mp3server this site's residential IP
# The Oracle box's IP is flagged by YouTube and cannot extract without a cookie
# session that lapses every few weeks. A residential exit needs no credential at
# all, so mp3server sends every yt_dlp call back out through this tunnel.
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=tunnel
# In a script, not inline: systemd runs no shell, so $VAR here would be
# expanded by systemd (to empty) rather than by the remote shell.
ExecStartPre=/usr/local/bin/clear-stale-forward.sh
ExecStart=/usr/bin/ssh -N \
  -o BatchMode=yes \
  -o ExitOnForwardFailure=yes \
  -o ServerAliveInterval=30 \
  -o ServerAliveCountMax=3 \
  -o ConnectTimeout=15 \
  -o StrictHostKeyChecking=accept-new \
  -R 172.18.0.1:1080 \
  ubuntu@147.224.213.182
# ServerAliveInterval is what turns a silently dead link into an actual exit
# instead of a process hanging while looking healthy; Restart brings it back.
Restart=always
RestartSec=15

[Install]
WantedBy=multi-user.target
```

### `clear-stale-forward.sh`

```bash
#!/usr/bin/env bash
# Clear an orphaned reverse forward on the audio box before dialling a new one.
#
# A dropped link can leave the remote sshd still holding port 1080 after its
# client is gone. The port then looks taken so every redial fails, and worse,
# the abandoned socket still ACCEPTS connections while carrying no traffic --
# so the far end reads it as a healthy proxy and never falls back. Observed in
# production; this is why the reconnect clears the way first.
#
# Always exits 0: nothing to clear is the normal case, not a failure.
BOX="${BOX:-ubuntu@147.224.213.182}"
ssh -o BatchMode=yes -o ConnectTimeout=10 "$BOX" '
  PID=$(sudo ss -tlnp 2>/dev/null | grep ":1080" | grep -o "pid=[0-9]*" | head -1 | cut -d= -f2)
  if [ -n "$PID" ]; then sudo kill "$PID" 2>/dev/null; echo "cleared stale forward $PID"; fi
' 2>/dev/null || true
exit 0
```

### `install.sh`

```bash
#!/usr/bin/env bash
# Run this ON the Proxmox LXC/VM that will hold the tunnel.
set -euo pipefail

BOX="${BOX:-ubuntu@147.224.213.182}"

echo "==> dedicated unprivileged user (the tunnel needs no rights here)"
id tunnel &>/dev/null || sudo useradd -r -m -s /bin/bash tunnel

echo "==> ssh key"
sudo -u tunnel test -f ~tunnel/.ssh/id_ed25519 || \
  sudo -u tunnel ssh-keygen -t ed25519 -N "" -f ~tunnel/.ssh/id_ed25519

echo
echo "==> Add THIS public key to the Oracle box, then re-run:"
sudo cat ~tunnel/.ssh/id_ed25519.pub
echo
if ! sudo -u tunnel ssh -o BatchMode=yes -o ConnectTimeout=10 "$BOX" true 2>/dev/null; then
  echo "   Not authorised yet. On a machine that can already reach the box:"
  echo "     ssh $BOX 'echo \"<the key above>\" >> ~/.ssh/authorized_keys'"
  exit 1
fi
echo "   key works."

echo "==> installing service"
sudo install -m 755 clear-stale-forward.sh /usr/local/bin/
  sudo cp june-audio-tunnel.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now june-audio-tunnel
sleep 5
sudo systemctl status june-audio-tunnel --no-pager | head -6
```
