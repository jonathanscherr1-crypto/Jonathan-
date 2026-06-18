# Inkwell — Notizen & Scans

Eine kostenlose, schöne Notiz-App im Stil von GoodNotes — als **Web-App (PWA)**,
die du im Browser nutzen und wie eine echte App auf iPad, iPhone oder Computer
installieren kannst. Keine Anmeldung, keine Kosten, alles bleibt lokal auf deinem Gerät.

## Funktionen

- ✍️ **Stifte wie bei GoodNotes**: Füller (druckabhängige Linienstärke), Kugelschreiber,
  Bleistift, Textmarker und Radierer.
- ✏️ **Apple Pencil / Stylus**: echte Druckerkennung über Pointer Events; flüssige Linien
  dank Coalesced Events.
- 📒 **Notizbücher & Seiten**: mehrere Notizbücher mit Cover, mehrere Seiten,
  hinzufügen/duplizieren/löschen, Vorschau-Thumbnails.
- 📄 **Papierarten**: Blanko, Liniert, Kariert, Punkteraster.
- 📷 **Dokumentenscanner** mit **automatischer Kantenerkennung** und
  **Perspektiv-Korrektur** (Homographie). Ecken sind manuell nachjustierbar.
  Filter: Farbe, Graustufen, S/W-Dokument (adaptiver Schwellenwert).
- 🖼️ **Bild-Import** als Seite.
- ⌖ **Lasso**: Striche auswählen und verschieben (mit Undo/Redo).
- ✌️ **Zwei-Finger-Zoom & -Verschieben** auf dem Tablet, zusätzlich Maus-Zoom.
- 🗂️ **Seitenübersicht**: Thumbnails zum Springen, Hinzufügen, Löschen, Umsortieren.
- 🔍 Zoom & Verschieben, Rückgängig/Wiederholen.
- 🎨 **Farben** inkl. eigener Farbwähler und zuletzt verwendeten Farben, 5 Linienstärken.
- ⇪ **Export**: aktuelle Seite als PNG, ganzes Notizbuch als PDF.
- 📦 **Offline-fähig** dank Service Worker; speichert Notizbücher in IndexedDB.

## Starten

Die App braucht keinen Build und keine Abhängigkeiten. Sie muss aber über
HTTP(S) ausgeliefert werden (wegen Kamera & Service Worker — `file://` reicht nicht).

```bash
# im Projektordner:
python3 -m http.server 8000
# dann im Browser öffnen:
#   http://localhost:8000
```

Alternativ jeden anderen statischen Server nutzen (z. B. `npx serve`).

### Als App installieren

- **iPhone / iPad (Safari)**: Teilen-Symbol → „Zum Home-Bildschirm".
- **Android (Chrome)**: Menü → „App installieren" / „Zum Startbildschirm".
- **Computer (Chrome/Edge)**: Installations-Symbol in der Adressleiste.

Für den Kamerazugriff (Scanner) muss die Seite über **HTTPS** oder `localhost` laufen.

## Tastenkürzel (Desktop)

| Taste | Funktion |
|------|----------|
| `F` / `B` / `P` / `H` | Füller / Kugel / Bleistift / Marker |
| `E` | Radierer · `V` Hand (verschieben) |
| `Strg/Cmd + Z` | Rückgängig · `Shift` für Wiederholen |
| `Strg/Cmd + Scroll` | Zoomen |

## Technik

Reines HTML/CSS/JavaScript (ES-Module), keine Frameworks, keine externen Laufzeit-Bibliotheken.

- `index.html` — Aufbau der Oberfläche
- `css/styles.css` — Design
- `js/engine.js` — Zeichen-Engine (Stifte, Druck, Zoom, Rendering)
- `js/scanner.js` — Kamera-Scanner mit Bildfiltern
- `js/storage.js` — Speicherung in IndexedDB
- `js/app.js` — App-Steuerung (Bibliothek, Editor, Export, PWA)
- `sw.js` / `manifest.webmanifest` — PWA / Offline
- `generate-icons.js` — erzeugt die App-Icons (einmalig, reines Node)
