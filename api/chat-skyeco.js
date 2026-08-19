// api/chat-skyeco.js
// Chat entre Skyeco Pro et une entreprise cliente. L'IA répond en premier,
// avec accès aux vraies données du client (prospects reçus, statut du
// compte), pour donner des réponses concrètes plutôt que génériques.
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

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

// Vérifie que le token envoyé par le client correspond bien à un utilisateur
// Supabase Auth valide, et renvoie son user id. Renvoie null si le token est
// absent, invalide ou expiré.
async function getUserIdFromToken(authHeader) {
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7);
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${token}`,
    },
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data && data.id ? data.id : null;
}

async function getEntrepriseContext(entreprise_id) {
  const [entreprises, tousLesProspects, prospectsCeMois] = await Promise.all([
    supabaseRequest(`entreprises?id=eq.${entreprise_id}&select=nom,created_at,abonnement_actif,plan,owner_user_id`),
    supabaseRequest(`prospects?entreprise_id=eq.${entreprise_id}&select=id`),
    supabaseRequest(
      `prospects?entreprise_id=eq.${entreprise_id}&created_at=gte.${new Date(
        new Date().getFullYear(),
        new Date().getMonth(),
        1
      ).toISOString()}&select=id`
    ),
  ]);

  const entreprise = entreprises && entreprises[0];
  if (!entreprise) return null;

  return {
    owner_user_id: entreprise.owner_user_id,
    nom: entreprise.nom,
    inscrit_depuis: entreprise.created_at,
    abonnement_actif: entreprise.abonnement_actif,
    plan: entreprise.plan,
    total_prospects: tousLesProspects ? tousLesProspects.length : 0,
    prospects_ce_mois: prospectsCeMois ? prospectsCeMois.length : 0,
  };
}

function buildSystemPrompt(ctx) {
  return `Tu es l'assistant Skyeco Pro, qui répond aux questions des entreprises clientes du service (artisans du BTP qui ont souscrit à Skyeco Pro pour recevoir des prospects qualifiés).

Voici les données réelles de l'entreprise avec qui tu discutes :
- Nom : ${ctx.nom}
- Cliente depuis : ${new Date(ctx.inscrit_depuis).toLocaleDateString("fr-FR")}
- Abonnement actif : ${ctx.abonnement_actif ? "oui" : "non"}
- Prospects reçus ce mois-ci : ${ctx.prospects_ce_mois}
- Prospects reçus au total : ${ctx.total_prospects}

Ce que tu sais faire :
- Répondre aux questions sur son compte, ses prospects reçus, le fonctionnement du service.
- Rester factuel : utilise uniquement les chiffres ci-dessus, n'invente jamais de données que tu n'as pas.
- Si la question porte sur le budget Google Ads dépensé, dis clairement que cette donnée n'est pas encore disponible dans le tableau de bord, plutôt que d'inventer un chiffre.
- Pour toute question complexe, commerciale (changement de tarif, résiliation, litige) ou que tu ne peux pas résoudre avec certitude, indique que tu transmets à Cyrille qui reviendra vers eux.

Ton : professionnel, direct, chaleureux. Réponses courtes (quelques phrases), pas de longs pavés. Tu t'adresses à un chef d'entreprise, pas à un particulier.`;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).send("Method not allowed");

  try {
    const { entreprise_id, message } = req.body || {};
    if (!entreprise_id || !message) {
      return res.status(400).json({ success: false, error: "entreprise_id et message requis" });
    }

    // Vérifie l'identité de l'appelant avant de faire quoi que ce soit
    const userId = await getUserIdFromToken(req.headers.authorization);
    if (!userId) {
      return res.status(401).json({ success: false, error: "Non authentifié" });
    }

    const ctx = await getEntrepriseContext(entreprise_id);
    if (!ctx) {
      return res.status(404).json({ success: false, error: "Entreprise introuvable" });
    }

    // Vérifie que l'entreprise demandée appartient bien à l'utilisateur connecté
    if (ctx.owner_user_id !== userId) {
      return res.status(403).json({ success: false, error: "Accès refusé" });
    }

    // 1) Enregistre le message du client
    await supabaseRequest("chat_messages", {
      method: "POST",
      body: JSON.stringify({ entreprise_id, auteur: "client", contenu: message }),
    });

    // 2) Récupère l'historique récent pour donner du contexte à l'IA
    const historique = await supabaseRequest(
      `chat_messages?entreprise_id=eq.${entreprise_id}&order=created_at.desc&limit=20&select=auteur,contenu`
    );
    const messagesTries = (historique || []).reverse();

    const anthropicMessages = messagesTries.map((m) => ({
      role: m.auteur === "client" ? "user" : "assistant",
      content: m.contenu,
    }));

    // 3) Appelle Claude avec le contexte réel du client
    const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 500,
        system: buildSystemPrompt(ctx),
        messages: anthropicMessages,
      }),
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      console.error("chat-skyeco Anthropic error:", errText);
      throw new Error("Erreur lors de la génération de la réponse.");
    }

    const aiData = await aiRes.json();
    const reponseTexte = aiData.content && aiData.content[0] ? aiData.content[0].text : "Désolé, je n'ai pas pu générer de réponse.";

    // 4) Enregistre la réponse de l'IA
    await supabaseRequest("chat_messages", {
      method: "POST",
      body: JSON.stringify({ entreprise_id, auteur: "ia", contenu: reponseTexte }),
    });

    return res.status(200).json({ success: true, reponse: reponseTexte });
  } catch (err) {
    console.error("chat-skyeco error:", err.message);
    return res.status(500).json({ success: false, error: "Erreur technique, merci de réessayer." });
  }
}
