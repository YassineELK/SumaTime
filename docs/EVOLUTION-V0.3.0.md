# Version 0.3 — calendrier et création GLPI

Développement sur CT-ANT, branche `codex/calendar-glpi-v0.3`. Production indépendante.

- Le calendrier permet de supprimer une prestation avec confirmation, de la déplacer et de redimensionner ses bornes. Les flèches des poignées permettent aussi ces modifications au clavier. Un déplacement peut être annulé tant que la version de la prestation n'a pas changé.
- Les gestes appliquent des deltas de 15 minutes et préservent les minutes déjà saisies. Les formulaires acceptent toujours HH:MM à la minute. La facturation manuelle conserve l'arrondi supérieur par prestation.
- Le chrono propose son début au quart inférieur et sa fin au quart supérieur, secondes comprises. Exemple validé : 09:07–10:22 devient 09:00–10:30. Les horaires restent modifiables avant enregistrement. Le passage de minuit crée des journées séparées ; les changements d'heure ambigus restent signalés.
- Nouveau ticket GLPI depuis les tickets, la saisie rapide et le calendrier : client associé, titre, description, type, catégorie et urgence. Les droits GLPI personnels et les règles du modèle GLPI s'appliquent.
- Activer explicitement `GLPI_WRITE_ENABLED=true` dans un environnement autorisé. Sans ce paramètre, les créations sont refusées côté serveur. La session GLPI sélectionne l'entité exacte du client avant création.
- Les demandes de création ont un identifiant persistant. Une réponse réussie est réutilisée pour un nouvel essai identique ; une réponse incertaine après envoi bloque le renvoi automatique. Vérifier dans GLPI avant toute nouvelle demande. Les refus explicites permettent de corriger le formulaire.
- Nouvelle table `glpi_creations`, initialisée automatiquement et incluse dans les sauvegardes SQLite. Aucune modification des anciennes prestations.

La prévisualisation utilise une copie autorisée des données métier ; sessions, jetons GLPI et chronomètres actifs sont retirés. Les essais de création utilisent un GLPI simulé et ne créent aucun ticket réel. Le compte existant peut utiliser son mot de passe habituel sur cette copie.

Référence : https://github.com/glpi-project/glpi/blob/10.0/bugfixes/apirest.md#add-items

Validation : résultats à compléter après la recette API et navigateur.
