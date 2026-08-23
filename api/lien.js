// api/lien.js
// Lien de tracking inséré dans le SMS envoyé aux prospects. Quand le
// prospect clique, cette route enregistre le clic dans Supabase puis
// redirige immédiatement vers la page des tarifs — le prospect ne voit
// aucune différence, tout se passe en une fraction de seconde.
//
// URL envoyée dans le SMS : https://skyeco-pro.vercel.app/api/lien?p=<id>
//
// Variables d'environnement requises :
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
// Prérequis SQL (à exécuter une fois dans Supabase, SQL editor) :
//   alter table prospects_sms add column if not exists lien_clique boolean default false;
//   alter table prospects_sms add column if not exists clic_date timestamptz;
//   alter table prospects_sms add column if not exists nb_clics integer default 0;

const DESTINATION = "https://skyeco-pro.vercel.app/tarifs.html";

export default async function handler(req, res) {
  const { p } = req.query || {};

  // Si l'id est absent ou invalide, on redirige quand même vers les tarifs
  // pour ne jamais laisser un visiteur sur une page cassée.
  if (!p) {
    res.writeHead(302, { Location: DESTINATION });
    return res.end();
  }

  try {
    // Lit le compteur actuel pour l'incrémenter (premier clic vs clics suivants).
    const lecture = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/prospects_sms?id=eq.${encodeURIComponent(p)}&select=nb_clics`,
      {
        headers: {
          apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        },
      }
    );
    const rows = lecture.ok ? await lecture.json() : [];
    const nbActuel = rows && rows[0] ? rows[0].nb_clics || 0 : 0;

    await fetch(`${process.env.SUPABASE_URL}/rest/v1/prospects_sms?id=eq.${encodeURIComponent(p)}`, {
      method: "PATCH",
      headers: {
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        lien_clique: true,
        clic_date: new Date().toISOString(),
        nb_clics: nbActuel + 1,
      }),
    });
  } catch (err) {
    // On ne bloque jamais la redirection même si le tracking échoue.
    console.error("lien tracking error:", err);
  }

  res.writeHead(302, { Location: DESTINATION });
  return res.end();
}
