/**
 * EINMAL-SKRIPT: überträgt alle bestehenden Daten aus diesem Google Sheet nach Supabase.
 *
 * ANLEITUNG:
 *  1. Zuerst im Supabase SQL Editor das "RLS temporär deaktivieren"-Skript ausführen
 *     (separat zugeschickt) - sonst blockiert die Absicherung den Massenimport.
 *  2. Diese Datei als NEUE Datei in eurem BESTEHENDEN Apps-Script-Projekt anlegen
 *     (Apps-Script-Editor -> "+" neben Dateien -> Skript -> Namen z.B. "Migration" geben,
 *     diesen kompletten Inhalt einfügen).
 *  3. Projekteinstellungen -> Script-Eigenschaften -> zwei neue Einträge hinzufügen:
 *       SUPABASE_URL        = https://lovdniycmhfnraozhfnh.supabase.co
 *       SUPABASE_ANON_KEY   = sb_publishable_CDpZVQnbGSWhzTVGSddmEQ_F6KB9jbb (derselbe Key wie in config.js)
 *  4. Oben in der Funktionsauswahl "migrateAllToSupabase" wählen -> Ausführen.
 *  5. Im Ausführungsprotokoll (Ansicht -> Protokolle) prüfen, ob alle Tabellen ohne
 *     "FEHLER"-Zeile durchgelaufen sind.
 *  6. Danach unbedingt das "RLS wieder aktivieren"-Skript ausführen (sonst liegen die
 *     Daten offen für jeden mit dem öffentlichen Key).
 *
 * Reihenfolge ist bewusst so gewählt, dass übergeordnete Tabellen (z.B. Flaechen) vor
 * den davon abhängigen (z.B. Schnitte) übertragen werden - sonst würden die Fremdschlüssel-
 * Prüfungen in Postgres die abhängigen Zeilen ablehnen.
 */
function migrateAllToSupabase() {
  var props = PropertiesService.getScriptProperties();
  var SUPABASE_URL = props.getProperty('SUPABASE_URL');
  var SERVICE_KEY = props.getProperty('SUPABASE_ANON_KEY');
  if (!SUPABASE_URL || !SERVICE_KEY) {
    throw new Error('Bitte SUPABASE_URL und SUPABASE_ANON_KEY in den Script-Eigenschaften setzen (siehe Kommentar oben in dieser Datei).');
  }

  var TABELLEN = [
    { sheet: 'Kulturen', table: 'kulturen', pk: 'kultur', felder: {
      Kultur: 'kultur', Kategorie: 'kategorie', SaatmengeKgHa: 'saatmenge_kg_ha',
      DuengeempfehlungN_KgHa: 'duengeempfehlung_n_kg_ha', DuengeempfehlungP_KgHa: 'duengeempfehlung_p_kg_ha',
      DuengeempfehlungK_KgHa: 'duengeempfehlung_k_kg_ha', UnvertraeglicheVorfruechte: 'unvertraegliche_vorfruechte',
      AnbaupauseJahre: 'anbaupause_jahre', KartenFarbe: 'karten_farbe', KartenSymbol: 'karten_symbol'
    } },
    { sheet: 'Flaechen', table: 'flaechen', felder: {
      ID: 'id', Name: 'name', KatastralGemeinde: 'katastral_gemeinde', Parzellennummer: 'parzellennummer',
      FlaecheHa: 'flaeche_ha', Besitzart: 'besitzart', Nutzungsart: 'nutzungsart', Rebsorte: 'rebsorte',
      AnzahlPflanzen: 'anzahl_pflanzen', ArbeitsablaufJSON: 'arbeitsablauf_json', GeoJSON: 'geojson',
      Notiz: 'notiz', ErstelltVon: 'erstellt_von', ErstelltAm: 'erstellt_am', Aktiv: 'aktiv'
    }, json: ['arbeitsablauf_json', 'geojson'], bool: ['aktiv'], timestamp: ['erstellt_am'] },
    { sheet: 'SubFlaechen', table: 'sub_flaechen', felder: {
      ID: 'id', FlaecheID: 'flaeche_id', Name: 'name', Rebsorte: 'rebsorte', FlaecheM2: 'flaeche_m2',
      Pflanzjahr: 'pflanzjahr', GeoJSON: 'geojson', Notiz: 'notiz', ErstelltVon: 'erstellt_von',
      ErstelltAm: 'erstellt_am', Aktiv: 'aktiv'
    }, json: ['geojson'], bool: ['aktiv'], timestamp: ['erstellt_am'] },
    { sheet: 'Fruchtfolge', table: 'fruchtfolge', felder: {
      ID: 'id', FlaecheID: 'flaeche_id', Jahr: 'jahr', Kultur: 'kultur', Aussaatdatum: 'aussaatdatum',
      Erntedatum: 'erntedatum', ErtragsMenge: 'ertragsmenge', ErtragsEinheit: 'ertragseinheit',
      SaatmengeKgHaBerechnet: 'saatmenge_kg_ha_berechnet', SaatmengeGesamtKg: 'saatmenge_gesamt_kg',
      Notiz: 'notiz', ErstelltVon: 'erstellt_von', ErstelltAm: 'erstellt_am'
    }, date: ['aussaatdatum', 'erntedatum'], timestamp: ['erstellt_am'] },
    { sheet: 'Schnitte', table: 'schnitte', felder: {
      ID: 'id', FlaecheID: 'flaeche_id', SchnittNummer: 'schnitt_nummer', Datum: 'datum',
      Erntetyp: 'erntetyp', ErtragsMenge: 'ertragsmenge', ErtragsEinheit: 'ertragseinheit', Notiz: 'notiz',
      ErfasstVon: 'erfasst_von', ErfasstAm: 'erfasst_am'
    }, date: ['datum'], timestamp: ['erfasst_am'] },
    { sheet: 'Feldarbeiten', table: 'feldarbeiten', felder: {
      ID: 'id', FlaecheID: 'flaeche_id', Schritt: 'schritt', Datum: 'datum', Notiz: 'notiz',
      ErfasstVon: 'erfasst_von', ErfasstAm: 'erfasst_am'
    }, date: ['datum'], timestamp: ['erfasst_am'] },
    { sheet: 'Duengungen', table: 'duengungen', felder: {
      ID: 'id', FlaecheID: 'flaeche_id', Datum: 'datum', Duengerart: 'duengerart', Menge: 'menge',
      Einheit: 'einheit', Notiz: 'notiz', ErfasstVon: 'erfasst_von', ErfasstAm: 'erfasst_am'
    }, date: ['datum'], timestamp: ['erfasst_am'] },
    { sheet: 'WeinbauMassnahmen', table: 'weinbau_massnahmen', felder: {
      ID: 'id', SubFlaecheID: 'sub_flaeche_id', Datum: 'datum', Massnahme: 'massnahme', Bio: 'bio',
      Mittel: 'mittel', Notiz: 'notiz', ErfasstVon: 'erfasst_von', ErfasstAm: 'erfasst_am'
    }, date: ['datum'], bool: ['bio'], timestamp: ['erfasst_am'] },
    { sheet: 'Reifemessungen', table: 'reifemessungen', felder: {
      ID: 'id', SubFlaecheID: 'sub_flaeche_id', Datum: 'datum', Oechsle: 'oechsle', Brix: 'brix',
      KMW: 'kmw', Saeure: 'saeure', PH: 'ph', Notiz: 'notiz', ErfasstVon: 'erfasst_von', ErfasstAm: 'erfasst_am'
    }, date: ['datum'], timestamp: ['erfasst_am'] },
    { sheet: 'WeinLese', table: 'wein_lese', felder: {
      ID: 'id', SubFlaecheID: 'sub_flaeche_id', Datum: 'datum', MengeKg: 'menge_kg',
      MostgewichtOechsle: 'mostgewicht_oechsle', Notiz: 'notiz', ErfasstVon: 'erfasst_von', ErfasstAm: 'erfasst_am'
    }, date: ['datum'], timestamp: ['erfasst_am'] },
    { sheet: 'Tanks', table: 'tanks', felder: {
      ID: 'id', Bezeichnung: 'bezeichnung', VolumenLiter: 'volumen_liter',
      AktuellerInhaltLiter: 'aktueller_inhalt_liter', Sorte: 'sorte', Jahrgang: 'jahrgang', Notiz: 'notiz',
      ErstelltVon: 'erstellt_von', ErstelltAm: 'erstellt_am', Aktiv: 'aktiv'
    }, bool: ['aktiv'], timestamp: ['erstellt_am'] },
    { sheet: 'KellerLogbuch', table: 'keller_logbuch', felder: {
      ID: 'id', TankID: 'tank_id', Datum: 'datum', Aktion: 'aktion', Oechsle: 'oechsle', Brix: 'brix',
      KMW: 'kmw', RestzuckerGL: 'restzucker_gl', VerbleibendLiter: 'verbleibend_liter', Notiz: 'notiz',
      ErfasstVon: 'erfasst_von', ErfasstAm: 'erfasst_am'
    }, date: ['datum'], timestamp: ['erfasst_am'] },
    { sheet: 'Abfuellungen', table: 'abfuellungen', felder: {
      ID: 'id', TankID: 'tank_id', Datum: 'datum', FlaschenAnzahl: 'flaschen_anzahl',
      FlaschenGroesseMl: 'flaschen_groesse_ml', Charge: 'charge', Notiz: 'notiz',
      ErfasstVon: 'erfasst_von', ErfasstAm: 'erfasst_am'
    }, date: ['datum'], timestamp: ['erfasst_am'] },
    { sheet: 'Flaschenbestand', table: 'flaschenbestand', felder: {
      ID: 'id', Bezeichnung: 'bezeichnung', Sorte: 'sorte', Jahrgang: 'jahrgang',
      FlaschenGroesseMl: 'flaschen_groesse_ml', AnzahlAktuell: 'anzahl_aktuell', FotoURL: 'foto_url',
      Notiz: 'notiz', ErstelltVon: 'erstellt_von', ErstelltAm: 'erstellt_am', Aktiv: 'aktiv'
    }, bool: ['aktiv'], timestamp: ['erstellt_am'] },
    { sheet: 'FlaschenBewegungen', table: 'flaschen_bewegungen', felder: {
      ID: 'id', FlaschenbestandID: 'flaschenbestand_id', Datum: 'datum', Typ: 'typ', Anzahl: 'anzahl',
      Erloes: 'erloes', Notiz: 'notiz', ErfasstVon: 'erfasst_von', ErfasstAm: 'erfasst_am'
    }, date: ['datum'], timestamp: ['erfasst_am'] },
    { sheet: 'Maschinen', table: 'maschinen', felder: {
      ID: 'id', GeraeteNummer: 'geraete_nummer', Bezeichnung: 'bezeichnung', Typ: 'typ',
      Baujahr: 'baujahr', Anschaffungspreis: 'anschaffungspreis', Anschaffungsdatum: 'anschaffungsdatum',
      BetriebsstundenAktuell: 'betriebsstunden_aktuell', FotoURL: 'foto_url', DokumenteJSON: 'dokumente_json',
      Notiz: 'notiz', ErstelltVon: 'erstellt_von', ErstelltAm: 'erstellt_am', Aktiv: 'aktiv'
    }, json: ['dokumente_json'], date: ['anschaffungsdatum'], bool: ['aktiv'], timestamp: ['erstellt_am'] },
    { sheet: 'Betriebsstunden', table: 'betriebsstunden', felder: {
      ID: 'id', MaschinenID: 'maschinen_id', Datum: 'datum', StundenDelta: 'stunden_delta',
      Notiz: 'notiz', ErfasstVon: 'erfasst_von', ErfasstAm: 'erfasst_am'
    }, date: ['datum'], timestamp: ['erfasst_am'] },
    { sheet: 'WartungsIntervalle', table: 'wartungs_intervalle', felder: {
      ID: 'id', MaschinenID: 'maschinen_id', Bezeichnung: 'bezeichnung',
      IntervallStunden: 'intervall_stunden', IntervallMonate: 'intervall_monate',
      LetzteWartungStunden: 'letzte_wartung_stunden', LetzteWartungDatum: 'letzte_wartung_datum', Notiz: 'notiz'
    }, date: ['letzte_wartung_datum'] },
    { sheet: 'MaschinenKosten', table: 'maschinen_kosten', felder: {
      ID: 'id', MaschinenID: 'maschinen_id', Datum: 'datum', Kategorie: 'kategorie', Betrag: 'betrag',
      Beschreibung: 'beschreibung', BelegURL: 'beleg_url', ErfasstVon: 'erfasst_von', ErfasstAm: 'erfasst_am'
    }, date: ['datum'], timestamp: ['erfasst_am'] },
    { sheet: 'AllgemeineKosten', table: 'allgemeine_kosten', felder: {
      ID: 'id', Datum: 'datum', Kategorie: 'kategorie', MengeLiter: 'menge_liter', Betrag: 'betrag',
      Beschreibung: 'beschreibung', BelegURL: 'beleg_url', ErfasstVon: 'erfasst_von', ErfasstAm: 'erfasst_am'
    }, date: ['datum'], timestamp: ['erfasst_am'] },
    { sheet: 'Erntevermarktung', table: 'erntevermarktung', felder: {
      ID: 'id', Datum: 'datum', Kategorie: 'kategorie', Menge: 'menge', Einheit: 'einheit',
      Erloes: 'erloes', Beschreibung: 'beschreibung', ErfasstVon: 'erfasst_von', ErfasstAm: 'erfasst_am'
    }, date: ['datum'], timestamp: ['erfasst_am'] },
    { sheet: 'Tiere', table: 'tiere', felder: {
      ID: 'id', Tierart: 'tierart', Ohrmarke: 'ohrmarke', Rasse: 'rasse', Name: 'name',
      Geburtsdatum: 'geburtsdatum', Geschlecht: 'geschlecht', Status: 'status',
      MutterOhrmarke: 'mutter_ohrmarke', Notiz: 'notiz', ErstelltVon: 'erstellt_von', ErstelltAm: 'erstellt_am'
    }, date: ['geburtsdatum'], timestamp: ['erstellt_am'] },
    { sheet: 'Zuchtereignisse', table: 'zuchtereignisse', felder: {
      ID: 'id', TierID: 'tier_id', Datum: 'datum', Typ: 'typ', Vatertier: 'vatertier',
      VoraussichtlichesAbkalbedatum: 'voraussichtliches_abkalbedatum', TrockenstellenAb: 'trockenstellen_ab',
      Notiz: 'notiz', ErfasstVon: 'erfasst_von', ErfasstAm: 'erfasst_am'
    }, date: ['datum', 'voraussichtliches_abkalbedatum', 'trockenstellen_ab'], timestamp: ['erfasst_am'] },
    { sheet: 'TierKosten', table: 'tier_kosten', felder: {
      ID: 'id', TierID: 'tier_id', Datum: 'datum', Kategorie: 'kategorie', Betrag: 'betrag',
      Beschreibung: 'beschreibung', BelegURL: 'beleg_url', ErfasstVon: 'erfasst_von', ErfasstAm: 'erfasst_am'
    }, date: ['datum'], timestamp: ['erfasst_am'] },
    { sheet: 'TierErloese', table: 'tier_erloese', felder: {
      ID: 'id', TierID: 'tier_id', Datum: 'datum', Art: 'art', Betrag: 'betrag',
      Beschreibung: 'beschreibung', ErfasstVon: 'erfasst_von', ErfasstAm: 'erfasst_am'
    }, date: ['datum'], timestamp: ['erfasst_am'] },
    { sheet: 'Tierbestand', table: 'tierbestand', felder: {
      ID: 'id', Tierart: 'tierart', Bezeichnung: 'bezeichnung', AnzahlAktuell: 'anzahl_aktuell',
      Notiz: 'notiz', ErstelltVon: 'erstellt_von', ErstelltAm: 'erstellt_am', Aktiv: 'aktiv'
    }, bool: ['aktiv'], timestamp: ['erstellt_am'] },
    { sheet: 'TierbestandBewegungen', table: 'tierbestand_bewegungen', felder: {
      ID: 'id', TierbestandID: 'tierbestand_id', Datum: 'datum', Typ: 'typ', Anzahl: 'anzahl',
      Notiz: 'notiz', ErfasstVon: 'erfasst_von'
    }, date: ['datum'] },
    { sheet: 'Futtermittel', table: 'futtermittel', felder: {
      ID: 'id', Bezeichnung: 'bezeichnung', Kategorie: 'kategorie', Einheit: 'einheit',
      BestandAktuell: 'bestand_aktuell', MindestBestand: 'mindest_bestand', Notiz: 'notiz',
      ErstelltVon: 'erstellt_von', ErstelltAm: 'erstellt_am', Aktiv: 'aktiv'
    }, bool: ['aktiv'], timestamp: ['erstellt_am'] },
    { sheet: 'FuttermittelBewegungen', table: 'futtermittel_bewegungen', felder: {
      ID: 'id', FuttermittelID: 'futtermittel_id', Datum: 'datum', Typ: 'typ', Menge: 'menge',
      HerkunftFlaecheID: 'herkunft_flaeche_id', Notiz: 'notiz', ErfasstVon: 'erfasst_von', ErfasstAm: 'erfasst_am'
    }, date: ['datum'], timestamp: ['erfasst_am'] },
    { sheet: 'Todos', table: 'todos', felder: {
      ID: 'id', Text: 'text', Prioritaet: 'prioritaet', Erledigt: 'erledigt',
      ErstelltVon: 'erstellt_von', ErstelltAm: 'erstellt_am'
    }, bool: ['erledigt'], timestamp: ['erstellt_am'] }
  ];

  TABELLEN.forEach(function (cfg) {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(cfg.sheet);
    if (!sheet) { Logger.log(cfg.sheet + ': Tabellenblatt nicht gefunden, übersprungen.'); return; }
    var rows = sheetToObjects(sheet);
    var pk = cfg.pk || 'id';

    var payload = rows.map(function (row) {
      var out = {};
      Object.keys(cfg.felder).forEach(function (quelle) {
        var ziel = cfg.felder[quelle];
        out[ziel] = wertUmwandeln(row[quelle], ziel, cfg);
      });
      return out;
    }).filter(function (r) { return r[pk] !== '' && r[pk] !== null && r[pk] !== undefined; });

    if (!payload.length) { Logger.log(cfg.sheet + ': keine Zeilen zu übertragen.'); return; }
    postBatch(cfg.table, payload, pk);
  });

  // Betrieb ist eine einzelne, feste Zeile (id=1 existiert bereits durch das Schema-Skript) - Update statt Insert.
  var betriebSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Betrieb');
  if (betriebSheet) {
    var betriebRows = sheetToObjects(betriebSheet);
    if (betriebRows.length) {
      var b = betriebRows[0];
      postBatch('betrieb', [{
        id: 1,
        hof_name: b.HofName || null, adresse: b.Adresse || null, betriebsnummer: b.Betriebsnummer || null,
        ansprechpartner: b.Ansprechpartner || null,
        erinnerung_wochen_vorher: b.ErinnerungWochenVorher || null,
        aktualisiert_am: wertUmwandeln(b.AktualisiertAm, 'aktualisiert_am', { timestamp: ['aktualisiert_am'] })
      }], 'id');
    }
  }

  Logger.log('=== Migration abgeschlossen. Bitte oben im Protokoll auf "FEHLER"-Zeilen prüfen. ===');

  function wertUmwandeln(wert, zielSpalte, cfg) {
    if (wert === '' || wert === null || wert === undefined) return null;
    if (cfg.json && cfg.json.indexOf(zielSpalte) !== -1) {
      try { return JSON.parse(wert); } catch (e) { return null; }
    }
    if (cfg.bool && cfg.bool.indexOf(zielSpalte) !== -1) {
      return wert === true || wert === 'TRUE' || wert === 'true' || wert === 1;
    }
    if (cfg.date && cfg.date.indexOf(zielSpalte) !== -1) {
      var d = (wert instanceof Date) ? wert : new Date(wert);
      return isNaN(d.getTime()) ? null : Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    }
    if (cfg.timestamp && cfg.timestamp.indexOf(zielSpalte) !== -1) {
      var dt = (wert instanceof Date) ? wert : new Date(wert);
      return isNaN(dt.getTime()) ? null : dt.toISOString();
    }
    // Manche Zellen sind in der Tabelle (vermutlich durch Kopieren/Formatieren) versehentlich
    // als Datum formatiert, obwohl eigentlich eine Zahl drinsteht (z.B. Oechsle/Saeure/PH) -
    // ein Date-Objekt für ein Zahlenfeld würde die ganze Zeile mit einem Fehler ablehnen.
    // Lieber dieses eine Feld leer lassen (später von Hand nachtragen) als die Zeile verlieren.
    if (wert instanceof Date) return null;
    return wert;
  }

  function postBatch(table, rows, pk) {
    var CHUNK = 300;
    for (var i = 0; i < rows.length; i += CHUNK) {
      var chunk = rows.slice(i, i + CHUNK);
      var resp = UrlFetchApp.fetch(SUPABASE_URL + '/rest/v1/' + table + '?on_conflict=' + pk, {
        method: 'post',
        contentType: 'application/json',
        headers: { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY, Prefer: 'resolution=merge-duplicates' },
        payload: JSON.stringify(chunk),
        muteHttpExceptions: true
      });
      if (resp.getResponseCode() >= 300) {
        Logger.log('FEHLER bei ' + table + ' (Zeilen ' + i + '-' + (i + chunk.length) + '): ' + resp.getResponseCode() + ' ' + resp.getContentText());
      } else {
        Logger.log(table + ': ' + chunk.length + ' Zeilen übertragen (' + Math.min(i + CHUNK, rows.length) + '/' + rows.length + ')');
      }
    }
  }
}
