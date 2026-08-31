#!/usr/bin/env node
/*
 * santinho.art — importador da base de candidatos do TSE
 *
 * Roda apenas no build/pipeline. O site publicado consome só os JSONs gerados
 * aqui (§8, §41). Nenhuma dependência npm: usa `unzip` do sistema quando
 * recebe um .zip.
 *
 * REGRA CENTRAL (§53): este script NÃO adivinha. Toda coluna, todo código de
 * cargo e toda situação de candidatura têm de estar nas tabelas declaradas
 * abaixo. Se o schema real divergir, ele aborta listando exatamente o que
 * mudou — em vez de gerar uma base silenciosamente errada.
 *
 * Uso:
 *   node scripts/update-data.mjs --from-local <dir|zip>   # arquivos já baixados
 *   node scripts/update-data.mjs --fetch                  # baixa do TSE
 *   node scripts/update-data.mjs --from-local x --dry-run  # valida sem escrever
 *   node scripts/update-data.mjs --probe                  # o que existe no portal
 *   node scripts/update-data.mjs --fetch --url=<URL>      # URL descoberta no probe
 *   ... --fotos=locais     baixa as fotos oficiais (ZIP por UF, ~106 MB)
 *   ... --ano=2026
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync, statSync, rmSync,
         existsSync, copyFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, basename, extname } from 'node:path';
import { tmpdir } from 'node:os';

/* ====================================================================== */
/* Contrato com o TSE — tudo o que precisa ser CONFIRMADO antes de publicar */
/* ====================================================================== */

/* NÃO VERIFICADO: confirmar no Portal de Dados Abertos do TSE o nome real do
 * pacote de 2026 antes de usar --fetch. Em 2026-08 este host respondia 403 a
 * requisições fora do Brasil, então --from-local é o caminho confiável.
 * Use --probe para descobrir os recursos reais em vez de confiar nestes palpites. */
const TSE_SOURCES = {
  candidatos: ano =>
    `https://cdn.tse.jus.br/estatistica/sead/odsele/consulta_cand/consulta_cand_${ano}.zip`,
};

/* Descoberta: o portal do TSE roda CKAN, que lista os recursos de cada dataset.
 * Perguntar ao portal é a única forma de não chutar nome de arquivo (§53). */
const PORTAL = {
  dataset: ano => `https://dadosabertos.tse.jus.br/api/3/action/package_show?id=candidatos-${ano}`,
  busca:   ano => `https://dadosabertos.tse.jus.br/api/3/action/package_search?q=candidatos+${ano}&rows=20`,
  pagina:  ano => `https://dadosabertos.tse.jus.br/dataset/candidatos-${ano}`,
};

/* Palpites testados por --probe. O de 2022 é controle: se ele também falhar,
 * o problema é acesso (IP/geo), não ausência do arquivo de 2026. */
const PALPITES = ano => [
  ['candidatos ' + ano,
   `https://cdn.tse.jus.br/estatistica/sead/odsele/consulta_cand/consulta_cand_${ano}.zip`],
  ['candidatos 2022 (controle)',
   'https://cdn.tse.jus.br/estatistica/sead/odsele/consulta_cand/consulta_cand_2022.zip'],
  ['fotos SP ' + ano,
   `https://cdn.tse.jus.br/estatistica/sead/odsele/foto_candidato/foto_cand${ano}_SP_div.zip`],
  ['fotos SP 2022 (controle)',
   'https://cdn.tse.jus.br/estatistica/sead/odsele/foto_candidato/foto_cand2022_SP_div.zip'],
  ['divulgacand: eleição atual',
   'https://divulgacandcontas.tse.jus.br/divulga/rest/v1/eleicao/eleicao-atual'],
];

/* Fotos: CONFIRMADO em 2026-08-31. Não existe URL de foto por candidato — o
 * arquivo solto responde 404 e a API do divulgacand devolve corpo vazio. A única
 * fonte é um ZIP por UF, com arquivos nomeados F{UF}{SQ_CANDIDATO}_div.jpg.
 * Atenção: o caminho NÃO é o odsele/foto_candidato/ de anos anteriores. */
const FOTOS_ZIP_URL = (uf, ano) =>
  `https://cdn.tse.jus.br/estatistica/sead/eleicoes/eleicoes2026/fotos/foto_cand${ano}_${uf}_div.zip`;

const FOTO_ARQUIVO = /^F[A-Z]{2}(\d+)_div\.jpe?g$/i;

/* Colunas exigidas. Se qualquer uma faltar, o script aborta. */
const COLUNAS_EXIGIDAS = [
  'ANO_ELEICAO', 'NR_TURNO', 'SG_UF', 'CD_CARGO', 'DS_CARGO',
  'NR_CANDIDATO', 'NM_URNA_CANDIDATO', 'NR_PARTIDO', 'SG_PARTIDO',
  'SQ_CANDIDATO', 'DS_SITUACAO_CANDIDATURA',
];

/* CONFIRMAR contra a documentação do TSE de 2026. Valor de CD_CARGO fora desta
 * tabela derruba o script (nada de heurística silenciosa). */
const CARGOS_TSE = {
  '1': { base: 'p',  escopo: 'BR', digitos: 2 },   // Presidente
  '3': { base: 'g',  escopo: 'UF', digitos: 2 },   // Governador
  '5': { base: 's',  escopo: 'UF', digitos: 3 },   // Senador
  '6': { base: 'df', escopo: 'UF', digitos: 4 },   // Deputado federal
  '7': { base: 'de', escopo: 'UF', digitos: 5 },   // Deputado estadual
  '8': { base: 'de', escopo: 'UF', digitos: 5 },   // Deputado distrital (DF)
};
/* cargos existentes na base que não usamos (vice, suplente etc.) */
const CARGOS_IGNORADOS = new Set(['2', '4', '9', '10', '11', '12', '13']);

/* Normalização da situação da candidatura (§13).
 *   A = apta   P = pendente/sub judice   X = não apta   N = não informada
 *
 * VERIFICADO em 2026-08-31 no pacote real: TODAS as 41.538 linhas de 2026 vêm
 * com DS_SITUACAO_CANDIDATURA = "#NE" e CD_SITUACAO_CANDIDATURA = -3, e o
 * layout de 2026 não tem a coluna DS_DETALHE_SITUACAO_CAND. Ou seja: o TSE
 * ainda não publicou o julgamento dos registros. "#NE" virou "N" — registro
 * existe, situação não informada — e não "A", para não afirmar aptidão que o
 * dado não sustenta. Quem decide exibir "N" é candidaturaExibivel() no front.
 * Valor desconhecido derruba o script. */
const SITUACOES = {
  '#NE': 'N',
  '#NULO': 'N',
  'APTO': 'A',
  'APTA': 'A',
  'DEFERIDO': 'A',
  'DEFERIDO COM RECURSO': 'A',
  'PENDENTE DE JULGAMENTO': 'P',
  'AGUARDANDO JULGAMENTO': 'P',
  'SUB JUDICE': 'P',
  'INAPTO': 'X',
  'INAPTA': 'X',
  'INDEFERIDO': 'X',
  'INDEFERIDO COM RECURSO': 'X',
  'CANCELADO': 'X',
  'CASSADO': 'X',
  'RENUNCIA': 'X',
  'RENÚNCIA': 'X',
  'FALECIDO': 'X',
  'NÃO CONHECIMENTO DO PEDIDO': 'X',
  'NAO CONHECIMENTO DO PEDIDO': 'X',
  'IMPUGNADO': 'X',
  '#NULO#': 'N',
  '': 'N',
};

const UFS = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG',
             'PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];

/* ====================================================================== */

const args = process.argv.slice(2);
const opt = (nome, padrao = null) => {
  const p = args.find(a => a.startsWith('--' + nome + '='));
  return p ? p.slice(nome.length + 3) : padrao;
};
const flag = nome => args.includes('--' + nome);

const ANO = Number(opt('ano', '2026'));
const DRY_RUN = flag('dry-run');
/* nenhuma | locais. Se a base já tem fotos e ninguém pediu o contrário, mantém
 * fotos: rodar o importador sem a flag não pode apagar em silêncio o campo `f`
 * de 19 mil registros e deixar data/photos órfão. */
const TEM_FOTOS_LOCAIS = existsSync(new URL('../data/photos', import.meta.url).pathname);
const MODO_FOTOS = opt('fotos') || (TEM_FOTOS_LOCAIS ? 'locais' : 'nenhuma');
const RAIZ = new URL('..', import.meta.url).pathname;

class ErroDeSchema extends Error {}

/* o Akamai do TSE bloqueia clientes sem User-Agent de navegador (o curl é
 * barrado até com o header certo, por fingerprint TLS; o fetch do Node passa) */
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
           'Chrome/126.0.0.0 Safari/537.36';

const morrer = msg => { console.error('\n✖ ' + msg + '\n'); process.exit(1); };
const log = (...a) => console.log(...a);

/* ------------------------------------------------------------------ CSV */

/* CSVs do TSE: separador ';', campos entre aspas, encoding ISO-8859-1 */
function lerCsv(buf) {
  const texto = new TextDecoder('iso-8859-1').decode(buf);
  const linhas = [];
  let campo = '', linha = [], dentroDeAspas = false;

  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (dentroDeAspas) {
      if (c === '"') {
        if (texto[i + 1] === '"') { campo += '"'; i++; }
        else dentroDeAspas = false;
      } else campo += c;
      continue;
    }
    if (c === '"') dentroDeAspas = true;
    else if (c === ';') { linha.push(campo); campo = ''; }
    else if (c === '\n') { linha.push(campo); linhas.push(linha); linha = []; campo = ''; }
    else if (c !== '\r') campo += c;
  }
  if (campo !== '' || linha.length) { linha.push(campo); linhas.push(linha); }

  if (!linhas.length) throw new ErroDeSchema('arquivo CSV vazio');
  const header = linhas[0].map(h => h.trim().replace(/^﻿/, ''));
  return { header, linhas: linhas.slice(1) };
}

function validarHeader(header, arquivo) {
  const faltando = COLUNAS_EXIGIDAS.filter(c => !header.includes(c));
  if (faltando.length) {
    throw new ErroDeSchema(
      'schema do TSE mudou em ' + arquivo + '\n' +
      '  colunas exigidas ausentes: ' + faltando.join(', ') + '\n' +
      '  colunas encontradas (' + header.length + '): ' + header.join(', ') + '\n' +
      '  → confira COLUNAS_EXIGIDAS em scripts/update-data.mjs (§53)'
    );
  }
}

/* -------------------------------------------------------------- entrada */

function extrairZip(zip) {
  const destino = join(tmpdir(), 'santinho-tse-' + process.pid);
  mkdirSync(destino, { recursive: true });
  try {
    execFileSync('unzip', ['-o', '-q', zip, '-d', destino], { stdio: ['ignore', 'ignore', 'pipe'] });
  } catch (e) {
    morrer('não foi possível descompactar ' + zip + '\n  ' + (e.stderr || e.message) +
           '\n  → extraia manualmente e use --from-local <diretorio>');
  }
  return destino;
}

function csvsEm(caminho) {
  const st = statSync(caminho);
  const dir = st.isDirectory() ? caminho
            : extname(caminho).toLowerCase() === '.zip' ? extrairZip(caminho)
            : null;
  if (!dir) {
    if (extname(caminho).toLowerCase() === '.csv') return { dir: null, arquivos: [caminho] };
    morrer('esperava um diretório, um .zip ou um .csv: ' + caminho);
  }
  /* varre recursivamente e descobre a UF pela coluna SG_UF, nunca pelo nome do
   * arquivo — assim mudanças de nomenclatura no TSE não quebram a importação */
  const achados = [];
  const varrer = d => {
    for (const nome of readdirSync(d)) {
      const p = join(d, nome);
      if (statSync(p).isDirectory()) varrer(p);
      else if (extname(nome).toLowerCase() === '.csv') achados.push(p);
    }
  };
  varrer(dir);
  if (!achados.length) morrer('nenhum .csv encontrado em ' + caminho);
  return { dir: st.isDirectory() ? null : dir, arquivos: achados.sort() };
}

async function baixarDoTse() {
  const url = opt('url') || TSE_SOURCES.candidatos(ANO);
  log('baixando ' + url);
  const resp = await fetch(url, {
    redirect: 'follow',
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(600000),
  });
  if (!resp.ok) {
    morrer('TSE respondeu ' + resp.status + ' para\n  ' + url +
           '\n  → verifique o recurso no Portal de Dados Abertos; se o acesso' +
           '\n    estiver bloqueado, baixe manualmente e use --from-local (§53)');
  }
  const zip = join(tmpdir(), 'consulta_cand_' + ANO + (url.endsWith('.csv') ? '.csv' : '.zip'));
  writeFileSync(zip, Buffer.from(await resp.arrayBuffer()));
  log('  ' + (statSync(zip).size / 1e6).toFixed(1) + ' MB');
  return zip;
}

/* ------------------------------------------------------------- processo */

function novaBase(uf) {
  return { uf, partidos: {}, cargos: uf === 'BR' ? { p: {} } : { df: {}, de: {}, s: {}, g: {} } };
}

function processar(arquivos) {
  const bases = new Map();
  const situacoesDesconhecidas = new Map();
  const cargosDesconhecidos = new Map();
  const eleicoes = new Set();
  const geracoes = new Set();
  let lidas = 0, usadas = 0, conflitos = 0, tamanhoErrado = 0, comSituacao = 0;

  for (const arquivo of arquivos) {
    const { header, linhas } = lerCsv(readFileSync(arquivo));
    validarHeader(header, basename(arquivo));
    const col = Object.fromEntries(header.map((h, i) => [h, i]));
    const val = (l, c) => (l[col[c]] ?? '').trim();

    for (const l of linhas) {
      if (l.length < header.length) continue;               // linha truncada
      lidas++;
      if (Number(val(l, 'ANO_ELEICAO')) !== ANO) continue;
      if (val(l, 'NR_TURNO') !== '1') continue;             // 2º turno não entra na cola
      if (col.CD_ELEICAO != null) eleicoes.add(val(l, 'CD_ELEICAO'));
      if (col.DT_GERACAO != null) geracoes.add(val(l, 'DT_GERACAO'));

      const cdCargo = val(l, 'CD_CARGO');
      if (CARGOS_IGNORADOS.has(cdCargo)) continue;
      const cargo = CARGOS_TSE[cdCargo];
      if (!cargo) {
        cargosDesconhecidos.set(cdCargo, val(l, 'DS_CARGO'));
        continue;
      }

      const sitBruta = val(l, 'DS_SITUACAO_CANDIDATURA').toUpperCase();
      const sit = SITUACOES[sitBruta];
      if (sit && sit !== 'N') comSituacao++;
      if (sit === undefined) {
        situacoesDesconhecidas.set(sitBruta, (situacoesDesconhecidas.get(sitBruta) || 0) + 1);
        continue;
      }

      const uf = cargo.escopo === 'BR' ? 'BR' : val(l, 'SG_UF').toUpperCase();
      if (uf !== 'BR' && !UFS.includes(uf)) continue;       // ZZ (exterior) etc.

      const numero = val(l, 'NR_CANDIDATO');
      if (!/^\d+$/.test(numero) || numero.length !== cargo.digitos) { tamanhoErrado++; continue; }

      if (!bases.has(uf)) bases.set(uf, novaBase(uf));
      const base = bases.get(uf);
      const alvo = base.cargos[cargo.base];
      const registro = {
        n: val(l, 'NM_URNA_CANDIDATO'),
        p: val(l, 'SG_PARTIDO'),
        sq: val(l, 'SQ_CANDIDATO'),
        sit,
      };

      /* Mesmo número para candidatos diferentes acontece de verdade no período
       * de registro (dois pedidos do mesmo partido com o mesmo número, ainda
       * não julgados). O desempate é determinístico e declarado, nunca aleatório:
       * situação melhor primeiro; empatando, o SQ_CANDIDATO maior — o pedido
       * mais recente. O registro fica marcado com dup:1 para o front poder
       * sinalizar que aquele número está em disputa. */
      const anterior = alvo[numero];
      if (anterior && anterior.sq !== registro.sq) {
        conflitos++;
        registro.dup = 1;
        const ordem = { A: 3, P: 2, N: 1, X: 0 };
        const melhorAntes = (ordem[anterior.sit] ?? 0) > (ordem[sit] ?? 0);
        const mesmaSit = anterior.sit === sit;
        if (melhorAntes || (mesmaSit && anterior.sq > registro.sq)) {
          anterior.dup = 1;
          continue;
        }
      } else if (anterior && anterior.dup) {
        registro.dup = 1;               // preserva a marca ao reencontrar a linha
      }
      alvo[numero] = registro;

      const nrPartido = val(l, 'NR_PARTIDO');
      const sgPartido = val(l, 'SG_PARTIDO');
      if (/^\d{2}$/.test(nrPartido) && sgPartido) base.partidos[nrPartido] = { sigla: sgPartido };
      usadas++;
    }
    log('  ' + basename(arquivo) + ': ' + linhas.length + ' linhas');
  }

  /* falha explícita: nada de base parcialmente adivinhada (§53) */
  if (cargosDesconhecidos.size) {
    throw new ErroDeSchema(
      'CD_CARGO fora da tabela conhecida: ' +
      [...cargosDesconhecidos].map(([c, d]) => c + ' (' + d + ')').join(', ') +
      '\n  → classifique em CARGOS_TSE ou em CARGOS_IGNORADOS'
    );
  }
  if (situacoesDesconhecidas.size) {
    throw new ErroDeSchema(
      'DS_SITUACAO_CANDIDATURA fora da tabela conhecida: ' +
      [...situacoesDesconhecidas].map(([s, n]) => '"' + s + '" (' + n + 'x)').join(', ') +
      '\n  → mapeie em SITUACOES como A (apta), P (pendente) ou X (não apta)'
    );
  }
  if (!usadas) {
    throw new ErroDeSchema(
      'nenhuma candidatura de ' + ANO + ' turno 1 encontrada em ' + lidas + ' linhas lidas' +
      '\n  → confira --ano e se o pacote baixado é o de consulta_cand'
    );
  }
  if (!bases.has('BR') || !Object.keys(bases.get('BR').cargos.p).length) {
    throw new ErroDeSchema('nenhum candidato a presidente (CD_CARGO 1) encontrado');
  }
  if (eleicoes.size > 1) {
    /* 2026 tem duas: "Eleição Geral Federal" (presidente) e
     * "Eleições Gerais Estaduais" (demais cargos). Mais que isso, investigue. */
    log('  nota: ' + eleicoes.size + ' eleições no pacote: ' + [...eleicoes].join(', '));
  }
  if (tamanhoErrado) {
    log('  aviso: ' + tamanhoErrado + ' registros com NR_CANDIDATO de tamanho inesperado (ignorados)');
  }
  if (conflitos) {
    log('  aviso: ' + conflitos + ' colisões de número no mesmo cargo/UF ' +
        '(registros marcados com dup:1)');
  }

  if (!comSituacao) {
    log('  aviso: nenhuma candidatura com situação publicada pelo TSE ' +
        '(todas "#NE") — o site anuncia isso no cabeçalho');
  }
  return { bases, meta: {
    situacaoPublicada: comSituacao > 0,
    numerosEmDisputa: conflitos,
    geradoPeloTseEm: [...geracoes].sort().pop() || null,
    candidaturas: usadas,
  } };
}

/* --------------------------------------------------------------- fotos */

/* Baixa um ZIP por UF e guarda apenas as fotos de candidaturas que estão na
 * base — descarta vices, suplentes e o leiame.pdf. Preenche o campo `foto` de
 * cada registro com o caminho relativo do arquivo salvo. */
async function baixarFotos(bases) {
  const dirFotos = join(RAIZ, 'data', 'photos');
  rmSync(dirFotos, { recursive: true, force: true });   // evita foto órfã
  mkdirSync(dirFotos, { recursive: true });

  let salvas = 0, semFoto = 0, bytes = 0;

  for (const [uf, base] of [...bases].sort()) {
    const porSq = new Map();
    for (const cargo of Object.values(base.cargos)) {
      for (const c of Object.values(cargo)) {
        if (!c.sq) continue;
        if (!porSq.has(c.sq)) porSq.set(c.sq, []);
        porSq.get(c.sq).push(c);
      }
    }
    if (!porSq.size) continue;

    const url = FOTOS_ZIP_URL(uf, ANO);
    let zip;
    try {
      const resp = await fetch(url, {
        headers: { 'User-Agent': UA },
        signal: AbortSignal.timeout(600000),
      });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      zip = join(tmpdir(), 'santinho-fotos-' + uf + '-' + process.pid + '.zip');
      writeFileSync(zip, Buffer.from(await resp.arrayBuffer()));
    } catch (e) {
      log('  ' + uf + ': fotos indisponíveis (' + e.message + ') — cards ficam com "?"');
      continue;
    }

    const extraido = extrairZip(zip);
    const destino = join(dirFotos, uf);
    mkdirSync(destino, { recursive: true });

    let doUf = 0;
    for (const arquivo of readdirSync(extraido)) {
      const m = FOTO_ARQUIVO.exec(arquivo);
      if (!m || !porSq.has(m[1])) continue;            // vice, suplente, leiame.pdf
      const caminho = join(destino, arquivo);
      copyFileSync(join(extraido, arquivo), caminho);
      bytes += statSync(caminho).size;
      /* só a marca: o caminho é derivável de UF + SQ, e repetir ~40 bytes por
       * candidato engordava o JSON de SP em 120 KB (§35) */
      for (const c of porSq.get(m[1])) c.f = 1;
      doUf++;
    }
    rmSync(extraido, { recursive: true, force: true });
    rmSync(zip, { force: true });

    const faltando = porSq.size - doUf;
    semFoto += faltando;
    salvas += doUf;
    log('  ' + uf + ': ' + doUf + ' fotos' + (faltando ? ' (' + faltando + ' sem foto)' : ''));
  }

  log('\n  ' + salvas + ' fotos salvas, ' + (bytes / 1e6).toFixed(0) + ' MB' +
      (semFoto ? ', ' + semFoto + ' candidaturas sem foto no pacote do TSE' : ''));
  return { salvas, semFoto };
}

/* --------------------------------------------------------------- saída */

function escrever(bases, apurado) {
  const dirData = join(RAIZ, 'data');
  const dirUf = join(dirData, 'uf');
  mkdirSync(dirUf, { recursive: true });

  /* limpa apenas o que este script gera, preservando data/photos */
  for (const f of readdirSync(dirUf)) if (f.endsWith('.json')) rmSync(join(dirUf, f));

  let total = 0;
  for (const [uf, base] of [...bases].sort()) {
    const destino = uf === 'BR' ? join(dirData, 'br.json') : join(dirUf, uf + '.json');
    writeFileSync(destino, JSON.stringify(base));
    const n = Object.values(base.cargos).reduce((s, o) => s + Object.keys(o).length, 0);
    total += n;
    log('  ' + uf + ': ' + n + ' candidatos, ' +
        (statSync(destino).size / 1024).toFixed(0) + ' KB');
  }

  writeFileSync(join(dirData, 'meta.json'), JSON.stringify({
    ano: ANO,
    fonte: 'TSE',
    atualizadoEm: new Date().toISOString(),
    geradoPeloTseEm: apurado.geradoPeloTseEm,
    /* false = o TSE ainda não julgou os registros; o site avisa no cabeçalho */
    situacaoPublicada: apurado.situacaoPublicada,
    numerosEmDisputa: apurado.numerosEmDisputa,
    fotos: apurado.fotos,
  }, null, 2));

  log('\n✔ ' + total + ' candidaturas em ' + bases.size + ' bases');
}

/* ---------------------------------------------------------------- probe */

async function tentar(url, metodo = 'GET') {
  try {
    const r = await fetch(url, {
      method: metodo,
      headers: { 'User-Agent': UA, 'Accept': '*/*' },
      redirect: 'follow',
      signal: AbortSignal.timeout(25000),
    });
    return { ok: r.ok, status: r.status, resp: r };
  } catch (e) {
    return { ok: false, status: 0, erro: e.message };
  }
}

/* Descobre os recursos reais no portal e testa os palpites, sem escrever nada. */
async function probe() {
  log('\n── 1. Portal de Dados Abertos (CKAN) — descoberta dos recursos reais');
  log('   página: ' + PORTAL.pagina(ANO) + '\n');

  let achou = false;
  for (const [nome, url] of [['package_show', PORTAL.dataset(ANO)], ['package_search', PORTAL.busca(ANO)]]) {
    const t = await tentar(url);
    if (!t.ok) {
      log('   ✖ ' + nome + ': ' + (t.status || t.erro));
      continue;
    }
    let json;
    try { json = await t.resp.json(); } catch (_) { log('   ✖ ' + nome + ': resposta não é JSON'); continue; }
    const pacotes = json.result?.results || (json.result ? [json.result] : []);
    for (const pkg of pacotes) {
      log('   ✔ dataset "' + (pkg.title || pkg.name) + '"' +
          (pkg.metadata_modified ? '  (modificado em ' + pkg.metadata_modified + ')' : ''));
      for (const r of pkg.resources || []) {
        achou = true;
        log('       [' + (r.format || '?').padEnd(4) + '] ' + (r.name || r.id));
        log('              ' + r.url);
      }
    }
    if (achou) break;
  }
  if (!achou) {
    log('\n   Nenhum recurso listado. Abra a página do dataset no navegador e copie a URL' +
        '\n   do arquivo de candidatos; depois: --fetch --url=<URL>  (ou baixe e use --from-local).');
  }

  log('\n── 2. Palpites codificados (HEAD/GET) — confirmam ou derrubam TSE_SOURCES');
  const resultados = [];
  for (const [nome, url] of PALPITES(ANO)) {
    const t = await tentar(url, 'HEAD');
    const t2 = t.ok || t.status ? t : await tentar(url, 'GET');
    const tam = t2.resp?.headers.get('content-length');
    resultados.push([nome, t2.status || t2.erro, tam]);
    log('   ' + (t2.ok ? '✔' : '✖') + ' ' + String(t2.status || t2.erro).padEnd(6) +
        (tam ? (tam / 1e6).toFixed(1) + ' MB  ' : '        ') + nome);
    log('       ' + url);
  }

  const doAno = resultados.find(r => r[0].startsWith('candidatos ' + ANO));
  const controle = resultados.find(r => r[0].includes('controle'));
  log('\n── 3. Leitura');
  if (doAno && doAno[1] === 200) {
    log('   O pacote de ' + ANO + ' respondeu 200: pode rodar');
    log('     node scripts/update-data.mjs --fetch --ano=' + ANO);
  } else if (controle && controle[1] !== 200) {
    log('   Nem o arquivo de controle (2022, que existe) respondeu 200.');
    log('   → é bloqueio de acesso deste IP, não ausência do arquivo de ' + ANO + '.');
    log('     Baixe pelo navegador e rode: --from-local <arquivo.zip>');
  } else {
    log('   O controle responde mas o de ' + ANO + ' não: o nome do pacote mudou.');
    log('   → use a URL descoberta no passo 1: --fetch --url=<URL>');
  }
  log('');
}

/* ----------------------------------------------------------------- main */

async function main() {
  if (flag('probe')) { await probe(); return; }

  const local = opt('from-local') ||
    (args.includes('--from-local') ? args[args.indexOf('--from-local') + 1] : null);

  if (!local && !flag('fetch')) {
    morrer('escolha a origem dos dados:\n' +
           '  --probe                      descobrir no portal quais recursos existem\n' +
           '  --from-local <dir|zip|csv>   arquivos já baixados do TSE (recomendado)\n' +
           '  --fetch [--url=<URL>]        baixar do TSE agora');
  }

  const origem = local || await baixarDoTse();
  if (local && !existsSync(local)) morrer('caminho inexistente: ' + local);

  log('lendo ' + origem);
  const { dir, arquivos } = csvsEm(origem);

  try {
    const { bases, meta: apurado } = processar(arquivos);
    if (DRY_RUN) {
      log('\n✔ schema validado (--dry-run: nada foi escrito)');
      return;
    }
    if (MODO_FOTOS === 'locais') {
      log('\n── fotos (um ZIP por UF, ~113 MB no total)' +
          (opt('fotos') ? '' : ' — data/photos já existe, use --fotos=nenhuma para remover'));
      const r = await baixarFotos(bases);
      apurado.fotos = r.salvas ? 'locais' : 'nenhuma';
    } else {
      apurado.fotos = 'nenhuma';
    }
    escrever(bases, apurado);
  } catch (e) {
    if (e instanceof ErroDeSchema) morrer(e.message);
    throw e;
  } finally {
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
}

main();
