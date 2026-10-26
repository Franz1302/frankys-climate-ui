// Standalone regression smoke test for the visual original-look prototype.
// Run: node tests/original-design.test.js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

class Element {
  attachShadow() {
    this.shadowRoot = {innerHTML: "", querySelector: () => null, querySelectorAll: () => []};
    return this.shadowRoot;
  }
  dispatchEvent() {}
}
const registrations = new Map();
const customElements = {
  get: name => registrations.get(name),
  define: (name, value) => registrations.set(name, value)
};
const window = {customCards: [], PointerEvent: class {}};
const js = fs.readFileSync(path.join(__dirname, "..", "frankys-climate-original-card.js"), "utf8");
vm.runInNewContext(js, {HTMLElement: Element, customElements, window, console, Date, setInterval, clearInterval});
const Card = registrations.get("frankys-climate-original-card");
assert.equal(typeof Card, "function", "separate original-look card type must be registered");
assert.ok(registrations.get("frankys-climate-original-card-editor"), "existing visual editor must remain present");

for (const mode of ["auto", "heat", "off"]) {
  const card = new Card();
  card._hass = {
    states: {
      "climate.room": {
        entity_id: "climate.room",
        state: mode,
        attributes: {
          temperature: 21, current_temperature: 19.4, min_temp: 5, max_temp: 30,
          hvac_modes: ["off", "heat", "auto"], hvac_action: mode === "auto" ? "heating" : "idle",
          target_temp_step: .5
        }
      }
    },
    language: "de",
    config: {language: "de", unit_system: {temperature: "°C"}}
  };
  card.setConfig({name: "Wohnzimmer", display_entity: "climate.room", control_entity: "climate.room", language: "de"});
  const svg = card.shadowRoot.innerHTML;
  assert.deepEqual([card._minTemp(), card._maxTemp()], [5, 30], "native temperature limits");
  for (const content of [
    "Ist-Temperatur", "Soll-Temperatur", ">19,4</text>", ">21,0</text>",
    'data-action="minus"', 'data-action="plus"', "data-slider",
    'url(#rimSteel)', 'url(#steelBrush)', 'url(#faceHighlight)',
    'url(#buttonTopHighlight)', '</svg>'
  ]) assert.ok(svg.includes(content), mode + ": missing " + content);
  for (const button of ["AUS", "AUTO", "MANUELL"])
    assert.ok(svg.includes('data-mode="' + button + '"'), mode + ": missing mode " + button);
  assert.equal((svg.match(/data-slider-pointer/g) || []).length, 5, "all layered pointer lines must update during drag");
  assert.ok(svg.includes(mode === "auto" ? 'fill="url(#flameFill)"' : 'fill="#62707a"'), "heating flame reflects device status");
}
console.log("Original-look visual smoke checks passed (AUTO / MANUELL / AUS).");
