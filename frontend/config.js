// ============================================================================
// KONFIGURATION - hier trägst du deine eigenen Werte ein
// ============================================================================

const CONFIG = {
  // URL deines veröffentlichten Google Apps Script Web Apps (endet auf /exec).
  // Anleitung dazu: siehe README.md, Abschnitt "Backend veröffentlichen".
  API_BASE_URL: 'https://script.google.com/macros/s/AKfycbxjAr7MlGr5lcbyfAJw8qc34q3_T21RZ2X_-D89gEVmAkfdwd8VvydYqVP9qaQZogl6gw/exec',

  // OAuth 2.0 Client-ID (Web Application) aus der Google Cloud Console.
  // Muss als "Autorisierter JavaScript-Origin" u.a. http://localhost:PORT und
  // deine spätere GitHub-Pages-URL eingetragen haben. Siehe README.
  GOOGLE_CLIENT_ID: '339593393540-makdc7m3ofus3209k78onh4e33ku4e12.apps.googleusercontent.com',

  // GeoServer-WMS der Autonomen Provinz Bozen (Kataster-Workspace).
  // Quelle: per GetCapabilities recherchiert/verifiziert.
  GEOSERVER_WMS_URL: 'https://geoservices5.civis.bz.it/geoserver/p_bz-Cadastre/ows',
  GEOSERVER_LAYER_VISUAL: 'WebRepresentation',   // Kataster-Grenzen als Kartenbild (GetMap)
  GEOSERVER_LAYER_INFO: 'ParcelsAggregate',      // Sachdaten je Parzelle (GetFeatureInfo, JSON)

  // Startposition der Karte (Südtirol als Standard - bitte an deinen Hof anpassen)
  MAP_CENTER: [46.4983, 11.3548],
  MAP_ZOOM: 14
};
