# SumaTime — comptes automatiques à partir des attributions Entra

Version 0.4.2 en développement sur CT-ANT, **non déployée en production**. Ce guide remplace la proposition 0.4.1 fondée sur un rôle applicatif, refusée par le propriétaire. Aucun rôle personnalisé à créer pour cette version.

## Fonctionnement pour l’administrateur et le prestataire

Dans **Entra → Applications d’entreprise → SumaTime → Utilisateurs et groupes**, ajouter individuellement une personne avec **Accès par défaut**, comme Kiosk actuellement. À sa première connexion Microsoft, SumaTime vérifie le jeton signé puis lit dans Graph l’attribution de cet Object ID à l’application SumaTime. Une attribution confirmée autorise la création d’un compte **partenaire**, sans mot de passe SumaTime et sans ID utilisateur à saisir.

Le Tenant ID et l’Object ID constituent l’identité stable ; email ou UPN servent seulement au contact. Une adresse déjà utilisée nécessite un rattachement manuel pour éviter une reprise de compte. Les administrateurs SumaTime existants conservent leurs droits. Aucun nouveau compte administrateur n’est créé automatiquement.

## Réglages Microsoft nécessaires, à effectuer avant la recette réelle

1. **Applications d’entreprise → SumaTime → Propriétés → Affectation requise ? = Oui.** Le code le vérifie via Graph. Un réglage différent bloque le mode automatique.
2. **Inscriptions d’applications → SumaTime → Autorisations API → Ajouter une autorisation → Microsoft Graph → Autorisations d’application → Application.Read.All.** Choisir le type Application, pas Déléguée.
3. Accorder le **consentement administrateur** pour Sumatoni. Aucun droit d’écriture d’attribution ni accès aux mails n’est demandé.
4. Conserver les attributions individuelles existantes avec **Accès par défaut**. Vérifier qu’un utilisateur de test ordinaire est attribué et qu’un autre ne l’est pas.
5. L’URI Web de retour de production reste `https://sumatime.home.sumatoni.be/api/auth/entra/callback`. Garder le secret côté serveur, sans le copier dans le chat. La validation réelle sur cette adresse et toute mise en production restent à autoriser séparément.

`Application.Read.All` permet de lire les applications et les principaux de service du tenant : **Microsoft ne limite pas cette permission à SumaTime**. Le code interroge uniquement le principal de service dont l’App ID est configuré, puis ses attributions ; les permissions ne permettent aucune écriture. Ce périmètre de lecture doit être accepté avant activation.

L’attribution individuelle n’utilise pas la fonction d’attribution par groupe P1/P2. Aucun rôle d’administration personnalisé, rôle d’application nommé, licence de boîte mail ou accès aux mails n’est nécessaire à ce mécanisme. Les groupes ne sont pas interprétés par cette version : attribuer chaque utilisateur directement.

## Configuration serveur future

```dotenv
ENTRA_ENABLED=true
ENTRA_ACCESS_MODE=assignment
ENTRA_AUTO_PROVISION=true
ENTRA_SESSION_MINUTES=60
```

Ces valeurs sont une configuration **future**, pas l’état actuel de production. Tenant ID, Client ID et secret continuent d’utiliser les paramètres OIDC existants. L’ID du principal de service de SumaTime est recherché par son Client ID : ne pas utiliser l’Object ID de l’inscription comme ID utilisateur.

Le mode par défaut reste `ENTRA_ACCESS_MODE=manual` et `ENTRA_AUTO_PROVISION=false`, compatible avec la production actuelle. Activer la création automatique en mode manuel est une configuration invalide qui refuse Microsoft plutôt que d’ouvrir les accès.

## Contrôles et révocation

- Chaque nouvelle connexion relit les attributions. Les sessions en cours utilisent un cache de lecture partagé dans le processus, valable au maximum **60 secondes à compter du début de l’observation**.
- Le retrait confirmé de l’attribution bloque le prestataire et supprime ses sessions Microsoft. Le membre, les prestations et les données de facturation sont conservés. Réattribuer permet une nouvelle connexion au même compte ; les anciennes sessions supprimées ne revivent pas.
- Microsoft indique que les attributions peuvent présenter un délai de réplication. Le cache applicatif est de 60 secondes ; le délai total de prise en compte ne peut donc pas être promis strictement égal à 60 secondes. Pour une exclusion urgente, désactiver aussi le membre dans SumaTime.
- Un administrateur général Entra doit aussi être attribué pour accéder en mode `assignment` : la vérification explicite Graph ne reprend pas l’exception d’accès de Microsoft pour les administrateurs généraux.
- Si Graph est indisponible, refuse la permission, répond de façon incomplète, ou si Affectation requise n’est plus Oui : aucune nouvelle création. Après expiration du cache, les API protégées répondent **503**, sans autoriser l’action ni supprimer la session pour une panne temporaire. L’application conserve les formulaires et présente Réessayer ; les accès locaux de secours restent utilisables.
- Pagination complète avant décision. Origine HTTPS fixe, aucun redirect suivi ni jeton envoyé à une URL arbitraire. Requêtes bornées, limite de taille, de pages et de durée. Jetons Graph uniquement en mémoire, pas dans SQLite, le navigateur, les exports ou les logs.
- Création transactionnelle unique, même avec deux premières connexions simultanées. Nom/email changés dans Microsoft ne réécrivent pas le profil existant et aucun claim Admin ne promeut le nouveau partenaire.
- Désactivation ou retrait local du rattachement bloquent l’accès et la recréation involontaire ; une réactivation/réassociation explicite conserve l’identité initiale.
- `ENTRA_AUTO_PROVISION=false` bloque les nouveaux comptes mais laisse les partenaires déjà créés accéder **sous contrôle Graph**, tant que le mode assignment reste actif. Revenir au mode manual ne permet pas aux comptes automatiquement créés de contourner ce contrôle. Les rattachements manuels antérieurs et les comptes locaux/LDAP gardent leur comportement manuel.

La migration `0009_entra_provision.sql` reste additive. Aucun remplacement de base de production par une base de développement. Les comptes automatiques ne reçoivent pas de mot de passe local ; un éventuel accès local distinct reste géré explicitement par l’administrateur.

## Recette à terminer dans le tenant réel avant activation

Tester Kiosk attribué, un utilisateur ordinaire non attribué, une deuxième connexion sans doublon, le retrait et la réattribution, le refus d’une action protégée après retrait, le compte administrateur existant et l’accès local de secours. Comparer les données avant/après. Les tests automatisés utilisent des simulateurs signés et des bases QA isolées ; ils ne remplacent pas la recette réelle avec les permissions du tenant.

## Références Microsoft

- [Attributions d’une application et permission minimale Application.Read.All](https://learn.microsoft.com/en-us/graph/api/serviceprincipal-list-approleassignedto?view=graph-rest-1.0).
- [Représentation de l’accès par défaut sans rôle nommé](https://learn.microsoft.com/en-us/graph/api/resources/approleassignment?view=graph-rest-1.0).
- [Attribution individuelle et licence pour l’attribution par groupe](https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/what-is-access-management).
- [Permission Application.Read.All et consentement administrateur](https://learn.microsoft.com/en-us/graph/permissions-reference#applicationreadall).
- [Affectation requise et exception administrateur général](https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/application-properties).
