const API = 'https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/prix-des-carburants-en-france-flux-instantane-v2/records';
const PAGE = 100;
const ZOOM_PRIX = 12;      // à partir de ce zoom, la pastille affiche le prix
const JOURS_ANCIEN = 3;    // un prix plus vieux est signalé en toutes lettres
const COULEURS = { vert: '#1b7a3e', orange: '#a8500a', rouge: '#b3261e' };
const NOMS_PALIER = { vert: 'Bas', orange: 'Moyen', rouge: 'Haut' };

const liste = document.getElementById('liste');
const selectCommune = document.getElementById('commune');
const resume = document.getElementById('resume');
const principal = document.querySelector('main');
const boutonsVue = document.querySelectorAll('.vues button');
const telephone = window.matchMedia('(max-width: 799px)');

const carte = L.map('carte', { zoomControl: true }).setView([45.76, 4.84], 10);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 18,
  attribution: '&copy; contributeurs OpenStreetMap',
}).addTo(carte);
const calque = L.layerGroup().addTo(carte);

let stations = [];
let entrees = [];          // { station, classe, marqueur, bouton }
let choisie = null;
let ajusterAuAffichage = false;

/* ---------- Données ---------- */

async function chargerPage(debut) {
  const params = new URLSearchParams({
    where: 'code_departement="69" and gazole_prix is not null',
    select: 'id,ville,adresse,cp,geom,gazole_prix,gazole_maj',
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
  let tout = premiere.results;
  for (let debut = PAGE; debut < premiere.total_count; debut += PAGE) {
    tout = tout.concat((await chargerPage(debut)).results);
  }
  return tout.filter((s) => s.geom);
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
      html: `<div class="pastille-prix${choix}" style="background:${COULEURS[classe]};width:56px;height:28px">${virgule(station.gazole_prix)}</div>`,
      iconSize: [56, 28],
      iconAnchor: [28, 14],
    });
  }
  return L.divIcon({
    className: '',
    html: `<div class="pastille${choix}" style="background:${COULEURS[classe]};width:22px;height:22px"></div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
}

function rafraichirIcones() {
  const zoom = carte.getZoom();
  entrees.forEach((e) => e.marqueur.setIcon(icone(e, zoom)));
}

function carteVisible() {
  return carte.getContainer().offsetParent !== null;
}

function ajusterCarte() {
  carte.invalidateSize();
  const points = entrees.map((e) => e.marqueur.getLatLng());
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
  }
  entree.bouton.setAttribute('aria-current', 'true');
  entree.marqueur.setZIndexOffset(2000);
  rafraichirIcones();

  if (depuisCarte) {
    entree.bouton.scrollIntoView({ block: 'nearest' });
  } else {
    if (telephone.matches) montrerVue('carte');
    carte.setView([entree.station.geom.lat, entree.station.geom.lon], Math.max(carte.getZoom(), 14));
    entree.marqueur.openPopup();
  }
}

/* ---------- Affichage ---------- */

function afficher() {
  const commune = selectCommune.value;
  const visibles = stations
    .filter((s) => !commune || s.ville === commune)
    .sort((a, b) => a.gazole_prix - b.gazole_prix);

  const prixRhone = stations.map((s) => s.gazole_prix);
  const min = Math.min(...prixRhone);
  const max = Math.max(...prixRhone);

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
      `<span class="prix ${classe}"><b>${virgule(s.gazole_prix)}</b><small>${NOMS_PALIER[classe]} · €/L</small></span>`;
    bouton.querySelector('.ville').textContent = s.ville;
    bouton.querySelector('.adresse').textContent = s.adresse.toLowerCase();
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
      selectCommune.length = 1;
      [...new Set(stations.map((s) => s.ville))]
        .sort((a, b) => a.localeCompare(b, 'fr'))
        .forEach((c) => selectCommune.add(new Option(c, c)));
      afficher();
    })
    .catch(erreur);
}

selectCommune.addEventListener('change', afficher);
carte.on('zoomend', rafraichirIcones);
telephone.addEventListener('change', () => {
  if (!telephone.matches) carte.invalidateSize();
});

demarrer();
