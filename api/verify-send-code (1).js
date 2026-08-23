// api/verify-send-code.js
// Envoie un code de vérification par SMS au numéro fourni, via Twilio Verify.
//
// Variables d'environnement requises (Vercel > Settings > Environment Variables) :
//   TWILIO_ACCOUNT_SID
//   TWILIO_AUTH_TOKEN
//   TWILIO_VERIFY_SERVICE_SID   (créé dans la console Twilio > Verify > Services)
//
// Requête attendue : POST { phone: "+33612345678" }
// Réponse : { success: true, status: "pending" } ou { success: false, error: "..." }

import twilio from "twilio";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Méthode non autorisée." });
  }

  const { phone } = req.body || {};

  if (!phone || typeof phone !== "string") {
    return res.status(400).json({ success: false, error: "Numéro de téléphone manquant." });
  }

  // Normalise en E.164 (+33...) à partir d'un numéro français saisi en 0X XX XX XX XX
  const digits = phone.replace(/[\s.-]/g, "");
  let e164;
  if (/^0[1-9]\d{8}$/.test(digits)) {
    e164 = "+33" + digits.slice(1);
  } else if (/^\+33[1-9]\d{8}$/.test(digits)) {
    e164 = digits;
  } else {
    return res.status(400).json({ success: false, error: "Format de numéro invalide." });
  }

  try {
    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

    const verification = await client.verify.v2
      .services(process.env.TWILIO_VERIFY_SERVICE_SID)
      .verifications.create({ to: e164, channel: "sms" });

    return res.status(200).json({ success: true, status: verification.status });
  } catch (err) {
    console.error("verify-send-code error:", err);
    return res.status(500).json({
      success: false,
      error: "Impossible d'envoyer le code pour le moment. Réessayez dans un instant.",
    });
  }
}
