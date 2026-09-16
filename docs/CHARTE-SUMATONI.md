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

Le logo et le mot-symbole sont les fichiers publics d’origine, sans recoloration : `/icon.e810b9a9.png` et `/wordmark.b193aacd.png`. Ils sont conservés dans `public/brand/`. Un fond clair maintient le contraste du mot-symbole dans la navigation sombre. Le composant commun `components/brand.tsx` les affiche dans la navigation, la connexion et le pied de page.

Les fichiers Poppins 400/500/600/700 proviennent des fichiers WOFF2 servis par le site public. Ils sont hébergés dans `public/fonts/`, avec la [licence SIL Open Font License](https://github.com/google/fonts/blob/main/ofl/poppins/OFL.txt) conservée dans `OFL-Poppins.txt`. Aucun appel à Google Fonts ni au site public n’est nécessaire à l’exécution. Les logos Sumatoni restent les éléments d’identité de Sumatoni.

Vérifier les écrans à 390 px et sur ordinateur lors des changements de typographie, notamment les événements de calendrier de 15 et 30 minutes et les dialogues.
