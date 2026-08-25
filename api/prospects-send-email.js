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
//   alter table prospects_sms add column if not exists email_ouvert boolean default false;
//   alter table prospects_sms add column if not exists date_ouverture timestamptz;
//   alter table prospects_sms add column if not exists nb_ouvertures integer default 0;

const FROM = "Skyeco Pro <contact@ecoskybyrms.fr>";
const BASE_URL = "https://skyeco-pro.vercel.app";

function emailHtml(nom, token) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <style>
    @keyframes clignote { 0%, 100% { opacity:1; } 50% { opacity:0.25; } }
    .exemple-clignote { animation: clignote 1.1s ease-in-out infinite; }
  </style>
</head>
<body style="margin:0;padding:0;background-color:#f0ece2;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f0ece2">
    <tr>
      <td align="center" style="padding:24px 16px;">
        <table width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="#0f1a2b" style="max-width:600px;">

          <!-- Bandeau logo -->
          <tr>
            <td style="padding:22px 32px;border-bottom:3px solid #DE5A2C;font-family:Arial,Helvetica,sans-serif;">
              <span style="font-size:18px;font-weight:800;letter-spacing:1px;color:#ffffff;">SKY<span style="color:#DE5A2C;">ECO</span>&nbsp;PRO</span>
            </td>
          </tr>

          <!-- Hero -->
          <tr>
            <td style="padding:40px 32px 28px 32px;font-family:Arial,Helvetica,sans-serif;">
              <p style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#DE5A2C;font-weight:bold;margin:0 0 14px 0;">
                Formulaire de devis &amp; Google Ads pour le BTP
              </p>
              <p style="font-size:26px;line-height:32px;font-weight:800;color:#ffffff;margin:0 0 22px 0;">
                Sans formulaire de devis direct,<br>
                <span style="color:#DE5A2C;">vous n'existez pas.</span>
              </p>
              <p style="font-size:14px;line-height:21px;color:#c3ccd6;margin:0;">
                Bonjour${nom ? " " + nom : ""}, un site vitrine seul ne suffit pas &mdash; sans formulaire de devis ni campagne Google Ads,
                vos clients potentiels vous trouvent difficilement et repartent sans laisser leurs coordonn&eacute;es.
                Skyeco Pro ajoute les deux : un formulaire qui convertit vos visiteurs en demandes, et des campagnes Google Ads g&eacute;r&eacute;es pour vous.
              </p>
            </td>
          </tr>

          <!-- Bloc tarif -->
          <tr>
            <td style="padding:0 32px 28px 32px;font-family:Arial,Helvetica,sans-serif;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#182742" style="border:1px solid #2a3a54;">
                <tr>
                  <td align="center" style="padding:22px 20px 10px 20px;">
                    <p style="font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:#DE5A2C;font-weight:bold;margin:0 0 8px 0;">Offre jusqu'au 30 septembre</p>
                    <p style="font-size:15px;font-weight:700;color:#ffffff;margin:0 0 14px 0;">Site + formulaire, carrousel &amp; vid&eacute;o + Google Ads</p>
                    <p style="font-size:15px;font-weight:600;color:#6b7c93;text-decoration:line-through;margin:0 0 2px 0;">1990&euro;</p>
                    <p style="font-size:40px;line-height:40px;font-weight:800;color:#ffffff;margin:0;">
                      1530&euro;<span style="font-size:14px;font-weight:600;color:#8fa0b8;">&nbsp;HT</span>
                    </p>
                    <p style="font-size:11px;color:#DE5A2C;font-weight:bold;margin:8px 0 0 0;">-460&euro; jusqu'au 30 septembre</p>
                    <p style="font-size:11px;color:#8fa0b8;margin:6px 0 0 0;">paiement unique + abonnement Google Ads d&egrave;s 150&euro;/mois</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding:14px 20px 20px 20px;border-top:1px solid #223252;">
                    <p style="font-size:12px;line-height:20px;color:#c3ccd6;margin:0;">
                      &#10003;&nbsp;Formulaire de demande de devis en ligne<br>
                      &#10003;&nbsp;Notification SMS &agrave; chaque nouveau contact<br>
                      &#10003;&nbsp;Gestion de vos campagnes Google Ads<br>
                      &#10003;&nbsp;Dashboard de suivi de vos demandes
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- CTA -->
          <tr>
            <td align="center" style="padding:0 32px 24px 32px;">
              <table cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td bgcolor="#DE5A2C" style="border-radius:4px;">
                    <a href="${BASE_URL}/l?p=${token}" style="display:block;padding:15px 36px;font-family:Arial,Helvetica,sans-serif;font-size:14px;letter-spacing:0.5px;text-transform:uppercase;color:#ffffff;text-decoration:none;font-weight:bold;">
                      Voir la formule compl&egrave;te
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Voir un exemple (gros, clignotant) -->
          <tr>
            <td align="center" style="padding:0 32px 40px 32px;">
              <a href="https://salesflow-ecosky.vercel.app/estimation.html" class="exemple-clignote" style="display:inline-block;font-family:Arial,Helvetica,sans-serif;font-size:22px;font-weight:800;color:#DE5A2C;text-decoration:underline;">
                Voir un exemple &rarr;
              </a>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:20px 32px 28px 32px;border-top:1px solid #223252;font-family:Arial,Helvetica,sans-serif;">
              <p style="font-size:11px;line-height:16px;color:#6b7c93;margin:0;">
                Vous recevez cet email car votre entreprise a &eacute;t&eacute; identifi&eacute;e via des donn&eacute;es publiques (annuaire professionnel).
                <a href="${BASE_URL}/d?p=${token}" style="color:#8fa0b8;text-decoration:underline;">Se d&eacute;sabonner en un clic</a>.
              </p>
            </td>
          </tr>

        </table>
        <img src="${BASE_URL}/o?p=${token}" width="1" height="1" alt="" style="display:block;border:0;" />
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function emailText(nom, token) {
  return (
    `SKYECO PRO — Formulaire de devis et Google Ads pour le BTP\n\n` +
    `Sans formulaire de devis direct, vous n'existez pas.\n\n` +
    `Bonjour${nom ? " " + nom : ""}, un site vitrine seul ne suffit pas — sans formulaire de devis ni campagne Google Ads, ` +
    `vos clients potentiels vous trouvent difficilement et repartent sans laisser leurs coordonnees. ` +
    `Skyeco Pro ajoute les deux : un formulaire qui convertit vos visiteurs en demandes, et des campagnes Google Ads gerees pour vous.\n\n` +
    `FORMULE 03 — Site + formulaire, carrousel & video + Google Ads\n` +
    `1990 EUR (barre) -> 1530 EUR HT (-460 EUR jusqu'au 30 septembre)\n` +
    `(paiement unique + abonnement Google Ads des 150 EUR/mois)\n` +
    `- Formulaire de demande de devis en ligne\n` +
    `- Notification SMS a chaque nouveau contact\n` +
    `- Gestion de vos campagnes Google Ads\n` +
    `- Dashboard de suivi de vos demandes\n\n` +
    `Voir la formule complete : ${BASE_URL}/l?p=${token}\n` +
    `Voir un exemple : https://salesflow-ecosky.vercel.app/estimation.html\n\n` +
    `Se desabonner en un clic : ${BASE_URL}/d?p=${token}`
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
      subject: "Sans formulaire de devis, vous n'existez pas",
      html: emailHtml(nom, token),
      text: emailText(nom, token),
      headers: {
        "List-Unsubscribe": `<${BASE_URL}/d?p=${token}>, <mailto:contact@ecoskybyrms.fr?subject=STOP>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
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
    if (!resp.ok) {
      const detail = await resp.text();
      throw new Error("Lecture Supabase impossible : " + detail);
    }
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
    return res.status(500).json({ success: false, error: "Envoi impossible : " + err.message });
  }
}
