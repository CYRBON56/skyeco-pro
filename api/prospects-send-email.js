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
                Offre limit&eacute;e &mdash; jusqu'au 30 septembre
              </p>
              <p style="font-size:32px;line-height:36px;font-weight:900;color:#DE5A2C;letter-spacing:0.5px;text-transform:uppercase;margin:0 0 18px 0;">
                Formulaire vitrine
              </p>
              <p style="font-size:24px;line-height:30px;font-weight:800;color:#ffffff;margin:0 0 18px 0;">
                Bonjour${nom ? " " + nom : ""}, 990&euro; pour trouver vos clients ?<br>
                <span style="color:#DE5A2C;">On sait, &ccedil;a sonne faux.</span>
              </p>
              <p style="font-size:14px;line-height:21px;color:#c3ccd6;margin:0 0 16px 0;">
                Normal. &laquo;&nbsp;Formulaire, SMS automatique, Google Ads inclus&nbsp;&raquo;, &ccedil;a ressemble &agrave; toutes les
                promesses qu'on vous a d&eacute;j&agrave; vendues.
              </p>
              <p style="font-size:13px;line-height:20px;color:#8fa0b8;margin:0 0 16px 0;border-left:2px solid #DE5A2C;padding-left:12px;">
                Sauf qu'ici il n'y a rien &agrave; croire sur parole. Un client tape votre m&eacute;tier sur Google, tombe sur votre
                <strong style="color:#c3ccd6;">formulaire vitrine</strong> &mdash; une mini-page d&eacute;di&eacute;e &agrave; votre m&eacute;tier
                &mdash; laisse ses coordonn&eacute;es, et vous recevez un <strong style="color:#c3ccd6;">SMS</strong> dans la minute. C'est tout.
                Pas de blabla marketing, juste le contact qui arrive avant que le client n'appelle quelqu'un d'autre.
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
                    <p style="font-size:15px;font-weight:700;color:#ffffff;margin:0 0 14px 0;">Formulaire vitrine, carrousel &amp; vid&eacute;o + Google Ads</p>
                    <p style="font-size:15px;font-weight:600;color:#6b7c93;text-decoration:line-through;margin:0 0 2px 0;">1530&euro;</p>
                    <p style="font-size:40px;line-height:40px;font-weight:800;color:#ffffff;margin:0;">
                      990&euro;<span style="font-size:14px;font-weight:600;color:#8fa0b8;">&nbsp;HT</span>
                    </p>
                    <p style="font-size:11px;color:#DE5A2C;font-weight:bold;margin:8px 0 0 0;">-540&euro; jusqu'au 30 septembre</p>
                    <p style="font-size:11px;color:#8fa0b8;margin:6px 0 0 0;">paiement unique + abonnement Google Ads d&egrave;s 150&euro;HT/mois</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding:14px 20px 20px 20px;border-top:1px solid #223252;">
                    <p style="font-size:12px;line-height:20px;color:#c3ccd6;margin:0;">
                      &#10003;&nbsp;<strong>Formulaire vitrine</strong> de demande de devis en ligne<br>
                      &#10003;&nbsp;<strong>Notification SMS</strong> imm&eacute;diate &agrave; chaque nouveau contact<br>
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
            <td align="center" style="padding:0 32px 10px 32px;">
              <table cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td bgcolor="#DE5A2C" style="border-radius:4px;">
                    <a href="${BASE_URL}/l?p=${token}" style="display:block;padding:16px 40px;font-family:Arial,Helvetica,sans-serif;font-size:15px;letter-spacing:0.5px;text-transform:uppercase;color:#ffffff;text-decoration:none;font-weight:bold;">
                      Je veux voir mon offre
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:0 32px 32px 32px;font-family:Arial,Helvetica,sans-serif;">
              <p style="font-size:11px;color:#5a6b82;margin:0;">
                Le bouton ne s'affiche pas ? <a href="${BASE_URL}/l?p=${token}" style="color:#8fa0b8;">Cliquez ici</a>
              </p>
            </td>
          </tr>

          <!-- Voir un exemple (image + lien gros, clignotant) -->
          <tr>
            <td align="center" style="padding:0 32px 40px 32px;">
              <a href="${BASE_URL}/l?p=${token}&dest=exemple" style="display:block;margin-bottom:14px;">
                <img src="https://heviivnlswohnrzcguxv.supabase.co/storage/v1/object/public/ecosky.fr/21.png" alt="Exemple de formulaire vitrine r&eacute;alis&eacute; par Skyeco Pro" width="536" style="width:100%;max-width:536px;height:auto;display:block;border:1px solid #2a3a54;border-radius:4px;">
              </a>
              <a href="${BASE_URL}/l?p=${token}&dest=exemple" class="exemple-clignote" style="display:inline-block;font-family:Arial,Helvetica,sans-serif;font-size:22px;font-weight:800;color:#DE5A2C;text-decoration:underline;">
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
    `SKYECO PRO — Offre limitée jusqu'au 30 septembre\n\n` +
    `FORMULAIRE VITRINE\n\n` +
    `Bonjour${nom ? " " + nom : ""}, 990 EUR pour trouver vos clients ? On sait, ca sonne faux.\n\n` +
    `Normal. "Formulaire, SMS automatique, Google Ads inclus", ca ressemble a toutes les promesses qu'on vous a deja vendues.\n\n` +
    `Sauf qu'ici il n'y a rien a croire sur parole. Un client tape votre metier sur Google, tombe sur votre formulaire vitrine ` +
    `(une mini-page dediee a votre metier), laisse ses coordonnees, et vous recevez un SMS dans la minute. C'est tout. ` +
    `Pas de blabla marketing, juste le contact qui arrive avant que le client n'appelle quelqu'un d'autre.\n\n` +
    `FORMULE 03 — Formulaire vitrine, carrousel & video + Google Ads\n` +
    `1530 EUR (barre) -> 990 EUR HT (-540 EUR jusqu'au 30 septembre)\n` +
    `(paiement unique + abonnement Google Ads des 150 EUR HT/mois)\n` +
    `- Formulaire vitrine de demande de devis en ligne\n` +
    `- Notification SMS immediate a chaque nouveau contact\n` +
    `- Gestion de vos campagnes Google Ads\n` +
    `- Dashboard de suivi de vos demandes\n\n` +
    `Je veux voir mon offre : ${BASE_URL}/l?p=${token}\n` +
    `Voir un exemple : ${BASE_URL}/l?p=${token}&dest=exemple\n\n` +
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
      subject: "990€ pour trouver vos clients ? On sait, ça sonne faux.",
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
    const err = new Error(detail);
    err.status = resp.status;
    throw err;
  }
  return resp.json();
}

function dormir(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Resend limite le compte à quelques requêtes par seconde (429 "rate_limit_exceeded"
// si on envoie trop vite en boucle serrée) — ça, on retente avec un délai croissant.
// Le quota journalier (429 "daily_quota_exceeded") en revanche ne se résout jamais en
// retentant : c'est une limite de compte pour la journée, il faut arrêter l'envoi.
class QuotaJournalierAtteint extends Error {}

async function envoyerAvecRetry(to, nom, token, tentativesMax = 4) {
  for (let tentative = 1; tentative <= tentativesMax; tentative++) {
    try {
      return await envoyerViaResend(to, nom, token);
    } catch (err) {
      if (/daily_quota_exceeded/i.test(err.message || "")) {
        throw new QuotaJournalierAtteint(err.message);
      }
      const estRateLimit = err.status === 429 || /rate.?limit/i.test(err.message || "");
      if (estRateLimit && tentative < tentativesMax) {
        await dormir(800 * tentative); // 800ms, puis 1.6s, puis 2.4s...
        continue;
      }
      throw err;
    }
  }
}

function genererToken() {
  const bytes = Array.from({ length: 6 }, () => Math.floor(Math.random() * 256));
  return Buffer.from(bytes).toString("base64url").slice(0, 8);
}

// Découpe un tableau en lots, pour éviter les URL Supabase trop longues
// (id=in.(...) avec des centaines/milliers d'UUID dépasse les limites de
// l'API et renvoie "Bad Request").
const TAILLE_LOT = 100;
function decouperEnLots(tableau, taille = TAILLE_LOT) {
  const lots = [];
  for (let i = 0; i < tableau.length; i += taille) {
    lots.push(tableau.slice(i, i + taille));
  }
  return lots;
}

// Lit les prospects par lots (au lieu d'une seule requête avec tous les IDs)
// pour rester sous les limites de longueur d'URL de Supabase/Vercel.
async function lireProspectsParLots(ids, supaHeaders) {
  const tousLesProspects = [];
  for (const lot of decouperEnLots(ids)) {
    const idsFilter = lot.map((id) => `"${id}"`).join(",");
    const resp = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/prospects_sms?id=in.(${idsFilter})&select=id,nom,email,opt_out,clic_token`,
      { headers: supaHeaders }
    );
    if (!resp.ok) {
      const detail = await resp.text();
      throw new Error("Lecture Supabase impossible : " + detail);
    }
    tousLesProspects.push(...(await resp.json()));
  }
  return tousLesProspects;
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
    const tousLesProspects = await lireProspectsParLots(ids, supaHeaders);

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
    let quotaAtteint = false;
    for (const p of prospects) {
      if (quotaAtteint) {
        results.push({ id: p.id, success: false, error: "Non tenté : quota journalier Resend atteint." });
        continue;
      }
      try {
        await envoyerAvecRetry(p.email, p.nom, p.clic_token);
        await fetch(`${process.env.SUPABASE_URL}/rest/v1/prospects_sms?id=eq.${encodeURIComponent(p.id)}`, {
          method: "PATCH",
          headers: { ...supaHeaders, Prefer: "return=minimal" },
          body: JSON.stringify({ email_envoye: true, date_envoi_email: new Date().toISOString() }),
        });
        results.push({ id: p.id, success: true });
      } catch (err) {
        if (err instanceof QuotaJournalierAtteint) {
          quotaAtteint = true;
          console.error("Quota journalier Resend atteint — arrêt de l'envoi.");
          results.push({ id: p.id, success: false, error: "Quota journalier Resend atteint." });
          continue;
        }
        console.error("Email échoué pour", p.email, err.message);
        results.push({ id: p.id, success: false, error: err.message });
      }
      await dormir(350); // throttle ~2,8 envois/seconde, sous la limite Resend par défaut
    }

    return res.status(200).json({
      success: true,
      envoyes: results.filter((r) => r.success).length,
      echoues: results.filter((r) => !r.success).length,
      ignoresOptOut: ignoresOptOut.length,
      ignoresSansEmail: sansEmail.length,
      quotaAtteint: quotaAtteint,
      details: results,
    });
  } catch (err) {
    console.error("prospects-send-email error:", err);
    return res.status(500).json({ success: false, error: "Envoi impossible : " + err.message });
  }
}
