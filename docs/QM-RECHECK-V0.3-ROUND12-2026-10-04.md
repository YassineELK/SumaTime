# QM — Sumatoni Time v0.3, Round 12

Date : 2026-10-04 UTC. Revue indépendante du commit `8b133f3` après le verdict Round 11.

## Verdict : REVISE

**Deux P2 confirmés : la consommation ACK n'est toujours pas stable après une vraie nouvelle page, et un historique migré peut perdre son replay durable sans capability. Aucun P0/P1 ni doublon fournisseur démontré. Pas de PASS global ni d'autorisation de release.**

Les contre-tests exacts des trois P2 Round 11 passent dans leur périmètre initial. L'intégration R2 officielle passe désormais **101 assertions**. Cela ne ferme pas le défaut ACK sur cold-process et ne neutralise pas la régression historique ci-dessous.

## Périmètre figé et provenance

- Dépôt : `/srv/projects/applications/timesheet`, branche `codex/calendar-glpi-v0.3`, HEAD exact `8b133f3ebe225c81714994f1312a693d8cef2924`, inchangé pendant la revue.
- Diff inspecté : `6588db9..8b133f3`, quatre fichiers, 289 insertions / 41 suppressions : `lib/glpi.ts`, `app/new-glpi-ticket.tsx`, `tests/glpi-r2-integration.mjs`, `tests/glpi-round12-authority.test.mjs`. Lecture des callers, du stockage navigateur, des migrations et des projections de récupération.
- Worktree préexistant conservé : `next.config.ts`, `package.json`, `package-lock.json` modifiés ; quatre fichiers deploy preview et documents requirements/évolution/revues Round 1–11 non suivis. Aucun changement applicatif, commit, déploiement ou nettoyage. Seul ajout durable de cette revue au dépôt : ce rapport. Les rebuilds ne concernent que les artefacts ignorés `.next`.
- Preview Round 12 réelle : PID `1246762`, répertoire `/dev/shm/sumatime-preview-round12-release-QRFLf7`, loopback `127.0.0.1:5176`, BUILD_ID `kAoMFKOgDa0zt-yuRluIe`. Mock PID `1246761`, `127.0.0.1:8794`. Base effective `/dev/shm/sumatime-preview-round12-runtime-3SKG6h/timesheet.sqlite`, LDAP désactivé, écriture GLPI autorisée **uniquement vers le mock loopback**.
- L'ancien service systemd Round 11 et `/opt/sumatime-preview/current` existent encore séparément. Ils ne sont ni la preview Round 12 évaluée, ni modifiés par cette revue.
- Avant rebuild QM : hashes local/preview égaux pour `server.js`, API GLPI et page ; 26/26 fichiers statiques, 8/8 public, 9/9 drizzle et 47/48 fichiers serveur identiques. Le seul fichier local supplémentaire est `interception-route-rewrite-manifest.js`, liste vide absente du standalone servi.
- SHA256 `server.js` : `0c4a8c7f407465f22a8fbab69c8d17994593e7fc036f412c63e3e905910d86d2` ; API GLPI : `f268ae442de3797af565a35f7ad940d60a352e8bd198612e023bb629fc664536` ; page : `96ac91ca89e57391b11be20d4e85105d609c399b05ec20e20c0df9e48427841c`.
- `/login` HTTP200 ; API GLPI anonyme HTTP401. Huit JS/CSS effectivement référencés par `/login` téléchargés en HTTP200 et identiques aux fichiers release. `initSession` mock HTTP200, session synthétique refermée par `killSession` HTTP200.
- Rebuild indépendant QM : BUILD_ID `BiI1IQBbCXxHYO_h-mRPH`, sans activation. API/page/server et 24 fichiers statiques applicatifs identiques à la preview. Les sept différences serveur et les deux manifestes statiques propres au build deviennent identiques après remplacement du seul BUILD_ID. La preview n'est pas stale par rapport au code évalué.
- Tests HTTP sur nouvelles bases `/dev/shm`, serveurs Next et GLPI loopback temporaires. Tests UI : React/Radix réels sous jsdom, vraies routes Next et SQLite ; chaque cold-process est un nouveau processus Node/UI, pas seulement un remount React conservant le cache de module. Sous-revue serveur complémentaire : transport `fetch` synthétique, aucune connexion réelle.

## P2-1 — Un résultat distinct consommé revient sur une vraie nouvelle page

Sources : `app/new-glpi-ticket.tsx:25`, `:374`, `:402`, `:556`, `:923` ; `lib/glpi.ts:446`.

Le correctif retire correctement les résultats ACK de `distinctDrafts`. Mais `openNew()` demande aussi `recover=1`, fusionne `recoverable` avec les opérations en cours et les adopte automatiquement. Le filtre `consumedOperations` est un `Set` de module : il disparaît au rechargement alors que l'ACK a été confirmé et que `onCreated` a déjà été appelé.

### Reproduction sans égalité de timestamps

1. Créer A puis confirmer « Utiliser ce ticket ».
2. Émettre une intention distincte B, créer B, avancer l'horloge contrôlée d'une seconde pour séparer les ACK, puis confirmer « Utiliser ce ticket » pour B. Réponse ACK200 reçue, callback exécuté exactement une fois.
3. Fermer le processus UI. Ouvrir une nouvelle instance Node/jsdom/React avec le même compte et le snapshot réel de stockage, puis cliquer « Nouveau ticket GLPI ».
4. **B déjà consommé (`GLPI-115`) réapparaît immédiatement comme « Ticket créé dans GLPI », avec « Utiliser ce ticket », sans formulaire neuf.** `requests=[]` et `distinctDrafts` absent ; B arrive par `recoverable`.

UUID B de la reproduction : `d3b50a34-1271-4284-b9f5-765578acb020`. Deux POST fournisseur seulement (A/B), donc aucune duplication GLPI dans cette reproduction. Le défaut porte sur la réapparition d'une consommation confirmée et le parcours « Nouveau ».

Preuves : `/tmp/sumatime-qm-round12-coysRM/cold-ack-notie/ack-success-cold-notie-ttl-minus1-issue.json`, fichier `*-resume.json` et `matrix-results.json`.

### Réponse ACK perdue : contrôle positif et sélection ambiguë

- Sans égalité de timestamps, ACK de B commis mais réponse supprimée avant le navigateur : callback0 avant cold-process ; B récupéré ensuite ; ACK rejoué avec callback1, sans POST supplémentaire. **PASS** dans `ack-loss-cold-notie-ttl-minus1`.
- Avec deux ACK au même instant contrôlé, cold-process sélectionne l'ancien A consommé au lieu du B dont l'ACK a été perdu (`GLPI-116` présenté à la place de `GLPI-117`). B reste récupérable en base : aucune perte définitive affirmée. La sélection par premier résultat n'est pas une preuve d'identité causale.
- Avec ACK tous deux confirmés au même instant, la nouvelle page affiche A ; après reconsommer A puis « Nouveau », B déjà consommé réapparaît à son tour. Preuves : répertoire `/tmp/sumatime-qm-round12-coysRM/advanced/`.

Attendu : distinguer durablement la consommation confirmée de la récupération d'un ACK inconnu ; une nouvelle page ne doit pas réintroduire automatiquement un ticket consommé dans le parcours de nouvelle demande. La récupération doit conserver/choisir explicitement l'identité correcte sans s'appuyer sur la première ligne ni sur un cache mémoire seul. Ne pas supprimer le résultat durable nécessaire au replay idempotent.

## P2-2 — Un ancien tombstone migré masque une réservation consommée valide

Sources : `lib/glpi.ts:300`, `:304`, `:312`, `:333`, `:738` ; migration `db/raw.ts:114`.

`draftIdentityForRequest` choisit la première ligne triée par `generation DESC, created_at DESC, intent_id DESC`. Les anciennes intentions pré-Round 11 reçoivent toutes `generation=0`. Lors d'un renouvellement Round 10 dans la même milliseconde, un ancien ID abandonné peut trier avant le nouveau ID actif puis consommé. L'ordre lexicographique d'une capability aléatoire est alors traité comme une chronologie.

### Reproduction différentielle

1. Construire une base au schéma pré-Round 11 : ancien ID `f…` abandonné et nouveau `a…` actif, même UUID et `created_at=2026-10-04T10:00:00.123Z` ; appliquer la migration officielle.
2. Avec la vraie fonction Round 11 archivée depuis `6588db9`, soumettre la capability active `a…` au fournisseur synthétique. Elle crée le ticket118, écrit la réservation et consomme cette capability : un POST initial, session refermée. Le résultat de création n'est pas injecté manuellement.
3. Rejouer le même UUID/payload sans capability sur exactement cette base : **Round 11 retourne118 ; Round 12 retourne409 `INTENT_ABANDONED`, `terminal=true`, `preserveOperation=false`.**
4. Round 12 avec capability consommée, ou via `beginGlpiDistinctCreation`, retrouve118. Zéro appel fournisseur pendant les replays, intégrité `ok`, FK0.

Impact borné mais réel : une réservation historique valide devient un faux abandon terminal sur le replay sans capability. Aucun doublon démontré ; les autres chemins constituent un contournement, pas la réparation du contrat de replay.

Preuve : `/tmp/sumatime-qm-r12-server-Pd4caz/migration-replay.mjs`, base `/dev/shm/qm-r12-migration-replay-v3nqui/audit.sqlite`, sous-rapport `/tmp/sumatime-qm-r12-server-Pd4caz/REPORT.md`. La copie Round 11 ne change que ses imports alias en chemins absolus.

Attendu : résoudre l'autorité historique sans trier les capabilities aléatoires comme des générations ; reconnaître la réservation exacte consommée tout en gardant les brouillons réellement abandonnés/non réservés fail-closed. Ne pas effacer les tombstones pour rétablir le replay.

## Contre-preuves des défauts Round 11 et régressions

- **UUID abandonné sans capability** : `INTENT_ABANDONED`, zéro nouvelle création, zéro alias, zéro POST supplémentaire ; même comportement avec ancienne capability et après366 jours. Avec empreinte d'une ancienne opération incertaine : aucun alias B→A. Isolation Alice/Bob et API A/B conservée. Cas consommé sans réservation : `INTENT_CONSUMED`, sans création/alias.
- **ACK et projection des brouillons** : aucune présence dans `distinctDrafts`, avec ou sans `includeAcknowledged`. Après expiration explicite, absent aussi de `recoverable`, mais replay exact UUID toujours idempotent. Replay et ACK après31 jours sans nouveau POST. Parcours même module « ACK puis Nouveau » corrigé ; **limite cold-process confirmée en P2-1**.
- **Rejet certain** : `CREATION_REJECTED`/`state='rejected'` conservé dans liste et `begin` ; nouvelle instance UI ne l'affiche plus comme résultat incertain aux bornes TTL−1, TTL et TTL+1. Reprise explicite : nouveau UUID, ancien rejet retiré de la projection mais `used_at`, `abandoned_at`, réservation rejetée et tombstone gardés. Reprise invalide : rollback du retrait de projection. Ancien UUID définitivement non créateur ; nouvelle opération créée une fois.
- Matrice Round 10B indépendante inchangée : **12/12 PASS**, 94,439 s, quatre parcours × TTL−1/TTL/TTL+1 : stockage indisponible dès émission, stockage perdu au cold-process, réponse create perdue après réservation, deux renouvellements simultanés puis deux workers UI. 22 POST mock, sessions finales0, intégrité `ok`, FK0. Les variantes stockage TTL−1 historiques ne soumettent pas toutes ; la matrice complémentaire ci-dessous ferme cette lacune.
- Matrice complémentaire Round 11 : **11/11 PASS**, 57,424 s : ACK même module, refus certain cold-process aux trois bornes, stockage absent avec vraie soumission aux trois bornes, soumission same-page aux trois bornes, nouvelle demande distincte depuis un résultat non consommé. 22 POST mock, sessions0, intégrité `ok`, FK0. Les POST de refus ne sont pas des tickets acceptés.
- Complément Round 12 : conservation des éditions pendant un polling réel après2,6 s **PASS** ; titre et description soumis inchangés. Les scénarios cold ACK détaillés ci-dessus conservent aussi intégrité/FK et sessions0.
- Migrations générales pré-Round11/pré-index : payload/génération, génération active unique, index partiel, scoping membre/API, DDL0006 et réouverture idempotente PASS. Les historiques tickets118/119 indépendants passent dans la suite officielle. **La variante historique à égalité reste le P2-2**, non couverte par ces PASS généraux.

## Suites et contrôles exécutés

- `node --import=tsx --test tests/*.test.mjs` : **49/49 PASS**, 8,402 s. Inclut undo/caller, vrai conflit concurrent via suite API, focus React DOM après deux ajustements et reload tardif, DST mesuré/arrondi, namespace membre, réponses tardives Alice/Bob, erreurs401/409, stockage, aliases et migrations.
- `node --import=tsx tests/glpi-r2-integration.mjs` : **101 assertions PASS**, 39,322 s, 12 POST principaux mock. **Fichier officiel du commit exécuté tel quel, aucune variante timing-adjusted.** Le diff remplace l'attente arbitraire du formulaire par sa réelle interactivité et conserve l'assertion du second POST distinct. Crash/restart, quota/corruption, réponse create/ACK perdue, concurrence multi-tab/process et isolation compte sont effectivement traversés.
- Intégration Round 9 : PASS, 12,451 s, config409 et distinct401/remount.
- Intégration Round 10 : PASS, 12,354 s, expiration/stockage/auth/renouvellement.
- API isolée : **198 assertions PASS**, 3,317 s.
- Provider isolé : **175 assertions PASS**, 18,637 s ; quatre POST attendus, sessions finales0, identité personnelle Alice mock, contexte d'entité strictement réussi avant création.
- TypeScript `--noEmit --incremental false` : PASS, 8,771 s.
- Lint des quatre fichiers Round 12 : PASS, 4,244 s. Lint de tous les fichiers TypeScript/applicatifs modifiés depuis `087da9e` : PASS, 5,436 s.
- Lint global : **FAIL, deux erreurs / trois warnings préexistants**, dans `app/login/page.tsx`, `components/client-color.tsx`, `app/account-panel.tsx`. Ces fichiers ne sont pas modifiés par Round 12 ; inventaire identique au rapport Round 11. Pas de désactivation de règles ni de dette ajoutée revendiquée.
- Build webpack standalone : PASS, 48,625 s ; hashes applicatifs comparés à la preview, aucun redémarrage/déploiement.
- Sauvegarde par le vrai `scripts/backup.mjs` de la base matrice : `/dev/shm/sumatime-qm-round12-RiTpqj/backups/timesheet-2026-10-04T11-33-22.188Z.sqlite`. Vérification indépendante : intégrité `ok`, FK0, 22 créations/22 alias/18 intentions, clé GLPI **synthétique** sauvegardée à côté.
- `git diff --check` PASS ; HEAD et dirty pre-review conservés. Aucun timeout ni échec d'infrastructure de suite caché par un rerun. La latence ponctuelle des appels filesystem/outils n'a nécessité ni assertion affaiblie ni changement de timeout.

## Artefacts et reproduction

Dossier principal : `/tmp/sumatime-qm-round12-coysRM/` : logs et métadonnées d'exécution, `matrix/`, `extra/`, `advanced/`, `cold-ack-notie/`. Première passe cold ACK conservée dans `cold-ack/` ; répétition approfondie dans `advanced/`, puis séparation explicite des timestamps dans `cold-ack-notie/`.

Depuis le dépôt, créer des répertoires de sortie neufs, puis :

```text
QM_OUTPUT_DIR=<dossier-neuf-1> QM_VARIANTS=storage-from-issuance,storage-lost-at-remount,reserved-response-lost,simultaneous-renewals node /tmp/sumatime-qm-r10b-QwUjdU/matrix.mjs
QM_OUTPUT_DIR=<dossier-neuf-2> QM_VARIANTS=ack-distinct,terminal-refusal,storage-from-issuance,same-page-boundary,direct-from-result node /tmp/sumatime-qm-round11-K6fdel/matrix-extra.mjs
QM_OUTPUT_DIR=<dossier-neuf-3> QM_VARIANTS=ack-success-cold-notie,ack-loss-cold-notie node /tmp/sumatime-qm-round12-coysRM/matrix-cold-ack.mjs
QM_OUTPUT_DIR=<dossier-neuf-4> QM_VARIANTS=ack-success-cold,ack-loss-cold,draft-edit-polling node /tmp/sumatime-qm-round12-coysRM/matrix-cold-ack.mjs
node --import=tsx /tmp/sumatime-qm-r12-server-Pd4caz/audit.mjs
node --import=tsx /tmp/sumatime-qm-r12-server-Pd4caz/migrations.mjs
node --import=tsx /tmp/sumatime-qm-r12-server-Pd4caz/migration-replay.mjs
```

Les orchestrateurs de matrices collectent les verdicts puis peuvent sortir0 : examiner `matrix-results.json` et les assertions, pas seulement l'exit code. Le harness `migration-replay.mjs` affirme la présence du défaut ; son exit0 **n'est pas un PASS produit**.

Les deux harness historiques ont un HEAD codé en dur dans leur `boundary.json` (Round10 et Round11). Ces champs ne sont pas une provenance Round12. Les runs ont chargé les sources HEAD `8b133f3` et le standalone BUILD_ID `kAoMFKOgDa0zt-yuRluIe`, contrôlés avant exécution. Le complément propre au Round12 enregistre le bon HEAD et, après rebuild QM, `BiI1IQBbCXxHYO_h-mRPH`, dont l'équivalence applicative à la preview est vérifiée ci-dessus.

## Limites et transmission

- Aucun Chromium, geste tactile natif, lecteur d'écran ou test de charge infrastructure. La recette jsdom instrumente de vrais composants/événements React mais ne constitue pas une certification navigateur exhaustive.
- La régression historique P2-2 est prouvée au niveau vraie fonction serveur/SQLite avec transport synthétique, pas par un parcours navigateur. Sa sélection terminale et ses flags sont observés directement.
- Production et GLPI réel inchangés ; aucune release. Tous les processus QA créés ont terminé ; les bases/artefacts synthétiques restent disponibles sans nettoyage destructif. Preview Round12 et ancien service Round11 préservés.
- Skill **Application Release Review** appliqué : séparation des défauts confirmés, dette préexistante et limites ; ajout du contrôle cold-process au-delà du remount React et de la preuve différentielle de migration.
- `CHECKLIST.md` relu avant verdict. Le mandat limite les écritures durables à ce rapport : le pilote a reçu le verdict exact et doit synchroniser MC/mémoire/activité sur **REVISE Round12, deux P2, propriétaire suivant Dev, puis re-revue QM ; release bloquée** avant annonce à Master. Ce rapport n'écrit pas ces registres et ne prétend pas que cette synchronisation est déjà faite.
