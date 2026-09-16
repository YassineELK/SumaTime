# Recette — Sumatoni Time

Exécutée le 16 septembre 2026 sur Windows, Node 24, runtime Workers local et D1 local. Aucune donnée de test n’a été envoyée à la production.

## Contrôles automatisés

- Vérification TypeScript : réussie.
- Compilation Worker et navigateur : réussie.
- Tests métier `node --test tests/business.test.mjs` : 3 tests réussis (arrondi, dates/heures, protection CSV).
- Recette API `node tests/api-recette.mjs` : **62 assertions réussies**, sur une base locale isolée `.sites-runtime/qa-state`.

La recette API valide : authentification obligatoire ; activation administrateur unique ; unicité des clients ; invitations ; interdiction des actions administratives aux partenaires ; isolation des consultations, modifications, suppressions et exports ; refus des comptes non autorisés ; arrondi 16 → 30 minutes ; nouvel essai idempotent ; chevauchements ; dates invalides/futures ; champs manquants ; heures invalides ; refus des requêtes d’une autre origine ; fin à minuit ; conflit de versions ; CSV détaillé et synthèse cohérents ; neutralisation des formules ; verrouillage et réouverture ; désactivation d’un membre ; conservation de l’administrateur ; archivage d’un client ; limite de période.

Les tests s’exécutent sur le Worker compilé, à l’adresse fixe loopback `http://127.0.0.1:8787`. Les en-têtes d’identité sont injectés exclusivement par le client de recette dans ce serveur local isolé pour simuler plusieurs membres. En production, ces en-têtes sont fournis par la plateforme d’authentification.

La recette complète nécessite une base de test vide. Appliquer les migrations avec Wrangler en utilisant `.sites-runtime/qa-state`, puis démarrer le Worker compilé avec ce même répertoire de persistance et le port 8787. Ne jamais utiliser une base distante ou le répertoire `.wrangler/state` contenant les essais utilisateur pour ce script. Arrêter le serveur de recette avant de recompiler sous Windows.

## Contrôles de l’interface

- Création d’un client fictif local depuis l’interface.
- Préparation puis sauvegarde d’une prestation de 16 minutes ; affichage de 30 minutes facturables et mise à jour du relevé.
- Affichage PC 1440 px et téléphone 390 px : pas de débordement horizontal de la page ; formulaire, filtres, relevé et actions accessibles.
- Export CSV déclenché depuis le menu de l’interface.
- Aucun message d’erreur navigateur observé pendant ce parcours.
- Outils WebMCP : enregistrement des deux outils, lecture du relevé, préparation d’un brouillon valide et rejet d’un client inexistant vérifiés dans le navigateur. La préparation ne sauvegarde aucune prestation.

## Limites explicites

La recette ne remplace pas un test de charge, un audit de sécurité indépendant ou un exercice de restauration. L’authentification et l’accès de partenaires externes sur le site hébergé dépendent de la configuration et des droits de partage Sites. L’application est initialement publiée en accès privé ; le parcours d’un partenaire réel sera possible après son autorisation et l’ouverture de l’accès au site.
