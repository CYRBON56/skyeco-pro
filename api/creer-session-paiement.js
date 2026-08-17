// api/creer-session-paiement.js
// Crée une session Stripe Checkout pour le paiement de la mise en place
// (2 500 € HT + TVA 20 % = 3 000 € TTC — ajuster MONTANT_CENTIMES si besoin).
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

// 3 000,00 € en centimes. À adapter si le taux de TVA ou le tarif change.
const MONTANT_CENTIMES = 300000;
const DEVISE = "eur";

async function supabaseRequest(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
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
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).send("Method not allowed");

  try {
    const { entreprise_id } = req.body || {};
    if (!entreprise_id) {
      return res.status(400).json({ success: false, error: "entreprise_id requis" });
    }

    const entreprises = await supabaseRequest(`entreprises?id=eq.${entreprise_id}&select=nom,email_contact`);
    const entreprise = entreprises && entreprises[0];
    if (!entreprise) {
      return res.status(404).json({ success: false, error: "Entreprise introuvable" });
    }

    const origin = req.headers.origin || `https://${req.headers.host}`;

    const params = new URLSearchParams({
      mode: "payment",
      "line_items[0][price_data][currency]": DEVISE,
      "line_items[0][price_data][unit_amount]": String(MONTANT_CENTIMES),
      "line_items[0][price_data][product_data][name]": "Skyeco Pro — Mise en place",
      "line_items[0][price_data][product_data][description]": `${entreprise.nom} — Vitrine, formulaire, compte Google Ads, mise en ligne et connexion SMS`,
      "line_items[0][quantity]": "1",
      success_url: `${origin}/dashboard.html?paiement=succes`,
      cancel_url: `${origin}/contrat-paiement.html?paiement=annule`,
      "metadata[entreprise_id]": entreprise_id,
    });
    if (entreprise.email_contact) {
      params.append("customer_email", entreprise.email_contact);
    }

    const stripeRes = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    const session = await stripeRes.json();
    if (!stripeRes.ok) {
      console.error("creer-session-paiement Stripe error:", session);
      throw new Error("Impossible de créer la session de paiement.");
    }

    await supabaseRequest(`entreprises?id=eq.${entreprise_id}`, {
      method: "PATCH",
      body: JSON.stringify({ stripe_session_id: session.id }),
    });

    return res.status(200).json({ success: true, url: session.url });
  } catch (err) {
    console.error("creer-session-paiement error:", err.message);
    return res.status(500).json({ success: false, error: "Erreur technique, merci de réessayer." });
  }
}
