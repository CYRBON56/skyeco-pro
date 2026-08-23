// api/prospects-delete.js
// Supprime un ou plusieurs prospects de Supabase.
//
// Mêmes variables d'environnement que prospects-import.js.
//
// Requête attendue : POST
//   Headers: Authorization: Bearer <ADMIN_TOKEN>
//   Body: { ids: ["uuid1", "uuid2", ...] }

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Méthode non autorisée." });
  }

  const auth = req.headers.authorization || "";
  if (auth !== `Bearer ${process.env.ADMIN_TOKEN}`) {
    return res.status(401).json({ success: false, error: "Non autorisé." });
  }

  const { ids } = req.body || {};
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ success: false, error: "Aucun prospect à supprimer." });
  }

  try {
    const idsFilter = ids.map((id) => `"${id}"`).join(",");
    const resp = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/prospects_sms?id=in.(${idsFilter})`,
      {
        method: "DELETE",
        headers: {
          apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        },
      }
    );

    if (!resp.ok) {
      const detail = await resp.text();
      console.error("prospects-delete supabase error:", detail);
      return res.status(500).json({ success: false, error: "Suppression impossible (Supabase)." });
    }

    return res.status(200).json({ success: true, deleted: ids.length });
  } catch (err) {
    console.error("prospects-delete error:", err);
    return res.status(500).json({ success: false, error: "Suppression impossible pour le moment." });
  }
}
