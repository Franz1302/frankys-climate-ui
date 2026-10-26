# Originalvorlage – separater Climate-Card-Test

Diese Testkarte baut die 3D-/Neon-Vorlage mit echtem SVG nach (kein gerendertes Hintergrundbild). Die vorhandene Franky's Climate UI bleibt unverändert. Es gibt **keinen automatischen Release und keine Änderung am bestehenden Dashboard**.

## Testinstallation

1. Lade `frankys-climate-original-card.js` aus diesem Branch herunter und lege sie in Home Assistant unter `/config/www/frankys-climate-original-card.js` ab.
2. Trage in **Einstellungen → Dashboards → Ressourcen** als JavaScript-Modul `/local/frankys-climate-original-card.js?v=1` ein, sofern noch nicht registriert.
3. Füge eine separate Karte mit dem Typ `custom:frankys-climate-original-card` hinzu (visueller Karteneditor sollte ebenfalls verfügbar sein).
4. Verwende deine bereits existierende Climate-Entität. Beispiel:

```yaml
type: custom:frankys-climate-original-card
name: Wohnzimmer
display_entity: climate.wohnzimmer
control_entity: climate.wohnzimmer
language: de
temperature_unit: auto
```

Die gezeigten Entitätsnamen sind Beispiele. `target_entity`, `mode_entity`, `heating_status_entity`, `schedule_entity` und die optionalen Aktionskonfigurationen werden wie bei `frankys-climate-ui-card` unterstützt.

## Funktion

- Temperaturanzeige und Recorder-Verlauf weiterhin aus Home Assistant.
- Ring-Slider und Plus/Minus verwenden die vorhandene Service-Logik.
- AUS/AUTO/MANUELL folgen unverändert den verfügbaren Gerätemodi/konfigurierten Aktionen; nicht unterstützte Modi sind deaktiviert.
- Heizflamme folgt Heizstatus; ein manuelles Schalten wird nur angeboten, wenn ein geeigneter Aktor explizit konfiguriert ist.
- Optionales Zeitplan-Symbol öffnet den vorhandenen Schedule-Dialog.
- Responsive SVG-Skalierung mit Original-Glas-/Metall-/Neon-Optik.

## Prüfung

Syntaxprüfung und isolierter Render-Smoke-Test mit simulierten Climate-Daten durchgeführt. Ein tatsächlicher Browser-/Home-Assistant-Gerätetest und visueller Pixelvergleich mit der Vorlage stehen noch aus. Die Variante wird deshalb **nicht** auf `main` übernommen oder veröffentlicht.
