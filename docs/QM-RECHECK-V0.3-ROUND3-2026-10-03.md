# Sumatoni Time v0.3 — contre-revue QM indépendante, round 3

Date : 2026-10-03 UTC. Branche : `codex/calendar-glpi-v0.3`.
HEAD revu : `ddedc3632d136d25dd63734bad00aae3b26eca89`.
Verdict : **REVISE — cinq P2 confirmés sur R2 ; aucune release ni production.**
Aucun P0/P1 démontré. R1, R3, R4, R5 et le lint de tous les fichiers modifiés sont validés dans le périmètre testé.

Revue conduite selon Application Release Review, exigences R1–R7 et rapports rounds 1/2. Aucun code applicatif modifié, aucun commit, aucun redémarrage de preview/mock, aucun accès au GLPI réel ou à la production. Seul ajout documentaire : le présent rapport.

## P2-1 — ACK invisible au montage, résultat perdu et doublon réel

Sources : `app/new-glpi-ticket.tsx:70-79`, `:122`, `:170-184` ; `lib/glpi.ts:139,155`.

`refreshPending` s'exécute dès le montage, même dialogue fermé. Un résultat complet déclenche immédiatement `acknowledgeCreation`, sans que l'utilisateur l'ait vu. À l'ouverture, une nouvelle lecture serveur ne retourne donc plus ce résultat ; `openNew` crée un UUID neuf et efface le résultat restauré.

Reproduction **vraie React UI → vraie API Next du build ddedc36 → mock HTTP** :

1. Faire échouer `localStorage.setItem` avec `QuotaExceededError`.
2. Créer un ticket, attendre sa création effective côté mock et la réponse HTTP 200 côté API, puis perdre uniquement la réponse navigateur.
3. Démonter/remonter le créateur, en gardant le dialogue fermé. La lecture serveur déclenche déjà l'ACK : GET uncertain retourne désormais zéro demande.
4. Ouvrir : formulaire neuf vide, aucun résultat à récupérer. Ressaisir la même demande et envoyer.

Résultat : **deux UUID, deux vrais `POST Ticket`**, sans action « demande distincte ». UUID de la dernière preuve : `cc72305d-d545-4473-bf5d-3db9e47946f4` et `e6511cf6-2291-4044-8d60-032f051c6c7c`.

Même perte de résultat observée au remontage avec stockage **fonctionnel**, supprimé, corrompu et désactivé : l'ACK caché retire le résultat serveur et l'ouverture présente le formulaire vierge. Le doublon fournisseur supplémentaire a été exécuté dans le scénario quota ; les quatre variantes démontrent la perte d'identité/résultat sans ajouter une seconde création.

Le test officiel `glpi-r2-dom.test.mjs` masque ce défaut : son mock ACK répond OK mais ne retire pas le pending, contrairement au vrai endpoint.

## P2-2 — réponse Alice tardive affichée chez Bob

Sources : `app/new-glpi-ticket.tsx:82-106`, `:108-128`.

Les réponses de `refreshPending` ne sont protégées ni par un identifiant membre capturé, ni par une génération de requête, ni par un AbortController. `mounted.current` reste vrai si l'instance est conservée lors du changement de `memberId`.

Reproduction intégrée avec deux comptes réellement authentifiés :

1. Retenir une réponse GET uncertain **déjà calculée par l'API authentifiée Alice**, contenant son résultat privé.
2. Rerendre la même instance avec le membre et la session Bob ; son propre GET retourne correctement zéro demande. Ouvrir le formulaire Bob, initialement vide.
3. Livrer seulement alors l'ancienne réponse Alice.

Résultat : **`ALICE PRIVATE TITLE` et le lien du ticket Alice apparaissent dans l'interface Bob**. Aucun POST Ticket supplémentaire. Bob ne peut pas acquitter la ligne Alice : le garde-fou SQL fonctionne, mais n'empêche pas la divulgation UI.

Challenge React/DOM complémentaire, API simulée avec résultat encore incertain : **titre et description privés Alice** apparaissent tous deux dans les champs Bob.

Portée exacte : défaut prouvé quand le composant est conservé au changement de membre. Le parcours logout/login exécuté avec démontage complet protège bien ce cas ; il est PASS séparément. Aucun navigateur natif multi-onglets n'a été instrumenté.

## P2-3 — état serveur périmé accepté avant envoi dans un autre onglet

Sources : `app/new-glpi-ticket.tsx:130-134`, `:211-233` ; `lib/glpi.ts:192-197`.

`submit` vérifie le booléen historique `pendingChecked`, pas un état serveur atomiquement réservé pour l'opération. La table déduplique un UUID, mais ne coordonne pas deux UUID issus d'interfaces déjà ouvertes. Sans notifications navigateur, le polling de deux secondes laisse une fenêtre de duplication.

Deux processus indépendants, chacun montant la vraie React UI dans son propre DOM, partagent le compte Alice et la vraie API ; **localStorage, BroadcastChannel et événements storage sont indisponibles** :

- Soumissions simultanées des mêmes champs : **deux UUID, deux POST Ticket**.
- Reproduction plus forte : les deux formulaires sont déjà ouverts ; le premier envoie puis perd sa réponse. Une lecture API indépendante confirme que son UUID est bien présent dans l'état serveur. Le second envoie ensuite, avant le prochain polling, sans action distincte et sans relire cet état : **deux UUID, deux POST Ticket**.

Dans cette seconde preuve, l'UUID déjà conservé est `5c78040d-f339-4abf-8d39-3d163c97a91c`; le second est `070aa981-d8ce-47fc-a6dc-0204f543c3e2`.

Le cas nominal de **deux créateurs déjà montés dans le même document**, avec notifications locales disponibles, est corrigé : partage immédiat du pending, récupération avec le même UUID, un seul POST Ticket. Cela ne ferme pas le défaut inter-contextes/capacités indisponibles.

## P2-4 — la demande explicitement distincte est écrasée par le polling

Sources : `app/new-glpi-ticket.tsx:56-63`, `:94-96`, `:130-134`, `:190-199`.

Vrai React/Radix/jsdom, API simulée : ouvrir une demande incertaine, cliquer « Commencer une nouvelle demande distincte », saisir un nouveau titre et une nouvelle description, attendre 2,15 secondes.

Le polling réinjecte l'ancien pending : **nouveaux champs perdus, ancien titre/description restaurés, formulaire reverrouillé**. Aucune intention distincte n'est mémorisée pour exclure l'ancienne opération. Zéro POST dans ce scénario. Le test conserve son assertion en échec.

## P2-5 — migration des anciennes créations réussies bloque toute nouvelle création

Sources : `db/raw.ts:40-45`, `lib/glpi.ts:139-148`, `app/new-glpi-ticket.tsx:91-96` et fieldset/bouton final.

La migration ajoute `payload_json` et `acknowledged_at` à NULL dans toutes les anciennes lignes, y compris les créations dont `result_json` prouve un succès. `glpiUncertainRequests` tente de parser leur payload absent, renvoie `blocked=true`, mais aucun résultat récupérable. L'UI interdit alors la création sans offrir d'action de résolution.

Reproduction réelle sur **clone de données exclusivement synthétiques**, ramené au schéma du round2 avec une seule ancienne création réussie :

- Avant : six anciennes colonnes ; une ligne, `result_json` présent.
- Démarrage du vrai serveur ddedc36 et authentification : les deux colonnes sont ajoutées, toutes deux NULL.
- GET uncertain : **`{"requests":[],"blocked":true}`**.
- Vraie React UI : **fieldset disabled, bouton Créer disabled, aucun bouton Récupérer** ; le message accuse à tort le stockage local.
- Zéro POST Ticket ; sessions mock zéro ; intégrité SQLite et FK correctes.

La preview actuelle contient bien, en lecture seule, une ancienne ligne avec résultat et l'ancien schéma. Sa migration authentifiée n'a volontairement pas été déclenchée par QM. Le défaut n'est donc pas une hypothèse de table vide : il est reproduit sur le chemin réel de migration et pertinent pour les historiques de création antérieurs.

## Anciennes corrections validées

### R1 — annulation réelle

Vrais handlers React et clic Annuler testés avec API simulée, puis payload du caller transmis à la vraie API : HTTP 200, restauration exacte `06:07–07:22`, version 2→3. Sept champs métier préservés (`client_id`, `member_id`, `ticket`, `description`, `on_site`, `hourly_rate_cents`, `billed`). Modification concurrente réelle puis ancienne version : HTTP 409, modification concurrente conservée. Seuls action/id/version/date/start/end sont envoyés.

### R3 — entité GLPI

Contrôle strict `selected !== true` maintenu. Provider 166 assertions : succès, false, HTTP et réponse malformée ; aucun Ticket POST après refus de contexte, réservations de refus certain retirées, sessions fermées. Protections existantes URL/origine/auth/jeton chiffré/redirections/limites et réservation UUID conservées dans les suites.

### R4 — focus

Harness round2 **inchangé : 10/10 PASS**. Handles start/end/move avec deux sauvegardes et parent tardif ; erreurs réseau/503/409 ; disparition/facturation ; déplacement lundi hors semaine vers dimanche ; navigation pendant sauvegarde puis retour. Fallback accessible connecté dans la vue courante, ou focus de navigation conservé ; aucune restauration périmée démontrée.

Quatre challenges supplémentaires : **4/4 PASS**, vrais boutons undo succès/conflit et dialogue suppression succès/503. Le défaut hors semaine/focus fantôme du round2 est fermé.

### R5 — DST

Matrice indépendante **29 assertions PASS** : printemps/automne, début et fin exacts ±1 ms, avant/après/traversée réelle, minuit exact ±1 ms. Les 20 minutes à la transition proposent 30 minutes arrondies, ni 90 ni 15. Champs de correction toujours éditables.

### R2 — protections effectivement validées

- GET uncertain sans session : 401 ; résultat membre-scopé ; Bob ne lit ni n'ACK la ligne Alice.
- ACK sans Origin : 403. Même UUID avec payload différent : 409, zéro nouvelle création.
- Canonicalisation serveur trim + allowlist : clés synthétiques token/password exclues du payload conservé et retourné.
- Même UUID terminé : résultat rejoué sans POST Ticket ; ligne corrompue : blocked=true.
- Demande réellement incertaine côté fournisseur conservée après logout Alice → Bob → login Alice, avec démontage : identité retrouvée, aucune divulgation Bob.
- **Arrêt SIGKILL du seul serveur Next éphémère**, redémarrage avec sa même DB : pending conservé, replay 409 sans nouveau POST Ticket. Le mock et la preview réelle ne sont pas arrêtés par ce test.
- Ancienne date serveur conservée : pas d'expiration dangereuse autorisant un renvoi aveugle.
- Deux créateurs du même document, notifications disponibles : un seul POST Ticket et même UUID lors de la récupération.

## Résultats des suites et qualité

- `node --import=tsx --test tests/*.test.mjs` : **27/27 PASS**, dont **4 tests React/DOM inclus**, pas 27+4.
- DOM indépendant calendrier : **10/10 PASS**, plus **4/4** challenges undo/suppression.
- Challenge DOM R2 polling/race/GET503 : **3 tests, 1 PASS / 2 FAIL**, assertions de défaut conservées.
- API : **198 assertions PASS**.
- Provider officiel : **166 assertions PASS**, quatre POST Ticket, sessions zéro. Confirmation tmpfs de la même recette : **166 PASS**, 126 appels mock, quatre POST Ticket, sessions zéro.
- Intégration indépendante finale R1/R2 : **14 POST Ticket réels vers le mock** : quota 2, résultat Alice 1, canonicalisation 1, tabs simultanés 2, tab périmé après perte de réponse 2, variantes stockage 4, créateurs coexistants 1, fournisseur réellement incertain 1. Compteur inchangé après crash/retry ; sessions zéro.
- TypeScript `tsc --noEmit --incremental false` : **PASS**.
- Build production : **PASS au premier essai**, exit 0, 133,76 s ; webpack 8,9 s, TypeScript 72 s. Aucun timeout build dans ce round.
- Lint des **28 fichiers code modifiés depuis `087da9e`**, workspace et next.config compris : **PASS, zéro erreur/avertissement**. Vérification des 31 fichiers changés : seuls CSS/package JSON affichent trois avertissements « no matching configuration », pas de code exclu.
- Lint global : **FAIL, 2 erreurs / 3 warnings préexistants**. Erreurs `app/login/page.tsx:13`, `components/client-color.tsx:14`; warnings de navigation `account-panel.tsx` et login. Ces trois fichiers sont octet-identiques à `087da9e`. R6 est désormais satisfait pour tous les fichiers touchés, sans présenter le lint global comme vert.
- `git diff --check` et contrôle depuis `087da9e` : **PASS**.
- SQLite : **integrity_check=ok, foreign_key_check=[]** sur preview en lecture seule, API QA, provider QA officiel/tmpfs, DB intégration et clone migration.

## P3 et limites non surclassées

- Stockage local : TTL sept jours classe l'élément expiré « corrupt », ne purge pas son texte ; la cinquième demande évince toujours la plus ancienne identité locale. Ces chemins reposent donc sur la récupération serveur, actuellement défectueuse. La borne 32 KB est maintenant mesurée en UTF-8 et correctement refusée sans faux succès.
- Ancienne clé globale v1 supprimée, espaces membre v2 isolés. Le helper local garde toutefois les clés supplémentaires d'un objet synthétique token/password par spread ; **aucune fuite réelle de credentials démontrée**, les callers normaux n'en fournissent pas. L'allowlist serveur fonctionne.
- Pas de politique de purge/TTL des lignes serveur acquittées et de leur texte métier ; GET limité à 20 lignes, sans pagination. Ne pas ajouter une purge aveugle des opérations incertaines pour corriger cela.
- Si GET uncertain échoue, ouverture/réouverture génère deux UUID différents avant vérification réussie ; **le submit reste bloqué et aucun POST n'est émis**. L'erreur GET est néanmoins effacée par openNew, donnant temporairement un formulaire bloqué sans explication. Écart UX/contrat, pas preuve supplémentaire de doublon.
- Tests interactifs en React/jsdom ; les deux onglets sont modélisés par **deux processus indépendants**, pas Chromium/Playwright. Reload modélisé par racine React froide avec stockage durable/perdu, pas rechargement natif instrumenté. Pas d'acceptation pointer/tactile native revendiquée.

## Boundary source, preview et environnement

- Preview figée : `/opt/sumatime-preview/releases/v0.3.0-ddedc36`, `127.0.0.1:5174`; mock `127.0.0.1:8792`. Services toujours aux mêmes PID 1126569 / 1126565, démarrés 21:13:55 UTC, sans restart QM.
- Environnement vérifié par allowlist : DB `/var/lib/sumatime-preview/timesheet.sqlite`, GLPI URL strictement mock loopback, writes=true uniquement contre ce mock, LDAP=false, preview=true. Aucun secret réel imprimé.
- `/login` 200 ; `/api/glpi` anonyme 401. Huit assets HTTP servis comparés au disque, identiques avant/après rebuild.
- Avant rebuild : BUILD_ID local/preview `B2Z10ALE9yl3bfUesdnre`, **74 fichiers identiques**. Après rebuild local `15Uu8WJBfSnLxDOjlGtda` : **65 fichiers identiques**, neuf différences uniquement BUILD_ID/ordre JSON normalisés. Un manifest généré local d'interception n'est pas empaqueté. Aucun drift applicatif démontré.
- Hash serveur page identique : `26bd97bf4ce9e71b607ad78ffc5d2d8d48a6107a9b05ea24ea0034f94524513c`. Route GLPI identique : `7648d24bd1289d1eac67970c30e53456ded312d3ac3f20457e513b508c49ab69`. Chunk UI identique : `139384344f2d950b8ae9393d872e0ea640d3523a0cff5af716e6ba064e807dcf`.
- Dirty initial conservé : `next.config.ts`, `package.json`, `package-lock.json` ; huit non-suivis initiaux, quatre docs et quatre fichiers deploy preview. Rapport round3 seul nouvel ajout documentaire.
- Tests éphémères sur loopback 8787/8790, 8788/8794, premier essai 8789/8793, provider tmpfs 8786/8795. Tous fermés après exécution. Bases synthétiques `/tmp` et `/dev/shm` uniquement.

## Premiers incidents conservés

- Provider officiel et première intégration ont subi plusieurs minutes d'attente filesystem : Next état D, `jbd2_log_wait_commit`, disque/inodes non pleins. Provider a finalement passé naturellement. Retry tmpfs préparé durant cette attente a également passé, sans modifier la recette applicative.
- Premier harness intégration : après cette attente, assertion compteur 0≠1 car il attendait l'apparition de l'état incertain local, déclenché avant la fin de la vraie requête. Assertion conservée dans `integration-first.log`; le harness attend maintenant la perte effective de la réponse HTTP 200 et la fin de busy. Les défauts sont reproduits avec ce garde robuste dans `integration-final.log`.
- Premier challenge UUID503 cherchait « Annuler » au lieu du vrai bouton « Fermer » : erreur du harness corrigée, pas de défaut produit additionnel. Les deux défauts réels polling/divulgation restent en échec après correction.
- Timeout build round2 reste documenté dans son rapport ; **il n'a pas récidivé ici**. Les échecs lint global et les assertions fonctionnelles ne sont pas effacés par les suites vertes.

## Preuves reproductibles

- `/tmp/sumatime-qm-r3-review-ZNw2sW/integration.mjs` et `tab-worker.mjs`, preuve finale `integration-final.log`. Commande depuis le dépôt : `QM_PORT=8788 QM_MOCK_PORT=8794 QM_DB_PREFIX=/dev/shm/qm-r3-integration- node --import=tsx /tmp/sumatime-qm-r3-review-ZNw2sW/integration.mjs`. Cette matrice journalise chaque invariant avec `pass:true/false` puis les comptes exacts ; exit 0 signifie harness terminé, **pas acceptation fonctionnelle**.
- `/tmp/sumatime-qm-r3-review-ZNw2sW/migration.mjs`, `migration.log` : schéma historique réel → migration serveur → blocage UI. Fixture synthétique source indiquée dans le script, jamais la DB preview.
- `/tmp/sumatime-qm-r3-review-ZNw2sW/storage-matrix.mjs` : TTL, legacy, partition membre, borne UTF-8, extras synthétiques, éviction.
- `/tmp/qm-r2-round3-poll-races.mjs` et `...-results.md` : deux assertions produit en échec, contrôle GET503 passant.
- `/tmp/qm-r4-dom-challenge.mjs`, `/tmp/qm-r4-round3-extra.mjs`, `/tmp/qm-r4-r5-r1-round3-results.md`, `/tmp/sumatime-qm-r2-review-BjZlFt/dst-matrix.mjs`.
- `/tmp/qm-round3-static-bc0f8r/RESULTS.md` et logs unit/API/provider/tsc/build/lint/SQLite/provenance : détail complet des commandes, fichiers et hashes.

## Gate suivante

Retour Dev obligatoire sur les cinq P2 R2 : ACK seulement après livraison réellement conservée/visible, résultat récupéré préservé à l'ouverture, garde membre/génération sur toutes réponses, coordination autoritaire avant création même sans notifications, intention distincte protégée du polling, migration des historiques avec résultat exploitable et résolution sûre.

Puis nouvelle preview figée et contre-revue indépendante, sans assouplir les assertions. **Ne pas déployer ni libérer v0.3 avant PASS.** Le pilote doit synchroniser Mission Control/mémoire avec exactement **REVISE, cinq P2 R2**, R1/R3/R4/R5 validés, puis relire CHECKLIST avant annonce utilisateur.
