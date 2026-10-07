# Création automatique des partenaires via Entra

À partir de SumaTime 0.4.1, un utilisateur autorisé avec le rôle applicatif `SumaTime.Partner` reçoit son compte partenaire à sa première connexion, lorsque `ENTRA_AUTO_PROVISION=true`. Aucun ID utilisateur ni mot de passe local à saisir dans SumaTime. La création et le rattachement utilisent uniquement le Tenant ID et l’Object ID du jeton d’identité signé et validé.

## Configuration Microsoft

1. Entra ID → **Inscriptions d’applications** → Toutes les applications → **SumaTime** → Gérer → **Rôles d’application** → Créer un rôle d’application. Ce menu n’est pas dans Applications d’entreprise.
2. Nom d’affichage : **Partenaire SumaTime**. Types de membres autorisés : **Utilisateurs/groupes**. Valeur exacte : **`SumaTime.Partner`**. Description : **Accès partenaire à SumaTime et création du compte à la première connexion**. Rôle activé, puis appliquer.
3. Entra ID → **Applications d’entreprise** → SumaTime → Utilisateurs et groupes. Affecter ce rôle aux utilisateurs concernés. Une affectation « Accès par défaut » ne transmet pas le rôle attendu ; la modifier/remplacer par **Partenaire SumaTime**.
4. L’attribution individuelle ne nécessite pas l’attribution par groupe. Pour présenter une tuile dans Mes applications, régler **Visible pour les utilisateurs** sur Oui dans les propriétés de l’application d’entreprise. Cette visibilité ne remplace pas l’autorisation.

Microsoft fournit les rôles d’application dans le champ `roles` du jeton d’identité : [documentation officielle](https://learn.microsoft.com/en-us/entra/identity-platform/howto-add-app-roles-in-apps).

## Comportement et protection des comptes

- Les nouveaux comptes ont toujours le rôle **partenaire**. Aucune élévation depuis un rôle nommé Admin dans Entra.
- Les comptes rattachés explicitement par un administrateur gardent leurs droits et leur historique. Le pilote administrateur existant n’est pas recréé ou rétrogradé.
- Pas de compte pour un jeton invalide, un autre tenant, une identité sans le rôle exact ou une création automatique désactivée.
- Adresse mail, ou UPN si le champ mail est absent, utilisée uniquement comme donnée de contact. Aucun accès aux mails ni à Graph ; une licence Microsoft 365/mailbox n’est pas nécessaire pour cette fonction.
- Une adresse déjà présente dans SumaTime exige un rattachement explicite par un administrateur. Pas de fusion automatique ni de reprise d’un compte par email.
- Deux premières connexions simultanées créent un seul membre, une seule identité et un seul événement d’audit `provision`, dans une transaction.
- Une désactivation locale interdit toute nouvelle connexion et coupe les sessions. Un rattachement retiré ne peut pas être recréé automatiquement, même si l’adresse change ; son origine est conservée dans `entra_provisioned_members`.
- Les utilisateurs créés automatiquement doivent présenter le rôle lors de chaque nouvelle connexion. Le retrait de ce rôle dans Entra n’interrompt pas immédiatement une session SumaTime déjà établie : durée d’une heure par défaut, limitée par l’expiration du jeton. Pour un retrait urgent, désactiver aussi le membre dans SumaTime.
- `ENTRA_AUTO_PROVISION=false` bloque les nouvelles créations automatiques ; les membres déjà rattachés continuent de suivre leur politique d’accès. Les comptes locaux et LDAP restent disponibles.

Migration `0009_entra_provision.sql` additive, sans transformation des données existantes. La table d’origine reste présente après un retrait Microsoft pour empêcher une recréation involontaire. L’audit automatique est un événement `provision` attribué au membre qui vient de s’inscrire ; il ne prétend pas être une action manuelle d’administrateur.
