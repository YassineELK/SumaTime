#!/usr/bin/env python3
"""Store the production Entra secret through a masked SSH terminal; never enable SSO."""
import datetime
import getpass
import os
from pathlib import Path
import shutil
import stat
import sys
import uuid

if os.geteuid() != 0:
    sys.exit('Run this helper as root on the SumaTime production server.')
if not sys.stdin.isatty():
    sys.exit('Use an interactive SSH terminal (ssh -t); no secret accepted through pipes.')
configuration = Path('/etc/sumatoni-time/sumatoni.env')
if not configuration.is_file() or configuration.is_symlink():
    sys.exit('Expected existing production configuration not found.')
metadata = configuration.stat()
if stat.S_IMODE(metadata.st_mode) & 0o007:
    sys.exit('Configuration permissions must prohibit access by other users.')
secret = getpass.getpass('Valeur du secret client Entra (saisie masquee) : ')
if not secret or len(secret) > 4096 or any(ord(c) < 32 or ord(c) == 127 for c in secret):
    sys.exit('Secret empty or invalid; configuration unchanged.')
os.umask(0o077)
stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
backup = Path('/var/backups/sumatoni-time') / ('entra-configuration-' + stamp + '-' + uuid.uuid4().hex[:8])
backup.mkdir(mode=0o700)
shutil.copyfile(configuration, backup / 'sumatoni.env')
os.chmod(backup / 'sumatoni.env', 0o600)
# systemd EnvironmentFile uses quoted values and does not expand shell variables.
quoted = '"' + secret.replace('\\', '\\\\').replace('"', '\\"') + '"'
lines = configuration.read_text().splitlines()
result = []
for line in lines:
    key = line.split('=', 1)[0].strip() if '=' in line and not line.lstrip().startswith('#') else None
    if key not in ('ENTRA_CLIENT_SECRET', 'ENTRA_ENABLED'):
        result.append(line)
result.extend(['ENTRA_CLIENT_SECRET=' + quoted, 'ENTRA_ENABLED=false'])
temporary = configuration.with_name('.sumatoni.env.' + uuid.uuid4().hex)
try:
    with temporary.open('x') as handle:
        handle.write('\n'.join(result) + '\n')
        handle.flush()
        os.fsync(handle.fileno())
    os.chmod(temporary, stat.S_IMODE(metadata.st_mode))
    os.chown(temporary, metadata.st_uid, metadata.st_gid)
    os.replace(temporary, configuration)
finally:
    if temporary.exists():
        temporary.unlink()
print('Secret enregistre. Microsoft reste desactive; aucun redemarrage effectue.')
