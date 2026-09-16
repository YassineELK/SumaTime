# Connecter GLPI à Sumatoni Time

Le connecteur prépare une prestation à partir d’un ticket : référence GLPI, sujet et client lorsque l’entité est associée. Il utilise le jeton personnel du prestataire. Il ne crée ni tâche, ni suivi, ni temps dans GLPI ; les relevés et la facturation restent dans Time.

## Préparer le serveur

Activer dans GLPI l’API REST **V1 / historique** et l’authentification par jeton utilisateur. Déclarer un client API pour le serveur Time et autoriser son adresse IP, selon la configuration GLPI. Utiliser une version GLPI maintenue. Le connecteur vise le contrat REST V1 de GLPI 10 et l’API historique de GLPI 11 ; il n’utilise pas OAuth ni l’API V2.

Dans `.env.local` sur Windows Server :

```dotenv
GLPI_API_URL=https://glpi.entreprise.be/apirest.php
GLPI_APP_TOKEN=jeton_application_si_requis_par_glpi
```

Pour une instance dont l’API historique est exposée via `api.php/v1`, utiliser cette URL complète à la place. Le lien « Ouvrir dans GLPI » est déduit de ces chemins canoniques. Les réécritures d’URL personnalisées ne sont pas prises en charge.

Redémarrer le service ou la tâche Windows de Time. La connexion se fait depuis **le serveur**, pas depuis le navigateur. Vérifier DNS, pare-feu sortant et certificat HTTPS. Pour une autorité interne, déclarer son certificat PEM dans `NODE_EXTRA_CA_CERTS` dans l’environnement de démarrage Node, puis redémarrer. La validation TLS reste active. HTTP est accepté uniquement sur la boucle locale pour les tests.

## Connecter un prestataire

1. Ouvrir **Mes tickets GLPI** dans Time.
2. Récupérer le jeton API personnel dans les préférences du compte GLPI, ou demander à l’administrateur GLPI d’autoriser sa génération.
3. Saisir le jeton et cliquer **Connecter mon compte GLPI**.
4. Rechercher un numéro ou un titre, puis choisir **Saisir du temps** ou **Chrono**.

Les résultats utilisent les droits, le profil et l’entité actifs de la session GLPI personnelle. Être administrateur dans Time ne donne pas les droits d’un autre compte GLPI. Le filtre initial montre les tickets ouverts ; **Tous les tickets** inclut les tickets résolus et clos. Chaque page contient au maximum dix tickets. Le jeton n’est jamais renvoyé au navigateur après l’enregistrement.

Dans **Ma connexion GLPI**, déconnecter retire le jeton du compte Time et conserve les prestations. Reconnecter ensuite pour remplacer un jeton expiré ou révoqué. Changer l’adresse API serveur exige de reconnecter chaque compte : les anciens jetons ne sont pas envoyés à la nouvelle adresse.

## Associer les clients

Un administrateur ouvre **Clients → Association GLPI**, puis indique l’identifiant numérique de l’entité correspondant au client. Zéro est valide. Une entité exacte ne peut appartenir qu’à un client Time. Les sous-entités ne sont pas assimilées automatiquement au parent.

Sans correspondance active, le ticket reste utilisable, mais le prestataire doit choisir le client avant d’enregistrer ou de démarrer le chronomètre. Le mode initial est « À distance » ; cocher **Sur site** au besoin. Aucun tarif GLPI n’est importé : les règles et tarifs configurés dans Time s’appliquent.

## Données et sauvegardes

La table `glpi_credentials` contient un jeton chiffré AES-256-GCM par membre. Le chiffrement lie le jeton au membre et à l’adresse API. La clé aléatoire de 32 octets est créée dans `glpi-key`, à côté de la base SQLite, lors de la première connexion. Restreindre les ACL NTFS du dossier de données au compte de service et aux administrateurs autorisés.

`npm run db:backup` sauvegarde la base et, lorsqu’elle existe, la clé sous le nom `<sauvegarde>.sqlite.glpi-key`. Conserver la paire dans un emplacement protégé. À la restauration, arrêter Time, restaurer la base selon `INSTALLATION-WINDOWS.md` et remettre la clé correspondante sous le nom `glpi-key` à côté de la base, puis redémarrer. La clé ne remplace pas `.env.local`, qui reste à sauvegarder séparément. Si la clé est perdue, chaque membre doit reconnecter son compte GLPI ; les prestations restent lisibles.

Les requêtes ont un délai global de 15 secondes, une réponse limitée à 2 Mo et refusent les redirections pour ne pas transférer de jetons à une autre adresse. Les sessions GLPI temporaires sont fermées en fin d’opération ; si GLPI est injoignable à ce moment, son expiration de session reste applicable.

## Validation

Recherche, pagination, choix du client, isolation entre utilisateurs, chiffrement, jetons invalides, réponses incohérentes, redirections, délai d’attente et sauvegarde de clé sont testés contre une API GLPI simulée sur une base isolée. L’instance réelle n’a pas été connectée : l’adresse et les jetons ne sont pas disponibles dans ce projet.

Références officielles : [API REST V1](https://help.glpi-project.org/documentation/modules/configuration/general/api/api), [API V2 et versionnement](https://help.glpi-project.org/documentation/modules/configuration/general/api/restful-api-v2).
