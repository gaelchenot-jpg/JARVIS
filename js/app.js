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

  /* Coffre de secours : la clé et le code du briefing sont aussi gardés dans IndexedDB,
     et on demande au navigateur de ne pas purger le stockage de Jarvis. */
  const SECRETS = ["fournisseur", "cle", "modele", "codeBriefing"];
  function coffre(mode, fn) {
    return new Promise((ok) => {
      try {
        const r = indexedDB.open("jarvis-coffre", 1);
        r.onupgradeneeded = () => r.result.createObjectStore("reglages");
        r.onerror = () => ok(null);
        r.onsuccess = () => { try { const t = r.result.transaction("reglages", mode); const req = fn(t.objectStore("reglages")); t.oncomplete = () => ok(req && req.result); t.onerror = () => ok(null); } catch { ok(null); } };
      } catch { ok(null); }
    });
  }
  function sauverCoffre() { const o = {}; SECRETS.forEach((k) => (o[k] = store.get(k, ""))); if (o.cle || o.codeBriefing) coffre("readwrite", (s) => s.put(o, "secrets")); }
  try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch {}

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
      const r1 = 194, r2 = maj ? 180 : 187;
      const l = document.createElementNS(NS, "line");
      l.setAttribute("x1", 200 + Math.cos(a) * r1); l.setAttribute("y1", 200 + Math.sin(a) * r1);
      l.setAttribute("x2", 200 + Math.cos(a) * r2); l.setAttribute("y2", 200 + Math.sin(a) * r2);
      if (maj) l.classList.add("majeure");
      g.appendChild(l);
    }
  })();
  /* Couronne de secteurs étiquetés, cellules lumineuses et hexagone du cœur */
  const pt = (r, a) => [200 + Math.cos(a) * r, 200 + Math.sin(a) * r];
  const secteurs = [], etiquettes = {};
  (function couronne() {
    const g = $("#couronne"), n = 12, r1 = 155, r2 = 181, ecart = 0.035;
    const noms = ["AGENDA", "MAILS", "POSTS", "ACTU", "BRIEFING", "VOIX", "MÉMOIRE", "RÉSEAU", "WEB", "SYSTÈME", "CERVEAU", "VEILLE"];
    const defs = document.querySelector(".noyau svg defs");
    for (let i = 0; i < n; i++) {
      const a1 = -Math.PI / 2 + (i / n) * Math.PI * 2 + ecart, a2 = -Math.PI / 2 + ((i + 1) / n) * Math.PI * 2 - ecart;
      const [x1, y1] = pt(r2, a1), [x2, y2] = pt(r2, a2), [x3, y3] = pt(r1, a2), [x4, y4] = pt(r1, a1);
      const seg = document.createElementNS(NS, "path");
      seg.setAttribute("d", `M${x1} ${y1} A${r2} ${r2} 0 0 1 ${x2} ${y2} L${x3} ${y3} A${r1} ${r1} 0 0 0 ${x4} ${y4} Z`);
      seg.setAttribute("class", "secteur"); g.appendChild(seg); secteurs.push(seg);
      // texte toujours lisible : sens horaire en haut, antihoraire en bas
      const milieu = (a1 + a2) / 2, bas = Math.sin(milieu) > 0.05;
      const rt = bas ? 171 : 164, id = "arcTxt" + i;
      const [sx, sy] = pt(rt, bas ? a2 : a1), [ex, ey] = pt(rt, bas ? a1 : a2);
      const chemin = document.createElementNS(NS, "path"); chemin.setAttribute("id", id);
      chemin.setAttribute("d", `M${sx} ${sy} A${rt} ${rt} 0 0 ${bas ? 0 : 1} ${ex} ${ey}`); defs.appendChild(chemin);
      const t = document.createElementNS(NS, "text"); t.setAttribute("class", "secteur-txt");
      const tp = document.createElementNS(NS, "textPath"); tp.setAttribute("href", "#" + id); tp.setAttribute("startOffset", "50%"); tp.setAttribute("text-anchor", "middle");
      tp.textContent = noms[i]; t.appendChild(tp); g.appendChild(t);
      etiquettes[noms[i]] = { seg, t };
    }
    // un secteur s'allume tour à tour, comme un balayage de contrôle
    let k = 0;
    const vitesse = () => ({ listening: 140, thinking: 90, speaking: 220 }[document.body.dataset.state] || 650);
    (function balayer() {
      if (!document.hidden && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
        secteurs.forEach((s, i) => s.classList.toggle("allume", i === k % n || (document.body.dataset.state === "thinking" && i === (k + 6) % n)));
        k++;
      }
      setTimeout(balayer, vitesse());
    })();
    const c = $("#cellules");
    for (let i = 0; i < 24; i++) {
      const a1 = (i / 24) * Math.PI * 2 + 0.05, a2 = ((i + 1) / 24) * Math.PI * 2 - 0.05;
      const [x1, y1] = pt(124, a1), [x2, y2] = pt(124, a2), [x3, y3] = pt(98, a2), [x4, y4] = pt(98, a1);
      const cel = document.createElementNS(NS, "path");
      cel.setAttribute("d", `M${x1} ${y1} A124 124 0 0 1 ${x2} ${y2} L${x3} ${y3} A98 98 0 0 0 ${x4} ${y4} Z`);
      cel.setAttribute("class", "cellule" + (i % 6 === 0 ? " cellule-vive" : "")); c.appendChild(cel);
      // bobinage : petits traits en travers de chaque cellule
      for (const rr of [104, 111, 118]) {
        const [bx1, by1] = pt(rr, a1 + 0.02), [bx2, by2] = pt(rr, a2 - 0.02);
        const l = document.createElementNS(NS, "line");
        l.setAttribute("x1", bx1); l.setAttribute("y1", by1); l.setAttribute("x2", bx2); l.setAttribute("y2", by2);
        l.setAttribute("class", "bobine"); c.appendChild(l);
      }
    }
    const hexa = (r, rot) => Array.from({ length: 6 }, (_, i) => pt(r, rot + (i * Math.PI) / 3).map((v) => v.toFixed(1)).join(",")).join(" ");
    document.querySelector(".hexa").setAttribute("points", hexa(62, Math.PI / 6));
    document.querySelector(".hexa-interne").setAttribute("points", hexa(52, Math.PI / 6));
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
    document.querySelectorAll(".anneau, .fond-cercles").forEach((el) => (el.style.animationPlayState = document.hidden ? "paused" : ""));
  });

  /* ---------- Fil de conversation ---------- */
  function ajouterMessage(qui, texte, erreur = false, defiler = true) {
    const li = document.createElement("li");
    li.className = "msg " + (qui === "vous" ? "msg-vous" : "msg-jarvis") + (erreur ? " msg-erreur" : "");
    const s = document.createElement("span"); s.className = "msg-qui"; s.textContent = qui === "vous" ? "Vous" : "Jarvis";
    const p = document.createElement("p"); p.textContent = texte.replace(/ ([:;?!»])/g, "\u00a0$1").replace(/« /g, "«\u00a0");
    li.append(s, p);
    $("#fil").appendChild(li);
    const fil = $("#fil");
    if (fil.scrollHeight > fil.clientHeight) fil.scrollTop = fil.scrollHeight;   // le fil défile à l'intérieur de son panneau
    if (defiler) li.scrollIntoView({ block: "nearest", behavior: "smooth" });
    return p;
  }
  const typo = (t) => t.replace(/ ([:;?!»])/g, "\u00a0$1").replace(/« /g, "«\u00a0");
  function rejouerHistorique() {
    historique.slice(-20).forEach((m) => ajouterMessage(m.role === "user" ? "vous" : "jarvis", m.texte, false, false));
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
  /* Diseur : une file de phrases. On peut lui en ajouter pendant qu'il parle,
     ce qui permet de commencer à parler avant d'avoir toute la réponse. */
  function creerDiseur() {
    let file = [], fini = false, actif = false, clos = false, resoudre;
    const promesse = new Promise((r) => (resoudre = r));
    const voix = voixDispo.find((v) => v.name === cfg.voix);
    const fin = () => { if (clos) return; clos = true; animerOnde(false); if (etat === "speaking") setEtat("idle"); resoudre(); };
    const suivant = () => {
      if (clos) return;
      if (etat !== "speaking") return fin();              // on lui a coupé la parole
      if (!file.length) { actif = false; if (fini) fin(); return; }
      actif = true;
      const u = new SpeechSynthesisUtterance(file.shift());
      u.lang = voix ? voix.lang : "fr-FR"; if (voix) u.voice = voix;
      u.rate = cfg.vitesse; u.pitch = cfg.hauteur;
      u.onend = suivant; u.onerror = () => { actif = false; suivant(); };
      synth.speak(u);
    };
    return {
      promesse,
      ajouter(t) {
        const propre = nettoyerPourVoix(t); if (!propre || clos) return;
        if (!synth) return;
        if (etat !== "speaking") { if (file.length || actif) return; setEtat("speaking"); animerOnde(true); }
        file.push(propre); if (!actif) suivant();
      },
      terminer() { fini = true; if (!synth || !actif) { if (!file.length) fin(); } return promesse; },
    };
  }
  function parler(texte) {
    if (!synth) return Promise.resolve();
    synth.cancel();
    const d = creerDiseur();
    (texte.match(/[^.!?…]+[.!?…]*\s*/g) || [texte]).forEach((m) => d.ajouter(m));
    return d.terminer();
  }
  let appelEnCours = null;
  function taire() { if (appelEnCours) { appelEnCours.abort(); appelEnCours = null; } if (synth) synth.cancel(); animerOnde(false); setEtat("idle"); }

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
    if (/(ajoute|inscri|note|mets|met |cale|programme|planifie|enregistre|cree|prevois|bloque|reserve)/.test(n) && /(agenda|calendrier|rendez[- ]vous|\brdv\b|reunion|rappel|evenement|creneau|planning)/.test(n)) return "ajout-agenda";
    if (/^(retiens|souviens[- ]toi|n.oublie pas|memorise|note)\b/.test(n)) return "retenir";
    if (/(qu.est[- ]ce que tu sais (sur|de) moi|que sais[- ]tu (sur|de) moi|tu te souviens de quoi|ta memoire)/.test(n)) return "memoire";
    if (/(ecri|redige|reponds|prepare|invente|propose)/.test(n)) return null; // demande de création : le cerveau s'en charge
    if (/(actu(alite)?s? (de l.)?(ia|intelligence)|actu(alite)?s? du jour|nouveau(x)? skills?|news (de l.)?ia|quoi de neuf (en|dans l.|cote) ?ia)/.test(n)) return "actu-ia";
    if (/(programme (du jour|d.aujourd.hui|de la journee)|qu.est[- ]ce que j.ai (de prevu|au programme) aujourd|ma journee)/.test(n)) return "programme";
    if (/(briefing|quoi de neuf|programme du jour|resume du jour|point du matin|fais (moi )?le point)/.test(n)) return "briefing";
    if (/(mail|courrier|boite)/.test(n) && /(lis|resume|quoi|combien|nouveau|important|urgent|recu|j'ai|ai-je|y a)/.test(n)) return "mails";
    if (/(post|publication|reseau|linkedin|facebook|buffer|fiche google)/.test(n) && /(quel|prochain|a venir|programme|prevu|cette semaine|demain|lis)/.test(n)) return "posts";
    if (/(agenda|rendez[- ]vous|\brdv\b|planning|emploi du temps|suis[- ]je libre|qu.est[- ]ce que j.ai (de prevu|aujourd|demain|cette semaine)|j.ai quoi (aujourd|demain|cette semaine))/.test(n)) return /demain/.test(n) ? "agenda-demain" : /semaine/.test(n) ? "agenda-semaine" : "agenda";
    if (/(quel(le)? heure|il est quelle heure)/.test(n)) return "heure";
    if (/(quel jour|on est le combien|quelle date|date du jour)/.test(n)) return "date";
    return null;
  }

  async function traiter(texte, piece) {
    const pVous = ajouterMessage("vous", texte);
    if (piece) { const im = document.createElement("img"); im.className = "msg-vignette"; im.alt = piece.video ? "Vidéo envoyée" : "Photo envoyée"; im.src = piece.vignette; pVous.before(im); }
    const intention = piece ? null : intentionLocale(texte);
    if (intention === "stop") { taire(); consigne("D'accord, je me tais."); return; }
    if (intention === "retenir") {
      const fait = texte.replace(/^\s*(retiens|souviens[- ]toi|n.oublie pas|mémorise|memorise|note)\s*(bien\s*)?(que|de|qu')?\s*/i, "");
      const ok = memoriserFait(fait.charAt(0).toUpperCase() + fait.slice(1));
      const rep = ok ? "C'est noté, je m'en souviendrai." : "Je le savais déjà.";
      ajouterMessage("jarvis", rep); await parler(rep); return;
    }
    if (intention === "ajout-agenda") { await ajouterAuAgenda(texte); return; }
    if (intention === "memoire") {
      const rep = memoire.length ? "Voici ce que j'ai retenu. " + memoire.join(". ") + "." : "Je n'ai encore rien retenu de particulier.";
      ajouterMessage("jarvis", rep); await parler(rep); return;
    }
    const suite = cfg.continu ? "Conversation continue : je réécoute après ma réponse." : "Touchez le cercle pour me répondre.";
    let reponse;
    if (intention) {
      reponse = repondreLocal(intention);
      ajouterMessage("jarvis", reponse); consigne(suite);
      memoriser("user", texte); memoriser("model", reponse);
      await parler(reponse);
    } else {
      setEtat("thinking"); consigne("Je réfléchis…");
      if (synth) synth.cancel();
      const diseur = creerDiseur();
      let p = null, recu = "", dit = 0;
      const surMorceau = (delta) => {
        recu += delta;
        if (!p) { p = ajouterMessage("jarvis", ""); consigne(suite); }
        p.textContent = typo(recu);
        p.parentNode.scrollIntoView({ block: "end" });
        // on envoie à la voix chaque phrase terminée, sans attendre la suite
        const re = /[^.!?…\n]*[.!?…\n]+(?=\s|$)/g; re.lastIndex = dit; let m;
        while ((m = re.exec(recu))) { if (m[0].trim().length > 1) diseur.ajouter(m[0]); dit = re.lastIndex; }
      };
      try { reponse = await demanderAuCerveau(texte, surMorceau, piece ? { piece, sansWeb: true } : {}); }
      catch (err) {
        if (err.name === "AbortError") { if (recu) { memoriser("user", texte); memoriser("model", recu); } return; }
        setEtat("idle");
        const m = err.message || "Je n'ai pas pu joindre mon cerveau.";
        if (p) p.parentNode.remove();
        ajouterMessage("jarvis", m, true); consigne(m, true);
        await parler(m);
        return;
      }
      if (!p) surMorceau(reponse);
      if (recu.slice(dit).trim()) diseur.ajouter(recu.slice(dit));
      memoriser("user", (piece ? (piece.video ? "[vidéo envoyée] " : "[photo envoyée] ") : "") + texte); memoriser("model", reponse);
      if (etat === "thinking") setEtat("idle");
      await diseur.terminer();
    }
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
    if (intention.startsWith("agenda")) return texteAgenda(intention);
    if (intention === "actu-ia") return texteActu();
    if (intention === "programme") return texteProgramme();
    return texteBriefing();
  }

  /* ---------- Cerveau (Gemini ou Groq) ---------- */
  function consignesSysteme() {
    const n = new Date();
    const mem = (typeof memoire !== "undefined" && memoire.length) ? "Ce que tu as retenu de vos échanges précédents :\n" + memoire.map((x) => "- " + x).join("\n") : "";
    return [mem,
      `Tu es Jarvis, l'assistant personnel vocal de ${cfg.surnom || "Gaël"}, qui dirige Confluence Numérique, une micro-entreprise de création de sites internet, applications et communication pour les commerces et artisans du Lot-et-Garonne (secteur Damazan, Aiguillon).`,
      `Nous sommes le ${fmtDate.format(n)}, il est ${fmtHeure.format(n)} (heure de Paris).`,
      "Tu réponds en français, avec un ton posé, chaleureux et un brin d'humour discret, comme un majordome efficace. Tu le vouvoies.",
      "Tes réponses sont lues à voix haute : phrases courtes, pas de listes à puces, pas de markdown, pas d'émojis. Trois ou quatre phrases maximum, sauf si on te demande un texte long (un post, un mail) : dans ce cas tu l'écris en entier.",
      "Fiabilité avant tout : Gaël veut des réponses sûres. Pour tout fait qui peut changer ou que tu ne connais pas avec certitude (actualité, chiffres, prix, dates, lois, démarches, règles fiscales ou sociales, horaires, personnes, entreprises), appuie-toi sur une recherche internet et cite en quelques mots ta source (le nom du site, sans lire d'adresse web). Privilégie les sources officielles ou reconnues (service-public.fr, impots.gouv.fr, urssaf.fr, sites des organismes, grands médias).",
      "N'invente jamais un chiffre, une date, un nom, un prix, une loi ou une citation. Si les sources se contredisent, dis-le. Si tu n'as pas pu vérifier, dis clairement « je n'ai pas pu le vérifier » et donne seulement ce dont tu es sûr. Sépare ce qui vient d'une source de ce qui est ton avis.",
      "Tu n'as pas accès directement aux mails, au calendrier ni aux réseaux sociaux. Si on te pose une question sur les mails, l'agenda ou les publications du jour, propose de dire « lis-moi le briefing ». Pour ajouter un rendez-vous, il suffit de dire par exemple « ajoute à l'agenda dentiste mardi à 14 h ».",
      "Gaël peut t'envoyer des photos ou des vidéos (sous forme d'images extraites) : décris ce que tu vois concrètement et réponds à sa question.",
      "Tu n'envoies et ne publies jamais rien toi-même. Si tu rédiges un mail ou un post, précise que c'est un brouillon à relire.",
      "Si tu ne sais pas, dis-le simplement plutôt que d'inventer. Mieux vaut une réponse courte et sûre qu'une réponse complète et douteuse.",
    ].filter(Boolean).join("\n");
  }

  /* Faut-il chercher sur internet ? (actualité, météo, prix, horaires, « cherche »…) */
  function besoinWeb(q) {
    const n = norm(q);
    // Question factuelle (qui, quand, combien, quel…) qui n'est pas une demande de rédaction : on vérifie sur internet
    const redaction = /^(redige|ecris|ecrit|fais|fait|propose|traduis|resume|corrige|reformule|lis|lit|ajoute|raconte|invente|imagine|aide.moi a (ecrire|rediger))\b/.test(n);
    if (!redaction && /(^|\b)(qui|quand|combien|quel|quelle|quels|quelles|ou se|ou est|est.ce que|c.est quoi|qu.est.ce que|que dit|comment fonctionne|comment faire pour|a quoi sert|pourquoi|loi|obligatoire|legal|droit|taxe|tva|urssaf|impot|aide|subvention|statut|chiffre|statistique|population|date)\b/.test(n)) return true;
    return /(cherche|recherche|internet|sur le web|sur google|actu|news|nouvelles|meteo|temps qu.il fait|il va pleuvoir|aujourd.hui|ce soir|demain|cette semaine|en ce moment|actuellement|derni[e]?r|recent|prix|combien coute|tarif|cours d|horaire|ouvert|ferme|adresse|telephone|numero de|resultat|score|qui a gagne|match|sortie|evenement|agenda|elections?|20[2-3]\d)/.test(n);
  }
  async function demanderAuCerveau(question, surMorceau, options = {}) {
    if (!cfg.cle) throw new Error("Il me manque ma clé pour réfléchir. Ouvrez les réglages, en haut à droite, et collez la clé gratuite.");
    if (!navigator.onLine) throw new Error("Je suis hors ligne. Je peux encore lire le briefing, mais pas discuter.");
    const passe = options.sansHistorique ? [] : historique.slice(-12);
    const ctrl = new AbortController(); appelEnCours = ctrl;
    // Garde-fou : si rien n'arrive en 25 secondes, on abandonne avec un message clair
    let premier = false, tropLong = false;
    const minuteur = setTimeout(() => { if (!premier) { tropLong = true; ctrl.abort(); } }, 40000);
    const morceau = surMorceau ? (t) => { premier = true; surMorceau(t); } : () => { premier = true; };
    const web = !options.sansWeb && besoinWeb(question);
    if (web && etat === "thinking") consigne("Je cherche sur internet…");
    if (options.piece && etat === "thinking") consigne(options.piece.video ? "Je regarde la vidéo…" : "Je regarde la photo…");
    try { return await (cfg.fournisseur === "groq" ? appelGroq(passe, question, morceau, ctrl.signal, web, options.piece) : appelGemini(passe, question, morceau, ctrl.signal, web, options.piece)); }
    catch (e) {
      if (tropLong) throw new Error("Google met trop de temps à répondre. Vérifiez la connexion, puis réessayez.");
      throw e;
    }
    finally { clearTimeout(minuteur); if (appelEnCours === ctrl) appelEnCours = null; }
  }

  function erreurHttp(status, detail) {
    if (status === 429) return new Error("J'ai atteint mon quota gratuit pour le moment. Réessayez dans une minute, ou demain si c'est le quota du jour.");
    if (status === 400 || status === 401 || status === 403) return new Error("Ma clé est refusée. Vérifiez-la dans les réglages." + (detail ? " (" + detail + ")" : ""));
    if (status === 404) return new Error("Le modèle choisi n'existe plus. Videz le champ « Modèle » dans les réglages pour que je choisisse tout seul.");
    return new Error("Mon cerveau ne répond pas (erreur " + status + "). Réessayez dans un instant.");
  }

  /* Liste ordonnée des modèles Gemini à essayer : les « flash » du plus récent au plus ancien,
     puis les « flash-lite ». Si l'un est saturé (503) ou hors quota (429), on passe au suivant. */
  async function modelesGemini() {
    if (cfg.modele) return [cfg.modele];
    const memo = store.get("modelesAutoGemini2", null);
    if (memo && Array.isArray(memo.l) && memo.l.length && Date.now() - memo.t < 3 * 864e5) return memo.l;
    let r;
    try { r = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=" + encodeURIComponent(cfg.cle), { signal: AbortSignal.timeout ? AbortSignal.timeout(15000) : undefined }); }
    catch { throw new Error("Je n'arrive pas à joindre Google. Vérifiez la connexion internet, puis réessayez."); }
    if (!r.ok) throw erreurHttp(r.status);
    const d = await r.json();
    const noms = (d.models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes("generateContent"))
      .map((m) => m.name.replace("models/", ""));
    const version = (n) => parseFloat(n.split("-")[1]) || 0;
    const tri = (re) => noms.filter((n) => re.test(n)).sort((a, b) => version(b) - version(a));
    const l = [...tri(/^gemini-\d+(\.\d+)?-flash-lite$/), ...tri(/^gemini-\d+(\.\d+)?-flash$/)]; // le plus rapide d'abord
    ["gemini-flash-lite-latest", "gemini-flash-latest"].forEach((n) => { if (noms.includes(n) || !l.length) l.push(n); });
    store.set("modelesAutoGemini2", { l, t: Date.now() });
    return l;
  }
  async function lireFlux(r, extraire, surMorceau) {
    const lecteur = r.body.getReader(), dec = new TextDecoder();
    let tampon = "", tout = "";
    for (;;) {
      const { value, done } = await lecteur.read();
      if (done) break;
      tampon += dec.decode(value, { stream: true });
      const lignes = tampon.split("\n"); tampon = lignes.pop();
      for (const l of lignes) {
        if (!l.startsWith("data:")) continue;
        const brut = l.slice(5).trim(); if (!brut || brut === "[DONE]") continue;
        let t = ""; try { t = extraire(JSON.parse(brut)) || ""; } catch {}
        if (t) { tout += t; if (surMorceau) surMorceau(t); }
      }
    }
    return tout.trim();
  }
  async function appelGemini(passe, question, surMorceau, signal, web, piece) {
    const liste = await modelesGemini();
    const contents = passe.map((m) => ({ role: m.role === "user" ? "user" : "model", parts: [{ text: m.texte }] }));
    const parts = [{ text: question }];
    if (piece) {
      if (piece.video && piece.videoB64) parts.push({ inline_data: { mime_type: piece.videoMime, data: piece.videoB64 } });
      else piece.images.forEach((u) => parts.push({ inline_data: { mime_type: "image/jpeg", data: u.split(",")[1] } }));
    }
    contents.push({ role: "user", parts });
    const sansReglage = store.get("geminiSansReglage", {});
    const corps = (modele) => {
      const generationConfig = { temperature: web ? 0.3 : 0.6, maxOutputTokens: 2048 };
      // Réponse immédiate : on coupe la « réflexion » préalable quand le modèle l'accepte
      if (!sansReglage[modele]) generationConfig.thinkingConfig = parseFloat(modele.split("-")[1]) >= 3 ? { thinkingLevel: "minimal" } : { thinkingBudget: 0 };
      const corps = { systemInstruction: { parts: [{ text: consignesSysteme() }] }, contents, generationConfig };
      if (web && !sansWeb) corps.tools = [{ google_search: {} }];   // recherche Google intégrée (gratuite, avec quota)
      return JSON.stringify(corps);
    };
    let sansWeb = false;
    const appel = (modele) => fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modele)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(cfg.cle)}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: corps(modele), signal });
    let derniere = 503;
    for (let i = 0; i < Math.min(liste.length, 5); i++) {
      let r;
      try {
        r = await appel(liste[i]);
        if (web && !sansWeb && [400, 429].includes(r.status)) { sansWeb = true; r = await appel(liste[i]); }  // recherche indisponible : on répond sans
        if (r.status === 400 && !sansReglage[liste[i]]) {       // ce modèle refuse le réglage : on réessaie sans, et on s'en souvient
          sansReglage[liste[i]] = true; store.set("geminiSansReglage", sansReglage);
          r = await appel(liste[i]);
        }
      } catch (e) { if (e.name === "AbortError") throw e; throw new Error("Je n'arrive pas à joindre Google. Vérifiez la connexion internet."); }
      if (r.ok) {
        if (i > 0 && !cfg.modele) store.set("modelesAutoGemini2", { l: [liste[i], ...liste.filter((x) => x !== liste[i])], t: Date.now() }); // celui qui marche passe en tête
        const t = await lireFlux(r, (d) => (d.candidates?.[0]?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || "").join(""), surMorceau);
        if (!t) throw new Error("Je n'ai pas trouvé quoi répondre. Pouvez-vous reformuler ?");
        return t;
      }
      derniere = r.status;
      if (![429, 500, 502, 503, 504, 404].includes(r.status)) break; // clé refusée, etc. : inutile d'insister
    }
    if (derniere === 404 && !cfg.modele) store.set("modelesAutoGemini2", null);
    if (derniere >= 500) throw new Error("Les serveurs de Google sont saturés en ce moment. Réessayez dans une minute.");
    throw erreurHttp(derniere);
  }

  async function modeleGroq() {
    if (cfg.modele) return cfg.modele;
    const memo = store.get("modeleAutoGroq", null);
    if (memo && Date.now() - memo.t < 7 * 864e5) return memo.m;
    let m = "llama-3.3-70b-versatile";
    try {
      const r = await fetch("https://api.groq.com/openai/v1/models", { headers: { Authorization: "Bearer " + cfg.cle }, signal: AbortSignal.timeout ? AbortSignal.timeout(15000) : undefined });
      if (r.ok) {
        const ids = ((await r.json()).data || []).map((x) => x.id);
        m = ["llama-3.3-70b-versatile", "openai/gpt-oss-120b", "openai/gpt-oss-20b"].find((x) => ids.includes(x)) || ids.find((x) => /llama|gpt-oss|qwen/.test(x)) || m;
      } else if ([401, 403].includes(r.status)) throw erreurHttp(r.status);
    } catch (e) { if (e.message.startsWith("Ma clé")) throw e; }
    store.set("modeleAutoGroq", { m, t: Date.now() });
    return m;
  }
  async function appelGroq(passe, question, surMorceau, signal, web, piece) {
    if (piece) {
      const contenu = [{ type: "text", text: (piece.video ? `Voici ${piece.images.length} images extraites, dans l'ordre, d'une vidéo de ${Math.round(piece.duree)} secondes. ` : "") + question }]
        .concat(piece.images.slice(0, 5).map((u) => ({ type: "image_url", image_url: { url: u } })));
      let derniere = null;
      for (const m of await modelesVisionGroq()) {
        try { const t = await appelGroqModele(m, passe, contenu, surMorceau, signal, true); store.set("modeleVisionGroq", m); return t; }
        catch (e) { if (e.name === "AbortError") throw e; derniere = e; }
      }
      throw new Error("Je n'arrive pas à regarder cette image pour le moment. Réessayez dans un instant." + (derniere && derniere.message ? " (" + derniere.message + ")" : ""));
    }
    const normal = await modeleGroq();
    if (web) {
      // Les modèles « compound » de Groq cherchent eux-mêmes sur le web
      for (const m of ["groq/compound-mini", "groq/compound"]) {
        try { return await appelGroqModele(m, passe, question, surMorceau, signal); }
        catch (e) { if (e.name === "AbortError") throw e; }   // sinon : modèle suivant, puis réponse sans recherche
      }
    }
    // La recherche n'a pas marché : on prévient le cerveau pour qu'il ne présente rien de douteux comme sûr
    const q = web ? "[Note : la recherche internet n'a pas fonctionné. Si la réponse dépend de faits précis ou récents, dis clairement que tu n'as pas pu les vérifier.]\n" + question : question;
    return appelGroqModele(normal, passe, q, surMorceau, signal);
  }
  // Modèles Groq qui acceptent les images : celui qui a marché, puis ceux de la liste du compte
  async function modelesVisionGroq() {
    const l = [store.get("modeleVisionGroq", ""), "qwen/qwen3.8-27b"];
    try {
      const r = await fetch("https://api.groq.com/openai/v1/models", { headers: { Authorization: "Bearer " + cfg.cle } });
      if (r.ok) ((await r.json()).data || []).map((x) => x.id).filter((id) => /vision|qwen3\.[6-9]|qwen3\.\d+-vl|llama-4|scout|maverick|gemma-?[34]/i.test(id)).forEach((id) => l.push(id));
    } catch {}
    return [...new Set(l.filter(Boolean))].slice(0, 4);
  }
  async function appelGroqModele(modele, passe, question, surMorceau, signal, vision) {
    const messages = [{ role: "system", content: consignesSysteme() }]
      .concat(passe.map((m) => ({ role: m.role === "user" ? "user" : "assistant", content: m.texte })))
      .concat([{ role: "user", content: question }]);
    const envoyer = (extra) => fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST", signal,
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + cfg.cle },
      body: JSON.stringify(Object.assign({ model: modele, messages, temperature: 0.5, max_tokens: 1500, stream: true }, extra)),
    });
    const extra = vision && /qwen/i.test(modele) ? { reasoning_format: "hidden" } : {};
    let r = await envoyer(extra);
    if (r.status === 400 && Object.keys(extra).length) r = await envoyer({});
    if (!r.ok) { if (!vision && !modele.startsWith("groq/")) store.set("modeleAutoGroq", null); throw erreurHttp(r.status); }
    let enReflexion = false;
    const filtre = vision ? (x) => { // on masque un éventuel bloc <think>…</think>
      if (!x) return x;
      if (x.includes("<think>")) { enReflexion = true; x = x.split("<think>")[0]; }
      if (enReflexion) { if (!x.includes("</think>")) return ""; enReflexion = false; x = x.split("</think>").pop(); }
      return x;
    } : (x) => x;
    const t = await lireFlux(r, (d) => filtre(d.choices?.[0]?.delta?.content), surMorceau);
    if (!t || !t.trim()) throw new Error("Je n'ai pas trouvé quoi répondre. Pouvez-vous reformuler ?");
    return t.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  }

  /* ---------- Briefing ---------- */
  const fmtJourHeure = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });
  const fmtCourt = new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });
  const dateSure = (s) => { const d = new Date(s); return isNaN(d) ? null : d; };
  const pluriel = (n, s, p) => `${n} ${n > 1 ? (p || s + "s") : s}`;

  function valider(b) {
    if (!b || typeof b !== "object") throw new Error("Ce fichier n'est pas un briefing Jarvis.");
    if (!b.mails && !b.publications && !b.a_valider && !b.actu_ia) throw new Error("Ce fichier ne contient ni mails, ni publications, ni éléments à valider.");
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

  /* Liens vers Gmail : construits ici à partir d'identifiants, jamais d'une adresse fournie telle quelle */
  function baseGmail(m) {
    const compte = typeof m.compte === "string" && /^[^\s@"<>]+@[^\s@"<>]+$/.test(m.compte) ? m.compte : "";
    return "https://mail.google.com/mail/" + (compte ? "?authuser=" + encodeURIComponent(compte) : "u/0/");
  }
  function lienGmailMail(m, x) {
    const id = String(x.id_fil || x.id || "");
    return /^[A-Za-z0-9_-]{6,64}$/.test(id) ? baseGmail(m) + "#all/" + id : null;
  }
  function lienGmailDossier(m, c) {
    const lib = typeof c.libelle === "string" ? c.libelle.trim() : "";
    if (!lib) return null;
    if (/^(INBOX|inbox)$/.test(lib)) return baseGmail(m) + "#inbox";
    return baseGmail(m) + "#label/" + encodeURIComponent(lib).replace(/%20/g, "+");
  }
  function afficherBriefing() {
    tableauMails(); afficherAgenda(); archiverActu(); afficherActu(); afficherProgramme(); majSignaux();
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
      const elems = Array.isArray(c.elements) ? c.elements : [];
      ulM.appendChild(li((e) => {
        if (elems.some((x) => x.urgent)) e.classList.add("urgent");
        const t = document.createElement("div"); t.className = "ligne-titre";
        const lienCat = lienGmailDossier(m, c);
        const titre = document.createElement(lienCat ? "a" : "strong");
        titre.textContent = c.nom || "Autres";
        if (lienCat) { titre.href = lienCat; titre.target = "_blank"; titre.rel = "noopener"; titre.className = "lien-mail lien-dossier"; titre.setAttribute("aria-label", `Ouvrir le dossier ${c.nom || ""} dans Gmail`); }
        const n = document.createElement("span"); n.className = "compte"; n.textContent = c.nombre ?? elems.length;
        t.append(titre, n); e.appendChild(t);
        if (elems.length) {
          const sous = document.createElement("ul"); sous.className = "sous-liste";
          elems.slice(0, 6).forEach((x) => {
            const l = document.createElement("li"); if (x.urgent) l.className = "urgent";
            const lien = lienGmailMail(m, x);
            const a = document.createElement(lien ? "a" : "span");
            a.textContent = `${x.de || "?"} : ${x.objet || x.but || ""}`;
            if (lien) { a.href = lien; a.target = "_blank"; a.rel = "noopener"; a.className = "lien-mail"; }
            l.appendChild(a); sous.appendChild(l);
          });
          if (elems.length > 6) { const l = document.createElement("li"); l.className = "ligne-meta"; l.textContent = `et ${elems.length - 6} autres`; sous.appendChild(l); }
          e.appendChild(sous);
        }
      }));
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
  /* ---------- Agenda (fourni par le briefing) ---------- */
  const fmtJourCle = new Intl.DateTimeFormat("fr-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Europe/Paris" });
  const fmtJourLong = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Paris" });
  const jourCle = (d) => fmtJourCle.format(d);
  // Rendez-vous ajoutés depuis Jarvis : gardés à part, pour qu'un nouveau briefing ne les efface pas
  let ajoutsAgenda = store.get("agendaAjouts", []);
  function evenements() {
    const base = Array.isArray(briefing && briefing.agenda) ? briefing.agenda : [];
    const cle = (e) => norm(String(e.titre || "")).trim() + "|" + (dateSure(e.debut) ? dateSure(e.debut).getTime() : String(e.debut).slice(0, 10));
    const deja = new Set(base.map(cle));
    ajoutsAgenda = ajoutsAgenda.filter((e) => !deja.has(cle(e)) && ((dateSure(e.fin) || dateSure(e.debut) || new Date(0)) > new Date(Date.now() - 864e5)));
    store.set("agendaAjouts", ajoutsAgenda);
    const l = base.concat(ajoutsAgenda);
    return l.map((e) => ({ ...e, d: e.journee ? new Date(String(e.debut).slice(0, 10) + "T12:00:00") : dateSure(e.debut), f: dateSure(e.fin) }))
      .filter((e) => e.d && (e.journee ? jourCle(e.d) >= jourCle(new Date()) : (e.f || e.d) > new Date()))
      .sort((a, b) => a.d - b.d);
  }
  function nomJour(d) {
    const auj = jourCle(new Date()), dem = jourCle(new Date(Date.now() + 864e5)), k = jourCle(d);
    return k === auj ? "Aujourd'hui" : k === dem ? "Demain" : fmtJourLong.format(d).replace(/^./, (c) => c.toUpperCase());
  }
  function lienAgenda(e) {
    try { const u = new URL(e.lien); return u.protocol === "https:" && /^(www\.google\.com|calendar\.google\.com)$/.test(u.hostname) ? u.href : null; } catch { return null; }
  }
  function afficherAgenda() {
    const ul = $("#agendaListe"); if (!ul) return;
    ul.innerHTML = "";
    if ((!briefing || !Array.isArray(briefing.agenda)) && !ajoutsAgenda.length) { vide(ul, "L'agenda arrive avec le briefing du matin."); return; }
    const evts = evenements().slice(0, 12);
    if (!evts.length) { vide(ul, "Rien de prévu dans les 7 prochains jours."); return; }
    let jourCourant = "";
    evts.forEach((e) => {
      const j = nomJour(e.d);
      if (j !== jourCourant) { jourCourant = j; const t = document.createElement("li"); t.className = "agenda-jour"; t.textContent = j; ul.appendChild(t); }
      const l = document.createElement("li"); l.className = "evt";
      if (!e.journee && e.d <= new Date() && e.f && e.f > new Date()) l.classList.add("maintenant");
      const h = document.createElement("span"); h.className = "evt-heure" + (e.journee ? " journee" : "");
      h.textContent = e.journee ? "Journée" : fmtHeure.format(e.d);
      const lien = lienAgenda(e);
      const t = document.createElement(lien ? "a" : "span"); t.className = "evt-titre" + (lien ? " lien-mail" : "");
      t.textContent = e.titre || "Sans titre";
      if (lien) { t.href = lien; t.target = "_blank"; t.rel = "noopener"; }
      const bloc = document.createElement("span"); bloc.appendChild(t);
      if (e.lieu) { const lieu = document.createElement("span"); lieu.className = "evt-lieu"; lieu.textContent = e.lieu; bloc.appendChild(lieu); }
      l.append(h, bloc); ul.appendChild(l);
    });
  }
  function texteAgenda(portee) {
    if ((!briefing || !Array.isArray(briefing.agenda)) && !ajoutsAgenda.length) return "Je n'ai pas encore votre agenda. Il arrivera avec le prochain briefing.";
    const auj = jourCle(new Date()), dem = jourCle(new Date(Date.now() + 864e5));
    let evts = evenements(), quand;
    if (portee === "agenda-demain") { evts = evts.filter((e) => jourCle(e.d) === dem); quand = "demain"; }
    else if (portee === "agenda-semaine") { quand = "ces sept prochains jours"; }
    else { const a = evts.filter((e) => jourCle(e.d) === auj); quand = "aujourd'hui"; if (!a.length && evts.length) { const p = evts[0]; return `Rien d'autre aujourd'hui. Votre prochain rendez-vous : ${nomJour(p.d).toLowerCase()}${p.journee ? "" : " à " + fmtHeure.format(p.d).replace(":", " h ")}, ${p.titre}.`; } evts = a; }
    if (!evts.length) return `Vous n'avez rien de prévu ${quand}.`;
    return `${pluriel(evts.length, "rendez-vous", "rendez-vous")} ${quand}. ` + evts.slice(0, 6).map((e) =>
      `${portee === "agenda-semaine" ? nomJour(e.d) + ", " : ""}${e.journee ? "toute la journée" : "à " + fmtHeure.format(e.d).replace(":", " h ")} : ${e.titre}${e.lieu ? ", à " + e.lieu : ""}.`).join(" ");
  }

  /* ---------- Actu IA : chaque édition du matin remplace la précédente.
     Seules restent les infos « gardées » : bouton Garder (sur l'appareil) ou demande écrite (clé actu_gardees du briefing). */
  let actus = store.get("actuIA", []).slice(0, 1);
  let gardeesLocales = store.get("actuGardees", []);
  const lienSur = (u) => { try { const x = new URL(u); return x.protocol === "https:" ? x.href : null; } catch { return null; } };
  const cleActu = (x) => norm(String(x.nom || x.titre || "")).trim();
  function archiverActu() {
    const a = briefing && briefing.actu_ia;
    if (!a || typeof a !== "object" || !(Array.isArray(a.skills) || Array.isArray(a.infos) || Array.isArray(a.infos_generales))) return;
    const date = String(a.date || (briefing.genere_le || "").slice(0, 10) || jourCle(new Date())).slice(0, 10);
    if (store.get("actuEffacees", []).includes(date)) { actus = []; store.set("actuIA", actus); return; }
    if (actus[0] && actus[0].date > date) return; // ne jamais revenir à une édition plus ancienne
    actus = [{ date, skills: (a.skills || []).slice(0, 3), infos: (a.infos || []).slice(0, 3), generales: (a.infos_generales || []).slice(0, 3) }];
    store.set("actuIA", actus);
  }
  function gardees() {
    const retirees = new Set(store.get("actuRetirees", []));
    const deBriefing = Array.isArray(briefing && briefing.actu_gardees) ? briefing.actu_gardees : [];
    const vues = new Set(); const l = [];
    deBriefing.concat(gardeesLocales).forEach((x) => { const k = cleActu(x); if (k && !vues.has(k) && !retirees.has(k)) { vues.add(k); l.push(x); } });
    return l;
  }
  const estGardee = (x) => gardees().some((g) => cleActu(g) === cleActu(x));
  function garder(x) {
    const k = cleActu(x);
    store.set("actuRetirees", store.get("actuRetirees", []).filter((r) => r !== k));
    if (!gardeesLocales.some((g) => cleActu(g) === k)) { gardeesLocales.push({ ...x, garde_le: jourCle(new Date()) }); store.set("actuGardees", gardeesLocales); }
    afficherActu();
  }
  function retirer(x) {
    const k = cleActu(x);
    gardeesLocales = gardeesLocales.filter((g) => cleActu(g) !== k); store.set("actuGardees", gardeesLocales);
    const r = store.get("actuRetirees", []); if (!r.includes(k)) { r.push(k); store.set("actuRetirees", r.slice(-200)); }
    afficherActu();
  }
  function elementActu(x, avecPourMoi, dansGardees) {
    return li((e) => {
      const lien = lienSur(x.lien);
      const tete = document.createElement("div"); tete.className = "actu-tete";
      const t = document.createElement(lien ? "a" : "strong"); t.textContent = x.nom || x.titre || "Sans titre";
      if (lien) { t.className = "lien-mail actu-titre"; t.href = lien; t.target = "_blank"; t.rel = "noopener"; }
      const g = document.createElement("button"); g.type = "button"; g.className = "actu-garder";
      const deja = !dansGardees && estGardee(x);
      g.textContent = dansGardees ? "Retirer" : deja ? "Gardée ✓" : "Garder";
      g.disabled = deja;
      g.setAttribute("aria-label", (dansGardees ? "Retirer : " : "Garder : ") + t.textContent);
      g.addEventListener("click", () => (dansGardees ? retirer(x) : garder(x)));
      tete.append(t, g); e.appendChild(tete);
      if (x.resume) { const p = document.createElement("p"); p.className = "actu-texte"; p.textContent = x.resume; e.appendChild(p); }
      if (avecPourMoi && x.pour_moi) { const p = document.createElement("p"); p.className = "actu-pourmoi"; p.textContent = x.pour_moi; e.appendChild(p); }
      if (x.source) { const sp = document.createElement("span"); sp.className = "actu-source"; sp.textContent = x.source; e.appendChild(sp); }
    });
  }
  function afficherActu() {
    const box = $("#actuContenu"); if (!box) return;
    box.innerHTML = "";
    const bloc = (parent, titre, liste, pourMoi, videTxt, dansGardees) => {
      const r = document.createElement("p"); r.className = "actu-rubrique"; r.textContent = titre; parent.appendChild(r);
      const ul = document.createElement("ul"); ul.className = "liste";
      if (liste.length) liste.forEach((x) => ul.appendChild(elementActu(x, pourMoi || !!x.pour_moi, dansGardees)));
      else ul.appendChild(li((e) => { e.className = "vide"; e.textContent = videTxt; }));
      parent.appendChild(ul);
    };
    if (!actus.length) { const p = document.createElement("p"); p.className = "vide-texte"; p.textContent = "La prochaine édition arrive avec le briefing de 8 h 30."; box.appendChild(p); }
    else {
      const ed = actus[0];
      const d = document.createElement("div"); d.className = "actu-edition";
      const h = document.createElement("p"); h.className = "actu-date"; h.textContent = nomJour(new Date(ed.date + "T12:00:00")); d.appendChild(h);
      bloc(d, "Nouveaux skills utiles", ed.skills || [], true, "Rien de nouveau qui vous concerne.");
      bloc(d, "IA : l'essentiel d'hier", ed.infos || [], false, "Pas d'info marquante.");
      bloc(d, "Actualité générale", ed.generales || [], false, "Pas d'info marquante.");
      box.appendChild(d);
    }
    const g = gardees();
    if (g.length) { const d = document.createElement("div"); d.className = "actu-edition actu-gardees"; bloc(d, "Infos gardées", g, false, "", true); box.appendChild(d); }
  }
  function texteActu() {
    if (!actus.length) return "Je n'ai pas encore d'actualité du jour. La prochaine édition arrive avec le briefing de 8 h 30.";
    const ed = actus[0], sk = ed.skills || [], inf = ed.infos || [], gen = ed.generales || [];
    let t = sk.length ? `Côté nouveaux skills : ${sk.map((x) => (x.nom || x.titre) + ". " + (x.resume || "")).join(" ")} ` : "Pas de nouveau skill utile pour vous. ";
    if (inf.length) t += `En intelligence artificielle : ${inf.map((x) => (x.titre || "") + ". " + (x.resume || "")).join(" ")} `;
    if (gen.length) t += `Dans l'actualité générale : ${gen.map((x) => (x.titre || "") + ". " + (x.resume || "")).join(" ")}`;
    return t.trim();
  }
  $("#effacerActu").addEventListener("click", () => {
    const out = $("#retourActu"); out.className = "retour ok";
    if (!actus.length) out.textContent = "C'est déjà vide.";
    else {
      store.set("actuEffacees", store.get("actuEffacees", []).concat(actus[0].date).slice(-60));
      actus = []; store.set("actuIA", actus); afficherActu();
      out.textContent = "Infos du jour effacées. Les infos gardées restent.";
    }
    setTimeout(() => { out.textContent = ""; }, 5000);
  });

  /* ---------- Ajout à Google Agenda (dicté) ----------
     Le cerveau transforme la phrase en rendez-vous ; Jarvis prépare la fiche Google Agenda
     déjà remplie, et Gaël la valide d'un toucher (aucune clé, aucun accès à son compte). */
  const deux = (x) => String(x).padStart(2, "0");
  // « 2026-11-17T14:00 » (heure de Paris) -> date exacte, quel que soit le fuseau de l'appareil
  function dateParis(loc) {
    const [a, mo, j, h, mi] = loc.match(/\d+/g).map(Number);
    const guess = Date.UTC(a, mo - 1, j, h, mi);
    const vu = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(guess));
    const g = (t) => Number(vu.find((x) => x.type === t).value);
    const ecart = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute")) - guess;
    return new Date(guess - ecart);
  }
  function compact(iso) { return iso.replace(/[-:]/g, "").slice(0, 15); } // 2026-11-17T14:00 -> 20261117T1400
  function lienCreationAgenda(ev) {
    const u = new URL("https://calendar.google.com/calendar/render");
    u.searchParams.set("action", "TEMPLATE");
    u.searchParams.set("text", ev.titre);
    let dates;
    if (ev.journee) {
      const d = new Date(ev.debut.slice(0, 10) + "T12:00:00"), f = new Date(d.getTime() + 864e5);
      dates = ev.debut.slice(0, 10).replace(/-/g, "") + "/" + `${f.getFullYear()}${deux(f.getMonth() + 1)}${deux(f.getDate())}`;
    } else dates = compact(ev.debut) + "00/" + compact(ev.fin) + "00";
    u.searchParams.set("dates", dates);
    u.searchParams.set("ctz", "Europe/Paris");
    if (ev.lieu) u.searchParams.set("location", ev.lieu);
    u.searchParams.set("details", (ev.details ? ev.details + "\n\n" : "") + "Ajouté par Jarvis");
    return u.href;
  }
  function lireEvenement(r) {
    const m = r.match(/\{[\s\S]*\}/); if (!m) return null;
    let o; try { o = JSON.parse(m[0]); } catch { return null; }
    if (!o || o.incomplet || !o.titre || !/^\d{4}-\d{2}-\d{2}/.test(o.debut || "")) return o && o.incomplet ? { incomplet: String(o.incomplet) } : null;
    const ev = { titre: String(o.titre).slice(0, 120), lieu: o.lieu ? String(o.lieu).slice(0, 120) : "", details: o.details ? String(o.details).slice(0, 300) : "", journee: !!o.journee || !/T\d{2}:\d{2}/.test(o.debut) };
    ev.debut = ev.journee ? o.debut.slice(0, 10) : o.debut.slice(0, 16);
    if (!ev.journee) {
      let f = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(o.fin || "") ? o.fin.slice(0, 16) : "";
      const d = new Date(ev.debut);
      if (isNaN(d)) return null;
      if (!f || new Date(f) <= d) { const g = new Date(d.getTime() + 36e5); f = `${g.getFullYear()}-${deux(g.getMonth() + 1)}-${deux(g.getDate())}T${deux(g.getHours())}:${deux(g.getMinutes())}`; }
      ev.fin = f;
    }
    return ev;
  }
  function phraseEvenement(ev) {
    const d = ev.journee ? new Date(ev.debut + "T12:00:00") : dateParis(ev.debut);
    return `${ev.titre}, ${fmtJourLong.format(d)}${ev.journee ? ", toute la journée" : " à " + fmtHeure.format(d).replace(":00", " h").replace(":", " h ")}${ev.lieu ? ", à " + ev.lieu : ""}`;
  }
  async function ajouterAuAgenda(texte) {
    setEtat("thinking"); consigne("Je prépare le rendez-vous…");
    const n = new Date();
    const consigneEv = `Nous sommes le ${fmtDate.format(n)} (${n.getFullYear()}-${deux(n.getMonth() + 1)}-${deux(n.getDate())}), il est ${fmtHeure.format(n)}, heure de Paris.\n` +
      `Gaël demande d'ajouter ceci à son agenda : « ${texte} »\n\n` +
      "Transforme la demande en un seul rendez-vous. Réponds UNIQUEMENT par un objet JSON, sans texte autour :\n" +
      '{"titre":"titre court et clair","debut":"AAAA-MM-JJTHH:MM","fin":"AAAA-MM-JJTHH:MM ou vide","journee":false,"lieu":"ou vide","details":"ou vide"}\n' +
      "Règles : dates à venir (« mardi » = le prochain mardi), heure de Paris, sans fuseau. Sans heure précisée, mets journee à true et debut au format AAAA-MM-JJ. " +
      "Sans durée, laisse fin vide. « Midi » = 12:00, « 14 h 30 » = 14:30, « en fin de matinée » = 11:00, « dans l'après-midi » = 14:00. " +
      'S\'il manque le jour, réponds {"incomplet":"une question courte pour demander le jour"}.';
    let ev = null;
    try { ev = lireEvenement(await demanderAuCerveau(consigneEv, null, { sansHistorique: true, sansWeb: true })); }
    catch (err) { if (err.name === "AbortError") return; setEtat("idle"); const m = err.message || "Je n'ai pas pu joindre mon cerveau."; ajouterMessage("jarvis", m, true); consigne(m, true); await parler(m); return; }
    setEtat("idle");
    memoriser("user", texte);
    if (!ev || ev.incomplet) {
      const m = ev && ev.incomplet ? ev.incomplet + " Redites-moi tout en une phrase, par exemple : ajoute à l'agenda dentiste mardi à 14 h." : "Je n'ai pas bien compris le rendez-vous. Dites par exemple : ajoute à l'agenda dentiste mardi à 14 h.";
      ajouterMessage("jarvis", m); memoriser("model", m); await parler(m); return;
    }
    const resume = phraseEvenement(ev);
    const p = ajouterMessage("jarvis", "Rendez-vous prêt : " + resume + ".");
    const a = document.createElement("a");
    a.className = "btn btn-petit btn-agenda"; a.href = lienCreationAgenda(ev); a.target = "_blank"; a.rel = "noopener";
    a.textContent = "Valider dans Google Agenda";
    a.addEventListener("click", () => {
      // on l'affiche tout de suite dans le panneau Agenda, sans attendre le briefing du lendemain
      ajoutsAgenda.push({ titre: ev.titre, debut: ev.journee ? ev.debut : dateParis(ev.debut).toISOString(), fin: ev.journee ? "" : dateParis(ev.fin).toISOString(), journee: ev.journee, lieu: ev.lieu, ajoute: true });
      store.set("agendaAjouts", ajoutsAgenda); afficherAgenda(); afficherProgramme(); majSignaux();
      a.textContent = "Ouvert dans Google Agenda ✓"; a.classList.add("fait");
    }, { once: true });
    p.after(a);
    const dit = `C'est prêt : ${resume}. Touchez « Valider dans Google Agenda » pour l'enregistrer.`;
    memoriser("model", "Rendez-vous préparé : " + resume + ".");
    consigne("Touchez le bouton pour l'enregistrer dans Google Agenda.");
    await parler(dit);
  }

  /* ---------- Balises lumineuses : signalent sur le titre d'un onglet qu'il y a quelque chose aujourd'hui ---------- */
  function poserBalise(selecteur, n, prochain) {
    const p = document.querySelector(selecteur); if (!p) return;
    const titre = p.querySelector(".panneau-bascule") || p.querySelector("h2"); if (!titre) return;
    let b = titre.querySelector(".balise");
    const mins = prochain ? Math.round((prochain - new Date()) / 6e4) : null;
    const imminent = mins !== null && mins <= 60;
    p.classList.toggle("signal-jour", n > 0); p.classList.toggle("signal-imminent", n > 0 && imminent);
    if (!n) { if (b) b.remove(); return; }
    if (!b) { b = document.createElement("span"); b.className = "balise"; b.innerHTML = '<span class="balise-led" aria-hidden="true"></span><span class="balise-txt"></span>'; titre.appendChild(b); }
    b.querySelector(".balise-txt").textContent = imminent ? (mins <= 0 ? "EN COURS" : `T−${mins} MIN`) : `${n} AUJ.`;
    b.title = imminent ? (mins <= 0 ? "En cours" : `Commence dans ${mins} min`) : `${n} prévu${n > 1 ? "s" : ""} aujourd'hui`;
  }
  function majSignaux() {
    const now = new Date(), auj = jourCle(now);
    const prochainDe = (l) => { const f = l.map((x) => x.d).filter((d) => d && d.getTime() > now - 36e5).sort((a, b) => a - b); return f[0] || null; };
    const evts = evenements().filter((e) => jourCle(e.d) === auj && (e.journee || (e.f || e.d) > now)).map((e) => ({ d: e.journee ? null : e.d, f: e.f }));
    const enCours = evts.find((e) => e.d && e.d <= now && e.f && e.f > now);
    const posts = (Array.isArray(briefing && briefing.publications) ? briefing.publications : []).map((p) => ({ d: dateSure(p.date) })).filter((p) => p.d && jourCle(p.d) === auj && p.d > now);
    const prog = programmeDuJour().filter((x) => !x.d || x.d > new Date(now - 36e5));
    poserBalise(".agenda", evts.length, enCours ? now : prochainDe(evts));
    poserBalise(".publications", posts.length, prochainDe(posts));
    poserBalise(".briefing-general", prog.length, enCours ? now : prochainDe(prog));
    const dock = document.querySelector('.dock-btn[data-dire*="agenda"]');
    if (dock) dock.classList.toggle("signal-jour", evts.length > 0);
    alertesCouronne(evts, posts, prog);
  }

  /* Alertes rouges sur la couronne : le secteur clignote tant qu'il y a quelque chose à faire ou à voir.
     « À voir » s'éteint quand le panneau correspondant est resté affiché à l'écran un instant. */
  var vus, alertesCles = {};   // var : majSignaux peut être appelé avant cette ligne au démarrage
  function alertesCouronne(evts, posts, prog) {
    if (!vus) vus = store.get("vus", {});
    const auj = jourCle(new Date());
    const nMails = ((briefing && briefing.mails && briefing.mails.categories) || []).reduce((s, c) => s + (c.nombre ?? (c.elements || []).length), 0);
    const aValider = Array.isArray(briefing && briefing.a_valider) ? briefing.a_valider.length : 0;
    const actu = briefing && briefing.actu_ia;
    // clé = ce qu'il y a à voir ; l'alerte reste tant que cette clé n'a pas été vue
    alertesCles = {
      AGENDA: evts.length ? "agenda-" + auj + "-" + evts.length : "",
      MAILS: nMails ? "mails-" + (briefing.genere_le || auj) : "",
      POSTS: posts.length ? "posts-" + auj + "-" + posts.length : "",
      ACTU: actu && ((actu.skills || []).length + (actu.infos || []).length + (actu.infos_generales || []).length) ? "actu-" + (actu.date || auj) : "",
      BRIEFING: prog.length ? "briefing-" + auj + "-" + prog.length : "",
    };
    const toujours = { POSTS: aValider > 0, CERVEAU: !cfg.cle, "RÉSEAU": !navigator.onLine };   // à faire : reste rouge jusqu'à ce que ce soit réglé
    Object.entries(etiquettes).forEach(([nom, e]) => {
      const cle = alertesCles[nom];
      const on = !!toujours[nom] || (!!cle && vus[nom] !== cle);
      e.seg.classList.toggle("alerte", on); e.t.classList.toggle("alerte", on);
    });
  }
  const PANNEAUX = { AGENDA: ".agenda", MAILS: ".briefing", POSTS: ".publications", ACTU: ".actu-ia", BRIEFING: ".briefing-general" };
  if ("IntersectionObserver" in window) {
    const minuteurs = new Map();
    const obs = new IntersectionObserver((entrees) => entrees.forEach((en) => {
      const nom = en.target.dataset.secteur;
      if (en.isIntersecting) minuteurs.set(nom, setTimeout(() => { if (alertesCles && alertesCles[nom]) { if (!vus) vus = store.get("vus", {}); vus[nom] = alertesCles[nom]; store.set("vus", vus); majSignaux(); } }, 1500));
      else clearTimeout(minuteurs.get(nom));
    }), { threshold: 0.5 });
    Object.entries(PANNEAUX).forEach(([nom, sel]) => { const el = document.querySelector(sel); if (el) { el.dataset.secteur = nom; obs.observe(el); } });
  }
  window.addEventListener("online", () => majSignaux()); window.addEventListener("offline", () => majSignaux());

  /* ---------- Programme du jour : rendez-vous, publications et rappels d'aujourd'hui, dans l'ordre ---------- */
  function programmeDuJour() {
    const auj = jourCle(new Date()), l = [];
    evenements().filter((e) => jourCle(e.d) === auj).forEach((e) => l.push({ d: e.journee ? null : e.d, type: "Rendez-vous", titre: e.titre, detail: e.lieu || "", lien: lienAgenda(e) }));
    (Array.isArray(briefing && briefing.publications) ? briefing.publications : []).forEach((p) => {
      const d = dateSure(p.date); if (!d || jourCle(d) !== auj) return;
      l.push({ d, type: "Publication", titre: p.titre || "Publication", detail: [(p.reseaux || []).join(", "), p.statut === "brouillon" ? "brouillon à valider" : p.statut].filter(Boolean).join(" · ") });
    });
    (Array.isArray(briefing && briefing.rappels) ? briefing.rappels : []).forEach((r) => {
      const d = dateSure(r.date); if (!d || jourCle(d) !== auj) return;
      l.push({ d: /T\d{2}:\d{2}/.test(r.date) ? d : null, type: "Rappel", titre: r.titre || "Rappel", detail: r.detail || "" });
    });
    return l.sort((a, b) => (a.d ? a.d.getTime() : 0) - (b.d ? b.d.getTime() : 0));
  }
  function afficherProgramme() {
    const ul = $("#programmeJour"); if (!ul) return;
    if (!briefing && !ajoutsAgenda.length) { vide(ul, "Le programme arrive avec le briefing du matin."); return; }
    const l = programmeDuJour(); ul.innerHTML = "";
    if (!l.length) {
      const p = evenements()[0];
      vide(ul, "Rien de programmé aujourd'hui." + (p ? ` Prochain rendez-vous : ${nomJour(p.d).toLowerCase()}${p.journee ? "" : " à " + fmtHeure.format(p.d)}, ${p.titre}.` : ""));
      return;
    }
    l.forEach((x) => {
      const e = document.createElement("li"); e.className = "evt";
      if (x.d && x.d <= new Date() && x.type === "Rendez-vous") e.classList.add("maintenant");
      const h = document.createElement("span"); h.className = "evt-heure" + (x.d ? "" : " journee"); h.textContent = x.d ? fmtHeure.format(x.d) : "Journée";
      const bloc = document.createElement("span");
      const t = document.createElement(x.lien ? "a" : "span"); t.className = "evt-titre" + (x.lien ? " lien-mail" : ""); t.textContent = x.titre;
      if (x.lien) { t.href = x.lien; t.target = "_blank"; t.rel = "noopener"; }
      const m = document.createElement("span"); m.className = "evt-lieu"; m.textContent = x.type + (x.detail ? " · " + x.detail : "");
      bloc.append(t, m); e.append(h, bloc); ul.appendChild(e);
    });
  }
  function texteProgramme() {
    const l = programmeDuJour();
    if (!l.length) return "Rien de programmé aujourd'hui.";
    return `Au programme aujourd'hui : ` + l.map((x) => `${x.d ? "à " + fmtHeure.format(x.d).replace(":00", " h").replace(":", " h ") : "dans la journée"}, ${x.type === "Rendez-vous" ? "" : x.type.toLowerCase() + " : "}${x.titre}`).join(" ; ") + ".";
  }

  function texteBriefing() {
    const h = Number(new Intl.DateTimeFormat("fr-FR", { hour: "numeric", hourCycle: "h23", timeZone: "Europe/Paris" }).format(new Date()));
    const salut = h < 18 ? "Bonjour" : "Bonsoir";
    let t = `${salut} ${cfg.surnom || "Gaël"}. `;
    if (briefing.exemple) t += "Attention, ceci est un briefing d'exemple, les données sont fictives. ";
    t += texteProgramme() + " ";
    t += texteMails() + " " + textePosts();
    const av = briefing.a_valider || [];
    if (av.length) t += ` Vous avez ${pluriel(av.length, "chose", "choses")} à valider.`;
    const ai = briefing.actu_ia;
    if (ai && ((ai.skills || []).length || (ai.infos || []).length || (ai.infos_generales || []).length)) t += " L'actu IA du jour est prête : dites « actu IA » pour que je vous la lise.";
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
  $("#chargerBriefing").addEventListener("click", async () => {
    // Avec un code : on télécharge le briefing chiffré du matin. Sans code : on ouvre les réglages au bon endroit.
    if (!store.get("codeBriefing", "")) {
      remplirReglages(); dlg.showModal();
      const c = $("#codeBriefing"); c.scrollIntoView({ block: "center" }); c.focus();
      $("#retourCode").textContent = "Collez votre code ici, puis touchez « Charger le briefing ».";
      return;
    }
    consigne("Je récupère le briefing…");
    try { if (await chargerBriefingChiffre(true)) consigne("Briefing à jour. Touchez « Briefing » pour que je vous le lise."); }
    catch (e) { consigne(e.message, true); }
  });
  $("#fichierBriefing").addEventListener("change", async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try { nouveauBriefing(JSON.parse(await f.text()), "depuis le fichier"); }
    catch (err) { consigne(err.message.startsWith("Ce fichier") ? err.message : "Ce fichier est illisible. Il faut le fichier jarvis-briefing.json.", true); }
    e.target.value = "";
  });

  /* ---------- Briefing chiffré publié chaque matin ---------- */
  const deB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const normCode = (c) => {
    // Si on a collé toute une phrase (« Ton code : XXXXX-… »), on ne garde que le code lui-même
    const m = (c || "").toUpperCase().match(/[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}/);
    return (m ? m[0] : (c || "").toUpperCase()).replace(/[^A-Z0-9]/g, "").replace(/(.{5})(?=.)/g, "$1-");
  };
  const canonCode = (c) => (c || "").toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/[OQ]/g, "0").replace(/[IL]/g, "1").replace(/S/g, "5").replace(/Z/g, "2").replace(/B/g, "8").replace(/G/g, "6");
  async function dechiffrer(paquet, code) {
    const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(canonCode(code)), "PBKDF2", false, ["deriveKey"]);
    const cle = await crypto.subtle.deriveKey({ name: "PBKDF2", salt: deB64(paquet.sel), iterations: 250000, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
    const clair = await crypto.subtle.decrypt({ name: "AES-GCM", iv: deB64(paquet.iv) }, cle, deB64(paquet.donnees));
    return JSON.parse(new TextDecoder().decode(clair));
  }
  async function chargerBriefingChiffre(manuel) {
    const code = store.get("codeBriefing", "");
    if (!code) return false;
    let paquet;
    try {
      const r = await fetch("briefing.chiffre.json?t=" + Date.now(), { cache: "no-store" });
      if (!r.ok) { if (manuel) consigne("Le briefing du matin n'a pas encore été publié.", true); return false; }
      paquet = await r.json();
    } catch { if (manuel) consigne("Impossible de récupérer le briefing. Vérifiez la connexion.", true); return false; }
    try {
      const b = await dechiffrer(paquet, code);
      nouveauBriefing(b, manuel ? "et déchiffré" : "");
      store.set("briefingLu", paquet.publie_le);
      return true;
    } catch {
      if (manuel) throw new Error("Code incorrect : impossible d'ouvrir le briefing.");
      return false;
    }
  }
  // Lien d'activation : …/JARVIS/#code=XXXXX-… (le code ne quitte jamais l'appareil)
  function codeDepuisLien() {
    const m = location.hash.match(/code=([A-Za-z0-9-]+)/);
    if (!m) return false;
    store.set("codeBriefing", normCode(m[1]));
    history.replaceState(null, "", location.pathname + location.search);
    return true;
  }
  codeDepuisLien();
  window.addEventListener("hashchange", () => { if (codeDepuisLien()) chargerBriefingChiffre(true); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) chargerBriefingChiffre(false); });

  async function briefingParDefaut() {
    if (await chargerBriefingChiffre(false)) return;
    if (briefing && !briefing.exemple) return afficherBriefing();
    if (store.get("codeBriefing", "")) { briefing = null; afficherBriefing(); return; }
    try { const r = await fetch("briefing-exemple.json"); if (r.ok) { briefing = await r.json(); afficherBriefing(); } } catch {}
  }

  /* ---------- Réglages ---------- */
  const dlg = $("#reglages");
  const virgule = (v) => String(v).replace(".", ",");
  function remplirReglages() {
    champsTouches.clear();
    document.querySelector(`input[name="fournisseur"][value="${cfg.fournisseur}"]`).checked = true;
    $("#cle").value = cfg.cle; $("#modele").value = cfg.modele; $("#surnom").value = cfg.surnom;
    $("#vitesse").value = cfg.vitesse; $("#vitesseVal").textContent = virgule(cfg.vitesse);
    $("#hauteur").value = cfg.hauteur; $("#hauteurVal").textContent = virgule(cfg.hauteur);
    majStyles();
    $("#cle").placeholder = cfg.fournisseur === "groq" ? "Clé Groq (commence par gsk_)" : "Clé Google AI Studio (commence par AIza)";
    $("#retourCle").textContent = "";
    $("#codeBriefing").value = store.get("codeBriefing", ""); $("#retourCode").textContent = "";
    afficherMemoire();
  }
  function enregistrer() {
    const ancien = cfg.fournisseur + cfg.cle;
    cfg.fournisseur = document.querySelector('input[name="fournisseur"]:checked').value;
    const cleSaisie = $("#cle").value.replace(/\s+/g, "");
    if (cleSaisie || champsTouches.has("cle")) cfg.cle = cleSaisie; // un champ vide non touché n'efface jamais la clé
    cfg.modele = $("#modele").value.trim();
    cfg.surnom = $("#surnom").value.trim() || "Gaël";
    cfg.vitesse = parseFloat($("#vitesse").value); cfg.hauteur = parseFloat($("#hauteur").value);
    cfg.voix = $("#voix").value;
    if (ancien !== cfg.fournisseur + cfg.cle) { store.set("modelesAutoGemini2", null); store.set("modeleAutoGroq", null); }
    ["fournisseur", "cle", "modele", "surnom", "vitesse", "hauteur", "voix"].forEach((k) => store.set(k, cfg[k]));
    const codeSaisi = normCode($("#codeBriefing").value);
    if (codeSaisi || champsTouches.has("codeBriefing")) store.set("codeBriefing", codeSaisi);
    sauverCoffre();
  }
  const champsTouches = new Set();
  ["cle", "codeBriefing"].forEach((id) => $("#" + id).addEventListener("input", () => champsTouches.add(id)));
  $("#testerCode").addEventListener("click", async () => {
    enregistrer();
    const out = $("#retourCode"); out.className = "retour"; out.textContent = "Chargement…";
    try {
      if (!store.get("codeBriefing", "")) throw new Error("Entrez d'abord le code.");
      $("#codeBriefing").value = store.get("codeBriefing", "");
      const ok = await chargerBriefingChiffre(true);
      out.textContent = ok ? "Briefing chargé." : "Pas encore de briefing publié. Il arrivera demain matin."; out.className = ok ? "retour ok" : "retour";
    } catch (e) { out.textContent = e.message; out.className = "retour ko"; }
  });
  $("#ouvrirReglages").addEventListener("click", () => { remplirReglages(); dlg.showModal(); });
  dlg.addEventListener("close", () => { enregistrer(); tableauEtats(); majSignaux(); });
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
  document.querySelectorAll('input[name="fournisseur"]').forEach((r) => r.addEventListener("change", () => { cfg.fournisseur = r.value; $("#cle").placeholder = r.value === "groq" ? "Clé Groq (commence par gsk_)" : "Clé Google AI Studio (commence par AIza)"; }));
  $("#vitesse").addEventListener("input", (e) => ($("#vitesseVal").textContent = virgule(e.target.value)));
  $("#hauteur").addEventListener("input", (e) => ($("#hauteurVal").textContent = virgule(e.target.value)));
  function majStyles() { document.querySelectorAll(".style-voix").forEach((b) => b.classList.toggle("actif", Number(b.dataset.vitesse) === Number($("#vitesse").value) && Number(b.dataset.hauteur) === Number($("#hauteur").value))); }
  document.querySelectorAll(".style-voix").forEach((b) => b.addEventListener("click", () => {
    $("#vitesse").value = b.dataset.vitesse; $("#vitesseVal").textContent = virgule(b.dataset.vitesse);
    $("#hauteur").value = b.dataset.hauteur; $("#hauteurVal").textContent = virgule(b.dataset.hauteur);
    majStyles(); enregistrer(); parler(`Bonjour ${cfg.surnom}. Voici le style ${b.textContent.toLowerCase()}. Tous les systèmes sont opérationnels.`);
  }));
  ["vitesse", "hauteur"].forEach((id) => $("#" + id).addEventListener("input", majStyles));
  $("#voix").addEventListener("change", () => { enregistrer(); parler(`Bonjour ${cfg.surnom}. Voici ma nouvelle voix.`); });
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
  /* Sauvegarde dans un fichier : survit à l'effacement des données du navigateur. */
  const A_SAUVER = ["fournisseur", "cle", "modele", "codeBriefing", "surnom", "vitesse", "hauteur", "voix", "continu", "memoire", "actuGardees", "agendaAjouts"];
  $("#sauverFichier").addEventListener("click", () => {
    enregistrer();
    const o = { jarvis: 1, date: new Date().toISOString() };
    A_SAUVER.forEach((k) => (o[k] = store.get(k, null)));
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(o, null, 1)], { type: "application/json" }));
    a.download = "jarvis-sauvegarde.json"; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    $("#retourSauvegarde").className = "retour ok"; $("#retourSauvegarde").textContent = "Sauvegarde créée dans Téléchargements.";
  });
  $("#restaurerFichier").addEventListener("click", () => $("#fichierSauvegarde").click());
  $("#fichierSauvegarde").addEventListener("change", async (e) => {
    const f = e.target.files[0]; e.target.value = ""; if (!f) return;
    const out = $("#retourSauvegarde");
    try {
      const o = JSON.parse(await f.text());
      if (!o || o.jarvis !== 1) throw new Error("Ce fichier n'est pas une sauvegarde de Jarvis.");
      A_SAUVER.forEach((k) => { if (o[k] !== null && o[k] !== undefined) store.set(k, o[k]); });
      sauverCoffre();
      out.className = "retour ok"; out.textContent = "Réglages restaurés. Jarvis redémarre…";
      setTimeout(() => location.reload(), 900);
    } catch (err) { out.className = "retour ko"; out.textContent = err.message.startsWith("Ce fichier") ? err.message : "Fichier illisible."; }
  });
  $("#effacerConv").addEventListener("click", () => { historique = []; store.set("historique", []); $("#fil").innerHTML = ""; });

  $("#modeConversation").checked = cfg.continu;
  $("#modeConversation").addEventListener("change", (e) => { cfg.continu = e.target.checked; store.set("continu", cfg.continu); });

  /* ---------- Photos et vidéos : réduites sur l'appareil avant l'envoi au cerveau ---------- */
  let piece = null;
  function imageEnJpeg(source, largeurMax) {
    const l = source.videoWidth || source.naturalWidth || source.width, h = source.videoHeight || source.naturalHeight || source.height;
    const k = Math.min(1, largeurMax / Math.max(l, h));
    const c = document.createElement("canvas"); c.width = Math.round(l * k); c.height = Math.round(h * k);
    c.getContext("2d").drawImage(source, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.82);
  }
  function chargerImage(fichier) {
    return new Promise((ok, ko) => { const u = URL.createObjectURL(fichier), im = new Image(); im.onload = () => { ok(imageEnJpeg(im, 1280)); URL.revokeObjectURL(u); }; im.onerror = () => ko(new Error("Je n'arrive pas à ouvrir cette image.")); im.src = u; });
  }
  async function imagesDeVideo(fichier, n) {
    const u = URL.createObjectURL(fichier), v = document.createElement("video");
    v.muted = true; v.playsInline = true; v.preload = "auto"; v.src = u;
    await new Promise((ok, ko) => { v.onloadedmetadata = ok; v.onerror = () => ko(new Error("Je n'arrive pas à lire cette vidéo.")); });
    const duree = isFinite(v.duration) ? v.duration : 1, images = [];
    for (let i = 0; i < n; i++) {
      v.currentTime = Math.min(duree - 0.05, (duree * (i + 0.5)) / n);
      await new Promise((ok) => { v.onseeked = ok; setTimeout(ok, 2500); });
      images.push(imageEnJpeg(v, 768));
    }
    URL.revokeObjectURL(u);
    return { images, duree };
  }
  const versB64 = (f) => new Promise((ok, ko) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(",")[1]); r.onerror = ko; r.readAsDataURL(f); });
  function retirerPiece() { piece = null; $("#pieceApercu").hidden = true; $("#fichierPiece").value = ""; $("#champ").placeholder = "Ou écrivez ici…"; }
  $("#joindre").addEventListener("click", () => $("#fichierPiece").click());
  $("#pieceRetirer").addEventListener("click", retirerPiece);
  $("#fichierPiece").addEventListener("change", async (e) => {
    const f = e.target.files[0]; if (!f) return;
    const video = f.type.startsWith("video/");
    $("#pieceApercu").hidden = false; $("#pieceImg").removeAttribute("src"); $("#pieceInfo").textContent = video ? "Je prépare la vidéo…" : "Je prépare la photo…";
    try {
      if (video) {
        const { images, duree } = await imagesDeVideo(f, 5);
        piece = { video: true, images, duree, vignette: images[Math.floor(images.length / 2)] };
        // Gemini sait regarder la vidéo entière si elle est légère
        if (cfg.fournisseur !== "groq" && f.size < 15e6) { piece.videoB64 = await versB64(f); piece.videoMime = f.type || "video/mp4"; }
        $("#pieceInfo").textContent = `Vidéo de ${Math.round(duree)} s prête. Posez votre question, ou envoyez directement.`;
      } else {
        const img = await chargerImage(f);
        piece = { video: false, images: [img], vignette: img };
        $("#pieceInfo").textContent = "Photo prête. Posez votre question, ou envoyez directement.";
      }
      $("#pieceImg").src = piece.vignette; $("#champ").placeholder = "Votre question sur ce fichier…"; $("#champ").focus();
    } catch (err) { piece = null; $("#pieceInfo").textContent = err.message || "Fichier illisible."; }
  });

  $("#saisie").addEventListener("submit", (e) => {
    e.preventDefault();
    let v = $("#champ").value.trim(); if (etat === "thinking") return;
    if (!v && !piece) return;
    const p = piece;
    if (!v) v = p.video ? "Que vois-tu dans cette vidéo ?" : "Que vois-tu sur cette photo ?";
    $("#champ").value = ""; retirerPiece(); traiter(v, p);
  });


  /* ---------- Tableau de bord : règle des jours, jauges, états ---------- */
  const arc = (id, pct) => { const e = $(id); if (e) e.style.strokeDasharray = `${Math.max(0, Math.min(100, pct))} 100`; };
  function tableauDate() {
    const p = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Paris" }).formatToParts(new Date());
    const jour = Number(p.find((x) => x.type === "day").value), mois = p.find((x) => x.type === "month").value, an = Number(p.find((x) => x.type === "year").value);
    const moisNum = new Date(`${mois} 1, 2000`).getMonth();
    const idx = ["janvier","février","mars","avril","mai","juin","juillet","août","septembre","octobre","novembre","décembre"].indexOf(mois);
    const total = new Date(an, (idx < 0 ? moisNum : idx) + 1, 0).getDate() || 30;
    const regle = $("#regle");
    if (regle.dataset.jour !== String(jour)) {
      regle.dataset.jour = jour; regle.innerHTML = "";
      for (let d = 1; d <= total; d++) {
        const s = document.createElement("span"); s.textContent = String(d).padStart(2, "0");
        if (d === jour) s.className = "auj proche"; else { if (d < jour) s.classList.add("passe"); if (Math.abs(d - jour) <= 4) s.classList.add("proche"); }
        regle.appendChild(s);
      }
    }
    $("#jourTxt").textContent = String(jour).padStart(2, "0"); $("#moisTxt").textContent = mois;
    arc("#arcJour", (jour / total) * 100);
  }
  function tableauEtats() {
    const c = navigator.connection;
    const r = $("#etatReseau");
    r.textContent = navigator.onLine ? "En ligne" + (c && c.effectiveType ? " · " + c.effectiveType.toUpperCase() : "") : "Hors ligne"; r.classList.toggle("ko", !navigator.onLine);
    const ce = $("#etatCerveau");
    ce.textContent = cfg.cle ? (cfg.fournisseur === "groq" ? "Groq" : "Gemini") + " prêt" : "Clé manquante"; ce.classList.toggle("ko", !cfg.cle);
  }
  function tableauMails() {
    const cats = (briefing && briefing.mails && briefing.mails.categories) || [];
    const n = cats.reduce((s, c) => s + (c.nombre ?? (c.elements || []).length), 0);
    $("#mailsTxt").textContent = briefing && briefing.mails ? String(n).padStart(2, "0") : "--";
    arc("#arcMails", briefing && briefing.mails ? Math.max(4, (n / 20) * 100) : 0);
    $("#jaugeMails").classList.toggle("alerte", cats.some((c) => (c.elements || []).some((x) => x.urgent)));
  }
  async function tableauMicro() {
    const m = $("#etatMicro");
    if (!Reco) { m.textContent = "Non géré ici"; m.classList.add("ko"); return; }
    try {
      const p = await navigator.permissions.query({ name: "microphone" });
      const maj = () => { m.textContent = { granted: "Autorisé", denied: "Bloqué", prompt: "À autoriser" }[p.state] || "—"; m.classList.toggle("ko", p.state === "denied"); };
      maj(); p.onchange = maj;
    } catch { m.textContent = "Prêt"; }
  }
  if (navigator.getBattery) navigator.getBattery().then((b) => {
    const maj = () => {
      const pc = Math.round(b.level * 100);
      $("#batterieTxt").textContent = pc; $("#batterieEtat").textContent = b.charging ? "en charge" : "énergie";
      arc("#arcBatterie", pc); $("#jaugeBatterie").classList.toggle("alerte", pc <= 15 && !b.charging);
    };
    maj(); b.addEventListener("levelchange", maj); b.addEventListener("chargingchange", maj);
  }).catch(() => {});
  else { $("#batterieTxt").textContent = "OK"; $("#batterieEtat").textContent = "secteur"; arc("#arcBatterie", 100); }
  window.addEventListener("online", tableauEtats); window.addEventListener("offline", tableauEtats);
  setInterval(tableauDate, 60000);

  document.querySelectorAll(".dock-btn[data-dire]").forEach((b) => b.addEventListener("click", () => { if (etat === "thinking") return; taire(); traiter(b.dataset.dire); }));
  $("#dockSilence").addEventListener("click", () => { arreterEcoute(); taire(); consigne("Silence. Touchez le cercle quand vous voulez."); });

  /* ---------- Mémoire durable ---------- */
  let memoire = store.get("memoire", []);
  function memoriserFait(f) {
    const t = String(f || "").replace(/^[-•*\s]+/, "").trim();
    if (t.length < 3) return false;
    if (memoire.some((x) => norm(x) === norm(t))) return false;
    memoire.push(t.slice(0, 240)); memoire = memoire.slice(-40); store.set("memoire", memoire);
    return true;
  }
  function afficherMemoire() {
    const ul = $("#memoireListe"); if (!ul) return; ul.innerHTML = "";
    if (!memoire.length) { const l = document.createElement("li"); l.className = "vide"; l.textContent = "Rien pour l'instant."; ul.appendChild(l); return; }
    memoire.forEach((f, i) => {
      const l = document.createElement("li");
      const s = document.createElement("span"); s.textContent = f;
      const b = document.createElement("button"); b.type = "button"; b.className = "memoire-suppr"; b.textContent = "Oublier"; b.setAttribute("aria-label", "Oublier : " + f);
      b.addEventListener("click", () => { memoire.splice(i, 1); store.set("memoire", memoire); afficherMemoire(); });
      l.append(s, b); ul.appendChild(l);
    });
  }
  async function retenirEssentiel() {
    const echanges = historique.slice(-30);
    if (echanges.length < 2 || !cfg.cle) return 0;
    const transcription = echanges.map((m) => (m.role === "user" ? "Gaël : " : "Jarvis : ") + m.texte).join("\n").slice(-12000);
    const consigneMem = "Voici une conversation entre Gaël et son assistant Jarvis.\n\n" + transcription +
      "\n\nDéjà mémorisé :\n" + (memoire.map((x) => "- " + x).join("\n") || "(rien)") +
      "\n\nExtrais au maximum 5 informations NOUVELLES et durables à retenir (préférences de Gaël, décisions, projets, rappels, personnes importantes). Ignore les bavardages et ce qui est déjà mémorisé. N'inclus aucune donnée sensible (mot de passe, numéro de carte, santé). Réponds uniquement par des lignes qui commencent par « - », ou par RIEN.";
    const r = await demanderAuCerveau(consigneMem, null, { sansHistorique: true, sansWeb: true });
    let n = 0;
    r.split("\n").filter((l) => /^\s*[-•*]/.test(l)).forEach((l) => { if (memoriserFait(l)) n++; });
    return n;
  }
  function nouvelleConversation(garder) {
    historique = []; store.set("historique", []); $("#fil").innerHTML = "";
    if (!garder) consigne("Conversation effacée.");
  }
  $("#nouvelleConv").addEventListener("click", async () => {
    const out = $("#retourConv"), btn = $("#nouvelleConv");
    if (!historique.length) { out.textContent = "La conversation est déjà vide."; out.className = "retour"; return; }
    taire(); btn.disabled = true; out.className = "retour"; out.textContent = "Je retiens l'essentiel…";
    let n = 0, echec = false;
    try { n = await retenirEssentiel(); } catch { echec = true; }
    if (echec && !confirm("Je n'ai pas pu résumer la conversation (cerveau injoignable). L'effacer quand même, sans rien retenir ?")) {
      out.textContent = "Conversation conservée."; btn.disabled = false; return;
    }
    nouvelleConversation(true);
    out.className = "retour ok";
    out.textContent = echec ? "Conversation effacée." : n ? `Conversation effacée. J'ai retenu ${n} ${n > 1 ? "choses" : "chose"}.` : "Conversation effacée. Rien de nouveau à retenir.";
    btn.disabled = false;
    setTimeout(() => { out.textContent = ""; }, 6000);
  });
  $("#toutOublier").addEventListener("click", () => {
    if (!confirm("Effacer tout ce que Jarvis a retenu ?")) return;
    memoire = []; store.set("memoire", []); afficherMemoire();
  });

  /* ---------- Panneaux repliables (touchez le titre), effet hologramme ---------- */
  (function panneauxRepliables() {
    const plies = new Set(store.get("panneauxPlies", []));
    const sansMouvement = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
    document.querySelectorAll(".panneau").forEach((p, i) => {
      const h2 = p.querySelector("h2"); if (!h2) return;
      const cle = p.getAttribute("aria-label") || "p" + i;
      const tete = h2.closest(".briefing-tete") || h2;
      const corps = document.createElement("div"); corps.className = "panneau-corps"; corps.id = "corps-" + i;
      const interieur = document.createElement("div"); interieur.className = "panneau-interieur";
      [...p.children].filter((c) => c !== tete).forEach((c) => interieur.appendChild(c));
      corps.appendChild(interieur); p.appendChild(corps);
      const b = document.createElement("button"); b.type = "button"; b.className = "panneau-bascule";
      b.setAttribute("aria-controls", corps.id);
      b.textContent = h2.textContent; h2.textContent = ""; h2.appendChild(b);
      const appliquer = (plie, anime) => {
        p.classList.remove("holo-on", "holo-off");
        if (anime && !sansMouvement()) { void p.offsetWidth; p.classList.add(plie ? "holo-off" : "holo-on"); }
        p.classList.toggle("plie", plie);
        corps.inert = plie;
        b.setAttribute("aria-expanded", String(!plie));
      };
      appliquer(plies.has(cle), false);
      b.addEventListener("click", () => {
        const plie = !p.classList.contains("plie"); appliquer(plie, true);
        plie ? plies.add(cle) : plies.delete(cle); store.set("panneauxPlies", [...plies]);
      });
    });
  })();
  majSignaux(); setInterval(majSignaux, 60000);

  /* ---------- Démarrage ---------- */
  rejouerHistorique();
  // À l'ouverture, Jarvis reste en haut de page, sur le cercle
  try { history.scrollRestoration = "manual"; } catch {}
  window.scrollTo(0, 0); requestAnimationFrame(() => window.scrollTo(0, 0));
  tableauDate(); tableauEtats(); tableauMails(); tableauMicro();
  // Si le navigateur a vidé le stockage, on récupère la clé et le code depuis le coffre.
  coffre("readonly", (s) => s.get("secrets")).then((o) => {
    if (!o) { sauverCoffre(); return; }
    let repris = false;
    if (!cfg.cle && o.cle) { cfg.cle = o.cle; cfg.fournisseur = o.fournisseur || cfg.fournisseur; cfg.modele = o.modele || ""; ["fournisseur", "cle", "modele"].forEach((k) => store.set(k, cfg[k])); repris = true; }
    if (!store.get("codeBriefing", "") && o.codeBriefing) { store.set("codeBriefing", o.codeBriefing); repris = true; chargerBriefingChiffre(false); }
    if (repris) { tableauEtats(); consigne("Réglages récupérés depuis la sauvegarde."); }
    else sauverCoffre();
  });
  briefingParDefaut();
  if (!Reco) consigne("Ce navigateur ne sait pas écouter. Écrivez-moi ci-dessous, ou ouvrez Jarvis dans Chrome ou Edge.");
  else if (!cfg.cle) consigne("Touchez le cercle et parlez. Pour discuter librement, ajoutez d'abord la clé dans les réglages.");
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).then((r) => r.update()).catch(() => {});
    // Quand une nouvelle version prend la main, on recharge une fois pour ne jamais mélanger deux versions
    let recharge = false; const avait = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener("controllerchange", () => { if (avait && !recharge) { recharge = true; location.reload(); } });
  }
})();
