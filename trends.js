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
    gschemaLoaded: 0,
    tab: "activiteiten",
    showSettings: false
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
      var intM = gevM[1].match(/\((\d+)\/100\)/);
      entries.push({
        dateKey: dateInfo.dateKey,
        sortKey: dateInfo.sortKey,
        time: time,
        gebeurtenis: gM[1].trim(),
        gedachten: gtM[1].trim(),
        gevoel: gevM[1].trim(),
        intensiteit: intM ? parseInt(intM[1], 10) : null,
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

  function dailyAverages(filled) {
    var map = {};
    filled.forEach(function (e) {
      if (!map[e.sortKey]) map[e.sortKey] = { sortKey: e.sortKey, dateKey: e.dateKey, n: 0, s: 0, f: 0 };
      map[e.sortKey].n++;
      map[e.sortKey].s += e.stress;
      map[e.sortKey].f += e.fatigue;
    });
    return Object.keys(map).sort().map(function (k) {
      var d = map[k];
      return { sortKey: d.sortKey, dateKey: d.dateKey, avgStress: d.s / d.n, avgFatigue: d.f / d.n };
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

  var SVG_NS = "http://www.w3.org/2000/svg";

  function hs(tag, attrs, children) {
    var el = document.createElementNS(SVG_NS, tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) { el.setAttribute(k, attrs[k]); });
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

  function cardTitle(text) {
    return h("p", { class: "date-title", style: "font-size:1.3rem;" }, [text]);
  }

  function shortDate(dateKey) {
    return dateKey.slice(0, 5); // dd-mm
  }

  // ---------- overzicht: lijngrafiek ----------

  function legendItem(color, label) {
    return h("span", {}, [
      h("span", { class: "legend-dot", style: "background:" + color + ";" }, []),
      label
    ]);
  }

  function lineChartCard(filled, gschema) {
    var card = h("div", { class: "card" }, [cardTitle("Verloop per dag")]);
    var days = dailyAverages(filled).slice(-31);

    if (days.length < 2) {
      card.appendChild(h("p", { class: "help" }, [
        "Zodra er metingen van twee of meer dagen zijn, verschijnt hier het verloop van je stress en vermoeidheid."
      ]));
      return card;
    }

    var W = 340, H = 190;
    var padL = 30, padR = 10, padT = 12, padB = 26;
    var innerW = W - padL - padR;
    var innerH = H - padT - padB;
    var n = days.length;

    function x(i) { return padL + (n === 1 ? innerW / 2 : i * innerW / (n - 1)); }
    function y(v) { return padT + (1 - v / 100) * innerH; }

    var svg = hs("svg", { viewBox: "0 0 " + W + " " + H, width: "100%", role: "img", "aria-label": "Lijngrafiek van stress en vermoeidheid per dag" }, []);

    // gridlijnen + y-labels
    [0, 25, 50, 75, 100].forEach(function (v) {
      svg.appendChild(hs("line", {
        x1: padL, y1: y(v), x2: W - padR, y2: y(v),
        style: "stroke:rgba(46,42,34,0.08);stroke-width:1;"
      }, []));
    });
    [0, 50, 100].forEach(function (v) {
      svg.appendChild(hs("text", {
        x: padL - 6, y: y(v) + 3, "text-anchor": "end",
        style: "font-size:9px;fill:var(--muted);font-family:var(--sans);"
      }, [String(v)]));
    });

    // x-labels: eerste en laatste dag
    svg.appendChild(hs("text", {
      x: x(0), y: H - 8, "text-anchor": "start",
      style: "font-size:9px;fill:var(--muted);font-family:var(--sans);"
    }, [shortDate(days[0].dateKey)]));
    svg.appendChild(hs("text", {
      x: x(n - 1), y: H - 8, "text-anchor": "end",
      style: "font-size:9px;fill:var(--muted);font-family:var(--sans);"
    }, [shortDate(days[n - 1].dateKey)]));

    // lijnen
    function polyline(valueFn, color, width) {
      var pts = days.map(function (d, i) { return x(i) + "," + y(valueFn(d)); }).join(" ");
      return hs("polyline", {
        points: pts,
        style: "fill:none;stroke:" + color + ";stroke-width:" + width + ";stroke-linejoin:round;stroke-linecap:round;"
      }, []);
    }
    svg.appendChild(polyline(function (d) { return d.avgFatigue; }, "var(--sage)", 2));
    svg.appendChild(polyline(function (d) { return d.avgStress; }, "var(--gold)", 2.5));

    // datapunten
    days.forEach(function (d, i) {
      svg.appendChild(hs("circle", { cx: x(i), cy: y(d.avgFatigue), r: 2.5, style: "fill:var(--sage);" }, []));
      svg.appendChild(hs("circle", { cx: x(i), cy: y(d.avgStress), r: 2.5, style: "fill:var(--gold);" }, []));
    });

    // G-schema-momenten (angst/paniek) als losse markers
    var dayIndex = {};
    days.forEach(function (d, i) { dayIndex[d.dateKey] = i; });
    var markers = (gschema || []).filter(function (g) { return dayIndex[g.dateKey] !== undefined; });
    markers.forEach(function (g) {
      var v = g.intensiteit !== null ? g.intensiteit : 95;
      var c = hs("circle", {
        cx: x(dayIndex[g.dateKey]), cy: y(v), r: 4,
        style: "fill:var(--danger);stroke:var(--card);stroke-width:1.5;"
      }, []);
      c.appendChild(hs("title", {}, [g.dateKey + " " + g.time + " · " + g.gevoel]));
      svg.appendChild(c);
    });

    card.appendChild(svg);

    var legend = h("div", { class: "chart-legend" }, [
      legendItem("var(--gold)", "Stress"),
      legendItem("var(--sage)", "Vermoeidheid")
    ]);
    if (markers.length) legend.appendChild(legendItem("var(--danger)", "Angst/paniek-moment"));
    card.appendChild(legend);

    if (dailyAverages(filled).length > 31) {
      card.appendChild(h("p", { class: "help" }, ["Laatste 31 dagen met metingen."]));
    }
    return card;
  }

  // ---------- overzicht: rust vs. stress per activiteit ----------

  function simpleBarRow(label, caption, value, color) {
    return h("div", { class: "trend-row" }, [
      h("div", { class: "trend-label" }, [label]),
      h("div", { class: "bar-track" }, [
        h("div", { class: "bar-fill", style: "width:" + value + "%;background:" + color + ";" }, [])
      ]),
      h("div", { class: "bar-caption" }, [caption])
    ]);
  }

  function rustStressCard(filled) {
    var agg = aggregateByKey(filled, function (e) { return e.activity; });
    var reliable = agg.filter(function (r) { return r.count >= 2; });
    var pool = reliable.length >= 2 ? reliable : agg;
    var sorted = pool.slice().sort(function (a, b) { return a.avgStress - b.avgStress; });

    var card = h("div", { class: "card" }, [cardTitle("Wat geeft rust, wat geeft stress")]);

    var rust = sorted.slice(0, Math.min(5, Math.ceil(sorted.length / 2)));
    var stress = sorted.slice(rust.length).slice(-5).reverse();

    card.appendChild(h("p", { class: "trend-label", style: "color:var(--done-text);margin-bottom:10px;" }, ["Meeste rust"]));
    rust.forEach(function (r) {
      card.appendChild(simpleBarRow(r.key, "Gem. stress " + r.avgStress + "/100 · " + r.count + "×", r.avgStress, "var(--sage)"));
    });

    if (stress.length) {
      card.appendChild(h("p", { class: "trend-label", style: "color:var(--open-text);margin:18px 0 10px;" }, ["Meeste stress"]));
      stress.forEach(function (r) {
        card.appendChild(simpleBarRow(r.key, "Gem. stress " + r.avgStress + "/100 · " + r.count + "×", r.avgStress, "var(--gold)"));
      });
    }

    if (reliable.length >= 2 && reliable.length < agg.length) {
      card.appendChild(h("p", { class: "help" }, ["Activiteiten met maar één meting zijn hier weggelaten."]));
    }
    return card;
  }

  // ---------- tabs met detail-overzichten ----------

  function renderActivityCard(filled) {
    var byActivity = aggregateByKey(filled, function (e) { return e.activity; })
      .sort(function (a, b) { return b.count - a.count; });
    var card = h("div", { class: "card" }, [cardTitle("Per activiteit")]);
    byActivity.forEach(function (row) {
      card.appendChild(h("div", { class: "trend-row" }, [
        h("div", { class: "trend-label" }, [row.key + " (" + row.count + "×)"]),
        h("div", { class: "bar-track" }, [h("div", { class: "bar-fill bar-stress", style: "width:" + (row.avgStress || 0) + "%;" }, [])]),
        h("div", { class: "bar-caption" }, ["Stress " + (row.avgStress != null ? row.avgStress : "–") + "/100"]),
        h("div", { class: "bar-track" }, [h("div", { class: "bar-fill bar-fatigue", style: "width:" + (row.avgFatigue || 0) + "%;" }, [])]),
        h("div", { class: "bar-caption" }, ["Vermoeidheid " + (row.avgFatigue != null ? row.avgFatigue : "–") + "/100"])
      ]));
    });
    return card;
  }

  function renderSlotCard(filled) {
    var bySlot = aggregateByKey(filled, function (e) { return e.slot; });
    var slotMap = {};
    bySlot.forEach(function (r) { slotMap[r.key] = r; });
    var card = h("div", { class: "card" }, [cardTitle("Per tijdvak")]);
    SLOTS.forEach(function (slot) {
      var row = slotMap[slot];
      if (!row) return;
      card.appendChild(h("div", { class: "trend-row" }, [
        h("div", { class: "trend-label" }, [slot + " (" + row.count + "×)"]),
        h("div", { class: "bar-track" }, [h("div", { class: "bar-fill bar-stress", style: "width:" + (row.avgStress || 0) + "%;" }, [])]),
        h("div", { class: "bar-caption" }, ["Stress " + (row.avgStress != null ? row.avgStress : "–") + "/100"]),
        h("div", { class: "bar-track" }, [h("div", { class: "bar-fill bar-fatigue", style: "width:" + (row.avgFatigue || 0) + "%;" }, [])]),
        h("div", { class: "bar-caption" }, ["Vermoeidheid " + (row.avgFatigue != null ? row.avgFatigue : "–") + "/100"])
      ]));
    });
    return card;
  }

  function renderNotesCard(filled) {
    var withContext = filled.filter(function (e) { return e.context; })
      .sort(function (a, b) { return (b.sortKey + b.slot) < (a.sortKey + a.slot) ? -1 : 1; });
    var card = h("div", { class: "card" }, [cardTitle("Context-aantekeningen")]);
    withContext.forEach(function (e) {
      card.appendChild(h("div", { class: "summary-block", style: "margin-bottom:10px;" }, [
        h("p", { style: "margin:0 0 4px;font-weight:600;" }, [e.dateKey + " · " + e.slot + " · " + e.activity]),
        h("p", { style: "margin:0;" }, [e.context])
      ]));
    });
    return card;
  }

  function renderGschemaCard() {
    var sortedG = state.gschema.slice().sort(function (a, b) {
      var aKey = a.sortKey + (a.time || "");
      var bKey = b.sortKey + (b.time || "");
      return bKey < aKey ? -1 : bKey > aKey ? 1 : 0;
    });
    var card = h("div", { class: "card" }, [cardTitle("G-schema's")]);
    sortedG.forEach(function (e) {
      card.appendChild(h("div", { class: "gschema-entry" }, [
        h("p", { style: "margin:0 0 6px;font-weight:600;font-size:0.85rem;color:var(--muted);" }, [e.dateKey + " · " + e.time]),
        h("p", { style: "margin:0 0 4px;" }, [h("strong", {}, ["Gevoel:"]), " " + e.gevoel]),
        h("p", { style: "margin:0 0 4px;" }, [h("strong", {}, ["Gebeurtenis:"]), " " + e.gebeurtenis]),
        h("p", { style: "margin:0 0 4px;" }, [h("strong", {}, ["Gedachten:"]), " " + e.gedachten]),
        h("p", { style: "margin:0 0 4px;" }, [h("strong", {}, ["Gedrag:"]), " " + e.gedrag]),
        h("p", { style: "margin:0;" }, [h("strong", {}, ["Gevolg:"]), " " + e.gevolg])
      ]));
    });
    return card;
  }

  // ---------- instellingen ----------

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
        state.showSettings = false;
        showToast("Instellingen opgeslagen, data wordt geladen…");
        loadAndRender(newCfg);
      }
    }, ["Opslaan & laden"]));
    return card;
  }

  // ---------- hoofdweergave ----------

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

    var configured = !!(cfg.token && cfg.owner && cfg.repo);

    if (!configured || state.showSettings) {
      viewEl.appendChild(renderSettingsCard(cfg));
    }

    if (state.loading) {
      viewEl.appendChild(h("div", { class: "card" }, [h("p", { class: "confirm-text" }, ["Data wordt geladen…"])]));
      return;
    }
    if (state.error) {
      viewEl.appendChild(h("div", { class: "card" }, [h("p", { style: "color:var(--danger);font-weight:600;margin:0;" }, ["⚠️ Fout bij laden: " + state.error])]));
      if (configured && !state.showSettings) {
        viewEl.appendChild(h("button", {
          class: "btn btn-secondary",
          onclick: function () { state.showSettings = true; renderView(); }
        }, ["⚙️ Instellingen"]));
      }
      return;
    }
    if (!state.entries) {
      return;
    }

    var filled = state.entries.filter(function (e) { return !e.skipped; });
    var hasGschema = state.gschema && state.gschema.length > 0;

    if (!filled.length && !hasGschema) {
      viewEl.appendChild(h("div", { class: "card" }, [h("p", { class: "confirm-text" }, ["Nog geen ingevulde metingen gevonden in " + state.daysLoaded + " dagbestand(en)."])]));
      return;
    }

    // Overzicht: direct zichtbaar
    if (filled.length) {
      viewEl.appendChild(lineChartCard(filled, state.gschema));
      viewEl.appendChild(rustStressCard(filled));
    }

    // Detail-tabs
    var tabs = [];
    if (filled.length) {
      tabs.push({ key: "activiteiten", label: "Activiteiten" });
      tabs.push({ key: "tijdvakken", label: "Tijdvakken" });
      if (filled.some(function (e) { return e.context; })) tabs.push({ key: "notities", label: "Notities" });
    }
    if (hasGschema) tabs.push({ key: "gschema", label: "G-schema's" });

    if (tabs.length) {
      var validKeys = tabs.map(function (t) { return t.key; });
      if (validKeys.indexOf(state.tab) === -1) state.tab = validKeys[0];

      var bar = h("div", { class: "tab-bar" }, []);
      tabs.forEach(function (t) {
        bar.appendChild(h("button", {
          class: "tab-btn" + (state.tab === t.key ? " active" : ""),
          onclick: function () { state.tab = t.key; renderView(); }
        }, [t.label]));
      });
      viewEl.appendChild(bar);

      if (state.tab === "activiteiten") viewEl.appendChild(renderActivityCard(filled));
      else if (state.tab === "tijdvakken") viewEl.appendChild(renderSlotCard(filled));
      else if (state.tab === "notities") viewEl.appendChild(renderNotesCard(filled));
      else if (state.tab === "gschema") viewEl.appendChild(renderGschemaCard());
    }

    var footerText = filled.length + " ingevulde metingen over " + state.daysLoaded + " dagbestand(en)";
    if (hasGschema) footerText += " · " + state.gschema.length + " G-schema('s)";
    viewEl.appendChild(h("p", { class: "help", style: "text-align:center;" }, [footerText + "."]));

    if (configured && !state.showSettings) {
      viewEl.appendChild(h("button", {
        class: "btn btn-secondary",
        onclick: function () { state.showSettings = true; renderView(); }
      }, ["⚙️ Instellingen"]));
    }
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
