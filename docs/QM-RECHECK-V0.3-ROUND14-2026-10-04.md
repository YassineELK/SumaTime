# QM — Sumatoni Time v0.3, Round 14

Date : 2026-10-04 UTC. Revue indépendante du commit `db8a71d`, après les deux P2 du Round 13.

## Verdict : PASS

**Les deux P2 Round 13 sont corrigés et les contre-tests indépendants passent. Aucun P0/P1/P2 causal confirmé dans le périmètre revu, aucun doublon fournisseur démontré.** Le PASS porte sur le code et l’artefact testés, en environnement isolé mock-only ; ce rapport n’effectue ni n’autorise implicitement un déploiement production ou un accès GLPI réel.

La dette lint préexistante et les limites des tests développeur restent documentées ci-dessous. La preview développeur `5187/8897` était arrêtée ; elle n’a pas été présentée comme active. Une instance QA du rebuild a été démarrée, contrôlée puis arrêtée volontairement.

## Frontière et changements réellement revus

- Dépôt `/srv/projects/applications/timesheet`, branche `codex/calendar-glpi-v0.3`.
- HEAD exact `db8a71dab7ad88f826794d80c20ad3176b7d360d`, parent exact `9682134d285f1106abd94043b922d7c21af31ced`, recontrôlés en fin de revue.
- Diff réel : sept fichiers, 715 insertions / 54 suppressions. Sources : `lib/glpi-draft.ts`, `lib/glpi.ts`. Tests : `glpi-r2-dom`, `glpi-r2-integration`, `glpi-round14-authority`, `glpi-round14-dom`, `glpi-round14-integration`.
- Callers inspectés : `app/new-glpi-ticket.tsx`, `app/api/glpi/route.ts`, les consommateurs `onCreated`, réservation et migration `db/raw.ts`. Lecture complète des exigences R1–R7 et du rapport Round 13 ; sous-revue indépendante des autorités serveur/migration.
- Dirty préexistant préservé : `next.config.ts`, `package.json`, `package-lock.json`, quatre fichiers preview/deploy non suivis, documents évolution/exigences/revues antérieures non suivis. Aucun source applicatif ni test officiel édité par QM, aucun commit. Seul ajout durable au dépôt : ce rapport ; rebuild limité aux artefacts ignorés `.next`.
- Bases QA en `/dev/shm`, artefacts et harnesses temporaires sous `/tmp`, ports dynamiques exclusivement `127.0.0.1`, LDAP désactivé, GLPI mock uniquement. Aucun service permanent, aucune base production, aucun vrai fournisseur touché.

## P2-1 Round 13 — ACK non durable : corrigé

Sources : `lib/glpi-draft.ts:64`, `:337`, `:357` ; caller `app/new-glpi-ticket.tsx:936`.

L’autorité ACK navigateur est désormais uniquement `localStorage`. Une erreur quota, indisponibilité ou corruption empêche la consommation finale : le callback n’est pas appelé et le pending n’est pas retiré. Le serveur peut avoir confirmé l’ACK avant cette erreur locale ; son replay exact reste donc nécessaire et conservé.

### Matrice indépendante : 33 scénarios ACK PASS

Les vrais composants React/Radix s’exécutent sous JSDOM ; toutes leurs requêtes traversent les vraies routes Next, SQLite et le mock HTTP. Émission, reprise et troisième ouverture utilisent **trois processus Node distincts**, avec snapshot du seul stockage réellement durable ; le `sessionStorage` de l’ancien processus n’est jamais transféré.

- **24 cas** : ACK confirmé et ACK dont la réponse HTTP est perdue, timestamps A/B égaux et distincts ; quota local avec sessionStorage disponible, puis sessionStorage inaccessible ; ACK store corrompu. Chaque variante est exécutée à capability TTL−1, TTL exact et TTL+1.
- **6 cas** : `localStorage` totalement inaccessible à l’ACK, avec `sessionStorage` disponible ou inaccessible, aux trois bornes TTL.
- **3 cas longs** : quota ACK et réponse ACK perdue après plus de sept jours ; deux ACK consommés après plus de 31 jours.
- Chaque scénario crée A puis un B explicitement distinct de même empreinte métier. A/B gardent leurs UUID et résultats séparés. Exactement deux POST Ticket mock par scénario, **aucun POST fournisseur supplémentaire pendant la reprise**.
- Quota local : seul `window.localStorage` est remplacé par un wrapper ; `sessionStorage` reste l’objet original inscriptible. Une écriture témoin confirme cette disponibilité. Ce n’est pas un patch du prototype commun aux deux stockages.
- ACK local non durable : callback B=0, UUID/payload B toujours conservés, aucun marqueur session accepté comme autorité. Après nouvelle session et retour d’un stockage durable valide, l’action réelle « Récupérer le résultat » restitue B, puis « Utiliser ce ticket » donne callback B=1.
- Les 24 replays HTTP de création utilisés comme récupération ont été comparés champ par champ au payload canonique et à l’objet ticket originaux. Les reprises après sept jours utilisent la projection serveur puisque le pending local a expiré ; elles restituent le ticket B attendu et n’envoient aucun POST Ticket.
- Une **troisième ouverture froide** vérifie, dans les 33 cas, un formulaire neuf, aucun bouton de consommation d’un ancien résultat et aucun callback automatique. Les ACK durables A/B ne réapparaissent pas.
- Toutes les bases : intégrité `ok`, FK `[]`, sessions fournisseur finales 0.

**Limite précise du cas corruption :** tant que le contenu ACK demeure invalide, le système reste volontairement fail-closed, y compris après page froide. Pour tester la reprise une fois le stockage réparé, le harness restaure explicitement le snapshot ACK précédemment valide avant le dernier clic. Aucun mécanisme de réparation automatique ou bouton UI de purge du stockage corrompu n’est revendiqué. La récupération exacte du ticket reste disponible avant cette réparation ; le callback final reste interdit.

Preuves : `/tmp/sumatime-qm-round14-EsoU3b/summary.json`, `ack-matrix/`, `ack-unavailable/`, `ack-age7-quota-final/`, `ack-age7-loss-final/`, `ack-age31/`. Les fichiers `*-issue.json`, `*-resume.json`, `*-confirm.json` contiennent requêtes, snapshots, callbacks et états UI.

## P2-2 Round 13 — Plusieurs tombstones génération zéro : corrigé

Sources : `lib/glpi.ts:321`, `:403`, `:703`.

La sélection privilégie une autorité active, puis la réservation exacte. Les groupes purement inactifs sans réservation ne sont plus projetés comme brouillons. Un tombstone reste une interdiction permanente pour son UUID ; son nombre ne bloque plus les identités indépendantes du membre/API. Aucun ordre lexical de capability n’est utilisé comme chronologie.

### Historique authentique : 8/8 PASS

Vrais `db/raw.ts` et `lib/glpi.ts` Round10 `d124e1c`, vérifiés contre Git, puis fermeture de base et migration par le vrai HEAD. Pas d’insertion SQL de tombstone pour fabriquer ces histoires. Le temps et, pour les permutations adversariales, le générateur des capabilities sont contrôlés.

Quatre formes : deux intentions aléatoires à dates distinctes ; trois intentions aux mêmes dates avec IDs `f…/8…/1…` ; ordre inverse `1…/8…/f…` ; trois intentions aux dates distinctes et IDs inversés. Deux cycles par forme :

1. Renouvellements Round10, rattachement du payload puis abandon réel HEAD : 2–3 tombstones génération zéro permanents. `begin`, création sans capability, ancienne et dernière capability refusent l’UUID en `409 INTENT_ABANDONED`, terminal=true, à J0 et J366. Pas d’alias ni de nouveau POST. Un autre UUID Alice/API A et les scopes Bob/API A et Alice/API B restent sains.
2. Même migration, réservation réelle par le runtime Round11 : HEAD restitue exactement le ticket lié avec/sans capability et via `begin`, à J0 et J366. L’ancienne capability reste refusée. ACK retire la projection brouillon sans détruire l’identité de replay.

Total : huit POST synthétiques initiaux, aucun replay fournisseur, sessions finales 0. Huit bases intègres, FK vides, migrations idempotentes à réouverture.

### Confirmation réelle HTTP et UI : 4/4 PASS

Les quatre histoires abandonnées sont réattribuées à quatre comptes QA créés via API ; seuls membre/API/client et un nibble des capabilities sont remappés pour éviter la collision entre bases d’origine, sans changer leur ordre, leurs dates ou leurs états.

- GET `/api/glpi?uncertain=1` et `?uncertain=1&recover=1` : **200**, `blocked=false` dans les quatre cas.
- Le vrai formulaire React reste actif ; soumission d’un autre UUID, puis ACK réel avec callback=1.
- Tickets mock 114, 115, 116, 117 : exactement **quatre POST Ticket** ; récupération de chaque opération correcte.
- Création et begin de l’ancien UUID : toujours `409 INTENT_ABANDONED`, aucun POST additionnel ; tombstones inchangés champ par champ.
- Intégrité `ok`, FK `[]`, sessions finales 0 ; instances temporaires arrêtées.

Preuves : `/tmp/sumatime-qm-r14-server-c1Nppd/REPORT.md`, `authentic-matrix.mjs`, `authentic-database-proof.log`, `http-history.mjs`, `http-history-results.log`. Bases authentiques `/dev/shm/qm-r14-authentic-mNHSee/` ; base HTTP `/dev/shm/qm-r14-http-history-exnFFe/fixture.sqlite`.

## Régressions et risques examinés

- **30 scénarios indépendants PASS**, trois bornes TTL chacun : stockage absent dès l’émission distincte, stockage perdu au remount, réponse création perdue, renouvellements simultanés depuis deux processus, soumission à la borne exacte, refus terminal froid, perte d’authentification, draft persisté, édition après polling réel de 2,6 s, nouvelle intention depuis résultat non consommé. Total 60 appels POST Ticket attendus, dont les refus certains ; aucun doublon d’une même opération.
- **16 tests serveur/migration ciblés PASS**, inclus également dans la suite complète : Round11/12/13/14, migrations anciennes, tickets historiques **118/119**, ACK exact et frontières ISO. Audits complémentaires scopes membre/API, génération unique à expiry, replay après 31/366 jours, rejet terminal durable, correction explicite atomique, rollback de correction invalide, tombstone consommé sans réservation refusé.
- Alice → Bob → Alice et réponses tardives : vrais chemins React/Next de R2 ; aucune présentation des champs privés d’Alice à Bob. ACK/capabilities membre/API-scopés également vérifiés côté fonctions et DOM.
- Anciennes régressions majeures : undo avec version courante et vrai conflit 409 via API ; deux ajustements clavier successifs avec focus conservé après reload parent tardif via DOM ; DST sur l’intervalle mesuré avant/traversant/après transition ; contrôle fonctionnel strict du changement d’entité fournisseur. Toutes les suites correspondantes passent.
- Hypothèse de plusieurs intents consommés vers des réservations historiquement supprimées : **pas de défaut causal démontré**. L’historique Git montre que l’introduction des intents Round6 supprime simultanément les DELETE de créations ; aucun DELETE/DROP/REPLACE ultérieur dans les neuf versions Round6–14. Une corruption SQL externe pourrait toujours créer des références ambiguës, mais ce n’est pas une migration valide reproduite et ce n’est pas présenté comme un P2.

Les 33 scénarios ACK et 30 autres parcours forment la matrice principale **63/63 PASS** ; les 8 histoires serveur et 4 parcours HTTP sont des preuves complémentaires, pas des tests confondus avec ce compte.

## Gates standard

- `node --import=tsx --test tests/*.test.mjs` : **59/59 PASS**, 12,019 s ; unités/DOM/migrations Round9–14 inclus.
- R2 officielle du HEAD exécutée **telle quelle, sans édition QM** : **101 assertions PASS**, 41,104 s, 12 POST principaux mock.
- Intégration Round14 : **26 assertions PASS**, 9,505 s, deux POST mock et redémarrage réel du processus Next entre ACK quota et récupération.
- Intégration Round9 : PASS, 11,540 s. Round10 : PASS, 11,901 s.
- API : **198 assertions PASS**, 6,845 s. Provider : **175 assertions PASS**, 30,374 s, quatre POST attendus, sessions finales 0. Exécutions séquentielles sur leur port partagé.
- TypeScript `--noEmit --incremental false` : PASS. ESLint des sept fichiers touchés : PASS. `git diff --check` et diff commit-à-commit : PASS.
- Build webpack standalone : **PASS**, 238,600 s ; collecte des traces lente, sans timeout ni rerun du build.
- Lint global : **FAIL préexistant**, deux erreurs / trois warnings dans `app/login/page.tsx`, `components/client-color.tsx`, `app/account-panel.tsx`. Aucun diff Round14 de ces fichiers, aucune désactivation de règle ajoutée.
- Vrai `scripts/backup.mjs` : intégrité source/backup `ok`, FK `[]`, comptes des **13 tables identiques**, dont six créations/sept aliases ; clé GLPI synthétique identique. Backup final : `/dev/shm/sumatime-qm14-gates-kVXOK3/backups/timesheet-2026-10-04T13-53-14.772Z.sqlite`.

Logs, commandes exactes et statuts : `/tmp/sumatime-qm14-gates-rtvstI/`, notamment `run-gates.mjs`, `gates-results.json`, `static-results.json`, `unit.log`, `r2-official.log`, `provider.log`, `proof.json`.

## Provenance et santé de l’artefact

- Snapshot initial stable utilisé par les matrices : `/tmp/sumatime-qm14-gates-rtvstI/standalone-initial/server.js`, BUILD_ID **`eLPP7fMoJJ--eVXZNTCJj`**. Ce n’est pas une affirmation de disponibilité de l’ancienne preview.
- Rebuild QM : BUILD_ID **`lTfMnVUi8D1IDYmJzO97-`**. Sources/configs hachées avant/après, inchangées ; suites standard HTTP exécutées après ce rebuild.
- Hashes initiaux/rebuild identiques : `server.js` = `0c4a8c7f407465f22a8fbab69c8d17994593e7fc036f412c63e3e905910d86d2` ; route GLPI = `61a011bff7b9e4eb03c3fafdc4dc61731061e5186b5de84c648a5d734b55a6c9` ; page = `646c337976849eaefe7e6d32591739d516428b3dff127e6f4241f331a9d8f717` ; route auth également identique.
- Artefact QA reconstruit : 26/26 statiques conformes au build, public 8/8 et drizzle 9/9 conformes ; BUILD_ID de l’instance identique au rebuild.
- Smoke temporaire réel : application `127.0.0.1:36715`, mock `127.0.0.1:36487` ; `/login` **200**, API GLPI anonyme **401**, mock `initSession` **200**, sessions mock finales 0. Les huit CSS/JS annoncés par le login sont téléchargés en 200 et leurs octets correspondent aux hashes du build. Base QA intègre/FK vides après initialisation explicite.
- Cette instance QA a été **arrêtée proprement après validation**. Les ports développeur `5187/8897` n’ont pas été réactivés. Pas de preview permanente actuelle déclarée validée, pas de déploiement.

## P3, premières passes et limites

1. **P3 — précision des tests développeur.** Les nouveaux tests Round14 modifient `Storage.prototype.setItem` sans filtrer `this` ; sous JSDOM, cela bloque aussi l’ACK dans sessionStorage. Ils ne prouvent donc pas à eux seuls le différentiel quota local / session writable. La matrice indépendante ci-dessus comble cette lacune. R2 conserve ses assertions de compte fournisseur/UUID/scopes, mais ses fixtures ont été rétrécies : corruption épargnant les ACK, stockage « disabled » devenu read-only après ouverture, localStorage conservé dans le scénario multi-tab. Le PASS R2 n’est pas présenté comme une couverture inchangée de toutes les indisponibilités ; les compléments indépendants couvrent ces variantes. Recommandation non bloquante : pérenniser ces contre-tests dans le dépôt.
2. **P3 — dette lint préexistante**, inventoriée séparément ; aucun ajout de dette dans les fichiers touchés.
3. Premier harness ACK >7 jours : le premier scénario quota passe, puis le nettoyage temporel a expiré la session administrateur utilisée pour créer le compte suivant ; HTTP 401 de fixture. Log `ack-age7.log` conservé. Reprises dans deux bases fraîches séparées : quota et ACK perdu PASS, intégrité/FK/sessions vérifiées. Pas de changement applicatif ni assertion retirée.
4. Premières passes serveur conservées : checker d’archive trop strict sur newline/import ; ancienne sélection lexicale Round10 lors d’une réservation à dates égales ; collision de PK entre histoires importées depuis plusieurs bases. Vérification d’archive corrigée, réservation authentique faite après migration avec Round11, identifiants de fixture remappés sans changer leur ordre. Matrices finales 8/8 et 4/4.
5. Premières passes provenance : chemin complémentaire `drizzle/drizzle` dans la copie temporaire, puis tentative d’inspecter une base santé non encore créée par les seules routes anonymes. Logs `proof-initial-failure.log` et `proof-lazy-db-failure.log` conservés. Correction du lecteur de fixture puis initialisation par GET auth ; troisième passe complète PASS. Toutes les instances des passes précédentes fermées en `finally`.
6. Pas de Chromium, geste tactile natif, lecteur d’écran ou charge multiutilisateur exhaustive. JSDOM exécute les composants et événements réels, mais n’est pas une certification navigateur graphique. La réparation automatique d’un ACK store corrompu n’est pas revendiquée ; les pertes/corruptions arbitraires de toute donnée durable ne sont pas assimilées à une consommation confirmée normale.

## Reproduction et transmission

Depuis le dépôt, avec un dossier de sortie neuf existant :

```text
QM_SERVER_PATH=/tmp/sumatime-qm14-gates-rtvstI/standalone-initial/server.js QM_OUTPUT_DIR=<sortie-neuve> QM_VARIANTS=ack-quota-cold,ack-quota-cold-notie,ack-quota-session-off-notie node /tmp/sumatime-qm-round14-EsoU3b/matrix-cold-ack.mjs
node --import=tsx /tmp/sumatime-qm-r14-server-c1Nppd/authentic-matrix.mjs
node --import=tsx /tmp/sumatime-qm-r14-server-c1Nppd/http-history.mjs
node /tmp/sumatime-qm-round14-EsoU3b/summarize.mjs
```

Les harnesses de matrice consignent des verdicts métier dans `matrix-results.json` ; contrôler ce fichier, pas seulement l’exit code. Les bases et artefacts sont temporaires et leur disponibilité ne constitue pas un engagement de service preview.

Skill **Application Release Review** appliqué : frontières isolées, scénarios adversariaux, vraie chaîne API/fournisseur, preuve d’artefact, distinction entre PASS fonctionnel et dette/limites. **CHECKLIST.md relu avant verdict.** Le mandat limite les écritures durables à ce rapport : MC, mémoire et activité ne sont pas modifiés par cette sous-revue. Le pilote doit les synchroniser sur **QM Round14 PASS, commit db8a71d, deux P2 clos, QA temporaire validée puis arrêtée, aucun déploiement ni GLPI réel**, avec prochaine étape de livraison explicitement distincte, avant annonce finale à Master.
