// api/accepter-contrat.js
// Enregistre l'acceptation du contrat par le client, avec les éléments de
// preuve d'une signature électronique simple (nom, horodatage, IP, user-agent).
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
    const { entreprise_id, signature_nom } = req.body || {};
    if (!entreprise_id || !signature_nom) {
      return res.status(400).json({ success: false, error: "entreprise_id et signature_nom requis" });
    }

    const ip =
      (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
      req.socket?.remoteAddress ||
      "inconnue";
    const userAgent = req.headers["user-agent"] || "inconnu";

    await supabaseRequest(`entreprises?id=eq.${entreprise_id}`, {
      method: "PATCH",
      body: JSON.stringify({
        contrat_accepte: true,
        contrat_accepte_le: new Date().toISOString(),
        contrat_signature_nom: signature_nom,
        contrat_signature_ip: ip,
        contrat_signature_user_agent: userAgent,
      }),
    });

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("accepter-contrat error:", err.message);
    return res.status(500).json({ success: false, error: "Erreur technique, merci de réessayer." });
  }
}
