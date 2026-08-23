// api/sms-inbound-webhook.js
// Webhook Twilio : appelé automatiquement à chaque SMS reçu sur le numéro
// Skyeco Pro (réponse d'un prospect). Si le message est un désabonnement
// (STOP, ARRET, ARRÊT...), on marque le prospect correspondant comme
// "opt_out" dans Supabase pour ne plus jamais lui envoyer de SMS.
//
// À configurer dans la Console Twilio, sur le numéro Skyeco Pro :
//   Section "A message comes in" → Webhook → POST
//   URL : https://skyeco-pro.vercel.app/api/sms-inbound-webhook
//
// Variables d'environnement requises :
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
// Prérequis SQL (à exécuter une fois dans Supabase, SQL editor) :
//   alter table prospects_sms add column if not exists opt_out boolean default false;
//   alter table prospects_sms add column if not exists opt_out_date timestamptz;
//   alter table prospects_sms add column if not exists derniere_reponse text;

const MOTS_STOP = ["stop", "arret", "arrêt", "desabonner", "désabonner", "stopsms"];

function estDesabonnement(texte) {
  if (!texte) return false;
  const normalise = texte
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, ""); // enlève les accents
  return MOTS_STOP.some((mot) => normalise === mot.normalize("NFD").replace(/[\u0300-\u036f]/g, ""));
}

async function supabaseRequest(path, options = {}) {
  const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: options.prefer || "return=representation",
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase error ${res.status}: ${text}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).send("Method not allowed");
  }

  try {
    // Twilio envoie le corps en x-www-form-urlencoded : { From, Body, ... }
    const { From, Body } = req.body || {};

    if (From) {
      const texte = (Body || "").toString();
      const desabonnement = estDesabonnement(texte);

      const updates = { derniere_reponse: texte, derniere_reponse_date: new Date().toISOString() };
      if (desabonnement) {
        updates.opt_out = true;
        updates.opt_out_date = new Date().toISOString();
      }

      // Met à jour tous les prospects correspondant à ce numéro (au cas où
      // le même numéro serait présent plusieurs fois).
      await supabaseRequest(`prospects_sms?telephone_e164=eq.${encodeURIComponent(From)}`, {
        method: "PATCH",
        body: JSON.stringify(updates),
        prefer: "return=minimal",
      });
    }

    // Twilio attend une réponse TwiML valide (même vide) sinon il logue une erreur.
    res.setHeader("Content-Type", "text/xml");
    return res.status(200).send("<Response></Response>");
  } catch (err) {
    console.error("sms-inbound-webhook error:", err);
    // On répond quand même 200 avec TwiML vide pour éviter que Twilio ne réessaie en boucle.
    res.setHeader("Content-Type", "text/xml");
    return res.status(200).send("<Response></Response>");
  }
}
