# Versions de Sumatoni Time

## v0.4.3 — gestion des rôles, 7 octobre 2026

- Le rôle s’affiche désormais « Prestataire » dans l’équipe, le profil, le calendrier, les filtres et les exports. La valeur technique historique reste compatible avec les comptes et données existants.

- Équipe : attribution et retrait explicites du rôle administrateur, avec confirmation des droits et reconnexion du membre.
- Contrôle serveur réservé aux administrateurs actifs, protection du rôle de l’acteur et du dernier administrateur local de secours, refus des changements devenus obsolètes.
- Historique des changements de rôle et révocation transactionnelle des sessions locales, LDAP et Microsoft ; données, comptes et identité Microsoft conservés.
- Les nouveaux comptes Microsoft restent prestataires par défaut. Le rôle choisi dans SumaTime est conservé lors des reconnexions Microsoft.
- Déployée après autorisation, sauvegardes avant/après et comparaison des données : deux membres, deux clients et 15 prestations conservés, aucun rôle existant modifié. HTTPS et démarrage OIDC vérifiés.

## v0.4.2 — 7 octobre 2026

- Contrôle des attributions individuelles Entra via Graph, y compris Accès par défaut, sans rôle personnalisé à créer. Permission Application.Read.All en lecture avec consentement administrateur.
- Création de partenaires après vérification explicite de l’attribution ; droits et historiques existants conservés. Lecture fraîche à chaque connexion, contrôle des sessions avec cache de 60 secondes.
- Retrait d’attribution : sessions Microsoft révoquées, prestations conservées. Panne Graph : refus temporaire 503, formulaires conservés et accès local disponible.
- Graph limité à HTTPS, pagination complète, réponses bornées et secrets uniquement en mémoire. Mode manuel inchangé par défaut ; création automatique désactivée.
- Déployée en production après autorisation : contrôle Graph et création automatique activés, compte existant et 15 prestations conservés. Sauvegardes avant/après, HTTPS et parcours OIDC vérifiés ; connexion interactive Kiosk à valider.

## v0.4.1 — proposition refusée, non déployée : création automatique des partenaires Entra, 7 octobre 2026

- Compte partenaire créé à la première connexion avec le rôle applicatif signé `SumaTime.Partner`, lorsque le provisionnement est activé. Les attributions Microsoft « Accès par défaut » ne donnent pas cette autorisation.
- Identités et rôles existants conservés ; jamais de fusion par email ni de promotion automatique. Comptes sans mailbox acceptés via leur UPN.
- Création transactionnelle sans doublons et conservation des révocations locales, même après un changement de contact.
- Migration additive et guide de configuration des rôles dans Microsoft.

## v0.4.0 — 7 octobre 2026

- Promotion de la connexion Entra facultative sur l’adresse HTTPS de production, avec accès local et données existantes conservés.
- Activation Microsoft après configuration du tenant, du secret serveur et du rattachement explicite du pilote. La validation réelle Microsoft reste une étape distincte du déploiement.
- Journaux Nginx SumaTime sans paramètres de requête pour ne pas enregistrer les codes OIDC. Saisie du secret client dans un terminal SSH avec entrée masquée et sauvegarde privée des réglages.

## v0.4.0-dev.1 — développement, 7 octobre 2026

- Connexion Microsoft 365 Sumatoni par Entra ID, facultative et désactivée par défaut. Flux serveur OIDC avec PKCE et validation des jetons signés.
- Rattachement explicite aux membres existants, nouveaux partenaires Microsoft sans mot de passe SumaTime, retrait d’identité et révocation des sessions Microsoft. Historique, rôles et accès locaux/LDAP conservés.
- Bouton Microsoft, choix d’un autre compte, messages de refus et compte Microsoft sans formulaire de mot de passe local.
- Durée de session Microsoft limitée ; compte local de secours disponible si Microsoft est absent. Guide de configuration et simulateur signé pour la recette.
- CT-ANT / prévisualisation uniquement. Configuration Microsoft et recette réelle à suivre ; aucune mise en production.

## v0.3.0 — 5 octobre 2026

- Calendrier : déplacement, redimensionnement, annulation avec contrôle de version et suppression confirmée. Les prestations facturées restent protégées.
- Horaires manuels à la minute ; gestes de quinze minutes préservant les minutes initiales.
- Chrono : début au quart inférieur, fin au quart supérieur ; 09:07–10:22 devient 09:00–10:30.
- Création GLPI avec droits personnels, sélection de l’entité du client et identité persistante pour récupérer un résultat sans création en double.
- Sélection d’un ticket GLPI vérifié ou « À compléter » ; références historiques conservées lors de la migration.
- Déploiement standalone Ubuntu, sauvegardes avant/après et conservation des données de production. Recette : 70 tests, 199 assertions API, 212 prestataire, 101 R2 et 26 Round14 ; compilation et TypeScript réussis.

## v0.2.1 — 17 septembre 2026

- Déploiement Ubuntu : service systemd non privilégié, reverse proxy Nginx HTTPS et sauvegarde quotidienne vérifiée.
- Mise à jour ciblée de `baseline-browser-mapping` vers 2.11.24 (correction GHSA-w5vr-8v7q-w6rv).
- Procédure Linux, restauration et suivi du certificat autosigné dans `INSTALLATION-LINUX.md`.

## v0.2.0 — 17 septembre 2026

Une journée de travail centrée sur le prestataire :

- Accueil personnel **Ma journée**, temps réels et facturables, semaine en un regard et accès aux interventions du jour.
- Reprise des tickets récents, saisie rapide, raccourci N et brouillon conservé par compte sur l’appareil.
- Chronomètre conservé sur le serveur, un par personne, avec arrêt puis vérification des horaires et description avant enregistrement.
- Enregistrement atomique au passage de minuit, contrôle des chevauchements, protection contre les doublons et application des règles de déplacement existantes.
- Connexion GLPI personnelle : recherche, filtres, pagination, ouverture du ticket, préparation d’une prestation ou d’un chrono. Association explicite des entités GLPI aux clients.
- Jetons GLPI chiffrés, sessions temporaires fermées, délais limités et sauvegarde de la clé de chiffrement.
- Parcours adaptés au téléphone, confirmations intégrées et correction des fonds colorés du calendrier pour éviter les repères visibles derrière les prestations.

La configuration de l’instance GLPI réelle reste à renseigner. Le connecteur a été vérifié contre une API simulée et ne transmet aucun temps dans GLPI. Voir `docs/GLPI.md`, `docs/EVOLUTION-V0.2.0.md` et `RECETTE.md`.

## v0.1.0 — 17 septembre 2026

Version de référence autonome pour Windows Server, enregistrée à la demande de l’utilisateur.

- Comptes locaux, rôles administrateur/partenaire et connecteur Active Directory / LDAP configurable.
- Calendrier de saisie au quart d’heure, horaires précis au clavier et affichage adapté aux prestations courtes.
- Clients, tickets, horaires, prestations sur site ou à distance et verrouillage après facturation.
- Arrondi supérieur au quart d’heure, tarifs horaires par client et forfait de déplacement par jour/client/prestataire.
- Exports internes, relevé client sans partenaire et relevé partenaire avec totaux pour le rapprochement de facture.
- Identité visuelle du site public Sumatoni : Poppins, logos et palette hébergés localement.
- Couleur personnalisable par client, partagée dans le calendrier de l’équipe.
- Base SQLite, sauvegardes, migrations et documentation d’installation Windows.

Validation : compilation et TypeScript réussis, 184 assertions API sur base isolée, recette navigateur sur ordinateur et téléphone. Détails dans `RECETTE.md`.

L’installation sur le Windows Server cible et la connexion à l’annuaire AD réel restent à valider sur cette infrastructure. L’ancien site cloud n’est pas synchronisé avec cette version locale.

Le dépôt et le paquet de sources excluent la base utilisateur, les sauvegardes et `.env.local`. Sauvegarder ces éléments séparément et les restaurer selon `INSTALLATION-WINDOWS.md`.
