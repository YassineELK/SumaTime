# SumaTime v0.4.5 — mise en production du 21 octobre 2026

Mise en production autorisée par le propriétaire après validation de la prévisualisation. Bascule et contrôles terminés vers 13:21, heure de Bruxelles, le 21 octobre 2026, sur https://sumatime.home.sumatoni.be.

## Version livrée

- Source canonique CT-ANT : `/srv/projects/applications/timesheet`, branche `codex/ticket-titles`.
- Code livré : `3de7c05fdaf4991a5d609ec828f008ff4ee83de3`, version stable 0.4.5, build `TEOCxED3P55PJwaeCV5Zj`.
- Release active : `/opt/sumatoni-time/releases/v0.4.5-ticket-titles-3de7c05`, sélectionnée par `/opt/sumatoni-time/current`.
- Archive sans données ni secrets : `sumatime-v0.4.5-ticket-titles.tar.gz`, SHA-256 `92446608fa296a64de2fdff452889598b54fdf4d80a12906539f0971b4bf9239`.
- 3150 fichiers runtime vérifiés avant installation ; 39 ressources publiques comparées octet pour octet après bascule HTTPS.
- Promotion de la préversion validée `0.4.5-dev.1` : aucun changement fonctionnel ; seuls le numéro de version et le journal de version ont changé avant reconstruction du paquet stable.

Fonctions livrées : titres GLPI vérifiés conservés avec les prestations et chronos ; numéro et intitulé visibles dans Prestations et recherche par titre ; relevé client anonyme à sept colonnes ; récupération explicite des titres historiques avec les accès GLPI personnels. Les exports de contrôle prestataire restent distincts des relevés destinés au client. Voir [les itérations et règles métier](TITRES-TICKETS-DEV-2026-10-21.md).

## Sauvegardes et conservation des données

- Sauvegarde fraîche avant bascule : `/var/backups/sumatoni-time/2026-10-21T11-21-29.217Z`.
- Sauvegarde après bascule : `/var/backups/sumatoni-time/2026-10-21T11-21-32.699Z`.
- SQLite, clé GLPI et environnement sauvegardés ; manifestes terminés, empreintes contrôlées, intégrité SQLite conforme, aucune erreur de clé étrangère.
- Preuves/scripts privés : `/root/sumatoni-deploy/v0.4.5-ticket-titles-20261021/`.

La base active reste `/var/lib/sumatoni-time/timesheet.sqlite` ; elle n'a pas été remplacée par une base de développement. Après migration, les valeurs de toutes les anciennes colonnes des 21 tables ont été comparées intégralement à la sauvegarde : identiques. Seules deux colonnes nullable `ticket_title` sont ajoutées à `entries` et `work_timers` (migration 0012). Aucun titre n'est inventé et aucune récupération historique n'est lancée automatiquement.

État après bascule : 5 membres, 1 compte local, 2 clients, 23 prestations, 4 connexions GLPI, aucun tarif prestataire initialisé arbitrairement. Les horaires, modes, tickets historiques, prix clients, états de facturation, comptes et rattachements Microsoft sont conservés. Après contrôles, les lignes métier antérieures restent présentes. Environnement Microsoft et clé GLPI inchangés octet pour octet par rapport à la sauvegarde. Aucun rôle réel modifié.

## Vérifications

Les tests de la préversion validée couvraient 54 tests unitaires/DOM et les recettes : 40 assertions titres/historique, 201 métier, 255 prestataire/GLPI, 77 confidentialité/rémunération, 25 rôles et 718 contrôles Entra/OIDC/Graph simulés. La version stable reconstruite a de nouveau passé les 40 assertions titres/historique, les 201 assertions métier et les 77 assertions confidentialité/rémunération sur bases isolées.

Le runtime stable exact a été lancé sous le compte de service sur une copie privée de la base de production avant bascule. Contrôle Graph réel de l'administrateur et d'un prestataire, session locale de secours, export client non vide à sept colonnes, tarifs clients masqués au prestataire et enrichissement de prestations tierces refusé : conformes. Les colonnes originales des 17 tables métier non transitoires de la copie sont conservées. Les sessions synthétiques ont été supprimées de cette copie après arrêt du processus. Aucun jeton GLPI n'a été utilisé pour une récupération de titre pendant cette vérification.

Après bascule : SumaTime et Nginx actifs, HTTPS vérifié avec le certificat existant sans contournement TLS ; réponses anonymes refusées sur les API, y compris POST `/api/ticket-titles` (401). Démarrage OIDC réel contrôlé (tenant, client, callback, PKCE S256, sélection de compte, cookie Secure), puis annulation et consommation du seul flux de vérification, sans création de session. Aucune nouvelle connexion humaine au mot de passe ou à Microsoft n'est revendiquée.

## Utilisation et retour arrière

Actualiser le navigateur pour charger les nouvelles ressources. Pour les anciennes prestations dont le titre est absent : Prestations → filtrer la période → « Compléter les intitulés manquants ». La récupération utilise l'accès GLPI personnel ; les titres inaccessibles restent explicitement non disponibles. Le relevé client exige un client précis et l'application des filtres.

Un retour automatique au code précédent était prévu en cas d'échec ; aucun retour n'a été nécessaire. En récupération manuelle, arrêter brièvement le service, sélectionner `/opt/sumatoni-time/releases/v0.4.4-provider-rates-7e81ea0`, puis redémarrer en conservant la base courante et la configuration. Les colonnes ajoutées peuvent rester présentes. Ne pas restaurer une ancienne base : les prestations et décisions plus récentes seraient perdues. L'ancien code n'afficherait plus les titres et reviendrait à l'ancien format d'export client.

La prévisualisation CT-ANT reste séparée, en `0.4.5-dev.1` sur http://192.168.10.131:5174 ; aucune base de production n'a été copiée sur CT-ANT pour ce déploiement.
