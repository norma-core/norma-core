#pragma once
// The control page, served at /. Plain HTML + JS, no libraries: the live MJPEG stream from port 81 with a canvas over
// it where the browser draws the newest boxes from /api/detections; or the analysed frame itself (/analysed.jpg,
// boxes drawn by the lamp) when "Analysed frame" is on. On a lamp without the camera module (/api/status cam.present
// false) the page adds the class "nocam" to the body, which hides the camera card, the detector rows and the search.
// The favicon is an inline SVG (the lit ring on a dark tile), so no /favicon.ico handler is needed.
static const char WEB_PAGE[] = R"HTML(<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>NC lamp</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%2315171a'/%3E%3Ccircle cx='16' cy='16' r='10' fill='none' stroke='%23ffb15c' stroke-width='4'/%3E%3Ccircle cx='16' cy='16' r='3.5' fill='%23ffb15c'/%3E%3C/svg%3E">
<style>
:root{color-scheme:dark}
body{margin:0;background:#15171a;color:#e6e6e6;font:15px/1.4 system-ui,Segoe UI,Roboto,sans-serif}
header{display:flex;flex-wrap:wrap;gap:8px 18px;align-items:baseline;padding:12px 16px;border-bottom:1px solid #2a2d33}
h1{font-size:18px;margin:0;font-weight:600}
#awake{position:absolute;left:0;top:0;width:100%;height:100%;opacity:.02;pointer-events:none;z-index:0}
#cam{z-index:1}#ov{z-index:2}   /* video 0, picture 1, boxes 2, camera-off card 3 */
#camoff{position:absolute;inset:0;z-index:3;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:16px;text-align:center;color:#8a93a6;background:#0b0d12}
#camoff svg{width:64px;height:64px;opacity:.7}#camoff b{color:#c9d1e0;font-weight:600;font-size:16px}#camoff span{max-width:420px;line-height:1.4}
#sys{color:#9aa0a6;font-size:13px}
main{max-width:980px;margin:0 auto;padding:16px;display:grid;gap:16px;grid-template-columns:1fr}
@media(min-width:900px){main{grid-template-columns:2fr 1fr}}
.card{background:#1d2026;border:1px solid #2a2d33;border-radius:10px;padding:14px}
.camwrap{position:relative;width:100%;max-width:640px;margin:0 auto;background:#000;border-radius:8px;overflow:hidden;aspect-ratio:4/3}
.camwrap img,.camwrap canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
.camwrap img{object-fit:fill}
.row{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-top:12px}
button{background:#2b3040;color:#e6e6e6;border:1px solid #3a4052;border-radius:6px;padding:6px 12px;cursor:pointer;font:inherit}
button.on{background:#2f6fed;border-color:#2f6fed}
label{color:#c7cbd1}
input[type=range]{width:160px;vertical-align:middle}
table{border-collapse:collapse;width:100%}
td{padding:4px 6px;border-bottom:1px solid #2a2d33}
td:last-child{text-align:right;color:#c7cbd1;font-variant-numeric:tabular-nums}
#list{margin:0;padding:0;list-style:none}
#list li{display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid #2a2d33}
#list li span:last-child{color:#9aa0a6;font-variant-numeric:tabular-nums}
.note{color:#9aa0a6;font-size:13px;margin-top:10px}
.dot{display:inline-block;width:9px;height:9px;border-radius:50%;background:#555;margin-right:6px;vertical-align:middle}
.dot.ok{background:#3ccf6a}.dot.bad{background:#e5484d}
a{color:#7fb0ff}
.joints{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:6px 18px;margin-top:10px}
.joint label{display:flex;justify-content:space-between;font-size:13px}
.joint label span:last-child{color:#9aa0a6;font-variant-numeric:tabular-nums}
.joint input{width:100%;margin:2px 0 0}
.strip{display:flex;gap:3px;flex-wrap:wrap;margin:6px 0 2px}
.strip i{width:10px;height:10px;border-radius:50%;background:#333;display:block}
.row label{display:inline-flex;align-items:center;gap:6px}
.row label input[type=range]{width:110px}
.nocam .cam,.nocam #camcard{display:none}   /* no camera module: nothing about the camera, the detector or the search */
.nocam .nocamh{display:block!important}
.nocam main{grid-template-columns:1fr}
</style></head><body>
<header><h1>NC lamp</h1><span id="sys">connecting…</span></header>
<main>
<section class="card" id="camcard">
  <div class="camwrap"><video id="awake" playsinline muted loop preload="auto"><source src="data:video/webm;base64,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" type="video/webm"><source src="data:video/mp4;base64,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" type="video/mp4"></video><img id="cam" alt=""><canvas id="ov"></canvas><div id="camoff"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7h3l2-2h8l2 2h3v12H3z"/><circle cx="12" cy="13" r="3.5"/><path d="M2 2l20 20"/></svg><b>Camera is off</b><span>It starts with the Camera button, with Search fruit, or with /api/cam?on=1, and stops when the search ends. Off, the head stays about 8 °C cooler.</span></div></div>
  <div class="row">
    <button id="bdet" class="on">Detect</button>
    <button id="bana">Analysed frame</button>
    <label>Threshold <input id="thr" type="range" min="0.1" max="0.9" step="0.05" value="0.35"> <span id="thrv">0.35</span></label>
  </div>
  <div class="row">
    <button id="bcam">Camera</button><button id="bmir">Mirror</button><button id="bflip">Flip</button>
    <a href="/jpg" target="_blank">Snapshot</a>
    <a href="/analysed.jpg" target="_blank">Analysed JPEG</a>
    <span id="camsys" class="note" style="margin:0"></span>
  </div>
  <p class="note">The stream is the live picture; the boxes come from the last frame the model finished, about one second
  old, so a moving object is drawn where it was. "Analysed frame" shows that frame itself with the boxes the lamp drew.</p>
</section>
<aside class="card">
  <h2 class="cam" style="font-size:15px;margin:0 0 8px"><span id="ddot" class="dot"></span>YOLO11n · 80 COCO classes</h2>
  <h2 class="nocamh" style="font-size:15px;margin:0 0 8px;display:none">Head</h2>
  <table>
    <tr class="cam"><td>model time</td><td id="s_ms">–</td></tr>
    <tr class="cam"><td>analysed frames / s</td><td id="s_dfps">–</td></tr>
    <tr class="cam"><td>camera frames / s</td><td id="s_cfps">–</td></tr>
    <tr class="cam"><td>stream frames / s</td><td id="s_sfps">–</td></tr>
    <tr class="cam"><td>screen kept awake</td><td id="s_awake">–</td></tr>
    <tr><td>chip temperature</td><td id="s_temp">–</td></tr>
    <tr><td>free RAM / PSRAM</td><td id="s_mem">–</td></tr>
    <tr><td>Wi-Fi</td><td id="s_wifi">–</td></tr>
    <tr><td>up</td><td id="s_up">–</td></tr>
    <tr><td>firmware</td><td id="s_fw">–</td></tr>
  </table>
  <div class="row">
    <input id="fw" type="file" accept=".bin" hidden>
    <button id="bfw">Upload firmware…</button>
    <span id="fwst" class="note" style="margin:0"></span>
  </div>
  <div class="cam">
  <h3 style="font-size:14px;margin:14px 0 6px">Seen now</h3>
  <ul id="list"><li><span class="note">nothing yet</span></li></ul>
  </div>
  <p class="note">API: <code>/api/status</code><span class="cam">, <code>/api/detections</code>, <code>/api/detect?on=1&amp;thr=0.35&amp;be=1</code>,
  <code>/api/cam?hflip=1&amp;vflip=0</code>, <code>/jpg</code>, <code>/analysed.jpg</code>, stream on port 81 <code>/stream</code></span>;
  firmware upload: POST the app image to <code>/update</code>; MCP server for AI clients: POST <code>/mcp</code>.</p>
</aside>
<section class="card" style="grid-column:1/-1">
  <h2 style="font-size:15px;margin:0 0 4px">Lamp</h2>
  <div class="row" style="margin-top:6px">
    <button id="btq">Torque off</button>
    <button id="bstop">Stop action</button>
    <button id="bcal">Set this pose as init…</button>
    <span id="actst" class="note" style="margin:0">idle</span>
    <span id="lmsg" class="note" style="margin:0"></span>
  </div>
  <div class="row" id="safeacts"></div>
  <div class="row" id="acts"></div>
  <div class="row cam">
    <button id="bsearch">Search fruit</button>
    <span id="searchst" class="note" style="margin:0"></span>
  </div>
  <div class="joints" id="joints"></div>
  <div class="row">
    <label>Speed <input id="jspeed" type="range" min="100" max="3000" step="50" value="900"> <span id="jspeedv">900</span></label>
    <label>Accel <input id="jacc" type="range" min="5" max="200" value="40"> <span id="jaccv">40</span></label>
  </div>
  <p class="note">Boot never moves the lamp: the servos are only read, then torque goes back to how you last set it (on = hold the pose
  as found). New lamp or re-seated horn: torque off, pose it pointing up by hand, set this pose as init, torque on. Joint angles follow
  the URDF (shoulder 90 = pointing up); the sliders show target → measured, servo temperature and current.</p>
  <h3 style="font-size:14px;margin:14px 0 4px">Light <span id="lclk" class="note" style="font-weight:normal"></span></h3>
  <div class="strip" id="strip"></div>
  <div class="row" id="modes" style="margin-top:6px"></div>
  <div class="row"><label>At start <select id="idle"></select></label><span id="idlenow" class="note" style="margin:0"></span></div>
  <div class="row">
    <label>Colour <input id="col" type="color" value="#ffb15c"></label>
    <label>2nd <input id="col2" type="color" value="#000000"></label>
    <label>Bright <input id="lbri" type="range" min="5" max="255" value="100"> <span id="lbriv">100</span></label>
    <label>Speed <input id="lspd" type="range" min="1" max="100" value="40"> <span id="lspdv">40</span></label>
    <label>Width <input id="lw" type="range" min="1" max="24" value="6"> <span id="lwv">6</span></label>
    <label>Aim <input id="laim" type="range" min="0" max="359" value="90"> <span id="laimv">90</span></label>
    <label>White <input id="lct" type="range" min="2000" max="10000" step="100" value="6500"> <span id="lctv">6500 K</span></label>
  </div>
  <p class="note">The strip view and Aim use a clock face seen from the front: 0 = top, 90 = right. Clock shows the time (hours amber,
  minutes violet, seconds orange) from the internet. Each action brings its own light and the one from before comes back when it ends,
  except Point up, Look down and Reach. <span class="cam">Search fruit: the head goes up and looks at the table with the radar light, stops at three
  yaw angles; a banana (yellow), apple (green) or carrot (orange) brings the head down and keeps it in the middle of the picture; several
  fruits give sectors, the banana wins; one other known object is followed in violet; nothing gives a red breath and a new sweep after
  5 s. </span>API: GET <code>/api/lamp</code> · POST <code>/api/pose</code> <code>/api/led</code> <code>/api/action</code>
  <code>/api/torque</code> <code>/api/calib</code> <code>/api/hold</code> <span class="cam"><code>/api/search</code> <code>{"on":true}</code> </span><code>/api/idle</code> <code>{"mode":"random"}</code> (JSON bodies).</p>
</section>
</main>
<script>
const $=id=>document.getElementById(id);
const img=$('cam'),cv=$('ov'),ctx=cv.getContext('2d');
// Keep the phone / tablet / laptop screen on while the camera runs: the Screen Wake Lock API where the browser allows it
// (needs https, so mostly not here), otherwise a silent looping video under the stream, as video players do (NoSleep.js clips).
const awake={lock:null,vid:$('awake'),want:false,camWas:false};
async function keepAwake(on){
  awake.want=on;
  if(on&&document.visibilityState==='visible'){
    if('wakeLock' in navigator&&!awake.lock){try{awake.lock=await navigator.wakeLock.request('screen');awake.lock.addEventListener('release',()=>{awake.lock=null;});}catch(e){}}
    if(awake.vid.paused)awake.vid.play().catch(()=>{});
  }else{
    if(awake.lock){awake.lock.release().catch(()=>{});awake.lock=null;}
    if(!awake.vid.paused)awake.vid.pause();
  }
  $('s_awake').textContent=awake.lock?'yes (wake lock)':(!awake.vid.paused?'yes (video)':'no');
}
document.addEventListener('visibilitychange',()=>keepAwake(awake.want));
// On the lamp itself the stream is on port 81; behind a reverse proxy (https on one host name) that port is not there,
// so the page falls back to /stream on its own origin, which the proxy can route to the lamp's port 81.
const streamUrls=[location.protocol+'//'+location.hostname+':81/stream','/stream'];let streamI=0;
let analysed=false,lastSeq=-1,det={boxes:[],w:320,h:240},st={},camUi=null;   // camUi: decided once from cam.present
const COLORS=['#ff9f1a','#3ccf6a','#2ee6ff','#ff4fd8','#ffe14d','#ff5a5f'];
function live(){img.src=streamUrls[streamI]+'?t='+Date.now();cv.style.display='';}
function fmt(n,d){return n==null||isNaN(n)?'–':Number(n).toFixed(d);}
function draw(){
  const W=img.clientWidth,H=img.clientHeight;if(!W||!H)return;
  if(cv.width!==W||cv.height!==H){cv.width=W;cv.height=H;}
  ctx.clearRect(0,0,W,H);
  if(analysed||!det.w)return;
  const sx=W/det.w,sy=H/det.h;ctx.lineWidth=2;ctx.font='13px system-ui,sans-serif';
  for(const b of det.boxes){
    const c=COLORS[b.c%COLORS.length],x=b.b[0]*sx,y=b.b[1]*sy,w=(b.b[2]-b.b[0])*sx,h=(b.b[3]-b.b[1])*sy;
    ctx.strokeStyle=c;ctx.strokeRect(x,y,w,h);
    const t=b.n+' '+Math.round(b.s*100)+'%',tw=ctx.measureText(t).width+8;
    ctx.fillStyle=c;ctx.fillRect(x,Math.max(0,y-18),tw,18);ctx.fillStyle='#000';ctx.fillText(t,x+4,Math.max(13,y-5));
  }
}
async function pollDet(){
  try{const r=await fetch('/api/detections',{cache:'no-store'});det=await r.json();
    if(det.seq!==lastSeq){lastSeq=det.seq;
      $('list').innerHTML=det.boxes.length?det.boxes.map(b=>'<li><span>'+b.n+'</span><span>'+Math.round(b.s*100)+'%</span></li>').join(''):'<li><span class="note">nothing in view</span></li>';
      if(analysed)img.src='/analysed.jpg?s='+det.seq;}
    draw();
  }catch(e){}
  setTimeout(pollDet,300);
}
async function pollStatus(){
  try{const r=await fetch('/api/status',{cache:'no-store'});st=await r.json();
    const d=st.det||{},c=st.cam||{},w=st.wifi||{};
    if(camUi===null){camUi=!!c.present;if(camUi){live();pollDet();}else document.body.classList.add('nocam');}   // no camera module: hide its parts
    $('sys').textContent=(w.ap?'AP ':'')+w.ssid+' · '+w.ip+(w.rssi?' · '+w.rssi+' dBm':'')+(st.temp!=null?' · '+fmt(st.temp,1)+' °C':'');
    $('s_ms').textContent=d.ms?d.ms+' ms':'–';$('s_dfps').textContent=fmt(d.fps,2);$('s_cfps').textContent=fmt(c.fps,1);
    $('s_sfps').textContent=fmt(c.streamFps,1)+(c.viewers?' ('+c.viewers+' viewer'+(c.viewers>1?'s':'')+')':'');
    $('s_temp').textContent=st.temp!=null?fmt(st.temp,1)+' °C':'n/a';
    $('s_mem').textContent=Math.round(st.heap/1024)+' / '+Math.round(st.psram/1024)+' kB';
    $('s_wifi').textContent=(w.ap?'AP ':'')+w.ssid+(w.rssi?' '+w.rssi+' dBm':'');
    $('s_up').textContent=st.up>3600?Math.floor(st.up/3600)+' h '+Math.floor(st.up%3600/60)+' min':Math.floor(st.up/60)+' min '+st.up%60+' s';
    $('camsys').textContent=c.ok?c.w+' x '+c.h+' RGB565':(c.err?'camera did not start: '+c.err:'camera not running');
    const a=st.app||{};$('s_fw').textContent=(a.version||'?')+' in '+(a.slot||'?');
    $('ddot').className='dot '+(d.ok?(d.on?'ok':''):'bad');
    $('bdet').classList.toggle('on',!!d.on);
    $('bcam').classList.toggle('on',!!c.ok);
    keepAwake(!!c.ok);
    $('camoff').style.display=c.ok?'none':'';
    if(!c.ok&&awake.camWas)img.removeAttribute('src');   // camera went off: no broken-picture icon behind the card
    if(c.ok&&!awake.camWas)setTimeout(live,1000);   // the search or the API switched the camera on: restart the stream picture
    awake.camWas=!!c.ok;
    if(document.activeElement!==$('thr')){$('thr').value=d.thr;$('thrv').textContent=fmt(d.thr,2);}
    $('bmir').classList.toggle('on',!!c.hflip);$('bflip').classList.toggle('on',!!c.vflip);
  }catch(e){$('sys').textContent='no answer from the lamp';}
  setTimeout(pollStatus,2000);
}
$('bdet').onclick=()=>fetch('/api/detect?on='+(st.det&&st.det.on?0:1)).then(pollStatusSoon);
$('bana').onclick=()=>{analysed=!analysed;$('bana').classList.toggle('on',analysed);if(analysed){img.src='/analysed.jpg?s='+lastSeq;}else live();draw();};
$('thr').oninput=e=>$('thrv').textContent=fmt(e.target.value,2);
$('thr').onchange=e=>fetch('/api/detect?thr='+e.target.value);
$('bcam').onclick=()=>fetch('/api/cam?on='+(st.cam&&st.cam.ok?0:1)).then(()=>{pollStatusSoon();setTimeout(live,1500);});
$('bmir').onclick=()=>fetch('/api/cam?hflip='+(st.cam&&st.cam.hflip?0:1)).then(pollStatusSoon);
$('bflip').onclick=()=>fetch('/api/cam?vflip='+(st.cam&&st.cam.vflip?0:1)).then(pollStatusSoon);
function pollStatusSoon(){setTimeout(()=>fetch('/api/status',{cache:'no-store'}).then(r=>r.json()).then(s=>{st=s;}),200);}
$('bfw').onclick=()=>$('fw').click();
$('fw').onchange=async e=>{
  const f=e.target.files[0];if(!f)return;
  if(!confirm('Send '+f.name+' ('+Math.round(f.size/1024)+' kB) to the lamp and reboot it?')){e.target.value='';return;}
  $('bfw').disabled=true;$('fwst').textContent='uploading '+Math.round(f.size/1024)+' kB…';
  try{const r=await fetch('/update',{method:'POST',body:f});const t=await r.text();
    if(!r.ok)throw new Error(t);
    $('fwst').textContent='done: '+t+' — rebooting, the page reloads in 12 s';
    setTimeout(()=>location.reload(),12000);
  }catch(err){$('fwst').textContent='failed: '+err.message;$('bfw').disabled=false;}
  e.target.value='';
};
img.onerror=()=>{if(!analysed&&st.cam&&st.cam.ok){streamI=(streamI+1)%streamUrls.length;setTimeout(live,2000);}};   // retry only while the camera runs, the other stream address next
new ResizeObserver(draw).observe(img);
// ---- lamp: servos and light
let lamp=null,built=false,pend={},poseT=null,ledPend={},ledT=null;
const post=(u,o)=>fetch(u,{method:'POST',body:JSON.stringify(o)}).then(r=>r.ok?r.json():null).then(s=>{if(s){lamp=s;showLamp();}}).catch(()=>{});
function sendPose(){if(poseT)return;poseT=setTimeout(()=>{poseT=null;const o=pend;pend={};post('/api/pose',o);},60);}
function sendLed(o){Object.assign(ledPend,o);if(ledT)return;ledT=setTimeout(()=>{ledT=null;const x=ledPend;ledPend={};post('/api/led',x);},80);}
function buildLamp(s){
  const J=$('joints');J.innerHTML='';
  for(const j of s.joints){const d=document.createElement('div');d.className='joint';
    d.innerHTML='<label><span>'+j.name+' <small>id '+j.id+' · '+j.min+' … '+j.max+'</small></span><span><span id="t_'+j.name+'"></span> → <span id="p_'+j.name+'"></span></span></label><input type="range" id="j_'+j.name+'" min="'+j.min+'" max="'+j.max+'" step="0.5" value="'+j.target+'">';
    J.appendChild(d);d.querySelector('input').oninput=e=>{pend[j.name]=+e.target.value;$('t_'+j.name).textContent=e.target.value;sendPose();};}
  const safe=new Set((s.safePoses||[]).map(p=>p.name));
  const SA=$('safeacts');SA.innerHTML='<span class="note" style="margin:0" title="Measured 2026-11-10: in these poses the arm stands by itself with the motors off. Torque off in one of them switches the motors off where the arm is; anywhere else the arm goes to the default pose (desk) first.">Safe poses:</span>';
  for(const p of s.safePoses||[]){const b=document.createElement('button');b.textContent=p.name;b.dataset.safe=p.name;b.onclick=()=>post('/api/action',{name:p.name});SA.appendChild(b);}
  const A=$('acts');A.innerHTML='<span class="note" style="margin:0">Gestures:</span>';for(const a of s.actions){if(safe.has(a))continue;const b=document.createElement('button');b.textContent=a;b.onclick=()=>post('/api/action',{name:a});A.appendChild(b);}
  const M=$('modes');M.innerHTML='';for(const m of s.led.modes){const b=document.createElement('button');b.textContent=m;b.dataset.m=m;b.onclick=()=>post('/api/led',{mode:m});M.appendChild(b);}
  const I=$('idle');I.innerHTML='';for(const c of s.led.idle.choices){const o=document.createElement('option');o.value=c;o.textContent=c;I.appendChild(o);}I.onchange=()=>post('/api/idle',{mode:I.value});
  const S=$('strip');S.innerHTML='';for(let i=0;i<s.led.n;i++)S.appendChild(document.createElement('i'));
  built=true;
}
function showLamp(){const s=lamp;if(!s||!s.joints)return;if(!built)buildLamp(s);
  $('btq').textContent=s.torque?'Torque on':'Torque off';$('btq').classList.toggle('on',s.torque);
  $('actst').textContent=(s.action?'action: '+s.action:'idle')+(s.floorBlocked?' · pose refused: shade too low':'')+(s.inSafePose&&!s.action?' · safe pose: the motors can go off here':'');
  for(const p of s.safePoses||[]){const b=document.querySelector('[data-safe="'+p.name+'"]');if(!b)continue;let on=true;for(let j=0;j<s.joints.length;j++){if(j===0||p.q[j]==null)continue;if(Math.abs(s.joints[j].target-p.q[j])>1)on=false;}b.classList.toggle('on',on);}
  if(s.msg)$('lmsg').textContent=s.msg;
  const ae=document.activeElement;
  for(const j of s.joints){const sl=$('j_'+j.name);if(ae!==sl)sl.value=j.target;$('t_'+j.name).textContent=j.target+'°';$('p_'+j.name).textContent=j.ok?j.deg+'° · '+j.temp+' °C · '+j.mA+' mA':'offline';}
  if(ae.tagName!=='INPUT'){$('jspeed').value=s.speed;$('jspeedv').textContent=s.speed;$('jacc').value=s.acc;$('jaccv').textContent=s.acc;
    const l=s.led;$('lbri').value=l.bri;$('lbriv').textContent=l.bri;$('lspd').value=l.spd;$('lspdv').textContent=l.spd;$('lw').value=l.w;$('lwv').textContent=l.w;$('laim').value=l.aim;$('laimv').textContent=l.aim;$('lct').value=l.ct;$('lctv').textContent=l.ct+' K';$('col').value=l.color;$('col2').value=l.color2;}
  $('modes').querySelectorAll('button').forEach(b=>b.classList.toggle('on',b.dataset.m===s.led.mode));
  if(document.activeElement!==$('idle'))$('idle').value=s.led.idle.set;$('idlenow').textContent=s.led.idle.set==='random'?'this boot: '+s.led.idle.now:'';
  const c=$('strip').children;for(let i=0;i<c.length;i++){const h=s.led.leds.substr(i*6,6);const r=parseInt(h.substr(0,2),16),g=parseInt(h.substr(2,2),16),b=parseInt(h.substr(4,2),16);c[i].style.background='rgb('+Math.max(28,r)+','+Math.max(28,g)+','+Math.max(28,b)+')';}
  $('lclk').textContent=(s.led.clock||'no time')+(s.led.ok?'':' · strip driver failed');
  const q=s.search||{};$('bsearch').classList.toggle('on',!!q.on);
  $('searchst').textContent=q.on?q.state+(q.target?' → '+q.target+' '+Math.round(q.score*100)+'%':'')+(q.seen?' · seen: '+q.seen:'')+(q.state==='sweep'?' · stop '+q.stop:''):'';
}
$('bsearch').onclick=()=>post('/api/search',{on:!(lamp&&lamp.search&&lamp.search.on)});
async function pollLamp(){try{const r=await fetch('/api/lamp',{cache:'no-store'});lamp=await r.json();showLamp();}catch(e){}setTimeout(pollLamp,300);}
$('btq').onclick=()=>post('/api/torque',{on:!(lamp&&lamp.torque)});
$('bstop').onclick=()=>post('/api/action',{name:''});
$('bcal').onclick=()=>{if(confirm('Writes the servo offsets so this pose reads 2048 on every joint. Torque off, hold the lamp pointing up (arm vertical, head straight), then OK.'))post('/api/calib',{joints:[]});};
$('jspeed').oninput=e=>{$('jspeedv').textContent=e.target.value;pend.speed=+e.target.value;sendPose();};
$('jacc').oninput=e=>{$('jaccv').textContent=e.target.value;pend.acc=+e.target.value;sendPose();};
$('col').oninput=e=>sendLed({color:e.target.value});$('col2').oninput=e=>sendLed({color2:e.target.value});
for(const[id,k]of[['lbri','bri'],['lspd','spd'],['lw','w'],['laim','aim']])$(id).oninput=e=>{$(id+'v').textContent=e.target.value;const o={};o[k]=+e.target.value;sendLed(o);};
$('lct').oninput=e=>{$('lctv').textContent=e.target.value+' K';sendLed({ct:+e.target.value});};
pollStatus();pollLamp();   // the stream and the detections start once /api/status says there is a camera
</script></body></html>
)HTML";
