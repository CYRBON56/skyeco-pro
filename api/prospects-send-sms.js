// api/prospects-send-sms.js
// Envoie le SMS de prospection Skyeco Pro aux prospects sélectionnés,
// puis marque chacun comme "envoyé" dans Supabase.
//
// Variables d'environnement requises :
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ADMIN_TOKEN  (voir prospects-import.js)
//   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER
//
// Requête attendue : POST
//   Headers: Authorization: Bearer <ADMIN_TOKEN>
//   Body: { ids: ["uuid1", "uuid2", ...] }

import twilio from "twilio";
import crypto from "crypto";

const BASE_URL = "https://skyeco-pro.vercel.app";
const MAX_NOM = 32; // marge calculée pour rester sous 160 caractères même avec un long nom d'entreprise

// Message volontairement composé uniquement de caractères GSM-7 (pas de €, pas
// de tiret cadratin —, pas d'accent hors norme comme ê) et d'un lien court
// avec token de 8 caractères (au lieu de l'UUID complet), avec le nom tronqué
// si besoin, pour GARANTIR 160 caractères max : 1 seul segment facturé par
// SMS au lieu de 4.
const MESSAGE = (nom, token) => {
  const nomCourt = (nom || "").slice(0, MAX_NOM);
  return (
    `Bonjour, Skyeco Pro (pour ${nomCourt}) : site vitrine artisan BTP dès 590 euros. ` +
    `Voir: ${BASE_URL}/l?p=${token} STOP=stop`
  );
};

// Génère un token court, url-safe, pour le lien de tracking.
function genererToken() {
  return crypto.randomBytes(6).toString("base64url").slice(0, 8);
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
      `${process.env.SUPABASE_URL}/rest/v1/prospects_sms?id=in.(${idsFilter})&select=id,nom,telephone_e164,opt_out,clic_token`,
      { headers: supaHeaders }
    );
    if (!resp.ok) throw new Error("Lecture Supabase impossible.");
    const tousLesProspects = await resp.json();

    // Ne jamais envoyer aux prospects qui ont répondu STOP.
    const prospects = tousLesProspects.filter((p) => !p.opt_out);
    const ignoresOptOut = tousLesProspects.filter((p) => p.opt_out).map((p) => p.id);

    // Assure que chaque prospect a un token de tracking avant l'envoi
    // (généré une seule fois, réutilisé pour les envois suivants).
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

    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

    const results = [];
    for (const p of prospects) {
      try {
        await client.messages.create({
          body: MESSAGE(p.nom, p.clic_token),
          from: process.env.TWILIO_FROM_NUMBER,
          to: p.telephone_e164,
        });
        results.push({ id: p.id, success: true });
      } catch (err) {
        console.error("SMS échoué pour", p.telephone_e164, err.message);
        results.push({ id: p.id, success: false, error: err.message });
      }
    }

    const sentIds = results.filter((r) => r.success).map((r) => `"${r.id}"`);
    if (sentIds.length > 0) {
      await fetch(`${process.env.SUPABASE_URL}/rest/v1/prospects_sms?id=in.(${sentIds.join(",")})`, {
        method: "PATCH",
        headers: supaHeaders,
        body: JSON.stringify({ sms_envoye: true, date_envoi: new Date().toISOString() }),
      });
    }

    return res.status(200).json({
      success: true,
      envoyes: results.filter((r) => r.success).length,
      echoues: results.filter((r) => !r.success).length,
      ignoresOptOut: ignoresOptOut.length,
      details: results,
    });
  } catch (err) {
    console.error("prospects-send-sms error:", err);
    return res.status(500).json({ success: false, error: "Envoi impossible pour le moment." });
  }
}
