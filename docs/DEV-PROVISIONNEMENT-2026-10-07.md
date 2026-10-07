# SumaTime 0.4.1 — approche par rôle refusée, non déployée

Ce document conserve la proposition par rôle refusée. Le développement alternatif autorisé ensuite est décrit dans [le compte rendu des attributions Graph](DEV-ATTRIBUTIONS-ENTRA-2026-10-07.md).

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

**Pas de bascule ni d’activation automatique en production.** Le contrôle d’approbation automatique a refusé l’activation faute d’autorisation explicite pour l’extension d’accès. Le propriétaire a ensuite explicitement refusé cette approche : solution jugée insuffisamment mature et blocage sur les rôles personnalisés avec sa licence actuelle. Ce refus remplace la demande d’accord en attente. Ne pas activer la release ni le provisionnement par rôle sans nouvelle autorisation explicite. Le code et la release inactive sont conservés comme travail de développement.

Le contrôle en lecture seule après ce refus confirme : production v0.4.0, Microsoft activé, provisionnement automatique désactivé, un membre, quatorze prestations, table de provisionnement absente. Aucun compte Kiosk créé.

## Piste à étudier, sans activation

Partir des attributions individuelles existantes avec « Accès par défaut », plutôt que demander au propriétaire de créer un rôle. Dans l’application d’entreprise, vérifier « Affectation requise ? = Oui » et le consentement administrateur requis avant tout essai. Microsoft confirme que l’accès par défaut satisfait l’exigence d’attribution lorsqu’aucun rôle nommé n’est exposé ; cette affectation ne fournit pas de claim `roles`. Ne pas remplacer le contrôle du rôle signé par une simple vérification du tenant ou du domaine email : cela pourrait élargir l’accès.

La restriction d’attribution ne s’applique pas aux administrateurs généraux Microsoft. Un modèle reposant uniquement sur cette restriction comporte donc cette exception. Tester avec un utilisateur ordinaire attribué et un autre non attribué ; définir explicitement le traitement de cette exception avant toute création automatique. Aucun mécanisme alternatif n’est développé ou activé à ce stade. L’approche reste à valider et à faire autoriser avant une mise en production.

Références officielles : [accès par défaut et absence de claim roles](https://learn.microsoft.com/en-us/troubleshoot/entra/entra-id/app-integration/error-code-aadsts50105-user-not-assigned-role), [attribution individuelle et licence pour les groupes](https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/what-is-access-management), [affectation requise et exception administrateur général](https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/application-properties).

Retour au code v0.4.0 : désactiver Microsoft avant retour si des utilisateurs ont été provisionnés, car l’ancien code ne contrôle pas leur rôle applicatif. Garder la base courante et utiliser l’administrateur local de secours. Ne pas restaurer une ancienne base au détriment de nouvelles prestations.
