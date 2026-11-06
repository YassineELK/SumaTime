# Relevé et facturation en lot — développement

Préversion `0.4.6-dev.2`, branche `codex/bulk-billing-ledger`, développée sur CT-ANT. Elle inclut les ajustements de `0.4.6-dev.1` (heures décimales dans le relevé client et retrait des mentions de fuseau). Aucun déploiement ni accès à la production dans cette demande.

## Parcours utilisateur

L'onglet Prestations utilise toute la largeur pour le relevé, les filtres et les exports. Le rectangle permanent Nouvelle prestation est retiré. L'ajout reste accessible dans les autres parcours existants. Le crayon ouvre une fenêtre superposée préremplie ; enregistrer ferme la fenêtre et actualise le relevé, annuler ferme sans enregistrer. Les erreurs de validation sont affichées dans la fenêtre. Les filtres appliqués restent conservés après une modification. Une prestation facturée doit toujours être rouverte par un administrateur avant modification.

Pour facturer un lot : appliquer les filtres client/période/prestataire/statut, cocher les lignes ou sélectionner toutes les prestations non facturées correspondant aux filtres, puis cliquer Marquer la sélection comme facturée. La case en tête sélectionne uniquement la page visible ; Tout sélectionner couvre aussi les autres pages. Les lignes déjà facturées sont exclues. La sélection est effacée quand les filtres sont appliqués ou le relevé actualisé ; les filtres modifiés non appliqués bloquent les actions de lot.

La confirmation indique le nombre de prestations, le total de temps facturable (arrondi par prestation) et le nombre de clients. Aucun changement avant confirmation. Le marquage verrouille les lignes ; il ne crée pas de facture. La réouverture individuelle reste disponible. Maximum 1000 prestations par lot ; réduire les filtres au-delà. Les prestataires n'ont pas accès à cette action.

## Garanties serveur

POST `/api/billing` exige un compte administrateur actif, un mot de passe provisoire déjà remplacé, une origine autorisée et une sélection explicite d'identifiants/versions. Les listes vides, dupliquées, invalides ou dépassant 1000 lignes sont refusées. L'authentification Microsoft existante reste appliquée par le contrôle d'accès commun.

Une transaction vérifie à nouveau les droits de l'acteur et toutes les versions/statuts. Une ligne supprimée, modifiée ou déjà facturée fait refuser tout le lot avec 409, sans mise à jour partielle. Une erreur sur une écriture ultérieure annule les écritures précédentes. Seuls billed, version et updated_at changent sur les lignes sélectionnées ; horaires, clients, tickets, tarifs et déplacements restent conservés. Aucun changement de schéma ni de compte.

## Validation

Tests unitaires de validation, atomicité, conflits, droits révoqués et panne sur une écriture intermédiaire. Tests du véritable composant Workspace : absence de formulaire permanent, ouverture/annulation/erreur de l'overlay, sauvegarde avec filtres conservés, sélection de page et multi-pages, exclusion des lignes verrouillées, confirmation, filtres non appliqués et absence des commandes pour un prestataire.

Résultats : 66 tests unitaires/DOM (incluant calendrier, chrono, confidentialité, comptes et Entra), 25 assertions API du marquage en lot, 201 assertions API métier, 255 prestataire/GLPI et 77 de confidentialité/rémunération. Build/TypeScript, ESLint ciblé et diff Git conformes. Toutes les recettes ont utilisé des bases séparées ; aucune prestation réelle de développement ou de production n'est marquée par ces tests.

## Prévisualisation installée

Disponible sur http://192.168.10.131:5174 : version `0.4.6-dev.2`, code `4749e915ccbb6e4b6326a772ca9447d95a75bf5a`, build `nPseQcoLmLK4K_5vplFdH`. Les 3154 fichiers runtime ont été vérifiés et les 40 ressources publiques correspondent au paquet servi. L'API de facturation refuse les appels anonymes (401).

Sauvegarde/preuves privées : `/var/backups/sumatime-preview/billing-ledger-20261106`. Comparaison intégrale des 21 tables avant/après : toutes les valeurs conservées, 2 membres/comptes, 2 clients et 8 prestations. Environnement et clé GLPI inchangés ; aucun changement de schéma, aucun marquage des prestations existantes pendant la vérification. La production n'a pas été contactée ni modifiée pour ce développement.
