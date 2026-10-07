# SumaTime v0.4.3 — rôles administrateur et Prestataire en production

Le propriétaire a répondu « ok mais aussi le role doit changer de nom prestataire au lieu de partenaire » à la demande explicite d’installation de la v0.4.3 en production, avec sauvegarde et conservation des données et rôles. Adaptation développée et vérifiée sur CT-ANT ; mise en production terminée le 7 octobre 2026 à 17:31, heure de Bruxelles.

Adresse : https://sumatime.home.sumatoni.be. Dans **Équipe**, un administrateur peut maintenant choisir **Rendre administrateur**, vérifier les droits et confirmer. La personne doit se reconnecter. Pour retirer les droits : **Passer en prestataire**. Voir [la procédure](GESTION-DES-ROLES.md).

## Paquet et sauvegardes

- Branche : `codex/member-roles`, code applicatif `6adc53b52a5c080812fac7122533abb63623fcaf`.
- Release active : `/opt/sumatoni-time/releases/v0.4.3-prestataire-6adc53b`, sélectionnée par `/opt/sumatoni-time/current`.
- Version 0.4.3, build `mRHPuxHoQ_DsGXBXLqLjG`, 3139 fichiers runtime comparés au manifeste.
- Archive sans données ni secrets : `sumatime-v0.4.3-prestataire.tar.gz`, SHA-256 `1bedd4d62d407d0b7312cb074c590682d0f1659a0a8f070eaf04180d16721708`.
- Sauvegarde avant première tentative : `/var/backups/sumatoni-time/2026-10-07T15-30-35.919Z`.
- Sauvegarde fraîche avant bascule finale : `/var/backups/sumatoni-time/2026-10-07T15-31-27.843Z`.
- Sauvegarde après bascule : `/var/backups/sumatoni-time/2026-10-07T15-32-42.987Z`.
- Sauvegardes SQLite, clé GLPI et environnement privées, terminées et contrôlées par empreintes ; SQLite intègre, aucune erreur de clé étrangère.
- Preuves/scripts privés : `/root/sumatoni-deploy/v0.4.3-prestataire-20261007/`. Les preuves de la première tentative sont préservées dans `attempt-1/`.

## Données et accès conservés

La base active reste `/var/lib/sumatoni-time/timesheet.sqlite`. Aucun remplacement par une base de développement ou de recette. Première migration : comparaison intégrale des 18 tables antérieures, mêmes lignes et valeurs ; seule la table d’audit vide `member_role_events` ajoutée par la migration 0010. Après le retour automatique puis la bascule finale, les 19 tables sont comparées et les lignes antérieures conservées.

État final : deux membres, un compte local, deux clients, 15 prestations et une connexion GLPI. Un administrateur et un prestataire ; aucun rôle de personne réelle modifié pendant l’installation. Identité et provenance Microsoft de Kiosk conservées. Aucun événement de rôle en production à l’issue des contrôles.

Les libellés d’équipe, profil, calendrier, filtres, aide et CSV utilisent **Prestataire**. La valeur technique `partner` reste inchangée : pas de migration des identités ni de modification des contraintes historiques. Les nouveaux comptes Microsoft restent prestataires par défaut.

Environnement Entra et clé GLPI comparés octet pour octet à la sauvegarde : inchangés. Microsoft, contrôle des attributions individuelles et création automatique restent activés. Accès local de secours et session de l’administrateur conservés. Aucun changement du SSO GLPI.

## Vérifications terminées

39 tests unitaires/DOM d’authentification, Entra et rôles ; 25 assertions API de promotion/rétrogradation, 712 assertions OIDC/Graph en simulation signée, 199 assertions métier et 251 prestataire/GLPI. Build, TypeScript, ESLint ciblé et diff conformes. Toutes ces recettes utilisent des bases distinctes.

Runtime exact de la version finale lancé sous le compte de service sur une copie privée de la base de production : Graph réel vérifie l’administrateur et refuse une identité non attribuée ; session locale de secours fonctionnelle. Promotion/rétrogradation du prestataire de cette copie : rôle appliqué et anciens jetons de session invalidés, données de prestations inchangées. Aucune connexion interactive au mot de passe du propriétaire ni nouvelle connexion humaine Kiosk revendiquée pour cette release. Kiosk avait déjà été validé par le propriétaire sur v0.4.2.

Après bascule : SumaTime et Nginx actifs ; HTTPS validé avec le certificat existant sans contournement TLS. Les 37 ressources publiques correspondent exactement au paquet. Les bundles compilés contiennent Prestataire et Rendre administrateur et ne contiennent plus le libellé Partenaire. Les API anonymes sont refusées (401). Démarrage OIDC réel vérifié : tenant/client/callback, PKCE S256, choix de compte, cookie Secure ; seul le flux de contrôle a été annulé et consommé sans création de session.

La première tentative a déclenché le rollback parce que le script de vérification avait gardé le numéro attendu 0.4.2. La comparaison des données avait déjà réussi ; le code est revenu automatiquement à v0.4.2, en conservant la base courante et la migration additive. Le numéro attendu a été corrigé, les preuves de cette tentative conservées, une nouvelle sauvegarde effectuée, puis la bascule finale et tous les contrôles ont réussi. Aucun défaut applicatif ni perte de données constaté.

## Prévisualisation et retour arrière

Prévisualisation : http://192.168.10.131:5174, même build final, release `/opt/sumatime-preview/releases/v0.4.3-prestataire-6adc53b`. Deux membres, deux comptes, deux clients et huit prestations conservés : comparaison intégrale des 19 tables, SQLite intègre, 37 ressources identiques. Entra reste désactivé sur cette base distincte. Sauvegarde/preuves : `/var/backups/sumatime-preview/roles-prestataire-20261007`.

En cas de retour au code v0.4.2 : arrêter brièvement SumaTime, rétablir atomiquement current vers `/opt/sumatoni-time/releases/v0.4.2`, puis redémarrer en conservant la base et les réglages Entra courants. La migration additive peut rester présente et v0.4.2 conserve le contrôle Graph des utilisateurs provisionnés. Ne pas restaurer une ancienne base qui ferait perdre les prestations et décisions de rôle plus récentes. Le bouton de gestion des rôles ne sera plus disponible sous l’ancien code.
