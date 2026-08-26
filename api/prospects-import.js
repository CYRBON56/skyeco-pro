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
//   Body: { prospects: [{ nom, ville, departement, telephone, telephone_e164, adresse, email }, ...] }
//
// Un prospect est accepté s'il a AU MOINS un mobile (telephone_e164) OU un
// email — les deux ne sont plus obligatoires en même temps. La déduplication
// se fait par mobile quand il existe, sinon par email.
//
// Prérequis SQL (à exécuter une fois dans Supabase, SQL editor) :
//   create unique index if not exists prospects_sms_email_idx
//     on prospects_sms(email) where email is not null;

async function upsert(rows, conflictColumn) {
  if (rows.length === 0) return 0;
  const resp = await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/prospects_sms?on_conflict=${conflictColumn}`,
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
    throw new Error(`Supabase (${conflictColumn}): ${detail}`);
  }
  return rows.length;
}

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

  const normalise = (p) => ({
    nom: p.nom || "",
    ville: p.ville || "",
    departement: p.departement || "",
    telephone: p.telephone || "",
    telephone_e164: p.telephone_e164 || null,
    adresse: p.adresse || "",
    email: p.email || null,
  });

  // Deux groupes : ceux qu'on peut dédupliquer par mobile, et ceux (sans
  // mobile) qu'on déduplique par email. Un prospect sans mobile NI email est
  // ignoré (rien à faire avec lui).
  const parPhone = new Map();
  const parEmail = new Map();
  let ignores = 0;

  prospects.filter(Boolean).forEach((p) => {
    const row = normalise(p);
    if (row.telephone_e164) {
      parPhone.set(row.telephone_e164, row);
    } else if (row.email) {
      parEmail.set(row.email, row);
    } else {
      ignores++;
    }
  });

  const lignesAvecMobile = Array.from(parPhone.values());
  const lignesSansMobile = Array.from(parEmail.values());

  if (lignesAvecMobile.length === 0 && lignesSansMobile.length === 0) {
    return res.status(400).json({ success: false, error: "Aucun mobile ni email valide dans le fichier." });
  }

  try {
    const nbAvecMobile = await upsert(lignesAvecMobile, "telephone_e164");
    const nbSansMobile = await upsert(lignesSansMobile, "email");

    return res.status(200).json({
      success: true,
      imported: nbAvecMobile + nbSansMobile,
      avecMobile: nbAvecMobile,
      emailSeul: nbSansMobile,
      ignores,
    });
  } catch (err) {
    console.error("prospects-import error:", err);
    return res.status(500).json({ success: false, error: "Import impossible : " + err.message });
  }
}
