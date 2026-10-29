// Two languages. The current language lives at module level so plain
// functions can read it; App keeps it in state too, so changing it
// re-renders everything.

export type Lang = 'en' | 'fr'

const KEY = 'tz.lang'

// Priority: ?lang= in the URL, then the saved choice, then the browser language.
function detect(): Lang {
  try {
    const fromUrl = new URLSearchParams(location.search).get('lang')
    if (fromUrl === 'en' || fromUrl === 'fr') return fromUrl
  } catch {
    // Not in a browser.
  }
  try {
    const saved = localStorage.getItem(KEY)
    if (saved === 'en' || saved === 'fr') return saved
  } catch {
    // Storage unavailable.
  }
  return typeof navigator !== 'undefined' && navigator.language && !navigator.language.startsWith('fr') ? 'en' : 'fr'
}

let current: Lang = detect()

export const getLang = () => current
export const locale = () => (current === 'fr' ? 'fr-FR' : 'en-GB')

export function setLang(lang: Lang) {
  current = lang
  try {
    localStorage.setItem(KEY, lang)
  } catch {
    // Not critical.
  }
  if (typeof document !== 'undefined') document.documentElement.lang = lang
}

const en = {
  tagline: 'Café terraces in the sun, in Paris.',
  search: 'Address or terrace…',
  myLocation: 'My location',
  geoDenied: 'Location unavailable.',
  switchLang: 'Version française',
  loading: 'Loading terraces…',
  error: 'Error: {msg}',
  now: 'Now',
  today: 'Today',
  tomorrow: 'Tomorrow',
  time: 'Time',
  backToNow: 'Back to now',
  // Sky
  skyTitle: 'Sky',
  skySun: 'Sunny',
  skyMixed: 'Sun and clouds',
  skyCloud: 'Clouds hide the sun',
  skyNight: 'Night',
  skyUntil: 'until about {time}',
  skyFrom: 'sun back around {time}',
  skySat: 'Satellite',
  skyModel: 'Model (AROME)',
  skyChart: 'Chance the sun is out',
  skySatAt: 'Satellite image of {time}, clouds moving {dir} at {v} km/h',
  skySatStill: 'Satellite image of {time}, clouds almost stationary',
  skyNoSat: 'Satellite unavailable: model only.',
  skySatNight: 'Sun too low for the satellite: model only.',
  skyTemp: '{t}°C',
  dirs: 'north|north-east|east|south-east|south|south-west|west|north-west',
  dirsShort: 'N|NE|E|SE|S|SW|W|NW',
  // States
  sSun: 'In the sun',
  sPartial: 'Partly in the sun',
  sTrees: 'Dappled shade (trees)',
  sShade: 'In the shade',
  sCloud: 'Sunny spot, but cloudy',
  sNight: 'Sun down',
  until: 'until {time}',
  untilSunset: 'until sunset',
  from: 'sun from {time}',
  noMore: 'no more sun today',
  minutesLeft: '{d} of sun left',
  // List and map
  inView: '{n} terraces in view',
  sunnyNow: '{n} in the sun',
  zoomIn: 'Zoom in to see each terrace’s sun.',
  noneInView: 'No terrace here. Move or zoom the map.',
  showAll: 'Show all',
  onlySunny: 'Sunny only',
  // Detail
  close: 'Close',
  dims: '{L} × {W} m',
  dayStrip: 'Sun on the terrace today',
  skyPlot: 'Sky seen from the terrace',
  skyPlotHelp: 'Grey: buildings. Green: trees. Line: the sun’s path today, dot: the selected time.',
  stripLegendSun: 'Sun',
  stripLegendPartial: 'Partly',
  stripLegendTrees: 'Trees',
  stripLegendShade: 'Shade',
  stripLegendCloud: 'Clouds',
  past: 'past',
  forecastNote: 'Clouds: satellite for the next hour, then the AROME model; geometry only beyond 3 days.',
  // Method
  method: 'How it works',
  methodItems:
    'Terraces: official list of authorised terraces from the City of Paris (position and size), aligned on the nearest facade (IGN BD TOPO).|Shade: IGN LiDAR HD surface model (50 cm, buildings and trees). For three points on each terrace at seated height (1.1 m), the height of the obstacles is measured in every direction up to 400 m.|Sun: exact solar position (NOAA algorithm, refraction included), every 5 minutes.|Clouds: MTG satellite images (every 10 min) moved along the clouds’ motion and read where the line of sight to the sun crosses the cloud layer (parallax corrected); beyond an hour, AROME’s direct sunlight (sunny when ≥ 120 W/m², WMO definition).|Limits: awnings, umbrellas and new buildings are not in the data; trees are shown as dappled shade, their leaves vary with the season.',
  where: 'Where?',
  when: 'When?',
  terraces: 'Terraces in the sun',
  aroundMe: 'Around me',
  locating: 'Locating…',
  quartier: 'Choose a neighbourhood',
  arr: '{n}e arrondissement',
  inHours: 'In {n} h',
  otherTime: 'Another time',
  noneHere: 'No terrace here.',
  noneSunny: 'No terrace in the sun at that time.',
  nSunny: '{n} of {total} in the sun',
  showMore: '{n} more',
  soon: 'Soon in the sun',
  directions: 'Directions',
  why: 'Why?',
  checkQ: 'You’re there? Is the terrace in the sun?',
  aSun: 'Sun',
  aPartial: 'Partly',
  aShade: 'Shade',
  aCloud: 'Cloudy',
  thanks: 'Thanks, noted. It helps make the forecast better.',
  data: 'Data',
}

type Dict = typeof en
export type TKey = keyof Dict

const fr: Dict = {
  tagline: 'Les terrasses au soleil, à Paris.',
  search: 'Adresse ou terrasse…',
  myLocation: 'Ma position',
  geoDenied: 'Position indisponible.',
  switchLang: 'English version',
  loading: 'Chargement des terrasses…',
  error: 'Erreur : {msg}',
  now: 'Maintenant',
  today: 'Aujourd’hui',
  tomorrow: 'Demain',
  time: 'Heure',
  backToNow: 'Revenir à maintenant',
  skyTitle: 'Ciel',
  skySun: 'Soleil',
  skyMixed: 'Soleil et nuages',
  skyCloud: 'Les nuages cachent le soleil',
  skyNight: 'Nuit',
  skyUntil: 'jusqu’à {time} environ',
  skyFrom: 'retour du soleil vers {time}',
  skySat: 'Satellite',
  skyModel: 'Modèle (AROME)',
  skyChart: 'Probabilité de soleil',
  skySatAt: 'Image satellite de {time}, nuages se déplaçant vers le {dir} à {v} km/h',
  skySatStill: 'Image satellite de {time}, nuages quasi immobiles',
  skyNoSat: 'Satellite indisponible : modèle seul.',
  skySatNight: 'Soleil trop bas pour le satellite : modèle seul.',
  skyTemp: '{t} °C',
  dirs: 'nord|nord-est|est|sud-est|sud|sud-ouest|ouest|nord-ouest',
  dirsShort: 'N|NE|E|SE|S|SO|O|NO',
  sSun: 'Au soleil',
  sPartial: 'En partie au soleil',
  sTrees: 'Ombre légère (arbres)',
  sShade: 'À l’ombre',
  sCloud: 'Ensoleillée, mais nuages',
  sNight: 'Soleil couché',
  until: 'jusqu’à {time}',
  untilSunset: 'jusqu’au coucher du soleil',
  from: 'soleil à partir de {time}',
  noMore: 'plus de soleil aujourd’hui',
  minutesLeft: 'encore {d} de soleil',
  inView: '{n} terrasses visibles',
  sunnyNow: '{n} au soleil',
  zoomIn: 'Zoomez pour voir le soleil de chaque terrasse.',
  noneInView: 'Aucune terrasse ici. Déplacez ou zoomez la carte.',
  showAll: 'Toutes',
  onlySunny: 'Au soleil',
  close: 'Fermer',
  dims: '{L} × {W} m',
  dayStrip: 'Soleil sur la terrasse aujourd’hui',
  skyPlot: 'Le ciel vu de la terrasse',
  skyPlotHelp: 'Gris : immeubles. Vert : arbres. Ligne : la course du soleil ce jour-là, point : l’heure choisie.',
  stripLegendSun: 'Soleil',
  stripLegendPartial: 'Partiel',
  stripLegendTrees: 'Arbres',
  stripLegendShade: 'Ombre',
  stripLegendCloud: 'Nuages',
  past: 'passé',
  forecastNote: 'Nuages : satellite pour l’heure qui vient, puis modèle AROME ; géométrie seule au-delà de 3 jours.',
  method: 'Méthode',
  methodItems:
    'Terrasses : liste officielle des terrasses autorisées de la Ville de Paris (position et dimensions), alignées sur la façade la plus proche (IGN BD TOPO).|Ombre : modèle de surface LiDAR HD de l’IGN (50 cm, immeubles et arbres). Pour trois points de chaque terrasse à hauteur d’une personne assise (1,1 m), la hauteur des obstacles est mesurée dans toutes les directions jusqu’à 400 m.|Soleil : position exacte du soleil (algorithme NOAA, réfraction comprise), toutes les 5 minutes.|Nuages : images du satellite MTG (toutes les 10 min) déplacées selon le mouvement des nuages et lues là où la ligne de visée vers le soleil traverse la couche nuageuse (parallaxe corrigée) ; au-delà d’une heure, rayonnement direct du modèle AROME (soleil si ≥ 120 W/m², définition OMM).|Limites : les stores, parasols et immeubles récents ne sont pas dans les données ; les arbres sont comptés comme ombre légère, leur feuillage varie selon la saison.',
  where: 'Où ?',
  when: 'Quand ?',
  terraces: 'Terrasses au soleil',
  aroundMe: 'Autour de moi',
  locating: 'Localisation…',
  quartier: 'Choisir un quartier',
  arr: '{n}e arrondissement',
  inHours: 'Dans {n} h',
  otherTime: 'Autre heure',
  noneHere: 'Aucune terrasse ici.',
  noneSunny: 'Aucune terrasse au soleil à cette heure-là.',
  nSunny: '{n} sur {total} au soleil',
  showMore: '{n} de plus',
  soon: 'Bientôt au soleil',
  directions: 'Itinéraire',
  why: 'Pourquoi ?',
  checkQ: 'Vous y êtes ? La terrasse est-elle au soleil ?',
  aSun: 'Soleil',
  aPartial: 'En partie',
  aShade: 'Ombre',
  aCloud: 'Nuageux',
  thanks: 'Merci, c’est noté. Cela aide à améliorer la prévision.',
  data: 'Données',
}

const DICTS: Record<Lang, Dict> = { en, fr }

export function t(key: TKey, vars?: Record<string, string | number>): string {
  let s: string = DICTS[current][key]
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v))
  return s
}

export const tList = (key: TKey) => t(key).split('|')

export function num(v: number, digits = 0): string {
  const s = (Number(v.toFixed(digits)) || 0).toFixed(digits)
  return current === 'fr' ? s.replace('.', ',') : s
}

export const percent = (p: number) => (current === 'fr' ? `${Math.round(p * 100)} %` : `${Math.round(p * 100)}%`)
