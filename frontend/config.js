// ============================================================================
// KONFIGURATION - hier trägst du deine eigenen Werte ein
// ============================================================================

const CONFIG = {
  // Supabase-Projekt-URL und öffentlicher ("publishable") API-Key.
  // Zu finden in Supabase: Project Settings -> API.
  SUPABASE_URL: 'https://lovdniycmhfnraozhfnh.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_CDpZVQnbGSWhzTVGSddmEQ_F6KB9jbb',

  // GeoServer-WMS der Autonomen Provinz Bozen (Kataster-Workspace).
  // Quelle: per GetCapabilities recherchiert/verifiziert.
  GEOSERVER_WMS_URL: 'https://geoservices5.civis.bz.it/geoserver/p_bz-Cadastre/ows',
  GEOSERVER_LAYER_VISUAL: 'WebRepresentation',   // Kataster-Grenzen als Kartenbild (GetMap)
  GEOSERVER_LAYER_INFO: 'ParcelsAggregate',      // Sachdaten je Parzelle (GetFeatureInfo, JSON)

  // Startposition der Karte (Südtirol als Standard - bitte an deinen Hof anpassen)
  MAP_CENTER: [46.4983, 11.3548],
  MAP_ZOOM: 14
};
