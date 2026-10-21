# Sumatoni Time

Application web pour administrateur et prestataires : calendrier au quart d’heure, saisie client/ticket/horaires, arrondi supérieur par prestation, exports CSV internes, relevé client sans prestataire et relevé par prestataire avec totaux pour contrôler sa facture, modes sur site/à distance, tarifs horaires et forfait de déplacement quotidien par client et prestataire, verrouillage de facturation.

Comptes locaux par e-mail/mot de passe. Active Directory / LDAP et Microsoft Entra ID optionnels. Aucun compte ChatGPT requis.

La version 0.3.0 permet de déplacer, redimensionner et supprimer les prestations dans le calendrier, et de créer des tickets GLPI. La saisie manuelle reste à la minute ; le chrono arrondit le début au quart inférieur et la fin au quart supérieur. Les nouveaux tickets sont sélectionnés dans GLPI ou marqués explicitement « À compléter ». Voir [les nouveautés](CHANGELOG.md), [GLPI](docs/GLPI.md) et [le déploiement validé](docs/DEPLOIEMENT-V0.3.0-2026-10-05.md).

## Démarrer

Node.js 24 requis. Depuis ce dossier :

```powershell
npm ci
Copy-Item .env.example .env.local
npm run build
npm start
```

Ouvrir http://127.0.0.1:5173. Créer l’administrateur avec le code généré dans data/setup-token.txt. Le dossier data reste privé et ne doit pas être servi par IIS.

- [Architecture et besoins métier](ARCHITECTURE.md)
- [Installation Windows et Active Directory](INSTALLATION-WINDOWS.md)
- [Installation Linux, HTTPS et sauvegardes](INSTALLATION-LINUX.md)
- [Guide utilisateur](GUIDE.md)
- [Recette](RECETTE.md)

## Vérifier

```powershell
node node_modules/typescript/bin/tsc --noEmit
node --import=tsx --test --test-concurrency=2 tests/*.test.mjs
npm run test:entra
node tests/run-api.mjs
node tests/run-provider.mjs
```

Le test API démarre le build de production sur le port 8787 avec une nouvelle base isolée. Sauvegarde : npm run db:backup. Les fichiers de l’ancien starter Sites restent des références historiques ; les commandes npm dev/build/start utilisent désormais exclusivement Next.js et Node.

La branche de développement **0.4.0-dev.1** prépare le login Microsoft 365, désactivé par défaut. Voir [configuration et recette Entra](docs/AUTHENTIFICATION-ENTRA-ID.md). Aucun changement de production ou du SSO GLPI.

### Confidentialité et tarif prestataire (v0.4.4)

Les tarifs clients sont réservés aux administrateurs, y compris dans les réponses API et les exports. Mon compte → Mon tarif avec Sumatoni permet de saisir sa rémunération horaire et sa date d'application. Le relevé prestataire inclut cette rémunération et les déplacements, avec une alerte si un montant manque. Voir [la règle métier, les exports et les protections](docs/CONFIDENTIALITE-ET-TARIFS-PRESTATAIRES.md).

### Version de développement : intitulés GLPI et relevé client

`0.4.5-dev.1` sur CT-ANT : conservation du titre avec chaque prestation/chrono, intitulé visible dans Prestations, recherche par titre et CSV client avec numéro/intitulé/durée facturable. Récupération explicite des titres historiques avec les droits GLPI personnels. Voir [les itérations, limites et validations](docs/TITRES-TICKETS-DEV-2026-10-21.md). Cette version n'est pas installée en production.
