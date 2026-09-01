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

/* Redes sociais: CONFIRMADO em 2026-08-31. Um zip nacional com um CSV por UF,
 * mais BRASIL.csv (agregado) e BR.csv (presidência). 105.100 linhas. */
const REDES_ZIP_URL = ano =>
  `https://cdn.tse.jus.br/estatistica/sead/odsele/consulta_cand/rede_social_candidato_${ano}.zip`;

const COLUNAS_REDES = ['SG_UF', 'SQ_CANDIDATO', 'NR_ORDEM_REDE_SOCIAL', 'DS_URL'];

/* Domínio → código da rede. O casamento é por **sufixo**, então um domínio
 * cobre seus subdomínios: `facebook.com` pega `web.`, `m.`, `pt-br.`, e
 * `instagram.com` pega o `l.instagram.com` que o próprio Instagram usa como
 * intermediário. A tabela cresce olhando o relatório do build, que lista os
 * domínios mais frequentes caídos no genérico. */
const REDES = [
  ['instagram.com', 'i'],
  ['facebook.com', 'f'], ['m.me', 'f'], ['fb.com', 'f'], ['fb.watch', 'f'],
  ['tiktok.com', 't'],
  ['youtube.com', 'y'], ['youtu.be', 'y'],
  ['x.com', 'x'], ['twitter.com', 'x'],
  ['threads.com', 'h'], ['threads.net', 'h'],
  ['linkedin.com', 'l'],
  ['kwai.com', 'k'], ['kwai-video.com', 'k'], ['kw.ai', 'k'],
  ['bsky.app', 'b'],
  ['spotify.com', 'p'],
  ['soundcloud.com', 'o'],
  ['flickr.com', 'c'],
  ['linktr.ee', 'n'], ['tr.ee', 'n'], ['beacons.ai', 'n'], ['bio.link', 'n'],
  ['t.me', 'g'], ['telegram.me', 'g'], ['telegram.org', 'g'],
  ['whatsapp.com', 'w'], ['wa.me', 'w'],
];

const codigoDaRede = host => {
  for (const [dominio, cod] of REDES) {
    if (host === dominio || host.endsWith('.' + dominio)) return cod;
  }
  return 's';
};

/* Duas formas de declarar sem link nenhum: "INSTAGRAM - @FULANO" (849 linhas,
 * a rede dita por extenso) e "@FULANO" avulso (1.670 linhas). Nas duas dá para
 * montar a URL; no @ avulso, sem rede nomeada, montamos Instagram e X.
 *
 * Isso é FALLBACK, não dado declarado: perde para o link real da mesma rede e
 * só ocupa vaga que sobrou depois dos declarados. A razão está medida - entre
 * quem declarou Instagram E X de verdade, só 35% usam o mesmo usuário nas duas
 * (32% no Facebook, 42% no TikTok), então usuário inferido erra com frequência.
 * WhatsApp fica de fora porque lá o identificador é telefone, não usuário. */
const REDE_POR_NOME = [
  [/\bINSTAGRAM\b|\bINSTA\b/i, 'i'],
  [/\bFACEBOOK\b|\bFACE\b|\bFB\b/i, 'f'],
  [/\bTIK\s?TOK\b/i, 't'],
  [/\bYOU\s?TUBE\b/i, 'y'],
  [/\bTWITTER\b/i, 'x'],
  [/\bTHREADS\b/i, 'h'],
  [/\bLINKED\s?IN\b/i, 'l'],
  [/\bKWAI\b/i, 'k'],
  [/\bTELEGRAM\b/i, 'g'],
  [/\bBLUESKY\b/i, 'b'],
  /* nomeada mas sem montador: no WhatsApp o identificador é telefone, então não
     há URL de perfil a montar. O @usuário ao lado ainda serve de propagado. */
  [/\bWHATSAPP\b|\bZAP\b/i, 'w'],
];

const PERFIL_DE_REDE = {
  i: h => 'https://instagram.com/' + h.toLowerCase(),
  f: h => 'https://facebook.com/' + h.toLowerCase(),
  x: h => 'https://x.com/' + h.toLowerCase(),
  t: h => 'https://tiktok.com/@' + h.toLowerCase(),
  y: h => 'https://youtube.com/@' + h,
  h: h => 'https://threads.com/@' + h.toLowerCase(),
  l: h => 'https://linkedin.com/in/' + h.toLowerCase(),
  k: h => 'https://kwai.com/@' + h.toLowerCase(),
  g: h => 'https://t.me/' + h,
  b: h => 'https://bsky.app/profile/' + h.toLowerCase(),
};

/* só ASCII: nome de usuário com acento existe (YouTube aceita), mas montar a
 * URL a partir de texto solto acentuado erra mais do que acerta */
const USUARIO = /@\s*([A-Za-z0-9._-]{2,40})/;

/* Redes inferidas quando o texto não nomeia nenhuma. O @ avulso é quase sempre
 * Instagram; X entra atrás dele, e as duas só aparecem como fallback. */
/* Um @usuário rende, no máximo, três coisas:
 *
 *   NOMEADO      a rede que o próprio texto cita ("INSTAGRAM - @FULANO"): a rede
 *                é declaração dele, só o formato da URL é nosso;
 *   PROPAGADO    Instagram, X, TikTok, Facebook e Threads montados do mesmo
 *                usuário, mesmo sem o texto citá-los. Quem escreve só o arroba
 *                está falando de alguma dessas - mas de qual, e se o usuário é
 *                o mesmo em todas, é aposta nossa. Quem só declarou um @ fica,
 *                no limite, com cinco ícones inferidos: é o caso de aposta
 *                máxima.
 *
 *                YouTube ficou FORA de propósito: lá o @ é espaço de nomes
 *                separado, que precisa ser reivindicado, e sem dono a URL dá
 *                404 - o palpite não erra de perfil, erra de página. Threads é
 *                o oposto e o melhor da lista: a conta nasce do Instagram, com
 *                o mesmo usuário.
 *
 *                Medido, entre quem declarou Instagram e a outra rede de
 *                verdade: mesmo usuário em 96% no Threads, 42% no TikTok, 37%
 *                no YouTube, 35% no X e 32% no Facebook.
 *
 * Os dois níveis existem para o nomeado nunca perder vaga para o propagado. */
const NOMEADO = 1, PROPAGADO = 2;
const INFERIDAS = ['i', 'x', 't', 'f', 'h'];

/* Devolve [[cod, url, nivel], ...] a partir de texto livre, ou [] quando não há
 * nada aproveitável. */
function perfisDeTextoLivre(texto) {
  const m = texto.match(USUARIO);
  if (!m) return [];
  /* "@fulano@gmail.com" é e-mail escrito com arroba na frente, não usuário */
  if (texto[m.index + m[0].length] === '@') return [];
  const usuario = m[1].replace(/[._-]+$/, '');
  if (usuario.length < 2) return [];
  /* "@fulano.com.br" é domínio no campo errado, e "@gmail.com" é e-mail */
  if (/\.[a-z]{2,}$/i.test(usuario)) return [];

  const nomeada = REDE_POR_NOME.find(([re]) => re.test(texto));
  const niveis = new Map();
  if (nomeada) niveis.set(nomeada[1], NOMEADO);
  for (const cod of INFERIDAS) if (!niveis.has(cod)) niveis.set(cod, PROPAGADO);

  return [...niveis]
    .filter(([cod]) => PERFIL_DE_REDE[cod])
    .map(([cod, nivel]) => [cod, PERFIL_DE_REDE[cod](usuario), nivel]);
}



/* Dentro do balde genérico "site" moram duas coisas bem diferentes: o site
 * próprio do candidato e uma página dele numa plataforma qualquer (catálogo de
 * streaming, encurtador, listagem de app, página de apoio). Só a primeira é o
 * "site oficial" que a prioridade promete. Sem separar, o Lula aparecia com um
 * link de podcast no lugar de lula.com.br. Não descartamos a plataforma: ela só
 * perde a vez para o site próprio. */
const PLATAFORMA_GENERICA = [
  'deezer.com', 'music.amazon.com', 'music.amazon.com.br', 'music.apple.com',
  'podcasts.apple.com', 'apps.apple.com', 'play.google.com',
  'docs.google.com', 'drive.google.com', 'share.google', 'sites.google.com',
  'bit.ly', 'tinyurl.com', 'cutt.ly', 'encurtador.com.br',
  'twibbonize.com', 'twb.nz', 'sticker.ly', 'bio.site',
  'queroapoiar.com.br', 'apoio.top', 'apoiar.me',
  'tse.jus.br',   /* houve quem colasse a URL do formulário de candidatura */
];

const ehPlataforma = host =>
  PLATAFORMA_GENERICA.some(d => host === d || host.endsWith('.' + d));

/* Ordem de exibição, e ordem do corte em MAX_REDES. As cinco redes de maior
 * alcance na frente, por pedido de produto; WhatsApp por último, porque abre
 * conversa privada e não perfil. */
const PRIORIDADE_REDES =
  ['i', 'x', 't', 'f', 'y', 's', 'h', 'l', 'k', 'b', 'p', 'o', 'c', 'n', 'g', 'w'];
/*  instagram x tiktok facebook youtube | site threads linkedin kwai bluesky
    spotify soundcloud flickr linktree telegram whatsapp

    As cinco primeiras são as cinco vagas da tela. O site próprio vem logo
    atrás: aparece sempre que falta alguma das cinco, e só perde quando o
    candidato tem todas. */

const MAX_REDES = 5;

/* Parâmetros de rastreio: sujam o link, não fazem falta e ainda carregam
 * identificador sensível a caixa. 22% das URLs trazem algum. */
const PARAM_DE_RASTREIO =
  /^(igsh|igshid|xmt|_r|_t|_u|mibextid|fbclid|gclid|si|is|feature|ref|ref_src|ref_url|utm_[a-z_]+)$/i;

/* O TSE grava 79% das URLs em CAIXA ALTA. Nome de usuário é insensível a caixa
 * em todas as redes grandes, então o link continua funcionando — mas caminho de
 * identificador opaco (/share/ do Facebook, /channel/ do YouTube, youtu.be) NÃO
 * é: em maiúsculas está quebrado. Melhor não oferecer link morto. */
const CAMINHO_OPACO = /^\/(share|channel|watch|reel|p|video|posts)\b/i;

/* O TSE corta DS_URL em 80 caracteres: 1.900 linhas param exatamente aí, contra
 * ~150 em cada comprimento vizinho. Quase sempre o corte cai na query de
 * rastreio, que a gente joga fora de qualquer jeito; mas em 203 linhas ele
 * decepa o caminho e o link nasce morto - foi assim que o "site oficial" do
 * Lula virou um endereço de podcast terminado em "/PODCAS". */
const CORTE_DO_TSE = 80;

/* O campo é texto livre, e sem checar o TLD viravam "site próprio" coisas como
 * "@FULANO.OFICIAL", "LUCIANALANA.PARTICULAR" e "INSTAGRAM.COMLAINNIOSOARES"
 * (barra esquecida depois do .com) - domínios que não existem.
 *
 * A lista da IANA é a única fonte que resolve isso sem chute. Se ela não
 * responder, o filtro fica DESLIGADO, não reduzido a uma lista curta: uma lista
 * pela metade derrubaria link bom em silêncio (`.website`, `.ly`, `.kr`, `.sc`
 * são reais e apareceram na base). Voltam ~30 links de domínio inexistente, o
 * que é bem menos grave, e o log diz que aconteceu. */
const TLD_URL = 'https://data.iana.org/TLD/tlds-alpha-by-domain.txt';
let TLDS = null;

/* usada pelos testes, para exercitar a regra com uma lista conhecida */
function definirTlds(lista) { TLDS = lista ? new Set(lista) : null; }

async function carregarTlds() {
  try {
    const r = await fetch(TLD_URL, { headers: { 'User-Agent': UA },
                                     signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const lista = (await r.text()).split('\n')
      .map(l => l.trim().toLowerCase())
      .filter(l => l && !l.startsWith('#'));
    if (lista.length < 500) throw new Error('lista curta demais (' + lista.length + ')');
    definirTlds(lista);
    log('  ' + TLDS.size + ' TLDs válidos, da IANA');
  } catch (e) {
    definirTlds(null);
    log('  ⚠ IANA indisponível (' + e.message + ') — sem checagem de TLD nesta rodada');
  }
}



/* redes cujo @ é insensível a caixa: dá para normalizar o caminho e ainda
 * conserta coisas como /PROFILE.PHP, que em maiúsculas o Facebook não serve */
const CAIXA_LIVRE = new Set(['i', 'f', 'x', 't', 'h']);

/* Endereço de e-mail no campo de URL: virar link seria vetor de spam. */
const PROVEDOR_DE_EMAIL = /^(gmail|hotmail|outlook|yahoo|live|icloud|bol|uol|terra|msn)\./;

/* Erro de digitação em domínio de rede conhecida. Não são linkados: quem
 * registra o domínio errado de propósito conta com esse clique. */
const DOMINIO_TYPO =
  /^(instagran|intagram|instragram|instagam|nstagram|instragam|faceboock|facebok|facebbok|twiter|youtub)\.|^(instagram|facebook|youtube|tiktok)\.com\.br$/;

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

/* mesma postura das fotos: rodar sem a flag não pode apagar o que já existe */
const TEM_REDES_LOCAIS = existsSync(new URL('../data/redes', import.meta.url).pathname);
const MODO_REDES = opt('redes') || (TEM_REDES_LOCAIS ? 'locais' : 'nenhuma');
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

function validarHeader(header, arquivo, exigidas = COLUNAS_EXIGIDAS, nomeDaLista = 'COLUNAS_EXIGIDAS') {
  const faltando = exigidas.filter(c => !header.includes(c));
  if (faltando.length) {
    throw new ErroDeSchema(
      'schema do TSE mudou em ' + arquivo + '\n' +
      '  colunas exigidas ausentes: ' + faltando.join(', ') + '\n' +
      '  colunas encontradas (' + header.length + '): ' + header.join(', ') + '\n' +
      '  → confira ' + nomeDaLista + ' em scripts/update-data.mjs (§53)'
    );
  }
}

/* -------------------------------------------------------------- entrada */

/* diretório único por chamada: com um nome fixo, extrair um segundo zip
 * enquanto o primeiro ainda está em uso misturava os dois conteúdos */
let extracoes = 0;

function extrairZip(zip) {
  const destino = join(tmpdir(), 'santinho-tse-' + process.pid + '-' + (++extracoes));
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

  /* Se as fotos já estão em disco, só reaponta os registros — rebaixar 113 MB
   * a cada execução para recalcular a mesma flag é desperdício. --fotos=refazer
   * força o download. */
  if (MODO_FOTOS !== 'refazer' && existsSync(dirFotos)) {
    let reaproveitadas = 0;
    for (const [uf, base] of bases) {
      const dirUf = join(dirFotos, uf);
      if (!existsSync(dirUf)) continue;
      const temFoto = new Set();
      for (const arquivo of readdirSync(dirUf)) {
        const m = FOTO_ARQUIVO.exec(arquivo);
        if (m) temFoto.add(m[1]);
      }
      for (const cargo of Object.values(base.cargos)) {
        for (const c of Object.values(cargo)) {
          if (c.sq && temFoto.has(c.sq)) { c.f = 1; reaproveitadas++; }
        }
      }
    }
    if (reaproveitadas) {
      log('  ' + reaproveitadas + ' fotos reaproveitadas de data/photos ' +
          '(use --fotos=refazer para baixar de novo)');
      return { salvas: reaproveitadas, semFoto: 0 };
    }
  }

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

/* --------------------------------------------------------- redes sociais */

/* O campo DS_URL é texto livre na prática: 10% das linhas não trazem URL alguma
 * ("@LOBOPVH_RO", "INSTAGRAM: @nome") e 6% embutem a URL numa frase
 * ("TWITTER - HTTPS://WWW.TWITTER.COM/..."). Devolve { host, url } ou null. */
function normalizarUrlRede(bruto) {
  let u = (bruto || '').trim();
  if (!u) return null;
  const truncado = u.length === CORTE_DO_TSE;

  /* para em um segundo "https://": há linha com duas URLs coladas */
  const embutida = u.match(/https?:\/\/(?:(?!https?:\/\/)[^\s"<>])+/i);
  if (embutida) u = embutida[0];
  else if (/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}(\/|\?|$)/i.test(u)) u = 'https://' + u;
  else return null;   /* texto livre é assunto de perfisDeTextoLivre() */

  try {
    const o = new URL(u);
    if (!/^https?:$/.test(o.protocol)) return null;
    const host = o.hostname.toLowerCase().replace(/^www\./, '');
    if (!host.includes('.')) return null;
    if (TLDS && !TLDS.has(host.split('.').pop())) return null;

    for (const chave of [...o.searchParams.keys()]) {
      if (PARAM_DE_RASTREIO.test(chave)) o.searchParams.delete(chave);
    }
    o.hash = '';

    const cod = codigoDaRede(host);
    /* normaliza o host só de rede conhecida: site próprio pode depender do www */
    if (cod !== 's') o.hostname = host;
    const semMinuscula = !/[a-z]/.test(o.pathname);
    if (semMinuscula && (CAMINHO_OPACO.test(o.pathname) || host === 'youtu.be')) return null;
    if (CAIXA_LIVRE.has(cod)) o.pathname = o.pathname.toLowerCase();

    /* De uma linha cortada só dá para aproveitar o perfil de um nível só
     * (/fulano): ali o corte pegou a query, que a gente descartaria de todo
     * jeito. Caminho mais fundo veio decepado, e /profile.php sem a query não
     * identifica ninguém. */
    if (truncado) {
      o.search = '';
      const niveis = o.pathname.split('/').filter(Boolean);
      if (niveis.length > 1 || /\.php$/i.test(o.pathname)) return null;
    }

    /* Numa rede a identidade está no caminho: sem caminho, o link cai na home
     * da rede e não mostra ninguém. Aparecia 33 vezes, de linha como
     * "INSTAGRAM.COM/HTTPS://WWW.THREADS.NET/@FULANO", onde a URL de dentro é
     * descartada e sobra só o domínio. Site próprio pode ser só o domínio. */
    if (cod !== 's' && o.pathname === '/') return null;

    return { host, cod, url: o.href };
  } catch (_) {
    return null;
  }
}

/* Primeiro trecho do caminho que não é usuário, e sim prefixo de rota ou
 * identificador opaco */
const CAMINHO_SEM_USUARIO = new Set(['profile.php', 'people', 'share', 'channel',
  'watch', 'reel', 'p', 'video', 'posts', 'in', 'photos', 'user', 'u', 'c',
  'show', 'artist', 'pages', 'groups']);

function usuarioDaUrl(url) {
  try {
    const seg = new URL(url).pathname.split('/').filter(Boolean);
    if (!seg.length) return null;
    const u = decodeURIComponent(seg[0]).replace(/^@/, '').toLowerCase();
    if (CAMINHO_SEM_USUARIO.has(u)) return null;
    return /^[a-z0-9._-]{2,40}$/.test(u) ? u : null;
  } catch (_) {
    return null;
  }
}

/* O usuário que o candidato repete em mais redes distintas.
 *
 * Serve de desempate dentro de uma rede em que ele declarou mais de um perfil.
 * O Lula é o caso: ele pôs @lulaoficial em primeiro no Instagram, mas no X
 * deixou @obrasilcomlula (ordem 16) na frente de @lulaoficial (ordem 17) - e o
 * card mostrava duas contas diferentes da mesma pessoa, lado a lado. Contando
 * as redes, @lulaoficial aparece em seis (Instagram, X, YouTube, TikTok, Kwai,
 * Flickr) contra duas de @obrasilcomlula, então ele é o canônico.
 *
 * Exige presença em pelo menos duas redes DECLARADAS: usuário visto numa só não
 * é evidência de nada, e usuário inferido não é evidência nenhuma. Empate
 * resolve pela menor ordem declarada. */
function usuarioCanonico(itens) {
  const redes = new Map();       // usuário -> Set de códigos de rede
  const menorOrdem = new Map();
  for (const it of itens) {
    if (it.cod === 's') continue;            // site não tem usuário
    /* só link declarado vota: link inferido foi montado por nós a partir de um
     * arroba, então contá-lo como evidência daquele mesmo arroba é circular -
     * e chegava a virar a escolha entre duas URLs declaradas em outra rede */
    if (it.inferido) continue;
    const u = usuarioDaUrl(it.url);
    if (!u) continue;
    if (!redes.has(u)) redes.set(u, new Set());
    redes.get(u).add(it.cod);
    menorOrdem.set(u, Math.min(menorOrdem.get(u) ?? Infinity, it.ordem));
  }
  let melhor = null;
  for (const [u, cods] of redes) {
    if (cods.size < 2) continue;
    const cand = { u, redes: cods.size, ordem: menorOrdem.get(u) };
    if (!melhor || cand.redes > melhor.redes ||
        (cand.redes === melhor.redes && cand.ordem < melhor.ordem)) melhor = cand;
  }
  return melhor ? melhor.u : null;
}

/* Dedupe por rede, ordena por prioridade e corta em MAX_REDES.
 *
 * Três desempates, em ordem:
 *
 * 1. link declarado (0) passa na frente da rede nomeada no texto (1), que passa
 *    na frente do usuário propagado para Instagram/X (2) - o @ é fallback, e não
 *    pode roubar a vaga de um link que o candidato deu;
 * 2. site próprio passa na frente de plataforma genérica;
 * 3. o usuário canônico do candidato (o que ele repete em mais redes) passa na
 *    frente dos outros perfis dele na mesma rede - ver usuarioCanonico();
 * 4. por fim vale o NR_ORDEM_REDE_SOCIAL, a ordem que o próprio candidato
 *    declarou (o CSV não vem ordenado por ela). Ignorá-la fazia o "site oficial"
 *    do Patrus virar patrusgovernador.com.br (ordem 5, que nem responde) no
 *    lugar de patrusananias.com.br (ordem 1).
 *
 * O corte em MAX_REDES respeita o item 1: os declarados enchem as vagas antes
 * de qualquer inferido. Só a exibição volta a ser pela PRIORIDADE_REDES, para
 * a fileira de ícones ficar sempre na mesma ordem. */
function escolherRedes(lista) {
  const ordenada = lista.map(([cod, url, ordem, inferido], i) => {
    let plataforma = false;
    if (cod === 's') {
      try { plataforma = ehPlataforma(new URL(url).hostname.replace(/^www\./, '')); }
      catch (_) { /* URL já veio validada; se não parsear, trata como site */ }
    }
    /* 0 declarado · 1 rede nomeada no texto · 2 usuário propagado */
    return { cod, url, plataforma, inferido: Number(inferido) || 0,
             usuario: usuarioDaUrl(url),
             ordem: Number.isFinite(ordem) ? ordem : i };
  });

  const canonico = usuarioCanonico(ordenada);
  const foraDoCanonico = it => (canonico && it.usuario !== canonico ? 1 : 0);

  ordenada.sort((a, b) => (a.inferido - b.inferido) ||
                          (a.plataforma - b.plataforma) ||
                          (foraDoCanonico(a) - foraDoCanonico(b)) ||
                          (a.ordem - b.ordem));

  const vistos = new Set();
  const unicos = [];
  for (const item of ordenada) {
    if (vistos.has(item.cod)) continue;
    vistos.add(item.cod);
    unicos.push(item);
  }

  /* Declarado primeiro; dentro de cada grupo, a prioridade decide quem fica
   * com as vagas */
  unicos.sort((a, b) => (a.inferido - b.inferido) ||
    (PRIORIDADE_REDES.indexOf(a.cod) - PRIORIDADE_REDES.indexOf(b.cod)));
  const escolhidas = unicos.slice(0, MAX_REDES);
  escolhidas.sort((a, b) =>
    PRIORIDADE_REDES.indexOf(a.cod) - PRIORIDADE_REDES.indexOf(b.cod));
  return escolhidas.map(({ cod, url }) => [cod, url]);
}

/* Baixa o zip nacional e escreve data/redes/<escopo>.json com no máximo três
 * links por candidatura, só para os SQ que estão na base. O escopo vem da nossa
 * base, não do SG_UF do CSV, para o arquivo casar com o que o front procura. */
async function baixarRedes(bases) {
  await carregarTlds();
  const url = REDES_ZIP_URL(ANO);
  let zip;
  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(300000),
    });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    zip = join(tmpdir(), 'santinho-redes-' + process.pid + '.zip');
    writeFileSync(zip, Buffer.from(await resp.arrayBuffer()));
  } catch (e) {
    log('  redes indisponíveis (' + e.message + ') — os cards ficam sem ícone');
    return { salvas: 0 };
  }

  const escopoDoSq = new Map();
  for (const [uf, base] of bases) {
    for (const cargo of Object.values(base.cargos)) {
      for (const c of Object.values(cargo)) if (c.sq) escopoDoSq.set(c.sq, uf);
    }
  }

  const extraido = extrairZip(zip);
  const porEscopo = new Map();
  const genericos = new Map();
  let lidas = 0, semUrl = 0, recuperadas = 0, emails = 0, typos = 0, inferidas = 0;

  for (const arquivo of readdirSync(extraido)) {
    if (extname(arquivo).toLowerCase() !== '.csv') continue;
    /* BRASIL.csv é o agregado: repete linha por linha o que já está nos
     * arquivos por UF (conferido: os dois conjuntos são idênticos). Ler os dois
     * dobrava o trabalho e inflava em 2x todos os números do relatório. */
    if (/BRASIL/i.test(arquivo)) continue;
    const { header, linhas } = lerCsv(readFileSync(join(extraido, arquivo)));
    validarHeader(header, arquivo, COLUNAS_REDES, 'COLUNAS_REDES');
    const col = Object.fromEntries(header.map((h, i) => [h, i]));

    for (const l of linhas) {
      if (l.length < header.length) continue;
      const sq = (l[col.SQ_CANDIDATO] ?? '').trim();
      const escopo = escopoDoSq.get(sq);
      if (!escopo) continue;                    // vice, suplente, fora da base

      const bruto = (l[col.DS_URL] ?? '').trim();
      const ordem = Number(l[col.NR_ORDEM_REDE_SOCIAL]);
      lidas++;

      /* achados: [cod, url, ordem, inferido] */
      const achados = [];
      const n = normalizarUrlRede(bruto);
      if (n) {
        if (PROVEDOR_DE_EMAIL.test(n.host)) { emails++; continue; }
        if (DOMINIO_TYPO.test(n.host)) { typos++; continue; }
        if (!/^https?:\/\//i.test(bruto)) recuperadas++;
        if (n.cod === 's') genericos.set(n.host, (genericos.get(n.host) || 0) + 1);
        achados.push([n.cod, n.url, ordem, false]);
      } else {
        /* sem URL: sobra o @usuário, como fallback */
        for (const [cod, url, nivel] of perfisDeTextoLivre(bruto)) {
          achados.push([cod, url, ordem, nivel]);
        }
        if (achados.length) inferidas++; else { semUrl++; continue; }
      }

      if (!porEscopo.has(escopo)) porEscopo.set(escopo, new Map());
      const mapa = porEscopo.get(escopo);
      if (!mapa.has(sq)) mapa.set(sq, []);
      for (const a of achados) mapa.get(sq).push(a);
    }
  }
  rmSync(extraido, { recursive: true, force: true });
  rmSync(zip, { force: true });

  const dirRedes = join(RAIZ, 'data', 'redes');
  rmSync(dirRedes, { recursive: true, force: true });
  mkdirSync(dirRedes, { recursive: true });

  let comRede = 0, links = 0;
  for (const [escopo, mapa] of [...porEscopo].sort()) {
    const saida = {};
    for (const [sq, lista] of mapa) {
      const escolhidas = escolherRedes(lista);
      if (!escolhidas.length) continue;
      saida[sq] = escolhidas;
      comRede++;
      links += escolhidas.length;
    }
    const destino = join(dirRedes, escopo + '.json');
    writeFileSync(destino, JSON.stringify(saida));
    log('  ' + escopo + ': ' + Object.keys(saida).length + ' candidatos, ' +
        (statSync(destino).size / 1024).toFixed(0) + ' KB');
  }

  log('\n  ' + lidas + ' linhas consideradas · ' + recuperadas +
      ' URLs recuperadas de texto livre · ' + inferidas + ' @usuários inferidos (fallback)');
  log('  descartadas: ' + semUrl + ' sem URL ou link opaco em caixa alta, ' +
      emails + ' e-mails, ' + typos + ' domínios-typo');
  log('  ' + comRede + ' de ' + escopoDoSq.size + ' candidaturas com rede (' +
      Math.round(comRede / escopoDoSq.size * 100) + '%), ' + links + ' links no total');

  if (genericos.size) {
    const topo = [...genericos].sort((a, b) => b[1] - a[1]).slice(0, 20);
    log('\n  domínios no ícone genérico de site (' + genericos.size + ' distintos); ' +
        'os 20 mais frequentes, para crescer a tabela REDES:');
    for (const [h, n] of topo) log('     ' + String(n).padStart(5) + '  ' + h);
  }

  return { salvas: comRede };
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
    redes: apurado.redes,
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
           '  --fetch [--url=<URL>]        baixar do TSE agora\n' +
           '\n  extras: --fotos=locais|nenhuma  --redes=locais|nenhuma');
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
    if (MODO_FOTOS === 'locais' || MODO_FOTOS === 'refazer') {
      log('\n── fotos (um ZIP por UF, ~113 MB no total)' +
          (opt('fotos') ? '' : ' — data/photos já existe, use --fotos=nenhuma para remover'));
      const r = await baixarFotos(bases);
      apurado.fotos = r.salvas ? 'locais' : 'nenhuma';
    } else {
      apurado.fotos = 'nenhuma';
    }

    if (MODO_REDES === 'locais') {
      log('\n── redes sociais (um zip nacional, 2,5 MB)' +
          (opt('redes') ? '' : ' — data/redes já existe, use --redes=nenhuma para remover'));
      const r = await baixarRedes(bases);
      apurado.redes = r.salvas ? 'locais' : 'nenhuma';
    } else {
      apurado.redes = 'nenhuma';
    }

    escrever(bases, apurado);
  } catch (e) {
    if (e instanceof ErroDeSchema) morrer(e.message);
    throw e;
  } finally {
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
}

/* importado pelos testes com SANTINHO_IMPORTADOR_TESTE=1, para exercitar as
 * funções puras sem executar o pipeline */
if (process.env.SANTINHO_IMPORTADOR_TESTE !== '1') main();

export { normalizarUrlRede, escolherRedes, codigoDaRede, perfisDeTextoLivre, ehPlataforma,
         definirTlds,
         usuarioDaUrl, usuarioCanonico, PRIORIDADE_REDES, MAX_REDES,
         PROVEDOR_DE_EMAIL, DOMINIO_TYPO };
