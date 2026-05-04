// OAuth 2.0 + PKCE Helper für Browser-Apps.
// PKCE-Algorithmus geprüft gegen RFC 7636 Test-Vektor:
//   verifier "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
//   challenge "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"

const TOKEN_KEY_PREFIX = 'oauth_token_';
const VERIFIER_KEY_PREFIX = 'oauth_pkce_verifier_';
const STATE_KEY_PREFIX = 'oauth_pkce_state_';

/**
 * Startet den OAuth-Flow: erzeugt PKCE, speichert verifier+state in sessionStorage,
 * leitet zum Authorize-Endpoint um. Nach Login landet der User auf der Callback-Seite.
 */
export async function startAuthorize(providerKey, config) {
  if (!config.clientId) {
    throw new Error(`Bitte zuerst ${providerKey}-Client-ID in den Einstellungen eintragen.`);
  }
  const verifier = makeCodeVerifier();
  const challenge = await codeChallenge(verifier);
  const state = makeState();

  sessionStorage.setItem(VERIFIER_KEY_PREFIX + providerKey, verifier);
  sessionStorage.setItem(STATE_KEY_PREFIX + providerKey, state);

  const url = new URL(config.authorizeEndpoint);
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', state);
  if (config.scopes && config.scopes.length) {
    url.searchParams.set('scope', config.scopes.join(' '));
  }
  for (const [k, v] of Object.entries(config.extraAuthParams || {})) {
    url.searchParams.set(k, v);
  }

  // Mit window.location.assign erreichen wir die History-fähige Navigation.
  window.location.assign(url.toString());
}

/**
 * Wird von der Callback-Seite aufgerufen. Extrahiert den Code aus der URL,
 * tauscht ihn gegen ein Token, speichert das Token in localStorage.
 * Wirft bei state-Mismatch (CSRF-Schutz).
 */
export async function handleCallback(providerKey, config) {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const returnedState = params.get('state');
  const error = params.get('error');

  if (error) throw new Error(`OAuth-Fehler vom Provider: ${error}`);
  if (!code) throw new Error('Kein Code in der Callback-URL.');

  const expectedState = sessionStorage.getItem(STATE_KEY_PREFIX + providerKey);
  if (!expectedState || expectedState !== returnedState) {
    throw new Error('State-Mismatch — möglicher CSRF-Angriff.');
  }
  const verifier = sessionStorage.getItem(VERIFIER_KEY_PREFIX + providerKey);
  if (!verifier) throw new Error('PKCE-Verifier nicht gefunden — Session abgelaufen?');

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.redirectUri,
    client_id: config.clientId,
    code_verifier: verifier
  });
  for (const [k, v] of Object.entries(config.extraTokenParams || {})) {
    body.set(k, v);
  }

  const resp = await fetch(config.tokenEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json'
    },
    body: body.toString()
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Token-Tausch fehlgeschlagen (${resp.status}): ${text}`);
  }
  const token = await resp.json();
  storeToken(providerKey, token);

  // Aufräumen
  sessionStorage.removeItem(VERIFIER_KEY_PREFIX + providerKey);
  sessionStorage.removeItem(STATE_KEY_PREFIX + providerKey);

  return token;
}

/** Holt ein gespeichertes Token oder null. */
export function loadToken(providerKey) {
  const raw = localStorage.getItem(TOKEN_KEY_PREFIX + providerKey);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

/** Speichert ein Token (mit fetchedAt für Ablaufprüfung). */
export function storeToken(providerKey, token) {
  if (!token.fetchedAt) token.fetchedAt = Date.now();
  localStorage.setItem(TOKEN_KEY_PREFIX + providerKey, JSON.stringify(token));
}

/** Prüft, ob ein Token (anhand expires_in) bald abläuft. 30s Puffer. */
export function isExpired(token) {
  if (!token || !token.expires_in) return false;
  const expiresAt = (token.fetchedAt ?? 0) + token.expires_in * 1000;
  return Date.now() >= expiresAt - 30_000;
}

/** Refresht ein Token mittels Refresh-Token-Grant. */
export async function refreshToken(providerKey, config, token) {
  if (!token.refresh_token) {
    throw new Error('Kein Refresh-Token vorhanden — bitte neu anmelden.');
  }
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: token.refresh_token,
    client_id: config.clientId
  });
  for (const [k, v] of Object.entries(config.extraTokenParams || {})) {
    body.set(k, v);
  }
  const resp = await fetch(config.tokenEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json'
    },
    body: body.toString()
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Refresh fehlgeschlagen (${resp.status}): ${text}`);
  }
  const newToken = await resp.json();
  // Spotify sendet kein neues refresh_token zurück → das alte beibehalten.
  if (!newToken.refresh_token && token.refresh_token) {
    newToken.refresh_token = token.refresh_token;
  }
  storeToken(providerKey, newToken);
  return newToken;
}

/** Stellt sicher, dass ein gültiges Token vorhanden ist. Refreshed bei Bedarf. */
export async function ensureValidToken(providerKey, config) {
  const token = loadToken(providerKey);
  if (!token) return null;
  if (!isExpired(token)) return token;
  try {
    return await refreshToken(providerKey, config, token);
  } catch (e) {
    console.warn('Token-Refresh fehlgeschlagen', e);
    return null;
  }
}

/** Token löschen — entspricht Sign-out. */
export function clearToken(providerKey) {
  localStorage.removeItem(TOKEN_KEY_PREFIX + providerKey);
}

// ============ PKCE-Primitives ============

function makeCodeVerifier() {
  // 48 random bytes → base64url ergibt 64 Zeichen.
  const bytes = new Uint8Array(48);
  crypto.getRandomValues(bytes);
  return base64urlEncode(bytes);
}

async function codeChallenge(verifier) {
  const data = new TextEncoder().encode(verifier);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return base64urlEncode(new Uint8Array(hash));
}

function makeState() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return base64urlEncode(bytes);
}

function base64urlEncode(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
