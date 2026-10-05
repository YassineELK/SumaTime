#!/bin/bash
set -eu
source=$(readlink -f /srv/projects/applications/timesheet)
target=/opt/sumatime-preview/releases/v0.3.0
[ -f "$source/.next/standalone/server.js" ]
[ -f /var/lib/sumatime-preview/timesheet.sqlite ]
[ ! -e "$target" ]
if ! id sumatime-preview >/dev/null 2>&1; then useradd --system --user-group --home-dir /var/lib/sumatime-preview --shell /usr/sbin/nologin sumatime-preview; fi
install -d -o root -g sumatime-preview -m 0750 /opt/sumatime-preview /opt/sumatime-preview/releases "$target" /etc/sumatime-preview
install -d -o sumatime-preview -g sumatime-preview -m 0700 /var/lib/sumatime-preview /var/cache/sumatime-preview
(cd "$source/.next/standalone" && tar --exclude='.env*' -cf - .) | (cd "$target" && tar -xf -)
install -d "$target/.next/static" "$target/public" "$target/drizzle"
cp -a "$source/.next/static/." "$target/.next/static/"
cp -a "$source/public/." "$target/public/"
cp -a "$source/drizzle/." "$target/drizzle/"
if [ ! -e "$target/.next/cache" ]; then ln -s /var/cache/sumatime-preview "$target/.next/cache"; fi
chown -R root:sumatime-preview "$target"
chmod -R go-w "$target"
ln -s "$target" /opt/sumatime-preview/current
chown sumatime-preview:sumatime-preview /var/lib/sumatime-preview/timesheet.sqlite
chmod 0600 /var/lib/sumatime-preview/timesheet.sqlite
install -m 0644 "$source/tests/glpi-mock.mjs" /opt/sumatime-preview/glpi-mock.mjs
install -m 0644 "$source/deploy/linux/preview-mock.mjs" /opt/sumatime-preview/preview-mock.mjs
umask 027
cat > /etc/sumatime-preview/preview.env <<'ENV'
NODE_ENV=production
NEXT_TELEMETRY_DISABLED=1
HOSTNAME=127.0.0.1
PORT=5174
APP_URL=http://localhost:18787
DATABASE_PATH=/var/lib/sumatime-preview/timesheet.sqlite
LDAP_ENABLED=false
GLPI_API_URL=http://127.0.0.1:8792/apirest.php
GLPI_APP_TOKEN=mock-app-token
GLPI_WRITE_ENABLED=true
SUMATONI_PREVIEW=true
PREVIEW_DATA_DATE=02/10/2026
ENV
chown root:sumatime-preview /etc/sumatime-preview/preview.env
chmod 0640 /etc/sumatime-preview/preview.env
install -m 0644 "$source/deploy/linux/sumatime-preview.service" "$source/deploy/linux/sumatime-preview-glpi.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now sumatime-preview-glpi.service sumatime-preview.service
