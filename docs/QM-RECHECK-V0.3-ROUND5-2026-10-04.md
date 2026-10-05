# Sumatoni Time v0.3 — contre-revue QM indépendante, round 5

Date : 2026-10-04 UTC. Branche : `codex/calendar-glpi-v0.3`.
HEAD revu : `17c07b43629fbe1f8a43ab9425023ccfcf3d17e4`.

## Verdict

**REVISE — trois défauts P2 confirmés sur R2. Aucune release ni mise en production.**

Aucun P0/P1 démontré. Les quatre reproductions exactes du round 4 sont corrigées dans leur fenêtre nominale ; les challenges supplémentaires révèlent une fausse déduplication des intentions distinctes, une récupération qui recrée après expiration et une migration qui change le ticket associé à une identité historique. R1, R3, R4 et R5 restent validés dans le périmètre exécuté.

Revue selon le skill **Application Release Review**, les exigences R1–R7 et les rapports rounds 1–4. Aucun changement applicatif, commit, redémarrage de la preview permanente, accès production ou GLPI réel. Les créations utilisent uniquement des bases, comptes et fournisseurs synthétiques. Ce rapport est le seul ajout au dépôt par cette revue.

## P2-1 — une demande explicitement distincte est silencieusement remplacée par un ancien ticket

Sources : `app/new-glpi-ticket.tsx:330`, `app/new-glpi-ticket.tsx:405`, `lib/glpi.ts:300`, `lib/glpi.ts:322`.

La déduplication autoritaire recherche toute opération de même empreinte, y compris un résultat déjà acquitté conservé pendant 30 jours. L’action « Commencer une nouvelle demande distincte » génère un UUID neuf, mais aucune identité d’intention distincte n’est transmise au serveur.

Reproduction vraie React/Radix/jsdom → API Next figée → mock HTTP :

1. Créer le ticket `Daily maintenance` et afficher son résultat GLPI-114.
2. Cliquer **« Commencer une nouvelle demande distincte »** ; ressaisir les mêmes champs métier, cas légitime d’une tâche récurrente.
3. Soumettre : UUID neuf `8a8afb7e-54c7-4a13-9731-e48a980ee3af`, mais **zéro nouveau POST Ticket** ; l’interface présente encore GLPI-114.
4. Consommer le résultat, ouvrir ensuite une demande neuve et ressaisir les mêmes champs : même ancien ticket, zéro nouveau POST, message « Ticket créé dans GLPI ».

L’UUID original est `2c7045b5-baf4-4394-8eab-30fe54cd6332`. Ces deux variantes démontrent le même défaut, pas deux P2.

**Impact :** une nouvelle intention explicite ne crée pas son ticket ; l’utilisateur reçoit un succès trompeur et peut rattacher son travail à un ancien ticket. Modifier artificiellement un champ métier ne constitue pas une correction du contrat.

**Attendu :** distinguer une récupération/alias de la même opération d’une intention de création explicitement nouvelle, tout en conservant la réservation atomique et la protection des réponses inconnues.

Preuve : `/tmp/sumatime-qm-r5-review-wYhCnw/deep.mjs`, `deep-first.log`.

## P2-2 — l’expiration efface l’identité, puis « Récupérer » crée un deuxième ticket

Sources : `lib/glpi.ts:153`, `lib/glpi.ts:311`, `lib/glpi.ts:334`, `db/raw.ts:48`, `app/new-glpi-ticket.tsx:461`.

La purge supprime l’opération acquittée et ses alias par cascade. Aucun marqueur durable ne distingue ensuite un UUID expiré d’un UUID jamais envoyé. Or un autre formulaire peut encore conserver cette même demande comme incertaine.

Reproduction avec **deux processus React indépendants**, sans localStorage/BroadcastChannel, vraie API et vrai mock :

1. Deux UUID soumettent la même demande ; les réponses navigateur sont perdues. Le serveur produit correctement **un seul POST Ticket**.
2. Une autre interface consomme le résultat autoritaire.
3. Accélérer uniquement l’expiration dans la base synthétique, pour représenter une opération ancienne avec une session utilisateur courante. Aucun test n’a attendu réellement 30 jours.
4. Dans le second processus toujours ouvert, cliquer seulement **« Récupérer le résultat »**, avec son UUID déjà soumis et son payload inchangé.

Résultat : **deux POST Ticket au total**, sans action « demande distincte ». L’UUID secondaire `60879b9d-7410-4982-b6f7-f2d8ee054481` apparaît identique avant/après dans le log ; l’original était `0b021c03-2c3d-4367-bcc0-71687c5f2727`.

Une rétention bornée n’est pas intrinsèquement incorrecte ; le défaut est le renvoi implicite depuis une action de récupération après suppression de la preuve d’identité. La limite de 30 jours n’est ni contractualisée dans les exigences R2 ni appliquée/annoncée par l’interface. Une expiration ne doit pas transformer une récupération en création neuve silencieuse.

**Extension temporelle confirmée :** le backfill utilise `datetime(..., '+30 days')`, avec un espace, puis compare lexicalement à un ISO avec `T`. Une vraie migration supprime un résultat **22 h 25 avant** son échéance prévue ; le replay du même UUID crée alors GLPI-115 après GLPI-114, deux vrais POST mock. Un autre harnais, horloge figée, confirme une purge quatre heures trop tôt. Cette erreur arithmétique est un sous-problème de la rétention, pas un quatrième P2 compté séparément.

**Attendu :** une identité connue expirée doit rester fail-closed ou être explicitement distinguée d’une nouvelle intention ; normaliser les instants d’expiration et préserver les opérations réellement incertaines.

Preuves : `/tmp/sumatime-qm-r5-review-wYhCnw/expired-alias-ui.mjs`, `expired-alias-first.log`, `deep-first.log` ; `/tmp/qm-round5-calendar-01lZde/ttl-first.log` ; `/tmp/qm-round5-static-0t0n36/ttl-migration.log`.

## P2-3 — la migration de plusieurs résultats change le ticket associé à un UUID historique

Sources : `db/raw.ts:112`, `db/raw.ts:128`, `lib/glpi.ts:218`, `lib/glpi.ts:322`.

Le vrai provider historique `ddedc36` crée deux tickets confirmés, GLPI-118 et GLPI-119, sous deux UUID et une même empreinte métier. Le round 5 choisit un gagnant et relie l’identité du second résultat au premier.

Après la vraie migration :

- UUID `1889d4f3-5769-476c-849a-c7611e14c75a`, dont le résultat historique est **119**, est aliasé vers `3b5e49e2-1969-48b0-b338-f333ea030aeb`, résultat **118**.
- Rejouer le premier UUID renvoie **118**, pas son résultat confirmé **119**.
- Acquitter ce UUID avec `ticket_id:119` retourne **`ok:false`**.
- La ligne historique contenant 119 existe encore et `recover=1` peut la retourner ; il ne s’agit donc pas d’une suppression physique immédiate. Mais le résultat retourné par la lecture et celui accepté par replay/ACK sont contradictoires.

Six créations historiques ont servi à la matrice (résultat + incertitude, deux incertitudes, deux résultats). **Aucun POST supplémentaire après migration**, SQLite/FK saines, sessions finales zéro. Le défaut est une corruption de correspondance identité/résultat et une consommation impossible, pas un nouveau doublon créé par la migration.

**Attendu :** ne pas écraser sémantiquement plusieurs résultats fournisseurs déjà confirmés en les déclarant équivalents à un seul ticket. Préserver une récupération/consommation cohérente de chacun, ou exposer leur conflit à résoudre explicitement.

Preuves : `/tmp/qm-round5-calendar-01lZde/duplicates.mjs`, `duplicates-worker.mjs`, `duplicates-retry.log`.

## Régressions et corrections validées

- **Round 4 / ACK perdu : PASS nominal.** Réponse ACK perdue après commit, remontage avant retry, résultat récupéré, ACK idempotent, callback `onCreated` une seule fois, un seul POST Ticket. Neuf ACK concurrents via alias retournent le même résultat ; mauvais ticket et autre membre refusés ; le retry ne décale pas l’échéance.
- **Round 4 / alias après consommation : PASS avant expiration.** Deux identités réellement soumises dans deux processus, un POST ; après consommation ailleurs, récupération du même UUID secondaire sans nouveau POST. La variante formulaire déjà ouvert mais pas encore soumis passe aussi. La limite d’expiration est P2-2.
- **Round 4 / migration legacy result-less : PASS pour le défaut exact.** Vrai provider `d541231`, quatre créations acceptées dont trois réponses perdues, migration vers la preview actuelle : incertitudes conservées et bloquantes, ancienne création réussie non bloquante. Nouvelle identité refusée avant POST ; abandon explicite et récupération API sur preuve testés, scopes membre/origine/auth conservés. Aucun nouveau POST après migration.
- **Round 4 / distinct-loading : PASS pour le défaut exact.** Depuis un résultat terminé, nouvelle demande avec champs différents, catégories rechargées, bouton actif. Polling après 2,3 s conserve les nouveaux champs. La fausse déduplication à champs identiques est P2-1.
- **Round 3 : les cinq défauts exacts restent fermés.** Aucun ACK caché au montage ; récupération avec stockage fonctionnel/perdu/corrompu/quota/désactivé ; réponse tardive Alice ignorée après changement membre ; logout/login sans divulgation Bob ; concurrence avant ACK dédupliquée ; demande distincte non écrasée par polling ; ancien résultat confirmé seul ne bloque plus les créations.
- **R1 : PASS.** Vrais handlers React d’undo, uniquement action/id/version/date/start/end, restauration API exacte 06:07–07:22, sept champs métier conservés, version courante et vrai conflit 409. Les clics React utilisent une API instrumentée ; le même helper/payload est ensuite vérifié séparément contre la vraie API. Aucune requête unique UI→API réelle n’est revendiquée pour cet undo.
- **R3 : PASS.** Provider 173 assertions, sélection d’entité strictement `true`, refus false/HTTP/malformed avant appels dépendants, sessions fermées.
- **R4 : PASS, 14 tests React/DOM.** Deux ajustements successifs start/end/move, reload parent tardif, erreurs/conflit, disparition/facturation/hors semaine, navigation pendant sauvegarde, undo et suppression ; focus précis ou fallback connecté.
- **R5 : PASS, 29 assertions.** Instants mesurés printemps/automne, bornes exactes et ±1 ms, franchissement réel, arrondi et minuit ; champs de correction éditables.

## Suites et challenges

- Unitaires/DOM officiels : **33/33 PASS**, premier essai. Les sous-tests DOM inclus ne sont pas comptés une seconde fois.
- Intégration officielle React → Next → mock : **58 assertions PASS**, cinq POST Ticket. Seuls les imports et le chemin standalone du harnais copié ont été adaptés pour utiliser le build figé ; aucune assertion retirée.
- API **198 PASS**, provider **173 PASS**, premier essai ; provider quatre POST Ticket, zéro session finale.
- Calendar/workday/DOM officiel ciblé : **13/13 PASS**, également couvert en partie par la suite complète.
- Reprise indépendante round 3 : **26/26 invariants PASS** après stabilisation DOM documentée ci-dessous ; onze POST Ticket.
- Challenge ACK/polling/canonicalisation/champs/membre : **21/21 PASS**, douze POST Ticket. Trim et allowlist serveur, payload modifié sur même UUID refusé, variations titre/description/type/urgence/catégorie distinctes.
- Alias après ACK : **6/6 PASS**, un POST Ticket. Alias expiré : **5/6 PASS / 1 FAIL**, deux POST Ticket, confirmation P2-2.
- Challenge profond identité/alias/TTL : **24 invariants, 21 PASS / 3 FAIL** ; deux variantes P2-1 et une preuve API de P2-2. Huit alias ordinaires convergent directement, aucun cycle/chaîne naturel ou contournement membre/API démontré.
- Deux processus Next partageant SQLite : **14/14 PASS**, dont dix courses atomiques, une seule création par paire ; clients distincts non confondus.
- Arrêts Next avant POST (`changeActiveEntities`) et après POST (`killSession`) : **9/9 PASS** avec contrôle distinct-loading ; réservations conservées, aucun renvoi après reprise. Les sessions interrompues brutalement sont fermées explicitement dans ce seul harnais ; aucune prétention de nettoyage automatique après crash.
- Coupures précises avant/après COMMIT réservation et résultat : **48/48 PASS**, trois POST au total, zéro session finale ; avant réservation rien de partiel et reprise une fois, après réservation incertitude sans envoi, avant commit résultat aucun deuxième POST, après commit résultat replay exact. Instrumentation seulement dans les processus de test, source inchangée.
- Migration legacy/API/permissions/backup/undo : **50 contrôles PASS** dans la recette élargie. Les challenges de résultats multiples et TTL produisent les défauts décrits, ils ne sont pas neutralisés par ce nombre.
- TypeScript **PASS**, build production **PASS au premier essai, 93,105 s**.
- Lint ciblé **32 fichiers, zéro erreur/warning** ; diff-check depuis `087da9e` **PASS**.
- Lint global **FAIL : deux erreurs / trois warnings préexistants**, dans `app/login/page.tsx`, `components/client-color.tsx`, `app/account-panel.tsx`. Fichiers et configuration ESLint octet-identiques à `087da9e`. Ne pas annoncer le lint global vert.
- SQLite/FK **PASS** sur preview en lecture seule, API/provider, bases de recettes, migrations et sauvegardes. Backup Linux **29 vérifications PASS**, neuf tables comparées, quatre alias préservés, clé/permissions/manifeste/hashes corrects.

## Provenance et frontière

- Preview figée `/opt/sumatime-preview/releases/v0.3.0-round5-20261004`, `127.0.0.1:5174`, mock permanent `127.0.0.1:8792`.
- PID preview/mock **1144707 / 1144703**, inchangés. DB preview séparée, URL GLPI strictement loopback mock, LDAP désactivé. Aucun secret réel affiché.
- Avant rebuild : **81/81 fichiers identiques**, BUILD_ID commun `BQ9-3sdpPNFoix4EC8p1Z`.
- Après rebuild local : **70/81 hashes bruts identiques, 81/81 normalisés**, différences seulement BUILD_ID/ordre JSON. Nouveau BUILD_ID local `EK_yH_APtctXFG7lxUmAL` ; preview inchangée.
- Route GLPI SHA-256 `357e1e2f0b1296d0c3ecf2c25625a579e57dc3c4e11c9bb27f9fbcdab6ce960d`, page serveur `ffb77398da90f0853f30fe25354165e1acf7a02d50cc13fc628e0e558889b8ca`, chunk UI `7fd6196164cceca22b4aa25eb3a8f0be4df946c724d800a2154b1b05b22a63dc` : strictement identiques preview/rebuild.
- **26 assets servis** correspondent aux hashes disque ; `/login` 200, API GLPI/récupération anonymes 401 avant/après build.
- **198 fichiers source/non-suivis inchangés** au contrôle statique final. Dirty initial conservé : `next.config.ts`, `package.json`, `package-lock.json` ; dix non-suivis initiaux (quatre deploy et six docs). Ce rapport seul s’ajoute ensuite.
- Tests applicatifs contre copies immuables du standalone avec bases `/tmp`/`/dev/shm`, jamais la DB preview pour les écritures. Hashes DB/WAL preview inchangés pendant les contrôles en lecture seule.

## Dette, limites et premiers incidents conservés

- Recette React/Radix/jsdom et vrais processus indépendants ; pas d’onglets Chromium ni de pointer/tactile natifs instrumentés. Aucune acceptation native revendiquée.
- Le premier replay indépendant a consigné un échec d’observation « deux créateurs » après seulement 30 ms de transition DOM. La récupération manuelle conservait déjà UUID/compteur. Avec attente de stabilisation 200 ms et capture DOM, les 26 invariants passent. `integration-first.log` reste conservé ; aucune modification produit ou suppression du premier échec.
- Premier harnais migration : mauvais libellé de bouton recherché (« Créer un ticket GLPI » au lieu de « Nouveau ticket GLPI »), corrigé uniquement dans le test ; log conservé. Premier challenge doublons : hypothèse incorrecte d’une exception encore incertaine malgré un résultat canonique disponible ; adaptation du harnais, puis défaut d’identité 119→118 confirmé.
- Aucun timeout/incident infrastructure du build ou des suites statiques dans ce round. L’échec lint global reste distinct.
- **P3 préexistant :** deux processus migrant simultanément un ancien schéma peuvent produire `duplicate column name: payload_json`, lecture de schéma avant verrou transactionnel ; base finale saine. Reproduit, pas observé sur preview mono-process.
- **P3 / parcours legacy incomplet côté UI :** l’interface propose seulement l’abandon après vérification qu’aucun ticket n’existe. Si un ticket historique existe, la récupération par preuve fonctionne via API, mais n’a pas de parcours UI. Ne pas présenter l’abandon comme une résolution correcte de ce cas. Un support technique reste nécessaire ; aucun P2 additionnel compté sans exigence UI plus explicite.
- Une variante multi-legacy puis récupération API a gardé « Chargement… » dans une instance ouverte ; l’abandon d’un unique legacy avec serveur débloqué fonctionne. Ce comportement étroit n’est pas établi comme nouveau P2.
- Les harnais de diagnostic journalisent explicitement PASS/FAIL. Leur exit 0 peut signifier « preuve terminée », pas « produit accepté ».

## Preuves et gate suivante

- Fonctionnel UI/API/mock : `/tmp/sumatime-qm-r5-review-wYhCnw/` ; logs `official-first.log`, `integration-first.log`, `integration-settled.log`, `challenge-first.log`, `alias-first.log`, `crash-first.log`, `deep-first.log`, `expired-alias-first.log`, `two-next-first.log`.
- Statique/provenance/backup : `/tmp/qm-round5-static-0t0n36/RESULTS.md` et `EXTRA-REVIEW.md` ; crash précis `crash-commits.log`, TTL `ttl-migration.log`.
- Calendrier/DST/migration : `/tmp/qm-round5-calendar-01lZde/RESULTS.md` ; `dom-first.log`, `calendar-workday-dom.log`, `dst-first.log`, `migration-expanded.log`, `duplicates-retry.log`, `ttl-first.log`.

**Retour Dev sur les trois P2**, sans affaiblir les invariants de réponse inconnue, la réservation atomique, l’isolation membre/API ou les anciennes corrections. Puis nouvelle preview figée et contre-revue indépendante. **La v0.3 reste non livrable avant PASS.**

Le pilote doit synchroniser Mission Control, la mémoire et l’activité avec exactement ce verdict, les trois P2 et les validations R1/R3/R4/R5, puis revérifier CHECKLIST avant annonce à Master. Cette sous-revue transmet les preuves et le verdict ; elle ne modifie pas les supports de coordination du pilote.
