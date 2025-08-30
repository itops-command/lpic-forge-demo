const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));

const LSKEY = 'lpic_pro_state';
const state = JSON.parse(localStorage.getItem(LSKEY) || '{}');

// Estado base
state.profile  ||= { email: '' };
state.stats    ||= { goal: 75, streak: 0, lastDay: '', minutes: 0, xp: 0 };
state.srs      ||= {};     // id -> {box,nextDue}
state.progress ||= {       // métricas
  perQ: {},                // id -> {right, wrong}
  perTopic: {}             // topic -> {right, wrong}
};
state.history  ||= { exams: [] }; // intentos de simulador
state.ui       ||= { lastTab: 'plan' };

function save(){ localStorage.setItem(LSKEY, JSON.stringify(state)); }
function today(){ return new Date().toISOString().slice(0,10); }
function showBanner(msg){
  let el = $('#banner');
  if(!el){
    el = document.createElement('div');
    el.id = 'banner';
    el.style.cssText = 'margin:10px 0;padding:10px;border:1px solid #7a5c15;background:#392c14;border-radius:10px';
    $('.wrap').insertBefore(el, $('.wrap').firstChild?.nextSibling);
  }
  el.textContent = msg;
}

function addMinutes(m){
  const t = today();
  if(state.stats.lastDay!==t){
    if(state.stats.minutes>=state.stats.goal) state.stats.streak+=1; else state.stats.streak=0;
    state.stats.minutes=0; state.stats.lastDay=t;
  }
  state.stats.minutes += m; state.stats.xp += m*2;
  save(); renderHeader();
}
function renderHeader(){
  $('#streak').textContent = state.stats.streak;
  $('#today').textContent = state.stats.minutes;
  $('#goal').textContent = state.stats.goal;
  $('#xp').textContent = state.stats.xp;
  $('#emailInput').value = state.profile.email || '';
}
function resetAll(){
  if(confirm('¿Restablecer todo tu progreso?')){ localStorage.removeItem(LSKEY); location.reload(); }
}
function tab(id){
  state.ui.lastTab = id; save();
  $$('.tab').forEach(t=>t.classList.toggle('active', t.dataset.id===id));
  $$('.view').forEach(v=>v.style.display = (v.id===id? 'block':'none'));
}

async function loadJSON(path){
  try{
    const r = await fetch(path, {cache:'no-store'});
    if(!r.ok) throw new Error('HTTP '+r.status);
    return await r.json();
  }catch(e){ showBanner('No se pudo cargar '+path); return []; }
}
let Q = [];   // preguntas
let LABS = []; // labs

// Utilidades preguntas
function shuffle(a){ return a.map(v=>[Math.random(),v]).sort((x,y)=>x[0]-y[0]).map(v=>v[1]) }
function normalize(s){ return (s??'').toString().trim().toLowerCase().replace(/\s+/g,' ') }
function isCorrect(q, ua){
  if(q.type==='mcq') return q.answer.includes(ua);
  if(q.type==='fitb') return q.answer.some(a=> normalize(a)===normalize(ua));
  return false;
}
function bumpProgress(q, ok){
  state.progress.perQ[q.id] ||= {right:0, wrong:0};
  state.progress.perTopic[q.topic] ||= {right:0, wrong:0};
  if(ok){ state.progress.perQ[q.id].right++; state.progress.perTopic[q.topic].right++; }
  else  { state.progress.perQ[q.id].wrong++; state.progress.perTopic[q.topic].wrong++; }
}

// SRS
const BOX = {1:0,2:1,3:3,4:7,5:14};
function ensureCard(id){ state.srs[id] ||= {box:1,nextDue:0}; return state.srs[id]; }
function nextDue(box){ return Date.now() + (BOX[box]||0)*24*60*60*1000; }
function reviewCard(id, ok){
  const c = ensureCard(id);
  c.box = ok ? Math.min(5, c.box+1) : 1;
  c.nextDue = nextDue(c.box);
}

function dueCards(){
  const now = Date.now();
  return (Q||[]).filter(q=> (ensureCard(q.id).nextDue||0) <= now );
}

// Dibujo simple de barras para Dashboard
function drawTopicsChart(){
  const canvas = $('#chartTopics'); if(!canvas) return;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0,0,canvas.width,canvas.height);
  const topics = Object.keys(state.progress.perTopic);
  if(!topics.length){ ctx.fillStyle='#e6ebff'; ctx.fillText('Aún no hay datos. Resuelve quizzes o simulacros.', 20, 40); return; }
  const data = topics.map(t=>{
    const v = state.progress.perTopic[t]; return {t, right:v.right||0, wrong:v.wrong||0};
  });
  const max = Math.max(1, ...data.map(d=> d.right + d.wrong));
  const W = canvas.width, H = canvas.height;
  const barW = Math.max(20, Math.floor((W-100)/data.length)-10);
  ctx.font='14px sans-serif'; ctx.fillStyle='#9db1d9';
  ctx.fillText('Aciertos/Fallos por tópico', 20, 20);
  data.forEach((d, i)=>{
    const x = 60 + i*(barW+10);
    const total = d.right + d.wrong;
    const rh = Math.floor((d.right/max)*(H-80));
    const wh = Math.floor((d.wrong/max)*(H-80));
    // wrong (abajo)
    ctx.fillStyle='#ff5d7a'; ctx.fillRect(x, H-40-wh, barW, wh);
    // right (arriba)
    ctx.fillStyle='#3dd68c'; ctx.fillRect(x, H-40-wh-rh, barW, rh);
    // labels
    ctx.fillStyle='#e6ebff'; ctx.fillText(d.t, x, H-20);
    ctx.fillText(total.toString(), x+Math.max(0,barW/2-8), H-45-wh-rh);
  });
  // Leyenda
  ctx.fillStyle='#3dd68c'; ctx.fillRect(W-180, 10, 12, 12); ctx.fillStyle='#e6ebff'; ctx.fillText('Correctas', W-160, 20);
  ctx.fillStyle='#ff5d7a'; ctx.fillRect(W-180, 30, 12, 12); ctx.fillStyle='#e6ebff'; ctx.fillText('Incorrectas', W-160, 40);
}
function renderDashList(){
  const div = $('#dashList'); if(!div) return;
  const arr = Object.entries(state.progress.perTopic).map(([k,v])=>{
    const t = (v.right||0)+(v.wrong||0) || 1;
    const rateWrong = (v.wrong||0)/t;
    return {topic:k, wrong:v.wrong||0, right:v.right||0, rateWrong};
  }).sort((a,b)=> b.rateWrong - a.rateWrong);
  if(!arr.length){ div.innerHTML='<div class="small">Aún no hay datos suficientes.</div>'; return; }
  const top = arr.slice(0,5).map(x=> `<li><b>${x.topic}</b> — ${x.wrong} mal / ${x.right} bien</li>`).join('');
  div.innerHTML = `<h4>Prioriza estos temas</h4><ol>${top}</ol>`;
}

// INIT
async function init(){
  renderHeader();
  // Tabs
  $$('.tab').forEach(t=>t.addEventListener('click', ()=>tab(t.dataset.id)));
  tab(state.ui.lastTab || 'plan');

  // Perfil, meta, reset
  $('#saveGoal').addEventListener('click', ()=>{
    const v = parseInt($('#goalInput').value||'0'); if(v>0){ state.stats.goal=v; save(); renderHeader(); alert('Meta guardada'); }
  });
  $('#saveEmail').addEventListener('click', ()=>{
    state.profile.email = ($('#emailInput').value || '').trim(); save(); alert('Perfil guardado');
  });
  $('#resetAll').addEventListener('click', resetAll);

  // Temporizador general
  let running=false, start=0;
  setInterval(()=>{
    if(running){
      const s = Math.floor((Date.now()-start)/1000);
      $('#timer').textContent = Math.floor(s/60).toString().padStart(2,'0')+':'+(s%60).toString().padStart(2,'0');
      if(s && s%60===0){ addMinutes(1); }
    }
  }, 1000);
  $('#startTimer').addEventListener('click', ()=>{ running=true; start=Date.now(); });
  $('#pauseTimer').addEventListener('click', ()=>{ running=false; });

  // Datos
  Q = await loadJSON('./questions.json');
  LABS = await loadJSON('./labs.json');

  // ----- SRS -----
  function renderSRS(){
    const due = dueCards();
    $('#dueCount').textContent = due.length;
    const box = $('#srsBox'); box.innerHTML='';
    if(!due.length){ box.innerHTML='<div class="panel">¡Nada pendiente ahora! Haz un Quiz para añadir tarjetas.</div>'; return; }
    const q = due[0];
    const prompt = (q.variants && Math.random()<0.5)? q.variants[0] : q.prompt;
    const ansText = (q.type==='mcq' ? q.options.filter((_,i)=>q.answer.includes(i)).join(' | ') : q.answer[0]);
    box.innerHTML = `
      <div class="panel">
        <div class="row" style="justify-content:space-between"><small>${q.topic}</small><span class="badge">${q.difficulty}</span></div>
        <div style="font-size:18px;margin-top:8px"><b>Concepto:</b> ${prompt}</div>
        <div id="srsInputs" style="margin-top:10px"></div>
        <div class="row" style="justify-content:space-between;margin-top:8px">
          <button id="srsReveal" class="btn ghost">Mostrar explicación</button>
          <div class="row">
            <button id="srsKO" class="btn ghost">✗ Difícil</button>
            <button id="srsOK" class="btn">✓ Fácil</button>
          </div>
        </div>
        <div id="srsAns" style="margin-top:8px;display:none">
          <div class="feedback ok"><b>Respuesta:</b> ${ansText}${q.explanation? ' — '+q.explanation:''}</div>
        </div>
      </div>`;
    if(q.type==='fitb'){ $('#srsInputs').innerHTML = '<input class="input" id="srsInput" placeholder="Respuesta…">'; }
    if(q.type==='mcq'){ $('#srsInputs').innerHTML = q.options.map((o,i)=>`<div class="opt">${o}</div>`).join(''); }
    $('#srsReveal').onclick = ()=>{ $('#srsAns').style.display='block'; };
    $('#srsOK').onclick    = ()=>{ reviewCard(q.id, true); save(); renderSRS(); };
    $('#srsKO').onclick    = ()=>{ reviewCard(q.id, false); save(); renderSRS(); };
  }
  renderSRS();
  $('#refreshSRS').addEventListener('click', renderSRS);

  // ----- QUIZ / LECCIÓN -----
  function startQuizGeneric(pool){
    const defer = $('#deferChk').checked;
    const panel = $('#quizPanel'); panel.innerHTML='';
    if(pool.length===0){ panel.innerHTML = '<div class="panel">No hay preguntas con esos filtros.</div>'; return; }

    let idx=0, answers={}; // id->ua
    let locked=false, reviewing=false;

    function draw(){
      const q = pool[idx];
      const prompt = (q.variants && Math.random()<0.5)? q.variants[0]: q.prompt;
      locked=false; reviewing=false;

      panel.innerHTML = `
        <div class="panel">
          <div class="row" style="justify-content:space-between"><small>${q.topic}</small><span class="badge">${q.difficulty}</span></div>
          <div style="font-size:18px;margin-top:8px">${prompt}</div>
          <div id="qArea" style="margin-top:10px"></div>
          <div id="qFeedback"></div>
          <div class="row" style="justify-content:space-between;margin-top:8px">
            <button id="prevQ" class="btn ghost">Anterior</button>
            <div>${idx+1}/${pool.length}</div>
            <button id="nextQ" class="btn">Siguiente</button>
          </div>
        </div>`;

      function evaluateAndShow(){
        const ua = answers[q.id];
        if(ua===undefined || ua===null || ua===''){ showBanner('Selecciona o escribe una respuesta antes de continuar.'); return false; }
        const ok = isCorrect(q, ua);
        bumpProgress(q, ok); reviewCard(q.id, ok); save();
        const ansText = (q.type==='mcq' ? q.options.filter((_,k)=>q.answer.includes(k)).join(' | ') : q.answer[0]);
        $('#qFeedback').innerHTML = `<div class="feedback ${ok?'ok':'ko'}">${ok?'✅ Correcto':'❌ Incorrecto'} — <b>Respuesta:</b> ${ansText}${q.explanation? ' — '+q.explanation:''}</div>`;
        reviewing = true; $('#nextQ').textContent = 'Continuar'; return true;
      }

      if(q.type==='mcq'){
        $('#qArea').innerHTML = q.options.map((o,i)=>`<button type="button" class="opt" data-i="${i}">${o}</button>`).join('');
        $$('#qArea .opt').forEach(b=> b.onclick = ()=>{
          if(locked) return; // bloquear cambio
          const i = parseInt(b.dataset.i);
          answers[q.id]=i; locked=true;
          if(!defer){
            const ok = isCorrect(q,i);
            $$('#qArea .opt').forEach(x=>x.classList.remove('sel','right','wrong'));
            b.classList.add('sel', ok?'right':'wrong');
            evaluateAndShow();
          }else{
            $$('#qArea .opt').forEach(x=>x.classList.remove('sel','right','wrong'));
            b.classList.add('sel');
          }
        });
      }else{
        $('#qArea').innerHTML = '<input class="input" id="ua" placeholder="Respuesta…">';
        $('#ua').onchange = (e)=>{ if(!locked){ answers[q.id]=e.target.value; locked=true; if(!defer){ evaluateAndShow(); } } };
      }

      $('#prevQ').onclick = ()=>{ idx = Math.max(0, idx-1); draw(); };
      $('#nextQ').onclick = ()=>{
        if(!reviewing){
          if(!defer){
            if(answers[q.id]===undefined){ showBanner('Selecciona o escribe una respuesta.'); return; }
            reviewing = true; $('#nextQ').textContent = 'Continuar';
          }else{
            if(!evaluateAndShow()) return;
          }
        }else{
          if(idx===pool.length-1) finish(); else { idx++; draw(); }
        }
      };
    }

    function finish(){
      let correct=0, made=0;
      pool.forEach(q=>{
        const ua = answers[q.id];
        if(ua!==undefined && ua!==null && ua!==''){ made++; if(isCorrect(q,ua)) correct++; }
        if(ua!==undefined) { ensureCard(q.id); }
      });
      save();

      const topics = Object.entries(state.progress.perTopic).map(([k,v])=>{
        const t = (v.right||0)+(v.wrong||0) || 1;
        return [k, v.wrong||0, v.right||0, (v.wrong||0)/t];
      }).sort((a,b)=> b[3]-a[3]).slice(0,3);

      const wrongList = pool.filter(q=>{
        const ua = answers[q.id]; return ua!==undefined && !isCorrect(q,ua);
      }).map(q=>{
        const ansText = (q.type==='mcq' ? q.options.filter((_,k)=>q.answer.includes(k)).join(' | ') : q.answer[0]);
        return `<li><b>${q.topic}</b> — ${q.prompt}<br><span class="small"><b>Correcta:</b> ${ansText}${q.explanation? ' — '+q.explanation:''}</span></li>`;
      }).join('');

      $('#quizPanel').innerHTML = `
        <div class="panel">
          <h3>Resultado</h3>
          <div class="row">
            <div class="badge">Correctas: ${correct}/${made}</div>
            <div class="badge">Preguntas: ${pool.length}</div>
          </div>
          <div class="hr"></div>
          <h4>🩹 Tus temas más débiles</h4>
          ${topics.length? `<ul>${topics.map(([k,w,r])=>`<li><b>${k}</b>: ${w} mal / ${r} bien</li>`).join('')}</ul>` : '<div class="small">Aún no hay suficientes datos.</div>'}
          <div class="hr"></div>
          <h4>❌ Revisión de fallos</h4>
          ${wrongList? `<ol>${wrongList}</ol>` : '<div class="small">¡No tuviste fallos en esta sesión!</div>'}
          <div class="hr"></div>
          <button id="again" class="btn">Reiniciar</button>
        </div>`;
      $('#again').onclick = ()=> startQuizGeneric(pool);
      drawTopicsChart(); renderDashList();
    }

    draw();
  }

  function startQuiz(){
    if(!Q.length){ showBanner('No hay preguntas. Revisa questions.json'); return; }
    const topic = $('#topicSel').value;
    const diff  = $('#diffSel').value;
    let pool = Q.slice();
    if(topic!=='all') pool = pool.filter(q=> q.topic===topic);
    if(diff!=='all')  pool = pool.filter(q=> q.difficulty===diff);
    pool = shuffle(pool).slice(0,12);
    startQuizGeneric(pool);
  }
  function startLesson10(){
    if(!Q.length){ showBanner('No hay preguntas.'); return; }
    startQuizGeneric(shuffle(Q.slice()).slice(0,10));
  }
  $('#startQuiz').addEventListener('click', ()=>{ tab('quiz'); startQuiz(); });
  $('#startLesson10').addEventListener('click', ()=>{ tab('quiz'); startLesson10(); });

  // ----- SIMULADOR -----
  let examTick=null;
  function fmtHMS(secs){
    const h=Math.floor(secs/3600), m=Math.floor((secs%3600)/60), s=secs%60;
    return [h,m,s].map(n=>String(n).padStart(2,'0')).join(':');
  }
  function startExam(){
    if(!Q.length){ showBanner('No hay preguntas.'); return; }
    const count = parseInt($('#examCount').value||'60');
    const timeMin = parseInt($('#examTime').value||'90');
    const pool = shuffle(Q.slice()).slice(0, Math.min(count, Q.length));
    const panel = $('#examPanel'); panel.innerHTML='';
    if(pool.length < count){ showBanner(`Solo hay ${pool.length} preguntas en el banco (demo).`); }

    let idx=0, answers={}, timeLeft=timeMin*60, locked=false;

    // temporizador
    $('#examTimer').textContent = fmtHMS(timeLeft);
    if(examTick) clearInterval(examTick);
    examTick = setInterval(()=>{ timeLeft--; $('#examTimer').textContent = fmtHMS(timeLeft); if(timeLeft<=0){ clearInterval(examTick); finish(true); } }, 1000);

    function draw(){
      const q = pool[idx];
      const prompt = q.prompt; // en examen NO alternamos texto para mantener consistencia
      locked=false;

      panel.innerHTML = `
        <div class="panel">
          <div class="row" style="justify-content:space-between"><small>${q.topic}</small><span class="badge">${q.difficulty}</span></div>
          <div style="font-size:18px;margin-top:8px">${prompt}</div>
          <div id="eArea" style="margin-top:10px"></div>
          <div class="row" style="justify-content:space-between;margin-top:8px">
            <div>${idx+1}/${pool.length}</div>
            <div class="row">
              <button id="submitExam" class="btn ghost">Terminar ahora</button>
              <button id="nextE" class="btn">Siguiente</button>
            </div>
          </div>
        </div>`;

      if(q.type==='mcq'){
        $('#eArea').innerHTML = q.options.map((o,i)=>{
          const sel = answers[q.id]===i ? ' sel' : '';
          return `<button type="button" class="opt${sel}" data-i="${i}">${o}</button>`;
        }).join('');
        $$('#eArea .opt').forEach(b=> b.onclick = ()=>{
          if(locked) return; // bloquear cambio si quisiéramos; aquí permitimos cambiar hasta pulsar "Siguiente"
          const i = parseInt(b.dataset.i);
          answers[q.id]=i;
          $$('#eArea .opt').forEach(x=>x.classList.remove('sel'));
          b.classList.add('sel');
        });
      }else{
        $('#eArea').innerHTML = `<input class="input" id="eUA" placeholder="Respuesta…">`;
        if(answers[q.id]) $('#eUA').value = answers[q.id];
        $('#eUA').onchange = (e)=>{ answers[q.id] = e.target.value; };
      }

      $('#nextE').onclick = ()=>{
        if(answers[q.id]===undefined || answers[q.id]===''){ showBanner('Selecciona/escribe una respuesta antes de continuar.'); return; }
        if(idx===pool.length-1){ finish(false); } else { idx++; draw(); }
      };
      $('#submitExam').onclick = ()=> finish(false);
    }

    function finish(auto=false){
      if(examTick) clearInterval(examTick);
      let correct=0, made=0;
      pool.forEach(q=>{
        const ua = answers[q.id];
        if(ua!==undefined && ua!==''){ made++; if(isCorrect(q,ua)) correct++; bumpProgress(q, isCorrect(q,ua)); reviewCard(q.id, isCorrect(q,ua)); }
      });
      save();

      const score = Math.round((correct / Math.max(1, pool.length))*100);
      state.history.exams.push({ts: Date.now(), count: pool.length, timeMin, used: (timeMin*60 - Math.max(0, parseInt($('#examTimer').textContent.split(':').reduce((a,b)=>60*a+ +b,0)))), score});
      save();

      const wrongList = pool.filter(q=> !isCorrect(q,answers[q.id])).map(q=>{
        const ansText = (q.type==='mcq' ? q.options.filter((_,k)=>q.answer.includes(k)).join(' | ') : q.answer[0]);
        return `<li><b>${q.topic}</b> — ${q.prompt}<br><span class="small"><b>Correcta:</b> ${ansText}${q.explanation? ' — '+q.explanation:''}</span></li>`;
      }).join('');

      $('#examPanel').innerHTML = `
        <div class="panel">
          <h3>Resultado del simulacro ${auto?'(auto-entregado por tiempo)':''}</h3>
          <div class="row">
            <div class="badge">Puntaje: ${score}%</div>
            <div class="badge">Correctas: ${correct}/${pool.length}</div>
          </div>
          <div class="hr"></div>
          <h4>❌ Revisión de fallos</h4>
          ${wrongList? `<ol>${wrongList}</ol>` : '<div class="small">¡Sin fallos, excelente!</div>'}
          <div class="hr"></div>
          <button id="examAgain" class="btn">Nuevo simulacro</button>
        </div>`;
      $('#examAgain').onclick = startExam;
      drawTopicsChart(); renderDashList();
    }

    draw();
  }
  $('#startExam').addEventListener('click', ()=>{ tab('exam'); startExam(); });

  // ----- LABS -----
  function populateLabs(){
    const sel = $('#labSel');
    sel.innerHTML = LABS.map(l=> `<option value="${l.id}">${l.title}</option>`).join('');
  }
  function startLab(){
    const id = $('#labSel').value;
    const lab = LABS.find(l=> l.id===id);
    const panel = $('#labPanel'); panel.innerHTML='';
    if(!lab){ panel.innerHTML='<div class="panel">No se encontró el lab.</div>'; return; }

    let step=0;
    function draw(){
      const s = lab.steps[step];
      panel.innerHTML = `
        <div class="panel">
          <h3>${lab.title}</h3>
          <div class="small">Paso ${step+1} de ${lab.steps.length}</div>
          <div class="hr"></div>
          <div><b>Instrucción:</b> ${s.prompt}</div>
          <div id="labIO" style="margin-top:10px"></div>
          <div id="labFB" style="margin-top:10px"></div>
          <div class="row" style="justify-content:space-between;margin-top:10px">
            <button id="labPrev" class="btn ghost"${step===0?' disabled':''}>Anterior</button>
            <div class="row">
              <button id="labCheck" class="btn">Verificar</button>
              <button id="labNext" class="btn ghost"${step===lab.steps.length-1?' disabled':''}>Siguiente</button>
            </div>
          </div>
        </div>`;

      if(s.type==='mcq'){
        $('#labIO').innerHTML = s.options.map((o,i)=>`<button class="opt" data-i="${i}">${o}</button>`).join('');
        let selIdx=null;
        $$('#labIO .opt').forEach(b=> b.onclick = ()=>{ selIdx=parseInt(b.dataset.i); $$('#labIO .opt').forEach(x=>x.classList.remove('sel')); b.classList.add('sel'); });
        $('#labCheck').onclick = ()=>{
          const ok = selIdx!==null && s.answer.includes(selIdx);
          $('#labFB').innerHTML = `<div class="feedback ${ok?'ok':'ko'}">${ok?'✅ Correcto':'❌ Incorrecto'} — ${s.explanation||''}</div>`;
          if(ok){ state.stats.xp += 5; save(); }
        };
      }else{ // cmd/fitb
        $('#labIO').innerHTML = `<input class="input" id="labIn" placeholder="Escribe el comando o respuesta">`;
        $('#labCheck').onclick = ()=>{
          const v = ($('#labIn').value||'').trim();
          let ok=false;
          if(s.regex){ ok = new RegExp(s.regex).test(v); }
          else if(Array.isArray(s.answer)){ ok = s.answer.some(a => normalize(a)===normalize(v)); }
          $('#labFB').innerHTML = `<div class="feedback ${ok?'ok':'ko'}">${ok?'✅ Correcto':'❌ Incorrecto'} — ${s.explanation||''}</div>`;
          if(ok){ state.stats.xp += 5; save(); }
        };
      }
      $('#labPrev').onclick = ()=>{ if(step>0){ step--; draw(); } };
      $('#labNext').onclick = ()=>{ if(step<lab.steps.length-1){ step++; draw(); } };
    }
    draw();
  }
  populateLabs();
  $('#startLab').addEventListener('click', ()=>{ tab('labs'); startLab(); });

  // ----- DASHBOARD -----
  drawTopicsChart(); renderDashList();

  // Sube minutos cada 60s (app abierta)
  let lastTick=Date.now(); setInterval(()=>{ const mins=Math.floor((Date.now()-lastTick)/60000); if(mins>0){ addMinutes(mins); lastTick=Date.now(); }}, 10000);
}

window.addEventListener('load', ()=>{ init(); });
