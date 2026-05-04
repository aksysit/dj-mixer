# DJ Mixer (Web-App)

Eine reine Browser-Anwendung — kein Build-Schritt, kein Installer, kein Xcode. Liest deine Spotify- oder Tidal-Bibliothek, reichert sie über die GetSongBPM-API mit BPM und Tonart an, und schlägt während eines Live-Sets passende nächste Songs nach Camelot-Wheel und BPM-Nähe vor. Optimiert für Wedding/Pop/Charts-Sets.

## Was diese App ist und nicht ist

Diese App ist **kein Mixer/Player** — Streaming-DRM verbietet das in Drittsoftware. Sie ist ein **intelligenter Empfehlungs-Begleiter**: Während du in deiner DJ-Software (rekordbox, djay Pro, Serato …) den aktuellen Song spielst, zeigt DJ Mixer dir live, **welcher Song aus deiner Streaming-Bibliothek als nächstes harmonisch und vom Tempo passt**.

## Live-Version

Sobald die Dateien aus diesem Ordner ins GitHub-Repo gepusht sind, läuft die App unter:

```
https://aksysit.github.io/dj-mixer/
```

## Was hier im Ordner liegt

```
DJ Software/
├── index.html              ← Haupt-App
├── callback-spotify.html   ← OAuth-Rückkehr nach Spotify-Login
├── callback-tidal.html     ← OAuth-Rückkehr nach Tidal-Login
├── style.css               ← Komplette Styles (dark theme)
├── js/
│   ├── app.js              ← Einstiegspunkt, verdrahtet alles
│   ├── state.js            ← Zentraler Zustand mit Pub/Sub
│   ├── ui.js               ← DOM-Rendering & Event-Bindings
│   ├── camelot.js          ← Camelot-Wheel-Mapping + Score
│   ├── engine.js           ← Empfehlungs-Algorithmus
│   ├── oauth.js            ← OAuth 2.0 + PKCE Helper
│   ├── getsongbpm.js       ← BPM-Lookup + lokaler Cache
│   └── providers/
│       ├── spotify.js
│       └── tidal.js
└── README.md
```

## Setup — Schritt für Schritt

### 1. Dateien ins GitHub-Repo hochladen

Im Repo `aksysit/dj-mixer` (das du schon hast):

1. Im Repo: **Add file → Upload files**
2. **Alle Dateien** aus diesem Ordner reinziehen (index.html, callback-*.html, style.css, README.md, .gitignore — und den kompletten `js/`-Ordner mitsamt Unterordner `providers/`)
3. **Commit changes**

GitHub Pages deployt automatisch nach dem Push (kann 30–60 Sekunden dauern).

### 2. Spotify-App neu konfigurieren

Die alte Redirect-URI (`djmixer://callback/spotify`) ist jetzt nicht mehr richtig — die Web-App verwendet eine HTTPS-URL.

1. https://developer.spotify.com/dashboard öffnen → deine bestehende DJ-Mixer-App
2. **Edit Settings** → bei **Redirect URIs** die alte Zeile löschen
3. Neu hinzufügen: `https://aksysit.github.io/dj-mixer/callback-spotify.html`
4. **Save**
5. Client-ID kopieren

### 3. Tidal-App konfigurieren

1. https://developer.tidal.com → **Apps** → Create New App
2. **Redirect URI**: `https://aksysit.github.io/dj-mixer/callback-tidal.html`
3. **Scopes** anhaken: `collection.read`, `playlists.read`, `search.read`, `user.read`
4. App erstellen → Client-ID kopieren

### 4. App starten und einrichten

1. https://aksysit.github.io/dj-mixer/ aufrufen
2. Oben rechts auf das Zahnrad ⚙︎
3. Tab **API-Keys**:
   - Spotify Client-ID einfügen
   - Tidal Client-ID einfügen
   - Country-Code prüfen (Default „DE", muss zu deinem Tidal-Account passen)
   - GetSongBPM API-Key einfügen
4. Modal schließen
5. Oben links: Provider wählen (Spotify oder Tidal)
6. **Verbinden** → Browser-Login, zurück zur App
7. Library wird automatisch geladen
8. **BPM anreichern** (Toolbar oben rechts) → läuft im Hintergrund (≈ 5 Tracks/Sek), Ergebnisse werden gecacht

## So benutzt du die App im Set

1. Kunde wünscht Song → in **Suche** tippen, in der Library erscheint er
2. Anklicken → wird oben mittig als „Now Playing" gesetzt → rechts erscheinen Vorschläge
3. Vorschläge sind sortiert nach Gesamt-Score (BPM 45 % · Tonart 30 % · Energy 15 % · Genre 10 %)
4. Klickst du auf einen Vorschlag, wird er zum nächsten „Now Playing" — die Liste rutscht weiter
5. **Wedding-Modus** (Toggle oben rechts an der Vorschlagsliste): mehr Toleranz für Genre- und BPM-Sprünge
6. Score-Farben: 🟢 80+ 🟡 60+ 🟠 40+ 🔴 darunter

## Falls GetSongBPM zickt

GetSongBPM steht hinter Cloudflare. Sollte beim ersten BPM-Anreichern alles als „nicht gefunden" zurückkommen:

1. https://getsongbpm.com einmalig in **demselben Browser** aufrufen, kurz warten bis die Cloudflare-Challenge automatisch durchläuft
2. Tab kann danach geschlossen werden — der clearance-Cookie hält ein paar Stunden bis Tage
3. Zurück zur App, **Settings → Cache → Negativ-Cache löschen**, dann **BPM anreichern** erneut starten

## Wie der Score berechnet wird

```
total = 0.45·BPM + 0.30·Key + 0.15·Energy + 0.10·Genre
```

| Faktor | Verhalten |
|---|---|
| BPM | linearer Abfall ab 0% Abweichung; ab `maxBpmDeviation` (Default 8 %, im Wedding-Modus +4 %) → 0. Halbe-/doppelte-BPM (z.B. 70↔140) gibt 0.85 |
| Tonart | Camelot-Wheel: gleicher Code = 1.0 · relative Dur/Moll = 0.9 · Quintsprung = 0.85 · diagonal = 0.4 · sonst 0.1 |
| Energy | manuell gepflegt, sonst neutral (0.5) |
| Genre | gleiches Genre = 1.0 · ungleich + Wedding = 0.6 · ungleich = 0.2 |

## Bekannte Einschränkungen

- **Spotify Audio Features** (BPM/Key) sind seit Nov 2024 für neue Apps weg — wir nutzen GetSongBPM stattdessen.
- **Amazon Music**: Hat keine öffentliche Developer-API. Anbindung daher nicht möglich.
- **Tidal-API-Stabilität**: Endpoints können sich ändern. Code im `js/providers/tidal.js` ist entsprechend kommentiert, falls Anpassungen nötig.
- **GetSongBPM-Trefferquote**: gut für Pop/Charts (~80–90 %), schlechter für Bootlegs/Mashups/sehr neue Releases.
- **localStorage-Quota**: BPM-Cache und Tokens leben im Browser-localStorage (~5 MB pro Origin). Reicht für ~10k Tracks.
- **Token-Storage**: localStorage ist nicht so sicher wie das Mac-Keychain. Wer Zugriff auf deinen Browser hat, sieht potenziell deine Tokens. Für ein internes DJ-Tool akzeptabel, aber gut zu wissen.

## Erweiterungsideen

- Drag&Drop einer rekordbox-XML als zusätzliche Library-Quelle
- Apple Music dazunehmen (über MusicKit JS — braucht Developer-Token aus deinem Apple-Account, der existiert schon)
- „Setlist-Modus": vorausgeplante Reihenfolge mit Score-Bewertung jedes Übergangs
- Manuelle BPM-/Energy-Pflege pro Track (Long-Press oder Inline-Edit)
- IndexedDB statt localStorage für unbegrenzten Cache
