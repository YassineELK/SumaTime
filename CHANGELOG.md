# Versions de Sumatoni Time

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
