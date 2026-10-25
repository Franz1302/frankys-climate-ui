(function(){
  if (!Array.prototype.at) Array.prototype.at = function(n){ n = Math.trunc(n) || 0; if (n < 0) n += this.length; return this[n]; };
  if (!Array.prototype.flatMap) Array.prototype.flatMap = function(cb, thisArg){ return Array.prototype.concat.apply([], this.map(cb, thisArg)); };
  if (!Object.fromEntries) Object.fromEntries = function(entries){ var obj = {}; for (var i=0;i<entries.length;i++) obj[entries[i][0]] = entries[i][1]; return obj; };
})();

/**
 * Frankys_Stuff Climate Card UI-only v0.1.0 — no internal heating regulation
 * Reusable 1000x640 climate control for Home Assistant. Keeps legacy custom element IDs.
 */
const FrankysClimateScheduleEnglishErrors = {
  "Für beide Tagesgruppen mindestens einen Beginn eintragen.": "Enter at least one start time for both day groups.",
  "Bitte eine gültige Beginnzeit eingeben.": "Enter a valid start time.",
  "Temperatur: 5–30 °C in Schritten von 0,5 °C.": "Temperature: 5–30 °C in increments of 0.5 °C.",
  "Beginnzeiten dürfen nicht doppelt vorkommen.": "Duplicate start times are not allowed.",
  "Der vorhandene Plan enthält Zeitlücken. Er wurde nicht verändert; dieser Editor benötigt einen durchgehenden Wochenplan.": "The existing schedule contains gaps. It has not been changed; this editor requires a continuous weekly schedule.",
  "Der vorhandene Plan hat unterschiedliche Einzeltage. Er bleibt unverändert; unterstützt werden Mo–Fr und Sa–So.": "The existing schedule has different individual weekdays. It remains unchanged; Monday–Friday and Saturday–Sunday groups are supported.",
  "Der ausgewählte Heizplan wurde nicht gefunden.": "The selected heating schedule was not found.",
  "Der ausgewählte Heizplan ist nicht über die HA-Oberfläche bearbeitbar.": "The selected heating schedule cannot be edited through the Home Assistant interface.",
  "Mehrere Heizpläne sind dieser Climate-Entität zugeordnet. Es wurde nichts geändert.": "Several schedules are associated with this climate entity. Nothing was changed.",
  "Dieser Heizplan gehört zu einer anderen Climate-Entität.": "This heating schedule belongs to another climate entity.",
  "Der bestehende Plan enthält zusätzliche Daten und bleibt unverändert.": "The existing schedule contains additional data and has not been changed.",
  "Bitte eine vorhandene Climate-Entität auswählen.": "Select an existing climate entity.",
  "Der Heizplan wurde inzwischen geändert. Bitte abbrechen und erneut öffnen.": "The schedule has changed in the meantime. Cancel and reopen it.",
  "Speichern wurde gesendet, aber nicht eindeutig bestätigt. Bitte neu öffnen; nicht mehrfach speichern.": "Save was sent but could not be verified. Reopen it; do not save repeatedly.",
  "Dieser Heizplan wird gerade in einer anderen Karte gespeichert.": "This heating schedule is being saved in another card.",
  "Zum Speichern des Heizplans ist ein HA-Administratorkonto erforderlich.": "A Home Assistant administrator account is required to save the schedule.",
  "Heizplan konnte nicht geladen werden.": "Could not load the heating schedule.",
  "Heizplan konnte nicht gespeichert werden. Bitte neu öffnen und prüfen.": "Could not save the heating schedule. Reopen it and check."
};

// One optional service action per mode; deliberately no action sequences or templates.
function frankysModeAction(value) {
  const object = v => v !== null && typeof v === "object" && !Array.isArray(v);
  if (typeof value === "string" && /^script\.[a-z0-9_]+$/.test(value)) {
    return { domain: "script", service: "turn_on", data: { entity_id: value } };
  }
  if (!object(value)) throw new Error("Invalid mode action");
  const service = value.service || value.perform_action || value.action;
  const allowed = ["service", "perform_action", "action", "data", "target"];
  if (Object.keys(value).some(k => !allowed.includes(k)) ||
      typeof service !== "string" || !/^[a-z0-9_]+\.[a-z0-9_]+$/.test(service) ||
      (value.action && ![service, "call-service", "perform-action"].includes(value.action)) ||
      (value.service && value.perform_action && value.service !== value.perform_action) ||
      (value.data !== undefined && !object(value.data)) ||
      (value.target !== undefined && !object(value.target))) throw new Error("Invalid mode action");
  const [domain, name] = service.split(".");
  return { domain, service: name, data: value.data || {}, target: value.target };
}

class JarvisClimateCardLegacy extends HTMLElement {
  static getStubConfig() {
    return {
      name: "Klima",
      profile: "thermostat",
      display_entity: "",
      control_entity: "",
      manual_entity: "",
      min_temp: null,
      max_temp: null,
      step: null
    };
  }

  static getConfigElement() {
    return document.createElement("frankys-climate-ui-card-editor");
  }

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._pending = false;
    this._error = "";
    this._temperatureHistory = [];
    this._historySource = "";
    this._historyStamp = "";
    this._historyValue = NaN;
    this._historyLoading = false;
    this._historyLastFetch = 0;
    this._historyGeneration = 0;
    this._historyTimer = null;
  }

  connectedCallback() {
    if (!this._historyTimer) {
      this._historyTimer = setInterval(() => {
        this._ensureTemperatureHistory();
        this._render();
      }, 60000);
    }
    this._ensureTemperatureHistory();
  }

  disconnectedCallback() {
    if (this._historyTimer) {
      clearInterval(this._historyTimer);
      this._historyTimer = null;
    }
    this._historyGeneration++;
    this._historyLoading = false;
  }

  setConfig(config) {
    this._config = {
      name: "Klima",
      language: "auto",
      profile: "thermostat",
      scale: 1, // legacy: kept for old configs, no longer used for layout
      min_temp: null,
      max_temp: null,
      step: null,
      display_entity: "",
      control_entity: "",
      manual_entity: "",
      temperature_entity: "",
      target_entity: "",
      mode_entity: "",
      heater_entity: "",
      flame_switch_entity: "",
      heating_status_entity: "",
      off_script: "",
      manual_script: "",
      schedule_entity: "",
      embedded: false,
      ...config
    };
    this._recordTemperature();
    this._ensureTemperatureHistory();
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._recordTemperature();
    this._ensureTemperatureHistory();
    this._render();
  }

  getCardSize() { return 6; }
  _state(id) { return id && this._hass && this._hass.states ? this._hass.states[id] : undefined; }
  _num(v, fallback = NaN) { const n = Number(v); return Number.isFinite(n) ? n : fallback; }
  _profile() { return "thermostat"; }
  _lang() {
    let raw = String((this._config && this._config.language) || "auto").toLowerCase();
    if (raw === "auto") raw = String((this._hass && this._hass.locale && this._hass.locale.language) || (this._hass && this._hass.language) || "en").toLowerCase();
    raw = raw.split("-")[0].split("_")[0];
    return raw === "de" ? "de" : "en";
  }
  _t(key) {
    const table = {
      de:{actual:"Aktuell",mode:"Modus",off:"AUS",auto:"AUTO",manual:"MANUELL",target:"Soll-Temperatur",sending:"BEFEHL WIRD GESENDET",unavailable:"NICHT VERFÜGBAR",ready:"BEREIT",active:"HEIZT",noHeat:"HEIZT NICHT",scheduleSetup:"HEIZPLAN ÜBER DIE UHR EINRICHTEN",noBlock:"KEIN GÜLTIGER ZEITBLOCK",schedule:"Heizplan öffnen",until:"BIS",plan:"HEIZPLAN",planIntro:"Jeder Beginn gilt bis zum nächsten Eintrag, auch über Mitternacht. Temperaturen: 5–30 °C · Schritt 0,5 °C.",weekday:"Mo–Fr",weekend:"Sa–So",start:"Beginn",temperature:"Temperatur °C",addStart:"+ Beginn",loading:"Heizplan wird geladen / gespeichert …",admin:"Bearbeiten und Speichern erfordert ein HA-Administratorkonto.",cancel:"ABBRECHEN",save:"SPEICHERN",remove:"Eintrag entfernen",noAutoMode:"AUTO NICHT UNTERSTÜTZT"},
      en:{actual:"Current",mode:"Mode",off:"OFF",auto:"AUTO",manual:"MANUAL",target:"Target Temp.",sending:"SENDING COMMAND",unavailable:"UNAVAILABLE",ready:"READY",active:"HEATING",noHeat:"NOT HEATING",scheduleSetup:"SET SCHEDULE VIA CLOCK",noBlock:"NO VALID TIME BLOCK",schedule:"Open schedule",until:"UNTIL",plan:"SCHEDULE",planIntro:"Each start time remains active until the next entry, including across midnight. Temperatures: 5–30 °C · Step 0.5 °C.",weekday:"Mon–Fri",weekend:"Sat–Sun",start:"Start",temperature:"Temperature °C",addStart:"+ Start",loading:"Schedule is loading / saving …",admin:"Editing and saving requires a Home Assistant administrator account.",cancel:"CANCEL",save:"SAVE",remove:"Remove entry",noAutoMode:"AUTO NOT SUPPORTED"}
    };
    const d = table[this._lang()] || table.en;
    return d[key] || key;
  }
  _localizedScheduleError(message) {
    if (this._lang() !== "en") return message;
    if (FrankysClimateScheduleEnglishErrors[message])
      return FrankysClimateScheduleEnglishErrors[message];
    const match = /^Die Kartenkonfiguration passt nicht zur vorhandenen (target_entity|mode_entity)-Zuordnung\.$/.exec(message);
    if (match) return "Card configuration does not match the existing " + match[1] + " association.";
    return message;
  }
  _modeDisplay(mode) {
    return mode === "AUS" ? this._t("off") : mode === "AUTO" ? this._t("auto") : mode === "MANUELL" ? this._t("manual") : mode;
  }
  _displayState() { return this._state(this._config.display_entity || this._config.control_entity); }
  _controlState() { return this._state(this._config.control_entity || this._config.display_entity); }

  _actualTemp() {
    if (this._config.temperature_entity) { const s = this._state(this._config.temperature_entity); return this._num(s ? s.state : undefined); }
    const s = this._displayState(); return this._num(s && s.attributes ? s.attributes.current_temperature : undefined);
  }

  _recordTemperature() {
    if (!this._config) return;
    const sensor = this._config.temperature_entity;
    const id = sensor || this._config.display_entity || this._config.control_entity || "";
    const source = JSON.stringify([id, sensor ? "state" : "current_temperature"]);
    if (source !== this._historySource) {
      this._temperatureHistory = [];
      this._historySource = source;
      this._historyStamp = "";
      this._historyValue = NaN;
      this._historyLastFetch = 0;
      this._historyGeneration++;
      this._historyLoading = false;
    }
    const state = this._state(id);
    if (!state) return;
    const attributes = state.attributes || {};
    const invalid = state.state === "unavailable" || state.state === "unknown";
    const raw = sensor ? state.state : attributes.current_temperature;
    const valid = !invalid &&
      (typeof raw === "number" || (typeof raw === "string" && raw.trim() !== "")) &&
      Number.isFinite(Number(raw));
    const value = valid ? Number(raw) : null;
    const stamp = String(state.last_updated || state.last_changed || "");
    if (!stamp || stamp === this._historyStamp) return;
    this._historyStamp = stamp;
    // Target and mode changes are not temperature readings.
    if (valid && value === this._historyValue) return;
    if (!valid && !Number.isFinite(this._historyValue)) return;
    this._historyValue = valid ? value : NaN;
    const t = Date.parse(stamp);
    if (!Number.isFinite(t)) return;
    this._temperatureHistory.push({ t: t, v: value });
    const cutoff = Date.now() - 24 * 3600000;
    this._temperatureHistory = this._temperatureHistory.filter(p => p.t >= cutoff);
  }

  _ensureTemperatureHistory() {
    if (!this.isConnected || !this._config || !this._hass ||
        typeof this._hass.callWS !== "function" || this._historyLoading) return;
    if (Date.now() - this._historyLastFetch < 15 * 60000) return;
    const sensor = this._config.temperature_entity;
    const id = sensor || this._config.display_entity || this._config.control_entity;
    if (!id) return;
    const source = this._historySource;
    const generation = ++this._historyGeneration;
    const end = Date.now();
    const start = end - 24 * 3600000;
    this._historyLoading = true;
    this._historyLastFetch = end;
    // Query Home Assistant's recorder, not browser memory, so a reload retains 24h.
    // Climate temperature is an attribute and requires the complete attributes.
    this._hass.callWS({
      type: "history/history_during_period",
      start_time: new Date(start).toISOString(),
      end_time: new Date(end).toISOString(),
      entity_ids: [id],
      include_start_time_state: true,
      significant_changes_only: true,
      minimal_response: false,
      no_attributes: !!sensor
    }).then(result => {
      if (generation !== this._historyGeneration || source !== this._historySource) return;
      const records = result && result[id] && Array.isArray(result[id]) ? result[id] : [];
      const restored = [];
      for (let i = 0; i < records.length; i++) {
        const item = records[i];
        const t = typeof item.lu === "number" ? item.lu * 1000 :
          Date.parse(item.last_updated || item.last_changed || "");
        if (!Number.isFinite(t) || t < start || t > Date.now()) continue;
        const state = item.s !== undefined ? item.s : item.state;
        if (state === "unavailable" || state === "unknown") {
          restored.push({ t: t, v: null });
          continue;
        }
        const attrs = item.a || item.attributes || {};
        const raw = sensor ? state : attrs.current_temperature;
        if ((typeof raw !== "number" && typeof raw !== "string") ||
            (typeof raw === "string" && raw.trim() === "") ||
            !Number.isFinite(Number(raw))) continue;
        restored.push({ t: t, v: Number(raw) });
      }
      // Include live samples that may not yet have been committed to recorder.
      const together = restored.concat(this._temperatureHistory.filter(p => p.t >= start));
      together.sort((a, b) => a.t - b.t);
      const unique = [];
      for (let i = 0; i < together.length; i++) {
        const point = together[i];
        if (unique.length && unique[unique.length - 1].t === point.t)
          unique[unique.length - 1] = point;
        else unique.push(point);
      }
      this._temperatureHistory = unique;
      this._render();
    }).catch(() => {
      // Keep valid live readings; retry without flooding the recorder.
      if (generation === this._historyGeneration) this._historyLastFetch = Date.now() - 14 * 60000;
    }).then(() => {
      if (generation === this._historyGeneration) this._historyLoading = false;
    });
  }

  _temperatureSparkline() {
    const now = Date.now();
    const start = now - 24 * 3600000;
    const points = this._temperatureHistory.filter(p => p.t >= start && p.t <= now);
    const axis = `<g pointer-events="none" aria-hidden="true">
      <path d="M65 261H285M65 227V261M175 227V261M285 227V261" fill="none" stroke="#34e9ff" stroke-opacity=".17" stroke-width=".75"/>
      <g fill="#a6d7f0" fill-opacity=".58" font-family="Arial" font-size="10" text-anchor="middle">
        <text x="65" y="274">-24h</text><text x="175" y="274">-12h</text><text x="285" y="274">0h</text>
      </g></g>`;
    const measured = points.filter(p => p.v !== null && Number.isFinite(p.v));
    if (!measured.length) return axis;
    let low = measured[0].v, high = measured[0].v;
    for (let i = 1; i < measured.length; i++) {
      low = Math.min(low, measured[i].v);
      high = Math.max(high, measured[i].v);
    }
    const span = Math.max(1, high - low);
    const center = (low + high) / 2;
    // True timestamps determine X; skipped/unavailable records break the line.
    const toX = t => 65 + (t - start) / (24 * 3600000) * 220;
    const toY = v => 244 - (v - center) / span * 29;
    const groups = [];
    let group = [];
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      if (p.v === null) {
        if (group.length) groups.push(group);
        group = [];
      } else {
        group.push(p);
      }
    }
    if (group.length) groups.push(group);
    // Continuation to 'now' only while the actual source remains available.
    const id = this._config.temperature_entity ||
      this._config.display_entity || this._config.control_entity;
    const current = this._state(id);
    if (groups.length && current && current.state !== "unavailable" && current.state !== "unknown") {
      const lastGroup = groups[groups.length - 1];
      const lastPoint = lastGroup[lastGroup.length - 1];
      if (lastPoint.v !== null && lastPoint.t < now)
        lastGroup.push({ t: now, v: lastPoint.v });
    }
    const strokes = [];
    for (let g = 0; g < groups.length; g++) {
      const entries = groups[g];
      if (entries.length < 2) continue;
      // Keep the first, minimum, maximum and last reading in each pixel column.
      // This preserves spikes without drawing thousands of SVG points.
      const reduced = [];
      let bucket = [], pixel = -1;
      const flush = () => {
        if (!bucket.length) return;
        const candidates = [bucket[0], bucket[bucket.length - 1]];
        let min = bucket[0], max = bucket[0];
        for (let n = 1; n < bucket.length; n++) {
          if (bucket[n].v < min.v) min = bucket[n];
          if (bucket[n].v > max.v) max = bucket[n];
        }
        candidates.push(min, max);
        candidates.sort((a, b) => a.t - b.t);
        for (let n = 0; n < candidates.length; n++)
          if (!reduced.length || reduced[reduced.length - 1].t !== candidates[n].t)
            reduced.push(candidates[n]);
        bucket = [];
      };
      for (let i = 0; i < entries.length; i++) {
        const p = entries[i], cell = Math.floor(toX(p.t));
        if (cell !== pixel) { flush(); pixel = cell; }
        bucket.push(p);
      }
      flush();
      const line = reduced.map(p =>
        toX(p.t).toFixed(2) + "," + toY(p.v).toFixed(2)).join(" ");
      strokes.push(`<polyline points="${line}" stroke-width="6" opacity=".09"/><polyline points="${line}" stroke-width="3" opacity=".22"/><polyline points="${line}" stroke-width="1.7" opacity=".88"/>`);
    }
    return axis + `<g fill="none" stroke="#34e9ff" stroke-linecap="round" stroke-linejoin="round" pointer-events="none" aria-hidden="true">${strokes.join("")}</g>`;
  }

  _targetTemp() {
    const entity = this._config.target_entity;
    const state = entity ? this._state(entity) : this._displayState();
    const reported = entity
      ? this._num(state ? state.state : undefined)
      : this._num(state && state.attributes ? state.attributes.temperature : undefined);
    const optimistic = this._optimisticTarget;
    if (optimistic && (
      (Number.isFinite(reported) && Math.abs(reported - optimistic.value) < 0.001) ||
      Date.now() >= optimistic.until
    )) this._optimisticTarget = null;
    return this._optimisticTarget ? this._optimisticTarget.value : reported;
  }

  _heaterOn() {
    if (this._config.heating_status_entity) {
      const e=this._state(this._config.heating_status_entity);
      return !!e && e.state==="on";
    }
    const e=this._controlState();
    return !!e && e.state!=="off" && (e.attributes||{}).hvac_action==="heating";
  }
  _mode() {
    if (this._config.mode_entity) {
      const e=this._state(this._config.mode_entity);
      const m=String((e&&e.state)||"").toUpperCase();
      if(m==="AUTO")return "AUTO";
      if(["MANUELL","MANUAL"].includes(m))return "MANUELL";
      if(["AUS","OFF"].includes(m))return "AUS";
      return "UNAVAILABLE";
    }
    const e=this._controlState();
    if(!e)return "UNAVAILABLE";
    return ({heat:"MANUELL",auto:"AUTO",off:"AUS"})[e.state]||"UNAVAILABLE";
  }
  _minTemp() {
    const ds = this._displayState(); const attr = ds && ds.attributes ? ds.attributes.min_temp : undefined;
    const cfg = this._config.min_temp;
    return cfg === null || cfg === undefined || cfg === ""
      ? this._num(attr, 5)
      : this._num(cfg, this._num(attr, 5));
  }

  _maxTemp() {
    const ds = this._displayState(); const attr = ds && ds.attributes ? ds.attributes.max_temp : undefined;
    const cfg = this._config.max_temp;
    return cfg === null || cfg === undefined || cfg === ""
      ? this._num(attr, 35)
      : this._num(cfg, this._num(attr, 35));
  }

  _step() {
    const ds = this._displayState(); const attr = ds && ds.attributes ? ds.attributes.target_temp_step : undefined;
    const cfg = this._config.step;
    const value = cfg === null || cfg === undefined || cfg === ""
      ? this._num(attr, 0.5)
      : this._num(cfg, this._num(attr, 0.5));
    return Math.max(0.1, value);
  }

  async _call(domain, service, data = {}, target) {
    if (!this._hass || this._pending) return false;
    this._pending = true;
    this._error = "";
    this._render();
    try {
      await this._hass.callService(domain, service, data, target);
      return true;
    } catch (e) {
      console.error("Frankys_Stuff Climate Card service call failed:", e);
      this._error = "BEFEHL FEHLGESCHLAGEN";
      return false;
    } finally {
      this._pending = false;
      this._render();
    }
  }

  _thermostatAutoMode(control) {
    const attrs = (this._state(control) || {}).attributes || {};
    const modes = attrs.hvac_modes;
    // Only "auto" is an explicit opt-in; anything else keeps the legacy "heat".
    const preferred = this._config.auto_hvac_mode === "auto" ? "auto" : "heat";
    const other = preferred === "auto" ? "heat" : "auto";
    // Without a reported mode list, use the configured mode.
    if (!Array.isArray(modes) || !modes.length) return preferred;
    if (modes.indexOf(preferred) !== -1) return preferred;
    if (modes.indexOf(other) !== -1) return other;
    return null;
  }

  _modeAction(mode) {
    const key = { AUS: "mode_off_action", AUTO: "mode_auto_action", MANUELL: "mode_manual_action" }[mode];
    return key ? this._config[key] : undefined;
  }

  _hasModeAction(mode) {
    const value = this._modeAction(mode);
    return value !== undefined && value !== null && value !== "";
  }

  async _setMode(mode) {
    if(this._pending||!this._hass)return;
    if(this._hasModeAction(mode)){
      let action;
      try{action=frankysModeAction(this._modeAction(mode));}
      catch(e){this._error="INVALID MODE ACTION";this._render();return;}
      await this._call(action.domain,action.service,action.data,action.target);return;
    }
    if(this._config.mode_entity){
      const id=this._config.mode_entity,domain=id.split(".")[0],e=this._state(id);
      const aliases={AUS:["AUS","OFF"],AUTO:["AUTO"],MANUELL:["MANUELL","MANUAL"]}[mode]||[];
      const options=e&&e.attributes&&e.attributes.options;
      const option=Array.isArray(options)&&options.find(o=>aliases.includes(String(o).toUpperCase()));
      if(!["input_select","select"].includes(domain)||!option||["unknown","unavailable"].includes(e.state)){
        this._error="MODE UNAVAILABLE";this._render();return;
      }
      if(e.state!==option)await this._call(domain,"select_option",{entity_id:id,option});return;
    }
    const id=this._config.control_entity||this._config.display_entity;
    const e=this._state(id),m={AUS:"off",AUTO:"auto",MANUELL:"heat"}[mode];
    if(!e||!m||!Array.isArray((e.attributes||{}).hvac_modes)||!e.attributes.hvac_modes.includes(m)){
      this._error="MODE NOT SUPPORTED";this._render();return;
    }
    if(m==="off")await this._call("climate","turn_off",{entity_id:id});
    else await this._call("climate","set_hvac_mode",{entity_id:id,hvac_mode:m});
  }
  async _toggleFlame() {
    const id=this._config.flame_switch_entity;
    if(!id||this._mode()==="AUS"||this._pending)return;
    const domain=id.split(".")[0],e=this._state(id);
    if(!["switch","input_boolean"].includes(domain)||!e||!["on","off"].includes(e.state))return;
    await this._call(domain,e.state==="on"?"turn_off":"turn_on",{entity_id:id});
  }
  async _changeTarget(delta) {
    const current = this._targetTemp();
    if (!Number.isFinite(current)) return;
    const next = Math.max(this._minTemp(), Math.min(this._maxTemp(), Math.round((current + delta) * 10) / 10));

    return this._setTarget(next);
  }

  async _setTarget(next) {
    if (this._pending || !Number.isFinite(next)) return false;
    let domain, service, data;
    if (this._config.target_entity) {
      const entityDomain = this._config.target_entity.split(".")[0];
      if (entityDomain === "input_number" || entityDomain === "number") {
        domain = entityDomain;
        service = "set_value";
        data = { entity_id: this._config.target_entity, value: next };
      }
    }
    if (!domain) {
      const control = this._config.control_entity || this._config.display_entity;
      if (!control) return false;
      domain = "climate";
      service = "set_temperature";
      data = { entity_id: control, temperature: next };
    }
    // Keep the selected temperature visible while Home Assistant updates the entity.
    this._optimisticTarget = { value: next, until: Date.now() + 4000 };
    const ok = await this._call(domain, service, data);
    if (!ok) {
      this._optimisticTarget = null;
      this._render();
    }
    return ok;
  }

  _sliderValue(ev, slider, previousValue = NaN) {
    const ctm = slider.getScreenCTM();
    if (!ctm) return this._targetTemp();
    const svg = slider.ownerSVGElement;
    if (!svg || !svg.createSVGPoint) return this._targetTemp();
    const svgPoint = svg.createSVGPoint();
    svgPoint.x = ev.clientX;
    svgPoint.y = ev.clientY;
    const point = svgPoint.matrixTransform(ctm.inverse());
    let angle = (Math.atan2(point.y - 320, point.x - 655) * 180 / Math.PI - 135 + 360) % 360;
    const min = this._minTemp(), max = this._maxTemp(), step = this._step();
    // The lower 90-degree gap is not part of the control: hold the previous
    // endpoint during a drag instead of jumping from minimum to maximum.
    if (angle > 270) {
      angle = Number.isFinite(previousValue) && max > min
        ? ((previousValue - min) / (max - min) >= 0.5 ? 270 : 0)
        : (angle < 315 ? 270 : 0);
    }
    const raw = min + angle / 270 * (max - min);
    return Math.max(min, Math.min(max, Number((min + Math.round((raw - min) / step) * step).toFixed(8))));
  }

  _previewSlider(value) {
    this._sliderDrag.value = value;
    const g = this._dialGeometry(value, this._actualTemp());
    this.shadowRoot.querySelector("[data-slider-value]").textContent = this._fmtTemp(value);
    this.shadowRoot.querySelectorAll("[data-slider-pointer]").forEach(line => {
      line.setAttribute("x1", g.pointerStart.x);
      line.setAttribute("y1", g.pointerStart.y);
      line.setAttribute("x2", g.pointerEnd.x);
      line.setAttribute("y2", g.pointerEnd.y);
    });
  }

  _bindSlider() {
    const slider = this.shadowRoot.querySelector("[data-slider]");
    if (!slider) return;
    const tolerance = 14;
    const begin = (id, x, y, pointerType) => {
      if (this._pending || this._sliderDrag || !Number.isFinite(this._targetTemp()) ||
          this._maxTemp() <= this._minTemp()) return false;
      const tapValue = this._sliderValue({ clientX: x, clientY: y }, slider);
      this._sliderDrag = { id, x, y, value: tapValue, tapValue, dragging: false, pointerType };
      this._previewSlider(tapValue);
      return true;
    };
    const move = (id, x, y) => {
      const drag = this._sliderDrag;
      if (!drag || drag.id !== id) return;
      if (!drag.dragging) {
        const moved = Math.hypot(x - drag.x, y - drag.y);
        if (drag.pointerType !== "mouse" && moved < tolerance) return;
        drag.dragging = true;
      }
      this._previewSlider(this._sliderValue({ clientX: x, clientY: y }, slider, drag.value));
    };
    const finish = (id, commit) => {
      const drag = this._sliderDrag;
      if (!drag || drag.id !== id) return;
      const value = drag.dragging ? drag.value : drag.tapValue;
      this._sliderDrag = null;
      if (commit && value !== this._targetTemp()) this._setTarget(value);
      else this._render();
    };
    if (typeof window.PointerEvent === "function") {
      slider.addEventListener("pointerdown", ev => {
        if (ev.button !== 0 || ev.isPrimary === false) return;
        if (!begin(ev.pointerId, ev.clientX, ev.clientY, ev.pointerType)) return;
        ev.preventDefault();
        ev.stopPropagation();
        if (slider.setPointerCapture) slider.setPointerCapture(ev.pointerId);
      });
      slider.addEventListener("pointermove", ev => {
        if (!this._sliderDrag || this._sliderDrag.id !== ev.pointerId) return;
        ev.preventDefault();
        ev.stopPropagation();
        move(ev.pointerId, ev.clientX, ev.clientY);
      });
      slider.addEventListener("pointerup", ev => {
        if (!this._sliderDrag || this._sliderDrag.id !== ev.pointerId) return;
        ev.preventDefault();
        ev.stopPropagation();
        finish(ev.pointerId, true);
        if (slider.hasPointerCapture && slider.hasPointerCapture(ev.pointerId)) slider.releasePointerCapture(ev.pointerId);
      });
      slider.addEventListener("pointercancel", ev => finish(ev.pointerId, false));
      slider.addEventListener("lostpointercapture", ev => finish(ev.pointerId, false));
    } else {
      // Older Safari/WebKit (including iOS 12): touch/mouse without PointerEvent.
      const touchById = (list, id) => {
        for (let i = 0; i < list.length; i++) if (list[i].identifier === id) return list[i];
        return null;
      };
      slider.addEventListener("touchstart", ev => {
        if (ev.touches.length !== 1) return;
        const t = ev.changedTouches[0];
        if (begin(t.identifier, t.clientX, t.clientY, "touch")) {
          ev.preventDefault();
          ev.stopPropagation();
        }
      }, { passive: false });
      slider.addEventListener("touchmove", ev => {
        if (!this._sliderDrag || this._sliderDrag.pointerType !== "touch") return;
        const t = touchById(ev.changedTouches, this._sliderDrag.id);
        if (!t) return;
        ev.preventDefault();
        ev.stopPropagation();
        move(t.identifier, t.clientX, t.clientY);
      }, { passive: false });
      const touchEnd = (ev, commit) => {
        if (!this._sliderDrag || this._sliderDrag.pointerType !== "touch") return;
        const t = touchById(ev.changedTouches, this._sliderDrag.id);
        if (!t) return;
        ev.preventDefault();
        ev.stopPropagation();
        finish(t.identifier, commit);
      };
      slider.addEventListener("touchend", ev => touchEnd(ev, true), { passive: false });
      slider.addEventListener("touchcancel", ev => touchEnd(ev, false), { passive: false });
      const mouseMove = ev => { ev.preventDefault(); move("mouse", ev.clientX, ev.clientY); };
      const mouseUp = () => {
        window.removeEventListener("mousemove", mouseMove);
        window.removeEventListener("mouseup", mouseUp);
        finish("mouse", true);
      };
      slider.addEventListener("mousedown", ev => {
        if (ev.button !== 0 || !begin("mouse", ev.clientX, ev.clientY, "mouse")) return;
        ev.preventDefault();
        ev.stopPropagation();
        window.addEventListener("mousemove", mouseMove);
        window.addEventListener("mouseup", mouseUp);
      });
    }
    slider.addEventListener("click", ev => ev.stopPropagation());
  }

  _fmtTemp(n) { return Number.isFinite(n) ? n.toFixed(1).replace(".", ",") : "–"; }

  _scheduleInfo() {
    if (!this._scheduleEnabled() || this._mode() !== "AUTO") return "";
    const plan = this._scheduleState();
    if (!plan) return this._t("auto") + " · " + this._t("scheduleSetup");
    const raw = plan && plan.attributes ? plan.attributes.temperature : undefined;
    const temp = raw === null || raw === undefined || raw === "" ? NaN : Number(raw);
    if (!plan || plan.state !== "on" || !Number.isFinite(temp) || temp < this._minTemp() || temp > this._maxTemp()) {
      return this._t("auto") + " · " + this._t("noBlock");
    }
    const block = String(plan.attributes.block || "HEIZPLAN").toUpperCase();
    const next = new Date(plan.attributes.next_event || "");
    const until = Number.isFinite(next.getTime())
      ? " · " + this._t("until") + " " + new Intl.DateTimeFormat(this._lang() === "de" ? "de-AT" : "en-GB", {
          hour: "2-digit", minute: "2-digit",
          timeZone: (this._hass && this._hass.config && this._hass.config.time_zone) || "Europe/Vienna"
        }).format(next)
      : "";
    return (this._t("auto") + " · " + block + " " + this._fmtTemp(temp) + " °C" + until)
      .replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  }

  _scheduleClimate(){return this._config.control_entity||this._config.display_entity||"";}
  _scheduleState(){
    if(this._config.schedule_entity)return this._state(this._config.schedule_entity);
    const id=this._scheduleClimate();
    return Object.values((this._hass&&this._hass.states)||{}).find(e=>
      e&&typeof e.entity_id==="string"&&e.entity_id.startsWith("schedule.")&&
      e.attributes&&e.attributes.climate_entity===id);
  }
  _scheduleEnabled(){return !!this._scheduleState();}
  _openSchedule(){
    const e=this._scheduleState();if(!e)return;
    this.dispatchEvent(new CustomEvent("hass-more-info",{bubbles:true,composed:true,detail:{entityId:e.entity_id}}));
  }
  _dialGeometry(target, current) {
    const min = this._minTemp();
    const max = this._maxTemp();
    const clamp = v => Math.max(0, Math.min(1, v));
    const targetP = Number.isFinite(target) && max > min ? clamp((target - min) / (max - min)) : 0;
    const currentP = Number.isFinite(current) && max > min ? clamp((current - min) / (max - min)) : 0;
    const cx = 655, cy = 320, r = 220, start = 135, sweep = 270;
    const polar = (angle, radius) => {
      const a = angle * Math.PI / 180;
      return { x: cx + radius * Math.cos(a), y: cy + radius * Math.sin(a) };
    };
    const angle = start + sweep * targetP;
    const currentAngle = start + sweep * currentP;
    const p0 = polar(start, r);
    const p1 = polar(start + sweep, r);

    let ticks = "", labels = "";
    const range = max - min;
    if (Number.isFinite(range) && range > 0) {
      // Standard ranges: numbers every 5 degrees, minor ticks every degree.
      // Bound SVG complexity for unusually large configured ranges.
      const majorStep = Math.max(5, Math.ceil(range / 50) * 5);
      const minorStep = majorStep / 5;
      const values = [min];
      const first = Math.ceil(min / majorStep) * majorStep;
      for (let i = 0; i <= 12; i++) {
        const value = first + i * majorStep;
        if (value >= max) break;
        if (value <= min) continue;
        // Leave room for endpoint labels in fractional/custom ranges.
        const previous = values[values.length - 1];
        if ((value - previous) / range * sweep >= 10 &&
            (max - value) / range * sweep >= 10) values.push(value);
      }
      values.push(max);
      const firstMinor = Math.ceil(min / minorStep) * minorStep;
      for (let i = 0; i <= 60; i++) {
        const value = firstMinor + i * minorStep;
        if (value >= max) break;
        if (value <= min) continue;
        const a = start + sweep * (value - min) / range;
        // A number replaces its tick. Also keep nearby endpoint text clear.
        if (values.some(v => Math.abs(value - v) / range * sweep < 4.5)) continue;
        const q1 = polar(a, 255), q2 = polar(a, 266);
        ticks += `<line x1="${q1.x}" y1="${q1.y}" x2="${q2.x}" y2="${q2.y}" stroke="#7191a3" stroke-width="2" stroke-linecap="round" opacity=".58"/>`;
      }
      labels = values.map(value => {
        const a = start + sweep * (value - min) / range;
        // Center each number on the former main tick (r = 250 to 266).
        const pt = polar(a, 258);
        const text = String(Number(value.toFixed(8))).replace(".", this._lang() === "de" ? "," : ".");
        const fit = text.length > 2 ? ' textLength="32" lengthAdjust="spacingAndGlyphs"' : "";
        return `<text x="${pt.x}" y="${pt.y}" dy=".35em" fill="#eef8ff" font-size="22" font-weight="600" font-family="Arial" text-anchor="middle"${fit}>${text}</text>`;
      }).join("");
    }

    return {
      cx, cy, ticks, labels,
      arc: `M ${p0.x} ${p0.y} A ${r} ${r} 0 1 1 ${p1.x} ${p1.y}`,
      pointerStart: polar(angle, 195),
      pointerEnd: polar(angle, 225),
      currentMarker: polar(currentAngle, r)
    };
  }

  _escape(value) {
    return String(value === null || value === undefined ? "" : value)
      .replace(/[&<>"']/g, c => ({"&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"}[c]));
  }

  _render() {
    if (!this.shadowRoot || !this._config || this._sliderDrag) return;

    const actual = this._actualTemp();
    const target = this._targetTemp();
    const mode = this._mode();
    const heaterOn = this._heaterOn();
    const heatingStatusEntity = this._config.heating_status_entity || "";
    const heatingStatusState = heatingStatusEntity ? this._state(heatingStatusEntity) : null;
    const heatingStatusUnavailable = !!heatingStatusEntity &&
      (!heatingStatusState || !["on", "off"].includes(heatingStatusState.state));
    const heaterUnavailable = false;
    const g = this._dialGeometry(target, actual);
    const name = this._config.name || "Klima";
    const modes=((this._controlState()||{}).attributes||{}).hvac_modes||[];
    const canMode=m=>!!this._config.mode_entity||this._hasModeAction(m)||
      (Array.isArray(modes)&&modes.includes({AUS:"off",AUTO:"auto",MANUELL:"heat"}[m]));
    const modeStroke = m => mode === m ? (m === "AUS" ? "#ff7a22" : "#18dfff") : "#507184";
    const modeText = m => mode === m ? (m === "AUS" ? "#ff9c46" : "#34e9ff") : "#9eb1bd";
    const status=this._error|| (this._pending?this._t("sending"):
      (mode==="UNAVAILABLE"||heatingStatusUnavailable)?this._t("unavailable"):
      mode==="AUS"?name.toUpperCase()+" · "+this._t("off"):
      name.toUpperCase()+" · "+this._t(heaterOn?"active":"noHeat"));
    const safeName = this._escape(name.toUpperCase());
    const safeStatus = this._escape(status);
    const safeScheduleInfo = this._escape(this._scheduleInfo());

    this.shadowRoot.innerHTML = `
      <style>
        :host{display:block;width:100%;max-width:100%;margin:0 auto;font-family:Arial,sans-serif;}
        .frame{position:relative;width:100%;height:0;padding-bottom:64%;overflow:hidden;border-radius:22px;user-select:none;-webkit-user-select:none;touch-action:manipulation;}
        svg{position:absolute;top:0;left:0;display:block;width:100%;height:100%;}
        .hit{cursor:pointer;fill:transparent;pointer-events:all;}
        .hit:hover{fill:rgba(255,255,255,.025);}
      </style>
      <div class="frame">
        <svg viewBox="0 0 1000 640" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#04121c"/><stop offset="55%" stop-color="#071521"/><stop offset="100%" stop-color="#02090f"/></linearGradient>
            <linearGradient id="arcGradient" x1="405" y1="320" x2="905" y2="320" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#087cff"/><stop offset="24%" stop-color="#11eaff"/><stop offset="51%" stop-color="#e6f43a"/><stop offset="72%" stop-color="#ff9c22"/><stop offset="100%" stop-color="#ff203e"/></linearGradient>
            <linearGradient id="pointerGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#fffac5"/><stop offset="45%" stop-color="#ffd23e"/><stop offset="100%" stop-color="#ff7610"/></linearGradient>
            <clipPath id="pointerClip"><circle cx="655" cy="320" r="233"/></clipPath>
            <filter id="orangeGlow" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="7"/></filter>
            <filter id="heatGlow" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="5"/></filter>
          </defs>

          ${this._config.embedded ? "" : `
          <rect x="12" y="12" width="976" height="616" rx="27" fill="url(#bg)" stroke="#00dcff" stroke-opacity=".60" stroke-width="2"/>
          <rect x="22" y="22" width="956" height="596" rx="23" fill="none" stroke="#5dd6ff" stroke-opacity=".10" stroke-width="1"/>`}

          <rect x="40" y="42" width="270" height="238" rx="18" fill="#071722" stroke="#67d9ff" stroke-opacity=".42" stroke-width="2"/>
          ${this._temperatureSparkline()}
          <text x="126" y="94" fill="#e8f5fc" font-family="Arial" font-size="29" font-weight="600" text-anchor="start">${this._t("actual")}</text>
          <text x="72" y="98" fill="#ff7d25" font-family="Arial" font-size="46">♨</text>
          <text x="175" y="208" fill="#f4fbff" font-family="Arial" font-size="86" font-weight="650" text-anchor="middle">${this._fmtTemp(actual)}</text>
          <text x="258" y="170" fill="#f4fbff" font-family="Arial" font-size="35" font-weight="600">°C</text>

          <rect x="40" y="300" width="270" height="300" rx="18" fill="#071722" stroke="#67d9ff" stroke-opacity=".42" stroke-width="2"/>
          <text x="91" y="350" fill="#18dfff" font-family="Arial" font-size="38">⚙</text>
          <text x="184" y="350" fill="#e8f5fc" font-family="Arial" font-size="29" font-weight="600" text-anchor="middle">${this._t("mode")}</text>

          ${["AUS", "AUTO", "MANUELL"].map((m, i) => {
            const y = 375 + i * 80;
            const enabled = canMode(m);
            const stroke = enabled ? modeStroke(m) : "#334a57";
            const color = enabled ? modeText(m) : "#506672";
            const fill = enabled && mode === m
              ? (m === "AUS" ? "rgba(255,110,20,.12)" : "rgba(0,190,255,.12)")
              : "#07151f";

            return `<rect x="60" y="${y}" width="230" height="62" rx="17" fill="${fill}" stroke="${stroke}" stroke-width="2"/><circle cx="93" cy="${y + 31}" r="10" fill="none" stroke="${stroke}" stroke-width="2"/><text x="185" y="${y + 39}" fill="${color}" font-family="Arial" font-size="29" font-weight="700" text-anchor="middle">${this._modeDisplay(m)}</text>${enabled ? `<rect class="hit" data-action="mode" data-mode="${m}" x="60" y="${y}" width="230" height="62" rx="17"/>` : ""}`;
          }).join("")}

          <rect x="330" y="42" width="630" height="558" rx="18" fill="#06131d" stroke="${this._config.embedded ? "none" : "#67d9ff"}" stroke-opacity="${this._config.embedded ? "0" : ".42"}" stroke-width="2"/>
          <text x="655" y="68" fill="#b3cad8" font-family="Arial" font-size="22" font-weight="600" letter-spacing="3" text-anchor="middle">${safeName}</text>
          ${this._scheduleEnabled() ? `<g data-action="schedule" role="button" tabindex="0" aria-label="${this._t("schedule")}" style="cursor:pointer"><title>${this._t("schedule")}</title><circle cx="919" cy="91" r="22" fill="#071722" stroke="#23d8ff" stroke-width="2"/><path d="M919 77V91L928 97" fill="none" stroke="#23d8ff" stroke-width="2.5" stroke-linecap="round"/></g>` : ""}
          <text x="645" y="584" fill="#a6d7f0" font-family="Arial" font-size="17" font-weight="500" text-anchor="middle">${safeScheduleInfo}</text>
          <g transform="translate(0,24)">
          <path d="${g.arc}" fill="none" stroke="#1e3442" stroke-width="34" stroke-linecap="round"/>
          <path d="${g.arc}" fill="none" stroke="url(#arcGradient)" stroke-width="15" stroke-linecap="round"/>
          ${g.ticks}${g.labels}

          ${Number.isFinite(actual) ? `<circle cx="${g.currentMarker.x}" cy="${g.currentMarker.y}" r="7" fill="#e4fbff" stroke="#13dcff" stroke-width="3"/>` : ""}
          ${Number.isFinite(target) ? `<g clip-path="url(#pointerClip)"><line data-slider-pointer x1="${g.pointerStart.x}" y1="${g.pointerStart.y}" x2="${g.pointerEnd.x}" y2="${g.pointerEnd.y}" stroke="#ff7a10" stroke-width="29" stroke-linecap="round" opacity=".55" filter="url(#orangeGlow)"/><line data-slider-pointer x1="${g.pointerStart.x}" y1="${g.pointerStart.y}" x2="${g.pointerEnd.x}" y2="${g.pointerEnd.y}" stroke="url(#pointerGradient)" stroke-width="17" stroke-linecap="round"/></g>` : ""}

          <path data-slider d="${g.arc}" fill="none" stroke="transparent" stroke-width="88" stroke-linecap="round" style="pointer-events:stroke;touch-action:none;cursor:pointer"/>

          <circle cx="${g.cx}" cy="${g.cy}" r="171" fill="#07141d" stroke="#758b98" stroke-opacity=".55" stroke-width="3"/>
          <circle cx="${g.cx}" cy="${g.cy}" r="159" fill="none" stroke="#182e3b" stroke-width="8"/>

          <g transform="translate(628 190)" fill="${heaterOn?"#ff9d2a":"#46545c"}" ${heaterOn?'filter="url(#heatGlow)"':""}>
            <path d="M28 0 C44 17 48 29 40 42 C59 31 60 22 57 10 C83 36 78 64 57 76 C32 88 7 73 10 48 C13 31 23 21 28 0Z"/>
            <path fill="${heaterOn?"#ffdb74":"#7b858c"}" d="M40 32 C46 46 31 52 35 62 C38 67 46 67 50 60 C55 77 26 82 22 62 C19 49 29 39 40 32Z"/>
          </g>
          ${this._config.flame_switch_entity&&mode!=="AUS"?'<rect class="hit" data-action="flame" x="598" y="185" width="120" height="90"/>':""}
          <text x="655" y="275" fill="#e2f0f7" font-family="Arial" font-size="23" font-weight="600" text-anchor="middle">${safeStatus}</text>
          <text x="655" y="320" fill="#e7f3f9" font-family="Arial" font-size="27" font-weight="500" text-anchor="middle">${this._t("target")}</text>
          <text data-slider-value x="655" y="398" fill="#ffb13b" font-family="Arial" font-size="88" font-weight="700" text-anchor="middle">${this._fmtTemp(target)}</text>
          <text x="764" y="362" fill="#ffc25a" font-family="Arial" font-size="35" font-weight="600">°C</text>

          <circle cx="568" cy="490" r="57" fill="#071722" stroke="#23d8ff" stroke-width="2"/>
          <text x="568" y="510" fill="#f3fbff" font-family="Arial" font-size="66" font-weight="500" text-anchor="middle">−</text>
          <circle class="hit" data-action="minus" cx="568" cy="490" r="57"/>

          <circle cx="750" cy="490" r="57" fill="#17100a" stroke="#ff8b32" stroke-width="2"/>
          <text x="750" y="512" fill="#ffffff" font-family="Arial" font-size="68" font-weight="500" text-anchor="middle">+</text>
          <circle class="hit" data-action="plus" cx="750" cy="490" r="57"/>
          </g>
        </svg>
      </div>`;

    this._bindSlider();
    const scheduleAction = this.shadowRoot.querySelector('[data-action="schedule"]'); if (scheduleAction) scheduleAction.addEventListener("keydown", ev => {
      if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); this._openSchedule(); }
    });
    this.shadowRoot.querySelectorAll("[data-action]").forEach(el => {
      el.addEventListener("click", async ev => {
        const action = ev.currentTarget.dataset.action;
        if (action === "mode") await this._setMode(ev.currentTarget.dataset.mode);
        if (action === "flame") await this._toggleFlame();
        if (action === "minus") await this._changeTarget(-this._step());
        if (action === "plus") await this._changeTarget(this._step());
        if (action === "schedule") this._openSchedule();
      });
    });
  }
}

JarvisClimateCardLegacy._days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
JarvisClimateCardLegacy._locks = new Map();

const FrankysClimateEditorEnglish = {
  "Heizflamme: Heizaktor (optional)": "Heating flame: actuator (optional)",
  "Nur Oberfläche: Heizungsregelung erfolgt über Home Assistant.": "UI only: Home Assistant handles heating control.",
  "AUS-Aktion (optional)": "OFF action (optional)",
  "AUTO-Aktion (optional)": "AUTO action (optional)",
  "MANUELL-Aktion (optional)": "MANUAL action (optional)",
  "Skript-ID oder gültiges Aktions-JSON eingeben.": "Enter a script ID or valid action JSON.",
  "Optional je Taste: script.beispiel oder JSON mit action/service, data und target. Leer = bisheriges Verhalten. Beispiele im README.": "Optional per button: script.example or JSON with action/service, data and target. Empty = existing behavior. See README for examples.",
  "Anzeigename": "Display name",
  "z. B. Schlafzimmer": "e.g. Bedroom",
  "Sprache / Language": "Language",
  "Deutsch": "German",
  "English": "English",
  "Profil": "Profile",
  "Climate / Wärmepumpe": "Climate / Heat pump",
  "Thermostat / Heizung": "Thermostat / Heating",
  "Erweitert (Helper / Scripts)": "Advanced (helpers / scripts)",
  "Climate-Entität für Ist / Soll": "Climate entity for current / target",
  "Climate-Entität für Steuerung": "Climate entity for control",
  "Manuell-Helper (optional)": "Manual helper (optional)",
  "Für Geräte mit eigener Climate-Regelung. Bestehende Energie- oder PV-Automationen bleiben unverändert.": "For devices with their own climate control. Existing energy and solar automations remain unchanged.",
  "Thermostat-Climate (Pflicht)": "Thermostat climate entity (required)",
  "Heizgerät / Switch (optional für MANUELL)": "Heating device / switch (optional for MANUAL)",
  "Heizstatus / Binärsensor (optional, nur Anzeige)": "Heating activity / binary sensor (optional, display only)",
  "Climate auswählen und Karte speichern. Über das Uhrsymbol Zeiten und Temperaturen festlegen; der Heizplan wird automatisch angelegt. Der optionale Switch dient der manuellen Bedienung.": "Select a climate entity and save the card. Use the clock icon to set times and temperatures; the heating schedule is created automatically. The optional switch provides manual control.",
  "Climate-Entität (optional)": "Climate entity (optional)",
  "Climate-Steuerentität (optional)": "Climate control entity (optional)",
  "Temperatursensor (optional)": "Temperature sensor (optional)",
  "Sollwert-Helper (optional)": "Target temperature helper (optional)",
  "Modus-Helper (optional)": "Mode helper (optional)",
  "Heizgerät / Switch (optional)": "Heating device / switch (optional)",
  "AUS-Script (optional)": "OFF script (optional)",
  "MANUELL-Script (optional)": "MANUAL script (optional)",
  "AUTO-Heizplan (optional)": "AUTO heating schedule (optional)",
  "Optional: separate Helper, Schalter und Skripte für individuelle Heizungssteuerungen.": "Optional separate helpers, switches, and scripts for custom heating systems.",
  "Min. Temperatur (leer = Gerät)": "Minimum temperature (blank = device)",
  "Max. Temperatur (leer = Gerät)": "Maximum temperature (blank = device)",
  "Schrittweite (leer = Gerät)": "Temperature step (blank = device)",
  "AUTO-Betriebsmodus": "AUTO operating mode",
  "heat – feste Solltemperatur (Standard)": "heat – fixed target temperature (default)",
  "auto – Automatikprogramm des Geräts (z. B. Homematic)": "auto – device's own automatic program (e.g. Homematic)",
  "nicht unterstützt": "not supported",
  "Wird bei AUTO an das Thermostat gesendet. Angeboten werden nur Modi, die das Gerät meldet.": "Sent to the thermostat when AUTO is selected. Only modes reported by the device are offered."
};

class JarvisClimateCardLegacyEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._rendered = false;
  }

  _lang() {
    let lang = String((this._config && this._config.language) || "auto").toLowerCase();
    if (lang === "auto") lang = String((this._hass && this._hass.locale && this._hass.locale.language) || (this._hass && this._hass.language) || "en").toLowerCase();
    return lang.split("-")[0].split("_")[0] === "de" ? "de" : "en";
  }
  _t(label) { return this._lang() === "de" ? label : (FrankysClimateEditorEnglish[label] || label); }

  set hass(hass) {
    const previous = this._hass;
    this._hass = hass;
    if (!hass) return;
    // Avoid expensive entity-picker updates on every sensor state change.
    // Pickers only need refreshing when the HA entity registry/configuration
    // or locale actually changes, not for each new hass.states object.
    if (!this._rendered) {
      if (this._config) this._render();
      return;
    }
    const localeChanged = !!previous && this._config &&
      !["de", "en"].includes(this._config.language) &&
      ((previous.locale && previous.locale.language) || previous.language || "") !==
      ((hass.locale && hass.locale.language) || hass.language || "");
    if (localeChanged) { this._render(); return; }
    if (previous &&
        previous.entities === hass.entities &&
        previous.config === hass.config &&
        previous.language === hass.language &&
        ((previous.locale && previous.locale.language) || "") ===
        ((hass.locale && hass.locale.language) || "")) return;
    this.shadowRoot.querySelectorAll("ha-entity-picker")
      .forEach(picker => { if (picker.hass !== hass) picker.hass = hass; });
  }

  setConfig(config) {
    const previousProfile = this._config ? this._config.profile : undefined;
    const previousLanguage = this._config ? this._config.language : undefined;
    this._config = { ...config };

    if (!this._rendered || previousProfile !== this._config.profile || previousLanguage !== this._config.language) {
      this._render();
    }
  }

  _fireChanged(key, value) {
    // Ignore identical picker values to avoid config-changed feedback loops.
    if (!this._config || Object.is(this._config[key], value)) return;
    this._config = { ...this._config, [key]: value };

    this.dispatchEvent(new CustomEvent("config-changed", {
      detail: { config: this._config },
      bubbles: true,
      composed: true
    }));

    if (key === "profile" || key === "language") {
      this._rendered = false;
      this._render();
    } else if (key === "display_entity" || key === "control_entity") {
      this._refreshAutoModeOptions();
    }
  }

  // Offers only heat/auto modes reported by the selected climate entity.
  _autoModeOptions() {
    const id = this._config.control_entity || this._config.display_entity;
    const state = id && this._hass && this._hass.states ? this._hass.states[id] : null;
    const reported = state && state.attributes ? state.attributes.hvac_modes : null;
    const current = this._config.auto_hvac_mode === "auto" ? "auto" : "heat";
    const known = Array.isArray(reported) && reported.length > 0;
    const options = [];
    ["heat", "auto"].forEach(mode => {
      if (!known || reported.indexOf(mode) !== -1) options.push({ value: mode, supported: true });
    });
    if (!options.some(o => o.value === current)) options.push({ value: current, supported: false });
    return { options, current };
  }

  _refreshAutoModeOptions() {
    const select = this.shadowRoot && this.shadowRoot.querySelector("#auto_hvac_mode");
    if (!select) return;
    const info = this._autoModeOptions();
    const labels = {
      heat: this._t("heat – feste Solltemperatur (Standard)"),
      auto: this._t("auto – Automatikprogramm des Geräts (z. B. Homematic)")
    };
    select.innerHTML = "";
    info.options.forEach(o => {
      const opt = document.createElement("option");
      opt.value = o.value;
      opt.textContent = labels[o.value] + (o.supported ? "" : " (" + this._t("nicht unterstützt") + ")");
      select.appendChild(opt);
    });
    select.value = info.current;
  }

  _modeActionField(key, label) {
    const wrap = document.createElement("label");
    wrap.className = "field";
    const title = document.createElement("div");
    title.className = "label";
    title.textContent = this._t(label);
    wrap.appendChild(title);
    const input = document.createElement("textarea");
    input.rows = 2;
    const value = this._config[key];
    input.value = value == null ? "" : typeof value === "string" ? value : JSON.stringify(value);
    input.placeholder = 'script.example';
    input.addEventListener("input", () => input.setCustomValidity(""));
    input.addEventListener("change", () => {
      const text = input.value.trim();
      let action = "";
      try {
        if (text) {
          action = text.startsWith("{") ? JSON.parse(text) : text;
          frankysModeAction(action);
        }
      } catch (_) {
        input.setCustomValidity(this._t("Skript-ID oder gültiges Aktions-JSON eingeben."));
        input.reportValidity();
        return;
      }
      input.setCustomValidity("");
      this._fireChanged(key, action);
    });
    wrap.appendChild(input);
    return wrap;
  }

  _autoModeField() {
    const wrap = document.createElement("label");
    wrap.className = "field";
    const title = document.createElement("div");
    title.className = "label";
    title.textContent = this._t("AUTO-Betriebsmodus");
    wrap.appendChild(title);
    const select = document.createElement("select");
    select.id = "auto_hvac_mode";
    select.addEventListener("change", ev => this._fireChanged("auto_hvac_mode", ev.target.value));
    wrap.appendChild(select);
    const note = document.createElement("div");
    note.className = "hint";
    note.textContent = this._t("Wird bei AUTO an das Thermostat gesendet. Angeboten werden nur Modi, die das Gerät meldet.");
    wrap.appendChild(note);
    // Populate once the element is attached to the shadow DOM.
    Promise.resolve().then(() => this._refreshAutoModeOptions());
    return wrap;
  }

  _picker(label, key, domains = []) {
    const wrap = document.createElement("div");
    wrap.className = "field";

    const title = document.createElement("div");
    title.className = "label";
    title.textContent = label;
    wrap.appendChild(title);

    const picker = document.createElement("ha-entity-picker");
    picker.hass = this._hass;
    picker.value = this._config && this._config[key] ? this._config[key] : "";
    picker.allowCustomEntity = true;
    if (domains.length) picker.includeDomains = domains;

    picker.addEventListener("value-changed", ev => {
      this._fireChanged(key, ev.detail.value || "");
    });

    wrap.appendChild(picker);
    return wrap;
  }

  _nativeInput(label, key, type = "text", options = {}) {
    const wrap = document.createElement("label");
    wrap.className = "field";

    const title = document.createElement("div");
    title.className = "label";
    title.textContent = label;
    wrap.appendChild(title);

    const input = document.createElement("input");
    input.type = type;
    input.value = this._config && this._config[key] !== null && this._config[key] !== undefined ? this._config[key] : "";
    if (options.step) input.step = options.step;
    if (options.placeholder) input.placeholder = options.placeholder;

    input.addEventListener("change", ev => {
      let value = ev.target.value;
      if (type === "number") {
        value = value === "" ? null : Number(value);
      }
      this._fireChanged(key, value);
    });

    wrap.appendChild(input);
    return wrap;
  }

  _render() {
    if (!this.shadowRoot || !this._config) return;

    this.shadowRoot.innerHTML = `
      <style>
        .wrap{
          display:grid;
          gap:16px;
          padding:8px 0;
        }

        .field{
          display:grid;
          gap:7px;
        }

        .label{
          color:var(--primary-text-color);
          font-size:14px;
          font-weight:500;
        }

        select,
        input,
        textarea{
          box-sizing:border-box;
          width:100%;
          min-height:46px;
          padding:10px 12px;
          border-radius:8px;
          border:1px solid var(--divider-color);
          background:var(--card-background-color);
          color:var(--primary-text-color);
          font:inherit;
        }

        select:focus,
        input:focus,
        textarea:focus{
          outline:2px solid var(--primary-color);
          outline-offset:1px;
        }

        #fields{
          display:grid;
          gap:16px;
        }

        .hint{
          padding:10px 12px;
          border-radius:8px;
          background:rgba(3,169,244,.08);
          color:var(--secondary-text-color);
          font-size:12px;
          line-height:1.45;
        }
      </style>

      <div class="wrap">
        <div id="nameField"></div>

        <label class="field">
          <div class="label">${this._t("Sprache / Language")}</div>
          <select id="language">
            <option value="auto">Auto / Home Assistant</option>
            <option value="de">${this._t("Deutsch")}</option>
            <option value="en">${this._t("English")}</option>
          </select>
        </label>

        <div id="fields"></div>

        <div id="numbers"></div>

        <div class="hint" id="hint"></div>
      </div>
    `;

    this.shadowRoot
      .querySelector("#nameField")
      .appendChild(this._nativeInput(this._t("Anzeigename"), "name", "text", {
        placeholder: this._t("z. B. Schlafzimmer")
      }));

    const languageSelect = this.shadowRoot.querySelector("#language");
    languageSelect.value = this._config.language || "auto";
    languageSelect.addEventListener("change", ev => {
      this._fireChanged("language", ev.target.value);
    });

    const fields = this.shadowRoot.querySelector("#fields");
    const add = el => fields.appendChild(el);
    add(this._picker(this._t("Thermostat-Climate (Pflicht)"),"display_entity",["climate"]));
    add(this._picker(this._t("Climate-Steuerentität (optional)"),"control_entity",["climate"]));
    add(this._picker(this._t("Temperatursensor (optional)"),"temperature_entity",["sensor"]));
    add(this._picker(this._t("Sollwert-Helper (optional)"),"target_entity",["number","input_number"]));
    add(this._picker(this._t("Modus-Helper (optional)"),"mode_entity",["select","input_select"]));
    add(this._picker(this._t("Heizstatus / Binärsensor (optional, nur Anzeige)"),"heating_status_entity",["binary_sensor"]));
    add(this._picker(this._t("Heizflamme: Heizaktor (optional)"),"flame_switch_entity",["switch","input_boolean"]));
    add(this._picker(this._t("AUTO-Heizplan (optional)"),"schedule_entity",["schedule"]));
    this.shadowRoot.querySelector("#hint").textContent=this._t("Nur Oberfläche: Heizungsregelung erfolgt über Home Assistant.");
    const actionsHint = document.createElement("div");
    actionsHint.className = "hint";
    actionsHint.textContent = this._t("Optional je Taste: script.beispiel oder JSON mit action/service, data und target. Leer = bisheriges Verhalten. Beispiele im README.");
    add(actionsHint);
    add(this._modeActionField("mode_off_action", "AUS-Aktion (optional)"));
    add(this._modeActionField("mode_auto_action", "AUTO-Aktion (optional)"));
    add(this._modeActionField("mode_manual_action", "MANUELL-Aktion (optional)"));

    const numbers = this.shadowRoot.querySelector("#numbers");
    numbers.style.display = "grid";
    numbers.style.gap = "16px";

    numbers.appendChild(this._nativeInput(
      this._t("Min. Temperatur (leer = Gerät)"),
      "min_temp",
      "number",
      { step: "0.5" }
    ));

    numbers.appendChild(this._nativeInput(
      this._t("Max. Temperatur (leer = Gerät)"),
      "max_temp",
      "number",
      { step: "0.5" }
    ));

    numbers.appendChild(this._nativeInput(
      this._t("Schrittweite (leer = Gerät)"),
      "step",
      "number",
      { step: "0.5" }
    ));

    this._rendered = true;
  }
}

if(!customElements.get("frankys-climate-ui-card"))customElements.define("frankys-climate-ui-card",JarvisClimateCardLegacy);
if(!customElements.get("frankys-climate-ui-card-editor"))customElements.define("frankys-climate-ui-card-editor",JarvisClimateCardLegacyEditor);
window.customCards = window.customCards || [];
if(!window.customCards.some(card=>card.type==="frankys-climate-ui-card"))window.customCards.push({
  type:"frankys-climate-ui-card",name:"Franky's Climate UI",
  description:"JARVIS temperature UI with flame, 24h history, HA native schedule"

});