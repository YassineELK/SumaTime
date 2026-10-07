# SumaTime 0.4.1 — provisionnement automatique prêt pour revue

Le propriétaire souhaite que les personnes autorisées dans Entra disposent automatiquement d’un compte SumaTime. La fonctionnalité est développée sur CT-ANT, branche `codex/entra-login`, commit `0d5c30d6b9824627c1f4620075e2c7ff80bd82a7`.

## Périmètre précis

Avec `ENTRA_AUTO_PROVISION=true`, une première connexion avec un jeton Microsoft valide du tenant configuré et le rôle exact `SumaTime.Partner` crée un partenaire. Les personnes uniquement affectées à « Accès par défaut » ne sont pas provisionnées. Jamais d’admin automatique, jamais de fusion par email. Les comptes et rôles existants restent conservés. Le retrait local du rattachement interdit une recréation, même après changement d’adresse ; le retrait du rôle Entra est contrôlé à chaque nouvelle connexion. Les sessions existantes restent limitées à leur expiration habituelle.

Le réglage Microsoft se fait dans **Inscriptions d’applications → SumaTime → Rôles d’application**. Les rôles d’application sont distincts des rôles personnalisés d’administration du répertoire, lesquels demandent une licence Premium. L’attribution individuelle à une application est disponible sans l’attribution par groupe, cette dernière nécessitant P1/P2. Références : [RBAC d’application](https://learn.microsoft.com/en-us/entra/identity-platform/custom-rbac-for-developers), [gestion des accès aux applications](https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/what-is-access-management).

## Preuves

- 83 tests unitaires/DOM.
- 369 contrôles Entra avec création automatique désactivée, puis 135 contrôles dédiés avec rôle signé et provisionnement activé.
- Concurrence, absence de rôle, rôle invalide, autre tenant, mauvaise signature, expiration, collision avec un compte existant, UPN sans mailbox, désactivation et révocation vérifiés.
- 199 assertions API métier et 251 prestataire/GLPI ; build, TypeScript, lint ciblé réussis.
- Runtime exact démarré sur une copie privée de la base de production : toutes les tables et sessions précédentes conservées, intégrité conforme ; une nouvelle table vide additive.
- Build `kaZcf0B4-oUekhAmlPz_y`, archive SHA-256 `c62c2cbef05534a1f7610a24684f9ed7044793eec7adf94e926fd36876b14f56`, 2 559 fichiers vérifiés.
- Release inactive préparée : `/opt/sumatoni-time/releases/v0.4.1`. Preuves privées : `/root/sumatoni-deploy/v0.4.1-20261007/`.

## État

**Pas de bascule ni d’activation automatique en production.** Le contrôle d’approbation automatique a refusé l’activation : l’autorisation explicite pour l’extension d’accès et son périmètre doit être confirmée par le propriétaire. Une demande précisant la création uniquement de partenaires avec le rôle `SumaTime.Partner` a été présentée. La production reste v0.4.0, avec un membre et quatorze prestations lors du contrôle, accès Microsoft et local existants conservés. L’inscription du rôle Microsoft est aussi en cours côté propriétaire.

Après accord : sauvegarde fraîche avant bascule, migration additive, comparaison des données et contrôle HTTPS, puis activation du provisionnement pour le rôle signé. Le compte Kiosk devra recevoir ce rôle et se reconnecter ; aucun ID manuel à saisir dans SumaTime.

Retour au code v0.4.0 : désactiver Microsoft avant retour si des utilisateurs ont été provisionnés, car l’ancien code ne contrôle pas leur rôle applicatif. Garder la base courante et utiliser l’administrateur local de secours. Ne pas restaurer une ancienne base au détriment de nouvelles prestations.
