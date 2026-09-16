# Sumatoni Time — Architecture et besoins métier

Version 1 · 16 septembre 2026

## 1. Objectif métier

Enregistrer les prestations de l’administrateur et de ses partenaires depuis un PC ou un téléphone, puis obtenir un relevé fiable pour préparer la facturation. La saisie doit rester courte : client, référence du ticket, date, heure de début et heure de fin. Une description facultative permet de justifier l’intervention.

Décisions confirmées : droits distincts ; l’administrateur voit toutes les prestations ; arrondi au quart d’heure supérieur. L’arrondi s’applique **à chaque prestation**, avant agrégation. Exemple : 09:00–09:16 représente 16 minutes réelles et 30 minutes facturables. Les heures originales sont conservées.

## 2. Parcours et facilité d’utilisation

L’écran d’accueil est un espace de travail : saisie immédiatement accessible, total de la période, liste des prestations et filtres. Date du jour proposée, champs horaires natifs adaptés au téléphone, durée calculée avant enregistrement. Les erreurs sont explicites et ne vident pas le formulaire. Une sauvegarde confirmée signifie une écriture dans la base partagée.

Sur PC, formulaire et relevé sont visibles côte à côte ; sur téléphone, ils s’empilent, la navigation reste accessible et les lignes deviennent des cartes. Les boutons ont une cible tactile suffisante, les champs ont un libellé, la navigation clavier reste possible. Aucune information essentielle ne dépend uniquement d’une couleur.

Le démarrage se fait dans une base vide. L’administrateur crée ses clients et autorise ses partenaires par adresse e-mail. Aucun exemple fictif n’est mélangé aux prestations réelles.

## 3. Droits et identité

| Action | Partenaire | Administrateur |
|---|---|---|
| Consulter les clients actifs | Oui | Oui |
| Créer une prestation | Pour soi | Pour soi |
| Consulter / exporter les prestations | Les siennes | Toutes |
| Corriger / supprimer une prestation non facturée | Les siennes | Toutes |
| Marquer facturé / rouvrir | Non | Oui |
| Gérer les clients et partenaires | Non | Oui |

Authentification via la connexion ChatGPT gérée par Sites. Chaque personne doit disposer d’un compte compatible. Le serveur utilise l’identifiant stable fourni par la plateforme, jamais un identifiant envoyé par le navigateur. L’accès à l’application est limité aux membres explicitement autorisés. La première activation administrateur se fait pendant que le site est privé et réservé à son propriétaire ; après activation, aucune inscription libre ne crée un administrateur.

La diffusion initiale reste privée. Pour utiliser l’application à plusieurs, l’audience de la plateforme doit autoriser les partenaires en complément de la liste de membres de l’application. Cette configuration dépend des possibilités de partage du compte Sites. Ne pas confondre une invitation applicative et l’accès à l’URL privée.

## 4. Règles de gestion

- Client actif, ticket non vide, date et heures obligatoires.
- Date et heures interprétées comme heures locales de Bruxelles ; stockage textuel ISO et minutes entières, sans conversion implicite par le fuseau du téléphone.
- Prestations limitées à une journée civile ; une intervention passant minuit est saisie en deux lignes. Fin strictement postérieure au début. Pas de date future.
- Les heures ambiguës des changements saisonniers ne représentent pas une durée chronométrique : l’application facture la différence entre heures civiles saisies. À signaler dans le guide.
- Durée réelle = fin − début ; durée facturable = plafond(durée / 15) × 15.
- Chevauchement des prestations d’une même personne refusé, y compris lors d’une modification ; contrôlé dans l’écriture SQL pour éviter les courses concurrentes.
- Une prestation facturée est verrouillée. L’administrateur peut la rouvrir explicitement. Exporter ne marque pas automatiquement facturé.
- Les clients se désactivent sans effacer leur historique. Les partenaires se désactivent sans effacer leurs prestations. L’administrateur initial ne peut pas se retirer son accès.
- Chaque modification utilise une version pour refuser l’écrasement d’une modification concurrente.

## 5. Exports pour la facturation

CSV UTF-8 avec BOM, séparateur point-virgule, décimales françaises, compatible avec une ouverture dans Excel. Export détaillé : identifiant de prestation, client, ticket, partenaire, date, début, fin, description, minutes réelles, minutes facturables, heures facturables et état de facturation. Export récapitulatif : total par client et partenaire. Les deux respectent la période et les filtres affichés, ainsi que les droits côté serveur.

Protection des cellules contre l’interprétation comme formules. Les totaux additionnent les minutes facturables de chaque ligne. Il s’agit d’un relevé de préparation : pas de calcul de TVA, de génération de facture légale ou d’intégration comptable dans cette version.

## 6. Architecture technique

Navigateur responsive → application React / Vinext → API même origine → base SQLite Cloudflare D1. Déploiement via Sites / Cloudflare Workers. Les données métier sont conservées côté serveur et disponibles depuis les différents appareils. Pas de données métier stockées exclusivement dans le navigateur.

Le serveur vérifie l’identité, l’appartenance et le rôle à chaque requête. Les écritures contrôlent aussi l’origine de la requête. Requêtes SQL préparées ; validation serveur des longueurs, types, heures et statuts. Les réponses privées ne doivent pas être mises en cache. Les erreurs internes ne révèlent pas les données ou la configuration.

## 7. Modèle de données

| Entité | Données principales |
|---|---|
| members | e-mail autorisé unique, identifiant d’identité lié après connexion, nom, rôle, actif |
| clients | identifiant, nom unique, actif |
| entries | identifiant, membre, client, ticket, date, début/fin en minutes, description, état, version, dates de création/modification |

Durées calculées à partir des heures d’origine pour éviter les incohérences. Index sur membre/date et date/client pour les consultations ; clés étrangères pour protéger les liens. Schéma versionné par migrations Drizzle, sans création de tables à la volée.

## 8. Fiabilité et exploitation

L’application nécessite une connexion Internet. En cas d’erreur de sauvegarde, les champs restent présents et un nouvel essai est possible. Les lectures sont limitées à une période de 366 jours maximum pour garder des exports et temps de réponse raisonnables. Les identifiants d’écriture uniques empêchent un double enregistrement involontaire.

Le code, les migrations et le guide sont livrés avec le produit. La persistance est assurée par D1 ; une politique de sauvegarde et restauration avec durée de conservation devra être définie avec l’exploitant avant une utilisation critique. Les exports réguliers donnent une copie métier portable, mais ne remplacent pas une sauvegarde complète.

## 9. Critères de recette

1. Une prestation de 16 minutes affiche et exporte 30 minutes facturables ; 15 minutes restent 15.
2. Une fin antérieure, un champ obligatoire manquant, une date future et un chevauchement sont refusés.
3. Une prestation enregistrée existe après rechargement.
4. Le partenaire ne lit ni ne modifie les prestations d’un autre membre, même en appelant directement l’API.
5. L’administrateur filtre toutes les prestations, exporte et verrouille les lignes facturées.
6. Les exports détaillés et récapitulatifs ont les mêmes totaux que la sélection à l’écran.
7. Une modification concurrente est signalée plutôt qu’écrasée.
8. Les principaux parcours restent accessibles sur PC et téléphone.

## 10. Périmètre de cette livraison

Application fonctionnelle, document d’architecture, guide de démarrage et d’exploitation, contrôles métier et droits, exports CSV. Les tarifs, la TVA, les pièces jointes, l’import automatique de tickets, le chronomètre, le fonctionnement hors connexion et les intégrations ERP restent hors périmètre.
