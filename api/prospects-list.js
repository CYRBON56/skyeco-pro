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
    // Supabase/PostgREST plafonne par défaut à 1000 lignes par requête.
    // On récupère donc par lots de 1000 (via l'en-tête Range) jusqu'à avoir
    // tout le monde, quel que soit le nombre total de prospects.
    const PAGE_SIZE = 1000;
    let offset = 0;
    let toutesLesLignes = [];
    let total = null;

    while (true) {
      const resp = await fetch(
        `${process.env.SUPABASE_URL}/rest/v1/prospects_sms?select=*&order=created_at.desc`,
        {
          headers: {
            apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
            Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
            Prefer: "count=exact",
            Range: `${offset}-${offset + PAGE_SIZE - 1}`,
          },
        }
      );

      if (!resp.ok) {
        const detail = await resp.text();
        console.error("prospects-list supabase error:", detail);
        return res.status(500).json({ success: false, error: "Chargement impossible (Supabase)." });
      }

      const page = await resp.json();
      toutesLesLignes = toutesLesLignes.concat(page);

      if (total === null) {
        const contentRange = resp.headers.get("content-range") || "";
        const match = contentRange.match(/\/(\d+)$/);
        total = match ? parseInt(match[1], 10) : toutesLesLignes.length;
      }

      offset += PAGE_SIZE;
      if (toutesLesLignes.length >= total || page.length === 0) break;
    }

    return res.status(200).json({ success: true, prospects: toutesLesLignes });
  } catch (err) {
    console.error("prospects-list error:", err);
    return res.status(500).json({ success: false, error: "Chargement impossible pour le moment." });
  }
}
