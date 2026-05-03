# Deployment runbook (Ubuntu + systemd + nginx)

This project can run in a single Node.js process:
- `@cac/server` serves the API (`/api/*`), project files (`/projects/*`), and (optionally) the built web UI.

## 1) Build once

```bash
pnpm install
pnpm build
```

## 2) Configure environment

Create `.env` (keep it private; do not commit it):

```bash
cp .env.example .env
```

Recommended production-ish settings:
- `HOST=127.0.0.1` (bind locally; nginx proxies)
- `PORT=5174`
- `SERVE_WEB=1` (serve `packages/web/dist` from the same process)

## 3) systemd service (user or root)

Example (system-level) unit: `/etc/systemd/system/creative-agentic-cms.service`

```ini
[Unit]
Description=Creative Agentic CMS
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/srv/creative-agentic-cms
ExecStart=/usr/bin/node --env-file=/srv/creative-agentic-cms/.env /srv/creative-agentic-cms/packages/server/dist/index.js
Restart=on-failure
RestartSec=2

# Ensure Node finds the right binaries
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

Enable + start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now creative-agentic-cms.service
sudo systemctl status creative-agentic-cms.service
```

Logs:

```bash
sudo journalctl -u creative-agentic-cms.service -f
```

## 4) nginx reverse proxy

Example server block (HTTP only, add TLS as needed):

```nginx
server {
  listen 80;
  server_name example.com;

  client_max_body_size 10m;

  location / {
    proxy_pass http://127.0.0.1:5174;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

Reload nginx:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

## 5) Backups

Back up the `projects/` directory (it contains `page.json`, `assets/`, and export output per project).

Create an archive (keeps the newest 14 by default):

```bash
KEEP=14 DATA_DIR=./projects ./scripts/backup-projects.sh ./backups
```

Example cron (daily at 03:15 UTC):

```cron
15 3 * * * cd /srv/creative-agentic-cms && KEEP=14 DATA_DIR=./projects ./scripts/backup-projects.sh ./backups >/dev/null 2>&1
```
