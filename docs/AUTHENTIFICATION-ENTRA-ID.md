# SumaTime — connexion Microsoft Entra ID

Version **0.4.0**, déployée sur la production le 7 octobre 2026 à la demande du propriétaire. Le pilote Microsoft utilise désormais l’adresse HTTPS de production ; il attend le secret client puis une connexion réelle. Les données et comptes locaux sont conservés. Aucun changement du SSO GLPI. Voir [le compte rendu de déploiement](DEPLOIEMENT-V0.4.0-2026-10-07.md).

## Comportement livré

Quand les paramètres serveur sont complets et `ENTRA_ENABLED=true`, la page de connexion propose **Se connecter avec Microsoft**. La session Microsoft du navigateur peut être réutilisée ; MFA et accès conditionnel restent décidés par le tenant. **Choisir un autre compte Microsoft** permet de sortir d’une session Microsoft qui ne correspond pas au compte Sumatoni attendu.

Les accès locaux et LDAP restent disponibles. Si Microsoft est désactivé ou mal configuré, son bouton est masqué et l’accès habituel continue de fonctionner. Une indisponibilité Microsoft pendant la connexion revient sur le login avec un message compréhensible. La configuration complète signifie que les paramètres sont renseignés, pas qu’une connexion réelle au tenant a déjà été validée.

Dans **Équipe**, l’administrateur peut rattacher Microsoft à un membre existant, créer un nouveau partenaire Microsoft sans mot de passe SumaTime, ou retirer le rattachement. Les prestations, le rôle, le forfait de déplacement et la connexion API GLPI restent associés au même `member_id`. Aucun compte administrateur n’est créé automatiquement. L’adresse e-mail n’est jamais utilisée pour fusionner automatiquement deux comptes : l’identité autorisée est le couple `tenant_id` + `object_id`. [Référence Microsoft des identifiants](https://learn.microsoft.com/en-us/entra/identity-platform/id-token-claims-reference).

Un membre connecté avec Microsoft ne reçoit pas de formulaire de changement de mot de passe Microsoft. Se déconnecter de SumaTime ne déconnecte pas les mails ou les autres applications Microsoft. Conserver un administrateur local de secours et son mot de passe dans le coffre habituel.

## Architecture et protections

- Client serveur confidentiel, mono-tenant, flux Authorization Code + PKCE S256, scopes `openid profile email`. Aucun appel Graph et aucun refresh token demandé.
- `openid-client` **6.8.8**, signature RS256 du jeton d’identité vérifiée avec les clés JWKS, émetteur exact, audience, expiration, nonce, tenant et Object ID contrôlés.
- `state` aléatoire et code d’autorisation liés à un cookie navigateur HttpOnly / SameSite=Lax. PKCE et nonce conservés côté serveur, dix minutes maximum, consommés une seule fois avant l’échange de code. Un retour rejoué ou provenant d’un autre navigateur est refusé.
- Endpoints limités à HTTPS sur `login.microsoftonline.com`. Aucun paramètre de requête ne peut remplacer le tenant, l’URI de retour ou l’émetteur. Aucun contournement TLS en code applicatif.
- Cookie de session HttpOnly, SameSite=Lax et Secure en HTTPS. Session Microsoft d’une heure par défaut, limitée aussi par l’expiration du jeton ; pas de conservation des jetons Microsoft dans SQLite ou le navigateur.
- Migration additive `0008_entra_auth.sql`. `accounts` local/LDAP reste inchangé. Les tables `entra_identities`, `entra_sessions` et `entra_flows` isolent les nouvelles identités et sessions. `entra_identity_events` trace les rattachements et retraits avec l’administrateur qui les a effectués.
- Rattachements réservés aux administrateurs, protégés contre CSRF et doublons. Une identité Microsoft ne peut appartenir à deux membres. Il faut retirer un ancien rattachement avant de le remplacer.
- Un membre désactivé ne peut pas se reconnecter. Désactivation dans SumaTime et retrait du rattachement coupent les sessions concernées. Une session Microsoft révoquée ne peut jamais redevenir une session locale par simple absence de rattachement.
- Désactiver le connecteur, rendre sa configuration incomplète ou changer de tenant bloque immédiatement les anciennes sessions Microsoft. Les comptes locaux ne dépendent pas de la disponibilité Microsoft.

Supprimer une assignation ou désactiver un utilisateur **seulement dans Entra** n’annule pas instantanément une session SumaTime existante. Elle expire au plus tard après la durée configurée ou l’expiration du jeton. Pour un départ urgent : désactiver aussi le membre dans SumaTime, ou retirer son rattachement. Pas de CAE ni de déconnexion Microsoft globale dans cette première version.

## Paramètres serveur

Dans le fichier d’environnement privé de **développement** :

```dotenv
APP_URL=http://localhost:5173
ENTRA_ENABLED=false
ENTRA_TENANT_ID=<Directory-tenant-ID-Sumatoni>
ENTRA_CLIENT_ID=<Application-client-ID-SumaTime-Dev>
ENTRA_CLIENT_SECRET=<valeur-du-secret>
ENTRA_SESSION_MINUTES=60
```

`APP_URL` doit contenir seulement l’origine, sans chemin, paramètres ou identifiants. HTTPS est exigé hors localhost / loopback. Durée acceptée : 15 à 240 minutes. Secret exclusivement sur le serveur ; ne pas le mettre dans Git, le JavaScript navigateur, une capture d’écran ou une conversation. Protéger les fichiers de configuration et SQLite par les permissions du compte de service. Le premier administrateur doit être créé localement avant toute connexion Microsoft.

L’URI de retour est calculée, sans réglage supplémentaire : **`APP_URL/api/auth/entra/callback`**. En localhost ci-dessus : `http://localhost:5173/api/auth/entra/callback`.

La prévisualisation CT-ANT utilise actuellement `http://192.168.10.131:5174`. Cette adresse HTTP de réseau privé ne convient pas pour activer Microsoft. Pour la recette réelle, prévoir une URL HTTPS de développement reconnue par les appareils, ou un tunnel localhost avec `APP_URL` correspondant. Ne pas activer Entra avec l’adresse HTTP actuelle. La page Équipe permet néanmoins de préparer les rattachements lorsque les identifiants seront connus.

## À préparer dans Microsoft, quand disponible

1. **Entra ID → Inscriptions d’applications → Nouvelle inscription**, nom `SumaTime Dev`, comptes de l’annuaire Sumatoni uniquement. Garder une inscription distincte pour la future production. Relever **ID d’application (client)** et **ID de l’annuaire (tenant)**. [Procédure Microsoft](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app).
2. **Authentification → Ajouter une plateforme → Web**, URI de retour exacte de développement. Ne pas sélectionner SPA, ne pas activer les flux implicites ou le client public. [URI de retour](https://learn.microsoft.com/en-us/entra/identity-platform/reply-url).
3. **Certificats et secrets → Nouveau secret client** : conserver sa **Valeur**, pas son ID ; noter son échéance dans le coffre et prévoir son renouvellement. Ce build utilise un secret client ; l’authentification par certificat applicatif reste une évolution, pas une fonctionnalité implémentée. [Credentials applicatifs](https://learn.microsoft.com/en-us/entra/identity-platform/how-to-add-credentials).
4. Les seuls scopes demandés sont `openid`, `profile`, `email`. SumaTime n’utilise pas `Mail.Read` ou `User.Read`. Respecter la politique de consentement du tenant ; aucune lecture des mails n’est requise.
5. Dans l’application d’entreprise, exiger l’assignation et assigner les utilisateurs pilotes. Consentement administrateur selon cette configuration/politique. L’assignation par utilisateur suffit pour commencer ; les options de groupe dépendent des licences. [Assignations Microsoft](https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/assign-user-or-group-access-portal).
6. **Entra → Utilisateurs → pilote → ID d’objet**. Dans SumaTime **Équipe → membre existant → Rattacher Microsoft**, recopier Tenant ID et cet Object ID. Vérifier le membre choisi : cela détermine l’historique et les droits auxquels le compte Microsoft aura accès.
7. Renseigner l’environnement de développement, mettre `ENTRA_ENABLED=true`, redémarrer **uniquement la prévisualisation**, puis effectuer la recette ci-dessous. Les secrets ne sont jamais demandés dans le chat.

## Recette réelle restant à effectuer

Quand Microsoft sera configuré : connexion du pilote sur PC et téléphone, session Microsoft déjà ouverte, MFA si applicable, choix d’un autre compte, annulation, accès refusé à un utilisateur non rattaché, visibilité limitée du partenaire, même historique qu’en local, calendrier, chrono, export et tickets GLPI. Vérifier la déconnexion SumaTime, l’expiration, le retrait du rattachement et le compte local de secours. Aucune validation réelle Microsoft n’a été revendiquée avec le simulateur.

## Vérifications automatisées

Après compilation, depuis CT-ANT :

```bash
npm run build
npm run test:entra
node --import=tsx --test --test-concurrency=2 tests/*.test.mjs
node tests/run-api.mjs
node tests/run-provider.mjs
```

La recette Entra lance Next sur le port 8788 et un simulateur Microsoft signé RS256 sur 8791, avec une base isolée. Le shim de réseau est importé explicitement dans ce **processus de test seulement** : aucun réglage du serveur applicatif ne permet de rediriger Microsoft vers un fournisseur simulé. Les recettes API / prestataire utilisent 8787 / 8790 et leurs propres bases ; les exécuter séparément si les ports sont occupés.

Les codes d’autorisation sont exclus du journal des requêtes Next en développement. À la future installation derrière un reverse proxy, exclure également les paramètres de la route callback des journaux d’accès du proxy. Les sauvegardes contiennent les rattachements et les sessions : les protéger comme la base. Ne pas transporter `.env`, `data`, les jetons GLPI ou une base dans une archive de release.

Vérifications réalisées le 7 octobre 2026 : build, TypeScript et ESLint ciblé réussis ; **83 tests unitaires / DOM**, **354 contrôles API Entra**, quatre redémarrages de contrôle de disponibilité / tenant / secours local, **199 assertions API métier** et **251 assertions prestataire / GLPI**. Rendus et accès local vérifiés en navigateur à 390 × 844 et 1280 × 900 sur une base de recette distincte.

## État et livraison

Fonctionnalité développée et testée en simulation. Prévisualisation CT-ANT seulement, Entra désactivé en attente de la configuration Microsoft. Aucun déploiement de production effectué. La connexion réelle et la mise en production feront l’objet d’une recette ultérieure après configuration du tenant et validation du propriétaire.
