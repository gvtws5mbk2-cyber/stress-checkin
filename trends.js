(function () {
  "use strict";

  // Anti-clickjacking: deze pagina bewaart een token, dus nooit in een iframe draaien.
  if (window.self !== window.top) {
    try { window.top.location = window.location; }
    catch (e) { document.documentElement.style.display = "none"; }
  }

  var SLOTS = ["09:00", "11:00", "13:00", "15:00", "17:00", "19:00", "21:00"];

  var state = {
    loading: false,
    error: "",
    entries: null,
    gschema: null,
    daysLoaded: 0,
    gschemaLoaded: 0
  };

  // ---------- config (separate from the main app's read/write token) ----------

  function loadConfig() {
    try { return JSON.parse(localStorage.getItem("trendsConfig") || "{}"); }
    catch (e) { return {}; }
  }

  function saveConfig(cfg) {
    localStorage.setItem("trendsConfig", JSON.stringify(cfg));
  }

  function loadAppConfigFallback() {
    try { return JSON.parse(localStorage.getItem("githubConfig") || "{}"); }
    catch (e) { return {}; }
  }

  // ---------- GitHub read-only access ----------

  function githubHeaders(cfg) {
    return {
      Authorization: "token " + cfg.token,
      Accept: "application/vnd.github+json"
    };
  }

  function base64ToUtf8(b64) {
    return decodeURIComponent(escape(atob(b64.replace(/\n/g, ""))));
  }

  function parseLinkHeader(header) {
    var next = null;
    if (!header) return next;
    header.split(",").forEach(function (part) {
      var m = part.match(/<([^>]+)>;\s*rel="next"/);
      if (m) next = m[1];
    });
    return next;
  }

  function listDataFiles(cfg) {
    var files = [];
    function fetchPage(url) {
      return fetch(url, { headers: githubHeaders(cfg) }).then(function (res) {
        if (!res.ok) return res.json().then(function (j) { throw new Error(j.message || ("HTTP " + res.status)); });
        var next = parseLinkHeader(res.headers.get("Link"));
        return res.json().then(function (items) {
          files = files.concat(items);
          if (next) return fetchPage(next);
        });
      });
    }
    var startUrl = "https://api.github.com/repos/" + cfg.owner + "/" + cfg.repo + "/contents/?per_page=100";
    return fetchPage(startUrl).then(function () {
      return {
        metingen: files.filter(function (it) {
          return it.type === "file" && /^metingen-\d{2}-\d{2}-\d{4}\.md$/.test(it.name);
        }),
        gschema: files.filter(function (it) {
          return it.type === "file" && /^gschema-\d{2}-\d{2}-\d{4}\.md$/.test(it.name);
        })
      };
    });
  }

  function fetchFileContent(cfg, path) {
    var url = "https://api.github.com/repos/" + cfg.owner + "/" + cfg.repo + "/contents/" + path;
    return fetch(url, { headers: githubHeaders(cfg) }).then(function (res) {
      if (!res.ok) return res.json().then(function (j) { throw new Error(j.message || ("HTTP " + res.status)); });
      return res.json();
    }).then(function (j) { return base64ToUtf8(j.content); });
  }

  function parseDateFromFilename(name) {
    var m = name.match(/^metingen-(\d{2})-(\d{2})-(\d{4})\.md$/);
    if (!m) return null;
    return { dateKey: m[1] + "-" + m[2] + "-" + m[3], sortKey: m[3] + m[2] + m[1] };
  }

  function parseDateFromGschemaFilename(name) {
    var m = name.match(/^gschema-(\d{2})-(\d{2})-(\d{4})\.md$/);
    if (!m) return null;
    return { dateKey: m[1] + "-" + m[2] + "-" + m[3], sortKey: m[3] + m[2] + m[1] };
  }

  function parseGschemaMarkdown(content, dateInfo) {
    var entries = [];
    var blocks = content.split(/^## /m).slice(1);
    blocks.forEach(function (block) {
      var lines = block.split("\n");
      var time = (lines[0] || "").trim();
      var body = lines.slice(1).join("\n");
      var gM = body.match(/\*\*Gebeurtenis:\*\*\s*(.+)/);
      var gtM = body.match(/\*\*Gedachten:\*\*\s*(.+)/);
      var gevM = body.match(/\*\*Gevoel:\*\*\s*(.+)/);
      var gedM = body.match(/\*\*Gedrag:\*\*\s*(.+)/);
      var gvlM = body.match(/\*\*Gevolg:\*\*\s*(.+)/);
      if (!gM || !gtM || !gevM || !gedM || !gvlM) return;
      entries.push({
        dateKey: dateInfo.dateKey,
        sortKey: dateInfo.sortKey,
        time: time,
        gebeurtenis: gM[1].trim(),
        gedachten: gtM[1].trim(),
        gevoel: gevM[1].trim(),
        gedrag: gedM[1].trim(),
        gevolg: gvlM[1].trim()
      });
    });
    return entries;
  }

  function parseMeasurementsMarkdown(content, dateInfo) {
    var entries = [];
    var blocks = content.split(/^## /m).slice(1);
    blocks.forEach(function (block) {
      var lines = block.split("\n");
      var slot = (lines[0] || "").trim();
      var body = lines.slice(1).join("\n");
      if (/\(overgeslagen\)/.test(body)) {
        entries.push({ dateKey: dateInfo.dateKey, sortKey: dateInfo.sortKey, slot: slot, skipped: true });
        return;
      }
      var activityM = body.match(/\*\*Activiteit:\*\*\s*(.+)/);
      var stressM = body.match(/\*\*Stress:\*\*\s*(\d+)/);
      var fatigueM = body.match(/\*\*Vermoeidheid:\*\*\s*(\d+)/);
      var contextM = body.match(/\*\*Context:\*\*\s*(.+)/);
      if (!activityM || !stressM || !fatigueM) return;
      entries.push({
        dateKey: dateInfo.dateKey,
        sortKey: dateInfo.sortKey,
        slot: slot,
        skipped: false,
        activity: activityM[1].trim(),
        stress: parseInt(stressM[1], 10),
        fatigue: parseInt(fatigueM[1], 10),
        context: contextM ? contextM[1].trim() : ""
      });
    });
    return entries;
  }

  function loadAllData(cfg) {
    return listDataFiles(cfg).then(function (result) {
      state.daysLoaded = result.metingen.length;
      state.gschemaLoaded = result.gschema.length;
      var chain = Promise.resolve();
      var allEntries = [];
      var allGschema = [];
      result.metingen.forEach(function (file) {
        chain = chain.then(function () {
          var dateInfo = parseDateFromFilename(file.name);
          if (!dateInfo) return;
          return fetchFileContent(cfg, file.path).then(function (content) {
            allEntries = allEntries.concat(parseMeasurementsMarkdown(content, dateInfo));
          });
        });
      });
      result.gschema.forEach(function (file) {
        chain = chain.then(function () {
          var dateInfo = parseDateFromGschemaFilename(file.name);
          if (!dateInfo) return;
          return fetchFileContent(cfg, file.path).then(function (content) {
            allGschema = allGschema.concat(parseGschemaMarkdown(content, dateInfo));
          });
        });
      });
      return chain.then(function () { return { entries: allEntries, gschema: allGschema }; });
    });
  }

  // ---------- aggregation ----------

  function average(sum, count) {
    return count ? Math.round((sum / count) * 10) / 10 : null;
  }

  function aggregateByKey(entries, keyFn) {
    var map = {};
    entries.forEach(function (e) {
      if (e.skipped) return;
      var k = keyFn(e);
      if (!map[k]) map[k] = { key: k, count: 0, stressSum: 0, fatigueSum: 0 };
      map[k].count++;
      map[k].stressSum += e.stress;
      map[k].fatigueSum += e.fatigue;
    });
    return Object.keys(map).map(function (k) {
      var m = map[k];
      return { key: k, count: m.count, avgStress: average(m.stressSum, m.count), avgFatigue: average(m.fatigueSum, m.count) };
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
    setTimeout(function () { t.remove(); }, 3200);
  }

  function barRow(label, count, avgStress, avgFatigue) {
    return h("div", { class: "trend-row" }, [
      h("div", { class: "trend-label" }, [label + " (" + count + "×)"]),
      h("div", { class: "bar-track" }, [
        h("div", { class: "bar-fill bar-stress", style: "width:" + (avgStress || 0) + "%;" }, []),
      ]),
      h("div", { class: "bar-caption" }, ["Stress " + (avgStress != null ? avgStress : "–") + "/100"]),
      h("div", { class: "bar-track" }, [
        h("div", { class: "bar-fill bar-fatigue", style: "width:" + (avgFatigue || 0) + "%;" }, []),
      ]),
      h("div", { class: "bar-caption" }, ["Vermoeidheid " + (avgFatigue != null ? avgFatigue : "–") + "/100"])
    ]);
  }

  function renderSettingsCard(cfg) {
    var card = h("div", { class: "card" }, []);
    card.appendChild(h("p", { class: "help" }, [
      "Plak hier een GitHub Personal Access Token met (read-only is voldoende) toegang tot ",
      h("strong", {}, ["Contents"]),
      " op de data-repo. Dit token wordt los van het token in de hoofd-app bewaard, alléén lokaal in dit apparaat."
    ]));
    var ownerInput = h("input", { type: "text", value: cfg.owner || "", placeholder: "GitHub-gebruikersnaam" }, []);
    var repoInput = h("input", { type: "text", value: cfg.repo || "stress-checkin-data", placeholder: "data-repo naam" }, []);
    var tokenInput = h("input", { type: "password", autocomplete: "off", value: cfg.token || "", placeholder: "github_pat_..." }, []);
    card.appendChild(h("div", { class: "field" }, [h("label", {}, ["GitHub-gebruikersnaam"]), ownerInput]));
    card.appendChild(h("div", { class: "field" }, [h("label", {}, ["Data-repo naam"]), repoInput]));
    card.appendChild(h("div", { class: "field" }, [h("label", {}, ["Personal Access Token (read-only)"]), tokenInput]));
    card.appendChild(h("button", {
      class: "btn btn-primary",
      onclick: function () {
        var newCfg = { owner: ownerInput.value.trim(), repo: repoInput.value.trim(), token: tokenInput.value.trim() };
        if (!newCfg.owner || !newCfg.repo || !newCfg.token) {
          showToast("Vul GitHub-gebruikersnaam, repo-naam en token allemaal in.");
          return;
        }
        saveConfig(newCfg);
        showToast("Instellingen opgeslagen, data wordt geladen…");
        loadAndRender(newCfg);
      }
    }, ["Opslaan & laden"]));
    return card;
  }

  function renderView() {
    viewEl.innerHTML = "";
    var cfg = loadConfig();

    if (!cfg.token) {
      var fallback = loadAppConfigFallback();
      if (fallback.owner || fallback.repo) {
        cfg.owner = cfg.owner || fallback.owner;
        cfg.repo = cfg.repo || fallback.repo;
      }
    }

    viewEl.appendChild(renderSettingsCard(cfg));

    if (state.loading) {
      viewEl.appendChild(h("div", { class: "card" }, [h("p", { class: "confirm-text" }, ["Data wordt geladen…"])]));
      return;
    }
    if (state.error) {
      viewEl.appendChild(h("div", { class: "card" }, [h("p", { style: "color:var(--danger);font-weight:600;margin:0;" }, ["⚠️ Fout bij laden: " + state.error])]));
      return;
    }
    if (!state.entries) {
      return;
    }

    var entries = state.entries;
    var filled = entries.filter(function (e) { return !e.skipped; });

    if (!filled.length) {
      viewEl.appendChild(h("div", { class: "card" }, [h("p", { class: "confirm-text" }, ["Nog geen ingevulde metingen gevonden in " + state.daysLoaded + " dagbestand(en)."])]));
      return;
    }

    // per activiteit
    var byActivity = aggregateByKey(filled, function (e) { return e.activity; })
      .sort(function (a, b) { return b.count - a.count; });
    var activityCard = h("div", { class: "card" }, [h("p", { class: "date-title", style: "font-size:1.3rem;" }, ["Per activiteit"])]);
    byActivity.forEach(function (row) {
      activityCard.appendChild(barRow(row.key, row.count, row.avgStress, row.avgFatigue));
    });
    viewEl.appendChild(activityCard);

    // per tijdvak
    var bySlot = aggregateByKey(filled, function (e) { return e.slot; });
    var slotMap = {};
    bySlot.forEach(function (r) { slotMap[r.key] = r; });
    var slotCard = h("div", { class: "card" }, [h("p", { class: "date-title", style: "font-size:1.3rem;" }, ["Per tijdvak"])]);
    SLOTS.forEach(function (slot) {
      var row = slotMap[slot];
      if (row) slotCard.appendChild(barRow(slot, row.count, row.avgStress, row.avgFatigue));
    });
    viewEl.appendChild(slotCard);

    // context-aantekeningen
    var withContext = filled.filter(function (e) { return e.context; })
      .sort(function (a, b) { return (b.sortKey + b.slot) < (a.sortKey + a.slot) ? -1 : 1; });
    if (withContext.length) {
      var contextCard = h("div", { class: "card" }, [h("p", { class: "date-title", style: "font-size:1.3rem;" }, ["Context-aantekeningen"])]);
      withContext.forEach(function (e) {
        contextCard.appendChild(h("div", { class: "summary-block", style: "margin-bottom:10px;" }, [
          h("p", { style: "margin:0 0 4px;font-weight:600;" }, [e.dateKey + " · " + e.slot + " · " + e.activity]),
          h("p", { style: "margin:0;" }, [e.context])
        ]));
      });
      viewEl.appendChild(contextCard);
    }

    // G-schema entries (meest recent eerst)
    if (state.gschema && state.gschema.length) {
      var sortedG = state.gschema.slice().sort(function (a, b) {
        var aKey = a.sortKey + (a.time || "");
        var bKey = b.sortKey + (b.time || "");
        return bKey < aKey ? -1 : bKey > aKey ? 1 : 0;
      });
      var gCard = h("div", { class: "card" }, [
        h("p", { class: "date-title", style: "font-size:1.3rem;" }, ["G-schema's"])
      ]);
      sortedG.forEach(function (e) {
        var block = h("div", { class: "gschema-entry" }, [
          h("p", { style: "margin:0 0 6px;font-weight:600;font-size:0.85rem;color:var(--muted);" }, [e.dateKey + " · " + e.time]),
          h("p", { style: "margin:0 0 4px;" }, [h("strong", {}, ["Gevoel:"]), " " + e.gevoel]),
          h("p", { style: "margin:0 0 4px;" }, [h("strong", {}, ["Gebeurtenis:"]), " " + e.gebeurtenis]),
          h("p", { style: "margin:0 0 4px;" }, [h("strong", {}, ["Gedachten:"]), " " + e.gedachten]),
          h("p", { style: "margin:0 0 4px;" }, [h("strong", {}, ["Gedrag:"]), " " + e.gedrag]),
          h("p", { style: "margin:0;" }, [h("strong", {}, ["Gevolg:"]), " " + e.gevolg])
        ]);
        gCard.appendChild(block);
      });
      viewEl.appendChild(gCard);
    }

    viewEl.appendChild(h("p", { class: "help", style: "text-align:center;" }, [
      filled.length + " ingevulde metingen over " + state.daysLoaded + " dagbestand(en)."
    ]));
  }

  function loadAndRender(cfg) {
    if (!cfg.owner || !cfg.repo || !cfg.token) return;
    state.loading = true;
    state.error = "";
    renderView();
    loadAllData(cfg)
      .then(function (result) {
        state.entries = result.entries;
        state.gschema = result.gschema;
        state.loading = false;
        renderView();
      })
      .catch(function (err) {
        state.error = err.message || String(err);
        state.loading = false;
        renderView();
      });
  }

  function init() {
    viewEl = document.getElementById("view");
    renderView();
    var cfg = loadConfig();
    if (cfg.token && cfg.owner && cfg.repo) loadAndRender(cfg);
  }

  document.addEventListener("DOMContentLoaded", init);
})();
