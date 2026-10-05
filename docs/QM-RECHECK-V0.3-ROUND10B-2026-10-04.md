# Sumatoni Time v0.3 — recette complémentaire indépendante round 10B

Date : 2026-10-04 UTC. Branche : `codex/calendar-glpi-v0.3`.
HEAD testé : `d124e1c458a5ebec8aa79892d9cb4cbb19275fbf`.

## Verdict : REVISE

**La matrice manquante du round10 a été exécutée. Elle révèle trois défauts fonctionnels P2, et non une simple insuffisance de preuves. Le verdict global ne peut donc pas devenir PASS.**

La lacune d'exécution est levée dans le périmètre ci-dessous ; la gate fonctionnelle reste rouge. Aucun P0/P1, doublon fournisseur, écriture production ou appel GLPI réel n'a été démontré. Les tests officiels round10 restent verts.

Revue guidée par [Application Release Review](/root/.openclaw/agents/main/agent/workshop-skills/application-release-review/SKILL.md), limitée à l'expiration, la persistance d'identité et le renouvellement. Aucun code applicatif ni service permanent modifié. Seul ajout au dépôt : ce rapport.

## Boundary et méthode

- Application : `/srv/projects/applications/timesheet`, HEAD ci-dessus ; modifications préexistantes de `next.config.ts`, `package.json`, `package-lock.json` conservées. Les documents/deploy non suivis préexistants n'ont pas été modifiés.
- React/Radix réels sous jsdom, vrai Next standalone local, vraies routes `/api/auth`, `/api/time`, `/api/glpi`, SQLite synthétique sous `/dev/shm`, fournisseur HTTP mock loopback. LDAP désactivé. `GLPI_WRITE_ENABLED=true` uniquement dans ces processus jetables dirigés vers le mock ; aucun environnement permanent reconfiguré.
- BUILD_ID du standalone testé : `elLaSl-zS5YorFFqBGp1t`, build de contrôle round10. Le rapport round10 établit sa correspondance normalisée 81/81 avec la preview `-p1NoSnHhobDOqr2Azqwq`. Pas de rebuild ni de remplacement de preview pendant 10B.
- Horloge partagée par le serveur Next et les workers UI via un préchargement **extérieur au dépôt** : `Date.now()` et `new Date()` lisent la même valeur entière ; les timers réseau/React restent réels. Les échéances serveur ne sont pas modifiées dans SQLite. L'intention reçue doit avoir exactement `expiresAt - now = 600000 ms`.
- Les observations sont faites à `Date.parse(expiresAt) - 1`, à `expiresAt` exactement et à `expiresAt + 1`. Le parcours same-page envoie réellement `createTicket` à ces instants : HTTP200 avant expiration ; HTTP409/`INTENT_EXPIRED` aux deux bornes expirées, puis renouvellement explicite du même UUID.
- Chaque remount principal est une **nouvelle instance Node/jsdom/React**, sans cache de module `consumedOperations`, sans mémoire du composant précédent. Seul le stockage sérialisé autorisé par le scénario est transmis. Les métadonnées de comparaison du harness ne sont jamais injectées dans les props du composant.
- Stockage indisponible : le vrai accès `window.localStorage.getItem/setItem/removeItem` lance une erreur. Le harness compte ces accès. La variante émission échoue déjà pendant la sauvegarde de l'intention ; la variante remount conserve d'abord une vraie sauvegarde puis retire l'accès dans le nouveau processus.
- Perte de session : omission de la session sur le vrai POST pré-réservation, réponse Next401, restauration de cette même session dans la nouvelle instance. Ce n'est pas une simulation de déconnexion GLPI personnelle ou d'expiration permanente de compte.
- Réponse perdue post-réservation : Next et le mock terminent réellement la création, puis le wrapper navigateur jette uniquement la réponse réussie. La réservation et le résultat existent donc avant l'expiration locale.
- Concurrence : deux vrais POST `beginDistinctCreation`, lancés par `Promise.all` pour le **même** `draft_request_id` et la même milliseconde serveur. Chaque réponse réelle alimente ensuite un worker UI indépendant qui récupère/crée avec sa capability. L'émission concurrente est API, pas deux clics natifs Chromium ; la suite traverse bien React → Next → mock pour l'utilisation des deux réponses.

## Matrice consolidée

`+POST` compte uniquement les nouveaux tickets de la demande distincte, après le ticket antérieur de fixture. Les refus d'expiration avant renouvellement et les replays du résultat réservé n'ajoutent aucun POST.

| Parcours | TTL−1 ms | TTL exact | TTL+1 ms | +POST par cas |
|---|---|---|---|---|
| Même page, soumission à la borne puis renouvellement si nécessaire | PASS | PASS | PASS | 1 |
| Stockage conservé, nouveau processus UI | PASS | PASS | PASS | 1 |
| Stockage indisponible dès émission et au remount | REVISE P2-1 | REVISE P2-1 | REVISE P2-1 | 0 |
| Stockage perdu seulement au remount | REVISE P2-1 | REVISE P2-1 | REVISE P2-1 | 0 |
| Session perdue avant réservation, restaurée au remount | PASS | PASS | PASS | 1 |
| Réservation terminée, réponse perdue, remount après expiration locale | PASS | REVISE P2-2 | REVISE P2-2 | 1 avant remount, 0 après |
| Deux renouvellements simultanés du même brouillon | PASS observé | REVISE P2-3 | REVISE P2-3 | 0 ou 1, jamais 2 |

La première passe de concurrence réussit aux trois bornes ; la seconde reproduit le défaut à TTL exact et TTL+1. Le défaut dépend de l'ordre lexical aléatoire des intentions créées dans la même milliseconde, **pas** de l'expiration propre à ces deux bornes. Le PASS observé à TTL−1 ne prouve pas une immunité de cette borne au même défaut de concurrence.

**Invariants établis :** au plus une nouvelle création mock par brouillon dans tous les cas ; aucune ligne d'alias ne relie le UUID distinct au UUID antérieur ; UUID conservé dans les parcours ordinaires de renouvellement et de restauration de session. **Invariant violé :** absence d'ancien résultat affiché après perte de stockage. Les autres défauts concernent la disponibilité et l'exactitude du parcours de renouvellement/récupération, sans duplication constatée.

## Défauts confirmés

### P2-1 — Une nouvelle page sans stockage affiche l'ancien ticket à la place du brouillon distinct

Reproduction réelle aux trois bornes, avec stockage absent dès émission **et** avec stockage perdu au remount :

1. Créer le ticket A, puis « Utiliser ce ticket » (acquittement réel).
2. Reprendre les mêmes champs, obtenir le refus distinct, puis cliquer « Commencer une nouvelle demande distincte » : le serveur émet une intention liée au UUID B, différent de A.
3. Avant réservation de B, fermer cette instance UI ; ouvrir une instance neuve sans stockage, à la borne choisie.
4. Cliquer « Nouveau ticket GLPI » après stabilisation du montage.
5. L'UI affiche **« Ticket créé dans GLPI » et GLPI-A**. À TTL exact/+1, aucun renouvellement de B n'est proposé.

Exemple TTL−1, stockage indisponible dès émission : ancien UUID `7cc9911d-b786-440f-8fff-2c6b23ff8c4a`, nouveau brouillon `2ec1fc8f-12fc-483c-9437-89072bbd9149`, ancien ticket **GLPI-120** réaffiché ; **0 nouveau POST**. L'intention B reste présente dans SQLite mais n'est pas reprise par le parcours membre-scopé.

Cause étayée : `glpiUncertainRequests` remonte les créations et les résultats acquittés, pas les brouillons d'intention non réservés (`lib/glpi.ts:307`). Sans marqueur local, `openNew` demande les résultats acquittés (`app/new-glpi-ticket.tsx:460`), le cache de consommation ne survit pas à la nouvelle page, et le premier résultat récupérable est adopté (`app/new-glpi-ticket.tsx:292`).

Ce n'est **pas** une corruption de la table d'alias ni un nouveau ticket créé : c'est une substitution silencieuse du résultat affiché, contrairement à l'intention distincte de l'utilisateur.

Preuves : `/tmp/sumatime-qm-r10b-stable-EhnMVW/storage-from-issuance-ttl-minus1-resume.json` et les cinq autres `storage-*-resume.json`, avec échanges API, UI exacte, UUID, intentions et compteurs dans `matrix-results.json`.

### P2-2 — Un résultat déjà réservé devient un brouillon « expiré » demandant un renouvellement impossible

Reproduction : création distincte B effectivement terminée, réponse navigateur perdue, stockage conservé, nouvelle instance à TTL exact ou TTL+1.

- Le résultat B est renvoyé par la lecture serveur membre-scopée, mais l'UI conserve le mode brouillon expiré.
- Elle exige « Renouveler l’intention distincte » au lieu de proposer la récupération de B.
- Ce bouton envoie le bon UUID B mais reçoit HTTP409 **`OPERATION_CONFLICT`**, « Ce brouillon possède déjà une identité GLPI ».
- Le ticket n'est pas perdu : une exploration du bouton ordinaire **« Créer dans GLPI » récupère ensuite B avec HTTP200 et 0 POST supplémentaire**, malgré l'instruction de verrouillage/renouvellement. Aucun blocage définitif ni doublon n'est donc revendiqué.

Cause étayée : l'initialisation considère tout marqueur local expiré comme un brouillon non réservé (`app/new-glpi-ticket.tsx:75`), puis `applyServerRequest` écarte le résultat de ce même brouillon car `operation.current` a été vidé (`app/new-glpi-ticket.tsx:234`). Le serveur refuse correctement de renouveler une identité déjà réservée (`lib/glpi.ts:453`).

Exemple stable à TTL exact : UUID B `06622724-e03e-414a-b66b-617c04c4fdea`. Une seconde fixture confirme le contournement par « Créer » : le ticket **GLPI-123** est récupéré sans nouvelle création.

Preuves : `/tmp/sumatime-qm-r10b-stable-EhnMVW/reserved-response-lost-ttl-exact-resume.json`, variante `ttl-plus1`, puis `/tmp/sumatime-qm-r10b-boundary-rYxdDY/reserved-response-lost-ttl-exact-resume.json` (`fallbackRecovered: true`).

### P2-3 — Deux renouvellements dans la même milliseconde peuvent rendre la capability active inutilisable

Deux appels de renouvellement simultanés réussissent pour le même UUID. Le second abandonne normalement le premier. Cependant, `draftIntentForRequest` sélectionne `ORDER BY created_at DESC,intent_id DESC` (`lib/glpi.ts:281`) : si les timestamps sont identiques, un identifiant aléatoire détermine l'autorité, pas le renouvellement actif.

Reproduction TTL exact :

- Brouillon : `d6aeb538-ede5-4b85-b738-e796e58224b0`.
- Les deux intentions sont créées à **2026-10-04T08:25:00.000Z**, valides jusqu'à 08:35.
- Intention antérieure abandonnée : préfixe `7eab0ef7…`.
- Intention finale active (`abandoned_at=null`) : préfixe `06869658…`.
- Le vrai `createTicket` avec la capability **active** et le bon UUID reçoit HTTP409 **`INTENT_REQUEST_MISMATCH`** ; aucune réservation ni nouveau POST. La comparaison serveur s'est faite avec la ligne abandonnée (`lib/glpi.ts:525`).

Même défaut reproduit à TTL+1 : intention abandonnée `93838d4d…`, active `19320b34…`, même timestamp, même refus erroné. Il s'agit d'un refus transitoire injustifié du renouvellement valide ; aucune impossibilité permanente de réessayer après une nouvelle intention n'est affirmée.

La première passe 3/3 verte avait, dans chaque paire, une intention active triant après l'abandonnée. Cette preuve passante est conservée, pas remplacée. La seconde passe donne 1 PASS/2 REVISE ; ensemble, elles couvrent les deux ordres effectivement produits par le serveur.

Preuves : `/tmp/sumatime-qm-r10b-concurrency-mQQkCh/matrix-results.json`, `simultaneous-renewals-ttl-exact-concurrency.json`, `simultaneous-renewals-ttl-plus1-concurrency.json`, réponses des deux workers et lignes SQLite.

## Exécutions et compteurs

- **Officiel round10 intégration : PASS**, premier essai, **12,427 s**. Commande : `node --import=tsx tests/glpi-round10-integration.mjs`.
- **Trois tests round10 ciblés : 3/3 PASS**, premier essai, **2,270 s** : expiry serveur, DOM, migration. Commande : `node --import=tsx --test tests/glpi-round10-expiry.test.mjs tests/glpi-round10-dom.test.mjs tests/glpi-round10-migration.test.mjs`.
- **Matrice stabilisée : 18 cas**, 10 PASS/8 REVISE/0 BLOCKED, **112,841 s**, **30 POST** (18 tickets A de fixture +12 tickets B). Sessions finales0 ; intégrité SQLite `ok`, violations FK0.
- **Bornes same-page + vérification du contournement post-réservation : 6 cas**, 4 PASS/2 REVISE/0 BLOCKED, **34,490 s**, **12 POST** (6 A +6 B). Sessions finales0 ; intégrité/FK PASS.
- **Concurrence seconde passe : 3 cas**, 1 PASS/2 REVISE/0 BLOCKED, **18,111 s**, **4 POST** (3 A +1 B). Sessions finales0 ; intégrité/FK PASS.
- Total des trois campagnes stabilisées : **27 exécutions de cas**, dont six reprises de variantes pour préciser une limite ; **21 cellules fonctionnelles distinctes** dans la matrice. **46 POST** de mock, dont27 tickets de fixture et19 demandes distinctes. Aucun cas n'a créé plus d'un B.
- Les orchestrateurs continuent volontairement après une assertion produit fausse pour compléter la matrice. Leur code de sortie0 signifie « collecte achevée », **pas PASS** : les verdicts sont dans `matrix-results.json`, les workers et les assertions JSON.

## Incidents conservés et limites

1. Première tentative du harness : échec d'infrastructure **avant toute assertion UI**, API503 avec `Date.parse is not a function`. La première enveloppe d'horloge ne reproduisait pas les propriétés statiques propres de Date attendues par Next. Correction uniquement dans `/tmp/.../clock.cjs` ; `matrix-first.log` et son résultat sont conservés. Ce n'est pas un défaut applicatif.
2. Première matrice exploratoire, **90,928 s**, 15 cas, utilisait un clic immédiatement après la résolution de `act`, pouvant annuler la requête `recover=1` au profit du timer initial. Elle montrait alors un formulaire vide dans le cas sans stockage. Une attente de stabilisation des effets a été ajoutée au harness avant le clic : la matrice de référence reproduit l'ancien résultat affiché. Les logs exploratoires ne sont ni supprimés ni utilisés pour revendiquer une acceptation des cas sans stockage.
3. Le second passage concurrent est justifié par la sélection d'autorité à timestamp égal, observée dans les lignes de la première passe ; il ne remplace pas ses PASS par convenance.
4. Pas de Chromium, geste tactile natif ou lecteur d'écran. Le gel de Date permet de vérifier le contrat aux bornes ; ce n'est pas une mesure de latence d'un navigateur réel.
5. La concurrence initiale est émise par les API locales ; les deux capacités sont ensuite utilisées par deux UI neuves. Aucun stress massif, test offensif, contournement d'autorisation ou endpoint réel n'est inclus.
6. Les autres preuves vertes de round10 ne sont pas relancées ni recomptées : build, TypeScript, API198, provider175, autres régressions et provenance restent celles du rapport précédent. Le lint global reste la dette déjà documentée (2 erreurs/3 avertissements) ; ce round ne revendique pas son succès.

## Artefacts, reproduction et clôture

Harness et logs d'orchestration/officiels : `/tmp/sumatime-qm-r10b-QwUjdU/` (`clock.cjs`, `ui-worker.mjs`, `matrix.mjs`, `run-check.mjs`, `*.result.json`). Données détaillées :

- `/tmp/sumatime-qm-r10b-stable-EhnMVW/` — matrice principale ;
- `/tmp/sumatime-qm-r10b-boundary-rYxdDY/` — soumissions exactes et contournement post-réservation ;
- `/tmp/sumatime-qm-r10b-concurrency-mQQkCh/` — seconde passe de concurrence.

Chaque dossier contient la boundary, les requêtes/réponses/UI, les compteurs mock, les lignes d'identité et l'intégrité SQLite. Les bases restent isolées sous `/dev/shm/sumatime-qm-r10b-*` ; aucun nettoyage destructif exécuté. Les journaux détaillés contiennent exclusivement des comptes/capabilities synthétiques.

Pour reproduire depuis la racine du dépôt : créer un nouveau dossier temporaire, puis lancer `QM_OUTPUT_DIR=<dossier-neuf> node /tmp/sumatime-qm-r10b-QwUjdU/matrix.mjs`. `QM_VARIANTS=same-page-boundary,reserved-response-lost` et `QM_FALLBACK=1` sélectionnent les preuves complémentaires ; `QM_VARIANTS=simultaneous-renewals` sélectionne les trois paires concurrentes. Les ports sont alloués dynamiquement et tous les processus sont arrêtés en `finally`.

Contrôles finaux : HEAD inchangé ; `git diff --check` PASS ; aucun processus de recette restant ; preview/mock permanents toujours PIDs **1215804/1215803**, démarrés à07:24:40UTC, `/login`200. Aucun redémarrage, commit, release ou déploiement effectué.

CHECKLIST relu. Le pilote doit synchroniser Mission Control/mémoire/activité sur **REVISE — trois P2 confirmés par matrice round10B, zéro doublon démontré**, avec prochaine gate : corrections ciblées puis relecture indépendante de ces trois parcours. Ce rapport ne modifie pas ces supports de coordination et ne vaut pas autorisation de release.
