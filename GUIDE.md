# Sumatoni Time — Guide d’utilisation et exploitation

## Démarrer

1. Ouvrez l’application. À la première ouverture, créez le compte administrateur avec votre nom, e-mail, mot de passe de 12 caractères minimum et code d’installation du serveur (data/setup-token.txt).
2. Connectez-vous ensuite avec votre e-mail et votre mot de passe local.
3. Dans **Clients**, ajoutez vos clients. Dans **Calendrier**, sélectionnez une plage puis complétez le ticket.

Aucun compte ChatGPT n’est nécessaire. Vos données de prévisualisation locale sont conservées lors de la migration. Les données de l’ancienne publication cloud sont indépendantes.

## Faire travailler un partenaire

Dans **Équipe**, choisissez **Compte local**, renseignez son nom, son e-mail et un mot de passe provisoire. Transmettez l’adresse de l’application et les identifiants par un canal privé. Le partenaire doit changer ce mot de passe à la première connexion. Aucun e-mail automatique n’est envoyé.

Pour un compte **Active Directory / LDAP**, renseignez aussi l’identifiant annuaire correspondant au filtre configuré sur le serveur (par exemple jdupont). Le partenaire utilise son mot de passe AD ; celui-ci n’est jamais enregistré par l’application. Le connecteur doit être activé par l’exploitant.

Chaque partenaire consulte, corrige et exporte uniquement ses propres prestations. L’administrateur voit l’ensemble. Désactiver un compte révoque immédiatement ses sessions. **Réinitialiser le mot de passe** permet de remplacer un mot de passe local perdu par un nouveau mot de passe provisoire. **Mon compte** permet de changer son propre mot de passe et déconnecte les autres sessions.

## Saisir les heures

### Ma journée et saisie rapide

L’accueil **Ma journée** montre vos propres interventions, les temps réels et facturables du jour et le temps réel depuis lundi, même pour un administrateur. Les temps du chronomètre en cours ne sont pas encore comptés. Un clic sur une intervention ouvre sa correction dans Prestations. Le calendrier reste accessible dans la navigation.

**Ajouter une prestation** ouvre la saisie rapide. Sur ordinateur, le raccourci **N** fonctionne hors des champs et dialogues. Le brouillon de cette saisie rapide est conservé sur l’appareil et associé au compte ; il peut être repris après fermeture ou rechargement. Il n’est pas synchronisé entre appareils et disparaît si le stockage du navigateur est effacé. Les formulaires historiques Calendrier et Prestations ne bénéficient pas de cette récupération. Les tickets récents préparent une nouvelle prestation en reprenant client, ticket, description et mode ; vérifiez les nouveaux horaires.

### Chronométrer une intervention

Choisissez **Démarrer un chrono**, puis le client, le ticket et le mode. Un seul chronomètre peut être présent par compte. Il est conservé sur le serveur et reste disponible sur un autre appareil après connexion ; fermez librement l’onglet. L’état est actualisé au retour sur la page et toutes les 30 secondes lorsque la page est visible.

**Terminer** arrête le temps et ouvre une vérification : corrigez les horaires et la description, puis enregistrez. **Plus tard** conserve l’intervention arrêtée. Le début est proposé à la minute inférieure, la fin à la minute supérieure, avec une durée minimale d’une minute ; l’arrondi facturable au quart d’heure intervient ensuite. Deux journées traversées produisent deux lignes, enregistrées ensemble. Les déplacements restent comptés une fois par jour, client et prestataire. Les tarifs sont figés à l’enregistrement de la prestation.

Un chevauchement bloque l’enregistrement et conserve le chronomètre. Corrigez les horaires dans la vérification. Si un chronomètre dépasse 24 heures ou traverse un changement d’heure été/hiver, saisissez les horaires réels manuellement dans le calendrier, puis supprimez le chronomètre. Une suppression de chronomètre ne crée aucune prestation.

### Préparer depuis GLPI

**Mes tickets GLPI** permet de chercher un numéro ou un titre, afficher les tickets ouverts ou tous les statuts, puis préparer une saisie ou un chrono. Le client est choisi automatiquement uniquement si l’entité GLPI est explicitement associée à un client actif. Sinon, choisissez-le dans le formulaire. Vérifiez le mode Sur site. Voir [la procédure de connexion GLPI](docs/GLPI.md).

### Sélectionner une plage dans le calendrier

Dans **Calendrier**, la semaine du lundi au dimanche est affichée sur PC. Cliquez-glissez dans la colonne d’un jour : chaque case représente 15 minutes. La plage surlignée affiche les horaires retenus ; relâchez pour ouvrir la fenêtre de saisie. Un simple clic prépare une prestation de 15 minutes. Le bouton **Prestation** permet aussi d’ouvrir directement le formulaire.

Sur téléphone, sélectionnez le jour en haut, touchez le premier puis le dernier quart d’heure de votre intervention. La fenêtre s’ouvre après le deuxième appui. Pour un seul quart d’heure, touchez deux fois la même case ou utilisez **Continuer** après le premier appui. Le défilement vertical reste disponible entre les deux appuis. Les horaires préremplis restent ajustables dans la fenêtre.

Choisissez le client, indiquez le numéro de ticket et éventuellement une description, puis cliquez sur **Enregistrer la prestation**. La prestation apparaît dans le calendrier et reste accessible dans le relevé et les exports de l’onglet **Prestations**. Les nouvelles saisies sont toujours attribuées à la personne connectée, même lorsque l’administrateur affiche un autre partenaire ou toute l’équipe.

Dans les champs Début et Fin, le bouton horloge propose les minutes 00, 15, 30 et 45. Pour une heure précise, tapez directement au format HH:MM (par exemple 10:47) ; elle est conservée sans arrondir l’horaire. Ce fonctionnement est identique dans Calendrier et Prestations.

Cliquez sur un bloc existant pour le modifier. Les prestations déjà facturées s’ouvrent en lecture seule. Les horaires exacts d’anciennes prestations restent conservés, même s’ils ne correspondent pas à un quart d’heure. La navigation propose les semaines précédente/suivante, **Aujourd’hui** et une date au choix. Les jours futurs ne permettent pas de saisie.

Au clavier : Tab pour atteindre la grille, flèches pour se déplacer, Maj + flèche haut/bas pour étendre la plage, Entrée pour ouvrir la saisie et Échap pour annuler une sélection. La fenêtre conserve les champs en cas d’erreur et demande confirmation avant d’abandonner des modifications.

Les heures sont les heures civiles de Bruxelles. Le téléphone ne les convertit pas automatiquement. La fin **00:00** signifie minuit à la fin de la date sélectionnée et apparaît comme **24:00** sur le relevé. Pour une intervention de 23:00 à 01:00, saisissez 23:00–00:00 le premier jour et 00:00–01:00 le lendemain. Lors des changements d’heure saisonniers, vérifiez votre saisie : le calcul porte sur les heures civiles, pas sur la durée chronométrique.

Une prestation de 16 minutes donne 30 minutes facturables. Chaque ligne est arrondie séparément au quart d’heure supérieur. Le relevé conserve les minutes réelles et arrondies. Les dates futures et les chevauchements d’une même personne sont refusés.

## Préparer la facturation

1. Sélectionnez une période (366 jours maximum), un client, un partenaire ou un statut.
2. Cliquez sur **Appliquer**. Les compteurs et le relevé correspondent alors à cette sélection.
3. Dans **Exporter**, choisissez **CSV détaillé** pour les justificatifs ou **Synthèse par client** pour les totaux par client et partenaire.
4. Ouvrez le fichier dans Excel. Il utilise UTF-8, un séparateur point-virgule et la virgule décimale. Si votre tableur utilise un autre séparateur régional, utilisez son import CSV en choisissant le point-virgule.
5. Après la facturation, utilisez la double coche sur chaque prestation pour la marquer facturée et la verrouiller. L’export seul ne change aucun statut.

La synthèse additionne les minutes arrondies de chaque prestation. Les exports internes détaillent aussi les tarifs et montants de prestations, ainsi que les forfaits prestataires, lorsque ces montants ont été configurés. Aucune TVA ni numéro de facture n’est calculé. Les relevés ne remplacent pas vos factures.

## Contrôler la facture d’un partenaire

Dans **Prestations**, choisir la période de la facture et le partenaire, laisser **Tous les clients** (ou sélectionner le client concerné), choisir **Tous les statuts**, vider la recherche puis cliquer sur **Appliquer → Exporter → Relevé partenaire · Facture**. Un partenaire connecté peut télécharger uniquement son propre relevé.

Le CSV s’ouvre dans Excel et contient les clients, tickets, descriptions, dates, horaires, modes, minutes réelles et heures arrondies au quart d’heure, ainsi que les forfaits de déplacement. La dernière ligne totalise le temps et les déplacements. Chaque forfait reste compté une fois par jour, client et prestataire. Les prestations déjà facturées au client restent incluses : ce statut ne signifie pas que la facture du partenaire a été contrôlée.

Les tarifs de vente aux clients ne sont pas repris et aucun tarif horaire d’achat au partenaire n’est supposé. Le rapprochement du montant des heures se fait avec le tarif convenu avec le partenaire. Si un forfait manque ou si un ancien mode reste à confirmer, la colonne **À vérifier** le signale et le total monétaire des déplacements reste vide, pour ne pas donner un montant incomplet.

## Corriger et conserver

Le crayon permet de corriger une ligne non facturée. La corbeille supprime une ligne après confirmation, sans possibilité de récupération dans l’interface. Une ligne facturée doit d’abord être rouverte par l’administrateur. Si quelqu’un a modifié la même ligne entre-temps, l’application refuse votre ancienne version : actualisez, relisez la ligne, puis recommencez.

Archiver un client retire son nom des nouvelles saisies, tout en conservant l’historique. Désactiver un partenaire bloque son accès applicatif mais conserve son relevé. Le compte administrateur initial ne peut pas être désactivé depuis l’application.

## Connexion et erreurs

Une connexion au serveur est nécessaire. Attendez la confirmation d’enregistrement avant de quitter l’écran. Les champs restent présents en cas d’échec ; rechargez uniquement après avoir copié une saisie non enregistrée si nécessaire. Un nouvel essai sur la même saisie conserve son identifiant pour limiter les doublons. Il n’y a pas de mode hors connexion ni de sauvegarde automatique des brouillons après fermeture de l’onglet.

## Exploitation technique

Voir **INSTALLATION-WINDOWS.md** pour l’installation autonome, le démarrage Windows, HTTPS, le connecteur AD/LDAP, les sauvegardes et la restauration. Aucun réglage de partage Sites n’intervient dans les accès de cette version.

## Sur site, tarifs et relevé destiné au client

Dans Calendrier ou Prestations, cocher **Sur site** pour une intervention chez le client. Décoché signifie **À distance**. Les anciennes lignes restent **À confirmer** jusqu’à une correction explicite : cocher Sur site, ou choisir Confirmer à distance. Une ligne facturée doit être rouverte par l’administrateur avant correction.

Dans **Clients → Tarifs**, configurer le tarif horaire standard et, pour les clients concernés, un tarif horaire sur site. Si le tarif sur site est vide, le tarif standard s’applique. Dans **Équipe → Déplacement**, configurer le forfait de chaque prestataire, administrateur compris. Vide signifie non renseigné ; 0 signifie aucun montant. Montants en euros, sans calcul de TVA.

Le montant d’une prestation utilise sa durée arrondie au quart d’heure supérieur et le tarif enregistré avec cette prestation. Le forfait est dû **une seule fois par prestataire, par jour et par client** avec au moins une prestation sur site. Il est présenté séparément du montant facturable au client et n’y est pas ajouté automatiquement.

Les changements de tarifs s’appliquent aux nouvelles prestations. Modifier uniquement le ticket, la description ou l’horaire conserve le tarif enregistré. Changer le client ou le mode prend le tarif actuel. Le forfait du jour/client/prestataire est conservé dès sa première saisie sur site ; les changements de forfait s’appliquent aux nouvelles combinaisons jour/client/prestataire. Les montants manquants restent vides dans les exports.

Pour remettre un relevé au client :

1. Dans **Prestations**, sélectionner le client et la période, puis **Appliquer**.
2. Choisir **Exporter → Relevé client · Sans partenaire**.
3. Le CSV contient uniquement **Date, Début, Fin, Mode de prestation**. Aucun nom, identifiant de partenaire, ticket, commentaire ou tarif n’est transmis.

Un client précis est obligatoire afin de ne pas mélanger plusieurs entreprises. L’export respecte les filtres et les droits du compte ; un partenaire n’exporte que ses propres interventions. Toute ligne au mode À confirmer bloque cet export jusqu’à correction.

Les exports internes conservent les partenaires, séparent À distance et Sur site et donnent les montants. Le forfait journalier est affecté à la première prestation sur site enregistrée du jour/client/prestataire dans l’ordre de saisie. Un filtre de ticket ou de statut qui masque cette ligne masque également son forfait : pour le total des déplacements, exporter la journée/client complète sans filtre de ticket ou de statut.

## Couleurs des clients dans le calendrier

L’administrateur peut ouvrir **Clients → Couleur du calendrier**, choisir une couleur proposée ou personnalisée, puis cliquer sur **Enregistrer la couleur**. Le choix s’applique aux prestations anciennes et nouvelles du client, pour toute l’équipe. Le calendrier conserve un fond clair teinté et un texte foncé pour la lisibilité, avec une bordure dans la couleur choisie.

**Revenir à la couleur par défaut**, puis enregistrer, supprime la personnalisation. Les clients existants gardent leur apparence par défaut tant qu’aucune couleur n’est choisie. Les prestations facturées conservent leur cadenas et, lorsqu’elles sont personnalisées, un contour en pointillés. Ce réglage visuel ne modifie pas les temps, tarifs, exports ou statuts.
