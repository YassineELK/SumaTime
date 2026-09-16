# Sumatoni Time

Application web responsive de saisie de prestations pour un administrateur et ses partenaires.

## Documents

- [Architecture et besoins métier](ARCHITECTURE.md)
- [Guide d’utilisation et exploitation](GUIDE.md)
- [Résultats de recette](RECETTE.md)
- [Référence technique du starter](docs/STARTER-TECHNIQUE.md)

## Fonctions

Client, ticket, date et heures ; description facultative ; arrondi au quart d’heure supérieur ; droits administrateur/partenaire ; gestion des clients et accès ; filtres ; CSV détaillé et synthèse ; verrouillage des prestations facturées.

## Démarrage technique

Node 22.13 ou supérieur. Installer avec `npm run install:ci`, compiler avec `npm run build`, puis appliquer les migrations locales avant de lancer `npm run dev`. Voir la référence technique pour les commandes D1. L’authentification locale simulée est uniquement destinée au développement ; Sites gère l’identité en production.

## Vérification

- `node node_modules/typescript/bin/tsc --noEmit`
- `node --test tests/business.test.mjs`
- `node tests/api-recette.mjs` uniquement contre une base de recette isolée vide, servie sur le port 8787.

Les données locales de l’aperçu et les données de production sont indépendantes. Ne pas inclure `.wrangler`, `.sites-runtime`, les variables privées ou des identifiants d’accès dans un export du code.
