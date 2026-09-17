# Sumatoni Time sur Ubuntu

## Installation déployée

Adresse : https://sumatime.home.sumatoni.be — serveur 192.168.87.224, Ubuntu 24.04 dans un conteneur LXC Proxmox. Version applicative 0.2.1, Node.js 24.21.0. Base initialement vide à la demande du propriétaire : aucune donnée du poste de développement transférée.

| Élément | Emplacement |
| --- | --- |
| Sources et dépendances | `/opt/sumatoni-time/releases/v0.2.1` |
| Version active | `/opt/sumatoni-time/current` (lien symbolique) |
| Configuration | `/etc/sumatoni-time/sumatoni.env` |
| Base SQLite | `/var/lib/sumatoni-time/timesheet.sqlite` |
| Code du premier administrateur | `/var/lib/sumatoni-time/setup-token.txt` |
| Cache Next.js | `/var/cache/sumatoni-time/next` |
| Certificat et clé privée | `/etc/sumatoni-time/tls/` |
| Sauvegardes | `/var/backups/sumatoni-time/` |

L'application fonctionne sous le compte système `sumatoni-time`, écoute uniquement sur `127.0.0.1:5173` et ne peut écrire que dans ses répertoires de données et de cache ainsi que son répertoire temporaire. Nginx expose HTTPS sur 443 et redirige HTTP sur 80. Les sources appartiennent à root. Le compte système ne dispose pas d'un shell interactif.

## Premier accès

Depuis le serveur, en root, lire le code d'installation :

```sh
cat /var/lib/sumatoni-time/setup-token.txt
```

Ouvrir l'adresse HTTPS, saisir ce code et créer le compte administrateur avec son adresse e-mail et un mot de passe d'au moins 12 caractères. Ce code ne permet plus de créer un administrateur après la création du premier compte. Aucun mot de passe administrateur prédéfini n'est installé. Les partenaires sont ensuite créés dans l'administration.

Le certificat est **autosigné**, conformément au choix du propriétaire. Le fichier public `outputs/sumatime.home.sumatoni.be.cer` peut être distribué aux postes autorisés. Windows permet son importation dans le magasin des certificats de confiance du compte utilisateur ; les autres appareils doivent aussi lui accorder explicitement confiance. Vérifier son empreinte avant l'importation. Ne jamais distribuer `privkey.pem`.

- Noms couverts : `sumatime.home.sumatoni.be` et IP `192.168.87.224`.
- Expiration : **17 septembre 2027 à 11:56:40 UTC**.
- Empreinte SHA-256 : `98:E5:ED:E4:C7:B8:0F:45:21:B6:0C:95:BC:2C:59:F7:71:4B:50:D9:45:8D:23:8C:78:0C:87:26:8D:1A:B9:F1`.

Le renouvellement n'est pas automatique. Remplacer le certificat avant cette date, puis `nginx -t && systemctl reload nginx`. Un nouveau certificat autosigné devra être approuvé à nouveau sur les postes.

## Services et diagnostic

```sh
systemctl status sumatoni-time nginx
journalctl -u sumatoni-time -n 100 --no-pager
systemctl restart sumatoni-time
systemctl list-timers sumatoni-time-backup.timer
nginx -t
```

Les modèles de configuration sont dans `deploy/linux/`. Le fichier d'environnement configure `APP_URL=https://sumatime.home.sumatoni.be`, `DATABASE_PATH=/var/lib/sumatoni-time/timesheet.sqlite` et `LDAP_ENABLED=false`. Il doit rester root:sumatoni-time avec des droits 0640. Voir `INSTALLATION-WINDOWS.md` pour les paramètres AD/LDAP et `docs/GLPI.md` pour GLPI : les variables applicatives sont identiques sous Linux. Les services réels AD et GLPI doivent encore être configurés et validés.

## Sauvegarde et restauration

Le timer lance chaque jour une sauvegarde entre **02:15 et 02:20 UTC**, avec rattrapage après un arrêt. Elle utilise l'API de sauvegarde SQLite, contrôle l'intégrité et enregistre les compteurs et les empreintes SHA-256. Elle inclut la clé GLPI si présente et la configuration applicative. Une sauvegarde comportant des jetons GLPI sans leur clé n'est pas marquée complète.

```sh
systemctl start sumatoni-time-backup.service
journalctl -u sumatoni-time-backup.service -n 30 --no-pager
```

Chaque sauvegarde est un dossier privé contenant `timesheet.sqlite`, `manifest.json`, `sumatoni.env` et, si présente, `glpi-key`. Seuls les dossiers dont le manifeste contient `completed: true` sont utilisables. Vérifier toutes les empreintes du manifeste avant restauration et effectuer un `PRAGMA integrity_check` sur la copie. Les sessions présentes dans une sauvegarde peuvent être encore valides : les supprimer avant remise en service après une restauration.

Pour restaurer : arrêter `sumatoni-time`, conserver une copie de l'état actuel, déplacer ensemble la base et ses éventuels fichiers `-wal` et `-shm` hors du répertoire actif, copier la base de sauvegarde et la clé GLPI associée, restaurer la configuration appropriée, fixer propriétaire `sumatoni-time:sumatoni-time` et droits 0600 sur base/clé, puis redémarrer et vérifier connexion, clients et prestations. Ne jamais mélanger la clé GLPI d'une autre installation ni d'anciens fichiers WAL avec une base restaurée. La clé TLS n'est pas comprise dans ces sauvegardes ; elle doit être sauvegardée séparément ou le certificat régénéré.

**À compléter pour l'exploitation :** copie automatique vers un stockage hors serveur, politique de rétention, alerte en cas d'échec et suivi de l'espace disque. Les sauvegardes locales seules ne protègent pas contre la perte du serveur. Aucun effacement automatique de sauvegardes n'est configuré.

## DNS et infrastructure

Le DNS demandé est `192.168.10.111`. Après correction réseau et nouveau contrôle le 17 septembre 2026, les requêtes DNS UDP et TCP depuis Ubuntu réussissent. Le résolveur système, resté sur le DNS public de secours après les échecs initiaux, a été redémarré : `resolvectl` et `getent` renvoient bien `192.168.87.224` pour `sumatime.home.sumatoni.be`. La résolution externe et l'accès HTTPS par nom depuis Ubuntu sont également vérifiés. La connexion AD réelle reste à configurer et à tester séparément.

La configuration est placée dans `/etc/resolv.conf` et `/etc/systemd/resolved.conf.d/sumatoni.conf`. Le fichier `/etc/.pve-ignore.resolv.conf` empêche Proxmox de rétablir son ancien DNS au redémarrage ; aligner également la configuration DNS du conteneur dans Proxmox avant de retirer ce fichier. Le DNS public de secours préexistant est conservé.

Le système présentait avant déploiement un échec du service `proxmox-regenerate-snakeoil.service` et des mises à jour Ubuntu en attente. Le certificat de cette application est indépendant. Planifier le traitement de ces points et la maintenance système avec l'administrateur Proxmox.

## Mettre à jour

Créer un nouveau répertoire versionné, installer les dépendances avec `npm ci`, compiler et tester sur une base isolée, puis sauvegarder la production avant de basculer le lien `current` et redémarrer le service. Préparer le cache comme dans la version déployée et rendre les sources non modifiables par le compte applicatif. Une migration de schéma peut empêcher un simple retour au code précédent : utiliser une sauvegarde cohérente, application et base, après analyse de la compatibilité.

Avis de sécurité corrigé : https://github.com/advisories/GHSA-w5vr-8v7q-w6rv
