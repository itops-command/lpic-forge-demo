const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));

const LSKEY = 'lpic_demo_state';
const state = JSON.parse(localStorage.getItem(LSKEY) || '{}');

// Estado inicial
state.profile ||= { email: '' };
state.stats   ||= { goal: 75, streak: 0, lastDay: '', minutes: 0, xp: 0 };
state.srs     ||= {};         // id -> {box,nextDue}
state.progress ||= {          // métricas para detectar puntos débiles
  perQ: {},                   // id -> {right:0, wrong:0}
  perTopic: {}                // topic -> {right:0, wrong:0}
};
state.ui ||= { lastTab: 'plan' }; // para reanudar la última vista

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
  const emailInput = $('#emailInput');
  if(emailInput) emailInput.value = state.profile.email || '';
}

function resetAll(){
  if(confirm('¿Restablecer todo tu progreso? Esta acción no se puede deshacer.')){
    localStorage.removeItem(LSKEY);
    location.reload();
  }
}

function tab(id){
  state.ui.lastTab = id; save();
  $$('.tab').forEach(t=>t.classList.toggle('active', t.dataset.id===id));
  $$('.view').forEach(v=>v.style.display = (v.id===id? 'block':'none'));
}

async function loadQ(){
  try{
    const r = await fetch('./questions.json', {cache:'no-store'});
    if(!r.ok) throw new Error('HTTP '+r.status);
    return await r.json();
  }catch(e){
    showBanner('No se pudieron cargar las preguntas (questions.json). Revisa que el archivo exista y recarga con Ctrl+Shift+R.');
    return [];
  }
}

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
  else { state.progress.perQ[q.id].wrong++; state.progress.perTopic[q.topic].wrong++; }
}

function ensureCard(id){ state.srs[id] ||= {box:1,nextDue:0}; return state.srs[id]; }
const BOX = {1:0,2:1,3:3,4:7,5:14};
function nextDue(box){ return Date.now() + (BOX[box]||0)*24*60*60*1000; }
function reviewCard(id, ok){
  const c = ensureCard(id);
  c.box = ok ? Math.min(5, c.box+1) : 1;
  c.nextDue = nextDue(c.box);
}

function dueCards(Q){
  const now = Date.now();
  return (Q||[]).filter(q=> (ensureCard(q.id).nextDue||0) <= now );
}

async function init(){
  renderHeader();

  // Tabs
  $$('.tab').forEach(t=>t.addEventListener('click', ()=>tab(t.dataset.id)));
  tab(state.ui.lastTab || 'plan');

  // Perfil & meta & reset
  $('#saveGoal').addEventListener('click', ()=>{
    const v = parseInt($('#goalInput').value||'0'); if(v>0){ state.stats.goal=v; save(); renderHeader(); alert('Meta guardada'); }
  });
  $('#saveEmail').addEventListener('click', ()=>{
    state.profile.email = ($('#emailInput').value || '').trim(); save(); alert('Perfil guardado');
  });
  $('#resetAll').addEventListener('click', resetAll);

  // Temporizador
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
  const Q = await loadQ();

  // ------- SRS -------
  function renderSRS(){
    const due = dueCards(Q);
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
    $('#srsOK').onclick = ()=>{ reviewCard(q.id, true); save(); renderSRS(); };
    $('#srsKO').onclick = ()=>{ reviewCard(q.id, false); save(); renderSRS(); };
  }
  renderSRS();
  $('#refreshSRS').addEventListener('click', renderSRS);

  // ------- QUIZ / LECCIÓN -------
  function startQuizGeneric(pool){
    const defer = $('#deferChk').checked;
    const panel = $('#quizPanel'); panel.innerHTML='';
    if(pool.length===0){ panel.innerHTML = '<div class="panel">No hay preguntas con esos filtros.</div>'; return; }

    let idx=0, answers={}, locked=false, reviewing=false;

    function draw(){
      const q = pool[idx];
      const prompt = (q.variants && Math.random()<0.5)? q.variants[0]: q.prompt;
      locked = false; reviewing = false;

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
        // métricas y SRS
        bumpProgress(q, ok);
        reviewCard(q.id, ok);
        save();
        // feedback
        const ansText = (q.type==='mcq' ? q.options.filter((_,k)=>q.answer.includes(k)).join(' | ') : q.answer[0]);
        $('#qFeedback').innerHTML = `<div class="feedback ${ok?'ok':'ko'}">${ok?'✅ Correcto':'❌ Incorrecto'} — <b>Respuesta:</b> ${ansText}${q.explanation? ' — '+q.explanation:''}</div>`;
        reviewing = true;
        $('#nextQ').textContent = 'Continuar';
        return true;
      }

      if(q.type==='mcq'){
        $('#qArea').innerHTML = q.options.map((o,i)=>`<button type="button" class="opt" data-i="${i}">${o}</button>`).join('');
        $$('#qArea .opt').forEach(b=> b.onclick = ()=>{
          if(locked) return; // no permitir cambiar
          const i = parseInt(b.dataset.i);
          answers[q.id]=i;
          locked = true; // bloquea la selección
          if(!defer){
            // feedback inmediato
            const ok = isCorrect(q,i);
            $$('#qArea .opt').forEach(x=>x.classList.remove('sel','right','wrong'));
            b.classList.add('sel', ok?'right':'wrong');
            evaluateAndShow();
          }else{
            // sin feedback hasta Siguiente (solo marcar selección)
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
            // ya se evaluó si no es diferido; si aún no, evalúa
            if(answers[q.id]===undefined){ showBanner('Selecciona o escribe una respuesta.'); return; }
            // en inmediato ya se mostró feedback al seleccionar
            reviewing = true;
            $('#nextQ').textContent = 'Continuar';
          }else{
            // diferido: evaluar ahora
            if(!evaluateAndShow()) return;
          }
        }else{
          // pasar a la siguiente
          if(idx===pool.length-1) finish();
          else { idx++; draw(); }
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

      // resumen por tópico (top 3 débiles)
      const topics = Object.entries(state.progress.perTopic).map(([k,v])=>{
        const t = v.right+v.wrong || 1;
        return [k, v.wrong, v.right, (v.wrong/t)];
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
          ${topics.length? `<ul>${topics.map(([k,w,r,rate])=>`<li><b>${k}</b>: ${w} mal / ${r} bien</li>`).join('')}</ul>` : '<div class="small">Aún no hay suficientes datos.</div>'}
          <div class="hr"></div>
          <h4>❌ Revisión de fallos</h4>
          ${wrongList? `<ol>${wrongList}</ol>` : '<div class="small">¡No tuviste fallos en esta sesión!</div>'}
          <div class="hr"></div>
          <button id="again" class="btn">Reiniciar</button>
        </div>`;
      $('#again').onclick = ()=> startQuizGeneric(pool);
    }

    draw();
  }

  function startQuiz(){
    if(!Array.isArray(Q) || Q.length===0){ showBanner('No hay preguntas. Revisa questions.json.'); return; }
    const topic = $('#topicSel').value;
    const diff = $('#diffSel').value;
    let pool = Q.slice();
    if(topic!=='all') pool = pool.filter(q=> q.topic===topic);
    if(diff!=='all')  pool = pool.filter(q=> q.difficulty===diff);
    pool = shuffle(pool).slice(0,12);
    startQuizGeneric(pool);
  }

  function startLesson10(){
    if(!Array.isArray(Q) || Q.length===0){ showBanner('No hay preguntas. Revisa questions.json.'); return; }
    // selecciona 10 conceptos al azar (puedes cambiar a por-tópico si quieres)
    const pool = shuffle(Q.slice()).slice(0,10);
    startQuizGeneric(pool);
  }

  $('#startQuiz').addEventListener('click', ()=>{ tab('quiz'); startQuiz(); });
  $('#startLesson10').addEventListener('click', ()=>{ tab('quiz'); startLesson10(); });
}

window.addEventListener('load', ()=>{ init(); });



