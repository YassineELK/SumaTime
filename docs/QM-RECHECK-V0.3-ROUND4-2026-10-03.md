# Sumatoni Time v0.3 — contre-revue QM indépendante, round 4

Date : 2026-10-03 UTC. Branche : `codex/calendar-glpi-v0.3`.
HEAD revu : `ba1fd64246a2b84fb931fc0e5e9387936c4d93db`.

## Verdict de release

**REVISE — quatre défauts P2 confirmés sur R2. Aucune release ni mise en production.**

Aucun P0/P1 démontré dans cette revue. R1, R3, R4 et R5 restent validés dans le périmètre exécuté. La preview correspond au code revu ; les résultats unitaires, API, provider et build ne compensent pas les quatre défauts fonctionnels ci-dessous.

Revue conduite selon le skill Application Release Review, les exigences R1–R7 et les rapports rounds 1–3. Aucun code applicatif modifié, aucun commit, aucun redémarrage de la preview permanente, aucun accès au GLPI réel ou à la production. Les créations de recette utilisent uniquement des comptes, bases et fournisseurs simulés. Le présent document est le seul ajout au dépôt par cette revue.

## P2-1 — acquittement non idempotent après perte de réponse

Sources : `lib/glpi.ts:161`, `lib/glpi.ts:173`, `app/new-glpi-ticket.tsx:446`.

Sur le vrai parcours React → API Next → mock, un ticket créé est affiché, puis l'utilisateur choisit « Utiliser ce ticket ». Si la réponse de cet acquittement est perdue, le serveur a déjà clos la récupération alors que le formulaire parent n'a reçu aucun ticket.

Une seconde tentative de consommation ne réussit pas : l'API retourne `ok:false`, le callback `onCreated` reste à zéro et l'interface affirme pourtant que le résultat reste conservé. Après remontage, la récupération serveur est vide et un formulaire neuf apparaît.

**Impact :** résultat non transmis au parcours de saisie, récupération bloquée et message de conservation incorrect. Un seul ticket fournisseur est créé dans cette preuve.

**Attendu :** la consommation du même résultat doit être rejouable sans erreur et rester récupérable si sa livraison à l'interface n'a pas abouti.

Preuve : `/tmp/sumatime-qm-r4-review-2USBJ8/challenge-final.log` ; trois invariants en échec décrivent ce même défaut.

## P2-2 — identité secondaire de demande non durable après consommation

Sources : `lib/glpi.ts:212`, `lib/glpi.ts:216`, `db/raw.ts:81`, `app/new-glpi-ticket.tsx:395`.

Deux processus React indépendants soumettent une même demande métier avec leurs identités respectives, sans synchronisation navigateur disponible. Le serveur déduplique correctement les soumissions initiales : **un seul POST Ticket**. Les réponses navigateur sont ensuite inconnues.

Après consommation du résultat autoritaire dans une autre interface, le second formulaire choisit seulement « Récupérer le résultat », avec **la même identité qu'il avait déjà soumise**. Cette identité secondaire n'a pas été conservée comme équivalente à l'opération d'origine ; la récupération produit alors **un deuxième POST Ticket**. Aucune action « demande distincte » n'a été choisie.

Une variante avec un formulaire déjà ouvert mais pas encore soumis produit également un doublon après consommation dans l'autre contexte. Elle relève du même défaut de continuité, pas d'un P2 supplémentaire.

**Impact :** une récupération présentée comme telle peut créer un second ticket. La réservation atomique protège l'opération active, mais sa continuité ne survit pas à tous les acquittements et réponses perdues.

**Attendu :** conserver durablement les équivalences d'identité déjà acceptées ; une récupération connue ne doit pas devenir une création neuve après consommation ailleurs.

Preuves : `/tmp/sumatime-qm-r4-review-2USBJ8/alias-retry.log` et `challenge-final.log`. Dans la preuve principale : un POST initial, puis deux au total après récupération, sessions finales zéro.

## P2-3 — migration d'une ancienne création incertaine pouvant dupliquer

Sources : `db/raw.ts:55`, `db/raw.ts:81`, `lib/glpi.ts:149`, `lib/glpi.ts:212`.

La migration traite les anciennes lignes sans payload enregistré comme acquittées, même quand elles ne contiennent aucun résultat confirmé.

La recette utilise le vrai provider de la version historique `d541231` et un mock ayant effectivement accepté une création dont la réponse est perdue. La même base est ensuite ouverte par `ba1fd64`. L'opération historique incertaine disparaît de la récupération ; le même besoin ressaisi sous une nouvelle identité peut alors être créé une seconde fois.

**Impact :** perte silencieuse d'une incertitude historique et doublon fournisseur après mise à niveau. La preuve compte deux créations de la même demande, plus une création réussie distincte servant de contrôle. SQLite reste intègre et aucune session mock ne subsiste.

La migration du cas historique terminé ne bloque plus le formulaire, ce qui ferme le blocage exact du round 3. Cela ne justifie pas d'appliquer la même clôture aux opérations sans résultat.

**Attendu :** préserver la distinction entre résultat confirmé et incertitude historique ; prévoir une résolution explicite, sans effacement automatique de la protection contre les doublons.

Preuve : `/tmp/qm-round4-calendar-zwHlXM/migration.log`. L'extension `duplicate-history.log` montre aussi que des résultats historiques supplémentaires sont masqués lors du regroupement des doublons ; elle n'est pas comptée comme un défaut P2 distinct.

## P2-4 — nouvelle demande distincte bloquée en chargement

Sources : `app/new-glpi-ticket.tsx:249`, `app/new-glpi-ticket.tsx:263`, `app/new-glpi-ticket.tsx:304`.

Depuis un résultat terminé affiché dans la vraie interface, « Commencer une nouvelle demande distincte » ouvre les champs de la nouvelle demande, mais remet le chargement à vrai sans déclencher de nouvelle récupération des catégories quand le client reste identique.

Après saisie et plusieurs cycles d'interface, la catégorie reste « Chargement… » et le bouton « Créer dans GLPI » reste désactivé. Le compteur de requêtes de catégories est inchangé. Aucun second ticket n'est créé dans ce scénario.

**Impact :** le parcours explicitement proposé par l'interface est inutilisable sans contourner ou réouvrir le formulaire.

**Attendu :** réinitialiser correctement les options et leur état de chargement pour chaque nouvelle demande, y compris après un résultat déjà terminé.

Preuve : `/tmp/sumatime-qm-r4-review-2USBJ8/crash-distinct.log`.

## État des régressions demandées

- **Round 3 / acquittement caché au montage : corrigé.** Le résultat reste récupérable avec stockage local fonctionnel, perdu, corrompu, indisponible ou saturé. Aucun acquittement automatique au remontage observé.
- **Round 3 / réponse tardive d'un autre membre : corrigé dans les parcours testés.** Changement de membre sur une instance conservée et parcours logout/login testés ; aucune donnée d'Alice affichée à Bob dans ces recettes.
- **Round 3 / soumissions concurrentes avant acquittement : corrigé.** Deux processus UI indépendants, ainsi que deux processus Next partageant la même SQLite, convergent vers une seule opération active. Le défaut résiduel après consommation est P2-2 ci-dessus.
- **Round 3 / polling écrasant une demande explicitement distincte : corrigé.** Titre et description nouveaux sont conservés ; la demande distincte est créée une fois et l'ancienne incertitude reste présente. Le défaut différent après résultat terminé est P2-4.
- **Round 3 / ancien résultat confirmé bloquant toute création : corrigé dans le clone exact testé avec UI/API.** La migration des anciennes incertitudes reste bloquante pour la release, au titre de P2-3.
- **R1 : PASS.** Vrais handlers d'annulation, payload limité aux champs nécessaires, restauration exacte via vraie API, version courante et vrai conflit concurrent conservé.
- **R3 : PASS.** Sélection d'entité strictement confirmée ; réponses false, HTTP en erreur ou malformées interrompent les parcours dépendants. Sessions fermées dans les parcours achevés normalement.
- **R4 : PASS, 14 tests React/DOM.** Poignées start/end/move, deux sauvegardes successives, reload parent tardif, erreurs, conflits, cible disparue/facturée, déplacement hors semaine, navigation pendant sauvegarde, undo et suppression. Focus exact, fallback accessible ou focus de navigation conservé.
- **R5 : PASS, 29 assertions.** Printemps/automne, bornes exactes et ±1 ms, avant/après/traversée réelle, minuit et durées arrondies. Les champs de correction restent éditables.

## Suites, qualité et vérifications complémentaires

- Unitaires/DOM officiels : **30/30 PASS**. Les tests DOM inclus ne sont pas comptés une seconde fois dans ce total.
- Intégration R2 officielle React → Next → mock : **49 assertions PASS**, cinq POST Ticket simulés.
- API : **198 assertions PASS**, premier essai.
- Provider : **173 assertions PASS**, quatre POST Ticket et zéro session finale.
- Reprise indépendante du round 3 : **26/26 invariants PASS**, onze POST Ticket simulés.
- Challenges fonctionnels supplémentaires : **21 invariants, 17 PASS / 4 FAIL** ; les trois échecs d'acquittement et la variante inter-contextes alimentent P2-1/P2-2.
- Challenge alias déjà soumis : **6 invariants, 5 PASS / 1 FAIL**, confirmation principale de P2-2.
- Challenge arrêt/reprise et demande distincte : **9 invariants, 8 PASS / 1 FAIL**, l'échec étant P2-4.
- Deux processus Next sur une même SQLite : **14/14 invariants PASS**, dont dix courses de réservation ; une seule création par paire de demandes. Les variations de champs métier/client et la portée membre ont été contrôlées séparément.
- Arrêts forcés du seul serveur éphémère avant puis après le POST mock : réservation conservée, récupération sans nouvel envoi. Les sessions mock interrompues brutalement sont consignées et ont été fermées explicitement à la fin de ces seuls scénarios ; cela ne constitue pas une preuve de nettoyage automatique après crash.
- TypeScript : **PASS** avec `--noEmit --incremental false`.
- Build production : **PASS au premier essai**, 136,276 s ; webpack 4,3 s, TypeScript 2,9 s. Aucun timeout build dans ce round.
- Lint ciblé : **31 fichiers code, zéro erreur/avertissement** ; trente fichiers modifiés depuis `087da9e` et le fichier preview mock non suivi.
- Lint global : **FAIL, 2 erreurs / 3 warnings préexistants**. Fichiers concernés : `app/login/page.tsx`, `components/client-color.tsx`, `app/account-panel.tsx`. Ces fichiers et la configuration ESLint sont identiques au commit de base. Ne pas annoncer un lint global vert.
- Diff-check depuis `087da9e` : **PASS**.
- SQLite : **integrity_check=ok, foreign_key_check=[]** sur preview en lecture seule, bases API/provider et backup, intégrations et clones de migration. Les empreintes de la DB/WAL preview sont restées identiques pendant les vérifications en lecture seule.

## Provenance preview et frontière de mutation

- Preview figée : `/opt/sumatime-preview/releases/v0.3.0-round4-20261003`, loopback 5174 ; mock permanent loopback 8792.
- Services preview/mock restés aux PID **1135046 / 1135042** ; aucun redémarrage QM. Environnement vérifié par allowlist : base preview séparée, fournisseur mock uniquement, LDAP désactivé, écritures GLPI seulement dans le contexte mock autorisé.
- Avant rebuild : **80/80 fichiers comparés identiques**, BUILD_ID local/preview `QrgLitRBxrMwgf75uoeah` ; `server.js` identique.
- Après rebuild local : **69/80 identiques octet par octet, 80/80 après normalisation** des identifiants de build et de l'ordre des manifests. Aucun changement applicatif détecté. Nouveau BUILD_ID local : `aH4V4H1-BhQv41edMlvi_`.
- Route GLPI, page serveur et chunk UI applicatif strictement identiques entre preview et rebuild. SHA-256 route GLPI : `897fe79d2ba6633d2543de0fac523b5122cc110e917dc0493504d64032393caa` ; chunk UI : `58fb23fd6fb8980a21bd3a97325462f7ff6111d9504e3a53e8a50b9cee0f8b2d`.
- **26 assets servis comparés au disque : tous identiques.** `/login` 200 ; API GLPI et récupération anonymes 401, avant/après les contrôles.
- Dirty initial préservé : `next.config.ts`, `package.json`, `package-lock.json` ; neuf non-suivis initiaux, soit quatre fichiers deploy preview et cinq documents. Seul ajout de cette revue dans le dépôt : ce rapport.
- Les recettes fonctionnelles utilisent le build standalone figé et des bases synthétiques isolées. Aucun résultat ne provient d'un GLPI réel ou d'une écriture en production.

## Limites, dette et premiers incidents conservés

- Recette interactive en React/Radix/jsdom. Les contextes indépendants sont de vrais processus, mais pas des onglets Chromium instrumentés. Aucune acceptation native pointer/tactile n'est revendiquée.
- P3 préexistant : deux processus démarrant simultanément une migration historique peuvent se gêner sur la lecture du schéma. Un échec d'initialisation a été reproduit, avec base finale saine ; aucun incident de ce type n'a été observé sur la preview mono-process.
- Les politiques de rétention/expiration des données locales et des opérations serveur acquittées restent à préciser. Une expiration aveugle des opérations incertaines n'est pas une correction acceptable.
- Premier essai API lent : **229,776 s**, puis réussite naturelle, sans timeout ni retry. Une attente I/O a été observée ; aucune cause applicative plus précise n'est affirmée. La recette provider suivante utilisait une base synthétique tmpfs dès son premier essai.
- Premier challenge UI élargi arrêté par une interaction artificielle du harnais qui resélectionnait le client déjà sélectionné. Après correction du harnais seulement, les échecs produit sont restés reproductibles. Le premier log est conservé.
- Premier challenge multi-serveur arrêté sur une hypothèse de fixture incorrecte : le produit refusait à juste titre une association client/entité déjà prise. Le contrôle a ensuite utilisé une autre entité autorisée ; les dix courses de réservation ont passé dans les deux exécutions. Le premier log est conservé.
- Les harnais de diagnostic consignent explicitement leurs invariants PASS/FAIL ; leur code de sortie réussi signifie parfois « preuve terminée », pas « produit accepté ».

## Dossiers de preuve et prochaine gate

- Fonctionnel/UI/API/mock : `/tmp/sumatime-qm-r4-review-2USBJ8/` ; logs principaux `integration-first.log`, `challenge-final.log`, `alias-retry.log`, `crash-distinct.log`, `two-next-final.log`. Résultat officiel R2 : `/tmp/qm-round4-r2-integration-official-first.log`.
- Calendrier/DST/migration : `/tmp/qm-round4-calendar-zwHlXM/RESULTS.md` et logs associés.
- Statique/build/provenance : `/tmp/qm-round4-static-iYE3rs/`, résultats JSON, captures de hashes et `INCIDENTS.md`.

**Retour Dev sur les quatre P2**, puis nouvelle preview figée et contre-revue indépendante des parcours affectés, sans assouplissement des assertions. **La release v0.3 reste non autorisée avant PASS.**

Le pilote doit synchroniser le suivi Mission Control et la mémoire avec exactement ce verdict, ces quatre P2, les validations R1/R3/R4/R5 et la prochaine gate Dev → QM. Cette sous-revue ne modifie pas ces supports de coordination ; CHECKLIST doit être revérifié par le pilote avant annonce utilisateur.
