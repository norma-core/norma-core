#pragma once
#include <pgmspace.h>

// The control page served at "/". Same layout as the design demo, talking JSON over the WebSocket:
// the lamp pushes status (joints, action, led, wifi, the current LED frame) 5 times a second,
// the page sends {"pose":{..}}, {"action":"name"}, {"led":{..}}, {"torque":bool}, {"calib":[names]}.
static const char INDEX_HTML[] PROGMEM = R"HTML(<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>NC Lamp</title>
<style>
:root{--bg:#121417;--panel:#1a1d22;--panel2:#22262d;--fg:#e8e6e0;--muted:#8f949c;--line:#2d323a;--accent:#f2a93b;--ink:#141414;--ok:#52c47a;--warn:#e2b23c;--bad:#e5604f;--track:#2f343c;color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.45 system-ui,sans-serif;padding:12px 16px}
header{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:12px}
h1{margin:0;font-size:20px}
.pill{font-family:monospace;font-size:12px;padding:3px 9px;border-radius:999px;border:1px solid var(--line);color:var(--muted)}
.pill.on{border-color:var(--ok);color:var(--ok)}.pill.bad{border-color:var(--bad);color:var(--bad)}
#net{margin-left:auto;font-family:monospace;font-size:12px;color:var(--muted)}
main{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:12px;min-width:0;display:flex;flex-direction:column;gap:10px}
h2{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:0;font-weight:700}
.modes{display:flex;flex-wrap:wrap;gap:6px}
button{font:inherit;font-weight:600;font-size:13px;padding:6px 11px;border-radius:8px;border:1px solid var(--line);background:var(--panel2);color:var(--fg);cursor:pointer}
button.on{background:var(--accent);color:var(--ink);border-color:var(--accent)}button.danger{border-color:var(--bad);color:var(--bad)}
.row{display:grid;grid-template-columns:86px 1fr 64px;gap:8px;align-items:center}
.row label{font-weight:600}.row .v{font-family:monospace;font-size:12px;text-align:right;color:var(--muted)}
input[type=range]{width:100%;margin:0;accent-color:var(--accent)}
input[type=color]{width:44px;height:30px;border:1px solid var(--line);border-radius:6px;background:var(--panel2);padding:2px}
.strip{display:flex;gap:1px;height:10px;border-radius:4px;overflow:hidden;background:var(--track)}.strip i{flex:1}
.joint{display:grid;grid-template-columns:1fr auto;gap:2px 10px;align-items:baseline}.joint label{font-weight:700}
.joint .val{font-family:monospace;font-size:12px}.joint .val small{color:var(--muted);margin-left:6px}
.joint input{grid-column:1/-1}.joint .lim{grid-column:1/-1;display:flex;justify-content:space-between;font-family:monospace;font-size:11px;color:var(--muted)}
table{width:100%;border-collapse:collapse;font-family:monospace;font-size:12px}
th,td{padding:4px 6px;text-align:right;border-bottom:1px solid var(--line);white-space:nowrap}th{color:var(--muted);font-weight:500}
th:first-child,td:first-child{text-align:left}.tw{overflow-x:auto}
.ok{color:var(--ok)}.warn{color:var(--warn)}.bad{color:var(--bad)}
.note{color:var(--muted);font-size:12px;margin:0}
.confirm{display:flex;gap:6px;align-items:center;flex-wrap:wrap;background:var(--panel2);border-radius:8px;padding:8px}
[hidden]{display:none!important}
textarea{width:100%;min-height:200px;font:13px/1.5 monospace;background:var(--panel2);color:var(--fg);border:1px solid var(--line);border-radius:8px;padding:8px;resize:vertical}
.prog{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.prog label{display:flex;gap:4px;align-items:center;color:var(--muted);font-size:12px}
#line{font-family:monospace;font-size:12px;color:var(--accent)}
</style></head><body>
<header><h1>NC Lamp</h1><span class="pill" id="conn">connecting</span><span class="pill" id="act">idle</span><span id="net"></span></header>
<main>
<section class="card"><h2>Light ring</h2>
<div class="strip" id="strip"></div>
<div class="modes" id="modes"></div>
<div class="row"><label>Colors</label><div style="display:flex;gap:8px"><input type="color" id="col" value="#ffb15c"><input type="color" id="col2" value="#000000"></div><span class="v" id="colv"></span></div>
<div class="row"><label for="bri">Brightness</label><input type="range" id="bri" min="5" max="255" value="150"><span class="v" id="briv">150</span></div>
<div class="row"><label for="ct">White bal.</label><input type="range" id="ct" min="2000" max="10000" step="100" value="6500"><span class="v" id="ctv">6500 K</span></div>
<div class="row"><label for="spd">Speed</label><input type="range" id="spd" min="1" max="100" value="40"><span class="v" id="spdv">40</span></div>
<div class="row"><label for="wid">Width</label><input type="range" id="wid" min="1" max="24" value="6"><span class="v" id="widv">6</span></div>
<div class="row"><label for="aim">Aim</label><input type="range" id="aim" min="0" max="359" value="90"><span class="v" id="aimv">90</span></div>
<p class="note">White balance corrects the strip's white: 6500 K leaves it as it is, lower is warmer; it is kept across reboots. The strip view and Aim use a clock face seen from the front: 0 = top, 90 = right, 180 = bottom. Follow keeps the lit sector still in the room while the head rolls; Reactive lights up with movement.</p>
</section>
<section class="card"><h2>Joints (deg, URDF: shoulder 90 = pointing up)</h2>
<div id="joints"></div>
<div class="row"><label for="speed">Speed</label><input type="range" id="speed" min="100" max="3000" step="50" value="900"><span class="v" id="speedv">900</span></div>
<div class="row"><label for="acc">Accel</label><input type="range" id="acc" min="5" max="200" value="40"><span class="v" id="accv">40</span></div>
<h2>Actions</h2><div class="modes" id="actions"></div>
<div class="modes"><button id="torque">Torque off</button><button id="stop">Stop action</button><button id="calib">Set this pose as init…</button></div>
<div class="confirm" id="calibBox" hidden><span>Writes the servo offsets so this pose reads 2048 on every joint. Torque off, hold the lamp pointing up (arm vertical, head straight), then write.</span><button id="calibYes" class="danger">Write offsets</button><button id="calibNo">Cancel</button></div>
<p class="note">Boot never moves the lamp: the servos are only read and torque stays as found. New lamp or re-seated horn: torque off, pose it pointing up by hand, set this pose as init, torque on. Torque on holds the arm where it is.</p>
<p class="note" id="msg"></p>
</section>
<section class="card"><h2>Status</h2>
<div class="tw"><table><thead><tr><th>joint</th><th>id</th><th>deg</th><th>ticks</th><th>load</th><th>°C</th><th>V</th><th>mA</th></tr></thead><tbody id="stat"></tbody></table></div>
<p class="note" id="sys"></p>
</section>
<section class="card"><h2>Program</h2>
<textarea id="prog" spellcheck="false"></textarea>
<div class="prog"><button id="play" class="on">&#9654; Play</button><button id="pstop">Stop</button><label><input type="checkbox" id="loop">loop</label><span id="line"></span></div>
<p class="note">One step per line. <b>action</b> (up, wake, …) waits until it finishes · <b>wait 800</b> ms · <b>led rainbow bri=7</b> or <b>led solid #ff8800 #000000 spd=40 w=6 ct=4000</b> · <b>pose yaw=30 wrist=20 speed=600</b> waits until the joints arrive · <b>#</b> comment.</p>
<p class="note">API: GET /api/status · POST /api/pose /api/action /api/led /api/torque /api/calib · WS /ws</p>
</section>
</main>
<script>
(function(){
const $=s=>document.querySelector(s);let ws,st=null,joints=[],built=false,sending=false,pend={};
const MODES=['off','solid','breathe','rainbow','comet','chase','scanner','sparkle','fire','follow','reactive'];
const ACTIONS=[['up','Point up'],['lookdown','Look down'],['reach','Reach'],['wake','Wake'],['scan','Scan desk'],['spin','Spin'],['bounce','Bounce'],['no','No'],['yes','Yes'],['peek','Peek']];
function send(o){if(ws&&ws.readyState===1)ws.send(JSON.stringify(o));}
function sendPose(){if(sending)return;sending=true;setTimeout(()=>{sending=false;send({pose:pend});pend={};},60);}
const hex=h=>[parseInt(h.slice(1,3),16),parseInt(h.slice(3,5),16),parseInt(h.slice(5,7),16)];
const mb=$('#modes');for(const m of MODES){const b=document.createElement('button');b.textContent=m;b.dataset.m=m;b.onclick=()=>send({led:{mode:m}});mb.appendChild(b);}
const ab=$('#actions');for(const[n,l]of ACTIONS){const b=document.createElement('button');b.textContent=l;b.onclick=()=>send({action:n});ab.appendChild(b);}
$('#col').oninput=e=>{send({led:{color:e.target.value}});$('#colv').textContent=e.target.value;};
$('#col2').oninput=e=>send({led:{color2:e.target.value}});
for(const[id,k]of[['bri','bri'],['spd','spd'],['wid','w'],['aim','aim']])$('#'+id).oninput=e=>{$('#'+id+'v').textContent=e.target.value;const o={};o[k]=+e.target.value;send({led:o});};
$('#ct').oninput=e=>{$('#ctv').textContent=e.target.value+' K';send({led:{ct:+e.target.value}});};
$('#speed').oninput=e=>{$('#speedv').textContent=e.target.value;pend.speed=+e.target.value;sendPose();};
$('#acc').oninput=e=>{$('#accv').textContent=e.target.value;pend.acc=+e.target.value;sendPose();};
$('#torque').onclick=()=>send({torque:!(st&&st.torque)});
$('#stop').onclick=()=>send({action:''});
$('#calib').onclick=()=>{$('#calibBox').hidden=false;};
$('#calibNo').onclick=()=>{$('#calibBox').hidden=true;};
$('#calibYes').onclick=()=>{$('#calibBox').hidden=true;send({calib:[]});};
// ---- program: runs in the browser, one line at a time, driven by the status pushes
const prog=$('#prog');prog.value=['# one step per line, play runs them in order','led reactive','wait 1000','up','lookdown','reach','wake','scan','spin','led rainbow bri=7','bounce','no','yes','peek','wait 1500','pose yaw=30 wrist=20 speed=600','wait 500','up','led sparkle bri=100',''].join('\n');
let running=false,run=0;const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function waitFor(pred,ms){const t0=Date.now();while(Date.now()-t0<ms){if(!running)return false;if(pred())return true;await sleep(60);}return false;}
function mark(i,txt){$('#line').textContent=txt;const lines=prog.value.split('\n');let p=0;for(let k=0;k<i;k++)p+=lines[k].length+1;if(i>=0&&document.activeElement!==prog)prog.setSelectionRange(p,p+lines[i].length);}
async function step(l){const w=l.trim().split(/\s+/);const c=w[0].toLowerCase();
 if(c==='wait'){await sleep(+w[1]||500);return;}
 if(c==='led'){const o={mode:w[1]||'off'};let nc=0;for(const t of w.slice(2)){const m=t.match(/^(\w+)=(.+)$/);if(m)o[m[1]]=isNaN(+m[2])?m[2]:+m[2];else o[nc++?'color2':'color']=t;}send({led:o});return;}
 if(c==='pose'){const o={};for(const t of w.slice(1)){const m=t.match(/^(\w+)=(-?[\d.]+)$/);if(m)o[m[1]]=+m[2];}send({pose:o});await sleep(150);
  await waitFor(()=>st&&st.joints.every(j=>!j.ok||!(j.name in o)||Math.abs(j.deg-j.target)<2.5),6000);return;}
 if(!ACTIONS.some(a=>a[0]===c)){$('#line').textContent='unknown step: '+l;await sleep(800);return;}
 send({action:c});await waitFor(()=>st&&st.action===c,600);await waitFor(()=>st&&st.action!==c,20000);}
async function play(){if(running)return;running=true;const my=++run;$('#play').textContent='Playing\u2026';
 do{const lines=prog.value.split('\n');for(let i=0;i<lines.length&&running&&my===run;i++){const l=lines[i].trim();if(!l||l[0]==='#')continue;mark(i,'line '+(i+1)+': '+l);await step(l);}}while(running&&my===run&&$('#loop').checked);
 if(my===run){running=false;$('#play').textContent='\u25B6 Play';$('#line').textContent='done';}}
$('#play').onclick=play;$('#pstop').onclick=()=>{running=false;run++;send({action:''});$('#play').textContent='\u25B6 Play';$('#line').textContent='stopped';};
const strip=$('#strip');
function build(s){joints=s.joints;const jb=$('#joints');jb.innerHTML='';
for(const j of joints){const d=document.createElement('div');d.className='joint';
d.innerHTML='<label>'+j.name+'</label><span class="val"><span id="t_'+j.name+'"></span><small>target</small><span id="p_'+j.name+'" style="margin-left:10px"></span><small>now</small></span><input type="range" id="j_'+j.name+'" min="'+j.min+'" max="'+j.max+'" step="0.5" value="'+j.target+'"><div class="lim"><span>'+j.min+'</span><span>id '+j.id+'</span><span>'+j.max+'</span></div>';
jb.appendChild(d);d.querySelector('input').oninput=e=>{pend[j.name]=+e.target.value;sendPose();};}
strip.innerHTML='';for(let i=0;i<s.led.n;i++)strip.appendChild(document.createElement('i'));built=true;}
function show(s){st=s;if(!built)build(s);
$('#act').textContent=s.action?'action: '+s.action:'idle';$('#torque').textContent=s.torque?'Torque on':'Torque off';$('#torque').classList.toggle('on',s.torque);
$('#net').textContent=(s.wifi.ap?'AP ':'')+s.wifi.ssid+' · '+s.wifi.ip+' · '+s.led.n+' LEDs';
mb.querySelectorAll('button').forEach(b=>b.classList.toggle('on',b.dataset.m===s.led.mode));
if(document.activeElement.tagName!=='INPUT'){for(const j of s.joints)$('#j_'+j.name).value=j.target;$('#speed').value=s.speed;$('#speedv').textContent=s.speed;$('#acc').value=s.acc;$('#accv').textContent=s.acc;$('#bri').value=s.led.bri;$('#briv').textContent=s.led.bri;$('#spd').value=s.led.spd;$('#spdv').textContent=s.led.spd;$('#wid').value=s.led.w;$('#widv').textContent=s.led.w;$('#aim').value=s.led.aim;$('#aimv').textContent=s.led.aim;$('#ct').value=s.led.ct;$('#ctv').textContent=s.led.ct+' K';$('#col').value=s.led.color;$('#col2').value=s.led.color2;}
let rows='';for(const j of s.joints){$('#t_'+j.name).textContent=j.target.toFixed(1);$('#p_'+j.name).textContent=j.ok?j.deg.toFixed(1):'--';
const tc=j.temp>55?'bad':j.temp>45?'warn':'ok';rows+='<tr><td>'+j.name+'</td><td class="'+(j.ok?'ok':'bad')+'">'+j.id+(j.ok?'':' !')+'</td><td>'+(j.ok?j.deg.toFixed(1):'--')+'</td><td>'+j.ticks+'</td><td>'+j.load+'</td><td class="'+tc+'">'+j.temp+'</td><td>'+j.v.toFixed(1)+'</td><td>'+j.mA+'</td></tr>';}
$('#stat').innerHTML=rows;$('#sys').textContent='up '+s.up+' s · heap '+Math.round(s.heap/1024)+' kB · rssi '+s.wifi.rssi+' dBm'+(s.floorBlocked?' · pose refused: shade too low':'');
if(s.msg)$('#msg').textContent=s.msg;
if(s.leds){const c=strip.children;for(let i=0;i<c.length;i++){const r=parseInt(s.leds.substr(i*6,2),16),g=parseInt(s.leds.substr(i*6+2,2),16),b=parseInt(s.leds.substr(i*6+4,2),16);c[i].style.background='rgb('+Math.max(28,r)+','+Math.max(28,g)+','+Math.max(28,b)+')';}}}
function connect(){ws=new WebSocket('ws://'+location.host+'/ws');
ws.onopen=()=>{$('#conn').textContent='connected';$('#conn').className='pill on';};
ws.onclose=()=>{$('#conn').textContent='reconnecting';$('#conn').className='pill bad';setTimeout(connect,1500);};
ws.onmessage=e=>{try{show(JSON.parse(e.data));}catch(err){}};}
connect();
})();
</script></body></html>)HTML";
