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
  ufContagem: document.getElementById('uf-contagem'),
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
      console.warn('santinho.art: base', escopo, 'indisponível —', err.message);
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
      return { estado: 'valido', nome: c.n, party: c.p, foto };
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
  els.ufPlaca.setAttribute('aria-label', 'Estado: ' + state.uf + ' — ' + nome + '. Trocar estado');
  els.ufTrigger.setAttribute('aria-label', 'Trocar estado, hoje ' + nome);
}

/* A lista só é construída na primeira abertura: são 27 bandeiras (163 KB) que
 * não têm por que entrar no primeiro carregamento (§35). */
let listaUfMontada = false;

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
    const combina = termos.every(t => palavras.some(p => p.startsWith(t)));
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
    ident.append(name, metaLinha);

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

    cargo.el = { card, img, semFoto, name, party, office, digits: digitEls, input, hint };
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
  if (!termos.length) return { termos, achados: itens };

  const achados = itens.filter(item => pontuar(termos, item.palavras, item.normal) >= 0);
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
  indeterminado: { texto: '—', tipo: 'neutro' },
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

  const posicao = focado ? ', dígito ' + (state.focus.index + 1) + ' de ' + cargo.len : '';
  el.input.setAttribute('aria-label', nomeDoCargo(cargo) + ', número de ' + cargo.len + ' dígitos');
  el.hint.textContent = (r.estado === 'valido' ? r.nome + ', ' + sigla
                        : TAGS[r.estado].texto) + posicao;
  if (r.estado === 'valido') el.name.title = r.nome;
  else el.name.removeAttribute('title');
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
    els.status.textContent = 'dados de exemplo — base não oficial (' + meta.fonte + ')';
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

/* -------------------------------------------------------- compartilhar (§5) */

async function compartilhar() {
  const url = location.href;
  if (navigator.share) {
    try {
      await navigator.share({ title: 'santinho.art', text: 'Minha cola eleitoral para 2026', url });
      return;
    } catch (err) {
      if (err && err.name === 'AbortError') return;   // usuário cancelou
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    toast('Link copiado ✓');
  } catch (_) {
    toast('Copie o link da barra de endereço');
  }
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
  carregamento.then(() => { cacheDeCor.clear(); renderAll(); atualizarStatus(); });
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
  carregamento.then(() => { cacheDeCor.clear(); renderAll(); atualizarStatus(); });
}

init();
