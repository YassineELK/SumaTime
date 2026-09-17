# Déploiement Sumatoni Time — 17 septembre 2026

## Résultat

Version 0.2.1 installée sur Ubuntu 24.04 LXC, serveur `192.168.87.224`, accessible sur **https://sumatime.home.sumatoni.be**. Base vierge confirmée : aucun membre, compte, client, prestation, déplacement, chronomètre ni identifiant GLPI. Le propriétaire a explicitement choisi une nouvelle installation ; aucune base locale n'a été copiée. Le premier administrateur reste à créer depuis l'écran d'installation avec le code privé du serveur.

## Vérifications effectuées

- Compilation Next.js de production et validation TypeScript réussies sur le serveur cible.
- 15 tests unitaires, 184 assertions API et 128 assertions prestataire réussis sur bases isolées.
- Connecteur GLPI testé contre une API simulée : requêtes en lecture seule, sessions refermées ; aucune connexion à l'instance GLPI réelle.
- Audit npm des dépendances de production : zéro vulnérabilité signalée après correction ciblée de `baseline-browser-mapping` vers 2.11.24.
- Nginx : configuration valide, redirection HTTP vers HTTPS, certificat autosigné contrôlé avec son certificat public et validation du nom d'hôte.
- Accès depuis le poste Windows par le DNS normal : `/login` répond HTTP 200 en environ 0,7 seconde lors du contrôle final. Aucun contournement de la validation TLS utilisé.
- API métiers refusées sans session, requête d'une autre origine refusée, chemin `/.env` inaccessible, en-têtes de protection présents.
- Service applicatif non privilégié ; écoute du port 5173 limitée à l'interface loopback.
- Arrêt forcé du processus principal par SIGKILL, puis reprise automatique systemd constatée et endpoint accessible. Le redémarrage complet du conteneur n'a pas été testé.
- Première sauvegarde exécutée via le service de production. Empreintes du manifeste vérifiées, copie restaurée dans un emplacement isolé, contrôle d'intégrité SQLite réussi, compteurs comparés et écriture dans la copie restaurée réussie.
- Application, Nginx et timer de sauvegarde activés au démarrage. Prochaine sauvegarde annoncée lors du contrôle : 18 septembre 2026 à 02:18 UTC.
- Contrôle DNS complémentaire du 17 septembre : réponses valides de `192.168.10.111` en UDP et TCP depuis Ubuntu. Après redémarrage du résolveur resté sur le DNS public de secours, `resolvectl` et `getent` résolvent le site vers `192.168.87.224`. Résolution externe et accès HTTPS par nom vérifiés (HTTP 200, certificat validé). Le problème DNS initial est résolu.

## Points d'exploitation encore ouverts

1. **Confiance HTTPS et renouvellement** : installer le certificat public sur les appareils autorisés ; expiration le 17 septembre 2027. Aucun renouvellement automatique du certificat autosigné.
2. **Sauvegardes hors serveur** : sauvegarde locale quotidienne activée ; stockage externe, rétention et alertes restent à définir.
3. **Infrastructure** : mises à jour Ubuntu préexistantes en attente et échec préexistant de `proxmox-regenerate-snakeoil.service`. Des attentes disque importantes ont été observées pendant les installations et les tests ; vérifier le stockage Proxmox avant d'augmenter la charge. La mémoire disponible était suffisante.
4. **AD et GLPI réels** : configuration et recette avec l'infrastructure du propriétaire encore nécessaires. Les comptes locaux sont opérationnels.

Procédures, emplacements et empreinte du certificat : [installation Linux](../INSTALLATION-LINUX.md).
