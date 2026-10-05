# Sumatoni Time v0.3 — exigences de correction après revue QM

Date : 2026-10-03  
Branche : `codex/calendar-glpi-v0.3`  
Verdict source : QM `REVISE` — cinq défauts P2 confirmés, aucun P0/P1 démontré.

## Objectif

Corriger les cinq défauts fonctionnels confirmés par QM, éliminer les régressions lint introduites par la v0.3, reconstruire la preview isolée depuis le code corrigé et fournir des preuves suffisantes pour une nouvelle revue QM indépendante.

## Limites et garde-fous

- Ne pas modifier ni déployer la production.
- Ne jamais appeler le GLPI réel pendant le développement ou les tests.
- Utiliser uniquement le mock GLPI et la preview isolée sur `127.0.0.1:5174`.
- Préserver les changements v0.3 existants ; aucun reset, écrasement ou nettoyage destructif du worktree.
- Ne pas affaiblir les protections existantes : `GLPI_WRITE_ENABLED=true`, contrôle d’origine, chiffrement du jeton, URL contrôlée, refus des redirections, délais/réponses bornés, fermeture de session et réservation SQLite atomique.
- Une réponse GLPI ambiguë ne doit jamais provoquer un renvoi automatique aveugle.

## R1 — Annulation fiable d’un déplacement calendrier

### Exigence

L’action « Annuler le déplacement » doit restaurer uniquement `date`, `start` et `end` de l’entrée originale, tout en envoyant la version courante attendue par le contrôle de concurrence.

### Critères d’acceptation

- Une annulation immédiatement après un déplacement réussi retourne HTTP 2xx et restaure exactement les bornes originales.
- L’annulation ne doit pas produire de conflit 409 avec elle-même.
- Si l’entrée a réellement été modifiée entre le déplacement et l’annulation, le conflit 409 reste obligatoire.
- Aucun autre champ métier ne doit être écrasé par l’objet historique.
- Un test de régression couvre le succès et le vrai conflit concurrent.

## R2 — Continuité d’une création GLPI à réponse incertaine

### Exigence

L’interface doit conserver durablement, pour la durée utile du formulaire, l’UUID et le payload canonique d’une demande dont l’envoi a pu réussir mais dont la réponse navigateur est inconnue. Fermer/réouvrir le composant ou réessayer ne doit pas générer un nouvel UUID pour la même demande incertaine.

### Critères d’acceptation

- Après une erreur réseau/JSON ambiguë, l’UI affiche explicitement un état « résultat incertain » et n’affiche pas un simple échec générique.
- Le même UUID et le même payload sont réutilisés pour la récupération/réconciliation de cette demande.
- Le bouton de renvoi automatique est interdit tant que le résultat reste incertain.
- La fermeture/réouverture du formulaire ne perd pas l’identité de la demande incertaine.
- Toute modification du payload après une réponse incertaine exige une nouvelle action explicitement distincte ; elle ne doit ni muter ni réutiliser silencieusement l’ancienne opération.
- Une réponse explicite avant envoi ou un refus certain peut permettre la correction et une nouvelle demande.
- Des tests utilisent le vrai chemin UI/API avec le mock : création acceptée côté GLPI, réponse navigateur perdue, réouverture du formulaire, puis vérification qu’aucun second `POST Ticket` n’est émis.

## R3 — Échec de changement d’entité GLPI bloquant

### Exigence

`changeActiveEntities` doit être considéré réussi uniquement si la réponse HTTP est valide **et** si le résultat fonctionnel vaut strictement `true`.

### Critères d’acceptation

- HTTP 200 avec `false` interrompt immédiatement le flux.
- Après cet échec, aucune catégorie de l’ancienne entité ne doit être présentée comme valide pour la cible.
- Après cet échec, aucun `POST Ticket` ne doit être tenté.
- L’utilisateur reçoit une erreur exploitable indiquant que le contexte d’entité n’a pas pu être sélectionné.
- Tests provider dédiés pour `true`, `false`, erreur HTTP et réponse malformée.

## R4 — Continuité du focus lors des ajustements clavier

### Exigence

Les poignées clavier du calendrier doivent rester utilisables en séquence. Une sauvegarde ne doit pas faire perdre définitivement le focus à la poignée active.

### Critères d’acceptation

- Après une flèche puis sauvegarde réussie, le focus revient sur la même entrée et la même poignée (`start`, `end` ou déplacement) si elle existe toujours.
- Plusieurs pressions successives peuvent être effectuées sans reprendre la souris ni retabuler depuis le début.
- En cas de suppression, conflit ou disparition légitime de la cible, aucun focus fantôme n’est imposé ; un fallback accessible et documenté est utilisé.
- L’état `saving` ne doit pas retirer inutilement l’élément focusé du DOM, ou une restauration précise doit être effectuée après le rendu.
- Ajouter un test navigateur/DOM automatisé couvrant au moins deux ajustements clavier successifs et le focus après sauvegarde.

## R5 — Validation DST sur l’intervalle mesuré, pas sur l’arrondi

### Exigence

La détection des changements/ambiguïtés DST doit analyser l’intervalle réellement mesuré. L’arrondi civil proposé pour l’enregistrement ne doit pas inventer un franchissement DST absent de la mesure réelle.

### Critères d’acceptation

- Le segment UTC `2026-03-29T00:40:00Z` → `2026-03-29T00:50:00Z` est accepté pour Bruxelles, même si l’arrondi proposé atteint une borne située après le changement d’heure.
- Un intervalle réellement mesuré qui traverse le changement d’heure reste signalé/refusé selon la règle actuelle.
- Les règles de passage de minuit et de découpage journalier restent intactes.
- Les bornes arrondies demeurent modifiables avant enregistrement.
- Tests dédiés : avant le saut avec arrondi traversant, traversée réelle du saut, heure ambiguë d’automne, cas normal sans DST.

## R6 — Qualité statique et non-régression

### Exigence

La correction ne doit pas ajouter de dette statique. Les erreurs lint introduites ou touchées par la v0.3 doivent être corrigées proprement, sans désactivation globale des règles ni multiplication de `any`.

### Critères d’acceptation

- `npm run lint` ne contient aucune erreur dans les fichiers ajoutés ou modifiés par la v0.3.
- Les cinq `any` signalés dans le nouveau code GLPI sont remplacés par des types explicites ou des validations de données inconnues.
- L’erreur lint de `new-glpi-ticket.tsx` est corrigée.
- Toute dette lint préexistante hors périmètre est inventoriée séparément, avec preuve qu’elle n’a pas été aggravée.
- `git diff --check`, `tsc --noEmit` et le build production passent.

## R7 — Preview et preuves de livraison

### Exigence

La preview isolée doit servir exactement le code corrigé soumis à QM.

### Critères d’acceptation

- Build standalone réussi depuis le worktree corrigé.
- Services preview/mock redémarrés avec ce build, sans changement de production.
- `/login` répond 200 ; l’API GLPI non authentifiée reste refusée.
- Le bundle UI servi correspond au build courant ; absence d’écart source/preview documentée.
- GLPI mock uniquement, avec compteur prouvant l’absence de création réelle.
- Tests requis : unitaires, TypeScript, lint ciblé/global documenté, API (184 assertions ou suite mise à jour équivalente), provider (148 assertions ou suite mise à jour équivalente), intégrité SQLite et recette navigateur ciblée undo/focus/GLPI incertain/DST.

## Gate de sortie développement

Le développement est prêt pour QM uniquement si :

1. R1 à R7 disposent chacun d’une preuve testable ;
2. toutes les suites requises passent sans retirer ni assouplir les assertions ;
3. les tests ne dépendent pas du vrai GLPI et ne modifient pas la production ;
4. le worktree, les fichiers touchés et les éventuelles limites restantes sont explicitement listés ;
5. la preview sert le même code que celui remis à QM ;
6. aucun défaut n’est masqué par un simple message d’erreur générique, un retry aveugle ou une désactivation de règle.

## Revue finale attendue

QM doit rendre `PASS`, `REVISE` ou `BLOCKED` après revue indépendante du diff, reproduction des cinq défauts, exécution des suites et recette de la preview. Aucun déploiement production ni release v0.3 ne peut avoir lieu avant `PASS`.
