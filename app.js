import { DB } from './db.js';
import { parseLocalFile } from './local-parser.js';

const $ = sel => document.querySelector(sel);
const esc = x => String(x ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const now = () => new Date().toISOString();
const hoursSince = date => date ? (Date.now()-new Date(date).getTime())/3600000 : 9999;
const prettyDate = iso => iso ? new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'short',year:'numeric'}).format(new Date(iso)) : 'Não verificada';
const uid = () => crypto.randomUUID?.() || `n_${Date.now()}_${Math.random().toString(36).slice(2)}`;
const MAX_UPLOAD = 20 * 1024 * 1024;
const preset = [
  {kind:'lei',number:'6019',year:'1974',title:'Lei 6.019/1974 · Terceirização'},
  {kind:'complementar',number:'150',year:'2015',title:'LC 150/2015 · Doméstico'},
  {kind:'lei',number:'8112',year:'1990',title:'Lei 8.112/1990 · Servidor federal'}
];
const state = {
  laws:[],notes:[],current:null, lawSearch:'', filter:'', limit:35,
  allNotes:false, draft:null, draftFiles:[], selected:null,
  refreshing:new Map(), recorder:null, recordStream:null,
  fileUrls:[], notesOpen:window.innerWidth>1220
};
let noticeTimer, deferredInstallPrompt;
const toast = (message, time=4200) => { const box=$('#toast'); box.textContent=message;box.hidden=false;clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>box.hidden=true,time); };
function showErr(id, msg){ const el=$(id);el.textContent=msg;el.hidden=false; }
function clearErr(id){ $(id).hidden=true;$(id).textContent=''; }
function modal(id){ const d=$('#'+id); if (!d.open) d.showModal(); }
function closeModal(id){ const d=$('#'+id); if(d.open)d.close(); }
function currentLaw(){ return state.laws.find(l=>l.id===state.current); }
function notesForLaw(lawId){return state.notes.filter(n=>n.lawId===lawId);}
function articleName(law, articleId){const art=law?.articles?.find(a=>a.id===articleId);return art ? `Art. ${art.number}`:articleId;}
function abbrev(kind){return ({lei:'LEI',complementar:'LC',decretolei:'DL',constituicao:'CF',emenda:'EC'})[kind]||'§';}
function showSidebar(open){$('#sidebar').classList.toggle('open',open);$('#sidebarShade').hidden=!open;}
function showNotes(open){state.notesOpen=open;$('#notesRail').classList.toggle('open',open);$('#notesShade').hidden=!open || window.innerWidth>1220;}
function upsertLaw(law){const i=state.laws.findIndex(x=>x.id===law.id);if(i>=0)state.laws[i]=law;else state.laws.push(law);}
function upsertNote(note){const i=state.notes.findIndex(x=>x.id===note.id);if(i>=0)state.notes[i]=note;else state.notes.unshift(note);}
function renderSidebar(){
  const list=$('#lawList'); list.replaceChildren();
  $('#lawCount').textContent=state.laws.length;
  const laws=state.laws.filter(l=>`${l.title} ${l.year} ${l.number}`.toLowerCase().includes(state.filter.toLowerCase()));
  for(const law of laws){
    const btn=document.createElement('button');btn.type='button';btn.className=`law-entry${law.id===state.current?' active':''}`;
    btn.innerHTML=`<span class="law-symbol">${esc(abbrev(law.kind))}</span><span><div class="law-title">${esc(law.title)}</div><div class="law-meta">${esc(law.articles.length)} artigos · ${notesForLaw(law.id).length} notas</div></span>`;
    btn.addEventListener('click',()=>openLaw(law.id));list.append(btn);
  }
  $('#emptySide').hidden=!!laws.length;
  if(!laws.length)$('#emptySide').textContent=state.laws.length?'Nenhuma lei corresponde à busca.':'Suas leis aparecerão aqui.';
}
function home(){
  state.current=null;state.lawSearch='';state.allNotes=false;
  $('#breadcrumb').innerHTML='Minha biblioteca <b>/</b> Visão geral';
  const content=$('#content');
  const articles=state.laws.reduce((sum,l)=>sum+l.articles.length,0);
  content.innerHTML=`<section class="hero-panel"><div class="eyebrow">SEU ESPAÇO DE ESTUDO</div><h1 class="hero-title">O Direito na ponta<br>dos seus dedos.</h1><p class="lead">Sua própria biblioteca de legislação federal. Consulte textos oficiais, destaque o que importa e reúna suas anotações em um só lugar.</p><div class="hero-lines"><span class="mini-line"></span> Seu estudo, no seu ritmo</div></section>
  <section class="stats-row"><div class="stat-card"><div class="stat-number">${state.laws.length}</div><div class="stat-label">Leis na biblioteca</div></div><div class="stat-card"><div class="stat-number">${articles.toLocaleString('pt-BR')}</div><div class="stat-label">Artigos disponíveis</div></div><div class="stat-card"><div class="stat-number">${state.notes.length}</div><div class="stat-label">Anotações salvas</div></div></section>
  <section><div class="section-row"><h2>Minha legislação</h2><button class="text-link" type="button" data-action="add">＋ Adicionar legislação</button></div><div id="libraryCards"></div></section>
  <section class="section-row" style="margin-top:34px"><h2>Comece por uma dessas normas</h2></section><div class="suggestions" id="suggestions"></div>`;
  const container=$('#libraryCards');
  if(!state.laws.length){container.innerHTML=`<div class="onboarding"><div class="onboarding-symbol">§</div><h3>Sua biblioteca começa aqui</h3><p>Adicione sua primeira lei federal. A fonte oficial será consultada, e você poderá anotar cada dispositivo.</p><button class="btn btn-primary" type="button" data-action="add">＋ Adicionar primeira legislação</button></div>`;}
  else {
    container.className='library-grid';
    for(const law of state.laws){
      const el=document.createElement('button');el.type='button';el.className='library-card';
      el.innerHTML=`<div class="library-card-top"><div class="law-card-symbol">§</div><span class="small-chevron">↗</span></div><h3>${esc(law.title)}</h3><p>Fonte: ${esc(law.source||'Planalto')}</p><div class="library-card-footer">${law.articles.length} artigos · ${notesForLaw(law.id).length} notas</div>`;
      el.addEventListener('click',()=>openLaw(law.id));container.append(el);
    }
  }
  for(const p of preset){const button=document.createElement('button');button.className='suggestion';button.type='button';button.textContent=p.title;button.addEventListener('click',()=>{openAdd();$('#lawKind').value=p.kind;$('#lawNumber').value=p.number;$('#lawYear').value=p.year;});$('#suggestions').append(button);}
  renderSidebar();renderNotes();
}
async function checkLibraryOnOpen(){
  if(!navigator.onLine)return;
  const stale=state.laws.filter(l=>hoursSince(l.checkedAt)>24);
  for(const entry of stale){
    if(!navigator.onLine)break;
    await refreshLaw(entry,false);
  }
}
function openLaw(id){
  if(!state.laws.some(l=>l.id===id))return home();
  state.current=id;state.allNotes=false;state.lawSearch='';state.limit=35;
  renderLaw();renderSidebar();renderNotes();showSidebar(false);
  $('#content').scrollTop=0;
  const law=currentLaw();
  if(navigator.onLine && hoursSince(law.checkedAt)>24) refreshLaw(law,false);
}
function renderLaw(){
  const law=currentLaw();if(!law)return home();
  $('#breadcrumb').innerHTML=`Minha biblioteca <b>/</b> ${esc(law.title)}`;
  const relevant=law.articles.filter(a=>{
    const q=state.lawSearch.toLowerCase().trim();
    return !q || `art. ${a.number} ${a.units.map(u=>u.text).join(' ')}`.toLowerCase().includes(q);
  });
  const count=relevant.length;
  const area=$('#content');
  const officialLink=law.officialUrl?` <a href="${esc(law.officialUrl)}" target="_blank" rel="noopener noreferrer">Consultar legislação no Planalto ↗</a>`:'';
  const officialButton=law.officialUrl?'<button id="openOfficial" type="button">↗ &nbsp; Ver original no Planalto</button>':'';
  area.innerHTML=`<div class="law-header"><div class="law-overline">◈ &nbsp; LEGISLAÇÃO FEDERAL &nbsp; • &nbsp; FONTE: ${esc(law.source||'PLANALTO').toUpperCase()}</div><h1>${esc(law.title)}</h1><p class="law-description">${law.articles.length} artigos extraídos · Última conferência: ${prettyDate(law.checkedAt)}</p><div class="law-actions"><button class="primary-action" id="checkUpdate" type="button">↻ &nbsp; Verificar alterações</button>${officialButton}<button id="removeLaw" type="button">▢ &nbsp; Remover da biblioteca</button></div></div>
  <div class="source-warning">⚑ &nbsp; ${esc(law.warning||'O texto foi extraído automaticamente e não substitui a publicação oficial.')} <strong>Confirme na fonte oficial</strong> as redações, exclusões, revogações e notas editoriais.${officialLink}</div>
  ${law.changes?.length?`<div class="changes-panel"><strong>⚠ Alterações encontradas na última verificação</strong>${law.changes.slice(0,12).map(c=>`<div>${esc(c.label)}: ${esc(c.type)}</div>`).join('')}${law.changes.length>12?`<div>... e mais ${law.changes.length-12} artigos.</div>`:''}<div>As anotações anteriores foram preservadas. Revise trechos sinalizados.</div></div>`:''}
  <div class="section-row"><h2>Artigos e dispositivos</h2><span class="result-info">${count} resultado(s)</span></div><div class="search-tools"><label class="search-box-main"><span>⌕</span><input type="search" id="lawSearch" placeholder="Buscar artigo, expressão ou palavra-chave..." value="${esc(state.lawSearch)}" aria-label="Pesquisar artigos"></label><input class="article-jump" type="search" id="articleJump" placeholder="Ir para art. nº" aria-label="Ir para artigo"></div>
  <div class="result-info">Para destacar, <strong>selecione um trecho</strong> do texto. Para anotar o dispositivo inteiro, use o símbolo ＋ ao lado dele.</div><div id="articles" class="articles"></div><div id="loadMoreHolder"></div>`;
  const articles=$('#articles');
  if(!count)articles.innerHTML='<div class="empty-results">Nenhum artigo corresponde à sua busca.</div>';
  else relevant.slice(0,state.limit).forEach(a=>articles.append(articleElement(law,a)));
  if(count>state.limit){
    const btn=document.createElement('button');btn.type='button';btn.className='load-more';btn.textContent=`Carregar mais artigos (${count-state.limit} restantes)`;btn.addEventListener('click',()=>{state.limit+=35;const pos=$('#content').scrollTop;renderLaw();$('#content').scrollTop=pos;});$('#loadMoreHolder').append(btn);
  }
  $('#lawSearch').addEventListener('input',ev=>{const val=ev.target.value;const caret=ev.target.selectionStart;state.lawSearch=val;state.limit=35;const scroll=$('#content').scrollTop;renderLaw();$('#content').scrollTop=scroll;$('#lawSearch').focus();try{$('#lawSearch').setSelectionRange(caret,caret);}catch{}});
  $('#articleJump').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();jumpToArticle(e.currentTarget.value);}});
  $('#checkUpdate').addEventListener('click',()=>refreshLaw(law,true));
  if(law.officialUrl)$('#openOfficial').addEventListener('click',()=>window.open(law.officialUrl,'_blank','noopener,noreferrer'));
  $('#removeLaw').addEventListener('click',()=>removeLaw(law));
}
function articleElement(law,article){
  const card=document.createElement('article');card.className='article-card';card.id=`article-${article.id}`;
  const related=state.notes.filter(n=>n.lawId===law.id&&n.articleId===article.id);
  if(related.length)card.classList.add('has-note');
  const header=document.createElement('div');header.className='article-head';
  const name=document.createElement('span');name.className='article-title';name.textContent=`Art. ${article.number}`;
  const right=document.createElement('div');right.className='article-head-right';
  if(related.length){const counter=document.createElement('span');counter.className='article-note-btn';counter.textContent=`${related.length} nota(s)`;right.append(counter);}
  const add=document.createElement('button');add.type='button';add.className='article-note-btn';add.textContent='＋ Anotar';add.title='Criar anotação no caput';add.addEventListener('click',()=>openNote({lawId:law.id,articleId:article.id,unitId:'caput'}));right.append(add);
  header.append(name,right);card.append(header);
  for(const unit of article.units){
    const wrapper=document.createElement('div');wrapper.className='unit';wrapper.dataset.unitId=unit.id;wrapper.dataset.articleId=article.id;
    const label=document.createElement('div');label.className='unit-label';label.textContent=unit.label;wrapper.append(label);
    const line=document.createElement('div');line.className='unit-line';
    const span=document.createElement('div');span.className='unit-text';span.dataset.lawId=law.id;span.dataset.unitId=unit.id;span.dataset.articleId=article.id;
    const relatedUnit=related.filter(n=>n.unitId===unit.id);
    fillUnit(span,unit.text,relatedUnit);
    const btn=document.createElement('button');btn.className='unit-note-btn';btn.type='button';btn.title=`Anotar ${unit.label}`;btn.setAttribute('aria-label',`Anotar ${unit.label}`);btn.textContent='＋';btn.addEventListener('click',()=>openNote({lawId:law.id,articleId:article.id,unitId:unit.id}));
    line.append(span,btn);wrapper.append(line);
    if(relatedUnit.some(n=>n.stale)){const w=document.createElement('span');w.className='orphan-alert';w.textContent='⚠ Anotação anterior à alteração: conferir';wrapper.append(w);}
    card.append(wrapper);
  }
  return card;
}
function fillUnit(element,text,notes){
  const selections=notes.filter(n=>n.quote && Number.isInteger(n.start)&&Number.isInteger(n.end)&&n.end>n.start&&n.start>=0&&n.end<=text.length&&text.slice(n.start,n.end)===n.quote);
  if(!selections.length){element.textContent=text;return;}
  const positions=new Set([0,text.length]);for(const n of selections){positions.add(n.start);positions.add(n.end);}
  const sorted=[...positions].sort((a,b)=>a-b);
  for(let i=0;i<sorted.length-1;i++){
    const begin=sorted[i],end=sorted[i+1],chunk=text.slice(begin,end);
    const active=selections.filter(n=>n.start<=begin&&n.end>=end).at(-1);
    const el=document.createElement(active?'mark':'span');
    if(active){el.className=`text-mark mark-${['yellow','green','pink','blue'].includes(active.color)?active.color:'yellow'}`;el.title=active.text?active.text.slice(0,90):'Trecho marcado';}
    el.textContent=chunk;element.append(el);
  }
}
function jumpToArticle(text){
  const law=currentLaw();if(!law)return;
  const id=String(text).replace(/[^0-9a-z-]/gi,'').toLowerCase();
  const a=law.articles.find(x=>x.number.toLowerCase().replace(/[^0-9a-z-]/g,'')===id);
  if(!a){toast('Artigo não encontrado nessa lei.');return;}
  state.lawSearch='';state.limit=Math.max(35,law.articles.findIndex(x=>x.id===a.id)+1);renderLaw();
  $('#article-'+CSS.escape(a.id))?.scrollIntoView({behavior:'smooth',block:'start'});
}
function renderNotes(){
  const visible = state.allNotes || !state.current ? [...state.notes] : notesForLaw(state.current);
  visible.sort((a,b)=>new Date(b.updatedAt)-new Date(a.updatedAt));
  $('#notesSubtitle').textContent=state.allNotes?'Todas as anotações da biblioteca':state.current?'Notas relacionadas à legislação aberta':'Suas marcações e comentários pessoais';
  const list=$('#notesList');list.replaceChildren();
  if(!visible.length){list.innerHTML='<div class="rail-empty"><span class="rail-empty-symbol">✎</span><b>Seu caderno está em branco</b><span>Selecione um trecho da lei ou toque em “Anotar” ao lado do dispositivo.</span></div>';return;}
  for(const n of visible){
    const law=state.laws.find(l=>l.id===n.lawId);const btn=document.createElement('button');btn.type='button';btn.className='note-card';
    const color=['yellow','green','pink','blue'].includes(n.color)?n.color:'yellow';
    btn.innerHTML=`<div class="note-top"><span>${esc(articleName(law,n.articleId))} · ${esc(law?.title||'Lei removida')}</span><span class="note-age">${prettyDate(n.updatedAt)}</span></div>${n.quote?`<div class="note-quote" style="border-color:var(--color-${color},#d9c483)">${esc(n.quote)}</div>`:''}${n.text?`<div class="note-text">${esc(n.text)}</div>`:''}${n.attachments?.length?`<div class="note-attachments">▧ ${n.attachments.length} arquivo(s) anexo(s)</div>`:''}${n.stale?'<span class="orphan-alert">⚠ Conferir após alteração</span>':''}`;
    btn.addEventListener('click',()=>openNote({note:n}));list.append(btn);
  }
}
function openAdd(){
  $('#addLawForm').reset();$('#lawKind').value='lei';$('#lawNumber').disabled=false;$('#lawYear').disabled=false;$('#localLawFileName').textContent='';clearErr('#lawError');modal('lawDialog');
}
function toggleConstitution(){const is=$('#lawKind').value==='constituicao';$('#lawNumber').disabled=is;$('#lawNumber').required=!is;$('#lawYear').disabled=is;$('#lawYear').required=!is;if(is){$('#lawNumber').value='1988';$('#lawYear').value='1988';}else if($('#lawNumber').value==='1988'&&$('#lawYear').value==='1988'){$('#lawNumber').value='';$('#lawYear').value='';}}
function queryParams({kind,number,year,url}){
  const query=new URLSearchParams();query.set('kind',kind);query.set('number',String(number||''));if(year)query.set('year',String(year));if(url)query.set('url',String(url));return query;
}
const IMPORT_MISSING='O serviço de busca automática não está publicado ou não responde corretamente neste Netlify. É necessário publicar as Functions por GitHub ou Netlify CLI (consulte o LEIA-ME do pacote). Até lá, você pode importar um HTML salvo do Planalto pela opção abaixo.';
async function readApi(path,controller){
  let res;
  try {res=await fetch(path,{signal:controller.signal,cache:'no-store'});}
  catch(e){if(e.name==='AbortError')throw Error('A consulta excedeu o tempo máximo. Tente novamente ou importe o arquivo HTML manualmente.');throw Error('Falha de rede na consulta ao servidor: '+e.message);}
  const type=res.headers.get('content-type')||'';
  if(!type.toLowerCase().includes('application/json')){
    const e=new Error((res.status===404||(res.status===200&&type.toLowerCase().includes('text/html')))?IMPORT_MISSING:`Servidor retornou HTTP ${res.status}, com resposta não-JSON. Verifique as Functions e os logs do deploy no Netlify.`);
    e.noFunction=res.status===404||(res.status===200&&type.toLowerCase().includes('text/html'));throw e;
  }
  const json=await res.json().catch(()=>{throw Error('O servidor respondeu com JSON inválido. Consulte os logs da função legislation.');});
  if(!res.ok)throw Error(`${json.error||`Falha HTTP ${res.status}`}${json.hint?'\n'+json.hint:''}`);
  return json;
}
async function fetchLegislation(data){
  const controller=new AbortController(),stop=setTimeout(()=>controller.abort(),55000);
  try{
    // Permite funcionamento quando a função foi implantada mas o redirecionamento do netlify.toml não.
    let json;
    try {json=await readApi(`/api/legislacao?${queryParams(data)}`,controller);}
    catch(error){if(!error.noFunction)throw error;json=await readApi(`/.netlify/functions/legislation?${queryParams(data)}`,controller);}
    if(!Array.isArray(json.articles)||!json.articles.length)throw Error('Nenhum artigo válido recebido da fonte.');
    return json;
  }finally{clearTimeout(stop);}
}
async function testImportServer(){
  clearErr('#lawError');const btn=$('#testImportServer');btn.disabled=true;btn.textContent='⚙ Testando serviço...';
  try{
    const data=await fetchLegislation({kind:'lei',number:'6019',year:'1974'});
    toast(`Serviço disponível: ${data.articles.length} artigo(s) de teste recebidos.`,5500);
  }catch(e){showErr('#lawError',`Diagnóstico: ${e.message}`);}
  finally{btn.disabled=false;btn.textContent='⚙ Verificar serviço de importação';}
}
async function addSavedHtml(evt){
  const input=evt.currentTarget;const file=input.files?.[0];if(!file)return;
  clearErr('#lawError');$('#localLawFileName').textContent=`Arquivo: ${file.name}`;
  const kind=$('#lawKind').value;
  const number=kind==='constituicao'?'1988':$('#lawNumber').value.replaceAll('.','').trim();
  const year=kind==='constituicao'?'1988':$('#lawYear').value.trim();
  const officialUrl=$('#lawUrl').value.trim();
  try{
    if(!/^\d{1,6}$/.test(number)||!/^\d{4}$/.test(year))throw Error('Primeiro preencha tipo, número e ano da norma, depois selecione o arquivo HTML.');
    if(officialUrl&&!/^https:\/\/(?:www\.)?planalto\.gov\.br\//i.test(officialUrl))throw Error('Quando informada, a URL deve ser HTTPS do Planalto.');
    const parsed=await parseLocalFile(file);
    const parts=({lei:'Lei',complementar:'Lei Complementar',decretolei:'Decreto-Lei',constituicao:'Constituição Federal',emenda:'Emenda Constitucional'});
    const id=`${kind}:${kind==='constituicao'?'1988':Number(number)}:${year}`;
    if(state.laws.some(l=>l.id===id))throw Error('Essa norma já está na biblioteca. Para evitar substituir suas anotações, primeiro faça um backup e use a verificação de atualizações.');
    const fingerprint=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(parsed.articles.map(a=>[a.id,a.units.map(u=>[u.id,u.text])]))));
    const fingerprintText=[...new Uint8Array(fingerprint)].map(b=>b.toString(16).padStart(2,'0')).join('');
    const title=kind==='constituicao'?'Constituição Federal de 1988':`${parts[kind]} nº ${Number(number).toLocaleString('pt-BR')}/${year}`;
    const law={id,kind,number,year,title,source:'Arquivo HTML local (não verificado)',officialUrl,checkedAt:null,addedAt:now(),changes:[],articles:parsed.articles,fingerprint:fingerprintText,warning:'Importado de cópia local. Não foi possível confirmar autenticidade, vigência ou atualização. Confira sempre o Planalto.'};
    await DB.put('laws',law);upsertLaw(law);closeModal('lawDialog');openLaw(id);
    toast(`${title} importada de arquivo HTML (${parsed.articles.length} artigos). Fonte e vigência não verificadas.`,7500);
  }catch(error){showErr('#lawError',error.message);}finally{input.value='';}
}
async function addLaw(e){
  e.preventDefault();clearErr('#lawError');
  const kind=$('#lawKind').value,number=$('#lawNumber').value.replaceAll('.','').trim(),year=$('#lawYear').value.trim(),url=$('#lawUrl').value.trim();
  const btn=$('#importLawBtn');btn.disabled=true;btn.textContent='Consultando a fonte oficial...';
  try{
    const data=await fetchLegislation({kind,number,year,url});
    if(state.laws.some(l=>l.id===data.id)){
      closeModal('lawDialog');openLaw(data.id);toast('Essa legislação já está na biblioteca. Você pode verificar atualizações.');return;
    }
    const law={...data,addedAt:now(),changes:[]};
    await DB.put('laws',law);upsertLaw(law);closeModal('lawDialog');openLaw(law.id);toast(`${law.title} adicionada com ${law.articles.length} artigos.`);
  }catch(error){showErr('#lawError',error.message);}
  finally{btn.disabled=false;btn.innerHTML='Buscar e adicionar <span>→</span>';}
}
function compareLaws(oldLaw,newLaw){
  const oldMap=new Map(oldLaw.articles.map(a=>[a.id,a]));
  const newMap=new Map(newLaw.articles.map(a=>[a.id,a]));
  const changes=[];
  for(const a of newLaw.articles){
    const prior=oldMap.get(a.id);
    if(!prior)changes.push({articleId:a.id,label:`Art. ${a.number}`,type:'Adicionado'});
    else if(JSON.stringify(prior.units)!==JSON.stringify(a.units))changes.push({articleId:a.id,label:`Art. ${a.number}`,type:'Redação ou estrutura modificada'});
  }
  for(const a of oldLaw.articles)if(!newMap.has(a.id))changes.push({articleId:a.id,label:`Art. ${a.number}`,type:'Não encontrado na versão atual'});
  return changes;
}
async function refreshLaw(law,manual){
  if(state.refreshing.has(law.id))return state.refreshing.get(law.id);
  const promise=(async()=>{
    const button=manual?$('#checkUpdate'):null;
    if(button){button.disabled=true;button.textContent='↻ Verificando...';}
    try{
      const data=await fetchLegislation({kind:law.kind,number:law.number,year:law.year,url:law.officialUrl});
      const latest=state.laws.find(l=>l.id===law.id);
      if(!latest)return;
      const changed=data.fingerprint!==latest.fingerprint;
      const changes=changed?compareLaws(latest,data):[];
      const updated={...latest,...data,addedAt:latest.addedAt,changes:changed?changes:latest.changes||[]};
      if(changed){
        for(const note of notesForLaw(law.id)){
          if(!changes.some(c=>c.articleId===note.articleId))continue;
          const article=updated.articles.find(a=>a.id===note.articleId);
          const unit=article?.units.find(u=>u.id===note.unitId);
          // Any note on a changed article merits human review, even when a quote is still present.
          const review={...note,stale:true};
          if(unit&&note.quote){
            const loc=unit.text.indexOf(note.quote);
            if(loc>=0){review.start=loc;review.end=loc+note.quote.length;}
          }
          await DB.put('notes',review);upsertNote(review);
        }
      }
      await DB.put('laws',updated);upsertLaw(updated);
      if(state.current===law.id){renderLaw();renderNotes();renderSidebar();}
      if(manual||changed) toast(changed?`${changes.length} artigo(s) com mudança detectada. Confira na fonte oficial.`:'Conferência concluída: nenhuma diferença encontrada.');
    }catch(error){
      if(manual)toast(`Não foi possível verificar: ${error.message}`,6500);
      else toast('Não foi possível verificar atualizações. Última versão salva mantida.',5000);
    }finally{if(button){button.disabled=false;button.textContent='↻ Verificar alterações';}}
  })();
  state.refreshing.set(law.id,promise);
  try{await promise;}finally{state.refreshing.delete(law.id);}
}
async function removeLaw(law){
  if(!confirm(`Remover ${law.title} da biblioteca? Suas anotações e anexos vinculados também serão excluídos. Faça backup antes, se necessário.`))return;
  for(const n of notesForLaw(law.id)){
    for(const id of n.attachments||[])await DB.del('files',id);
    await DB.del('notes',n.id);
  }
  await DB.del('laws',law.id);
  state.notes=state.notes.filter(n=>n.lawId!==law.id);
  state.laws=state.laws.filter(l=>l.id!==law.id);
  home();toast('Legislação removida deste dispositivo.');
}
function clearDraftUrls(){for(const u of state.fileUrls)URL.revokeObjectURL(u);state.fileUrls=[];}
async function openNote({lawId,articleId,unitId,note,quote,start,end}={}){
  clearErr('#noteError');clearDraftUrls();
  const n=note || null;
  state.draft=n?{...n}:{id:uid(),lawId,articleId,unitId,quote:quote||'',start:Number.isInteger(start)?start:null,end:Number.isInteger(end)?end:null,color:'yellow',text:'',attachments:[],createdAt:now(),stale:false};
  state.draftFiles=[];
  const law=state.laws.find(l=>l.id===state.draft.lawId);
  $('#noteModalTitle').textContent=n?'Editar anotação':state.draft.quote?'Marcar e anotar trecho':'Anotar dispositivo';
  $('#noteTarget').textContent=`${law?.title||'Legislação'} · ${articleName(law,state.draft.articleId)} · ${state.draft.unitId==='caput'?'Caput':state.draft.unitId}`;
  $('#noteBody').value=state.draft.text||'';
  const color=$(`#colorChoices input[value="${state.draft.color}"]`);if(color)color.checked=true;
  $('#quotePreview').hidden=!state.draft.quote;$('#quotePreview').textContent=state.draft.quote?`“${state.draft.quote}”`:'';
  $('#deleteNote').hidden=!n;
  $('#recordBtn').textContent='◉ Gravar áudio';$('#recordBtn').classList.remove('recording');
  await displayPendingFiles();modal('noteDialog');
}
async function displayPendingFiles(){
  const container=$('#pendingFiles');container.replaceChildren();clearDraftUrls();
  const ids=state.draft?.attachments||[];
  for(const id of ids){
    const item=await DB.get('files',id);
    if(item)container.append(fileRow(item,false));
  }
  for(const item of state.draftFiles)container.append(fileRow(item,true));
}
function fileRow(file,pending){
  const row=document.createElement('div');row.className='pending-item';
  const icon=document.createElement('span');icon.textContent=`${file.type.startsWith('audio/')?'♫':'▧'} ${file.name} (${Math.round(file.blob.size/1024)} KB)`;row.append(icon);
  if(file.blob.type.startsWith('image/')||file.blob.type.startsWith('audio/')){
    const u=URL.createObjectURL(file.blob);state.fileUrls.push(u);
    const player=file.blob.type.startsWith('audio/')?document.createElement('audio'):document.createElement('img');
    if(player.tagName==='AUDIO')player.controls=true;player.src=u;row.append(player);
  }
  const del=document.createElement('button');del.type='button';del.textContent='✕';del.setAttribute('aria-label','Remover anexo');
  del.addEventListener('click',async()=>{
    if(pending)state.draftFiles=state.draftFiles.filter(f=>f.id!==file.id);
    else state.draft.attachments=state.draft.attachments.filter(id=>id!==file.id);
    await displayPendingFiles();
  });row.append(del);return row;
}
function receiveFiles(files){
  let rejected=0;
  for(const file of files){
    if(!file.type.startsWith('image/')&&!file.type.startsWith('audio/')){rejected++;continue;}
    if(file.size>MAX_UPLOAD){rejected++;continue;}
    state.draftFiles.push({id:uid(),name:file.name,type:file.type,blob:file});
  }
  if(rejected)showErr('#noteError',`${rejected} arquivo(s) ignorado(s). Use imagens ou áudios de até 20 MB cada.`);
  displayPendingFiles();
}
async function toggleRecording(){
  const button=$('#recordBtn');
  if(state.recorder?.state==='recording'){
    state.recorder.stop();button.disabled=true;return;
  }
  if(!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==='undefined'){showErr('#noteError','Gravação não suportada neste navegador. Você ainda pode anexar um arquivo de áudio.');return;}
  try{
    const stream=await navigator.mediaDevices.getUserMedia({audio:true});state.recordStream=stream;
    const prefer=['audio/webm;codecs=opus','audio/mp4','audio/webm'].find(x=>MediaRecorder.isTypeSupported(x));
    const rec=new MediaRecorder(stream,prefer?{mimeType:prefer}:{});state.recorder=rec;
    const chunks=[];rec.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
    rec.onstop=()=>{
      stream.getTracks().forEach(t=>t.stop());state.recordStream=null;state.recorder=null;button.disabled=false;button.classList.remove('recording');button.textContent='◉ Gravar áudio';
      const blob=new Blob(chunks,{type:rec.mimeType||'audio/webm'});
      if(blob.size && blob.size<=MAX_UPLOAD){const ext=blob.type.includes('mp4')?'m4a':'webm';receiveFiles([new File([blob],`Gravação ${new Date().toLocaleTimeString('pt-BR').replaceAll(':','-')}.${ext}`,{type:blob.type})]);}
      else if(blob.size)showErr('#noteError','A gravação ultrapassou o limite de 20 MB.');
    };
    rec.start();button.classList.add('recording');button.textContent='■ Parar gravação';
  }catch(error){showErr('#noteError','Não foi possível acessar o microfone. Autorize a permissão no navegador.');}
}
async function saveNote(e){
  e.preventDefault();clearErr('#noteError');
  if(state.recorder?.state==='recording'){showErr('#noteError','Encerre a gravação antes de salvar.');return;}
  const note={...state.draft,text:$('#noteBody').value.trim(),color:$('#colorChoices input:checked')?.value||'yellow',updatedAt:now()};
  if(!note.quote&&!note.text&&!note.attachments.length&&!state.draftFiles.length){showErr('#noteError','Escreva uma anotação, selecione um trecho ou anexe um arquivo.');return;}
  try{
    const old=state.notes.find(n=>n.id===note.id);
    const removed=(old?.attachments||[]).filter(id=>!note.attachments.includes(id));
    for(const item of state.draftFiles){await DB.put('files',item);note.attachments.push(item.id);}
    await DB.put('notes',note);
    for(const id of removed)await DB.del('files',id);
    upsertNote(note);closeModal('noteDialog');clearDraftUrls();
    if(state.current===note.lawId)renderLaw();renderNotes();renderSidebar();
    toast('Anotação salva neste navegador.');
  }catch(error){showErr('#noteError','Não foi possível salvar. Verifique o espaço de armazenamento do navegador. '+error.message);}
}
async function deleteNote(){const note=state.draft;if(!state.notes.some(n=>n.id===note.id))return;if(!confirm('Excluir esta anotação e os anexos associados?'))return;for(const id of note.attachments)await DB.del('files',id);await DB.del('notes',note.id);state.notes=state.notes.filter(n=>n.id!==note.id);closeModal('noteDialog');clearDraftUrls();if(state.current===note.lawId)renderLaw();renderNotes();renderSidebar();toast('Anotação excluída.');}
function selectionToolbar(){
  const box=document.createElement('button');box.type='button';box.id='selectionToolbar';box.textContent='✎ Marcar / anotar trecho';
  box.style.cssText='position:fixed;z-index:25;background:#1f4248;color:white;border:1px solid #376c6d;border-radius:9px;padding:11px 14px;box-shadow:0 8px 28px #17313b40;font-size:12px;font-weight:700;display:none;max-width:230px';
  document.body.append(box);
  document.addEventListener('selectionchange',()=>{requestAnimationFrame(updateSelection)});
  box.addEventListener('pointerdown',e=>e.preventDefault());
  box.addEventListener('click',()=>{if(state.selected){const target=state.selected;box.style.display='none';window.getSelection()?.removeAllRanges();openNote(target);}});
}
function updateSelection(){
  const box=$('#selectionToolbar');
  if($('#noteDialog').open||$('#lawDialog').open||!state.current){box.style.display='none';return;}
  const sel=window.getSelection();
  if(!sel||sel.isCollapsed||!sel.rangeCount||!sel.toString().trim()){box.style.display='none';return;}
  const range=sel.getRangeAt(0);
  const root=range.startContainer.nodeType===1?range.startContainer:range.startContainer.parentElement;
  const dest=root?.closest('.unit-text');
  if(!dest||!dest.contains(range.endContainer)||!dest.dataset.lawId||dest.dataset.lawId!==state.current){box.style.display='none';return;}
  const before=document.createRange();before.selectNodeContents(dest);before.setEnd(range.startContainer,range.startOffset);
  const start=before.toString().length;const end=start+sel.toString().length;
  const law=currentLaw();const article=law?.articles.find(a=>a.id===dest.dataset.articleId);const unit=article?.units.find(u=>u.id===dest.dataset.unitId);
  if(!unit||unit.text.slice(start,end)!==sel.toString()||end-start>3000){box.style.display='none';return;}
  state.selected={lawId:state.current,articleId:article.id,unitId:unit.id,quote:sel.toString(),start,end};
  const rect=range.getBoundingClientRect();
  box.style.top=`${Math.max(8,Math.min(window.innerHeight-55,rect.top-51))}px`;
  box.style.left=`${Math.max(8,Math.min(window.innerWidth-240,rect.left+rect.width/2-105))}px`;
  box.style.display='block';
}
async function exportBackup(){
  try{
    toast('Preparando arquivo de backup...');
    const files=await DB.all('files');
    const serialized=await Promise.all(files.map(async file => ({id:file.id,name:file.name,type:file.type,data:await blobAsData(file.blob)})));
    const data={format:'meu-vade-mecum-backup',version:1,date:now(),laws:state.laws,notes:state.notes,files:serialized};
    const blob=new Blob([JSON.stringify(data)],{type:'application/json'});const url=URL.createObjectURL(blob);
    const a=document.createElement('a');a.href=url;a.download=`backup-vade-mecum-${new Date().toISOString().slice(0,10)}.json`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),15000);
    toast('Backup gerado. Guarde-o em local seguro.');
  }catch(error){toast('Falha ao gerar o backup: '+error.message,6000);}
}
function blobAsData(blob){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(blob);});}
function dataAsBlob(data){const [header,raw]=String(data).split(',');const mime=(header.match(/^data:([^;]+)/)||[])[1]||'application/octet-stream';const binary=atob(raw);const bytes=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);return new Blob([bytes],{type:mime});}
async function importBackup(event){
  const file=event.target.files?.[0];event.target.value='';if(!file)return;
  if(file.size>90*1024*1024){toast('Backup muito grande para importar pelo navegador.');return;}
  try{
    const data=JSON.parse(await file.text());
    if(data.format!=='meu-vade-mecum-backup'||data.version!==1||!Array.isArray(data.laws)||!Array.isArray(data.notes)||!Array.isArray(data.files))throw Error('Formato de backup não reconhecido.');
    if(!confirm(`Importar ${data.laws.length} lei(s) e ${data.notes.length} anotação(ões)? Registros com os mesmos identificadores serão substituídos.`))return;
    for(const law of data.laws){if(!law.id||!Array.isArray(law.articles))continue;await DB.put('laws',law);}
    for(const note of data.notes){if(!note.id||!note.lawId)continue;await DB.put('notes',note);}
    for(const f of data.files){if(!f.id||!f.data||!f.name)continue;await DB.put('files',{id:f.id,name:f.name,type:f.type||'',blob:dataAsBlob(f.data)});}
    state.laws=await DB.all('laws');state.notes=await DB.all('notes');home();toast('Backup importado com sucesso.');
  }catch(error){toast('Não foi possível importar o backup: '+error.message,6500);}
}
function wire(){
  $('#addLawSide').addEventListener('click',openAdd);
  $('#openSidebar').addEventListener('click',()=>showSidebar(true));
  $('#closeSidebar').addEventListener('click',()=>showSidebar(false));
  $('#sidebarShade').addEventListener('click',()=>showSidebar(false));
  $('#toggleNotes').addEventListener('click',()=>showNotes(!state.notesOpen));
  $('#closeNotes').addEventListener('click',()=>showNotes(false));
  $('#notesShade').addEventListener('click',()=>showNotes(false));
  $('#viewAllNotes').addEventListener('click',()=>{state.allNotes=true;renderNotes();showNotes(true);showSidebar(false);});
  $('#libraryFilter').addEventListener('input',e=>{state.filter=e.target.value;renderSidebar();});
  $('#content').addEventListener('click',e=>{if(e.target.closest('[data-action="add"]'))openAdd();});
  $('#addLawForm').addEventListener('submit',addLaw);
  $('#lawKind').addEventListener('change',toggleConstitution);
  $('#localLawFile').addEventListener('change',addSavedHtml);
  $('#testImportServer').addEventListener('click',testImportServer);
  $('#noteForm').addEventListener('submit',saveNote);
  $('#noteFiles').addEventListener('change',e=>{receiveFiles([...e.target.files]);e.target.value='';});
  $('#recordBtn').addEventListener('click',toggleRecording);
  $('#deleteNote').addEventListener('click',deleteNote);
  $('#exportBackup').addEventListener('click',exportBackup);
  $('#railBackup').addEventListener('click',exportBackup);
  $('#importBackup').addEventListener('change',importBackup);
  $('#helpBtn').addEventListener('click',()=>modal('helpDialog'));
  document.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',()=>closeModal(b.dataset.close)));
  $('#noteDialog').addEventListener('close',()=>{if(state.recorder?.state==='recording')state.recorder.stop();state.recordStream?.getTracks().forEach(t=>t.stop());clearDraftUrls();});
  $('#breadcrumb').addEventListener('click',e=>{if(state.current)home();});
  window.addEventListener('online',()=>{$('#offlineBanner').hidden=true;checkLibraryOnOpen();});
  window.addEventListener('offline',()=>{$('#offlineBanner').hidden=false;});
  $('#offlineBanner').hidden=navigator.onLine;
  window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredInstallPrompt=e;$('#installBtn').hidden=false;});
  $('#installBtn').addEventListener('click',async()=>{if(!deferredInstallPrompt)return;deferredInstallPrompt.prompt();await deferredInstallPrompt.userChoice;deferredInstallPrompt=null;$('#installBtn').hidden=true;});
  window.addEventListener('appinstalled',()=>{$('#installBtn').hidden=true;toast('Aplicativo instalado!');});
  window.addEventListener('resize',()=>{if(window.innerWidth>1220){$('#notesRail').classList.remove('open');$('#notesShade').hidden=true;}else showNotes(false);});
  selectionToolbar();
}
async function init(){
  wire();
  try{
    state.laws=await DB.all('laws');state.notes=await DB.all('notes');
    state.laws.sort((a,b)=>a.title.localeCompare(b.title,'pt-BR'));
    home();
    setTimeout(checkLibraryOnOpen, 1600);
  }catch(error){$('#content').innerHTML='<div class="onboarding"><h3>Armazenamento indisponível</h3><p>Este navegador não permitiu abrir a base local. Experimente usar uma aba normal, liberar armazenamento ou outro navegador.</p></div>';toast('Erro ao abrir armazenamento local: '+error.message,7000);}
  if('serviceWorker'in navigator && location.protocol==='https:')navigator.serviceWorker.register('/service-worker.js').catch(()=>{});
}
init();
