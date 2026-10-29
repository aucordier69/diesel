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

let stations = [];
let entrees = [];          // { station, classe, marqueur, bouton }
let choisie = null;
let ajusterAuAffichage = false;
let premierAffichage = true;   // la carte s'ouvre sur le Rhône, pas sur toute la région
let modePrix = carte.getZoom() >= ZOOM_PRIX;
const departementsActifs = new Set(CODES);

/* ---------- Données ---------- */

async function chargerPage(debut) {
  const codes = CODES.map((c) => `"${c}"`).join(',');
  const params = new URLSearchParams({
    where: `code_departement in (${codes}) and gazole_prix is not null`,
    select: 'id,ville,adresse,cp,code_departement,geom,gazole_prix,gazole_maj',
    order_by: 'id',
    limit: PAGE,
    offset: debut,
  });
  const reponse = await fetch(`${API}?${params}`);
  if (!reponse.ok) throw new Error(`Erreur ${reponse.status}`);
  return reponse.json();
}

async function chargerStations() {
  const premiere = await chargerPage(0);
  const suivantes = [];
  for (let debut = PAGE; debut < premiere.total_count; debut += PAGE) {
    suivantes.push(chargerPage(debut));
  }
  const pages = await Promise.all(suivantes);
  return premiere.results
    .concat(...pages.map((p) => p.results))
    .filter((s) => s.geom);
}

/* ---------- Mise en forme ---------- */

const virgule = (n) => n.toFixed(3).replace('.', ',');

function palier(prix, min, max) {
  const tiers = (max - min) / 3;
  if (prix <= min + tiers) return 'vert';
  if (prix <= min + 2 * tiers) return 'orange';
  return 'rouge';
}

function fraicheur(iso) {
  const heures = Math.max(0, Math.floor((Date.now() - new Date(iso)) / 3600000));
  const jours = Math.floor(heures / 24);
  const date = new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  if (heures < 1) return { texte: 'Prix de moins d’1 h', ancien: false };
  if (heures < 24) return { texte: `Prix d’il y a ${heures} h`, ancien: false };
  return { texte: `Prix d’il y a ${jours} j (${date})`, ancien: jours >= JOURS_ANCIEN };
}

/* ---------- Carte ---------- */

function icone(entree, zoom) {
  const { station, classe } = entree;
  const choix = station.id === choisie ? ' choisie' : '';
  if (zoom >= ZOOM_PRIX) {
    return L.divIcon({
      className: '',
      html: `<div class="pastille-prix${choix}" style="width:70px;height:28px"><i style="background:${COULEURS[classe]}"></i>${virgule(station.gazole_prix)}</div>`,
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

function ajusterCarte() {
  carte.invalidateSize();
  let retenues = entrees;
  if (premierAffichage) {
    const rhone = entrees.filter((e) => e.station.code_departement === DEPARTEMENT_DE_DEPART);
    if (rhone.length) retenues = rhone;
  }
  const points = retenues.map((e) => e.marqueur.getLatLng());
  if (points.length) carte.fitBounds(points, { padding: [40, 40], maxZoom: 14 });
  ajusterAuAffichage = false;
}

/* ---------- Vues (téléphone) ---------- */

function montrerVue(vue) {
  principal.dataset.vue = vue;
  boutonsVue.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.vue === vue)));
  if (vue === 'carte') {
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
    precedente.marqueur.setZIndexOffset(0);
    majIcone(precedente);
  }
  entree.bouton.setAttribute('aria-current', 'true');
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

function afficher() {
  const commune = selectCommune.value;
  const dansDepartements = stations.filter((s) => departementsActifs.has(s.code_departement));
  const visibles = dansDepartements
    .filter((s) => !commune || `${s.code_departement}|${s.ville}` === commune)
    .sort((a, b) => a.gazole_prix - b.gazole_prix);

  // Les paliers se calculent sur tous les départements cochés, pour rester comparables
  const prixRepere = dansDepartements.map((s) => s.gazole_prix);
  const min = Math.min(...prixRepere);
  const max = Math.max(...prixRepere);

  liste.innerHTML = '';
  liste.removeAttribute('aria-busy');
  calque.clearLayers();
  entrees = [];
  choisie = null;

  visibles.forEach((s, i) => {
    const classe = palier(s.gazole_prix, min, max);
    const entree = { station: s, classe };

    entree.marqueur = L.marker([s.geom.lat, s.geom.lon], {
      icon: icone(entree, carte.getZoom()),
      zIndexOffset: 1000 - i,
      title: `${s.ville}, ${virgule(s.gazole_prix)} € le litre`,
    }).addTo(calque);

    const frais = fraicheur(s.gazole_maj);
    const nomDepartement = DEPARTEMENTS[s.code_departement];
    const popup = document.createElement('div');
    popup.className = 'popup';
    popup.innerHTML = '<strong></strong><br><span class="adr"></span><span class="popup-prix"></span><small></small>';
    popup.querySelector('strong').textContent = s.ville;
    popup.querySelector('.adr').textContent = `${s.adresse}, ${s.cp}`;
    popup.querySelector('.popup-prix').textContent = `${virgule(s.gazole_prix)} €/L`;
    popup.querySelector('small').textContent = frais.texte;
    entree.marqueur.bindPopup(popup);
    entree.marqueur.on('click', () => choisir(entree, { depuisCarte: true }));

    const li = document.createElement('li');
    const bouton = document.createElement('button');
    bouton.type = 'button';
    bouton.className = 'ligne';
    bouton.innerHTML =
      `<span class="rang">${i + 1}</span>` +
      '<span class="infos"><span class="ville"></span><span class="adresse"></span><span class="fraicheur"></span></span>' +
      `<span class="prix ${classe}"><b>${virgule(s.gazole_prix)}</b><small>${NOMS_PALIER[classe]}</small></span>`;
    bouton.querySelector('.ville').textContent = s.ville;
    bouton.querySelector('.adresse').textContent = `${s.adresse.toLowerCase()} · ${nomDepartement}`;
    const f = bouton.querySelector('.fraicheur');
    f.textContent = frais.texte;
    if (frais.ancien) f.classList.add('ancien');
    if (s.gazole_prix === min) {
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

  boutonEffacer.hidden = !commune;
  liste.scrollTop = 0;
  ajusterAuAffichage = true;
  if (carteVisible()) ajusterCarte();

  if (visibles.length) {
    const prix = visibles.map((s) => s.gazole_prix);
    resume.textContent = `${visibles.length} station${visibles.length > 1 ? 's' : ''} · de ${virgule(Math.min(...prix))} à ${virgule(Math.max(...prix))} € le litre`;
  } else {
    resume.textContent = 'Aucune station.';
  }
}

function erreur() {
  liste.removeAttribute('aria-busy');
  liste.innerHTML =
    '<li class="message"><p>Impossible de charger les prix pour le moment.</p>' +
    '<button type="button">Réessayer</button></li>';
  liste.querySelector('button').addEventListener('click', demarrer);
  resume.textContent = 'Prix indisponibles.';
}

function demarrer() {
  resume.textContent = 'Chargement des prix…';
  liste.setAttribute('aria-busy', 'true');
  liste.innerHTML = '<li class="squelette" aria-hidden="true"></li>'.repeat(6);
  chargerStations()
    .then((donnees) => {
      stations = donnees;
      construireCommunes();
      afficher();
    })
    .catch(erreur);
}

selectCommune.addEventListener('change', () => {
  premierAffichage = false;
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
  afficher();
  selectCommune.focus();   // le bouton vient de disparaître : le focus ne doit pas se perdre
});
telephone.addEventListener('change', () => {
  toutAfficherSurTelephone();
  carte.invalidateSize();
});

construireDepartements();
demarrer();
