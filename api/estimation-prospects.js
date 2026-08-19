// api/estimation-prospects.js
// Calcule une estimation du potentiel de prospects (recherches Google, concurrence,
// CPC) pour un couple activité + zone géographique donné, détaillé mot-clé par
// mot-clé (pas de moyenne agrégée — chaque ligne du seed est renvoyée telle quelle
// pour affichage en tableau côté front).
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
//
// Tant que ces variables ne sont pas configurées, l'endpoint répond en 503 avec la
// liste des variables manquantes plutôt que de planter — le front-end bascule alors
// sur un message clair et laisse quand même la possibilité de demander un rappel.
//
// Note documentée (non fournie telle quelle par l'API Google Ads) :
//   - "Concurrence" est directement l'indice competitionIndex (0-100) de Google Ads,
//     converti en libellé faible/moyenne/élevée pour l'affichage.
//   - "Taux de clic" et "Taux de conversion" sont deux hypothèses commerciales
//     fixes et volontairement prudentes, appliquées en cascade :
//       recherches -> (taux de clic, CLICK_RATE_DEFAULT, 2% par défaut) -> clics
//       clics -> (taux de conversion, CONVERSION_RATE_DEFAULT, 3% par défaut) -> clients
//     Ni l'une ni l'autre n'est une donnée Google Ads réelle.

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

// Résout un nom de zone ("Morbihan", "Bretagne", "Vannes"...) en identifiant
// Google Ads. Renvoie aussi le nom canonique retourné par Google, utile pour
// confirmer côté front que la bonne zone a été comprise (ex: distinguer un
// département d'une ville homonyme).
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
  if (!suggestion) return { resourceName: null, canonicalName: null };
  return {
    resourceName: suggestion.geoTargetConstant.resourceName, // ex: "geoTargetConstants/1006585"
    canonicalName: suggestion.geoTargetConstant.name || null,
  };
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

function competitionLabel(index) {
  if (index === null || index === undefined) return "Inconnue";
  if (index < 33) return "Faible";
  if (index < 66) return "Moyenne";
  return "Élevée";
}

// Transforme chaque résultat brut de l'API en une ligne prête à afficher,
// triée par volume de recherche décroissant. Ne garde que les mots-clés qui
// ont au moins une métrique exploitable (évite les lignes 100% vides).
function buildKeywordRows(results) {
  return results
    .map((r) => {
      const m = r.keywordIdeaMetrics || {};
      const searches = m.avgMonthlySearches !== undefined ? Number(m.avgMonthlySearches) : null;
      const competitionIndex = m.competitionIndex !== undefined ? Number(m.competitionIndex) : null;
      const lowCpc = microsToEuros(m.lowTopOfPageBidMicros);
      const highCpc = microsToEuros(m.highTopOfPageBidMicros);
      return {
        motCle: r.text,
        recherchesParMois: searches,
        concurrence: competitionLabel(competitionIndex),
        cpcMin: lowCpc,
        cpcMax: highCpc,
      };
    })
    .filter((row) => row.recherchesParMois !== null)
    .sort((a, b) => (b.recherchesParMois || 0) - (a.recherchesParMois || 0));
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
    const { resourceName: geoTargetResourceName, canonicalName: zoneResolue } = await resolveGeoTarget(
      accessToken,
      zone
    );
    const results = await fetchKeywordIdeas(accessToken, activite, zone, geoTargetResourceName);
    const keywords = buildKeywordRows(results);

    if (!keywords.length) {
      return res.status(200).json({
        success: true,
        found: false,
        activite,
        zone,
        zoneResolue,
        message: "Pas assez de données Google Ads pour cette combinaison activité / zone.",
      });
    }

    const totalSearches = keywords.reduce((sum, k) => sum + (k.recherchesParMois || 0), 0);
    const clickRate = Number(process.env.CLICK_RATE_DEFAULT || 0.02);
    const conversionRate = Number(process.env.CONVERSION_RATE_DEFAULT || 0.03);
    const clicsEstimesParMois = Math.max(0, Math.round(totalSearches * clickRate));
    const clientsEstimesParMois = Math.max(0, Math.round(clicsEstimesParMois * conversionRate));

    return res.status(200).json({
      success: true,
      found: true,
      activite,
      zone,
      zoneResolue, // nom canonique renvoyé par Google, pour vérifier que la bonne zone a été comprise
      keywords, // tableau détaillé, un objet par mot-clé
      totalRecherchesParMois: totalSearches,
      tauxClic: clickRate,
      clicsEstimesParMois,
      tauxConversion: conversionRate,
      clientsEstimesParMois,
    });
  } catch (err) {
    console.error("estimation-prospects error:", err.message);
    return res.status(500).json({
      success: false,
      error: "Erreur lors du calcul de l'estimation, merci de réessayer.",
    });
  }
}
