// api/estimation-prospects.js
// Calcule une estimation du potentiel de prospects (recherches Google, concurrence,
// CPC, clients estimés) pour un couple activité + zone géographique donné.
//
// Données réelles récupérées via l'API Google Ads (Keyword Planner) :
//   - geoTargetConstants:suggest        -> résout le nom de la zone en identifiant Google Ads
//   - customers/{id}:generateKeywordIdeas -> volumes de recherche, concurrence, CPC
//
// Variables d'environnement requises (Vercel > Project Settings > Environment Variables) :
//   GOOGLE_ADS_DEVELOPER_TOKEN    Jeton développeur (ads.google.com/aw/apicenter)
//   GOOGLE_ADS_CLIENT_ID          Client OAuth2 (console.cloud.google.com)
//   GOOGLE_ADS_CLIENT_SECRET      Secret OAuth2
//   GOOGLE_ADS_REFRESH_TOKEN      Refresh token OAuth2 généré une fois pour le compte Google Ads
//   GOOGLE_ADS_LOGIN_CUSTOMER_ID  Identifiant du compte manager (MCC), sans tirets
//   GOOGLE_ADS_CUSTOMER_ID        Identifiant du compte Google Ads interrogé, sans tirets
//   CONVERSION_RATE_DEFAULT       Optionnel, ex. "0.03" pour 3 % (défaut : 0.03)
//
// Tant que ces variables ne sont pas configurées, l'endpoint répond en 503 avec la
// liste des variables manquantes plutôt que de planter — le front-end bascule alors
// sur un message clair et laisse quand même la possibilité de demander un rappel.
//
// Hypothèses documentées (non fournies telles quelles par l'API Google Ads) :
//   - "Concurrents actifs" est une estimation dérivée de l'indice de concurrence
//     Google Ads (competitionIndex, 0-100), convertie en un nombre d'annonceurs
//     plausible. Ce n'est pas un décompte réel d'entreprises concurrentes.
//   - "Taux de conversion moyen" est une hypothèse commerciale fixe (configurable
//     via CONVERSION_RATE_DEFAULT), pas une donnée Google Ads.

const API_VERSION = "v18";
const BASE_URL = `https://googleads.googleapis.com/${API_VERSION}`;
const TOKEN_URL = "https://oauth2.googleapis.com/token";

const REQUIRED_ENV = [
  "GOOGLE_ADS_DEVELOPER_TOKEN",
  "GOOGLE_ADS_CLIENT_ID",
  "GOOGLE_ADS_CLIENT_SECRET",
  "GOOGLE_ADS_REFRESH_TOKEN",
  "GOOGLE_ADS_CUSTOMER_ID",
];

// Le token est mis en cache le temps de l'exécution de la fonction serverless
// (utile si plusieurs appels réutilisent la même instance chaude).
let cachedToken = null; // { accessToken, expiresAt }

async function getAccessToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30000) {
    return cachedToken.accessToken;
  }
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_ADS_CLIENT_ID,
    client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET,
    refresh_token: process.env.GOOGLE_ADS_REFRESH_TOKEN,
    grant_type: "refresh_token",
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Erreur OAuth Google (${res.status}): ${text}`);
  }
  const data = await res.json();
  cachedToken = {
    accessToken: data.access_token,
    expiresAt: Date.now() + (data.expires_in || 3000) * 1000,
  };
  return cachedToken.accessToken;
}

function adsHeaders(accessToken) {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "developer-token": process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
    "Content-Type": "application/json",
  };
  if (process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID) {
    headers["login-customer-id"] = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID;
  }
  return headers;
}

// Résout un nom de zone ("Morbihan", "Vannes"...) en identifiant Google Ads.
async function resolveGeoTarget(accessToken, zone) {
  const res = await fetch(`${BASE_URL}/geoTargetConstants:suggest`, {
    method: "POST",
    headers: adsHeaders(accessToken),
    body: JSON.stringify({
      locale: "fr",
      countryCode: "FR",
      locationNames: { names: [zone] },
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Erreur résolution zone (${res.status}): ${text}`);
  }
  const data = await res.json();
  const suggestion =
    data.geoTargetConstantSuggestions && data.geoTargetConstantSuggestions[0];
  return suggestion ? suggestion.geoTargetConstant.resourceName : null; // ex: "geoTargetConstants/1006585"
}

async function fetchKeywordIdeas(accessToken, activite, zone, geoTargetResourceName) {
  const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID;
  const seedKeywords = [
    activite,
    `${activite} ${zone}`,
    `devis ${activite}`,
    `${activite} urgence`,
    `entreprise ${activite}`,
  ];

  const body = {
    language: "languageConstants/1003", // Français
    keywordSeed: { keywords: seedKeywords },
    keywordPlanNetwork: "GOOGLE_SEARCH",
  };
  if (geoTargetResourceName) {
    body.geoTargetConstants = [geoTargetResourceName];
  }

  const res = await fetch(`${BASE_URL}/customers/${customerId}:generateKeywordIdeas`, {
    method: "POST",
    headers: adsHeaders(accessToken),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Erreur Keyword Planner (${res.status}): ${text}`);
  }
  const data = await res.json();
  return data.results || [];
}

function microsToEuros(micros) {
  if (!micros) return null;
  return Math.round((Number(micros) / 1_000_000) * 100) / 100;
}

// Voir note en tête de fichier : approximation, pas une donnée exacte.
function estimateCompetitorCount(competitionIndex) {
  if (competitionIndex === null || competitionIndex === undefined) return null;
  return Math.max(1, Math.round((competitionIndex / 100) * 25));
}

function aggregateMetrics(results, activite) {
  if (!results.length) return null;

  const exact = results.find(
    (r) => r.text && r.text.toLowerCase() === activite.toLowerCase()
  );
  const pool = exact
    ? [exact]
    : results
        .slice()
        .sort(
          (a, b) =>
            (b.keywordIdeaMetrics?.avgMonthlySearches || 0) -
            (a.keywordIdeaMetrics?.avgMonthlySearches || 0)
        )
        .slice(0, 3);

  const searches = pool.map((r) => Number(r.keywordIdeaMetrics?.avgMonthlySearches || 0));
  const avgSearches = Math.round(searches.reduce((a, b) => a + b, 0) / pool.length);

  const competitionIndexes = pool
    .map((r) => r.keywordIdeaMetrics?.competitionIndex)
    .filter((v) => v !== undefined && v !== null)
    .map(Number);
  const avgCompetitionIndex = competitionIndexes.length
    ? Math.round(competitionIndexes.reduce((a, b) => a + b, 0) / competitionIndexes.length)
    : null;

  const lowBids = pool
    .map((r) => r.keywordIdeaMetrics?.lowTopOfPageBidMicros)
    .filter(Boolean)
    .map(Number);
  const highBids = pool
    .map((r) => r.keywordIdeaMetrics?.highTopOfPageBidMicros)
    .filter(Boolean)
    .map(Number);

  return {
    avgSearches,
    avgCompetitionIndex,
    lowCpc: lowBids.length ? microsToEuros(Math.min(...lowBids)) : null,
    highCpc: highBids.length ? microsToEuros(Math.max(...highBids)) : null,
  };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST" && req.method !== "GET") {
    return res.status(405).json({ success: false, error: "Méthode non autorisée" });
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
      error: "Le calculateur n'est pas encore connecté à Google Ads.",
      missingEnv: missing,
    });
  }

  try {
    const accessToken = await getAccessToken();
    const geoTargetResourceName = await resolveGeoTarget(accessToken, zone);
    const results = await fetchKeywordIdeas(accessToken, activite, zone, geoTargetResourceName);
    const metrics = aggregateMetrics(results, activite);

    if (!metrics) {
      return res.status(200).json({
        success: true,
        found: false,
        message: "Pas assez de données Google Ads pour cette combinaison activité / zone.",
      });
    }

    const conversionRate = Number(process.env.CONVERSION_RATE_DEFAULT || 0.03);
    const estimatedClients = Math.max(0, Math.round(metrics.avgSearches * conversionRate));

    return res.status(200).json({
      success: true,
      found: true,
      activite,
      zone,
      recherchesParMois: metrics.avgSearches,
      concurrentsActifs: estimateCompetitorCount(metrics.avgCompetitionIndex),
      cpcMin: metrics.lowCpc,
      cpcMax: metrics.highCpc,
      tauxConversion: conversionRate,
      clientsEstimesParMois: estimatedClients,
    });
  } catch (err) {
    console.error("estimation-prospects error:", err.message);
    return res.status(500).json({
      success: false,
      error: "Erreur lors du calcul de l'estimation, merci de réessayer.",
    });
  }
}
