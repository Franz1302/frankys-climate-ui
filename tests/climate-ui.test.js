// Run with: node tests/climate-ui.test.js (from the standalone repository root)
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('frankys-climate-ui-card.js','utf8'),registry={};
const ctx={HTMLElement:class {},customElements:{get:k=>registry[k],define:(k,v)=>registry[k]=v},window:{},document:{createElement:()=>({})},console,setInterval,clearInterval,setTimeout,clearTimeout,CustomEvent:class{constructor(name,options){this.type=name;this.detail=options.detail;}}};
vm.runInNewContext(source,ctx);
const Card=registry['frankys-climate-ui-card'];assert(Card);assert(registry['frankys-climate-ui-card-editor']);
function make(extra={}){
 const calls=[],states={
  'climate.one':{entity_id:'climate.one',state:'heat',attributes:{current_temperature:20,temperature:21,hvac_modes:['off','heat','auto'],hvac_action:'idle',min_temp:5,max_temp:30,target_temp_step:0.5}},
  'input_select.mode':{entity_id:'input_select.mode',state:'MANUELL',attributes:{options:['AUS','AUTO','MANUELL']}},
  'input_number.temp':{entity_id:'input_number.temp',state:'21',attributes:{min:5,max:30}},
  'binary_sensor.heating':{entity_id:'binary_sensor.heating',state:'off'},
  'switch.actor':{entity_id:'switch.actor',state:'off'},
  'schedule.plan':{entity_id:'schedule.plan',state:'on',attributes:{climate_entity:'climate.one',temperature:21,block:'Day'}}
 };
 const c=Object.create(Card.prototype);
 c._config={display_entity:'climate.one',language:'en',...extra};
 c._hass={language:'en',states,config:{time_zone:'Europe/Vienna'},callService:async(d,n,data)=>calls.push([d,n,data])};
 c._pending=false;c._error='';c._render=()=>{};
 return {c,calls,states};
}
(async()=>{
 const basic=make();assert.equal(basic.c._mode(),'MANUELL');
 await basic.c._setMode('AUTO');
 assert.equal(basic.calls[0][2].hvac_mode,'auto');
 await basic.c._setTarget(23);
 assert.equal(basic.calls[1][0],'climate');
 assert.equal(basic.calls[1][1],'set_temperature');
 const noAuto=make();noAuto.states['climate.one'].attributes.hvac_modes=['off','heat'];
 await noAuto.c._setMode('AUTO');assert.equal(noAuto.calls.length,0);
 assert.equal(noAuto.c._error,'MODE NOT SUPPORTED');
 const custom=make({mode_entity:'input_select.mode',target_entity:'input_number.temp',heating_status_entity:'binary_sensor.heating',flame_switch_entity:'switch.actor',schedule_entity:'schedule.plan'});
 assert.equal(custom.c._mode(),'MANUELL');
 assert.equal(custom.c._targetTemp(),21);
 assert.equal(custom.c._heaterOn(),false);
 custom.states['binary_sensor.heating'].state='on';assert.equal(custom.c._heaterOn(),true);
 await custom.c._setMode('AUTO');assert.equal(custom.calls[0][0],'input_select');
 assert.equal(custom.calls[0][2].option,'AUTO');
 await custom.c._setTarget(25);assert.equal(custom.calls[1][0],'input_number');
 assert.equal(custom.calls[1][2].value,25);
 await custom.c._toggleFlame();assert.equal(custom.calls[2][0],'switch');
 assert.equal(custom.calls[2][1],'turn_on');
 custom.states['input_select.mode'].state='AUS';
 await custom.c._toggleFlame();assert.equal(custom.calls.length,3,'AUS must block flame control');
 const schedule=make({schedule_entity:'schedule.plan'});
 const events=[];schedule.c.dispatchEvent=e=>events.push(e);
 assert(schedule.c._scheduleEnabled());
 schedule.c._openSchedule();assert.equal(events[0].detail.entityId,'schedule.plan');
 const noPlan=make();delete noPlan.states['schedule.plan'];assert.equal(noPlan.c._scheduleEnabled(),false);
 assert(!source.includes('schedule/create')&&!source.includes('schedule/update'),'No schedule writes');
 assert(source.includes('history/history_during_period'),'Recorder query retained; graph displays 12h');
 const render=make({heating_status_entity:'binary_sensor.heating'});
 render.c.shadowRoot={innerHTML:'',querySelector:()=>null,querySelectorAll:()=>[]};
 render.c._temperatureHistory=[];
 render.c._bindSlider=()=>{};
 render.c._render=Card.prototype._render;
 render.c.clientWidth=1300;
 render.c._render();
 // All components must stay in ONE proportional SVG, including on small mobile views.
 for (const width of [320, 390, 540, 600, 740, 1300]) {
   render.c.clientWidth=width;
   render.c._render();
   const html=render.c.shadowRoot.innerHTML;
   assert.equal((html.match(/<svg\b/g)||[]).length,1,`Expected one SVG at ${width}px`);
   assert.equal((html.match(/class="cell"/g)||[]).length,1,`Expected one sizing cell at ${width}px`);
   assert(html.includes('viewBox="40 94 1370 870"'),`Stable uncropped viewbox at ${width}px`);
   assert(html.includes('aspect-ratio:1370/870'),`Intrinsic 1370:870 aspect ratio at ${width}px`);
   assert(html.includes('data-action="plus"') && html.includes('data-action="minus"'),`Dial controls retained at ${width}px`);
   assert(html.includes('data-action="mode"'),`Mode controls retained at ${width}px`);
   assert(html.includes('data-title="actual"') && html.includes('data-title="mode"'),`Temperature/mode panels retained at ${width}px`);
 }
 assert(!source.includes('NARROW_PX') && !source.includes('const body = narrow'),'No breakpoint-based panel stacking');
 assert(render.c.shadowRoot.innerHTML.includes('data-slider'));
 assert(render.c.shadowRoot.innerHTML.includes('data-ring-depth'),'3D ring artwork present');
 assert(render.c.shadowRoot.innerHTML.includes('-12 h'),'12h Recorder time axis present');
 assert(!render.c.shadowRoot.innerHTML.includes('data-action="manual"'));
 // Heating state is deliberately short; no duplicate room name may overlap the flame.
 render.c._config.name='SCHLAFZIMMER';
 render.c._render();
 assert(render.c.shadowRoot.innerHTML.includes('OFF</text>'),'OFF label must remain visible');
 assert.match(render.c.shadowRoot.innerHTML, /<text data-room-name[^>]*>SCHLAFZIMMER<\/text>/,'Room name must be visible, not only an accessible label');
 assert(render.c.shadowRoot.innerHTML.includes('aria-label="SCHLAFZIMMER"'));
 assert(render.c.shadowRoot.innerHTML.includes('data-room-name x="208" y="224"'),'Room name starts in the upper-left temperature panel');
 assert(render.c.shadowRoot.innerHTML.includes('font-size="48" font-weight="700" fill="#e2f7ff"'),'Room name is large and prominent');
 assert(render.c.shadowRoot.innerHTML.includes('data-title="actual" x="208" y="273" font-size="26"'),'Current-temperature caption is below room name');
 render.c._config.name='Bad & <Spa> "OG"';
 render.c._render();
 assert.match(render.c.shadowRoot.innerHTML, /<text data-room-name[^>]*>Bad &amp; &lt;Spa&gt; &quot;OG&quot;<\/text>/);
 render.c._config.name='SCHLAFZIMMER';
 assert(!render.c.shadowRoot.innerHTML.includes('SCHLAFZIMMER ·'),'No duplicate old title');
 // Explicit heating sensor takes precedence over hvac_action in this configuration.
 render.states['binary_sensor.heating'].state='on';
 render.c._render();
 assert(render.c.shadowRoot.innerHTML.includes('data-heating'),'Flame should appear when sensor reports heating');

 // HUD border must not be clipped by a fixed-radius wrapper when the card is narrow.
 assert(source.includes('.cell{position:relative;width:100%;height:100%;aspect-ratio:1370/870;overflow:hidden}'),'Responsive cell fits allocated height with intrinsic aspect ratio fallback');
 const grid=render.c.getGridOptions();
 assert(grid.min_columns < grid.columns,'Sections width must be resizable');
 assert(Number.isFinite(grid.rows) && grid.min_rows < grid.rows,'Sections height must be resizable');
 assert(!source.includes('overflow:hidden;border-radius:22px'));

 // Language and display units change formatting but never change HA's native value.
 const fahrenheit=make({temperature_unit:'fahrenheit'});
 fahrenheit.c._hass.config.unit_system={temperature:'°C'};
 assert.equal(fahrenheit.c._displayTempUnit(),'°F');
 assert.equal(fahrenheit.c._fmtTemp(20),'68.0');
 assert.equal(fahrenheit.c._fmtTemp(21),'69.8');
 assert.equal(fahrenheit.c._targetTemp(),21);
 await fahrenheit.c._setTarget(23);
 assert.equal(fahrenheit.calls[0][2].temperature,23,'display Fahrenheit must not alter native °C service');
 fahrenheit.c._config.language='de';
 assert.equal(fahrenheit.c._fmtTemp(21),'69,8');
 fahrenheit.c._config.temperature_unit='auto';
 assert.equal(fahrenheit.c._fmtTemp(21),'21,0');

 // A Fahrenheit Home Assistant and native Fahrenheit thermostat must not be converted twice.
 const nativeF=make({temperature_unit:'auto'});
 nativeF.c._hass.config.unit_system={temperature:'°F'};
 nativeF.states['climate.one'].attributes.current_temperature=68;
 nativeF.states['climate.one'].attributes.temperature=71.6;
 nativeF.states['climate.one'].attributes.min_temp=41;
 nativeF.states['climate.one'].attributes.max_temp=86;
 assert.equal(nativeF.c._displayTempUnit(),'°F');
 assert.equal(nativeF.c._fmtTemp(nativeF.c._actualTemp()),'68.0');
 assert.equal(nativeF.c._targetTemp(),71.6);
 nativeF.c._config.temperature_unit='celsius';
 assert.equal(nativeF.c._fmtTemp(68),'20.0');
 await nativeF.c._setTarget(75);
 assert.equal(nativeF.calls[0][2].temperature,75,'native °F service should receive °F');

 // Sensors and separate target helpers can report units different from climate.
 const mixed=make({temperature_entity:'sensor.f',target_entity:'input_number.f',temperature_unit:'celsius'});
 mixed.c._hass.config.unit_system={temperature:'°C'};
 mixed.states['sensor.f']={state:'71.6',attributes:{unit_of_measurement:'°F'}};
 mixed.states['input_number.f']={state:'69.8',attributes:{unit_of_measurement:'°F',min:41,max:86,step:0.9}};
 assert(Math.abs(mixed.c._actualTemp()-22)<1e-8);
 assert(Math.abs(mixed.c._targetTemp()-21)<1e-8);
 assert(Math.abs(mixed.c._step()-0.5)<1e-8);
 assert(Math.abs(mixed.c._minTemp()-5)<1e-8);
 assert(Math.abs(mixed.c._maxTemp()-30)<1e-8);
 await mixed.c._setTarget(25);
 assert.equal(mixed.calls[0][0],'input_number');
 assert.equal(mixed.calls[0][2].value,77,'target helper must receive its own °F');

 // Dial and schedule labels use the requested output unit.
 fahrenheit.c._config.temperature_unit='fahrenheit';
 const labels=fahrenheit.c._dialGeometry(21,20).labels;
 assert(labels.includes('41') && labels.includes('86'),'Fahrenheit labels on dial');
 fahrenheit.c._config.schedule_entity='schedule.plan';
 fahrenheit.states['climate.one'].state='auto';
 assert(fahrenheit.c._scheduleInfo().includes('°F'));

 // The visual editor must expose the unit selector in addition to the language selector.
 assert(source.includes('id="temperature_unit"') && source.includes('id="language"'));
 console.log('PASS: Climate UI 3D HUD, controls, 12h chart, DE/EN and °C/°F conversions');
})().catch(error=>{console.error(error);process.exitCode=1});
