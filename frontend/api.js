// ============================================================================
// AUTH (Supabase Auth mit Google OAuth) + API-LAYER (Supabase Postgres/Storage)
// ============================================================================

const supabaseClient = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const Auth = {
  _onSignedIn: null,
  _onSignedOut: null,
  _signedInFired: false,

  init(onSignedIn, onSignedOut) {
    this._onSignedIn = onSignedIn;
    this._onSignedOut = onSignedOut;

    document.getElementById('btnGoogleSignIn').onclick = () => {
      supabaseClient.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: location.origin + location.pathname }
      });
    };

    // onAuthStateChange feuert beim Start immer einmal selbst mit ('INITIAL_SESSION'),
    // ob bereits eine Sitzung besteht (durch Supabase automatisch aus localStorage
    // wiederhergestellt) oder nicht - deshalb reicht dieser einzelne Listener aus,
    // ein zusätzlicher initialer getSession()-Aufruf ist nicht nötig.
    supabaseClient.auth.onAuthStateChange((event, session) => {
      if (session && !this._signedInFired) {
        this._signedInFired = true;
        const meta = session.user.user_metadata || {};
        this._onSignedIn && this._onSignedIn({ picture: meta.avatar_url || meta.picture || '' });
      } else if (event === 'SIGNED_OUT') {
        this._signedInFired = false;
        currentUser = null;
        this._onSignedOut && this._onSignedOut();
      }
    });
  },

  async signOut() {
    await supabaseClient.auth.signOut();
  }
};

// ============================================================================
// ÜBERSETZUNGSSCHICHT: app.js arbeitet weiterhin mit den ursprünglichen
// PascalCase-Feldnamen (aus der früheren Google-Sheets-Zeit) - hier werden sie
// beim Lesen/Schreiben in die snake_case-Spaltennamen von Postgres übersetzt.
// Diese Zuordnung ist bewusst 1:1 dieselbe wie im einmaligen Migrationsskript
// (backend/migrate_to_supabase.gs), damit beide Seiten garantiert übereinstimmen.
// ============================================================================
const ENTITIES = {
  flaechen: { table: 'flaechen', felder: {
    ID: 'id', Name: 'name', KatastralGemeinde: 'katastral_gemeinde', Parzellennummer: 'parzellennummer',
    FlaecheHa: 'flaeche_ha', Besitzart: 'besitzart', Nutzungsart: 'nutzungsart', Rebsorte: 'rebsorte',
    AnzahlPflanzen: 'anzahl_pflanzen', ArbeitsablaufJSON: 'arbeitsablauf_json', GeoJSON: 'geojson',
    Notiz: 'notiz', ErstelltVon: 'erstellt_von', ErstelltAm: 'erstellt_am', Aktiv: 'aktiv'
  }, json: ['arbeitsablauf_json', 'geojson'], bool: ['aktiv'] },
  subflaechen: { table: 'sub_flaechen', felder: {
    ID: 'id', FlaecheID: 'flaeche_id', Name: 'name', Rebsorte: 'rebsorte', FlaecheM2: 'flaeche_m2',
    Pflanzjahr: 'pflanzjahr', GeoJSON: 'geojson', Notiz: 'notiz', ErstelltVon: 'erstellt_von',
    ErstelltAm: 'erstellt_am', Aktiv: 'aktiv'
  }, json: ['geojson'], bool: ['aktiv'] },
  kulturen: { table: 'kulturen', pkCol: 'kultur', felder: {
    Kultur: 'kultur', Kategorie: 'kategorie', SaatmengeKgHa: 'saatmenge_kg_ha',
    DuengeempfehlungN_KgHa: 'duengeempfehlung_n_kg_ha', DuengeempfehlungP_KgHa: 'duengeempfehlung_p_kg_ha',
    DuengeempfehlungK_KgHa: 'duengeempfehlung_k_kg_ha', UnvertraeglicheVorfruechte: 'unvertraegliche_vorfruechte',
    AnbaupauseJahre: 'anbaupause_jahre', KartenFarbe: 'karten_farbe', KartenSymbol: 'karten_symbol'
  } },
  fruchtfolge: { table: 'fruchtfolge', felder: {
    ID: 'id', FlaecheID: 'flaeche_id', Jahr: 'jahr', Kultur: 'kultur', Aussaatdatum: 'aussaatdatum',
    Erntedatum: 'erntedatum', ErtragsMenge: 'ertragsmenge', ErtragsEinheit: 'ertragseinheit',
    SaatmengeKgHaBerechnet: 'saatmenge_kg_ha_berechnet', SaatmengeGesamtKg: 'saatmenge_gesamt_kg',
    Notiz: 'notiz', ErstelltVon: 'erstellt_von', ErstelltAm: 'erstellt_am'
  } },
  schnitte: { table: 'schnitte', felder: {
    ID: 'id', FlaecheID: 'flaeche_id', SchnittNummer: 'schnitt_nummer', Datum: 'datum',
    Erntetyp: 'erntetyp', ErtragsMenge: 'ertragsmenge', ErtragsEinheit: 'ertragseinheit', Notiz: 'notiz',
    ErfasstVon: 'erfasst_von', ErfasstAm: 'erfasst_am'
  } },
  feldarbeiten: { table: 'feldarbeiten', felder: {
    ID: 'id', FlaecheID: 'flaeche_id', Schritt: 'schritt', Datum: 'datum', Notiz: 'notiz',
    ErfasstVon: 'erfasst_von', ErfasstAm: 'erfasst_am'
  } },
  duengungen: { table: 'duengungen', felder: {
    ID: 'id', FlaecheID: 'flaeche_id', Datum: 'datum', Duengerart: 'duengerart', Menge: 'menge',
    Einheit: 'einheit', Notiz: 'notiz', ErfasstVon: 'erfasst_von', ErfasstAm: 'erfasst_am'
  } },
  weinbaumassnahmen: { table: 'weinbau_massnahmen', felder: {
    ID: 'id', SubFlaecheID: 'sub_flaeche_id', Datum: 'datum', Massnahme: 'massnahme', Bio: 'bio',
    Mittel: 'mittel', Notiz: 'notiz', ErfasstVon: 'erfasst_von', ErfasstAm: 'erfasst_am'
  }, bool: ['bio'] },
  reifemessungen: { table: 'reifemessungen', felder: {
    ID: 'id', SubFlaecheID: 'sub_flaeche_id', Datum: 'datum', Oechsle: 'oechsle', Brix: 'brix',
    KMW: 'kmw', Saeure: 'saeure', PH: 'ph', Notiz: 'notiz', ErfasstVon: 'erfasst_von', ErfasstAm: 'erfasst_am'
  } },
  weinlese: { table: 'wein_lese', felder: {
    ID: 'id', SubFlaecheID: 'sub_flaeche_id', Datum: 'datum', MengeKg: 'menge_kg',
    MostgewichtOechsle: 'mostgewicht_oechsle', Notiz: 'notiz', ErfasstVon: 'erfasst_von', ErfasstAm: 'erfasst_am'
  } },
  tanks: { table: 'tanks', felder: {
    ID: 'id', Bezeichnung: 'bezeichnung', VolumenLiter: 'volumen_liter',
    AktuellerInhaltLiter: 'aktueller_inhalt_liter', Sorte: 'sorte', Jahrgang: 'jahrgang', Notiz: 'notiz',
    ErstelltVon: 'erstellt_von', ErstelltAm: 'erstellt_am', Aktiv: 'aktiv'
  }, bool: ['aktiv'] },
  kellerlogbuch: { table: 'keller_logbuch', felder: {
    ID: 'id', TankID: 'tank_id', Datum: 'datum', Aktion: 'aktion', Oechsle: 'oechsle', Brix: 'brix',
    KMW: 'kmw', RestzuckerGL: 'restzucker_gl', VerbleibendLiter: 'verbleibend_liter', Notiz: 'notiz',
    ErfasstVon: 'erfasst_von', ErfasstAm: 'erfasst_am'
  } },
  abfuellungen: { table: 'abfuellungen', felder: {
    ID: 'id', TankID: 'tank_id', Datum: 'datum', FlaschenAnzahl: 'flaschen_anzahl',
    FlaschenGroesseMl: 'flaschen_groesse_ml', Charge: 'charge', Notiz: 'notiz',
    ErfasstVon: 'erfasst_von', ErfasstAm: 'erfasst_am'
  } },
  flaschenbestand: { table: 'flaschenbestand', felder: {
    ID: 'id', Bezeichnung: 'bezeichnung', Sorte: 'sorte', Jahrgang: 'jahrgang',
    FlaschenGroesseMl: 'flaschen_groesse_ml', AnzahlAktuell: 'anzahl_aktuell', FotoURL: 'foto_url',
    Notiz: 'notiz', ErstelltVon: 'erstellt_von', ErstelltAm: 'erstellt_am', Aktiv: 'aktiv'
  }, bool: ['aktiv'] },
  flaschenbewegungen: { table: 'flaschen_bewegungen', felder: {
    ID: 'id', FlaschenbestandID: 'flaschenbestand_id', Datum: 'datum', Typ: 'typ', Anzahl: 'anzahl',
    Erloes: 'erloes', Notiz: 'notiz', ErfasstVon: 'erfasst_von', ErfasstAm: 'erfasst_am'
  } },
  maschinen: { table: 'maschinen', felder: {
    ID: 'id', GeraeteNummer: 'geraete_nummer', Bezeichnung: 'bezeichnung', Typ: 'typ',
    Baujahr: 'baujahr', Anschaffungspreis: 'anschaffungspreis', Anschaffungsdatum: 'anschaffungsdatum',
    BetriebsstundenAktuell: 'betriebsstunden_aktuell', FotoURL: 'foto_url', DokumenteJSON: 'dokumente_json',
    Notiz: 'notiz', ErstelltVon: 'erstellt_von', ErstelltAm: 'erstellt_am', Aktiv: 'aktiv'
  }, json: ['dokumente_json'], bool: ['aktiv'] },
  betriebsstunden: { table: 'betriebsstunden', felder: {
    ID: 'id', MaschinenID: 'maschinen_id', Datum: 'datum', StundenDelta: 'stunden_delta',
    Notiz: 'notiz', ErfasstVon: 'erfasst_von', ErfasstAm: 'erfasst_am'
  } },
  wartungsintervalle: { table: 'wartungs_intervalle', felder: {
    ID: 'id', MaschinenID: 'maschinen_id', Bezeichnung: 'bezeichnung',
    IntervallStunden: 'intervall_stunden', IntervallMonate: 'intervall_monate',
    LetzteWartungStunden: 'letzte_wartung_stunden', LetzteWartungDatum: 'letzte_wartung_datum', Notiz: 'notiz'
  } },
  maschinenkosten: { table: 'maschinen_kosten', felder: {
    ID: 'id', MaschinenID: 'maschinen_id', Datum: 'datum', Kategorie: 'kategorie', Betrag: 'betrag',
    Beschreibung: 'beschreibung', BelegURL: 'beleg_url', ErfasstVon: 'erfasst_von', ErfasstAm: 'erfasst_am'
  } },
  allgemeinekosten: { table: 'allgemeine_kosten', felder: {
    ID: 'id', Datum: 'datum', Kategorie: 'kategorie', MengeLiter: 'menge_liter', Betrag: 'betrag',
    Beschreibung: 'beschreibung', BelegURL: 'beleg_url', ErfasstVon: 'erfasst_von', ErfasstAm: 'erfasst_am'
  } },
  erntevermarktung: { table: 'erntevermarktung', felder: {
    ID: 'id', Datum: 'datum', Kategorie: 'kategorie', Menge: 'menge', Einheit: 'einheit',
    Erloes: 'erloes', Beschreibung: 'beschreibung', FlaschenbewegungID: 'flaschenbewegung_id',
    ErfasstVon: 'erfasst_von', ErfasstAm: 'erfasst_am'
  } },
  tiere: { table: 'tiere', felder: {
    ID: 'id', Tierart: 'tierart', Ohrmarke: 'ohrmarke', Rasse: 'rasse', Name: 'name',
    Geburtsdatum: 'geburtsdatum', Geschlecht: 'geschlecht', Status: 'status',
    MutterOhrmarke: 'mutter_ohrmarke', Notiz: 'notiz', Eingangsdatum: 'eingangsdatum', Ausgangsdatum: 'ausgangsdatum',
    ErstelltVon: 'erstellt_von', ErstelltAm: 'erstellt_am'
  } },
  zuchtereignisse: { table: 'zuchtereignisse', felder: {
    ID: 'id', TierID: 'tier_id', Datum: 'datum', Typ: 'typ', Vatertier: 'vatertier',
    VoraussichtlichesAbkalbedatum: 'voraussichtliches_abkalbedatum', TrockenstellenAb: 'trockenstellen_ab',
    Notiz: 'notiz', ErfasstVon: 'erfasst_von', ErfasstAm: 'erfasst_am'
  } },
  tierkosten: { table: 'tier_kosten', felder: {
    ID: 'id', TierID: 'tier_id', Datum: 'datum', Kategorie: 'kategorie', Betrag: 'betrag',
    Beschreibung: 'beschreibung', BelegURL: 'beleg_url', ErfasstVon: 'erfasst_von', ErfasstAm: 'erfasst_am'
  } },
  tiererloese: { table: 'tier_erloese', felder: {
    ID: 'id', TierID: 'tier_id', Datum: 'datum', Art: 'art', Betrag: 'betrag',
    Beschreibung: 'beschreibung', ErfasstVon: 'erfasst_von', ErfasstAm: 'erfasst_am'
  } },
  tierbestand: { table: 'tierbestand', felder: {
    ID: 'id', Tierart: 'tierart', Bezeichnung: 'bezeichnung', AnzahlAktuell: 'anzahl_aktuell',
    Notiz: 'notiz', ErstelltVon: 'erstellt_von', ErstelltAm: 'erstellt_am', Aktiv: 'aktiv'
  }, bool: ['aktiv'] },
  tierbestandbewegungen: { table: 'tierbestand_bewegungen', felder: {
    ID: 'id', TierbestandID: 'tierbestand_id', Datum: 'datum', Typ: 'typ', Anzahl: 'anzahl',
    Notiz: 'notiz', ErfasstVon: 'erfasst_von'
  } },
  futtermittel: { table: 'futtermittel', felder: {
    ID: 'id', Bezeichnung: 'bezeichnung', Kategorie: 'kategorie', Einheit: 'einheit',
    BestandAktuell: 'bestand_aktuell', MindestBestand: 'mindest_bestand', Notiz: 'notiz',
    ErstelltVon: 'erstellt_von', ErstelltAm: 'erstellt_am', Aktiv: 'aktiv'
  }, bool: ['aktiv'] },
  futtermittelbewegungen: { table: 'futtermittel_bewegungen', felder: {
    ID: 'id', FuttermittelID: 'futtermittel_id', Datum: 'datum', Typ: 'typ', Menge: 'menge',
    HerkunftFlaecheID: 'herkunft_flaeche_id', SchnittID: 'schnitt_id', FruchtfolgeID: 'fruchtfolge_id',
    Notiz: 'notiz', ErfasstVon: 'erfasst_von', ErfasstAm: 'erfasst_am'
  } },
  todos: { table: 'todos', felder: {
    ID: 'id', Text: 'text', Prioritaet: 'prioritaet', Erledigt: 'erledigt', Status: 'status',
    ErstelltVon: 'erstellt_von', ErstelltAm: 'erstellt_am'
  }, bool: ['erledigt'] }
};

Object.values(ENTITIES).forEach(cfg => { if (!cfg.pkCol) cfg.pkCol = 'id'; });

// ============================================================================
// DATEIEN (Fotos/Belege/Dokumente) - Bucket ist PRIVAT. In der Datenbank steht nur der
// Pfad im Bucket; beim Laden wird daraus eine zeitlich begrenzte signierte URL, beim
// Speichern wird jede URL (signiert oder eine alte öffentliche) wieder auf den Pfad
// zurückgeführt. app.js arbeitet weiter mit "URLs" und merkt davon nichts.
// ============================================================================
const DATEI_BUCKET = 'hof-management';
const SIGNED_URL_SEKUNDEN = 6 * 3600;
const DATEI_URL_SPALTEN = ['foto_url', 'beleg_url'];
const DATEI_URL_MUSTER = new RegExp('/storage/v1/object/(?:public|sign|authenticated)/' + DATEI_BUCKET + '/([^?#]+)');

// URL/Pfad -> reiner Bucket-Pfad. Fremde URLs (z.B. alte Google-Bilder) bleiben unverändert.
function dateiPfad(wert) {
  if (typeof wert !== 'string' || !wert) return wert;
  const treffer = wert.match(DATEI_URL_MUSTER);
  if (treffer) { try { return decodeURIComponent(treffer[1]); } catch (e) { return treffer[1]; } }
  return wert;
}

function istBucketPfad(wert) {
  return typeof wert === 'string' && wert !== '' && !/^[a-z][a-z0-9+.-]*:/i.test(wert);
}

function dokumenteZuPfaden(liste) {
  return Array.isArray(liste) ? liste.map(d => (d && typeof d === 'object') ? { ...d, url: dateiPfad(d.url) } : d) : liste;
}

// Rohzeilen aus Postgres -> app.js-Objekte, mit signierten URLs für alle Datei-Spalten.
async function ladeZeilen(cfg, rows) {
  const spalten = Object.values(cfg.felder);
  const hatDateien = spalten.some(c => DATEI_URL_SPALTEN.indexOf(c) !== -1 || c === 'dokumente_json');
  if (!hatDateien || !rows.length) return rows.map(r => fromPg(cfg, r));

  const pfade = new Set();
  rows.forEach(r => {
    DATEI_URL_SPALTEN.forEach(c => { if (c in r) { const p = dateiPfad(r[c]); if (istBucketPfad(p)) pfade.add(p); } });
    if (Array.isArray(r.dokumente_json)) r.dokumente_json.forEach(d => { const p = d && dateiPfad(d.url); if (istBucketPfad(p)) pfade.add(p); });
  });

  const signiert = {};
  if (pfade.size) {
    const { data, error } = await supabaseClient.storage.from(DATEI_BUCKET).createSignedUrls([...pfade], SIGNED_URL_SEKUNDEN);
    if (error) throw new Error(error.message);
    (data || []).forEach(e => { if (e.path && e.signedUrl) signiert[e.path] = e.signedUrl; });
  }
  const zuUrl = (wert) => {
    const p = dateiPfad(wert);
    return istBucketPfad(p) ? (signiert[p] || '') : wert;
  };

  return rows.map(r => {
    const kopie = { ...r };
    DATEI_URL_SPALTEN.forEach(c => { if (c in kopie) kopie[c] = zuUrl(kopie[c]); });
    if (Array.isArray(kopie.dokumente_json)) {
      kopie.dokumente_json = kopie.dokumente_json.map(d => (d && typeof d === 'object') ? { ...d, url: zuUrl(d.url) } : d);
    }
    return fromPg(cfg, kopie);
  });
}

function toPgValue(value, col, cfg) {
  if (value === '' || value === undefined || value === null) return null;
  if (DATEI_URL_SPALTEN.indexOf(col) !== -1) return dateiPfad(value);
  if (cfg.json && cfg.json.indexOf(col) !== -1) {
    let parsed = value;
    if (typeof value === 'string') {
      try { parsed = JSON.parse(value); } catch (e) { return null; }
    }
    return col === 'dokumente_json' ? dokumenteZuPfaden(parsed) : parsed;
  }
  if (cfg.bool && cfg.bool.indexOf(col) !== -1) {
    return value === true || value === 'true' || value === 'TRUE' || value === 1;
  }
  return value;
}

function toPg(cfg, payload, user, isCreate) {
  const row = {};
  Object.keys(cfg.felder).forEach(appField => {
    if (payload[appField] !== undefined) {
      row[cfg.felder[appField]] = toPgValue(payload[appField], cfg.felder[appField], cfg);
    }
  });
  if (isCreate) {
    ['ErstelltAm', 'ErfasstAm'].forEach(f => {
      const col = cfg.felder[f];
      if (col && row[col] === undefined) row[col] = new Date().toISOString();
    });
    ['ErstelltVon', 'ErfasstVon'].forEach(f => {
      const col = cfg.felder[f];
      if (col && row[col] === undefined) row[col] = user ? user.name : '';
    });
    if (cfg.bool && cfg.bool.indexOf('aktiv') !== -1 && cfg.felder.Aktiv && row.aktiv === undefined) {
      row.aktiv = true;
    }
  }
  return row;
}

function fromPg(cfg, row) {
  if (!row) return row;
  const out = {};
  Object.keys(cfg.felder).forEach(appField => {
    const col = cfg.felder[appField];
    let v = row[col];
    if (v === null || v === undefined) {
      v = '';
    } else if (cfg.json && cfg.json.indexOf(col) !== -1) {
      v = JSON.stringify(v);
    }
    out[appField] = v;
  });
  return out;
}

// ============================================================================
// AKTUELLER NUTZER (Rolle/Name aus profiles - einmal pro Sitzung geladen)
// ============================================================================
let currentUser = null;

async function authMeFn() {
  const { data: { user: authUser } } = await supabaseClient.auth.getUser();
  if (!authUser) throw new Error('Nicht angemeldet.');

  // Der Bootstrap-Trigger legt die profiles-Zeile beim allerersten Login serverseitig
  // an - im seltenen Fall, dass sie noch nicht ganz committet ist, kurz nachfragen.
  let profile = null;
  for (let i = 0; i < 5 && !profile; i++) {
    const { data, error } = await supabaseClient.from('profiles').select('*').eq('id', authUser.id).maybeSingle();
    if (error) throw new Error(error.message);
    profile = data;
    if (!profile) await sleep(400);
  }
  if (!profile) throw new Error('Profil konnte nicht geladen werden. Bitte Seite neu laden.');
  if (profile.status !== 'Aktiv') {
    throw new Error('Dieses Konto wurde noch nicht freigeschaltet oder wurde gesperrt. Bitte einen Admin kontaktieren.');
  }

  currentUser = { email: profile.email, name: profile.name || authUser.email, role: profile.role };
  await logActivity(currentUser, 'Login', '');
  return currentUser;
}

async function getCurrentUser() {
  if (currentUser) return currentUser;
  return authMeFn();
}

async function requireAdmin() {
  const user = await getCurrentUser();
  if (user.role !== 'Admin') throw new Error('Diese Aktion erfordert Admin-Rechte.');
}

async function logActivity(user, aktion, details) {
  try {
    await supabaseClient.from('aktivitaets_log').insert({
      user_email: user.email, user_name: user.name, aktion, details: details || ''
    });
  } catch (e) {
    // Aktivitäts-Logging darf nie die eigentliche Aktion zum Scheitern bringen
  }
}

// Für jeden freigeschalteten Nutzer den letzten bekannten Aktivitäts-Zeitpunkt (egal wie
// lange her) plus ein "gerade aktiv"-Flag (innerhalb der letzten 15 Minuten) - für die
// kompakte Anzeige in der Seitenleiste ("wer ist gerade da, wann war der andere zuletzt da").
async function allUserActivityFn() {
  // Läuft über eine SECURITY DEFINER-Funktion (nicht direkt über die profiles-Tabelle):
  // deren RLS-Regel lässt normale Mitarbeiter nur ihre eigene Zeile lesen, "wer war
  // wann aktiv" soll aber für alle sichtbar sein - siehe backend/add_user_activity_overview.sql.
  const { data, error } = await supabaseClient.rpc('user_activity_overview');
  if (error) throw new Error(error.message);
  const cutoff = Date.now() - 15 * 60 * 1000;
  return (data || [])
    .map(r => ({
      email: r.email, name: r.name, lastSeen: r.last_seen,
      aktivJetzt: !!r.last_seen && new Date(r.last_seen).getTime() >= cutoff
    }))
    .sort((a, b) => new Date(b.lastSeen || 0) - new Date(a.lastSeen || 0));
}

// ============================================================================
// BENUTZERVERWALTUNG (profiles) - Zeilen entstehen automatisch bei der ersten
// Google-Anmeldung (siehe Bootstrap-Trigger in supabase_schema.sql), Admins
// können hier nur noch Rolle/Status bestehender Nutzer pflegen bzw. entfernen.
// ============================================================================
async function usersListFn() {
  const { data, error } = await supabaseClient.from('profiles').select('*').order('email');
  if (error) throw new Error(error.message);
  return (data || []).map(r => ({ Email: r.email, Name: r.name, Rolle: r.role, Status: r.status }));
}

async function usersUpdateFn(id, payload) {
  const row = {};
  if (payload.Email !== undefined) row.email = payload.Email;
  if (payload.Name !== undefined) row.name = payload.Name;
  if (payload.Rolle !== undefined) row.role = payload.Rolle;
  if (payload.Status !== undefined) row.status = payload.Status;
  const { data, error } = await supabaseClient.from('profiles').update(row).eq('email', id).select().single();
  if (error) throw new Error(error.message);
  return { Email: data.email, Name: data.name, Rolle: data.role, Status: data.status };
}

async function usersDeleteFn(id) {
  const { error } = await supabaseClient.from('profiles').delete().eq('email', id);
  if (error) throw new Error(error.message);
  return { ok: true };
}

// ============================================================================
// BETRIEB (Stammdaten, eine feste Zeile mit id=1)
// ============================================================================
function betriebFromPg(data) {
  if (!data) return null;
  return {
    HofName: data.hof_name || '', Adresse: data.adresse || '', Betriebsnummer: data.betriebsnummer || '',
    Ansprechpartner: data.ansprechpartner || '',
    ErinnerungWochenVorher: data.erinnerung_wochen_vorher === null || data.erinnerung_wochen_vorher === undefined ? '' : data.erinnerung_wochen_vorher,
    AktualisiertAm: data.aktualisiert_am || ''
  };
}

async function betriebGetFn() {
  const { data, error } = await supabaseClient.from('betrieb').select('*').eq('id', 1).maybeSingle();
  if (error) throw new Error(error.message);
  return betriebFromPg(data);
}

async function betriebUpdateFn(payload) {
  const row = {
    hof_name: payload.HofName || null, adresse: payload.Adresse || null, betriebsnummer: payload.Betriebsnummer || null,
    ansprechpartner: payload.Ansprechpartner || null,
    erinnerung_wochen_vorher: (payload.ErinnerungWochenVorher === '' || payload.ErinnerungWochenVorher === undefined)
      ? null : Number(payload.ErinnerungWochenVorher),
    aktualisiert_am: new Date().toISOString()
  };
  const { data, error } = await supabaseClient.from('betrieb').update(row).eq('id', 1).select().single();
  if (error) throw new Error(error.message);
  return betriebFromPg(data);
}

// ============================================================================
// GENERISCHE CRUD-HELFER (für alle übrigen Entitäten)
// ============================================================================
async function genericList(entity) {
  const cfg = ENTITIES[entity];
  const { data, error } = await supabaseClient.from(cfg.table).select('*');
  if (error) throw new Error(error.message);
  return ladeZeilen(cfg, data || []);
}

async function genericGet(entity, id) {
  const cfg = ENTITIES[entity];
  const { data, error } = await supabaseClient.from(cfg.table).select('*').eq(cfg.pkCol, id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('Datensatz nicht gefunden.');
  return (await ladeZeilen(cfg, [data]))[0];
}

async function genericCreate(entity, payload) {
  const cfg = ENTITIES[entity];
  const user = await getCurrentUser();
  const row = toPg(cfg, payload, user, true);
  const { data, error } = await supabaseClient.from(cfg.table).insert(row).select().single();
  if (error) throw new Error(error.message);
  return (await ladeZeilen(cfg, [data]))[0];
}

async function genericUpdate(entity, id, payload) {
  if (!id) throw new Error('Keine ID angegeben.');
  const cfg = ENTITIES[entity];
  const row = toPg(cfg, payload, null, false);
  const { data, error } = await supabaseClient.from(cfg.table).update(row).eq(cfg.pkCol, id).select().single();
  if (error) throw new Error(error.message);
  return (await ladeZeilen(cfg, [data]))[0];
}

async function genericDelete(entity, id) {
  if (!id) throw new Error('Keine ID angegeben.');
  await requireAdmin();
  const cfg = ENTITIES[entity];
  if (cfg.bool && cfg.bool.indexOf('aktiv') !== -1) {
    const { error } = await supabaseClient.from(cfg.table).update({ aktiv: false }).eq(cfg.pkCol, id);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabaseClient.from(cfg.table).delete().eq(cfg.pkCol, id);
    if (error) throw new Error(error.message);
  }
  return { ok: true };
}

// ============================================================================
// FRUCHTFOLGE-PRÜFUNG
// ============================================================================
async function fruchtfolgeCheckFn(payload) {
  const flaecheId = payload.flaecheId;
  const jahr = Number(payload.jahr);
  const kultur = payload.kultur;

  const { data: kulturRow, error: e0 } = await supabaseClient.from('kulturen').select('*').eq('kultur', kultur).maybeSingle();
  if (e0) throw new Error(e0.message);
  const kulturInfo = kulturRow ? fromPg(ENTITIES.kulturen, kulturRow) : null;

  const { data: histRows, error: e1 } = await supabaseClient.from('fruchtfolge').select('*')
    .eq('flaeche_id', flaecheId).lt('jahr', jahr).order('jahr', { ascending: false });
  if (e1) throw new Error(e1.message);
  const history = (histRows || []).map(r => fromPg(ENTITIES.fruchtfolge, r));

  const warnings = [];
  if (kulturInfo && history.length > 0) {
    const vorfrucht = history[0];
    const unvertraeglich = String(kulturInfo.UnvertraeglicheVorfruechte || '')
      .split(',').map(s => s.trim()).filter(Boolean);
    if (unvertraeglich.indexOf(vorfrucht.Kultur) !== -1) {
      warnings.push(`"${kultur}" verträgt sich schlecht mit der Vorfrucht "${vorfrucht.Kultur}" (${vorfrucht.Jahr}).`);
    }
    const pause = Number(kulturInfo.AnbaupauseJahre || 0);
    if (pause > 0) {
      const treffer = history.find(h => h.Kultur === kultur && (jahr - Number(h.Jahr)) < pause);
      if (treffer) warnings.push(`"${kultur}" wurde zuletzt ${treffer.Jahr} angebaut. Empfohlene Anbaupause: ${pause} Jahr(e).`);
    }
  }
  return { ok: warnings.length === 0, warnings, kulturInfo };
}

// ============================================================================
// MASCHINEN: BETRIEBSSTUNDEN-SCHNELLEINGABE
// ============================================================================
async function maschinenAddStundenFn(payload) {
  const maschinenId = payload.maschinenId;
  const delta = Number(payload.stundenDelta);
  if (!maschinenId || !delta) throw new Error('MaschinenID und StundenDelta erforderlich.');

  await genericCreate('betriebsstunden', {
    MaschinenID: maschinenId, Datum: payload.datum || new Date().toISOString(), StundenDelta: delta, Notiz: payload.notiz || ''
  });

  const { data: rec, error: e1 } = await supabaseClient.from('maschinen').select('betriebsstunden_aktuell').eq('id', maschinenId).single();
  if (e1) throw new Error(e1.message);
  const neu = Number(rec.betriebsstunden_aktuell || 0) + delta;
  const { error: e2 } = await supabaseClient.from('maschinen').update({ betriebsstunden_aktuell: neu }).eq('id', maschinenId);
  if (e2) throw new Error(e2.message);
  return { maschinenId, neueBetriebsstunden: neu };
}

// ============================================================================
// WARTUNG ERLEDIGT MELDEN (setzt Intervall-Zähler zurück + erfasst Kosten)
// ============================================================================
async function wartungsintervalleErfassenFn(payload) {
  const intervallId = payload.id;
  if (!intervallId) throw new Error('Kein Wartungsintervall angegeben.');

  const { data: rec, error: e0 } = await supabaseClient.from('wartungs_intervalle').select('*').eq('id', intervallId).single();
  if (e0) throw new Error(e0.message);

  const datum = payload.datum || new Date().toISOString();
  const betriebsstunden = (payload.betriebsstunden !== undefined && payload.betriebsstunden !== '')
    ? Number(payload.betriebsstunden) : rec.letzte_wartung_stunden;

  const { error: e1 } = await supabaseClient.from('wartungs_intervalle')
    .update({ letzte_wartung_stunden: betriebsstunden, letzte_wartung_datum: datum })
    .eq('id', intervallId);
  if (e1) throw new Error(e1.message);

  let kostenEntry = null;
  if (payload.kosten) {
    kostenEntry = await genericCreate('maschinenkosten', {
      MaschinenID: rec.maschinen_id, Datum: datum, Kategorie: 'Wartung', Betrag: payload.kosten,
      Beschreibung: 'Wartung erledigt: ' + rec.bezeichnung, BelegURL: payload.belegURL || ''
    });
  }
  return { ok: true, kosten: kostenEntry };
}

// ============================================================================
// ZUCHTKALENDER (Rinder)
// ============================================================================
const TRAECHTIGKEITSDAUER_TAGE = 283; // Rind, Standardwert
const TROCKENSTELLEN_TAGE_VOR_ABKALBUNG = 60;

function addTage(isoDatum, tage) {
  const d = new Date(isoDatum);
  d.setDate(d.getDate() + tage);
  return d.toISOString();
}

async function zuchtereignisseCreateFn(payload) {
  const typ = payload.Typ;
  let abkalbedatum = payload.VoraussichtlichesAbkalbedatum || '';
  let trockenstellenAb = payload.TrockenstellenAb || '';

  if ((typ === 'Besamung' || typ === 'Deckung') && payload.Datum) {
    abkalbedatum = addTage(payload.Datum, TRAECHTIGKEITSDAUER_TAGE);
    trockenstellenAb = addTage(abkalbedatum, -TROCKENSTELLEN_TAGE_VOR_ABKALBUNG);
  }

  return genericCreate('zuchtereignisse', Object.assign({}, payload, {
    VoraussichtlichesAbkalbedatum: abkalbedatum, TrockenstellenAb: trockenstellenAb
  }));
}

// ============================================================================
// KELLERWIRTSCHAFT: ABFÜLLUNG (reduziert Tank-Inhalt automatisch)
// ============================================================================
async function abfuellungenCreateFn(payload) {
  const tankId = payload.TankID;
  if (!tankId) throw new Error('Kein Tank angegeben.');

  const entry = await genericCreate('abfuellungen', payload);

  const { data: tank, error: e0 } = await supabaseClient.from('tanks').select('*').eq('id', tankId).maybeSingle();
  if (e0) throw new Error(e0.message);

  const flaschenAnzahl = Number(payload.FlaschenAnzahl) || 0;
  const groesseMl = Number(payload.FlaschenGroesseMl) || 0;

  if (tank) {
    // Abfüllung ist der letzte Schritt der Charge - das Fass gilt danach als
    // vollständig geleert (unabhängig von Rundungsdifferenzen Liter/Flaschen).
    const { error: e1 } = await supabaseClient.from('tanks').update({ aktueller_inhalt_liter: 0 }).eq('id', tankId);
    if (e1) throw new Error(e1.message);
  }

  if (flaschenAnzahl > 0 && tank) {
    const { data: bestandRows, error: e2 } = await supabaseClient.from('flaschenbestand').select('*')
      .eq('sorte', tank.sorte).eq('jahrgang', tank.jahrgang).eq('flaschen_groesse_ml', groesseMl).neq('aktiv', false);
    if (e2) throw new Error(e2.message);
    let bestand = (bestandRows || [])[0];
    if (!bestand) {
      const insertRow = toPg(ENTITIES.flaschenbestand, {
        Bezeichnung: (tank.sorte || 'Wein') + ' ' + (tank.jahrgang || ''),
        Sorte: tank.sorte, Jahrgang: tank.jahrgang, FlaschenGroesseMl: groesseMl, AnzahlAktuell: 0
      }, await getCurrentUser(), true);
      const { data: newBestand, error: e2b } = await supabaseClient.from('flaschenbestand').insert(insertRow).select().single();
      if (e2b) throw new Error(e2b.message);
      bestand = newBestand;
    }
    await genericCreate('flaschenbewegungen', {
      FlaschenbestandID: bestand.id, Datum: payload.Datum, Typ: 'Zugang (Abfüllung)',
      Anzahl: flaschenAnzahl, Notiz: 'Abfüllung Charge ' + (payload.Charge || '')
    });
    const { error: e3 } = await supabaseClient.from('flaschenbestand')
      .update({ anzahl_aktuell: Number(bestand.anzahl_aktuell || 0) + flaschenAnzahl }).eq('id', bestand.id);
    if (e3) throw new Error(e3.message);
  }

  return entry;
}

// ============================================================================
// API
// ============================================================================
// Verhindert, dass eine Anfrage bei schlechter (v.a. mobiler) Verbindung ewig
// hängen bleibt, ohne dass ein Fehler zurückkommt - ohne das dreht sich z.B. das
// Aktualisieren-Symbol unbegrenzt weiter, obwohl längst nichts mehr passiert.
const API_TIMEOUT_MS = 20000;

function withTimeout(promise, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Zeitüberschreitung bei "${label}" - bitte Internetverbindung prüfen und erneut versuchen.`)), API_TIMEOUT_MS);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

const Api = {
  async call(action, payload = {}) {
    return withTimeout(this._dispatch(action, payload), action);
  },

  async _dispatch(action, payload = {}) {
    payload = payload || {};
    switch (action) {
      case 'auth.me': return authMeFn();
      case 'activity.ping': {
        const user = await getCurrentUser();
        await logActivity(user, 'Aktiv', payload.context || '');
        return { ok: true };
      }
      case 'dashboard.userActivity': return allUserActivityFn();
      case 'betrieb.get': return betriebGetFn();
      case 'betrieb.update': await requireAdmin(); return betriebUpdateFn(payload);
      case 'fruchtfolge.check': return fruchtfolgeCheckFn(payload);
      case 'maschinen.addStunden': return maschinenAddStundenFn(payload);
      case 'wartungsintervalle.erfassen': return wartungsintervalleErfassenFn(payload);
      case 'zuchtereignisse.create': return zuchtereignisseCreateFn(payload);
      case 'abfuellungen.create': return abfuellungenCreateFn(payload);
      case 'users.list': return usersListFn();
      case 'users.update': await requireAdmin(); return usersUpdateFn(payload.id, payload);
      case 'users.delete': await requireAdmin(); return usersDeleteFn(payload.id);
      default: break;
    }

    const parts = action.split('.');
    const entity = parts[0];
    const op = parts[1];
    const cfg = ENTITIES[entity];
    if (!cfg) throw new Error('Unbekannte Aktion: ' + action);

    switch (op) {
      case 'list': return genericList(entity);
      case 'get': return genericGet(entity, payload.id);
      case 'create': return genericCreate(entity, payload);
      case 'update': return genericUpdate(entity, payload.id, payload);
      case 'delete': return genericDelete(entity, payload.id);
      default: throw new Error('Unbekannte Operation: ' + op);
    }
  },

  // Bündelt mehrere Aktionen in einem Promise.all statt einzeln nacheinander -
  // dieselbe Signatur wie zuvor, damit safeBatch/cachedBatch in app.js unverändert bleiben.
  async batch(namedCalls) {
    const keys = Object.keys(namedCalls);
    const settled = await Promise.all(keys.map(k =>
      this.call(namedCalls[k].action, namedCalls[k].payload || {}).then(
        data => ({ ok: true, data }),
        err => ({ ok: false, error: err.message })
      )
    ));
    const out = {};
    settled.forEach((r, i) => {
      if (!r.ok) throw new Error(r.error || `Fehler bei "${keys[i]}"`);
      out[keys[i]] = r.data;
    });
    return out;
  },

  async uploadFile(file, category) {
    const KATEGORIE_ORDNER = { tier: 'Tiere', maschine: 'Maschinen', flasche: 'Flaschen' };
    const ordner = KATEGORIE_ORDNER[category] || 'Sonstiges';
    const ext = (file.name.split('.').pop() || 'dat').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) || 'dat';
    const path = `${ordner}/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabaseClient.storage.from(DATEI_BUCKET).upload(path, file, {
      contentType: file.type || 'application/octet-stream'
    });
    if (error) throw new Error(error.message);
    // Bucket ist privat: zurück kommt eine zeitlich begrenzte signierte URL (nur zur
    // sofortigen Anzeige) - gespeichert wird beim Schreiben in die DB nur der Pfad.
    const { data, error: signError } = await supabaseClient.storage.from(DATEI_BUCKET).createSignedUrl(path, SIGNED_URL_SEKUNDEN);
    if (signError) throw new Error(signError.message);
    return { url: data.signedUrl, path };
  }
};
