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
 assert(source.includes('history/history_during_period'),'24-hour Recorder query retained');
 const render=make({heating_status_entity:'binary_sensor.heating'});
 render.c.shadowRoot={innerHTML:'',querySelector:()=>null,querySelectorAll:()=>[]};
 render.c._temperatureHistory=[];
 render.c._bindSlider=()=>{};
 render.c._render=Card.prototype._render;
 render.c._render();
 assert(render.c.shadowRoot.innerHTML.includes('data-slider'));
 assert(render.c.shadowRoot.innerHTML.includes('M28 0 C44 17'),'Flame artwork present');
 assert(!render.c.shadowRoot.innerHTML.includes('data-action="manual"'));
 console.log('PASS: Climate UI core functionality and HUD render');
})().catch(error=>{console.error(error);process.exitCode=1});
