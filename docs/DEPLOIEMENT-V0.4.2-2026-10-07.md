# SumaTime v0.4.2 — attributions Entra en production

Le propriétaire a autorisé explicitement le déploiement et l’activation avec « tu peux poursuivre », après la vérification réelle des permissions Microsoft Graph. Mise en production effectuée le 7 octobre 2026 à 16:53, heure de Bruxelles. Adresse : https://sumatime.home.sumatoni.be. Aucun changement du SSO GLPI.

## Release et sauvegardes

- Code : `5040bbc5bb5947451145ee3baf4b38415ab3acc3`, branche `codex/entra-assignments` sur CT-ANT.
- Runtime : `/opt/sumatoni-time/releases/v0.4.2`, cible active de `/opt/sumatoni-time/current`. Ancienne v0.4.0 conservée.
- Build : `wW8hRm8IeGmbn0Xz3BbTI` ; 2549 fichiers vérifiés par manifeste.
- Archive SHA-256 : `c5af102ed72f7a68be19a199a1d21e58996fa0f5e80034fbda2fc5734c77417f`. Même runtime testé en développement ; seules les métadonnées du manifeste ont été promues. Aucun secret, SQLite ou dossier de données dans l’archive.
- Sauvegarde fraîche avant bascule : `/var/backups/sumatoni-time/2026-10-07T14-53-22.920Z`.
- Sauvegarde après activation : `/var/backups/sumatoni-time/2026-10-07T14-54-15.834Z`.
- Base, clé GLPI et environnement privé sauvegardés ; manifestes terminés et empreintes SHA-256 vérifiées. SQLite intègre dans les sauvegardes et en production.
- Preuves et scripts privés : `/root/sumatoni-deploy/v0.4.2-20261007/`. Aucun secret ou jeton dans ce document.

## Conservation des données

La base active reste `/var/lib/sumatoni-time/timesheet.sqlite`. Aucun remplacement par la base de développement ou de recette. Avant activation : comparaison intégrale des lignes et valeurs des 17 tables antérieures, toutes identiques. Après activation : toutes les anciennes lignes métier, comptes, identités et credentials conservées ; les tables de sessions, flux et limites de connexion sont transitoires. Un membre administrateur, un compte local, deux clients, 15 prestations et une connexion GLPI conservés. Aucun chrono en cours. Nouvelle table additive `entra_provisioned_members` vide à la fin du déploiement.

La migration 0009 ajoute la provenance des comptes automatiques ; aucun utilisateur n’a été créé artificiellement dans la base active. Permissions SQLite, WAL et SHM : compte de service `sumatoni-time`, mode 600. Aucune erreur de clé étrangère.

## Activation Microsoft

Configuration effective :

```dotenv
ENTRA_ENABLED=true
ENTRA_ACCESS_MODE=assignment
ENTRA_AUTO_PROVISION=true
ENTRA_SESSION_MINUTES=60
```

Tenant, client et secret existants conservés. Graph `Application.Read.All` de type Application, consentement accordé ; Affectation requise = Oui vérifiée. Quatre attributions individuelles constatées, dont Kiosk et le propriétaire. Aucun rôle personnalisé requis. Les nouveaux comptes reçoivent uniquement le rôle partenaire ; l’administrateur existant conserve son identité et ses droits. Pas de fusion automatique par email.

Les attributions sont relues à la connexion et contrôlées pendant les sessions avec cache de 60 secondes, sous réserve de réplication Microsoft. Un retrait confirmé révoque les sessions Microsoft en conservant les prestations. Une panne Graph après expiration du cache refuse temporairement les actions ; l’accès local reste indépendant de Graph. Voir [le guide](PROVISIONNEMENT-ENTRA.md).

## Vérifications effectuées

Avant bascule, le runtime exact a été lancé sous le compte de service sur une copie privée de la base, en loopback, avec Graph réel et création automatique désactivée. L’administrateur attribué garde son identité et son rôle ; une session locale administrateur fonctionne ; une identité non attribuée est refusée et sa session révoquée. Base QA distincte, processus arrêté et fixtures supprimées. Le mot de passe local du propriétaire n’a pas été saisi : le contrôle local utilise une session de recette sur cette copie, pas une connexion interactive à la production.

Recette préalable isolée : 46 tests unitaires/DOM, 683 assertions Entra/Graph et quatre configurations de redémarrage, 199 assertions métier, 251 prestataire/GLPI ; build, TypeScript, ESLint ciblé et diff conformes.

Après bascule, services SumaTime et Nginx actifs. HTTPS vérifié avec le certificat autosigné existant, sans désactiver la validation TLS. Les 37 ressources publiques correspondent au paquet ; API anonymes refusées (401). Le démarrage OIDC réel contrôle tenant, client, callback, PKCE S256, choix de compte et cookie Secure. Son propre flux de test a été annulé et consommé sans création de session ni compte. URI : `https://sumatime.home.sumatoni.be/api/auth/entra/callback`.

La connexion interactive de Kiosk n’a pas encore été réalisée. Utiliser le site de production, puis « Choisir un autre compte Microsoft » et le compte Kiosk. Vérifier sa création comme partenaire, sa visibilité limitée, une deuxième connexion sans doublon et les parcours calendrier/chrono/GLPI. Les tests simulés et les lectures Graph réelles ne constituent pas une connexion humaine Kiosk. L’absence d’attribution a été testée au niveau du runtime avec Graph réel ; un essai interactif avec un utilisateur ordinaire non attribué reste également à faire.

## Retour arrière sans perte des nouvelles saisies

Pour suspendre seulement les nouveaux comptes : `ENTRA_AUTO_PROVISION=false`, puis redémarrer le service ; les comptes déjà créés restent sous contrôle Graph. Pour couper Microsoft entièrement : `ENTRA_ENABLED=false`, puis redémarrer ; conserver le compte local de secours.

Avant un retour au code v0.4.0, désactiver Microsoft et la création automatique : l’ancien runtime ne contrôle pas les attributions des comptes créés par v0.4.2. Arrêter SumaTime, rétablir atomiquement le lien current vers la release v0.4.0, puis redémarrer avec Microsoft désactivé. Conserver la base courante et la clé GLPI ; ne pas restaurer une ancienne sauvegarde qui effacerait les prestations plus récentes. La migration additive peut rester présente.
