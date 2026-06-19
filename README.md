# Stress Check-in

Een eenvoudige, installeerbare web-app (PWA) voor dagelijkse korte stress- en
vermoeidheidsmetingen, voor gebruik bij je psycholoog. De app werkt offline,
slaat alles lokaal op, en schrijft elke meting automatisch naar een privé
GitHub-data-repo.

## 1. Live-app en installeren op je iPhone

Live-URL: **https://gvtws5mbk2-cyber.github.io/stress-checkin/**

Zo zet je 'm op je beginscherm:

1. Open de link hierboven in **Safari** op je iPhone (moet Safari zijn, geen
   andere browser, anders werkt "Zet op beginscherm" niet goed).
2. Tik op het **deel-icoon** (vierkant met pijl omhoog) onderin.
3. Kies **"Zet op beginscherm"**.
4. De app verschijnt nu als eigen icoon en opent fullscreen, zonder
   Safari-balken, en werkt ook offline.

## 2. GitHub-token instellen (eenmalig)

De app schrijft elke meting automatisch weg naar een **privé data-repo**
(`stress-checkin-data`). Daarvoor heeft de app een toegangstoken nodig.

1. Ga naar GitHub → **Settings → Developer settings → Personal access tokens
   → Fine-grained tokens → Generate new token**.
2. Geef het token een naam, bijv. "stress-checkin-app".
3. Onder **Repository access**: kies **"Only select repositories"** en
   selecteer alleen **`stress-checkin-data`**.
4. Onder **Permissions → Repository permissions**: zet **Contents** op
   **"Read and write"**. Verder niets nodig.
5. Genereer het token en kopieer het (het is maar één keer zichtbaar).
6. Open in de app het **instellingen-icoon (⚙️)** rechtsboven, vul je
   GitHub-gebruikersnaam, de repo-naam (`stress-checkin-data`) en het token
   in, en tik op **"Opslaan & testen"**.

Het token wordt **uitsluitend lokaal** op je telefoon opgeslagen
(`localStorage`) en nooit verzonden naar iets anders dan `api.github.com`.

## 3. Dagelijkse herinneringen instellen

De app gebruikt geen pushmeldingen (te fragiel/onbetrouwbaar op PWA's voor
iOS). In plaats daarvan open je de app-URL automatisch op de vaste tijden via
**Wekker** of **Shortcuts**:

### Optie A — Wekker-app
Stel 7 herhalende wekkers in (zonder geluid als je wilt) op 09:00, 11:00,
13:00, 15:00, 17:00, 19:00 en 21:00, elke dag herhalend, als geheugensteuntje
om de app te openen.

### Optie B — Shortcuts (Automatisering), opent de app automatisch
1. Open **Shortcuts** → tab **Automatisering** → **+** → **Tijd van de dag**.
2. Stel de tijd in (bijv. 09:00), herhaling: **Elke dag**, en zet **"Vraag
   voor uitvoeren"** UIT zodat het automatisch gaat.
3. Voeg de actie **"Open URL's"** toe met:
   `https://gvtws5mbk2-cyber.github.io/stress-checkin/`
4. Herhaal dit voor alle 7 tijdstippen (09:00, 11:00, 13:00, 15:00, 17:00,
   19:00, 21:00).

De app toont op het startscherm altijd welke metingen van vandaag nog open
staan en markeert de eerstvolgende.

## 4. Hoe je cowork-schema de data inleest

De metingen komen terecht in de privé repo **`stress-checkin-data`**, in
bestanden genaamd `metingen-dd-mm-jjjj.md`.

1. **Eenmalig**: clone de privé data-repo lokaal op je Mac, bijvoorbeeld naar
   `/Users/reinoutmooij/Desktop/untitled folder`:
   ```
   git clone git@github.com:gvtws5mbk2-cyber/stress-checkin-data.git "/Users/reinoutmooij/Desktop/untitled folder"
   ```
   (git is op je Mac al ingelogd via je bestaande GitHub-account/SSH-key, dus
   hier is geen extra token nodig.)
2. Je cowork-dagtaak (avond) doet:
   ```
   git -C "/Users/reinoutmooij/Desktop/untitled folder" pull
   ```
   gevolgd door het inlezen van het bestand van die dag,
   `metingen-dd-mm-jjjj.md`, uit die map.
3. **Belangrijk:** voer de `git pull` vlak vóór het inlezen uit, zodat ook de
   laatste meting van 21:00 al gesynchroniseerd en meegenomen is.

## 5. Markdown-format

Elk dagbestand (`metingen-dd-mm-jjjj.md`) begint met:
```
# Metingen dd-mm-jjjj
```
Per ingevulde meting:
```
## HH:MM

- **Activiteit:** [gekozen activiteit, of zelf-getypte tekst bij "Anders, namelijk: ..."]
- **Stress:** [getal]/100
- **Vermoeidheid:** [getal]/100
- **Context:** [optionele toelichting] (regel ontbreekt volledig als dit veld leeg is)
```
Per overgeslagen meting:
```
## HH:MM

- *(overgeslagen)*
```
`HH:MM` is het vaste tijdvak (09:00, 11:00, ... 21:00), niet de werkelijke
kloktijd van invullen. Activiteit is een vaste keuzelijst met als laatste optie
"Anders, namelijk: ..." — kies je die, dan verschijnt er een tekstveld en wordt
je eigen tekst opgeslagen (niet de letterlijke optie-tekst).

## 6. Offline gedrag

- Lukt het wegschrijven naar GitHub niet (geen internet, token verlopen), dan
  blijft de meting lokaal staan en wordt automatisch opnieuw geprobeerd zodra
  er weer verbinding is (en elke minuut op de achtergrond).
- De syncstatus rechtsboven toont: **✅ gesynct**, **⏳ wacht (n)**, of
  **⚠️ fout** (bijv. ongeldig token).
- Er is geen handmatige exportstap nodig: elke meting wordt automatisch naar
  de data-repo geschreven, zodra er weer verbinding is.

## Projectstructuur

```
stress-checkin/
├── index.html        één-pagina app
├── style.css         styling, mobiel-first
├── app.js            alle logica: vragenflow, opslag, GitHub-sync
├── trends.html        trends- en analysepagina (leest data-repo read-only)
├── trends.js          parse- en aggregatielogica voor trends.html
├── manifest.json      PWA-manifest
├── sw.js             service worker (offline cache)
├── icons/            app-iconen
└── README.md
```

### Trends-pagina

Via ⚙️ Instellingen → "📊 Bekijk trends" open je `trends.html`. Die pagina
heeft een eigen, los GitHub-token nodig (alleen-lezen "Contents" op de
data-repo is voldoende) — dit token staat los van het schrijf-token van de
hoofdapp en wordt apart in `localStorage` bewaard. De pagina haalt alle
`metingen-dd-mm-jjjj.md`-bestanden op en toont gemiddelde stress/vermoeidheid
per activiteit en per tijdvak, plus een overzicht van alle ingevulde
Context-aantekeningen.

Geen build-stap nodig — gewoon statische bestanden, gehost via GitHub Pages.
