# SumaTime v0.4.6 — mise en production du 6 novembre 2026

Mise en production autorisée par le propriétaire après validation de la préversion de facturation en lot, avec sauvegarde préalable et conservation des données. Bascule et vérifications terminées vers 20:32, heure de Bruxelles, sur https://sumatime.home.sumatoni.be.

## Version livrée

- Source canonique CT-ANT : `/srv/projects/applications/timesheet`, branche `codex/bulk-billing-ledger`.
- Code applicatif `085b07263b94658bbb5b01465cb8af1d0e3c4902`, version stable 0.4.6, build `VlI4X_4CATlWR1yqXWWg6`.
- Release active `/opt/sumatoni-time/releases/v0.4.6-billing-085b072`, lien `/opt/sumatoni-time/current`.
- Archive sans données ni secrets `sumatime-v0.4.6-billing.tar.gz`, SHA-256 `e2a3d5b2984f2bb2d82137aff5c07f6c4cb881977a6bb4d253f1fe3a732ecca9`.
- 3154 fichiers runtime vérifiés avant installation ; les 40 ressources publiques correspondent exactement au paquet après bascule HTTPS.
- Promotion de `0.4.6-dev.2` sans changement fonctionnel : seuls les numéros de version et le journal de version ont changé avant reconstruction du paquet stable.

Fonctions livrées : sélection de lignes, de page ou de toutes les prestations non facturées filtrées ; confirmation du marquage en lot ; transaction atomique et contrôle des versions/droits ; relevé pleine largeur et modification en fenêtre superposée. Les heures décimales de l'export client et le retrait des mentions géographiques de fuseau sont également inclus. Voir [le parcours et les garanties](DEV-FACTURATION-LOT-2026-11-06.md).

## Sauvegardes et conservation

- Sauvegarde fraîche avant bascule `/var/backups/sumatoni-time/2026-11-06T19-32-25.330Z`.
- Sauvegarde après bascule `/var/backups/sumatoni-time/2026-11-06T19-32-31.148Z`.
- Sauvegardes SQLite, environnement et clé GLPI terminées et vérifiées par leurs empreintes ; intégrité SQLite conforme et aucune erreur de clé étrangère.
- Scripts/preuves privés `/root/sumatoni-deploy/v0.4.6-billing-20261106/`.

La base active reste `/var/lib/sumatoni-time/timesheet.sqlite` ; elle n'a pas été remplacée par une base de développement. Aucun changement de schéma. Comparaison intégrale des schémas, lignes et valeurs des 21 tables après démarrage : identiques à l'état précédant la bascule. Après les contrôles, les lignes métier antérieures sont également conservées.

État final : 5 membres, 1 compte local, 2 clients, 33 prestations, 4 connexions GLPI. Les 33 prestations restent non facturées : aucun marquage automatique en production. Horaires, tickets/titres, prix clients, rémunérations, déplacements, états de facturation, comptes et rattachements Microsoft conservés. Environnement et clé GLPI inchangés octet pour octet par rapport à la sauvegarde ; aucun rôle de personne réelle modifié.

## Vérifications

Préversion : 66 tests unitaires/DOM (dont tests du véritable Workspace, calendrier, chrono, rôles, confidentialité et Entra), 25 assertions API du lot, 201 assertions métier, 255 prestataire/GLPI et 77 confidentialité/rémunération. La version stable reconstruite a de nouveau passé les 25 assertions du marquage en lot, les 201 assertions métier et les 77 assertions confidentialité/rémunération sur bases isolées. Build et TypeScript conformes.

Avant bascule, le runtime stable exact a été exécuté sous le compte de service sur une copie privée de la base de production. Contrôle Graph réel de l'administrateur et d'un prestataire, session locale de secours, export client non vide à sept colonnes et prix clients masqués : conformes. Le marquage de deux prestations a été effectué uniquement dans cette copie privée. Un conflit de version a refusé tout le lot sans écriture partielle ; le prestataire et l'accès anonyme sont refusés ; un rejeu ne modifie pas les versions ; une ligne marquée est verrouillée. Seuls billed, version et updated_at des deux lignes sélectionnées de la copie ont changé. Aucun jeton GLPI n'a été utilisé pour enrichir un titre. Le processus et les sessions synthétiques ont été arrêtés/supprimés après le contrôle ; aucune de ces opérations n'a marqué une prestation réelle.

Après bascule : SumaTime et Nginx actifs, HTTPS vérifié avec le certificat existant sans contournement TLS. Les API anonymes sont refusées, y compris POST `/api/billing` (401). Démarrage OIDC réel vérifié : tenant/client/callback, PKCE S256, sélection de compte et cookie Secure. Seul le flux de vérification a été annulé et consommé, sans création de session. Aucune connexion humaine interactive au mot de passe ou à Microsoft n'est revendiquée.

## Utilisation et retour arrière

Actualiser le navigateur. Dans Prestations : appliquer les filtres, sélectionner les lignes ou Tout sélectionner, puis Marquer la sélection comme facturée et confirmer. Le lot est réservé aux administrateurs et limité à 1000 lignes ; les prestations déjà facturées sont exclues. Modifier les filtres sans les appliquer bloque le lot. Une ligne modifiée/supprimée/déjà facturée fait refuser toute l'opération ; actualiser puis refaire la sélection.

Aucun retour arrière n'a été nécessaire. Le déploiement prévoit un retour automatique au code précédent si les contrôles échouent. En récupération manuelle, arrêter brièvement le service, rétablir le lien vers `/opt/sumatoni-time/releases/v0.4.5-ticket-titles-3de7c05`, puis redémarrer en conservant la base courante et la configuration. Ne pas restaurer une ancienne base qui ferait perdre les prestations et les décisions de facturation plus récentes. L'ancien code conserve les statuts facturés mais ne propose plus le marquage en lot ni l'édition en fenêtre.

La prévisualisation CT-ANT reste distincte en `0.4.6-dev.2`, sur http://192.168.10.131:5174. Aucune base de production n'a été transférée sur CT-ANT pour ce déploiement. Le code et les preuves de déploiement sont synchronisés avec le dépôt GitHub ; aucune base ni configuration privée n'est incluse dans Git.
