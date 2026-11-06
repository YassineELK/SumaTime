# Export client et répartition des heures — développement

Préversion `0.4.7-dev.1`, branche `codex/client-export-billing-summary`, préparée sur CT-ANT. Aucune mise en production dans cette demande.

## Nom du fichier

Le relevé client utilise le nom du client sélectionné et les dates des filtres appliqués : `salarypay-prestations-2026-09-01-2026-10-31.csv`. Le serveur génère ce nom dans Content-Disposition et le téléchargement navigateur l'utilise. Il ne remplace plus systématiquement ce nom par un préfixe générique.

Les accents et signes sont normalisés pour obtenir un nom lisible et sûr, sans séparateur de chemin ni caractères de contrôle. Les autres exports incluent aussi le client sélectionné, avec un suffixe distinct : detail, synthese ou prestataire-nom. Sans filtre client, le préfixe tous-les-clients est explicite. Le relevé client anonyme n'inclut jamais le nom du prestataire dans son nom de fichier.

## Décimales et CSV

Le CSV client conserve le séparateur de colonnes `;`, l'encodage UTF-8 avec BOM et ses sept colonnes. Durée facturable (heures) utilise désormais la virgule décimale, avec deux décimales : `0,25`, `0,50`, `1,00`, `1,50`. Ce format correspond à la lecture de nombres dans un tableur configuré en français, contrairement au point décimal demandé dans la version précédente. Aucun préambule propriétaire ni formule n'est ajouté.

L'arrondi au quart d'heure s'applique toujours par prestation avant conversion : 16 minutes donnent `0,50` heure. Les horaires réels restent conservés. Les exports détaillés/synthétiques/prestataire utilisaient déjà la virgule pour leurs nombres décimaux ; leurs colonnes ne changent pas. Les noms, notes internes et tarifs du prestataire restent exclus du relevé client.

## À l'écran

Sous le total Temps facturable dans Prestations, une petite répartition affiche Sur site et À distance. Chaque valeur additionne les durées facturables des prestations correspondant aux filtres appliqués, sur toutes les pages du relevé. Un mode inconnu est compté séparément dans À confirmer et n'est jamais assimilé à une prestation à distance. La répartition additionnée correspond au total facturable. Aucun prix ni règle d'arrondi n'est modifié.

## Validation

Tests du nom de fichier serveur et réellement utilisé au téléchargement, normalisation et rejet de noms dangereux, décimales françaises pouvant être additionnées, arrondis, répartition sur site/à distance/mode inconnu et affichage dans le véritable Workspace. Recette API sur une base isolée : nom et période exacts, somme 3,50 h pour l'administrateur et 2,00 h pour le prestataire sur son périmètre propre ; export client toujours anonyme et refus du mode inconnu. Aucun changement de schéma ni de prestation.
