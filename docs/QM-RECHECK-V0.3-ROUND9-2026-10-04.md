# Sumatoni Time v0.3 — contre-revue QM indépendante, round 9

Date : 2026-10-04 UTC. Branche : `codex/calendar-glpi-v0.3`.
HEAD revu : `21f375d8bfc3da817662d0cea645b95d24ad9672`.

## Verdict

**BLOCKED — revue incomplète sur une limite d’expiration de l’intention distincte. Aucun PASS de release, aucune mise en production.**

Les deux reproductions exactes du round 8 sont **corrigées dans les parcours exécutés**. Les suites officielles et les régressions historiques ci-dessous passent. Aucun nouveau P0/P1 ni nouveau P2 reproduit de bout en bout n’a été établi pendant ce round.

Un **risque fonctionnel de niveau potentiel P2** reste cependant non levé : après expiration locale d’une intention distincte qui n’a pas encore été réservée, le client retire sa capability avant la récupération. Le chemin de code permettant ensuite de rattacher ce nouvel UUID à une ancienne opération identique existe toujours. **L’effet complet UI → Next → mock après expiration n’a pas été reproduit dans cette revue** ; il ne doit être annoncé ni comme défaut expérimentalement confirmé ni comme correction validée.

À la demande du pilote, la revue a été clôturée sans lancer de nouveau test. Le statut BLOCKED exprime cette limite de validation et ce risque d’identité non tranché, pas un échec des suites passantes. La prochaine gate est une recette ciblée de cette limite, puis un verdict indépendant actualisé.

Revue conduite selon [Application Release Review](/root/.openclaw/agents/main/agent/workshop-skills/application-release-review/SKILL.md), les exigences R1–R7 et les rapports rounds 1–8. L’application, les commits, les services permanents, la production et le vrai GLPI n’ont pas été modifiés. Ce rapport est le seul ajout QM au dépôt ; les autres artefacts sont temporaires et les données de recette synthétiques.

## Deux corrections round 8 confirmées

### Configuration temporairement indisponible

Le parcours réel React/Radix/jsdom → Next figé → mock commence par une création fournisseur acceptée mais incertaine. Lorsque la configuration GLPI du seul serveur de recette devient temporairement indisponible, la récupération reçoit le vrai HTTP409 avec `CONFIG_NOT_READY`, `terminal:false`, `retryable:true`, `preserveOperation:true`.

L’interface conserve désormais le même UUID, le payload et le verrou. Aucun formulaire corrigible sous nouvel UUID n’est ouvert implicitement. La recette officielle round9 couvre également le rétablissement de configuration et la reprise : **un seul POST fournisseur pour l’opération**.

- Reprise indépendante du harnais round8 : **23/23 invariants PASS**, un POST, sessions finales0. Le total est23, pas24 : la branche supplémentaire qui exploitait la perte de verrou n’est plus atteinte.
- Vrais401/429, reprise après restauration de session, polling pendant limitation,500/503/504, JSON malformé/vide/null et erreur transport sont également couverts. Les erreurs navigateur instrumentées ne sont pas présentées comme des pannes spontanées du serveur.
- Double clic sur Récupérer : une tentative API, aucune nouvelle création fournisseur.

Preuves : `recovery-deep-first.log` et `round9-official-first.log` dans `/tmp/sumatime-qm-r9-review-2LUh3l/`.

### Premier envoi distinct refusé401 avant réservation

Après une ancienne opération incertaine, le clic distinct autorise une nouvelle intention. Le premier envoi sous nouvel UUID reçoit le vrai401 avant réservation. Après restauration de la session, la récupération conserve maintenant **le nouvel UUID et la capability**, crée la seconde opération une seule fois et ne l’aliasse pas à l’ancienne.

- Reproduction exacte indépendante round8 : **10/10 PASS**, deux POST au total pour les deux opérations explicitement demandées, sessions0.
- Intégration officielle round9 : remontage réel React avec stockage durable, récupération conservant identité/capability, aucun alias ancien. Les deux scénarios round9 combinés passent, deux POST dans leur fixture.
- Cette validation est dans la durée de validité de la capability ; elle ne ferme pas le cas d’expiration ci-dessous.

Preuves : `distinct-transient-first.log`, `round9-official-first.log`.

## Limite d’expiration restant à valider

Observations établies par lecture du HEAD :

- `app/new-glpi-ticket.tsx:51` refuse localement une capability dont `expiresAt` est dépassé ; ce filtre intervient aussi lors de la restauration du brouillon.
- `app/new-glpi-ticket.tsx:341` efface alors `distinctIntent` et son échéance.
- `app/new-glpi-ticket.tsx:603` appelle ce filtre avant récupération ; `:605` n’envoie plus `distinct_intent` si la référence a été effacée.
- `lib/glpi.ts:251` sait refuser explicitement une intention expirée **si elle lui est transmise**.
- `lib/glpi.ts:494` ne vérifie l’intention que si son identifiant est présent ; `:496` à `:500` conservent le rapprochement d’une requête ordinaire sans intention avec une opération autoritaire de même empreinte.

L’hypothèse fonctionnelle est donc la perte de la distinction après une interruption suffisamment longue **avant réservation**, avec possible retour vers une ancienne demande. La matrice serveur85 prouve séparément que le serveur refuse une capability expirée reçue explicitement. Elle ne prouve pas que le navigateur continue à transmettre cette identité après son propre filtrage temporel.

**État exact : chemin à risque identifié dans le code, conséquence utilisateur non reproduite à cette gate.** Aucun doublon, aucun alias observé après expiration et aucune perte de ticket ne sont revendiqués sur cette nouvelle variante. Une confirmation ciblée doit également couvrir le remontage après expiration et distinguer une intention encore inutilisée d’une opération déjà réservée.

L’audit supplémentaire a été interrompu par un filtre automatique de contenu avant la production de cette preuve. Il s’agit d’une limite de la revue, pas d’une réponse ou d’un défaut de l’application. La consigne ultérieure de clôture sans nouveau test a été respectée.

## Régressions et invariants validés

- **Round7 / transition distincte : 14/14 PASS.** Options chargées et bouton réellement utilisable sans remontage supplémentaire ; correction d’un refus certain sous nouvel UUID ; double clic et replay sans création additionnelle. Cinq POST de fixture.
- **Round3 : 26/26 PASS.** Stockage fonctionnel/perdu/corrompu/quota/désactivé, absence d’ACK invisible, deux processus UI sans notifications, créateurs coexistants, ancienne réponse Alice ignorée chez Bob, logout/login et reprise durable. Onze POST, sessions0. Ces variantes stockage ne sont pas une preuve spécifique du nouveau cas capability pré-réservation puis remontage sans stockage.
- **ACK perdu et polling distinct : 9/9 PASS.** ACK commis puis réponse perdue, remontage, consommation idempotente et callback unique ; nouveaux champs distincts préservés. Trois POST, sessions0 après drain borné.
- **Alias expiré d’une opération déjà enregistrée : 6/6 PASS**, un POST total ; ce cas est différent de l’expiration d’une capability inutilisée.
- **Arrêt/reprise du Next éphémère : 9/9 PASS**, deux POST total, réservation conservée et absence de renvoi. Les sessions synthétiques interrompues sont fermées explicitement dans ce harnais ; aucune fermeture automatique après arrêt brutal n’est revendiquée.
- **Intentions serveur : 85 PASS**, portée membre/API, valeurs invalides, expiration reçue par le serveur, réemploi, dix courses single-use et identités durables. Douze POST, sessions0.
- **Limites transactionnelles : 48 PASS ordinaires et60 PASS distinctes**, réservation/alias/consommation atomiques, trois POST par matrice et sessions0 aux points instrumentés.
- **R1 : PASS réel React → Next → SQLite.** Undo200, six clés seulement, heures HH:MM, version courante, bornes restaurées et sept champs métier préservés ; vrai concurrent409, données concurrentes intactes.
- **R3 : PASS via provider175.** Sélection d’entité strictement confirmée ; false/HTTP/réponse malformée bloquent les opérations dépendantes, sessions normalement achevées fermées.
- **R4 : 14/14 PASS DOM indépendant.** Deux ajustements start/end/move, parent retardé, erreurs/conflit, cible disparue/facturée/hors semaine, navigation, undo/suppression : focus exact ou fallback connecté.
- **R5 : 29/29 PASS.** Printemps/automne, bornes exactes±1ms, traversée réelle, minuit et arrondi. Éditabilité des bornes inspectée.
- **Migrations : 75 contrôles PASS ; deep78 PASS** (`4+27+21+26`, sans double comptage du rollback). Historiques115/118/119 retrouvent leur propre résultat/replay/ACK ; six POST historiques, aucun après migration. TTL ISO exact, alias/reopen et tombstones conservés.

La couverture effectuée du contrat d’erreur est ciblée, pas exhaustive pour toutes combinaisons statut/champs contradictoires ou tous anciens clients. Aucun PASS global de compatibilité de schéma, d’expiration UI ou de session-epoch au-delà des parcours réellement exécutés n’est revendiqué.

## Suites, qualité et données

- **39/39 unités/DOM/migrations officiels PASS**, premier essai,8,137s ; les tests DOM inclus ne sont pas additionnés de nouveau.
- **Intégration officielle94 PASS au premier essai**,40,862s, onze POST du mock principal.
- **Intégration round9 PASS au premier essai**,11,335s, deux POST ; configuration rétablie et remontage distinct401.
- **API198 PASS au premier essai**,5,458s ; **provider175 PASS au premier essai**,34,913s, quatre POST et sessions0.
- **Build production PASS au premier essai**,70,575s ; **TypeScript PASS après build**,6,799s.
- **Lint ciblé39 fichiers PASS**, zéro erreur/warning ; **lint global FAIL deux erreurs/trois warnings préexistants**, dans `app/login/page.tsx`, `components/client-color.tsx`, `app/account-panel.tsx`. Ces fichiers et la configuration ESLint sont identiques à `087da9e`.
- **Diff-check depuis `087da9e` PASS**.
- **SQLite/FK PASS dans les fixtures UI, intentions, reprises transactionnelles, migrations et sauvegardes exécutées**. La vérification finale séparée des bases source/preview en lecture seule était préparée mais n’a pas été lancée avant clôture ; ne pas lui attribuer un résultat.
- **Backup Linux29 PASS + intentions2 PASS** : neuf tables du manifeste comparées, six opérations/sept alias dans la fixture provider, douze intentions non vides conservées exactement, fichiers/permissions/hashes contrôlés. Configuration et clé exclusivement synthétiques.

## Preview, provenance et frontière

- Preview figée : `/opt/sumatime-preview/releases/v0.3.0-round9-20261004-r2`, loopback5174 ; mock permanent loopback8792. BUILD_ID servi `EVsxO_GUqpr8-ZsC6XWGa`.
- PIDs preview/mock **1208789/1208785**, inchangés au contrôle de provenance après build. Base preview distincte, LDAPfalse, URL GLPI strictement mock-only ; aucun secret réel affiché.
- Avant rebuild : **81/81 fichiers comparés identiques**, même BUILD_ID, `server.js` identique.
- Après rebuild local `T5Km0K50qtq4Sq14lHcxp` : **72/81 hashes bruts identiques,81/81 normalisés**, aucune différence applicative observée. La preview n’a pas été redémarrée avec le BUILD_ID de contrôle.
- `/login`200 ; API GLPI et récupération anonymes401. Assets HTTP comparés au disque avec succès, y compris après rebuild local.
- **208 fichiers source/non-suivis inchangés** au contrôle après build, HEAD et dirty préservés. Dirty initial : `next.config.ts`, `package.json`, `package-lock.json`, quatre fichiers deploy et dix documents non suivis. Seul ce rapport s’ajoute ensuite.
- Les recettes utilisent soit le build local vérifié avant reconstruction, soit la release figée avec des bases synthétiques `/dev/shm`/`/tmp`. Aucun service permanent arrêté ou redémarré ; tous les processus de recette déjà lancés étaient terminés à la clôture.

## Incidents, dette et limites

- Les premiers incidents **Dev** antérieurs (attente filesystem API et tentative provider avec conflit d’adresse/502 transitoire) restent documentés dans le handoff et la mémoire ; ils ne sont pas effacés par les premiers essais QM réussis. Aucun timeout/retry des suites principales QM de ce round.
- Cinq warnings React `act` conservés dans l’intégration calendrier historique ; assertions passantes. Deux petites erreurs de commandes de lecture de logs (option `tail`, accolade dans un résumé Node) n’ont exécuté aucun test ni modifié l’application.
- **P3 antérieurs non fermés** : migration simultanée d’ancien schéma non rejouée ; récupération d’un ancien ticket existant toujours API/support ; politique de rétention/volume des tombstones à préciser. Le manifeste backup omet le compte explicite des intentions, dont le contenu sauvegardé est néanmoins vérifié.
- React/Radix/jsdom et processus indépendants, pas Chromium/pointer/tactile/lecteur d’écran natifs. Aucune acceptation native revendiquée.
- Les harnais diagnostiques consignent les invariants : leur exit0 n’est pas utilisé seul comme preuve de PASS. Les listes de checks ont été lues, sans échec caché dans les sept matrices UI exécutées.

## Preuves et prochaine gate

- Consolidation UI/API/provider/build/provenance/backup : `/tmp/sumatime-qm-r9-review-2LUh3l/` ; chaque run conserve sa commande, son environnement borné, son premier log et son résultat JSON.
- Calendrier/DST/historiques : `/tmp/qm-round9-calendar-c0e8oG/RESULTS.md`, logs premiers essais et identité des harnais. Substitutions environnement seulement, assertions historiques conservées.

**Gate maintenue BLOCKED** jusqu’à confirmation ou correction de la limite d’expiration avant réservation et clôture de la validation ciblée restante. Les deux P2 exacts du round8 sont fermés dans les parcours exécutés ; ne pas les laisser marqués non corrigés, mais ne pas transformer ces PASS bornés en PASS de release.

CHECKLIST relu. Le pilote doit synchroniser MC, mémoire et activité avec **BLOCKED/revue incomplète ; deux reproductions round8 corrigées ; risque potentiel P2 expiration non reproduit ; suites principales PASS ; aucune release** avant annonce à Master. Cette sous-revue ne modifie pas ces supports de coordination et ne constitue aucune autorisation de déploiement.
