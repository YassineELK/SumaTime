# Sumatoni Time

Application web pour administrateur et partenaires : calendrier au quart d’heure, saisie client/ticket/horaires, arrondi supérieur par prestation, exports CSV internes, relevé client sans partenaire et relevé par partenaire avec totaux pour contrôler sa facture, modes sur site/à distance, tarifs horaires et forfait de déplacement quotidien par client et prestataire, verrouillage de facturation.

Comptes locaux par e-mail/mot de passe. Active Directory / LDAP optionnel. Aucun compte ChatGPT requis.

La version 0.2.0 ajoute **Ma journée**, le chronomètre persistant avec vérification des horaires, les brouillons de saisie rapide, la reprise des tickets récents et un connecteur GLPI individuel en lecture seule. Voir [les nouveautés](CHANGELOG.md) et [la configuration GLPI](docs/GLPI.md).

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
- [Guide utilisateur](GUIDE.md)
- [Recette](RECETTE.md)

## Vérifier

```powershell
node node_modules/typescript/bin/tsc --noEmit
node --test tests/business.test.mjs tests/calendar.test.mjs tests/auth.test.mjs tests/workday.test.mjs
node tests/run-api.mjs
node tests/run-provider.mjs
```

Le test API démarre le build de production sur le port 8787 avec une nouvelle base isolée. Sauvegarde : npm run db:backup. Les fichiers de l’ancien starter Sites restent des références historiques ; les commandes npm dev/build/start utilisent désormais exclusivement Next.js et Node.
