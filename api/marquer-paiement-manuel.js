// api/marquer-paiement-manuel.js
// Enregistre que le client a choisi de payer par virement/chèque. Le statut
// reste "en_attente" tant que Cyrille n'a pas validé manuellement la
// réception du paiement (via le Table Editor Supabase : passer
// paiement_statut à "valide" sur la ligne de l'entreprise concernée).
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

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).send("Method not allowed");

  try {
    const { entreprise_id, mode } = req.body || {};
    if (!entreprise_id || !mode) {
      return res.status(400).json({ success: false, error: "entreprise_id et mode requis" });
    }

    await supabaseRequest(`entreprises?id=eq.${entreprise_id}`, {
      method: "PATCH",
      body: JSON.stringify({ paiement_mode: mode }),
    });

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("marquer-paiement-manuel error:", err.message);
    return res.status(500).json({ success: false, error: "Erreur technique, merci de réessayer." });
  }
}
