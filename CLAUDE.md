# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Ce que c'est

Site statique sans build (`index.html`, `style.css`, `app.js`) : prix du gazole des stations de 5 départements (Ain 01, Isère 38, Loire 42, Rhône 69, Saône-et-Loire 71), en liste et sur une carte Leaflet, avec filtres département et commune. Titre : « Gazole Rhône-Alpes ». Les utilisateurs et les principes produit sont dans `PRODUCT.md` : à lire avant tout travail de design.

## Commandes

Pas de build, de lint ni de tests. Ni Python ni Node ne sont installés sur la machine (Windows). Pour tester en local, lancer en arrière-plan un petit serveur PowerShell (`System.Net.HttpListener`, préfixe `http://localhost:8080/`, sert `index.html`, `.css`, `.js` depuis la racine du dépôt) puis ouvrir `http://localhost:8080/`. Le navigateur intégré n'exécute pas la page ouverte en `file://`.

Déploiement : `git push` sur `main` ; Vercel redéploie seul (`https://diesel-livid.vercel.app`). Le push met le site en ligne : ne pousser qu'avec l'accord de l'utilisateur.

## Architecture

Tout le comportement est dans `app.js`.

- **Données** : API Opendatasoft de `data.economie.gouv.fr` (jeu `prix-des-carburants-en-france-flux-instantane-v2`), appelée depuis le navigateur : CORS ouvert, pas de clé. L'API plafonne à 100 résultats par page : la 1re page donne `total_count`, les suivantes partent en parallèle. Requête : `code_departement in (...) and gazole_prix is not null`.
- **Pièges de l'API** : les champs bruts `latitude`/`longitude` sont mal échelonnés (ex. `"4594300"`), utiliser `geom.lat`/`geom.lon`. Les prix peuvent dater de plusieurs jours : `gazole_maj` est affiché et signalé au-delà de 3 jours.
- **Flux** : `stations` (tout) → filtre départements (`departementsActifs`) → filtre commune → `afficher()` reconstruit liste et marqueurs. La commune se filtre par la clé `code|ville`, car des communes homonymes existent dans plusieurs départements. Les paliers vert/orange/rouge et l'étiquette « Le moins cher » se calculent sur les départements cochés, pas sur la commune choisie. Décocher le dernier département les rallume tous.
- **Ordre des départements** : garder `LISTE_DEPARTEMENTS` en tableau ; un objet à clés numériques (`'38'`) se réordonne tout seul.
- **Carte** : Leaflet 1.9.4 (cdnjs). Points sous le zoom 12, pastilles avec le prix à partir de 12. `premierAffichage` fait s'ouvrir la carte sur le Rhône ; tout changement de filtre la recadre sur ce qui est affiché (`ajusterCarte`). Sur téléphone, la carte est masquée en vue Liste : elle doit être `invalidateSize()` puis recadrée au passage en vue Carte (`ajusterAuAffichage`).
- **Mise en page** : mobile d'abord ; bascule Liste/Carte sous 800 px ; au-dessus, liste de 420 px à gauche et carte à droite.

## Conventions

- Interface, commentaires et messages en français.
- Scène d'usage : conducteur à l'arrêt, au soleil, sur téléphone. Fond clair, contrastes forts, prix en gros, polices système.
- Un état ne repose jamais sur la couleur seule : mots « Bas / Moyen / Haut » sur les prix, coche sur les départements actifs.
- Pas de modale ; ce qui est inline reste inline.

## Design et qualité

Le skill `impeccable` est installé dans `.claude/skills/impeccable/` (non versionné). Après une modification de l'interface, lancer `.claude/skills/impeccable/scripts/impeccable.cmd detect --json index.html style.css app.js` ; la sortie attendue est `[]`. `PRODUCT.md` existe ; il n'y a pas encore de `DESIGN.md`.

## Git

Branche `main`, remote `origin` (`github.com/aucordier69/diesel`). Ne jamais ajouter `.claude/` au dépôt. Les avertissements LF/CRLF de git sont sans gravité.
