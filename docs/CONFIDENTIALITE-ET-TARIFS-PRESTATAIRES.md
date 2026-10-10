# Confidentialité et rémunération des prestataires — v0.4.4

## Règle métier

Les conventions commerciales entre Sumatoni et ses clients sont réservées aux administrateurs. Un prestataire consulte ses propres interventions, son tarif avec Sumatoni et ses propres frais de déplacement. Il ne consulte ni les tarifs de vente (à distance ou sur site), ni le montant calculé pour le client, ni la rémunération des autres prestataires.

Les valeurs techniques des rôles restent `admin` et `partner`. Un compte promu administrateur accède à l'ensemble des tarifs et prestations : attribuer ce rôle uniquement aux personnes habilitées.

## Mon tarif avec Sumatoni

Mon compte → Mon tarif avec Sumatoni. Le prestataire indique son montant horaire en EUR HT et sa date d'application. Ce tarif est commun à tous les clients. Il est indépendant des prix de vente ; aucun tarif client n'est recopié comme rémunération par défaut.

Un tarif s'applique aux prestations datées à partir de sa date d'application, jusqu'à la prochaine date de tarif. Une date passée recalcule le relevé des heures déjà enregistrées dans cette période. Ajouter une nouvelle date conserve les tarifs antérieurs. Modifier la même date corrige ce tarif et recalcule la période correspondante. Il s'agit d'une valorisation du relevé de contrôle, pas d'une facture émise ou d'une modification des tarifs clients.

Champ vide = tarif inconnu à partir de cette date, sans réutilisation du tarif précédent. Zéro = tarif nul connu. Une période sans tarif ne reçoit aucun montant de remplacement. Les administrateurs retrouvent la même information dans Équipe → membre → Tarif avec Sumatoni et peuvent la corriger.

Chaque modification est enregistrée avec son auteur, la date d'application, l'ancien et le nouveau montant et la version. Une modification concurrente est refusée : recharger les tarifs avant de recommencer. Aucune approbation supplémentaire ni promotion automatique du prestataire.

## Relevés

Prestations → Exporter → Mon relevé avec Sumatoni. Choisir Tous les statuts, sans recherche, puis Appliquer. Le filtre client est optionnel. Les administrateurs sélectionnent aussi le prestataire à contrôler.

Les 14 premières colonnes historiques sont conservées. Trois colonnes sont ajoutées : Tarif prestataire EUR HT, Rémunération prestataire EUR HT, Total avec déplacements EUR HT. Chaque prestation est valorisée après arrondi de sa durée au quart d'heure supérieur ; le montant est arrondi au centime par ligne, puis additionné. Le forfait de déplacement du prestataire reste compté une fois par jour, client et prestataire.

Un tarif absent est signalé dans À vérifier ; le total de rémunération et le total global restent vides pour éviter un montant incomplet présenté comme définitif. Un déplacement sans forfait ou un mode inconnu empêche aussi un total global complet. Le tarif nul est distingué de l'absence de tarif. Les exports détaillés et synthétiques d'un prestataire utilisent uniquement sa rémunération. Les exports administrateur détaillés/synthétiques conservent les prix clients ; l'export administrateur « Relevé prestataire » utilise la rémunération du prestataire.

## Protection serveur et conservation

La version précédente filtrait les tarifs du répertoire client mais laissait le tarif de vente historisé dans les réponses de prestations et les exports détaillés/synthétiques des prestataires. La correction s'effectue côté serveur : projection explicite des seuls champs autorisés des prestations, sur `/api/time` et `/api/workday`, appliquée avant toute sérialisation JSON ou CSV. Le champ de compatibilité `hourly_rate_cents` vaut null pour un prestataire. L'affichage ignore aussi une éventuelle valeur de vente dans les propriétés d'un composant prestataire.

`/api/provider-rate` exige un compte actif sans changement de mot de passe en attente. Un prestataire peut lire/modifier uniquement son propre historique ; un identifiant tiers est refusé. Les écritures contrôlent l'origine, le format, le montant, la date, la version et les droits dans la transaction. Les réponses sont `no-store`.

Migration 0011 additive : `provider_rates` et `provider_rate_events`. Aucune prestation, aucun tarif client historisé, aucun forfait, aucun compte ni jeton GLPI n'est remplacé ou migré vers un autre prix. Aucun tarif prestataire n'est initialisé arbitrairement. Le calcul lit le tarif propre applicable à la date de la prestation. L'environnement Microsoft reste inchangé.

## Vérification

Tests unitaires/DOM : projection de confidentialité, propriétés contenant un tarif client, formulaire prérempli, conflit, création d'une nouvelle date, historique, montants nuls/inconnus, arrondi et déplacements. Recette sur base isolée : appels anonymes, origine externe, lecture/écriture d'un tiers, paramètres de recherche/export, champ commercial futur inconnu, maintien des droits administrateur, changements de tarifs datés et comparaison intégrale des prestations et clients avant/après. Les recettes métier, GLPI, rôles et Entra sont également exécutées.
