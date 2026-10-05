# Sumatoni Time v0.3 — contre-revue QM indépendante, round 6

Date : 2026-10-04 UTC. Branche : `codex/calendar-glpi-v0.3`.
HEAD revu : `09c393b283c6177f403e4d444e15acc8d1a4aca9`.

## Verdict

**REVISE — deux défauts fonctionnels P2 confirmés. Aucune release ni mise en production.**

Aucun P0/P1 démontré. Les protections d'identité et la migration des résultats progressent, mais deux transitions du formulaire empêchent encore une création légitime. Les suites statiques et provider vertes ne ferment pas ces défauts UI.

Revue selon le skill **Application Release Review**, les exigences R1–R7 et les rapports rounds 1–5. Recettes exclusivement synthétiques, avec vraie UI React/Radix/jsdom, vraie API Next et mock HTTP selon les scénarios. Aucun code applicatif modifié, aucun commit, aucun redémarrage de la preview permanente, aucun GLPI réel ou environnement de production utilisé. Ce rapport est le seul ajout au dépôt par cette revue. À la demande du pilote, la revue a été finalisée sans lancer de nouveau test après son instruction de clôture.

## P2-1 — après consommation, le formulaire exige une action distincte qu'il ne propose pas

Sources : `app/new-glpi-ticket.tsx:323`, `app/new-glpi-ticket.tsx:587`, `app/new-glpi-ticket.tsx:598`, `lib/glpi.ts:419`.

Reproduction UI → Next figé → mock :

1. Créer un ticket pour une tâche récurrente, puis cliquer **« Utiliser ce ticket »** ; le résultat est acquitté et le dialogue se ferme.
2. Cliquer **« Nouveau ticket GLPI »**, ressaisir les mêmes champs métier, puis soumettre.
3. L'API refuse HTTP 409 et demande explicitement d'utiliser **« Commencer une nouvelle demande distincte »**.
4. Ce bouton est absent : en mode brouillon, seuls les boutons Fermer/Créer sont proposés. Fermer puis rouvrir le dialogue conserve le même formulaire et le même blocage.

Le serveur ne renvoie plus un ancien ticket comme s'il venait d'être créé : cette partie du round 5 est corrigée. Cependant, l'utilisateur ne peut pas exécuter l'action maintenant obligatoire depuis le parcours normal après consommation.

**Impact :** tâche répétée légitime impossible dans ce parcours, avec instruction UI inexécutable. Un seul POST Ticket a été effectué ; aucun doublon n'est démontré.

**Attendu :** offrir une transition explicite accessible vers une nouvelle intention distincte depuis ce refus, en conservant les protections des demandes incertaines et sans demander de modifier artificiellement les champs métier.

Preuve : `/tmp/sumatime-qm-r6-review-y3fcI1/novel-ui.mjs`, `novel-first.log`. UUID initial `308708b8-db10-46f7-9555-ac1321aa6f28` ; nouveau brouillon `d6ecaa18-ac4d-40a2-b401-340b8e45ffad`. Deux assertions décrivent le même P2, avant et après fermeture/réouverture.

## P2-2 — après refus certain, la correction conserve l'identité rejetée et reste bloquée

Sources : `app/new-glpi-ticket.tsx:427`, `app/new-glpi-ticket.tsx:479`, `app/new-glpi-ticket.tsx:328`, `lib/glpi.ts:394`, `lib/glpi.ts:441`.

Reproduction UI → Next figé → mock :

1. Soumettre la fixture de refus fournisseur certain `REJECT-CREATE` ; le mock retourne un refus explicite, traduit en HTTP 422 par l'API.
2. Le formulaire reste éditable et invite à vérifier/corriger les données ; aucun résultat incertain n'est annoncé.
3. Corriger le titre vers une valeur valide puis soumettre.
4. Le client conserve l'UUID de la réservation rejetée. L'API répond HTTP 409 : **« Cette demande a changé. Ouvrez un nouveau formulaire. »**
5. Fermer et rouvrir conserve ce même UUID ; le blocage persiste et aucune action de nouvelle demande distincte n'est proposée.

La conservation serveur d'une identité terminale est cohérente avec l'idempotence. Le défaut est la transition client après un refus **certain**, qui réutilise cette identité pour une correction métier tout en présentant un formulaire réessayable.

**Impact :** correction normale impossible sans sortir du cycle de vie du composant ; le refus certain devient un blocage persistant du formulaire. Une seule tentative POST Ticket, explicitement refusée, a été observée ; aucune création supplémentaire après correction.

**Attendu :** prévoir une nouvelle identité/intention par une transition sûre après refus certain ; ne jamais appliquer cette transition à une réponse ambiguë.

Preuve : même harnais et log que P2-1. UUID rejeté et réutilisé après correction : `20fe5217-662e-4f95-8679-747efc1c6288`. Les deux assertions correction/réouverture décrivent un seul défaut.

## Intégration officielle : échec réel du run, hypothèse incorrecte du test de course

**Statut : FAIL au premier essai, non relancée. Ne pas annoncer les 70 assertions PASS dans cette revue.**

Le harnais `tests/glpi-r2-integration.mjs` a été copié en adaptant uniquement les imports et le chemin du standalone vers la preview round 6. Les assertions ont été conservées. Il échoue à la ligne 441 sur `409 !== 200`, lors du replay après expiration de `processPayloads[0]`.

À la ligne 410, les deux créations sont lancées dans des processus concurrents : l'indice 0 ne garantit pas l'identité gagnante. Le code du test accepte déjà, lignes 425–427, qu'un UUID secondaire arrivé après le résultat terminal n'ait pas d'alias et soit refusé sans création. Pourtant, la ligne 441 traite systématiquement l'indice 0 comme l'UUID original enregistré et exige HTTP 200.

**Qualification : défaut d'hypothèse du harnais, pas preuve d'un doublon applicatif.** Le refus observé est celui d'une empreinte terminée sans nouvelle intention distincte. Les assertions antérieures du même run ont déjà vérifié un seul POST pour la paire concurrente et aucun POST supplémentaire au premier replay. Le test doit identifier le gagnant depuis le résultat autoritaire et distinguer UUID durable/alias durable/UUID refusé, sans affaiblir le contrôle du compteur fournisseur.

Cet échec reste un défaut de fiabilité de la preuve de livraison : la recette officielle complète n'est pas verte et sa dernière partie n'a pas été atteinte dans ce run. Les contrôles indépendants de migration et d'idempotence ci-dessous sont séparés, ils ne transforment pas ce run en PASS.

Preuve : `/tmp/sumatime-qm-r6-review-y3fcI1/official-integration.mjs`, `official-first.log`.

## Corrections et régressions effectivement vérifiées

- **Round 5 / intention distincte depuis un résultat : PASS.** Mêmes champs métier, UUID neuf et intention serveur : exactement un nouveau POST Ticket. La perte de réponse après consommation de l'intention permet le replay du même UUID, avec ou sans le jeton déjà consommé, sans nouvel envoi. Le résultat est récupéré après remontage. Le défaut de parcours après ACK est P2-1 ci-dessus.
- **Identité après expiration : PASS dans les contrôles serveur/migration exécutés.** Les UUID et alias durables conservent leur résultat ; une échéance passée ne recrée pas de ticket. Les dates migrées sont ISO et respectent leur borne exacte. La reproduction UI complète de l'alias expiré du round 5 n'a pas été relancée dans ce round ; aucune acceptation UI additionnelle de cette variante n'est revendiquée.
- **Round 5 / résultats historiques 118 et 119 : PASS.** Vrai provider historique puis migration actuelle : chaque UUID retrouve son propre ticket et son ACK ; six créations historiques, aucune nouvelle création après migration. Des clones de la base synthétique round 5 déjà affectée ont également été contrôlés.
- **Round 3 / continuité, stockage et membres : 26/26 invariants PASS.** Stockage disponible, perdu, corrompu, quota et désactivé ; absence d'ACK caché ; processus UI distincts sans notifications ; créateurs coexistants ; réponse membre tardive, logout/login Alice/Bob ; reprise du serveur avec la même identité. Onze POST Ticket au total, zéro session finale dans cette matrice.
- **Round 4 / chargement après demande distincte et reprise : 9/9 invariants PASS.** Les catégories sont rechargées et le formulaire redevient utilisable. Arrêts du seul Next éphémère avant/après le POST : réservation conservée et aucun renvoi. Deux POST au total ; les sessions synthétiques interrompues ont été fermées explicitement, sans prétendre démontrer un nettoyage automatique après arrêt brutal.
- **Round 4 / migration legacy sans résultat : PASS.** Les anciennes incertitudes restent visibles et bloquantes ; un résultat ancien confirmé seul ne bloque pas les nouvelles créations. Les parcours de résolution et leurs contraintes ont été vérifiés sur bases synthétiques.
- **R1 : PASS.** Un trajet supplémentaire utilise réellement les handlers React, l'API Next et SQLite : undo HTTP 200, restauration exacte des bornes, payload réduit aux six clés attendues et sept champs métier préservés ; une vraie modification concurrente produit HTTP 409 et reste intacte.
- **R3 : PASS.** Provider 175 assertions : sélection d'entité strictement confirmée, refus fonctionnel/HTTP/réponse malformée bloquant les appels dépendants, sessions normalement achevées fermées.
- **R4 : PASS, 14 tests React/DOM indépendants.** Ajustements clavier successifs, reload parent tardif, erreurs/conflit, disparition/facturation, hors semaine, navigation pendant sauvegarde, undo et suppression.
- **R5 : PASS, 29 assertions indépendantes.** Printemps/automne, bornes exactes et ±1 ms, avant/après/traversée réelle, minuit et arrondi. Les champs de correction restent éditables.

La recette ciblée `novel-first.log` compte **14 invariants : 9 PASS / 5 FAIL**. Quatre FAIL représentent les deux P2, chacun avec sa variante fermeture/réouverture. Le cinquième est l'observation finale de sessions mock non toutes fermées ; le harnais coupe ensuite ses processus sans attendre une stabilisation supplémentaire. Sa cause n'a pas été isolée avant la demande de clôture : ne pas présenter ce harnais comme une preuve de fermeture complète, ni compter un troisième P2 sans preuve suffisante.

## Suites, qualité, base et sauvegardes

- Suite unitaire/DOM officielle : **35/35 PASS**, premier essai. Les suites ciblées ne sont pas additionnées une seconde fois à ce total.
- API : **198 assertions PASS**, premier essai.
- Provider : **175 assertions PASS**, premier essai ; quatre POST Ticket mock, zéro session finale.
- Intégration officielle React → Next → mock : **FAIL**, hypothèse de gagnant décrite ci-dessus ; aucun PASS 70 revendiqué.
- Calendrier/workday/DOM/migration officiels ciblés : **15/15 PASS**.
- Migration/legacy et vrai undo UI/API : **75 contrôles PASS** ; quatre créations historiques acceptées, zéro nouvelle création pendant la migration/récupération ; sessions finales zéro.
- Contrôles serveur d'intention, concurrence, portée et durée : **85 contrôles PASS**, douze POST mock, sessions finales zéro.
- Interruptions aux limites de transaction : **48 contrôles PASS** pour les opérations ordinaires et **60 contrôles PASS** pour les intentions distinctes ; trois POST mock dans chaque recette, aucune duplication après reprise, sessions finales zéro dans ces harnais.
- TypeScript : **PASS** avec `--noEmit --incremental false`.
- Build production : **PASS au premier essai, 184,646 s** ; aucun timeout build dans ce round.
- Lint ciblé : **34 fichiers PASS**, zéro erreur/avertissement dans les fichiers code touchés.
- Lint global : **FAIL, deux erreurs / trois warnings préexistants**, dans `app/login/page.tsx`, `components/client-color.tsx`, `app/account-panel.tsx`. Ces fichiers et la configuration ESLint sont octet-identiques à `087da9e`. Ne pas annoncer le lint global vert.
- `git diff --check` depuis la base v0.3 : **PASS**.
- SQLite/FK : **PASS** sur preview en lecture seule, bases API/provider, migrations et sauvegardes. Sauvegarde Linux : **29 contrôles PASS**, neuf tables comparées, six opérations et sept alias conservés, contenu/clé/permissions/manifeste/hashes vérifiés ; **deux contrôles supplémentaires PASS** démontrent que les douze lignes d'intention d'une base non vide sont conservées octet pour octet dans sa sauvegarde dédiée.

## Provenance de la preview et frontière de mutation

- Preview : `/opt/sumatime-preview/releases/v0.3.0-round6-20261004`, loopback `127.0.0.1:5174` ; mock permanent `127.0.0.1:8792`.
- PID preview/mock **1155566 / 1155565**, inchangés. Base preview distincte, URL GLPI exclusivement mock, LDAP désactivé ; aucun secret réel affiché.
- Avant rebuild : **81/81 fichiers comparés identiques**, BUILD_ID commun `95uLDGyMP1_Tejp0s2iiX`.
- Après rebuild local : **70/81 hashes bruts identiques, 81/81 après normalisation** BUILD_ID/ordre JSON ; aucune différence applicative démontrée. Nouveau BUILD_ID local `1rDf0Ghi5oEwpQz1zkKvL` ; preview inchangée.
- Route GLPI SHA-256 `8f6b6ed033abd2c4fb07a206182bb6beab46e6e2ea6309d67d02390c1a13af10`, page serveur `a642da1abba28223e26f2ca33fd0a127ecc5aef8255089092ab8007369bf6f62`, chunk UI `c489e26b15c9e11f7e7523778765c28bf3913914f3fff9f905a777f6deb1c35d` : strictement identiques preview/rebuild, sans normalisation.
- **26 assets servis correspondent au disque**. `/login` 200 ; API GLPI et récupération anonymes 401, avant/après les contrôles.
- **201 fichiers source/non-suivis inchangés** au contrôle de frontière précédant ce rapport. Dirty initial conservé : `next.config.ts`, `package.json`, `package-lock.json` ; onze non-suivis initiaux (quatre deploy et sept documents). Seul ce rapport s'ajoute ensuite.
- Les recettes modifiant des données utilisent des standalone figés ou snapshots et des bases `/tmp`/`/dev/shm`. La preview permanente n'a pas servi de base d'écriture de recette ; ses contrôles SQLite sont en lecture seule.

## Dette, limites et premiers incidents

- Tests interactifs React/Radix/jsdom ; processus indépendants pour les contextes concurrents, mais pas d'onglets Chromium ni de pointer/tactile natifs instrumentés. Ne pas revendiquer cette acceptation native.
- L'échec de l'intégration officielle est conservé et non réessayé ; il doit être corrigé dans le test avant une nouvelle gate complète.
- La recette ciblée des deux P2 conserve également son assertion finale de sessions non fermées ; cause non isolée, portée limitée à ce harnais.
- Les premiers incidents des harnais délégués sont conservés dans leurs logs : erreur de syntaxe du harnais d'intention, première fixture de sauvegarde sans lignes d'intention, et transaction imbriquée dans une fixture de migration, rectifiées dans `/tmp` seulement. Cinq warnings React `act` sont également conservés dans l'intégration calendrier élargie ; ses assertions passent après attente de stabilisation. Ces incidents ne sont pas présentés comme défauts produit.
- **P3 préexistant :** deux migrations d'ancien schéma démarrées simultanément peuvent produire `duplicate column name: payload_json`. Reproduit ; base finale intègre, aucun incident observé sur la preview mono-process.
- **P3 préexistant / legacy :** la récupération d'un ancien ticket confirmé fonctionne via API, mais n'a pas de parcours UI ; l'interface propose seulement l'abandon après vérification qu'aucun ticket n'existe. Le cas où un ticket existe nécessite donc encore un support adapté. Le chargement d'une instance ouverte après résolution externe de plusieurs historiques reste une limite documentée, sans nouveau P2 établi.
- La rétention permanente protège l'identité ; elle conserve aussi les lignes et données métier. La politique opérationnelle de volume/rétention reste à préciser sans supprimer la protection des identités connues. Aucun incident de capacité démontré.
- Le manifeste de sauvegarde ne compte pas encore explicitement les intentions, même si la table et ses lignes sont présentes dans la sauvegarde vérifiée.
- Les harnais de diagnostic journalisent chaque invariant ; un exit 0 peut signifier « preuve terminée » et ne remplace pas la lecture des FAIL.

## Preuves et prochaine gate

- UI/API/mock, deux P2 et intégration officielle : `/tmp/sumatime-qm-r6-review-y3fcI1/` ; `novel-first.log`, `integration-first.log`, `official-first.log`, `crash-first.log`.
- Statique, build, provenance, SQLite et sauvegardes : `/tmp/qm-round6-static-Q3VxDX/RESULTS.md` et logs/resultats associés.
- Calendrier, DST, undo réel et migrations : `/tmp/qm-round6-calendar-DsetK8/RESULTS.md` et logs associés.

**Retour Dev sur les deux P2 UI**, et correction de l'hypothèse de course du test officiel. Puis nouvelle preview figée et contre-revue indépendante des transitions refus certain/ACK/intention distincte, sans affaiblissement de l'idempotence ni des protections d'une réponse inconnue. **La v0.3 reste non livrable avant PASS.**

Le pilote doit synchroniser Mission Control, mémoire et activité avec exactement **REVISE, deux P2 UI, intégration officielle FAIL sur hypothèse de test**, les validations R1/R3/R4/R5 et la prochaine gate Dev → QM. Cette sous-revue ne modifie pas ces supports de coordination ; CHECKLIST doit être revérifié par le pilote avant annonce utilisateur.
