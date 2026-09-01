/* santinho.art — cola eleitoral 2026
 *
 * Arquitetura de digitação (§22-28): cada card tem UM input mestre invisível
 * que guarda o número inteiro. As casinhas de dígito são apenas <span>s.
 * O input nunca fica vazio (usa '-' como marca de dígito ausente) e mantém
 * sempre um caractere selecionado — é isso que faz o Gboard emitir
 * `deleteContentBackward` de forma confiável, causa raiz do bug clássico de
 * backspace no Android. Todo `beforeinput` é cancelado: o estado é 100% nosso.
 */
'use strict';

/* ------------------------------------------------------------- constantes */

/* sigla + nome por extenso, na ordem alfabética de sigla usada no seletor */
const UFS = [
  ['AC', 'Acre'],              ['AL', 'Alagoas'],
  ['AP', 'Amapá'],             ['AM', 'Amazonas'],
  ['BA', 'Bahia'],             ['CE', 'Ceará'],
  ['DF', 'Distrito Federal'],  ['ES', 'Espírito Santo'],
  ['GO', 'Goiás'],             ['MA', 'Maranhão'],
  ['MT', 'Mato Grosso'],       ['MS', 'Mato Grosso do Sul'],
  ['MG', 'Minas Gerais'],      ['PA', 'Pará'],
  ['PB', 'Paraíba'],           ['PR', 'Paraná'],
  ['PE', 'Pernambuco'],        ['PI', 'Piauí'],
  ['RJ', 'Rio de Janeiro'],    ['RN', 'Rio Grande do Norte'],
  ['RS', 'Rio Grande do Sul'], ['RO', 'Rondônia'],
  ['RR', 'Roraima'],           ['SC', 'Santa Catarina'],
  ['SP', 'São Paulo'],         ['SE', 'Sergipe'],
  ['TO', 'Tocantins'],
];
const NOME_DA_UF = new Map(UFS);
const UF_PADRAO = 'SP';
const REGIOES = [
  ['N', 'Norte', ['AC', 'AP', 'AM', 'PA', 'RO', 'RR', 'TO']],
  ['NE', 'Nordeste', ['AL', 'BA', 'CE', 'MA', 'PB', 'PE', 'PI', 'RN', 'SE']],
  ['CO', 'Centro-Oeste', ['DF', 'GO', 'MS', 'MT']],
  ['SE', 'Sudeste', ['ES', 'MG', 'RJ', 'SP']],
  ['S', 'Sul', ['PR', 'RS', 'SC']],
];
const REGIAO_DA_UF = new Map(REGIOES.flatMap(([key, , ufs]) => ufs.map(uf => [uf, key])));

/* bandeiras baixadas por scripts/update-flags.mjs */
const bandeiraDaUf = uf => 'assets/flags/' + uf + '.png';

/* ordem eleitoral do §3 — não reordenar */
const CARGOS = [
  { key:'df', len:4, base:'df', nacional:false, legenda:true,
    label:'Deputado federal',   curto:'Dep. federal' },
  { key:'de', len:5, base:'de', nacional:false, legenda:true,
    label:'Deputado estadual',  curto:'Dep. estadual',
    labelDF:'Deputado distrital', curtoDF:'Dep. distrital' },
  { key:'s1', len:3, base:'s',  nacional:false, legenda:false,
    label:'Senador · 1ª vaga',  curto:'1º senador' },
  { key:'s2', len:3, base:'s',  nacional:false, legenda:false,
    label:'Senador · 2ª vaga',  curto:'2º senador' },
  { key:'g',  len:2, base:'g',  nacional:false, legenda:false,
    label:'Governador',        curto:'Governador' },
  { key:'p',  len:2, base:'p',  nacional:true,  legenda:false,
    label:'Presidente',        curto:'Presidente' },
];
const POR_KEY = Object.fromEntries(CARGOS.map(c => [c.key, c]));

/* marca de dígito ausente no input mestre; nunca chega à tela */
const VAZIO = '-';

/* Situações de candidatura aceitas para exibição (§13). O importador normaliza
 * o código do TSE em uma letra: A = apta, P = pendente/sub judice, X = inapta,
 * N = não informada. Mudar a regra aqui NÃO exige reprocessar a base.
 *
 * 'N' está na lista porque, no pacote de 2026, o TSE ainda não publicou o
 * julgamento dos registros: 100% das candidaturas vêm com situação "#NE".
 * Excluir 'N' hoje esconderia a base inteira. O cabeçalho avisa que a situação
 * não foi julgada (ver meta.situacaoPublicada). Quando o TSE publicar, remover
 * 'N' daqui passa a ser a postura correta. */
const SITUACOES_EXIBIVEIS = new Set(['A', 'N']);

/* hosts autorizados para foto (§38) — nada fora daqui é carregado */
const FOTO_HOSTS = new Set(['divulgacandcontas.tse.jus.br', 'cdn.tse.jus.br']);

/* Cor do partido (§16, primeira opção da lista: "derivada do partido").
 * Vem de data/cores-partidos.json, gerado de uma fonte citável (Wikidata P465)
 * por scripts/update-party-colors.mjs. Sigla sem cor conhecida cai na paleta
 * por hash abaixo — nenhuma legenda fica sem identidade nem ganha destaque. */
const PALETA = ['#8b8d94','#6b6d73','#5a5c62','#7d7f86','#4a4c52',
                '#9a9ca2','#63656b','#74767d','#53555b','#84868d'];

/* ------------------------------------------------------------------ estado */

const state = {
  uf: UF_PADRAO,
  votes: {},     // key -> Array(len) com dígito (string) ou null
  focus: null,   // { key, index } ou null
  /* ordem em que cada cargo foi mexido — contador monotônico, não relógio:
   * determinístico e suficiente para saber qual vaga é a mais antiga (§21) */
  mexidoEm: {},
};
let relogioDeEdicao = 0;
const marcarMexido = key => { state.mexidoEm[key] = ++relogioDeEdicao; };

const bases = new Map();     // 'SP' | 'BR' -> { status, cargos, partidos }
const carregando = new Map();
let meta = null;
let coresDePartido = {};     // sigla -> 'rrggbb'

/* páginas de 50 no scroll infinito: com a lista completa aberta, montar 2.570
 * linhas de uma vez é desperdício */
const PAGINA_BUSCA = 50;

const els = {
  cards:     document.getElementById('cards'),
  buscaTrigger: document.getElementById('busca-trigger'),
  buscaDialog:  document.getElementById('busca-dialog'),
  buscaInput:   document.getElementById('busca-input'),
  buscaLista:   document.getElementById('busca-lista'),
  buscaClose:   document.getElementById('busca-close'),
  buscaContagem: document.getElementById('busca-contagem'),
  ufTrigger: document.getElementById('uf-trigger'),
  ufPlaca:   document.getElementById('uf-placa-trigger'),
  ufFlag:    document.getElementById('uf-flag'),
  ufSigla:   document.getElementById('uf-sigla'),
  ufDialog:  document.getElementById('uf-dialog'),
  ufList:    document.getElementById('uf-list'),
  ufClose:   document.getElementById('uf-close'),
  ufBusca:    document.getElementById('uf-busca'),
  ufFiltros:  document.getElementById('uf-filtros'),
  ufContagem: document.getElementById('uf-contagem'),
  buscaFiltros: document.getElementById('busca-filtros'),
  buscaFiltrosPartidos: document.getElementById('busca-filtros-partidos'),
  share:     document.getElementById('share'),
  status:    document.getElementById('status'),
  toast:     document.getElementById('toast'),
};

/* -------------------------------------------------------------- dados (§43) */

function urlDaBase(escopo) {
  return escopo === 'BR' ? 'data/br.json' : 'data/uf/' + escopo + '.json';
}

/* Carrega sob demanda e nunca bloqueia a interface. Falha virou estado
 * 'error', que o front trata como "indeterminado" — jamais como INVÁLIDO. */
function loadElectionData(escopo) {
  if (bases.has(escopo)) return Promise.resolve(bases.get(escopo));
  if (carregando.has(escopo)) return carregando.get(escopo);

  const p = fetch(urlDaBase(escopo))
    .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(json => ({
      status: 'ok',
      cargos: json.cargos || {},
      partidos: json.partidos || {},
    }))
    .catch(err => {
      console.warn('santinho.art: base', escopo, 'indisponível -', err.message);
      return { status: 'error', cargos: {}, partidos: {} };
    })
    .then(base => {
      bases.set(escopo, base);
      carregando.delete(escopo);
      return base;
    });

  carregando.set(escopo, p);
  return p;
}

function carregarMeta() {
  return fetch('data/meta.json')
    .then(r => (r.ok ? r.json() : null))
    .catch(() => null)
    .then(json => { meta = json; return json; });
}

function carregarCores() {
  return fetch('data/cores-partidos.json')
    .then(r => (r.ok ? r.json() : null))
    .catch(() => null)
    .then(json => { coresDePartido = (json && json.cores) || {}; return json; });
}

function candidaturaExibivel(candidate) {
  if (!candidate) return false;
  if (candidate.sit == null || candidate.sit === '') return true; // base sem situação
  return SITUACOES_EXIBIVEIS.has(String(candidate.sit).toUpperCase());
}

/* --------------------------------------------------------- redes sociais */

/* Ícones desenhados aqui, aproximações geométricas das marcas — nada de asset
 * de terceiro (§36) nem cor de marca, para não virar vitrine visual de campanha.
 * Traço em currentColor, no mesmo estilo dos outros ícones do app. */
const ICONES_REDE = {
  i: ['Instagram', '<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/>' +
      '<circle cx="17.1" cy="6.9" r="1.1" fill="currentColor" stroke="none"/>'],
  f: ['Facebook', '<circle cx="12" cy="12" r="9"/><path d="M14.9 8.1h-1.7c-1 0-1.6.6-1.6 1.6V21"/>' +
      '<path d="M9.4 13.1h4.7"/>'],
  x: ['X', '<path d="M5.2 5.2l13.6 13.6M18.8 5.2L5.2 18.8"/>'],
  y: ['YouTube', '<rect x="2.5" y="5.5" width="19" height="13" rx="4.2"/>' +
      '<path d="M10.4 9.4l5.4 2.6-5.4 2.6z" fill="currentColor" stroke="none"/>'],
  t: ['TikTok', '<path d="M14.6 3.4v10a3.8 3.8 0 1 1-3.8-3.8"/>' +
      '<path d="M14.6 3.4c.4 2.4 2 4 4.4 4.3"/>'],
  h: ['Threads', '<path d="M12.4 21c-5.2 0-8.4-3.5-8.4-9s3.2-9 8.4-9c3.5 0 5.9 1.6 6.9 4.2"/>' +
      '<path d="M12.2 16.8c-2 0-3.3-1-3.3-2.4 0-1.5 1.5-2.4 3.5-2.3 2.4.1 3.8 1.4 3.8 3.4 0 2.5-2 4-4.5 4"/>'],
  l: ['LinkedIn', '<rect x="3" y="3" width="18" height="18" rx="3.4"/>' +
      '<path d="M7.5 10.6V17M7.5 7.4v.2"/><path d="M11.6 17v-3.9a2.6 2.6 0 0 1 5.2 0V17"/>'],
  w: ['WhatsApp', '<path d="M20 11.8a8 8 0 0 1-11.9 7L4 20l1.2-4.1A8 8 0 1 1 20 11.8z"/>' +
      '<path d="M9.4 9.5c0 2.7 2.4 5.1 5.1 5.1l.9-1.2-1.7-1-.9.8c-.9-.4-1.6-1.1-2-2l.8-.9-1-1.7z"' +
      ' fill="currentColor" stroke="none"/>'],
  k: ['Kwai', '<circle cx="12" cy="12" r="9"/>' +
      '<path d="M10.1 8.4l5.2 3.6-5.2 3.6z" fill="currentColor" stroke="none"/>'],
  g: ['Telegram', '<path d="M21 4.2L3 11.1l5.1 2 1.9 5.9 3.1-3.9 5 2.9z"/>'],
  b: ['Bluesky', '<path d="M12 13.6C10 9.1 6.4 6 4.4 6.6c-1.5.5-1 3.9.6 5.5 1 1 2.4 1.4 3.6 1.4' +
      '-1.2.3-2.4 1-2 2.6.4 1.7 2.5 2.4 3.9 1 .8-.8 1.2-1.8 1.5-2.5.3.7.7 1.7 1.5 2.5' +
      '1.4 1.4 3.5.7 3.9-1 .4-1.6-.8-2.3-2-2.6 1.2 0 2.6-.4 3.6-1.4 1.6-1.6 2.1-5 .6-5.5' +
      'C17.6 6 14 9.1 12 13.6z"/>'],
  p: ['Spotify', '<circle cx="12" cy="12" r="9"/>' +
      '<path d="M7.5 9.3c3-.7 6.3-.3 8.7 1.2M8.2 12.5c2.4-.5 5-.2 7 1.1M8.9 15.6c1.9-.4 4-.2 5.6.9"/>'],
  o: ['SoundCloud', '<path d="M6 16.2v-4.8M9.1 16.2V9.1M12.2 16.2V8.2M15.3 16.2v-5.8"/>' +
      '<path d="M17.4 16.2a3.1 3.1 0 0 0 0-6.2c-.3 0-.6 0-.9.1"/>'],
  c: ['Flickr', '<circle cx="8.1" cy="12" r="3.5" fill="currentColor" stroke="none"/>' +
      '<circle cx="15.9" cy="12" r="3.5"/>'],
  n: ['Linktree', '<path d="M12 21v-6.8M12 14.2l-4.2-4.3M12 14.2l4.2-4.3M7.8 5.9L12 10.2l4.2-4.3"/>'],
  s: ['site', '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/>' +
      '<path d="M12 3c2.6 2.5 4 5.6 4 9s-1.4 6.5-4 9c-2.6-2.5-4-5.6-4-9s1.4-6.5 4-9z"/>'],
};

const redes = new Map();            // escopo -> { status, porSq }
const carregandoRedes = new Map();

/* Carregada em segundo plano, depois da base: para abrir link em nova aba o
 * href precisa existir no momento do toque — bloqueador de popup barra abertura
 * depois de um await. Falha silenciosa: sem arquivo, sem ícone (§44). */
function carregarRedes(escopo) {
  if (redes.has(escopo)) return Promise.resolve(redes.get(escopo));
  if (carregandoRedes.has(escopo)) return carregandoRedes.get(escopo);

  const p = fetch('data/redes/' + escopo + '.json')
    .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(json => ({ status: 'ok', porSq: json }))
    .catch(() => ({ status: 'error', porSq: {} }))
    .then(dados => {
      redes.set(escopo, dados);
      carregandoRedes.delete(escopo);
      renderAll();
      return dados;
    });

  carregandoRedes.set(escopo, p);
  return p;
}

/* O importador já corta em cinco; o teto aqui é para a garantia de layout não
 * depender do arquivo de dados estar certo. */
const MAX_REDES = 5;

function redesDoCandidato(escopo, sq) {
  const dados = redes.get(escopo);
  if (!dados || dados.status !== 'ok' || !sq) return null;
  const lista = dados.porSq[sq];
  return lista && lista.length ? lista.slice(0, MAX_REDES) : null;
}

/* Só https, e só o que o importador já classificou. Irmã de fotoUrlSegura(). */
function urlDeRedeSegura(url) {
  if (typeof url !== 'string' || !url) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' ? u.href : null;
  } catch (_) {
    return null;
  }
}

/* ------------------------------------------------------------- resolução */

function escopoDo(cargo) { return cargo.nacional ? 'BR' : state.uf; }
function baseDo(cargo)   { return bases.get(escopoDo(cargo)) || null; }

function resolvePartyVote(base, digits) {
  if (digits[0] === null || digits[1] === null) return null;
  if (!digits.slice(2).every(d => d === null)) return null;   // resto tem de estar vazio
  const p = base.partidos[digits[0] + digits[1]];
  return p ? p.sigla : null;
}

/* Estados possíveis: vazio | parcial | legenda | valido | invalido |
 * indeterminado (base ainda não disponível — §43/§44). */
function resolveCandidate(cargo) {
  const digits = state.votes[cargo.key];
  if (digits.every(d => d === null)) return { estado: 'vazio' };

  const base = baseDo(cargo);
  if (!base || base.status !== 'ok') return { estado: 'indeterminado' };

  if (digits.every(d => d !== null)) {
    const c = (base.cargos[cargo.base] || {})[digits.join('')];
    if (candidaturaExibivel(c)) {
      const foto = c.foto || (c.f ? fotoLocal(escopoDo(cargo), c.sq) : null);
      return { estado: 'valido', nome: c.n, party: c.p, foto, sq: c.sq };
    }
    return { estado: 'invalido' };
  }

  if (cargo.legenda) {
    const sigla = resolvePartyVote(base, digits);
    if (sigla) return { estado: 'legenda', party: sigla };
  }
  return { estado: 'parcial' };
}

/* Caminho da foto local gerada pelo build. O importador grava apenas `f: 1`
 * quando o arquivo existe; o nome do arquivo é derivável de UF + SQ_CANDIDATO.
 * É caminho nosso, gerado aqui — não uma URL do TSE montada por suposição. */
function fotoLocal(escopo, sq) {
  return 'data/photos/' + escopo + '/F' + escopo + sq + '_div.jpg';
}

function fotoUrlSegura(url) {
  if (typeof url !== 'string' || url === '') return null;
  if (/^data\/photos\/[\w./-]+$/.test(url)) return url;        // gerada pelo build
  try {
    const u = new URL(url, location.href);
    if (u.protocol !== 'https:') return null;
    return FOTO_HOSTS.has(u.hostname) ? u.href : null;
  } catch (_) { return null; }
}

function corPorHash(sigla) {
  let h = 0;
  for (let i = 0; i < sigla.length; i++) h = (h * 31 + sigla.charCodeAt(i)) >>> 0;
  return PALETA[h % PALETA.length];
}

const canais = hex => {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const hexDe = ([r, g, b]) => '#' + [r, g, b]
  .map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');

/* luminância relativa (WCAG) */
function luminancia([r, g, b]) {
  const lin = v => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/* Cor real inclui amarelo (PSOL) e azul-claro (Republicanos): texto branco em
 * cima seria ilegível, e o número precisa contrastar com o card quase branco.
 * Daí duas variantes derivadas de cada cor, calculadas uma vez por sigla. */
const LUM_TEXTO_CLARO = 0.42;   // acima disto, texto escuro sobre a cor
const LUM_MAX_NO_CARD = 0.17;   // ~4,5:1 contra o creme claro do card

function escurecerAte(rgb, alvo) {
  let atual = rgb.slice();
  for (let i = 0; i < 24 && luminancia(atual) > alvo; i++) atual = atual.map(v => v * 0.9);
  return atual;
}

const cacheDeCor = new Map();

function paletaDoPartido(sigla) {
  if (!sigla) return null;
  if (cacheDeCor.has(sigla)) return cacheDeCor.get(sigla);

  const oficial = coresDePartido[sigla];
  const base = /^#?[0-9a-fA-F]{6}$/.test(oficial || '')
    ? '#' + String(oficial).replace('#', '')
    : corPorHash(sigla);

  const rgb = canais(base);
  const paleta = {
    cor: base,
    /* texto sobre a cor cheia (selo do partido, dígito em foco) */
    texto: luminancia(rgb) > LUM_TEXTO_CLARO ? 'var(--ink)' : 'var(--card)',
    /* cor escurecida o suficiente para ler sobre o card */
    escura: hexDe(escurecerAte(rgb, LUM_MAX_NO_CARD)),
    oficial: Boolean(oficial),
  };
  cacheDeCor.set(sigla, paleta);
  return paleta;
}

/* nome completo do cargo — usado nos rótulos de acessibilidade */
/* O TSE já limita o nome de urna a 30 caracteres, então não abreviamos nada:
 * o nome vai inteiro (§15). Para caber, a fonte se ajusta ao comprimento e o
 * nome pode usar duas linhas — mais legível que encolher tudo numa linha só.
 *
 * `--nl` tem de ser a linha mais longa DEPOIS da quebra por palavras, não
 * metade do nome: "ZÉ - TELMO CORRETOR DE IMÓVEIS" quebra em "ZÉ - TELMO
 * CORRETOR" + "DE IMÓVEIS", ou seja 19 caracteres, não 15. As duas funções
 * abaixo calculam isso sem tocar no DOM (nenhum reflow por tecla digitada). */
const NOME_EM_UMA_LINHA = 18;

/* as palavras cabem em `linhas` linhas de no máximo `largura` caracteres? */
function cabeEm(palavras, linhas, largura) {
  let usadas = 1, atual = 0;
  for (const p of palavras) {
    if (p.length > largura) return false;
    const comEspaco = atual === 0 ? p.length : atual + 1 + p.length;
    if (comEspaco <= largura) {
      atual = comEspaco;
    } else {
      usadas++;
      atual = p.length;
      if (usadas > linhas) return false;
    }
  }
  return true;
}

/* menor largura de linha que ainda acomoda o nome em `linhas` linhas */
function maiorLinha(nome, linhas) {
  const palavras = nome.split(/\s+/).filter(Boolean);
  if (!palavras.length) return 8;
  let min = Math.max(...palavras.map(p => p.length));
  let max = nome.length;
  while (min < max) {
    const meio = (min + max) >> 1;
    if (cabeEm(palavras, linhas, meio)) max = meio;
    else min = meio + 1;
  }
  return min;
}

function aplicarNome(el, nome) {
  el.textContent = nome;                       // textContent: nada de innerHTML (§38)
  const linhas = nome.length > NOME_EM_UMA_LINHA ? 2 : 1;
  el.style.setProperty('--nl', String(Math.max(8, maiorLinha(nome, linhas))));
}

function nomeDoCargo(cargo) {
  return (state.uf === 'DF' && cargo.labelDF) ? cargo.labelDF : cargo.label;
}

/* versão curta — usada no card, onde o espaço é disputado com o número (§33) */
function nomeCurtoDoCargo(cargo) {
  return (state.uf === 'DF' && cargo.curtoDF) ? cargo.curtoDF : cargo.curto;
}

/* ------------------------------------------------------------- construção */

/* No cabeçalho fica só bandeira + sigla; o nome por extenso vive no diálogo. */
function renderGatilhoUf() {
  const nome = NOME_DA_UF.get(state.uf) || state.uf;
  els.ufFlag.src = bandeiraDaUf(state.uf);
  els.ufFlag.alt = '';                         // o nome vem no aria-label do botão
  els.ufSigla.textContent = state.uf;
  /* o rótulo visível da placa é a sigla, então ela entra no nome acessível
   * (WCAG 2.5.3); o botão do rodapé mostra "trocar estado" */
  els.ufPlaca.setAttribute('aria-label', 'Estado: ' + state.uf + ' - ' + nome + '. Trocar estado');
  els.ufTrigger.setAttribute('aria-label', 'Trocar estado, hoje ' + nome);
}

/* A lista só é construída na primeira abertura: são 27 bandeiras (163 KB) que
 * não têm por que entrar no primeiro carregamento (§35). */
let listaUfMontada = false;
const regioesAtivas = new Set();

function montarListaUf() {
  if (listaUfMontada) return;
  for (const [uf, nome] of UFS) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'uf-opcao';
    b.dataset.uf = uf;

    const img = document.createElement('img');
    img.className = 'uf-opcao-flag';
    img.src = bandeiraDaUf(uf);
    img.alt = '';
    img.width = 34;
    img.height = 24;
    img.loading = 'lazy';
    img.decoding = 'async';

    const nomeEl = document.createElement('span');
    nomeEl.className = 'uf-opcao-nome';
    nomeEl.textContent = nome;

    const siglaEl = document.createElement('span');
    siglaEl.className = 'uf-opcao-sigla';
    siglaEl.textContent = uf;

    b.append(img, nomeEl, siglaEl);
    li.appendChild(b);
    els.ufList.appendChild(li);
  }
  listaUfMontada = true;
}

function montarFiltrosDeRegiao() {
  if (els.ufFiltros.childElementCount) return;
  for (const [key, nome] of REGIOES) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip-filtro';
    chip.dataset.regiao = key;
    chip.textContent = nome;
    chip.setAttribute('aria-pressed', 'false');
    els.ufFiltros.appendChild(chip);
  }
  els.ufFiltros.appendChild(botaoLimparFiltros());
  permitirArrastarFiltros(els.ufFiltros);
}

function botaoLimparFiltros() {
  const botao = document.createElement('button');
  botao.type = 'button';
  botao.className = 'limpar-filtros';
  botao.dataset.limparFiltros = '';
  botao.hidden = true;
  botao.title = 'Limpar filtros';
  botao.setAttribute('aria-label', 'Limpar filtros');
  botao.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>';
  return botao;
}

function atualizarBotaoLimparFiltros(container, haSelecao) {
  container.querySelector('[data-limpar-filtros]').hidden = !haSelecao;
}

function permitirArrastarFiltros(container) {
  let inicioX = 0;
  let inicioScroll = 0;
  let arrastou = false;

  container.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    inicioX = e.clientX;
    inicioScroll = container.scrollLeft;
    arrastou = false;
    container.classList.add('is-pronto-para-arrastar');
  });
  container.addEventListener('pointermove', e => {
    if (!container.classList.contains('is-pronto-para-arrastar')) return;
    const distancia = e.clientX - inicioX;
    if (Math.abs(distancia) > 3) arrastou = true;
    if (!arrastou) return;
    container.scrollLeft = inicioScroll - distancia;
    container.classList.add('is-arrastando');
    e.preventDefault();
  });
  container.addEventListener('pointerup', e => {
    if (!container.classList.contains('is-pronto-para-arrastar')) return;
    container.classList.remove('is-pronto-para-arrastar');
    container.classList.remove('is-arrastando');
  });
}

/* só as opções visíveis: o filtro esconde as demais */
function opcoesUf() {
  return [...els.ufList.querySelectorAll('.uf-opcao')]
    .filter(b => !b.parentElement.hidden);
}

/* Prefixo de palavra, não substring: com 27 itens, "ri" tem de trazer os três
 * Rios, não Distrito Federal (dist-RI-to) e Espírito Santo. Cada termo digitado
 * precisa iniciar alguma palavra do nome ou a sigla. */
function filtrarEstados() {
  const termos = normalizarNome(els.ufBusca.value).split(' ').filter(Boolean);
  let visiveis = 0;
  for (const botao of els.ufList.querySelectorAll('.uf-opcao')) {
    const uf = botao.dataset.uf;
    const palavras = normalizarNome((NOME_DA_UF.get(uf) || '') + ' ' + uf).split(' ');
    const combina = (!regioesAtivas.size || regioesAtivas.has(REGIAO_DA_UF.get(uf))) &&
      termos.every(t => palavras.some(p => p.startsWith(t)));
    botao.parentElement.hidden = !combina;
    if (combina) visiveis++;
  }
  els.ufContagem.textContent = visiveis ? '' : 'nenhum estado encontrado';
}

/* ------------------------------------------------------------ abas da folha
 * A folha aberta mantém, na sua ponta, as mesmas abas do rodapé — clonadas dos
 * botões originais, para a geometria ser idêntica e a folha parecer ter sido
 * puxada por ali. A aba da folha aberta deixa de ser botão: é a ponta da ficha,
 * não um controle (fechar já existe no ✕, no Esc e no clique fora). A outra aba
 * troca de folha. */

function montarAbas(ativa) {
  const linha = document.createElement('div');
  linha.className = 'folha-abas';

  for (const [nome, original] of [['uf', els.ufTrigger], ['busca', els.buscaTrigger]]) {
    const clone = original.cloneNode(true);
    clone.removeAttribute('id');
    for (const filho of clone.querySelectorAll('[id]')) filho.removeAttribute('id');

    let aba = clone;
    if (nome === ativa) {
      /* vira elemento inerte, preservando as classes e o conteúdo */
      aba = document.createElement('span');
      aba.className = clone.className;
      aba.append(...clone.childNodes);
      aba.setAttribute('aria-hidden', 'true');
      aba.classList.add('is-ativa');
    } else {
      aba.addEventListener('click', () => trocarDeFolha(nome));
    }
    aba.dataset.aba = nome;
    linha.appendChild(aba);
  }
  return linha;
}

/* A fileira vai no TOPO da folha: assim o botão sobe junto com ela e termina
 * como a aba da ficha, em vez de ficar parado no rodapé. */
function prepararAbas(dialogo, ativa) {
  const antiga = dialogo.querySelector('.folha-abas');
  if (antiga) antiga.remove();
  dialogo.prepend(montarAbas(ativa));
}

/* Fecha deixando a folha descer de volta ao rodapé. <dialog> sai da top layer
 * assim que close() é chamado, então a animação roda antes. Se o usuário pediu
 * menos movimento (ou a animação não dispara), fecha na hora. */
const DURACAO_FECHAMENTO = 170;

function fecharComAnimacao(dialogo) {
  if (!dialogo.open || dialogo.classList.contains('is-fechando')) return;

  const querAnimacao = matchMedia('(prefers-reduced-motion: no-preference)').matches;
  if (!querAnimacao) { dialogo.close(); return; }

  dialogo.classList.add('is-fechando');
  let encerrado = false;
  const encerrar = () => {
    if (encerrado) return;
    encerrado = true;
    dialogo.classList.remove('is-fechando');
    dialogo.close();
  };
  dialogo.addEventListener('animationend', encerrar, { once: true });
  setTimeout(encerrar, DURACAO_FECHAMENTO + 80);      // rede de segurança
}

/* Trocar de folha não é fechar e abrir: a ficha fica, o conteúdo muda. Sem
 * animação, senão a folha desceria e voltaria. */
function trocarDeFolha(destino) {
  for (const d of [els.ufDialog, els.buscaDialog]) {
    d.classList.remove('is-fechando');
    if (d.open) d.close();
  }
  /* a classe sai no evento `close`, não no próximo quadro: requestAnimationFrame
   * roda antes de a animação começar, e a folha subia de novo */
  const alvo = destino === 'uf' ? els.ufDialog : els.buscaDialog;
  alvo.classList.add('sem-animacao');
  if (destino === 'uf') abrirSeletorUf();
  else abrirBusca();
}

function abrirSeletorUf() {
  montarListaUf();
  montarFiltrosDeRegiao();
  els.ufBusca.value = '';
  filtrarEstados();
  for (const b of opcoesUf()) {
    const atual = b.dataset.uf === state.uf;
    b.classList.toggle('is-atual', atual);
    if (atual) b.setAttribute('aria-current', 'true');
    else b.removeAttribute('aria-current');
  }
  prepararAbas(els.ufDialog, 'uf');
  els.ufTrigger.setAttribute('aria-expanded', 'true');
  els.ufPlaca.setAttribute('aria-expanded', 'true');
  els.ufDialog.showModal();
  const atual = els.ufList.querySelector('.uf-opcao.is-atual');
  if (atual) atual.scrollIntoView({ block: 'center' });
  (atual || opcoesUf()[0]).focus({ preventScroll: true });
}

function fecharSeletorUf() {
  fecharComAnimacao(els.ufDialog);
}

/* teclado dentro do diálogo: setas percorrem a lista (Esc e o aprisionamento de
 * foco vêm de graça no <dialog>). O salto por letra saiu quando entrou o campo
 * de filtro: as letras agora vão para o campo, que faz melhor o mesmo serviço. */
function tecladoNoSeletorUf(e) {
  const opcoes = opcoesUf();
  if (!opcoes.length) return;

  /* no campo de filtro: seta desce para a lista, Enter escolhe o primeiro */
  if (e.target === els.ufBusca) {
    if (e.key === 'ArrowDown') { e.preventDefault(); opcoes[0].focus(); }
    else if (e.key === 'Enter') { e.preventDefault(); opcoes[0].click(); }
    return;
  }

  const atual = opcoes.indexOf(document.activeElement);

  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const passo = e.key === 'ArrowDown' ? 1 : -1;
    const i = (atual + passo + opcoes.length) % opcoes.length;
    opcoes[i].focus();
    return;
  }
  if (e.key === 'Home' || e.key === 'End') {
    e.preventDefault();
    opcoes[e.key === 'Home' ? 0 : opcoes.length - 1].focus();
    return;
  }
}

function ligarSeletorUf() {
  els.ufTrigger.addEventListener('click', abrirSeletorUf);
  els.ufPlaca.addEventListener('click', abrirSeletorUf);
  els.ufClose.addEventListener('click', fecharSeletorUf);
  els.ufDialog.addEventListener('close', () => {
    els.ufPlaca.setAttribute('aria-expanded', 'false');
    const abas = els.ufDialog.querySelector('.folha-abas');
    if (abas) abas.remove();          // não deixa fileira órfã na folha fechada
    els.ufDialog.classList.remove('sem-animacao');
    els.ufTrigger.setAttribute('aria-expanded', 'false');
    els.ufTrigger.focus({ preventScroll: true });
  });
  /* clique fora do conteúdo fecha: no backdrop e na faixa das abas o alvo é o
   * próprio <dialog> ou a fileira, nunca o corpo */
  els.ufDialog.addEventListener('click', e => {
    if (e.target === els.ufDialog || e.target.classList.contains('folha-abas')) {
      fecharSeletorUf();
    }
  });
  els.ufBusca.addEventListener('input', filtrarEstados);
  els.ufFiltros.addEventListener('click', e => {
    if (e.target.closest('[data-limpar-filtros]')) {
      regioesAtivas.clear();
      for (const chip of els.ufFiltros.querySelectorAll('[data-regiao]')) {
        chip.classList.remove('is-ativo');
        chip.setAttribute('aria-pressed', 'false');
      }
      atualizarBotaoLimparFiltros(els.ufFiltros, false);
      filtrarEstados();
      return;
    }
    const chip = e.target.closest('.chip-filtro[data-regiao]');
    if (!chip) return;
    const { regiao } = chip.dataset;
    if (regioesAtivas.has(regiao)) regioesAtivas.delete(regiao);
    else regioesAtivas.add(regiao);
    const ativo = regioesAtivas.has(regiao);
    chip.classList.toggle('is-ativo', ativo);
    chip.setAttribute('aria-pressed', String(ativo));
    atualizarBotaoLimparFiltros(els.ufFiltros, regioesAtivas.size > 0);
    filtrarEstados();
  });
  els.ufList.addEventListener('click', e => {
    const opcao = e.target.closest('.uf-opcao');
    if (!opcao) return;
    fecharSeletorUf();
    if (opcao.dataset.uf !== state.uf) trocarUf(opcao.dataset.uf);
  });
  els.ufDialog.addEventListener('keydown', tecladoNoSeletorUf);
  els.ufDialog.addEventListener('cancel', e => { e.preventDefault(); fecharSeletorUf(); });
}

function montarCards() {
  for (const cargo of CARGOS) {
    const card = document.createElement('article');
    card.className = 'card';
    card.dataset.cargo = cargo.key;
    card.style.setProperty('--n', String(cargo.len));

    const band = document.createElement('div');
    band.className = 'band';
    band.setAttribute('aria-hidden', 'true');

    const photo = document.createElement('div');
    photo.className = 'photo';
    const img = document.createElement('img');
    img.alt = '';
    img.hidden = true;
    img.loading = 'lazy';
    img.decoding = 'async';
    img.referrerPolicy = 'no-referrer';
    img.addEventListener('error', () => {
      img.hidden = true;
      img.removeAttribute('src');
      semFoto.hidden = false;              // foto quebrada volta ao placeholder (§17)
    });
    const semFoto = document.createElement('span');
    semFoto.className = 'photo-empty';
    semFoto.textContent = '?';
    semFoto.setAttribute('aria-hidden', 'true');
    photo.append(img, semFoto);

    const ident = document.createElement('div');
    ident.className = 'ident';
    const name = document.createElement('span');
    name.className = 'name';
    const metaLinha = document.createElement('span');
    metaLinha.className = 'meta';
    const party = document.createElement('span');
    party.className = 'party';
    party.hidden = true;
    const office = document.createElement('span');
    office.className = 'office';
    office.textContent = nomeCurtoDoCargo(cargo);
    metaLinha.append(party, office);
    const redesEl = document.createElement('div');
    redesEl.className = 'redes';
    ident.append(name, metaLinha, redesEl);

    const numwrap = document.createElement('div');
    numwrap.className = 'numwrap';
    const digitsBox = document.createElement('div');
    digitsBox.className = 'digits';
    digitsBox.setAttribute('aria-hidden', 'true');
    const digitEls = [];
    for (let i = 0; i < cargo.len; i++) {
      const d = document.createElement('span');
      d.className = 'digit';
      d.dataset.index = String(i);
      /* separador visual depois dos dois dígitos do partido (§20) */
      if (cargo.legenda && i === 2) d.classList.add('after-party');
      digitsBox.appendChild(d);
      digitEls.push(d);
    }

    const input = document.createElement('input');
    input.className = 'sink';
    input.type = 'text';
    input.inputMode = 'numeric';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.setAttribute('autocorrect', 'off');
    input.setAttribute('autocapitalize', 'off');
    input.setAttribute('enterkeyhint', 'done');
    input.id = 'num-' + cargo.key;

    const hint = document.createElement('span');
    hint.className = 'sr-only';
    hint.id = 'hint-' + cargo.key;
    input.setAttribute('aria-describedby', hint.id);

    numwrap.append(digitsBox, input, hint);
    card.append(band, photo, ident, numwrap);
    els.cards.appendChild(card);

    cargo.el = { card, img, semFoto, name, party, office, redes: redesEl,
                 digits: digitEls, input, hint };
    ligarEventos(cargo);
  }
}

/* ------------------------------------------------------- motor de entrada */

function primeiroVazio(cargo) {
  const digits = state.votes[cargo.key];
  const i = digits.indexOf(null);
  return i === -1 ? cargo.len - 1 : i;      // todos preenchidos → último (§26)
}

function focusDigit(key, index) {
  const cargo = POR_KEY[key];
  const i = Math.max(0, Math.min(cargo.len - 1, index));
  state.focus = { key, index: i };
  if (document.activeElement !== cargo.el.input) {
    cargo.el.input.focus({ preventScroll: true });
  }
  renderAll();
  syncSink(cargo);
}

/* mantém o input mestre coerente com o estado e com um caractere selecionado */
function syncSink(cargo) {
  const input = cargo.el.input;
  const valor = state.votes[cargo.key].map(d => (d === null ? VAZIO : d)).join('');
  if (input.value !== valor) input.value = valor;
  if (state.focus && state.focus.key === cargo.key) {
    const i = state.focus.index;
    try { input.setSelectionRange(i, i + 1); } catch (_) { /* sem seleção: ok */ }
  }
}

function apenasDigitos(texto) {
  return typeof texto === 'string' ? texto.replace(/\D+/g, '').split('') : [];
}

/* digitar preenche o dígito atual e avança; no último, mantém o foco (§23) */
function aplicarDigitos(cargo, chars) {
  if (!chars.length) return false;
  const digits = state.votes[cargo.key];
  let i = state.focus ? state.focus.index : 0;
  for (const ch of chars) {
    digits[i] = ch;
    if (i >= cargo.len - 1) break;
    i++;
  }
  state.focus = { key: cargo.key, index: i };
  return true;
}

/* colar (§28): número completo substitui tudo; parcial entra na posição atual */
function handlePaste(cargo, texto) {
  const chars = apenasDigitos(texto);
  if (!chars.length) return false;
  if (chars.length >= cargo.len) {
    const digits = state.votes[cargo.key];
    for (let i = 0; i < cargo.len; i++) digits[i] = chars[i];
    state.focus = { key: cargo.key, index: cargo.len - 1 };
    return true;
  }
  return aplicarDigitos(cargo, chars);
}

/* backspace (§24): com valor apaga o próprio; vazio volta e apaga o anterior */
function apagarAtras(cargo) {
  const digits = state.votes[cargo.key];
  let i = state.focus ? state.focus.index : 0;
  if (digits[i] !== null) {
    digits[i] = null;
  } else if (i > 0) {
    i--;
    digits[i] = null;
  }
  state.focus = { key: cargo.key, index: i };
  return true;
}

/* delete (§25): apaga o dígito atual sem mover */
function apagarAtual(cargo) {
  state.votes[cargo.key][state.focus ? state.focus.index : 0] = null;
  return true;
}

function handleBeforeInput(e, cargo) {
  e.preventDefault();                 // o valor do input nunca muda por conta própria
  const t = e.inputType;
  let mudou = false;

  if (t === 'insertText' || t === 'insertCompositionText' || t === 'insertReplacementText') {
    mudou = aplicarDigitos(cargo, apenasDigitos(e.data));
  } else if (t === 'insertFromPaste' || t === 'insertFromDrop') {
    const txt = e.dataTransfer ? e.dataTransfer.getData('text') : e.data;
    mudou = handlePaste(cargo, txt);
  } else if (t.startsWith('deleteContentBackward') || t === 'deleteWordBackward' ||
             t === 'deleteSoftLineBackward' || t === 'deleteHardLineBackward') {
    mudou = apagarAtras(cargo);
  } else if (t === 'deleteContentForward' || t === 'deleteWordForward' || t === 'deleteByCut') {
    mudou = apagarAtual(cargo);
  }

  if (mudou) depoisDeEditar(cargo);
  else syncSink(cargo);               // reafirma valor e seleção mesmo sem mudança
}

/* teclado físico: só navegação. Dígitos e apagar seguem pelo beforeinput,
 * assim não há risco de aplicar a mesma tecla duas vezes (§27). */
function handleKeydown(e, cargo) {
  const i = state.focus ? state.focus.index : 0;
  switch (e.key) {
    case 'ArrowLeft':  e.preventDefault(); focusDigit(cargo.key, i - 1); break;
    case 'ArrowRight': e.preventDefault(); focusDigit(cargo.key, i + 1); break;
    case 'Home':       e.preventDefault(); focusDigit(cargo.key, 0); break;
    case 'End':        e.preventDefault(); focusDigit(cargo.key, cargo.len - 1); break;
    case 'Enter':      e.preventDefault(); cargo.el.input.blur(); break;
    default: break;
  }
}

function ligarEventos(cargo) {
  const { card, input } = cargo.el;

  input.addEventListener('beforeinput', e => handleBeforeInput(e, cargo));
  input.addEventListener('keydown', e => handleKeydown(e, cargo));
  input.addEventListener('paste', e => {
    e.preventDefault();               // cancela também o insertFromPaste
    const txt = e.clipboardData ? e.clipboardData.getData('text') : '';
    if (handlePaste(cargo, txt)) depoisDeEditar(cargo);
  });

  input.addEventListener('focus', () => {
    if (!state.focus || state.focus.key !== cargo.key) {
      state.focus = { key: cargo.key, index: primeiroVazio(cargo) };
    }
    renderAll();
    syncSink(cargo);
  });

  input.addEventListener('blur', () => {
    if (state.focus && state.focus.key === cargo.key) state.focus = null;
    renderAll();
  });

  /* toque/clique: dígito tocado recebe foco e fica selecionado; no resto do
   * card, primeiro dígito vazio (§26). pointerdown responde imediato, click
   * cobre navegadores que só liberam foco programático no clique. */
  const alvo = e => {
    const digit = e.target.closest ? e.target.closest('.digit') : null;
    focusDigit(cargo.key, digit ? Number(digit.dataset.index) : primeiroVazio(cargo));
  };
  card.addEventListener('pointerdown', alvo);
  card.addEventListener('click', alvo);
}

function depoisDeEditar(cargo) {
  marcarMexido(cargo.key);
  renderAll();
  syncSink(cargo);
  syncUrl();
  agendarImagem();
}

/* ------------------------------------------------------------------- URL */

function codificarVoto(digits) {
  return digits.map(d => (d === null ? VAZIO : d)).join('').replace(/-+$/, '');
}

/* replaceState: a URL acompanha a digitação sem recarregar nem empilhar
 * histórico a cada dígito (§4.1) */
function syncUrl() {
  const p = new URLSearchParams();
  p.set('uf', state.uf.toLowerCase());
  for (const cargo of CARGOS) {
    const v = codificarVoto(state.votes[cargo.key]);
    if (v) p.set(cargo.key, v);
  }
  history.replaceState(null, '', location.pathname + '?' + p.toString() + location.hash);
}

function hydrateFromUrl() {
  const p = new URLSearchParams(location.search);
  const uf = (p.get('uf') || '').trim().toUpperCase();
  state.uf = NOME_DA_UF.has(uf) ? uf : UF_PADRAO;

  for (const cargo of CARGOS) {
    const bruto = (p.get(cargo.key) || '').replace(/[^0-9-]/g, '').slice(0, cargo.len);
    const arr = new Array(cargo.len).fill(null);
    for (let i = 0; i < bruto.length; i++) if (bruto[i] !== VAZIO) arr[i] = bruto[i];
    state.votes[cargo.key] = arr;
    /* na ordem dos cargos: o que vem antes na URL conta como mexido há mais
     * tempo, então a substituição por busca começa pela primeira vaga */
    if (arr.some(d => d !== null)) marcarMexido(cargo.key);
  }
}

/* ------------------------------------------------- busca por nome (§46) */

/* A lista abre completa, em ordem alfabética, e o campo filtra. Isso é
 * compatível com o §46 — e mais neutro que ordenar por semelhança: ninguém é
 * recomendado, destacado ou posto na frente. Nome é o primeiro critério, número
 * do candidato o segundo. A ordenação acontece uma vez, na construção do
 * índice, então filtrar não reordena nada. */

const MIN_LETRAS = 2;

/* conectivos não são exigidos na busca: "jose da silva" tem de achar
 * "JOSE SILVA LIMA", que não tem a palavra "da" */
const CONECTIVOS = new Set(['DE', 'DA', 'DO', 'DAS', 'DOS', 'E', 'DI', 'DU', 'AO', 'NA', 'NO']);
const CARGO_POR_BASE = new Map();
for (const c of CARGOS) if (!CARGO_POR_BASE.has(c.base)) CARGO_POR_BASE.set(c.base, c);
const cargosAtivos = new Set();
const partidosAtivos = new Set();

/* na busca o cargo aparece sem a vaga: existe um Senado só, com duas vagas */
function rotuloDaBase(base) {
  return base === 's' ? 'Senador' : nomeDoCargo(CARGO_POR_BASE.get(base));
}

const normalizarNome = t => (t || '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

let indiceBusca = null;
let chaveDoIndice = '';

/* chave muda quando a UF ou o estado de carga das bases muda */
function chaveAtualDoIndice() {
  const uf = bases.get(state.uf);
  const br = bases.get('BR');
  return state.uf + '|' + (uf ? uf.status : '-') + '|' + (br ? br.status : '-');
}

function construirIndice() {
  const chave = chaveAtualDoIndice();
  if (indiceBusca && chaveDoIndice === chave) return indiceBusca;

  const itens = [];
  for (const escopo of [state.uf, 'BR']) {
    const base = bases.get(escopo);
    if (!base || base.status !== 'ok') continue;
    for (const [nomeBase, porNumero] of Object.entries(base.cargos)) {
      if (!CARGO_POR_BASE.has(nomeBase)) continue;
      for (const [numero, c] of Object.entries(porNumero)) {
        if (!candidaturaExibivel(c)) continue;
        const normal = normalizarNome(c.n);
        itens.push({
          nome: c.n, normal, palavras: normal.split(' '), sigla: c.p,
          base: nomeBase, numero, escopo, temFoto: Boolean(c.f || c.foto), foto: c.foto, sq: c.sq,
        });
      }
    }
  }
  /* ordena uma vez: nome, depois número do candidato */
  itens.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR') ||
                       Number(a.numero) - Number(b.numero));
  indiceBusca = itens;
  chaveDoIndice = chave;
  return itens;
}

/* Distância de edição limitada: para além do limite, aborta e devolve o limite
 * mais um. Comparar por palavra, e não pelo nome inteiro, é o que impede
 * "haddad" de casar com "RICHARDSON DA PADARIA". */
function distanciaAte(a, b, limite) {
  if (Math.abs(a.length - b.length) > limite) return limite + 1;
  let anterior = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const atual = [i];
    let melhorDaLinha = i;
    for (let j = 1; j <= b.length; j++) {
      const custo = a[i - 1] === b[j - 1] ? 0 : 1;
      atual[j] = Math.min(atual[j - 1] + 1, anterior[j] + 1, anterior[j - 1] + custo);
      if (atual[j] < melhorDaLinha) melhorDaLinha = atual[j];
    }
    if (melhorDaLinha > limite) return limite + 1;
    anterior = atual;
  }
  return anterior[b.length];
}

/* erro de digitação tolerado conforme o tamanho do termo; abaixo de 4 letras,
 * nenhum — seria ruído */
const toleranciaDe = termo => (termo.length >= 7 ? 2 : termo.length >= 4 ? 1 : 0);

/* Todo termo digitado tem de casar de alguma forma; a pontuação premia começo
 * de nome e começo de palavra. Nome mais curto desempata. */
function pontuar(termos, palavras, normal) {
  let total = 0;
  for (const termo of termos) {
    let ponto = 0;
    if (normal.startsWith(termo)) {
      ponto = 100;
    } else {
      for (const palavra of palavras) {
        if (palavra.startsWith(termo)) { ponto = Math.max(ponto, 70); break; }
        if (palavra.includes(termo)) ponto = Math.max(ponto, 40);
      }
    }
    const limite = toleranciaDe(termo);
    if (!ponto && limite) {
      for (const palavra of palavras) {
        if (distanciaAte(termo, palavra, limite) <= limite) { ponto = 20; break; }
      }
    }
    if (!ponto) return -1;
    total += ponto;
  }
  return total - normal.length / 100;
}

function buscarCandidatos(consulta) {
  const itens = construirIndice();
  const brutos = normalizarNome(consulta).split(' ').filter(t => t.length >= MIN_LETRAS);
  const semConectivos = brutos.filter(t => !CONECTIVOS.has(t));
  const termos = semConectivos.length ? semConectivos : brutos;

  /* sem termo utilizável, a lista inteira — já ordenada */
  if (!termos.length) return { termos, achados: itens.filter(item =>
    (!cargosAtivos.size || cargosAtivos.has(item.base)) &&
    (!partidosAtivos.size || partidosAtivos.has(item.sigla))) };

  const achados = itens.filter(item =>
    (!cargosAtivos.size || cargosAtivos.has(item.base)) &&
    (!partidosAtivos.size || partidosAtivos.has(item.sigla)) &&
    pontuar(termos, item.palavras, item.normal) >= 0);
  return { termos, achados };
}

const numeroCompletoDe = key => {
  const digits = state.votes[key];
  return digits.every(d => d !== null) ? digits.join('') : null;
};

/* Senado tem duas vagas (§21). Escolher pela busca sobrescreve, nesta ordem:
 *   1. a vaga que já tem esse mesmo número — não duplica, é idempotente
 *   2. a vaga vazia
 *   3. a vaga sem candidato válido (número incompleto ou inexistente)
 *   4. entre duas válidas, a mexida há mais tempo
 * Sem isso, a busca atropelava sempre a primeira vaga, e buscar um terceiro
 * senador sobrescrevia justamente quem acabou de ser escolhido. */
function destinoDoResultado(item) {
  if (item.base !== 's') return CARGO_POR_BASE.get(item.base).key;

  const vagas = ['s1', 's2'];
  const repetida = vagas.find(k => numeroCompletoDe(k) === item.numero);
  if (repetida) return repetida;

  const prioridade = key => {
    const digits = state.votes[key];
    if (digits.every(d => d === null)) return 0;              // vazia
    return resolveCandidate(POR_KEY[key]).estado === 'valido' ? 2 : 1;
  };

  return vagas
    .map(key => ({ key, ordem: prioridade(key), quando: state.mexidoEm[key] || 0 }))
    .sort((a, b) => a.ordem - b.ordem || a.quando - b.quando)[0].key;
}

function preencherNumero(key, numero) {
  const cargo = POR_KEY[key];
  const digits = state.votes[key];
  for (let i = 0; i < cargo.len; i++) digits[i] = numero[i] || null;
  marcarMexido(key);
  state.focus = null;
  renderAll();
  syncSink(cargo);
  syncUrl();
  agendarImagem();
}

function linhaDeResultado(item) {
  const li = document.createElement('li');
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'busca-opcao';
  b.dataset.base = item.base;
  b.dataset.numero = item.numero;

  const paleta = paletaDoPartido(item.sigla);
  if (paleta) {
    b.style.setProperty('--c', paleta.cor);
    b.style.setProperty('--c-txt', paleta.texto);
    b.style.setProperty('--c-escura', paleta.escura);
  }

  const foto = item.temFoto
    ? fotoUrlSegura(item.foto || fotoLocal(item.escopo, item.sq))
    : null;
  if (foto) {
    const img = document.createElement('img');
    img.className = 'busca-foto';
    img.src = foto;
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.referrerPolicy = 'no-referrer';
    b.appendChild(img);
  } else {
    const vazio = document.createElement('span');
    vazio.className = 'busca-foto';
    b.appendChild(vazio);
  }

  const ident = document.createElement('span');
  ident.className = 'busca-ident';
  const nome = document.createElement('span');
  nome.className = 'busca-nome';
  nome.textContent = item.nome;                 // textContent sempre (§38)
  const meta = document.createElement('span');
  meta.className = 'busca-meta';
  const partido = document.createElement('span');
  partido.className = 'busca-partido';
  partido.textContent = item.sigla;
  const cargo = document.createElement('span');
  cargo.className = 'busca-cargo';
  cargo.textContent = rotuloDaBase(item.base);
  meta.append(partido, cargo);
  ident.append(nome, meta);

  const numero = document.createElement('span');
  numero.className = 'busca-numero';
  numero.textContent = item.numero;

  b.append(ident, numero);
  b.setAttribute('aria-label', item.nome + ', ' + item.sigla + ', ' +
    rotuloDaBase(item.base) + ', número ' + item.numero.split('').join(' '));
  li.appendChild(b);
  return li;
}

let resultadosDaBusca = [];
let mostradosNaBusca = 0;
let sentinela = null;
let observadorDoFim = null;

function montarFiltrosDeCargo() {
  if (els.buscaFiltros.childElementCount) return;
  for (const [base, cargo] of CARGO_POR_BASE) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip-filtro';
    chip.dataset.cargo = base;
    chip.textContent = rotuloDaBase(base).replace(/^Deputado/, 'Dep.');
    chip.setAttribute('aria-pressed', 'false');
    els.buscaFiltros.appendChild(chip);
  }
  els.buscaFiltros.appendChild(botaoLimparFiltros());
  permitirArrastarFiltros(els.buscaFiltros);
}

function montarFiltrosDePartido() {
  const partidos = [...new Set(construirIndice().map(item => item.sigla))]
    .filter(Boolean).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  els.buscaFiltrosPartidos.replaceChildren();
  partidosAtivos.clear();
  for (const sigla of partidos) {
    const chip = document.createElement('button');
    const paleta = paletaDoPartido(sigla);
    chip.type = 'button';
    chip.className = 'chip-filtro chip-partido';
    chip.dataset.partido = sigla;
    chip.textContent = sigla;
    chip.setAttribute('aria-pressed', 'false');
    chip.style.setProperty('--c', paleta.cor);
    chip.style.setProperty('--c-txt', paleta.texto);
    els.buscaFiltrosPartidos.appendChild(chip);
  }
  els.buscaFiltrosPartidos.appendChild(botaoLimparFiltros());
  permitirArrastarFiltros(els.buscaFiltrosPartidos);
}

/* acrescenta a próxima página e mantém a sentinela no fim da lista */
function mostrarMaisResultados() {
  const proximos = resultadosDaBusca.slice(mostradosNaBusca, mostradosNaBusca + PAGINA_BUSCA);
  if (!proximos.length) {
    if (sentinela) sentinela.remove();
    return;
  }
  const fragmento = document.createDocumentFragment();
  for (const item of proximos) fragmento.appendChild(linhaDeResultado(item));
  els.buscaLista.insertBefore(fragmento, sentinela);
  mostradosNaBusca += proximos.length;
  if (mostradosNaBusca >= resultadosDaBusca.length && sentinela) sentinela.remove();
}

function renderBusca() {
  const { termos, achados } = buscarCandidatos(els.buscaInput.value);
  resultadosDaBusca = achados;
  mostradosNaBusca = 0;
  els.buscaLista.replaceChildren();

  const baseUf = bases.get(state.uf);
  if (!baseUf || baseUf.status !== 'ok') {
    els.buscaContagem.textContent = 'carregando dados…';
    return;
  }
  if (!achados.length) {
    els.buscaContagem.textContent = termos.length
      ? 'nenhum candidato encontrado em ' + state.uf
      : 'nenhum candidato na base de ' + state.uf;
    return;
  }
  /* com resultados na tela a contagem não informa nada que a lista não mostre */
  els.buscaContagem.textContent = '';

  /* sentinela do scroll infinito, sempre no fim da lista */
  sentinela = document.createElement('li');
  sentinela.className = 'busca-fim';
  sentinela.setAttribute('aria-hidden', 'true');
  els.buscaLista.appendChild(sentinela);

  if (!observadorDoFim) {
    observadorDoFim = new IntersectionObserver(entradas => {
      if (entradas.some(e => e.isIntersecting)) mostrarMaisResultados();
    }, { root: els.buscaLista, rootMargin: '240px' });
  }
  mostrarMaisResultados();
  observadorDoFim.observe(sentinela);
}

function abrirBusca() {
  montarFiltrosDeCargo();
  montarFiltrosDePartido();
  els.buscaInput.value = '';
  els.buscaLista.scrollTop = 0;
  renderBusca();
  prepararAbas(els.buscaDialog, 'busca');
  els.buscaTrigger.setAttribute('aria-expanded', 'true');
  els.buscaDialog.showModal();
  els.buscaInput.focus({ preventScroll: true });
}

function fecharBusca() {
  fecharComAnimacao(els.buscaDialog);
}

function escolherResultado(botao) {
  const item = { base: botao.dataset.base };
  fecharBusca();
  preencherNumero(destinoDoResultado(item), botao.dataset.numero);
}

function opcoesBusca() {
  return [...els.buscaLista.querySelectorAll('.busca-opcao')];
}

function ligarBusca() {
  els.buscaTrigger.addEventListener('click', abrirBusca);
  els.buscaClose.addEventListener('click', fecharBusca);
  els.buscaDialog.addEventListener('close', () => {
    const abas = els.buscaDialog.querySelector('.folha-abas');
    if (abas) abas.remove();          // não deixa fileira órfã na folha fechada
    els.buscaDialog.classList.remove('sem-animacao');
    els.buscaTrigger.setAttribute('aria-expanded', 'false');
    els.buscaTrigger.focus({ preventScroll: true });
  });
  els.buscaInput.addEventListener('input', renderBusca);
  els.buscaFiltros.addEventListener('click', e => {
    if (e.target.closest('[data-limpar-filtros]')) {
      cargosAtivos.clear();
      for (const chip of els.buscaFiltros.querySelectorAll('[data-cargo]')) {
        chip.classList.remove('is-ativo');
        chip.setAttribute('aria-pressed', 'false');
      }
      atualizarBotaoLimparFiltros(els.buscaFiltros, false);
      els.buscaLista.scrollTop = 0;
      renderBusca();
      return;
    }
    const chip = e.target.closest('.chip-filtro[data-cargo]');
    if (!chip) return;
    const { cargo } = chip.dataset;
    if (cargosAtivos.has(cargo)) cargosAtivos.delete(cargo);
    else cargosAtivos.add(cargo);
    const ativo = cargosAtivos.has(cargo);
    chip.classList.toggle('is-ativo', ativo);
    chip.setAttribute('aria-pressed', String(ativo));
    atualizarBotaoLimparFiltros(els.buscaFiltros, cargosAtivos.size > 0);
    els.buscaLista.scrollTop = 0;
    renderBusca();
  });
  els.buscaFiltrosPartidos.addEventListener('click', e => {
    if (e.target.closest('[data-limpar-filtros]')) {
      partidosAtivos.clear();
      for (const chip of els.buscaFiltrosPartidos.querySelectorAll('[data-partido]')) {
        chip.classList.remove('is-ativo');
        chip.setAttribute('aria-pressed', 'false');
      }
      atualizarBotaoLimparFiltros(els.buscaFiltrosPartidos, false);
      els.buscaLista.scrollTop = 0;
      renderBusca();
      return;
    }
    const chip = e.target.closest('.chip-filtro[data-partido]');
    if (!chip) return;
    const { partido } = chip.dataset;
    if (partidosAtivos.has(partido)) partidosAtivos.delete(partido);
    else partidosAtivos.add(partido);
    const ativo = partidosAtivos.has(partido);
    chip.classList.toggle('is-ativo', ativo);
    chip.setAttribute('aria-pressed', String(ativo));
    atualizarBotaoLimparFiltros(els.buscaFiltrosPartidos, partidosAtivos.size > 0);
    els.buscaLista.scrollTop = 0;
    renderBusca();
  });

  /* clique fora do conteúdo fecha: no backdrop, o alvo é o próprio <dialog> */
  els.buscaDialog.addEventListener('click', e => {
    if (e.target === els.buscaDialog || e.target.classList.contains('folha-abas')) {
      fecharBusca();
    }
  });

  els.buscaLista.addEventListener('click', e => {
    const opcao = e.target.closest('.busca-opcao');
    if (opcao) escolherResultado(opcao);
  });

  els.buscaInput.addEventListener('keydown', e => {
    const opcoes = opcoesBusca();
    if (e.key === 'Escape') {
      e.preventDefault();               // fecha em vez de só limpar o campo
      fecharBusca();
    } else if (e.key === 'Enter' && opcoes.length) {
      e.preventDefault();
      escolherResultado(opcoes[0]);
    } else if (e.key === 'ArrowDown' && opcoes.length) {
      e.preventDefault();
      opcoes[0].focus();
    }
  });

  els.buscaDialog.addEventListener('cancel', e => { e.preventDefault(); fecharBusca(); });

  els.buscaLista.addEventListener('keydown', e => {
    const opcoes = opcoesBusca();
    const atual = opcoes.indexOf(document.activeElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const i = atual + (e.key === 'ArrowDown' ? 1 : -1);
      if (i < 0) els.buscaInput.focus();
      else if (i < opcoes.length) opcoes[i].focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      opcoes[0].focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      opcoes[opcoes.length - 1].focus();
    }
  });
}

/* --------------------------------------------------------------- render */

const TAGS = {
  vazio:         { texto: 'INVÁLIDO', tipo: 'invalido' },
  parcial:       { texto: 'INVÁLIDO', tipo: 'invalido' },
  invalido:      { texto: 'INVÁLIDO', tipo: 'invalido' },
  legenda:       { texto: 'VOTO DE LEGENDA', tipo: 'legenda' },
  indeterminado: { texto: '-', tipo: 'neutro' },
};

function renderCard(cargo) {
  const r = resolveCandidate(cargo);
  const el = cargo.el;
  const digits = state.votes[cargo.key];
  const focado = !!state.focus && state.focus.key === cargo.key;

  const paleta = paletaDoPartido(r.party);
  el.card.style.setProperty('--c', paleta ? paleta.cor : 'var(--neutral)');
  el.card.style.setProperty('--c-txt', paleta ? paleta.texto : 'var(--card)');
  el.card.style.setProperty('--c-escura', paleta ? paleta.escura : 'var(--ink-soft)');
  el.card.dataset.corOficial = paleta && paleta.oficial ? '1' : '0';
  el.card.classList.toggle('is-focused', focado);
  el.card.dataset.estado = r.estado;

  for (let i = 0; i < cargo.len; i++) {
    const cell = el.digits[i];
    const d = digits[i];
    cell.textContent = d === null ? '' : d;
    cell.classList.toggle('is-empty', d === null);
    cell.classList.toggle('is-caret', focado && state.focus.index === i);
  }

  /* nome do candidato ou tag ocupando exatamente o mesmo lugar (§19, §20.1) */
  if (r.estado === 'valido') {
    el.name.classList.remove('is-tag');
    el.name.removeAttribute('data-tag');
    aplicarNome(el.name, r.nome);
  } else {
    const tag = TAGS[r.estado];
    el.name.textContent = tag.texto;
    el.name.classList.add('is-tag');
    el.name.dataset.tag = tag.tipo;
    el.name.style.removeProperty('--nl');
  }

  const sigla = r.party || '';
  el.party.hidden = !sigla;
  el.party.textContent = sigla;
  el.office.textContent = nomeCurtoDoCargo(cargo);

  const foto = r.estado === 'valido' ? fotoUrlSegura(r.foto) : null;
  if (foto) {
    if (el.img.getAttribute('src') !== foto) el.img.src = foto;
    el.img.hidden = false;
    el.img.alt = '';
    el.semFoto.hidden = true;              // o "?" não fica sobre a foto
  } else {
    el.img.hidden = true;
    el.img.removeAttribute('src');
    el.semFoto.hidden = false;
  }

  renderRedes(cargo, r);

  const posicao = focado ? ', dígito ' + (state.focus.index + 1) + ' de ' + cargo.len : '';
  el.input.setAttribute('aria-label', nomeDoCargo(cargo) + ', número de ' + cargo.len + ' dígitos');
  el.hint.textContent = (r.estado === 'valido' ? r.nome + ', ' + sigla
                        : TAGS[r.estado].texto) + posicao;
  if (r.estado === 'valido') el.name.title = r.nome;
  else el.name.removeAttribute('title');
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/* Até três links, na ordem que o importador já definiu. Remonta só quando o
 * candidato muda, para não refazer DOM a cada tecla digitada. */
function renderRedes(cargo, r) {
  const el = cargo.el.redes;
  const lista = r.estado === 'valido' ? redesDoCandidato(escopoDo(cargo), r.sq) : null;
  const chave = lista ? escopoDo(cargo) + '|' + r.sq : '';
  if (el.dataset.chave === chave) return;
  el.dataset.chave = chave;
  el.replaceChildren();
  if (!lista) return;

  for (const [cod, url] of lista) {
    const seguro = urlDeRedeSegura(url);
    if (!seguro) continue;
    const [nome, desenho] = ICONES_REDE[cod] || ICONES_REDE.s;

    const a = document.createElement('a');
    a.className = 'rede';
    a.href = seguro;
    a.target = '_blank';
    /* nofollow também diz "não é endosso" */
    a.rel = 'noopener noreferrer nofollow';
    a.setAttribute('aria-label', nome + ' de ' + r.nome + ' (abre em nova aba)');

    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.9');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    /* innerHTML aqui é constante nossa, nunca dado do TSE (§38) */
    svg.innerHTML = desenho;
    a.appendChild(svg);

    /* o card escuta pointerdown E click para focar dígito (§26): sem parar a
     * propagação, tocar no ícone também moveria o foco do número */
    for (const evento of ['pointerdown', 'click']) {
      a.addEventListener(evento, e => e.stopPropagation());
    }
    el.appendChild(a);
  }
}

function renderAll() { for (const cargo of CARGOS) renderCard(cargo); }

/* --------------------------------------------------------------- status */

function atualizarStatus() {
  const pendente = carregando.size > 0;
  const falhou = CARGOS.some(c => {
    const b = bases.get(escopoDo(c));
    return b && b.status === 'error';
  });

  if (pendente) {
    els.status.textContent = 'carregando dados…';
    els.status.dataset.kind = 'info';
  } else if (falhou) {
    els.status.textContent = 'Não foi possível validar os candidatos agora.';
    els.status.dataset.kind = 'warn';
  } else if (meta && meta.fonte && meta.fonte !== 'TSE') {
    els.status.textContent = 'dados de exemplo - base não oficial (' + meta.fonte + ')';
    els.status.dataset.kind = 'warn';
  } else {
    els.status.textContent = '';
    els.status.dataset.kind = 'info';
  }
  document.body.classList.toggle('has-status', els.status.textContent !== '');
}

let toastTimer = 0;
function toast(msg) {
  els.toast.textContent = msg;
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { els.toast.hidden = true; }, 2200);
}

/* ------------------------------------------------------- cola em texto (§5) */

/* Texto para colar em conversa: só cargo e número. Nome, partido e foto vão na
 * imagem, que segue junto no compartilhamento — repetir tudo em texto deixava a
 * cola pesada de ler. Linha em branco só entre o título e os votos (e, no
 * caminho do clipboard, antes do link). */
function textoDaCola() {
  const linhas = [];
  for (const cargo of CARGOS) {
    const digits = state.votes[cargo.key];
    if (digits.every(d => d === null)) continue;
    linhas.push(nomeCurtoDoCargo(cargo) + ' · ' + codificarVoto(digits));
  }
  if (!linhas.length) return null;

  return 'Minha cola eleitoral 2026 - ' + state.uf + '\n\n' + linhas.join('\n');
}

/* -------------------------------------------------------- imagem do santinho */

/* Desenha a cola num canvas e devolve um PNG. Sem biblioteca: o layout é
 * reescrito aqui em 2D, o que dá controle total e mantém o site sem dependência
 * (§36). Tudo é do mesmo domínio, então o canvas não fica "tainted" e toBlob
 * funciona (§38). */
const IMG_LARGURA = 1080;
const IMG_MARGEM = 40;
const IMG_CARTAO_H = 208;
const IMG_ESPACO = 18;
const IMG_CABECALHO = 132;
const FAMILIA = '"Helvetica Neue", Helvetica, Arial, sans-serif';

function carregarImagem(src) {
  return new Promise(resolve => {
    if (!src) { resolve(null); return; }
    const img = new Image();
    img.decoding = 'sync';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function caminhoArredondado(ctx, x, y, w, h, r) {
  const raio = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + raio, y);
  ctx.arcTo(x + w, y, x + w, y + h, raio);
  ctx.arcTo(x + w, y + h, x, y + h, raio);
  ctx.arcTo(x, y + h, x, y, raio);
  ctx.arcTo(x, y, x + w, y, raio);
  ctx.closePath();
}

/* quebra o nome em até duas linhas, como no card */
function quebrarEmDuas(ctx, texto, largura) {
  if (ctx.measureText(texto).width <= largura) return [texto];
  const palavras = texto.split(' ');
  let melhor = [texto, ''];
  for (let i = 1; i < palavras.length; i++) {
    const a = palavras.slice(0, i).join(' ');
    const b = palavras.slice(i).join(' ');
    const pior = Math.max(ctx.measureText(a).width, ctx.measureText(b).width);
    if (pior < Math.max(ctx.measureText(melhor[0]).width, ctx.measureText(melhor[1]).width)) {
      melhor = [a, b];
    }
  }
  return melhor;
}

function desenharCartao(ctx, x, y, w, h, cargo, foto) {
  const r = resolveCandidate(cargo);
  const paleta = paletaDoPartido(r.party);
  const cor = paleta ? paleta.cor : '#9a9ca2';
  const corEscura = paleta ? paleta.escura : '#4b4d52';
  const corTexto = paleta && paleta.texto === 'var(--ink)' ? '#17181b' : '#fbfbfc';
  const raio = 18;

  /* cartão */
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,.18)';
  ctx.shadowBlur = 14;
  ctx.shadowOffsetY = 4;
  ctx.fillStyle = '#fbfbfc';
  caminhoArredondado(ctx, x, y, w, h, raio);
  ctx.fill();
  ctx.restore();

  /* faixa com recorte diagonal */
  const fotoH = h * 0.78;
  const fotoW = fotoH * 0.75;
  const fotoX = x + 22;
  const fotoY = y + (h - fotoH) / 2;
  const faixaW = 22 + fotoW + 52;
  ctx.save();
  caminhoArredondado(ctx, x, y, w, h, raio);
  ctx.clip();
  const grad = ctx.createLinearGradient(x, y, x + faixaW, y + h);
  grad.addColorStop(0, cor);
  grad.addColorStop(1, corEscura);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + faixaW, y);
  ctx.lineTo(x + faixaW * 0.58, y + h);
  ctx.lineTo(x, y + h);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  /* foto (ou placeholder) */
  ctx.save();
  caminhoArredondado(ctx, fotoX, fotoY, fotoW, fotoH, 10);
  ctx.clip();
  ctx.fillStyle = '#e6e6e9';
  ctx.fillRect(fotoX, fotoY, fotoW, fotoH);
  if (foto) {
    const escala = Math.max(fotoW / foto.naturalWidth, fotoH / foto.naturalHeight);
    const lw = foto.naturalWidth * escala;
    const lh = foto.naturalHeight * escala;
    ctx.drawImage(foto, fotoX + (fotoW - lw) / 2, fotoY + (fotoH - lh) * 0.22, lw, lh);
  } else {
    ctx.fillStyle = '#b9bbc0';
    ctx.font = '700 ' + Math.round(fotoH * 0.42) + 'px ' + FAMILIA;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('?', fotoX + fotoW / 2, fotoY + fotoH / 2);
  }
  ctx.restore();
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,.95)';
  ctx.lineWidth = 5;
  caminhoArredondado(ctx, fotoX, fotoY, fotoW, fotoH, 10);
  ctx.stroke();
  ctx.restore();

  /* número, da direita para a esquerda */
  const digits = state.votes[cargo.key];
  const numTamanho = Math.round(h * 0.42);
  ctx.font = '800 ' + numTamanho + 'px ' + FAMILIA;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const celulaW = numTamanho * 0.74;
  const separador = cargo.legenda ? numTamanho * 0.22 : 0;
  const numW = celulaW * cargo.len + separador;
  const numX = x + w - 26 - numW;
  const meioY = y + h / 2;
  for (let i = 0; i < cargo.len; i++) {
    const cx = numX + celulaW * i + celulaW / 2 + (cargo.legenda && i >= 2 ? separador : 0);
    ctx.fillStyle = 'rgba(0,0,0,.045)';
    caminhoArredondado(ctx, cx - celulaW / 2 + 3, meioY - numTamanho * 0.62,
                       celulaW - 6, numTamanho * 1.24, 6);
    ctx.fill();
    ctx.fillStyle = digits[i] === null ? '#c2c4c9' : corEscura;
    ctx.fillText(digits[i] === null ? '-' : digits[i], cx, meioY + 2);
  }
  if (cargo.legenda) {
    const sepX = numX + celulaW * 2 + separador / 2;
    ctx.save();
    ctx.strokeStyle = '#c2c4c9';
    ctx.lineWidth = 4;
    ctx.setLineDash([5, 7]);
    ctx.beginPath();
    ctx.moveTo(sepX, meioY - numTamanho * 0.5);
    ctx.lineTo(sepX, meioY + numTamanho * 0.5);
    ctx.stroke();
    ctx.restore();
  }

  /* identidade */
  const identX = fotoX + fotoW + 34;
  const identW = numX - identX - 24;
  ctx.textAlign = 'left';

  const cargoTexto = nomeCurtoDoCargo(cargo).toUpperCase();
  const nomeTamanho = 40;
  const seloAltura = 34;

  if (r.estado === 'valido') {
    ctx.fillStyle = '#17181b';
    ctx.font = '800 ' + nomeTamanho + 'px ' + FAMILIA;
    const linhas = quebrarEmDuas(ctx, r.nome.toUpperCase(), identW);
    const alturaBloco = linhas.length * nomeTamanho * 1.06 + 12 + seloAltura;
    let ly = meioY - alturaBloco / 2 + nomeTamanho * 0.55;
    for (const linha of linhas) {
      ctx.fillText(linha, identX, ly);
      ly += nomeTamanho * 1.06;
    }
    desenharSeloECargo(ctx, identX, ly + 6, r.party, cargoTexto, cor, corTexto, seloAltura);
  } else {
    const tag = r.estado === 'legenda' ? 'VOTO DE LEGENDA'
              : r.estado === 'indeterminado' ? '-' : 'INVÁLIDO';
    const alturaBloco = seloAltura + 12 + seloAltura;
    let ly = meioY - alturaBloco / 2;
    ctx.font = '800 26px ' + FAMILIA;
    const tagW = ctx.measureText(tag).width + 28;
    const tagCor = r.estado === 'legenda' ? cor : '#9a9ca2';
    ctx.fillStyle = 'rgba(0,0,0,.06)';
    caminhoArredondado(ctx, identX, ly, tagW, seloAltura, 5);
    ctx.fill();
    ctx.fillStyle = r.estado === 'legenda' ? corEscura : '#6b6d73';
    ctx.textBaseline = 'middle';
    ctx.fillText(tag, identX + 14, ly + seloAltura / 2 + 1);
    desenharSeloECargo(ctx, identX, ly + seloAltura + 12 + seloAltura / 2,
                       r.estado === 'legenda' ? r.party : '', cargoTexto,
                       tagCor, corTexto, seloAltura);
  }
}

function desenharSeloECargo(ctx, x, meio, sigla, cargoTexto, cor, corTexto, altura) {
  ctx.textBaseline = 'middle';
  let cursor = x;
  if (sigla) {
    ctx.font = '800 24px ' + FAMILIA;
    const w = ctx.measureText(sigla).width + 26;
    ctx.fillStyle = cor;
    caminhoArredondado(ctx, cursor, meio - altura / 2, w, altura, 5);
    ctx.fill();
    ctx.fillStyle = corTexto;
    ctx.fillText(sigla, cursor + 13, meio + 1);
    cursor += w + 14;
  }
  ctx.font = '700 22px ' + FAMILIA;
  ctx.fillStyle = '#6b6d73';
  ctx.fillText(cargoTexto, cursor, meio + 1);
}

async function gerarImagem() {
  const altura = IMG_CABECALHO + CARGOS.length * IMG_CARTAO_H +
                 (CARGOS.length - 1) * IMG_ESPACO + IMG_MARGEM;
  const canvas = document.createElement('canvas');
  canvas.width = IMG_LARGURA;
  canvas.height = altura;
  const ctx = canvas.getContext('2d');

  /* fundo */
  ctx.fillStyle = '#ececee';
  ctx.fillRect(0, 0, IMG_LARGURA, altura);
  ctx.save();
  ctx.strokeStyle = 'rgba(0,0,0,.016)';
  ctx.lineWidth = 3;
  for (let i = -altura; i < IMG_LARGURA; i += 10) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + altura, altura);
    ctx.stroke();
  }
  ctx.restore();

  /* cabeçalho: marca, bandeira e sigla */
  const [bandeira, ...fotos] = await Promise.all([
    carregarImagem(bandeiraDaUf(state.uf)),
    ...CARGOS.map(cargo => {
      const r = resolveCandidate(cargo);
      const url = r.estado === 'valido' ? fotoUrlSegura(r.foto) : null;
      return carregarImagem(url);
    }),
  ]);

  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  const baseY = IMG_MARGEM + 34;
  ctx.font = '800 54px ' + FAMILIA;
  ctx.fillStyle = '#17181b';
  ctx.fillText('santinho', IMG_MARGEM, baseY);
  const marcaW = ctx.measureText('santinho').width;
  ctx.fillStyle = '#6b6d73';
  ctx.fillText('.art', IMG_MARGEM + marcaW, baseY);

  if (bandeira) {
    const bh = 40;
    const bw = bh * 10 / 7;
    const bx = IMG_LARGURA - IMG_MARGEM - bw - 76;
    ctx.save();
    caminhoArredondado(ctx, bx, baseY - bh / 2, bw, bh, 4);
    ctx.clip();
    ctx.drawImage(bandeira, bx, baseY - bh / 2, bw, bh);
    ctx.restore();
    ctx.font = '800 34px ' + FAMILIA;
    ctx.fillStyle = '#17181b';
    ctx.fillText(state.uf, bx + bw + 12, baseY + 1);
  }

  ctx.font = '600 26px ' + FAMILIA;
  ctx.fillStyle = '#6b6d73';
  ctx.fillText('nada impresso: nem voto, nem santinho', IMG_MARGEM, baseY + 44);

  /* cartões */
  const largura = IMG_LARGURA - IMG_MARGEM * 2;
  CARGOS.forEach((cargo, i) => {
    const y = IMG_CABECALHO + i * (IMG_CARTAO_H + IMG_ESPACO);
    desenharCartao(ctx, IMG_MARGEM, y, largura, IMG_CARTAO_H, cargo, fotos[i]);
  });

  /* JPEG e não PNG: as fotos são o volume da imagem e comprimem muito melhor
   * assim (505 KB → ~170 KB), e todo alvo de compartilhamento aceita JPEG.
   * WebP seria menor ainda, mas alguns alvos ainda tropeçam nele. */
  return new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.92));
}

/* -------------------------------------------------------- compartilhar (§5) */

/* A imagem é preparada em segundo plano: gerar carrega fotos e codifica PNG, e
 * o navigator.share precisa ser chamado dentro do gesto do usuário (o Safari
 * recusa se houver await demais antes). Se estiver pronta, vai junto. */
let imagemCache = null;        // { chave, blob }
let gerandoImagem = false;
let timerImagem = 0;

function chaveDoEstado() {
  return state.uf + '|' +
         CARGOS.map(c => codificarVoto(state.votes[c.key])).join('|') + '|' +
         (bases.get(state.uf) ? bases.get(state.uf).status : '-');
}

async function prepararImagem() {
  const chave = chaveDoEstado();
  if (gerandoImagem || (imagemCache && imagemCache.chave === chave)) return;
  gerandoImagem = true;
  try {
    const blob = await gerarImagem();
    if (blob) imagemCache = { chave, blob };
  } catch (e) {
    console.warn('santinho.art: não foi possível gerar a imagem -', e.message);
  } finally {
    gerandoImagem = false;
  }
}

function agendarImagem() {
  clearTimeout(timerImagem);
  timerImagem = setTimeout(() => {
    if (typeof requestIdleCallback === 'function') requestIdleCallback(() => prepararImagem());
    else prepararImagem();
  }, 700);
}

function baixarImagem(blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'santinho-' + state.uf.toLowerCase() + '.jpg';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

async function compartilhar() {
  const url = location.href;
  const texto = textoDaCola();
  const dados = { title: 'santinho.art', url };
  if (texto) dados.text = texto;

  const pronta = imagemCache && imagemCache.chave === chaveDoEstado() ? imagemCache.blob : null;
  const arquivo = pronta
    ? new File([pronta], 'santinho-' + state.uf.toLowerCase() + '.jpg', { type: 'image/jpeg' })
    : null;

  /* melhor caso: imagem + texto + link numa só folha nativa */
  if (arquivo && navigator.canShare && navigator.canShare({ files: [arquivo] })) {
    try {
      await navigator.share({ ...dados, files: [arquivo] });
      return;
    } catch (err) {
      if (err && err.name === 'AbortError') return;   // usuário cancelou
    }
  }
  if (navigator.share) {
    try {
      await navigator.share(dados);
      return;
    } catch (err) {
      if (err && err.name === 'AbortError') return;
    }
  }

  /* sem compartilhamento nativo: copia a cola e entrega a imagem por download */
  const paraCopiar = (texto ? texto + '\n\n' : '') + url;
  let copiou = false;
  try {
    await navigator.clipboard.writeText(paraCopiar);
    copiou = true;
  } catch (_) { /* sem permissão de clipboard */ }

  if (pronta) baixarImagem(pronta);
  if (copiou) toast(pronta ? 'Cola copiada ✓ · imagem baixada' : (texto ? 'Cola copiada ✓' : 'Link copiado ✓'));
  else toast(pronta ? 'Imagem baixada ✓' : 'Copie o link da barra de endereço');
  if (!pronta) prepararImagem();       // deixa pronta para a próxima
}

/* ------------------------------------------------------------------ init */

function trocarUf(novaUf) {
  state.uf = novaUf;
  renderGatilhoUf();
  syncUrl();
  renderAll();                       // cargos estaduais revalidam; presidente não muda (§6)
  /* uma base que falhou não fica presa no cache: trocar de UF é a chance de
   * tentar de novo, sem transformar cada tecla em uma nova requisição (§44) */
  const base = bases.get(state.uf);
  if (base && base.status === 'error') bases.delete(state.uf);
  const carregamento = loadElectionData(state.uf);
  atualizarStatus();
  carregamento.then(() => {
    cacheDeCor.clear();
    renderAll();
    atualizarStatus();
    agendarImagem();
    carregarRedes(state.uf);
    carregarRedes('BR');
  });
}

function observarTecladoVirtual() {
  const vv = window.visualViewport;
  if (!vv) return;
  const aferir = () => {
    document.body.classList.toggle('kb-open', vv.height < window.innerHeight * 0.8);
  };
  vv.addEventListener('resize', aferir);
  aferir();
}

function init() {
  hydrateFromUrl();
  montarCards();
  renderGatilhoUf();
  renderAll();
  syncUrl();                          // normaliza a URL logo na abertura

  ligarSeletorUf();
  ligarBusca();
  els.share.addEventListener('click', compartilhar);
  observarTecladoVirtual();

  const carregamento = Promise.all(
    [carregarMeta(), carregarCores(), loadElectionData('BR'), loadElectionData(state.uf)]);
  atualizarStatus();                  // já com as requisições na fila (§43)
  carregamento.then(() => {
    cacheDeCor.clear();
    renderAll();
    atualizarStatus();
    agendarImagem();
    carregarRedes(state.uf);
    carregarRedes('BR');
  });
}

init();
