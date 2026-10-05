# Sumatoni Time v0.3 — contre-revue QM indépendante

Date : 2026-10-03  
Branche : `codex/calendar-glpi-v0.3`  
HEAD revu : `4e9773821c926b1ed1849af0e90a77d959bbee67`  
Modèle : GPT-6 Astra, effort ultra  
Verdict : **REVISE** — aucune release ni mise en production.

## Défauts P2 confirmés

### R1 — L'annulation réelle échoue encore

`app/time-calendar.tsx` renvoie `start/end` en minutes numériques, tandis que `app/api/time/route.ts` attend des chaînes `HH:MM`.

- Payload exact de l'UI : HTTP 400, `Les heures doivent être au format HH:MM.`
- Contrôle avec chaînes : restauration correcte et champs métier conservés.
- Vrai conflit concurrent : HTTP 409 correct.

Le test API ajouté ne couvre que les chaînes et ne teste donc pas le caller réel.

### R2 — Une réponse GLPI incertaine peut encore produire un doublon après démontage

UUID, payload canonique et état incertain restent dans le state local de `app/new-glpi-ticket.tsx`. Fermer le parent, QuickEntry/calendrier ou changer d'onglet démonte le composant et perd cette identité.

- Même instance montée : récupération avec le même UUID, zéro nouvelle création.
- Démontage/remontage : nouvel UUID pour les mêmes données métier, deux créations acceptées.
- Le serveur rejoue correctement le même UUID et refuse un payload différent ; le défaut est la perte d'identité côté UI.

### R4 — Le focus peut être restauré puis reperdu

Une première recharge locale restaure la poignée et consomme la cible de focus. Une seconde recharge tardive du parent remplace ensuite les données, démonte le nœud focusé et ne restaure plus le focus.

- Vrais handlers et effets exécutés avec DOM modélisé : un POST, recharges locale + parent, entrée survivante, focus final perdu.
- Le test `calendar-dom.test.mjs` actuel est un helper de tableaux ; il ne monte pas React et ne prouve pas deux sauvegardes clavier dans un vrai DOM.
- Aucun navigateur/Playwright/jsdom réel n'était disponible ; l'acceptation interactive reste non prouvée.

### R5 — Les bornes DST exactes restent incohérentes

La validation utilise l'offset de `stopped - 1`, puis convertit l'heure civile à `stopped`.

- Printemps : 20 minutes mesurées à la borne exacte deviennent 90 minutes proposées.
- Automne : 20 minutes mesurées deviennent 15 minutes proposées.
- Ajouter 1 ms provoque un rejet, ce qui confirme l'incohérence de la borne exacte.

## Correction validée

### R3 — Changement d'entité fail-closed

`changeActiveEntities` doit retourner strictement `true`. `false`, réponse malformée et erreur HTTP bloquent le flux avant catégories et création : zéro `POST Ticket`, sessions fermées. Les messages HTTP/JSON restent génériques (P3 diagnostic), sans défaut d'écriture démontré.

## Résultats de contrôle

- Unitaires : **19/19**.
- API : **198 assertions**.
- Provider mock : **156 assertions**.
- Provider : 4 tentatives `POST Ticket`, 3 créations acceptées + 1 refus explicite, 0 session ouverte.
- TypeScript, build standalone, lint ciblé, `git diff --check`, intégrité SQLite : **PASS**.
- Lint global : **7 erreurs / 6 warnings préexistants** hors diff v0.3.
- Preview/mock actifs et inchangés ; bundle servi et rebuild comparés par hash, aucun drift applicatif démontré.
- Premier build expiré à 180 s puis retry réussi ; premiers blocages I/O/API/lint/provider conservés dans la preuve.

## Boundary Git et preview

- Commit applicatif revu : `4e97738`.
- Trois fichiers suivis restent modifiés : `next.config.ts`, `package.json`, `package-lock.json`.
- Six fichiers docs/deploy restent non suivis, plus ce rapport.
- Preview isolée uniquement, GLPI mock sur loopback ; aucun GLPI réel ni production touché.

## Prochaine gate

Retour développeur obligatoire sur R1, R2, R4 et R5. Ajouter une vraie preuve DOM/navigateur pour R4, rejouer les suites existantes sans assouplir les assertions, reconstruire la preview, puis demander une nouvelle contre-revue QM indépendante. La v0.3 reste non livrable jusqu'à `PASS`.
