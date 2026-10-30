const API = 'https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/prix-des-carburants-en-france-flux-instantane-v2/records';
const PAGE = 100;
const ZOOM_PRIX = 12;      // à partir de ce zoom, la pastille affiche le prix
const JOURS_ANCIEN = 3;    // un prix plus vieux est signalé en toutes lettres
const COULEURS = { vert: '#15803d', orange: '#b45309', rouge: '#b91c1c' };
const NOMS_PALIER = { vert: 'Bas', orange: 'Moyen', rouge: 'Haut' };

// Le Rhône et les départements qui le touchent
const LISTE_DEPARTEMENTS = [
  ['01', 'Ain'],
  ['38', 'Isère'],
  ['42', 'Loire'],
  ['69', 'Rhône'],
  ['71', 'Saône-et-Loire'],
];
const DEPARTEMENTS = Object.fromEntries(LISTE_DEPARTEMENTS);
const CODES = LISTE_DEPARTEMENTS.map(([code]) => code);
const DEPARTEMENT_DE_DEPART = '69';

const liste = document.getElementById('liste');
const selectCommune = document.getElementById('commune');
const boutonEffacer = document.getElementById('effacer');
const boutonsDepartements = document.getElementById('departements');
const resume = document.getElementById('resume');
const principal = document.querySelector('main');
const boutonsVue = document.querySelectorAll('.vues button');
const telephone = window.matchMedia('(max-width: 799px)');

const carte = L.map('carte', { zoomControl: true }).setView([45.76, 4.84], 10);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 18,
  attribution: '&copy; contributeurs OpenStreetMap · Prix : prix-carburants.gouv.fr (Licence Ouverte 2.0)',
}).addTo(carte);
const calque = L.layerGroup().addTo(carte);
const calqueCommune = L.layerGroup().addTo(carte);   // repère de la commune cherchée à l'accueil

const ZOOM_COMMUNE = 13;       // une commune et ses abords ; pastilles-prix affichées
const CLE_ACCUEIL = 'accueil-vu-2';   // à changer quand l'accueil évolue : il réapparaît alors une fois pour tous
const CLE_CARBURANT = 'carburant';

// Les carburants de l'État (champs `<code>_prix` et `<code>_maj` de l'API), gazole d'abord
const CARBURANTS = [
  ['gazole', 'Gazole'],
  ['e10', 'SP95-E10'],
  ['sp98', 'SP98'],
  ['e85', 'E85'],
  ['sp95', 'SP95'],
  ['gplc', 'GPL'],
];
const NOMS_CARBURANTS = Object.fromEntries(CARBURANTS);

function lireCarburant() {
  try {
    const code = localStorage.getItem(CLE_CARBURANT);
    if (NOMS_CARBURANTS[code]) return code;
  } catch (e) { /* stockage bloqué : gazole */ }
  return 'gazole';
}

let carburant = lireCarburant();

// Un seul carburant est chargé à la fois (celui qui est choisi) : c'est ce qui rend le site rapide.
// Pages à demander d'emblée, toutes en parallèle (un peu au-dessus des comptes actuels de stations)
const PAGES_ATTENDUES = { gazole: 8, e10: 6, sp98: 6, e85: 4, sp95: 3, gplc: 1 };
const DUREE_CACHE = 10 * 60 * 1000;   // les prix sont actualisés toutes les 10 minutes
const cachePrix = new Map();          // code du carburant → { stations, instant }
let versionChargement = 0;            // ignore la réponse d'un carburant déjà abandonné
let controleChargement = null;
let enChargement = false;
let premiereCharge = true;            // la toute première arrivée de prix recadre la carte sur le Rhône

let zoneChoisie = null;        // commune cherchée avant l'arrivée des prix : ajusterCarte() la respecte une fois
let stations = [];
let entrees = [];          // { station, classe, marqueur, bouton }
let choisie = null;
let ajusterAuAffichage = false;
let premierAffichage = true;   // la carte s'ouvre sur le Rhône, pas sur toute la région
let modePrix = carte.getZoom() >= ZOOM_PRIX;
const departementsActifs = new Set(CODES);

/* ---------- Données ---------- */

async function chargerPage(code, debut, signal) {
  const codes = CODES.map((c) => `"${c}"`).join(',');
  const params = new URLSearchParams({
    where: `code_departement in (${codes}) and ${code}_prix is not null`,
    select: `id,ville,adresse,cp,code_departement,geom,${code}_prix,${code}_maj`,
    order_by: 'id',
    limit: PAGE,
    offset: debut,
  });
  const reponse = await fetch(`${API}?${params}`, { signal });
  if (!reponse.ok) throw new Error(`Erreur ${reponse.status}`);
  return reponse.json();
}

// Les stations d'un seul carburant, ramenées à { …, prix, maj } : le reste du code ignore de quel carburant il s'agit
async function chargerStations(code, signal) {
  const pages = PAGES_ATTENDUES[code] || 1;
  const reponses = await Promise.all(Array.from({ length: pages }, (_, i) => chargerPage(code, i * PAGE, signal)));
  // Plus de stations que prévu : on complète
  const manquantes = [];
  for (let debut = pages * PAGE; debut < reponses[0].total_count; debut += PAGE) {
    manquantes.push(chargerPage(code, debut, signal));
  }
  reponses.push(...await Promise.all(manquantes));
  return reponses
    .flatMap((r) => r.results)
    .filter((s) => s.geom)
    .map((s) => ({
      id: s.id,
      ville: s.ville,
      adresse: s.adresse,
      cp: s.cp,
      code_departement: s.code_departement,
      geom: s.geom,
      prix: s[`${code}_prix`],
      maj: s[`${code}_maj`],
    }));
}

/* ---------- Mise en forme ---------- */

const virgule = (n) => n.toFixed(3).replace('.', ',');

function palier(prix, min, max) {
  const tiers = (max - min) / 3;
  if (prix <= min + tiers) return 'vert';
  if (prix <= min + 2 * tiers) return 'orange';
  return 'rouge';
}

// Un seul formateur, créé une fois : toLocaleDateString() en recrée un à chaque appel (×716 = 150 ms perdues)
const FORMAT_JOUR = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });

function fraicheur(iso) {
  const heures = Math.max(0, Math.floor((Date.now() - new Date(iso)) / 3600000));
  const jours = Math.floor(heures / 24);
  if (heures < 1) return { texte: 'Prix de moins d’1 h', ancien: false };
  if (heures < 24) return { texte: `Prix d’il y a ${heures} h`, ancien: false };
  return { texte: `Prix d’il y a ${jours} j (${FORMAT_JOUR.format(new Date(iso))})`, ancien: jours >= JOURS_ANCIEN };
}

/* ---------- Itinéraire (téléphone) ---------- */

const EST_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);   // iPad qui se présente en Mac

// L'appli de cartes du téléphone : Plans sur iPhone, Google Maps ailleurs
function urlItineraire(lat, lon, ios) {
  if (ios) return `https://maps.apple.com/?daddr=${lat},${lon}&dirflg=d`;
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}&travelmode=driving`;
}

// Un vrai lien (il ouvre une autre application), masqué sur grand écran par le CSS
function lienYAller(s) {
  const a = document.createElement('a');
  a.className = 'y-aller';
  a.href = urlItineraire(s.geom.lat, s.geom.lon, EST_IOS);
  a.target = '_blank';
  a.rel = 'noopener';
  a.setAttribute('aria-label', `Y aller : itinéraire vers ${s.ville}, ${s.adresse}`);
  a.innerHTML = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false"><path d="M14 2 2 7.2l4.8 1.9L8.8 14z" fill="currentColor"/></svg>Y aller';
  return a;
}

/* ---------- Carte ---------- */

function icone(entree, zoom) {
  const { station, classe } = entree;
  const choix = station.id === choisie ? ' choisie' : '';
  if (zoom >= ZOOM_PRIX) {
    return L.divIcon({
      className: '',
      html: `<div class="pastille-prix${choix}" style="width:70px;height:28px"><i style="background:${COULEURS[classe]}"></i>${virgule(station.prix)}</div>`,
      iconSize: [70, 28],
      iconAnchor: [35, 14],
    });
  }
  return L.divIcon({
    className: '',
    html: `<div class="pastille${choix}" style="background:${COULEURS[classe]};width:22px;height:22px"></div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
}

function majIcone(entree) {
  entree.marqueur.setIcon(icone(entree, carte.getZoom()));
}

function carteVisible() {
  return carte.getContainer().offsetParent !== null;
}

// Sur téléphone la carte est cachée au démarrage (vue Liste) : on ne pose les ~700 marqueurs dessus
// que quand elle devient visible (garnirCarte), pas avant
let carteGarnie = true;
function garnirCarte() {
  if (carteGarnie) return;
  carteGarnie = true;
  entrees.forEach((e) => calque.addLayer(e.marqueur));
}

function ajusterCarte() {
  garnirCarte();
  carte.invalidateSize();
  // Tout mouvement de carte passe par ici et sans animation : Leaflet ignore un setView
  // demandé pendant une animation en cours (c'était le bug « le zoom ne marche pas »)
  if (zoneChoisie) {
    carte.setView([zoneChoisie.lat, zoneChoisie.lon], ZOOM_COMMUNE, { animate: false });
    if (stations.length) zoneChoisie = null;   // sinon on la garde : afficher() la respectera à l'arrivée des prix
    ajusterAuAffichage = false;
    return;
  }
  let retenues = entrees;
  if (premierAffichage) {
    const rhone = entrees.filter((e) => e.station.code_departement === DEPARTEMENT_DE_DEPART);
    if (rhone.length) retenues = rhone;
  }
  const points = retenues.map((e) => e.marqueur.getLatLng());
  if (points.length) carte.fitBounds(points, { padding: [40, 40], maxZoom: 14, animate: false });
  ajusterAuAffichage = false;
}

/* ---------- Vues (téléphone) ---------- */

function montrerVue(vue) {
  principal.dataset.vue = vue;
  boutonsVue.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.vue === vue)));
  if (vue === 'carte') {
    garnirCarte();
    carte.invalidateSize();
    if (ajusterAuAffichage) ajusterCarte();
  }
}

boutonsVue.forEach((b) => b.addEventListener('click', () => montrerVue(b.dataset.vue)));

/* ---------- Sélection d'une station ---------- */

function choisir(entree, { depuisCarte = false } = {}) {
  const precedente = entrees.find((e) => e.station.id === choisie);
  choisie = entree.station.id;
  if (precedente) {
    precedente.bouton.removeAttribute('aria-current');
    precedente.bouton.parentElement.classList.remove('ligne-choisie');
    precedente.bouton.parentElement.querySelector('.y-aller')?.remove();
    precedente.marqueur.setZIndexOffset(0);
    majIcone(precedente);
  }
  entree.bouton.setAttribute('aria-current', 'true');
  const ligne = entree.bouton.parentElement;
  ligne.classList.add('ligne-choisie');   // révèle « Y aller » sur téléphone
  // Frère du bouton, pas dedans (un lien ne s'imbrique pas dans un bouton) ; créé seulement pour la ligne choisie
  if (!ligne.querySelector('.y-aller')) ligne.appendChild(lienYAller(entree.station));
  entree.marqueur.setZIndexOffset(2000);
  majIcone(entree);

  if (depuisCarte) {
    entree.bouton.scrollIntoView({ block: 'nearest' });
  } else {
    if (telephone.matches) montrerVue('carte');
    carte.setView([entree.station.geom.lat, entree.station.geom.lon], Math.max(carte.getZoom(), 14));
    entree.marqueur.openPopup();
  }
}

/* ---------- Filtres ---------- */

function construireDepartements() {
  boutonsDepartements.innerHTML = '';
  CODES.forEach((code) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.code = code;
    b.setAttribute('aria-pressed', 'true');
    b.textContent = DEPARTEMENTS[code];
    b.title = `${DEPARTEMENTS[code]} (${code})`;
    b.addEventListener('click', () => basculerDepartement(code));
    boutonsDepartements.appendChild(b);
  });
}

function majDepartements() {
  // Jamais de liste vide : si tout est décoché, on rallume tout
  if (!departementsActifs.size) CODES.forEach((c) => departementsActifs.add(c));
  boutonsDepartements.querySelectorAll('button').forEach((b) =>
    b.setAttribute('aria-pressed', String(departementsActifs.has(b.dataset.code))));
  premierAffichage = false;
  oublierZone();
  construireCommunes();
  afficher();
}

function basculerDepartement(code) {
  if (departementsActifs.has(code)) departementsActifs.delete(code);
  else departementsActifs.add(code);
  majDepartements();
}

// Sur téléphone, le filtre département n'existe pas : tout doit être affiché
function toutAfficherSurTelephone() {
  if (!telephone.matches || departementsActifs.size === CODES.length) return;
  CODES.forEach((c) => departementsActifs.add(c));
  majDepartements();
}

function construireCommunes() {
  const avant = selectCommune.value;
  selectCommune.length = 1;
  const vues = new Map();
  stations
    .filter((s) => departementsActifs.has(s.code_departement))
    .forEach((s) => vues.set(`${s.code_departement}|${s.ville}`, s));
  [...vues.entries()]
    .sort((a, b) => a[1].ville.localeCompare(b[1].ville, 'fr'))
    .forEach(([cle, s]) => selectCommune.add(new Option(`${s.ville} (${s.code_departement})`, cle)));
  selectCommune.value = vues.has(avant) ? avant : '';
}

/* ---------- Affichage ---------- */

// Contenu de la bulle d'une station, construit seulement quand elle s'ouvre (et non pour les 700 stations d'avance)
function construirePopup(s) {
  const popup = document.createElement('div');
  popup.className = 'popup';
  popup.innerHTML = '<strong></strong><br><span class="adr"></span><span class="popup-prix"></span><small></small>';
  popup.querySelector('strong').textContent = s.ville;
  popup.querySelector('.adr').textContent = `${s.adresse}, ${s.cp}`;
  popup.querySelector('.popup-prix').textContent = `${virgule(s.prix)} €/L`;
  popup.querySelector('small').textContent = fraicheur(s.maj).texte;
  popup.appendChild(lienYAller(s));
  return popup;
}

// garderCarte : changer de carburant ne doit pas faire bouger la carte
function afficher({ garderCarte = false } = {}) {
  if (enChargement) return;   // les prix arrivent : afficher() sera rappelé avec eux
  const commune = selectCommune.value;
  // `stations` ne contient que le carburant choisi
  const dansDepartements = stations.filter((s) => departementsActifs.has(s.code_departement));
  const visibles = dansDepartements
    .filter((s) => !commune || `${s.code_departement}|${s.ville}` === commune)
    .sort((a, b) => a.prix - b.prix);

  // Les paliers se calculent sur tous les départements cochés, pour rester comparables
  const prixRepere = dansDepartements.map((s) => s.prix);
  const min = Math.min(...prixRepere);
  const max = Math.max(...prixRepere);

  liste.innerHTML = '';
  liste.removeAttribute('aria-busy');
  calque.clearLayers();
  entrees = [];
  choisie = null;

  visibles.forEach((s, i) => {
    const classe = palier(s.prix, min, max);
    const entree = { station: s, classe };

    entree.marqueur = L.marker([s.geom.lat, s.geom.lon], {
      icon: icone(entree, carte.getZoom()),
      zIndexOffset: 1000 - i,
      title: `${s.ville}, ${virgule(s.prix)} € le litre`,
    });   // posé sur la carte par garnirCarte()

    const frais = fraicheur(s.maj);
    const nomDepartement = DEPARTEMENTS[s.code_departement];
    entree.marqueur.bindPopup(() => construirePopup(s));
    entree.marqueur.on('click', () => choisir(entree, { depuisCarte: true }));

    const li = document.createElement('li');
    const bouton = document.createElement('button');
    bouton.type = 'button';
    bouton.className = 'ligne';
    bouton.innerHTML =
      `<span class="rang">${i + 1}</span>` +
      '<span class="infos"><span class="ville"></span><span class="adresse"></span><span class="fraicheur"></span></span>' +
      `<span class="prix ${classe}"><b>${virgule(s.prix)}</b><small>${NOMS_PALIER[classe]}</small></span>`;
    bouton.querySelector('.ville').textContent = s.ville;
    bouton.querySelector('.adresse').textContent = `${s.adresse.toLowerCase()} · ${nomDepartement}`;
    const f = bouton.querySelector('.fraicheur');
    f.textContent = frais.texte;
    if (frais.ancien) f.classList.add('ancien');
    if (s.prix === min) {
      const tag = document.createElement('span');
      tag.className = 'meilleur';
      tag.textContent = 'Le moins cher';
      bouton.querySelector('.ville').append(tag);
    }
    bouton.addEventListener('click', () => choisir(entree));
    li.appendChild(bouton);
    liste.appendChild(li);
    entree.bouton = bouton;
    entrees.push(entree);
  });

  const credit = document.createElement('li');
  credit.className = 'credit';
  credit.textContent = 'Données : prix-carburants.gouv.fr (Licence Ouverte 2.0), actualisées toutes les 10 min environ.';
  liste.appendChild(credit);

  carteGarnie = false;
  if (carteVisible()) garnirCarte();

  boutonEffacer.hidden = !commune;
  liste.scrollTop = 0;
  if (!garderCarte) {
    ajusterAuAffichage = true;
    if (carteVisible()) ajusterCarte();
  }

  if (visibles.length) {
    const prix = visibles.map((s) => s.prix);
    resume.textContent = `${NOMS_CARBURANTS[carburant]} · ${visibles.length} station${visibles.length > 1 ? 's' : ''} · de ${virgule(Math.min(...prix))} à ${virgule(Math.max(...prix))} € le litre`;
  } else {
    resume.textContent = `${NOMS_CARBURANTS[carburant]} · aucune station ne le vend ici.`;
  }
}

function erreur() {
  enChargement = false;
  liste.removeAttribute('aria-busy');
  liste.innerHTML =
    '<li class="message"><p>Impossible de charger les prix pour le moment.</p>' +
    '<button type="button">Réessayer</button></li>';
  liste.querySelector('button').addEventListener('click', () => chargerCarburant());
  resume.textContent = `${NOMS_CARBURANTS[carburant]} · prix indisponibles.`;
}

// Ce qui s'affiche pendant que les prix du carburant choisi arrivent
function etatChargement() {
  enChargement = true;
  stations = [];
  entrees = [];
  choisie = null;
  calque.clearLayers();
  resume.textContent = `${NOMS_CARBURANTS[carburant]} · chargement des prix…`;
  liste.setAttribute('aria-busy', 'true');
  liste.innerHTML = '<li class="squelette" aria-hidden="true"></li>'.repeat(6);
}

function appliquerStations(donnees) {
  enChargement = false;
  stations = donnees;
  construireCommunes();
  const premiere = premiereCharge;
  afficher({ garderCarte: !premiere });   // changer de carburant ne fait pas bouger la carte
  if (!premiere) zoneChoisie = null;      // la commune demandée pendant le chargement est déjà à l'écran
  premiereCharge = false;
}

// Charge les prix du carburant choisi, et de lui seul. Déjà chargé il y a moins de 10 minutes : aucun appel réseau.
async function chargerCarburant() {
  const code = carburant;
  const version = ++versionChargement;
  if (controleChargement) controleChargement.abort();   // un autre carburant était en cours : on l'abandonne
  const enCache = cachePrix.get(code);
  if (enCache && Date.now() - enCache.instant < DUREE_CACHE) {
    appliquerStations(enCache.stations);
    return;
  }
  controleChargement = new AbortController();
  etatChargement();
  try {
    const donnees = await chargerStations(code, controleChargement.signal);
    if (version !== versionChargement) return;   // réponse d'un carburant abandonné entre-temps
    cachePrix.set(code, { stations: donnees, instant: Date.now() });
    appliquerStations(donnees);
  } catch (e) {
    if (version !== versionChargement) return;   // annulé volontairement
    erreur();
  }
}

selectCommune.addEventListener('change', () => {
  premierAffichage = false;
  oublierZone();
  afficher();
});
carte.on('zoomend', () => {
  // Les icônes ne changent de forme (point ou prix) qu'en franchissant le seuil de zoom
  const prix = carte.getZoom() >= ZOOM_PRIX;
  if (prix !== modePrix) {
    modePrix = prix;
    entrees.forEach(majIcone);
  }
});
boutonEffacer.addEventListener('click', () => {
  selectCommune.value = '';
  premierAffichage = false;
  oublierZone();
  afficher();
  selectCommune.focus();   // le bouton vient de disparaître : le focus ne doit pas se perdre
});
telephone.addEventListener('change', () => {
  toutAfficherSurTelephone();
  if (carteVisible()) garnirCarte();
  carte.invalidateSize();
});

// Les prix passent avant tout : lancés ici, avant l'accueil, pour qu'un incident d'interface ne les empêche jamais
chargerCarburant();

/* ---------- Accueil ---------- */

const titreAccueil = document.getElementById('accueil-titre');
const formAccueil = document.getElementById('accueil-form');
const champAccueil = document.getElementById('accueil-commune');
const boutonAccueilRecherche = formAccueil.querySelector('button[type="submit"]');
const messageAccueil = document.getElementById('accueil-message');
const boutonAccueilFermer = document.getElementById('accueil-fermer');
const boutonAide = document.getElementById('aide');
const conteneurCarburants = document.getElementById('accueil-carburants');
// Tant que l'accueil est ouvert, le reste de la page n'est ni focalisable ni lisible par un lecteur d'écran
const zonesDerriere = ['.entete', 'main', '.vues', 'footer'].map((s) => document.querySelector(s));

const accueilOuvert = () => !document.documentElement.classList.contains('accueil-vu');

function ecrireVu() {
  try { localStorage.setItem(CLE_ACCUEIL, '1'); } catch (e) { /* stockage bloqué : l'accueil reviendra, sans gravité */ }
}

function construireCarburants() {
  conteneurCarburants.replaceChildren(...CARBURANTS.map(([code, nom]) => {
    const puce = document.createElement('label');
    puce.className = 'puce';
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'carburant';
    radio.value = code;
    radio.checked = code === carburant;
    radio.addEventListener('change', () => changerCarburant(code));
    const texte = document.createElement('span');
    texte.textContent = nom;
    puce.append(radio, texte);
    return puce;
  }));
}

function changerCarburant(code) {
  if (code === carburant) return;
  carburant = code;
  try { localStorage.setItem(CLE_CARBURANT, code); } catch (e) { /* stockage bloqué : le choix ne sera pas retenu, sans gravité */ }
  chargerCarburant();   // les prix du nouveau carburant (ou ceux déjà en cache depuis moins de 10 min)
}

function ouvrirAccueil() {
  document.documentElement.classList.remove('accueil-vu');
  zonesDerriere.forEach((z) => { z.inert = true; });
  messageAccueil.replaceChildren();
  titreAccueil.focus();   // pas le champ : sur téléphone, le clavier cacherait le texte
}

function fermerAccueil() {
  ecrireVu();
  document.documentElement.classList.add('accueil-vu');
  zonesDerriere.forEach((z) => { z.inert = false; });
  boutonAide.focus();
}

function paragraphe(texte, classe) {
  const p = document.createElement('p');
  p.textContent = texte;
  if (classe) p.className = classe;
  return p;
}

const normaliser = (t) => t.normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[-'’]/g, ' ').replace(/\s+/g, ' ').trim();

// geo.api.gouv.fr : un appel par département de la zone, pour que les petites communes
// ne soient pas noyées parmi les homonymes du reste de la France
async function chercherCommune(texte) {
  const controle = new AbortController();
  const minuteur = setTimeout(() => controle.abort(), 6000);
  try {
    const reponses = await Promise.all(CODES.map(async (code) => {
      const params = new URLSearchParams({
        // Les claviers de téléphone écrivent « ’ » ; l'API ne connaît que l'apostrophe droite
        nom: texte.replace(/[’‘ʼ´`]/g, "'"),
        codeDepartement: code,
        fields: 'nom,centre,departement,population',
        boost: 'population',
        limit: 5,
      });
      const reponse = await fetch(`https://geo.api.gouv.fr/communes?${params}`, { signal: controle.signal });
      if (!reponse.ok) throw new Error(`Erreur ${reponse.status}`);
      return reponse.json();
    }));
    const cherche = normaliser(texte);
    const exacte = (c) => (normaliser(c.nom) === cherche ? 1 : 0);
    return reponses.flat()
      .filter((c) => c.centre)
      .sort((a, b) => exacte(b) - exacte(a) || (b.population || 0) - (a.population || 0))
      .slice(0, 6);
  } finally {
    clearTimeout(minuteur);
  }
}

function oublierZone() {
  calqueCommune.clearLayers();
  zoneChoisie = null;
}

function zoomerSur(commune) {
  const [lon, lat] = commune.centre.coordinates;
  fermerAccueil();
  premierAffichage = false;
  oublierZone();
  zoneChoisie = { lat, lon };
  if (telephone.matches) montrerVue('carte');   // peut déjà consommer la zone via ajusterCarte()
  if (zoneChoisie) ajusterCarte();
  L.circleMarker([lat, lon], { radius: 9, color: '#fff', weight: 3, fillColor: '#1d4ed8', fillOpacity: 1 })
    .bindTooltip(commune.nom, { permanent: true, direction: 'top', offset: [0, -8], className: 'repere-commune' })
    .addTo(calqueCommune);
}

function proposer(communes) {
  const propositions = document.createElement('div');
  propositions.className = 'propositions';
  communes.forEach((c) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = `${c.nom} (${c.departement.nom})`;
    b.addEventListener('click', () => zoomerSur(c));
    propositions.appendChild(b);
  });
  messageAccueil.replaceChildren(paragraphe('Plusieurs communes correspondent. Laquelle ?'), propositions);
}

async function envoyerAccueil(evenement) {
  evenement.preventDefault();
  const texte = champAccueil.value.trim();
  if (!texte) {
    messageAccueil.replaceChildren(paragraphe('Écris le nom d’une commune, ou touche « go (sans commune) ».'));
    return;
  }
  boutonAccueilRecherche.disabled = true;
  boutonAccueilRecherche.textContent = 'Recherche…';
  let trouvees;
  try {
    trouvees = await chercherCommune(texte);
  } catch (e) {
    messageAccueil.replaceChildren(paragraphe('Impossible de chercher cette commune pour l’instant. Tu peux entrer dans l’application.'));
    return;
  } finally {
    boutonAccueilRecherche.disabled = false;
    boutonAccueilRecherche.textContent = 'go';
  }
  if (!trouvees.length) {
    messageAccueil.replaceChildren(
      paragraphe('Connais-tu ta géographie ?', 'accueil-erreur'),
      paragraphe('Cette commune n’est pas dans le Rhône ni dans les départements limitrophes.'),
    );
    return;
  }
  const cherche = normaliser(texte);
  const exactes = trouvees.filter((c) => normaliser(c.nom) === cherche);
  const candidates = exactes.length ? exactes : trouvees;
  if (candidates.length === 1) zoomerSur(candidates[0]);
  else proposer(candidates);
}

formAccueil.addEventListener('submit', envoyerAccueil);
boutonAccueilFermer.addEventListener('click', fermerAccueil);
boutonAide.addEventListener('click', ouvrirAccueil);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && accueilOuvert()) fermerAccueil();
});

construireDepartements();
construireCarburants();
if (accueilOuvert()) ouvrirAccueil();
