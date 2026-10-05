# QM — Sumatoni Time v0.3, Round 13

Date : 2026-10-04 UTC. Revue indépendante du commit `9682134` après le verdict Round 12.

## Verdict : REVISE

**Deux P2 confirmés : un ACK consommé réapparaît après le fallback `sessionStorage`, et plusieurs tombstones historiques génération zéro bloquent toute la récupération GLPI du membre/API. Aucun P0/P1 ni doublon fournisseur démontré. Aucune autorisation de release ou de déploiement.**

Les deux reproductions initiales du Round 12 sont corrigées dans leur périmètre nominal : ACK durable en `localStorage` et replay de la réservation historique valide. Les variantes ci-dessous restent bloquantes. Les suites standard passent ; la preview annoncée s'est arrêtée pendant la revue et son contrôle de santé final est **non validé**.

## Frontière, worktree et provenance

- Dépôt `/srv/projects/applications/timesheet`, branche `codex/calendar-glpi-v0.3`, HEAD exact `9682134d285f1106abd94043b922d7c21af31ced`, parent exact `8b133f3ebe225c81714994f1312a693d8cef2924`, inchangés pendant la revue.
- Diff réel inspecté : six fichiers, 536 insertions / 47 suppressions : `app/new-glpi-ticket.tsx`, `lib/glpi-draft.ts`, `lib/glpi.ts`, `tests/glpi-dom.test.mjs`, `tests/glpi-round13-authority.test.mjs`, `tests/glpi-round13-dom.test.mjs`. Lecture des callers UI/API, de la réservation et des migrations `db/raw.ts`, avec sous-revue serveur indépendante.
- Dirty préexistant préservé : `next.config.ts`, `package.json`, `package-lock.json` modifiés ; quatre fichiers deploy preview et documents requirements/évolution/revues précédentes non suivis. Aucun source applicatif édité, aucun commit, aucun déploiement. Seul ajout durable au dépôt : ce rapport. Le rebuild modifie seulement les artefacts ignorés `.next`.
- Preview annoncée : application `127.0.0.1:5177`, mock `127.0.0.1:8795`, release `/dev/shm/sumatime-round13-preview-88r9qj/release`, BUILD_ID `8I6K-mmR3IYavjtPPUfwd`. Au contrôle initial, les PID 1255082/1255067 et les listeners existaient ; le cwd et les variables sélectionnées confirmaient la base tmpfs, LDAP désactivé et GLPI mock loopback uniquement. À la sous-revue provenance, PID/listeners avaient disparu : `/login`, API anonyme et `initSession` retournent `ECONNREFUSED`. Aucun redémarrage tenté, cause d'arrêt non attribuée.
- Artefact offline source/release identique avant rebuild : 26/26 statiques communs, 47/47 fichiers serveur de la release, public 8/8 et drizzle 9/9. La release contient deux vieux manifestes statiques supplémentaires sous `4E0Eu_j8y4b0S4C4d2t8o`; le local contient seul `interception-route-rewrite-manifest.js`.
- SHA256 source/release identiques : `server.js` = `0c4a8c7f407465f22a8fbab69c8d17994593e7fc036f412c63e3e905910d86d2` ; API GLPI = `25217429949d50d6b2fd56f4f62db466e875b38ec2affad71cefa57e6091d101` ; page = `621c04275e0965946f69acb62bbaa0c6100cd23cee737194ffb9d0973f165183`.
- Rebuild QM indépendant : BUILD_ID `XkpSAZC9BlDEGtPPRFH5_`, non activé. Bundles server/API/page inchangés ; 39 fichiers serveur exactement égaux, sept égaux après normalisation du BUILD_ID, `app-paths-manifest.json` strictement égal après parsing JSON (ordre des clés seulement). Les 26 statiques correspondent après normalisation du chemin BUILD_ID. Pas d'écart applicatif inexpliqué.
- Tests HTTP : nouvelles bases tmpfs, Next et mock GLPI temporaires loopback. Tests UI : vrais composants React/Radix sous jsdom, vraies routes Next/SQLite ; phases émission/reprise dans des processus Node distincts. Les premières matrices utilisent le standalone local avant rebuild ; les matrices complémentaires sont épinglées sur le `server.js` de la release Round 13 ci-dessus. Aucun GLPI réel ni production.

## P2-1 — Le fallback ACK accepte une consommation non durable entre sessions

Sources : `lib/glpi-draft.ts:64`, `:338`, `:349`, `:361` ; `app/new-glpi-ticket.tsx:382`, `:423`, `:952`.

`markGlpiCreationAcknowledged` essaie `localStorage`, puis accepte `sessionStorage` comme succès. `consumeCreated` retire alors l'UUID pending et appelle `onCreated`. Le marqueur ACK est pourtant perdu dans une nouvelle session/onglet sans l'ancien `sessionStorage`. Le serveur conserve légitimement le résultat ACK dans `recoverable` ; sans marqueur client, l'UI le réadopte automatiquement.

### Reproduction réelle UI → Next → SQLite → mock

1. Créer puis consommer A normalement ; son marqueur ACK demeure en `localStorage`.
2. Créer B par intention explicitement distincte, même empreinte métier, UUID propre. Avant de consommer B, simuler `QuotaExceededError` sur les écritures `localStorage` uniquement ; les lectures et suppressions restent possibles. `sessionStorage` reste disponible.
3. Recevoir ACK HTTP 200 pour B. Le fallback écrit son marqueur en `sessionStorage`. Le callback B est exécuté **une fois** et le pending B est retiré. Dans la même page, « Nouveau » affiche bien un formulaire neuf.
4. Fermer le processus UI ; ouvrir un nouveau processus/page avec le snapshot réel de `localStorage`, mais une nouvelle session sans l'ancien `sessionStorage`.
5. **B déjà consommé réapparaît comme « Ticket créé dans GLPI », avec « Utiliser ce ticket » ; aucun formulaire neuf.** A est correctement filtré par son marqueur persistant. Il ne s'agit donc pas d'un choix arbitraire entre deux résultats ni d'une égalité d'ACK.

Cas principal : B UUID `147348b5-8936-411d-87d9-3001f2bbc3ef`, ticket **GLPI-123**, ACK B à `2026-10-04T09:00:02.000Z` contre ACK A à `09:00:01.000Z`. Le JSON de preuve contient les deux snapshots : A uniquement dans localStorage, B uniquement dans sessionStorage. Deux POST fournisseur A/B, aucun POST additionnel à la reprise.

**Reproduit aux trois bornes de capability TTL−1, TTL et TTL+1**, tickets B 123/125/127. L'ACK est confirmé, le callback est déjà consommé et `distinctDrafts` est vide dans chaque cas. Le défaut porte sur `recoverable` et sur la garantie de consommation durable, pas sur une duplication de ticket GLPI.

Preuves : `/tmp/sumatime-qm-round13-0yuPxz/ack-adversarial/ack-success-quota-notie-ttl-minus1-issue.json`, `*-resume.json`, variantes exact/plus1 et `matrix-results.json`. Le snapshot session est enregistré séparément ; aucune suppression artificielle d'un marqueur local valide n'est nécessaire.

Attendu : ne pas conclure une consommation durable inter-session à partir d'un stockage limité à l'onglet, ni réintroduire automatiquement un résultat consommé faute de ce marqueur. Préserver le replay exact nécessaire aux ACK inconnus et ne pas utiliser un cache de module comme autorité.

## P2-2 — Deux tombstones historiques bloquent toutes les opérations du membre/API

Sources : `lib/glpi.ts:307`, `:338`, `:402`, `:495` ; caller `app/api/glpi/route.ts:56`, récupération UI `app/new-glpi-ticket.tsx:374`.

Le nouveau `highestGeneration` exige une ligne unique à la génération maximale. Les anciennes intentions migrent toutes à génération zéro. Quand un ancien renouvellement puis son remplaçant sont tous deux abandonnés, `draftIdentityForRequest` lève `OPERATION_CONFLICT`, même avec des dates distinctes. `distinctDraftsForMember` appelle cette fonction **avant** d'écarter les lignes abandonnées ; l'erreur interrompt toute la projection du membre/API, y compris ses autres UUID valides.

### Reproduction historique authentique, sans insertion artificielle d'intention

1. Avec les vrais `db/raw.ts` et `lib/glpi.ts` archivés du Round 10 `d124e1c`, émettre puis renouveler deux intentions pour le même UUID à `10:00:00.123Z` puis `10:00:01.123Z`. La première est abandonnée par le renouvellement.
2. Fermer la base et appliquer la migration officielle HEAD : les deux intentions reçoivent génération zéro.
3. Le vrai `beginGlpiDistinctCreation` Round 13 rattache le payload à la seconde intention active ; le vrai `abandonGlpiDistinctCreation` Round 13 l'abandonne. Les deux tombstones sont conservés.
4. Sur exactement cette base, **Round 12 retourne une liste vide saine ; Round 13 lève HTTP 409 `OPERATION_CONFLICT`, `retryable=false`, `preserveOperation=true`**. Le renouvellement explicite du même UUID retourne aussi 409 ; il n'existe pas de résolution UI de ce conflit historique.
5. Créer un autre UUID directement par la vraie fonction backend : ticket 119, un seul POST synthétique. Round 12 le liste ; Round 13 refuse encore toute la liste à cause du brouillon abandonné indépendant. Bob et l'autre API restent non affectés.

Preuve : `/tmp/sumatime-qm-r13-server-5CPgkO/all-abandoned-authentic.mjs`, `all-abandoned-authentic-results.json`, base `/dev/shm/qm-r13-authentic-hejjub/audit.sqlite`. Les copies historiques ne changent que les imports ; transport fournisseur synthétique, aucune connexion réelle.

### Confirmation HTTP et UI

Une fixture équivalente issue de la comparaison différentielle, réattribuée au compte/client/mock synthétiques de la recette, donne réellement :

- `GET /api/glpi?uncertain=1&recover=1` **409 `OPERATION_CONFLICT`** ; le fallback sans `recover` échoue aussi.
- Nouvelle page React : message « L’historique GLPI de ce brouillon est ambigu. Aucun nouveau ticket ne sera envoyé. » ; bouton **« Créer dans GLPI » désactivé**. Aucun POST Ticket.
- Intégrité `ok`, FK `[]`, sessions mock finales 0.

Preuves : `/tmp/sumatime-qm-round13-0yuPxz/history-ui/`, `history-ui.log`. Le cas est également reproduit avec timestamps égaux et ordre lexical des capabilities inversé ; il ne dépend ni d'une égalité de dates ni d'un ID particulier.

Attendu : conserver les tombstones et refuser tout replay créateur d'un UUID réellement abandonné, mais ne pas laisser cet historique inactif faire échouer la projection et les opérations indépendantes du même membre/API. Ne pas réintroduire l'ordre lexical des capabilities comme chronologie.

## Contre-preuves et régressions

- **Migration P2 Round 12 précise : corrigée.** Ancien tombstone `f…`, capability active `a…`, mêmes timestamps/génération zéro ; le vrai Round 11 crée 118. Replay sans capability : Round 11 = 118, Round 12 = `INTENT_ABANDONED`, Round 13 = 118. Avec capability consommée et via begin : 118. Replay Round 13 après 366 jours : 118. Zéro POST pendant les replays. Variantes ordre lexical inversé et timestamps distincts correctes. Six fixtures différentielles au total, intégrité/FK correctes.
- **ACK nominal : quatre cas cold-process PASS**, ACK confirmé/perdu × timestamps égaux/distincts. A et B confirmés ne réapparaissent pas quand le marqueur local est durable. ACK B perdu : callback 0 avant fermeture ; action explicite « Récupérer le résultat » rejoue le même UUID/payload, restitue B et permet callback 1, jamais A, sans POST fournisseur supplémentaire.
- **Expiration ACK/pending : PASS.** Après plus de sept jours et nouvelle authentification, B dont la réponse ACK était perdue est récupéré exactement malgré l'expiration du pending local. Après plus de 31 jours, A/B consommés ne reviennent pas. Replay serveur exact après expiration de liste et après 31/366 jours reste idempotent dans l'audit serveur.
- **Round 10B :** matrice initiale 11/12 assertions de scénario vertes ; le cas concurrent TTL exact voit temporairement `CREATION_UNCERTAIN` pendant l'autre POST, ce que l'ancien harness rejetait. Aucun doublon, UUID correct. Complément avec attente puis récupération explicite de cette même opération : **3/3 bornes concurrence PASS**, six POST totaux A/B, sessions 0, intégrité/FK correctes. Les trois autres parcours initiaux (stockage absent, stockage perdu, réponse create perdue) passent aux trois bornes.
- **Complément Round 11 : 11/11 PASS** : ACK même page, refus certain cold-process, soumission sans stockage, soumission exacte à TTL−1/TTL/TTL+1, nouvelle demande distincte depuis résultat non consommé. Rejet terminal reste `rejected` ; reprise explicite conserve le tombstone et retire seulement l'ancienne projection.
- **Complément Round 12 :** édition titre/description après polling réel 2,6 s PASS, payload soumis inchangé.
- **Audit serveur complémentaire PASS** : scopes membre/API, abandons après 366 jours sans alias/création, consumed sans réservation fail-closed, renouvellement à expiry, migration active unique/génération/index partiel, réouverture idempotente, DDL 0006, rollback d'une reprise invalide. Sessions finales 0 et intégrité/FK correctes.
- **Anciens P2 majeurs :** suites réelles DOM/API couvrant Alice/Bob et réponses tardives, multi-tab/process, UUID distinct, pertes create/ACK, rejet terminal ; undo sérialisé/version courante et vrai conflit, deux ajustements clavier avec focus conservé après reload parent tardif, DST mesuré avant/across/après transitions. Aucun défaut nouveau reproduit dans ces parcours.

## Gates standard

- `node --import=tsx --test tests/*.test.mjs` : **55/55 PASS**, 10,285 s ; Round 11/12/13 inclus.
- Intégration R2 officielle **inchangée** : **101 assertions PASS**, 41,411 s, 12 POST principaux mock ; second ticket distinct confirmé.
- Intégration Round 9 : PASS, 10,570 s. Round 10 : PASS, 11,832 s.
- API : **198 assertions PASS**, 5,284 s. Provider : **175 assertions PASS**, 17,183 s, quatre POST attendus, sessions finales 0. Exécutions séquentielles sur leur port partagé.
- TypeScript `--noEmit --incremental false` : PASS, 7,056 s. ESLint des six fichiers Round 13 : PASS, 3,432 s. `git diff --check` : PASS.
- Lint global : **FAIL préexistant**, deux erreurs / trois warnings dans `app/login/page.tsx`, `components/client-color.tsx`, `app/account-panel.tsx`. Aucun diff Round 13 sur ces fichiers, aucune désactivation de règle ajoutée.
- Build webpack standalone : PASS, 127,863 s ; pas de timeout ni rerun, fin de collecte des traces lente. Source/release comparées ci-dessus, sans activation.
- Vrai `scripts/backup.mjs` sur base QA provider : intégrité source/backup `ok`, FK `[]`, comptes égaux des 13 tables, dont six créations / sept aliases ; clé GLPI synthétique identique. Backup `/dev/shm/sumatime-qm-r13-suites-APdHDZ/backups/timesheet-2026-10-04T12-32-41.026Z.sqlite`.
- Toutes les bases des matrices complémentaires contrôlées : intégrité `ok`, FK `[]`. Tous les processus QA créés sont terminés ; les fixtures/logs synthétiques restent disponibles.

## Premières passes et limites conservées

- L'ancien harness cold ACK attendait une présentation automatique du résultat ; ses deux cas ACK perdu échouent initialement. La nouvelle UI affiche volontairement « Récupérer le résultat ». Le complément clique cette action réelle, sans modifier l'application, et prouve le même UUID/résultat/callback. Ces premiers logs restent dans `cold-first/` ; ils ne sont pas comptés comme deux défauts produit supplémentaires.
- L'ancien harness concurrence n'acceptait pas l'état transitoire `CREATION_UNCERTAIN` ; premier résultat conservé dans `prior-matrix/`, complément causal dans `concurrency-completion/`. Aucun second POST pour le même UUID.
- Premier harness différentiel serveur : rejouer un UUID abandonné avec Round 11 recréait effectivement un ticket (défaut Round 11 connu) et contaminait la fixture. Cette mutation a été retirée des comparaisons de **listes abandonnées**, puis six bases neuves utilisées. Les comparaisons de replay valide Round 11/12/13 sont maintenues.
- Premier contrôle de backup temporaire : comparaison stricte objet SQLite null-prototype contre objet littéral échouée alors que l'intégrité valait `ok`. Correction de cette assertion du harness seulement, rerun complet PASS ; preuve `backup-check-initial-failure.txt` conservée. Aucun test applicatif affaibli ; aucune suite officielle n'a nécessité de rerun.
- Preview finale indisponible : impossible de revendiquer `/login` 200, API anonyme 401 ou téléchargement des chunks **sur les ports annoncés** durant cette recette. L'identité des artefacts offline est prouvée, et les mêmes artefacts ont été exercés sur ports QA isolés ; ce n'est pas une validation de santé de la preview arrêtée.
- Pas de Chromium, geste tactile natif, lecteur d'écran ou test de charge. jsdom exécute les vrais composants/événements React, mais ne vaut pas certification navigateur exhaustive.

## Artefacts, reproduction et transmission

- Matrices UI/HTTP : `/tmp/sumatime-qm-round13-0yuPxz/` (`ack-adversarial/`, `ack-age7/`, `ack-age31/`, `history-ui/`, `prior-matrix/`, `prior-extra/`, `concurrency-completion/`, `cold-first/`).
- Migration/audit serveur : `/tmp/sumatime-qm-r13-server-5CPgkO/REPORT.md`, harnesses différentiels/authentiques et sorties JSON.
- Gates/provenance/backup : `/tmp/sumatime-qm-r13-suites-8M4C9L/REPORT.md`, logs et `provenance-before.json`, `provenance-after.json`, `normalized-comparison.json`.

Depuis le dépôt et avec un répertoire de sortie neuf existant :

```text
QM_OUTPUT_DIR=<sortie-neuve> QM_VARIANTS=ack-success-quota-notie node /tmp/sumatime-qm-round13-0yuPxz/matrix-cold-ack.mjs
QM_OUTPUT_DIR=<autre-sortie-neuve> QM_VARIANTS=history-abandoned node /tmp/sumatime-qm-round13-0yuPxz/matrix-history.mjs
node --import=tsx /tmp/sumatime-qm-r13-server-5CPgkO/all-abandoned-authentic.mjs
node --import=tsx /tmp/sumatime-qm-r13-server-5CPgkO/migration-differential.mjs
```

Les harnesses de matrices collectent les verdicts et peuvent sortir 0 : lire `matrix-results.json`, pas seulement l'exit code. Les harnesses historiques Round 10B/11 contiennent un ancien HEAD statique dans `boundary.json` ; ils ont ici chargé le HEAD Round 13 vérifié. Les compléments épinglent le serveur de la release Round 13 : pour une future revue, changer explicitement l'artefact cible et vérifier sa provenance. Le champ buildId de certaines sorties complémentaires lit le build local, reconstruit pendant la revue ; l'artefact effectivement exécuté reste la release épinglée `8I6K-mmR3IYavjtPPUfwd`, pas le rebuild QM.

Skill **Application Release Review** appliqué : distinction entre fonctionnement nominal, contre-tests adversariaux, dette lint et limite de preview. `CHECKLIST.md` relu avant verdict. Le mandat limite les écritures durables à ce rapport : **le pilote doit synchroniser Mission Control/mémoire/activité sur REVISE Round 13, deux P2, preview arrêtée, propriétaire Dev puis re-revue QM, release bloquée** avant annonce à Master. Ces registres ne sont pas modifiés par cette sous-revue.
