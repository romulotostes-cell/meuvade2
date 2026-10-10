/**
 * Busca textos compilados do Planalto e os organiza por dispositivo.
 * IMPORTANTE: extração automatizada é sujeita a falhas; sempre conferível pelo link oficial.
 * No armazenamento local do app, somente a diferença nos textos aciona alerta.
 */
import * as cheerio from 'cheerio';
import { createHash } from 'node:crypto';

const JSON_HEADERS = { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store' };
const MAX_HTML = 8_000_000;
const ALLOWED = new Set(['www.planalto.gov.br', 'planalto.gov.br']);
const TYPES = { lei:'Lei', complementar:'Lei Complementar', decretolei:'Decreto-Lei', constituicao:'Constituição Federal', emenda:'Emenda Constitucional' };
const normalize = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const tidy = s => String(s || '').replace(/[\u00a0\u200b\u200e\u200f]/g, ' ').replace(/\s+/g, ' ').trim();
const respond = (data, status=200) => new Response(JSON.stringify(data), {status, headers:JSON_HEADERS});
const hash = s => createHash('sha256').update(s).digest('hex');

export function candidates(kind, rawNum, rawYear) {
  const n = Number(rawNum); const y = Number(rawYear);
  const root = 'https://www.planalto.gov.br/ccivil_03';
  const out = [];
  if (kind === 'lei') {
    const base = `/leis/l${n}`;
    for (const ext of ['compilado.htm', 'compilada.htm', '.htm', 'cons.htm']) out.push(root + base + ext);
    if (y >= 2000 && y <= 2100) {
      for (const ext of ['compilado.htm', 'compilada.htm', '.htm']) out.push(root+`/leis/${y}/l${n}`+ext);
    }
  } else if (kind === 'complementar') {
    for (const ext of ['.htm', 'compilado.htm']) out.push(root + `/leis/lcp/lcp${n}` + ext);
  } else if (kind === 'decretolei') {
    out.push(root + `/decreto-lei/del${n}.htm`);
  } else if (kind === 'constituicao') {
    out.push(root + '/constituicao/constituicao.htm');
  } else if (kind === 'emenda') {
    out.push(root + `/constituicao/emendas/emc/emc${n}.htm`);
  }
  return [...new Set(out)];
}

function matchesHeading(text, kind, number, year) {
  if (kind === 'constituicao') return normalize(text).includes('constituicao');
  const n = Number(number);
  const head = normalize(text.slice(0, 7000));
  const compact = head.replace(/\./g,'');
  const numberFound = new RegExp(`\\b${n}\\b`).test(compact);
  const yearFound = !year || new RegExp(`\\b${Number(year)}\\b`).test(compact);
  return numberFound && yearFound;
}

async function fetchOfficial(input) {
  let url = new URL(input);
  for (let i = 0; i < 3; i++) {
    if (url.protocol !== 'https:' || !ALLOWED.has(url.hostname) || url.username || url.password || (url.port && url.port !== '443')) throw new Error('Somente endereços HTTPS oficiais do Planalto são aceitos.');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8500);
    let res;
    try { res = await fetch(url, { headers:{ 'User-Agent':'Mozilla/5.0 (compatible; BibliotecaEstudo/1.0)', 'Accept':'text/html' }, signal:controller.signal, redirect:'manual' }); }
    finally { clearTimeout(timer); }
    if ([301,302,303,307,308].includes(res.status)) {
      const location = res.headers.get('location');
      if (!location) throw new Error('Redirecionamento sem endereço.');
      url = new URL(location, url);
      continue;
    }
    if (!res.ok) throw new Error(`Fonte oficial indisponível (HTTP ${res.status}).`);
    const len = Number(res.headers.get('content-length')||0);
    if (len > MAX_HTML) throw new Error('Documento acima do limite permitido.');
    const buffer = await res.arrayBuffer();
    if (buffer.byteLength > MAX_HTML) throw new Error('Documento acima do limite permitido.');
    const bytes = new Uint8Array(buffer);
    const peek = new TextDecoder('latin1').decode(bytes.slice(0,3000));
    const encoding = (res.headers.get('content-type') || '').match(/charset\s*=\s*['"]?([\w-]+)/i)?.[1]
      || peek.match(/charset\s*=\s*['"]?([\w-]+)/i)?.[1]
      || 'windows-1252';
    let html;
    try { html = new TextDecoder(encoding).decode(bytes); } catch { html = new TextDecoder('windows-1252').decode(bytes); }
    return { html, url: url.href };
  }
  throw new Error('Excesso de redirecionamentos.');
}

function parentStruck($, el) {
  let node = el;
  while (node?.type === 'tag') {
    const tag = (node.name||'').toLowerCase();
    if (['s','strike','del'].includes(tag)) return true;
    const inlineStyle = String($(node).attr('style') || '').toLowerCase();
    if (/text-decoration(?:-line)?\s*:\s*[^;]*(line-through)/.test(inlineStyle)) return true;
    node = node.parent;
  }
  return false;
}

/** Cheerio copies a paragraph, removes deleted/historical markup, keeps the enacted content. */
function paragraphText($, el) {
  if (parentStruck($,el)) return '';
  const clone = $(el).clone();
  clone.find('s,strike,del,script,style,noscript').remove();
  clone.find('[style]').each((_,n) => {
    const style = String($(n).attr('style')||'').toLowerCase();
    if (/text-decoration(?:-line)?\s*:\s*[^;]*line-through/.test(style)) $(n).remove();
  });
  clone.find('br').replaceWith(' ');
  return tidy(clone.text());
}

function detectUnit(text, number) {
  const s = tidy(text);
  let m;
  if ((m = s.match(/^§\s*(\d+[A-Za-z]?(?:[-‑][A-Za-z0-9]+)?)\s*[º°o.]?\s*/i))) return { id:`par-${normalize(m[1])}`, label:`§ ${m[1]}`, text:s };
  if (/^par[aá]grafo\s+[uú]nico\b/i.test(s)) return {id:'par-unico',label:'Parágrafo único',text:s};
  if ((m = s.match(/^([IVXLCDM]{1,8})\s*[-–—]\s+/i))) return {id:`inc-${m[1].toUpperCase()}`,label:`Inciso ${m[1].toUpperCase()}`,text:s};
  if ((m = s.match(/^([a-z])\s*[)\-]\s+/i))) return {id:`al-${m[1].toLowerCase()}`,label:`Alínea ${m[1].toLowerCase()}`,text:s};
  return {id:'continuacao',label:'Continuação',text:s};
}

export function parseHtml(html, meta={}) {
  const $ = cheerio.load(html, { decodeEntities:true });
  $('script, style, noscript, iframe, form, nav').remove();
  const nodes = $('body p, body li').toArray();
  const textLines = nodes.map(el => paragraphText($,el)).filter(Boolean);
  const headingText = textLines.slice(0,35).join(' ').slice(0,7000);
  const articleStart = /^art(?:igo)?\.?\s*(\d+)\s*[º°o.]?(?:[-‑]([a-zA-Z0-9]+))?(?=\s|[-–—.:]|$)/i;
  const articles = []; let article = null;
  const duplicateKeys = new Map();
  for (const line of textLines) {
    const a = line.match(articleStart);
    if (a) {
      const number = (a[1] + (a[2] ? '-' + a[2] : '')).toUpperCase();
      const base = `art-${number.toLowerCase()}`;
      duplicateKeys.set(base, (duplicateKeys.get(base)||0)+1);
      const id = duplicateKeys.get(base) === 1 ? base : `${base}-${duplicateKeys.get(base)}`;
      article = { id, number, units:[{id:'caput', label:'Caput', text:line}] };
      articles.push(article);
      continue;
    }
    if (!article) continue;
    // Paragraph headers, chapters and editorial notes that are not in article body
    if (/^(t[ií]tulo|cap[ií]tulo|se[cç][aã]o|subse[cç][aã]o|livro|parte)\s+[IVXLC\d]/i.test(line)) continue;
    if (/^(Bras[ií]lia,|Este texto n[aã]o substitui|O PRESIDENTE DA REP[UÚ]BLICA|A PRESIDENTA DA REP[UÚ]BLICA)/i.test(line)) break;
    const u = detectUnit(line);
    const existing = article.units.find(e => e.id === u.id && e.id !== 'continuacao');
    if (existing) existing.text += ' ' + line;
    else if (u.id === 'continuacao') {
      const prev = article.units[article.units.length-1];
      if (prev) prev.text += ' ' + line;
    } else article.units.push(u);
  }
  const filtered = articles.filter(a => a.units.length && a.units[0].text.length > 8);
  if (filtered.length < 1) throw new Error('Não foi possível identificar artigos no HTML oficial. Confira a fonte manualmente.');
  // Do not blindly promise this is consolidated; the Planalto may serve both historical and current text.
  const fingerprint = hash(JSON.stringify(filtered.map(a=>[a.id,a.units.map(u=>[u.id,u.text])])));
  return {articles:filtered, fingerprint, headingText};
}

export default async function handler(req) {
  if (req.method !== 'GET') return respond({error:'Método não permitido.'},405);
  try {
    const args = new URL(req.url).searchParams;
    if (args.get('health') === '1') return respond({ ok:true, service:'legislation', version:2 });
    const kind = String(args.get('kind')||'lei').toLowerCase();
    const number = String(args.get('number')||'').replace(/\./g,'');
    const year = String(args.get('year')||'').trim();
    const submittedUrl = String(args.get('url')||'').trim();
    if (!TYPES[kind]) return respond({error:'Tipo normativo não suportado.'},400);
    if (kind !== 'constituicao' && (!/^\d{1,6}$/.test(number) || Number(number)<1)) return respond({error:'Informe um número de norma válido.'},400);
    if (kind !== 'constituicao' && !year) return respond({error:'Informe o ano da norma.'},400);
    if (year && (!/^\d{4}$/.test(year) || Number(year)<1800 || Number(year)>2100)) return respond({error:'Ano inválido.'},400);
    if (submittedUrl && submittedUrl.length > 500) return respond({error:'URL muito longa.'},400);
    const choices = submittedUrl ? [submittedUrl] : candidates(kind,number,year);
    let lastError = null;
    for (let i=0; i<choices.length; i+=3) {
      const attempts = await Promise.all(choices.slice(i,i+3).map(async candidate => {
        try {
          const result = await fetchOfficial(candidate);
          const parsed = parseHtml(result.html);
          if (!matchesHeading(parsed.headingText,kind,number,year)) throw new Error('Número ou ano não corresponde ao documento retornado.');
          return { ...parsed, url:result.url };
        } catch(e) { return { error: e.message }; }
      }));
      const result = attempts.find(x=>!x.error);
      if (result) {
        const id = `${kind}:${kind === 'constituicao' ? '1988' : Number(number)}:${year || 'sem-ano'}`;
        const label = kind === 'constituicao' ? 'Constituição Federal de 1988' : `${TYPES[kind]} nº ${Number(number).toLocaleString('pt-BR')}${year?'/'+year:''}`;
        return respond({ id, kind, number, year, title:label, source:'Planalto', officialUrl:result.url, checkedAt: new Date().toISOString(), fingerprint:result.fingerprint, articles:result.articles, stats:{articleCount: result.articles.length}, warning:'Extração automática de texto. Confira a versão oficial e os dispositivos em caso de dúvida.' });
      }
      lastError = attempts.map(x=>x.error).filter(Boolean).at(-1);
    }
    return respond({error:`Não foi possível localizar ou interpretar a norma automaticamente. ${lastError||''}`,hint:'Informe o endereço exato da versão compilada no Planalto no campo URL oficial.'},404);
  } catch (error) {
    return respond({error:error.message || 'Falha ao consultar a fonte oficial.'},502);
  }
}
