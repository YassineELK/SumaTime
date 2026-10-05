# Identité visuelle Sumatoni Time

Référence choisie par l’utilisateur : le site public [sumatoni.be](https://sumatoni.be/), consulté le 17 septembre 2026. Couleurs et polices relevées dans sa feuille de style `/index.a128a854.css`.

## Typographie et palette

- **Poppins**, graisses 400, 500, 600 et 700 : interface, titres, formulaires, dialogues et sélecteur horaire.
- Bleu principal : `#29A7DF` ; turquoise : `#008082`.
- Fond bleu nuit : `#08131C`, avec les nuances `#050D12` et `#061019` du site public.
- Variante claire du site : texte `#183543`, titres `#0A2938`, texte secondaire `#486675`, accent lisible sur blanc `#08759C`.
- Les statuts de validation, avertissement et erreur conservent leurs couleurs sémantiques.

La navigation et l’écran de connexion reprennent les fonds sombres du site ; les tableaux, calendriers et formulaires utilisent sa palette claire pour une lecture quotidienne. Les boutons principaux utilisent le bleu officiel avec du texte foncé. Les styles sont centralisés dans `app/brand.css`.

## Ressources locales

Sumatime possède son propre logo depuis le 5 octobre 2026 : une horloge simple, avec un cercle bleu `#29A7DF` et des aiguilles turquoise `#008082`, conservée dans `public/brand/sumatime-clock.svg`. Le nom « Sumatime » est affiché en Poppins, dans le bleu nuit de la charte. Le composant commun `components/brand.tsx` affiche cette identité dans la navigation, la connexion et le pied de page. L'horloge sert également d'icône d'onglet. Les couleurs et la typographie Sumatoni restent celles de l'interface.

Les anciens logos publics Sumatoni sont conservés dans `public/brand/` pour référence, mais ne sont plus affichés comme logo de l'application.

Les fichiers Poppins 400/500/600/700 proviennent des fichiers WOFF2 servis par le site public. Ils sont hébergés dans `public/fonts/`, avec la [licence SIL Open Font License](https://github.com/google/fonts/blob/main/ofl/poppins/OFL.txt) conservée dans `OFL-Poppins.txt`. Aucun appel à Google Fonts ni au site public n’est nécessaire à l’exécution.

Vérifier les écrans à 390 px et sur ordinateur lors des changements de typographie, notamment les événements de calendrier de 15 et 30 minutes et les dialogues.
