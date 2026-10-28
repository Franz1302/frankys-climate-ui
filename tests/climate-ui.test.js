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
 const basic=make();assert.equal(basic.c._mode(),'AUTO','native heat is thermostat regulation');
 assert.equal(basic.c._canMode('MANUELL'),false,'heat alone must never enable manual override');
 await basic.c._setMode('AUTO');
 assert.equal(basic.calls[0][2].hvac_mode,'heat','legacy thermostat AUTO prefers heat');
 await basic.c._setTarget(23);
 assert.equal(basic.calls[1][0],'climate');
 assert.equal(basic.calls[1][1],'set_temperature');
 const noAuto=make();noAuto.states['climate.one'].attributes.hvac_modes=['off','heat'];
 assert.equal(noAuto.c._mode(),'AUTO');
 assert.equal(noAuto.c._canMode('AUTO'),true);
 assert.equal(noAuto.c._canMode('MANUELL'),false);
 await noAuto.c._setMode('AUTO');assert.equal(noAuto.calls.length,1,'heat/off thermometers can use AUTO');
 assert.equal(noAuto.calls[0][2].hvac_mode,'heat');
 const noHeat=make();noHeat.states['climate.one'].attributes.hvac_modes=['off','cool'];
 assert.equal(noHeat.c._canMode('AUTO'),false);
 await noHeat.c._setMode('AUTO');assert.equal(noHeat.calls.length,0);
 assert.equal(noHeat.c._error,'MODE NOT SUPPORTED');
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
 // Regression coverage for published v0.2.4: design migration must preserve old controls.
 const explicitAuto=make({auto_hvac_mode:'auto'});
 await explicitAuto.c._setMode('AUTO');
 assert.equal(explicitAuto.calls[0][2].hvac_mode,'auto','explicit auto override wins');
 const manual=make({profile:'thermostat',heater_entity:'switch.actor'});
 assert.equal(manual.c._canMode('MANUELL'),true);
 await manual.c._setMode('MANUELL');
 assert.equal(manual.calls[0][1],'turn_off','manual override stops thermostat');
 assert.equal(manual.c._mode(),'MANUELL');
 assert.equal(manual.c._canToggleFlame(),true);
 manual.states['climate.one'].state='off'; // HA state after the preceding turn_off.
 await manual.c._toggleFlame();
 assert.deepEqual(JSON.parse(JSON.stringify(manual.calls[1])),['switch','turn_on',{entity_id:'switch.actor'}]);
 manual.states['climate.one'].state='off';manual.states['switch.actor'].state='on';
 manual.c._manualArmed=false;
 assert.equal(manual.c._mode(),'MANUELL','override survives state refresh while heater is on');
 await manual.c._setMode('AUS');
 assert.equal(manual.calls[2][1],'turn_off');
 assert.deepEqual(JSON.parse(JSON.stringify(manual.calls[3])),['switch','turn_off',{entity_id:'switch.actor'}]);
 const plain=make({profile:'thermostat'});
 await plain.c._setMode('MANUELL');
 assert.equal(plain.calls.length,0,'never fabricate manual control without an actor');
 assert.equal(plain.c._canToggleFlame(),false);
 const adv=make({profile:'advanced',off_script:'script.off'});
 assert.equal(adv.c._profile(),'advanced');
 await adv.c._setMode('AUS');
 assert.deepEqual(JSON.parse(JSON.stringify(adv.calls[0])),['script','turn_on',{entity_id:'script.off'}]);
 const pool=make({profile:'pool_heatpump',manual_entity:'input_boolean.manual'});
 assert.equal(pool.c._profile(),'pool_heatpump');
 await pool.c._setMode('AUTO');
 assert.deepEqual(JSON.parse(JSON.stringify(pool.calls[0])),['input_boolean','turn_on',{entity_id:'input_boolean.manual'}]);
 assert.equal(pool.calls[1][2].hvac_mode,'heat');
 const autoAction=make({mode_auto_action:'script.custom_auto'});
 await autoAction.c._setMode('AUTO');
 assert.deepEqual(JSON.parse(JSON.stringify(autoAction.calls[0])),['script','turn_on',{entity_id:'script.custom_auto'}]);
 const unconfigured=make({mode_entity:'input_select.mode'});
 unconfigured.states['input_select.mode'].attributes.options=['AUS','MANUELL'];
 assert.equal(unconfigured.c._canMode('AUTO'),false,'unavailable helper option must be disabled');

 const schedule=make({schedule_entity:'schedule.plan'});
 assert(schedule.c._scheduleEnabled());
 assert.equal(schedule.c._scheduleState().entity_id,'schedule.plan');
 const noPlan=make();delete noPlan.states['schedule.plan'];assert.equal(noPlan.c._scheduleEnabled(),true);
 assert(source.includes('type:"schedule/list"') && source.includes('type:"schedule/update"'),'Editor uses supported HA schedule WebSocket commands');
 assert(source.includes('type:"schedule/create"'),'Explicit save can create a schedule as in v0.2.8');
 const days=schedule.c._schedDayKeys();
 const plan={id:'schlafzimmer_heizplan',name:'Schlafzimmer Heizplan',icon:'mdi:radiator'};
 const block1={from:'00:00:00',to:'06:00:00',data:{temperature:18,block:'NACHT',climate_entity:'climate.one',target_entity:'input_number.temp',mode_entity:'input_select.mode',custom:'keep'}};
 const block2={from:'06:00:00',to:'24:00:00',data:{temperature:21.5,block:'TAG',custom:'keep2'}};
 const draft={};
 for(const d of days)draft[d]=[JSON.parse(JSON.stringify(block1)),JSON.parse(JSON.stringify(block2))];
 assert.equal(schedule.c._schedMinutes('24:00:00'),1440);
 assert(Number.isNaN(schedule.c._schedMinutes('24:05')),'Only exactly 24:00 can end a day');
 assert.equal(schedule.c._schedValidate(draft),'','Valid schedule with midnight bound');
 const payload=schedule.c._schedPayload(draft,plan);
 assert.equal(payload.name,plan.name);assert.equal(payload.icon,plan.icon);
 assert.deepEqual(JSON.parse(JSON.stringify(payload.monday[0].data)),block1.data,'Preserve schedule metadata including helper associations');
 assert.equal(payload.monday[1].to,'24:00:00','End-of-day boundary is not truncated');
 const overlapping=JSON.parse(JSON.stringify(draft));overlapping.monday[1].from='05:50';
 assert.equal(schedule.c._schedValidate(overlapping),schedule.c._schedLabels().overlap);
 const badTemp=JSON.parse(JSON.stringify(draft));badTemp.monday[0].data.temperature=999;
 assert.equal(schedule.c._schedValidate(badTemp),schedule.c._schedLabels().invalidTemp);
 const empty=JSON.parse(JSON.stringify(draft));empty.tuesday=[];
 assert.equal(schedule.c._schedValidate(empty),'','Empty days remain valid');
 schedule.c._config.temperature_unit='fahrenheit';
 assert.equal(schedule.c._schedDisplay(20),'68');
 assert.equal(schedule.c._schedNative('68'),20,'°F edit converts back to source units');
 schedule.c._config.temperature_unit='auto';
 schedule.c._schedDraft={monday:JSON.parse(JSON.stringify(draft.monday))};
 schedule.c._schedDay='monday';schedule.c._schedRender=()=>{};
 schedule.c._schedAdd();
 assert.equal(schedule.c._schedDraft.monday.length,3,'Adding to an already full day splits a block');
 assert.equal(schedule.c._schedValidate({monday:schedule.c._schedDraft.monday}),'','Split must not overlap');
 assert(schedule.c._schedDraft.monday.every(r=>r.data.temperature!==undefined),'New block has its own temperature');
 const live=make();
 const originalPlan=Object.assign({id:plan.id,name:plan.name,icon:plan.icon},JSON.parse(JSON.stringify(draft)));
 live.c._schedOriginal=JSON.parse(JSON.stringify(originalPlan));
 live.c._schedDraft=JSON.parse(JSON.stringify(draft));
 live.c._schedPortal={};live.c._schedRender=()=>{};live.c._hass.user={is_admin:true};
 const wsCalls=[];
 live.c._hass.callWS=async msg=>{
   wsCalls.push(JSON.parse(JSON.stringify(msg)));
   if(msg.type==='schedule/list')return [JSON.parse(JSON.stringify(originalPlan))];
   if(msg.type==='schedule/update')return Object.assign({id:msg.schedule_id},msg);
   throw Error('Unexpected WebSocket message');
 };
 await live.c._schedSave();
 assert.equal(wsCalls.length,2,'Save first rereads live schedule to avoid stale overwrites');
 assert.equal(wsCalls[1].type,'schedule/update');
 assert.equal(wsCalls[1].schedule_id,originalPlan.id);
 assert.equal(wsCalls[1].monday[0].data.custom,'keep');
 assert.equal(live.c._schedSaved,true,'Success should be visible in the editor');
 const conflict=make();
 conflict.c._schedOriginal=originalPlan;
 conflict.c._schedDraft=JSON.parse(JSON.stringify(draft));
 conflict.c._schedPortal={};conflict.c._schedRender=()=>{};
 const writes=[];
 conflict.c._hass.callWS=async msg=>{
   writes.push(msg.type);
   if(msg.type==='schedule/list')return [Object.assign({},originalPlan,{name:'Changed externally'})];
   throw Error('Unexpected write');
 };
 await conflict.c._schedSave();
 assert.deepEqual(writes,['schedule/list'],'Conflicting changes must never be overwritten');
 assert(conflict.c._schedError.includes('changed')||conflict.c._schedError.includes('geändert'));
 const readOnly=make();
 readOnly.c._schedOriginal=originalPlan;
 readOnly.c._schedDraft=JSON.parse(JSON.stringify(draft));
 readOnly.c._schedPortal={};readOnly.c._schedRender=()=>{};
 readOnly.c._hass.user={is_admin:false};
 let callCount=0;readOnly.c._hass.callWS=async()=>{callCount++;};
 await readOnly.c._schedSave();assert.equal(callCount,0,'Read-only users cannot send update');

 // Exercise the changed schedule load/create paths inside the existing test harness.
 const oldDocument={...ctx.document};
 Object.assign(ctx.document,{
   createElement:()=>({attachShadow(){this.shadowRoot={addEventListener(){}};}}),
   body:{appendChild(){}},addEventListener(){}
 });
 const renamed=make({schedule_entity:'schedule.plan'});
 renamed.c._schedRender=()=>{};
 const loadCalls=[];
 renamed.c._hass.callWS=async msg=>{
   loadCalls.push(msg.type);
   if(msg.type==='schedule/list')return [originalPlan];
   if(msg.type==='config/entity_registry/list')return [{entity_id:'schedule.plan',platform:'schedule',unique_id:originalPlan.id}];
   throw Error('Loading must never write');
 };
 await renamed.c._openSchedule();
 assert.equal(renamed.c._schedOriginal.id,originalPlan.id,'Renamed schedule resolves through registry unique_id');
 assert.deepEqual(loadCalls,['schedule/list','config/entity_registry/list']);
 const fresh=make();delete fresh.states['schedule.plan'];
 fresh.c._schedRender=()=>{};
 const createCalls=[];
 fresh.c._hass.callWS=async msg=>{
   createCalls.push(JSON.parse(JSON.stringify(msg)));
   if(msg.type==='schedule/list'||msg.type==='config/entity_registry/list')return [];
   if(msg.type==='schedule/create')return Object.assign({id:'created_plan'},msg);
   throw Error('Unexpected schedule operation');
 };
 await fresh.c._openSchedule();
 assert.equal(createCalls.length,2,'Opening an empty editor performs reads only');
 fresh.c._schedAdd();
 await fresh.c._schedSave();
 assert.deepEqual(createCalls.map(x=>x.type),['schedule/list','config/entity_registry/list','schedule/list','schedule/create']);
 assert.equal(createCalls[3].monday[0].data.climate_entity,'climate.one');
 assert.equal(fresh.c._schedOriginal.id,'created_plan');
 assert.equal(fresh.c._schedSaved,true);
 const duplicate=make();delete duplicate.states['schedule.plan'];
 duplicate.c._schedRender=()=>{};
 duplicate.c._hass.callWS=async msg=>msg.type==='schedule/list'?[originalPlan,{...originalPlan,id:'other_plan'}]:[];
 await duplicate.c._openSchedule();
 assert.equal(duplicate.c._schedDraft,null,'Ambiguous linked schedules must never be edited');
 assert(duplicate.c._schedError.includes('Multiple schedules'));
 Object.assign(ctx.document,oldDocument);

 assert(source.includes('history/history_during_period'),'Recorder query retained; graph displays 12h');
 // Both the default card and 3D HUD respect the same mode capability checks.
 noAuto.c._temperatureHistory=[];
 noAuto.c._curveMarkup=()=>'';
 const simpleHud=noAuto.c._leftMarkup();
 assert(simpleHud.includes('data-action="mode" data-mode="AUTO"'),'AUTO is clickable in the 3D HUD');
 assert(!simpleHud.includes('data-action="mode" data-mode="MANUELL"'),'MANUELL is disabled in the 3D HUD');
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
