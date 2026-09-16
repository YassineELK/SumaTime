# Recette — Sumatoni Time autonome

Exécutée le 16 septembre 2026 sous Windows, Node.js 24.14.1, Next.js 16.3.4 et SQLite. Les essais utilisent une base neuve dans un dossier accounts-qa-* distinct sous .sites-runtime ; aucune prestation utilisateur n’est utilisée pour les tests.

## Résultats

- Compilation de production Next.js / navigateur et vérification TypeScript : réussies.
- 11 tests unitaires : arrondi, dates/heures, CSV, calendrier et authentification.
- 91 assertions API : comptes locaux et règles métier, sur le serveur de production compilé en loopback au port 8787.
- Copie de la base locale précédente : 1 membre, 2 clients, 3 prestations, comptages et intégrité vérifiés ; original conservé.
- Sauvegarde SQLite cohérente : exécutée et intégrité vérifiée.

## Couverture authentification

Premier administrateur protégé par code d’installation et création unique ; authentification par mot de passe ; changement obligatoire du mot de passe provisoire avant accès aux prestations ; isolation administrateur/partenaire ; refus des en-têtes d’identité hérités de Sites ; refus des requêtes provenant d’une autre origine ; limitation des tentatives ; réinitialisation et révocation des sessions ; déconnexion ; désactivation ; récupération locale par l’exploitant ; absence de hash de mot de passe dans les réponses.

Les mots de passe sont vérifiés avec des sels distincts. Les tests du connecteur LDAP vérifient l’échappement des filtres, le refus du protocole en clair, l’ordre StartTLS → bind de service → recherche → bind utilisateur → unbind, le refus d’une recherche ambiguë et d’un mot de passe incorrect. Ces tests utilisent un client simulé ; ils ne prouvent pas la connectivité avec un domaine réel.

## Couverture métier

Consultation, modification, suppression et export limités aux droits du compte ; arrondi de 16 à 30 minutes ; sauvegarde idempotente ; chevauchements ; validation de dates et horaires ; fin à minuit ; gestion des versions concurrentes ; export détaillé et synthèse cohérents ; protection des cellules CSV contre les formules ; verrouillage et réouverture de facturation ; archivage clients ; période maximale de consultation.

## Contrôles dans le navigateur

Connexion réelle d’un administrateur local de recette, affichage de son calendrier, sélection d’un quart d’heure ouvrant une fenêtre préremplie 09:00–09:15 avec client/ticket, écran Équipe avec comptes locaux et LDAP, écran Mon compte et déconnexion vérifiés. La nouvelle page de création du compte administrateur est ouverte sur l’instance utilisateur locale, avec code d’installation prérempli. Aucun mot de passe utilisateur n’a été choisi par l’agent.

Les styles responsive du calendrier et du relevé sont conservés. Le changement de viewport n’a pas été appliqué par le navigateur de recette pendant cette session ; les nouveaux écrans n’ont donc pas été validés visuellement à 390 px.

## Reproduire

```powershell
npm run build
node node_modules/typescript/bin/tsc --noEmit
node --test tests/business.test.mjs tests/calendar.test.mjs tests/auth.test.mjs
node tests/run-api.mjs
```

Le lanceur initialise une base isolée, démarre le serveur au port 8787 et l’arrête après les tests. Ce port doit être libre.

## Limites de validation externe

Aucun accès à votre Windows Server ou à votre annuaire n’a été fourni. La tâche Windows de démarrage, le reverse proxy IIS, le certificat HTTPS et les binds sur votre AD réel restent à valider lors de l’installation. La version tourne ici en local au port 5173. L’ancienne publication cloud n’a pas été remplacée et ne synchronise pas ses données avec cette version.

## Sélecteur horaire au quart d’heure

Le 16 septembre 2026 : compilation et TypeScript réussis. Dans le navigateur de recette isolé, vérification des suggestions 00/15/30/45 dans Calendrier et Prestations. Sélection de 10:45, remplacement au clavier par 10:47, enregistrement et relecture : 09:00–10:47 conservé (1 h 47 réelles, 2 h 00 facturables). Le sélecteur natif a été remplacé par un composant commun ; aucune contrainte de pas de 15 minutes ne bloque la saisie exacte au clavier.

## Relevé client, mode et tarification — 17 septembre 2026

Compilation et TypeScript réussis ; 144 assertions API et 11 tests unitaires réussis. Tests ajoutés : export client limité strictement à quatre colonnes, client obligatoire, absence d’identités/tickets/descriptions/montants, droits partenaire, modes inconnus bloqués, case Sur site validée et persistée, calcul des tarifs standard/sur site, maintien des tarifs historiques, un forfait par jour/client/prestataire, changement de jour/client/prestataire, non-déplacement du forfait lorsque l’on saisit ensuite un ticket à une heure antérieure.

Vérification navigateur isolée : configuration d’un tarif standard de recette à 80 €, sur site à 100 €, forfait de recette à 25 € ; création d’une prestation sur site de 1 h ; affichage de 100 € de prestation et 25 € de déplacement séparés ; choix du client puis téléchargement du relevé sans partenaire confirmé. Ces montants de test ne sont pas appliqués aux données utilisateur. La migration est précédée d’une sauvegarde et conserve les champs historiques des prestations existantes.

## Affichage des créneaux courts — 17 septembre 2026

Correction du calendrier : une ligne pour les prestations de moins de 30 minutes, deux lignes entre 30 et 44 minutes, trois lignes à partir de 45 minutes. Le nom du client et le ticket sont regroupés dans les créneaux courts, avec ellipse horizontale et détails complets au clic ou au survol. Les lignes ne sont plus comprimées verticalement. Suppression du zéro parasite devant l’heure des prestations non facturées.

Compilation et TypeScript réussis. Vérification dans un navigateur avec base de recette isolée, sur ordinateur et à 390 px de largeur : prestations adjacentes de 15, 30, 45 et 1 minute, nom de client long, absence de débordement vertical, ouverture des détails du créneau de 15 minutes. Aucune donnée utilisateur modifiée.

## Relevé de rapprochement par partenaire — 17 septembre 2026

Compilation et TypeScript réussis. 170 assertions API réussies sur base isolée : sélection obligatoire d’un partenaire pour l’administrateur, auto-export partenaire, refus d’accès au relevé d’un autre partenaire, période vide, refus des filtres partiels de ticket/statut, absence de tarifs de vente client, ordre chronologique, protection des cellules CSV et totaux exacts sur plusieurs jours et clients. Le forfait est compté une fois par jour/client/prestataire ; les forfaits absents et modes inconnus sont signalés avec total monétaire laissé vide.

Parcours navigateur vérifié : Prestations → choisir un partenaire → Appliquer → Exporter → Relevé partenaire · Facture ; confirmation de téléchargement obtenue. Le fichier comporte le nom du partenaire et la période dans son nom. Aucun changement de données utilisateur ni de schéma de base.

## Charte graphique du site public Sumatoni — 17 septembre 2026

Palette et Poppins reprises du site public choisi par l’utilisateur ; logos originaux intégrés dans la navigation, la connexion et le pied de page. Polices 400/500/600/700 et logos hébergés localement, licence Poppins jointe. Sources et décisions consignées dans docs/CHARTE-SUMATONI.md.

Compilation et TypeScript réussis. Vérification navigateur sur base isolée : rendu du calendrier et des relevés sur ordinateur, formulaires et sélecteur horaire à 390 px, police Poppins appliquée aux dialogues et au sélecteur, logos chargés, absence de débordement horizontal sur mobile. Créneaux de 1, 15, 30 et 45 minutes sans débordement vertical. Menu défilable sur petit écran d’ordinateur et déconnexion vérifiée après ajustement. Page de connexion vérifiée sur ordinateur et téléphone. Aucune modification des règles métier ni des données utilisateur.

## Couleurs par client — 17 septembre 2026

Compilation et TypeScript réussis ; 184 assertions API réussies. Tests ajoutés : valeur initiale nulle, modification réservée à l’administrateur, couleurs invalides rejetées, client absent, normalisation en majuscules, lecture par un partenaire et remise à zéro. Migration additive appliquée après sauvegarde vérifiée de la base utilisateur.

Recette navigateur sur base isolée : choix du violet dans Clients, sauvegarde confirmée, couleur persistante à la réouverture, bordures violettes et fonds teintés sur les prestations existantes de 1, 15, 30 et 45 minutes. Vérification à 390 px et sur ordinateur : aucun débordement horizontal ni texte coupé verticalement, palette tactile lisible. Aucune couleur attribuée automatiquement aux clients utilisateur ; exports et calculs inchangés.

## Espace prestataire et GLPI — v0.2.0, 17 septembre 2026

Compilation de production et contrôle TypeScript réussis. 15 tests unitaires passent (dont minutes englobantes, passage à minuit, changements d’heure, limite de 24 h et propositions au quart d’heure). Les 184 assertions API existantes restent valides. 128 assertions supplémentaires couvrent l’accueil personnel, la confidentialité des tarifs, les chronomètres, la protection CSRF et les comptes provisoires, la reprise et le rejeu sans doublon, les conflits atomiques entre deux jours, le forfait quotidien unique, les associations d’entités, les jetons GLPI personnels chiffrés, les droits séparés, les recherches, la pagination, les erreurs, les redirections refusées, le délai de 15 secondes, le changement d’adresse et la sauvegarde de la clé. Total : 312 assertions API. Les sessions du simulateur GLPI sont toutes fermées et les requêtes limitées à GET.

Recette navigateur avec données fictives dans une base isolée : accueil Ma journée, totaux et tickets récents, ticket GLPI associé et non associé, recherche par numéro, préremplissage client/ticket/sujet, restauration du brouillon après rechargement, 13:07–13:23 conservé avec 30 minutes facturables, démarrage et reprise du chronomètre après rechargement, ajustement des horaires avant enregistrement, arrêt différé, conservation et suppression confirmée. Confirmations intégrées testées. Aucune erreur ou alerte dans la console du dernier parcours.

Vérification visuelle sur ordinateur et viewport 390 × 844 : formulaires, recherche GLPI, boutons, absence de débordement horizontal et suggestions 00/15/30/45. Contrôle des prestations colorées de 15 et 30 minutes : hauteurs 22 et 46 px, contenu contenu dans les blocs, couleurs distinctes ; correction des fonds transparents qui laissaient transparaître les repères horaires sur mobile.

Avant migration utilisateur : sauvegarde SQLite vérifiée. Après démarrage local : contrôle d’intégrité OK, empreintes et nombres des prestations, membres, forfaits et champs clients existants identiques ; aucune donnée de démonstration introduite dans la base utilisateur. Les nouvelles tables sont vides sur cette installation.

La recette GLPI utilise un serveur simulé conforme au contrat V1. La connexion au GLPI réel et la recette AD sur le Windows Server cible restent à effectuer avec leurs paramètres réels ; aucun identifiant de ces systèmes n’a été utilisé.
