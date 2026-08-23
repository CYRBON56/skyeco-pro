// api/demande-rappel.js
// Reçoit une demande de "rappel immédiat" DÉJÀ confirmée par code SMS
// (voir verify-send-code.js / verify-check-code.js) et notifie RMS EcoSky.
//
// Variables d'environnement requises : les mêmes que book-appointment.js
//   TWILIO_ACCOUNT_SID
//   TWILIO_AUTH_TOKEN
//   TWILIO_FROM_NUMBER
//   TWILIO_TO_NUMBER
//
// Requête attendue : POST { phone: "+33612345678", formule: "..." (optionnel) }

import twilio from "twilio";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Méthode non autorisée." });
  }

  const { phone, formule } = req.body || {};

  if (!phone) {
    return res.status(400).json({ success: false, error: "Numéro manquant." });
  }

  try {
    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

    const message =
      `Demande de rappel IMMÉDIAT — Skyeco Pro\n` +
      `Numéro confirmé par SMS : ${phone}\n` +
      `${formule ? "Formule : " + formule : ""}`;

    await client.messages.create({
      body: message.trim(),
      from: process.env.TWILIO_FROM_NUMBER,
      to: process.env.TWILIO_TO_NUMBER,
    });

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("demande-rappel error:", err);
    return res.status(500).json({ success: false, error: "Notification impossible pour le moment." });
  }
}
