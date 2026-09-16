# Versions de Sumatoni Time

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
