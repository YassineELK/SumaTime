# Installer Sumatoni Time sur Windows Server

Cette version est autonome. Les comptes locaux sont prêts à l’emploi ; le connecteur Active Directory / LDAP est optionnel. Elle ne requiert aucun compte ChatGPT. Les exemples ci-dessous doivent être adaptés au DNS et au domaine réels.

## 1. Préparer et démarrer

Installer Node.js **24 LTS**, puis placer le projet dans `C:\SumatoniTime`. Utiliser un disque local NTFS, hors OneDrive et hors partage réseau. Le port Node reste lié à la boucle locale ; IIS fournit l’accès des partenaires.

Depuis PowerShell, dans le dossier du projet :

```powershell
npm ci
Copy-Item -LiteralPath .env.example -Destination .env.local
npm run build
npm start
```

`Copy-Item` est à faire seulement lors de la première installation : conserver votre configuration lors des mises à jour. Le démarrage normal ne demande ni Wrangler, ni Docker, ni accès à Sites. Les tables sont initialisées à la première requête. Le fichier SQLite par défaut est `data\timesheet.sqlite`.

Ouvrir `http://127.0.0.1:5173` **sur le serveur**, puis créer l’administrateur avec le code de `data\setup-token.txt`. Choisir soi-même son mot de passe. Le code n’est accepté qu’avant la création du premier compte ; il peut ensuite être supprimé. Aucun mot de passe par défaut n’est livré.

## 2. Accès HTTPS depuis PC et téléphone

1. Créer un nom DNS pour le serveur, par exemple `temps.entreprise.be`, et installer son certificat HTTPS dans IIS.
2. Installer les modules IIS **URL Rewrite** et **Application Request Routing (ARR)** depuis Microsoft. Activer le proxy dans *Application Request Routing Cache → Server Proxy Settings → Enable proxy*.
3. Créer un site IIS avec un répertoire dédié, par exemple `C:\inetpub\sumatoni-proxy`. Ce répertoire ne contient que le fichier `web.config`, copié depuis `deploy\iis-web.config.example`. **Ne pas utiliser le dossier des sources ou de la base comme racine IIS.**
4. Lier ce site au nom DNS exact sur HTTPS 443. Conserver l’authentification anonyme IIS : l’application assure la connexion. Le modèle redirige HTTP vers HTTPS puis relaie les requêtes vers `127.0.0.1:5173`.
5. Dans `.env.local`, définir l’origine publique exacte, sans chemin : `APP_URL=https://temps.entreprise.be`. Redémarrer Node. Toutes les connexions et mutations utilisent ensuite cette URL. Les formulaires ouverts directement sur l’adresse loopback seront refusés lorsque `APP_URL` est l’URL publique : c’est attendu.
6. Autoriser HTTPS dans le pare-feu et le réseau prévu pour les partenaires (LAN, VPN ou publication administrée). Le port 5173 n’a pas à être exposé. Désactiver la mise en cache des réponses dynamiques au niveau du proxy.

Les cookies deviennent `Secure` dès que `APP_URL` est en HTTPS. Le contrôle d’origine ne dépend pas d’en-têtes de proxy fournis par le navigateur. Les fichiers `.env.local`, `data`, les sauvegardes et les certificats privés ne doivent jamais être accessibles par HTTP.

## 3. Démarrage automatique Windows

Après le premier démarrage manuel et sa vérification, arrêter cette instance. Ouvrir PowerShell **en administrateur** et lancer :

```powershell
.\scripts\install-windows-task.ps1
Get-ScheduledTaskInfo -TaskName 'Sumatoni Time'
```

Le script installe une tâche au démarrage Windows sous **Local Service**, sans privilèges administrateur, avec reprise sur échec. Il autorise la lecture du projet et restreint les droits du dossier `data` à Local Service, SYSTEM et Administrateurs. Il refuse de remplacer une tâche existante. Vérifier le fonctionnement après un redémarrage réel du serveur. Ce script n’a pas été exécuté sur votre serveur dans cette livraison.

Restreindre aussi les ACL de `.env.local` et des fichiers de certificat CA à l’exploitant et à Local Service. Avec `DATABASE_PATH` hors du dossier `data`, donner les mêmes droits au dossier choisi ; le script ne modifie pas un chemin externe. Si votre politique impose des scripts signés, signer les scripts selon votre procédure interne.

```powershell
Stop-ScheduledTask -TaskName 'Sumatoni Time'
Start-ScheduledTask -TaskName 'Sumatoni Time'
```

## 4. Activer Active Directory / LDAP

Les comptes locaux fonctionnent avant cette étape. Conserver l’administrateur local comme accès de secours.

Le serveur doit joindre un contrôleur de domaine disposant d’un certificat LDAPS valide. Créer un compte de service en lecture seule pour rechercher les utilisateurs. Configurer `.env.local` :

```dotenv
LDAP_ENABLED=true
LDAP_URL=ldaps://dc01.entreprise.local:636
LDAP_STARTTLS=false
LDAP_BASE_DN=DC=entreprise,DC=local
LDAP_BIND_DN=CN=svc-timesheet,OU=Services,DC=entreprise,DC=local
LDAP_BIND_PASSWORD=REMPLACER_PAR_LE_SECRET_REEL
LDAP_USER_FILTER=(sAMAccountName={{username}})
LDAP_CA_FILE=C:/SumatoniTime/certificates/autorite-interne.pem
```

Le chemin CA est facultatif si l’autorité est déjà approuvée par Node. Fournir la chaîne nécessaire en PEM pour une PKI interne. La vérification TLS n’est jamais désactivée. Pour StartTLS, utiliser `ldap://...:389` et `LDAP_STARTTLS=true` ; un bind en clair est refusé.

Pour limiter l’accès à un groupe AD, on peut utiliser un filtre adapté, par exemple :

```dotenv
LDAP_USER_FILTER=(&(sAMAccountName={{username}})(memberOf=CN=Timesheet,OU=Groupes,DC=entreprise,DC=local))
```

Cet exemple teste l’appartenance directe. Pour OpenLDAP, utiliser le filtre et la base de votre annuaire, par exemple `(uid={{username}})`. Ne pas copier un DN d’exemple sans l’adapter.

Redémarrer l’application, puis dans **Équipe** créer un compte **Active Directory / LDAP** avec le nom, l’e-mail de contact et l’identifiant recherché (`jdupont` dans cet exemple). L’utilisateur saisit cet identifiant et son mot de passe AD à la connexion. Le mot de passe n’est pas conservé dans la base. Un utilisateur de l’annuaire sans compte préautorisé dans Équipe ne peut pas entrer.

La connexion est un bind LDAP, pas une connexion automatique Windows/Kerberos ni Entra ID. Les droits restent ceux de l’application. Un compte désactivé dans AD ne peut plus ouvrir de session ; une session déjà ouverte dure au maximum 12 heures. Pour la fermer immédiatement, désactiver également le membre dans Équipe.

Le connecteur est implémenté et ses protections sont testées, mais la connectivité, les certificats et les filtres doivent être validés contre votre annuaire réel. Aucun identifiant de votre domaine n’a été fourni ou utilisé pendant la recette.

## 5. Sauvegarder, restaurer et mettre à jour

```powershell
npm run db:backup
```

La commande crée une sauvegarde SQLite cohérente dans `backups`, même en mode WAL, puis vérifie l’intégrité. Planifier son exécution et copier les sauvegardes chiffrées hors du serveur selon votre politique. Elles contiennent les prestations et les empreintes de mots de passe : les protéger comme la base. Les exports CSV ne remplacent pas cette sauvegarde.

Restauration : arrêter la tâche Windows, déplacer la base courante **et ses éventuels fichiers `-wal` et `-shm`** dans un dossier de conservation, restaurer la sauvegarde sous le nom configuré, puis redémarrer et vérifier membres, clients, totaux et connexions. Tester d’abord cette opération sur une copie. Ne pas copier seulement le fichier principal d’une base active.

Mise à jour : sauvegarder, arrêter la tâche, mettre à jour les sources en conservant `data` et `.env.local`, exécuter `npm ci` puis `npm run build`, redémarrer et vérifier les totaux et un export. Déployer une seule instance Node contre cette base SQLite ; ne pas distribuer le fichier sur plusieurs serveurs.

## 6. Reprendre les données précédentes

Depuis la version 0.2, les connexions GLPI personnelles utilisent aussi un fichier `glpi-key` à côté de la base. La commande de sauvegarde en crée une copie `<sauvegarde>.sqlite.glpi-key` lorsqu’il existe. Restaurer cette clé sous le nom `glpi-key` à côté de la base correspondante. Protéger cette paire et conserver `.env.local` séparément. Voir [la configuration GLPI et sa restauration](docs/GLPI.md).

La prévisualisation locale a été copiée dans `data\timesheet.sqlite` avec conservation des identifiants. La base d’origine `.wrangler` est intacte. Le premier compte local reprend le membre administrateur existant. Pour un ancien partenaire, créer son compte avec la même adresse e-mail pour conserver ses prestations.

Pour une autre base SQLite compatible, **avant le premier démarrage et avec une destination inexistante** :

```powershell
node scripts/migrate-local.mjs C:/sauvegardes/ancienne-base.sqlite
```

Le script refuse d’écraser une base existante et vérifie les nombres de membres, clients, prestations et l’intégrité. L’ancienne publication `chatgpt.site` reste une application distincte : aucune synchronisation avec ce serveur. Si elle a reçu des saisies réelles, prévoir leur export avant la bascule ; cette livraison a migré seulement les données locales.

## 7. Mot de passe administrateur perdu

Avec un accès autorisé au dossier de données sur le serveur, exécuter :

```powershell
.\scripts\reset-local-password.ps1 -Email admin@entreprise.be
```

La saisie du mot de passe provisoire est masquée ; il n’est pas passé en argument de processus. Toutes les sessions de ce compte sont révoquées. Le compte doit choisir un nouveau mot de passe à sa prochaine connexion. Cette procédure ne modifie pas les comptes LDAP, les rôles ou les prestations. Elle est réservée à l’exploitant du serveur ; les partenaires utilisent la réinitialisation dans Équipe.

## Références techniques

- [Hébergement autonome Next.js](https://nextjs.org/docs/app/guides/self-hosting)
- [Client LDAPts : bind, recherche et TLS](https://github.com/ldapts/ldapts)
- [API SQLite de Node.js](https://nodejs.org/api/sqlite.html)
