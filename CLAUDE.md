# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Ce que c'est

Site statique sans build (`index.html`, `style.css`, `app.js`) : prix des carburants (gazole par défaut) des stations de 5 départements (Ain 01, Isère 38, Loire 42, Rhône 69, Saône-et-Loire 71), en liste et sur une carte Leaflet, avec filtres département et commune. Titre : « La pétrolette des chouquettes ». Les utilisateurs et les principes produit sont dans `PRODUCT.md` : à lire avant tout travail de design.

## Commandes

Pas de build, de lint ni de tests. Ni Python ni Node ne sont installés sur la machine (Windows). Pour tester en local, lancer en arrière-plan un petit serveur PowerShell (`System.Net.HttpListener`, préfixe `http://localhost:8080/`, sert `index.html`, `.css`, `.js` depuis la racine du dépôt) puis ouvrir `http://localhost:8080/`. Le navigateur intégré n'exécute pas la page ouverte en `file://`.

Déploiement : `git push` sur `main` ; Vercel redéploie seul (`https://diesel-livid.vercel.app`). Le push met le site en ligne : ne pousser qu'avec l'accord de l'utilisateur.

## Architecture

Tout le comportement est dans `app.js`.

- **Données** : API Opendatasoft de `data.economie.gouv.fr` (jeu `prix-des-carburants-en-france-flux-instantane-v2`), appelée depuis le navigateur : CORS ouvert, pas de clé. L'API plafonne à 100 résultats par page : la 1re page donne `total_count`, les suivantes partent en parallèle. Requête : `code_departement in (...)` seulement ; les prix des 6 carburants (`CARBURANTS` : `gazole`, `e10` = SP95-E10, `sp98`, `e85`, `sp95`, `gplc`, champs `<code>_prix` et `<code>_maj`) sont chargés **une fois**, ~780 stations. Le carburant choisi (`carburant`, mémorisé dans `localStorage` `carburant`) est lu partout par `prixDe(s)` / `majDe(s)` : ne jamais écrire `s.gazole_prix` en dur. Une station sans prix pour ce carburant (`null`) n'est ni listée ni sur la carte ni dans le menu des communes. Changer de carburant (`changerCarburant`) reconstruit communes et affichage sans appel réseau et sans bouger la carte (`afficher({ garderCarte: true })`).
- **Pièges de l'API** : les champs bruts `latitude`/`longitude` sont mal échelonnés (ex. `"4594300"`), utiliser `geom.lat`/`geom.lon`. Les prix peuvent dater de plusieurs jours : la date de mise à jour est affichée et signalée au-delà de 3 jours.
- **Flux** : `stations` (tout) → filtre départements (`departementsActifs`) → filtre commune → `afficher()` reconstruit liste et marqueurs. La commune se filtre par la clé `code|ville`, car des communes homonymes existent dans plusieurs départements. Les paliers vert/orange/rouge et l'étiquette « Le moins cher » se calculent sur les départements cochés, pas sur la commune choisie. Décocher le dernier département les rallume tous.
- **Ordre des départements** : garder `LISTE_DEPARTEMENTS` en tableau ; un objet à clés numériques (`'38'`) se réordonne tout seul.
- **Carte** : Leaflet 1.9.4 (cdnjs). Points sous le zoom 12, pastilles avec le prix à partir de 12. `premierAffichage` fait s'ouvrir la carte sur le Rhône ; tout changement de filtre la recadre sur ce qui est affiché (`ajusterCarte`). Sur téléphone, la carte est masquée en vue Liste : elle doit être `invalidateSize()` puis recadrée au passage en vue Carte (`ajusterAuAffichage`). **Tout mouvement de carte passe par `ajusterCarte()` et sans animation** : Leaflet ignore silencieusement un `setView` demandé pendant une animation (un `fitBounds` animé suivi d'un `setView` laissait la carte sur la vue d'ensemble). Une commune cherchée est transmise par `zoneChoisie`, jamais par un `setView` direct.
- **Itinéraire** : `urlItineraire()` (Apple Plans sur iOS, Google Maps ailleurs) et `lienYAller()` ; le lien est un `<a>` frère du bouton `.ligne` dans le `<li>` (jamais dedans) et dans le popup. Affiché sur téléphone seulement (CSS) ; dans la liste, uniquement sur la ligne choisie (`.ligne-choisie`).
- **Mise en page** : mobile d'abord ; au-dessus de 800 px, liste de 420 px à gauche et carte à droite. Sous 800 px (téléphone) : filtre département masqué en CSS (et `toutAfficherSurTelephone()` rallume tous les départements si l'écran passe en mode téléphone), bascule Liste/Carte flottante en bas (`position: fixed`), pied de page masqué (le crédit des prix est dans l'attribution Leaflet et dans un `li.credit` en bas de la liste).
- **Accueil** (`#accueil`, section « Accueil » de `app.js`) : plein écran à la première visite, mémorisé par la clé `localStorage` `accueil-vu` (un petit script dans le `<head>` pose la classe `accueil-vu` sur `<html>` pour éviter l'éclair ; pour retester, vider cette clé). Le bouton « ? » le rouvre ; il contient aussi le choix du carburant (boutons radio en puces, `construireCarburants()`), seul endroit où on le change. Pendant qu'il est ouvert, `inert` est posé sur l'en-tête, `main`, la bascule et le pied de page. La commune saisie est cherchée sur `geo.api.gouv.fr` (un appel par département de la zone, sinon les homonymes du reste de la France noient les petites communes ; l'API exige l'apostrophe droite, les claviers de téléphone écrivent « ’ » : `chercherCommune` la remplace), puis la carte zoome à `ZOOM_COMMUNE` sans filtrer la liste. Les prix se chargent derrière l'accueil : si la recherche aboutit avant, `zoneChoisie` empêche `ajusterCarte()` de rezoomer sur le Rhône à leur arrivée. Le repère de la commune (`calqueCommune`) disparaît via `oublierZone()` au premier changement de filtre.
- **Commune** : le bouton `#effacer` (« × Toutes ») n'est visible que si une commune est choisie ; il remet le menu à vide, recadre la carte et redonne le focus au menu.

## Conventions

- Interface, commentaires et messages en français.
- Scène d'usage : conducteur à l'arrêt, au soleil, sur téléphone. Style « blanc pur et aéré » : fond blanc, texte presque noir, un seul accent bleu (`--accent`), filets fins, polices système, le prix est le seul gros élément.
- Un état ne repose jamais sur la couleur seule : point de couleur + mot « Bas / Moyen / Haut » sur les prix, coche sur les départements actifs.
- Pas de modale ; ce qui est inline reste inline.

## Design et qualité

Le skill `impeccable` est installé dans `.claude/skills/impeccable/` (non versionné). Après une modification de l'interface, lancer `.claude/skills/impeccable/scripts/impeccable.cmd detect --json index.html style.css app.js` ; la sortie attendue est `[]`. `PRODUCT.md` existe ; il n'y a pas encore de `DESIGN.md`.

## Git

Branche `main`, remote `origin` (`github.com/aucordier69/diesel`). Ne jamais ajouter `.claude/` au dépôt. Les avertissements LF/CRLF de git sont sans gravité.
