# SumaTime v0.4.4 — confidentialité et tarif prestataire

Déploiement terminé le 10 octobre 2026 à 14:39, heure de Bruxelles, sur `https://sumatime.home.sumatoni.be`.

## Release et preuve

- Source canonique CT-ANT `/srv/projects/applications/timesheet`, branche `codex/provider-rates`.
- Code applicatif `7e81ea0001b7b3ca345c247a35511b796b9f31bb`, version 0.4.4, build `51ok3KWprhTcm3yJsuon1`.
- Release active `/opt/sumatoni-time/releases/v0.4.4-provider-rates-7e81ea0`, lien `/opt/sumatoni-time/current`.
- Archive `sumatime-v0.4.4-provider-rates.tar.gz`, SHA-256 `17e7cfe24c0e118cd3288ef848f7dad0c139b53d33c45c48478ecb10a54aa874`.
- 3145 fichiers runtime vérifiés ; aucune base ni configuration privée dans l'archive. Les 38 ressources publiques ont été comparées au paquet après bascule HTTPS.
- Sauvegarde fraîche avant bascule `/var/backups/sumatoni-time/2026-10-10T12-39-06.398Z`.
- Sauvegarde après bascule `/var/backups/sumatoni-time/2026-10-10T12-39-08.663Z`.
- Sauvegardes SQLite, environnement et clé GLPI terminées, empreintes vérifiées, intégrité SQLite et clés étrangères contrôlées.
- Scripts et preuves privés `/root/sumatoni-deploy/v0.4.4-provider-rates-20261010/`.

## Correction livrée

Les prestataires ne reçoivent plus les prix clients historisés dans les prestations JSON, ni dans les exports détaillés et synthétiques. `/api/time` et `/api/workday` utilisent une projection explicite avant réponse ; les nouveaux champs internes futurs ne sont pas automatiquement publiés. Les administrateurs conservent les tarifs clients pour la facturation.

Mon compte → Mon tarif avec Sumatoni permet de déclarer un tarif horaire EUR HT et une date d'application, avec historique. Équipe → membre → Tarif avec Sumatoni permet le contrôle administratif. Le relevé prestataire utilise exclusivement ce tarif pour la rémunération et inclut un total avec déplacements. Une période sans tarif est explicitement signalée ; aucun prix client n'est utilisé par défaut. Les dates passées recalculent la valorisation des heures déjà saisies à partir de cette date, sans modifier les lignes de prestation ou les tarifs clients.

Règles détaillées : [Confidentialité et tarifs prestataires](CONFIDENTIALITE-ET-TARIFS-PRESTATAIRES.md).

## Données conservées

La base de production reste `/var/lib/sumatoni-time/timesheet.sqlite` ; aucun remplacement par une base de développement. Les lignes et valeurs des 19 tables existantes ont été comparées intégralement après migration : identiques. Seules les tables vides `provider_rates` et `provider_rate_events` sont ajoutées par la migration 0011.

État après bascule : 3 membres (1 administrateur, 2 prestataires), 1 compte local, 2 clients, 17 prestations, 2 connexions GLPI, 2 membres Microsoft provisionnés. Aucun rôle, tarif réel ou compte réel modifié pendant les essais. Aucun tarif prestataire initialisé arbitrairement. La configuration Entra et la clé GLPI sont inchangées octet pour octet par rapport à la sauvegarde ; les accès locaux et Microsoft restent en place.

La vérification OIDC de production crée puis annule uniquement son propre flux de connexion, sans créer de session. La comparaison après vérification confirme la conservation des données métier ; aucune reconnexion humaine au mot de passe ou via Microsoft n'est revendiquée pour ce déploiement.

## Vérifications

- Build final et TypeScript, ESLint ciblé, diff Git conformes.
- 46 tests unitaires/DOM (authentification, Entra, rôles, confidentialité, calcul des montants et formulaire tarif).
- 77 assertions API confidentialité/tarifs : isolation propre compte/tiers, origine externe, rôle administrateur, filtres et CSV, nouveau champ commercial inconnu, dates d'application, valeur nulle/zéro, conflit concurrent et conservation intégrale des prestations/clients.
- 201 assertions de recette métier ; 251 assertions prestataire/GLPI ; 25 assertions de gestion des rôles.
- 718 contrôles Entra/OIDC/Graph signés en simulation, sur bases isolées.
- Runtime final exécuté sous le compte de service sur une copie privée de la base de production : contrôle Graph réel de l'administrateur et du prestataire, session locale de secours, refus des tarifs d'un tiers, propre tarif calculé dans les exports, tarifs clients filtrés. Le tarif d'essai est resté exclusivement dans cette copie privée ; les sessions synthétiques sont supprimées et le processus arrêté.
- Après bascule : SumaTime/Nginx actifs, API anonymes refusées avec 401, HTTPS vérifié avec le certificat existant sans contournement TLS, OIDC tenant/client/callback/PKCE/cookie Secure vérifiés.

## Prévisualisation et retour arrière

Prévisualisation `http://192.168.10.131:5174` : même paquet final, release `/opt/sumatime-preview/releases/v0.4.4-provider-rates-7e81ea0`. Les 19 tables antérieures, les 2 membres/comptes, 2 clients et 8 prestations sont conservés intégralement. Microsoft reste désactivé dans cet environnement séparé. Sauvegarde/preuves `/var/backups/sumatime-preview/provider-rates-20261010`.

Le déploiement possède un retour automatique vers le code précédent si ses contrôles échouent ; aucun retour nécessaire cette fois. Pour un retour manuel, conserver la base courante et les réglages Microsoft, arrêter brièvement le service, rétablir le lien vers `/opt/sumatoni-time/releases/v0.4.3-prestataire-6adc53b`, puis redémarrer. **La v0.4.3 réintroduirait la divulgation de tarifs corrigée ici** : limiter ce retour à une récupération d'urgence et réappliquer la correction avant de rouvrir les accès prestataires. Ne pas restaurer une ancienne base qui ferait perdre les saisies et tarifs plus récents.
