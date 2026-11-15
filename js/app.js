/* Jarvis — assistant vocal personnel de Gaël.
   Voix : Web Speech API du navigateur (gratuit).
   Cerveau : Google Gemini ou Groq, offre gratuite, clé gardée sur l'appareil.
   Briefing : fichier jarvis-briefing.json préparé chaque matin, lu en local (rien n'est envoyé au cerveau). */
(() => {
  "use strict";

  const $ = (s) => document.querySelector(s);
  const store = {
    get(k, d) { try { const v = localStorage.getItem("jarvis." + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem("jarvis." + k, JSON.stringify(v)); } catch {} },
  };

  const cfg = {
    fournisseur: store.get("fournisseur", "gemini"),
    cle: store.get("cle", ""),
    modele: store.get("modele", ""),
    voix: store.get("voix", ""),
    vitesse: store.get("vitesse", 1.05),
    hauteur: store.get("hauteur", 0.9),
    surnom: store.get("surnom", "Gaël"),
    continu: store.get("continu", false),
  };
  let historique = store.get("historique", []);
  let briefing = store.get("briefing", null);

  /* ---------- État visuel ---------- */
  const ETATS = { idle: "En veille", listening: "J'écoute", thinking: "Je réfléchis", speaking: "Je parle" };
  const TEXTES_NOYAU = { idle: "Parler", listening: "J'écoute", thinking: "…", speaking: "Couper" };
  let etat = "idle";
  function setEtat(e) {
    etat = e;
    document.body.dataset.state = e;
    $("#etatTexte").textContent = ETATS[e];
    $("#noyauTexte").textContent = TEXTES_NOYAU[e];
    $("#noyau").setAttribute("aria-label", e === "speaking" ? "Couper la parole à Jarvis" : e === "listening" ? "Arrêter l'écoute" : "Appuyer pour parler");
  }
  function consigne(t, erreur = false) {
    const c = $("#consigne");
    c.textContent = t;
    c.classList.toggle("erreur", erreur);
  }

  /* ---------- Horloge ---------- */
  const fmtHeure = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });
  const fmtDate = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Paris" });
  function tic() {
    const n = new Date();
    $("#heure").textContent = fmtHeure.format(n);
    $("#date").textContent = fmtDate.format(n);
  }
  tic(); setInterval(tic, 15000);

  /* ---------- Dessin du noyau ---------- */
  const NS = "http://www.w3.org/2000/svg";
  (function graduations() {
    const g = $("#graduations");
    for (let i = 0; i < 120; i++) {
      const a = (i / 120) * Math.PI * 2, maj = i % 10 === 0;
      const r1 = 188, r2 = maj ? 172 : 180;
      const l = document.createElementNS(NS, "line");
      l.setAttribute("x1", 200 + Math.cos(a) * r1); l.setAttribute("y1", 200 + Math.sin(a) * r1);
      l.setAttribute("x2", 200 + Math.cos(a) * r2); l.setAttribute("y2", 200 + Math.sin(a) * r2);
      if (maj) l.classList.add("majeure");
      g.appendChild(l);
    }
  })();
  const barres = [];
  (function onde() {
    const g = $("#onde"), n = 15, w = 5, gap = 4, total = n * w + (n - 1) * gap;
    for (let i = 0; i < n; i++) {
      const r = document.createElementNS(NS, "rect");
      r.setAttribute("x", 200 - total / 2 + i * (w + gap)); r.setAttribute("y", 165);
      r.setAttribute("width", w); r.setAttribute("height", 40);
      g.appendChild(r); barres.push(r);
    }
  })();
  let ondeTimer = null;
  function animerOnde(on) {
    clearInterval(ondeTimer);
    if (!on || matchMedia("(prefers-reduced-motion: reduce)").matches) { barres.forEach((b) => (b.style.transform = "")); return; }
    ondeTimer = setInterval(() => {
      barres.forEach((b, i) => {
        const centre = 1 - Math.abs(i - 7) / 9;
        b.style.transform = `scaleY(${(0.15 + Math.random() * 0.85 * centre).toFixed(2)})`;
      });
    }, 110);
  }
  document.addEventListener("visibilitychange", () => {
    document.querySelectorAll(".anneau, .courbes").forEach((el) => (el.style.animationPlayState = document.hidden ? "paused" : ""));
  });

  /* ---------- Fil de conversation ---------- */
  function ajouterMessage(qui, texte, erreur = false) {
    const li = document.createElement("li");
    li.className = "msg " + (qui === "vous" ? "msg-vous" : "msg-jarvis") + (erreur ? " msg-erreur" : "");
    const s = document.createElement("span"); s.className = "msg-qui"; s.textContent = qui === "vous" ? "Vous" : "Jarvis";
    const p = document.createElement("p"); p.textContent = texte.replace(/ ([:;?!»])/g, "\u00a0$1").replace(/« /g, "«\u00a0");
    li.append(s, p);
    $("#fil").appendChild(li);
    li.scrollIntoView({ block: "end", behavior: "smooth" });
  }
  function rejouerHistorique() {
    historique.slice(-20).forEach((m) => ajouterMessage(m.role === "user" ? "vous" : "jarvis", m.texte));
  }

  /* ---------- Voix de sortie ---------- */
  const synth = window.speechSynthesis;
  let voixDispo = [];
  function chargerVoix() {
    if (!synth) return;
    voixDispo = synth.getVoices().filter((v) => v.lang && v.lang.toLowerCase().startsWith("fr"));
    const sel = $("#voix"); sel.innerHTML = "";
    if (!voixDispo.length) { const o = document.createElement("option"); o.textContent = "Voix française par défaut"; o.value = ""; sel.appendChild(o); return; }
    // On met en tête les voix naturelles (en ligne) et masculines quand on les reconnaît
    const score = (v) => (/(natural|online|neural|premium|enhanced)/i.test(v.name) ? 2 : 0) + (/(henri|thomas|paul|claude|remy|rémy|daniel|male|homme)/i.test(v.name) ? 1 : 0) + (/google/i.test(v.name) ? 1 : 0);
    voixDispo.sort((a, b) => score(b) - score(a));
    voixDispo.forEach((v) => { const o = document.createElement("option"); o.value = v.name; o.textContent = `${v.name} (${v.lang})`; sel.appendChild(o); });
    if (cfg.voix && voixDispo.some((v) => v.name === cfg.voix)) sel.value = cfg.voix; else cfg.voix = voixDispo[0].name;
  }
  if (synth) { chargerVoix(); synth.onvoiceschanged = chargerVoix; }

  function nettoyerPourVoix(t) {
    return t.replace(/```[\s\S]*?```/g, " ").replace(/[*_#`>|]/g, "").replace(/\[(.*?)\]\(.*?\)/g, "$1").replace(/https?:\/\/\S+/g, "le lien").replace(/\s+/g, " ").trim();
  }
  function parler(texte) {
    return new Promise((resolve) => {
      if (!synth) return resolve();
      synth.cancel();
      const morceaux = nettoyerPourVoix(texte).match(/[^.!?…]+[.!?…]*\s*/g) || [texte];
      const voix = voixDispo.find((v) => v.name === cfg.voix);
      let i = 0;
      setEtat("speaking"); animerOnde(true);
      const fin = () => { animerOnde(false); if (etat === "speaking") setEtat("idle"); resolve(); };
      const suivant = () => {
        if (i >= morceaux.length || etat !== "speaking") return fin();
        const u = new SpeechSynthesisUtterance(morceaux[i++]);
        u.lang = voix ? voix.lang : "fr-FR"; if (voix) u.voice = voix;
        u.rate = cfg.vitesse; u.pitch = cfg.hauteur;
        u.onend = suivant; u.onerror = fin;
        synth.speak(u);
      };
      suivant();
    });
  }
  function taire() { if (synth) synth.cancel(); animerOnde(false); setEtat("idle"); }

  /* ---------- Voix d'entrée ---------- */
  const Reco = window.SpeechRecognition || window.webkitSpeechRecognition;
  let reco = null, entendu = "";
  function ecouter() {
    if (!Reco) { consigne("Ce navigateur ne sait pas écouter. Utilisez Chrome ou Edge, ou écrivez-moi ci-dessous.", true); return; }
    if (synth) synth.cancel();
    reco = new Reco();
    reco.lang = "fr-FR"; reco.interimResults = true; reco.continuous = false; reco.maxAlternatives = 1;
    entendu = "";
    reco.onstart = () => { setEtat("listening"); animerOnde(true); consigne("Je vous écoute…"); };
    reco.onresult = (e) => {
      let txt = "";
      for (let i = 0; i < e.results.length; i++) txt += e.results[i][0].transcript;
      entendu = txt.trim();
      consigne("« " + entendu + " »");
    };
    reco.onerror = (e) => {
      const msg = {
        "not-allowed": "Le micro est bloqué pour cette adresse. Cliquez sur l'icône à gauche de l'adresse, mettez Micro sur Autoriser, puis rechargez la page.",
        "service-not-allowed": "Ce navigateur refuse la reconnaissance vocale. Ouvrez Jarvis dans Chrome ou Edge, ou écrivez-moi ci-dessous.",
        "no-speech": "Je n'ai rien entendu. Touchez le cercle et parlez un peu plus fort.",
        "audio-capture": "Aucun micro trouvé sur cet appareil.",
        "network": "La reconnaissance vocale a besoin d'internet. Vérifiez la connexion.",
      }[e.error];
      if (msg) consigne(msg, true);
      if (e.error === "not-allowed" || e.error === "audio-capture") $("#modeConversation").checked = cfg.continu = false;
    };
    reco.onend = () => {
      animerOnde(false);
      reco = null;
      if (entendu) traiter(entendu);
      else if (etat === "listening") setEtat("idle");
    };
    try { reco.start(); } catch { /* déjà en cours */ }
  }
  function arreterEcoute() { if (reco) reco.stop(); }

  $("#noyau").addEventListener("click", () => {
    if (etat === "speaking") { taire(); ecouter(); return; }      // on coupe Jarvis et on reprend la main
    if (etat === "listening") { arreterEcoute(); return; }
    if (etat === "thinking") return;
    ecouter();
  });
  document.addEventListener("keydown", (e) => {
    if (e.code === "Space" && document.activeElement === document.body) { e.preventDefault(); $("#noyau").click(); }
    if (e.key === "Escape" && etat === "speaking") taire();
  });

  /* ---------- Compréhension ---------- */
  const norm = (t) => t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  function intentionLocale(t) {
    const n = norm(t);
    if (/^(stop|silence|tais[- ]toi|arrete|chut|ca suffit)\b/.test(n)) return "stop";
    if (/(ecri|redige|reponds|prepare|invente|propose)/.test(n)) return null; // demande de création : le cerveau s'en charge
    if (/(briefing|quoi de neuf|programme du jour|resume du jour|point du matin|fais (moi )?le point)/.test(n)) return "briefing";
    if (/(mail|courrier|boite)/.test(n) && /(lis|resume|quoi|combien|nouveau|important|urgent|recu|j'ai|ai-je|y a)/.test(n)) return "mails";
    if (/(post|publication|reseau|linkedin|facebook|buffer|fiche google)/.test(n) && /(quel|prochain|a venir|programme|prevu|cette semaine|demain|lis)/.test(n)) return "posts";
    if (/(quel(le)? heure|il est quelle heure)/.test(n)) return "heure";
    if (/(quel jour|on est le combien|quelle date|date du jour)/.test(n)) return "date";
    return null;
  }

  async function traiter(texte) {
    ajouterMessage("vous", texte);
    const intention = intentionLocale(texte);
    let reponse;
    if (intention === "stop") { taire(); consigne("D'accord, je me tais."); return; }
    if (intention) reponse = repondreLocal(intention);
    else {
      setEtat("thinking"); consigne("Je réfléchis…");
      try { reponse = await demanderAuCerveau(texte); }
      catch (err) {
        setEtat("idle");
        const m = err.message || "Je n'ai pas pu joindre mon cerveau.";
        ajouterMessage("jarvis", m, true); consigne(m, true);
        await parler(m);
        return;
      }
    }
    memoriser("user", texte); memoriser("model", reponse);
    ajouterMessage("jarvis", reponse);
    consigne(cfg.continu ? "Conversation continue : je réécoute après ma réponse." : "Touchez le cercle pour me répondre.");
    await parler(reponse);
    if (cfg.continu && etat === "idle") setTimeout(ecouter, 350);
  }
  function memoriser(role, texte) {
    historique.push({ role, texte });
    historique = historique.slice(-30);
    store.set("historique", historique);
  }

  function repondreLocal(intention) {
    const n = new Date();
    if (intention === "heure") return `Il est ${fmtHeure.format(n).replace(":", " h ")}.`;
    if (intention === "date") return `Nous sommes ${fmtDate.format(n)}.`;
    if (!briefing) return "Je n'ai pas encore de briefing pour aujourd'hui. Chargez le fichier du matin, ou reliez le dossier dans les réglages.";
    if (intention === "mails") return texteMails();
    if (intention === "posts") return textePosts();
    return texteBriefing();
  }

  /* ---------- Cerveau (Gemini ou Groq) ---------- */
  function consignesSysteme() {
    const n = new Date();
    return [
      `Tu es Jarvis, l'assistant personnel vocal de ${cfg.surnom || "Gaël"}, qui dirige Confluence Numérique, une micro-entreprise de création de sites internet, applications et communication pour les commerces et artisans du Lot-et-Garonne (secteur Damazan, Aiguillon).`,
      `Nous sommes le ${fmtDate.format(n)}, il est ${fmtHeure.format(n)} (heure de Paris).`,
      "Tu réponds en français, avec un ton posé, chaleureux et un brin d'humour discret, comme un majordome efficace. Tu le vouvoies.",
      "Tes réponses sont lues à voix haute : phrases courtes, pas de listes à puces, pas de markdown, pas d'émojis. Trois ou quatre phrases maximum, sauf si on te demande un texte long (un post, un mail) : dans ce cas tu l'écris en entier.",
      "Tu n'as pas accès aux mails, au calendrier ni aux réseaux sociaux. Si on te pose une question sur les mails ou les publications du jour, propose de dire « lis-moi le briefing ».",
      "Tu n'envoies et ne publies jamais rien toi-même. Si tu rédiges un mail ou un post, précise que c'est un brouillon à relire.",
      "Si tu ne sais pas, dis-le simplement plutôt que d'inventer.",
    ].join("\n");
  }

  async function demanderAuCerveau(question) {
    if (!cfg.cle) throw new Error("Il me manque ma clé pour réfléchir. Ouvrez les réglages, en haut à droite, et collez la clé gratuite.");
    if (!navigator.onLine) throw new Error("Je suis hors ligne. Je peux encore lire le briefing, mais pas discuter.");
    const passe = historique.slice(-12);
    return cfg.fournisseur === "groq" ? appelGroq(passe, question) : appelGemini(passe, question);
  }

  function erreurHttp(status, detail) {
    if (status === 429) return new Error("J'ai atteint mon quota gratuit pour le moment. Réessayez dans une minute, ou demain si c'est le quota du jour.");
    if (status === 400 || status === 401 || status === 403) return new Error("Ma clé est refusée. Vérifiez-la dans les réglages." + (detail ? " (" + detail + ")" : ""));
    if (status === 404) return new Error("Le modèle choisi n'existe plus. Videz le champ « Modèle » dans les réglages pour que je choisisse tout seul.");
    return new Error("Mon cerveau ne répond pas (erreur " + status + "). Réessayez dans un instant.");
  }

  async function modeleGemini() {
    if (cfg.modele) return cfg.modele;
    const memo = store.get("modeleAutoGemini", null);
    if (memo && Date.now() - memo.t < 7 * 864e5) return memo.m;
    const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=" + encodeURIComponent(cfg.cle));
    if (!r.ok) throw erreurHttp(r.status);
    const d = await r.json();
    const noms = (d.models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes("generateContent"))
      .map((m) => m.name.replace("models/", ""))
      .filter((n) => /^gemini-\d+(\.\d+)?-flash(-latest)?$/.test(n));
    noms.sort((a, b) => parseFloat(b.split("-")[1]) - parseFloat(a.split("-")[1]));
    const m = noms[0] || "gemini-flash-latest";
    store.set("modeleAutoGemini", { m, t: Date.now() });
    return m;
  }
  async function appelGemini(passe, question) {
    const modele = await modeleGemini();
    const contents = passe.map((m) => ({ role: m.role === "user" ? "user" : "model", parts: [{ text: m.texte }] }));
    contents.push({ role: "user", parts: [{ text: question }] });
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modele)}:generateContent?key=${encodeURIComponent(cfg.cle)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: consignesSysteme() }] }, contents, generationConfig: { temperature: 0.7, maxOutputTokens: 2048 } }),
    });
    if (!r.ok) { store.set("modeleAutoGemini", null); throw erreurHttp(r.status); }
    const d = await r.json();
    const t = (d.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("").trim();
    if (!t) throw new Error("Je n'ai pas trouvé quoi répondre. Pouvez-vous reformuler ?");
    return t;
  }

  async function modeleGroq() {
    if (cfg.modele) return cfg.modele;
    const memo = store.get("modeleAutoGroq", null);
    if (memo && Date.now() - memo.t < 7 * 864e5) return memo.m;
    let m = "llama-3.3-70b-versatile";
    try {
      const r = await fetch("https://api.groq.com/openai/v1/models", { headers: { Authorization: "Bearer " + cfg.cle } });
      if (r.ok) {
        const ids = ((await r.json()).data || []).map((x) => x.id);
        m = ["llama-3.3-70b-versatile", "openai/gpt-oss-120b", "openai/gpt-oss-20b"].find((x) => ids.includes(x)) || ids.find((x) => /llama|gpt-oss|qwen/.test(x)) || m;
      } else if ([401, 403].includes(r.status)) throw erreurHttp(r.status);
    } catch (e) { if (e.message.startsWith("Ma clé")) throw e; }
    store.set("modeleAutoGroq", { m, t: Date.now() });
    return m;
  }
  async function appelGroq(passe, question) {
    const modele = await modeleGroq();
    const messages = [{ role: "system", content: consignesSysteme() }]
      .concat(passe.map((m) => ({ role: m.role === "user" ? "user" : "assistant", content: m.texte })))
      .concat([{ role: "user", content: question }]);
    const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + cfg.cle },
      body: JSON.stringify({ model: modele, messages, temperature: 0.7, max_tokens: 1500 }),
    });
    if (!r.ok) { store.set("modeleAutoGroq", null); throw erreurHttp(r.status); }
    const d = await r.json();
    const t = (d.choices?.[0]?.message?.content || "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
    if (!t) throw new Error("Je n'ai pas trouvé quoi répondre. Pouvez-vous reformuler ?");
    return t;
  }

  /* ---------- Briefing ---------- */
  const fmtJourHeure = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });
  const fmtCourt = new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });
  const dateSure = (s) => { const d = new Date(s); return isNaN(d) ? null : d; };
  const pluriel = (n, s, p) => `${n} ${n > 1 ? (p || s + "s") : s}`;

  function valider(b) {
    if (!b || typeof b !== "object") throw new Error("Ce fichier n'est pas un briefing Jarvis.");
    if (!b.mails && !b.publications && !b.a_valider) throw new Error("Ce fichier ne contient ni mails, ni publications, ni éléments à valider.");
    return b;
  }

  function li(contenu) { const e = document.createElement("li"); contenu(e); return e; }
  function ligne(e, titre, droite, meta, classe) {
    if (classe) e.classList.add(classe);
    const t = document.createElement("div"); t.className = "ligne-titre";
    const s = document.createElement("strong"); s.textContent = titre; t.appendChild(s);
    if (droite != null) { const c = document.createElement("span"); c.className = "compte"; c.textContent = droite; t.appendChild(c); }
    e.appendChild(t);
    if (meta) { const m = document.createElement("span"); m.className = "ligne-meta"; m.textContent = meta; e.appendChild(m); }
  }
  function vide(ul, txt) { ul.innerHTML = ""; ul.appendChild(li((e) => { e.className = "vide"; e.textContent = txt; })); }

  function afficherBriefing() {
    const maj = $("#briefingMaj");
    if (!briefing) { maj.textContent = "Aucun briefing chargé"; return; }
    const g = dateSure(briefing.genere_le);
    maj.textContent = (briefing.exemple ? "Exemple fictif · " : "") + (g ? "Préparé " + fmtJourHeure.format(g) : "Date inconnue");
    maj.classList.toggle("demo", !!briefing.exemple);

    const m = briefing.mails || {};
    $("#mailsResume").textContent = m.resume || "Pas de résumé des mails.";
    const ulM = $("#mailsListe"); ulM.innerHTML = "";
    const cats = Array.isArray(m.categories) ? m.categories : [];
    cats.forEach((c) => {
      const urgents = (c.elements || []).filter((x) => x.urgent);
      ulM.appendChild(li((e) => ligne(e, c.nom || "Autres", c.nombre ?? (c.elements || []).length,
        (c.elements || []).slice(0, 3).map((x) => `${x.de || "?"} : ${x.objet || x.but || ""}`).join(" · "), urgents.length ? "urgent" : "")));
    });
    if (m.pubs_ecartees) ulM.appendChild(li((e) => ligne(e, "Pubs et newsletters écartées", m.pubs_ecartees, m.pubs_resume || "")));

    const ulP = $("#postsListe");
    const posts = (Array.isArray(briefing.publications) ? briefing.publications : []).slice().sort((a, b) => (dateSure(a.date) || 0) - (dateSure(b.date) || 0));
    if (!posts.length) vide(ulP, "Rien de prévu pour l'instant.");
    else { ulP.innerHTML = ""; posts.forEach((p) => ulP.appendChild(li((e) => {
      const d = dateSure(p.date);
      ligne(e, p.titre || "Publication", null, `${d ? fmtCourt.format(d) : "date à fixer"} · ${(p.reseaux || []).join(", ")} · ${p.statut || "brouillon"}`);
    }))); }

    const ulF = $("#faireListe");
    const av = Array.isArray(briefing.a_valider) ? briefing.a_valider : [];
    if (!av.length) vide(ulF, "Rien en attente.");
    else { ulF.innerHTML = ""; av.forEach((x) => ulF.appendChild(li((e) => ligne(e, typeof x === "string" ? x : x.titre || "", null, typeof x === "string" ? "" : x.detail || "")))); }
  }

  function texteMails() {
    const m = briefing.mails;
    if (!m) return "Le briefing ne contient pas de résumé des mails.";
    let t = m.resume ? m.resume + " " : "";
    (m.categories || []).forEach((c) => {
      const n = c.nombre ?? (c.elements || []).length;
      if (!n) return;
      t += `${c.nom} : ${pluriel(n, "mail")}. `;
      (c.elements || []).filter((x) => x.urgent).forEach((x) => (t += `Urgent, de ${x.de} : ${x.objet}. `));
    });
    if (m.pubs_ecartees) t += `J'ai écarté ${pluriel(m.pubs_ecartees, "pub ou newsletter", "pubs et newsletters")}.`;
    return t.trim() || "Rien de particulier dans les mails.";
  }
  function textePosts() {
    const posts = (briefing.publications || []).filter((p) => !dateSure(p.date) || dateSure(p.date) > new Date() - 864e5);
    if (!posts.length) return "Aucune publication prévue pour l'instant.";
    return `${pluriel(posts.length, "publication prévue", "publications prévues")}. ` + posts.slice(0, 4).map((p) => {
      const d = dateSure(p.date);
      return `${d ? fmtJourHeure.format(d).replace(":", " h ") : "Date à fixer"}, sur ${(p.reseaux || []).join(" et ") || "les réseaux"} : ${p.titre}${p.statut === "brouillon" ? ", encore à valider" : ""}.`;
    }).join(" ");
  }
  function texteBriefing() {
    const h = Number(new Intl.DateTimeFormat("fr-FR", { hour: "numeric", hourCycle: "h23", timeZone: "Europe/Paris" }).format(new Date()));
    const salut = h < 18 ? "Bonjour" : "Bonsoir";
    let t = `${salut} ${cfg.surnom || "Gaël"}. `;
    if (briefing.exemple) t += "Attention, ceci est un briefing d'exemple, les données sont fictives. ";
    t += texteMails() + " " + textePosts();
    const av = briefing.a_valider || [];
    if (av.length) t += ` Vous avez ${pluriel(av.length, "chose", "choses")} à valider.`;
    return t;
  }

  function nouveauBriefing(b, source) {
    briefing = valider(b);
    store.set("briefing", briefing);
    afficherBriefing();
    if (source) consigne("Briefing chargé " + source + ".");
  }

  $("#lireBriefing").addEventListener("click", async () => {
    const t = briefing ? texteBriefing() : repondreLocal("briefing");
    ajouterMessage("jarvis", t);
    await parler(t);
  });
  $("#chargerBriefing").addEventListener("click", () => $("#fichierBriefing").click());
  $("#fichierBriefing").addEventListener("change", async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try { nouveauBriefing(JSON.parse(await f.text()), "depuis le fichier"); }
    catch (err) { consigne(err.message.startsWith("Ce fichier") ? err.message : "Ce fichier est illisible. Il faut le fichier jarvis-briefing.json.", true); }
    e.target.value = "";
  });

  /* Dossier relié (ordinateur, Chrome ou Edge) : la poignée est gardée dans IndexedDB */
  const idb = {
    ouvrir: () => new Promise((ok, ko) => { const r = indexedDB.open("jarvis", 1); r.onupgradeneeded = () => r.result.createObjectStore("kv"); r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error); }),
    async get(k) { const db = await this.ouvrir(); return new Promise((ok) => { const q = db.transaction("kv").objectStore("kv").get(k); q.onsuccess = () => ok(q.result); q.onerror = () => ok(null); }); },
    async set(k, v) { const db = await this.ouvrir(); return new Promise((ok) => { const t = db.transaction("kv", "readwrite"); t.objectStore("kv").put(v, k); t.oncomplete = ok; }); },
  };
  async function lireDossier(dossier, demander) {
    const perm = await dossier.queryPermission({ mode: "read" });
    if (perm !== "granted") {
      if (!demander) { $("#retourDossier").textContent = "Touchez « Relier un dossier » pour autoriser la lecture."; return; }
      if ((await dossier.requestPermission({ mode: "read" })) !== "granted") return;
    }
    try {
      const fh = await dossier.getFileHandle("jarvis-briefing.json");
      nouveauBriefing(JSON.parse(await (await fh.getFile()).text()), "depuis le dossier « " + dossier.name + " »");
      $("#retourDossier").textContent = "Relié à « " + dossier.name + " »"; $("#retourDossier").className = "retour ok";
    } catch {
      $("#retourDossier").textContent = "Pas de fichier jarvis-briefing.json dans « " + dossier.name + " »."; $("#retourDossier").className = "retour ko";
    }
  }
  if (window.showDirectoryPicker) {
    $("#relierDossier").addEventListener("click", async () => {
      try {
        let d = await idb.get("dossier");
        if (d && (await d.queryPermission({ mode: "read" })) !== "granted") return lireDossier(d, true);
        d = await window.showDirectoryPicker({ id: "jarvis-briefing", mode: "read" });
        await idb.set("dossier", d);
        await lireDossier(d, true);
      } catch (e) { if (e.name !== "AbortError") consigne("Impossible de relier ce dossier.", true); }
    });
    idb.get("dossier").then((d) => d && lireDossier(d, false)).catch(() => {});
  } else {
    $("#zoneDossier").hidden = true;
  }

  async function briefingParDefaut() {
    if (briefing) return afficherBriefing();
    try { const r = await fetch("briefing-exemple.json"); if (r.ok) { briefing = await r.json(); afficherBriefing(); } } catch {}
  }

  /* ---------- Réglages ---------- */
  const dlg = $("#reglages");
  const virgule = (v) => String(v).replace(".", ",");
  function remplirReglages() {
    document.querySelector(`input[name="fournisseur"][value="${cfg.fournisseur}"]`).checked = true;
    $("#cle").value = cfg.cle; $("#modele").value = cfg.modele; $("#surnom").value = cfg.surnom;
    $("#vitesse").value = cfg.vitesse; $("#vitesseVal").textContent = virgule(cfg.vitesse);
    $("#hauteur").value = cfg.hauteur; $("#hauteurVal").textContent = virgule(cfg.hauteur);
    $("#cle").placeholder = cfg.fournisseur === "groq" ? "Clé Groq (commence par gsk_)" : "Clé Google AI Studio (commence par AIza)";
    $("#retourCle").textContent = "";
  }
  function enregistrer() {
    const ancien = cfg.fournisseur + cfg.cle;
    cfg.fournisseur = document.querySelector('input[name="fournisseur"]:checked').value;
    cfg.cle = $("#cle").value.trim(); cfg.modele = $("#modele").value.trim();
    cfg.surnom = $("#surnom").value.trim() || "Gaël";
    cfg.vitesse = parseFloat($("#vitesse").value); cfg.hauteur = parseFloat($("#hauteur").value);
    cfg.voix = $("#voix").value;
    if (ancien !== cfg.fournisseur + cfg.cle) { store.set("modeleAutoGemini", null); store.set("modeleAutoGroq", null); }
    ["fournisseur", "cle", "modele", "surnom", "vitesse", "hauteur", "voix"].forEach((k) => store.set(k, cfg[k]));
  }
  $("#ouvrirReglages").addEventListener("click", () => { remplirReglages(); dlg.showModal(); });
  dlg.addEventListener("close", enregistrer);
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
  document.querySelectorAll('input[name="fournisseur"]').forEach((r) => r.addEventListener("change", () => { cfg.fournisseur = r.value; $("#cle").placeholder = r.value === "groq" ? "Clé Groq (commence par gsk_)" : "Clé Google AI Studio (commence par AIza)"; }));
  $("#vitesse").addEventListener("input", (e) => ($("#vitesseVal").textContent = virgule(e.target.value)));
  $("#hauteur").addEventListener("input", (e) => ($("#hauteurVal").textContent = virgule(e.target.value)));
  $("#essayerVoix").addEventListener("click", () => { enregistrer(); parler(`Bonjour ${cfg.surnom}. Tous les systèmes sont opérationnels.`); });
  $("#testerCle").addEventListener("click", async () => {
    enregistrer();
    const out = $("#retourCle"); out.className = "retour"; out.textContent = "Test en cours…";
    $("#testerCle").disabled = true;
    try {
      const t = await demanderAuCerveau("Réponds seulement : prêt.");
      out.textContent = "Ça marche. Réponse : " + t.slice(0, 60); out.className = "retour ok";
    } catch (e) { out.textContent = e.message; out.className = "retour ko"; }
    $("#testerCle").disabled = false;
  });
  $("#effacerConv").addEventListener("click", () => { historique = []; store.set("historique", []); $("#fil").innerHTML = ""; });

  $("#modeConversation").checked = cfg.continu;
  $("#modeConversation").addEventListener("change", (e) => { cfg.continu = e.target.checked; store.set("continu", cfg.continu); });

  $("#saisie").addEventListener("submit", (e) => {
    e.preventDefault();
    const v = $("#champ").value.trim(); if (!v || etat === "thinking") return;
    $("#champ").value = ""; traiter(v);
  });

  /* ---------- Démarrage ---------- */
  rejouerHistorique();
  briefingParDefaut();
  if (!Reco) consigne("Ce navigateur ne sait pas écouter. Écrivez-moi ci-dessous, ou ouvrez Jarvis dans Chrome ou Edge.");
  else if (!cfg.cle) consigne("Touchez le cercle et parlez. Pour discuter librement, ajoutez d'abord la clé dans les réglages.");
  if ("serviceWorker" in navigator && location.protocol !== "file:") navigator.serviceWorker.register("sw.js").catch(() => {});
})();
