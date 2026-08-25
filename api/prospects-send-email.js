// api/prospects-send-email.js
// Envoie un email de prospection (via Resend) aux prospects sélectionnés qui
// ont une adresse email renseignée. Miroir de prospects-send-sms.js.
//
// Variables d'environnement requises :
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ADMIN_TOKEN
//   RESEND_API_KEY
//
// Requête attendue : POST
//   Headers: Authorization: Bearer <ADMIN_TOKEN>
//   Body: { ids: ["uuid1", "uuid2", ...] }
//
// Prérequis SQL (à exécuter une fois dans Supabase, SQL editor) :
//   alter table prospects_sms add column if not exists email text;
//   alter table prospects_sms add column if not exists email_envoye boolean default false;
//   alter table prospects_sms add column if not exists date_envoi_email timestamptz;

const FROM = "Skyeco Pro <contact@ecoskybyrms.fr>";
const BASE_URL = "https://skyeco-pro.vercel.app";

function emailHtml(nom, token) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background-color:#f5f7f5;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f5f7f5">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="max-width:600px;">
          <tr>
            <td style="padding:32px;font-family:Arial,Helvetica,sans-serif;">
              <p style="font-size:16px;line-height:24px;color:#14312a;margin:0 0 16px 0;">
                Bonjour${nom ? " " + nom : ""},
              </p>
              <p style="font-size:15px;line-height:23px;color:#333333;margin:0 0 16px 0;">
                Skyeco Pro cr&eacute;e des sites vitrines professionnels pour les artisans et entreprises du BTP,
                pr&ecirc;ts &agrave; l'emploi rapidement, &agrave; prix fixe d&egrave;s <strong>590&nbsp;euros</strong> (sans abonnement obligatoire).
              </p>
              <p style="font-size:15px;line-height:23px;color:#333333;margin:0 0 24px 0;">
                Vos clients vous cherchent d&eacute;j&agrave; sur Google &mdash; un site vitrine leur donne une raison de vous trouver.
              </p>
              <table cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td bgcolor="#1e6f4c" style="border-radius:8px;">
                    <a href="${BASE_URL}/l?p=${token}" style="display:block;padding:12px 24px;font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#ffffff;text-decoration:none;font-weight:bold;">
                      Voir les formules
                    </a>
                  </td>
                </tr>
              </table>
              <p style="font-size:12px;line-height:18px;color:#8a8a8a;margin:32px 0 0 0;">
                Vous recevez cet email car votre entreprise a &eacute;t&eacute; identifi&eacute;e via des donn&eacute;es publiques (annuaire professionnel).
                Pour ne plus recevoir nos communications, r&eacute;pondez &agrave; cet email avec le mot STOP.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function emailText(nom, token) {
  return (
    `Bonjour${nom ? " " + nom : ""},\n\n` +
    `Skyeco Pro cree des sites vitrines professionnels pour les artisans et entreprises du BTP, ` +
    `prets a l'emploi rapidement, a prix fixe des 590 euros (sans abonnement obligatoire).\n\n` +
    `Voir les formules : ${BASE_URL}/l?p=${token}\n\n` +
    `Pour ne plus recevoir nos communications, repondez avec le mot STOP.`
  );
}

async function envoyerViaResend(to, nom, token) {
  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: FROM,
      to: [to],
      subject: "Votre entreprise, enfin visible sur Google",
      html: emailHtml(nom, token),
      text: emailText(nom, token),
      headers: {
        "List-Unsubscribe": `<mailto:contact@ecoskybyrms.fr?subject=STOP>`,
      },
    }),
  });
  if (!resp.ok) {
    const detail = await resp.text();
    throw new Error(detail);
  }
  return resp.json();
}

function genererToken() {
  const bytes = Array.from({ length: 6 }, () => Math.floor(Math.random() * 256));
  return Buffer.from(bytes).toString("base64url").slice(0, 8);
}

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
    return res.status(400).json({ success: false, error: "Aucun prospect sélectionné." });
  }

  const supaHeaders = {
    apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
  };

  try {
    const idsFilter = ids.map((id) => `"${id}"`).join(",");
    const resp = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/prospects_sms?id=in.(${idsFilter})&select=id,nom,email,opt_out,clic_token`,
      { headers: supaHeaders }
    );
    if (!resp.ok) throw new Error("Lecture Supabase impossible.");
    const tousLesProspects = await resp.json();

    const sansEmail = tousLesProspects.filter((p) => !p.email).map((p) => p.id);
    const prospects = tousLesProspects.filter((p) => p.email && !p.opt_out);
    const ignoresOptOut = tousLesProspects.filter((p) => p.email && p.opt_out).map((p) => p.id);

    for (const p of prospects) {
      if (!p.clic_token) {
        p.clic_token = genererToken();
        await fetch(`${process.env.SUPABASE_URL}/rest/v1/prospects_sms?id=eq.${encodeURIComponent(p.id)}`, {
          method: "PATCH",
          headers: { ...supaHeaders, Prefer: "return=minimal" },
          body: JSON.stringify({ clic_token: p.clic_token }),
        });
      }
    }

    const results = [];
    for (const p of prospects) {
      try {
        await envoyerViaResend(p.email, p.nom, p.clic_token);
        await fetch(`${process.env.SUPABASE_URL}/rest/v1/prospects_sms?id=eq.${encodeURIComponent(p.id)}`, {
          method: "PATCH",
          headers: { ...supaHeaders, Prefer: "return=minimal" },
          body: JSON.stringify({ email_envoye: true, date_envoi_email: new Date().toISOString() }),
        });
        results.push({ id: p.id, success: true });
      } catch (err) {
        console.error("Email échoué pour", p.email, err.message);
        results.push({ id: p.id, success: false, error: err.message });
      }
    }

    return res.status(200).json({
      success: true,
      envoyes: results.filter((r) => r.success).length,
      echoues: results.filter((r) => !r.success).length,
      ignoresOptOut: ignoresOptOut.length,
      ignoresSansEmail: sansEmail.length,
      details: results,
    });
  } catch (err) {
    console.error("prospects-send-email error:", err);
    return res.status(500).json({ success: false, error: "Envoi impossible pour le moment." });
  }
}
