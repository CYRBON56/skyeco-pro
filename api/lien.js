// api/lien.js
// Lien de tracking court inséré dans le SMS envoyé aux prospects (accessible
// via l'alias court /l grâce à vercel.json). Quand le prospect clique, cette
// route enregistre le clic dans Supabase puis redirige immédiatement vers la
// page des tarifs — le prospect ne voit aucune différence.
//
// URL envoyée dans le SMS : https://skyeco-pro.vercel.app/l?p=<token 8 car.>
//
// Variables d'environnement requises :
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
// Prérequis SQL (à exécuter une fois dans Supabase, SQL editor) :
//   alter table prospects_sms add column if not exists lien_clique boolean default false;
//   alter table prospects_sms add column if not exists clic_date timestamptz;
//   alter table prospects_sms add column if not exists nb_clics integer default 0;
//   alter table prospects_sms add column if not exists clic_token text;
//   create unique index if not exists prospects_sms_clic_token_idx on prospects_sms(clic_token);

const TARIFS_URL = "https://skyeco-pro.vercel.app/tarifs.html";
const EXEMPLE_URL = "https://salesflow-ecosky.vercel.app/estimation.html";

export default async function handler(req, res) {
  const { p, dest } = req.query || {};
  const destination = dest === "exemple" ? EXEMPLE_URL : TARIFS_URL;

  if (!p) {
    res.writeHead(302, { Location: destination });
    return res.end();
  }

  try {
    const lecture = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/prospects_sms?clic_token=eq.${encodeURIComponent(p)}&select=id,nb_clics`,
      {
        headers: {
          apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        },
      }
    );
    const rows = lecture.ok ? await lecture.json() : [];
    const prospect = rows && rows[0];

    if (prospect) {
      await fetch(`${process.env.SUPABASE_URL}/rest/v1/prospects_sms?id=eq.${encodeURIComponent(prospect.id)}`, {
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
          nb_clics: (prospect.nb_clics || 0) + 1,
        }),
      });
    }
  } catch (err) {
    console.error("lien tracking error:", err);
  }

  res.writeHead(302, { Location: destination });
  return res.end();
}
