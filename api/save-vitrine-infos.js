// api/save-vitrine-infos.js
// Enregistre (création ou mise à jour) les informations fournies par une
// entreprise cliente pour la construction de sa vitrine.
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

async function supabaseRequest(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: options.prefer || "return=representation",
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase error ${res.status}: ${text}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

const CHAMPS_AUTORISES = [
  "nom_commercial", "slogan", "description_activite", "zone_intervention",
  "services", "logo_url", "photos", "video_url",
  "telephone_public", "email_public", "adresse_publique",
  "domaine_souhaite", "domaine_deja_possede",
  "reseaux_sociaux", "temoignages", "couleur_principale", "statut",
];

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).send("Method not allowed");

  try {
    const { entreprise_id, ...body } = req.body || {};
    if (!entreprise_id) {
      return res.status(400).json({ success: false, error: "entreprise_id requis" });
    }

    const payload = { entreprise_id, updated_at: new Date().toISOString() };
    for (const champ of CHAMPS_AUTORISES) {
      if (body[champ] !== undefined) payload[champ] = body[champ];
    }

    // Upsert : crée la ligne si elle n'existe pas encore pour cette entreprise
    // (on_conflict cible entreprise_id, qui est la contrainte unique de la table)
    const rows = await supabaseRequest("vitrine_infos?on_conflict=entreprise_id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify(payload),
    });

    return res.status(200).json({ success: true, vitrine: rows ? rows[0] : payload });
  } catch (err) {
    console.error("save-vitrine-infos error:", err.message);
    return res.status(500).json({ success: false, error: "Erreur technique, merci de réessayer." });
  }
}
