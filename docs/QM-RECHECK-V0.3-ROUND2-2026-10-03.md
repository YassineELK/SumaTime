# Sumatoni Time v0.3 — contre-revue QM indépendante, round 2

Date : 2026-10-03. Branche : `codex/calendar-glpi-v0.3`.
HEAD revu : `d5412316cfee4c20506f13d0db9d0d24637c9f07`.
Verdict : **REVISE — release et production interdites à cette gate**.
Quatre défauts P2 confirmés ; aucun P0/P1 démontré.

## P2-1 / R2 — perte silencieuse de persistance, doublon réel après remontage

`lib/glpi-draft.ts:67-75` ignore silencieusement stockage absent, exception `setItem` et dépassement de taille. `app/new-glpi-ticket.tsx:131-134` envoie quand même. L'UI affirme ensuite que l'UUID et le payload restent conservés.

Reproduction exécutée sur vraie UI React/DOM → vraie API Next isolée → GLPI mock HTTP :

1. Faire lever `QuotaExceededError` à `localStorage.setItem`.
2. Envoyer une demande ; attendre que l'API et GLPI aient effectivement créé le ticket, puis perdre seulement la réponse navigateur.
3. Démonter/remonter le créateur. Aucune récupération n'est proposée.
4. Ressaisir les mêmes champs métier et envoyer.

Résultat : **deux UUID, deux vrais `POST Ticket`**, deux tickets acceptés pour la même demande métier. Le serveur déduplique correctement un UUID conservé ; l'identité est perdue avant sa récupération.

Autres limites exécutées : quatre descriptions valides contenant chacune 4 000 guillemets dépassent le plafond JSON ; la quatrième sauvegarde est silencieusement ignorée. Une cinquième petite demande évince la plus ancienne, même incertaine. Le stockage corrompu est interprété comme vide, sans diagnostic ni récupération.

## P2-2 / R2 — divulgation du brouillon entre membres

La clé `sumatoni-glpi-uncertain-v1` est globale à l'origine (`lib/glpi-draft.ts:19`). Aucun membre ni contexte GLPI n'est associé au brouillon ; sélection par client/description uniquement (`:78-86`). Le composant ne reçoit pas d'identité membre et la déconnexion ne partitionne/purge pas ces données.

Reproduction exécutée avec deux comptes réellement authentifiés : Alice laisse une demande incertaine, puis Bob ouvre le créateur dans le même stockage navigateur. **Le titre et la description privés d'Alice sont visibles chez Bob.** Une seconde preuve monte le vrai `GlpiPanel` avec `data.me.id='bob'` et constate la même divulgation.

La tentative de récupération de Bob est correctement refusée HTTP 409 par le serveur ; zéro `POST Ticket` supplémentaire. Cette protection serveur n'empêche pas la divulgation locale.

## P2-3 / R2 — deux créateurs déjà montés ne se synchronisent pas

`app/new-glpi-ticket.tsx:36-50` lit le stockage seulement au premier montage. `openNew` (`:87`) ne le relit pas. Aucun abonnement aux changements de stockage ni coordination inter-composants.

Reproduction exécutée avec deux vrais créateurs React déjà montés : création incertaine dans le second, fermeture, ouverture du premier et même saisie. **Deux UUID, deux vrais `POST Ticket`**, bien que la première identité soit présente dans localStorage.

Ce chemin est pertinent : `GlpiPanel` et `QuickEntry` peuvent coexister dans `Workspace`, chacun contenant son créateur. Le même risque existe pour un onglet navigateur déjà ouvert ; la preuve multi-onglets natifs n'a pas été exécutée.

## P2-4 / R4 — fallback absent hors semaine, puis focus fantôme

`app/time-calendar.tsx:93-99` ne recherche un fallback que sur le jour cible. Si ce jour n'est plus affiché, aucun fallback n'est focalisé et la cible pendante n'est pas purgée.

Deux reproductions dans un vrai React DOM/jsdom :

- Lundi 2026-09-28, poignée move, `ArrowLeft` : déplacement sauvegardé vers dimanche 2026-09-27, hors semaine visible ; focus final sur `BODY`, aucun fallback accessible.
- Début de sauvegarde sur poignée end, navigation vers semaine précédente pendant la requête, puis retour : la cible périmée vole le focus au bouton de navigation et refocalise l'ancienne poignée.

Confirmation ciblée : **2 tests, 2 échecs**, assertions conservées. C'est une même cause, deux effets. Les cas supprimé/facturé dans la semaine ont bien un fallback ; le cas hors semaine reste ouvert.

## Corrections effectivement validées

### R1 — annulation

Le caller utilise maintenant `restoreEntryPayload`, qui sérialise `HH:MM` et n'envoie que action/id/version/date/start/end. Appel de ce payload à la vraie API : HTTP 200, bornes `06:07–07:22` restaurées exactement, version incrémentée. Sept champs métier (`client_id`, `member_id`, `ticket`, `description`, `on_site`, `hourly_rate_cents`, `billed`) préservés. Modification concurrente réelle puis ancienne version : HTTP 409, modification concurrente conservée.

### R2 — cas nominal seulement

Perte de réponse après acceptation réelle, fermeture/réouverture, démontage/remontage et recréation d'une racine sans mémoire React : même UUID et payload canonique ; **un seul `POST Ticket`** après récupération. Même UUID avec payload modifié : 409 sans création. Champs incertains verrouillés ; nouvelle demande distincte explicite crée un autre UUID sans modifier l'ancien payload.

La recréation de racine à partir du stockage sérialisé modélise le reload de page ; ce n'est pas un rechargement instrumenté dans Chromium. Le test officiel `tests/glpi-dom.test.mjs` simule toute l'API et ne prouve pas seul le compteur fournisseur ; notre preuve intégrée utilise réellement l'API et le serveur mock.

### R3 — entité GLPI

Le contrôle strict `selected !== true` reste présent. La suite provider couvre vrai succès, false, HTTP et JSON malformé ; réservation retirée avant envoi interdit, sessions fermées. Pas de nouvelle régression identifiée.

### R4 — ancien défaut de reload tardif

Test officiel React DOM : PASS. Challenges indépendants passants : `start`, `end`, `move`, chacun avec deux sauvegardes clavier successives et reload parent tardif ; erreurs HTTP 503/réseau ; conflit mock 409 avec version réellement incrémentée ; disparition de l'entrée et facturation supprimant les poignées. Dans les cas dans la semaine visible, même poignée ou fallback accessible correct.

### R5 — DST

Matrice indépendante : **29 assertions PASS**. Printemps et automne, endpoint exact et −1 ms acceptés ; endpoint +1 ms et début −1 ms traversant la transition refusés ; débuts exact/+1 ms après transition acceptés ; cas avant/après/traversée ; minuit exact ±1 ms ; durées normales.

À la borne de printemps, 20 minutes mesurées proposent `01:30–02:00` (30 minutes arrondies), pas 90. À l'automne, `02:30–03:00` (30 minutes), pas 15. Minuit garde un seul segment à la borne exacte, deux après +1 ms. Les bornes restent éditables dans `TimerReview` (`app/workday-panel.tsx:24-31`).

## Contrôles exécutés

- `node --import=tsx --test tests/*.test.mjs` : **23/23 PASS**.
- `node tests/run-api.mjs` : **198 assertions PASS**, SQLite isolée.
- `node tests/run-provider.mjs` : **156 assertions PASS** ; **4 `POST Ticket`**, dont 3 créations acceptées et 1 refus explicite ; sessions fermées.
- Intégration indépendante UI/API/mock : **6 `POST Ticket`** au total (1 nominal, 2 doublons quota, 1 Alice, 2 doublons créateurs coexistants), 0 session ouverte ; aucun fournisseur réel.
- `npx tsc --noEmit` : PASS.
- Build standalone : **PASS au retry**, exit 0. Premier essai borné à 180 secondes, **timeout exit 124** après webpack réussi (10,6 s), pendant TypeScript. Retry borné à 420 secondes : webpack 18,2 s, TypeScript 2 minutes, génération et traces terminées.
- Lint global : **FAIL, 7 erreurs / 6 warnings**.
- Lint ciblé des **25 fichiers TypeScript/TSX/MJS modifiés depuis `087da9e`** : **FAIL, 5 erreurs / 3 warnings**, tous dans `app/workspace.tsx` ; les 24 autres fichiers sont sans diagnostics.
- Comparaison ESLint sur les blobs `087da9e`, `4e97738`, `d541231` de workspace : diagnostics exactement identiques (lignes 52, 90, 96, 105, 126, 132, 195). **Aucune régression lint**, mais R6 exige zéro erreur dans les fichiers modifiés : critère strict non satisfait. Ne pas annoncer « lint ciblé PASS ».
- `git diff --check` et `git diff --check 4e97738..HEAD` : PASS.
- SQLite : `integrity_check=ok`, `foreign_key_check=[]` sur la base intégration, bases QA contrôlées et preview en lecture seule.

## P3 / limites nouvelles, sans surclasser les preuves

- TTL 7 jours : masque les données expirées mais ne purge pas leur texte de localStorage ; la récupération remet `savedAt` à maintenant.
- Limite « 32 KB » vérifie des caractères, pas des octets : 4 descriptions CJK acceptées donnent 48 766 octets UTF-8 / 33 532 octets UTF-16.
- StrictMode développement : cleanup annule la microtask de restauration et `restored.current` empêche le second setup ; demande conservée mais récupération non proposée. Non démontré dans le runtime production.
- Aucun secret d'authentification n'est persisté par les callers normaux examinés. Le texte métier l'est en clair (voir P2-2). Un objet synthétique étendu garde des propriétés `token/password`, faute d'allowlist ; **pas de fuite de credentials réelle démontrée**.
- Tests interactifs réalisés avec React/jsdom, pas Chromium/Playwright ; pas de preuve tactile/pointer native supplémentaire.

## Boundary preview, source et Git

- Preview active : `/opt/sumatime-preview/releases/v0.3.0-r2-20261003`, loopback `127.0.0.1:5174` ; mock `127.0.0.1:8792`.
- Processus et environnement vérifiés : DB `/var/lib/sumatime-preview/timesheet.sqlite`, `GLPI_API_URL=http://127.0.0.1:8792/apirest.php`, `GLPI_WRITE_ENABLED=true`, LDAP désactivé, preview=true.
- `/login` : 200 ; `/api/glpi` sans authentification : 401.
- Avant rebuild indépendant : BUILD_ID source/preview identique `OGSr2J8fBB5buIZIZrpCl`, `standalone/server.js` identique, 72 fichiers server/static identiques ; un fichier généré source `server/interception-route-rewrite-manifest.js` absent du packaging preview, pas un drift applicatif démontré. Huit assets réellement servis depuis `/login` comparés octet à octet au disque preview : identiques.
- Après rebuild : 24 assets static identiques octet à octet ; deux manifests portent le nouvel identifiant de build `ch-nWeWc4CxcXeU5Iwhu1`. Côté serveur : 38 fichiers identiques, huit fichiers de metadata/pages d'erreur ne diffèrent que par BUILD_ID ou ordre des clés JSON (égalité normalisée vérifiée). Hash du bundle applicatif `server/app/page.js` identique source/preview : `b79cf8d46b2ca567061e96199632d0434794761643eaee466abca275cb5cb7aa`. Hash du serveur standalone identique : `0c4a8c7f407465f22a8fbab69c8d17994593e7fc036f412c63e3e905910d86d2`. Aucune différence de code applicatif démontrée. La preview n'a pas été redéployée avec le BUILD_ID aléatoire de ce rebuild de contrôle.
- Aucun redémarrage de preview/mock, déploiement, modification applicative ou commit par QM. Tests complémentaires : serveurs éphémères 8789/8793, DB `/tmp`, fermés à la sortie.
- Dirty initial préservé : `next.config.ts`, `package.json`, `package-lock.json` ; non suivis initiaux : quatre fichiers `deploy/linux/preview-*`/`start-preview.sh`/services et trois docs (`EVOLUTION`, exigences, premier QM). Seul ajout documentaire de cette revue : le présent rapport.

## Reproduction / preuves conservées

- `/tmp/sumatime-qm-r2-review-BjZlFt/integration.mjs` : vraie UI/API/mock, R1 et trois P2 R2. Commande : `node --import=tsx /tmp/sumatime-qm-r2-review-BjZlFt/integration.mjs`, depuis le dépôt.
- `/tmp/qm-r2-storage-challenge.mjs` : 11 scénarios DOM/helper pour fermeture, distinct, quota, deux créateurs, cross-member, TTL, corruption, bornes et StrictMode.
- `/tmp/qm-r4-dom-challenge.mjs` et `/tmp/qm-r4-dom-challenge-results.md` : huit cas passants et deux échecs focus conservés. Confirmation : `node --import tsx --test --test-name-pattern='move out|navigate during' /tmp/qm-r4-dom-challenge.mjs`.
- `/tmp/sumatime-qm-r2-review-BjZlFt/dst-matrix.mjs` : 29 assertions.
- Premiers échecs conservés : build 180 s, lint global et ciblé, assertions focus. Une lecture ciblant un fichier TimerReview inexistant a été corrigée par localisation dans `workday-panel.tsx`. Le premier one-liner de comparaison post-build comportait une accolade finale superflue (SyntaxError), remplacé par `provenance.mjs` ; ces deux erreurs de commande ne sont pas des défaillances applicatives.

## Prochaine gate

Retour Dev sur R2 et R4 obligatoire, puis contre-revue indépendante. R2 : persistance vérifiée/fail-closed avant envoi, identité utilisateur/contexte isolée, synchronisation des créateurs/onglets, traitement explicite des capacités et expirations. R4 : fallback dans la vue courante ou maintien du focus de navigation, abandon des restaurations périmées. Clarifier/résoudre R6 sans présenter une exclusion de workspace comme un lint ciblé vert.

Le pilote doit reporter exactement **REVISE** dans Mission Control et mémoire avant toute annonce au demandeur. **Aucune release v0.3 ni production.**
