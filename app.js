(function () {
  "use strict";

  // Anti-clickjacking: deze app bewaart een token, dus nooit in een iframe draaien.
  if (window.self !== window.top) {
    try { window.top.location = window.location; }
    catch (e) { document.documentElement.style.display = "none"; }
  }

  var SLOTS = ["09:00", "11:00", "13:00", "15:00", "17:00", "19:00", "21:00"];
  var OTHER_LABEL = "Anders, namelijk: ...";
  var ACTIVITY_OPTIONS = [
    { label: "Aan het werk", sub: ["Op kantoor", "Thuis", "Extern bij klant", OTHER_LABEL] },
    { label: "Vergadering / overleg", sub: ["Op kantoor", "Online (video)", "Telefonisch", OTHER_LABEL] },
    { label: "School / studeren", sub: ["Les / college", "Zelfstudie / huiswerk", "Toets / tentamen", OTHER_LABEL] },
    { label: "Afspraak (zorg/arts/psycholoog e.d.)", sub: ["Psycholoog", "Huisarts / specialist", "Andere zorgafspraak", OTHER_LABEL] },
    { label: "In de auto / onderweg", sub: ["Naar werk", "Naar school", "Naar huis", "Boodschappen", "Familie of vrienden bezoeken", "Vrije tijd / uitje", OTHER_LABEL] },
    { label: "Huishouden", sub: ["Schoonmaken", "Boodschappen doen", "Koken", "Wassen / opruimen", "Administratie / regelen", OTHER_LABEL] },
    { label: "Eten", sub: ["Ontbijt", "Lunch", "Avondeten", "Tussendoortje", OTHER_LABEL] },
    { label: "Actief ontspannen", sub: ["Fietsen", "Wandelen", "Sporten", "Zwemmen", OTHER_LABEL] },
    { label: "Ontspannen (passief)", sub: ["Lezen", "Serie of film kijken", "Gamen", OTHER_LABEL] },
    { label: "Met familie/vrienden", sub: ["Samen eten", "Kletsen & ontspannen", "Activiteit samen", "Bellen", OTHER_LABEL] },
    { label: "Slaap / net wakker", sub: ["Net wakker", "Net naar bed", "Powernap overdag", OTHER_LABEL] },
    OTHER_LABEL
  ];
  var GSCHEMA_EMOTIONS = [
    "angst", "boos", "verdrietig", "somber", "gespannen",
    "nerveus", "schaamte", "schuldig", "machteloos", "opgelucht", "blij"
  ];

  var GSCHEMA_STEPS = [
    { key: "gebeurtenis", text: "Wat gebeurde er precies?", type: "text",
      hint: "Beschrijf zo feitelijk als een camera — zonder interpretatie of gevoel.",
      placeholder: "Bijv. 'Ik ontving een e-mail van mijn baas dat ik langs moest komen.'" },
    { key: "gedachten", text: "Welke gedachten schoten er door je hoofd?", type: "text",
      hint: "Schrijf de automatische gedachte concreet uit — niet als vraag, maar als het ergste scenario.",
      placeholder: "Bijv. 'Ik word ontslagen.' of 'Niemand mag me echt.'" },
    { key: "gevoel", text: "Wat voelde je, en hoe intens?", type: "emotion" },
    { key: "gedrag", text: "Wat deed je, of wat had je de neiging te doen?", type: "text",
      hint: "",
      placeholder: "Bijv. 'Ik liep weg.' of 'Ik zei niets en deed alsof er niets was.'" },
    { key: "gevolg", text: "Wat was het gevolg?", type: "text",
      hint: "",
      placeholder: "Bijv. 'Ik voelde me daarna opgelucht, maar ook schuldig.'" }
  ];

  var QUESTIONS = [
    { key: "activity", text: "Wat ben je op dit moment aan het doen?", type: "select" },
    { key: "context", text: "Wil je je antwoord nog toelichten? (optioneel)", type: "text", optional: true, placeholder: "Bijv. meer details over de situatie…" },
    { key: "stress", text: "Hoe hoog is je stressniveau op dit moment?", type: "scale", lo: "Geen stress", hi: "Extreem veel stress" },
    { key: "fatigue", text: "Hoe vermoeid voel je je op dit moment?", type: "scale", lo: "Niet vermoeid", hi: "Extreem vermoeid" }
  ];

  var state = {
    view: "home",
    slot: null,
    qIndex: 0,
    answers: {},
    gStep: 0,
    gAnswers: {},
    gSelectedEmotions: [],
    gIntensity: 50
  };

  // ---------- date / storage helpers ----------

  function pad(n) { return n < 10 ? "0" + n : "" + n; }

  function dateKeyFor(d) {
    return pad(d.getDate()) + "-" + pad(d.getMonth() + 1) + "-" + d.getFullYear();
  }

  function todayKey() { return dateKeyFor(new Date()); }

  var DAY_ABBR = ["Zo", "Ma", "Di", "Wo", "Do", "Vr", "Za"];

  function todayShortLabel() {
    var d = new Date();
    return DAY_ABBR[d.getDay()] + " " + pad(d.getDate()) + "-" + pad(d.getMonth() + 1);
  }

  function nowHHMM() {
    var d = new Date();
    return pad(d.getHours()) + ":" + pad(d.getMinutes());
  }

  function loadData() {
    try {
      return JSON.parse(localStorage.getItem("measurements") || "{}");
    } catch (e) {
      return {};
    }
  }

  function saveData(data) {
    localStorage.setItem("measurements", JSON.stringify(data));
  }

  function loadConfig() {
    try {
      return JSON.parse(localStorage.getItem("githubConfig") || "{}");
    } catch (e) {
      return {};
    }
  }

  function saveConfig(cfg) {
    localStorage.setItem("githubConfig", JSON.stringify(cfg));
  }

  function loadGschemaData() {
    try { return JSON.parse(localStorage.getItem("gschemaData") || "[]"); }
    catch (e) { return []; }
  }

  function saveGschemaData(data) {
    localStorage.setItem("gschemaData", JSON.stringify(data));
  }

  function getEntry(dateKey, slot) {
    var data = loadData();
    return (data[dateKey] && data[dateKey][slot]) || null;
  }

  function setEntry(dateKey, slot, entry) {
    var data = loadData();
    if (!data[dateKey]) data[dateKey] = {};
    data[dateKey][slot] = entry;
    saveData(data);
  }

  function slotStatus(dateKey, slot) {
    var entry = getEntry(dateKey, slot);
    if (entry) return entry.status; // 'done' | 'skipped'
    if (dateKey === todayKey()) {
      return nowHHMM() >= slot ? "open" : "future";
    }
    return "open";
  }

  function nextOpenSlot(dateKey) {
    for (var i = 0; i < SLOTS.length; i++) {
      if (slotStatus(dateKey, SLOTS[i]) === "open") return SLOTS[i];
    }
    return null;
  }

  // ---------- markdown ----------

  function buildGschemaBlock(entry) {
    var d = new Date(entry.timestamp);
    var timeStr = pad(d.getHours()) + ":" + pad(d.getMinutes());
    function safe(s) { return (s || "").replace(/\r?\n/g, " ").trim(); }
    return "## " + timeStr + "\n\n" +
      "- **Gebeurtenis:** " + safe(entry.gebeurtenis) + "\n" +
      "- **Gedachten:** " + safe(entry.gedachten) + "\n" +
      "- **Gevoel:** " + (entry.gevoelens || []).join(", ") + " (" + entry.intensiteit + "/100)\n" +
      "- **Gedrag:** " + safe(entry.gedrag) + "\n" +
      "- **Gevolg:** " + safe(entry.gevolg);
  }

  function buildBlock(slot, entry) {
    if (entry.status === "skipped") {
      return "## " + slot + "\n\n- *(overgeslagen)*";
    }
    var block =
      "## " + slot + "\n\n" +
      "- **Activiteit:** " + entry.activity + "\n" +
      "- **Stress:** " + entry.stress + "/100\n" +
      "- **Vermoeidheid:** " + entry.fatigue + "/100";
    if (entry.context && entry.context.trim()) {
      block += "\n- **Context:** " + entry.context.trim();
    }
    return block;
  }

  function buildHeader(dateKey) {
    return "# Metingen " + dateKey;
  }

  function buildFullDayMarkdown(dateKey) {
    var data = loadData();
    var dayData = data[dateKey] || {};
    var blocks = [];
    SLOTS.forEach(function (slot) {
      var entry = dayData[slot];
      if (entry) blocks.push(buildBlock(slot, entry));
    });
    var md = buildHeader(dateKey);
    if (blocks.length) md += "\n\n" + blocks.join("\n\n");
    return md + "\n";
  }

  // ---------- base64 utf-8 helpers ----------

  function utf8ToBase64(str) {
    return btoa(unescape(encodeURIComponent(str)));
  }

  function base64ToUtf8(b64) {
    return decodeURIComponent(escape(atob(b64.replace(/\n/g, ""))));
  }

  // ---------- GitHub sync ----------

  var syncState = { status: "idle", message: "" }; // idle | pending | syncing | synced | error

  function pendingCount() {
    var data = loadData();
    var n = 0;
    Object.keys(data).forEach(function (dk) {
      Object.keys(data[dk]).forEach(function (slot) {
        if (!data[dk][slot].synced) n++;
      });
    });
    n += loadGschemaData().filter(function (e) { return !e.synced; }).length;
    return n;
  }

  function updateStatusDot() {
    var dot = document.getElementById("statusDot");
    if (!dot) return;
    var allDone = nextOpenSlot(todayKey()) === null;
    dot.className = "status-dot" + (allDone ? " all-done" : "");
    dot.title = allDone ? "Alle metingen van vandaag zijn afgehandeld" : "Er staat nog een meting open vandaag";
  }

  function updateSyncBadge() {
    var badge = document.getElementById("syncBadge");
    if (!badge) return;
    var n = pendingCount();
    var cfg = loadConfig();
    if (!cfg.token) {
      badge.textContent = "⚙️ niet ingesteld";
      badge.className = "sync-badge";
    } else if (syncState.status === "error") {
      badge.textContent = "⚠️ fout";
      badge.className = "sync-badge error";
    } else if (n > 0) {
      badge.textContent = "⏳ wacht (" + n + ")";
      badge.className = "sync-badge pending";
    } else {
      badge.textContent = "✅ gesynct";
      badge.className = "sync-badge";
    }
  }

  function githubHeaders(cfg) {
    return {
      Authorization: "token " + cfg.token,
      Accept: "application/vnd.github+json"
    };
  }

  function ghGetFile(cfg, path) {
    var url = "https://api.github.com/repos/" + cfg.owner + "/" + cfg.repo + "/contents/" + path;
    return fetch(url, { headers: githubHeaders(cfg) }).then(function (res) {
      if (res.status === 404) return { exists: false, content: "", sha: null };
      if (!res.ok) return res.json().then(function (j) { throw new Error(j.message || ("HTTP " + res.status)); });
      return res.json().then(function (j) {
        return { exists: true, content: base64ToUtf8(j.content), sha: j.sha };
      });
    });
  }

  function ghPutFile(cfg, path, content, sha, message) {
    var url = "https://api.github.com/repos/" + cfg.owner + "/" + cfg.repo + "/contents/" + path;
    var body = { message: message, content: utf8ToBase64(content) };
    if (sha) body.sha = sha;
    return fetch(url, {
      method: "PUT",
      headers: Object.assign({ "Content-Type": "application/json" }, githubHeaders(cfg)),
      body: JSON.stringify(body)
    }).then(function (res) {
      if (!res.ok) return res.json().then(function (j) { throw new Error(j.message || ("HTTP " + res.status)); });
      return res.json();
    });
  }

  function getPendingByDate() {
    var data = loadData();
    var byDate = {};
    Object.keys(data).forEach(function (dk) {
      SLOTS.forEach(function (slot) {
        var entry = data[dk][slot];
        if (entry && !entry.synced) {
          byDate[dk] = byDate[dk] || [];
          byDate[dk].push(slot);
        }
      });
    });
    return byDate;
  }

  var syncing = false;

  function processSyncQueue() {
    var cfg = loadConfig();
    if (!cfg.token || !cfg.owner || !cfg.repo) {
      updateSyncBadge();
      return Promise.resolve();
    }
    if (syncing) return Promise.resolve();
    var byDate = getPendingByDate();
    var dateKeys = Object.keys(byDate);
    var pendingG = loadGschemaData().filter(function (e) { return !e.synced; });
    var gByDate = {};
    pendingG.forEach(function (e) { gByDate[e.dateKey] = true; });
    var gDateKeys = Object.keys(gByDate);
    if (!dateKeys.length && !gDateKeys.length) {
      syncState.status = "synced";
      updateSyncBadge();
      return Promise.resolve();
    }
    syncing = true;
    syncState.status = "syncing";
    updateSyncBadge();

    var chain = Promise.resolve();
    dateKeys.forEach(function (dk) {
      chain = chain.then(function () { return syncOneDate(cfg, dk, byDate[dk]); });
    });
    gDateKeys.forEach(function (dk) {
      chain = chain.then(function () { return syncOneGschemaDate(cfg, dk); });
    });

    return chain
      .then(function () {
        syncState.status = "synced";
        syncState.message = "";
      })
      .catch(function (err) {
        syncState.status = "error";
        syncState.message = err.message || String(err);
      })
      .then(function () {
        syncing = false;
        updateSyncBadge();
        if (state.view === "settings" || state.view === "confirm" || state.view === "gschema-confirm") renderView();
      });
  }

  function syncOneGschemaDate(cfg, dateKey) {
    var path = "gschema-" + dateKey + ".md";
    var allData = loadGschemaData();
    var pending = allData.filter(function (e) { return e.dateKey === dateKey && !e.synced; });
    if (!pending.length) return Promise.resolve();
    return ghGetFile(cfg, path).then(function (file) {
      var content = file.exists ? file.content.replace(/\s+$/, "") : "# G-schema " + dateKey;
      var changed = false;
      pending.forEach(function (entry) {
        var d = new Date(entry.timestamp);
        var timeStr = pad(d.getHours()) + ":" + pad(d.getMinutes());
        var heading = "## " + timeStr;
        if (new RegExp("^" + heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$", "m").test(content)) {
          entry.synced = true;
          return;
        }
        content += "\n\n" + buildGschemaBlock(entry);
        changed = true;
        entry.synced = true;
      });
      saveGschemaData(allData);
      if (!changed) return Promise.resolve();
      return ghPutFile(cfg, path, content + "\n", file.sha, "G-schema " + dateKey);
    }).catch(function (err) {
      pending.forEach(function (entry) { entry.synced = false; });
      saveGschemaData(allData);
      throw err;
    });
  }

  // Vervangt het bestaande blok voor dit tijdvak, of null als het kopje niet bestaat.
  // Nodig omdat een meting opnieuw ingevuld kan worden (bijv. na per ongeluk overslaan).
  function replaceBlock(content, slot, newBlock) {
    var lines = content.split("\n");
    var startIdx = -1;
    var endIdx = lines.length;
    for (var i = 0; i < lines.length; i++) {
      if (startIdx === -1 && lines[i].trim() === "## " + slot) { startIdx = i; continue; }
      if (startIdx !== -1 && /^## /.test(lines[i].trim())) { endIdx = i; break; }
    }
    if (startIdx === -1) return null;
    var before = lines.slice(0, startIdx).join("\n").replace(/\s+$/, "");
    var after = lines.slice(endIdx).join("\n").replace(/^\s+/, "");
    return before + "\n\n" + newBlock + (after ? "\n\n" + after : "");
  }

  function syncOneDate(cfg, dateKey, slots) {
    var path = "metingen-" + dateKey + ".md";
    return ghGetFile(cfg, path).then(function (file) {
      var content = file.exists ? file.content.replace(/\s+$/, "") : buildHeader(dateKey);
      var changed = false;
      slots.forEach(function (slot) {
        var entry = getEntry(dateKey, slot);
        if (!entry) return;
        var newBlock = buildBlock(slot, entry);
        var replaced = replaceBlock(content, slot, newBlock);
        if (replaced === null) {
          content += "\n\n" + newBlock;
          changed = true;
        } else if (replaced !== content) {
          content = replaced;
          changed = true;
        }
        entry.synced = true;
        setEntry(dateKey, slot, entry);
      });
      if (!changed) return Promise.resolve();
      var msg = "Meting(en) " + dateKey + ": " + slots.join(", ");
      return ghPutFile(cfg, path, content + "\n", file.sha, msg);
    }).catch(function (err) {
      // mark these entries as not synced again so they retry later
      slots.forEach(function (slot) {
        var entry = getEntry(dateKey, slot);
        if (entry) { entry.synced = false; setEntry(dateKey, slot, entry); }
      });
      throw err;
    });
  }

  function testConnection(cfg) {
    var url = "https://api.github.com/repos/" + cfg.owner + "/" + cfg.repo;
    return fetch(url, { headers: githubHeaders(cfg) }).then(function (res) {
      if (!res.ok) return res.json().then(function (j) { throw new Error(j.message || ("HTTP " + res.status)); });
      return true;
    });
  }

  // ---------- rendering ----------

  var viewEl;

  function h(tag, attrs, children) {
    var el = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      if (k === "class") el.className = attrs[k];
      else if (k.indexOf("on") === 0) el.addEventListener(k.slice(2), attrs[k]);
      else el.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) {
      if (typeof c === "string") el.appendChild(document.createTextNode(c));
      else if (c) el.appendChild(c);
    });
    return el;
  }

  function showToast(msg) {
    var existing = document.querySelector(".toast");
    if (existing) existing.remove();
    var t = h("div", { class: "toast" }, [msg]);
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 2600);
  }

  function renderView() {
    viewEl.innerHTML = "";
    if (state.view === "home") viewEl.appendChild(renderHome());
    else if (state.view === "question") viewEl.appendChild(renderQuestion());
    else if (state.view === "confirm") viewEl.appendChild(renderConfirm());
    else if (state.view === "settings") viewEl.appendChild(renderSettings());
    else if (state.view === "gschema") viewEl.appendChild(renderGschema());
    else if (state.view === "gschema-confirm") viewEl.appendChild(renderGschemaConfirm());
    updateSyncBadge();
    updateStatusDot();
  }

  function statusLabel(status) {
    return { open: "Nu invullen", future: "Nog niet aan de beurt", done: "Ingevuld", skipped: "Overgeslagen" }[status];
  }

  function renderHome() {
    var dk = todayKey();
    var next = nextOpenSlot(dk);
    var wrap = h("div", {}, []);
    wrap.appendChild(h("p", { class: "date-title" }, [todayShortLabel()]));

    var list = h("div", { class: "slot-list" }, []);
    SLOTS.forEach(function (slot) {
      var status = slotStatus(dk, slot);
      var row = h("button", {
        class: "slot-row" + (slot === next ? " next" : ""),
        onclick: function () { openSlot(slot); }
      }, [
        h("span", { class: "slot-time" }, [slot]),
        h("span", { class: "slot-status status-" + status }, [statusLabel(status)])
      ]);
      list.appendChild(row);
    });
    wrap.appendChild(h("div", { class: "card" }, [list]));

    if (next) {
      wrap.appendChild(h("button", {
        class: "btn btn-primary",
        onclick: function () { openSlot(next); }
      }, ["Start meting " + next]));
    }

    wrap.appendChild(h("button", {
      class: "btn btn-secondary",
      style: "margin-top:20px;",
      onclick: openGschema
    }, ["Nieuw G-schema invullen"]));

    return wrap;
  }

  function openSlot(slot) {
    state.view = "question";
    state.slot = slot;
    state.qIndex = 0;
    state.answers = {};
    state.activityChoice = null;
    state.activitySubChoice = null;
    state.activityOtherText = "";
    renderView();
  }

  function goHome() {
    state.view = "home";
    state.slot = null;
    state.qIndex = 0;
    state.answers = {};
    state.activityChoice = null;
    state.activitySubChoice = null;
    state.activityOtherText = "";
    state.gStep = 0;
    state.gAnswers = {};
    state.gSelectedEmotions = [];
    state.gIntensity = 50;
    renderView();
  }

  function openGschema() {
    state.view = "gschema";
    state.gStep = 0;
    state.gAnswers = {};
    state.gSelectedEmotions = [];
    state.gIntensity = 50;
    renderView();
  }

  function saveGschemaEntry(answers) {
    var now = new Date();
    var entry = {
      id: now.toISOString(),
      timestamp: now.toISOString(),
      dateKey: todayKey(),
      gebeurtenis: answers.gebeurtenis,
      gedachten: answers.gedachten,
      gevoelens: answers.gevoelens,
      intensiteit: answers.intensiteit,
      gedrag: answers.gedrag,
      gevolg: answers.gevolg,
      synced: false
    };
    var data = loadGschemaData();
    data.push(entry);
    saveGschemaData(data);
    processSyncQueue();
    state.view = "gschema-confirm";
    renderView();
  }

  function renderGschema() {
    var step = GSCHEMA_STEPS[state.gStep];
    var isLast = state.gStep === GSCHEMA_STEPS.length - 1;
    var wrap = h("div", { class: "card question-card" }, []);

    wrap.appendChild(h("button", { class: "link-back", onclick: goHome }, ["← Terug naar overzicht"]));
    wrap.appendChild(h("p", { class: "progress" }, [
      "G-schema · stap " + (state.gStep + 1) + " van " + GSCHEMA_STEPS.length
    ]));
    wrap.appendChild(h("p", { class: "question-text" }, [step.text]));
    if (step.hint) {
      wrap.appendChild(h("p", { class: "help" }, [step.hint]));
    }

    if (step.type === "text") {
      var ta = h("textarea", { rows: "4", placeholder: step.placeholder || "", id: "ginput" }, []);
      ta.value = state.gAnswers[step.key] || "";
      wrap.appendChild(h("div", { class: "field" }, [ta]));
      wrap.appendChild(h("button", {
        class: "btn btn-primary",
        onclick: function () {
          var val = ta.value.trim();
          if (!val) { showToast("Vul dit veld in voordat je verder gaat."); return; }
          state.gAnswers[step.key] = val;
          if (isLast) { saveGschemaEntry(state.gAnswers); }
          else { state.gStep++; renderView(); }
        }
      }, [isLast ? "Opslaan" : "Volgende"]));

    } else if (step.type === "emotion") {
      var grid = h("div", { class: "gevoel-grid" }, []);
      GSCHEMA_EMOTIONS.forEach(function (emotion) {
        var isActive = state.gSelectedEmotions.indexOf(emotion) !== -1;
        var btn = h("button", { class: "gevoel-btn" + (isActive ? " active" : "") }, [emotion]);
        btn.addEventListener("click", function () {
          var idx = state.gSelectedEmotions.indexOf(emotion);
          if (idx === -1) { state.gSelectedEmotions.push(emotion); btn.classList.add("active"); }
          else { state.gSelectedEmotions.splice(idx, 1); btn.classList.remove("active"); }
        });
        grid.appendChild(btn);
      });
      wrap.appendChild(grid);

      var intensityDisplay = h("div", { class: "slider-value" }, [String(state.gIntensity)]);
      var slider = h("input", { type: "range", min: "0", max: "100", step: "1", value: String(state.gIntensity) }, []);
      slider.addEventListener("input", function () {
        state.gIntensity = parseInt(slider.value, 10);
        intensityDisplay.textContent = slider.value;
      });
      wrap.appendChild(h("p", { class: "help", style: "margin:18px 0 4px;font-weight:600;color:var(--ink);" }, ["Intensiteit"]));
      wrap.appendChild(h("div", { class: "slider-wrap" }, [
        intensityDisplay, slider,
        h("div", { class: "scale-labels" }, [h("span", {}, ["Nauwelijks"]), h("span", {}, ["Extreem intens"])])
      ]));
      wrap.appendChild(h("button", {
        class: "btn btn-primary",
        onclick: function () {
          if (!state.gSelectedEmotions.length) { showToast("Selecteer minstens één gevoel."); return; }
          state.gAnswers.gevoelens = state.gSelectedEmotions.slice();
          state.gAnswers.intensiteit = state.gIntensity;
          state.gStep++;
          renderView();
        }
      }, ["Volgende"]));
    }

    if (state.gStep > 0) {
      wrap.appendChild(h("button", {
        class: "btn btn-secondary",
        onclick: function () { state.gStep--; renderView(); }
      }, ["Terug"]));
    }

    return wrap;
  }

  function renderGschemaConfirm() {
    var wrap = h("div", { class: "card" }, []);
    wrap.appendChild(h("p", { class: "confirm-icon" }, ["✅"]));
    wrap.appendChild(h("p", { class: "confirm-text" }, ["G-schema opgeslagen. Goed bezig!"]));
    wrap.appendChild(h("p", { id: "confirmSyncStatus", class: "help", style: "text-align:center;" }, [confirmSyncStatusText()]));
    wrap.appendChild(h("button", { class: "btn btn-primary", onclick: goHome }, ["Terug naar overzicht"]));
    return wrap;
  }

  function renderQuestion() {
    var q = QUESTIONS[state.qIndex];
    var wrap = h("div", { class: "card question-card" }, []);
    wrap.appendChild(h("button", {
      class: "link-back",
      onclick: goHome
    }, ["← Terug naar overzicht"]));
    wrap.appendChild(h("p", { class: "progress" }, ["Meting " + state.slot + " · vraag " + (state.qIndex + 1) + " van " + QUESTIONS.length]));
    wrap.appendChild(h("p", { class: "question-text" }, [q.text]));

    var inputEl;
    var isLast = state.qIndex === QUESTIONS.length - 1;
    var nextLabel = isLast ? "Opslaan" : "Volgende";

    if (q.type === "select") {
      var topLabels = ACTIVITY_OPTIONS.map(function (opt) { return typeof opt === "string" ? opt : opt.label; });

      function getTopOption(label) {
        for (var i = 0; i < ACTIVITY_OPTIONS.length; i++) {
          var o = ACTIVITY_OPTIONS[i];
          if ((typeof o === "string" ? o : o.label) === label) return o;
        }
        return null;
      }

      var select = h("select", { id: "qinput" }, topLabels.map(function (label) {
        return h("option", { value: label }, [label]);
      }));
      var prevChoice = (state.activityChoice && topLabels.indexOf(state.activityChoice) !== -1) ? state.activityChoice : topLabels[0];
      select.value = prevChoice;

      var otherInput = h("input", { type: "text", placeholder: "Typ hier wat je aan het doen was…" }, []);
      otherInput.value = state.activityOtherText || "";
      var otherWrap = h("div", { class: "field" }, [otherInput]);

      var subWrap = h("div", {}, []);
      var subSelect = null;

      function leafValue() {
        return subSelect ? subSelect.value : select.value;
      }

      function refreshOtherVisibility() {
        var isOther = leafValue() === OTHER_LABEL;
        otherWrap.style.display = isOther ? "" : "none";
      }

      function refreshLevel2() {
        subWrap.innerHTML = "";
        subSelect = null;
        var topOpt = getTopOption(select.value);
        if (topOpt && typeof topOpt === "object") {
          var prevSub = (state.activitySubChoice && topOpt.sub.indexOf(state.activitySubChoice) !== -1) ? state.activitySubChoice : topOpt.sub[0];
          subSelect = h("select", {}, topOpt.sub.map(function (s) {
            return h("option", { value: s }, [s]);
          }));
          subSelect.value = prevSub;
          state.activitySubChoice = prevSub;
          subWrap.appendChild(h("div", { class: "field" }, [subSelect]));
          subSelect.addEventListener("change", function () {
            state.activitySubChoice = subSelect.value;
            refreshOtherVisibility();
            if (subSelect.value === OTHER_LABEL) otherInput.focus();
          });
        } else {
          state.activitySubChoice = null;
        }
        refreshOtherVisibility();
      }

      select.addEventListener("change", function () {
        state.activityChoice = select.value;
        state.activitySubChoice = null;
        refreshLevel2();
        if (!subSelect && select.value === OTHER_LABEL) otherInput.focus();
      });

      wrap.appendChild(h("div", { class: "field" }, [select]));
      wrap.appendChild(subWrap);
      wrap.appendChild(otherWrap);
      refreshLevel2();
      state.activityChoice = select.value;

      wrap.appendChild(h("button", {
        class: "btn btn-primary",
        onclick: function () {
          state.activityChoice = select.value;
          state.activitySubChoice = subSelect ? subSelect.value : null;
          state.activityOtherText = otherInput.value.trim();
          var val = leafValue() === OTHER_LABEL ? otherInput.value.trim() : leafValue();
          if (!val) {
            showToast("Vul iets in, of gebruik Overslaan.");
            return;
          }
          state.answers[q.key] = val;
          if (isLast) saveMeasurement(state.slot, state.answers);
          else { state.qIndex++; renderView(); }
        }
      }, [nextLabel]));
    } else if (q.type === "text") {
      inputEl = h("textarea", { rows: "3", placeholder: q.placeholder || "Bijv. aan het werk, in de auto, pauze…", id: "qinput" }, []);
      inputEl.value = state.answers[q.key] || "";
      wrap.appendChild(h("div", { class: "field" }, [inputEl]));

      wrap.appendChild(h("button", {
        class: "btn btn-primary",
        onclick: function () { handleNext(q, inputEl, isLast); }
      }, [nextLabel]));
    } else {
      var initial = state.answers[q.key] !== undefined ? state.answers[q.key] : 30;
      var valueDisplay = h("div", { class: "slider-value", id: "valDisplay" }, [String(initial)]);
      var range = h("input", { type: "range", min: "0", max: "100", step: "1", value: String(initial), id: "qinput" }, []);
      range.addEventListener("input", function () { valueDisplay.textContent = range.value; });
      var labels = h("div", { class: "scale-labels" }, [h("span", {}, [q.lo]), h("span", {}, [q.hi])]);
      wrap.appendChild(h("div", { class: "slider-wrap" }, [valueDisplay, range, labels]));
      inputEl = range;

      wrap.appendChild(h("button", {
        class: "btn btn-primary",
        onclick: function () { handleNext(q, inputEl, isLast); }
      }, [nextLabel]));
    }

    wrap.appendChild(h("button", {
      class: "btn btn-danger-outline",
      onclick: function () { skipCurrent(); }
    }, ["Overslaan"]));

    if (state.qIndex > 0) {
      wrap.appendChild(h("button", {
        class: "btn btn-secondary",
        onclick: function () { state.qIndex--; renderView(); }
      }, ["Terug"]));
    }

    return wrap;
  }

  function handleNext(q, inputEl, isLast) {
    var val = q.type === "text" ? inputEl.value.trim() : parseInt(inputEl.value, 10);
    if (q.type === "text" && !val && !q.optional) {
      showToast("Vul iets in, of gebruik Overslaan.");
      return;
    }
    state.answers[q.key] = val;
    if (isLast) {
      saveMeasurement(state.slot, state.answers);
    } else {
      state.qIndex++;
      renderView();
    }
  }

  function saveMeasurement(slot, answers) {
    var dk = todayKey();
    setEntry(dk, slot, {
      status: "done",
      activity: answers.activity,
      stress: answers.stress,
      fatigue: answers.fatigue,
      context: answers.context || "",
      timestamp: new Date().toISOString(),
      synced: false
    });
    processSyncQueue();
    state.view = "confirm";
    renderView();
  }

  function skipCurrent() {
    var dk = todayKey();
    setEntry(dk, state.slot, {
      status: "skipped",
      timestamp: new Date().toISOString(),
      synced: false
    });
    processSyncQueue();
    state.view = "confirm";
    renderView();
  }

  function renderConfirm() {
    var entry = getEntry(todayKey(), state.slot);
    var wrap = h("div", { class: "card" }, []);
    if (entry && entry.status === "done") {
      wrap.appendChild(h("p", { class: "confirm-icon" }, ["✅"]));
      wrap.appendChild(h("p", { class: "confirm-text" }, ["Meting " + state.slot + " is opgeslagen. Dank je wel!"]));
    } else {
      wrap.appendChild(h("p", { class: "confirm-icon" }, ["⏭️"]));
      wrap.appendChild(h("p", { class: "confirm-text" }, ["Meting " + state.slot + " is overgeslagen."]));
    }
    wrap.appendChild(h("p", { id: "confirmSyncStatus", class: "help", style: "text-align:center;" }, [confirmSyncStatusText()]));
    wrap.appendChild(h("button", {
      class: "btn btn-primary",
      onclick: goHome
    }, ["Terug naar overzicht"]));
    return wrap;
  }

  function confirmSyncStatusText() {
    var cfg = loadConfig();
    if (!cfg.token) return "⚙️ Geen GitHub-sync ingesteld — meting staat alleen lokaal opgeslagen.";
    if (syncState.status === "syncing") return "⏳ Bezig met opslaan naar GitHub… even geduld voordat je de app sluit.";
    if (syncState.status === "error") return "⚠️ Sync mislukt (" + (syncState.message || "onbekende fout") + ") — blijft in de wachtrij en probeert later opnieuw.";
    if (pendingCount() > 0) return "⏳ Nog niet gesynct, wordt opnieuw geprobeerd zodra er verbinding is.";
    return "✅ Opgeslagen op GitHub — veilig om de app te sluiten.";
  }

  function renderSettings() {
    var cfg = loadConfig();
    var wrap = h("div", {}, []);

    var card = h("div", { class: "card" }, []);
    card.appendChild(h("div", { class: "topbar-row-sub", style: "margin-bottom:14px;" }, [
      h("span", { id: "syncBadge", class: "sync-badge", title: "Syncstatus" }, ["…"])
    ]));
    card.appendChild(h("p", { class: "help" }, [
      "Plak hier een fine-grained GitHub Personal Access Token met alleen de permissie ",
      h("strong", {}, ["Contents: Read and write"]),
      " op de privé data-repo. Het token wordt uitsluitend lokaal in dit apparaat opgeslagen (localStorage) en nooit verzonden naar iets anders dan api.github.com."
    ]));

    var ownerInput = h("input", { type: "text", value: cfg.owner || "", placeholder: "GitHub-gebruikersnaam" }, []);
    var repoInput = h("input", { type: "text", value: cfg.repo || "stress-checkin-data", placeholder: "data-repo naam" }, []);
    var tokenInput = h("input", { type: "password", autocomplete: "off", value: cfg.token || "", placeholder: "github_pat_..." }, []);

    card.appendChild(h("div", { class: "field" }, [h("label", {}, ["GitHub-gebruikersnaam"]), ownerInput]));
    card.appendChild(h("div", { class: "field" }, [h("label", {}, ["Data-repo naam"]), repoInput]));
    card.appendChild(h("div", { class: "field" }, [h("label", {}, ["Personal Access Token"]), tokenInput]));

    var statusP = h("p", { class: "help", id: "settingsStatus" }, [syncState.message || ""]);
    card.appendChild(statusP);

    card.appendChild(h("button", {
      class: "btn btn-primary",
      onclick: function () {
        saveConfig({ owner: ownerInput.value.trim(), repo: repoInput.value.trim(), token: tokenInput.value.trim() });
        showToast("Instellingen opgeslagen.");
        testConnection(loadConfig())
          .then(function () { statusP.textContent = "Verbinding met data-repo OK."; updateSyncBadge(); processSyncQueue(); })
          .catch(function (err) { statusP.textContent = "Verbinding mislukt: " + err.message; updateSyncBadge(); });
      }
    }, ["Opslaan & testen"]));

    card.appendChild(h("button", {
      class: "btn btn-secondary",
      onclick: function () { processSyncQueue(); }
    }, ["Nu opnieuw synchroniseren (" + pendingCount() + " openstaand)"]));

    wrap.appendChild(card);

    var trendsLink = h("a", { href: "trends.html", class: "btn btn-secondary", style: "text-decoration:none;text-align:center;" }, ["📊 Bekijk trends"]);
    wrap.appendChild(trendsLink);

    wrap.appendChild(h("button", {
      class: "btn btn-secondary",
      onclick: goHome
    }, ["← Terug"]));

    return wrap;
  }

  // ---------- init ----------

  function init() {
    viewEl = document.getElementById("view");
    document.getElementById("settingsBtn").addEventListener("click", function () {
      state.view = "settings";
      renderView();
    });
    document.getElementById("homeBtn").addEventListener("click", goHome);
    renderView();
    processSyncQueue();
    window.addEventListener("online", processSyncQueue);
    setInterval(processSyncQueue, 60000);
    setInterval(function () { if (state.view === "home") renderView(); }, 30000);

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("sw.js").then(function (reg) {
        reg.update();
      }).catch(function () {});
      var hadController = !!navigator.serviceWorker.controller;
      navigator.serviceWorker.addEventListener("controllerchange", function () {
        if (hadController) location.reload();
      });
    }
  }

  document.addEventListener("DOMContentLoaded", init);

  // expose for manual testing in console
  window.__stressApp = { buildFullDayMarkdown: buildFullDayMarkdown, buildBlock: buildBlock, buildHeader: buildHeader, replaceBlock: replaceBlock };
})();
