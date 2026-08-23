// api/prospects-update.js
// Met à jour les champs d'un prospect existant dans Supabase.
//
// Mêmes variables d'environnement que prospects-import.js.
//
// Requête attendue : POST
//   Headers: Authorization: Bearer <ADMIN_TOKEN>
//   Body: { id, nom, ville, departement, telephone, adresse }

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Méthode non autorisée." });
  }

  const auth = req.headers.authorization || "";
  if (auth !== `Bearer ${process.env.ADMIN_TOKEN}`) {
    return res.status(401).json({ success: false, error: "Non autorisé." });
  }

  const { id, nom, ville, departement, telephone, adresse } = req.body || {};
  if (!id) {
    return res.status(400).json({ success: false, error: "Identifiant manquant." });
  }

  const digits = String(telephone || "").replace(/[\s.-]/g, "");
  let telephone_e164 = null;
  if (/^0[1-9]\d{8}$/.test(digits)) telephone_e164 = "+33" + digits.slice(1);
  else if (/^\+33[1-9]\d{8}$/.test(digits)) telephone_e164 = digits;

  if (telephone && !telephone_e164) {
    return res.status(400).json({ success: false, error: "Format de numéro invalide." });
  }

  const patch = {
    nom: nom || "",
    ville: ville || "",
    departement: departement || "",
    adresse: adresse || "",
  };
  if (telephone) {
    patch.telephone = telephone;
    patch.telephone_e164 = telephone_e164;
  }

  try {
    const resp = await fetch(`${process.env.SUPABASE_URL}/rest/v1/prospects_sms?id=eq.${id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        Prefer: "return=minimal",
      },
      body: JSON.stringify(patch),
    });

    if (!resp.ok) {
      const detail = await resp.text();
      console.error("prospects-update supabase error:", detail);
      return res.status(500).json({ success: false, error: "Mise à jour impossible (Supabase)." });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("prospects-update error:", err);
    return res.status(500).json({ success: false, error: "Mise à jour impossible pour le moment." });
  }
}
