// api/envoi-auto-quotidien.js
// Envoie automatiquement un petit lot d'emails chaque jour, aux prospects
// jamais contactés par email, sans intervention manuelle.
//
// Déclenché par Vercel Cron (voir vercel.json : "0 7 * * *" = 7h UTC).
// Vercel ajoute automatiquement l'en-tête "Authorization: Bearer <CRON_SECRET>"
// aux requêtes cron si la variable d'environnement CRON_SECRET est définie —
// c'est ce qui protège cet endpoint contre un déclenchement externe non désiré.
//
// Variables d'environnement requises :
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY, CRON_SECRET
// Variable optionnelle :
//   ENVOI_AUTO_QUOTIDIEN_LIMITE (nombre d'emails envoyés par jour, défaut 200)

import {
  envoyerAvecRetry,
  dormir,
  genererToken,
  QuotaJournalierAtteint,
} from "./prospects-send-email.js";

const LIMITE_PAR_DEFAUT = 200;

export default async function handler(req, res) {
  // Sécurité : seul Vercel Cron (avec le bon secret) peut déclencher cet envoi.
  const auth = req.headers.authorization || "";
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ success: false, error: "Non autorisé." });
  }

  const limite = parseInt(process.env.ENVOI_AUTO_QUOTIDIEN_LIMITE, 10) || LIMITE_PAR_DEFAUT;

  const supaHeaders = {
    apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
  };

  try {
    // On ne prend que les prospects jamais contactés par email, avec une
    // adresse connue et pas désabonnés — triés par id pour un ordre stable
    // (on avance dans la liste jour après jour, sans jamais revenir en arrière).
    const resp = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/prospects_sms` +
        `?email_envoye=eq.false&opt_out=eq.false&email=not.is.null` +
        `&select=id,nom,email,clic_token&order=id.asc&limit=${limite}`,
      { headers: supaHeaders }
    );
    if (!resp.ok) {
      const detail = await resp.text();
      throw new Error("Lecture Supabase impossible : " + detail);
    }
    const prospects = await resp.json();

    if (prospects.length === 0) {
      console.log("Envoi auto quotidien : aucun prospect restant à contacter.");
      return res.status(200).json({ success: true, envoyes: 0, echoues: 0, message: "Aucun prospect restant." });
    }

    // Génère un token de suivi pour ceux qui n'en ont pas encore.
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
          console.error("Envoi auto quotidien : quota journalier Resend atteint, arrêt.");
          results.push({ id: p.id, success: false, error: "Quota journalier Resend atteint." });
          continue;
        }
        console.error("Envoi auto quotidien : échec pour", p.email, err.message);
        results.push({ id: p.id, success: false, error: err.message });
      }
      await dormir(350); // throttle ~2,8 envois/seconde, sous la limite Resend par défaut
    }

    const envoyes = results.filter((r) => r.success).length;
    const echoues = results.filter((r) => !r.success).length;
    console.log(`Envoi auto quotidien terminé : ${envoyes} envoyé(s), ${echoues} échoué(s)/non tenté(s).`);

    return res.status(200).json({
      success: true,
      envoyes,
      echoues,
      quotaAtteint,
      details: results,
    });
  } catch (err) {
    console.error("envoi-auto-quotidien error:", err);
    return res.status(500).json({ success: false, error: "Envoi automatique impossible : " + err.message });
  }
}
