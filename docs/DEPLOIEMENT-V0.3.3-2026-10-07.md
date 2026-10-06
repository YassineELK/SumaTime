# SumaTime v0.3.3 — récupération des chronos oubliés

Publié le 7 octobre 2026 (Europe/Brussels) sur https://sumatime.home.sumatoni.be. Commit/tag : 9021efe43df0c55daf4b98cf44a96b085c06b586 / v0.3.3. BUILD_ID : usjN3tkCKMhYbm4o8u9w7. SHA-256 : 70089e705de80703b9775545906097707df21e5d7d53059a52468a24aa6e2024.

Au-delà de 24 heures ou lors d’un changement d’heure, le chrono n’avait aucun champ de correction et l’API refusait la sauvegarde avant de lire les horaires saisis. Le formulaire propose maintenant date, début, fin et description, sans facturer automatiquement l’intervalle oublié. Plusieurs journées peuvent être précisées (une plage par jour, maximum 31), dans la période du chrono et sans date future. Les minutes tapées au clavier sont conservées ; les propositions automatiques normales gardent les arrondis au quart inférieur/supérieur.

L’API valide les corrections avant transaction ; chevauchements, versions périmées, dates répétées et horaires invalides sont refusés sans perdre le chrono. Les reçus existants rendent une sauvegarde répétée idempotente. Le forfait de déplacement reste unique par prestataire/client/jour.

Validation : 77 tests unitaires/DOM, build Next et TypeScript, 251 assertions de recette prestataire/API. Dans le navigateur, un chrono fictif de plus de 24 heures a été corrigé à 09:07–10:22 puis enregistré à la minute exacte en une seule prestation. Formulaire vérifié sur ordinateur et à 390 px.

Production : sauvegarde /var/backups/sumatoni-time/2026-10-06T22-18-21.792Z ; empreintes des tables métier identiques avant/après, intégrité SQLite conforme et FK valides. HTTPS vérifié, 35 assets identiques au paquet et API anonymes refusées. Aucun chrono utilisateur n’a été corrigé ou supprimé par la recette : les seules saisies de test se trouvent dans la base fictive sur CT-ANT.

Preuves : /root/sumatoni-deploy/v0.3.3-20261006/ sur la production. Logs : /tmp/sumatime-v033-unit.log, /tmp/sumatime-v033-build.log et /tmp/sumatime-v033-qa/provider.log sur CT-ANT. Build effectué au commit 5632331 puis deux corrections de tests seuls ajoutées ; identité des sources de production vérifiée entre ce commit et la release.

Retour au code précédent : arrêter le service, rétablir atomiquement /opt/sumatoni-time/current vers /opt/sumatoni-time/releases/v0.3.2 et redémarrer. Aucun changement de schéma : conserver la base courante.
