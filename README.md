# Franky's Climate UI — v0.2.6

![Climate UI v0.2.0 in Home Assistant](images/climate-ui-v0.2.0-preview.png)

A standalone **visual-only** Lovelace climate interface by Franky's Stuff, based on the familiar JARVIS design. This is **not** an update to Frankys_Stuff Climate Card. Its heating behavior and source remain unchanged.


## Updated JARVIS UI

This is an **update to the existing card**, not a second card or design. The Home Assistant card type remains `custom:frankys-climate-ui-card` and the existing HACS installation and configurations remain valid. The new look replaces the previous interface automatically.

- Photo-realistic glass/neon thermostat that always remains **one proportional card**: the ring, temperature curve and mode buttons scale together, even in narrow dashboard columns. No vertically stacked panels or layout change.
- Temperature dial scale adapts to the entity's configured min/max limits (including sauna, pool and Fahrenheit ranges).
- Recorder-backed glowing orange **12-hour** actual-temperature history; unavailable states create gaps and the graph restores on refresh.
- The existing mode actions, entity/helpers, flame options and schedule handling are retained. The visual configuration editor uses the existing fields; **no design selector** is needed.

### Existing configuration remains valid

```yaml
type: custom:frankys-climate-ui-card
display_entity: climate.living_room
control_entity: climate.living_room
language: auto
temperature_unit: auto
```

No migration, new resource, or additional HACS repository is required. A normal update will change the appearance for all existing cards.

## Functions

- Touch temperature ring with orange setpoint pointer and current-temperature marker.
- Plus and minus buttons; reads/writes Home Assistant target temperature.
- 12-hour recorder-backed temperature history, restored after browser reload.
- Left AUS / AUTO / MANUELL buttons: native climate modes if available, optional helper or explicit HA service/script actions otherwise.
- Orange heating flame: **on** when measured heating is active, **off** otherwise. No standby state.
- Optional direct flame toggle only for a deliberately selected, suitable heater actuator. No automatic detection of a mains supply plug; when AUS is selected the flame control is locked.
- Clock opens a **straightforward weekly heating schedule editor**: select Monday–Sunday, edit start/end times and temperatures in directly labeled fields, add/remove blocks, or copy a day's plan to other days. Save and Cancel are explicit. It appears only when an existing schedule helper is linked; all helper `data` fields remain intact. If the editor cannot load the schedule, the original HA helper dialog remains available as a fallback.
- Visual card editor with **language** selection: Auto (Home Assistant), Deutsch, English. Number formatting follows the selected language (21,5 / 21.5).
- **Temperature units**: Auto (Home Assistant), Celsius (°C) or Fahrenheit (°F). Readings, setpoint, ring tick labels and schedule info use the chosen unit, while service calls retain their actual source entity units.
- Proportional SVG scaling without clipping the HUD's rounded corners when resized.
- Home Assistant Sections cards default to 12 columns and 6 rows and can be resized down to 3 columns and 2 rows. The complete artwork fits proportionally inside the selected size; spare space is left when the container has a different aspect ratio. Masonry cards and explicit `grid_options.rows: auto` retain intrinsic proportional height.
- **Why can't I make the card wider?** A normal Home Assistant section has 12 grid columns; 12 is already the full section width, not a limit imposed by this card. For a larger view, configure the *section* to span two columns (`column_span: 2`) and set the card's Layout width to **Full** (`grid_options.columns: full`) or resize within the expanded section. Give it a fixed starting height such as `grid_options.rows: 9` if you also want to resize its height; `rows: auto` sizes to the content and disables manual height resizing. Alternatively use a Panel view. This avoids silently shrinking existing cards just to create apparent enlargement room.
- The configured `name` appears in large type at the top-left of the temperature panel, with the current-temperature caption directly below. The name remains available as an accessible label.

## Configuration

Minimal (works for native climate features; unsupported modes are disabled):

```yaml
type: custom:frankys-climate-ui-card
name: Wohnzimmer
display_entity: climate.wohnzimmer
language: auto
temperature_unit: auto
```

With existing HA helpers and heating status:

```yaml
type: custom:frankys-climate-ui-card
name: Schlafzimmer
display_entity: climate.schlafzimmer
language: de
temperature_unit: celsius  # or fahrenheit / auto
temperature_entity: sensor.schlafzimmer_temperatur
target_entity: input_number.schlafzimmer_soll
mode_entity: input_select.schlafzimmer_modus
heating_status_entity: binary_sensor.schlafzimmer_heizt
schedule_entity: schedule.schlafzimmer_heizplan
# flame_switch_entity: switch.separater_heizaktor
```

These entity IDs are **examples**, not automatically installed entities.

## How control works

| Surface | Home Assistant backend |
| --- | --- |
| Ring, +/- | `climate.set_temperature`, or `input_number.set_value` / `number.set_value` if `target_entity` configured |
| MANUELL | Native `heat` on devices with a separate `auto` mode; otherwise `mode_entity` or custom action. Disabled on simple `heat/off` thermostats without a manual actuator/action |
| AUTO | Native `auto`; native `heat` on simple `heat/off` regulating thermostats; otherwise `mode_entity` or custom action |
| AUS | Native `off`; otherwise `mode_entity` or custom action |
| Heating flame | `heating_status_entity` binary on/off, else native `hvac_action: heating` |
| Tap flame | Optional `flame_switch_entity` (`switch` or `input_boolean`) on/off; blocked when AUS |
| Clock | Home Assistant's built-in `schedule/list` (read) and `schedule/update` (save) WebSocket endpoints for an already configured Schedule helper; never edits `.storage` directly |

**A climate entity exposing only `heat` and `off` can still regulate its temperature automatically while in `heat`.** The AUTO button therefore selects `heat` on simple thermostats; it does **not** start or implement a timed heating program. MANUELL remains disabled unless an explicit separate mode action/helper is provided. To use a custom schedule, configure an existing HA helper and automation. This card never creates a helper, builds an automation or overrides thermostat safety limits. Schedule edits are applied **only after explicitly pressing Save**; no heating control actions are issued by this UI. A separate Home Assistant automation must read the schedule to drive the actual target temperature.

You may assign `mode_off_action`, `mode_auto_action` or `mode_manual_action` to a script entity ID (`script.example`) or a single Home Assistant service action in JSON. Such actions override the default mode button commands; the displayed selected mode must still be reported by the device or `mode_entity`.

### Installation

Add `https://github.com/Franz1302/frankys-climate-ui` to **HACS → Custom repositories** as category **Dashboard/Lovelace**, then install **Franky's Climate UI**. Add a new dashboard card with type `custom:frankys-climate-ui-card`. This repository is independent of Frankys_Stuff Climate Card; you can keep both cards installed.

### Heating schedule editing

Configure an existing `schedule` helper under **Settings → Devices & services → Helpers** and select it in the card's **AUTO-Heizplan** field. Open the clock icon on the card. Each row is a time block with start, end (`24:00` means midnight), and temperature. You can select days, add/remove blocks, or copy one day to other days. The editor validates overlaps, ranges and temperatures before writing via the official Home Assistant API, checks for concurrent changes, and preserves custom data such as `block`, `climate_entity`, `target_entity`, and `mode_entity`. No YAML or "Additional data" field is needed. If some time ranges are empty, the existing thermostat setpoint remains unchanged in those gaps; make a 24-hour schedule for continuous control. Saving requires a user with schedule-update permissions.

### Testing

Core behavior simulated with native HVAC, helper modes, target temperature helper, heating sensor, on/off flame actor and AUS guard; JavaScript compilation and HUD markup render checked. Hardware testing and native schedule dialog verification remain outstanding. v0.1.2 is a preview; review behavior before controlling real heating hardware.

### License

MIT (see LICENSE).
