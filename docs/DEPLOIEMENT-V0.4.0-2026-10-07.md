# SumaTime v0.4.0 — pilote Entra en production

Déploiement autorisé par le propriétaire le 7 octobre 2026 après préparation en développement. Adresse : https://sumatime.home.sumatoni.be. L’utilisation de localhost pour la recette réelle est abandonnée au profit de cette adresse HTTPS. La configuration GLPI reste indépendante et inchangée.

## Version et preuves

- Code applicatif : `c1ba85fa70e6be201cbbf956b0881d4edc1d6d1b`, branche `codex/entra-login`.
- Version / release : `0.4.0`, `/opt/sumatoni-time/releases/v0.4.0`.
- Build : `AIif9JRXvcWdPTgoo_4p5`.
- Archive SHA-256 : `af14f86197d225d9f9927293ec16212504c1bcf8ca262d5ba605988166ed4f9e`.
- Ancienne release conservée : `/opt/sumatoni-time/releases/v0.3.3`.
- Preuves privées sur la production : `/root/sumatoni-deploy/v0.4.0-20261007/` ; manifeste, comparaison de toutes les tables avant/après, vérification HTTPS/assets et résultat du déploiement.
- Sauvegarde avant bascule : `/var/backups/sumatoni-time/2026-10-07T11-14-07.974Z`. Base SQLite, clé GLPI et configuration sauvegardées avec manifeste et empreintes vérifiées.

## Conservation et validation

La base active reste `/var/lib/sumatoni-time/timesheet.sqlite` ; aucune base de développement copiée sur la production. Toutes les valeurs des tables préexistantes sont identiques avant/après démarrage et après rattachement du pilote. Un membre, un compte local, deux clients, quatorze prestations, une connexion GLPI ; aucun chrono. `integrity_check=ok`, aucune erreur de clé étrangère. Les quatre tables Entra sont additives ; le rattachement et son audit sont les seules données nouvelles du pilote.

La release exacte a d’abord démarré sur une copie privée de la base de production, sous le compte de service, sans changement des tables existantes. Build et TypeScript réussis ; 83 tests unitaires/DOM, 354 contrôles API OIDC signés, quatre redémarrages de contrôle de configuration/secours local, 199 assertions métier et 251 prestataire/GLPI. Toutes les données de ces recettes sont isolées.

Après bascule : 2 558 fichiers runtime vérifiés au manifeste ; 37 assets servis identiques au paquet ; HTTPS vérifié avec le certificat existant ; API anonymes refusées (401). Service applicatif et Nginx actifs. Journaux d’accès SumaTime sans paramètres ni Referer ; le marqueur de contrôle placé dans une requête callback n’apparaît pas dans le journal. Ni `.env`, ni SQLite, ni clés dans le paquet.

## État du pilote Microsoft

Tenant et Client ID fournis par le propriétaire configurés ; découverte OIDC du tenant validée sur TLS. L’Object ID fourni est rattaché explicitement au seul administrateur local existant. Le rôle, le mot de passe et l’historique sont conservés.

Le secret a ensuite été saisi par le propriétaire sur le serveur, puis **Microsoft a été activé pour le pilote**. Le redémarrage a conservé toutes les données, y compris le compte local. Les vérifications HTTPS du vrai démarrage OIDC passent : tenant, client, URI de retour, PKCE S256, cookie Secure/HttpOnly/SameSite et choix de compte. Un flux de contrôle a été annulé et consommé correctement. La connexion Microsoft interactive reste à effectuer par le propriétaire ; le secret ne peut être validé réellement qu’au retour de cette connexion.

Pour installer ou renouveler le secret sans affichage dans un terminal SSH :

```powershell
ssh -t -i "$env:USERPROFILE\.ssh\sumatoni_time_deploy_ed25519" root@192.168.87.224 /usr/local/sbin/sumatime-entra-secret
```

L’outil sauvegarde la configuration dans un répertoire privé, remplace atomiquement le secret et laisse `ENTRA_ENABLED=false`. Il ne redémarre pas le service et ne transmet jamais le secret dans la conversation. Le code de référence est `deploy/linux/set-entra-secret.py`.

URI Web exacte à enregistrer dans Entra : `https://sumatime.home.sumatoni.be/api/auth/entra/callback`. La connexion Microsoft réelle et MFA restent à vérifier avec le pilote. L’accès local reste disponible. Le certificat autosigné est accepté par les contrôles serveur utilisant explicitement ce certificat, mais le navigateur intégré le refuse (`ERR_CERT_AUTHORITY_INVALID`) : effectuer le pilote dans un navigateur qui l’accepte, ou installer ultérieurement un certificat reconnu.

## Retour arrière

En cas de problème d’activation, remettre `ENTRA_ENABLED=false` dans l’environnement privé puis redémarrer le service : les sessions Microsoft sont refusées, l’accès local continue de fonctionner.

Pour revenir au code v0.3.3 : désactiver Microsoft, arrêter `sumatoni-time`, rétablir atomiquement `/opt/sumatoni-time/current` vers `/opt/sumatoni-time/releases/v0.3.3`, puis redémarrer. **Conserver la base courante** : les tables additives sont ignorées par l’ancien code. Ne restaurer une ancienne base qu’en cas de corruption avérée et en tenant compte des saisies ultérieures. L’ancien fichier Nginx est conservé dans le dossier de preuves ; le nouveau journal sans paramètres peut rester en place.
