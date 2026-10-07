# Attribuer le rôle administrateur dans SumaTime

Disponible à partir de la v0.4.3. Deux rôles : prestataire (ses propres prestations) et administrateur (toutes les prestations, modifications, exports, clients, facturation et gestion des comptes).

1. Pour une personne Microsoft, l’attribuer individuellement à SumaTime dans Entra avec Accès par défaut, puis lui faire effectuer sa première connexion pour créer son compte prestataire.
2. Se connecter dans SumaTime avec un administrateur et ouvrir **Équipe**.
3. Dans la fiche de la personne, cliquer **Rendre administrateur**. Vérifier le nom et les droits affichés, puis **Confirmer les droits administrateur**.
4. La personne est déconnectée de SumaTime. À sa reconnexion Microsoft, locale ou LDAP, elle reçoit le rôle administrateur et peut consulter toutes les prestations.

Pour retirer les droits, **Passer en prestataire**, puis confirmer. Toutes ses sessions SumaTime sont révoquées et sa prochaine connexion limite l’accès à ses propres prestations. Son historique, ses identifiants et ses données sont conservés. Aucune modification du rôle Entra ou du SSO GLPI n’est nécessaire.

L’administrateur ne peut pas modifier son propre rôle. Un membre désactivé doit être réactivé avant promotion. Le dernier administrateur actif disposant d’un compte local ne peut pas être rétrogradé ; conserver ce secours local avant de retirer ses droits. Si un autre administrateur a déjà modifié le rôle affiché, actualiser l’équipe avant de réessayer.

Les décisions sont validées côté serveur dans une transaction et enregistrées dans `member_role_events` (acteur, membre, ancien rôle, nouveau rôle et date). Le changement et la révocation des sessions sont atomiques. Aucun mot de passe, secret ou jeton dans l’historique. La migration 0010 est additive.

Le provisionnement Entra continue de créer uniquement des prestataires. Les administrateurs accordent les droits supplémentaires explicitement dans SumaTime ; une reconnexion Microsoft conserve cette décision sans créer un nouveau membre.
