# Sumatoni Time v0.3 — contre-revue QM indépendante, round 7

Date : 2026-10-04 UTC. Branche : `codex/calendar-glpi-v0.3`.
HEAD revu : `3b45ed3336c24cf23272b82272bf93637170377e`.

## Verdict

**REVISE — deux défauts P2 confirmés ; aucune release ni mise en production.**

Aucun P0/P1 démontré. Le refus fournisseur certain est désormais corrigeable avec un nouvel UUID, y compris après remontage. Le bouton distinct manquant du round 6 est ajouté, mais son nouveau parcours reste bloqué sur le chargement des catégories. Une autre transition traite à tort un échec de récupération comme la preuve que la création antérieure n'a pas réussi.

Revue selon **Application Release Review**, exigences R1–R7 et rapports rounds 1–6, avec vrais composants React/Radix/jsdom, vraie API Next figée et mocks HTTP. Aucun code applicatif, commit, production, GLPI réel ou service preview permanent modifié. Les mutations de recette utilisent uniquement des fixtures et bases synthétiques `/tmp`/`/dev/shm`. Ce rapport est le seul ajout au dépôt par QM ; suivi MC/mémoire confié au pilote.

## P2-1 — après conflit post-ACK, l'action distincte existe mais laisse Créer désactivé

Sources : `app/new-glpi-ticket.tsx:296`, `:310`, `:315`, `:321`, `:329`, `:369`.

Reproduction UI → Next round7 → mock :

1. Créer un ticket, puis **Utiliser ce ticket** ; l'ACK ferme le dialogue.
2. Ouvrir un nouveau formulaire, ressaisir les mêmes champs métier et soumettre.
3. Le serveur refuse 409 avec `distinct_required:true`. Le bouton **Commencer une nouvelle demande distincte** est maintenant visible, et reste visible après fermeture/réouverture.
4. Cliquer ce bouton une seule fois. Une intention serveur est bien créée, mais la catégorie affiche **Chargement…** et **Créer dans GLPI reste désactivé**, après plusieurs cycles et plus de 2,3 secondes.

`enterDraft` remet `loading=true` et vide les catégories, alors que le mode était déjà `draft`. Le client, le mode et les autres dépendances de l'effet de chargement restent identiques : aucune nouvelle récupération d'options n'est déclenchée. La variante double clic du premier essai reste également bloquée.

Une fermeture/réouverture **supplémentaire après l'autorisation distincte** contourne le défaut. Après ce contournement, un double submit émet exactement un nouveau POST Ticket ; replay du même UUID idempotent et réemploi de l'intention avec un UUID différent refusé. Ce contournement ne valide pas le parcours normal proposé.

**Impact :** l'utilisateur ne peut pas achever normalement l'action distincte requise ; le P2 du round 6 n'est donc pas fermé de bout en bout.

**Attendu :** réinitialiser/recharger les options pour chaque nouvelle génération de brouillon, y compris `draft → draft`, et tester l'action par un clic réellement utilisable. Le test officiel envoie un événement `submit` directement au formulaire sans vérifier le bouton désactivé : il contourne ce défaut.

Preuves : `/tmp/sumatime-qm-r7-review-kb66bx/transitions-first.log` (timeout sur formulaire réellement bloqué) et `transitions-continued.log` (confirmation clic unique, invariant en échec, puis contournement documenté). Aucun changement produit entre ces preuves.

## P2-2 — 401/429 pendant une récupération effacent à tort l'incertitude et autorisent une correction créatrice

Sources : `app/new-glpi-ticket.tsx:529`, `:555`, `:556`, `:562`, `:565` ; `app/api/glpi/route.ts:7`, `:48`.

`reconcile` considère tout non-2xx avec `uncertain !== true` comme un refus certain de l'opération d'origine. Or une authentification refusée ou un rate limit arrivent **avant** la consultation de cette opération : ils ne disent rien de son résultat fournisseur.

Reproduction principale entièrement UI/API/mock :

1. Créer `UNCERTAIN-CREATE`. Le mock accepte effectivement le Ticket puis détruit sa réponse. Next conserve l'UUID en `state='uncertain'` ; l'UI affiche Résultat incertain et verrouille les champs.
2. Cliquer neuf fois normalement **Récupérer le résultat** : même UUID, aucune nouvelle création. La récupération suivante atteint naturellement le limiteur 10/min et reçoit le vrai HTTP **429**, « Trop de tentatives. Patientez avant de réessayer. »
3. L'UI quitte pourtant l'état incertain, génère un UUID neuf, déverrouille les champs et propose **Créer dans GLPI** sans action distincte.
4. Une fois le limiteur libéré, modifier le titre comme une correction puis soumettre crée un **deuxième Ticket**, sans intention distincte. Pour accélérer uniquement l'attente du limiteur, la fixture remet ensuite sa ligne de rate limit à zéro ; le déclenchement du 429 provient bien des vrais clics UI.

Identité initiale `daa91999-fb17-46a1-b8b5-7ab35b382b00`, nouvelle identité `439fe630-1605-4111-9c7f-b8ad81ff5eb0`. SQLite confirme l'ancienne ligne toujours `uncertain`, la nouvelle `completed` avec ticket 115 et `distinct_intent_id=NULL` dans les deux lignes. Deux POST Ticket acceptés, zéro session finale.

Variante indépendante : rendre momentanément invalide le cookie envoyé par le harnais fait répondre le **vrai endpoint 401** à la récupération. Même déverrouillage, puis restauration de la session et correction : deux POST. UUID `e1cd4423-275e-44b2-8078-e99132638bb0` → `c9c16a75-72fd-421a-bd30-6d610cea284a`. Il s'agit du même défaut, pas d'un troisième P2.

**Impact :** une création réellement acceptée mais inconnue peut être suivie d'une nouvelle création depuis une simple correction du formulaire, sans la transition distincte exigée par R2. La protection serveur du payload strictement identique demeure ; le défaut ne prétend pas qu'un replay inchangé de l'UUID duplique.

**Attendu :** seule une preuve autoritaire de rejet terminal de l'opération identifiée peut autoriser cette transition. Authentification, rate limit, indisponibilité ou erreur de lecture doivent conserver UUID, payload et verrouillage de l'incertitude. Ne pas confondre « cette tentative de récupération a échoué » et « le fournisseur n'a pas créé le ticket ».

Preuves : `transitions-continued.log`, `recovery429-first.log`, `recovery429-natural-first.log` et harnais voisins dans `/tmp/sumatime-qm-r7-review-kb66bx/`. Deux assertions en échec par variante décrivent ce même P2.

## Intégration officielle — premier essai FAIL, non relancé

`tests/glpi-r2-integration.mjs` copié avec seuls imports et chemin standalone adaptés à la preview figée : **FAIL ligne 532**, `undefined !== UUID autoritaire`. Aucun PASS 94 revendiqué dans cette revue.

Le gagnant est maintenant identifié dynamiquement depuis l'opération autoritaire : l'hypothèse d'indice gagnant du round 6 est corrigée. Mais la nouvelle assertion exige encore que **tout perdant 409 contienne `operation.payload.request_id`**. Un concurrent arrivant après la terminaison peut légitimement recevoir `distinct_required:true` sans opération ni alias. Le premier run rencontre exactement cette branche.

La vérification précédente a bien établi un POST pour la paire concurrente. Cette assertion incorrecte n'est pas une preuve de doublon produit ; elle reste un échec de la recette officielle, et sa dernière partie n'a pas été atteinte. Le test doit distinguer le perdant rattaché à une opération active du refus terminal sans alias, avec contrôle du compteur fournisseur et du stockage dans les deux cas. Il doit aussi vérifier l'utilisabilité réelle du bouton de création, car son submit programmatique masque P2-1.

Preuve : `/tmp/sumatime-qm-r7-review-kb66bx/official-integration.mjs`, `official-first.log`. Les validations indépendantes ci-dessous ne transforment pas ce premier run en succès.

## Corrections et régressions validées

- **Round 6 / refus certain : PASS.** HTTP422/provider refusé, identité serveur `rejected`, formulaire éditable, correction avec nouvel UUID après fermeture/réouverture et après vrai remontage React ; une seule création acceptée après la tentative rejetée.
- **Intention distincte et double action : PASS dans les parcours utilisables.** Après contournement explicite de P2-1, double submit donne un seul nouveau Ticket ; même UUID rejoue, intention single-use avec UUID différent refusée. Contrôles serveur supplémentaires : portée membre/API, format, expiration, dix courses et tombstones.
- **Round 3 : 26/26 invariants PASS.** Quota, stockage fonctionnel/perdu/corrompu/désactivé, aucun ACK caché, deux processus UI sans notifications, créateurs coexistants, réponse Alice tardive ignorée chez Bob, logout/login, reprise avec même identité. Onze POST mock, zéro session finale.
- **ACK perdu / polling distinct : PASS.** ACK réellement commis puis réponse perdue ; remontage avant retry, résultat récupéré, callback livré une fois ; champs distincts préservés après polling, ancienne incertitude conservée. Le premier contrôle final de sessions était prématuré (voir incidents) ; preuve avec drain borné : 9/9, trois POST, zéro session.
- **Alias expiré, vraie UI : 6/6 PASS.** Deux processus ont réellement soumis leur UUID ; après ACK ailleurs et expiration synthétique, Récupérer réutilise l'UUID secondaire sans nouveau POST. Un seul POST total, sessions zéro.
- **Crash Next éphémère avant/après POST : 9/9 PASS.** Réservation conservée, UUID original et nouveau UUID de même empreinte ne renvoient pas le Ticket ; deux POST au total avec contrôle distinct-loading. Les sessions interrompues brutalement sont fermées explicitement dans ce seul harnais, sans prétendre prouver un nettoyage automatique après crash.
- **Historiques/migrations : PASS.** Anciennes incertitudes conservées et bloquantes, résultats confirmés non bloquants, permissions/résolution vérifiées. Six créations historiques dans la matrice de résultats multiples, aucun nouveau POST après migration ; chaque UUID retrouve son propre ticket, notamment 118/119. Tombstones et alias restent sûrs après expiration/reopen ; TTL ISO exact et rollback transactionnel contrôlés.
- **R1 : PASS.** Vrais handlers React → Next → SQLite : undo200, six clés seulement, chaînes HH:MM, sept champs métier préservés ; vraie modification concurrente →409 et données concurrentes intactes.
- **R3 : PASS.** Provider175 : sélection strictement `true`, false/HTTP/malformed bloquent les appels dépendants, sessions normalement achevées fermées.
- **R4 : PASS, 14 tests React/DOM.** Deux ajustements start/end/move, parent retardé, erreurs/conflit, disparition/facturation/hors semaine, navigation, undo/suppression ; focus exact ou fallback connecté.
- **R5 : PASS, 29 assertions.** Printemps/automne, bornes exactes et ±1ms, traversée réelle, minuit et arrondi. Champs de correction toujours éditables à l'inspection.

## Suites, qualité et données

- Unités/DOM officiels : **35/35 PASS**, premier essai ; tests ciblés non additionnés au total.
- API : **198 PASS**, premier essai QM. Provider : **175 PASS**, premier essai QM, quatre POST et zéro session finale.
- Intégration officielle : **FAIL premier essai**, aucune relance ; ne pas annoncer 94 PASS.
- Matrice indépendante nouvelles transitions : **15 invariants, 12 PASS / 3 FAIL**, les trois FAIL représentant les deux P2. Variantes429 synthétique/naturelle : respectivement 5/7 et 6/8, deux FAIL pour le même P2-2.
- Migration/legacy/undo UI réel : **75 PASS** ; deep migration **78 PASS** ; les quatre checks rollback rejoués ailleurs ne sont pas additionnés une seconde fois.
- Contrôles intentions serveur : **85 PASS**, douze POST, sessions zéro. Crash aux bornes COMMIT : **48 PASS** ordinaires et **60 PASS** intentions distinctes, trois POST par matrice, zéro session finale.
- Build production : **PASS au premier essai, 145,191s**. TypeScript : **PASS séquentiel** après l'incident de concurrence de harnais décrit ci-dessous.
- Lint ciblé : **34 fichiers PASS**, zéro erreur/warning. Lint global : **FAIL, deux erreurs / trois warnings préexistants**, `app/login/page.tsx`, `components/client-color.tsx`, `app/account-panel.tsx` ; fichiers et configuration ESLint identiques à `087da9e`. Ne pas annoncer le lint global vert.
- `git diff --check` depuis la base v0.3 : **PASS**.
- SQLite/FK : **PASS** sur preview read-only, fixtures API/provider, intégrations/migrations et sauvegardes. Backup Linux : **29 contrôles + 2 contrôles intentions PASS** ; neuf tables comparées, intentions non vides conservées exactement, permissions/clé/manifeste/hashes contrôlés.

## Provenance et frontière

- Preview `/opt/sumatime-preview/releases/v0.3.0-round7-20261004`, loopback5174 ; mock permanent loopback8792.
- PID preview/mock **1164585 / 1164561**, inchangés pendant QM. Services actifs ; DB preview distincte, GLPI mock-only, LDAP désactivé. Aucun secret réel affiché.
- Avant rebuild : **81/81 fichiers identiques**, BUILD_ID commun `YO-BG4NCEJrGx8-dojrtQ`. Après rebuild local `HL3CTnYvH68lYfiRvhFmN` : **70/81 hashes bruts identiques, 81/81 normalisés** ; aucun drift applicatif démontré. Preview non redémarrée avec le nouveau BUILD_ID local. Route GLPI SHA-256 `903a510ac6e06e5178ff61672ef294b3effd2f97e36a76586bda97478d40bed3` et chunk UI `67b72a95527af887d375f2726c83dcf3ad764502af670699dc1718e423bbee1a` strictement identiques sans normalisation.
- **26 assets HTTP** conformes au disque ; `/login`200, API GLPI/récupération anonymes401. DB/WAL preview inchangés pendant les vérifications en lecture seule.
- **202 fichiers source/non-suivis inchangés** avant ce rapport. Dirty initial conservé : `next.config.ts`, `package.json`, `package-lock.json` ; douze non-suivis initiaux, quatre deploy et huit docs. Ce rapport seul s'ajoute ensuite.
- Tous les serveurs de recettes ont été arrêtés ; seuls les listeners preview/mock permanents restent sur les ports de recette contrôlés. Aucun processus production arrêté ni redémarré.

## Premiers incidents, dette et limites

- **Incident Dev antérieur, distinct des runs QM :** premier provider502 au lieu de403, zéro appel provider, puis rerun175 PASS. Le provider QM courant passe à son propre premier essai. Aucune cause plus précise imputée au produit sans preuve.
- **Incident déploiement Dev :** premier `systemctl daemon-reload` bloqué avec PID1 en attente noyau ; restarts explicites ensuite réussis. Non reproduit par QM. Premier contrôle post-déploiement aussi interrompu par un `printf` mal formé, puis corrigé selon handoff Dev.
- **Incident harnais statique QM :** premier tsc lancé pendant que build remplaçait `.next` : TS6053 sur fichiers générés manquants. Build puis tsc séquentiel passent. Cet échec n'est pas supprimé et n'est pas classé défaut TypeScript applicatif.
- Première préparation d'un harnais délégué : SyntaxError de parenthèse dans l'export JSON `node -e`, avant toute action applicative ; corrigée uniquement pour produire les fichiers temporaires.
- Premier challenge distinct arrêté sur le vrai bouton disabled : c'est la preuve de P2-1, pas un simple timeout infrastructure. Le run suivant conserve l'assertion en échec et ne continue qu'après le contournement documenté.
- Premier challenge ACK/polling : sessions1 au contrôle immédiat avant stabilisation, 8/9 invariants. Instrumentation de drain borné confirme une requête catégories encore en cours (`getMyEntities`), puis `changeActiveEntities`, `ITILCategory`, `killSession` et sessions0 ; 9/9. Pas de fuite persistante démontrée. Premier log conservé.
- Cinq warnings React `not wrapped in act` dans la matrice migration ; assertions passantes après stabilisation. Aucun timeout/retry nécessaire dans ces recettes historiques.
- **P3 préexistant :** migration concurrente d'ancien schéma susceptible de `duplicate column name: payload_json`, non rejouée ici ; aucune fermeture revendiquée. UI legacy ne propose que l'abandon après vérification d'absence de ticket ; recovery d'un ticket existant nécessite API/support. Chargement restant après résolution externe de plusieurs legacy encore observable, cas à blocker unique fonctionnel.
- Politique de volume/rétention des tombstones et données métier à préciser ; ne pas supprimer les protections d'identité pour réduire les lignes. Le manifeste backup ne compte pas explicitement les intentions, pourtant présentes dans la sauvegarde vérifiée.
- React/Radix/jsdom et vrais processus indépendants : pas d'onglets Chromium, pointer/tactile ou lecteur d'écran natifs instrumentés. Aucune acceptation native revendiquée.
- Les harnais de diagnostic journalisent PASS/FAIL : leur exit0 ne signifie pas que tous leurs invariants passent.

## Preuves et prochaine gate

- UI/API/mock et deux P2 : `/tmp/sumatime-qm-r7-review-kb66bx/` ; commande type depuis le dépôt : `QM_PORT=8788 QM_MOCK_PORT=8794 QM_DB_PREFIX=/dev/shm/qm-r7-recheck- node --import=tsx /tmp/sumatime-qm-r7-review-kb66bx/transitions-continued.mjs`. Les ports doivent être libres ; aucun ciblage de la DB preview.
- Statique/build/provenance/backup/intentions/crash COMMIT : `/tmp/qm-round7-static-7tto6S/RESULTS.md` et logs voisins.
- Calendrier/DST et historiques : `/tmp/qm-round7-calendar-qB43WU/RESULTS.md`, `MIGRATIONS-RESULTS.md` et logs premiers essais.

**Retour Dev sur les deux P2**, plus correction du test de course et de son contournement du bouton disabled. Ajouter une preuve de refus terminal explicitement attachée à l'opération ; conserver l'incertitude après401/429/échec de lecture. Puis nouvelle preview figée et contre-revue indépendante sans assouplissement des garanties. **La v0.3 reste non livrable avant PASS.**

Le pilote doit synchroniser MC, mémoire et activité avec **REVISE, deux P2, intégration officielle FAIL**, validations R1/R3/R4/R5 et gate Dev → QM. CHECKLIST relu ; cette sous-revue ne modifie pas les supports de coordination du pilote et ne constitue aucune autorisation de release.
