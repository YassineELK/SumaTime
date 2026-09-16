# Sumatoni Time — Architecture et besoins métier

Version 3 · 16 septembre 2026 · Windows Server, comptes locaux et AD / LDAP

## 1. Objectif métier

Enregistrer les prestations de l’administrateur et de ses partenaires depuis un PC ou un téléphone, puis obtenir un relevé fiable pour préparer la facturation. La saisie doit rester courte : client, référence du ticket, date, heure de début et heure de fin. Une description facultative permet de justifier l’intervention.

Décisions confirmées : droits distincts ; l’administrateur voit toutes les prestations ; arrondi au quart d’heure supérieur. L’arrondi s’applique **à chaque prestation**, avant agrégation. Exemple : 09:00–09:16 représente 16 minutes réelles et 30 minutes facturables. Les heures originales sont conservées.

## 2. Parcours et facilité d’utilisation

L’écran d’accueil est un espace de travail : saisie immédiatement accessible, total de la période, liste des prestations et filtres. Date du jour proposée, champs horaires natifs adaptés au téléphone, durée calculée avant enregistrement. Les erreurs sont explicites et ne vident pas le formulaire. Une sauvegarde confirmée signifie une écriture dans la base partagée.

Sur PC, formulaire et relevé sont visibles côte à côte ; sur téléphone, ils s’empilent, la navigation reste accessible et les lignes deviennent des cartes. Les boutons ont une cible tactile suffisante, les champs ont un libellé, la navigation clavier reste possible. Aucune information essentielle ne dépend uniquement d’une couleur.

Le démarrage se fait dans une base vide. L’administrateur crée ses clients et autorise ses partenaires par adresse e-mail. Aucun exemple fictif n’est mélangé aux prestations réelles.

## 3. Droits et identité

| Action | Partenaire | Administrateur |
|---|---|---|
| Consulter les clients actifs | Oui | Oui |
| Créer une prestation | Pour soi | Pour soi |
| Consulter / exporter les prestations | Les siennes | Toutes |
| Corriger / supprimer une prestation non facturée | Les siennes | Toutes |
| Marquer facturé / rouvrir | Non | Oui |
| Gérer les clients et partenaires | Non | Oui |

Authentification locale par e-mail et mot de passe, ou AD / LDAP activable sur le serveur. Aucun compte ChatGPT requis. Le premier administrateur est créé avec un code aléatoire conservé sur le serveur. Aucune inscription publique ; l’administrateur crée les partenaires. Le mot de passe provisoire d’un partenaire local doit être changé avant l’accès aux données.

Les mots de passe locaux sont hachés avec scrypt et sel aléatoire. Sessions opaques de 12 heures, jetons hachés en base, cookie HttpOnly / SameSite=Lax / Secure en HTTPS. Déconnexion, réinitialisation et désactivation révoquent les sessions. Limitation persistante des tentatives par identifiant et globale. Les en-têtes d’identité de l’ancienne plateforme ne sont plus acceptés.

Le connecteur annuaire effectue un bind de service, une recherche d’un utilisateur unique puis un bind avec son mot de passe. LDAPS ou StartTLS obligatoire, vérification du certificat et délais limités. Les filtres échappent les identifiants. Les comptes sont préautorisés avec leur identifiant AD explicite : aucune association automatique par e-mail, aucun rôle administrateur attribué par l’annuaire. Le compte administrateur local reste indépendant de l’AD. Les comptes AD désactivés dans l’annuaire ne peuvent plus ouvrir de session ; une session existante expire sous 12 heures ou peut être révoquée immédiatement par désactivation dans l’application. Il s’agit d’une connexion identifiant/mot de passe AD, pas d’un SSO Kerberos ou Entra ID.

## 4. Règles de gestion

- Client actif, ticket non vide, date et heures obligatoires.
- Date et heures interprétées comme heures locales de Bruxelles ; stockage textuel ISO et minutes entières, sans conversion implicite par le fuseau du téléphone.
- Prestations limitées à une journée civile ; une intervention passant minuit est saisie en deux lignes. Fin strictement postérieure au début. Pas de date future.
- Les heures ambiguës des changements saisonniers ne représentent pas une durée chronométrique : l’application facture la différence entre heures civiles saisies. À signaler dans le guide.
- Durée réelle = fin − début ; durée facturable = plafond(durée / 15) × 15.
- Chevauchement des prestations d’une même personne refusé, y compris lors d’une modification ; contrôlé dans l’écriture SQL pour éviter les courses concurrentes.
- Une prestation facturée est verrouillée. L’administrateur peut la rouvrir explicitement. Exporter ne marque pas automatiquement facturé.
- Les clients se désactivent sans effacer leur historique. Les partenaires se désactivent sans effacer leurs prestations. L’administrateur initial ne peut pas se retirer son accès.
- Chaque modification utilise une version pour refuser l’écrasement d’une modification concurrente.

## 5. Exports pour la facturation

CSV UTF-8 avec BOM, séparateur point-virgule, décimales françaises, compatible avec une ouverture dans Excel. Export détaillé : identifiant de prestation, client, ticket, partenaire, date, début, fin, description, minutes réelles, minutes facturables, heures facturables et état de facturation. Export récapitulatif : total par client et partenaire. Les deux respectent la période et les filtres affichés, ainsi que les droits côté serveur.

Protection des cellules contre l’interprétation comme formules. Les totaux additionnent les minutes facturables de chaque ligne. Il s’agit d’un relevé de préparation : tarifs horaires et forfaits en euros configurables, sans calcul de TVA, de génération de facture légale ou d’intégration comptable dans cette version.

## 6. Architecture technique

Navigateur responsive → IIS HTTPS → application React / Next.js sur Node.js 24 → API même origine → SQLite sur disque local Windows. Le processus Node écoute uniquement sur 127.0.0.1:5173. Une tâche Windows sous Local Service permet le démarrage au boot. Les données métier sont conservées côté serveur et disponibles depuis les différents appareils. Pas de données métier stockées exclusivement dans le navigateur.

Le serveur vérifie l’identité, l’appartenance et le rôle à chaque requête. Les écritures contrôlent aussi l’origine de la requête. Requêtes SQL préparées ; validation serveur des longueurs, types, heures et statuts. Les réponses privées ne doivent pas être mises en cache. Les erreurs internes ne révèlent pas les données ou la configuration.

## 7. Modèle de données

| Entité | Données principales |
|---|---|
| members | identifiant métier stable, e-mail unique, nom, rôle, actif ; ancien user_id conservé uniquement pour compatibilité |
| accounts | membre, identifiant de connexion unique, fournisseur local/ldap, hash local et changement obligatoire |
| sessions | hash du jeton, membre, expiration |
| login_limits | clé de limitation, nombre de tentatives, échéance |
| clients | identifiant, nom unique, actif |
| entries | identifiant, membre, client, ticket, date, début/fin en minutes, description, état, version, dates de création/modification |

Durées calculées à partir des heures d’origine pour éviter les incohérences. Index sur membre/date et date/client pour les consultations ; clés étrangères pour protéger les liens. Le schéma métier initial reste dans drizzle/0000_spotty_luminals.sql. Le serveur initialise les tables manquantes et ajoute de manière idempotente accounts, sessions et login_limits. Les migrations suivantes devront préserver les données et être précédées d’une sauvegarde.

## 8. Fiabilité et exploitation

L’application nécessite une connexion au serveur (réseau interne, VPN ou HTTPS). En cas d’erreur de sauvegarde, les champs restent présents et un nouvel essai est possible. Les lectures sont limitées à une période de 366 jours maximum pour garder des exports et temps de réponse raisonnables. Les identifiants d’écriture uniques empêchent un double enregistrement involontaire.

Le code, les migrations et le guide sont livrés avec le produit. La persistance est assurée par SQLite en mode WAL sur disque local, avec clés étrangères et transactions. Une commande de sauvegarde cohérente avec vérification d’intégrité est fournie. L’exploitant fixe la rétention, une copie hors serveur et teste la restauration. Ne pas placer la base active sur un partage réseau ou dans un dossier synchronisé. Les exports réguliers donnent une copie métier portable, mais ne remplacent pas une sauvegarde complète.

## 9. Critères de recette

1. Une prestation de 16 minutes affiche et exporte 30 minutes facturables ; 15 minutes restent 15.
2. Une fin antérieure, un champ obligatoire manquant, une date future et un chevauchement sont refusés.
3. Une prestation enregistrée existe après rechargement.
4. Le partenaire ne lit ni ne modifie les prestations d’un autre membre, même en appelant directement l’API.
5. L’administrateur filtre toutes les prestations, exporte et verrouille les lignes facturées.
6. Les exports détaillés et récapitulatifs ont les mêmes totaux que la sélection à l’écran.
7. Une modification concurrente est signalée plutôt qu’écrasée.
8. Les principaux parcours restent accessibles sur PC et téléphone.

## 10. Périmètre de cette livraison

Application fonctionnelle, document d’architecture, guide de démarrage et d’exploitation, contrôles métier et droits, exports CSV. La TVA, les pièces jointes, l’import automatique de tickets, le chronomètre, le fonctionnement hors connexion et les intégrations ERP restent hors périmètre.

## 11. Évolution : saisie par calendrier

La vue d’accueil devient un calendrier hebdomadaire sur PC, avec une journée sélectionnée sur téléphone. Une grille de 96 créneaux par jour permet une sélection de durée par multiples de 15 minutes. Le clic-glissé à la souris, deux appuis tactiles ou la navigation clavier ouvrent une fenêtre accessible avec client, ticket, date, horaires et description. Le relevé et ses exports restent accessibles dans Prestations.

Le calendrier recharge uniquement la semaine affichée et respecte les mêmes droits côté serveur. Il affiche le calendrier personnel par défaut ; l’administrateur peut sélectionner un partenaire ou toute l’équipe. Les blocs simultanés sont disposés côte à côte. La création reste attribuée au membre connecté ; une modification conserve le propriétaire initial. Les blocs facturés sont consultables en lecture seule.

Cette évolution réutilise l’API existante : pas de nouvelle table, de migration de données ou de modification des règles de facturation. Les sélections utilisent les heures civiles de Bruxelles ; les dates sont calculées sans dépendance au fuseau de l’appareil. Les heures exactes des prestations déjà enregistrées sont conservées. Les contrôles de chevauchement et de version restent autoritaires sur le serveur.

## 12. Migration et exploitation Windows

La base locale précédente est copiée avec l’API de sauvegarde SQLite, puis vérifiée par comptage et intégrité. Les identifiants de membres et prestations restent inchangés ; l’ancien fichier est conservé. Lors de la première activation, le compte local récupère le membre administrateur existant. Les anciens partenaires doivent recevoir un compte avec la même adresse pour conserver leur identité métier.

La version autonome remplace l’architecture Sites. L’ancienne publication cloud reste indépendante et n’est pas synchronisée ; exporter ses données si elle a été utilisée avant une bascule. Aucune publication de données métier ou de mots de passe n’est faite vers cette plateforme. Installation, HTTPS IIS, AD et sauvegardes : voir INSTALLATION-WINDOWS.md.

## 13. Mode de prestation et confidentialité de l’export client

Migration additive : entries.on_site est nullable pour préserver l’incertitude historique, puis explicitement enregistré pour les nouvelles lignes. La case est disponible dans les deux formulaires. Les anciennes lignes restent à confirmer ; elles ne sont jamais classées automatiquement à distance. La validation, l’idempotence et le verrouillage de facturation incluent le mode.

L’export client est construit côté serveur avec une liste blanche de quatre champs : date, début, fin, mode. Aucun nom, ID, ticket, description, montant ou autre champ n’est repris. Il exige un seul client et des modes confirmés, respecte les droits et les filtres, et trie les horaires chronologiquement. L’export interne reste distinct.

## 14. Tarifs horaires et forfaits prestataires

clients porte un tarif standard et une dérogation sur site ; members porte un forfait de déplacement. Montants stockés en centimes entiers, saisie décimale validée, absence de montant distincte de zéro. L’administrateur seul configure ces valeurs. Les tarifs de clients non concernés ne sont pas exposés dans le répertoire des partenaires.

Chaque prestation conserve son tarif horaire applicable. Le montant est la durée facturable multipliée par le tarif et arrondie au centime par ligne. La table travel_days, clé unique membre/client/date, conserve le forfait de la combinaison dès sa première prestation sur site. L’écriture de la prestation et du forfait journalier est transactionnelle. Les corrections ordinaires et les changements de configuration ne revalorisent pas rétroactivement les prestations.

Le forfait est présenté une seule fois, sur la première ligne sur site enregistrée du jour/client/membre. Les filtres s’appliquent ensuite : une extraction partielle peut masquer cette ligne et donc le forfait ; l’interface et le guide le signalent. Une deuxième journée, un deuxième client ou un deuxième prestataire constituent un autre forfait. Sans prestation sur site restante, aucun forfait n’est affiché. La valeur enregistrée pour la combinaison reste conservée en cas de nouvelle saisie sur ce même jour/client/membre.

Les exports détaillés et de synthèse fournissent séparément montant des prestations, nombre de déplacements et forfait prestataire. Le forfait n’est pas facturé au client automatiquement. Aucune TVA ou facture comptable n’est produite. Le fichier destiné au client reste limité aux horaires et au mode.

## 15. Rapprochement des factures partenaires

L’export CSV `partner` exige un membre précis pour un administrateur ; un partenaire n’accède qu’à son propre relevé. La période et le filtre client sont respectés. Les recherches libres et filtres de statut sont refusés pour ne pas masquer une ligne portant le forfait journalier ; le statut existant concerne la facturation au client, pas le règlement du prestataire.

Le relevé contient les données opérationnelles, le temps réel, le temps arrondi par prestation, les déplacements et leurs montants, puis une ligne de total. Il ne reprend aucun tarif de vente client. Il ne suppose pas de tarif horaire d’achat prestataire. Un forfait absent ou un mode historique inconnu est signalé, et le total monétaire des déplacements reste vide tant que ces données ne sont pas complètes. Exporter ne modifie ni les prestations ni leur statut. Aucun changement de schéma n’est nécessaire.

## 16. Identité Sumatoni

L’application reprend la police Poppins, les logos originaux et la palette du site public Sumatoni, référence confirmée par l’utilisateur. Les composants de marque sont communs à la navigation, au pied de page et à la connexion. Les fichiers de police et logos sont servis localement pour une installation Windows autonome. Les origines, licences, couleurs et choix de lisibilité figurent dans `docs/CHARTE-SUMATONI.md` ; les styles de marque sont centralisés dans `app/brand.css`.

## 17. Couleur par client

Migration additive `0004_client_color.sql` : couleur nullable sur `clients`, au format strict `#RRGGBB`, normalisée en majuscules par l’API. Seul un administrateur peut modifier ce réglage partagé ; les partenaires reçoivent la couleur en lecture avec le répertoire clients. Valeur nulle = styles Sumatoni par défaut. Le calendrier utilise la couleur actuelle du client pour les anciennes et nouvelles prestations, sans modifier les enregistrements de temps. L’application affiche un fond teinté clair, une bordure colorée et un texte foncé ; la facturation reste identifiée par un cadenas. Aucun changement dans les exports.

## 17. Espace prestataire et intégration GLPI

La version 0.2 ajoute les parcours documentés dans [Évolution prestataire](docs/EVOLUTION-V0.2.0.md). L’accueil est personnel même pour l’administrateur ; les données de vente ne sont pas exposées aux partenaires par l’API workday.

La migration 0005 ajoute work_timers (un chronomètre par membre), timer_receipts (rejeu idempotent après enregistrement), glpi_credentials (jeton personnel chiffré) et clients.glpi_entity_id (association unique nullable). Les migrations sont exécutées au démarrage par db/raw.ts ; les schémas Drizzle historiques ne pilotent pas le déploiement. Ne pas utiliser db:generate pour appliquer ces migrations opérationnelles.

Le chronomètre utilise des instants serveur, convertis en heures civiles Europe/Brussels. Les intervalles englobent les minutes réelles. Les jours traversés sont enregistrés dans une seule transaction après vérification ; un conflit annule toutes les écritures. Un changement d’heure ou une durée supérieure à 24 heures impose une saisie manuelle. Le tarif et le forfait sont repris au moment de l’enregistrement ; les règles de verrouillage et de forfait journalier restent communes au relevé.

La saisie rapide conserve un brouillon localStorage par membre. Il n’est pas synchronisé ni une sauvegarde serveur. Le chronomètre, au contraire, persiste en SQLite et peut être retrouvé sur un autre appareil après connexion.

Le connecteur GLPI est configuré uniquement côté serveur et utilise l’API historique V1 en lecture seule. Chaque demande ouvre une session avec le jeton personnel, respecte les droits GLPI et ferme la session. Les secrets sont liés au membre et à l’URL via AES-GCM. La clé glpi-key est sauvegardée avec la base. La procédure, les limites et la validation du contrat HTTP sont précisées dans [GLPI](docs/GLPI.md).
