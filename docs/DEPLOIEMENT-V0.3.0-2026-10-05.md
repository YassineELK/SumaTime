# Sumatoni Time v0.3.0 — production

Déployée le 5 octobre 2026 à 09:52 Europe/Brussels sur 192.168.87.224, https://sumatime.home.sumatoni.be.

- Commit du paquet : `03b1dc724516fc3f04353318d735dde025381027` ; code applicatif validé : `ca215a766175fc343991b2e3ef7026ae439211af`.
- BUILD_ID : `5YontI78VaYkcPanJezEr`.
- SHA-256 du paquet : `f1c843441dc3ff2cd5b5c708ff38720219d9534d8f566e72289f287423f96ea5`.
- Release active : `/opt/sumatoni-time/releases/v0.3.0` ; précédente : `/opt/sumatoni-time/releases/v0.2.2`.
- Recette du code final : 70 tests unitaires/DOM, TypeScript, build, 199 assertions API, 212 prestataire, 101 R2 et 26 Round14, tous PASS. Logs CT-ANT : `/tmp/sumatime-prod-gates-20261005/`.
- Migration sur copie privée de la sauvegarde : intégrité/FK conformes, données métier identiques, saisie 09:07–09:22 et suppression de la prestation de recette vérifiées. GLPI réel désactivé pendant cette recette.
- Sauvegarde finale avant bascule : `/var/backups/sumatoni-time/2026-10-05T07-52-27.732Z` ; empreintes vérifiées.
- Sauvegarde après migration : `/var/backups/sumatoni-time/2026-10-05T07-53-21.864Z`.
- Après bascule : HTTPS validé avec le certificat configuré, 8 assets identiques au build, APIs anonymes refusées, SQLite intègre/FK vides, toutes les colonnes et données préexistantes comparées à la sauvegarde. Un compte, deux clients, sept prestations et un jeton GLPI conservés. Aucun ticket GLPI réel créé par la recette.
- Preuves serveur : `/root/sumatoni-deploy/v0.3.0-20261005/deployment-result.json`, `migration-validation.json`, `rollback.json`.

## Retour arrière

Arrêter `sumatoni-time` et conserver toute donnée saisie depuis la bascule avant restauration. Conserver séparément la base migrée et ses fichiers WAL/SHM. Remettre ensemble base, clé GLPI et configuration de la sauvegarde finale vérifiée ci-dessus ; fixer les droits de service. Retirer le complément `runtime-v03.conf`, rétablir le lien `current` vers v0.2.2, lancer `systemctl daemon-reload`, redémarrer et vérifier HTTPS, connexion et données. Une restauration de la sauvegarde pré-déploiement n’inclut pas les saisies postérieures : les réconcilier avant toute opération de restauration.

Le GLPI réel reste celui de production. Les clients copiés n’avaient pas d’association d’entité : l’administrateur doit les associer dans Clients pour sélectionner/créer leurs tickets. L’option À compléter permet de saisir les prestations en attendant.
