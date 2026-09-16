# Version 0.2.0 — travailler du point de vue du prestataire

## Objectif métier

Le prestataire doit pouvoir répondre rapidement à trois questions : sur quoi travailler, quel temps enregistrer et qu’est-ce qui manque à son relevé ? La saisie répétitive, la perte d’un brouillon et le mélange entre prix client et rémunération prestataire coûtent du temps et créent des erreurs.

## Parcours retenus

1. **Ma journée** : accueil personnel, temps du jour et de la semaine, répartition quotidienne, interventions récentes et reprise d’un ticket en un clic. Même l’administrateur voit ici ses propres heures.
2. **Chronomètre** : un seul travail en cours par personne, état conservé sur le serveur entre appareils. Arrêter prépare un relevé à vérifier ; rien n’est facturé automatiquement. Enregistrement atomique des journées traversées, prévention des chevauchements et protection contre les doubles clics.
3. **Tickets GLPI** : connexion individuelle à l’API REST V1 de GLPI, recherche et pagination, ouverture du ticket source, préparation du client/ticket/description. Correspondance explicite entre entité GLPI et client local ; aucune attribution devinée. Lecture seule côté GLPI.
4. **Saisie rapide et récupération** : formulaire compact accessible depuis l’accueil, les tickets et les dernières interventions ; conservation d’un brouillon sur l’appareil, associée au compte. Saisie exacte des heures et suggestions au quart d’heure conservées.

## Choix techniques

- Réutiliser Next.js, SQLite, les contrôles de rôles, les règles d’arrondi et les forfaits existants.
- Migrations additives ; sauvegarde avant migration ; tests sur base isolée.
- GLPI configuré par l’exploitant (adresse API et App-Token optionnel). Les jetons personnels sont chiffrés côté serveur et liés à l’adresse GLPI configurée ; jamais renvoyés au navigateur. Les sessions GLPI sont fermées après chaque opération. Pas d’écriture de tâches ou de temps dans GLPI dans cette version.
- Couleurs clients, Poppins et identité Sumatoni conservées ; parcours tactile à 390 px et clavier vérifiés.
- Les tickets consultables sont ceux autorisés par le compte GLPI personnel. L’administration de Time ne donne pas accès aux jetons GLPI des autres membres.

## Recette attendue

Tester permissions et isolation, sauvegarde/reprise du chronomètre, minuit et changements d’heure, conflit de créneau, requêtes rejouées, GLPI indisponible, jeton invalide, pagination/recherche et changement d’adresse serveur. Vérifier les parcours de création, correction, brouillon récupéré et export sur ordinateur et téléphone. La connexion au GLPI réel nécessite les paramètres de l’instance ; les contrats HTTP seront vérifiés contre un serveur GLPI simulé conforme à la documentation officielle.

Références : [API REST V1 GLPI](https://help.glpi-project.org/documentation/modules/configuration/general/api/api), [versionnement GLPI](https://help.glpi-project.org/documentation/modules/configuration/general/api/restful-api-v2).
