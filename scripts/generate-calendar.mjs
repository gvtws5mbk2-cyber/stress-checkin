// Genereert calendar.ics in de repo-root vanuit een JSON-bestand met
// planningsitems. Geen npm-dependencies, alleen Node built-ins.
//
// Gebruik:
//   node scripts/generate-calendar.mjs planning.json
//
// Input-format (JSON-array):
//   [
//     { "date": "2026-06-22", "start": "09:00", "end": "11:00", "summary": "Deep work" },
//     { "date": "2026-06-22", "start": "13:00", "end": "14:00", "summary": "Boodschappen" }
//   ]
//
// date/start/end worden behandeld als lokale tijd in Europe/Amsterdam en
// correct (DST-bewust, via Intl) omgerekend naar UTC voor het .ics-bestand.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const TIMEZONE = "Europe/Amsterdam";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

function pad2(n) {
  return n < 10 ? "0" + n : "" + n;
}

// Offset (in minuten) van timeZone t.o.v. UTC op het moment `date`.
function getTimeZoneOffsetMinutes(date, timeZone) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
  const parts = dtf.formatToParts(date);
  const map = {};
  for (const p of parts) map[p.type] = p.value;
  const asUTC = Date.UTC(
    Number(map.year), Number(map.month) - 1, Number(map.day),
    Number(map.hour), Number(map.minute), Number(map.second)
  );
  return (asUTC - date.getTime()) / 60000;
}

// Rekent een lokale wandklok-tijd (dateStr "YYYY-MM-DD", timeStr "HH:MM") in
// `timeZone` om naar een UTC Date-instant. Twee passes om correct te blijven
// rond DST-overgangen (CET <-> CEST).
function zonedTimeToUtc(dateStr, timeStr, timeZone) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const [hh, mm] = timeStr.split(":").map(Number);
  const utcGuess = Date.UTC(y, m - 1, d, hh, mm, 0);
  const offset1 = getTimeZoneOffsetMinutes(new Date(utcGuess), timeZone);
  let utc = utcGuess - offset1 * 60000;
  const offset2 = getTimeZoneOffsetMinutes(new Date(utc), timeZone);
  utc = utcGuess - offset2 * 60000;
  return new Date(utc);
}

function formatICSDateUTC(d) {
  return (
    d.getUTCFullYear() + pad2(d.getUTCMonth() + 1) + pad2(d.getUTCDate()) +
    "T" + pad2(d.getUTCHours()) + pad2(d.getUTCMinutes()) + pad2(d.getUTCSeconds()) + "Z"
  );
}

// Escape tekst volgens RFC 5545 (3.3.11): backslash, komma, puntkomma,
// newline.
function escapeText(text) {
  return String(text)
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

// Vouwt regels >75 octets volgens RFC 5545 (3.1): vervolgregels beginnen met
// een spatie.
function foldLine(line) {
  if (line.length <= 75) return line;
  let result = line.slice(0, 75);
  let rest = line.slice(75);
  while (rest.length > 0) {
    result += "\r\n " + rest.slice(0, 74);
    rest = rest.slice(74);
  }
  return result;
}

function buildEvent(item, index, now) {
  const dtStart = zonedTimeToUtc(item.date, item.start, TIMEZONE);
  const dtEnd = zonedTimeToUtc(item.date, item.end, TIMEZONE);
  const uid = `${item.date}-${item.start.replace(":", "")}-${index}-${Math.random().toString(36).slice(2, 8)}@stress-checkin.gvtws5mbk2-cyber.github.io`;

  const lines = [
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${formatICSDateUTC(now)}`,
    `DTSTART:${formatICSDateUTC(dtStart)}`,
    `DTEND:${formatICSDateUTC(dtEnd)}`,
    `SUMMARY:${escapeText(item.summary)}`,
    "END:VEVENT"
  ];
  return lines.map(foldLine).join("\r\n");
}

function buildCalendar(items) {
  const now = new Date();
  const header = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Stress Check-in//Weekplanning//NL",
    "CALSCALE:GREGORIAN",
    "X-WR-CALNAME:Weekplanning"
  ].map(foldLine).join("\r\n");

  const events = items.map((item, i) => buildEvent(item, i, now)).join("\r\n");
  const footer = "END:VCALENDAR";

  return header + "\r\n" + events + (events ? "\r\n" : "") + footer + "\r\n";
}

function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error("Gebruik: node scripts/generate-calendar.mjs <planning.json>");
    process.exit(1);
  }
  const raw = fs.readFileSync(path.resolve(inputPath), "utf8");
  const items = JSON.parse(raw);
  if (!Array.isArray(items)) {
    console.error("Input-bestand moet een JSON-array van planningsitems zijn.");
    process.exit(1);
  }

  const ics = buildCalendar(items);
  const outPath = path.join(REPO_ROOT, "calendar.ics");
  fs.writeFileSync(outPath, ics, "utf8");
  console.log(`calendar.ics geschreven (${items.length} item(s)): ${outPath}`);
}

main();
