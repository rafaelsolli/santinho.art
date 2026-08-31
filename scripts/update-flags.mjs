#!/usr/bin/env node
/*
 * santinho.art — baixa as bandeiras das UFs para o seletor de estado.
 *
 * Roda só no build. As bandeiras estaduais são símbolos oficiais (domínio
 * público no Brasil) e vêm do Wikimedia Commons, rasterizadas pequenas.
 *
 * Mesma postura do importador do TSE: não adivinha em silêncio. Cada UF tem uma
 * lista de nomes candidatos no Commons; o script usa o primeiro que responder
 * 200 com imagem e **aborta listando as UFs que não resolveram**.
 *
 *   node scripts/update-flags.mjs
 *   node scripts/update-flags.mjs --largura=160
 */

import { writeFileSync, mkdirSync, statSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const UFS = [
  ['AC', 'Acre'],               ['AL', 'Alagoas'],
  ['AP', 'Amapá'],              ['AM', 'Amazonas'],
  ['BA', 'Bahia'],              ['CE', 'Ceará'],
  ['DF', 'Distrito Federal'],   ['ES', 'Espírito Santo'],
  ['GO', 'Goiás'],              ['MA', 'Maranhão'],
  ['MT', 'Mato Grosso'],        ['MS', 'Mato Grosso do Sul'],
  ['MG', 'Minas Gerais'],       ['PA', 'Pará'],
  ['PB', 'Paraíba'],            ['PR', 'Paraná'],
  ['PE', 'Pernambuco'],         ['PI', 'Piauí'],
  ['RJ', 'Rio de Janeiro'],     ['RN', 'Rio Grande do Norte'],
  ['RS', 'Rio Grande do Sul'],  ['RO', 'Rondônia'],
  ['RR', 'Roraima'],            ['SC', 'Santa Catarina'],
  ['SP', 'São Paulo'],          ['SE', 'Sergipe'],
  ['TO', 'Tocantins'],
];

/* nomes que não seguem nenhum dos padrões genéricos */
const NOMES_ESPECIFICOS = {
  DF: ['Bandeira do Distrito Federal (Brasil).svg'],
  SP: ['Bandeira do estado de São Paulo.svg'],
};

const candidatos = (uf, nome) => NOMES_ESPECIFICOS[uf] || [
  `Bandeira do ${nome}.svg`,
  `Bandeira de ${nome}.svg`,
  `Bandeira da ${nome}.svg`,
  `Bandeira do estado de ${nome}.svg`,
  `Bandeira do Estado de ${nome}.svg`,
  `Bandeira do estado do ${nome}.svg`,
];

const UA = 'santinho.art/1.0 (script de build; https://santinho.art)';
const arg = (n, p) => {
  const a = process.argv.find(x => x.startsWith('--' + n + '='));
  return a ? a.slice(n.length + 3) : p;
};
const LARGURA = Number(arg('largura', '160'));
const RAIZ = new URL('..', import.meta.url).pathname;
const DESTINO = join(RAIZ, 'assets', 'flags');

const urlDoCommons = (arquivo, largura) =>
  'https://commons.wikimedia.org/wiki/Special:FilePath/' +
  encodeURIComponent(arquivo) + '?width=' + largura;

async function baixar(uf, nome) {
  for (const arquivo of candidatos(uf, nome)) {
    try {
      const r = await fetch(urlDoCommons(arquivo, LARGURA), {
        headers: { 'User-Agent': UA },
        redirect: 'follow',
        signal: AbortSignal.timeout(30000),
      });
      if (!r.ok) continue;
      const tipo = r.headers.get('content-type') || '';
      if (!tipo.startsWith('image/')) continue;
      const bytes = Buffer.from(await r.arrayBuffer());
      if (bytes.length < 200) continue;                 // resposta vazia/placeholder
      writeFileSync(join(DESTINO, uf + '.png'), bytes);
      return { arquivo, bytes: bytes.length };
    } catch (_) { /* tenta o próximo nome */ }
  }
  return null;
}

mkdirSync(DESTINO, { recursive: true });

const naoResolvidas = [];
const creditos = [];
let total = 0;

for (const [uf, nome] of UFS) {
  const r = await baixar(uf, nome);
  if (!r) {
    naoResolvidas.push(uf + ' (' + nome + ')');
    console.log('  ✖ ' + uf + ' — nenhum nome candidato resolveu');
    continue;
  }
  total += r.bytes;
  creditos.push('| ' + uf + ' | ' + nome + ' | `' + r.arquivo + '` |');
  console.log('  ✔ ' + uf.padEnd(3) + String(r.bytes).padStart(6) + ' B  ' + r.arquivo);
}

if (naoResolvidas.length) {
  console.error('\n✖ ' + naoResolvidas.length + ' UF(s) sem bandeira: ' +
    naoResolvidas.join(', ') +
    '\n  → acrescente o nome correto do arquivo em NOMES_ESPECIFICOS' +
    '\n    (procure em https://commons.wikimedia.org)\n');
  process.exit(1);
}

writeFileSync(join(DESTINO, 'CREDITOS.md'),
  '# Bandeiras das unidades federativas\n\n' +
  'As bandeiras estaduais são símbolos oficiais, de domínio público no Brasil.\n' +
  'Os arquivos aqui foram rasterizados a partir dos SVG do Wikimedia Commons por\n' +
  '`scripts/update-flags.mjs`, em ' + LARGURA + ' px de largura.\n\n' +
  '| UF | Estado | Arquivo no Commons |\n|---|---|---|\n' + creditos.join('\n') + '\n\n' +
  'Fonte: https://commons.wikimedia.org — recuperado via `Special:FilePath`.\n');

console.log('\n✔ ' + UFS.length + ' bandeiras, ' + (total / 1024).toFixed(0) + ' KB em assets/flags/');
