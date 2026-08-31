#!/usr/bin/env node
/*
 * santinho.art — cor de cada partido, a partir do Wikidata.
 *
 * O §16 lista "derivada do partido" como primeira opção de cor; o hash da sigla
 * é a segunda. Cor real é mais informativa e não privilegia ninguém: toda
 * legenda recebe a sua (§46). O que não se pode é inventar de cabeça, então a
 * fonte é a propriedade P465 (cor) do Wikidata, citável e reconferível.
 *
 * Só resolve as siglas que estão de fato na base gerada por update-data.mjs.
 * Sigla sem cor não derruba o build: o front cai no hash da paleta neutra.
 *
 *   node scripts/update-party-colors.mjs
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const RAIZ = new URL('..', import.meta.url).pathname;
const DIR_DATA = join(RAIZ, 'data');
const UA = 'santinho.art/1.0 (script de build; https://santinho.art)';

/* Ajustes manuais, com o motivo. Só entram quando o Wikidata não resolve.
 * Vazio de propósito: nada aqui é chute — o PL, por exemplo, aparece com
 * #FF7F00 (laranja) no Wikidata, mas essa é a cor do PL de 1985-2006, extinto;
 * a legenda atual foi fundada em 2006 e é #0F0073. O filtro de dissolução já
 * resolve isso, e não se deve sobrescrever pela lembrança popular. */
const CORES_MANUAIS = {
  // sigla: ['#rrggbb', 'motivo'],
};

/* Várias legendas mudaram de nome e o Wikidata guarda a sigla antiga em P1813
 * (Republicanos→PRB, Cidadania→PPS, AGIR→PTC, Solidariedade→SD). O casamento
 * por rótulo resolve a maioria; estas ficam de fora e precisam do apelido. */
const APELIDOS = {
  'UNIÃO': 'União Brasil',
  'UP': 'Unidade Popular',
  'PCDOB': 'PCdoB',
};

/* comparação tolerante a acento, caixa, ponto e espaço */
const normalizar = t => (t || '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toUpperCase().replace(/[^A-Z0-9]/g, '');

/* siglas presentes na base atual */
function siglasDaBase() {
  const siglas = new Set();
  const arquivos = [];
  if (existsSync(join(DIR_DATA, 'br.json'))) arquivos.push(join(DIR_DATA, 'br.json'));
  const dirUf = join(DIR_DATA, 'uf');
  if (existsSync(dirUf)) {
    for (const f of readdirSync(dirUf)) if (f.endsWith('.json')) arquivos.push(join(dirUf, f));
  }
  if (!arquivos.length) {
    console.error('\n✖ nenhuma base em data/ — rode scripts/update-data.mjs primeiro\n');
    process.exit(1);
  }
  for (const f of arquivos) {
    const base = JSON.parse(readFileSync(f, 'utf8'));
    for (const cargo of Object.values(base.cargos || {})) {
      for (const c of Object.values(cargo)) if (c.p) siglas.add(c.p);
    }
    for (const p of Object.values(base.partidos || {})) if (p.sigla) siglas.add(p.sigla);
  }
  return siglas;
}

/* partidos brasileiros com cor, excluindo os já extintos (P576) — é o que
 * separa o PL de hoje do PL de 1985, que têm cores diferentes no Wikidata */
/* consulta enxuta de propósito: a caminhada de subclasses (P279*) somada a
 * FILTER NOT EXISTS derrubava o endpoint com 502. A data de dissolução vem como
 * OPTIONAL e o filtro é feito aqui no JS. */
const CONSULTA = `SELECT ?partyLabel ?sigla ?cor ?dissolucao WHERE {
  ?party wdt:P31 wd:Q7278 ;
         wdt:P17 wd:Q155 ;
         wdt:P465 ?cor .
  # P1813 é OPTIONAL: União Brasil e Democrata não têm sigla no Wikidata e
  # seriam excluídos antes de chegar ao casamento por rótulo
  OPTIONAL { ?party wdt:P1813 ?sigla }
  OPTIONAL { ?party wdt:P576 ?dissolucao }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "pt-br,pt,en". }
} LIMIT 500`;

/* Rede de segurança: nem todo partido brasileiro está tipado como instância
 * direta de Q7278 (o PCB e o PCdoB, por exemplo, não estão), e a caminhada de
 * subclasses derruba o endpoint. Esta consulta pega qualquer entidade
 * brasileira com cor — são poucas — e o casamento por sigla/rótulo contra as
 * siglas da base faz a filtragem. Só é usada para o que sobrou da primeira. */
const CONSULTA_AMPLA = `SELECT ?partyLabel ?sigla ?cor ?dissolucao WHERE {
  ?party wdt:P17 wd:Q155 ; wdt:P465 ?cor .
  OPTIONAL { ?party wdt:P1813 ?sigla }
  OPTIONAL { ?party wdt:P576 ?dissolucao }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "pt-br,pt,en". }
} LIMIT 3000`;

async function doWikidata(consulta) {
  const url = 'https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(consulta);
  let json = null;
  for (let tentativa = 1; tentativa <= 3 && !json; tentativa++) {
    try {
      const r = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: 'application/sparql-results+json' },
        signal: AbortSignal.timeout(90000),
      });
      if (r.ok) { json = await r.json(); break; }
      console.log('  Wikidata respondeu ' + r.status + ' (tentativa ' + tentativa + '/3)');
    } catch (e) {
      console.log('  ' + e.message + ' (tentativa ' + tentativa + '/3)');
    }
    if (!json) await new Promise(r => setTimeout(r, 3000 * tentativa));
  }
  if (!json) {
    console.error('\n✖ Wikidata indisponível' +
                  '\n  → tente de novo mais tarde; sem este arquivo o site usa o hash da sigla (§16)\n');
    process.exit(1);
  }

  /* Índice por sigla E por rótulo, ambos normalizados: é o rótulo que resolve
   * as legendas renomeadas. Cirílico e afins caem fora na normalização. */
  const indice = new Map();
  const anotar = (chave, cor, rotulo) => {
    if (!chave || chave.length < 2) return;
    if (!indice.has(chave)) indice.set(chave, new Map());
    indice.get(chave).set(cor, rotulo);
  };

  for (const b of json.results.bindings) {
    if (b.dissolucao?.value) continue;                 // legenda extinta
    const cor = (b.cor?.value || '').trim().toUpperCase();
    if (!/^[0-9A-F]{6}$/.test(cor)) continue;
    const rotulo = b.partyLabel?.value || '';
    const sigla = normalizar(b.sigla?.value);
    if (/^[A-Z0-9]+$/.test(sigla)) anotar(sigla, cor, rotulo);
    anotar(normalizar(rotulo), cor, rotulo);
  }
  return indice;
}

const siglas = siglasDaBase();
console.log('siglas na base: ' + siglas.size);
const indice = await doWikidata(CONSULTA);
console.log('chaves com cor (consulta restrita): ' + indice.size);
const indiceAmplo = await doWikidata(CONSULTA_AMPLA);
console.log('chaves com cor (consulta ampla): ' + indiceAmplo.size);

const cores = {};
const conflitos = [];
const semCor = [];
const amplas = [];

for (const sigla of [...siglas].sort()) {
  if (CORES_MANUAIS[sigla]) {
    cores[sigla] = CORES_MANUAIS[sigla][0].toUpperCase().replace('#', '');
    console.log('  ✔ ' + sigla.padEnd(18) + '#' + cores[sigla] + '  (manual: ' + CORES_MANUAIS[sigla][1] + ')');
    continue;
  }
  const chaves = [normalizar(sigla)];
  if (APELIDOS[sigla]) chaves.push(normalizar(APELIDOS[sigla]));

  let achadas = chaves.map(c => indice.get(c)).find(Boolean);
  let viaAmpla = false;
  if (!achadas) {
    achadas = chaves.map(c => indiceAmplo.get(c)).find(Boolean);
    viaAmpla = Boolean(achadas);
  }
  if (!achadas) { semCor.push(sigla); continue; }

  const lista = [...achadas.keys()].sort();
  if (lista.length > 1) {
    conflitos.push(sigla + ' → ' + lista.map(c => '#' + c + ' (' + achadas.get(c) + ')').join(', '));
  }
  cores[sigla] = lista[0];
  if (viaAmpla) amplas.push(sigla + ' → #' + lista[0] + ' (' + achadas.get(lista[0]) + ')');
  console.log('  ✔ ' + sigla.padEnd(18) + '#' + lista[0] +
              (viaAmpla ? '  (consulta ampla)' : '') +
              (lista.length > 1 ? '  ⚠ ' + lista.length + ' cores, usando a primeira' : ''));
}

if (conflitos.length) {
  console.log('\n  ⚠ conflito de cor (defina em CORES_MANUAIS se a escolhida estiver errada):');
  for (const c of conflitos) console.log('     ' + c);
}
if (amplas.length) {
  console.log('\n  ℹ resolvidas pela consulta ampla — confira se a entidade é mesmo o partido:');
  for (const a of amplas) console.log('     ' + a);
}
if (semCor.length) {
  console.log('\n  ⚠ sem cor no Wikidata, cairão no hash da paleta neutra (§16): ' + semCor.join(', '));
}

writeFileSync(join(DIR_DATA, 'cores-partidos.json'), JSON.stringify({
  fonte: 'Wikidata (P465)',
  atualizadoEm: new Date().toISOString(),
  cores,
}, null, 1));

console.log('\n✔ ' + Object.keys(cores).length + '/' + siglas.size +
            ' siglas com cor em data/cores-partidos.json');
