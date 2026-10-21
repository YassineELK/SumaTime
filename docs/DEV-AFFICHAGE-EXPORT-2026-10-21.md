# Prochaine version — affichage et durée exportée

Version de développement `0.4.6-dev.1`, branche `codex/export-decimal-hours`. Préparation limitée à CT-ANT et à la prévisualisation. Aucune mise en production dans cette demande.

## Changements

Les mentions géographiques de fuseau sont retirées de l'interface : instructions du calendrier, formulaires de prestation et guide pratique. Les calculs de dates, les horaires enregistrés et le comportement des chronos restent identiques ; seuls les textes visibles changent.

L'export client conserve ses sept colonnes et son anonymisation, avec la colonne **Durée facturable (heures)** à la place de la durée en minutes. Les valeurs sont des heures décimales utilisant un point : 15 minutes → `0.25`, 30 minutes → `0.5`, 1 heure → `1`, 1 h 30 → `1.5`. Pas de zéros décimaux inutiles.

L'arrondi commercial reste appliqué à chaque prestation avant conversion : 16 minutes donnent `0.5` heure facturable, 61 minutes `1.25`, 91 minutes `1.75`. Les horaires de début/fin restent ceux enregistrés, le mode à distance/sur site et le numéro/titre du ticket restent exportés. Aucun tarif ni nom de prestataire n'est ajouté au relevé client. Les autres formats de relevés ne changent pas.

## Validation

Tests ciblés des valeurs décimales, de l'arrondi, d'une fin à minuit, des titres et de l'exclusion des informations internes. Recettes API métier et titres/historique sur bases isolées. Build/TypeScript, ESLint ciblé et diff Git vérifiés.
