'use strict';

// ============================================================================
// GLOBALER STATE
// ============================================================================
const state = {
  user: null,
  flaechen: [],
  subflaechen: [],
  kulturen: [],
  fruchtfolge: [],
  schnitte: [],
  duengungen: [],
  weinbaumassnahmen: [],
  reifemessungen: [],
  weinlese: [],
  tanks: [],
  kellerlogbuch: [],
  abfuellungen: [],
  maschinen: [],
  wartungsintervalle: [],
  maschinenkosten: [],
  allgemeinekosten: [],
  erntevermarktung: [],
  tiere: [],
  zuchtereignisse: [],
  tierkosten: [],
  tiererloese: [],
  users: [],
  betrieb: null,
  map: null,
  katasterWmsLayer: null,
  flaechenLayerGroup: null,
  flaechenLayerById: {},
  subFlaechenLayerGroup: null,
  drawnItems: null,
  drawControl: null,
  drawModus: 'flaeche', // 'flaeche' | 'subflaeche'
  drawModusFlaecheId: null,
  katasterAbfrageAktiv: false,
  aktuelleZeichnungGeoJSON: null,
  sammelModus: false,
  gesammelteTeile: [], // { geometry, ha, label }
  sammelZielFlaeche: null,
  sammelLayerGroup: null,
  teilenZielFlaeche: null,
  aktiveFlaecheFuerFruchtfolge: null,
  aktiveFlaecheFuerSubFlaechen: null,
  aktiveFlaecheFuerFeldbuch: null,
  gpsWatchId: null,
  gpsMarker: null,
  gpsCircle: null
};

// ============================================================================
// HILFSFUNKTIONEN
// ============================================================================
function toast(msg, isError = false) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden', 'bg-gray-900', 'bg-red-700');
  el.classList.add(isError ? 'bg-red-700' : 'bg-gray-900');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add('hidden'), 4000);
}

function euro(n) {
  return Number(n || 0).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
}

function fmtDate(d) {
  if (!d) return '';
  const date = new Date(d);
  if (isNaN(date)) return String(d);
  return date.toLocaleDateString('de-DE');
}

async function safeCall(action, payload, successMsg) {
  try {
    const res = await Api.call(action, payload);
    if (successMsg) toast(successMsg);
    // Jede schreibende Aktion kann die Dashboard-Summen verändern - da diese
    // (anders als die Einzellisten) serverseitig berechnet und nicht lokal
    // nachrechenbar sind, den Cache dafür invalidieren statt zu patchen.
    if (/\.(create|update|delete|addStunden|erfassen)$/.test(action)) {
      invalidateCache('dashboard.summary');
    }
    return res;
  } catch (e) {
    toast(e.message, true);
    throw e;
  }
}

async function safeBatch(namedCalls) {
  try {
    return await Api.batch(namedCalls);
  } catch (e) {
    toast(e.message, true);
    throw e;
  }
}

// ============================================================================
// CLIENT-CACHE: Daten werden einmal beim Start komplett geladen (fullSync) und
// danach nur noch aus dem Speicher gelesen. Nur Speichern/Löschen braucht noch
// eine Serverantwort - reines Durchschauen/Navigieren ist danach sofort da.
// ============================================================================
const listCache = {};

async function cachedList(action) {
  if (!(action in listCache)) {
    listCache[action] = await safeCall(action);
  }
  return listCache[action];
}

// Wie safeBatch, aber überspringt bereits gecachte Aktionen komplett und holt
// nur die tatsächlich fehlenden in einem gebündelten Request nach.
async function cachedBatch(namedCalls) {
  const result = {};
  const missing = {};
  Object.entries(namedCalls).forEach(([key, call]) => {
    if (call.action in listCache) result[key] = listCache[call.action];
    else missing[key] = call;
  });
  if (Object.keys(missing).length > 0) {
    const fetched = await safeBatch(missing);
    Object.entries(missing).forEach(([key, call]) => {
      listCache[call.action] = fetched[key];
      result[key] = fetched[key];
    });
  }
  return result;
}

// Nach dem Speichern wird der Cache direkt lokal nachgeführt (mit dem vom
// Server zurückgegebenen Datensatz) statt die Liste neu vom Server zu holen -
// dadurch können Dialoge sofort schließen, ohne auf einen zweiten Roundtrip zu warten.
function cacheUpsert(action, record, idField = 'ID') {
  if (!(action in listCache) || !record) return;
  const idx = listCache[action].findIndex(r => r[idField] === record[idField]);
  if (idx >= 0) listCache[action][idx] = record; else listCache[action].push(record);
  persistCacheDebounced();
}

function cacheRemove(action, id, idField = 'ID') {
  if (!(action in listCache)) return;
  listCache[action] = listCache[action].filter(r => r[idField] !== id);
  persistCacheDebounced();
}

function invalidateCache(action) {
  delete listCache[action];
  persistCacheDebounced();
}

function clearCache() {
  Object.keys(listCache).forEach(k => delete listCache[k]);
}

// ---- Cache über App-Neustarts hinweg lokal sichern -------------------------
// Ohne das müsste bei JEDEM Öffnen der App (bzw. nach jedem Login) wieder komplett
// neu geladen werden ("ewiges Laden"), obwohl sich die Daten seit dem letzten Mal oft
// kaum geändert haben. Stattdessen: letzten bekannten Stand sofort anzeigen, im
// Hintergrund still aktualisieren (siehe onSignedIn).
const CACHE_STORAGE_KEY = 'hof_cache_v1';
let _persistTimer = null;

function persistCacheDebounced() {
  // Mehrere Änderungen kurz hintereinander (z.B. innerhalb eines Batch-Vorgangs) zu
  // EINEM Schreibvorgang bündeln, statt bei jeder einzelnen sofort das ganze (ggf.
  // mehrere hundert KB große) Cache-Objekt in localStorage zu serialisieren.
  clearTimeout(_persistTimer);
  _persistTimer = setTimeout(() => {
    try {
      localStorage.setItem(CACHE_STORAGE_KEY, JSON.stringify({ listCache, betrieb: state.betrieb, savedAt: new Date().toISOString() }));
    } catch (e) { /* z.B. Speicher voll - dann halt kein lokaler Schnellstart, kein Beinbruch */ }
  }, 400);
}

function restoreCacheFromStorage() {
  try {
    const raw = localStorage.getItem(CACHE_STORAGE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.listCache) return false;
    Object.assign(listCache, parsed.listCache);
    if (parsed.betrieb) state.betrieb = parsed.betrieb;
    return true;
  } catch (e) {
    return false;
  }
}

function clearPersistedCache() {
  localStorage.removeItem(CACHE_STORAGE_KEY);
}

// ============================================================================
// LADE-OVERLAY (beim initialen Vollsync und beim manuellen Aktualisieren)
// ============================================================================
function showLoadingOverlay(text) {
  document.getElementById('loadingOverlayText').textContent = text || 'Daten werden geladen...';
  document.getElementById('loadingOverlay').classList.remove('hidden');
}
function hideLoadingOverlay() {
  document.getElementById('loadingOverlay').classList.add('hidden');
}

// Alle Listen, die die App zum Anzeigen (nicht nur beim Bearbeiten) braucht,
// in EINEM gebündelten Request laden. Wird einmal beim Login und erneut beim
// Klick auf "Aktualisieren" ausgeführt.
const FULL_SYNC_CALLS = {
  betrieb: { action: 'betrieb.get' },
  flaechen: { action: 'flaechen.list' },
  subflaechen: { action: 'subflaechen.list' },
  kulturen: { action: 'kulturen.list' },
  fruchtfolge: { action: 'fruchtfolge.list' },
  schnitte: { action: 'schnitte.list' },
  duengungen: { action: 'duengungen.list' },
  weinbaumassnahmen: { action: 'weinbaumassnahmen.list' },
  reifemessungen: { action: 'reifemessungen.list' },
  weinlese: { action: 'weinlese.list' },
  tanks: { action: 'tanks.list' },
  kellerlogbuch: { action: 'kellerlogbuch.list' },
  maschinen: { action: 'maschinen.list' },
  wartungsintervalle: { action: 'wartungsintervalle.list' },
  maschinenkosten: { action: 'maschinenkosten.list' },
  allgemeinekosten: { action: 'allgemeinekosten.list' },
  erntevermarktung: { action: 'erntevermarktung.list' },
  tiere: { action: 'tiere.list' },
  zuchtereignisse: { action: 'zuchtereignisse.list' },
  tierkosten: { action: 'tierkosten.list' },
  tiererloese: { action: 'tiererloese.list' },
  users: { action: 'users.list' },
  dashboardSummary: { action: 'dashboard.summary' }
};

async function fullSync({ silent = false } = {}) {
  if (!silent) showLoadingOverlay('Daten werden geladen …');
  try {
    clearCache();
    const data = await safeBatch(FULL_SYNC_CALLS);
    Object.entries(FULL_SYNC_CALLS).forEach(([key, call]) => {
      listCache[call.action] = data[key];
    });
    state.betrieb = data.betrieb;
    if (data.betrieb && data.betrieb.HofName) document.getElementById('hofNameLabel').textContent = data.betrieb.HofName;
    persistCacheDebounced();
  } finally {
    if (!silent) hideLoadingOverlay();
  }
}

async function refreshAll() {
  await fullSync();
  const aktiveSektion = document.querySelector('.nav-btn.active');
  if (aktiveSektion) await showSection(aktiveSektion.dataset.section);
  toast('Daten aktualisiert.');
}

// ============================================================================
// GENERISCHES FORMULAR-MODAL
// ============================================================================
const formModal = document.getElementById('formModal');
const formModalForm = document.getElementById('formModalForm');
const formModalBody = document.getElementById('formModalBody');
const formModalTitle = document.getElementById('formModalTitle');
const formModalSaveBtn = document.getElementById('formModalSave');

document.getElementById('formModalClose').onclick = () => formModal.close();
document.getElementById('formModalCancel').onclick = () => formModal.close();

// Egal wie der Dialog schließt (Speichern, Abbrechen, X, ESC) - eine evtl. gerade
// gezeichnete/gesammelte Geometrie darf danach nie an einem späteren, unabhängigen
// Bearbeitungsvorgang "kleben bleiben".
formModal.addEventListener('close', () => {
  state.aktuelleZeichnungGeoJSON = null;
  state.teilenZielFlaeche = null;
  if (state.drawnItems) state.drawnItems.clearLayers();
});

function fieldHtml(f, value) {
  const val = value === undefined || value === null ? '' : value;
  const req = f.required ? 'required' : '';
  const common = `id="field_${f.key}" name="${f.key}" class="w-full border rounded px-3 py-2 text-sm"`;
  let inner = '';
  switch (f.type) {
    case 'select':
      inner = `<select ${common} ${req}>` +
        (f.options || []).map(o => {
          const ov = typeof o === 'object' ? o.value : o;
          const ol = typeof o === 'object' ? o.label : o;
          return `<option value="${ov}" ${String(ov) === String(val) ? 'selected' : ''}>${ol}</option>`;
        }).join('') + `</select>`;
      break;
    case 'textarea':
      inner = `<textarea ${common} rows="2">${val}</textarea>`;
      break;
    case 'checkbox':
      inner = `<input type="checkbox" id="field_${f.key}" name="${f.key}" class="w-5 h-5" ${val ? 'checked' : ''}>`;
      break;
    case 'file':
      inner = `<input type="file" ${common} accept="${f.accept || '*'}">`;
      break;
    case 'hidden':
      return `<input type="hidden" id="field_${f.key}" name="${f.key}" value="${val}">`;
    default:
      inner = `<input type="${f.type || 'text'}" ${common} value="${val}" ${f.step ? `step="${f.step}"` : ''} ${req}>`;
  }
  return `<div>
      <label class="block text-sm font-medium text-gray-600 mb-1">${f.label}</label>
      ${inner}
      ${f.help ? `<p class="text-xs text-gray-400 mt-1">${f.help}</p>` : ''}
    </div>`;
}

let _currentModalOnSubmit = null;

function openFormModal({ title, fields, initial = {}, onSubmit }) {
  formModalTitle.textContent = title;
  formModalBody.innerHTML = fields.map(f => fieldHtml(f, initial[f.key])).join('');
  _currentModalOnSubmit = onSubmit;
  formModal.showModal();
}

let _formModalSpeichertGerade = false;

formModalForm.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  // Schutz gegen Mehrfach-Absenden: ohne diese Sperre erzeugt mehrfaches/ungeduldiges
  // Klicken auf "Speichern" (bevor der erste Request fertig ist) mehrere parallele
  // Submits und damit doppelte/mehrfache Einträge.
  if (_formModalSpeichertGerade) return;
  _formModalSpeichertGerade = true;
  formModalSaveBtn.disabled = true;
  const urspruenglicherText = formModalSaveBtn.textContent;
  formModalSaveBtn.textContent = 'Speichert …';

  const values = {};
  [...formModalBody.querySelectorAll('[name]')].forEach(el => {
    values[el.name] = el.type === 'checkbox' ? el.checked : el.type === 'file' ? el.files[0] : el.value;
  });
  try {
    if (_currentModalOnSubmit) await _currentModalOnSubmit(values);
    formModal.close();
  } catch (e) {
    toast(e.message, true);
  } finally {
    _formModalSpeichertGerade = false;
    formModalSaveBtn.disabled = false;
    formModalSaveBtn.textContent = urspruenglicherText;
  }
});

// ============================================================================
// GENERISCHES DETAIL-MODAL (Kosten/Erlöse/Wartung-Listen)
// ============================================================================
const detailModal = document.getElementById('detailModal');
document.getElementById('detailModalClose').onclick = () => detailModal.close();

function openDetailModal(title, renderFn) {
  document.getElementById('detailModalTitle').textContent = title;
  const body = document.getElementById('detailModalBody');
  body.innerHTML = '';
  renderFn(body);
  detailModal.showModal();
}

// ============================================================================
// GENERISCHE TABELLE
// ============================================================================
function renderTable(container, columns, rows, { onEdit, onDelete, extraButtons, onRowClick } = {}) {
  if (!rows.length) {
    container.innerHTML = `<p class="text-gray-400 text-sm py-4">Keine Einträge vorhanden.</p>`;
    return;
  }
  const canWrite = state.user && state.user.role;
  const canDelete = state.user && state.user.role === 'Admin';
  let html = `<table class="min-w-full text-sm"><thead><tr class="text-left text-gray-500 border-b">`;
  columns.forEach(c => html += `<th class="py-2 pr-4">${c.label}</th>`);
  html += `<th></th></tr></thead><tbody>`;
  rows.forEach((row, idx) => {
    html += `<tr class="border-b hover:bg-gray-50${onRowClick ? ' cursor-pointer' : ''}" data-row-idx="${idx}">`;
    columns.forEach(c => html += `<td class="py-2 pr-4">${c.format ? c.format(row) : (row[c.key] ?? '')}</td>`);
    html += `<td class="py-2 pr-2 text-right whitespace-nowrap">`;
    if (extraButtons) html += extraButtons(row, idx);
    if (onEdit && canWrite) html += `<button data-idx="${idx}" class="btn-edit text-blue-600 hover:underline mr-2">Bearbeiten</button>`;
    if (onDelete && canDelete) html += `<button data-idx="${idx}" class="btn-delete text-red-600 hover:underline">Löschen</button>`;
    html += `</td></tr>`;
  });
  html += `</tbody></table>`;
  container.innerHTML = html;
  if (onEdit) container.querySelectorAll('.btn-edit').forEach(b => b.onclick = () => onEdit(rows[b.dataset.idx]));
  if (onDelete) container.querySelectorAll('.btn-delete').forEach(b => b.onclick = () => {
    if (confirm('Wirklich löschen?')) onDelete(rows[b.dataset.idx]);
  });
  if (onRowClick) container.querySelectorAll('tbody tr').forEach(tr => tr.addEventListener('click', (ev) => {
    if (ev.target.closest('button')) return;
    onRowClick(rows[tr.dataset.rowIdx]);
  }));
}

// ============================================================================
// NAVIGATION (inkl. einklappbares Menü für Mobilgeräte)
// ============================================================================
function schliesseMobilMenu() {
  document.getElementById('mainNav').classList.remove('nav-open');
  document.getElementById('navBackdrop').classList.add('hidden');
}
function oeffneMobilMenu() {
  document.getElementById('mainNav').classList.add('nav-open');
  document.getElementById('navBackdrop').classList.remove('hidden');
}

document.getElementById('btnMenuToggle').addEventListener('click', () => {
  document.getElementById('mainNav').classList.contains('nav-open') ? schliesseMobilMenu() : oeffneMobilMenu();
});
document.getElementById('navBackdrop').addEventListener('click', schliesseMobilMenu);

document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => { showSection(btn.dataset.section); schliesseMobilMenu(); });
});

async function showSection(name) {
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.section === name));
  document.querySelectorAll('.app-section').forEach(s => s.classList.add('hidden'));
  document.getElementById('section-' + name).classList.remove('hidden');

  if (name === 'dashboard') await loadDashboard();
  if (name === 'flaechen') await loadFlaechenSection();
  if (name === 'fuhrpark') await loadFuhrparkSection();
  if (name === 'vieh') await loadViehSection();
  if (name === 'futtermittel') await loadFuttermittelSection();
  if (name === 'weinbau') await loadWeinbauSection();
  if (name === 'finanzen') await loadFinanzenSection();
  if (name === 'einstellungen') await loadEinstellungenSection();
}

// ============================================================================
// AUTH / BOOTSTRAP
window.addEventListener('DOMContentLoaded', () => {
  // Wandelt alle statisch im HTML vorhandenen <i data-lucide="..."> Platzhalter (Login-
  // Bildschirm, Kopfzeile, Navigation, Abschnitts-Überschriften) in echte SVG-Icons um.
  // Dynamisch nachgeladene Inhalte (z.B. Dashboard-Kacheln) rufen das nach dem eigenen
  // Rendern jeweils selbst nochmal auf.
  lucide.createIcons();

  Auth.init(onSignedIn, onSignedOut);

  document.getElementById('signOutBtn').onclick = () => Auth.signOut();
  document.getElementById('btnAktualisieren').onclick = async (ev) => {
    const icon = ev.currentTarget.querySelector('.btn-refresh');
    icon.classList.add('spinning');
    try { await refreshAll(); } finally { icon.classList.remove('spinning'); }
  };
});

async function onSignedIn(profile) {
  document.getElementById('loginError').textContent = '';
  try {
    const me = await Api.call('auth.me');
    state.user = me;
    document.getElementById('loginScreen').classList.add('hidden');
    document.getElementById('appShell').classList.remove('hidden');
    document.getElementById('userAvatar').src = profile.picture || '';
    document.getElementById('userNameLabel').textContent = `${me.name} (${me.role})`;

    // Gibt es vom letzten Mal einen lokal gesicherten Datenstand, sofort damit anzeigen
    // statt auf's Netzwerk zu warten ("ewiges Laden") - im Hintergrund wird still
    // aktualisiert. Nur beim allerersten Login auf einem Gerät (noch kein lokaler
    // Stand vorhanden) muss wie bisher auf den vollen Ladevorgang gewartet werden.
    if (restoreCacheFromStorage()) {
      if (state.betrieb && state.betrieb.HofName) document.getElementById('hofNameLabel').textContent = state.betrieb.HofName;
      await showSection('dashboard');
      hintergrundAktualisierung();
    } else {
      await fullSync();
      await showSection('dashboard');
    }

    // Ping + "wer ist aktiv" in EINEM gebündelten Request statt zwei getrennten
    // Hintergrund-Anfragen - weniger gleichzeitige Anfragen an Apps Script.
    refreshActiveUsersLabel();
    setInterval(refreshActiveUsersLabel, 3 * 60 * 1000);
  } catch (e) {
    document.getElementById('loginError').textContent = e.message;
    document.getElementById('appShell').classList.add('hidden');
    document.getElementById('loginScreen').classList.remove('hidden');
  }
}

// Lädt nach einem Sofort-Start aus dem lokalen Cache im Hintergrund den tatsächlich
// aktuellen Stand nach - mit einem kleinen drehenden Icon statt dem vollen Ladebalken,
// damit die bereits sichtbare Oberfläche dabei nicht verdeckt wird.
async function hintergrundAktualisierung() {
  const icon = document.querySelector('#btnAktualisieren .btn-refresh');
  if (icon) icon.classList.add('spinning');
  try {
    await fullSync({ silent: true });
    const aktiveSektion = document.querySelector('.nav-btn.active');
    if (aktiveSektion) await showSection(aktiveSektion.dataset.section);
  } catch (e) {
    // Kein Blocker: die App zeigt einfach weiter den letzten bekannten (jetzt evtl.
    // leicht veralteten) Stand, bis die Verbindung wieder klappt oder manuell aktualisiert wird.
  } finally {
    if (icon) icon.classList.remove('spinning');
  }
}

function onSignedOut() {
  clearPersistedCache();
  location.reload();
}

async function refreshActiveUsersLabel() {
  try {
    const { users } = await Api.batch({
      ping: { action: 'activity.ping' },
      users: { action: 'dashboard.activeUsers' }
    });
    const label = document.getElementById('activeUsersLabel');
    label.textContent = users.length ? `🟢 Aktiv: ${users.map(u => u.name).join(', ')}` : '';
  } catch (e) { /* still fine */ }
}

// ============================================================================
// DASHBOARD
// ============================================================================
const TODO_PRIORITAET_ORDER = { Hoch: 0, Mittel: 1, Niedrig: 2 };
const TODO_PRIORITAET_ICONS = { Hoch: '🔴', Mittel: '🟡', Niedrig: '🟢' };

// Modernes SVG-Icon (Lucide) statt Emoji - siehe lucide.createIcons()-Aufrufe nach jedem
// Neu-Rendern von Inhalten, die dieses Markup enthalten (Platzhalter <i> wird erst dadurch
// zum tatsächlichen <svg>).
function lucideIcon(name, klasse = 'w-6 h-6') {
  return `<i data-lucide="${name}" class="${klasse}"></i>`;
}

// Eigenes Kuh-Kopf-Icon (Lucide hat keins) im selben Strich-Stil wie die Lucide-Icons,
// damit es sich optisch nahtlos einfügt.
function kuhKopfIcon(klasse = 'w-6 h-6') {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="${klasse}">
    <path d="M3 7c-1-1.5-1-3 0-4" /><path d="M21 7c1-1.5 1-3 0-4" /><path d="M9 4.5c-.3-1 0-2 .8-2.6" /><path d="M15 4.5c.3-1 0-2-.8-2.6" />
    <path d="M4 8c0-3 3-5 8-5s8 2 8 5c0 2-.7 3.6-1.8 4.8-.6.7-1 1.6-1.2 2.5-.4 2-2.2 3.7-5 3.7s-4.6-1.7-5-3.7c-.2-.9-.6-1.8-1.2-2.5C4.7 11.6 4 10 4 8Z" />
    <circle cx="9" cy="9" r="1" fill="currentColor" stroke="none" /><circle cx="15" cy="9" r="1" fill="currentColor" stroke="none" />
    <rect x="7.5" y="13" width="9" height="6" rx="3" />
    <circle cx="10" cy="16" r="0.8" fill="currentColor" stroke="none" /><circle cx="14" cy="16" r="0.8" fill="currentColor" stroke="none" />
  </svg>`;
}

// Eine Dashboard-Kachel als HTML-String: feste/quadratische Größe, Kopf (Icon/Titel/
// Wert) + darunter eine scrollende Kurz-Vorschau (wächst nie über die Kachel hinaus -
// bei mehr Zeilen wird innerhalb der Kachel gescrollt). Der Pfeil oben rechts (nur wenn
// "expandable" gesetzt ist) öffnet ein Detail-Fenster mit der vollständigen, klickbaren
// Liste; ein Klick irgendwo sonst auf die Kachel springt direkt in die zugehörige Sektion.
function dashTileHtml({ id, icon, title, value, sub, preview, section, alert, expandable }) {
  return `<div class="dash-tile${alert ? ' dash-tile-alert' : ''}" data-tile-id="${id}" data-section="${section || ''}">
    ${expandable ? `<button type="button" class="dash-tile-arrow" data-modal-id="${id}" aria-label="Details öffnen">›</button>` : ''}
    <div class="dash-tile-icon" id="dashIcon-${id}">${icon}</div>
    <div class="dash-tile-title">${title}</div>
    <div class="dash-tile-value" id="dashVal-${id}">${value}</div>
    ${sub !== undefined ? `<div class="dash-tile-sub" id="dashSub-${id}">${sub}</div>` : ''}
    <div class="dash-tile-preview" id="dashDet-${id}">${preview || ''}</div>
  </div>`;
}
function drow(label, value) {
  return `<div class="drow"><span>${label}</span><b>${value}</b></div>`;
}
// Ein einziger delegierter Click-Handler statt einzelner Listener pro Kachel - bleibt auch
// gültig, wenn einzelne Kachel-Inhalte später asynchron nachgeladen/gepatcht werden (Wetter).
document.getElementById('dashboardGrid').addEventListener('click', (e) => {
  const arrow = e.target.closest('.dash-tile-arrow');
  if (arrow) { openDashTileDetail(arrow.dataset.modalId); return; }
  const tile = e.target.closest('.dash-tile');
  if (!tile) return;
  if (tile.dataset.section) showSection(tile.dataset.section);
});

// Vollständige, klickbare Detail-Ansicht je Kachel - nutzt dieselben Formulare/Aktionen
// wie die jeweilige Sektion, damit man von hier aus direkt handeln kann statt nur zu lesen.
const DASH_TILE_SECTIONS = {
  tiere: { section: 'vieh', label: 'Viehhaltung' },
  flaechen: { section: 'flaechen', label: 'Flächen' },
  arbeiten: { section: 'flaechen', label: 'Flächen' },
  wartung: { section: 'fuhrpark', label: 'Fuhrpark' },
  futter: { section: 'futtermittel', label: 'Futtermittel' },
  keller: { section: 'weinbau', label: 'Weinbau & Keller' }
};

// Öffnet das Detail-Fenster einer Dashboard-Kachel mit einem fest sichtbaren Link zum
// zugehörigen Reiter oben im Fenster - auf dem Handy ist das die einzige Möglichkeit,
// von der (im Fenster gefangenen) Detailansicht aus direkt in den vollen Bereich zu
// wechseln, ohne das Fenster erst manuell schließen zu müssen.
function openDashDetailWithSection(title, tileId, renderFn) {
  const ziel = DASH_TILE_SECTIONS[tileId];
  openDetailModal(title, (body) => {
    body.innerHTML = ziel
      ? `<button id="btnDashGoto" class="text-sm text-green-700 hover:underline mb-3">→ ${ziel.label} öffnen</button><div id="dashDetailInner"></div>`
      : '<div id="dashDetailInner"></div>';
    if (ziel) document.getElementById('btnDashGoto').onclick = () => { detailModal.close(); showSection(ziel.section); };
    renderFn(document.getElementById('dashDetailInner'));
  });
}

function todoRowHtml(t) {
  return `<div class="flex items-center gap-2 py-1.5 border-b last:border-b-0${t.Erledigt ? ' opacity-50' : ''}">
    <input type="checkbox" class="todo-check w-4 h-4 shrink-0" data-id="${t.ID}" ${t.Erledigt ? 'checked' : ''}>
    <span class="flex-1 text-sm ${t.Erledigt ? 'line-through text-gray-400' : ''}">${t.Text}</span>
    ${!t.Erledigt ? `<button data-id="${t.ID}" class="todo-prio-up text-gray-400 hover:text-gray-700 px-1" title="Priorität erhöhen">▲</button>
    <button data-id="${t.ID}" class="todo-prio-down text-gray-400 hover:text-gray-700 px-1" title="Priorität senken">▼</button>` : ''}
    <span title="${t.Prioritaet || 'Mittel'}">${TODO_PRIORITAET_ICONS[t.Prioritaet] || '🟡'}</span>
    <button data-id="${t.ID}" class="todo-delete text-red-400 hover:text-red-600 px-1">✕</button>
  </div>`;
}

function renderTodoListe(container) {
  const alle = state.dashboardData.todos || [];
  const offen = alle.filter(t => !t.Erledigt).sort((a, b) => (TODO_PRIORITAET_ORDER[a.Prioritaet] ?? 1) - (TODO_PRIORITAET_ORDER[b.Prioritaet] ?? 1));
  const erledigt = alle.filter(t => t.Erledigt);

  container.innerHTML = `
    <div class="flex gap-2 mb-3">
      <input id="todoNeuText" type="text" placeholder="Neue Aufgabe eintippen …" class="flex-1 border rounded px-3 py-2 text-sm">
      <button id="todoNeuAdd" class="bg-green-700 text-white px-3 py-2 rounded text-sm shrink-0">+ Hinzufügen</button>
    </div>
    <div>${offen.map(todoRowHtml).join('') || '<p class="text-gray-400 text-sm py-2">Keine offenen Aufgaben.</p>'}</div>
    ${erledigt.length ? `<div class="mt-4 pt-3 border-t">
      <div class="text-xs text-gray-400 mb-1">Erledigt (${erledigt.length})</div>
      <div>${erledigt.map(todoRowHtml).join('')}</div>
    </div>` : ''}`;

  const neuHinzufuegen = async () => {
    const feld = document.getElementById('todoNeuText');
    const text = feld.value.trim();
    if (!text) return;
    const saved = await safeCall('todos.create', { Text: text, Prioritaet: 'Mittel', Erledigt: false }, 'Aufgabe hinzugefügt.');
    cacheUpsert('todos.list', saved);
    renderTodoListe(container);
  };
  container.querySelector('#todoNeuAdd').onclick = neuHinzufuegen;
  container.querySelector('#todoNeuText').addEventListener('keydown', (e) => { if (e.key === 'Enter') neuHinzufuegen(); });

  container.querySelectorAll('.todo-check').forEach(cb => cb.onchange = async () => {
    const saved = await safeCall('todos.update', { id: cb.dataset.id, Erledigt: cb.checked });
    cacheUpsert('todos.list', saved);
    renderTodoListe(container);
  });
  container.querySelectorAll('.todo-prio-up').forEach(b => b.onclick = () => aendereTodoPrioritaet(b.dataset.id, -1, container));
  container.querySelectorAll('.todo-prio-down').forEach(b => b.onclick = () => aendereTodoPrioritaet(b.dataset.id, 1, container));
  container.querySelectorAll('.todo-delete').forEach(b => b.onclick = async () => {
    await safeCall('todos.delete', { id: b.dataset.id }, 'Gelöscht.');
    cacheRemove('todos.list', b.dataset.id);
    state.dashboardData.todos = listCache['todos.list'];
    renderTodoListe(container);
  });
}

// Verschiebt eine Aufgabe eine Prioritätsstufe nach oben (-1) oder unten (+1).
async function aendereTodoPrioritaet(id, delta, container) {
  const t = (state.dashboardData.todos || []).find(x => x.ID === id);
  if (!t) return;
  const stufen = ['Hoch', 'Mittel', 'Niedrig'];
  let idx = stufen.indexOf(t.Prioritaet);
  if (idx < 0) idx = 1;
  idx = Math.min(stufen.length - 1, Math.max(0, idx + delta));
  const saved = await safeCall('todos.update', { id, Prioritaet: stufen[idx] });
  cacheUpsert('todos.list', saved);
  renderTodoListe(container);
}

function openDashTileDetail(id) {
  const d = state.dashboardData || {};
  if (id === 'todos') {
    openDashDetailWithSection('To-Do', id, (inner) => renderTodoListe(inner));
  } else if (id === 'tiere') {
    openDashDetailWithSection('Tiere', id, (inner) => {
      renderTable(inner,
        [{ key: 'Ohrmarke', label: 'Ohrmarke' }, { key: 'Tierart', label: 'Tierart' }, { key: 'Name', label: 'Name' }, { key: 'Rasse', label: 'Rasse' }],
        d.tiereLebend,
        { extraButtons: (row) => `<button data-id="${row.ID}" class="btn-dash-tier-details text-green-700 hover:underline mr-2">📋 Details &amp; Zucht</button>`
            + `<button data-id="${row.ID}" class="btn-dash-tier-edit text-blue-600 hover:underline">Bearbeiten</button>` });
      inner.querySelectorAll('.btn-dash-tier-details').forEach(b => b.onclick = () => { detailModal.close(); openTierBuchungenDetail(d.tiereLebend.find(t => t.ID === b.dataset.id)); });
      inner.querySelectorAll('.btn-dash-tier-edit').forEach(b => b.onclick = () => { detailModal.close(); openTierModal(d.tiereLebend.find(t => t.ID === b.dataset.id)); });
    });
  } else if (id === 'flaechen') {
    openDashDetailWithSection('Flächen', id, (inner) => {
      renderTable(inner,
        [{ key: 'Name', label: 'Name' }, { key: 'Nutzungsart', label: 'Nutzung' }, { label: 'Fläche', format: r => `${Number(r.FlaecheHa || 0).toFixed(2)} ha` }],
        d.flaechenAktiv,
        { onRowClick: async (row) => { detailModal.close(); await showSection('flaechen'); zoomZuFlaeche(state.flaechen.find(f => f.ID === row.ID) || row); } });
    });
  } else if (id === 'arbeiten') {
    openDashDetailWithSection('Anstehende Bearbeitungen', id, (inner) => {
      renderTable(inner, [{ key: 'Name', label: 'Fläche' }, { label: 'Nächster Schritt', format: r => r._naechster }], d.anstehend,
        { onRowClick: (row) => { detailModal.close(); openArbeitsschrittModal(row); } });
    });
  } else if (id === 'wartung') {
    openDashDetailWithSection('Wartung', id, (inner) => {
      renderTable(inner, [{ label: 'Maschine', format: r => r.m.Bezeichnung }, { label: 'Hinweis', format: r => r.hinweise.join(' · ') }], d.alarme,
        { onRowClick: (row) => { detailModal.close(); openWartungsintervalleDetail(row.m); } });
    });
  } else if (id === 'futter') {
    openDashDetailWithSection('Futtermittel', id, (inner) => {
      renderTable(inner, [{ key: 'Bezeichnung', label: 'Bezeichnung' }, { label: 'Bestand', format: r => `${Number(r.BestandAktuell || 0).toFixed(1)} ${r.Einheit}` }], d.futtermittelAktiv,
        { onRowClick: (row) => { detailModal.close(); openFuttermittelBewegungModal(row); } });
    });
  } else if (id === 'keller') {
    openDashDetailWithSection('Keller', id, (inner) => {
      inner.innerHTML = '<div class="font-semibold mb-2">Fässer</div><div id="dashKellerFass"></div><div class="font-semibold mt-4 mb-2">Flaschenlager</div><div id="dashKellerFlaschen"></div>';
      renderTable(document.getElementById('dashKellerFass'),
        [{ key: 'Bezeichnung', label: 'Tank' }, { label: 'Inhalt', format: r => `${Number(r.AktuellerInhaltLiter || 0).toFixed(0)} l` }], d.fassMitInhalt,
        { onRowClick: (row) => { detailModal.close(); openKellerLogbuchDetail(row); } });
      renderTable(document.getElementById('dashKellerFlaschen'),
        [{ key: 'Bezeichnung', label: 'Bezeichnung' }, { label: 'Anzahl', format: r => `${r.AnzahlAktuell} Flaschen` }], d.flaschenbestandAktiv,
        { onRowClick: (row) => { detailModal.close(); openFlaschenAustragModal(row); } });
    });
  }
}

async function loadDashboard() {
  // dashboard.summary wird bewusst NICHT über cachedBatch/listCache geführt: der Server
  // hält ihn ohnehin schon ~20s selbst im Cache (günstig), aber ein clientseitiger Cache
  // darüber hinaus würde nach jeder Änderung (neue Fläche, Tier, ...) beliebig lange
  // veraltete Zahlen zeigen, bis man "Aktualisieren" drückt - hier soll jeder Dashboard-
  // Aufruf den aktuellen (serverseitig kurz gecachten) Stand bekommen.
  const [s, { maschinen, intervalle, futtermittel, tanks, flaschenbestand, flaechen, fruchtfolge, feldarbeiten, tiere, todos }] = await Promise.all([
    safeCall('dashboard.summary'),
    cachedBatch({
      maschinen: { action: 'maschinen.list' },
      intervalle: { action: 'wartungsintervalle.list' },
      futtermittel: { action: 'futtermittel.list' },
      tanks: { action: 'tanks.list' },
      flaschenbestand: { action: 'flaschenbestand.list' },
      flaechen: { action: 'flaechen.list' },
      fruchtfolge: { action: 'fruchtfolge.list' },
      feldarbeiten: { action: 'feldarbeiten.list' },
      tiere: { action: 'tiere.list' },
      todos: { action: 'todos.list' }
    })
  ]);
  state.maschinen = maschinen.filter(m => m.Aktiv !== false);
  state.wartungsintervalle = intervalle;
  const futtermittelAktiv = futtermittel.filter(f => f.Aktiv !== false);
  const flaschenbestandAktiv = flaschenbestand.filter(f => f.Aktiv !== false && Number(f.AnzahlAktuell || 0) > 0);
  const flaechenAktiv = flaechen.filter(f => f.Aktiv !== false);
  const tiereLebend = tiere.filter(t => t.Status === 'Lebend');
  const jahr = new Date().getFullYear();
  const fassMitInhalt = tanks.filter(t => t.Aktiv !== false && Number(t.AktuellerInhaltLiter || 0) > 0);
  const alarme = state.maschinen.map(m => ({ m, ...computeAmpelStatus(m, intervalle) })).filter(x => x.status !== 'green');
  const anstehend = flaechenAktiv
    .filter(f => hatArbeitsablauf(f))
    .map(f => ({ ...f, _naechster: naechsterArbeitsschritt(f, feldarbeiten, jahr) }))
    .filter(x => x._naechster);

  // Für die Detail-Fenster (Pfeil-Klick) - dort wird mit den vollen, klickbaren Listen
  // gearbeitet statt nur mit der kompakten Kachel-Vorschau.
  state.dashboardData = { tiereLebend, flaechenAktiv, anstehend, alarme, futtermittelAktiv, fassMitInhalt, flaschenbestandAktiv, todos };

  const tiles = [];

  const todosOffen = todos.filter(t => !t.Erledigt).sort((a, b) => (TODO_PRIORITAET_ORDER[a.Prioritaet] ?? 1) - (TODO_PRIORITAET_ORDER[b.Prioritaet] ?? 1));
  tiles.push(dashTileHtml({
    id: 'todos', icon: lucideIcon('list-checks'), title: 'To-Do', value: todosOffen.length, sub: `${todos.length - todosOffen.length} erledigt`, expandable: true,
    preview: todosOffen.length
      ? todosOffen.slice(0, 8).map(t => drow(`${TODO_PRIORITAET_ICONS[t.Prioritaet] || '🟡'} ${t.Text}`, '')).join('')
      : '<p class="text-gray-400 text-xs py-2">Keine offenen Aufgaben.</p>'
  }));

  tiles.push(dashTileHtml({
    id: 'tiere', icon: kuhKopfIcon(), title: 'Tiere', value: tiereLebend.length, sub: 'lebend', section: 'vieh', expandable: true,
    preview: tiereLebend.length
      ? tiereLebend.map(t => drow(`${t.Name || t.Ohrmarke || 'unbenannt'}`, t.Tierart)).join('')
      : '<p class="text-gray-400 text-xs py-2">Keine Tiere erfasst.</p>'
  }));

  // ---- Flächen nach Nutzung/Kultur ----
  const haVon = (arr) => arr.reduce((sum, f) => sum + Number(f.FlaecheHa || 0), 0);
  const gruenland = flaechenAktiv.filter(f => f.Nutzungsart === 'Dauerwiese' || f.Nutzungsart === 'Wechselwiese');
  const weinbau = flaechenAktiv.filter(f => f.Nutzungsart === 'Weinbau' || f.Nutzungsart === 'Obst-Weinbau');
  const obstbau = flaechenAktiv.filter(f => f.Nutzungsart === 'Obstbau');
  const ackerland = flaechenAktiv.filter(f => f.Nutzungsart === 'Ackerland');
  const wald = flaechenAktiv.filter(f => f.Nutzungsart === 'Wald');
  const almweide = flaechenAktiv.filter(f => f.Nutzungsart === 'Almweide');
  const ackerlandProKultur = {};
  ackerland.forEach(f => {
    const zuweisung = fruchtfolge.find(ff => ff.FlaecheID === f.ID && Number(ff.Jahr) === jahr);
    const kultur = zuweisung ? zuweisung.Kultur : 'ohne Zuweisung';
    ackerlandProKultur[kultur] = (ackerlandProKultur[kultur] || 0) + Number(f.FlaecheHa || 0);
  });
  const flaechenPreview = [
    drow('🌾 Grünland', `${haVon(gruenland).toFixed(2)} ha`),
    drow('🍇 Weinbau', `${haVon(weinbau).toFixed(2)} ha`),
    obstbau.length ? drow('🍎 Obstbau', `${haVon(obstbau).toFixed(2)} ha`) : '',
    drow('🌱 Ackerland', `${haVon(ackerland).toFixed(2)} ha`),
    drow('🌲 Wald', `${haVon(wald).toFixed(2)} ha`),
    drow('⛰️ Almweide', `${haVon(almweide).toFixed(2)} ha`)
  ].join('');
  // Kopfwert bewusst aus der (bereits aktuellen) Flächen-Liste berechnet statt aus s.* -
  // so ist er nach einer Änderung sofort korrekt, ohne auf den serverseitigen Summary-Cache warten zu müssen.
  tiles.push(dashTileHtml({ id: 'flaechen', icon: lucideIcon('map'), title: 'Flächen', value: `${haVon(flaechenAktiv).toFixed(2)} ha`, sub: `${flaechenAktiv.length} Parzellen`, section: 'flaechen', expandable: true, preview: flaechenPreview }));

  // ---- Anstehende Bearbeitungen (Arbeitsabläufe je Fläche) ----
  if (anstehend.length) {
    tiles.push(dashTileHtml({
      id: 'arbeiten', icon: lucideIcon('clipboard-list'), title: 'Bearbeitungen', value: anstehend.length, sub: 'offene Schritte', section: 'flaechen', expandable: true,
      preview: anstehend.map(x => drow(x.Name, x._naechster)).join('')
    }));
  }

  // ---- Wartungsalarm ----
  if (alarme.length) {
    tiles.push(dashTileHtml({
      id: 'wartung', icon: lucideIcon('wrench'), title: 'Wartung', value: alarme.length, sub: 'fällig/bald fällig', alert: true, section: 'fuhrpark', expandable: true,
      preview: alarme.map(a => drow(`${a.status === 'red' ? '🔴' : '🟡'} ${a.m.Bezeichnung}`, a.hinweise.join(' · '))).join('')
    }));
  }

  // ---- Futtermittel konkret (was, wie viel) statt nur Sortenanzahl ----
  if (futtermittelAktiv.length) {
    const knapp = futtermittelAktiv.filter(f => f.MindestBestand && Number(f.BestandAktuell || 0) < Number(f.MindestBestand));
    tiles.push(dashTileHtml({
      id: 'futter', icon: lucideIcon('wheat'), title: 'Futtermittel', value: `${futtermittelAktiv.length} Sorten`, sub: knapp.length ? `${knapp.length} knapp ⚠️` : 'Bestand ok', alert: knapp.length > 0, section: 'futtermittel', expandable: true,
      preview: futtermittelAktiv.map(f => {
        const istKnapp = f.MindestBestand && Number(f.BestandAktuell || 0) < Number(f.MindestBestand);
        return `<div class="drow${istKnapp ? ' text-red-600 font-semibold' : ''}"><span>${f.Bezeichnung}</span><b>${Number(f.BestandAktuell || 0).toFixed(1)} ${f.Einheit}${istKnapp ? ' ⚠️' : ''}</b></div>`;
      }).join('')
    }));
  }

  // ---- Keller konkret (Fässer mit Inhalt + Flaschenbestand je Sorte/Jahrgang) ----
  if (fassMitInhalt.length || flaschenbestandAktiv.length) {
    const literGesamt = fassMitInhalt.reduce((sum, t) => sum + Number(t.AktuellerInhaltLiter || 0), 0);
    const flaschenGesamt = flaschenbestandAktiv.reduce((sum, f) => sum + Number(f.AnzahlAktuell || 0), 0);
    const kellerPreview = [
      ...fassMitInhalt.map(t => drow(`🛢️ ${t.Bezeichnung}`, `${Number(t.AktuellerInhaltLiter || 0).toFixed(0)} l`)),
      ...flaschenbestandAktiv.map(f => drow(`🍾 ${f.Bezeichnung}`, `${f.AnzahlAktuell}`))
    ].join('');
    tiles.push(dashTileHtml({ id: 'keller', icon: lucideIcon('grape'), title: 'Keller', value: `${literGesamt.toFixed(0)} l`, sub: `${flaschenGesamt} Flaschen`, section: 'weinbau', expandable: true, preview: kellerPreview }));
  }

  // ---- Wetter: Platzhalter, wird gleich unten asynchron befüllt (externe API) ----
  tiles.push(dashTileHtml({
    id: 'wetter', icon: lucideIcon('cloud-sun'), title: 'Wetter', value: 'Lädt …', sub: '', section: 'flaechen',
    preview: '<p class="text-gray-400 text-xs py-2">Wetterdaten werden geladen …</p>'
  }));

  // ---- Gerade aktiv ----
  tiles.push(dashTileHtml({
    id: 'aktiv', icon: lucideIcon('users'), title: 'Aktiv', value: s.aktiveNutzer.length, sub: s.aktiveNutzer.length ? s.aktiveNutzer.map(u => u.name).join(', ') : 'niemand sonst',
    preview: s.aktiveNutzer.length
      ? s.aktiveNutzer.map(u => drow(u.name, new Date(u.lastSeen).toLocaleTimeString('de-DE'))).join('')
      : '<p class="text-gray-400 text-xs py-2">Aktuell sonst niemand aktiv.</p>'
  }));

  document.getElementById('dashboardGrid').innerHTML = tiles.join('');
  lucide.createIcons();

  loadWetterBox();
}

// WMO-Wettercode -> Emoji, damit die Wetterkachel wie eine normale Wetter-App aussieht
// statt nur Zahlen zu zeigen (https://open-meteo.com/en/docs -> WMO Weather interpretation codes).
function weatherIcon(code) {
  if (code === 0) return '☀️';
  if (code === 1 || code === 2) return '🌤️';
  if (code === 3) return '☁️';
  if (code === 45 || code === 48) return '🌫️';
  if ([51, 53, 55, 56, 57].includes(code)) return '🌦️';
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return '🌧️';
  if ([71, 73, 75, 77, 85, 86].includes(code)) return '🌨️';
  if ([95, 96, 99].includes(code)) return '⛈️';
  return '🌡️';
}

// Wetter/Boden-Übersicht für den Koordinaten-Mittelwert der Dauergrünwiesen (Open-Meteo,
// kein API-Key nötig). Läuft bewusst NICHT über cachedList/cachedBatch - Wetterdaten
// sollen bei jedem Dashboard-Aufruf frisch sein, nicht aus dem Sitzungs-Cache kommen.
// Patcht die schon gerenderte Wetter-Kachel gezielt (id "wetter"), statt die ganze
// Dashboard-Kachel-Liste neu aufzubauen - der Fetch ist langsamer als der Rest.
async function loadWetterBox() {
  const valEl = document.getElementById('dashVal-wetter');
  const subEl = document.getElementById('dashSub-wetter');
  const detEl = document.getElementById('dashDet-wetter');
  const iconEl = document.getElementById('dashIcon-wetter');
  if (!valEl) return;
  try {
    const flaechen = await cachedList('flaechen.list');
    const dauerwiesen = flaechen.filter(f => f.Nutzungsart === 'Dauerwiese' && f.GeoJSON);
    const quelle = dauerwiesen.length ? dauerwiesen : flaechen.filter(f => f.GeoJSON);
    if (!quelle.length) { valEl.textContent = 'keine Fläche'; detEl.innerHTML = '<p class="text-gray-400 text-sm py-2">Keine Fläche mit Geometrie hinterlegt.</p>'; return; }
    const zentren = quelle.map(f => {
      try { return computeCentroid(JSON.parse(f.GeoJSON)); } catch (e) { return null; }
    }).filter(Boolean);
    if (!zentren.length) { valEl.textContent = 'keine Fläche'; return; }
    const lat = zentren.reduce((sum, p) => sum + p.lat, 0) / zentren.length;
    const lng = zentren.reduce((sum, p) => sum + p.lng, 0) / zentren.length;

    // "Jetzt" kommt aus dem Standard-Blendmodell (best_match) - für einen Momentanwert
    // ergibt eine Mittelung über mehrere Vorhersagemodelle keinen Sinn, nur für die
    // Tage-Vorhersage weiter unten.
    const aktuellUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}&current=temperature_2m,precipitation,weather_code&timezone=auto`;
    const aktuellRes = await fetch(aktuellUrl);
    const aktuellData = aktuellRes.ok ? await aktuellRes.json() : null;

    // 7-Tage-Vorhersage (heute + 6 Tage) aus mehreren unabhängigen Wettermodellen
    // gemittelt (deutsches ICON, europäisches ECMWF, amerikanisches GFS) - näherungsweise
    // das, was mit mehreren "verlässlichen Quellen" gemeint ist, ohne dass dafür separate
    // kostenpflichtige/Key-basierte Wetterdienste nötig wären. Der Wettercode (für die
    // Icons) wird nicht gemittelt - dafür wird nur das erste Modell herangezogen, da
    // sich Wetterlagen-Kategorien nicht sinnvoll zahlenmäßig mitteln lassen.
    const MODELLE = ['icon_seamless', 'ecmwf_ifs025', 'gfs_seamless'];
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}&daily=precipitation_sum,precipitation_probability_max,sunshine_duration,temperature_2m_max,temperature_2m_min,et0_fao_evapotranspiration,weather_code&past_days=7&forecast_days=7&timezone=auto&models=${MODELLE.join(',')}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Wetterdienst nicht erreichbar');
    const data = await res.json();
    const tage = data.daily.time;

    const mittel = (feld) => tage.map((_, i) => {
      const werte = MODELLE.map(m => (data.daily[`${feld}_${m}`] || [])[i]).filter(v => v !== null && v !== undefined);
      return werte.length ? werte.reduce((sum, v) => sum + v, 0) / werte.length : null;
    });
    const niederschlag = mittel('precipitation_sum');
    const niederschlagWk = mittel('precipitation_probability_max');
    const sonnenstunden = mittel('sunshine_duration').map(s => s !== null ? s / 3600 : null); // Sekunden -> Stunden
    const tempMax = mittel('temperature_2m_max');
    const tempMin = mittel('temperature_2m_min');
    const verdunstung = mittel('et0_fao_evapotranspiration');

    const heuteStr = new Date().toISOString().slice(0, 10);
    let heuteIdx = tage.indexOf(heuteStr);
    if (heuteIdx < 0) heuteIdx = 7; // Fallback: past_days=7, "heute" ist normalerweise Index 7

    const niederschlag7 = niederschlag.slice(Math.max(0, heuteIdx - 7), heuteIdx).reduce((sum, v) => sum + (v || 0), 0);
    const verdunstung7 = verdunstung.slice(Math.max(0, heuteIdx - 7), heuteIdx).reduce((sum, v) => sum + (v || 0), 0);

    // Mähfenster: ab heute den ersten Zeitraum mit mind. 2 aufeinanderfolgenden trockenen Tagen (<1mm) suchen
    let maehfenster = null;
    for (let i = heuteIdx; i < tage.length - 1; i++) {
      if ((niederschlag[i] || 0) < 1 && (niederschlag[i + 1] || 0) < 1) {
        let ende = i + 1;
        while (ende + 1 < tage.length && (niederschlag[ende + 1] || 0) < 1) ende++;
        maehfenster = { von: tage[i], bis: tage[ende] };
        break;
      }
    }

    const wettercodeTage = data.daily[`weather_code_${MODELLE[0]}`] || [];
    const naechsten7 = [];
    for (let i = heuteIdx; i < Math.min(heuteIdx + 7, tage.length); i++) {
      naechsten7.push({ datum: tage[i], code: wettercodeTage[i], regenWk: niederschlagWk[i], regenMm: niederschlag[i], sonne: sonnenstunden[i], tempMax: tempMax[i], tempMin: tempMin[i] });
    }

    const jetztCode = aktuellData && aktuellData.current ? aktuellData.current.weather_code : null;
    if (iconEl && jetztCode !== null && jetztCode !== undefined) iconEl.textContent = weatherIcon(jetztCode);
    valEl.textContent = (aktuellData && aktuellData.current) ? `${aktuellData.current.temperature_2m.toFixed(0)}°C` : '–';
    subEl.textContent = maehfenster
      ? `Mähfenster: ${fmtDate(maehfenster.von)}–${fmtDate(maehfenster.bis)}`
      : `${niederschlag7.toFixed(0)} mm Regen (7 Tage)`;

    // Kompakter Tagesstreifen mit Icons (wie in einer normalen Wetter-App) - die genauen
    // Werte (Sonnenstunden, Verdunstung, Regenmenge) gibt es erst in der aufgeklappten Kachel.
    const tagStreifen = naechsten7.map((t, i) => `
      <div class="dash-day">
        <div>${i === 0 ? 'Heute' : new Date(t.datum).toLocaleDateString('de-DE', { weekday: 'short' })}</div>
        <div class="dash-day-icon">${t.code !== undefined ? weatherIcon(t.code) : '🌡️'}</div>
        <div class="dash-day-temp">${t.tempMax !== null ? Math.round(t.tempMax) + '°' : '-'}</div>
        <div>${t.regenWk !== null ? Math.round(t.regenWk) + '%' : ''}</div>
      </div>`).join('');

    detEl.innerHTML = `
      <div class="dash-day-strip">${tagStreifen}</div>
      <div class="grid grid-cols-2 gap-3 mt-3 text-sm">
        <div><span class="text-gray-400 text-xs">Niederschlag letzte 7 Tage</span><br><b>${niederschlag7.toFixed(1)} mm</b></div>
        <div><span class="text-gray-400 text-xs">Verdunstung letzte 7 Tage</span><br><b>${verdunstung7.toFixed(1)} mm</b></div>
      </div>
      ${maehfenster
        ? `<div class="mt-2 text-green-700 text-sm">🌤️ Gutes Mähfenster: ${fmtDate(maehfenster.von)} – ${fmtDate(maehfenster.bis)} (trocken)</div>`
        : `<div class="mt-2 text-gray-500 text-sm">Kein trockenes Mähfenster in den nächsten Tagen erkennbar.</div>`}
      <div class="text-xs text-gray-400 mt-2">7-Tage-Vorhersage gemittelt aus mehreren Wettermodellen (ICON, ECMWF, GFS).</div>
    `;
  } catch (e) {
    valEl.textContent = 'nicht verfügbar';
    if (detEl) detEl.innerHTML = '<p class="text-gray-400 text-sm py-2">Wetterdaten konnten nicht geladen werden.</p>';
  }
}

// ============================================================================
// FLÄCHEN & FRUCHTFOLGE (Leaflet + Kataster-WMS)
// ============================================================================
function initMapIfNeeded() {
  if (state.map) return;
  state.map = L.map('map').setView(CONFIG.MAP_CENTER, CONFIG.MAP_ZOOM);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap-Mitwirkende'
  }).addTo(state.map);

  state.katasterWmsLayer = L.tileLayer.wms(CONFIG.GEOSERVER_WMS_URL, {
    layers: CONFIG.GEOSERVER_LAYER_VISUAL,
    format: 'image/png',
    transparent: true,
    version: '1.3.0',
    attribution: 'Kataster: Autonome Provinz Bozen'
  });

  state.flaechenLayerGroup = new L.FeatureGroup().addTo(state.map);
  state.drawnItems = new L.FeatureGroup().addTo(state.map);
  state.sammelLayerGroup = new L.FeatureGroup().addTo(state.map);
  renderFlaechenLegende();

  // Schnellerfassung direkt aus dem Karten-Popup (Schnitt/Düngung), ohne Umweg über
  // das Feldbuch-Panel - Popup-Inhalte werden von Leaflet als rohes HTML eingefügt,
  // daher hier per Delegation nach dem Öffnen verdrahten statt vorab addEventListener.
  state.map.on('popupopen', (e) => {
    const el = e.popup.getElement();
    if (!el) return;
    el.querySelectorAll('[data-popup-action]').forEach(btn => {
      btn.onclick = () => {
        const flaeche = state.flaechen.find(f => f.ID === btn.dataset.flaecheId);
        if (!flaeche) return;
        state.aktiveFlaecheFuerFeldbuch = flaeche;
        state.map.closePopup();
        if (btn.dataset.popupAction === 'schnitt') openSchnittModal(flaeche);
        else if (btn.dataset.popupAction === 'duengung') openDuengungModal(flaeche);
        else if (btn.dataset.popupAction === 'arbeitsschritt') openArbeitsschrittModal(flaeche);
        else if (btn.dataset.popupAction === 'rebanlage-detail') openRebanlageDetail({ ID: flaeche.ID, Name: flaeche.Name });
        else if (btn.dataset.popupAction === 'ernte-acker') {
          const jahr = new Date().getFullYear();
          const bestehend = (state.fruchtfolge || []).find(ff => ff.FlaecheID === flaeche.ID && Number(ff.Jahr) === jahr);
          openFruchtfolgeModal(flaeche, bestehend || {});
        }
      };
    });
  });

  state.drawControl = new L.Control.Draw({
    draw: { polygon: true, marker: false, circle: false, circlemarker: false, polyline: false, rectangle: true },
    edit: { featureGroup: state.drawnItems }
  });

  state.map.on(L.Draw.Event.CREATED, (e) => {
    if (e.layerType === 'polyline') {
      verarbeiteTeilungslinie(e.layer);
      return;
    }
    state.drawnItems.clearLayers();
    state.drawnItems.addLayer(e.layer);
    const geojson = e.layer.toGeoJSON();
    state.aktuelleZeichnungGeoJSON = geojson;
    const haFromGeoJSON = computeAreaHaFromGeoJSON(geojson);

    if (state.drawModus === 'subflaeche') {
      openSubFlaecheModal({ FlaecheM2: (haFromGeoJSON * 10000).toFixed(0) }, state.drawModusFlaecheId);
    } else if (state.sammelModus) {
      const n = state.gesammelteTeile.filter(t => t.art === 'gezeichnet').length + 1;
      addTeilZurSammlung({ geometry: geojson.geometry, ha: haFromGeoJSON, label: `Handgezeichnetes Teilstück #${n}`, art: 'gezeichnet' });
      state.drawnItems.clearLayers();
    } else {
      openFlaecheModal({ FlaecheHa: haFromGeoJSON.toFixed(2) });
    }
  });

  document.getElementById('toggleKatasterLayer').addEventListener('change', (e) => {
    if (e.target.checked) state.katasterWmsLayer.addTo(state.map);
    else state.map.removeLayer(state.katasterWmsLayer);
  });

  document.getElementById('btnZeichnen').addEventListener('click', () => {
    state.drawModus = 'flaeche';
    state.drawModusFlaecheId = null;
    state.map.addControl(state.drawControl);
    new L.Draw.Polygon(state.map, state.drawControl.options.draw.polygon).enable();
    toast('Zeichne die Fläche als Polygon auf der Karte. Doppelklick zum Abschließen.');
  });

  document.getElementById('btnGpsStandort').addEventListener('click', toggleGpsTracking);

  document.getElementById('btnWerkzeugeToggle').addEventListener('click', () => {
    document.getElementById('flaechenWerkzeuge').classList.toggle('hidden');
  });

  document.getElementById('btnSammelModus').addEventListener('click', () => startSammelModus(null));
  document.getElementById('btnSammelFertig').addEventListener('click', finalisiereSammlung);
  document.getElementById('btnSammelAbbrechen').addEventListener('click', beendeSammelModus);

  document.getElementById('btnKatasterAbfragen').addEventListener('click', () => {
    state.katasterAbfrageAktiv = !state.katasterAbfrageAktiv;
    const btn = document.getElementById('btnKatasterAbfragen');
    btn.classList.toggle('bg-blue-800', state.katasterAbfrageAktiv);
    toast(state.katasterAbfrageAktiv
      ? 'Aktiv: Klicke auf eine Parzelle in der Karte, um Katasterdaten zu laden.'
      : 'Kataster-Abfrage deaktiviert.');
  });

  state.map.on('click', onMapClickKatasterAbfrage);
}

// --- Web-Mercator (EPSG:3857) <-> WGS84 (EPSG:4326) Konvertierung ---
const R_MAJOR = 20037508.34;

function lngLatToMercator([lng, lat]) {
  const x = lng * R_MAJOR / 180;
  let y = Math.log(Math.tan((90 + lat) * Math.PI / 360)) / (Math.PI / 180);
  y = y * R_MAJOR / 180;
  return [x, y];
}

function mercatorToLngLat([x, y]) {
  const lng = x / R_MAJOR * 180;
  let lat = 180 / Math.PI * (2 * Math.atan(Math.exp((y / R_MAJOR * 180) * Math.PI / 180)) - Math.PI / 2);
  return [lng, lat];
}

function convertGeometryCoords(geometry, fn) {
  const map = (coords) => {
    if (typeof coords[0] === 'number') return fn(coords);
    return coords.map(map);
  };
  return { ...geometry, coordinates: map(geometry.coordinates) };
}

// WICHTIG: Für Flächenberechnung NICHT die Web-Mercator-Koordinaten (lngLatToMercator)
// verwenden! Web-Mercator ist längentreu, aber NICHT flächentreu - die Flächen-
// verzerrung wächst mit 1/cos²(Breitengrad). Bei Südtirols Breite (~46°N) ergibt
// das ungefähr die DOPPELTE Fläche der echten Bodenfläche. Stattdessen wird hier
// lokal um den mittleren Breitengrad des jeweiligen Rings in eine gleichabständige
// (äquidistante) Ebene projiziert - das liefert für Feldgrößen (Meter bis wenige
// Kilometer) eine sehr genaue echte Bodenfläche.
const R_ERDE = 6378137; // WGS84-Äquatorradius in Metern

function ringZuLokalerEbene(ring) {
  const mittlereBreiteRad = ring.reduce((s, p) => s + p[1], 0) / ring.length * Math.PI / 180;
  const cosBreite = Math.cos(mittlereBreiteRad);
  return ring.map(([lng, lat]) => [
    lng * Math.PI / 180 * R_ERDE * cosBreite,
    lat * Math.PI / 180 * R_ERDE
  ]);
}

function ringFlaecheM2(ring) {
  if (!ring || ring.length < 3) return 0;
  const pts = ringZuLokalerEbene(ring);
  let area = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    area += pts[i][0] * pts[i + 1][1] - pts[i + 1][0] * pts[i][1];
  }
  return Math.abs(area / 2);
}

// Flächenberechnung (Shoelace auf lokal korrigierter Ebene, s.o.).
// Bei MultiPolygon (mehrteilige Flächen) werden die Flächen aller Teile summiert.
function computeAreaHaFromGeoJSON(geojson) {
  const geom = geojson.geometry || geojson;
  const aussenringe = geom.type === 'Polygon' ? [geom.coordinates[0]]
    : geom.type === 'MultiPolygon' ? geom.coordinates.map(poly => poly[0])
    : [];
  const totalArea = aussenringe.reduce((sum, ring) => sum + ringFlaecheM2(ring), 0);
  return totalArea / 10000; // m² -> ha
}

// Korrigiert alte, mit der früheren (fehlerhaften) Web-Mercator-Formel gespeicherte
// Flächenwerte handgezeichneter Flächen, ohne dass die Geometrie neu gezeichnet werden muss.
async function neuberechneFlaecheHa(flaeche) {
  if (!flaeche || !flaeche.GeoJSON) return;
  const geom = JSON.parse(flaeche.GeoJSON);
  const neuHa = computeAreaHaFromGeoJSON(geom);
  const altHa = Number(flaeche.FlaecheHa) || 0;
  if (Math.abs(neuHa - altHa) < 0.001) {
    toast('Fläche ist bereits korrekt berechnet.');
    return;
  }
  if (!confirm(`Bisheriger Wert: ${altHa.toFixed(2)} ha\nNeu berechnet: ${neuHa.toFixed(2)} ha\n\nGespeicherten Wert aktualisieren?`)) return;
  const saved = await safeCall('flaechen.update', { id: flaeche.ID, FlaecheHa: neuHa.toFixed(2) }, 'Fläche neu berechnet.');
  cacheUpsert('flaechen.list', saved);
  await loadFlaechenSection();
}

async function onMapClickKatasterAbfrage(e) {
  if (!state.katasterAbfrageAktiv) return;
  const map = state.map;
  const size = map.getSize();
  const bounds = map.getBounds();
  const sw = lngLatToMercator([bounds.getWest(), bounds.getSouth()]);
  const ne = lngLatToMercator([bounds.getEast(), bounds.getNorth()]);
  const point = map.latLngToContainerPoint(e.latlng);

  const params = new URLSearchParams({
    SERVICE: 'WMS', VERSION: '1.3.0', REQUEST: 'GetFeatureInfo',
    LAYERS: CONFIG.GEOSERVER_LAYER_INFO, QUERY_LAYERS: CONFIG.GEOSERVER_LAYER_INFO,
    INFO_FORMAT: 'application/json', CRS: 'EPSG:3857',
    BBOX: `${sw[0]},${sw[1]},${ne[0]},${ne[1]}`,
    WIDTH: Math.round(size.x), HEIGHT: Math.round(size.y),
    I: Math.round(point.x), J: Math.round(point.y),
    FEATURE_COUNT: 1
  });

  try {
    const res = await fetch(`${CONFIG.GEOSERVER_WMS_URL}?${params.toString()}`);
    const data = await res.json();
    if (!data.features || !data.features.length) {
      toast('An dieser Stelle wurde keine Parzelle gefunden.', true);
      return;
    }
    const feature = data.features[0];
    const geometry4326 = convertGeometryCoords(feature.geometry, mercatorToLngLat);
    const props = feature.properties || {};
    const haGeschaetzt = computeAreaHaFromGeoJSON({ geometry: geometry4326 });
    const ha = Number(props.PART_AREA_TOTALE) ? (Number(props.PART_AREA_TOTALE) / 10000) : haGeschaetzt;

    if (state.sammelModus) {
      const label = `Parzelle ${props.PART_NUMERATORE || '?'} (${props.PART_CCAT_NOME_DE || 'Kataster'})`;
      addTeilZurSammlung({ geometry: geometry4326, ha, label, art: 'kataster' });
      return;
    }

    state.flaechenLayerGroup.clearLayers();
    L.geoJSON(geometry4326, { style: { color: '#2563eb', weight: 3 } }).addTo(state.flaechenLayerGroup);
    state.aktuelleZeichnungGeoJSON = { type: 'Feature', geometry: geometry4326, properties: {} };

    openFlaecheModal({
      Parzellennummer: props.PART_NUMERATORE || '',
      KatastralGemeinde: props.PART_CCAT_NOME_DE || '',
      FlaecheHa: ha.toFixed(2)
    });
  } catch (err) {
    toast('Katasterabfrage fehlgeschlagen. Ist der Geodienst erreichbar (CORS)?', true);
  }
}

const NUTZUNGSARTEN = ['Wald', 'Dauerwiese', 'Wechselwiese', 'Weinbau', 'Obstbau', 'Ackerland', 'Almweide'];
const WECHSEL_NUTZUNGSARTEN = ['Wechselwiese', 'Ackerland'];
const DAUERKULTUR_NUTZUNGSARTEN = ['Weinbau', 'Obstbau', 'Obst-Weinbau'];
const NUTZUNGSART_FARBEN = {
  'Wald': '#166534',
  'Dauerwiese': '#65a30d',
  'Wechselwiese': '#eab308',
  'Weinbau': '#7e22ce',
  'Obstbau': '#db2777',
  'Obst-Weinbau': '#c026d3', // Altdaten-Kompatibilität
  'Ackerland': '#92400e',
  'Almweide': '#0d9488'
};
const NUTZUNGSART_ICONS = {
  'Wald': '🌲',
  'Dauerwiese': '🌾',
  'Wechselwiese': '🌱',
  'Weinbau': '🍇',
  'Obstbau': '🍎',
  'Obst-Weinbau': '🍇',
  'Ackerland': '🌱',
  'Almweide': '⛰️'
};
const NUTZUNGSART_FARBE_STANDARD = '#2563eb';

function renderFlaechenLegende() {
  document.getElementById('flaechenLegende').innerHTML = NUTZUNGSARTEN.map(n => `
    <span class="flex items-center gap-1">
      <span class="inline-block w-3 h-3 rounded-sm" style="background:${NUTZUNGSART_FARBEN[n] || NUTZUNGSART_FARBE_STANDARD}"></span>
      ${NUTZUNGSART_ICONS[n] || ''} ${n}
    </span>`).join('');
}

// Ermittelt Farbe/Symbol/Label einer Fläche: bei Dauerkulturen direkt aus der
// Nutzungsart, bei Wechselwiese/Ackerland aus der für das laufende Jahr in der
// Fruchtfolge zugewiesenen Kultur (Kulturen-Stammdaten liefern Farbe/Symbol).
function getKulturDarstellung(flaeche) {
  if (WECHSEL_NUTZUNGSARTEN.includes(flaeche.Nutzungsart)) {
    const jahr = new Date().getFullYear();
    const zuweisung = state.fruchtfolge.find(f => f.FlaecheID === flaeche.ID && Number(f.Jahr) === jahr);
    if (zuweisung) {
      const kulturInfo = state.kulturen.find(k => k.Kultur === zuweisung.Kultur);
      if (kulturInfo && kulturInfo.KartenFarbe) {
        return { farbe: kulturInfo.KartenFarbe, icon: kulturInfo.KartenSymbol || '🌱', label: zuweisung.Kultur };
      }
      return { farbe: NUTZUNGSART_FARBEN[flaeche.Nutzungsart] || NUTZUNGSART_FARBE_STANDARD, icon: '🌱', label: zuweisung.Kultur };
    }
  }
  return {
    farbe: NUTZUNGSART_FARBEN[flaeche.Nutzungsart] || NUTZUNGSART_FARBE_STANDARD,
    icon: NUTZUNGSART_ICONS[flaeche.Nutzungsart] || '📍',
    label: flaeche.Nutzungsart
  };
}

// Flächenschwerpunkt (Fläche-gewichteter Polygon-Zentroid) - für die Platzierung
// des Kultur-Symbols auf der Karte. Nutzt dieselbe lokal breitengrad-korrigierte
// Ebene wie computeAreaHaFromGeoJSON (s.o.), damit mehrere Teile eines
// MultiPolygon konsistent zueinander gewichtet werden.
function computeCentroid(geojson) {
  const geom = geojson.geometry || geojson;
  const aussenringe = (geom.type === 'Polygon' ? [geom.coordinates[0]]
    : geom.type === 'MultiPolygon' ? geom.coordinates.map(poly => poly[0])
    : []).filter(ring => ring && ring.length >= 3);
  if (!aussenringe.length) return null;

  const allePunkte = aussenringe.flat();
  const mittlereBreiteRad = allePunkte.reduce((s, p) => s + p[1], 0) / allePunkte.length * Math.PI / 180;
  const cosBreite = Math.cos(mittlereBreiteRad);
  const projiziere = ([lng, lat]) => [lng * Math.PI / 180 * R_ERDE * cosBreite, lat * Math.PI / 180 * R_ERDE];

  let totalArea = 0, totalCx = 0, totalCy = 0;
  aussenringe.forEach(ring => {
    const pts = ring.map(projiziere);
    let a = 0, cx = 0, cy = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const cross = pts[i][0] * pts[i + 1][1] - pts[i + 1][0] * pts[i][1];
      a += cross;
      cx += (pts[i][0] + pts[i + 1][0]) * cross;
      cy += (pts[i][1] + pts[i + 1][1]) * cross;
    }
    a = a / 2;
    if (a === 0) return;
    const flaeche = Math.abs(a);
    totalCx += (cx / (6 * a)) * flaeche;
    totalCy += (cy / (6 * a)) * flaeche;
    totalArea += flaeche;
  });
  if (totalArea === 0) return null;
  const lng = (totalCx / totalArea) / (Math.PI / 180 * R_ERDE * cosBreite);
  const lat = (totalCy / totalArea) / (Math.PI / 180 * R_ERDE);
  return L.latLng(lat, lng);
}

function flaechePopupHtml(f) {
  const { icon, label } = getKulturDarstellung(f);
  let html = `<b>${f.Name}</b><br>${icon} ${label} · ${Number(f.FlaecheHa).toFixed(2)} ha`;
  if (f.Nutzungsart === 'Dauerwiese') {
    const jahr = new Date().getFullYear();
    const schnitteJahr = (state.schnitte || [])
      .filter(s => s.FlaecheID === f.ID && new Date(s.Datum).getFullYear() === jahr)
      .sort((a, b) => Number(a.SchnittNummer) - Number(b.SchnittNummer));
    html += `<br><br>✂️ <b>${schnitteJahr.length}/3 Schnitte ${jahr}</b>`;
    if (schnitteJahr.length) {
      html += '<br>' + schnitteJahr.map(s => `${s.SchnittNummer}. Schnitt: ${new Date(s.Datum).toLocaleDateString('de-DE')}${s.ErtragsMenge ? ` (${s.ErtragsMenge} ${s.ErtragsEinheit || ''})` : ''}`).join('<br>');
    }
  }
  // Schnellerfassung direkt aus dem Popup - je Nutzungsart die jeweils passenden Aktionen
  const aktionen = [];
  if (f.Nutzungsart === 'Dauerwiese' || f.Nutzungsart === 'Wechselwiese') {
    aktionen.push(`<button data-popup-action="schnitt" data-flaeche-id="${f.ID}" class="text-xs bg-green-600 text-white px-2 py-1 rounded">✂️ Schnitt erfassen</button>`);
    aktionen.push(`<button data-popup-action="duengung" data-flaeche-id="${f.ID}" class="text-xs bg-amber-600 text-white px-2 py-1 rounded">💩 Düngung erfassen</button>`);
  }
  if (f.Nutzungsart === 'Ackerland') {
    aktionen.push(`<button data-popup-action="ernte-acker" data-flaeche-id="${f.ID}" class="text-xs bg-orange-600 text-white px-2 py-1 rounded">🌾 Bearbeitung/Ernte erfassen</button>`);
  }
  if (DAUERKULTUR_NUTZUNGSARTEN.includes(f.Nutzungsart)) {
    aktionen.push(`<button data-popup-action="rebanlage-detail" data-flaeche-id="${f.ID}" class="text-xs bg-purple-600 text-white px-2 py-1 rounded">🍇 Pflege/Reife/Ernte</button>`);
  }
  if (hatArbeitsablauf(f)) {
    aktionen.push(`<button data-popup-action="arbeitsschritt" data-flaeche-id="${f.ID}" class="text-xs bg-teal-600 text-white px-2 py-1 rounded">✅ Schritt erledigt</button>`);
  }
  if (aktionen.length) html += `<div class="mt-2 pt-2 border-t flex gap-2 flex-wrap">${aktionen.join('')}</div>`;
  return html;
}

function renderFlaechenOnMap() {
  state.flaechenLayerGroup.clearLayers();
  state.flaechenLayerById = {};
  state.flaechen.forEach(f => {
    if (!f.GeoJSON) return;
    try {
      const geo = JSON.parse(f.GeoJSON);
      const { farbe, icon, label } = getKulturDarstellung(f);
      const layer = L.geoJSON(geo, { style: { color: farbe, weight: 2, fillColor: farbe, fillOpacity: 0.4 } })
        .bindPopup(() => flaechePopupHtml(f));
      layer.on('click', () => zoomZuFlaeche(f));
      layer.addTo(state.flaechenLayerGroup);
      state.flaechenLayerById[f.ID] = layer;

      const mitte = computeCentroid(geo);
      if (mitte) {
        L.marker(mitte, {
          icon: L.divIcon({ className: '', html: `<div style="font-size:22px;line-height:1;text-shadow:0 0 3px white,0 0 3px white">${icon}</div>`, iconSize: [24, 24], iconAnchor: [12, 12] }),
          interactive: false
        }).addTo(state.flaechenLayerGroup);
      }
    } catch (e) { /* ungültiges GeoJSON ignorieren */ }
  });

  if (state.flaechenLayerGroup.getLayers().length > 0) {
    state.map.fitBounds(state.flaechenLayerGroup.getBounds(), { padding: [30, 30], maxZoom: 16 });
  }
}

function highlightLayer(layer) {
  const el = layer.getElement && layer.getElement();
  if (!el) return;
  el.classList.remove('flaeche-highlight');
  void el.offsetWidth; // Reflow erzwingen, damit die Animation bei erneutem Klick neu startet
  el.classList.add('flaeche-highlight');
}

function zoomZuFlaeche(f) {
  if (!f.GeoJSON) { toast('Für diese Fläche ist noch keine Geometrie hinterlegt.', true); return; }
  try {
    const geo = JSON.parse(f.GeoJSON);
    const tempLayer = L.geoJSON(geo);
    state.map.fitBounds(tempLayer.getBounds(), { padding: [50, 50], maxZoom: 18 });
    const echteLayer = state.flaechenLayerById[f.ID];
    if (echteLayer) setTimeout(() => highlightLayer(echteLayer), 300);
  } catch (e) { /* ungültiges GeoJSON ignorieren */ }
}

// ============================================================================
// MEHRTEILIGE FLÄCHEN: mehrere Kataster-Parzellen und/oder frei gezeichnete
// Teilstücke zu einer einzigen Fläche zusammenfassen (z.B. wenn eine Wiese aus
// mehreren Katasterparzellen besteht, oder nur ein Teil einer Parzelle anders
// genutzt wird). Auch zum nachträglichen Erweitern bestehender Flächen nutzbar.
// ============================================================================
function combineGeometrienZuMultiPolygon(teile) {
  const polygons = [];
  teile.forEach(t => {
    const g = t.geometry;
    if (g.type === 'Polygon') polygons.push(g.coordinates);
    else if (g.type === 'MultiPolygon') polygons.push(...g.coordinates);
  });
  return { type: 'MultiPolygon', coordinates: polygons };
}

function startSammelModus(existingFlaeche) {
  state.sammelModus = true;
  state.sammelZielFlaeche = existingFlaeche || null;
  state.gesammelteTeile = [];

  if (existingFlaeche && existingFlaeche.GeoJSON) {
    try {
      const geo = JSON.parse(existingFlaeche.GeoJSON);
      state.gesammelteTeile.push({
        geometry: geo, ha: Number(existingFlaeche.FlaecheHa || 0),
        label: `${existingFlaeche.Name} (bisherige Fläche)`, art: 'bestehend'
      });
    } catch (e) { /* ungültiges GeoJSON ignorieren */ }
  }

  document.getElementById('sammelZielName').textContent = existingFlaeche ? existingFlaeche.Name : 'neue Fläche';
  document.getElementById('sammelPanel').classList.remove('hidden');
  renderSammelVorschau();
}

function addTeilZurSammlung(teil) {
  state.gesammelteTeile.push(teil);
  renderSammelVorschau();
}

function entferneTeilAusSammlung(idx) {
  state.gesammelteTeile.splice(idx, 1);
  renderSammelVorschau();
}

function renderSammelVorschau() {
  state.sammelLayerGroup.clearLayers();
  state.gesammelteTeile.forEach(t => {
    L.geoJSON(t.geometry, { style: { color: '#9333ea', weight: 2, fillColor: '#9333ea', fillOpacity: 0.3, dashArray: '6 4' } })
      .addTo(state.sammelLayerGroup);
  });
  if (state.sammelLayerGroup.getLayers().length > 0) {
    state.map.fitBounds(state.sammelLayerGroup.getBounds(), { padding: [30, 30], maxZoom: 17 });
  }

  const summe = state.gesammelteTeile.reduce((s, t) => s + Number(t.ha || 0), 0);
  document.getElementById('sammelListe').innerHTML = state.gesammelteTeile.length
    ? state.gesammelteTeile.map((t, i) => `
        <div class="flex items-center justify-between bg-white rounded px-3 py-2 border border-purple-200">
          <span>${t.label} — ${Number(t.ha).toFixed(2)} ha</span>
          <button data-idx="${i}" class="btn-teil-entfernen text-red-600 hover:underline text-xs">✕ entfernen</button>
        </div>`).join('')
    : '<p class="text-purple-700 text-sm">Noch keine Teile gesammelt.</p>';
  document.getElementById('sammelListe').querySelectorAll('.btn-teil-entfernen').forEach(b => {
    b.onclick = () => entferneTeilAusSammlung(Number(b.dataset.idx));
  });
  document.getElementById('sammelSumme').textContent = `Summe: ${summe.toFixed(2)} ha aus ${state.gesammelteTeile.length} Teil(en)`;
}

function beendeSammelModus() {
  state.sammelModus = false;
  state.sammelZielFlaeche = null;
  state.gesammelteTeile = [];
  state.sammelLayerGroup.clearLayers();
  document.getElementById('sammelPanel').classList.add('hidden');
}

function finalisiereSammlung() {
  if (state.gesammelteTeile.length === 0) { toast('Bitte zuerst mindestens ein Teilstück sammeln.', true); return; }
  const geometrie = combineGeometrienZuMultiPolygon(state.gesammelteTeile);
  const summeHa = state.gesammelteTeile.reduce((s, t) => s + Number(t.ha || 0), 0);
  const ziel = state.sammelZielFlaeche;

  state.aktuelleZeichnungGeoJSON = { type: 'Feature', geometry: geometrie, properties: {} };
  openFlaecheModal({ ...(ziel || {}), FlaecheHa: summeHa.toFixed(2) });
  beendeSammelModus();
}

// ============================================================================
// PARZELLE TEILEN: eine Fläche entlang einer gezeichneten Linie präzise in
// zwei Teile schneiden (statt ungenau von Hand zwei neue Polygone zu zeichnen -
// so ist die Summe der beiden Teile immer exakt gleich der Ausgangsfläche).
// Nutzt Turf.js: die Linie wird hauchdünn "aufgeblasen" (Puffer) und von der
// Fläche abgezogen - das saubere Trennstück, das dabei entsteht, ist so schmal
// (5 cm), dass der Flächenverlust vernachlässigbar ist.
// ============================================================================
function starteParzellenTeilung(flaeche) {
  if (!flaeche.GeoJSON) { toast('Diese Fläche hat keine Geometrie hinterlegt.', true); return; }
  state.teilenZielFlaeche = flaeche;
  zoomZuFlaeche(flaeche);
  toast('Zeichne eine Linie, die die Fläche komplett durchtrennt (über beide Ränder hinaus). Doppelklick zum Abschließen.');
  new L.Draw.Polyline(state.map, { shapeOptions: { color: '#ea580c', weight: 3, dashArray: '4 4' } }).enable();
}

function berechneParzellenTeilung(flaeche, latlngs) {
  try {
    const linie = turf.lineString(latlngs.map(ll => [ll.lng, ll.lat]));
    const geom = JSON.parse(flaeche.GeoJSON);
    const flaechenFeature = turf.feature(geom);
    const puffer = turf.buffer(linie, 0.05, { units: 'meters' });
    const ergebnis = turf.difference(flaechenFeature, puffer);
    if (!ergebnis || ergebnis.geometry.type !== 'MultiPolygon' || ergebnis.geometry.coordinates.length < 2) {
      return null;
    }
    return ergebnis.geometry.coordinates
      .map(coords => ({ type: 'Polygon', coordinates: coords }))
      .map(geometry => ({ geometry, ha: computeAreaHaFromGeoJSON(geometry) }))
      .sort((a, b) => b.ha - a.ha)
      .slice(0, 2);
  } catch (e) {
    console.error('Teilung fehlgeschlagen', e);
    return null;
  }
}

function verarbeiteTeilungslinie(layer) {
  const flaeche = state.teilenZielFlaeche;
  state.teilenZielFlaeche = null;
  state.map.removeLayer(layer);
  if (!flaeche) return;

  const teile = berechneParzellenTeilung(flaeche, layer.getLatLngs());
  if (!teile) {
    toast('Die Linie hat die Fläche nicht vollständig durchtrennt - bitte über beide Ränder der Fläche hinaus zeichnen und erneut versuchen.', true);
    return;
  }
  openTeilungsModal(flaeche, teile);
}

function openTeilungsModal(flaeche, teile) {
  formModalTitle.textContent = `Fläche teilen: ${flaeche.Name}`;
  formModalBody.innerHTML = `
    <p class="text-sm text-gray-500">Gesamtfläche bisher: ${Number(flaeche.FlaecheHa).toFixed(2)} ha. Neue Aufteilung: ${teile[0].ha.toFixed(2)} + ${teile[1].ha.toFixed(2)} = ${(teile[0].ha + teile[1].ha).toFixed(2)} ha.</p>
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <div class="space-y-2 border rounded-lg p-3">
        <div class="font-semibold text-sm">Teil 1 — ${teile[0].ha.toFixed(2)} ha</div>
        ${fieldHtml({ key: 'teil1_Name', label: 'Name', required: true }, flaeche.Name)}
        ${fieldHtml({ key: 'teil1_Nutzungsart', label: 'Nutzungsart', type: 'select', options: NUTZUNGSARTEN }, flaeche.Nutzungsart)}
      </div>
      <div class="space-y-2 border rounded-lg p-3">
        <div class="font-semibold text-sm">Teil 2 — ${teile[1].ha.toFixed(2)} ha</div>
        ${fieldHtml({ key: 'teil2_Name', label: 'Name', required: true }, flaeche.Name + ' (Teil 2)')}
        ${fieldHtml({ key: 'teil2_Nutzungsart', label: 'Nutzungsart', type: 'select', options: NUTZUNGSARTEN }, flaeche.Nutzungsart)}
      </div>
    </div>`;
  _currentModalOnSubmit = async (values) => {
    const saved1 = await safeCall('flaechen.update', {
      id: flaeche.ID, Name: values.teil1_Name, Nutzungsart: values.teil1_Nutzungsart,
      FlaecheHa: teile[0].ha.toFixed(2), GeoJSON: JSON.stringify(teile[0].geometry)
    }, 'Teil 1 gespeichert.');
    cacheUpsert('flaechen.list', saved1);

    const saved2 = await safeCall('flaechen.create', {
      Name: values.teil2_Name, Nutzungsart: values.teil2_Nutzungsart,
      Besitzart: flaeche.Besitzart, KatastralGemeinde: flaeche.KatastralGemeinde, Parzellennummer: flaeche.Parzellennummer,
      FlaecheHa: teile[1].ha.toFixed(2), GeoJSON: JSON.stringify(teile[1].geometry)
    }, 'Teil 2 angelegt.');
    cacheUpsert('flaechen.list', saved2);

    await loadFlaechenSection();
  };
  formModal.showModal();
}

// ============================================================================
// GPS-LIVE-STANDORT (Browser Geolocation API)
// ============================================================================
function toggleGpsTracking() {
  const btn = document.getElementById('btnGpsStandort');
  if (state.gpsWatchId !== null) {
    navigator.geolocation.clearWatch(state.gpsWatchId);
    state.gpsWatchId = null;
    if (state.gpsMarker) { state.map.removeLayer(state.gpsMarker); state.gpsMarker = null; }
    if (state.gpsCircle) { state.map.removeLayer(state.gpsCircle); state.gpsCircle = null; }
    btn.classList.remove('bg-sky-800');
    toast('Standort-Anzeige beendet.');
    return;
  }
  if (!navigator.geolocation) { toast('Geolocation wird von diesem Browser nicht unterstützt.', true); return; }

  btn.classList.add('bg-sky-800');
  state.gpsWatchId = navigator.geolocation.watchPosition((pos) => {
    const latlng = L.latLng(pos.coords.latitude, pos.coords.longitude);
    if (!state.gpsMarker) {
      state.gpsMarker = L.circleMarker(latlng, { radius: 8, color: '#0284c7', fillColor: '#0ea5e9', fillOpacity: 1, weight: 2 }).addTo(state.map);
      state.gpsCircle = L.circle(latlng, { radius: pos.coords.accuracy, color: '#0284c7', fillColor: '#0ea5e9', fillOpacity: 0.15, weight: 1 }).addTo(state.map);
      state.map.setView(latlng, Math.max(state.map.getZoom(), 17));
    } else {
      state.gpsMarker.setLatLng(latlng);
      state.gpsCircle.setLatLng(latlng).setRadius(pos.coords.accuracy);
    }
  }, (err) => {
    toast('Standort konnte nicht ermittelt werden: ' + err.message, true);
    toggleGpsTracking();
  }, { enableHighAccuracy: true, maximumAge: 5000 });

  toast('Standort-Anzeige aktiv.');
}

function openFlaecheModal(initial = {}) {
  let arbeitsablaufListe = [];
  try { arbeitsablaufListe = JSON.parse(initial.ArbeitsablaufJSON || '[]'); } catch (e) { arbeitsablaufListe = []; }
  openFormModal({
    title: initial.ID ? 'Fläche bearbeiten' : 'Neue Fläche',
    fields: [
      { key: 'Name', label: 'Name', required: true },
      { key: 'KatastralGemeinde', label: 'Katastralgemeinde' },
      { key: 'Parzellennummer', label: 'Parzellennummer' },
      { key: 'FlaecheHa', label: 'Fläche (ha)', type: 'number', step: '0.01', required: true },
      { key: 'Besitzart', label: 'Besitzart', type: 'select', options: ['Besitz', 'Pacht'] },
      { key: 'Nutzungsart', label: 'Nutzungsart', type: 'select', options: NUTZUNGSARTEN },
      { key: 'Rebsorte', label: 'Rebsorte/Sorte (nur bei Weinbau/Obstbau relevant)' },
      { key: 'AnzahlPflanzen', label: 'Anzahl Pflanzen (nur bei Weinbau/Obstbau relevant)', type: 'number' },
      { key: 'ArbeitsablaufText', label: 'Arbeitsschritte (kommagetrennt, in Reihenfolge)', help: 'z.B. Pflügen, Grubbern, Säen, Düngen, Ernten - oder 1. Schnitt, 2. Schnitt, 3. Schnitt. Ermöglicht die "Nächster Schritt"-Anzeige im Dashboard.' },
      { key: 'Notiz', label: 'Notiz', type: 'textarea' }
    ],
    initial: { ...initial, ArbeitsablaufText: arbeitsablaufListe.join(', ') },
    onSubmit: async (values) => {
      const payload = { ...values };
      delete payload.ArbeitsablaufText;
      payload.ArbeitsablaufJSON = JSON.stringify((values.ArbeitsablaufText || '').split(',').map(s => s.trim()).filter(Boolean));
      if (state.aktuelleZeichnungGeoJSON) {
        payload.GeoJSON = JSON.stringify(state.aktuelleZeichnungGeoJSON.geometry || state.aktuelleZeichnungGeoJSON);
      } else if (initial.GeoJSON) {
        payload.GeoJSON = initial.GeoJSON;
      }
      const saved = initial.ID
        ? await safeCall('flaechen.update', { id: initial.ID, ...payload }, 'Fläche aktualisiert.')
        : await safeCall('flaechen.create', payload, 'Fläche angelegt.');
      cacheUpsert('flaechen.list', saved);
      state.aktuelleZeichnungGeoJSON = null;
      state.drawnItems.clearLayers();
      await loadFlaechenSection();
    }
  });
}

async function loadFlaechenSection() {
  initMapIfNeeded();
  setTimeout(() => state.map.invalidateSize(), 100);

  const { flaechen, kulturen, fruchtfolge, schnitte } = await cachedBatch({
    flaechen: { action: 'flaechen.list' },
    kulturen: { action: 'kulturen.list' },
    fruchtfolge: { action: 'fruchtfolge.list' },
    schnitte: { action: 'schnitte.list' }
  });
  state.flaechen = flaechen.filter(f => f.Aktiv !== false);
  state.kulturen = kulturen;
  state.fruchtfolge = fruchtfolge;
  state.schnitte = schnitte;
  renderFlaechenOnMap();

  renderTable(document.getElementById('flaechenTable'),
    [
      { key: 'Name', label: 'Name' },
      { key: 'Nutzungsart', label: 'Nutzungsart' },
      { label: 'Fläche', format: r => `${Number(r.FlaecheHa).toFixed(2)} ha` },
      { key: 'Besitzart', label: 'Besitz/Pacht' },
      { key: 'Parzellennummer', label: 'Parzelle' }
    ],
    state.flaechen,
    {
      onEdit: (row) => openFlaecheModal(row),
      onDelete: async (row) => { await safeCall('flaechen.delete', { id: row.ID }, 'Fläche gelöscht.'); cacheRemove('flaechen.list', row.ID); await loadFlaechenSection(); },
      onRowClick: (row) => zoomZuFlaeche(row),
      extraButtons: (row) => `<button data-id="${row.ID}" class="btn-erweitern text-purple-700 hover:underline mr-2">🧩 Erweitern</button>` +
        (row.GeoJSON ? `<button data-id="${row.ID}" class="btn-teilen text-orange-700 hover:underline mr-2">✂️ Teilen</button>` : '') +
        (row.GeoJSON ? `<button data-id="${row.ID}" class="btn-neuberechnen text-teal-700 hover:underline mr-2" title="Fläche aus der gespeicherten Geometrie neu berechnen (behebt ggf. alte, zu hohe Werte)">🔄 ha neu berechnen</button>` : '') +
        `<button data-id="${row.ID}" class="btn-feldbuch text-gray-700 hover:underline mr-2">📋 Feldbuch</button>` +
        (WECHSEL_NUTZUNGSARTEN.includes(row.Nutzungsart)
          ? `<button data-id="${row.ID}" class="btn-fruchtfolge text-green-700 hover:underline mr-2">Fruchtfolge</button>` : '') +
        (DAUERKULTUR_NUTZUNGSARTEN.includes(row.Nutzungsart)
          ? `<button data-id="${row.ID}" class="btn-rebanlagen text-purple-700 hover:underline mr-2">🍇 Rebanlagen</button>` : '') +
        (hatArbeitsablauf(row) ? `<button data-id="${row.ID}" class="btn-arbeitsschritt text-teal-700 hover:underline mr-2">✅ Schritt erledigt</button>` : '')
    });

  document.querySelectorAll('.btn-arbeitsschritt').forEach(b => {
    b.onclick = () => openArbeitsschrittModal(state.flaechen.find(f => f.ID === b.dataset.id));
  });
  document.querySelectorAll('.btn-erweitern').forEach(b => {
    b.onclick = () => startSammelModus(state.flaechen.find(f => f.ID === b.dataset.id));
  });
  document.querySelectorAll('.btn-teilen').forEach(b => {
    b.onclick = () => starteParzellenTeilung(state.flaechen.find(f => f.ID === b.dataset.id));
  });
  document.querySelectorAll('.btn-neuberechnen').forEach(b => {
    b.onclick = () => neuberechneFlaecheHa(state.flaechen.find(f => f.ID === b.dataset.id));
  });
  document.querySelectorAll('.btn-fruchtfolge').forEach(b => {
    b.onclick = () => openFruchtfolgePanel(state.flaechen.find(f => f.ID === b.dataset.id));
  });
  document.querySelectorAll('.btn-rebanlagen').forEach(b => {
    b.onclick = () => openSubFlaechenPanel(state.flaechen.find(f => f.ID === b.dataset.id));
  });
  document.querySelectorAll('.btn-feldbuch').forEach(b => {
    b.onclick = () => openFeldbuchPanel(state.flaechen.find(f => f.ID === b.dataset.id));
  });

  document.getElementById('btnNeueFlaeche').onclick = () => { state.aktuelleZeichnungGeoJSON = null; openFlaecheModal(); };
}

async function openFruchtfolgePanel(flaeche) {
  state.aktiveFlaecheFuerFruchtfolge = flaeche;
  document.getElementById('fruchtfolgePanel').classList.remove('hidden');
  document.getElementById('fruchtfolgeFlaecheName').textContent = flaeche.Name;
  await reloadFruchtfolgeTable();

  document.getElementById('btnNeueFruchtfolge').onclick = () => openFruchtfolgeModal(flaeche);
}

async function reloadFruchtfolgeTable() {
  const all = await cachedList('fruchtfolge.list');
  state.fruchtfolge = all;
  renderFlaechenOnMap();
  const rows = all.filter(r => r.FlaecheID === state.aktiveFlaecheFuerFruchtfolge.ID)
    .sort((a, b) => Number(b.Jahr) - Number(a.Jahr));
  renderTable(document.getElementById('fruchtfolgeTable'),
    [
      { key: 'Jahr', label: 'Jahr' },
      { key: 'Kultur', label: 'Kultur' },
      { label: 'Aussaat', format: r => fmtDate(r.Aussaatdatum) },
      { label: 'Ernte', format: r => fmtDate(r.Erntedatum) },
      { label: 'Ertrag', format: r => r.ErtragsMenge ? `${r.ErtragsMenge} ${r.ErtragsEinheit || ''}` : '-' },
      { label: 'Saatmenge gesamt', format: r => `${Number(r.SaatmengeGesamtKg || 0).toFixed(1)} kg` },
      { label: 'Düngeempfehlung (N/P/K)', format: r => formatDuengeempfehlung(r.Kultur, state.aktiveFlaecheFuerFruchtfolge.FlaecheHa) }
    ],
    rows,
    {
      onEdit: (row) => openFruchtfolgeModal(state.aktiveFlaecheFuerFruchtfolge, row),
      onDelete: async (row) => { await safeCall('fruchtfolge.delete', { id: row.ID }, 'Eintrag gelöscht.'); cacheRemove('fruchtfolge.list', row.ID); await reloadFruchtfolgeTable(); }
    });
}

// Liefert die Düngeempfehlung (N/P/K in kg gesamt) für eine Kultur auf einer
// Fläche gegebener Größe - wird sowohl in der Fruchtfolge-Tabelle als auch
// dauerhaft im Feldbuch angezeigt (nicht mehr nur als kurzer Toast).
function berechneDuengeempfehlung(kulturName, flaecheHa) {
  const kulturInfo = state.kulturen.find(k => k.Kultur === kulturName);
  if (!kulturInfo) return null;
  const ha = Number(flaecheHa || 0);
  return {
    kultur: kulturName,
    n: Number(kulturInfo.DuengeempfehlungN_KgHa || 0) * ha,
    p: Number(kulturInfo.DuengeempfehlungP_KgHa || 0) * ha,
    k: Number(kulturInfo.DuengeempfehlungK_KgHa || 0) * ha
  };
}

function formatDuengeempfehlung(kulturName, flaecheHa) {
  const e = berechneDuengeempfehlung(kulturName, flaecheHa);
  if (!e) return '-';
  return `N ${e.n.toFixed(0)} / P ${e.p.toFixed(0)} / K ${e.k.toFixed(0)} kg`;
}

function openFruchtfolgeModal(flaeche, initial = {}) {
  openFormModal({
    title: initial.ID ? `Fruchtfolge bearbeiten: ${flaeche.Name}` : `Kultur zuweisen: ${flaeche.Name}`,
    fields: [
      { key: 'Jahr', label: 'Jahr', type: 'number', required: true, help: `z.B. ${new Date().getFullYear()}` },
      { key: 'Kultur', label: 'Kultur', type: 'select', options: state.kulturen.map(k => k.Kultur), required: true },
      { key: 'Aussaatdatum', label: 'Aussaatdatum', type: 'date' },
      { key: 'Erntedatum', label: 'Erntedatum', type: 'date' },
      { key: 'ErtragsMenge', label: 'Ertragsmenge (bei Ernte, z.B. Silomais)', type: 'number', step: '0.1' },
      { key: 'ErtragsEinheit', label: 'Einheit', type: 'select', options: ['Ballen', 'kg', 'Tonnen'] },
      { key: 'Notiz', label: 'Notiz', type: 'textarea' }
    ],
    initial,
    onSubmit: async (values) => {
      if (!initial.ID) {
        const check = await safeCall('fruchtfolge.check', { flaecheId: flaeche.ID, jahr: values.Jahr, kultur: values.Kultur });
        if (!check.ok) {
          const weiter = confirm('Fruchtfolge-Warnung:\n\n' + check.warnings.join('\n') + '\n\nTrotzdem speichern?');
          if (!weiter) return;
        }
      }
      const kulturInfo = state.kulturen.find(k => k.Kultur === values.Kultur);
      const saatmengeHa = kulturInfo ? Number(kulturInfo.SaatmengeKgHa) : 0;
      const saatmengeGesamt = saatmengeHa * Number(flaeche.FlaecheHa || 0);

      const payload = {
        FlaecheID: flaeche.ID, Jahr: values.Jahr, Kultur: values.Kultur,
        Aussaatdatum: values.Aussaatdatum, Erntedatum: values.Erntedatum,
        ErtragsMenge: values.ErtragsMenge, ErtragsEinheit: values.ErtragsEinheit,
        SaatmengeKgHaBerechnet: saatmengeHa, SaatmengeGesamtKg: saatmengeGesamt,
        Notiz: values.Notiz
      };
      const saved = initial.ID
        ? await safeCall('fruchtfolge.update', { id: initial.ID, ...payload }, 'Fruchtfolge aktualisiert.')
        : await safeCall('fruchtfolge.create', payload, `Kultur zugewiesen. Saatmenge: ${saatmengeGesamt.toFixed(1)} kg.`);
      cacheUpsert('fruchtfolge.list', saved);

      // Ernte nur EINMAL automatisch in Futtermittel verbuchen (nicht bei jeder weiteren Bearbeitung erneut)
      if (values.ErtragsMenge && !initial.ErtragsMenge) {
        await wandereErtragInFuttermittel({
          Bezeichnung: values.Kultur, Kategorie: values.Kultur, Einheit: values.ErtragsEinheit,
          Menge: values.ErtragsMenge, HerkunftFlaecheID: flaeche.ID, Datum: values.Erntedatum,
          Notiz: `Ernte ${values.Jahr} ${flaeche.Name}`
        });
      }
      await reloadFruchtfolgeTable();
    }
  });
}

// ============================================================================
// SUB-FLÄCHEN / REBANLAGEN (innerhalb einer Parzelle)
// ============================================================================
function computeStandjahr(pflanzjahr) {
  if (!pflanzjahr) return { standjahr: null, label: 'Pflanzjahr unbekannt' };
  const standjahr = new Date().getFullYear() - Number(pflanzjahr) + 1;
  if (standjahr < 1) return { standjahr, label: 'noch nicht gepflanzt' };
  if (standjahr <= 3) return { standjahr, label: `${standjahr}. Standjahr - Junganlage` };
  return { standjahr, label: `${standjahr}. Standjahr - Vollertrag` };
}

async function openSubFlaechenPanel(flaeche) {
  state.aktiveFlaecheFuerSubFlaechen = flaeche;
  document.getElementById('subFlaechenPanel').classList.remove('hidden');
  document.getElementById('subFlaechenFlaecheName').textContent = flaeche.Name;
  await reloadSubFlaechenTable();

  document.getElementById('btnNeueSubFlaeche').onclick = () => {
    state.drawModus = 'subflaeche';
    state.drawModusFlaecheId = flaeche.ID;
    state.map.addControl(state.drawControl);
    new L.Draw.Polygon(state.map, state.drawControl.options.draw.polygon).enable();
    toast('Zeichne die Rebanlage als Polygon innerhalb der Parzelle. Doppelklick zum Abschließen.');
  };
}

async function reloadSubFlaechenTable() {
  const all = await cachedList('subflaechen.list');
  state.subflaechen = all.filter(s => s.Aktiv !== false);
  const rows = state.subflaechen.filter(s => s.FlaecheID === state.aktiveFlaecheFuerSubFlaechen.ID);
  renderTable(document.getElementById('subFlaechenTable'),
    [
      { key: 'Name', label: 'Name' },
      { key: 'Rebsorte', label: 'Rebsorte' },
      { label: 'Fläche', format: r => `${Number(r.FlaecheM2 || 0).toFixed(0)} m²` },
      { key: 'Pflanzjahr', label: 'Pflanzjahr' },
      { label: 'Standjahr', format: r => computeStandjahr(r.Pflanzjahr).label }
    ],
    rows,
    {
      onEdit: (row) => openSubFlaecheModal(row, state.aktiveFlaecheFuerSubFlaechen.ID),
      onDelete: async (row) => { await safeCall('subflaechen.delete', { id: row.ID }, 'Rebanlage gelöscht.'); cacheRemove('subflaechen.list', row.ID); await reloadSubFlaechenTable(); }
    });
}

function openSubFlaecheModal(initial = {}, flaecheId) {
  openFormModal({
    title: initial.ID ? 'Rebanlage bearbeiten' : 'Neue Rebanlage',
    fields: [
      { key: 'Name', label: 'Name / Bezeichnung', required: true },
      { key: 'Rebsorte', label: 'Rebsorte' },
      { key: 'FlaecheM2', label: 'Fläche (m²)', type: 'number', step: '1' },
      { key: 'Pflanzjahr', label: 'Pflanzjahr', type: 'number' },
      { key: 'Notiz', label: 'Notiz', type: 'textarea' }
    ],
    initial,
    onSubmit: async (values) => {
      const payload = { ...values, FlaecheID: flaecheId };
      if (state.aktuelleZeichnungGeoJSON) {
        payload.GeoJSON = JSON.stringify(state.aktuelleZeichnungGeoJSON.geometry || state.aktuelleZeichnungGeoJSON);
      } else if (initial.GeoJSON) {
        payload.GeoJSON = initial.GeoJSON;
      }
      const saved = initial.ID
        ? await safeCall('subflaechen.update', { id: initial.ID, ...payload }, 'Rebanlage aktualisiert.')
        : await safeCall('subflaechen.create', payload, 'Rebanlage angelegt.');
      cacheUpsert('subflaechen.list', saved);
      state.aktuelleZeichnungGeoJSON = null;
      state.drawnItems.clearLayers();
      await reloadSubFlaechenTable();
    }
  });
}

// ============================================================================
// ARBEITSABLÄUFE (freie Schritt-Reihenfolge je Fläche, z.B. Pflügen/Grubbern/Säen
// oder 1./2./3. Schnitt) - ermittelt automatisch den nächsten anstehenden Schritt.
// ============================================================================
function arbeitsablaufVon(flaeche) {
  try { return JSON.parse(flaeche.ArbeitsablaufJSON || '[]'); } catch (e) { return []; }
}
function hatArbeitsablauf(flaeche) {
  return arbeitsablaufVon(flaeche).length > 0;
}

// Nächster Schritt = erster Schritt der Reihenfolge, der in diesem Kalenderjahr noch
// nicht als erledigt protokolliert wurde. Sind alle erledigt, gilt der Ablauf als
// abgeschlossen (kein "nächster Schritt" mehr) - passend z.B. für "3 Schnitte pro Jahr".
function naechsterArbeitsschritt(flaeche, feldarbeitenAlle, jahr = new Date().getFullYear()) {
  const schritte = arbeitsablaufVon(flaeche);
  if (!schritte.length) return null;
  const erledigtDiesesJahr = new Set(
    feldarbeitenAlle.filter(f => f.FlaecheID === flaeche.ID && new Date(f.Datum).getFullYear() === jahr).map(f => f.Schritt)
  );
  return schritte.find(s => !erledigtDiesesJahr.has(s)) || null;
}

function openArbeitsschrittModal(flaeche) {
  cachedList('feldarbeiten.list').then(alle => {
    const naechster = naechsterArbeitsschritt(flaeche, alle);
    openFormModal({
      title: `Arbeitsschritt erledigt: ${flaeche.Name}`,
      fields: [
        { key: 'Schritt', label: 'Schritt', type: 'select', options: arbeitsablaufVon(flaeche) },
        { key: 'Datum', label: 'Datum', type: 'date', required: true },
        { key: 'Notiz', label: 'Notiz', type: 'textarea' }
      ],
      initial: { Schritt: naechster || arbeitsablaufVon(flaeche)[0] },
      onSubmit: async (values) => {
        const saved = await safeCall('feldarbeiten.create', { FlaecheID: flaeche.ID, ...values }, 'Arbeitsschritt erfasst.');
        cacheUpsert('feldarbeiten.list', saved);
      }
    });
  });
}

// ============================================================================
// FELDBUCH (Schnitte + Düngung je Fläche)
// ============================================================================
document.querySelectorAll('.ftab-btn').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('.ftab-btn').forEach(x => {
    x.classList.toggle('border-green-700', x === b);
    x.classList.toggle('text-gray-500', x !== b);
  });
  document.querySelectorAll('.ftab-panel').forEach(p => p.classList.add('hidden'));
  document.getElementById('ftab-' + b.dataset.ftab).classList.remove('hidden');
}));

async function openFeldbuchPanel(flaeche) {
  state.aktiveFlaecheFuerFeldbuch = flaeche;
  document.getElementById('feldbuchPanel').classList.remove('hidden');
  document.getElementById('feldbuchFlaecheName').textContent = flaeche.Name;
  await reloadFeldbuchTabellen();

  document.getElementById('btnNeuerSchnitt').onclick = () => openSchnittModal(flaeche);
  document.getElementById('btnNeueDuengung').onclick = () => openDuengungModal(flaeche);
}

async function reloadFeldbuchTabellen() {
  const flaeche = state.aktiveFlaecheFuerFeldbuch;
  const flaecheId = flaeche.ID;
  const { schnitte, duengungen } = await cachedBatch({ schnitte: { action: 'schnitte.list' }, duengungen: { action: 'duengungen.list' } });
  state.schnitte = schnitte;
  state.duengungen = duengungen;

  const box = document.getElementById('duengeempfehlungBox');
  const jahr = new Date().getFullYear();
  const zuweisung = state.fruchtfolge.find(f => f.FlaecheID === flaecheId && Number(f.Jahr) === jahr);
  const empfehlung = zuweisung ? berechneDuengeempfehlung(zuweisung.Kultur, flaeche.FlaecheHa) : null;
  if (empfehlung) {
    box.classList.remove('hidden');
    box.innerHTML = `<b>🌱 Düngeempfehlung ${jahr} (${empfehlung.kultur}):</b> `
      + `N ${empfehlung.n.toFixed(0)} kg · P ${empfehlung.p.toFixed(0)} kg · K ${empfehlung.k.toFixed(0)} kg gesamt für ${Number(flaeche.FlaecheHa).toFixed(2)} ha`
      + ` — trage unten die tatsächlich ausgebrachte Düngung zum Vergleich ein.`;
  } else {
    box.classList.remove('hidden');
    box.innerHTML = `<b>🌱 Düngeempfehlung ${jahr}:</b> Noch keine Kultur für dieses Jahr in der Fruchtfolge zugewiesen (nur bei Wechselwiese/Ackerland relevant).`;
  }

  renderTable(document.getElementById('schnitteTable'),
    [
      { key: 'SchnittNummer', label: 'Schnitt Nr.' },
      { label: 'Datum', format: r => fmtDate(r.Datum) },
      { key: 'Erntetyp', label: 'Erntetyp' },
      { label: 'Ertrag', format: r => `${r.ErtragsMenge || ''} ${r.ErtragsEinheit || ''}` }
    ],
    schnitte.filter(s => s.FlaecheID === flaecheId).sort((a, b) => new Date(b.Datum) - new Date(a.Datum)),
    { onDelete: async (row) => { await safeCall('schnitte.delete', { id: row.ID }, 'Gelöscht.'); cacheRemove('schnitte.list', row.ID); await reloadFeldbuchTabellen(); } });

  renderTable(document.getElementById('duengungTable'),
    [
      { label: 'Datum', format: r => fmtDate(r.Datum) },
      { key: 'Duengerart', label: 'Düngerart' },
      { label: 'Menge', format: r => `${r.Menge || ''} ${r.Einheit || ''}` }
    ],
    duengungen.filter(d => d.FlaecheID === flaecheId).sort((a, b) => new Date(b.Datum) - new Date(a.Datum)),
    { onDelete: async (row) => { await safeCall('duengungen.delete', { id: row.ID }, 'Gelöscht.'); cacheRemove('duengungen.list', row.ID); await reloadFeldbuchTabellen(); } });
}

function openSchnittModal(flaeche) {
  const bisherige = state.schnitte.filter(s => s.FlaecheID === flaeche.ID && Number(s.Datum && new Date(s.Datum).getFullYear()) === new Date().getFullYear());
  openFormModal({
    title: `Schnitt erfassen: ${flaeche.Name}`,
    fields: [
      { key: 'SchnittNummer', label: 'Schnitt-Nummer', type: 'number', required: true, help: `Vorschlag: ${bisherige.length + 1}. Schnitt` },
      { key: 'Datum', label: 'Datum', type: 'date', required: true },
      { key: 'Erntetyp', label: 'Erntetyp', type: 'select', options: ['Heu', 'Silage', 'Grummet'] },
      { key: 'ErtragsMenge', label: 'Ertragsmenge', type: 'number', step: '0.1' },
      { key: 'ErtragsEinheit', label: 'Einheit', type: 'select', options: ['Rundballen', 'Quaderballen', 'Tonnen'] },
      { key: 'Notiz', label: 'Notiz', type: 'textarea' }
    ],
    initial: { SchnittNummer: bisherige.length + 1 },
    onSubmit: async (values) => {
      const saved = await safeCall('schnitte.create', { FlaecheID: flaeche.ID, ...values }, 'Schnitt erfasst.');
      cacheUpsert('schnitte.list', saved);
      if (values.ErtragsMenge) {
        await wandereErtragInFuttermittel({
          Bezeichnung: values.Erntetyp || 'Heu', Kategorie: values.Erntetyp || 'Heu', Einheit: values.ErtragsEinheit,
          Menge: values.ErtragsMenge, HerkunftFlaecheID: flaeche.ID, Datum: values.Datum,
          Notiz: `${values.SchnittNummer}. Schnitt ${flaeche.Name}`
        });
      }
      await reloadFeldbuchTabellen();
    }
  });
}

function openDuengungModal(flaeche) {
  openFormModal({
    title: `Düngung erfassen: ${flaeche.Name}`,
    fields: [
      { key: 'Datum', label: 'Datum', type: 'date', required: true },
      { key: 'Duengerart', label: 'Düngerart', type: 'select', options: ['Gülle', 'Mist', 'Mistsuppe', 'Kompost', 'Mineraldünger (Kunstdünger)', 'Sonstiges'] },
      { key: 'Menge', label: 'Menge', type: 'number', step: '0.1', required: true },
      { key: 'Einheit', label: 'Einheit', type: 'select', options: ['m³', 'kg'] },
      { key: 'Notiz', label: 'Notiz', type: 'textarea' }
    ],
    onSubmit: async (values) => {
      const saved = await safeCall('duengungen.create', { FlaecheID: flaeche.ID, ...values }, 'Düngung erfasst.');
      cacheUpsert('duengungen.list', saved);
      await reloadFeldbuchTabellen();
    }
  });
}

// ============================================================================
// FUHRPARK
// ============================================================================
// Kompakte "nächste Wartung in X Tagen"-Anzeige direkt auf der Maschinenkarte
// (nur datumsbasierte Intervalle - Betriebsstunden-Intervalle stehen schon in den Hinweisen).
function naechsteWartungLabel(maschine, intervalle) {
  let naechste = null;
  intervalle.filter(i => i.MaschinenID === maschine.ID).forEach(iv => {
    if (!iv.IntervallMonate || !iv.LetzteWartungDatum) return;
    const datum = new Date(iv.LetzteWartungDatum);
    datum.setMonth(datum.getMonth() + Number(iv.IntervallMonate));
    const tage = Math.round((datum - new Date()) / 86400000);
    if (!naechste || tage < naechste.tage) naechste = { tage, bezeichnung: iv.Bezeichnung, datum };
  });
  if (!naechste) return '';
  if (naechste.tage < 0) return `⚠️ ${naechste.bezeichnung} überfällig seit ${Math.abs(naechste.tage)} Tagen`;
  return `Nächste Wartung: ${naechste.bezeichnung} in ${naechste.tage} Tagen (${fmtDate(naechste.datum)})`;
}

function computeAmpelStatus(maschine, intervalle) {
  let status = 'green';
  let hinweise = [];
  intervalle.filter(i => i.MaschinenID === maschine.ID).forEach(iv => {
    if (iv.IntervallStunden) {
      const verbleibend = Number(iv.LetzteWartungStunden || 0) + Number(iv.IntervallStunden) - Number(maschine.BetriebsstundenAktuell || 0);
      if (verbleibend <= 0) { status = 'red'; hinweise.push(`${iv.Bezeichnung}: überfällig (Std.)`); }
      else if (verbleibend <= Number(iv.IntervallStunden) * 0.1 && status !== 'red') { status = 'yellow'; hinweise.push(`${iv.Bezeichnung}: bald fällig (${verbleibend.toFixed(0)} Std. übrig)`); }
    }
    if (iv.IntervallMonate && iv.LetzteWartungDatum) {
      const naechste = new Date(iv.LetzteWartungDatum);
      naechste.setMonth(naechste.getMonth() + Number(iv.IntervallMonate));
      const tageBis = (naechste - new Date()) / 86400000;
      if (tageBis <= 0) { status = 'red'; hinweise.push(`${iv.Bezeichnung}: überfällig (Datum)`); }
      else if (tageBis <= 30 && status !== 'red') { status = 'yellow'; hinweise.push(`${iv.Bezeichnung}: fällig am ${fmtDate(naechste)}`); }
    }
  });
  return { status, hinweise };
}

async function loadFuhrparkSection() {
  const { maschinen, intervalle } = await cachedBatch({
    maschinen: { action: 'maschinen.list' },
    intervalle: { action: 'wartungsintervalle.list' }
  });
  state.maschinen = maschinen.filter(m => m.Aktiv !== false);
  state.wartungsintervalle = intervalle;

  const grid = document.getElementById('maschinenGrid');
  grid.innerHTML = state.maschinen.map(m => {
    const { status, hinweise } = computeAmpelStatus(m, intervalle);
    return `<div class="bg-white rounded-xl shadow overflow-hidden space-y-2">
      ${m.FotoURL ? `<img src="${m.FotoURL}" class="w-full h-32 object-cover" alt="">` : `<div class="w-full h-16 bg-gray-100 flex items-center justify-center text-3xl">🚜</div>`}
      <div class="p-4 pt-0 space-y-2">
      <div class="flex items-center justify-between">
        <div>
          <div class="font-semibold">${m.GeraeteNummer ? `<span class="text-gray-400 font-normal">${m.GeraeteNummer}</span> ` : ''}${m.Bezeichnung}</div>
          <div class="text-xs text-gray-500">${m.Typ || ''}${m.Baujahr ? ' · Baujahr ' + m.Baujahr : ''}</div>
        </div>
        <span class="w-4 h-4 rounded-full traffic-${status} shrink-0" title="${hinweise.join(' · ') || 'Alles im grünen Bereich'}"></span>
      </div>
      <div class="text-sm text-gray-600">Betriebsstunden: <b>${Number(m.BetriebsstundenAktuell || 0).toFixed(1)}</b></div>
      ${hinweise.length ? `<div class="text-xs text-amber-700">${hinweise.join('<br>')}</div>` : ''}
      ${naechsteWartungLabel(m, intervalle) ? `<div class="text-xs text-gray-500">${naechsteWartungLabel(m, intervalle)}</div>` : ''}
      <div class="flex gap-2 flex-wrap pt-2 border-t">
        <button data-id="${m.ID}" class="btn-stunden text-xs bg-gray-100 hover:bg-gray-200 px-2 py-1 rounded">+ Std.</button>
        <button data-id="${m.ID}" class="btn-edit-maschine text-xs bg-gray-100 hover:bg-gray-200 px-2 py-1 rounded">Bearbeiten</button>
        <button data-id="${m.ID}" class="btn-kosten text-xs bg-gray-100 hover:bg-gray-200 px-2 py-1 rounded">Kosten</button>
        <button data-id="${m.ID}" class="btn-wartung text-xs bg-gray-100 hover:bg-gray-200 px-2 py-1 rounded">Wartung</button>
        <button data-id="${m.ID}" class="btn-dokumente text-xs bg-gray-100 hover:bg-gray-200 px-2 py-1 rounded">Dokumente</button>
        ${state.user.role === 'Admin' ? `<button data-id="${m.ID}" class="btn-delete-maschine text-xs text-red-600 hover:underline ml-auto">Löschen</button>` : ''}
      </div>
      </div>
    </div>`;
  }).join('') || '<p class="text-gray-400">Noch keine Maschinen angelegt.</p>';

  grid.querySelectorAll('.btn-stunden').forEach(b => b.onclick = () => quickAddStunden(b.dataset.id));
  grid.querySelectorAll('.btn-edit-maschine').forEach(b => b.onclick = () => openMaschineModal(state.maschinen.find(m => m.ID === b.dataset.id)));
  grid.querySelectorAll('.btn-delete-maschine').forEach(b => b.onclick = async () => {
    if (confirm('Maschine wirklich löschen?')) {
      await safeCall('maschinen.delete', { id: b.dataset.id }, 'Gelöscht.');
      cacheRemove('maschinen.list', b.dataset.id);
      await loadFuhrparkSection();
    }
  });
  grid.querySelectorAll('.btn-kosten').forEach(b => b.onclick = () => openMaschinenKostenDetail(state.maschinen.find(m => m.ID === b.dataset.id)));
  grid.querySelectorAll('.btn-wartung').forEach(b => b.onclick = () => openWartungsintervalleDetail(state.maschinen.find(m => m.ID === b.dataset.id)));
  grid.querySelectorAll('.btn-dokumente').forEach(b => b.onclick = () => openDokumenteDetail(state.maschinen.find(m => m.ID === b.dataset.id)));
  document.getElementById('btnNeueMaschine').onclick = () => openMaschineModal();
}

function openMaschineModal(initial = {}) {
  openFormModal({
    title: initial.ID ? 'Maschine bearbeiten' : 'Neue Maschine',
    fields: [
      { key: 'GeraeteNummer', label: 'Geräte-Nummer (z.B. #TR-01)' },
      { key: 'Bezeichnung', label: 'Bezeichnung', required: true },
      { key: 'Typ', label: 'Typ' },
      { key: 'Baujahr', label: 'Baujahr', type: 'number' },
      { key: 'Anschaffungspreis', label: 'Anschaffungspreis (€)', type: 'number', step: '0.01' },
      { key: 'Anschaffungsdatum', label: 'Anschaffungsdatum', type: 'date' },
      { key: 'BetriebsstundenAktuell', label: 'Aktuelle Betriebsstunden', type: 'number', step: '0.1' },
      { key: 'Foto', label: 'Foto (ersetzt vorhandenes Foto)', type: 'file', accept: 'image/*' },
      { key: 'Notiz', label: 'Notiz', type: 'textarea' }
    ],
    initial,
    onSubmit: async (values) => {
      const payload = { ...values };
      delete payload.Foto;
      if (values.Foto) {
        const up = await Api.uploadFile(values.Foto, 'maschine');
        payload.FotoURL = up.url;
      }
      const saved = initial.ID
        ? await safeCall('maschinen.update', { id: initial.ID, ...payload }, 'Aktualisiert.')
        : await safeCall('maschinen.create', payload, 'Maschine angelegt.');
      cacheUpsert('maschinen.list', saved);
      await loadFuhrparkSection();
    }
  });
}

// ---- Dokumentenablage (Schmierplan, Ersatzteillisten, Notizen als PDF/Bild) ----
function openDokumenteDetail(maschine) {
  openDetailModal(`Dokumente: ${maschine.Bezeichnung}`, async (body) => {
    let dokumente = [];
    try { dokumente = JSON.parse(maschine.DokumenteJSON || '[]'); } catch (e) { dokumente = []; }

    const render = () => {
      body.innerHTML = `
        <div id="dokListe" class="space-y-1"></div>
        <button id="btnNeuesDokument" class="bg-green-700 text-white px-3 py-2 rounded text-sm">+ Dokument hochladen</button>`;
      const listeEl = document.getElementById('dokListe');
      listeEl.innerHTML = dokumente.length
        ? dokumente.map((d, i) => `<div class="flex items-center justify-between border-b py-1">
             <a href="${d.url}" target="_blank" class="text-blue-600 underline text-sm">${d.name}</a>
             <button data-idx="${i}" class="btn-dok-del text-red-600 hover:underline text-xs">Entfernen</button>
           </div>`).join('')
        : '<p class="text-gray-400 text-sm">Noch keine Dokumente hinterlegt.</p>';

      listeEl.querySelectorAll('.btn-dok-del').forEach(btn => btn.onclick = async () => {
        dokumente.splice(Number(btn.dataset.idx), 1);
        const saved = await safeCall('maschinen.update', { id: maschine.ID, DokumenteJSON: JSON.stringify(dokumente) }, 'Entfernt.');
        cacheUpsert('maschinen.list', saved);
        render();
      });

      document.getElementById('btnNeuesDokument').onclick = () => openFormModal({
        title: 'Dokument hochladen',
        fields: [
          { key: 'Name', label: 'Bezeichnung (z.B. Schmierplan)', required: true },
          { key: 'Datei', label: 'PDF/Bild', type: 'file', accept: '.pdf,image/*', required: true }
        ],
        onSubmit: async (values) => {
          const up = await Api.uploadFile(values.Datei, 'maschine');
          dokumente.push({ name: values.Name, url: up.url });
          const saved = await safeCall('maschinen.update', { id: maschine.ID, DokumenteJSON: JSON.stringify(dokumente) }, 'Dokument gespeichert.');
          cacheUpsert('maschinen.list', saved);
          maschine.DokumenteJSON = JSON.stringify(dokumente);
          render();
        }
      });
    };
    render();
  });
}

async function quickAddStunden(maschinenId) {
  const delta = prompt('Wie viele Betriebsstunden hinzufügen? (z.B. 5)');
  if (!delta || isNaN(Number(delta))) return;
  const res = await safeCall('maschinen.addStunden', { maschinenId, stundenDelta: Number(delta) }, `+${delta} Std. erfasst.`);
  const maschine = (listCache['maschinen.list'] || []).find(m => m.ID === maschinenId);
  if (maschine) maschine.BetriebsstundenAktuell = res.neueBetriebsstunden;
  await loadFuhrparkSection();
}

function openMaschinenKostenDetail(maschine) {
  openDetailModal(`Kosten: ${maschine.Bezeichnung}`, async (body) => {
    body.innerHTML = `<button id="btnNeueMKosten" class="bg-green-700 text-white px-3 py-2 rounded text-sm mb-2">+ Kosten erfassen</button><div id="mKostenTable"></div>`;
    const reload = async () => {
      const alle = await cachedList('maschinenkosten.list');
      const rows = alle.filter(k => k.MaschinenID === maschine.ID).sort((a, b) => new Date(b.Datum) - new Date(a.Datum));
      renderTable(document.getElementById('mKostenTable'),
        [
          { label: 'Datum', format: r => fmtDate(r.Datum) },
          { key: 'Kategorie', label: 'Kategorie' },
          { label: 'Betrag', format: r => euro(r.Betrag) },
          { key: 'Beschreibung', label: 'Beschreibung' },
          { label: 'Beleg', format: r => r.BelegURL ? `<a href="${r.BelegURL}" target="_blank" class="text-blue-600 underline">Öffnen</a>` : '' }
        ], rows,
        { onDelete: async (row) => { await safeCall('maschinenkosten.delete', { id: row.ID }, 'Gelöscht.'); cacheRemove('maschinenkosten.list', row.ID); await reload(); } });
    };
    document.getElementById('btnNeueMKosten').onclick = () => openFormModal({
      title: 'Kosten erfassen',
      fields: [
        { key: 'Datum', label: 'Datum', type: 'date', required: true },
        { key: 'Kategorie', label: 'Kategorie', type: 'select', options: ['Reparatur', 'Wartung', 'Kraftstoff', 'Versicherung', 'Sonstiges'] },
        { key: 'Betrag', label: 'Betrag (€)', type: 'number', step: '0.01', required: true },
        { key: 'Beschreibung', label: 'Beschreibung' },
        { key: 'Beleg', label: 'Beleg-Foto/PDF', type: 'file', accept: 'image/*,.pdf' }
      ],
      onSubmit: async (values) => {
        let belegURL = '';
        if (values.Beleg) {
          const up = await Api.uploadFile(values.Beleg, 'maschine');
          belegURL = up.url;
        }
        const saved = await safeCall('maschinenkosten.create', {
          MaschinenID: maschine.ID, Datum: values.Datum, Kategorie: values.Kategorie,
          Betrag: values.Betrag, Beschreibung: values.Beschreibung, BelegURL: belegURL
        }, 'Kosten erfasst.');
        cacheUpsert('maschinenkosten.list', saved);
        await reload();
      }
    });
    await reload();
  });
}

function openWartungsintervalleDetail(maschine) {
  openDetailModal(`Wartungsintervalle: ${maschine.Bezeichnung}`, async (body) => {
    body.innerHTML = `<button id="btnNeuIntervall" class="bg-green-700 text-white px-3 py-2 rounded text-sm mb-2">+ Intervall</button><div id="ivTable"></div>`;
    const reload = async () => {
      const alle = await cachedList('wartungsintervalle.list');
      const rows = alle.filter(i => i.MaschinenID === maschine.ID);
      renderTable(document.getElementById('ivTable'),
        [
          { key: 'Bezeichnung', label: 'Bezeichnung' },
          { key: 'IntervallStunden', label: 'Intervall (Std.)' },
          { key: 'IntervallMonate', label: 'Intervall (Monate)' },
          { key: 'LetzteWartungStunden', label: 'Letzte Wartung (Std.)' },
          { label: 'Letzte Wartung (Datum)', format: r => fmtDate(r.LetzteWartungDatum) }
        ], rows,
        {
          onEdit: (row) => openIntervallModal(maschine, row, reload),
          onDelete: async (row) => { await safeCall('wartungsintervalle.delete', { id: row.ID }, 'Gelöscht.'); cacheRemove('wartungsintervalle.list', row.ID); await reload(); },
          extraButtons: (row) => `<button data-id="${row.ID}" class="btn-erledigt text-green-700 hover:underline mr-2">✅ Erledigt melden</button>`
        });
      document.querySelectorAll('.btn-erledigt').forEach(b => b.onclick = () => openWartungErledigtModal(maschine, rows.find(r => r.ID === b.dataset.id), reload));
    };
    document.getElementById('btnNeuIntervall').onclick = () => openIntervallModal(maschine, {}, reload);
    await reload();
  });
}

function openWartungErledigtModal(maschine, intervall, reload) {
  openFormModal({
    title: `Wartung erledigt: ${intervall.Bezeichnung}`,
    fields: [
      { key: 'datum', label: 'Datum', type: 'date', required: true },
      { key: 'betriebsstunden', label: 'Betriebsstunden bei Wartung', type: 'number', step: '0.1' },
      { key: 'kosten', label: 'Kosten (€, optional)', type: 'number', step: '0.01' },
      { key: 'beleg', label: 'Beleg (optional)', type: 'file', accept: 'image/*,.pdf' }
    ],
    initial: { betriebsstunden: maschine.BetriebsstundenAktuell },
    onSubmit: async (values) => {
      let belegURL = '';
      if (values.beleg) { const up = await Api.uploadFile(values.beleg, 'maschine'); belegURL = up.url; }
      const res = await safeCall('wartungsintervalle.erfassen', {
        id: intervall.ID, datum: values.datum, betriebsstunden: values.betriebsstunden,
        kosten: values.kosten, belegURL
      }, 'Wartung erfasst - Zähler zurückgesetzt.');
      // Rückgabe enthält nur die neuen Kosten (falls angegeben) - Intervall selbst
      // lokal mit den gesendeten Werten nachführen, um einen weiteren Fetch zu sparen.
      const iv = (listCache['wartungsintervalle.list'] || []).find(i => i.ID === intervall.ID);
      if (iv) { iv.LetzteWartungStunden = values.betriebsstunden; iv.LetzteWartungDatum = values.datum; }
      if (res.kosten) cacheUpsert('maschinenkosten.list', res.kosten);
      await reload();
    }
  });
}

function openIntervallModal(maschine, initial, reload) {
  openFormModal({
    title: initial.ID ? 'Intervall bearbeiten' : 'Neues Wartungsintervall',
    fields: [
      { key: 'Bezeichnung', label: 'Bezeichnung (z.B. Ölwechsel)', required: true },
      { key: 'IntervallStunden', label: 'Intervall in Betriebsstunden', type: 'number' },
      { key: 'IntervallMonate', label: 'Intervall in Monaten', type: 'number' },
      { key: 'LetzteWartungStunden', label: 'Betriebsstunden bei letzter Wartung', type: 'number' },
      { key: 'LetzteWartungDatum', label: 'Datum letzte Wartung', type: 'date' },
      { key: 'Notiz', label: 'Notiz', type: 'textarea' }
    ],
    initial,
    onSubmit: async (values) => {
      const saved = initial.ID
        ? await safeCall('wartungsintervalle.update', { id: initial.ID, MaschinenID: maschine.ID, ...values }, 'Aktualisiert.')
        : await safeCall('wartungsintervalle.create', { MaschinenID: maschine.ID, ...values }, 'Intervall angelegt.');
      cacheUpsert('wartungsintervalle.list', saved);
      await reload();
    }
  });
}

// ============================================================================
// VIEHHALTUNG
// ============================================================================
const TIERARTEN = ['Rind', 'Ziege', 'Schaf', 'Huhn', 'Sonstiges'];
const TIERART_ICONS = { Rind: '🐄', Ziege: '🐐', Schaf: '🐑', Huhn: '🐔', Sonstiges: '🐾' };

async function loadViehSection() {
  const { tiere, tierkosten, tiererloese, zuchtereignisse } = await cachedBatch({
    tiere: { action: 'tiere.list' },
    tierkosten: { action: 'tierkosten.list' },
    tiererloese: { action: 'tiererloese.list' },
    zuchtereignisse: { action: 'zuchtereignisse.list' }
  });
  state.tiere = tiere;
  state.tierkosten = tierkosten;
  state.tiererloese = tiererloese;
  state.zuchtereignisse = zuchtereignisse;
  renderZuchtErinnerungen();

  const grid = document.getElementById('tiereTable');
  grid.innerHTML = state.tiere.map(t => `
    <div class="bg-white rounded-xl shadow p-4 space-y-2">
      <div class="flex items-center justify-between">
        <div class="font-semibold">${t.Name || t.Ohrmarke || 'unbenannt'}</div>
        <span class="text-2xl">${TIERART_ICONS[t.Tierart] || '🐾'}</span>
      </div>
      <div class="text-xs text-gray-500">${t.Tierart}${t.Rasse ? ' · ' + t.Rasse : ''}${t.Ohrmarke && t.Name ? ' · ' + t.Ohrmarke : ''}</div>
      <div class="text-sm text-gray-600">${t.Status}${t.Geschlecht ? ' · ' + t.Geschlecht : ''}</div>
      <div class="text-xs text-gray-400">${zuchtstatusFuerTier(t.ID)}</div>
      <div class="text-sm text-gray-600">Deckungsbeitrag: <b>${euro(deckungsbeitragFuerTier(t.ID))}</b></div>
      <div class="flex gap-2 flex-wrap pt-2 border-t">
        <button data-id="${t.ID}" class="btn-tier-buchungen text-xs bg-gray-100 hover:bg-gray-200 px-2 py-1 rounded">📋 Details &amp; Zucht</button>
        <button data-id="${t.ID}" class="btn-tier-edit text-xs bg-gray-100 hover:bg-gray-200 px-2 py-1 rounded">Bearbeiten</button>
        ${state.user.role === 'Admin' ? `<button data-id="${t.ID}" class="btn-tier-delete text-xs text-red-600 hover:underline ml-auto">Löschen</button>` : ''}
      </div>
    </div>`).join('') || '<p class="text-gray-400">Noch keine Tiere erfasst.</p>';

  grid.querySelectorAll('.btn-tier-buchungen').forEach(b => b.onclick = () => openTierBuchungenDetail(state.tiere.find(t => t.ID === b.dataset.id)));
  grid.querySelectorAll('.btn-tier-edit').forEach(b => b.onclick = () => openTierModal(state.tiere.find(t => t.ID === b.dataset.id)));
  grid.querySelectorAll('.btn-tier-delete').forEach(b => b.onclick = async () => {
    if (confirm('Tier wirklich löschen?')) {
      await safeCall('tiere.delete', { id: b.dataset.id }, 'Gelöscht.');
      cacheRemove('tiere.list', b.dataset.id);
      await loadViehSection();
    }
  });

  document.getElementById('btnNeuesTier').onclick = () => openTierModal();
  document.getElementById('btnExportBestandsregister').onclick = () => exportBestandsregisterCsv();
}

// ---- Zuchtkalender: Erinnerungsbox für anstehende Trockenstellen/Abkalbungen ----
function renderZuchtErinnerungen() {
  const box = document.getElementById('zuchtErinnerungen');
  const wochenVorher = Number(state.betrieb && state.betrieb.ErinnerungWochenVorher) || 4;
  const tageVorher = wochenVorher * 7;
  const heute = new Date();
  const stichtag = new Date(heute.getTime() + tageVorher * 86400000);
  const anstehend = state.zuchtereignisse
    .filter(z => z.Typ === 'Besamung' || z.Typ === 'Deckung')
    .flatMap(z => {
      const tier = state.tiere.find(t => t.ID === z.TierID);
      const tierLabel = tier ? (tier.Name || tier.Ohrmarke) : z.TierID;
      const eintraege = [];
      const abkalb = new Date(z.VoraussichtlichesAbkalbedatum);
      const trocken = new Date(z.TrockenstellenAb);
      if (!isNaN(trocken) && trocken >= heute && trocken <= stichtag) {
        eintraege.push(`🐄 ${tierLabel}: Trockenstellen ab ${fmtDate(trocken)}`);
      }
      if (!isNaN(abkalb) && abkalb >= heute && abkalb <= stichtag) {
        eintraege.push(`🐄 ${tierLabel}: voraussichtliche Abkalbung ${fmtDate(abkalb)}`);
      }
      return eintraege;
    });
  if (anstehend.length) {
    box.classList.remove('hidden');
    box.innerHTML = `<b>📅 Anstehend (nächste ${wochenVorher} Wochen):</b><br>` + anstehend.join('<br>');
  } else {
    box.classList.add('hidden');
  }
}

// ---- Bestandsregister-Export (CSV) ----
function csvEscape(val) {
  const s = String(val ?? '');
  return /[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function downloadCsv(filename, rows) {
  const csv = rows.map(r => r.map(csvEscape).join(';')).join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

function exportBestandsregisterCsv() {
  const header = ['Ohrmarke', 'Tierart', 'Rasse', 'Name', 'Geburtsdatum', 'Geschlecht', 'Status', 'MutterOhrmarke', 'ErstelltAm'];
  const rows = state.tiere.map(t => header.map(h => t[h]));
  downloadCsv(`Bestandsregister_${new Date().toISOString().slice(0, 10)}.csv`, [header, ...rows]);
  toast('Bestandsregister als CSV heruntergeladen.');
}

function deckungsbeitragFuerTier(tierId) {
  const kosten = state.tierkosten.filter(k => k.TierID === tierId).reduce((s, k) => s + Number(k.Betrag || 0), 0);
  const erloese = state.tiererloese.filter(k => k.TierID === tierId).reduce((s, k) => s + Number(k.Betrag || 0), 0);
  return erloese - kosten;
}

function openTierModal(initial = {}) {
  openFormModal({
    title: initial.ID ? 'Tier bearbeiten' : 'Neues Einzeltier',
    fields: [
      { key: 'Tierart', label: 'Tierart', type: 'select', options: TIERARTEN, required: true },
      { key: 'Ohrmarke', label: 'Ohrmarkennummer' },
      { key: 'Rasse', label: 'Rasse' },
      { key: 'Name', label: 'Name' },
      { key: 'Geburtsdatum', label: 'Geburtsdatum', type: 'date' },
      { key: 'Geschlecht', label: 'Geschlecht', type: 'select', options: ['weiblich', 'männlich'] },
      { key: 'Status', label: 'Status', type: 'select', options: ['Lebend', 'Verkauft', 'Geschlachtet', 'Verstorben'] },
      { key: 'MutterOhrmarke', label: 'Ohrmarke der Mutter (optional)' },
      { key: 'Notiz', label: 'Notiz', type: 'textarea' }
    ],
    initial,
    onSubmit: async (values) => {
      const saved = initial.ID
        ? await safeCall('tiere.update', { id: initial.ID, ...values }, 'Aktualisiert.')
        : await safeCall('tiere.create', values, 'Tier angelegt.');
      cacheUpsert('tiere.list', saved);
      await loadViehSection();
    }
  });
}

// Zeigt in der Tier-Übersicht direkt das nächste anstehende Zuchtereignis (statt erst im Detail-Modal).
function zuchtstatusFuerTier(tierId) {
  const events = (state.zuchtereignisse || []).filter(z => z.TierID === tierId);
  if (!events.length) return '-';
  const heute = new Date();
  const kommende = events
    .flatMap(z => {
      const out = [];
      const abkalb = new Date(z.VoraussichtlichesAbkalbedatum);
      const trocken = new Date(z.TrockenstellenAb);
      if (!isNaN(abkalb) && abkalb >= heute) out.push({ label: `📅 Abkalbung ${fmtDate(abkalb)}`, datum: abkalb });
      if (!isNaN(trocken) && trocken >= heute) out.push({ label: `📅 Trockenstellen ${fmtDate(trocken)}`, datum: trocken });
      return out;
    })
    .sort((a, b) => a.datum - b.datum);
  if (kommende.length) return kommende[0].label;
  const letztes = events.slice().sort((a, b) => new Date(b.Datum) - new Date(a.Datum))[0];
  return `${letztes.Typ} ${fmtDate(letztes.Datum)}`;
}

function openTierBuchungenDetail(tier) {
  openDetailModal(`Details &amp; Zucht: ${tier.Name || tier.Ohrmarke}`, async (body) => {
    body.innerHTML = `
      <div class="flex gap-2">
        <button id="btnNeueTierKosten" class="bg-red-100 text-red-700 px-3 py-2 rounded text-sm">+ Kosten</button>
        <button id="btnNeueTierErloes" class="bg-green-100 text-green-700 px-3 py-2 rounded text-sm">+ Erlös</button>
      </div>
      <div class="font-semibold mt-2">Kosten</div><div id="tKostenTable"></div>
      <div class="font-semibold mt-2">Erlöse</div><div id="tErloeseTable"></div>
      <div class="text-right font-bold pt-2 border-t" id="tSaldo"></div>
      <div class="flex items-center justify-between pt-3 border-t">
        <div class="font-semibold">Zuchtkalender</div>
        <button id="btnNeuesZuchtereignis" class="bg-amber-100 text-amber-800 px-3 py-2 rounded text-sm">+ Besamung/Deckung/Abkalbung</button>
      </div>
      <div id="tZuchtTable"></div>`;

    const reload = async () => {
      const { kostenAlle, erloeseAlle, zuchtAlle } = await cachedBatch({
        kostenAlle: { action: 'tierkosten.list' },
        erloeseAlle: { action: 'tiererloese.list' },
        zuchtAlle: { action: 'zuchtereignisse.list' }
      });
      const kosten = kostenAlle.filter(k => k.TierID === tier.ID);
      const erloese = erloeseAlle.filter(k => k.TierID === tier.ID);
      state.tierkosten = kostenAlle; state.tiererloese = erloeseAlle;

      renderTable(document.getElementById('tKostenTable'),
        [{ label: 'Datum', format: r => fmtDate(r.Datum) }, { key: 'Kategorie', label: 'Kategorie' },
         { label: 'Betrag', format: r => euro(r.Betrag) }, { key: 'Beschreibung', label: 'Beschreibung' },
         { label: 'Beleg', format: r => r.BelegURL ? `<a href="${r.BelegURL}" target="_blank" class="text-blue-600 underline">Öffnen</a>` : '' }],
        kosten, { onDelete: async (row) => { await safeCall('tierkosten.delete', { id: row.ID }, 'Gelöscht.'); cacheRemove('tierkosten.list', row.ID); await reload(); } });

      renderTable(document.getElementById('tErloeseTable'),
        [{ label: 'Datum', format: r => fmtDate(r.Datum) }, { key: 'Art', label: 'Art' },
         { label: 'Betrag', format: r => euro(r.Betrag) }, { key: 'Beschreibung', label: 'Beschreibung' }],
        erloese, { onDelete: async (row) => { await safeCall('tiererloese.delete', { id: row.ID }, 'Gelöscht.'); cacheRemove('tiererloese.list', row.ID); await reload(); } });

      document.getElementById('tSaldo').textContent = 'Deckungsbeitrag: ' + euro(deckungsbeitragFuerTier(tier.ID));

      state.zuchtereignisse = zuchtAlle;
      renderTable(document.getElementById('tZuchtTable'),
        [
          { key: 'Typ', label: 'Typ' },
          { label: 'Datum', format: r => fmtDate(r.Datum) },
          { key: 'Vatertier', label: 'Vatertier' },
          { label: 'Vorauss. Abkalbung', format: r => fmtDate(r.VoraussichtlichesAbkalbedatum) },
          { label: 'Trockenstellen ab', format: r => fmtDate(r.TrockenstellenAb) }
        ],
        zuchtAlle.filter(z => z.TierID === tier.ID).sort((a, b) => new Date(b.Datum) - new Date(a.Datum)),
        { onDelete: async (row) => { await safeCall('zuchtereignisse.delete', { id: row.ID }, 'Gelöscht.'); cacheRemove('zuchtereignisse.list', row.ID); await reload(); } });
    };

    document.getElementById('btnNeuesZuchtereignis').onclick = () => openFormModal({
      title: 'Zuchtereignis erfassen',
      fields: [
        { key: 'Datum', label: 'Datum', type: 'date', required: true },
        { key: 'Typ', label: 'Typ', type: 'select', options: ['Besamung', 'Deckung', 'Abkalbung'] },
        { key: 'Vatertier', label: 'Vatertier / Bulle (optional)' },
        { key: 'Notiz', label: 'Notiz', type: 'textarea' }
      ],
      onSubmit: async (values) => {
        const saved = await safeCall('zuchtereignisse.create', { TierID: tier.ID, ...values }, 'Zuchtereignis erfasst.');
        cacheUpsert('zuchtereignisse.list', saved);
        await reload();
      }
    });

    document.getElementById('btnNeueTierKosten').onclick = () => openFormModal({
      title: 'Kosten erfassen',
      fields: [
        { key: 'Datum', label: 'Datum', type: 'date', required: true },
        { key: 'Kategorie', label: 'Kategorie', type: 'select', options: ['Kauf', 'Tierarzt', 'Futter', 'Besamung', 'Sonstiges'] },
        { key: 'Betrag', label: 'Betrag (€)', type: 'number', step: '0.01', required: true },
        { key: 'Beschreibung', label: 'Beschreibung' },
        { key: 'Beleg', label: 'Beleg-Foto/PDF', type: 'file', accept: 'image/*,.pdf' }
      ],
      onSubmit: async (values) => {
        let belegURL = '';
        if (values.Beleg) { const up = await Api.uploadFile(values.Beleg, 'tier'); belegURL = up.url; }
        const saved = await safeCall('tierkosten.create', { TierID: tier.ID, ...values, BelegURL: belegURL }, 'Kosten erfasst.');
        cacheUpsert('tierkosten.list', saved);
        await reload();
      }
    });

    document.getElementById('btnNeueTierErloes').onclick = () => openFormModal({
      title: 'Erlös erfassen',
      fields: [
        { key: 'Datum', label: 'Datum', type: 'date', required: true },
        { key: 'Art', label: 'Art', type: 'select', options: ['Verkauf', 'Schlachtung'] },
        { key: 'Betrag', label: 'Betrag (€)', type: 'number', step: '0.01', required: true },
        { key: 'Beschreibung', label: 'Beschreibung' }
      ],
      onSubmit: async (values) => {
        const saved = await safeCall('tiererloese.create', { TierID: tier.ID, ...values }, 'Erlös erfasst.');
        cacheUpsert('tiererloese.list', saved);
        await reload();
      }
    });

    await reload();
  });
}

// ============================================================================
// FUTTERMITTEL
// ============================================================================
const FUTTERMITTEL_KATEGORIEN = ['Heu', 'Silage', 'Grummet', 'Silomais', 'Kraftfutter', 'Stroh', 'Sonstiges'];
const FUTTERMITTEL_EINHEITEN = ['Ballen', 'kg', 'Tonnen'];

// Verbucht einen Ernteertrag (Schnitt oder Fruchtfolge-Ernte) automatisch als Zugang
// im passenden Futtermittel-Bestand - legt den Bestand bei Bedarf neu an.
async function wandereErtragInFuttermittel({ Bezeichnung, Kategorie, Einheit, Menge, HerkunftFlaecheID, Datum, Notiz }) {
  if (!Menge || Number(Menge) <= 0) return;
  // Für den Futtermittel-Bestand zählen wir nur noch in generischen Einheiten (Ballen/kg/Tonnen) -
  // die feinere Unterscheidung Rundballen/Quaderballen bleibt im Feldbuch-Datensatz erhalten.
  if (Einheit === 'Rundballen' || Einheit === 'Quaderballen') Einheit = 'Ballen';
  const futtermittel = await cachedList('futtermittel.list');
  let eintrag = futtermittel.find(f => f.Aktiv !== false && f.Bezeichnung.toLowerCase() === String(Bezeichnung).toLowerCase() && f.Einheit === Einheit);
  if (!eintrag) {
    eintrag = await safeCall('futtermittel.create', { Bezeichnung, Kategorie: Kategorie || 'Sonstiges', Einheit, BestandAktuell: 0 });
    cacheUpsert('futtermittel.list', eintrag);
  }
  await safeCall('futtermittelbewegungen.create', {
    FuttermittelID: eintrag.ID, Datum: Datum || new Date().toISOString().slice(0, 10),
    Typ: 'Zugang (Ernte)', Menge, HerkunftFlaecheID: HerkunftFlaecheID || '', Notiz: Notiz || ''
  });
  invalidateCache('futtermittelbewegungen.list');
  const aktualisiert = await safeCall('futtermittel.update', { id: eintrag.ID, BestandAktuell: Number(eintrag.BestandAktuell || 0) + Number(Menge) });
  cacheUpsert('futtermittel.list', aktualisiert);
  toast(`${Menge} ${Einheit || ''} ${Bezeichnung} zu Futtermittel hinzugefügt.`);
}

const FUTTERMITTEL_ICONS = { Heu: '🌾', Silage: '🌱', Grummet: '🌿', Silomais: '🌽', Kraftfutter: '🥣', Stroh: '🍂', Sonstiges: '📦' };

async function loadFuttermittelSection() {
  const { futtermittel, bewegungen } = await cachedBatch({
    futtermittel: { action: 'futtermittel.list' },
    bewegungen: { action: 'futtermittelbewegungen.list' }
  });
  state.futtermittel = futtermittel.filter(f => f.Aktiv !== false);

  const vor30Tagen = new Date(Date.now() - 30 * 86400000);
  const verbrauchProTag = (futtermittelId) => bewegungen
    .filter(b => b.FuttermittelID === futtermittelId && b.Typ === 'Verfüttert' && new Date(b.Datum) >= vor30Tagen)
    .reduce((sum, b) => sum + Number(b.Menge || 0), 0) / 30;

  const grid = document.getElementById('futtermittelTable');
  grid.innerHTML = state.futtermittel.map(f => {
    const knapp = f.MindestBestand && Number(f.BestandAktuell || 0) < Number(f.MindestBestand);
    const verbrauch = verbrauchProTag(f.ID);
    return `<div class="bg-white rounded-xl shadow p-4 space-y-2">
      <div class="flex items-center justify-between">
        <div class="font-semibold">${f.Bezeichnung}</div>
        <span class="text-2xl">${FUTTERMITTEL_ICONS[f.Kategorie] || '📦'}</span>
      </div>
      <div class="text-xs text-gray-500">${f.Kategorie || ''}</div>
      <div class="text-sm text-gray-600">Bestand: <b class="${knapp ? 'text-red-600' : ''}">${Number(f.BestandAktuell || 0).toFixed(1)} ${f.Einheit || ''}${knapp ? ' ⚠️' : ''}</b></div>
      ${f.MindestBestand ? `<div class="text-xs text-gray-400">Mindestbestand: ${f.MindestBestand} ${f.Einheit || ''}</div>` : ''}
      ${verbrauch > 0 ? `<div class="text-xs text-gray-400">Ø ${verbrauch.toFixed(1)} ${f.Einheit || ''}/Tag (30 Tage)</div>` : ''}
      <div class="flex gap-2 flex-wrap pt-2 border-t">
        <button data-id="${f.ID}" class="btn-futter-buchen text-xs bg-gray-100 hover:bg-gray-200 px-2 py-1 rounded">📉 Verbrauch/Verkauf</button>
        <button data-id="${f.ID}" class="btn-futter-verlauf text-xs bg-gray-100 hover:bg-gray-200 px-2 py-1 rounded">📜 Verlauf</button>
        <button data-id="${f.ID}" class="btn-futter-edit text-xs bg-gray-100 hover:bg-gray-200 px-2 py-1 rounded">Bearbeiten</button>
        ${state.user.role === 'Admin' ? `<button data-id="${f.ID}" class="btn-futter-delete text-xs text-red-600 hover:underline ml-auto">Löschen</button>` : ''}
      </div>
    </div>`;
  }).join('') || '<p class="text-gray-400">Noch kein Futtermittel-Bestand.</p>';

  grid.querySelectorAll('.btn-futter-buchen').forEach(b => {
    b.onclick = () => openFuttermittelBewegungModal(state.futtermittel.find(f => f.ID === b.dataset.id));
  });
  grid.querySelectorAll('.btn-futter-verlauf').forEach(b => {
    b.onclick = () => openFuttermittelVerlauf(state.futtermittel.find(f => f.ID === b.dataset.id));
  });
  grid.querySelectorAll('.btn-futter-edit').forEach(b => {
    b.onclick = () => openFuttermittelModal(state.futtermittel.find(f => f.ID === b.dataset.id));
  });
  grid.querySelectorAll('.btn-futter-delete').forEach(b => b.onclick = async () => {
    if (confirm('Futtermittel wirklich löschen?')) {
      await safeCall('futtermittel.delete', { id: b.dataset.id }, 'Gelöscht.');
      cacheRemove('futtermittel.list', b.dataset.id);
      await loadFuttermittelSection();
    }
  });

  document.getElementById('btnNeuesFuttermittel').onclick = () => openFuttermittelModal();
}

function openFuttermittelModal(initial = {}) {
  openFormModal({
    title: initial.ID ? 'Futtermittel bearbeiten' : 'Neuer Futtermittel-Bestand',
    fields: [
      { key: 'Bezeichnung', label: 'Bezeichnung (z.B. Kraftfutter, Heu, Stroh)', required: true },
      { key: 'Kategorie', label: 'Kategorie', type: 'select', options: FUTTERMITTEL_KATEGORIEN, required: true },
      { key: 'Einheit', label: 'Einheit', type: 'select', options: FUTTERMITTEL_EINHEITEN, required: true },
      { key: 'BestandAktuell', label: 'Bestand aktuell', type: 'number', step: '0.1', required: true },
      { key: 'MindestBestand', label: 'Mindestbestand (Warnung im Dashboard bei Unterschreitung)', type: 'number', step: '0.1' },
      { key: 'Notiz', label: 'Notiz', type: 'textarea' }
    ],
    initial: initial.ID ? initial : { BestandAktuell: 0 },
    onSubmit: async (values) => {
      const saved = initial.ID
        ? await safeCall('futtermittel.update', { id: initial.ID, ...values }, 'Aktualisiert.')
        : await safeCall('futtermittel.create', values, 'Futtermittel-Bestand angelegt.');
      cacheUpsert('futtermittel.list', saved);
      await loadFuttermittelSection();
    }
  });
}

function openFuttermittelBewegungModal(bestand) {
  openFormModal({
    title: `Verbrauch/Verkauf/Zugang: ${bestand.Bezeichnung} (${Number(bestand.BestandAktuell || 0).toFixed(1)} ${bestand.Einheit || ''} vorhanden)`,
    fields: [
      { key: 'Datum', label: 'Datum', type: 'date', required: true },
      { key: 'Typ', label: 'Typ', type: 'select', options: ['Verfüttert', 'Verkauft', 'Verlust', 'Zugang (Manuell)'], required: true },
      { key: 'Menge', label: `Menge (${bestand.Einheit || ''})`, type: 'number', step: '0.1', required: true },
      { key: 'Notiz', label: 'Notiz' }
    ],
    onSubmit: async (values) => {
      const istZugang = values.Typ === 'Zugang (Manuell)';
      const delta = istZugang ? Number(values.Menge) : -Number(values.Menge);
      if (!istZugang && Number(values.Menge) > Number(bestand.BestandAktuell || 0)) {
        toast('Menge übersteigt den aktuellen Bestand.', true);
        return;
      }
      await safeCall('futtermittelbewegungen.create', { FuttermittelID: bestand.ID, ...values }, 'Bewegung erfasst.');
      invalidateCache('futtermittelbewegungen.list');
      const saved = await safeCall('futtermittel.update', { id: bestand.ID, BestandAktuell: Number(bestand.BestandAktuell || 0) + delta });
      cacheUpsert('futtermittel.list', saved);
      await loadFuttermittelSection();
    }
  });
}

async function openFuttermittelVerlauf(bestand) {
  const alle = await cachedList('futtermittelbewegungen.list');
  const bewegungen = alle.filter(b => b.FuttermittelID === bestand.ID).sort((a, b) => new Date(b.Datum) - new Date(a.Datum));
  openDetailModal(`Verlauf: ${bestand.Bezeichnung}`, (body) => {
    renderTable(body,
      [
        { label: 'Datum', format: r => fmtDate(r.Datum) },
        { key: 'Typ', label: 'Typ' },
        { label: 'Menge', format: r => `${r.Menge} ${bestand.Einheit || ''}` },
        { key: 'Notiz', label: 'Notiz' }
      ],
      bewegungen, {});
  });
}

// ============================================================================
// WEINBAU & KELLERWIRTSCHAFT
// ============================================================================
document.querySelectorAll('.wtab-btn').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('.wtab-btn').forEach(x => {
    x.classList.toggle('border-green-700', x === b);
    x.classList.toggle('text-gray-500', x !== b);
  });
  document.querySelectorAll('.wtab-panel').forEach(p => p.classList.add('hidden'));
  document.getElementById('wtab-' + b.dataset.wtab).classList.remove('hidden');
}));

const WEINBAU_MASSNAHMEN = ['Rebschnitt', 'Biegen-Binden', 'Auslauben', 'Maehen-Mulchen', 'Netze-schliessen', 'Reifekontrolle', 'Pflanzenschutz', 'Sonstiges'];

// Näherungsweise gegenseitige Umrechnung Oechsle/Brix/KMW (übliche Faustformeln aus der
// Praxis, keine laborgenaue Umrechnung - reicht aber für die Lesezeitpunkt-Einschätzung).
// Oechsle ≈ Brix × 4.25, Oechsle ≈ KMW × 5.
function wireMostgewichtKonvertierung() {
  const feldOe = document.getElementById('field_Oechsle');
  const feldBrix = document.getElementById('field_Brix');
  const feldKmw = document.getElementById('field_KMW');
  if (!feldOe || !feldBrix || !feldKmw) return;
  const aktualisiere = (quelle) => {
    if (quelle === feldOe && feldOe.value !== '') {
      const oe = Number(feldOe.value);
      feldBrix.value = (oe / 4.25).toFixed(1);
      feldKmw.value = (oe / 5).toFixed(1);
    } else if (quelle === feldBrix && feldBrix.value !== '') {
      const brix = Number(feldBrix.value);
      feldOe.value = (brix * 4.25).toFixed(1);
      feldKmw.value = (brix * 4.25 / 5).toFixed(1);
    } else if (quelle === feldKmw && feldKmw.value !== '') {
      const kmw = Number(feldKmw.value);
      feldOe.value = (kmw * 5).toFixed(1);
      feldBrix.value = (kmw * 5 / 4.25).toFixed(1);
    }
  };
  [feldOe, feldBrix, feldKmw].forEach(f => f.addEventListener('input', () => aktualisiere(f)));
}

// Bewässerungsempfehlung je Rebanlage anhand der letzten 5 Tage (Open-Meteo, ein
// gebündelter Request für alle Rebanlagen gleichzeitig statt eines Requests pro Zeile).
async function berechneBewaesserungsempfehlung(rows) {
  const ergebnis = {};
  const mitGeometrie = rows.map(r => {
    if (!r.GeoJSON) return null;
    try { return { id: r.ID, centroid: computeCentroid(JSON.parse(r.GeoJSON)) }; } catch (e) { return null; }
  }).filter(Boolean);
  if (!mitGeometrie.length) return ergebnis;
  try {
    const lats = mitGeometrie.map(m => m.centroid.lat.toFixed(4)).join(',');
    const lngs = mitGeometrie.map(m => m.centroid.lng.toFixed(4)).join(',');
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lngs}&daily=precipitation_sum,et0_fao_evapotranspiration&past_days=5&forecast_days=1&timezone=auto`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Wetterdienst nicht erreichbar');
    const data = await res.json();
    // Bei genau einer Koordinate liefert Open-Meteo ein einzelnes Objekt statt eines Arrays
    const liste = Array.isArray(data) ? data : [data];
    mitGeometrie.forEach((m, i) => {
      const d = liste[i];
      if (!d || !d.daily) return;
      const niederschlag5 = d.daily.precipitation_sum.slice(0, 5).reduce((sum, v) => sum + (v || 0), 0);
      const verdunstung5 = d.daily.et0_fao_evapotranspiration.slice(0, 5).reduce((sum, v) => sum + (v || 0), 0);
      const bewaessern = niederschlag5 < 5 && verdunstung5 > niederschlag5 + 10;
      ergebnis[m.id] = bewaessern
        ? `💧 Bewässern empfohlen (${niederschlag5.toFixed(0)}mm Regen / ${verdunstung5.toFixed(0)}mm Verdunstung, 5 Tage)`
        : `✅ Kein Bedarf (${niederschlag5.toFixed(0)}mm Regen, 5 Tage)`;
    });
  } catch (e) { /* Wetterdienst nicht erreichbar - Spalte bleibt leer, kein Blocker für die restliche Anzeige */ }
  return ergebnis;
}

async function loadWeinbauSection() {
  const { subflaechen, flaechen } = await cachedBatch({
    subflaechen: { action: 'subflaechen.list' },
    flaechen: { action: 'flaechen.list' }
  });
  state.subflaechen = subflaechen.filter(s => s.Aktiv !== false);
  state.flaechen = flaechen;

  // Manche Betriebe zeichnen einen Weingarten direkt als eigene Fläche (Nutzungsart
  // Weinbau/Obstbau) statt als SubFläche über den "Rebanlagen"-Button - solche Flächen
  // sollen hier trotzdem als Rebanlage auftauchen (nur wenn nicht bereits in SubFlächen
  // unterteilt, sonst gäbe es die Parzelle doppelt: einmal ganz, einmal in Teilen).
  const flaechenOhneSubflaeche = flaechen.filter(f =>
    f.Aktiv !== false && DAUERKULTUR_NUTZUNGSARTEN.includes(f.Nutzungsart) &&
    !state.subflaechen.some(s => s.FlaecheID === f.ID));
  const rebanlagenAnzeige = [
    ...state.subflaechen.map(s => ({ ...s, _istEigeneFlaeche: false })),
    ...flaechenOhneSubflaeche.map(f => ({
      ID: f.ID, Name: f.Name, FlaecheID: null, Rebsorte: f.Rebsorte,
      FlaecheM2: Number(f.FlaecheHa || 0) * 10000, AnzahlPflanzen: f.AnzahlPflanzen,
      Pflanzjahr: null, GeoJSON: f.GeoJSON, _istEigeneFlaeche: true
    }))
  ];
  state.rebanlagenAnzeige = rebanlagenAnzeige;

  const bewaesserung = await berechneBewaesserungsempfehlung(rebanlagenAnzeige);

  const rebanlagenGrid = document.getElementById('rebanlagenTable');
  rebanlagenGrid.innerHTML = rebanlagenAnzeige.map(r => `
    <div class="bg-white rounded-xl shadow p-4 space-y-2">
      <div class="flex items-center justify-between">
        <div class="font-semibold">${r.Name}</div>
        <span class="text-2xl">🍇</span>
      </div>
      <div class="text-xs text-gray-500">${r._istEigeneFlaeche ? '(eigene Parzelle)' : ((state.flaechen.find(f => f.ID === r.FlaecheID) || {}).Name || '-')}</div>
      <div class="text-sm text-gray-600">${r.Rebsorte || 'Sorte unbekannt'} · ${Number(r.FlaecheM2 || 0).toFixed(0)} m²${r.AnzahlPflanzen ? ` · ${r.AnzahlPflanzen} Pflanzen` : ''}</div>
      <div class="text-xs text-gray-400">${computeStandjahr(r.Pflanzjahr).label}</div>
      <div class="text-sm">💧 ${bewaesserung[r.ID] || 'keine Wetterdaten'}</div>
      <div class="flex gap-2 flex-wrap pt-2 border-t">
        <button data-id="${r.ID}" class="btn-rebanlage-detail text-xs bg-gray-100 hover:bg-gray-200 px-2 py-1 rounded">Pflege/Reife/Ernte</button>
      </div>
    </div>`).join('') || '<p class="text-gray-400">Noch keine Rebanlagen angelegt.</p>';

  rebanlagenGrid.querySelectorAll('.btn-rebanlage-detail').forEach(b => {
    b.onclick = () => openRebanlageDetail(rebanlagenAnzeige.find(s => s.ID === b.dataset.id));
  });

  await loadKellerTab();
  await loadFlaschenlagerTab();
}

async function loadFlaschenlagerTab() {
  const bestand = await cachedList('flaschenbestand.list');
  state.flaschenbestand = bestand.filter(b => b.Aktiv !== false);

  const grid = document.getElementById('flaschenlagerTable');
  grid.innerHTML = state.flaschenbestand.map(f => `
    <div class="bg-white rounded-xl shadow overflow-hidden space-y-2">
      ${f.FotoURL ? `<img src="${f.FotoURL}" class="w-full h-32 object-cover" alt="">` : `<div class="w-full h-16 bg-gray-100 flex items-center justify-center text-3xl">🍾</div>`}
      <div class="p-4 pt-0 space-y-2">
        <div class="font-semibold">${f.Bezeichnung}</div>
        <div class="text-xs text-gray-500">${f.Sorte || ''} ${f.Jahrgang || ''} · ${f.FlaschenGroesseMl || ''} ml</div>
        <div class="text-sm text-gray-600">Bestand: <b>${f.AnzahlAktuell}</b> Flaschen</div>
        <div class="flex gap-2 flex-wrap pt-2 border-t">
          <button data-id="${f.ID}" class="btn-flasche-austragen text-xs bg-gray-100 hover:bg-gray-200 px-2 py-1 rounded">📤 Austragen</button>
          <button data-id="${f.ID}" class="btn-flasche-edit text-xs bg-gray-100 hover:bg-gray-200 px-2 py-1 rounded">Bearbeiten</button>
          ${state.user.role === 'Admin' ? `<button data-id="${f.ID}" class="btn-flasche-delete text-xs text-red-600 hover:underline ml-auto">Löschen</button>` : ''}
        </div>
      </div>
    </div>`).join('') || '<p class="text-gray-400">Noch kein Flaschenbestand.</p>';

  grid.querySelectorAll('.btn-flasche-austragen').forEach(b => {
    b.onclick = () => openFlaschenAustragModal(state.flaschenbestand.find(f => f.ID === b.dataset.id));
  });
  grid.querySelectorAll('.btn-flasche-edit').forEach(b => {
    b.onclick = () => openFlaschenbestandModal(state.flaschenbestand.find(f => f.ID === b.dataset.id));
  });
  grid.querySelectorAll('.btn-flasche-delete').forEach(b => b.onclick = async () => {
    if (confirm('Flaschenbestand wirklich löschen?')) {
      await safeCall('flaschenbestand.delete', { id: b.dataset.id }, 'Gelöscht.');
      cacheRemove('flaschenbestand.list', b.dataset.id);
      await loadFlaschenlagerTab();
    }
  });

  const btnNeu = document.getElementById('btnNeuesFlaschenbestand');
  if (btnNeu) btnNeu.onclick = () => openFlaschenbestandModal();
}

function openFlaschenbestandModal(initial = {}) {
  openFormModal({
    title: initial.ID ? 'Flaschenbestand bearbeiten' : 'Flaschenbestand manuell anlegen',
    fields: [
      { key: 'Bezeichnung', label: 'Bezeichnung (z.B. Vernatsch 2025)', required: true },
      { key: 'Sorte', label: 'Sorte' },
      { key: 'Jahrgang', label: 'Jahrgang', type: 'number' },
      { key: 'FlaschenGroesseMl', label: 'Flaschengröße (ml)', type: 'number', required: true },
      { key: 'AnzahlAktuell', label: 'Anzahl Flaschen', type: 'number', required: true },
      { key: 'Foto', label: 'Etikett-Foto (ersetzt vorhandenes Foto)', type: 'file', accept: 'image/*' },
      { key: 'Notiz', label: 'Notiz', type: 'textarea' }
    ],
    initial: initial.ID ? initial : { FlaschenGroesseMl: 750, AnzahlAktuell: 0 },
    onSubmit: async (values) => {
      const payload = { ...values };
      delete payload.Foto;
      if (values.Foto) {
        const up = await Api.uploadFile(values.Foto, 'flasche');
        payload.FotoURL = up.url;
      }
      const saved = initial.ID
        ? await safeCall('flaschenbestand.update', { id: initial.ID, ...payload }, 'Aktualisiert.')
        : await safeCall('flaschenbestand.create', payload, 'Flaschenbestand angelegt.');
      cacheUpsert('flaschenbestand.list', saved);
      await loadFlaschenlagerTab();
    }
  });
}

function openFlaschenAustragModal(bestand) {
  openFormModal({
    title: `Austragen: ${bestand.Bezeichnung} (${bestand.AnzahlAktuell} Flaschen vorhanden)`,
    fields: [
      { key: 'Datum', label: 'Datum', type: 'date', required: true },
      { key: 'Typ', label: 'Typ', type: 'select', options: ['Eigenbedarf', 'Verkauf'], required: true },
      { key: 'Anzahl', label: 'Anzahl Flaschen', type: 'number', required: true },
      { key: 'Erloes', label: 'Erlös (€, nur bei Verkauf)', type: 'number', step: '0.01' },
      { key: 'Notiz', label: 'Notiz' }
    ],
    onSubmit: async (values) => {
      if (Number(values.Anzahl) > Number(bestand.AnzahlAktuell || 0)) {
        toast('Anzahl übersteigt den aktuellen Bestand.', true);
        return;
      }
      await safeCall('flaschenbewegungen.create', { FlaschenbestandID: bestand.ID, ...values }, 'Austrag erfasst.');
      invalidateCache('flaschenbewegungen.list');
      const saved = await safeCall('flaschenbestand.update', { id: bestand.ID, AnzahlAktuell: Number(bestand.AnzahlAktuell || 0) - Number(values.Anzahl) });
      cacheUpsert('flaschenbestand.list', saved);
      if (values.Typ === 'Verkauf' && Number(values.Erloes) > 0) {
        const erntevermarktung = await safeCall('erntevermarktung.create', {
          Datum: values.Datum, Kategorie: 'Wein', Menge: values.Anzahl, Einheit: 'Flaschen',
          Erloes: values.Erloes, Beschreibung: `Verkauf ${bestand.Bezeichnung}` + (values.Notiz ? ` — ${values.Notiz}` : '')
        }, 'Erlös in Finanzen erfasst.');
        cacheUpsert('erntevermarktung.list', erntevermarktung);
      }
      await loadFlaschenlagerTab();
    }
  });
}

function openRebanlageDetail(subFlaeche) {
  openDetailModal(`Rebanlage: ${subFlaeche.Name}`, async (body) => {
    body.innerHTML = `
      <div class="flex gap-2 border-b">
        <button data-rtab="pflege" class="rtab-btn px-3 py-2 text-sm font-medium border-b-2 border-green-700">Pflegetagebuch</button>
        <button data-rtab="reife" class="rtab-btn px-3 py-2 text-sm font-medium border-b-2 border-transparent text-gray-500">Reifemessungen</button>
        <button data-rtab="ernte" class="rtab-btn px-3 py-2 text-sm font-medium border-b-2 border-transparent text-gray-500">Ernte</button>
      </div>
      <div id="rtab-pflege" class="rtab-panel space-y-2">
        <div class="flex flex-wrap gap-1">
          ${WEINBAU_MASSNAHMEN.map(m => `<button data-m="${m}" class="btn-checkliste text-xs bg-green-50 hover:bg-green-100 text-green-800 px-2 py-1 rounded">+ ${m.replace('-', '/')}</button>`).join('')}
        </div>
        <div id="pflegeTable"></div>
      </div>
      <div id="rtab-reife" class="rtab-panel hidden space-y-2">
        <div id="reifeTable"></div>
        <button id="btnNeueReifemessung" class="bg-green-700 text-white px-3 py-2 rounded text-sm">+ Messung erfassen</button>
      </div>
      <div id="rtab-ernte" class="rtab-panel hidden space-y-2">
        <div id="ernteTable"></div>
        <button id="btnNeueErnte" class="bg-green-700 text-white px-3 py-2 rounded text-sm">+ Lese erfassen</button>
      </div>`;

    body.querySelectorAll('.rtab-btn').forEach(b => b.addEventListener('click', () => {
      body.querySelectorAll('.rtab-btn').forEach(x => { x.classList.toggle('border-green-700', x === b); x.classList.toggle('text-gray-500', x !== b); });
      body.querySelectorAll('.rtab-panel').forEach(p => p.classList.add('hidden'));
      body.querySelector('#rtab-' + b.dataset.rtab).classList.remove('hidden');
    }));

    const reloadPflege = async () => {
      const alle = await cachedList('weinbaumassnahmen.list');
      renderTable(document.getElementById('pflegeTable'),
        [{ label: 'Datum', format: r => fmtDate(r.Datum) }, { key: 'Massnahme', label: 'Maßnahme' },
         { label: 'Bio', format: r => r.Bio ? '✅' : '' }, { key: 'Mittel', label: 'Mittel' }, { key: 'Notiz', label: 'Notiz' }],
        alle.filter(m => m.SubFlaecheID === subFlaeche.ID).sort((a, b) => new Date(b.Datum) - new Date(a.Datum)),
        { onDelete: async (row) => { await safeCall('weinbaumassnahmen.delete', { id: row.ID }, 'Gelöscht.'); cacheRemove('weinbaumassnahmen.list', row.ID); await reloadPflege(); } });
    };

    body.querySelectorAll('.btn-checkliste').forEach(b => b.onclick = () => openFormModal({
      title: `Maßnahme: ${b.dataset.m.replace('-', '/')}`,
      fields: [
        { key: 'Datum', label: 'Datum', type: 'date', required: true },
        { key: 'Bio', label: 'Bio-konform', type: 'checkbox' },
        { key: 'Mittel', label: 'Mittel (bei Pflanzenschutz/Stärkung)' },
        { key: 'Notiz', label: 'Notiz', type: 'textarea' }
      ],
      onSubmit: async (values) => {
        const saved = await safeCall('weinbaumassnahmen.create', { SubFlaecheID: subFlaeche.ID, Massnahme: b.dataset.m, ...values }, 'Maßnahme erfasst.');
        cacheUpsert('weinbaumassnahmen.list', saved);
        await reloadPflege();
      }
    }));

    const reloadReife = async () => {
      const alle = await cachedList('reifemessungen.list');
      renderTable(document.getElementById('reifeTable'),
        [{ label: 'Datum', format: r => fmtDate(r.Datum) }, { key: 'Oechsle', label: '°Oechsle' }, { key: 'Brix', label: '°Brix' }, { key: 'KMW', label: '°KMW' }, { key: 'Saeure', label: 'Säure' }, { key: 'PH', label: 'pH' }],
        alle.filter(m => m.SubFlaecheID === subFlaeche.ID).sort((a, b) => new Date(b.Datum) - new Date(a.Datum)),
        { onDelete: async (row) => { await safeCall('reifemessungen.delete', { id: row.ID }, 'Gelöscht.'); cacheRemove('reifemessungen.list', row.ID); await reloadReife(); } });
    };
    document.getElementById('btnNeueReifemessung').onclick = () => {
      openFormModal({
        title: 'Reifemessung erfassen',
        fields: [
          { key: 'Datum', label: 'Datum', type: 'date', required: true },
          { key: 'Oechsle', label: '°Oechsle', type: 'number', step: '0.1', help: 'Eines der drei Felder eintragen - die anderen werden automatisch (näherungsweise) umgerechnet.' },
          { key: 'Brix', label: '°Brix', type: 'number', step: '0.1' },
          { key: 'KMW', label: '°KMW', type: 'number', step: '0.1' },
          { key: 'Saeure', label: 'Säure (g/l)', type: 'number', step: '0.1' },
          { key: 'PH', label: 'pH-Wert', type: 'number', step: '0.01' },
          { key: 'Notiz', label: 'Notiz' }
        ],
        onSubmit: async (values) => {
          const saved = await safeCall('reifemessungen.create', { SubFlaecheID: subFlaeche.ID, ...values }, 'Messung erfasst.');
          cacheUpsert('reifemessungen.list', saved);
          await reloadReife();
        }
      });
      wireMostgewichtKonvertierung();
    };

    const reloadErnte = async () => {
      const alle = await cachedList('weinlese.list');
      renderTable(document.getElementById('ernteTable'),
        [{ label: 'Datum', format: r => fmtDate(r.Datum) }, { label: 'Menge', format: r => `${r.MengeKg || 0} kg` }, { key: 'MostgewichtOechsle', label: 'Mostgewicht (°Oe)' }],
        alle.filter(m => m.SubFlaecheID === subFlaeche.ID).sort((a, b) => new Date(b.Datum) - new Date(a.Datum)),
        { onDelete: async (row) => { await safeCall('weinlese.delete', { id: row.ID }, 'Gelöscht.'); cacheRemove('weinlese.list', row.ID); await reloadErnte(); } });
    };
    document.getElementById('btnNeueErnte').onclick = () => openFormModal({
      title: 'Weinlese erfassen',
      fields: [
        { key: 'Datum', label: 'Lese-Datum', type: 'date', required: true },
        { key: 'MengeKg', label: 'Gesamtmenge (kg)', type: 'number', step: '0.1', required: true },
        { key: 'MostgewichtOechsle', label: 'Durchschnittliches Mostgewicht (°Oe)', type: 'number', step: '0.1' },
        { key: 'Notiz', label: 'Notiz' }
      ],
      onSubmit: async (values) => {
        const saved = await safeCall('weinlese.create', { SubFlaecheID: subFlaeche.ID, ...values }, 'Ernte erfasst.');
        cacheUpsert('weinlese.list', saved);
        await reloadErnte();
      }
    });

    await reloadPflege(); await reloadReife(); await reloadErnte();
  });
}

async function loadKellerTab() {
  const tanks = await cachedList('tanks.list');
  state.tanks = tanks.filter(t => t.Aktiv !== false);

  document.getElementById('tanksGrid').innerHTML = state.tanks.map(t => {
    const fuellstand = t.VolumenLiter > 0 ? Math.min(100, Number(t.AktuellerInhaltLiter || 0) / Number(t.VolumenLiter) * 100) : 0;
    return `<div class="bg-white rounded-xl shadow p-4 space-y-2">
      <div class="font-semibold">${t.Bezeichnung}</div>
      <div class="text-xs text-gray-500">${t.Sorte || ''} ${t.Jahrgang || ''}</div>
      <div class="w-full bg-gray-100 rounded h-3"><div class="bg-purple-500 h-3 rounded" style="width:${fuellstand.toFixed(0)}%"></div></div>
      <div class="text-sm text-gray-600">${Number(t.AktuellerInhaltLiter || 0).toFixed(0)} / ${Number(t.VolumenLiter || 0).toFixed(0)} l</div>
      <div class="flex gap-2 flex-wrap pt-2 border-t">
        <button data-id="${t.ID}" class="btn-tank-edit text-xs bg-gray-100 hover:bg-gray-200 px-2 py-1 rounded">Bearbeiten</button>
        <button data-id="${t.ID}" class="btn-tank-log text-xs bg-gray-100 hover:bg-gray-200 px-2 py-1 rounded">Logbuch</button>
        <button data-id="${t.ID}" class="btn-tank-abfuellen text-xs bg-gray-100 hover:bg-gray-200 px-2 py-1 rounded">Abfüllen</button>
        ${state.user.role === 'Admin' ? `<button data-id="${t.ID}" class="btn-tank-delete text-xs text-red-600 hover:underline ml-auto">Löschen</button>` : ''}
      </div>
    </div>`;
  }).join('') || '<p class="text-gray-400">Noch keine Tanks angelegt.</p>';

  document.getElementById('tanksGrid').querySelectorAll('.btn-tank-edit').forEach(b => b.onclick = () => openTankModal(state.tanks.find(t => t.ID === b.dataset.id)));
  document.getElementById('tanksGrid').querySelectorAll('.btn-tank-delete').forEach(b => b.onclick = async () => {
    if (confirm('Tank wirklich löschen?')) {
      await safeCall('tanks.delete', { id: b.dataset.id }, 'Gelöscht.');
      cacheRemove('tanks.list', b.dataset.id);
      await loadKellerTab();
    }
  });
  document.getElementById('tanksGrid').querySelectorAll('.btn-tank-log').forEach(b => b.onclick = () => openKellerLogbuchDetail(state.tanks.find(t => t.ID === b.dataset.id)));
  document.getElementById('tanksGrid').querySelectorAll('.btn-tank-abfuellen').forEach(b => b.onclick = () => openAbfuellungModal(state.tanks.find(t => t.ID === b.dataset.id)));

  document.getElementById('btnNeuerTank').onclick = () => openTankModal();
}

function openTankModal(initial = {}) {
  openFormModal({
    title: initial.ID ? 'Tank bearbeiten' : 'Neuer Tank',
    fields: [
      { key: 'Bezeichnung', label: 'Bezeichnung', required: true },
      { key: 'VolumenLiter', label: 'Volumen (Liter)', type: 'number', required: true },
      { key: 'AktuellerInhaltLiter', label: 'Aktueller Inhalt (Liter)', type: 'number' },
      { key: 'Sorte', label: 'Sorte' },
      { key: 'Jahrgang', label: 'Jahrgang', type: 'number' },
      { key: 'Notiz', label: 'Notiz', type: 'textarea' }
    ],
    initial,
    onSubmit: async (values) => {
      const saved = initial.ID
        ? await safeCall('tanks.update', { id: initial.ID, ...values }, 'Aktualisiert.')
        : await safeCall('tanks.create', values, 'Tank angelegt.');
      cacheUpsert('tanks.list', saved);
      await loadKellerTab();
    }
  });
}

function openKellerLogbuchDetail(tank) {
  openDetailModal(`Logbuch: ${tank.Bezeichnung}`, async (body) => {
    body.innerHTML = `<button id="btnNeuerLogEintrag" class="bg-green-700 text-white px-3 py-2 rounded text-sm mb-2">+ Eintrag</button><div id="logTable"></div>`;
    const reload = async () => {
      const alle = await cachedList('kellerlogbuch.list');
      renderTable(document.getElementById('logTable'),
        [{ label: 'Datum', format: r => fmtDate(r.Datum) }, { key: 'Aktion', label: 'Aktion' },
         { label: 'Mostgewicht', format: r => [r.Oechsle && `${r.Oechsle}°Oe`, r.Brix && `${r.Brix}°Brix`, r.KMW && `${r.KMW}°KMW`].filter(Boolean).join(' / ') || '-' },
         { key: 'RestzuckerGL', label: 'Restzucker (g/l)' },
         { label: 'Verbleibend', format: r => r.VerbleibendLiter ? `${r.VerbleibendLiter} l` : '-' },
         { key: 'Notiz', label: 'Notiz' }],
        alle.filter(l => l.TankID === tank.ID).sort((a, b) => new Date(b.Datum) - new Date(a.Datum)),
        { onDelete: async (row) => { await safeCall('kellerlogbuch.delete', { id: row.ID }, 'Gelöscht.'); cacheRemove('kellerlogbuch.list', row.ID); await reload(); } });
    };
    document.getElementById('btnNeuerLogEintrag').onclick = () => {
      openFormModal({
        title: 'Logbuch-Eintrag',
        fields: [
          { key: 'Datum', label: 'Datum', type: 'date', required: true },
          { key: 'Aktion', label: 'Aktion', type: 'select', options: ['Schwefelung', 'Abstich', 'Stabilisierung', 'Filtration', 'Sonstiges'] },
          { key: 'Oechsle', label: '°Oechsle', type: 'number', step: '0.1', help: 'Eines der drei Felder eintragen - die anderen werden automatisch (näherungsweise) umgerechnet.' },
          { key: 'Brix', label: '°Brix', type: 'number', step: '0.1' },
          { key: 'KMW', label: '°KMW', type: 'number', step: '0.1' },
          { key: 'RestzuckerGL', label: 'Restzucker (g/l)', type: 'number', step: '0.1' },
          { key: 'VerbleibendLiter', label: 'Nur bei Abstich: verbleibend im Fass (Liter, Rest gilt als entsorgt)', type: 'number', step: '1' },
          { key: 'Notiz', label: 'Notiz', type: 'textarea' }
        ],
        onSubmit: async (values) => {
          const saved = await safeCall('kellerlogbuch.create', { TankID: tank.ID, ...values }, 'Eintrag gespeichert.');
          cacheUpsert('kellerlogbuch.list', saved);
          if (values.Aktion === 'Abstich' && values.VerbleibendLiter !== '') {
            const aktualisierterTank = await safeCall('tanks.update', { id: tank.ID, AktuellerInhaltLiter: Number(values.VerbleibendLiter) }, 'Fassinhalt aktualisiert.');
            cacheUpsert('tanks.list', aktualisierterTank);
            tank.AktuellerInhaltLiter = aktualisierterTank.AktuellerInhaltLiter;
            await loadKellerTab();
          }
          await reload();
        }
      });
      wireMostgewichtKonvertierung();
    };
    await reload();
  });
}

function openAbfuellungModal(tank) {
  openFormModal({
    title: `Abfüllung: ${tank.Bezeichnung}`,
    fields: [
      { key: 'Datum', label: 'Datum', type: 'date', required: true },
      { key: 'FlaschenAnzahl', label: 'Flaschenanzahl', type: 'number', required: true },
      { key: 'FlaschenGroesseMl', label: 'Flaschengröße (ml)', type: 'number', required: true, help: 'z.B. 750' },
      { key: 'Charge', label: 'Charge/Los-Bezeichnung' },
      { key: 'Notiz', label: 'Notiz' }
    ],
    onSubmit: async (values) => {
      await safeCall('abfuellungen.create', { TankID: tank.ID, ...values }, 'Abfüllung erfasst - Tank geleert, Flaschenbestand aktualisiert.');
      // Backend leert den Tank vollständig und legt/erhöht automatisch den passenden
      // Flaschenbestand - da wir dessen Rückgabewerte hier nicht direkt bekommen,
      // betroffene Caches invalidieren statt veraltete Werte lokal nachzurechnen.
      const cachedTank = (listCache['tanks.list'] || []).find(t => t.ID === tank.ID);
      if (cachedTank) cachedTank.AktuellerInhaltLiter = 0;
      invalidateCache('flaschenbestand.list');
      await loadKellerTab();
      await loadFlaschenlagerTab();
    }
  });
}

// ============================================================================
// FINANZEN
// ============================================================================
function jahrVon(datum) {
  const d = new Date(datum);
  return isNaN(d) ? null : d.getFullYear();
}

function deckungsbeitragFuerTierJahr(tierId, jahr) {
  const kosten = state.tierkosten.filter(k => k.TierID === tierId && jahrVon(k.Datum) === jahr).reduce((s, k) => s + Number(k.Betrag || 0), 0);
  const erloese = state.tiererloese.filter(k => k.TierID === tierId && jahrVon(k.Datum) === jahr).reduce((s, k) => s + Number(k.Betrag || 0), 0);
  return erloese - kosten;
}

async function loadFinanzenSection() {
  const { maschinenkosten, tierkosten, tiererloese, allgemeinekosten, erntevermarktung, maschinen, tiere } = await cachedBatch({
    maschinenkosten: { action: 'maschinenkosten.list' },
    tierkosten: { action: 'tierkosten.list' },
    tiererloese: { action: 'tiererloese.list' },
    allgemeinekosten: { action: 'allgemeinekosten.list' },
    erntevermarktung: { action: 'erntevermarktung.list' },
    maschinen: { action: 'maschinen.list' },
    tiere: { action: 'tiere.list' }
  });
  state.maschinenkosten = maschinenkosten;
  state.tierkosten = tierkosten;
  state.tiererloese = tiererloese;
  state.allgemeinekosten = allgemeinekosten;
  state.erntevermarktung = erntevermarktung;
  state.maschinen = maschinen;
  state.tiere = tiere;

  populateFinanzenJahrDropdown();
  renderFinanzen();

  document.getElementById('finanzenJahr').onchange = renderFinanzen;
  document.getElementById('finanzenAnschaffungToggle').onchange = renderFinanzen;
  document.getElementById('tierAuswertungModus').onchange = renderFinanzen;

  document.getElementById('btnNeueAllgemeineKosten').onclick = () => openAllgemeineKostenModal();
  document.getElementById('btnNeueErntevermarktung').onclick = () => openErntevermarktungModal();
}

function populateFinanzenJahrDropdown() {
  const alleJahre = new Set([new Date().getFullYear()]);
  [...state.maschinenkosten, ...state.tierkosten, ...state.tiererloese, ...state.allgemeinekosten, ...state.erntevermarktung]
    .forEach(r => { const j = jahrVon(r.Datum); if (j) alleJahre.add(j); });
  const jahre = [...alleJahre].sort((a, b) => b - a);
  const sel = document.getElementById('finanzenJahr');
  const bisher = sel.value;
  sel.innerHTML = jahre.map(j => `<option value="${j}">${j}</option>`).join('');
  sel.value = jahre.map(String).includes(bisher) ? bisher : String(jahre[0]);
}

function renderFinanzen() {
  const jahr = Number(document.getElementById('finanzenJahr').value);
  const mitAnschaffung = document.getElementById('finanzenAnschaffungToggle').checked;
  const modus = document.getElementById('tierAuswertungModus').value;
  const inJahr = r => jahrVon(r.Datum) === jahr;
  const sum = (rows, feld) => rows.reduce((s, r) => s + Number(r[feld || 'Betrag'] || 0), 0);

  const maschinenKostenJahr = state.maschinenkosten.filter(inJahr);
  const tierKostenJahr = state.tierkosten.filter(inJahr);
  const tierErloeseJahr = state.tiererloese.filter(inJahr);
  const allgemeineKostenJahr = state.allgemeinekosten.filter(inJahr);
  const erntevermarktungJahr = state.erntevermarktung.filter(inJahr);

  const anschaffungSumme = mitAnschaffung
    ? state.maschinen.filter(m => jahrVon(m.Anschaffungsdatum) === jahr).reduce((s, m) => s + Number(m.Anschaffungspreis || 0), 0)
    : 0;

  const kostenGesamt = sum(maschinenKostenJahr) + sum(tierKostenJahr) + sum(allgemeineKostenJahr) + anschaffungSumme;
  const erloeseGesamt = sum(tierErloeseJahr) + sum(erntevermarktungJahr, 'Erloes');

  document.getElementById('finanzenCards').innerHTML = `
    <div class="bg-white rounded-xl shadow p-4"><div class="text-gray-500 text-sm">Kosten ${jahr}${mitAnschaffung ? ' (inkl. Anschaffungen)' : ''}</div><div class="text-xl font-bold text-red-700">${euro(kostenGesamt)}</div></div>
    <div class="bg-white rounded-xl shadow p-4"><div class="text-gray-500 text-sm">Erlöse ${jahr}</div><div class="text-xl font-bold text-green-700">${euro(erloeseGesamt)}</div></div>
    <div class="bg-white rounded-xl shadow p-4"><div class="text-gray-500 text-sm">Saldo ${jahr}</div><div class="text-xl font-bold">${euro(erloeseGesamt - kostenGesamt)}</div></div>`;

  const bars = [
    ['Maschinenkosten', sum(maschinenKostenJahr), 'bg-red-500'],
    ['Tierkosten', sum(tierKostenJahr), 'bg-red-400'],
    ['Allgemeine Kosten', sum(allgemeineKostenJahr), 'bg-red-300']
  ];
  if (mitAnschaffung) bars.push(['Maschinen-Anschaffungen', anschaffungSumme, 'bg-red-700']);
  bars.push(['Tiererlöse', sum(tierErloeseJahr), 'bg-green-500']);
  bars.push(['Erntevermarktung', sum(erntevermarktungJahr, 'Erloes'), 'bg-green-400']);

  const max = Math.max(...bars.map(b => b[1]), 1);
  document.getElementById('finanzenBars').innerHTML = bars.map(([label, val, color]) => `
    <div>
      <div class="flex justify-between text-sm mb-1"><span>${label}</span><span>${euro(val)}</span></div>
      <div class="w-full bg-gray-100 rounded h-3"><div class="${color} h-3 rounded" style="width:${(val / max * 100).toFixed(1)}%"></div></div>
    </div>`).join('') + `<div class="pt-2 font-bold">Saldo ${jahr}: ${euro(erloeseGesamt - kostenGesamt)}</div>`;

  document.getElementById('deckungsbeitragTitel').textContent =
    modus === 'jahr' ? `Tier-Auswertung ${jahr} (Jahresbilanz)` : 'Deckungsbeitrag je Tier (Lebenszyklus, gesamt)';
  renderTable(document.getElementById('deckungsbeitragTable'),
    [
      { label: 'Tier', format: r => `${r.Name || ''} (${r.Ohrmarke || '-'})` },
      { key: 'Tierart', label: 'Tierart' },
      { key: 'Status', label: 'Status' },
      {
        label: modus === 'jahr' ? `Bilanz ${jahr}` : 'Deckungsbeitrag',
        format: r => euro(modus === 'jahr' ? deckungsbeitragFuerTierJahr(r.ID, jahr) : deckungsbeitragFuerTier(r.ID))
      }
    ], state.tiere, {});

  renderTable(document.getElementById('allgemeineKostenTable'),
    [
      { label: 'Datum', format: r => fmtDate(r.Datum) }, { key: 'Kategorie', label: 'Kategorie' },
      { label: 'Menge', format: r => r.MengeLiter ? `${r.MengeLiter} l` : '' },
      { label: 'Betrag', format: r => euro(r.Betrag) }, { key: 'Beschreibung', label: 'Beschreibung' },
      { label: 'Beleg', format: r => r.BelegURL ? `<a href="${r.BelegURL}" target="_blank" class="text-blue-600 underline">Öffnen</a>` : '' }
    ],
    [...state.allgemeinekosten].sort((a, b) => new Date(b.Datum) - new Date(a.Datum)),
    { onDelete: async (row) => { await safeCall('allgemeinekosten.delete', { id: row.ID }, 'Gelöscht.'); cacheRemove('allgemeinekosten.list', row.ID); await loadFinanzenSection(); } });

  renderTable(document.getElementById('erntevermarktungTable'),
    [
      { label: 'Datum', format: r => fmtDate(r.Datum) }, { key: 'Kategorie', label: 'Kategorie' },
      { label: 'Menge', format: r => `${r.Menge || ''} ${r.Einheit || ''}` },
      { label: 'Erlös', format: r => euro(r.Erloes) }, { key: 'Beschreibung', label: 'Beschreibung' }
    ],
    [...state.erntevermarktung].sort((a, b) => new Date(b.Datum) - new Date(a.Datum)),
    { onDelete: async (row) => { await safeCall('erntevermarktung.delete', { id: row.ID }, 'Gelöscht.'); cacheRemove('erntevermarktung.list', row.ID); await loadFinanzenSection(); } });
}

function openAllgemeineKostenModal() {
  openFormModal({
    title: 'Allgemeine Betriebskosten erfassen',
    fields: [
      { key: 'Datum', label: 'Datum', type: 'date', required: true },
      { key: 'Kategorie', label: 'Kategorie', type: 'select', options: ['Treibstoff-Sammelrechnung', 'Versicherung', 'Pacht', 'Strom', 'Beitraege', 'Sonstiges'] },
      { key: 'MengeLiter', label: 'Menge (Liter, nur bei Treibstoff)', type: 'number', step: '0.1' },
      { key: 'Betrag', label: 'Betrag (€)', type: 'number', step: '0.01', required: true },
      { key: 'Beschreibung', label: 'Beschreibung' },
      { key: 'Beleg', label: 'Beleg', type: 'file', accept: 'image/*,.pdf' }
    ],
    onSubmit: async (values) => {
      let belegURL = '';
      if (values.Beleg) { const up = await Api.uploadFile(values.Beleg, 'maschine'); belegURL = up.url; }
      const saved = await safeCall('allgemeinekosten.create', { ...values, BelegURL: belegURL }, 'Kosten erfasst.');
      cacheUpsert('allgemeinekosten.list', saved);
      await loadFinanzenSection();
    }
  });
}

function openErntevermarktungModal() {
  openFormModal({
    title: 'Ernte-/Holz-/Weinverkauf erfassen',
    fields: [
      { key: 'Datum', label: 'Datum', type: 'date', required: true },
      { key: 'Kategorie', label: 'Kategorie', type: 'select', options: ['Heuballen', 'Siloballen', 'Silomais', 'Brennholz', 'Stammholz', 'Trauben', 'Wein', 'Sonstiges'] },
      { key: 'Menge', label: 'Menge', type: 'number', step: '0.1' },
      { key: 'Einheit', label: 'Einheit', type: 'select', options: ['Ballen', 'Tonnen', 'Festmeter', 'Raummeter', 'kg', 'Liter'] },
      { key: 'Erloes', label: 'Erlös (€)', type: 'number', step: '0.01', required: true },
      { key: 'Beschreibung', label: 'Beschreibung' }
    ],
    onSubmit: async (values) => {
      const saved = await safeCall('erntevermarktung.create', values, 'Verkauf erfasst.');
      cacheUpsert('erntevermarktung.list', saved);
      await loadFinanzenSection();
    }
  });
}

// ============================================================================
// EINSTELLUNGEN
// ============================================================================
async function loadEinstellungenSection() {
  const { betrieb, users, kulturen } = await cachedBatch({
    betrieb: { action: 'betrieb.get' },
    users: { action: 'users.list' },
    kulturen: { action: 'kulturen.list' }
  });

  document.getElementById('betriebForm').innerHTML = [
    { key: 'HofName', label: 'Hofname' }, { key: 'Adresse', label: 'Adresse' },
    { key: 'Betriebsnummer', label: 'Betriebsnummer' }, { key: 'Ansprechpartner', label: 'Ansprechpartner' },
    { key: 'ErinnerungWochenVorher', label: 'Zuchtkalender-Erinnerung (Wochen vorher)', type: 'number', help: 'Wie viele Wochen vor Trockenstellen/Abkalbung die Erinnerungsbox in der Viehhaltung erscheinen soll. Standard: 4 Wochen.' }
  ].map(f => fieldHtml(f, (betrieb || {})[f.key])).join('');

  document.getElementById('btnBetriebSpeichern').onclick = async () => {
    const payload = {};
    ['HofName', 'Adresse', 'Betriebsnummer', 'Ansprechpartner', 'ErinnerungWochenVorher'].forEach(k => {
      const el = document.getElementById('field_' + k);
      if (el) payload[k] = el.value;
    });
    const saved = await safeCall('betrieb.update', payload, 'Betrieb gespeichert.');
    listCache['betrieb.get'] = saved;
    state.betrieb = saved;
    if (saved && saved.HofName) document.getElementById('hofNameLabel').textContent = saved.HofName;
  };

  const isAdmin = state.user.role === 'Admin';
  // Neue Nutzer entstehen jetzt automatisch bei der ersten Google-Anmeldung (Supabase-
  // Trigger legt das Profil an, zunächst mit Status "Gesperrt") - ein Admin kann sie
  // hier danach nur noch freischalten/bearbeiten, nicht mehr im Voraus manuell anlegen.
  document.getElementById('btnNeuerUser').classList.add('hidden');

  state.users = users;
  renderTable(document.getElementById('usersTable'),
    [{ key: 'Email', label: 'E-Mail' }, { key: 'Name', label: 'Name' }, { key: 'Rolle', label: 'Rolle' }, { key: 'Status', label: 'Status' }],
    users,
    isAdmin ? {
      onEdit: (row) => openUserModal(row),
      onDelete: async (row) => { await safeCall('users.delete', { id: row.Email }, 'Entfernt.'); cacheRemove('users.list', row.Email, 'Email'); await loadEinstellungenSection(); }
    } : {});

  state.kulturen = kulturen;
  renderTable(document.getElementById('kulturenTable'),
    [
      { label: 'Karte', format: r => `<span class="inline-block w-3 h-3 rounded-sm align-middle" style="background:${r.KartenFarbe || '#84cc16'}"></span> ${r.KartenSymbol || ''}` },
      { key: 'Kultur', label: 'Kultur' }, { key: 'Kategorie', label: 'Kategorie' },
      { key: 'SaatmengeKgHa', label: 'Saatmenge (kg/ha)' },
      { label: 'N/P/K (kg/ha)', format: r => `${r.DuengeempfehlungN_KgHa}/${r.DuengeempfehlungP_KgHa}/${r.DuengeempfehlungK_KgHa}` },
      { key: 'AnbaupauseJahre', label: 'Anbaupause (Jahre)' }
    ], kulturen,
    { onEdit: (row) => openKulturModal(row), onDelete: async (row) => { await safeCall('kulturen.delete', { id: row.Kultur }, 'Gelöscht.'); cacheRemove('kulturen.list', row.Kultur, 'Kultur'); await loadEinstellungenSection(); } });
  document.getElementById('btnNeueKultur').onclick = () => openKulturModal();
}

function openUserModal(initial) {
  openFormModal({
    title: 'Benutzer bearbeiten',
    fields: [
      { key: 'Name', label: 'Name', required: true },
      { key: 'Rolle', label: 'Rolle', type: 'select', options: ['Mitarbeiter', 'Admin'] },
      { key: 'Status', label: 'Status', type: 'select', options: ['Aktiv', 'Gesperrt'], help: 'Neue Nutzer erscheinen hier automatisch nach ihrer ersten Google-Anmeldung, zunächst mit Status "Gesperrt".' }
    ],
    initial,
    onSubmit: async (values) => {
      const saved = await safeCall('users.update', { id: initial.Email, ...values }, 'Aktualisiert.');
      cacheUpsert('users.list', saved, 'Email');
      await loadEinstellungenSection();
    }
  });
}

function openKulturModal(initial = {}) {
  openFormModal({
    title: initial.Kultur ? 'Kultur bearbeiten' : 'Neue Kultur',
    fields: [
      { key: 'Kultur', label: 'Kultur-Name', required: true },
      { key: 'Kategorie', label: 'Kategorie', type: 'select', options: ['Getreide', 'Hackfrucht', 'Leguminose', 'Gras-Ackerfutter', 'Sonstiges'] },
      { key: 'SaatmengeKgHa', label: 'Saatmenge (kg/ha)', type: 'number', step: '0.1' },
      { key: 'DuengeempfehlungN_KgHa', label: 'Düngeempfehlung N (kg/ha)', type: 'number' },
      { key: 'DuengeempfehlungP_KgHa', label: 'Düngeempfehlung P (kg/ha)', type: 'number' },
      { key: 'DuengeempfehlungK_KgHa', label: 'Düngeempfehlung K (kg/ha)', type: 'number' },
      { key: 'UnvertraeglicheVorfruechte', label: 'Unverträgliche Vorfrüchte (kommagetrennt)' },
      { key: 'AnbaupauseJahre', label: 'Anbaupause (Jahre)', type: 'number' },
      { key: 'KartenFarbe', label: 'Kartenfarbe (Hex, z.B. #eab308)', type: 'color', help: 'Farbe der Parzelle auf der Karte, solange diese Kultur im laufenden Jahr zugewiesen ist.' },
      { key: 'KartenSymbol', label: 'Kartensymbol (ein Emoji, z.B. 🌽)' }
    ],
    initial: { KartenFarbe: '#84cc16', ...initial },
    onSubmit: async (values) => {
      const saved = initial.Kultur
        ? await safeCall('kulturen.update', { id: initial.Kultur, ...values }, 'Aktualisiert.')
        : await safeCall('kulturen.create', values, 'Kultur angelegt.');
      if (initial.Kultur && initial.Kultur !== saved.Kultur) cacheRemove('kulturen.list', initial.Kultur, 'Kultur'); // Kultur wurde umbenannt
      cacheUpsert('kulturen.list', saved, 'Kultur');
      await loadEinstellungenSection();
    }
  });
}

// ============================================================================
// PWA: SERVICE WORKER REGISTRIEREN
// ============================================================================
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
