// api/prospects-import.js
// Importe (ou met à jour) une liste de prospects dans Supabase, à partir
// du fichier Excel téléchargé sur la page prospects.html.
//
// Variables d'environnement requises :
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY   (clé service_role — jamais la clé publique)
//   ADMIN_TOKEN                 (mot de passe partagé pour protéger la page)
//
// Requête attendue : POST
//   Headers: Authorization: Bearer <ADMIN_TOKEN>
//   Body: { prospects: [{ nom, ville, departement, telephone, telephone_e164, adresse }, ...] }

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Méthode non autorisée." });
  }

  const auth = req.headers.authorization || "";
  if (auth !== `Bearer ${process.env.ADMIN_TOKEN}`) {
    return res.status(401).json({ success: false, error: "Non autorisé." });
  }

  const { prospects } = req.body || {};
  if (!Array.isArray(prospects) || prospects.length === 0) {
    return res.status(400).json({ success: false, error: "Liste de prospects manquante." });
  }

  // On déduplique par numéro (dernière occurrence gagne) : Supabase refuse
  // qu'un même envoi mette à jour deux fois la même ligne (erreur 21000).
  const parPhone = new Map();
  prospects
    .filter((p) => p && p.telephone_e164)
    .forEach((p) => {
      parPhone.set(p.telephone_e164, {
        nom: p.nom || "",
        ville: p.ville || "",
        departement: p.departement || "",
        telephone: p.telephone || "",
        telephone_e164: p.telephone_e164,
        adresse: p.adresse || "",
      });
    });
  const rows = Array.from(parPhone.values());

  if (rows.length === 0) {
    return res.status(400).json({ success: false, error: "Aucun numéro valide dans le fichier." });
  }

  try {
    const resp = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/prospects_sms?on_conflict=telephone_e164`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
          Prefer: "resolution=merge-duplicates,return=minimal",
        },
        body: JSON.stringify(rows),
      }
    );

    if (!resp.ok) {
      const detail = await resp.text();
      console.error("prospects-import supabase error:", detail);
      return res.status(500).json({ success: false, error: "Import impossible (Supabase)." });
    }

    return res.status(200).json({ success: true, imported: rows.length });
  } catch (err) {
    console.error("prospects-import error:", err);
    return res.status(500).json({ success: false, error: "Import impossible pour le moment." });
  }
}
