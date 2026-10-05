# QM — Sumatoni Time v0.3, round 11

Date : 2026-10-04 UTC. Revue indépendante après reprise d’un transport QM interrompu.

## Verdict : REVISE

**Les trois défauts du round 10B sont corrigés dans la matrice indépendante. Trois nouvelles régressions P2 sont confirmées. Aucun P0/P1 démontré ; pas de PASS global ni d’autorisation de release.**

## Boundary et isolation

- HEAD exact : `6588db95ecaf5117f01cda7e6a2f1b2a176640cc`, branche `codex/calendar-glpi-v0.3`.
- Preview : `/opt/sumatime-preview/releases/v0.3.0-round11-20261004`, BUILD_ID servi `6mcu15McCq0s0nF29Nss2`.
- Avant tests/build QM : `server.js` et bundle API GLPI identiques source/preview, 26/26 fichiers statiques, 8/8 fichiers public et 9/9 fichiers drizzle identiques. 47/48 fichiers `.next/server` identiques ; le seul fichier local supplémentaire est `interception-route-rewrite-manifest.js`, contenant une liste vide et absent du standalone servi.
- Services preview/mock actifs ; `/login` HTTP200 ; API GLPI anonyme HTTP401. Environnement effectif filtré du service : loopback `127.0.0.1:5174`, GLPI mock `127.0.0.1:8792`, base `/var/lib/sumatime-preview/timesheet.sqlite`, LDAP désactivé. Aucun credential affiché.
- Bases des tests sous `/dev/shm`, Next et fournisseur mock sur ports loopback temporaires. Les scénarios UI utilisent React/Radix réels sous jsdom et les vraies routes Next. Les tests serveur complémentaires utilisent un transport `fetch` synthétique.
- Aucun code applicatif, commit, service permanent, configuration production ou GLPI réel modifié. Seul ajout au dépôt : ce rapport. Les trois fichiers suivis préexistants modifiés (`next.config.ts`, `package.json`, `package-lock.json`) et les fichiers docs/deploy non suivis sont conservés.
- Le rebuild QM final a produit `QXRjCQ_E6TYPMlBkK5RjL` sans redéploiement. Les bundles API GLPI et page ainsi que les 24 fichiers statiques hors manifestes propres au BUILD_ID restent identiques à la preview.

## P2-1 — Le UUID d’un brouillon distinct abandonné redevient créateur ou alias

Sources : `lib/glpi.ts:297`, `lib/glpi.ts:304`, `lib/glpi.ts:308`, `lib/glpi.ts:315`, réservation `createGlpiTicket`.

`draftIntentForRequest` ne retourne désormais que les intentions non abandonnées et non consommées. Ce helper est également utilisé pour vérifier la présence d’une identité durable quand une soumission ne contient pas de capability. Les branches `intent.abandoned_at` et `intent.used_at` du contrôle sont donc devenues inaccessibles.

Reproduction serveur indépendante, SQLite neuve et transport synthétique :

1. Émettre une intention distincte pour un UUID de brouillon B.
2. Abandonner explicitement cette intention.
3. Rejouer B et son payload sans `distinct_intent`.

Résultat : **un nouveau `POST Ticket`**, ligne de création `state='completed'`, `distinct_intent_id=NULL`, alors que le tombstone d’intention abandonnée existe toujours. Avec une ancienne opération incertaine A de même empreinte, la variante crée plutôt un alias permanent B→A. Ce n’est pas une simple erreur d’affichage.

Attendu : séparer la sélection de la génération active du contrôle permanent d’identité du brouillon. Une intention abandonnée/consommée ne doit jamais disparaître de ce second contrôle, ni permettre une création ordinaire ou un alias silencieux. Une réservation durable existante doit rester rejouable selon son état exact ; une nouvelle intention explicite doit rester nécessaire quand elle est requise.

Reproduction : `node --import=tsx /tmp/sumatime-qm-r11-server-aD9LGz/audit.mjs`. Cas JSON `abandoned-draft-missing-capability` et `abandoned-draft-missing-capability-old-uncertain`. Le harness affirme la présence du défaut ; son exit0 n’est pas un PASS produit.

## P2-2 — Un résultat distinct déjà acquitté réapparaît à « Nouveau ticket »

Sources : `app/new-glpi-ticket.tsx:343`, `app/new-glpi-ticket.tsx:345`, `app/new-glpi-ticket.tsx:280`, `lib/glpi.ts:328`, `lib/glpi.ts:348`.

La nouvelle liste `distinctDrafts` contourne les filtres appliqués à `recoverable` : ni le cache des opérations explicitement consommées côté UI, ni l’échéance des résultats acquittés côté serveur ne sont appliqués à cette liste.

Reproduction indépendante réelle React→Next→mock :

1. Créer puis utiliser un ticket A.
2. Autoriser une demande distincte B, la créer puis cliquer « Utiliser ce ticket » : ACK confirmé.
3. Dans le même composant, cliquer « Nouveau ticket GLPI ».

Résultat : **« Ticket créé dans GLPI » et le ticket B déjà consommé reviennent immédiatement**, avec une nouvelle action « Utiliser ce ticket », au lieu du parcours de nouvelle demande. Exemple conservé : `GLPI-117`. Deux créations mock au total (A/B), pas de doublon fournisseur dans ce cas.

Variante serveur confirmée : après échéance explicite du résultat ACK, `recoverable=[]` exclut correctement ce ticket mais `distinctDrafts` le renvoie encore. Le résultat expiré n’est pas un brouillon actif.

Attendu : mêmes états et mêmes règles de récupération dans toutes les projections. L’ACK perdu doit rester récupérable de manière idempotente, sans faire revenir une consommation déjà confirmée à chaque action « Nouveau », et sans réintroduire les résultats expirés dans la liste des brouillons.

Preuve : `/tmp/sumatime-qm-round11-extra-H7uPAM/ack-distinct-ttl-minus1-issue.json`, `matrix-results.json`. Variante TTL : `audit.mjs`, cas `acknowledged-result-after-explicit-expiry`.

## P2-3 — Un refus certain d’une demande distincte est réinterprété comme résultat incertain

Sources : `lib/glpi.ts:343`, `lib/glpi.ts:542`, `app/new-glpi-ticket.tsx:269`, `app/new-glpi-ticket.tsx:283`.

La projection des brouillons liés à une opération ne transmet pas son état terminal. `beginGlpiDistinctCreation` classe toute opération liée sans ticket et non `uncertain` comme `reserved`, y compris une ligne `state='rejected'`.

Reproduction indépendante réelle React→Next→mock :

1. Créer/consommer A, puis autoriser B distinct.
2. Soumettre B avec le titre de fixture `REJECT-CREATE` : le vrai mock refuse le POST ; Next renvoie **`CREATION_REJECTED`, `terminal=true`**.
3. Ouvrir une nouvelle instance Node/jsdom/React sans mémoire du composant précédent.

Résultat : l’UI affiche **« Résultat incertain »**, verrouille les champs et propose « Récupérer le résultat » pour le UUID dont le refus est pourtant certain. Reproduit avant, à et après l’échéance de capability (TTL−1/TTL/TTL+1). La base conserve correctement `state='rejected'` ; c’est sa projection/récupération qui ment.

Une variante serveur avec un client non mappé confirme le même défaut sans appel fournisseur : `beginGlpiDistinctCreation(B)` renvoie `state='reserved'`.

Attendu : conserver l’état terminal à travers la lecture des brouillons, le renouvellement et l’UI. Un refus certain ne doit pas être transformé en opération réservée/incertaine. La correction du formulaire doit suivre le contrat de nouvelle identité autorisée, sans effacer le tombstone de l’ancien UUID ni le reposter.

Preuves : `/tmp/sumatime-qm-round11-terminal-OvG7xj/terminal-refusal-ttl-*-issue.json`, fichiers `*-resume.json`, `matrix-results.json` ; `audit.mjs`, cas `rejected-operation-resurrected-as-reserved`.

## Défauts round 10B : contre-preuve indépendante

Le harness round10B a été repris sans changer ses assertions pour la première matrice. Serveur et workers partagent une horloge contrôlée ; les timers réseau et React restent réels. Chaque remount est un nouveau processus UI. Aucun snapshot d’expiration SQLite n’est trafiqué.

| Ancien défaut / cas | TTL−1 ms | TTL exact | TTL+1 ms |
|---|---|---|---|
| Stockage indisponible dès l’émission puis nouvelle page | PASS | PASS | PASS |
| Stockage disponible puis perdu à la nouvelle page | PASS | PASS | PASS |
| Réponse perdue après réservation terminée puis nouvelle page | PASS | PASS | PASS |
| Deux renouvellements au même instant, puis deux workers UI | PASS | PASS | PASS |

Première matrice : **12/12**, 144,212 s, 22 POST mock, zéro session finale, intégrité `ok`, FK0. Les deux variantes stockage à TTL−1 du harness historique vérifiaient la récupération mais ne soumettaient pas ; une matrice complémentaire soumet réellement le brouillon sans stockage à TTL−1/TTL/TTL+1 et confirme **un seul nouveau POST par B**, UUID conservé.

Matrice complémentaire : 8 cas, 7 PASS/1 REVISE (P2-2), 55,827 s, 16 POST mock. Elle inclut soumissions same-page aux trois bornes, stockage indisponible aux trois bornes, création distincte depuis un résultat non consommé et consommation ACK. Matrice terminale : 3 REVISE (P2-3), 18,904 s, 6 POST mock dont trois refus certains ; **ne pas assimiler le nombre de POST au nombre de tickets acceptés**.

Toutes ces matrices conservent intégrité `ok`, FK0, sessions finales0 et aucun alias B→A dans les scénarios corrigés. Leurs orchestrateurs collectent les cas puis sortent0 : seuls les verdicts JSON/assertions font foi.

## Autres contrôles exécutés

- `node --import=tsx --test tests/*.test.mjs` : **46/46 PASS**, 8,066 s, incluant undo/caller, focus réel React DOM, DST, namespace membre, réponses tardives, erreurs 401/409, stockage, ACK, alias, tombstones et migrations.
- API isolée : **198 assertions PASS**, 3,226 s.
- Provider isolé : **175 assertions PASS**, 45,982 s ; quatre POST Ticket attendus, sessions finales0, identité personnelle mock vérifiée.
- Intégration round9 : **PASS**, 10,925 s, config409 et distinct401/remount, deux POST mock.
- Intégration round10 : **PASS**, 11,856 s, frontières, stockage, auth et renouvellement.
- Sous-revue indépendante migrations/serveur : six tests officiels ciblés PASS ; migration pré-round11, DDL portable, réouverture idempotente, génération unique, isolation membre/API, historiques118/119 indépendants, ACK et replay au-delà du TTL sans nouveau POST vérifiés.
- TypeScript `--noEmit --incremental false` : PASS, 8,877 s.
- Lint des fichiers applicatifs modifiés depuis `087da9e` : PASS, 6,286 s. Lint global : **FAIL, deux erreurs/trois warnings préexistants**, dans `app/login/page.tsx`, `components/client-color.tsx`, `app/account-panel.tsx`.
- Build webpack standalone : PASS, 55,325 s, sans déploiement.
- Sauvegarde par le vrai `scripts/backup.mjs` de la base QA : intégrité `ok`, FK0, 22 créations,22 alias,18 intentions, colonnes payload/génération et index unique présents. Clé GLPI synthétique sauvegardée à côté.
- `git diff --check` : PASS avant ce rapport ; HEAD inchangé. Preview et mock permanents toujours actifs, aucun redémarrage QM.

### Échec conservé : suite d’intégration R2 globale

`node --import=tsx tests/glpi-r2-integration.mjs` échoue à la ligne302 : **1 POST observé au lieu de 2** pour la demande explicitement distincte. Une seconde exécution d’une copie externe ajoutant uniquement du diagnostic reproduit le même échec. L’UI rapporte « L’état de cette demande ne peut pas être vérifié de façon sûre » ; le second `createTicket` n’est pas envoyé.

Une variante indépendante qui laisse le polling se stabiliser traverse ce parcours avec succès. Donc **pas de quatrième défaut métier permanent affirmé sur cette seule preuve** : la synchronisation de ce scénario doit être comprise, et le harness doit attendre des conditions d’interactivité réelles plutôt que forcer la soumission d’un formulaire encore bloqué. L’échec officiel reste un gate rouge ; les assertions ultérieures de cette suite (dont certains scénarios crash/concurrence bout-en-bout) ne sont pas revendiquées PASS dans ce round.

Logs : `official-r2.log` et `diagnostic-r2.log` dans `/tmp/sumatime-qm-round11-K6fdel/`. La copie diagnostic ne modifie pas le dépôt et n’assouplit aucune assertion.

## Artefacts et reproduction

- Dossier principal : `/tmp/sumatime-qm-round11-K6fdel/` (logs, résumés d’exécution, première matrice).
- Compléments UI : `/tmp/sumatime-qm-round11-extra-H7uPAM/` et `/tmp/sumatime-qm-round11-terminal-OvG7xj/`.
- Sous-revue serveur/migrations : `/tmp/sumatime-qm-r11-server-aD9LGz/audit.mjs`, `migrations.mjs`.
- Sauvegarde QA : `/dev/shm/sumatime-qm-round11-0JLNaK/backups/timesheet-2026-10-04T10-20-29.040Z.sqlite`.

Depuis le dépôt, créer un dossier temporaire neuf puis :

```text
QM_OUTPUT_DIR=<dossier-neuf> QM_VARIANTS=storage-from-issuance,storage-lost-at-remount,reserved-response-lost,simultaneous-renewals node /tmp/sumatime-qm-r10b-QwUjdU/matrix.mjs
QM_OUTPUT_DIR=<dossier-neuf> QM_VARIANTS=ack-distinct,storage-from-issuance,same-page-boundary node /tmp/sumatime-qm-round11-K6fdel/matrix-extra.mjs
QM_OUTPUT_DIR=<dossier-neuf> QM_VARIANTS=terminal-refusal node /tmp/sumatime-qm-round11-K6fdel/matrix-extra.mjs
node --import=tsx /tmp/sumatime-qm-r11-server-aD9LGz/audit.mjs
node --import=tsx /tmp/sumatime-qm-r11-server-aD9LGz/migrations.mjs
```

Attention documentaire : le `boundary.json` du harness historique contient un HEAD round10 **codé en dur**. Le run round11 a bien chargé les sources courantes et le standalone BUILD_ID `6mcu15McCq0s0nF29Nss2`, vérifiés indépendamment avant exécution. Le harness complémentaire corrige ce champ en `6588db9…`. Ne pas utiliser le champ historique isolé comme provenance.

Limites : aucun Chromium/geste tactile natif/lecteur d’écran ; jsdom réel n’est pas une recette navigateur exhaustive. Aucun test de charge infrastructure. Des appels outils ont subi la latence filesystem connue ; aucun échec fonctionnel n’a été masqué en modifiant des assertions ou des timeouts. Les processus QA ont tous été arrêtés ; les bases synthétiques restent disponibles, sans nettoyage destructif.

CHECKLIST relu. Le pilote doit synchroniser Mission Control/mémoire/activité sur **REVISE round11 : anciens trois P2 fermés, trois nouvelles régressions et suite R2 globale rouge**, puis faire corriger et relire cette boundary. Ce rapport n’écrit pas les registres de coordination et ne vaut pas autorisation de production.
