// api/estimation-prospects.js
// POST /api/estimation-prospects
// Body attendu : { activite: "paysagiste", zone: "Morbihan" }  (zone = département OU région)
//
// 1) Résout la zone géographique saisie en Geo Target Constant Google (France).
// 2) Interroge le Keyword Plan Idea Service pour obtenir le volume de recherche
//    mensuel et le CPC estimé pour le mot-clé (et quelques idées proches).
// 3) Applique des hypothèses prudentes de taux de clic / taux de conversion
//    pour donner une estimation de clients potentiels par mois.
//
// Réponse renvoyée (format attendu par la page d'accueil skyeco-pro) :
// {
//   success: true,
//   found: true,
//   zoneResolue: "Morbihan",
//   keywords: [{ motCle, recherchesParMois, cpcMin, cpcMax, concurrence }, ...],
//   tauxClic: 0.05,
//   clicsEstimesParMois: 12,
//   tauxConversion: 0.15,
//   clientsEstimesParMois: 2
// }
//
// Nécessite le package "google-ads-api" (npm i google-ads-api).
// Variables d'environnement requises (Vercel, projet skyeco-pro) :
//   GOOGLE_ADS_DEVELOPER_TOKEN
//   GOOGLE_ADS_CLIENT_ID
//   GOOGLE_ADS_CLIENT_SECRET
//   GOOGLE_ADS_REFRESH_TOKEN
//   GOOGLE_ADS_CUSTOMER_ID        (compte client, ex: 5452754443)
//   GOOGLE_ADS_LOGIN_CUSTOMER_ID  (MCC, ex: 7353350497)

import { GoogleAdsApi } from 'google-ads-api';

const LANGUAGE_FRENCH = 'languageConstants/1002';

// Hypothèses prudentes, affichées comme telles côté front (pas des données Google Ads).
const TAUX_CLIC = 0.05; // 5% des recherches mènent à un clic sur l'annonce
const TAUX_CONVERSION = 0.15; // 15% des clics se transforment en client

const COMPETITION_LABELS = {
  0: 'Inconnue',
  1: 'Inconnue',
  2: 'Faible',
  3: 'Moyenne',
  4: 'Élevée',
  UNSPECIFIED: 'Inconnue',
  UNKNOWN: 'Inconnue',
  LOW: 'Faible',
  MEDIUM: 'Moyenne',
  HIGH: 'Élevée',
};

const client = new GoogleAdsApi({
  client_id: process.env.GOOGLE_ADS_CLIENT_ID,
  client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET,
  developer_token: process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
});

function microsToEuros(micros) {
  if (micros == null) return null;
  return Math.round((micros / 1_000_000) * 100) / 100;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Méthode non autorisée' });
  }

  try {
    const { activite, zone } = req.body || {};

    if (!activite || !activite.trim()) {
      return res.status(400).json({ success: false, error: "Le champ 'activite' est requis" });
    }
    if (!zone || !zone.trim()) {
      return res.status(400).json({ success: false, error: "Le champ 'zone' est requis" });
    }

    const customer = client.Customer({
      customer_id: process.env.GOOGLE_ADS_CUSTOMER_ID,
      login_customer_id: process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID,
      refresh_token: process.env.GOOGLE_ADS_REFRESH_TOKEN,
    });

    // 1) Résolution géographique
    const geoSuggestions = await customer.geoTargetConstants.suggestGeoTargetConstants({
      locale: 'fr',
      country_code: 'FR',
      location_names: { names: [zone.trim()] },
    });

    const suggestions = geoSuggestions?.geo_target_constant_suggestions || [];
    if (suggestions.length === 0) {
      return res.status(200).json({
        success: true,
        found: false,
        error: `Zone géographique "${zone}" non reconnue par Google.`,
      });
    }

    const geo = suggestions[0].geo_target_constant;
    const geoResourceName = geo.resource_name;
    const zoneResolue = geo.name;

    // 2) Idées de mots-clés + volumes de recherche
    const ideas = await customer.keywordPlanIdeas.generateKeywordIdeas({
      customer_id: process.env.GOOGLE_ADS_CUSTOMER_ID,
      keyword_seed: { keywords: [activite.trim()] },
      geo_target_constants: [geoResourceName],
      language: LANGUAGE_FRENCH,
      keyword_plan_network: 'GOOGLE_SEARCH',
    });

    const results = ideas?.results || ideas || [];
    if (!results.length) {
      return res.status(200).json({
        success: true,
        found: false,
        error: `Aucune donnée de recherche pour "${activite}" dans cette zone.`,
      });
    }

    // On garde les 5 idées avec le plus de volume (l'idée correspondant
    // exactement au mot-clé saisi, si présente, passe en premier).
    const sorted = [...results].sort(
      (a, b) => (b.keyword_idea_metrics?.avg_monthly_searches || 0) - (a.keyword_idea_metrics?.avg_monthly_searches || 0)
    );
    const exactIndex = sorted.findIndex(
      (r) => (r.text || '').toLowerCase() === activite.trim().toLowerCase()
    );
    if (exactIndex > 0) {
      const [exact] = sorted.splice(exactIndex, 1);
      sorted.unshift(exact);
    }
    const top = sorted.slice(0, 5);

    const keywords = top.map((r) => {
      const m = r.keyword_idea_metrics || {};
      return {
        motCle: r.text,
        recherchesParMois: m.avg_monthly_searches ?? 0,
        cpcMin: microsToEuros(m.low_top_of_page_bid_micros),
        cpcMax: microsToEuros(m.high_top_of_page_bid_micros),
        concurrence: COMPETITION_LABELS[m.competition] || 'Inconnue',
      };
    });

    const totalSearches = keywords.reduce((sum, k) => sum + (k.recherchesParMois || 0), 0);
    const clicsEstimesParMois = Math.round(totalSearches * TAUX_CLIC);
    const clientsEstimesParMois = Math.round(clicsEstimesParMois * TAUX_CONVERSION);

    return res.status(200).json({
      success: true,
      found: true,
      zoneResolue,
      keywords,
      tauxClic: TAUX_CLIC,
      clicsEstimesParMois,
      tauxConversion: TAUX_CONVERSION,
      clientsEstimesParMois,
    });
  } catch (error) {
    console.error('Erreur estimation-prospects:', error);
    return res.status(500).json({
      success: false,
      error: "Estimation momentanément indisponible.",
      detail: error.message,
    });
  }
}
