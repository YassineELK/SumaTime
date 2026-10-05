# Sumatime v0.3.1 — correctif GLPI en production

Version active le 5 octobre 2026 sur https://sumatime.home.sumatoni.be, serveur 192.168.87.224.

## Comportement corrigé

La recherche et la validation des tickets activent les entités autorisées au profil GLPI personnel courant. Le profil n'est pas changé automatiquement. Dans le cas contrôlé, le profil Admin conserve ses droits sur la racine et Salarypay (entité 2), sans utiliser le profil Super-Admin également attribué au compte.

Le filtre initial utilise le statut natif GLPI `notclosed` : Résolu (5) est inclus ; Clos (6) est ajouté seulement avec « Inclure les clos » ou « Tous les tickets ». La création conserve son contexte d'entité client et ses contrôles existants.

## Version livrée

- Commit et tag : `2c6712cfb2b7d249b1b0efca464b4240f55100b9`, `v0.3.1`.
- BUILD_ID : `_k1tas_UJt_pX_NH8HB5g`.
- SHA-256 du paquet : `99e3fe967c76352e37c80e0e169b6a5041a858da9deb2036e4d26fb3c24c8b95`.
- Release active : `/opt/sumatoni-time/releases/v0.3.1` ; précédente : `/opt/sumatoni-time/releases/v0.3.0`.
- Build isolé du commit exact : `/tmp/sumatime-v031-clean` ; paquet : `/tmp/sumatime-v031-clean-release/sumatime-v0.3.1.tar.gz`.
- Les modifications de charte présentes en parallèle dans le dossier de développement sont conservées et n'ont pas été livrées dans ce correctif. Le premier paquet construit sur ce dossier partagé a été remplacé avant activation.

## Validation

La version isolée passe 74 tests unitaires/DOM, TypeScript et le build ; 199 assertions API, 220 prestataire, 101 R2 et 26 Round14. Logs : `/tmp/sumatime-v031-clean-qa/`. Les dernières recettes sont exécutées une à une avec des ports dédiés pour le harnais API/prestataire.

Après bascule : HTTPS validé avec le certificat configuré ; 34 assets servis identiques au paquet ; API Time, Workday et GLPI anonymes refusées (401). Le test sur GLPI réel retrouve le ticket 1141, Résolu, entité 2 / Salarypay, avec le filtre initial et le profil Admin. Aucun ticket réel n'a été créé ou modifié par la recette.

Sauvegarde vérifiée avant bascule : `/var/backups/sumatoni-time/2026-10-05T15-10-16.290Z`. Les empreintes des tables métier avant/après démarrage sont identiques, l'intégrité SQLite est conforme et aucune FK n'est invalide : un compte, deux clients, huit prestations et un jeton personnel GLPI conservés. Aucune migration de données dans cette version.

Preuves privées serveur : `/root/sumatoni-deploy/v0.3.1-20261005/` (`deployment.log`, `deployment-result.json`, `data-before.json`, `data-after.json`, `verification.json`, `live-glpi-after.json`).

## Retour arrière

Pour revenir au code v0.3.0, arrêter `sumatoni-time`, rétablir atomiquement le lien `/opt/sumatoni-time/current` vers `/opt/sumatoni-time/releases/v0.3.0` et redémarrer le service. Cette version ne changeant pas le schéma, conserver la base courante et ses données. La restauration de la sauvegarde antérieure n'est pas nécessaire pour ce retour au code précédent et supprimerait les éventuelles saisies postérieures si elle était effectuée sans réconciliation.
