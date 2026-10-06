# SumaTime — faisabilité de la connexion Microsoft Entra ID

Étude du 7 octobre 2026. Le propriétaire confirme que les prestataires utilisent des comptes Microsoft 365 Sumatoni et que le SSO GLPI est déjà configuré. Périmètre : ajouter la connexion Entra à SumaTime. Aucun changement GLPI ou Microsoft 365 prévu et aucune configuration Entra modifiée pendant cette étude.

## Conclusion

Intégration réalisable sans refondre le calendrier, les prestations ou la facturation. Le code actuel possède déjà des membres, des rôles et des sessions serveur. Le travail consiste à ajouter une méthode de connexion OIDC et à adapter le modèle des comptes, actuellement limité à local/ldap. Ce n’est pas une application à recommencer.

Expérience souhaitée : bouton « Se connecter avec Microsoft », connexion avec le compte Microsoft 365 Sumatoni, puis accès au même membre et à son historique. La session Microsoft existante peut éviter de ressaisir le mot de passe, selon les politiques MFA et de session du tenant.

## Architecture retenue

Application Entra dédiée à SumaTime, limitée au tenant Sumatoni. Inscriptions et identifiants distincts pour le test et la production. Flux OIDC par code d’autorisation avec PKCE, state et nonce, traité côté serveur par une bibliothèque maintenue. Contrôler signature, tenant, émetteur, audience, expiration et nonce.

Identité durable : couple tenant ID + object ID (tid, oid), rattaché explicitement au member_id existant. Conserver l’historique, les tarifs, forfaits et connexions GLPI personnelles. Ne pas fusionner automatiquement les comptes sur un simple e-mail. Ajouter les identités externes et adapter accounts/getMember/sessions pour Entra ; le fournisseur courant et Mon compte doivent refléter la connexion Microsoft sans proposer de changer un mot de passe Microsoft dans SumaTime.

Rôles actuels conservés : prestataire et administrateur. Accès aux utilisateurs assignés ; aucun administrateur créé automatiquement sur la seule base du domaine e-mail. Garder un administrateur local de secours. Un compte désactivé dans SumaTime reste refusé après connexion Microsoft.

## Prérequis

- Tenant ID Sumatoni et inscription d’application autorisée dans Entra.
- Client ID, URI de retour exacte, configuration serveur et credential applicatif protégé ; préférer un certificat pour la production quand le client retenu le permet.
- Pour une connexion seule : scopes openid/profile/email, sans permission de lecture des mails et sans accès Graph étendu.
- HTTPS reconnu sur les appareils des prestataires. Les adresses peuvent rester privées, atteignables depuis le réseau/VPN ; les navigateurs et le serveur doivent joindre les endpoints Microsoft requis. L’authentification ne remplace pas l’accès réseau.
- Utilisateur pilote et association contrôlée avec son membre existant. Contrôler les licences seulement pour les options supplémentaires retenues : accès conditionnel et assignation par groupes notamment.

## Travail à réaliser

1. Préparer sur CT-ANT un bouton Microsoft et les routes de démarrage/retour OIDC, avec configuration facultative.
2. Ajouter le rattachement d’identité Entra aux membres existants, adapter le compte et les sessions, conserver les droits actuels et le secours local.
3. Configurer l’inscription Entra de test ; vérifier PC/téléphone, session Microsoft réutilisée, MFA, annulation et refus d’un autre tenant/utilisateur non autorisé.
4. Vérifier absence de doublons et conservation des prestations, exports, chrono et connexion API GLPI personnelle.
5. Publier progressivement après sauvegarde avec possibilité de revenir à la connexion actuelle.

Les appels SumaTime vers GLPI continuent d’utiliser leur mécanisme existant de jeton personnel. Ajouter le SSO SumaTime ne les remplace pas implicitement et ne nécessite pas de reconfigurer le SSO GLPI déjà en place.

## Recette et fin d’accès

Tester les claims et retours invalides, les identités non assignées, la désactivation, l’expiration et l’absence de Microsoft. Les sessions SumaTime sont actuellement de 12 heures : retirer un accès Entra bloque les nouvelles connexions mais n’annule pas instantanément un cookie applicatif déjà émis. Définir une durée/renouvellement adaptée et une révocation des sessions locales pour un départ urgent ; mesurer le délai réel.

## Sources officielles

- [Microsoft : tenant et audience de l’application](https://learn.microsoft.com/en-us/entra/identity-platform/single-and-multi-tenant-apps)
- [Microsoft : code d’autorisation et PKCE](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow)
- [Microsoft : identifiants oid/tid et claims](https://learn.microsoft.com/en-us/entra/identity-platform/id-token-claims-reference)
- [Microsoft : URI de retour](https://learn.microsoft.com/en-us/entra/identity-platform/reply-url)

État : étude et préparation du périmètre, connexion Entra SumaTime non implémentée et non activée.
