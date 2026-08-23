// api/book-appointment.js
// Reçoit le créneau choisi par le client sur commande.html et envoie une
// notification SMS à RMS EcoSky (même principe que api/request-callback.js
// de SalesFlow) — pas de dépendance à un service externe type Calendly.
//
// Variables d'environnement requises :
//   TWILIO_ACCOUNT_SID
//   TWILIO_AUTH_TOKEN
//   TWILIO_FROM_NUMBER     (numéro Twilio expéditeur)
//   TWILIO_TO_NUMBER       (numéro de Cyrille, ex: +33645688394)

import twilio from "twilio";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Méthode non autorisée." });
  }

  const { formule, prix, raisonSociale, siret, telephone, email, creneau } = req.body || {};

  if (!telephone || !creneau) {
    return res.status(400).json({ success: false, error: "Informations manquantes." });
  }

  try {
    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

    const message =
      `Nouveau RDV Skyeco Pro\n` +
      `${formule || "Formule non précisée"} (${prix || "-"})\n` +
      `${raisonSociale ? raisonSociale + " — " : ""}SIRET ${siret || "-"}\n` +
      `Tel: ${telephone}${email ? " / " + email : ""}\n` +
      `Créneau: ${creneau}`;

    await client.messages.create({
      body: message,
      from: process.env.TWILIO_FROM_NUMBER,
      to: process.env.TWILIO_TO_NUMBER,
    });

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("book-appointment error:", err);
    return res.status(500).json({ success: false, error: "Notification impossible pour le moment." });
  }
}
