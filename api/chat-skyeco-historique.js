// api/chat-skyeco-historique.js
// Retourne l'historique des messages du chat pour une entreprise donnée.
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

    const messages = await supabaseRequest(
      `chat_messages?entreprise_id=eq.${entreprise_id}&order=created_at.asc&select=auteur,contenu,created_at`
    );

    return res.status(200).json({ success: true, messages: messages || [] });
  } catch (err) {
    console.error("chat-skyeco-historique error:", err.message);
    return res.status(500).json({ success: false, error: "Erreur technique, merci de réessayer." });
  }
}
