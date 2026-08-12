# Hof-Management

Eine PWA für die Verwaltung von Flächen, Fuhrpark, Viehhaltung, Weinbau/Keller und Finanzen.
Frontend auf GitHub Pages, Backend + Datenbank auf Google Apps Script / Sheets / Drive (kostenlos, mehrbenutzerfähig).

**Module:** Dashboard · Flächen & Fruchtfolge & Feldbuch (Schnitte/Düngung) · Fuhrpark
(Wartung, QR-Codes, Fotos, Dokumente) · Viehhaltung (Einzeltier, Zuchtkalender,
Bestandsregister-Export) · Weinbau & Kellerwirtschaft (Rebanlagen, Pflegetagebuch,
Reifemessung, Ernte, Tanks/Logbuch/Abfüllung) · Finanzen (Jahresvergleich, Sammelkosten,
Erntevermarktung).

## Architektur

```
Browser (PWA, GitHub Pages)
   │  Google Sign-In (Identity Services) → Google-ID-Token
   │  fetch() POST (text/plain, um CORS-Preflight zu vermeiden)
   ▼
Google Apps Script Web App (doPost)
   │  verifiziert ID-Token direkt bei Google (tokeninfo)
   │  prüft Rolle in "Users"-Tabelle
   ▼
Google Sheet (Datenbank) + Google Drive (Beleg-Uploads)
```

Es gibt **keinen** lokalen Mock-Modus: Das Frontend spricht immer mit dem echten
Apps-Script-Backend. Für die lokale Entwicklung richtest du dir aber schnell ein
eigenes (kostenloses) Test-Sheet ein und startest das Frontend lokal über einen
einfachen Webserver – siehe unten.

---

## 1. Google Sheet + Apps Script einrichten

1. Erstelle ein neues Google Sheet, z. B. "Hof-Management Datenbank".
2. Öffne **Erweiterungen → Apps Script**.
3. Lösche den Beispielcode und füge den kompletten Inhalt von [`backend/code.gs`](backend/code.gs) ein.
4. Speichern (Strg+S). Gib dem Projekt oben einen Namen, z. B. "Hof-Management Backend".
5. Führe einmalig die Funktion **`migrate`** aus (Dropdown oben in der Toolbar → `migrate` auswählen → ▶ Ausführen).
   - Beim ersten Ausführen fragt Google nach Berechtigungen (Zugriff auf dieses Sheet + Drive + externe Anfragen für die Login-Prüfung) – bestätigen.
   - `migrate()` legt alle benötigten Tabellenblätter mit den richtigen Spaltenköpfen an (siehe [`backend/schema.json`](backend/schema.json)) und befüllt "Kulturen" mit ein paar Standard-Kulturen. Der alte Name `setup()` funktioniert weiterhin (ruft intern `migrate()` auf).
   - **Wichtig nach jedem Code-Update:** `migrate()` erneut ausführen. Sie ist datenschonend - fehlende Tabellenblätter/Spalten werden ergänzt, bestehende Daten bleiben unangetastet.
6. Noch **nicht** als Web-App bereitstellen – dafür brauchen wir erst die OAuth-Client-ID (nächster Schritt), weil `doPost` diese zur Token-Prüfung benötigt.

## 2. Google OAuth Client-ID erstellen (für echtes Google-Konto-Login)

Wir nutzen "Google Identity Services" im Frontend, damit sich Mitarbeiter mit ihrem
echten Google-Konto anmelden. Das Backend verifiziert das dabei ausgestellte
ID-Token direkt bei Google – es ist kein separater Server nötig.

1. Gehe zur [Google Cloud Console](https://console.cloud.google.com/) und lege ein neues Projekt an (oder nutze ein bestehendes).
2. **APIs & Dienste → OAuth-Zustimmungsbildschirm**:
   - Nutzertyp: "Extern" (außer du hast Google Workspace für den Betrieb, dann "Intern").
   - App-Name, Support-E-Mail etc. ausfüllen.
   - Scopes: die Standard-Scopes `email` und `profile` reichen aus.
   - Unter "Testnutzer" trage vorerst alle Google-Konten ein, die die App testen sollen (solange die App im Status "Testing" ist, können sich nur diese anmelden).
3. **APIs & Dienste → Anmeldedaten → Anmeldedaten erstellen → OAuth-Client-ID**:
   - Anwendungstyp: **Webanwendung**.
   - Unter "Autorisierte JavaScript-Quellen" trägst du **alle** Ursprünge ein, von denen aus die App später aufgerufen wird, z. B.:
     - `http://localhost:8080` (für lokale Tests, siehe Schritt 4)
     - `https://DEIN-GITHUB-USERNAME.github.io` (für GitHub Pages, siehe Schritt 5)
   - Speichern → du erhältst eine **Client-ID** (endet auf `.apps.googleusercontent.com`).
4. Trage diese Client-ID an zwei Stellen ein:
   - `frontend/config.js` → `GOOGLE_CLIENT_ID`
   - Im Apps-Script-Projekt: **Projekteinstellungen (Zahnrad links) → Script-Eigenschaften → Property hinzufügen** → Name `OAUTH_CLIENT_ID`, Wert = deine Client-ID.

## 3. Backend als Web-App veröffentlichen

1. Zurück im Apps-Script-Editor: **Bereitstellen → Neue Bereitstellung**.
2. Typ auswählen: **Web-App**.
3. Einstellungen:
   - "Ausführen als": **Ich** (dein Google-Konto – dadurch hat das Script immer Zugriff auf Sheet + Drive, unabhängig davon, wer die App benutzt).
   - "Zugriff": **Alle**.
4. Bereitstellen → die generierte **Web-App-URL** (endet auf `/exec`) kopieren.
5. Eintragen in `frontend/config.js` → `API_BASE_URL`.
6. Jede Änderung am Code erfordert eine **neue Bereitstellungsversion**
   (Bereitstellen → Bereitstellungen verwalten → ✏️ → "Neue Version").

## 4. Lokal testen

Google Identity Services und `fetch()` benötigen einen echten HTTP-Ursprung (kein
`file://`). Starte im `frontend`-Ordner einen einfachen lokalen Webserver, z. B.:

```bash
cd frontend
npx serve -l 8080
```

oder mit Python:

```bash
cd frontend
python -m http.server 8080
```

Öffne dann `http://localhost:8080`. Falls du einen anderen Port nutzt, trage
diesen zusätzlich als autorisierten JavaScript-Ursprung bei der OAuth-Client-ID ein (Schritt 2).

**Erster Login:** Der allererste Google-Account, der sich einloggt, wird automatisch
als **Admin** in der "Users"-Tabelle angelegt (Bootstrap). Alle weiteren Kolleg:innen
müssen danach unter **Einstellungen → Benutzer** von einem Admin mit ihrer
Google-E-Mail-Adresse freigeschaltet werden (Rolle Admin oder Mitarbeiter).

Jetzt kannst du alle Module gegen dein echtes Test-Sheet ausprobieren, bevor du live gehst.

**GPS-Standort-Anzeige:** Der "🛰️ Mein Standort"-Button in der Flächen-Ansicht nutzt die
Browser-Geolocation-API. Diese funktioniert aus Sicherheitsgründen nur über `https://`
oder `http://localhost` - beides ist hier bereits gegeben.

## 5. Deployment auf GitHub Pages

1. Lade den Inhalt des `frontend`-Ordners in ein GitHub-Repository hoch (z. B. als Root oder unter `/docs`).
2. Im Repository: **Settings → Pages** → Branch und Ordner auswählen, in dem `index.html` liegt.
3. GitHub zeigt dir die veröffentlichte URL, z. B. `https://dein-username.github.io/hof-management/`.
4. Trage diese URL als weiteren autorisierten JavaScript-Ursprung bei deiner OAuth-Client-ID ein (Google Cloud Console, Schritt 2) – **ohne** Pfad, nur `https://dein-username.github.io`.
5. Fertig – `config.js` muss nicht geändert werden, da `API_BASE_URL` und `GOOGLE_CLIENT_ID` überall gleich bleiben.

---

## Kataster-/Geodaten-Integration (Südtirol)

Die Flächen-Karte nutzt den GeoServer-WMS-Dienst der Autonomen Provinz Bozen
(`p_bz-Cadastre`, siehe `frontend/config.js`):

- **Visuelle Kataster-Ebene** (Layer `WebRepresentation`): über den Schalter
  "Kataster-Ebene" in der Flächen-Ansicht als Kartenüberlagerung zuschaltbar.
- **Sachdaten-Abfrage** (Layer `ParcelsAggregate`): Button "Parzelle vom Kataster
  abfragen" aktivieren, dann auf eine Parzelle in der Karte klicken. Die App lädt
  per WMS `GetFeatureInfo` Parzellennummer, Katastralgemeinde, Fläche **und** die
  Geometrie und öffnet direkt das Formular "Neue Fläche" damit vorausgefüllt.
- Alternativ kannst du mit "Fläche zeichnen" jede Parzelle auch manuell als
  Polygon einzeichnen (z. B. für Flächen außerhalb des Katasters oder wenn der
  Geodienst gerade nicht erreichbar ist).

Falls die Kataster-Abfrage mit einem Fehler wie "Katasterabfrage fehlgeschlagen"
abbricht, blockiert wahrscheinlich eine CORS-Einschränkung des Geodienstes den
direkten Browser-Zugriff – nutze in dem Fall vorerst "Fläche zeichnen".

---

## Rollen & Rechte

| Aktion | Mitarbeiter | Admin |
|---|---|---|
| Daten ansehen | ✅ | ✅ |
| Flächen/Maschinen/Tiere/Kosten anlegen & bearbeiten | ✅ | ✅ |
| Datensätze löschen | ❌ | ✅ |
| Benutzer verwalten | ❌ | ✅ |
| Betriebsdaten (Einstellungen) ändern | ❌ | ✅ |

## Projektstruktur

```
hof-management/
├── backend/
│   ├── code.gs          Apps-Script-Backend (CRUD, Auth, Drive-Upload, Business-Logik)
│   └── schema.json       Referenz: Google-Sheet-Tabellenlayout
├── frontend/
│   ├── index.html         App-Struktur (Tailwind, Leaflet, Modals)
│   ├── app.js             Anwendungslogik, Karte, Formulare
│   ├── api.js              Google-Login + API-Aufrufe ans Backend
│   ├── config.js           Deine Konfigurationswerte (API-URL, Client-ID, WMS)
│   ├── manifest.json       PWA-Manifest
│   ├── sw.js                Service Worker (Offline-Caching der App-Shell)
│   ├── serve.ps1            Lokaler Webserver ohne Zusatzsoftware (falls kein Node/Python vorhanden)
│   └── icons/icon.svg       Platzhalter-App-Icon
└── README.md
```

**Hinweis zu den Icons:** `icons/icon.svg` ist ein einfacher Platzhalter. Für die
finale Veröffentlichung solltest du ihn durch echte PNG-Icons (192×192 und
512×512) ersetzen – z. B. mit einem beliebigen Online-Favicon-/PWA-Icon-Generator
deiner Wahl – und die Pfade in `manifest.json` sowie `index.html` entsprechend anpassen.

## Fehlerbehebung

- **"Server-Konfiguration fehlt: OAUTH_CLIENT_ID..."** → Script-Eigenschaft im
  Apps-Script-Projekt setzen (Schritt 2.4).
- **"Dieses Google-Konto ist noch nicht freigeschaltet"** → Als bestehender Admin
  unter Einstellungen → Benutzer die E-Mail-Adresse eintragen, oder falls es der
  allererste Login sein sollte: Prüfen, ob die "Users"-Tabelle im Sheet wirklich leer ist.
- **"Tabellenblatt ... existiert nicht" / nach einem Update fehlen neue Felder** → `migrate()` im Apps-Script-Editor erneut ausführen.
- **"Sie haben nicht die erforderliche Berechtigung, UrlFetchApp.fetch anzurufen"** → Das Script muss die Berechtigung für externe Anfragen erneut erteilt bekommen: `migrate()` (oder eine beliebige Funktion) manuell im Editor ausführen und im Berechtigungsdialog **alle** Punkte zulassen, danach eine **neue Bereitstellungsversion** erzeugen (siehe Schritt 3.6). Falls kein Dialog erscheint, unter [myaccount.google.com/permissions](https://myaccount.google.com/permissions) den Zugriff für dieses Apps-Script-Projekt entfernen und danach erneut ausführen.
- **CORS-/Netzwerkfehler beim Speichern** → `API_BASE_URL` in `config.js` prüfen
  (muss auf `/exec` enden) und sicherstellen, dass die neueste Bereitstellungsversion aktiv ist.
- **Google-Login-Button erscheint nicht / Fehler zur Client-ID** → Aktuellen
  Ursprung (`http://localhost:PORT` bzw. die GitHub-Pages-URL) als autorisierte
  JavaScript-Quelle bei der OAuth-Client-ID hinterlegen.
