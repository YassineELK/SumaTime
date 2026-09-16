# Sumatoni Time — Guide d’utilisation et exploitation

## Démarrer

1. Ouvrez l’application et connectez-vous avec votre compte ChatGPT.
2. À la première ouverture du site privé, indiquez votre nom et activez votre espace. Votre compte devient administrateur.
3. Dans **Clients**, ajoutez les noms de vos clients.
4. Dans **Prestations**, saisissez client, ticket, date, début et fin. Vérifiez la durée affichée, puis enregistrez.

La base de production démarre vide. Les données utilisées pour la recette sont exclusivement locales.

## Faire travailler un partenaire

Dans **Équipe**, ajoutez son nom et l’adresse exacte de son compte ChatGPT. Aucune invitation e-mail n’est envoyée par l’application. Le partenaire peut consulter, saisir, corriger et exporter ses propres prestations. L’administrateur voit toutes les prestations et peut les corriger tant qu’elles ne sont pas facturées.

Le site est livré privé, réservé à son propriétaire. L’administrateur doit aussi autoriser le partenaire dans les réglages de partage du site. L’autorisation dans Équipe ne modifie pas à elle seule cette protection de la plateforme. Selon le compte Sites, l’accès externe peut être disponible ou nécessiter une autre configuration d’hébergement. Ne partagez pas publiquement un espace non activé : l’activation initiale doit être réalisée par le propriétaire pendant que le site est privé.

## Saisir les heures

### Sélectionner une plage dans le calendrier

L’application s’ouvre maintenant sur **Calendrier**. Sur PC, la semaine du lundi au dimanche est affichée. Cliquez-glissez dans la colonne d’un jour : chaque case représente 15 minutes. La plage surlignée affiche les horaires retenus ; relâchez pour ouvrir la fenêtre de saisie. Un simple clic prépare une prestation de 15 minutes. Le bouton **Prestation** permet aussi d’ouvrir directement le formulaire.

Sur téléphone, sélectionnez le jour en haut, touchez le premier puis le dernier quart d’heure de votre intervention. La fenêtre s’ouvre après le deuxième appui. Pour un seul quart d’heure, touchez deux fois la même case ou utilisez **Continuer** après le premier appui. Le défilement vertical reste disponible entre les deux appuis. Les horaires préremplis restent ajustables dans la fenêtre.

Choisissez le client, indiquez le numéro de ticket et éventuellement une description, puis cliquez sur **Enregistrer la prestation**. La prestation apparaît dans le calendrier et reste accessible dans le relevé et les exports de l’onglet **Prestations**. Les nouvelles saisies sont toujours attribuées à la personne connectée, même lorsque l’administrateur affiche un autre partenaire ou toute l’équipe.

Cliquez sur un bloc existant pour le modifier. Les prestations déjà facturées s’ouvrent en lecture seule. Les horaires exacts d’anciennes prestations restent conservés, même s’ils ne correspondent pas à un quart d’heure. La navigation propose les semaines précédente/suivante, **Aujourd’hui** et une date au choix. Les jours futurs ne permettent pas de saisie.

Au clavier : Tab pour atteindre la grille, flèches pour se déplacer, Maj + flèche haut/bas pour étendre la plage, Entrée pour ouvrir la saisie et Échap pour annuler une sélection. La fenêtre conserve les champs en cas d’erreur et demande confirmation avant d’abandonner des modifications.

Les heures sont les heures civiles de Bruxelles. Le téléphone ne les convertit pas automatiquement. La fin **00:00** signifie minuit à la fin de la date sélectionnée et apparaît comme **24:00** sur le relevé. Pour une intervention de 23:00 à 01:00, saisissez 23:00–00:00 le premier jour et 00:00–01:00 le lendemain. Lors des changements d’heure saisonniers, vérifiez votre saisie : le calcul porte sur les heures civiles, pas sur la durée chronométrique.

Une prestation de 16 minutes donne 30 minutes facturables. Chaque ligne est arrondie séparément au quart d’heure supérieur. Le relevé conserve les minutes réelles et arrondies. Les dates futures et les chevauchements d’une même personne sont refusés.

## Préparer la facturation

1. Sélectionnez une période (366 jours maximum), un client, un partenaire ou un statut.
2. Cliquez sur **Appliquer**. Les compteurs et le relevé correspondent alors à cette sélection.
3. Dans **Exporter**, choisissez **CSV détaillé** pour les justificatifs ou **Synthèse par client** pour les totaux par client et partenaire.
4. Ouvrez le fichier dans Excel. Il utilise UTF-8, un séparateur point-virgule et la virgule décimale. Si votre tableur utilise un autre séparateur régional, utilisez son import CSV en choisissant le point-virgule.
5. Après la facturation, utilisez la double coche sur chaque prestation pour la marquer facturée et la verrouiller. L’export seul ne change aucun statut.

La synthèse additionne les minutes arrondies de chaque prestation. Le fichier contient des durées ; aucun tarif, montant, TVA ou numéro de facture n’est calculé. Les relevés ne remplacent pas vos factures.

## Corriger et conserver

Le crayon permet de corriger une ligne non facturée. La corbeille supprime une ligne après confirmation, sans possibilité de récupération dans l’interface. Une ligne facturée doit d’abord être rouverte par l’administrateur. Si quelqu’un a modifié la même ligne entre-temps, l’application refuse votre ancienne version : actualisez, relisez la ligne, puis recommencez.

Archiver un client retire son nom des nouvelles saisies, tout en conservant l’historique. Désactiver un partenaire bloque son accès applicatif mais conserve son relevé. Le compte administrateur initial ne peut pas être désactivé depuis l’application.

## Connexion et erreurs

Une connexion Internet est nécessaire. Attendez la confirmation d’enregistrement avant de quitter l’écran. Les champs restent présents en cas d’échec ; rechargez uniquement après avoir copié une saisie non enregistrée si nécessaire. Un nouvel essai sur la même saisie conserve son identifiant pour limiter les doublons. Il n’y a pas de mode hors connexion ni de sauvegarde automatique des brouillons après fermeture de l’onglet.

## Exploitation technique

Le projet utilise React, Vinext, Workers et D1. Le schéma se trouve dans `db/schema.ts`, les migrations dans `drizzle/`, l’API dans `app/api/time/route.ts`. Les données ne sont pas stockées dans le dépôt Git.

- Installation : `npm run install:ci` (Node 22.13 ou supérieur).
- Compilation : `npm run build`.
- Développement local : `npm run dev` ; connexion locale simulée uniquement en développement sur loopback.
- Migrations locales : compiler d’abord puis appliquer chaque SQL dans l’ordre avec Wrangler, en suivant les indications du README technique du starter.
- Validation : `node node_modules/typescript/bin/tsc --noEmit` ; tests de recette documentés dans `RECETTE.md`.

En production, l’identité est fournie par la plateforme Sites. Ne déployez pas directement ce serveur derrière un proxy qui laisse le navigateur choisir les en-têtes `oai-authenticated-user-*`. En hébergement autonome, il faut remplacer ou sécuriser cette couche d’authentification avant exposition.

Les clés et jetons d’hébergement ne doivent pas être placés dans les sources. La connexion simulée du développement est exclue de la compilation de production. Chaque appel à l’API vérifie le rôle ; le filtrage visuel n’est pas la barrière de sécurité.

### Sauvegarde et reprise

La base D1 assure la persistance. Avant usage critique, l’exploitant doit fixer la rétention des sauvegardes, l’accès administratif de secours et la procédure de restauration. Les exports CSV sont une copie métier utile mais ne contiennent pas tous les paramètres ni toutes les relations nécessaires à une restauration complète. Cette version ne fournit pas de bouton de restauration ni de journal d’audit immuable.

Pour restaurer un environnement, remettre une sauvegarde D1 et la révision de code compatible, puis vérifier les membres, clients, totaux et droits sur un espace de validation avant de rouvrir l’accès. Ne rejouer aucune migration déjà appliquée ; les migrations de production sont versionnées et immuables.
