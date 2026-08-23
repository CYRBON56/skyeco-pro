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

const LIEN = "https://skyeco-pro.vercel.app/tarifs.html";
const MESSAGE = (nom) =>
  `Bonjour${nom ? " " + nom : ""}, Skyeco Pro construit des sites vitrines pour les artisans du BTP, prix fixe dès 590€. ` +
  `Voir les formules : ${LIEN} — Répondez STOP pour ne plus recevoir de message.`;

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
      `${process.env.SUPABASE_URL}/rest/v1/prospects_sms?id=in.(${idsFilter})&select=id,nom,telephone_e164,opt_out`,
      { headers: supaHeaders }
    );
    if (!resp.ok) throw new Error("Lecture Supabase impossible.");
    const tousLesProspects = await resp.json();

    // Ne jamais envoyer aux prospects qui ont répondu STOP.
    const prospects = tousLesProspects.filter((p) => !p.opt_out);
    const ignoresOptOut = tousLesProspects.filter((p) => p.opt_out).map((p) => p.id);

    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

    const results = [];
    for (const p of prospects) {
      try {
        await client.messages.create({
          body: MESSAGE(p.nom),
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
