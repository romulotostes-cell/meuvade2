/** Importação MANUAL de arquivo HTML previamente salvo pelo usuário.
 * Nenhuma requisição à fonte é realizada; um arquivo salvo não prova vigência.
 */
const normal = str => String(str || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const clean = str => String(str || '').replace(/[\u00a0\u200b\u200e\u200f]/g,' ').replace(/\s+/g,' ').trim();
const articleRe = /^art(?:igo)?\.?\s*(\d+)\s*[º°o.]?(?:[-‑]([a-zA-Z0-9]+))?(?=\s|[-–—.:]|$)/i;
function unitFor(value) {
  const s=clean(value); let m;
  if((m=s.match(/^§\s*(\d+[a-z]?(?:[-‑][a-z0-9]+)?)\s*[º°o.]?\s*/i))) return {id:`par-${normal(m[1])}`,label:`§ ${m[1]}`,text:s};
  if(/^par[aá]grafo\s+[uú]nico\b/i.test(s))return {id:'par-unico',label:'Parágrafo único',text:s};
  if((m=s.match(/^([IVXLCDM]{1,8})\s*[-–—]\s+/i)))return {id:`inc-${m[1].toUpperCase()}`,label:`Inciso ${m[1].toUpperCase()}`,text:s};
  if((m=s.match(/^([a-z])\s*[)\-]\s+/i)))return {id:`al-${m[1].toLowerCase()}`,label:`Alínea ${m[1].toLowerCase()}`,text:s};
  return {id:'continuacao',label:'Continuação',text:s};
}
export function parseLocalHtml(source) {
  if(typeof source!=='string'||source.length>12_000_000) throw Error('O arquivo HTML é inválido ou grande demais.');
  const doc=new DOMParser().parseFromString(source,'text/html');
  doc.querySelectorAll('script,style,noscript,iframe,form,nav').forEach(n=>n.remove());
  let nodes=[...doc.querySelectorAll('body p,body li')];
  if(!nodes.length) nodes=[...doc.querySelectorAll('body div')].filter(n=>n.children.length===0);
  const lines=[];
  for(const n of nodes){
    if(n.closest('s,strike,del,[style*="line-through"]'))continue;
    const clone=n.cloneNode(true);
    clone.querySelectorAll('s,strike,del,[style*="line-through"]').forEach(el=>el.remove());
    const line=clean(clone.textContent);if(line)lines.push(line);
  }
  const articles=[], seen=new Map();let current=null;
  for(const line of lines){
    const a=line.match(articleRe);
    if(a){
      const number=(a[1]+(a[2]?'-'+a[2]:'')).toUpperCase(), base=`art-${number.toLowerCase()}`;
      seen.set(base,(seen.get(base)||0)+1);
      const id=seen.get(base)===1?base:`${base}-${seen.get(base)}`;
      current={id,number,units:[{id:'caput',label:'Caput',text:line}]};articles.push(current);continue;
    }
    if(!current)continue;
    if(/^(t[ií]tulo|cap[ií]tulo|se[cç][aã]o|subse[cç][aã]o|livro|parte)\s+[IVXLC\d]/i.test(line))continue;
    if(/^(Bras[ií]lia,|Este texto n[aã]o substitui|O PRESIDENTE DA REP[UÚ]BLICA|A PRESIDENTA DA REP[UÚ]BLICA)/i.test(line))break;
    const u=unitFor(line), previous=current.units.find(x=>x.id===u.id&&u.id!=='continuacao');
    if(previous)previous.text+=' '+line;
    else if(u.id==='continuacao')current.units[current.units.length-1].text+=' '+line;
    else current.units.push(u);
  }
  const filtered=articles.filter(a=>a.units[0].text.length>8);
  if(!filtered.length) throw Error('Não encontrei artigos no HTML. Salve a página oficial completa em formato .html e tente novamente.');
  return {articles:filtered,headingText:lines.slice(0,35).join(' ').slice(0,7000)};
}

export async function parseLocalFile(file){
  if(!file||file.size>10_000_000)throw Error('Selecione um HTML de até 10 MB.');
  const buf=await file.arrayBuffer();
  const bytes=new Uint8Array(buf);
  const first=new TextDecoder('windows-1252').decode(bytes.slice(0,3000));
  const charset=first.match(/charset\s*=\s*["']?([\w-]+)/i)?.[1]||'windows-1252';
  let str;
  try{str=new TextDecoder(charset).decode(bytes);}catch{str=new TextDecoder('windows-1252').decode(bytes);}
  return parseLocalHtml(str);
}
