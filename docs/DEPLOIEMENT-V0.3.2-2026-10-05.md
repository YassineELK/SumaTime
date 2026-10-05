# Sumatime v0.3.2 — logo en production

Version active le 5 octobre 2026 sur https://sumatime.home.sumatoni.be (192.168.87.224).

Le logo Sumatime utilise une horloge SVG bleue et turquoise et le nom en Poppins. Navigation, connexion, pied de page, titre de page et favicon utilisent cette identité. Les modifications de charte conservées lors du correctif GLPI v0.3.1 sont désormais livrées. Le correctif GLPI est conservé.

- Commit et tag : `63289c2ea825bc51287a86aaaf7b4398676d7646`, `v0.3.2`.
- BUILD_ID : `yDneQUvWkbNIa-WpTfC1E`.
- SHA-256 : `6e0150e3197079fcf18fc8c9177b922886c6f5f27f4ce6227ebc1c67105d7f83`.
- Release : `/opt/sumatoni-time/releases/v0.3.2`, précédente : `/opt/sumatoni-time/releases/v0.3.1`.
- Build isolé : `/tmp/sumatime-v032-clean`, paquet : `/tmp/sumatime-v032-release/`.

Build Next et TypeScript passent. La recette prestataire compte 220 assertions réussies, avec contrôle des identités et de la fermeture des sessions GLPI. Vérification visuelle dans le navigateur : connexion et navigation sur ordinateur, navigation et pied de page à 390 px ; SVG chargé, sans débordement du logo.

Après sauvegarde et bascule : empreintes des tables métier identiques avant/après, intégrité SQLite conforme, aucune FK invalide. HTTPS validé avec le certificat configuré ; 35 assets identiques au paquet ; accès anonyme aux API métier refusé. HTML de connexion vérifié avec le nouveau titre et le SVG. Le ticket réel 1141 Résolu de Salarypay reste retrouvé avec le profil personnel Admin ; aucune écriture de ticket GLPI pendant la vérification.

Preuves et chemin de sauvegarde : `/root/sumatoni-deploy/v0.3.2-20261005/deployment-result.json` sur la production. Logs de build et recette : `/tmp/sumatime-v032-build.log`, `/tmp/sumatime-v032-qa/provider-final.log` sur CT-ANT.

Pour revenir au code précédent : arrêter le service, rétablir atomiquement `/opt/sumatoni-time/current` vers v0.3.1 et redémarrer. Conserver la base courante : cette version ne change aucun schéma ni donnée métier.
