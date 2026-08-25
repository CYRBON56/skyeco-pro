// api/ouverture.js
// Pixel de suivi d'ouverture d'email (image invisible 1x1). Intégré dans le
// HTML de l'email de prospection, il se déclenche automatiquement quand le
// client mail du prospect charge les images de l'email (donc quand il
// l'ouvre). Renvoie toujours une image transparente valide, jamais d'erreur
// visible.
//
// URL appelée depuis l'email : https://skyeco-pro.vercel.app/o?p=<token>
//
// Variables d'environnement requises :
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
// Prérequis SQL (à exécuter une fois dans Supabase, SQL editor) :
//   alter table prospects_sms add column if not exists email_ouvert boolean default false;
//   alter table prospects_sms add column if not exists date_ouverture timestamptz;
//   alter table prospects_sms add column if not exists nb_ouvertures integer default 0;

// GIF transparent 1x1, le format le plus universellement accepté par les
// clients mail (Gmail, Outlook, Apple Mail...).
const PIXEL_GIF = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBTAA7",
  "base64"
);

export default async function handler(req, res) {
  const { p } = req.query || {};

  function repondrePixel() {
    res.setHeader("Content-Type", "image/gif");
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
    res.status(200).send(PIXEL_GIF);
  }

  if (!p) {
    return repondrePixel();
  }

  try {
    const lecture = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/prospects_sms?clic_token=eq.${encodeURIComponent(p)}&select=id,nb_ouvertures`,
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
          email_ouvert: true,
          date_ouverture: new Date().toISOString(),
          nb_ouvertures: (prospect.nb_ouvertures || 0) + 1,
        }),
      });
    }
  } catch (err) {
    console.error("ouverture tracking error:", err);
  }

  return repondrePixel();
}
