const API = 'https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/prix-des-carburants-en-france-flux-instantane-v2/records';
const PAGE = 100;

const liste = document.getElementById('liste');
const selectCommune = document.getElementById('commune');
const resume = document.getElementById('resume');

const carte = L.map('carte').setView([45.76, 4.84], 10);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 18,
  attribution: '&copy; contributeurs OpenStreetMap',
}).addTo(carte);
const calque = L.layerGroup().addTo(carte);

let stations = [];

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

function couleur(prix, min, max) {
  const tiers = (max - min) / 3;
  if (prix <= min + tiers) return 'vert';
  if (prix <= min + 2 * tiers) return 'orange';
  return 'rouge';
}

const COULEURS = { vert: '#2e9e4f', orange: '#e8a317', rouge: '#d93c3c' };

function formaterDate(iso) {
  return new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}

function afficher() {
  const commune = selectCommune.value;
  const visibles = stations
    .filter((s) => !commune || s.ville === commune)
    .sort((a, b) => a.gazole_prix - b.gazole_prix);

  const prixRhone = stations.map((s) => s.gazole_prix);
  const min = Math.min(...prixRhone);
  const max = Math.max(...prixRhone);

  liste.innerHTML = '';
  calque.clearLayers();

  visibles.forEach((s, i) => {
    const classe = couleur(s.gazole_prix, min, max);
    const prix = s.gazole_prix.toFixed(3).replace('.', ',');

    const marqueur = L.marker([s.geom.lat, s.geom.lon], {
      icon: L.divIcon({
        className: '',
        html: `<div class="pastille" style="background:${COULEURS[classe]};width:18px;height:18px"></div>`,
        iconSize: [18, 18],
      }),
    }).addTo(calque);
    marqueur.bindPopup(
      `<strong>${s.ville}</strong><br>${s.adresse}, ${s.cp}<br>` +
      `Gazole : <strong>${prix} €/L</strong><br><small>Prix du ${formaterDate(s.gazole_maj)}</small>`
    );

    const li = document.createElement('li');
    li.innerHTML =
      `<span class="rang">${i + 1}</span>` +
      `<span class="infos"><strong></strong><small></small></span>` +
      `<span class="prix ${classe}">${prix} €</span>`;
    li.querySelector('strong').textContent = s.ville;
    li.querySelector('small').textContent = s.adresse;
    li.addEventListener('click', () => {
      carte.setView([s.geom.lat, s.geom.lon], 15);
      marqueur.openPopup();
    });
    liste.appendChild(li);
  });

  if (visibles.length) {
    carte.invalidateSize();
    carte.fitBounds(calque.getLayers().map((m) => m.getLatLng()), { padding: [30, 30], maxZoom: 14 });
    resume.textContent = `${visibles.length} station(s) · de ${visibles[0].gazole_prix.toFixed(3).replace('.', ',')} € à ${visibles[visibles.length - 1].gazole_prix.toFixed(3).replace('.', ',')} € le litre`;
  } else {
    resume.textContent = 'Aucune station.';
  }
}

selectCommune.addEventListener('change', afficher);

chargerStations()
  .then((donnees) => {
    stations = donnees;
    const communes = [...new Set(stations.map((s) => s.ville))].sort((a, b) => a.localeCompare(b, 'fr'));
    communes.forEach((c) => selectCommune.add(new Option(c, c)));
    afficher();
  })
  .catch(() => {
    resume.textContent = 'Impossible de charger les prix pour le moment. Réessaie dans quelques minutes.';
  });
