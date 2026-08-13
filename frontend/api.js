// ============================================================================
// AUTH (Google Identity Services) + API-LAYER (Apps Script Backend)
// ============================================================================

function decodeJwtPayload(token) {
  // JWTs sind Base64URL-kodiert (-/_ statt +//), nicht Standard-Base64 - daher erst konvertieren.
  let base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) base64 += '=';
  return JSON.parse(atob(base64));
}

const Auth = {
  idToken: null,
  profile: null, // {email, name, picture}

  init(onSignedIn, onSignedOut) {
    this._onSignedIn = onSignedIn;
    this._onSignedOut = onSignedOut;

    // localStorage statt sessionStorage: sessionStorage wird komplett gelöscht, sobald die
    // App/der Tab geschlossen wird - auf dem Handy killt das Betriebssystem installierte PWAs
    // im Hintergrund ständig, wodurch man sich immer neu anmelden musste, obwohl das Google-
    // Token (gültig bis zu 1 Std.) eigentlich noch gar nicht abgelaufen war.
    const stored = localStorage.getItem('hof_id_token');
    const storedProfile = localStorage.getItem('hof_profile');
    if (stored && storedProfile && !this._isExpired(stored)) {
      this.idToken = stored;
      this.profile = JSON.parse(storedProfile);
    }

    google.accounts.id.initialize({
      client_id: CONFIG.GOOGLE_CLIENT_ID,
      callback: (response) => this._handleCredential(response.credential),
      auto_select: true,
      // Safari blockiert standardmäßig geräteübergreifende Cookies (ITP) - dieser Parameter
      // sagt der Google-Bibliothek, dass sie sich darauf einstellen soll (sonst bleibt der
      // "Mit Google anmelden"-Button in Safari/iOS wirkungslos oder erscheint gar nicht).
      itp_support: true
    });

    google.accounts.id.renderButton(document.getElementById('gsiButtonContainer'), {
      theme: 'outline', size: 'large', shape: 'pill', text: 'signin_with', locale: 'de'
    });

    if (this.idToken) {
      this._onSignedIn && this._onSignedIn(this.profile);
    } else {
      google.accounts.id.prompt();
    }
  },

  _isExpired(idToken) {
    try {
      const payload = decodeJwtPayload(idToken);
      return payload.exp * 1000 < Date.now();
    } catch (e) {
      return true;
    }
  },

  _handleCredential(credential) {
    const payload = decodeJwtPayload(credential);
    this.idToken = credential;
    this.profile = { email: payload.email, name: payload.name, picture: payload.picture };
    localStorage.setItem('hof_id_token', credential);
    localStorage.setItem('hof_profile', JSON.stringify(this.profile));
    this._onSignedIn && this._onSignedIn(this.profile);
  },

  signOut() {
    google.accounts.id.disableAutoSelect();
    this.idToken = null;
    this.profile = null;
    localStorage.removeItem('hof_id_token');
    localStorage.removeItem('hof_profile');
    this._onSignedOut && this._onSignedOut();
  },

  getIdToken() {
    if (!this.idToken || this._isExpired(this.idToken)) return null;
    return this.idToken;
  }
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const Api = {
  // Google Apps Script liefert unter Last gelegentlich statt JSON eine eigene
  // HTML-Fehlerseite aus, obwohl das Skript im Hintergrund trotzdem fertig
  // rechnet (bekannte Infrastruktur-Eigenheit, kein Programmfehler). Solche
  // Aussetzer sind fast immer transient - deshalb hier automatisch bis zu
  // zweimal im Hintergrund wiederholen, bevor der Nutzer einen Fehler sieht.
  async call(action, payload = {}, _attempt = 0) {
    const idToken = Auth.getIdToken();
    if (!idToken) {
      Auth.signOut();
      throw new Error('Sitzung abgelaufen. Bitte neu anmelden.');
    }

    let res;
    try {
      res = await fetch(CONFIG.API_BASE_URL, {
        method: 'POST',
        // text/plain vermeidet einen CORS-Preflight (OPTIONS), den Apps Script nicht handhabt
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action, idToken, payload })
      });
    } catch (networkErr) {
      if (_attempt < 2) { await sleep(700 * (_attempt + 1)); return this.call(action, payload, _attempt + 1); }
      throw new Error('Backend nicht erreichbar. Ist API_BASE_URL in config.js korrekt gesetzt?');
    }

    let data;
    try {
      data = await res.json();
    } catch (parseErr) {
      if (_attempt < 2) { await sleep(700 * (_attempt + 1)); return this.call(action, payload, _attempt + 1); }
      throw new Error('Google-Server war kurz nicht erreichbar (ungültige Antwort). Bitte nochmal versuchen.');
    }

    if (!data.success) throw new Error(data.error || 'Unbekannter Fehler.');
    return data.data;
  },

  // Bündelt mehrere Aktionen in einem einzigen Request/einer Apps-Script-Ausführung.
  // namedCalls: { ergebnisName: { action, payload }, ... } -> gibt { ergebnisName: data, ... } zurück.
  // Deutlich schneller als mehrere gleichzeitige einzelne this.call()-Aufrufe, da Google
  // Apps Script parallele Anfragen an dasselbe Skript nicht wirklich parallel abarbeitet.
  async batch(namedCalls) {
    const keys = Object.keys(namedCalls);
    const calls = keys.map(k => ({ action: namedCalls[k].action, payload: namedCalls[k].payload || {} }));
    const results = await this.call('batch', { calls });
    const out = {};
    keys.forEach((k, i) => {
      const r = results[i];
      if (!r.ok) throw new Error(r.error || `Fehler bei "${k}"`);
      out[k] = r.data;
    });
    return out;
  },

  fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  },

  async uploadFile(file, category) {
    const base64Data = await this.fileToBase64(file);
    return this.call('upload.file', { fileName: file.name, mimeType: file.type, base64Data, category });
  }
};
