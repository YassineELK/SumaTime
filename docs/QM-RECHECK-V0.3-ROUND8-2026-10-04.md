# Sumatoni Time v0.3 — contre-revue QM indépendante, round 8

Date : 2026-10-04 UTC. Branche : `codex/calendar-glpi-v0.3`.
HEAD revu : `062a847ddcf98e35d334766182e4b6d2e49f5ee4`.

## Verdict

**REVISE — deux défauts P2 confirmés sur les transitions de récupération. Aucune release ni mise en production.**

Aucun P0/P1 démontré. Les deux reproductions exactes du round 7 sont corrigées : l’action distincte recharge ses options sans remount, et les récupérations 401/429 conservent l’UUID, le payload et le verrou. L’intégration officielle passe enfin **94 assertions au premier essai**. Deux challenges supplémentaires montrent cependant qu’un 409 non terminal efface encore l’incertitude et qu’une autorisation distincte se perd après le premier envoi refusé pour authentification.

Revue selon **Application Release Review**, exigences R1–R7 et rapports rounds 1–7, avec vrais composants React/Radix/jsdom, vraie API Next et mocks HTTP. Aucun changement applicatif, commit, redémarrage permanent, production ou GLPI réel. Bases synthétiques `/tmp`/`/dev/shm` uniquement pour les mutations. Le présent rapport est le seul ajout au dépôt par QM ; Mission Control/mémoire restent à synchroniser par le pilote avant annonce globale.

## P2-1 — un 409 de configuration sans preuve terminale efface l’incertitude

Sources : `app/new-glpi-ticket.tsx:43-48`, `:554-560`, `:583-591` ; `app/api/glpi/route.ts:7-14`, `:50`.

Le nouveau classificateur exclut plusieurs erreurs transitoires, mais son fallback considère encore **tout autre HTTP 4xx** comme terminal, même lorsque l’API annonce explicitement `terminal:false`.

Reproduction réelle UI → Next round8 → mock :

1. Créer `UNCERTAIN-CREATE`. Le mock accepte le Ticket puis détruit sa réponse ; SQLite conserve l’opération `uncertain`, UI verrouillée, un POST.
2. Redémarrer **seulement le Next éphémère de recette**, même DB, avec `GLPI_API_URL` momentanément absent. Aucun service permanent n’est modifié.
3. Cliquer **Récupérer le résultat**. Le vrai endpoint répond 409 **avant de consulter l’opération** : `{"error":"GLPI doit être configuré.","uncertain":false,"terminal":false,"retryable":false}`.
4. L’UI retire pourtant l’état incertain, génère un nouvel UUID, déverrouille les champs et active Créer.
5. Rétablir la même configuration mock, attendre le polling de disponibilité, corriger seulement le titre et cliquer réellement Créer, sans action distincte.

Résultat : **deux Ticket POST**, ancien UUID `42af5c77-2c72-4a32-83cd-692e58e96abe` toujours `uncertain`, nouvel UUID `8297f510-3b5f-41bf-9089-82670096635b` `completed`. `distinct_intent_id=NULL` sur les deux lignes. Zéro session finale.

**Impact :** une indisponibilité de configuration, qui ne prouve aucun rejet fournisseur, autorise une correction créatrice de la demande précédemment acceptée. Ce n’est pas un doublon provoqué par le replay inchangé du même UUID ; c’est la perte injustifiée de sa protection, comme dans le défaut round7 désormais fermé pour 401/429.

**Attendu :** la récupération doit rester fail-closed tant qu’aucune preuve terminale autoritaire de l’opération identifiée n’est disponible. `terminal:false` et une erreur préalable à sa consultation ne peuvent pas justifier un nouvel UUID ni le déverrouillage.

Preuves : `/tmp/sumatime-qm-r8-review-qlwV9q/recovery-deep.mjs`, `recovery-deep-final.log` ; **24 invariants, 22 PASS / 2 FAIL**, les deux FAIL décrivant ce même P2. Confirmation antérieure `recovery-deep-stabilized.log`, avec autres UUID et le même résultat.

## P2-2 — le premier submit 401 perd l’intention distincte et récupère l’ancienne opération

Sources : `app/new-glpi-ticket.tsx:468-473`, `:550-560` ; `lib/glpi.ts:403`, `:415-419`.

`submit` efface inconditionnellement `distinctIntent.current` après tout non-2xx. Une erreur d’authentification survenant **avant la réservation** retire donc l’autorisation encore valide. La récupération réutilise bien le nouvel UUID, mais plus la capability qui distingue cette opération de l’ancienne empreinte identique.

Reproduction réelle UI → Next round8 → mock, boutons réellement activés/cliqués :

1. Créer une demande réellement acceptée mais incertaine, UUID `454b7d08-8298-468f-bb0a-298bd7d36e70`.
2. Cliquer **Commencer une nouvelle demande distincte**. Le serveur émet une intention single-use, liée au membre/API/opération ; les options se chargent et Créer est utilisable sans remount.
3. Avec les mêmes champs métier, soumettre la nouvelle opération `7bd6467a-47c9-4ba4-99d0-25e5175accd0`, mais avec un cookie temporairement invalide. Le vrai endpoint répond 401 ; aucun second POST fournisseur, aucune réservation de ce nouvel UUID. La requête contenait bien sa capability.
4. Restaurer le cookie valide et cliquer **Récupérer le résultat**. La requête conserve le nouvel UUID mais omet désormais `distinct_intent`.
5. Le serveur rattache durablement ce UUID à l’ancienne incertitude de même empreinte. L’UI adopte l’ancien UUID ; au clic de récupération suivant elle utilise `454b7d08…`, pas `7bd6467a…`.

Résultat : **un seul POST au lieu des deux opérations explicitement demandées** ; l’intention autorisée reste `used_at=NULL`, et le nouvel UUID est désormais un alias de l’ancien. Une preuve serveur indépendante démontre que rétablir ensuite la capability sur ce UUID ne répare pas l’alias déjà créé : la lecture d’identité précède sa vérification.

**Impact :** l’action distincte est silencieusement perdue après un incident d’authentification ; la récupération annoncée « même UUID/même demande » change d’opération. L’utilisateur doit recommencer l’action distincte, et une récupération peut lui présenter le mauvais incident. Ce défaut ne prétend pas démontrer un nouveau Ticket dupliqué.

**Attendu :** préserver l’identité complète de l’intention explicitement autorisée jusqu’à sa réservation/consommation prouvée ou son abandon explicite ; un refus transitoire préalable à la réservation ne doit ni supprimer sa capability ni convertir son UUID en alias d’une intention antérieure.

Preuves : `/tmp/sumatime-qm-r8-review-qlwV9q/distinct-transient.mjs`, `distinct-transient-first.log` ; **10 invariants, 7 PASS / 3 FAIL**, trois observations du même P2, premier essai. Preuve serveur complémentaire : `/tmp/qm-round8-server-OOY5jg/lost-intent-first.log`, neuf contrôles, un POST, sessions0.

## Régressions effectivement validées

- **Round7 / chargement distinct : PASS.** Après ACK puis refus 409 du même besoin, action distincte unique, options `Non précisée / Assistance`, bouton Créer actif sans fermeture supplémentaire ni remount. Double clic réel sur Créer : exactement un nouveau POST ; replay UUID idempotent ; réemploi de capability avec autre UUID refusé. `transitions-click-first.log` : **14/14 PASS**, cinq POST incluant les autres fixtures.
- **Round7 / récupération401/429 : PASS exact.** Vrai 401 par cookie invalide ; restauration de session puis reprise même UUID/payload. Vrai 429 obtenu par clics successifs du limiteur 10/min ; polling pendant backoff conserve le verrou. Après libération de la seule ligne du limiteur synthétique, reprise même opération, un POST total avant le challenge config séparé.
- **500/503/504, JSON malformé/absent/null, erreur transport simulée : PASS.** Réponses navigateur instrumentées après établissement d’une vraie incertitude fournisseur ; identité et verrou conservés. Le 503 portait même `terminal:true` : le statut transitoire reste prioritaire. Ces injections ne sont pas présentées comme des 5xx spontanés de Next.
- **Double récupération : PASS.** Deux clics immédiats produisent une seule tentative API, aucune nouvelle création fournisseur.
- **Round6 / refus certain : PASS.** Fixture fournisseur422, tombstone `rejected`, correction après vrai remontage React sous nouvel UUID, une seule création acceptée après la tentative refusée.
- **Round3 : 26/26 PASS.** Stockage fonctionnel/perdu/corrompu/quota/désactivé, pas d’ACK invisible, deux processus UI sans notifications, créateurs coexistants, réponse Alice tardive ignorée chez Bob, logout/login et reprise durable. Onze POST mock, sessions0.
- **ACK perdu et polling distinct : 9/9 PASS.** ACK réellement commis puis réponse perdue, remount/retry idempotent, callback livré une seule fois ; nouveaux champs distincts conservés après polling. Trois POST, sessions0 après drain borné.
- **Alias expiré, vraie UI : 6/6 PASS.** Deux UUID réellement soumis dans deux processus ; après ACK ailleurs et expiration synthétique, récupération de l’identité secondaire sans second POST. Un POST total, sessions0.
- **Crash Next avant/après POST : 9/9 PASS.** Réservation et identité conservées, aucun renvoi après reprise, demande distincte utilisable. Deux POST total. Sessions interrompues fermées explicitement dans ce seul harnais ; aucune affirmation de nettoyage automatique après SIGKILL pendant une session.
- **Historiques : PASS.** Incertitudes legacy bloquantes, anciens résultats confirmés non bloquants, résolution/permissions, tombstones, ISO exact, rollback, reopen, alias. Les résultats historiques **115/118/119** conservent leurs propres UUID/replay/ACK, six POST historiques et aucun après migration.
- **R1 : PASS réel React → Next → SQLite.** Undo envoie seulement action/id/version/date/start/end, heures HH:MM, version courante ; HTTP200 et restauration exacte, sept champs métier préservés. Vrai concurrent →409, données concurrentes intactes. Focus rétabli après reload parent retardé.
- **R3 : PASS.** Provider175 : changement d’entité strictement `true`, false/HTTP/malformed bloquent les appels dépendants, sessions normalement achevées fermées.
- **R4 : 14/14 PASS DOM indépendant.** Deux ajustements start/end/move, parent tardif, erreurs/conflit, disparition/facturation/hors semaine, navigation, undo/suppression : focus exact ou fallback connecté.
- **R5 : 29/29 PASS.** Printemps/automne, bornes exactes ±1ms, traversée réelle, minuit/arrondi ; champs de correction éditables à l’inspection.

## Suites, qualité et données

- Unités/DOM officiels : **35/35 PASS**, premier essai, 13,067s. Les DOM inclus ne sont pas additionnés une seconde fois.
- **Intégration officielle94 PASS au premier essai**, 46,673s, onze POST du mock principal. Le gagnant est déterminé par l’opération autoritaire ; le perdant409 terminal sans alias est accepté uniquement comme refus fermé, avec compteur fournisseur toujours vérifié. Les assertions de replay après ACK/expiry restent présentes. La suite conserve des submits programmatiques ; son PASS seul ne prouve pas un bouton utilisable, d’où le challenge de clic indépendant.
- **API198 PASS au premier run effectif** après stall filesystem transitoire documenté ci-dessous ; une répétition tmpfs déjà engagée passe aussi, sans double comptage.
- **Provider175 PASS au premier essai**, quatre Ticket POST, sessions0.
- Intentions serveur : **85 PASS**, dix courses single-use, portée membre/API, forge/expiration/replay/alias ; douze POST, sessions0.
- Crash aux limites COMMIT : **48 PASS** ordinaires et **60 PASS** distincts ; trois POST par matrice, sessions0. Réservation/alias/consommation d’intention atomiques.
- Migration/legacy/undo réel : **75 PASS** ; deep migrations : **78 PASS** (`4+27+21+26`), zéro réseau. Les quatre checks rollback ne sont pas recomptés à part.
- Build production : **PASS premier essai**, 43,821s. TypeScript exécuté **après** build : **PASS**, 7,373s, aucun conflit de fichiers générés.
- Lint ciblé : **34 fichiers PASS**, zéro erreur/warning. Lint global : **FAIL deux erreurs/trois warnings préexistants**, `app/login/page.tsx`, `components/client-color.tsx`, `app/account-panel.tsx` ; fichiers et configuration ESLint identiques à `087da9e`.
- `git diff --check 087da9e` : **PASS**.
- SQLite/FK : **PASS** sur source/preview read-only et fixtures/migrations/backups. Contrôle local de dix bases, complément serveur de seize bases : ce sont des périmètres qui peuvent se recouper, pas 26 bases uniques revendiquées. Source et preview DB/WAL inchangés.
- Backup Linux : **29 contrôles PASS + deux contrôles intentions non vides**, neuf tables comparées, douze intentions conservées exactement, clés synthétiques/permissions/manifeste/hashes corrects.

## Provenance et frontière

- Preview `/opt/sumatime-preview/releases/v0.3.0-round8-20261004`, loopback5174 ; mock permanent loopback8792. PIDs **1179464 / 1179460**, inchangés. Base preview distincte, GLPI strictement mock, LDAPfalse. Aucun secret réel imprimé.
- Avant rebuild : **81/81 fichiers identiques**, BUILD_ID commun `U1jRquRbLLLb3dYbZf5eu`. L’intégration officielle utilise ce build local vérifié et se termine avant le rebuild ; les autres parcours Next utilisent la release figée.
- Après rebuild local `IB2OxzLMLg8_QdCExcnMX` : **70/81 hashes bruts identiques, 81/81 normalisés** BUILD_ID/ordre JSON. Aucune différence applicative. La preview n’est pas redémarrée avec le BUILD_ID de contrôle.
- Route GLPI SHA256 `06716e1738b6e7aaaf40f53b2bb8fc66c861b9c2fda44aa3c52c26870216b256`, page serveur `834c9a41d05fff209af66d233b976ed8e02367e73e2bba03de06f36541315b4f`, chunk UI `35336151a7ad6107531570b8fe565b0a50f4ec38c987298a0ce79e50c0a7daf3` : identiques preview/rebuild sans normalisation.
- **26 assets HTTP conformes au disque**. `/login`200, API GLPI et récupération anonymes401, avant/après.
- **203 fichiers source/non-suivis inchangés**, HEAD et dirty identiques au contrôle final précédant ce rapport. Dirty initial : `next.config.ts`, `package.json`, `package-lock.json` ; treize non-suivis, quatre deploy et neuf docs. Ce rapport seul s’ajoute ensuite.
- Tous les listeners de recette sont fermés. Aucun processus permanent ou production arrêté/redémarré ; seuls les Next éphémères créés pour crash/config ont été relancés.

## Premiers incidents, dette et limites

- API : Next éphémère en état D `jbd2_log_wait_commit`, curl diagnostic `/api/auth` timeout5s. Le premier runner reprend et finit198 PASS naturellement, avant la tentative de terminaison ; ses PID étaient déjà absents, aucun signal livré. Une répétition tmpfs préparée pendant le stall passe aussi. Pas d’assertion API échouée transformée en PASS.
- Premier challenge récupération élargi : une assertion «429» échoue parce que le harnais s’arrête à dix requêtes permises après remise à zéro, pas à la onzième limitée. Première tentative après rétablissement config trop précoce, `pendingCheckFailed` empêche encore le submit ; timeout conservé. Adaptations **du harnais seulement** : onzième clic réel, attente2,4s du polling après restart. Le run final ferme401/429 et conserve les deux FAIL du vrai P2config. `recovery-deep-first.log` et `recovery-deep-stabilized.log` restent disponibles.
- Premier diagnostic SQLite serveur : assertion trop stricte «WAL absent» versus fichier WAL vide créé par une ouverture read-only. DB inchangée, zéro frame ; contrôle affiné DB/hash des frames passe sur16 bases. Premier log conservé, pas présenté comme corruption.
- Cinq warnings React `act` dans l’intégration historique ; assertions passantes après les attentes existantes. Aucun timeout/retry du build, de l’intégration officielle ou des migrations.
- **P3 antérieurs :** récupération d’un ticket legacy existant reste API/support ; course de migration simultanée non rejouée, aucune fermeture revendiquée. La fixture multi-legacy dont les catégories restaient bloquées au round7 affiche maintenant `Non précisée / Assistance` après résolution externe ; amélioration prouvée de cette fixture seulement.
- Politique de volume/rétention des tombstones/données métier encore à préciser. Manifeste backup sans compte explicite des intentions, mais contenu non vide vérifié intact.
- React/Radix/jsdom et vrais processus indépendants, **pas Chromium/pointer/tactile/lecteur d’écran natifs**. Aucune acceptation native revendiquée.
- Les harnais de diagnostic consignent les PASS/FAIL ; leur exit0 signifie parfois «preuve terminée», pas «produit accepté».

## Preuves et prochaine gate

- UI/API/mock, build/provenance : `/tmp/sumatime-qm-r8-review-qlwV9q/` ; logs `official-first.log`, `transitions-click-first.log`, `recovery-deep-final.log`, `distinct-transient-first.log`, `round3-regressions-first.log`, `ack-polling-first.log`, `expired-alias-first.log`, `crash-distinct-first.log`.
- Serveur/provider/backup : `/tmp/qm-round8-server-OOY5jg/RESULTS.md` et logs voisins.
- Calendrier/DST/historiques : `/tmp/qm-round8-calendar-K3NbO0/RESULTS.md` et `evidence-verification.log` prouvant les seules substitutions de chemins/ports, sans assouplir les assertions.
- Commande de reproduction principale depuis le dépôt : `node --import=tsx /tmp/sumatime-qm-r8-review-qlwV9q/recovery-deep.mjs` ; utilise8789/8793 libres, uniquement bases synthétiques. Autre P2 : même commande avec `distinct-transient.mjs`, séquentiellement. Les commandes exactes et environnements des runs conservés figurent dans chaque `.log`/`.result.json`.

**Retour Dev sur les deux P2**, puis preview figée et nouvelle contre-revue indépendante. Préserver la totalité de l’identité d’opération/intention, n’accepter un déverrouillage que sur preuve terminale adéquate, conserver les assertions officielles et ajouter les transitions réellement cliquables. **Aucune release v0.3 avant PASS.**

CHECKLIST relu. Le pilote doit synchroniser MC, mémoire et activité avec **REVISE/deux P2 ; intégration94 désormais PASS ; R1/R3/R4/R5 validés ; gate Dev → QM** avant l’annonce utilisateur. Cette revue ne constitue aucune autorisation de release.
