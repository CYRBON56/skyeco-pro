// api/creer-entreprise.js
// Crée la fiche "entreprise" liée à un compte Supabase Auth fraîchement
// inscrit (voir public/inscription.html). Utilise la clé secrète
// (service_role) côté serveur, jamais exposée au navigateur — c'est ce qui
// permet de poser un slug unique proprement sans dépendre du RLS.

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
    const { owner_user_id, nom, slug, email_contact } = req.body || {};
    if (!owner_user_id || !nom || !slug) {
      return res.status(400).json({ success: false, error: "owner_user_id, nom et slug requis" });
    }

    // Garantit l'unicité du slug (suffixe -2, -3... si déjà pris)
    let finalSlug = slug;
    let attempt = 1;
    while (true) {
      const existing = await supabaseRequest(`entreprises?slug=eq.${encodeURIComponent(finalSlug)}&select=id`);
      if (!existing || existing.length === 0) break;
      attempt += 1;
      finalSlug = `${slug}-${attempt}`;
    }

    const rows = await supabaseRequest("entreprises", {
      method: "POST",
      body: JSON.stringify({
        owner_user_id,
        nom,
        slug: finalSlug,
        email_contact: email_contact || null,
      }),
    });

    return res.status(200).json({ success: true, entreprise: rows[0] });
  } catch (err) {
    console.error("creer-entreprise error:", err.message);
    return res.status(500).json({ success: false, error: "Erreur technique, merci de réessayer." });
  }
}
