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
  clôture: ["garden fence", "home improvement"],
  charpentier: ["carpentry", "home improvement"],
  maçon: ["masonry", "construction"],
  électricien: ["electrician", "home improvement"],
  plombier: ["plumbing", "home improvement"],
};

// Résout l'activité ("Couvreur"...) en centres d'intérêt Meta les plus
// pertinents. On combine plusieurs intérêts liés (jusqu'à 3) plutôt qu'un
// seul : Meta traite les entrées du tableau "interests" comme une union
// ("OU"), ce qui donne une audience plus réaliste qu'un intérêt unique et
// souvent trop niche (l'audience se limitait à ~1000, plancher de
// confidentialité de Meta pour un ciblage trop étroit).
async function resolveInterests(activite) {
  const key = activite.toLowerCase();
  const mapped = INTEREST_QUERY_MAP[key] || ["home improvement"];
  const queries = [...mapped, activite];

  const found = [];
  const seenIds = new Set();
  for (const q of queries) {
    const data = await metaGet("/search", { type: "adinterest", q, limit: "5" });
    const results = data.data || [];
    for (const r of results) {
      if (!seenIds.has(r.id)) {
        seenIds.add(r.id);
        found.push(r);
      }
      if (found.length >= 3) break;
    }
    if (found.length >= 3) break;
  }
  return found; // tableau d'intérêts, potentiellement vide
}

// Meta utilise des pluriels irréguliers pour les clés de géo-ciblage : ce
// n'est PAS un simple "+s" (ex. "city" -> "cities", pas "citys"). Une clé
// mal orthographiée est silencieusement ignorée par l'API, ce qui peut
// donner un ciblage vide ou incohérent sans message d'erreur explicite.
const GEO_TYPE_PLURAL = {
  country: "countries",
  region: "regions",
  city: "cities",
  zip: "zips",
};

// Résout la zone ("Morbihan", "Vannes"...) en cible géographique Meta.
// country_code="FR" est indispensable : sans lui, la recherche peut renvoyer
// un lieu du même nom dans n'importe quel pays. On priorise le type "region"
// (département) sur "city" : cibler une seule petite ville donne une
// audience quasi nulle une fois croisée avec un centre d'intérêt, alors
// qu'un département a une population large et pertinente pour ce cas d'usage.
async function resolveGeo(zone) {
  const data = await metaGet("/search", {
    type: "adgeolocation",
    q: zone,
    location_types: ["region", "city"],
    country_code: "FR",
    limit: "10",
  });
  const results = data.data || [];
  if (!results.length) return null;
  const region = results.find((r) => r.type === "region");
  return region || results[0]; // { key, name, type, ... }
}

function buildTargetingSpec(interests, geo) {
  return {
    geo_locations: geo
      ? { [GEO_TYPE_PLURAL[geo.type] || `${geo.type}s`]: [{ key: geo.key }] }
      : { countries: ["FR"] },
    interests:
      interests && interests.length
        ? interests.map((i) => ({ id: i.id, name: i.name }))
        : undefined,
    publisher_platforms: ["facebook", "instagram"],
  };
}

// Certains centres d'intérêt renvoyés par la recherche Meta sont dépréciés :
// Meta refuse alors la requête (code 100, error_subcode 1870247) et indique
// dans le message d'erreur l'identifiant à retirer. On extrait ces IDs et on
// relance la requête sans eux, une seule fois, plutôt que d'échouer.
function extractDeprecatedInterestIds(errorMessage) {
  const matches = errorMessage.matchAll(/"deprecated_interest_id":"(\d+)"/g);
  return [...matches].map((m) => m[1]);
}

async function deliveryEstimateWithRetry(path, params, interests, geo) {
  try {
    return await metaGet(path, params);
  } catch (err) {
    const deprecatedIds = extractDeprecatedInterestIds(err.message);
    if (deprecatedIds.length && interests && interests.length) {
      const filtered = interests.filter((i) => !deprecatedIds.includes(i.id));
      if (filtered.length !== interests.length) {
        console.log(
          "estimation-prospects-meta retry without deprecated interests:",
          JSON.stringify({ deprecatedIds, remaining: filtered.map((i) => i.id) })
        );
        const retryParams = { ...params, targeting_spec: buildTargetingSpec(filtered, geo) };
        return await metaGet(path, retryParams);
      }
    }
    throw err;
  }
}

// Deux appels séparés sont nécessaires : l'objectif REACH donne l'audience
// atteignable (estimate_mau) mais jamais de coût ; un objectif comme
// LINK_CLICKS donne l'estimation de coût (bid_estimate / CPM) mais une
// audience moins fiable. On combine les deux résultats.
async function fetchDeliveryEstimates(interests, geo) {
  const accountId = process.env.META_AD_ACCOUNT_ID;
  const targetingSpec = buildTargetingSpec(interests, geo);

  console.log(
    "estimation-prospects-meta resolved targeting:",
    JSON.stringify({ interests, geo, targetingSpec })
  );

  const [reachData, clicksData] = await Promise.all([
    deliveryEstimateWithRetry(
      `/act_${accountId}/delivery_estimate`,
      { optimization_goal: "REACH", targeting_spec: targetingSpec },
      interests,
      geo
    ).catch((err) => {
      console.error("estimation-prospects-meta REACH error:", err.message);
      return null;
    }),
    deliveryEstimateWithRetry(
      `/act_${accountId}/delivery_estimate`,
      { optimization_goal: "LINK_CLICKS", targeting_spec: targetingSpec },
      interests,
      geo
    ).catch((err) => {
      console.error("estimation-prospects-meta LINK_CLICKS error:", err.message);
      return null;
    }),
  ]);

  console.log(
    "estimation-prospects-meta raw response:",
    JSON.stringify({ reachData, clicksData })
  );

  const reachEstimate = reachData?.data?.[0] || null;
  const clicksEstimate = clicksData?.data?.[0] || null;
  return { reachEstimate, clicksEstimate };
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
    const [interests, geo] = await Promise.all([resolveInterests(activite), resolveGeo(zone)]);
    const { reachEstimate, clicksEstimate } = await fetchDeliveryEstimates(interests, geo);

    if (!reachEstimate && !clicksEstimate) {
      return res.status(200).json({
        success: true,
        found: false,
        message: "Pas assez de données Meta pour cette combinaison activité / zone.",
      });
    }

    const audience = extractAudience(reachEstimate) ?? extractAudience(clicksEstimate);
    const { low: cpmLow, high: cpmHigh } = extractCpm(clicksEstimate || reachEstimate);

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
