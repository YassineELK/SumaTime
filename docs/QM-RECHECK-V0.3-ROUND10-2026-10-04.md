# Sumatoni Time v0.3 — contre-revue QM indépendante, round 10

Date : 2026-10-04 UTC. Branche : `codex/calendar-glpi-v0.3`.
HEAD revu : `d124e1c458a5ebec8aa79892d9cb4cbb19275fbf`.

## Verdict

**BLOCKED — validation fonctionnelle incomplète de la matrice d’expiration. Aucun PASS de release ni mise en production.**

Les suites exécutées et les régressions historiques passent. Aucun nouveau P0/P1 ni P2 reproduit n’est établi dans cette revue. Le parcours officiel round10 apporte une preuve bout en bout supplémentaire sur l’expiration avant réservation et son renouvellement. Il ne constitue toutefois pas une matrice UI indépendante à horloge contrôlée couvrant exactement TTL−1 ms, TTL et TTL+1 ms, ni toutes les combinaisons demandées de perte de stockage/remontage.

**L’ancien angle mort est donc partiellement vérifié, pas totalement fermé à cette gate.** BLOCKED qualifie la couverture restante ; il ne transforme ni une hypothèse en défaut confirmé, ni les suites passantes en échec.

À la demande du pilote, la revue a été clôturée sans engager de nouvelle campagne. Le présent rapport ne consolide que les résultats déjà produits par les exécutions lancées. La sous-revue complémentaire n’a pas livré de preuve exécutable ; aucun résultat ne lui est attribué.

Revue selon [Application Release Review](/root/.openclaw/agents/main/agent/workshop-skills/application-release-review/SKILL.md) et les exigences R1–R7. Aucun code applicatif, commit, service permanent, production ou fournisseur réel modifié. Seul ajout QM au dépôt : ce rapport ; artefacts de recette sous `/tmp` et données synthétiques sous `/dev/shm`.

## Expiration : ce qui est effectivement vérifié

### Contrat serveur à horloge contrôlée — PASS ciblé

La suite officielle de 42 tests inclut `tests/glpi-round10-expiry.test.mjs` :

- TTL−1 ms : nouvelle demande distincte acceptée ; un nouveau ticket simulé.
- TTL exact et TTL+1 ms : refus explicite de l’intention expirée, aucun nouvel envoi fournisseur.
- Intention absente sur un brouillon déjà identifié : refus explicite, aucun retour implicite vers l’ancienne opération.
- Renouvellement du même UUID : nouveau résultat distinct des précédents, un seul nouvel envoi ; correspondance brouillon/opération conservée.
- Durée d’intention de dix minutes vérifiée.

Ce test appelle le vrai module serveur avec horloge injectée et transport fournisseur simulé. **Il ne traverse pas React et Next à ces trois instants exacts.**

### Parcours officiel React → Next → mock — PASS ciblé

`tests/glpi-round10-integration.mjs`, premier essai : **PASS, 11,734 s**.

Le parcours établit un ancien résultat, autorise un brouillon distinct, positionne son échéance dans la base synthétique avant réservation, puis vérifie le refus sans nouveau POST. Il remonte React à partir du stockage conservé, exerce l’injection d’indisponibilité du stockage après ce remontage, renouvelle le même UUID et constate exactement un nouveau POST. Une variante perd l’authentification avant réservation, expire ensuite l’intention, récupère l’état explicite et renouvelle le même brouillon une seule fois.

Les UUID et compteurs vérifiés ne montrent aucun retour vers l’ancienne opération dans ces parcours.

**Précision temporelle :** l’intégration utilise une échéance de fixture fixée à l’heure courante, puis effectue la requête. Elle ne fige pas conjointement les horloges navigateur et serveur à TTL−1/exact/+1 ; son libellé « exact-expiry » ne suffit donc pas à revendiquer cette précision bout en bout.

### Couverture restant ouverte

- Matrice indépendante UI → Next → mock, horloges contrôlées, aux trois bornes exactes.
- Stockage indisponible dès l’émission de l’intention, puis véritable nouvelle instance sans mémoire du brouillon avant réservation.
- Distinction explicite entre expiration avant réservation et expiration locale après une création déjà réservée dont la réponse a été perdue.
- Renouvellements simultanés et transitions expiration/renouvellement, au-delà des parcours séquentiels officiels.

Ces variantes ne sont pas annoncées comme défaillantes : elles n’ont pas été reproduites dans cette revue. Aucun doublon, mauvais résultat ou blocage utilisateur nouveau n’est affirmé sur leur seule inspection.

## Régressions fonctionnelles produites

- **Transitions round7 : 14/14 PASS**, cinq POST de fixture. Action distincte réellement cliquable, options rechargées, double clic sans création supplémentaire, correction d’un refus certain sous nouvelle identité.
- **Round3 : 26/26 PASS**, onze POST, sessions finales zéro. Stockage fonctionnel/perdu/corrompu/saturé/désactivé pour les opérations déjà envoyées, absence d’acquittement invisible, créateurs coexistants, deux processus UI, changement de membre et reprise durable. Ces résultats ne sont pas assimilés au cas distinct pré-réservation sans stockage ci-dessus.
- **ACK perdu et polling : 9/9 PASS**, trois POST, sessions zéro après stabilisation. Résultat conservé après réponse d’acquittement perdue, remontage, consommation rejouable et livraison unique ; champs distincts préservés au polling.
- **Alias d’une opération déjà enregistrée après expiration : 6/6 PASS**, un POST total. Ce n’est pas l’expiration d’une intention inutilisée.
- **Arrêt/reprise du Next éphémère : 9/9 PASS**, deux POST total. Réservation conservée avant/après l’envoi, aucun renvoi après reprise. Les sessions simulées interrompues sont explicitement fermées dans le harnais ; aucun nettoyage automatique après arrêt brutal n’est revendiqué.
- **Récupération round8/9 : 23/23 PASS**, un POST total. Configuration temporairement indisponible, réponses transitoires, erreur de lecture, récupération répétée et limitation préservent l’opération. Les erreurs navigateur injectées ne sont pas présentées comme des pannes spontanées du produit.
- **Premier envoi distinct refusé avant réservation : 10/10 PASS**, deux POST pour deux opérations explicitement demandées. L’identité nouvelle est conservée après retour de session, dans la fenêtre de validité vérifiée.
- **R1 : PASS réel React → Next → SQLite.** Annulation avec version courante, six champs attendus et heures sérialisées ; restauration exacte, sept champs métier préservés ; vraie modification concurrente conservée avec refus409.
- **R3 : PASS via provider175.** Contexte d’entité confirmé avant opérations dépendantes ; échecs fonctionnels/HTTP/lecture bloquants ; sessions normalement achevées fermées.
- **R4 : 14/14 PASS DOM indépendant**, premier essai. Deux ajustements start/end/move, recharge parent retardée, erreurs/conflit, disparition/facturation/hors semaine, navigation, annulation et suppression ; focus exact ou fallback connecté.
- **R5 : 29/29 PASS**, premier essai. Printemps/automne, bornes exactes±1ms, intervalle réellement traversant, minuit et arrondis.
- **Migration legacy et annulation : 75 contrôles PASS ; migrations approfondies : 78 PASS** (`4+27+21+26`, sans double comptage). Résultats historiques115/118/119 conservés avec leur propre récupération/acquittement ; six POST historiques dans la fixture dédiée, aucun nouveau après migration, sessions zéro. TTL ISO exact et continuité des alias conservés.

## Suites et qualité

- **42/42 tests unitaires/DOM/migrations PASS**, premier essai, 7,096 s. Sous-suites incluses non recomptées dans ce total.
- **Intégration officielle94 PASS au premier essai**, 38,263 s, onze POST du mock principal.
- **Intégration round9 PASS au premier essai**, 10,560 s ; **round10 PASS**, 11,734 s.
- **API198 PASS**, premier essai, 3,111 s.
- **Provider175 PASS**, premier essai, 17,388 s ; quatre POST simulés, zéro session finale.
- **Build production PASS**, premier essai, 79,349 s.
- **TypeScript PASS**, exécuté après le build, 7,213 s.
- **Lint ciblé43 fichiers PASS**, zéro erreur/avertissement.
- **Lint global FAIL : deux erreurs/trois avertissements préexistants** dans `app/login/page.tsx`, `components/client-color.tsx`, `app/account-panel.tsx`. Fichiers et configuration ESLint identiques à `087da9e`, vérification enregistrée.
- **Diff-check depuis `087da9e` PASS**.
- **SQLite/FK PASS dans les fixtures UI et migrations exécutées**, avec sauvegardes de migration vérifiées par ces harnais. Le contrôle séparé read-only des bases source/preview et la suite de sauvegarde Linux29+intentions2 n’ont pas été exécutés dans cette revue : aucun PASS round10 leur est attribué.
- Les matrices serveur indépendantes85 et interruptions transactionnelles48/60 des rounds précédents n’ont pas été relancées ici. Leurs anciens résultats ne sont pas recyclés en preuves round10.

## Preview et provenance

- Preview : `/opt/sumatime-preview/releases/v0.3.0-round10-20261004`, loopback5174 ; mock permanent loopback8792.
- BUILD_ID servi : `-p1NoSnHhobDOqr2Azqwq`.
- **Avant rebuild : 81/81 fichiers comparés identiques**, même BUILD_ID et serveur standalone identique.
- **Après rebuild local de contrôle : 70/81 hashes bruts identiques, 81/81 après normalisation** du BUILD_ID et de l’ordre JSON ; aucune différence applicative détectée. BUILD_ID local de contrôle : `elLaSl-zS5YorFFqBGp1t`. La preview n’a pas été remplacée par ce rebuild.
- **26 assets HTTP conformes aux fichiers de la preview.** Contrôle de santé effectué : `/login`200 et endpoints GLPI anonymes401.
- PIDs preview/mock **1215804/1215803**, inchangés dans le contrôle post-build. Base preview distincte, fournisseur strictement mock-only, LDAP désactivé.
- **213 fichiers source/non-suivis inchangés** au contrôle post-build. HEAD et dirty identiques avant ajout de ce rapport. Dirty initial : `next.config.ts`, `package.json`, `package-lock.json`, plus quinze non-suivis préexistants (quatre deploy et onze documents).
- Tous les processus de recette observés étaient terminés à la clôture ; aucun redémarrage des services permanents.

## Incidents et limites

- Aucun échec, timeout ou retry des suites officielles, API, provider ou build dans ce round ; lint global reste explicitement rouge.
- Cinq avertissements React `act` conservés dans le harnais migration/annulation ; assertions passantes après les attentes prévues.
- Une lecture initiale cherchait un nom de harnais inexistant, corrigé par inventaire des fichiers ; aucune assertion produit concernée.
- Les files de recettes déjà lancées se sont terminées pendant la collecte. La tentative d’arrêter leur orchestrateur a constaté un PID déjà absent, sans signal livré ; aucune nouvelle campagne indépendante engagée après la consigne de clôture.
- La sous-revue complémentaire s’est interrompue avant production de ses preuves ; ce n’est pas un défaut applicatif ni un résultat PASS.
- React/Radix/jsdom et processus distincts utilisés ; pas de recette Chromium, tactile/pointer natif ou lecteur d’écran revendiquée.
- Les limites préexistantes de parcours legacy et de rétention restent hors correction de ce round. Aucun nouvel incident les concernant n’a été établi.

## Preuves et prochaine gate

Dossier : `/tmp/sumatime-qm-r10-review-vkhZG5/`. Chaque exécution enregistrée possède son `.log` et son `.result.json` avec commande, environnement de recette, premier résultat et durée. Logs principaux : `unit-first`, `official-first`, `round9-official-first`, `round10-official-first`, `api-first`, `provider-first`, `transitions-click-first`, `integration-settled-first`, `recovery-deep-first`, `distinct-transient-first`, `migration-integration-first`, `deep-migrations-first`, `build-first`, `provenance-before`, `provenance-after-first`, `served-assets-first`.

**Prochaine gate : achever la recette fonctionnelle ciblée d’expiration/remontage/renouvellement, puis rendre un verdict indépendant consolidé. Aucune release v0.3 avant PASS.**

CHECKLIST relu. Le pilote doit synchroniser Mission Control, mémoire et activité avec **BLOCKED — suites passantes, couverture expiry partielle, aucun nouveau P2 confirmé**. Cette sous-revue ne modifie pas ces supports de coordination et ne vaut pas autorisation de release.
