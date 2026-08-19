// api/estimation-prospects-meta.js
// Calcule une estimation du potentiel de prospects via l'API Meta Marketing
// (Facebook/Instagram Ads) pour un couple activité + zone géographique donné.
//
// IMPORTANT — Meta fonctionne différemment de Google Ads : il n'y a pas de
// "volume de recherche" (les gens ne tapent pas de requête, l'algorithme cible
// des audiences par centres d'intérêt/comportement). Les métriques renvoyées
// sont donc différentes :
//   - audiencePotentielle : nombre de comptes Meta atteignables avec ce ciblage
//   - cpmMin / cpmMax     : coût estimé pour 1000 affichages (pas un CPC)
//   - clientsEstimesParMois : basé sur des hypothèses de CTR + conversion,
//     configurables (aucune de ces deux valeurs n'est fournie par l'API Meta)
//
// Étapes de l'API Meta Marketing utilisées :
//   - GET /search?type=adinterest      -> résout l'activité en centre d'intérêt Meta
//   - GET /search?type=adgeolocation   -> résout la zone en cible géographique Meta
//   - GET /act_{id}/delivery_estimate  -> audience potentielle + CPM estimé
//
// Variables d'environnement requises (Vercel > Project Settings > Environment Variables) :
//   META_ADS_ENABLED       "true" pour activer cette source (sinon toujours désactivée)
//   META_ACCESS_TOKEN      Token d'accès système (System User) avec la permission ads_read
//   META_AD_ACCOUNT_ID     Identifiant du compte publicitaire, SANS le préfixe "act_"
//   META_CTR_DEFAULT       Optionnel, ex. "0.01" pour 1% de taux de clic (défaut : 0.01)
//   CONVERSION_RATE_DEFAULT Optionnel, partagé avec l'estimation Google (défaut : 0.03)
//
// Tant que META_ADS_ENABLED n'est pas "true" ou que les autres variables manquent,
// l'endpoint répond en 503 avec la liste des variables manquantes plutôt que de
// planter — le front-end masque alors simplement le panneau Meta.

const API_VERSION = "v21.0";
const BASE_URL = `https://graph.facebook.com/${API_VERSION}`;

const REQUIRED_ENV = ["META_ACCESS_TOKEN", "META_AD_ACCOUNT_ID"];

async function metaGet(path, params) {
  const url = new URL(`${BASE_URL}${path}`);
  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(key, typeof value === "string" ? value : JSON.stringify(value));
  });
  url.searchParams.set("access_token", process.env.META_ACCESS_TOKEN);

  const res = await fetch(url.toString());
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Erreur Meta API (${res.status}): ${text}`);
  }
  return res.json();
}

// Les intitulés de métiers français bruts ("Couvreur") ne correspondent pas
// toujours à la taxonomie de centres d'intérêt de Meta (souvent en anglais,
// orientée grand public). On mappe chaque activité du site vers des termes de
// recherche plus susceptibles de matcher un centre d'intérêt Meta existant.
const INTEREST_QUERY_MAP = {
  couvreur: ["roofing", "home improvement"],
  terrassier: ["excavation", "construction"],
  étanchéité: ["waterproofing", "home improvement"],
  clôture: ["fencing", "home improvement"],
  charpentier: ["carpentry", "home improvement"],
  maçon: ["masonry", "construction"],
  électricien: ["electrician", "home improvement"],
  plombier: ["plumbing", "home improvement"],
};

// Résout l'activité ("Couvreur"...) en centre d'intérêt Meta le plus pertinent.
// On essaie d'abord les termes anglais mappés (plus fiables sur la taxonomie
// Meta) avant le terme français brut, qui peut matcher un intérêt totalement
// hors sujet par coïncidence de nom (ex. "Clôture" a pu matcher un intérêt
// lié à l'escrime plutôt qu'à la pose de clôtures).
async function resolveInterest(activite) {
  const key = activite.toLowerCase();
  const mapped = INTEREST_QUERY_MAP[key] || ["home improvement"];
  const queries = [...mapped, activite];

  for (const q of queries) {
    const data = await metaGet("/search", { type: "adinterest", q, limit: "5" });
    const results = data.data || [];
    if (results.length) return results[0]; // { id, name, audience_size_lower_bound, ... }
  }
  return null;
}

// Résout la zone ("Morbihan", "Vannes"...) en cible géographique Meta.
// country_code="FR" est indispensable : sans lui, la recherche peut renvoyer
// un lieu du même nom dans n'importe quel pays (ex. "Morbihan" a pu matcher
// une ville homonyme à l'étranger).
async function resolveGeo(zone) {
  const data = await metaGet("/search", {
    type: "adgeolocation",
    q: zone,
    location_types: ["region", "city"],
    country_code: "FR",
    limit: "5",
  });
  const results = data.data || [];
  return results.length ? results[0] : null; // { key, name, type, ... }
}

async function fetchDeliveryEstimate(interest, geo) {
  const accountId = process.env.META_AD_ACCOUNT_ID;
  const targetingSpec = {
    geo_locations: geo
      ? { [`${geo.type}s`]: [{ key: geo.key }] }
      : { countries: ["FR"] },
    interests: interest ? [{ id: interest.id, name: interest.name }] : undefined,
    publisher_platforms: ["facebook", "instagram"],
  };

  // Log de diagnostic : montre précisément ce que la résolution activité/zone
  // a trouvé côté Meta, et le ciblage exact envoyé à l'API.
  console.log(
    "estimation-prospects-meta resolved targeting:",
    JSON.stringify({ interest, geo, targetingSpec })
  );

  const data = await metaGet(`/act_${accountId}/delivery_estimate`, {
    optimization_goal: "REACH",
    targeting_spec: targetingSpec,
  });

  // Log de diagnostic : la forme exacte de la réponse Meta varie selon les
  // comptes / versions d'API. Ce log apparaît dans Vercel > Logs et permet
  // d'ajuster précisément les noms de champs si besoin.
  console.log("estimation-prospects-meta raw response:", JSON.stringify(data));

  const estimate = data.data && data.data[0];
  return estimate || null;
}

// Cherche une valeur numérique parmi plusieurs noms de champs possibles,
// car l'API Meta a renommé/varie ces champs selon les versions et comptes.
function firstDefined(obj, keys) {
  for (const key of keys) {
    const value = key.split(".").reduce((o, k) => (o && o[k] !== undefined ? o[k] : undefined), obj);
    if (value !== undefined && value !== null) return value;
  }
  return null;
}

function extractAudience(estimate) {
  const lower = firstDefined(estimate, ["estimate_mau_lower_bound", "estimate_dau_lower_bound"]);
  const upper = firstDefined(estimate, ["estimate_mau_upper_bound", "estimate_dau_upper_bound"]);
  if (lower !== null && upper !== null) {
    return Math.round((Number(lower) + Number(upper)) / 2);
  }
  const direct = firstDefined(estimate, ["estimate_mau", "estimate_dau", "users"]);
  return direct !== null ? Number(direct) : null;
}

function extractCpm(estimate) {
  const low = firstDefined(estimate, [
    "bid_estimate.low_inclusive",
    "bid_estimate.min_bid",
    "bid_estimations.0.min_bid",
    "bid_estimations.0.median_bid",
  ]);
  const high = firstDefined(estimate, [
    "bid_estimate.high_inclusive",
    "bid_estimate.max_bid",
    "bid_estimations.0.max_bid",
  ]);
  return { low: microToEuros(low), high: microToEuros(high) };
}

function microToEuros(value) {
  if (value === undefined || value === null) return null;
  return Math.round((Number(value) / 100) * 100) / 100; // Meta renvoie des centimes
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST" && req.method !== "GET") {
    return res.status(405).json({ success: false, error: "Méthode non autorisée" });
  }

  if (process.env.META_ADS_ENABLED !== "true") {
    return res.status(503).json({
      success: false,
      disabled: true,
      error: "La source Meta Ads n'est pas activée.",
    });
  }

  const source = req.method === "GET" ? req.query : req.body || {};
  const activite = (source.activite || "").toString().trim();
  const zone = (source.zone || "").toString().trim();

  if (!activite || !zone) {
    return res.status(400).json({ success: false, error: "Activité et zone requises." });
  }

  const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
  if (missing.length) {
    return res.status(503).json({
      success: false,
      error: "Le calculateur Meta n'est pas encore configuré.",
      missingEnv: missing,
    });
  }

  try {
    const [interest, geo] = await Promise.all([resolveInterest(activite), resolveGeo(zone)]);
    const estimate = await fetchDeliveryEstimate(interest, geo);

    if (!estimate) {
      return res.status(200).json({
        success: true,
        found: false,
        message: "Pas assez de données Meta pour cette combinaison activité / zone.",
      });
    }

    const audience = extractAudience(estimate);
    const { low: cpmLow, high: cpmHigh } = extractCpm(estimate);

    const ctr = Number(process.env.META_CTR_DEFAULT || 0.01);
    const conversionRate = Number(process.env.CONVERSION_RATE_DEFAULT || 0.03);
    const estimatedClicks = audience ? Math.round(audience * ctr) : null;
    const estimatedClients = estimatedClicks ? Math.round(estimatedClicks * conversionRate) : null;

    return res.status(200).json({
      success: true,
      found: true,
      activite,
      zone,
      audiencePotentielle: audience,
      cpmMin: cpmLow,
      cpmMax: cpmHigh,
      tauxClic: ctr,
      tauxConversion: conversionRate,
      clientsEstimesParMois: estimatedClients,
    });
  } catch (err) {
    console.error("estimation-prospects-meta error:", err.message);
    return res.status(500).json({
      success: false,
      error: "Erreur lors du calcul de l'estimation Meta, merci de réessayer.",
    });
  }
}
