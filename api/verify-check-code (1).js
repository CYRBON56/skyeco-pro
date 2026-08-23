// api/verify-check-code.js
// Vérifie le code SMS saisi par l'utilisateur, via Twilio Verify.
//
// Mêmes variables d'environnement que verify-send-code.js.
//
// Requête attendue : POST { phone: "+33612345678", code: "123456" }
// Réponse : { success: true, valid: true|false } ou { success: false, error: "..." }

import twilio from "twilio";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Méthode non autorisée." });
  }

  const { phone, code } = req.body || {};

  if (!phone || !code) {
    return res.status(400).json({ success: false, error: "Numéro ou code manquant." });
  }

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

    const check = await client.verify.v2
      .services(process.env.TWILIO_VERIFY_SERVICE_SID)
      .verificationChecks.create({ to: e164, code: String(code).trim() });

    return res.status(200).json({ success: true, valid: check.status === "approved" });
  } catch (err) {
    console.error("verify-check-code error:", err);
    return res.status(500).json({
      success: false,
      error: "Vérification impossible pour le moment. Réessayez.",
    });
  }
}
