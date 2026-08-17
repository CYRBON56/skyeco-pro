// api/stripe-webhook.js
// Reçoit la confirmation de paiement de Stripe et active l'accès du client.
// Nécessite STRIPE_WEBHOOK_SECRET (obtenu en configurant le webhook dans le
// dashboard Stripe, endpoint : https://skyeco-pro.vercel.app/api/stripe-webhook).
//
// IMPORTANT : cet endpoint doit recevoir le corps brut (non parsé) pour que
// la vérification de signature Stripe fonctionne. Sur Vercel, désactiver le
// bodyParser via la config ci-dessous.
export const config = {
  api: { bodyParser: false },
};

const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

async function getRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

// Vérification de signature Stripe sans dépendance externe (HMAC SHA-256).
async function verifierSignatureStripe(rawBody, signatureHeader, secret) {
  const crypto = await import("crypto");
  const parts = Object.fromEntries(
    signatureHeader.split(",").map((p) => p.split("="))
  );
  const timestamp = parts.t;
  const signature = parts.v1;
  const payload = `${timestamp}.${rawBody}`;
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  return expected === signature;
}

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
  if (req.method !== "POST") return res.status(405).send("Method not allowed");

  try {
    const rawBody = await getRawBody(req);
    const signatureHeader = req.headers["stripe-signature"];

    const valide = await verifierSignatureStripe(rawBody.toString(), signatureHeader, STRIPE_WEBHOOK_SECRET);
    if (!valide) {
      console.error("stripe-webhook: signature invalide");
      return res.status(400).send("Signature invalide");
    }

    const event = JSON.parse(rawBody.toString());

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const entrepriseId = session.metadata && session.metadata.entreprise_id;
      if (entrepriseId) {
        await supabaseRequest(`entreprises?id=eq.${entrepriseId}`, {
          method: "PATCH",
          body: JSON.stringify({
            paiement_statut: "valide",
            paiement_mode: "carte",
            paiement_valide_le: new Date().toISOString(),
          }),
        });
      }
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error("stripe-webhook error:", err.message);
    return res.status(500).send("Erreur webhook");
  }
}
