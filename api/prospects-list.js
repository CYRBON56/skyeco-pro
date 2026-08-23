// api/prospects-list.js
// Retourne la liste complète des prospects SMS enregistrés dans Supabase.
//
// Mêmes variables d'environnement que prospects-import.js.
//
// Requête attendue : GET, Headers: Authorization: Bearer <ADMIN_TOKEN>

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ success: false, error: "Méthode non autorisée." });
  }

  const auth = req.headers.authorization || "";
  if (auth !== `Bearer ${process.env.ADMIN_TOKEN}`) {
    return res.status(401).json({ success: false, error: "Non autorisé." });
  }

  try {
    const resp = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/prospects_sms?select=*&order=created_at.desc`,
      {
        headers: {
          apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        },
      }
    );

    if (!resp.ok) {
      const detail = await resp.text();
      console.error("prospects-list supabase error:", detail);
      return res.status(500).json({ success: false, error: "Chargement impossible (Supabase)." });
    }

    const data = await resp.json();
    return res.status(200).json({ success: true, prospects: data });
  } catch (err) {
    console.error("prospects-list error:", err);
    return res.status(500).json({ success: false, error: "Chargement impossible pour le moment." });
  }
}
