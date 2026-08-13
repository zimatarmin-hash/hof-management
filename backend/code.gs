/**
 * HOF-MANAGEMENT - Backend (Google Apps Script)
 *
 * Dieses Script muss an das Master-Google-Sheet gebunden sein
 * (im Sheet: Erweiterungen > Apps Script).
 *
 * EINMALIGES SETUP:
 *   1. Dieses Script an das Sheet binden (siehe README).
 *   2. Projekteinstellungen > Script-Eigenschaften > OAUTH_CLIENT_ID = deine Google OAuth Client-ID setzen.
 *   3. Die Funktion setup() einmal manuell ausführen (Auswahl oben: setup > Ausführen).
 *   4. Als Web-App bereitstellen (Bereitstellen > Neue Bereitstellung > Web-App,
 *      "Ausführen als: Ich", "Zugriff: Jeder").
 *
 * AUTHENTIFIZIERUNG:
 *   Das Frontend nutzt Google Identity Services (Sign-In-Button) und schickt bei
 *   jedem Request ein Google-ID-Token mit. Dieses Script verifiziert das Token direkt
 *   bei Google (tokeninfo-Endpoint) und ermittelt darüber E-Mail/Name des Nutzers.
 *   Der erste Login überhaupt wird automatisch als Admin in der "Users"-Tabelle angelegt
 *   (Bootstrap). Alle weiteren Personen müssen von einem Admin in "Users" freigeschaltet werden.
 */

// ============================================================================
// KONFIGURATION
// ============================================================================

var DRIVE_ROOT_FOLDER_NAME = 'Hof-Management Belege';

var SHEET_SCHEMA = {
  Users: ['Email', 'Name', 'Rolle', 'Status', 'AngelegtAm'],
  Betrieb: ['HofName', 'Adresse', 'Betriebsnummer', 'Ansprechpartner', 'ErinnerungWochenVorher', 'AktualisiertAm'],
  Flaechen: ['ID', 'Name', 'KatastralGemeinde', 'Parzellennummer', 'FlaecheHa', 'Besitzart', 'Nutzungsart', 'GeoJSON', 'Notiz', 'ErstelltVon', 'ErstelltAm', 'Aktiv'],
  SubFlaechen: ['ID', 'FlaecheID', 'Name', 'Rebsorte', 'FlaecheM2', 'Pflanzjahr', 'GeoJSON', 'Notiz', 'ErstelltVon', 'ErstelltAm', 'Aktiv'],
  Kulturen: ['Kultur', 'Kategorie', 'SaatmengeKgHa', 'DuengeempfehlungN_KgHa', 'DuengeempfehlungP_KgHa', 'DuengeempfehlungK_KgHa', 'UnvertraeglicheVorfruechte', 'AnbaupauseJahre', 'KartenFarbe', 'KartenSymbol'],
  Fruchtfolge: ['ID', 'FlaecheID', 'Jahr', 'Kultur', 'Aussaatdatum', 'Erntedatum', 'ErtragsMenge', 'ErtragsEinheit', 'SaatmengeKgHaBerechnet', 'SaatmengeGesamtKg', 'Notiz', 'ErstelltVon', 'ErstelltAm'],
  Schnitte: ['ID', 'FlaecheID', 'SchnittNummer', 'Datum', 'Erntetyp', 'ErtragsMenge', 'ErtragsEinheit', 'Notiz', 'ErfasstVon', 'ErfasstAm'],
  Duengungen: ['ID', 'FlaecheID', 'Datum', 'Duengerart', 'Menge', 'Einheit', 'Notiz', 'ErfasstVon', 'ErfasstAm'],
  WeinbauMassnahmen: ['ID', 'SubFlaecheID', 'Datum', 'Massnahme', 'Bio', 'Mittel', 'Notiz', 'ErfasstVon', 'ErfasstAm'],
  Reifemessungen: ['ID', 'SubFlaecheID', 'Datum', 'Oechsle', 'Brix', 'KMW', 'Saeure', 'PH', 'Notiz', 'ErfasstVon', 'ErfasstAm'],
  WeinLese: ['ID', 'SubFlaecheID', 'Datum', 'MengeKg', 'MostgewichtOechsle', 'Notiz', 'ErfasstVon', 'ErfasstAm'],
  Tanks: ['ID', 'Bezeichnung', 'VolumenLiter', 'AktuellerInhaltLiter', 'Sorte', 'Jahrgang', 'Notiz', 'ErstelltVon', 'ErstelltAm', 'Aktiv'],
  KellerLogbuch: ['ID', 'TankID', 'Datum', 'Aktion', 'Oechsle', 'Brix', 'KMW', 'RestzuckerGL', 'VerbleibendLiter', 'Notiz', 'ErfasstVon', 'ErfasstAm'],
  Abfuellungen: ['ID', 'TankID', 'Datum', 'FlaschenAnzahl', 'FlaschenGroesseMl', 'Charge', 'Notiz', 'ErfasstVon', 'ErfasstAm'],
  Flaschenbestand: ['ID', 'Bezeichnung', 'Sorte', 'Jahrgang', 'FlaschenGroesseMl', 'AnzahlAktuell', 'Notiz', 'ErstelltVon', 'ErstelltAm', 'Aktiv'],
  FlaschenBewegungen: ['ID', 'FlaschenbestandID', 'Datum', 'Typ', 'Anzahl', 'Erloes', 'Notiz', 'ErfasstVon'],
  Maschinen: ['ID', 'GeraeteNummer', 'Bezeichnung', 'Typ', 'Baujahr', 'Anschaffungspreis', 'Anschaffungsdatum', 'BetriebsstundenAktuell', 'FotoDriveFileID', 'FotoURL', 'DokumenteJSON', 'Notiz', 'ErstelltVon', 'ErstelltAm', 'Aktiv'],
  Betriebsstunden: ['ID', 'MaschinenID', 'Datum', 'StundenDelta', 'Notiz', 'ErfasstVon', 'ErfasstAm'],
  WartungsIntervalle: ['ID', 'MaschinenID', 'Bezeichnung', 'IntervallStunden', 'IntervallMonate', 'LetzteWartungStunden', 'LetzteWartungDatum', 'Notiz'],
  MaschinenKosten: ['ID', 'MaschinenID', 'Datum', 'Kategorie', 'Betrag', 'Beschreibung', 'BelegDriveFileID', 'BelegURL', 'ErfasstVon', 'ErfasstAm'],
  AllgemeineKosten: ['ID', 'Datum', 'Kategorie', 'MengeLiter', 'Betrag', 'Beschreibung', 'BelegDriveFileID', 'BelegURL', 'ErfasstVon', 'ErfasstAm'],
  Erntevermarktung: ['ID', 'Datum', 'Kategorie', 'Menge', 'Einheit', 'Erloes', 'Beschreibung', 'ErfasstVon', 'ErfasstAm'],
  Tiere: ['ID', 'Tierart', 'Ohrmarke', 'Rasse', 'Name', 'Geburtsdatum', 'Geschlecht', 'Status', 'MutterOhrmarke', 'Notiz', 'ErstelltVon', 'ErstelltAm'],
  Zuchtereignisse: ['ID', 'TierID', 'Datum', 'Typ', 'Vatertier', 'VoraussichtlichesAbkalbedatum', 'TrockenstellenAb', 'Notiz', 'ErfasstVon', 'ErfasstAm'],
  TierKosten: ['ID', 'TierID', 'Datum', 'Kategorie', 'Betrag', 'Beschreibung', 'BelegDriveFileID', 'BelegURL', 'ErfasstVon', 'ErfasstAm'],
  TierErloese: ['ID', 'TierID', 'Datum', 'Art', 'Betrag', 'Beschreibung', 'ErfasstVon', 'ErfasstAm'],
  Tierbestand: ['ID', 'Tierart', 'Bezeichnung', 'AnzahlAktuell', 'Notiz', 'ErstelltVon', 'ErstelltAm', 'Aktiv'],
  TierbestandBewegungen: ['ID', 'TierbestandID', 'Datum', 'Typ', 'Anzahl', 'Notiz', 'ErfasstVon'],
  Futtermittel: ['ID', 'Bezeichnung', 'Kategorie', 'Einheit', 'BestandAktuell', 'MindestBestand', 'Notiz', 'ErstelltVon', 'ErstelltAm', 'Aktiv'],
  FuttermittelBewegungen: ['ID', 'FuttermittelID', 'Datum', 'Typ', 'Menge', 'HerkunftFlaecheID', 'Notiz', 'ErfasstVon'],
  AktivitaetsLog: ['Timestamp', 'UserEmail', 'UserName', 'Aktion', 'Details']
};

// Ordnung: entity-Name (wie vom Frontend genutzt) -> Sheet-Name
var ENTITY_SHEET_MAP = {
  flaechen: 'Flaechen',
  subflaechen: 'SubFlaechen',
  kulturen: 'Kulturen',
  fruchtfolge: 'Fruchtfolge',
  schnitte: 'Schnitte',
  duengungen: 'Duengungen',
  weinbaumassnahmen: 'WeinbauMassnahmen',
  reifemessungen: 'Reifemessungen',
  weinlese: 'WeinLese',
  tanks: 'Tanks',
  kellerlogbuch: 'KellerLogbuch',
  abfuellungen: 'Abfuellungen',
  flaschenbestand: 'Flaschenbestand',
  flaschenbewegungen: 'FlaschenBewegungen',
  maschinen: 'Maschinen',
  betriebsstunden: 'Betriebsstunden',
  wartungsintervalle: 'WartungsIntervalle',
  maschinenkosten: 'MaschinenKosten',
  allgemeinekosten: 'AllgemeineKosten',
  erntevermarktung: 'Erntevermarktung',
  tiere: 'Tiere',
  zuchtereignisse: 'Zuchtereignisse',
  tierkosten: 'TierKosten',
  tiererloese: 'TierErloese',
  tierbestand: 'Tierbestand',
  tierbestandbewegungen: 'TierbestandBewegungen',
  futtermittel: 'Futtermittel',
  futtermittelbewegungen: 'FuttermittelBewegungen',
  users: 'Users'
};

// Primärschlüssel-Spalte je Entität (Standard: "ID"; einige Stammdaten-Tabellen
// nutzen einen fachlichen Schlüssel statt einer generierten ID).
var ENTITY_KEY_MAP = {
  users: 'Email',
  kulturen: 'Kultur'
};

// ============================================================================
// SETUP
// ============================================================================

/**
 * Migrations-Funktion: einmal beim Erst-Setup und danach nach JEDEM Code-Update
 * erneut ausführen. Idempotent und datenschonend:
 *  - Fehlende Tabellenblätter werden komplett neu angelegt.
 *  - Bei bestehenden Blättern werden nur fehlende Spalten rechts angehängt -
 *    vorhandene Spalten/Daten werden nie verändert oder gelöscht.
 */
function migrate() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(SHEET_SCHEMA).forEach(function (name) {
    var headers = SHEET_SCHEMA[name];
    var sheet = ss.getSheetByName(name);

    if (!sheet) {
      sheet = ss.insertSheet(name);
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.setFrozenRows(1);
      return;
    }

    var lastCol = Math.max(sheet.getLastColumn(), 1);
    var existingHeaders = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    if (existingHeaders.join('') === '') {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.setFrozenRows(1);
      return;
    }

    var missing = headers.filter(function (h) { return existingHeaders.indexOf(h) === -1; });
    if (missing.length > 0) {
      sheet.getRange(1, existingHeaders.length + 1, 1, missing.length).setValues([missing]);
    }
  });

  // Standard-Kulturen als Startdaten anlegen, falls Kulturen-Tabelle leer ist
  var kulturenSheet = ss.getSheetByName('Kulturen');
  if (kulturenSheet.getLastRow() < 2) {
    var defaults = [
      ['Weizen', 'Getreide', 180, 120, 30, 60, 'Weizen,Gerste', 2, '#ca8a04', '🌾'],
      ['Gerste', 'Getreide', 160, 100, 25, 50, 'Gerste,Weizen', 2, '#eab308', '🌾'],
      ['Mais', 'Hackfrucht', 3, 150, 40, 80, 'Mais', 3, '#f59e0b', '🌽'],
      ['Kartoffel', 'Hackfrucht', 2500, 100, 60, 150, 'Kartoffel', 4, '#78350f', '🥔'],
      ['Klee-Gras', 'Leguminose', 30, 0, 20, 40, '', 0, '#22c55e', '🍀'],
      ['Wechselwiese Standard', 'Gras-Ackerfutter', 25, 40, 20, 60, '', 0, '#84cc16', '🌱']
    ];
    kulturenSheet.getRange(2, 1, defaults.length, defaults[0].length).setValues(defaults);
  }

  getOrCreateDriveRootFolder();
  Logger.log('Migration abgeschlossen. Bitte OAUTH_CLIENT_ID in den Script-Eigenschaften setzen, falls noch nicht geschehen.');
}

// Rückwärtskompatibler Name (README/ältere Anleitung verweist auf setup()).
function setup() {
  migrate();
}

// ============================================================================
// WEB APP ENTRY POINTS
// ============================================================================

function doGet(e) {
  return jsonResponse({ success: true, message: 'Hof-Management API ist aktiv.' });
}

/**
 * Diagnose-Hilfsfunktion (manuell im Editor ausführen, dann Ctrl+Enter bzw.
 * "Protokolle anzeigen" für das Ergebnis). Zeigt für jedes Tabellenblatt die
 * tatsächliche Zeilen-/Spaltenanzahl laut Google Sheets. Falls hier ein Blatt
 * mit winzigen echten Daten trotzdem viele Tausend Zeilen/Spalten anzeigt,
 * ist das der "aufgeblähte benutzte Bereich" - Ursache für starke Langsamkeit.
 * Behoben durch Markieren der überschüssigen Zeilen/Spalten im Sheet und
 * "Zeilen löschen" / "Spalten löschen" (nicht nur Inhalt leeren!).
 */
function diagnoseSheetSizes() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var zeilen = ss.getSheets().map(function (sheet) {
    return sheet.getName() + ': ' + sheet.getLastRow() + ' Zeilen x ' + sheet.getLastColumn() + ' Spalten';
  });
  Logger.log(zeilen.join('\n'));
}

// Schreibt Debug-/Timing-Meldungen direkt in ein Tabellenblatt "DebugLog" -
// zuverlässiger einsehbar als das Apps-Script-Ausführungsprotokoll (dessen UI
// beim Aufklappen einzelner Einträge nicht immer reagiert). Einfach den Tab
// "DebugLog" im Sheet öffnen. Selbstkürzend, damit er nicht unbegrenzt wächst.
function debugLog(msg) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('DebugLog');
    if (!sheet) {
      sheet = ss.insertSheet('DebugLog');
      sheet.appendRow(['Zeit', 'Meldung']);
      sheet.setFrozenRows(1);
    }
    sheet.appendRow([new Date().toISOString(), msg]);
    var lastRow = sheet.getLastRow();
    if (lastRow > 500) sheet.deleteRows(2, Math.floor((lastRow - 1) / 2));
  } catch (e) {
    // Debug-Logging darf nie die eigentliche Aktion zum Scheitern bringen
  }
}

function doPost(e) {
  var t0 = Date.now();
  try {
    if (!e || !e.postData || !e.postData.contents) {
      throw new Error('Kein Request-Body erhalten.');
    }
    var body = JSON.parse(e.postData.contents);
    var action = body.action;
    if (!action) throw new Error('Kein "action" angegeben.');

    // auth.ping wird ohne vollen User-Check gebraucht? -> Nein, alles braucht Auth.
    var user = authenticate(body.idToken);
    var tAuth = Date.now();
    var result = routeAction(action, body.payload || {}, user);
    var tRoute = Date.now();
    debugLog('action=' + action + ' auth=' + (tAuth - t0) + 'ms route=' + (tRoute - tAuth) + 'ms gesamt=' + (tRoute - t0) + 'ms');
    return jsonResponse({ success: true, data: result });
  } catch (err) {
    debugLog('FEHLER bei action nach ' + (Date.now() - t0) + 'ms: ' + err.message);
    return jsonResponse({ success: false, error: err.message });
  }
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ============================================================================
// AUTHENTIFIZIERUNG (Google ID Token)
// ============================================================================

// Verifiziert das ID-Token bei Google (externer Aufruf, der teuerste Teil jedes
// Requests) und cacht das Ergebnis kurz - das Token ist pro Frontend-Sitzung
// bis zu ~1 Std. identisch und wird bei jeder einzelnen Aktion erneut mitgeschickt.
// Ohne Cache würde JEDE Aktion (Liste laden, Speichern, Klick...) einen
// zusätzlichen externen HTTP-Roundtrip zu Google bezahlen.
function verifyIdTokenCached(idToken) {
  var cache = CacheService.getScriptCache();
  var cacheKey = 'authtok_' + Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, idToken)
  );
  var cached = cache.get(cacheKey);
  if (cached) { debugLog('Token-Cache: HIT'); return JSON.parse(cached); }

  var tFetch = Date.now();
  var clientId = PropertiesService.getScriptProperties().getProperty('OAUTH_CLIENT_ID');
  if (!clientId) throw new Error('Server-Konfiguration fehlt: OAUTH_CLIENT_ID Script-Eigenschaft ist nicht gesetzt.');

  var resp = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken), {
    muteHttpExceptions: true
  });
  debugLog('Token-Cache: MISS, UrlFetchApp=' + (Date.now() - tFetch) + 'ms');
  if (resp.getResponseCode() !== 200) {
    throw new Error('Anmeldung ungültig oder abgelaufen. Bitte neu einloggen.');
  }
  var info = JSON.parse(resp.getContentText());

  if (info.aud !== clientId) throw new Error('Token wurde nicht für diese App ausgestellt.');
  if (Number(info.exp) * 1000 < Date.now()) throw new Error('Anmeldung abgelaufen. Bitte neu einloggen.');
  if (info.email_verified !== 'true' && info.email_verified !== true) {
    throw new Error('E-Mail-Adresse ist bei Google nicht verifiziert.');
  }

  var result = { email: info.email.toLowerCase(), name: info.name || info.email };
  // Maximal 5 Minuten cachen (und nie länger als bis das Token selbst abläuft) -
  // das Token bleibt exakt dasselbe, solange die Frontend-Sitzung läuft.
  var ttl = Math.max(0, Math.min(300, Number(info.exp) - Math.floor(Date.now() / 1000)));
  if (ttl > 0) cache.put(cacheKey, JSON.stringify(result), ttl);
  return result;
}

function authenticate(idToken) {
  if (!idToken) throw new Error('Nicht angemeldet (kein ID-Token).');

  // Auch bei bereits verifiziertem Token kostet der Rollen-Check in der
  // "Users"-Tabelle jedes Mal einen vollen (ersten) Tabellenblatt-Zugriff -
  // das ist bei Apps Script der teuerste Teil pro Ausführung (~1-2s), völlig
  // unabhängig von der Datenmenge. Deshalb wird auch das fertige Nutzerobjekt
  // kurz gecacht (Rollenänderungen brauchen dadurch bis zu 60s zum Durchsetzen).
  var cache = CacheService.getScriptCache();
  var userCacheKey = 'user_' + Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, idToken)
  );
  var cachedUser = cache.get(userCacheKey);
  if (cachedUser) { debugLog('User-Cache: HIT'); return JSON.parse(cachedUser); }

  var verified = verifyIdTokenCached(idToken);
  var email = verified.email;
  var name = verified.name;

  var usersSheet = getSheet('Users');
  var rows = sheetToObjects(usersSheet);

  var existing = null;
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].Email).toLowerCase() === email) { existing = rows[i]; break; }
  }

  var result;
  if (!existing) {
    if (rows.length === 0) {
      // Bootstrap: allererster Nutzer wird automatisch Admin
      createRecordRaw('Users', { Email: email, Name: name, Rolle: 'Admin', Status: 'Aktiv', AngelegtAm: nowIso() });
      result = { email: email, name: name, role: 'Admin' };
      cache.put(userCacheKey, JSON.stringify(result), 60);
      return result;
    }
    throw new Error('Dieses Google-Konto (' + email + ') ist noch nicht freigeschaltet. Bitte einen Admin des Betriebs bitten, dich in der Users-Tabelle einzutragen.');
  }

  if (String(existing.Status) !== 'Aktiv') {
    throw new Error('Dieses Konto wurde gesperrt. Bitte einen Admin kontaktieren.');
  }

  result = { email: email, name: existing.Name || name, role: existing.Rolle };
  cache.put(userCacheKey, JSON.stringify(result), 60);
  return result;
}

function requireAdmin(user) {
  if (user.role !== 'Admin') throw new Error('Diese Aktion erfordert Admin-Rechte.');
}

// ============================================================================
// ROUTING
// ============================================================================

function routeAction(action, payload, user) {
  var parts = action.split('.');
  var entity = parts[0];
  var op = parts[1];

  // Spezial-Aktionen (keine generische CRUD-Logik)
  switch (action) {
    case 'auth.me':
      logActivity(user, 'Login', '');
      return user;
    case 'activity.ping':
      logActivity(user, 'Aktiv', payload.context || '');
      return { ok: true };
    case 'dashboard.summary':
      return dashboardSummary();
    case 'dashboard.activeUsers':
      return activeUsers();
    case 'betrieb.get':
      return betriebGet();
    case 'betrieb.update':
      return betriebUpdate(payload, user);
    case 'fruchtfolge.check':
      return fruchtfolgeCheck(payload);
    case 'maschinen.addStunden':
      return maschinenAddStunden(payload, user);
    case 'wartungsintervalle.erfassen':
      return wartungErfassen(payload, user);
    case 'zuchtereignisse.create':
      return zuchtereignisCreate(payload, user);
    case 'abfuellungen.create':
      return abfuellungCreate(payload, user);
    case 'upload.file':
      return uploadFile(payload);
    case 'batch':
      // Führt mehrere Aktionen in EINEM Request/EINER Ausführung aus (siehe Api.batch
      // im Frontend). Spart Roundtrips - mehrere gleichzeitige einzelne Requests an
      // dasselbe Apps-Script-Projekt werden von Google nicht wirklich parallel
      // verarbeitet und sind in Summe langsamer als ein gebündelter Aufruf.
      return (payload.calls || []).map(function (c) {
        var tSub = Date.now();
        try {
          var data = routeAction(c.action, c.payload || {}, user);
          debugLog('  batch-Teil ' + c.action + ': ' + (Date.now() - tSub) + 'ms');
          return { ok: true, data: data };
        } catch (err) {
          debugLog('  batch-Teil ' + c.action + ' FEHLER nach ' + (Date.now() - tSub) + 'ms: ' + err.message);
          return { ok: false, error: err.message };
        }
      });
    default:
      break;
  }

  var sheetName = ENTITY_SHEET_MAP[entity];
  if (!sheetName) throw new Error('Unbekannte Entität: ' + entity);
  var keyCol = ENTITY_KEY_MAP[entity] || 'ID';

  switch (op) {
    case 'list':
      return listRecords(sheetName);
    case 'get':
      return getRecord(sheetName, keyCol, payload.id);
    case 'create':
      if (entity === 'users') requireAdmin(user);
      return createRecord(sheetName, payload, user);
    case 'update':
      if (entity === 'users') requireAdmin(user);
      return updateRecord(sheetName, keyCol, payload.id, payload, user);
    case 'delete':
      requireAdmin(user);
      return deleteRecord(sheetName, keyCol, payload.id);
    default:
      throw new Error('Unbekannte Operation: ' + op);
  }
}

// ============================================================================
// GENERISCHE SHEET/CRUD-HELFER
// ============================================================================

function getSheet(name) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sheet) throw new Error('Tabellenblatt "' + name + '" existiert nicht. Bitte setup() ausführen.');
  return sheet;
}

function getHeaders(sheet) {
  var lastCol = sheet.getLastColumn();
  return sheet.getRange(1, 1, 1, lastCol).getValues()[0];
}

function sheetToObjects(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var headers = getHeaders(sheet);
  var values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  var out = [];
  for (var r = 0; r < values.length; r++) {
    var obj = {};
    for (var c = 0; c < headers.length; c++) {
      obj[headers[c]] = values[r][c];
    }
    obj._row = r + 2; // 1-basierte Sheet-Zeile
    out.push(obj);
  }
  return out;
}

function listRecords(sheetName) {
  var sheet = getSheet(sheetName);
  var rows = sheetToObjects(sheet);
  return rows.map(stripRow);
}

function stripRow(obj) {
  var copy = {};
  Object.keys(obj).forEach(function (k) { if (k !== '_row') copy[k] = obj[k]; });
  return copy;
}

function findByKey(sheetName, keyCol, id) {
  var sheet = getSheet(sheetName);
  var headers = getHeaders(sheet);
  if (headers.indexOf(keyCol) === -1) throw new Error('Tabelle "' + sheetName + '" hat keine Spalte "' + keyCol + '".');
  var rows = sheetToObjects(sheet);
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][keyCol]).toLowerCase() === String(id).toLowerCase()) return rows[i];
  }
  return null;
}

// Rückwärtskompatibler Alias für Stellen, die immer mit der Standard-ID-Spalte arbeiten
// (Fruchtfolge-Prüfung, Betriebsstunden-Schnelleingabe, u.ä.)
function findById(sheetName, id) {
  return findByKey(sheetName, 'ID', id);
}

function getRecord(sheetName, keyCol, id) {
  var rec = findByKey(sheetName, keyCol, id);
  if (!rec) throw new Error('Datensatz nicht gefunden.');
  return stripRow(rec);
}

function createRecord(sheetName, payload, user) {
  return withLock(function () {
    return createRecordRaw(sheetName, payload, user);
  });
}

function createRecordRaw(sheetName, payload, user) {
  var sheet = getSheet(sheetName);
  var headers = getHeaders(sheet);
  var row = headers.map(function (h) {
    if (h === 'ID' && !payload.ID) return Utilities.getUuid();
    if (h === 'ErstelltAm' && !payload.ErstelltAm) return nowIso();
    if (h === 'ErfasstAm' && !payload.ErfasstAm) return nowIso();
    if (h === 'ErstelltVon' && !payload.ErstelltVon) return user ? user.name : '';
    if (h === 'ErfasstVon' && !payload.ErfasstVon) return user ? user.name : '';
    if (h === 'Aktiv' && payload.Aktiv === undefined) return true;
    return payload[h] !== undefined ? payload[h] : '';
  });
  sheet.appendRow(row);
  if (user) logActivity(user, 'Erstellt: ' + sheetName, '');
  var obj = {};
  headers.forEach(function (h, i) { obj[h] = row[i]; });
  return obj;
}

function updateRecord(sheetName, keyCol, id, payload, user) {
  if (!id) throw new Error('Keine ID angegeben.');
  return withLock(function () {
    var sheet = getSheet(sheetName);
    var headers = getHeaders(sheet);
    var rec = findByKey(sheetName, keyCol, id);
    if (!rec) throw new Error('Datensatz nicht gefunden.');
    var rowIndex = rec._row;
    var current = sheet.getRange(rowIndex, 1, 1, headers.length).getValues()[0];
    var updated = headers.map(function (h, i) {
      // Der Schlüssel selbst wird nicht überschrieben, außer explizit im Payload enthalten
      if (h === keyCol && payload[h] === undefined) return current[i];
      return payload[h] !== undefined ? payload[h] : current[i];
    });
    sheet.getRange(rowIndex, 1, 1, headers.length).setValues([updated]);
    if (user) logActivity(user, 'Aktualisiert: ' + sheetName, String(id));
    var obj = {};
    headers.forEach(function (h, i) { obj[h] = updated[i]; });
    return obj;
  });
}

function deleteRecord(sheetName, keyCol, id) {
  if (!id) throw new Error('Keine ID angegeben.');
  return withLock(function () {
    var sheet = getSheet(sheetName);
    var headers = getHeaders(sheet);
    var rec = findByKey(sheetName, keyCol, id);
    if (!rec) throw new Error('Datensatz nicht gefunden.');
    if (headers.indexOf('Aktiv') !== -1) {
      sheet.getRange(rec._row, headers.indexOf('Aktiv') + 1).setValue(false);
    } else {
      sheet.deleteRow(rec._row);
    }
    return { ok: true };
  });
}

function withLock(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function nowIso() {
  return new Date().toISOString();
}

// ============================================================================
// BETRIEB (Stammdaten, eine Zeile)
// ============================================================================

function betriebGet() {
  var sheet = getSheet('Betrieb');
  if (sheet.getLastRow() < 2) return null;
  var headers = getHeaders(sheet);
  var row = sheet.getRange(2, 1, 1, headers.length).getValues()[0];
  var obj = {};
  headers.forEach(function (h, i) { obj[h] = row[i]; });
  return obj;
}

function betriebUpdate(payload, user) {
  requireAdmin(user);
  return withLock(function () {
    var sheet = getSheet('Betrieb');
    var headers = getHeaders(sheet);
    payload.AktualisiertAm = nowIso();
    var row = headers.map(function (h) { return payload[h] !== undefined ? payload[h] : ''; });
    if (sheet.getLastRow() < 2) {
      sheet.appendRow(row);
    } else {
      sheet.getRange(2, 1, 1, headers.length).setValues([row]);
    }
    var obj = {};
    headers.forEach(function (h, i) { obj[h] = row[i]; });
    return obj;
  });
}

// ============================================================================
// FRUCHTFOLGE-PRÜFUNG
// ============================================================================

function fruchtfolgeCheck(payload) {
  var flaecheId = payload.flaecheId;
  var jahr = Number(payload.jahr);
  var kultur = payload.kultur;

  var kulturenRows = sheetToObjects(getSheet('Kulturen'));
  var kulturInfo = null;
  for (var i = 0; i < kulturenRows.length; i++) {
    if (kulturenRows[i].Kultur === kultur) { kulturInfo = kulturenRows[i]; break; }
  }

  var history = sheetToObjects(getSheet('Fruchtfolge'))
    .filter(function (r) { return String(r.FlaecheID) === String(flaecheId) && Number(r.Jahr) < jahr; })
    .sort(function (a, b) { return Number(b.Jahr) - Number(a.Jahr); });

  var warnings = [];

  if (kulturInfo && history.length > 0) {
    var vorfrucht = history[0];
    var unvertraeglich = String(kulturInfo.UnvertraeglicheVorfruechte || '')
      .split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    if (unvertraeglich.indexOf(vorfrucht.Kultur) !== -1) {
      warnings.push('"' + kultur + '" verträgt sich schlecht mit der Vorfrucht "' + vorfrucht.Kultur + '" (' + vorfrucht.Jahr + ').');
    }

    var pause = Number(kulturInfo.AnbaupauseJahre || 0);
    if (pause > 0) {
      for (var j = 0; j < history.length; j++) {
        if (history[j].Kultur === kultur && (jahr - Number(history[j].Jahr)) < pause) {
          warnings.push('"' + kultur + '" wurde zuletzt ' + history[j].Jahr + ' angebaut. Empfohlene Anbaupause: ' + pause + ' Jahr(e).');
          break;
        }
      }
    }
  }

  return { ok: warnings.length === 0, warnings: warnings, kulturInfo: kulturInfo ? stripRow(kulturInfo) : null };
}

// ============================================================================
// MASCHINEN: BETRIEBSSTUNDEN-SCHNELLEINGABE
// ============================================================================

function maschinenAddStunden(payload, user) {
  var maschinenId = payload.maschinenId;
  var delta = Number(payload.stundenDelta);
  if (!maschinenId || !delta) throw new Error('MaschinenID und StundenDelta erforderlich.');

  return withLock(function () {
    createRecordRaw('Betriebsstunden', {
      MaschinenID: maschinenId,
      Datum: payload.datum || nowIso(),
      StundenDelta: delta,
      Notiz: payload.notiz || ''
    }, user);

    var sheet = getSheet('Maschinen');
    var headers = getHeaders(sheet);
    var rec = findById('Maschinen', maschinenId);
    if (!rec) throw new Error('Maschine nicht gefunden.');
    var col = headers.indexOf('BetriebsstundenAktuell') + 1;
    var neu = Number(rec.BetriebsstundenAktuell || 0) + delta;
    sheet.getRange(rec._row, col).setValue(neu);
    logActivity(user, 'Betriebsstunden erfasst', maschinenId + ' (+' + delta + ')');
    return { maschinenId: maschinenId, neueBetriebsstunden: neu };
  });
}

// ============================================================================
// WARTUNG ERLEDIGT MELDEN (setzt Intervall-Zähler zurück + erfasst Kosten)
// ============================================================================

function wartungErfassen(payload, user) {
  var intervallId = payload.id;
  if (!intervallId) throw new Error('Kein Wartungsintervall angegeben.');

  return withLock(function () {
    var sheet = getSheet('WartungsIntervalle');
    var headers = getHeaders(sheet);
    var rec = findById('WartungsIntervalle', intervallId);
    if (!rec) throw new Error('Wartungsintervall nicht gefunden.');

    var datum = payload.datum || nowIso();
    var betriebsstunden = payload.betriebsstunden !== undefined && payload.betriebsstunden !== ''
      ? Number(payload.betriebsstunden) : rec.LetzteWartungStunden;

    var updated = headers.map(function (h) {
      if (h === 'LetzteWartungStunden') return betriebsstunden;
      if (h === 'LetzteWartungDatum') return datum;
      return rec[h];
    });
    sheet.getRange(rec._row, 1, 1, headers.length).setValues([updated]);

    var kostenEntry = null;
    if (payload.kosten) {
      kostenEntry = createRecordRaw('MaschinenKosten', {
        MaschinenID: rec.MaschinenID,
        Datum: datum,
        Kategorie: 'Wartung',
        Betrag: payload.kosten,
        Beschreibung: 'Wartung erledigt: ' + rec.Bezeichnung,
        BelegDriveFileID: payload.belegDriveFileID || '',
        BelegURL: payload.belegURL || ''
      }, user);
    }

    logActivity(user, 'Wartung erledigt gemeldet', rec.Bezeichnung);
    return { ok: true, kosten: kostenEntry };
  });
}

// ============================================================================
// ZUCHTKALENDER (Rinder)
// ============================================================================

var TRAECHTIGKEITSDAUER_TAGE = 283; // Rind, Standardwert
var TROCKENSTELLEN_TAGE_VOR_ABKALBUNG = 60;

function addTage(isoDatum, tage) {
  var d = new Date(isoDatum);
  d.setDate(d.getDate() + tage);
  return d.toISOString();
}

function zuchtereignisCreate(payload, user) {
  var typ = payload.Typ;
  var abkalbedatum = payload.VoraussichtlichesAbkalbedatum || '';
  var trockenstellenAb = payload.TrockenstellenAb || '';

  if ((typ === 'Besamung' || typ === 'Deckung') && payload.Datum) {
    abkalbedatum = addTage(payload.Datum, TRAECHTIGKEITSDAUER_TAGE);
    trockenstellenAb = addTage(abkalbedatum, -TROCKENSTELLEN_TAGE_VOR_ABKALBUNG);
  }

  return createRecord('Zuchtereignisse', Object.assign({}, payload, {
    VoraussichtlichesAbkalbedatum: abkalbedatum,
    TrockenstellenAb: trockenstellenAb
  }), user);
}

// ============================================================================
// KELLERWIRTSCHAFT: ABFÜLLUNG (reduziert Tank-Inhalt automatisch)
// ============================================================================

function abfuellungCreate(payload, user) {
  var tankId = payload.TankID;
  if (!tankId) throw new Error('Kein Tank angegeben.');

  return withLock(function () {
    var entry = createRecordRaw('Abfuellungen', payload, user);
    var tank = findById('Tanks', tankId);
    var flaschenAnzahl = Number(payload.FlaschenAnzahl) || 0;
    var groesseMl = Number(payload.FlaschenGroesseMl) || 0;

    if (tank) {
      // Abfüllung ist der letzte Schritt der Charge - das Fass gilt danach als
      // vollständig geleert (unabhängig von Rundungsdifferenzen Liter/Flaschen).
      var tankSheet = getSheet('Tanks');
      var tankHeaders = getHeaders(tankSheet);
      tankSheet.getRange(tank._row, tankHeaders.indexOf('AktuellerInhaltLiter') + 1).setValue(0);
    }

    if (flaschenAnzahl > 0 && tank) {
      var bestand = sheetToObjects(getSheet('Flaschenbestand')).filter(function (b) {
        return b.Aktiv !== false && b.Sorte === tank.Sorte && String(b.Jahrgang) === String(tank.Jahrgang) && Number(b.FlaschenGroesseMl) === groesseMl;
      })[0];
      if (!bestand) {
        bestand = createRecordRaw('Flaschenbestand', {
          Bezeichnung: (tank.Sorte || 'Wein') + ' ' + (tank.Jahrgang || ''), Sorte: tank.Sorte, Jahrgang: tank.Jahrgang,
          FlaschenGroesseMl: groesseMl, AnzahlAktuell: 0
        }, user);
      }
      createRecordRaw('FlaschenBewegungen', {
        FlaschenbestandID: bestand.ID, Datum: payload.Datum, Typ: 'Zugang (Abfüllung)',
        Anzahl: flaschenAnzahl, Notiz: 'Abfüllung Charge ' + (payload.Charge || '')
      }, user);
      var fSheet = getSheet('Flaschenbestand');
      var fHeaders = getHeaders(fSheet);
      var bestandRow = findById('Flaschenbestand', bestand.ID);
      fSheet.getRange(bestandRow._row, fHeaders.indexOf('AnzahlAktuell') + 1).setValue(Number(bestandRow.AnzahlAktuell || 0) + flaschenAnzahl);
    }

    logActivity(user, 'Abfüllung erfasst', tankId);
    return entry;
  });
}

// ============================================================================
// DRIVE-UPLOAD (Belege)
// ============================================================================

function getOrCreateDriveRootFolder() {
  var it = DriveApp.getFoldersByName(DRIVE_ROOT_FOLDER_NAME);
  var folder = it.hasNext() ? it.next() : DriveApp.createFolder(DRIVE_ROOT_FOLDER_NAME);
  return folder;
}

function getOrCreateSubfolder(parent, name) {
  var it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

function uploadFile(payload) {
  if (!payload.base64Data || !payload.fileName) throw new Error('Datei fehlt.');
  var root = getOrCreateDriveRootFolder();
  var sub = getOrCreateSubfolder(root, payload.category === 'tier' ? 'Tiere' : 'Maschinen');

  var bytes = Utilities.base64Decode(payload.base64Data);
  var blob = Utilities.newBlob(bytes, payload.mimeType || 'application/octet-stream', payload.fileName);
  var file = sub.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  return { fileId: file.getId(), url: file.getUrl(), downloadUrl: 'https://drive.google.com/uc?id=' + file.getId() };
}

// ============================================================================
// DASHBOARD / AKTIVITÄT
// ============================================================================

var AKTIVITAETSLOG_MAX_ZEILEN = 1500; // ab hier wird die älteste Hälfte automatisch entfernt
var AKTIVITAETSLOG_LESE_FENSTER = 300; // für "aktiv in den letzten 15 Min." reichen die letzten Zeilen völlig

function logActivity(user, aktion, details) {
  try {
    createRecordRaw('AktivitaetsLog', {
      Timestamp: nowIso(),
      UserEmail: user.email,
      UserName: user.name,
      Aktion: aktion,
      Details: details || ''
    });
    // Tabelle klein & schnell halten - ohne das würde JEDER Login/Dashboard-Aufruf
    // (siehe activeUsers()) mit der Zeit ein immer größeres Blatt komplett einlesen
    // müssen und die App würde spürbar langsamer werden.
    var sheet = getSheet('AktivitaetsLog');
    var lastRow = sheet.getLastRow();
    if (lastRow > AKTIVITAETSLOG_MAX_ZEILEN) {
      sheet.deleteRows(2, Math.floor((lastRow - 1) / 2));
    }
  } catch (e) {
    // Aktivitäts-Logging darf nie die eigentliche Aktion zum Scheitern bringen
  }
}

function activeUsers() {
  var cache = CacheService.getScriptCache();
  var cached = cache.get('activeUsers');
  if (cached) return JSON.parse(cached);

  var sheet = getSheet('AktivitaetsLog');
  var lastRow = sheet.getLastRow();
  var result = [];
  if (lastRow >= 2) {
    var headers = getHeaders(sheet);
    var startRow = Math.max(2, lastRow - AKTIVITAETSLOG_LESE_FENSTER + 1);
    var values = sheet.getRange(startRow, 1, lastRow - startRow + 1, headers.length).getValues();

    var cutoff = Date.now() - 15 * 60 * 1000; // 15 Minuten
    var byUser = {};
    values.forEach(function (row) {
      var r = {};
      headers.forEach(function (h, i) { r[h] = row[i]; });
      var t = new Date(r.Timestamp).getTime();
      if (t >= cutoff) {
        if (!byUser[r.UserEmail] || new Date(byUser[r.UserEmail].Timestamp).getTime() < t) {
          byUser[r.UserEmail] = r;
        }
      }
    });
    result = Object.keys(byUser).map(function (email) {
      return { email: email, name: byUser[email].UserName, lastSeen: byUser[email].Timestamp };
    });
  }

  // Kurz cachen (15s) - "wer ist aktiv" muss nicht sekundengenau sein, wird aber
  // sowohl alle 60s einzeln als auch bei jedem Dashboard-Aufruf mitgeladen.
  cache.put('activeUsers', JSON.stringify(result), 15);
  return result;
}

function dashboardSummary() {
  var cache = CacheService.getScriptCache();
  var cached = cache.get('dashboardSummary');
  if (cached) { debugLog('Dashboard-Cache: HIT'); return JSON.parse(cached); }
  var tStart = Date.now();

  var flaechen = sheetToObjects(getSheet('Flaechen')).filter(function (r) { return r.Aktiv !== false; });
  var maschinen = sheetToObjects(getSheet('Maschinen')).filter(function (r) { return r.Aktiv !== false; });
  var tiere = sheetToObjects(getSheet('Tiere')).filter(function (r) { return r.Status === 'Lebend'; });
  var tierbestand = sheetToObjects(getSheet('Tierbestand')).filter(function (r) { return r.Aktiv !== false; });

  var flaecheGesamtHa = flaechen.reduce(function (sum, f) { return sum + Number(f.FlaecheHa || 0); }, 0);
  var tierbestandGesamt = tierbestand.reduce(function (sum, t) { return sum + Number(t.AnzahlAktuell || 0); }, 0);

  var maschinenKosten = sheetToObjects(getSheet('MaschinenKosten'));
  var tierKosten = sheetToObjects(getSheet('TierKosten'));
  var tierErloese = sheetToObjects(getSheet('TierErloese'));
  var allgemeineKosten = sheetToObjects(getSheet('AllgemeineKosten'));
  var erntevermarktung = sheetToObjects(getSheet('Erntevermarktung'));

  var sumBetrag = function (rows, feld) { return rows.reduce(function (s, r) { return s + Number(r[feld || 'Betrag'] || 0); }, 0); };

  var kostenGesamt = sumBetrag(maschinenKosten) + sumBetrag(tierKosten) + sumBetrag(allgemeineKosten);
  var erloeseGesamt = sumBetrag(tierErloese) + sumBetrag(erntevermarktung, 'Erloes');

  var result = {
    flaechenAnzahl: flaechen.length,
    flaecheGesamtHa: flaecheGesamtHa,
    maschinenAnzahl: maschinen.length,
    tiereAnzahl: tiere.length,
    tierbestandGesamt: tierbestandGesamt,
    finanzen: {
      maschinenKostenGesamt: sumBetrag(maschinenKosten),
      tierKostenGesamt: sumBetrag(tierKosten),
      tierErloeseGesamt: sumBetrag(tierErloese),
      allgemeineKostenGesamt: sumBetrag(allgemeineKosten),
      erntevermarktungErloeseGesamt: sumBetrag(erntevermarktung, 'Erloes'),
      kostenGesamt: kostenGesamt,
      erloeseGesamt: erloeseGesamt,
      saldo: erloeseGesamt - kostenGesamt
    },
    aktiveNutzer: activeUsers()
  };

  debugLog('Dashboard-Cache: MISS, Berechnung=' + (Date.now() - tStart) + 'ms');
  cache.put('dashboardSummary', JSON.stringify(result), 20);
  return result;
}
