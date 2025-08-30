const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));

const LSKEY = 'lpic_demo_state';
const state = JSON.parse(localStorage.getItem(LSKEY) || '{}');

// estado inicial
state.profile ||= { email: '' };
state.stats   ||= { goal: 75, streak: 0, lastDay: '', minutes: 0, xp: 0 };
state.srs     ||= {}; // id -> {box,nextDue}

function save(){ localStorage.setItem(LSKEY, JSON.stringify(state)); }
function today(){ return new Date().toISOString().slice(0,10); }

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
  if(confirm('¿Restablecer todo tu progreso? Esta acción no se puede deshacer.')){
    localStorage.removeItem(LSKEY);
    location.reload();
  }
}

function tab(id){
  $$('.tab').forEach(t=>t.classList.toggle('active', t.dataset.id===id));
  $$('.view').forEach(v=>v.style.display = (v.id===id? 'block':'none'));
}

async function loadQ(){ const r = await fetch('./questions.json'); return r.json(); }
function shuffle(a){ return a.map(v=>[Math.random(),v]).sort((x,y)=>x[0]-y[0]).map(v=>v[1]) }
function normalize(s){ return (s??'').toString().trim().toLowerCase().replace(/\s+/g,' ') }
function isCorrect(q, ua){
  if(q.type==='mcq') return q.answer.includes(ua);
  if(q.type==='fitb') return q.answer.some(a=> normalize(a)===normalize(ua));
  return false;
}

async function init(){
  renderHeader();

  // Tabs
  $$('.tab').forEach(t=>t.addEventListener('click', ()=>tab(t.dataset.id)));
  tab('plan');

  // Perfil & meta
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
  const BOX = {1:0,2:1,3:3,4:7,5:14};
  function ensureCard(id){ if(!state.srs[id]) state.srs[id] = {box:1,nextDue:0}; return state.srs[id]; }
  function nextDue(box){ return Date.now() + (BOX[box]||0)*24*60*60*1000; }
  function reviewCard(id, ok){
    const c = ensureCard(id);
    c.box = ok ? Math.min(5, c.box+1) : 1;
    c.nextDue = nextDue(c.box);
    save();
  }
  function dueCards(){
    const now = Date.now();
    return Q.filter(q=> (ensureCard(q.id).nextDue||0) <= now );
  }
  function renderSRS(){
    const due = dueCards();
    $('#dueCount').textContent = due.length;
    const box = $('#srsBox'); box.innerHTML='';
    if(!due.length){ box.innerHTML='<div class="panel">¡Nada pendiente ahora! Haz un Quiz para añadir tarjetas.</div>'; return; }
    const q = due[0]; const prompt = (q.variants && Math.random()<0.5)? q.variants[0] : q.prompt;
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
    $('#srsOK').onclick = ()=>{ reviewCard(q.id, true); renderSRS(); };
    $('#srsKO').onclick = ()=>{ reviewCard(q.id, false); renderSRS(); };
  }
  renderSRS();
  $('#refreshSRS').addEventListener('click', renderSRS);

  // ------- Quiz -------
  function startQuiz(){
    const topic = $('#topicSel').value;
    const diff = $('#diffSel').value;
    let pool = Q.slice();
    if(topic!=='all') pool = pool.filter(q=> q.topic===topic);
    if(diff!=='all') pool = pool.filter(q=> q.difficulty===diff);
    pool = shuffle(pool).slice(0,12);

    const panel = $('#quizPanel'); panel.innerHTML='';
    let idx=0, answers={}, feedback=null;

    function draw(){
      const q = pool[idx]; feedback=null;
      const prompt = (q.variants && Math.random()<0.5)? q.variants[0]: q.prompt;

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

      if(q.type==='mcq'){
        $('#qArea').innerHTML = q.options.map((o,i)=>`<button class="opt" data-i="${i}">${o}</button>`).join('');
        $$('#qArea .opt').forEach(b=> b.onclick = ()=>{
          const i = parseInt(b.dataset.i);
          answers[q.id]=i;
          const ok = isCorrect(q,i);
          $$('#qArea .opt').forEach(x=>x.classList.remove('sel','right','wrong'));
          b.classList.add('sel', ok?'right':'wrong');
          const ansText = q.options.filter((_,k)=>q.answer.includes(k)).join(' | ');
          $('#qFeedback').innerHTML = `<div class="feedback ${ok?'ok':'ko'}">${ok?'✅ Correcto':'❌ Incorrecto'} — <b>Respuesta:</b> ${ansText}${q.explanation? ' — '+q.explanation:''}</div>`;
        });
      }else{
        $('#qArea').innerHTML = '<input class="input" id="ua" placeholder="Respuesta…">';
        $('#ua').onchange = (e)=>{
          const v = e.target.value;
          answers[q.id]=v;
          const ok = isCorrect(q,v);
          const ansText = q.answer[0];
          $('#qFeedback').innerHTML = `<div class="feedback ${ok?'ok':'ko'}">${ok?'✅ Correcto':'❌ Incorrecto'} — <b>Respuesta:</b> ${ansText}${q.explanation? ' — '+q.explanation:''}</div>`;
        };
      }

      $('#prevQ').onclick = ()=>{ idx = Math.max(0, idx-1); draw(); };
      $('#nextQ').onclick = ()=>{ if(idx===pool.length-1) finish(); else { idx++; draw(); } };
    }

    function finish(){
      let correct=0, made=0;
      pool.forEach(q=>{
        const ua = answers[q.id];
        if(ua!==undefined && ua!==null && ua!==''){ made++; if(isCorrect(q,ua)) correct++; }
        if(ua!==undefined) { state.srs[q.id] ||= {box:1,nextDue:0}; }
      });
      save();
      panel.innerHTML = `<div class="panel"><h3>Resultado</h3><div class="row"><div class="badge">Correctas: ${correct}/${made}</div><div class="badge">Preguntas: ${pool.length}</div></div><div class="hr"></div><button id="again" class="btn">Reiniciar</button></div>`;
      $('#again').onclick = startQuiz;
      renderSRS();
    }

    draw();
  }

  $('#startQuiz').addEventListener('click', startQuiz);
}

window.addEventListener('load', ()=>{ init(); });

