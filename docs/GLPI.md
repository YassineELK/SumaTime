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

Les résultats utilisent les droits et le profil actifs de la session GLPI personnelle. Sumatime active toutes les entités autorisées par ce profil avant la recherche et la validation d’un ticket, sans changer de profil. Être administrateur dans Time ne donne pas les droits d’un autre compte GLPI. Le filtre initial montre les tickets non clos, y compris les tickets résolus (statut 5) ; **Tous les tickets** ou **Inclure les clos** ajoute les tickets clos (statut 6). Chaque page contient au maximum dix tickets. Le jeton n’est jamais renvoyé au navigateur après l’enregistrement.

Dans **Ma connexion GLPI**, déconnecter retire le jeton du compte Time et conserve les prestations. Reconnecter ensuite pour remplacer un jeton expiré ou révoqué. Changer l’adresse API serveur exige de reconnecter chaque compte : les anciens jetons ne sont pas envoyés à la nouvelle adresse.

## Associer les clients

Un administrateur ouvre **Clients → Association GLPI**, puis indique l’identifiant numérique de l’entité correspondant au client. Zéro est valide. Une entité exacte ne peut appartenir qu’à un client Time. Les sous-entités ne sont pas assimilées automatiquement au parent.

Sans correspondance active, le ticket est affiché mais ne peut pas être sélectionné comme référence vérifiée ; associer son entité à un client actif ou choisir explicitement « À compléter plus tard ». Le mode initial est « À distance » ; cocher **Sur site** au besoin. Aucun tarif GLPI n’est importé : les règles et tarifs configurés dans Time s’appliquent.

## Créer et sélectionner des tickets (v0.3)

Activer `GLPI_WRITE_ENABLED=true` dans l’environnement du service pour autoriser **Nouveau ticket GLPI**. La production Sumatoni l’active depuis le 5 octobre 2026. Le compte GLPI personnel doit avoir les droits de création ; l’administration Time ne donne pas de droits supplémentaires dans GLPI.

Associer chaque client actif à son entité GLPI exacte. Les tickets proposés sans association ne peuvent pas être sélectionnés comme références vérifiées. **À compléter plus tard** permet d’enregistrer le temps avant que le ticket soit disponible.

Créer depuis les tickets, la saisie rapide ou le calendrier : client, titre, description, type, catégorie et urgence. Les modèles GLPI peuvent exiger des champs supplémentaires ; compléter directement dans GLPI en cas de refus. **Utiliser ce ticket** conserve les horaires du brouillon.

UUID, réservation, résultat et acquittement sont persistants. Une réponse perdue se récupère avec la même identité ; une réponse fournisseur incertaine bloque le renvoi automatique. Les tables `glpi_creations`, `glpi_creation_aliases` et `glpi_creation_intents` font partie de la base à sauvegarder. La création a été testée sur simulateur ; aucun ticket réel n’a été créé lors du déploiement.

## Données et sauvegardes

La table `glpi_credentials` contient un jeton chiffré AES-256-GCM par membre. Le chiffrement lie le jeton au membre et à l’adresse API. La clé aléatoire de 32 octets est créée dans `glpi-key`, à côté de la base SQLite, lors de la première connexion. Restreindre les ACL NTFS du dossier de données au compte de service et aux administrateurs autorisés.

`npm run db:backup` sauvegarde la base et, lorsqu’elle existe, la clé sous le nom `<sauvegarde>.sqlite.glpi-key`. Conserver la paire dans un emplacement protégé. À la restauration, arrêter Time, restaurer la base selon `INSTALLATION-WINDOWS.md` et remettre la clé correspondante sous le nom `glpi-key` à côté de la base, puis redémarrer. La clé ne remplace pas `.env.local`, qui reste à sauvegarder séparément. Si la clé est perdue, chaque membre doit reconnecter son compte GLPI ; les prestations restent lisibles.

Les requêtes ont un délai global de 15 secondes, une réponse limitée à 2 Mo et refusent les redirections pour ne pas transférer de jetons à une autre adresse. Les sessions GLPI temporaires sont fermées en fin d’opération ; si GLPI est injoignable à ce moment, son expiration de session reste applicable.

## Validation

Recherche, pagination, choix du client, isolation entre utilisateurs, chiffrement, jetons invalides, réponses incohérentes, redirections, délai d’attente et sauvegarde de clé sont testés contre une API GLPI simulée sur une base isolée. La connexion réelle existante est conservée en production. Les essais de création et de récupération utilisent exclusivement un simulateur.

Références officielles : [API REST V1](https://help.glpi-project.org/documentation/modules/configuration/general/api/api), [API V2 et versionnement](https://help.glpi-project.org/documentation/modules/configuration/general/api/restful-api-v2).


## Correctif v0.3.1 — périmètre des entités et statuts

Chaque recherche et validation ouvre une session API personnelle, active les entités autorisées au profil courant avec `changeActiveEntities` et ferme cette session dans `finally`. Le corps `{ "is_recursive": true }` omet `entities_id` : GLPI transforme un identifiant explicitement fourni en entier, y compris la chaîne `"all"`, qui devient 0. L’omission utilise réellement le mode toutes les entités accessibles. Un refus, une réponse invalide ou une erreur HTTP bloque la recherche/validation ; aucun profil Super-Admin n’est sélectionné automatiquement.

La création de tickets conserve son contexte explicite d’entité client et ses contrôles existants. L’association entre client actif et entité GLPI reste obligatoire pour sélectionner et enregistrer un ticket. Le statut Résolu n’est pas un statut Clos : la recherche par défaut exclut uniquement le statut 6.
