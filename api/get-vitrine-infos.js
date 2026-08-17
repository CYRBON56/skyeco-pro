// api/get-vitrine-infos.js
// Retourne les informations de vitrine déjà enregistrées pour une entreprise
// (utilisé pour pré-remplir le formulaire quand le client le rouvre).
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

async function supabaseRequest(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
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

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method !== "GET") return res.status(405).send("Method not allowed");

  try {
    const { entreprise_id } = req.query || {};
    if (!entreprise_id) {
      return res.status(400).json({ success: false, error: "entreprise_id requis" });
    }

    const rows = await supabaseRequest(`vitrine_infos?entreprise_id=eq.${entreprise_id}&select=*`);
    return res.status(200).json({ success: true, vitrine: rows && rows[0] ? rows[0] : null });
  } catch (err) {
    console.error("get-vitrine-infos error:", err.message);
    return res.status(500).json({ success: false, error: "Erreur technique, merci de réessayer." });
  }
}
