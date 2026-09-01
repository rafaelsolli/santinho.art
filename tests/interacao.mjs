/*
 * santinho.art — testes de interação (§48) e de viewport (§50)
 *
 * Dirige um Chrome headless real: valida digitação, backspace, colagem, URL
 * bidirecional, estados do card e ausência de scroll nos tamanhos de tela do
 * §50. Não substitui o teste em Android real (§49): nenhum headless reproduz
 * teclado virtual/IME.
 *
 *   npm install          # instala puppeteer-core (só para os testes)
 *   npm test
 *
 * O Chrome é procurado nos caminhos usuais; para apontar outro:
 *   CHROME_PATH=/caminho/para/chrome npm test
 */
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, mkdtempSync, symlinkSync, cpSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, tmpdir } from 'node:os';

/* ------------------------------------------------------- Chrome e servidor */

function acharChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const fixos = [
    '/opt/google/chrome/chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ];
  for (const c of fixos) if (existsSync(c)) return c;

  /* Chrome baixado pelo puppeteer, se existir */
  const cache = join(homedir(), '.cache', 'puppeteer', 'chrome');
  if (existsSync(cache)) {
    for (const versao of readdirSync(cache).sort().reverse()) {
      for (const sub of ['chrome-linux64/chrome', 'chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing']) {
        const c = join(cache, versao, sub);
        if (existsSync(c)) return c;
      }
    }
  }
  console.error('\n✖ Chrome não encontrado. Use CHROME_PATH=/caminho/para/chrome npm test\n');
  process.exit(1);
}

const PORTA = Number(process.env.PORT || 8123);
const BASE = 'http://localhost:' + PORTA + '/';
const RAIZ = new URL('..', import.meta.url).pathname;

/* Os testes rodam contra uma base fictícia fixa (tests/fixtures/data), não
 * contra data/ — assim uma atualização da base real do TSE não quebra a suíte.
 * Monta um diretório temporário com o site real + os dados de fixture. */
function montarSite() {
  const dir = mkdtempSync(join(tmpdir(), 'santinho-testes-'));
  for (const arquivo of ['index.html', 'styles.css', 'app.js'])
    symlinkSync(join(RAIZ, arquivo), join(dir, arquivo));
  cpSync(join(RAIZ, 'tests', 'fixtures', 'data'), join(dir, 'data'), { recursive: true });
  cpSync(join(RAIZ, 'assets'), join(dir, 'assets'), { recursive: true });
  return dir;
}

const raizServida = montarSite();
const servidor = spawn('python3', ['-m', 'http.server', String(PORTA)],
  { cwd: raizServida, stdio: 'ignore' });
const encerrar = () => {
  try { servidor.kill(); } catch (_) {}
  try { rmSync(raizServida, { recursive: true, force: true }); } catch (_) {}
};
process.on('exit', encerrar);
process.on('SIGINT', () => { encerrar(); process.exit(130); });
await new Promise(r => setTimeout(r, 700));

/* --------------------------------------------------------------- asserções */

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n         esperado: ' + w + '\n         obtido:   ' + g); }
};
const ok = (name, cond, info = '') => eq(name + (info ? ' ' + info : ''), !!cond, true);

const READ = (key) => {
  const card = document.querySelector('.card[data-cargo="' + key + '"]');
  const cells = [...card.querySelectorAll('.digit')];
  const img = card.querySelector('img');
  return {
    digits: cells.map(d => d.textContent === '' ? '_' : d.textContent).join(''),
    caret: cells.findIndex(d => d.classList.contains('is-caret')),
    name: card.querySelector('.name').textContent,
    tag: card.querySelector('.name').dataset.tag || null,
    party: card.querySelector('.party').hidden ? null : card.querySelector('.party').textContent,
    office: card.querySelector('.office').textContent,
    focused: card.classList.contains('is-focused'),
    estado: card.dataset.estado,
    photo: img.hidden ? null : img.getAttribute('src'),
  };
};

const browser = await puppeteer.launch({
  executablePath: acharChrome(), headless: 'shell', args: ['--no-sandbox'] });
const page = await browser.newPage();
const erros = [];
page.on('pageerror', e => erros.push(String(e)));
page.on('console', m => { const t = m.text();
  if (m.type() === 'error' && !t.includes('Failed to load resource')) erros.push(t); });
const read = key => page.evaluate(READ, key);
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* o seletor de UF é um diálogo: abre pelo gatilho, escolhe pela bandeira */
async function escolherUf(uf) {
  await page.click('#uf-trigger');
  await sleep(120);
  await page.click(`.uf-opcao[data-uf="${uf}"]`);
  await esperarFolhaFechar();
}
const siglaNoCabecalho = () => page.$eval('#uf-sigla', e => e.textContent);

/* a folha desce animada (~170ms) antes de o <dialog> fechar de fato */
const esperarFolhaFechar = () => sleep(420);

/* ------------------------------------------------- §50 viewports: sem scroll */
console.log('\n== §50 viewports (zero scroll vertical, zero overflow horizontal)');
for (const [w, h] of [[320,640],[360,800],[375,667],[390,844],[412,915],[430,932],
                      /* alturas do §32 */ [390,667],[390,720],[390,740],[390,780],
                      [390,800],[390,896],[390,932],
                      /* desktop como adaptação (§2.2) */ [1280,800],[1024,640]]) {
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.goto(BASE + '?uf=sp&df=1313&de=13131&s1=131&s2=132&g=13&p=31', { waitUntil: 'networkidle0' });
  await sleep(120);
  const m = await page.evaluate(() => {
    const de = document.scrollingElement;
    const cards = [...document.querySelectorAll('.card')];
    return {
      vScroll: de.scrollHeight - de.clientHeight,
      hScroll: de.scrollWidth - de.clientWidth,
      nCards: cards.length,
      minCardH: Math.min(...cards.map(c => c.getBoundingClientRect().height)),
      lastBottom: cards[cards.length-1].getBoundingClientRect().bottom,
      innerH: window.innerHeight,
      digitsFit: cards.every(c => {
        const d = c.querySelector('.digits').getBoundingClientRect();
        const r = c.getBoundingClientRect();
        return d.right <= r.right + 1 && d.left >= r.left;
      }),
      nameVisible: cards.every(c => c.querySelector('.name').getBoundingClientRect().width > 8),
      semTruncar: cards.every(c => {
        const alvos = [c.querySelector('.name'), c.querySelector('.office'), c.querySelector('.party')];
        return alvos.every(e => e.hidden || e.scrollWidth <= e.clientWidth + 1);
      }),
      cromo: (() => {
        const r = sel => document.querySelector(sel).getBoundingClientRect();
        const placa = r('#uf-placa-trigger'), uf = r('#uf-trigger');
        const busca = r('#busca-trigger'), share = r('#share'), cards = r('.cards');
        /* cabeçalho e rodapé têm alturas próprias: os controles de cima são
           mais baixos, para o cabeçalho ocupar o mínimo de altura */
        const alturasTopo = [placa.height, share.height];
        const alturasRodape = [uf.height, busca.height];
        const h1 = document.querySelector('.brand-name');
        const marcaVisivel = getComputedStyle(h1).display !== 'none';
        const faixa = document.createRange();
        faixa.selectNodeContents(h1);
        const tituloTexto = faixa.getBoundingClientRect();
        const ctrl = document.querySelector('.controls').getBoundingClientRect();
        return {
          /* o subtítulo foi removido: nada deve ter sobrado no DOM */
          semSubtitulo: !document.querySelector('.tagline'),
          /* placa de estado e compartilhar dividem a primeira faixa */
          placaNoCabecalho: placa.top < cards.top,
          placaAntesDoShare: placa.right <= share.left + 1,
          /* dentro de cada faixa, os controles têm a mesma altura */
          mesmaAlturaTopo: Math.abs(alturasTopo[0] - alturasTopo[1]) < 0.6,
          mesmaAlturaRodape: Math.abs(alturasRodape[0] - alturasRodape[1]) < 0.6,
          topoMaisBaixoQueRodape: alturasTopo[0] < alturasRodape[0] + 0.5,
          /* trocar estado e buscar no rodapé, abaixo dos cards e dentro da tela */
          rodapeDentro: busca.bottom <= innerHeight + 0.5 && uf.top >= cards.bottom - 0.5,
          shareDentro: share.right <= innerWidth,
          /* a marca não ganhou espaços parasitas nem encavala na placa; em tela
             minúscula ela cede lugar, e aí não há o que medir */
          marca: h1.textContent,
          /* o ".art" recua num cinza discreto, sem perder contraste de texto
             grande (3:1); "santinho" segue em tinta cheia */
          sufixoMaisClaro: (() => {
            const lum = cor => {
              const [r2, g2, b2] = cor.match(/\d+/g).map(Number);
              const f = v => { const x = v / 255; return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
              return 0.2126 * f(r2) + 0.7152 * f(g2) + 0.0722 * f(b2);
            };
            const sufixo = document.querySelector('.brand-sufixo');
            if (!sufixo) return false;
            const lSuf = lum(getComputedStyle(sufixo).color);
            const lTitulo = lum(getComputedStyle(h1).color);
            const lFundo = lum(getComputedStyle(document.body).backgroundColor);
            const razao = (Math.max(lSuf, lFundo) + 0.05) / (Math.min(lSuf, lFundo) + 0.05);
            return lSuf > lTitulo && razao >= 3;
          })(),
          marcaVisivel,
          marcaCabe: !marcaVisivel || tituloTexto.right <= placa.left,
          tituloNoTopo: !marcaVisivel || Math.abs(tituloTexto.top - ctrl.top) <= 3,
        };
      })(),
    };
  });
  const tag = w + 'x' + h;
  ok('sem scroll vertical', m.vScroll <= 1, tag + ' (overflow ' + m.vScroll + 'px)');
  ok('sem overflow horizontal', m.hScroll <= 1, tag + ' (overflow ' + m.hScroll + 'px)');
  ok('6 cards', m.nCards === 6, tag);
  ok('ultimo card dentro da viewport', m.lastBottom <= m.innerH + 1, tag + ' (' + m.lastBottom.toFixed(1) + '/' + m.innerH + ')');
  ok('numero cabe no card', m.digitsFit, tag);
  ok('nome visivel', m.nameVisible, tag);
  ok('tag/cargo/partido sem truncar', m.semTruncar, tag);
  ok('placa de estado no cabecalho, antes do compartilhar',
     m.cromo.placaNoCabecalho && m.cromo.placaAntesDoShare, tag);
  ok('placa e compartilhar com a mesma altura', m.cromo.mesmaAlturaTopo, tag);
  ok('as duas abas do rodape com a mesma altura', m.cromo.mesmaAlturaRodape, tag);
  ok('controles do topo mais baixos que as abas', m.cromo.topoMaisBaixoQueRodape, tag);
  ok('estado e busca no rodape, dentro da tela', m.cromo.rodapeDentro, tag);
  ok('compartilhar dentro da tela', m.cromo.shareDentro, tag);
  ok('marca cabe sem encavalar na placa', m.cromo.marcaCabe, tag);
  ok('titulo na mesma faixa dos controles', m.cromo.tituloNoTopo, tag);
  ok('subtitulo removido do DOM', m.cromo.semSubtitulo, tag);
  eq('marca sem espacos parasitas ' + tag, m.cromo.marca, 'santinho.art');
  ok('".art" em cinza mais claro que "santinho"', m.cromo.sufixoMaisClaro, tag);
}

/* pior caso: card de 5 dígitos focado, com a tag VOTO DE LEGENDA */
console.log('\n== §33 pior caso horizontal (de focado, tag de legenda)');
for (const [w, h] of [[320,640],[360,800],[390,844]]) {
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.goto(BASE + '?uf=sp&de=13', { waitUntil: 'networkidle0' });
  await sleep(120);
  await page.click('.card[data-cargo="de"] .digit[data-index="2"]');
  await sleep(120);
  const m = await page.evaluate(() => {
    const c = document.querySelector('.card[data-cargo="de"]');
    const n = c.querySelector('.name'), o = c.querySelector('.office');
    return { tag: n.textContent, truncTag: n.scrollWidth > n.clientWidth + 1,
             truncOffice: o.scrollWidth > o.clientWidth + 1,
             hScroll: document.scrollingElement.scrollWidth - document.scrollingElement.clientWidth };
  });
  eq('tag completa ' + w, m.tag, 'VOTO DE LEGENDA');
  ok('tag nao truncada', !m.truncTag, w + 'px');
  ok('cargo nao truncado', !m.truncOffice, w + 'px');
  ok('sem overflow horizontal', m.hScroll <= 1, w + 'px');
}

/* --------------------------------------------------- §4.2 hidratação por URL */
console.log('\n== §4.2 inicialização por URL');
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await page.goto(BASE + '?uf=sp&df=1313&de=13131&s1=131&s2=132&g=13&p=31', { waitUntil: 'networkidle0' });
await sleep(150);
eq('uf no cabecalho', await siglaNoCabecalho(), 'SP');
eq('bandeira no cabecalho', await page.$eval('#uf-flag', e => e.getAttribute('src')),
   'assets/flags/SP.png');
const df = await read('df');
eq('df digitos', df.digits, '1313');
eq('df nome', df.name, 'MAYA EXEMPLO');
eq('df partido', df.party, 'FUT');
eq('df foto', df.photo, 'data/photos/exemplo-1.svg');
eq('placeholder "?" escondido quando ha foto', await page.$eval(
  '.card[data-cargo="df"] .photo-empty', e => e.hidden), true);
eq('placeholder "?" visivel sem foto', await page.$eval(
  '.card[data-cargo="s2"] .photo-empty', e => e.hidden), false);
eq('foto quebrada volta ao placeholder', await page.evaluate(async () => {
  const c = document.querySelector('.card[data-cargo="df"]');
  const img = c.querySelector('img');
  img.src = 'data/photos/nao-existe.jpg';
  await new Promise(r => img.addEventListener('error', r, { once: true }));
  return [img.hidden, c.querySelector('.photo-empty').hidden];
}), [true, false]);
eq('df estado', df.estado, 'valido');
eq('de nome', (await read('de')).name, 'JOAO EXEMPLO');
eq('s1 nome', (await read('s1')).name, 'RUTE EXEMPLO');
eq('s2 nome', (await read('s2')).name, 'IVO DEMO');
eq('s1 e s2 independentes', [(await read('s1')).digits, (await read('s2')).digits], ['131','132']);
eq('g nome', (await read('g')).name, 'AGDA EXEMPLO');
eq('presidente (base nacional)', (await read('p')).name, 'PRES DEMO B');
eq('rotulo curto do cargo', (await read('de')).office, 'Dep. estadual');

/* --------------------------------------------------- §48 digitação normal */
console.log('\n== §48 digitação, substituição, backspace');
await page.goto(BASE, { waitUntil: 'networkidle0' });
await sleep(150);
eq('estado inicial vazio', (await read('g')).digits, '__');
await page.click('.card[data-cargo="g"] .digit[data-index="0"]');
eq('foco no digito 0', (await read('g')).caret, 0);
ok('card destacado', (await read('g')).focused);
await page.keyboard.press('1');
eq('digitou 1 -> avanca', [(await read('g')).digits, (await read('g')).caret], ['1_', 1]);
await page.keyboard.press('3');
eq('digitou 3 -> ultimo digito mantem foco', [(await read('g')).digits, (await read('g')).caret], ['13', 1]);
const g = await read('g');
eq('governador resolvido', [g.name, g.party, g.estado], ['AGDA EXEMPLO', 'FUT', 'valido']);

await page.click('.card[data-cargo="g"] .digit[data-index="0"]');
await page.keyboard.press('3');
eq('substituicao no digito tocado', (await read('g')).digits, '33');
await page.click('.card[data-cargo="g"] .digit[data-index="0"]');
await page.keyboard.press('1');
eq('volta para 13', (await read('g')).digits, '13');

await page.click('.card[data-cargo="g"] .digit[data-index="1"]');
await page.keyboard.press('Backspace');
eq('backspace com valor apaga o proprio', [(await read('g')).digits, (await read('g')).caret], ['1_', 1]);
await page.keyboard.press('Backspace');
eq('backspace em vazio volta e apaga anterior', [(await read('g')).digits, (await read('g')).caret], ['__', 0]);
await page.keyboard.press('Backspace');
eq('backspace no primeiro digito nao estoura', [(await read('g')).digits, (await read('g')).caret], ['__', 0]);

/* ----------------------------------------------------------- §25 delete */
await page.keyboard.press('1'); await page.keyboard.press('3');
await page.click('.card[data-cargo="g"] .digit[data-index="0"]');
await page.keyboard.press('Delete');
eq('delete apaga o digito atual sem mover', [(await read('g')).digits, (await read('g')).caret], ['_3', 0]);

/* -------------------------------------------------- §27 navegação por setas */
await page.keyboard.press('ArrowRight');
eq('ArrowRight', (await read('g')).caret, 1);
await page.keyboard.press('ArrowLeft');
eq('ArrowLeft', (await read('g')).caret, 0);
await page.keyboard.press('ArrowLeft');
eq('ArrowLeft satura em 0', (await read('g')).caret, 0);

/* ---------------------------------------------------------- §20 legenda */
console.log('\n== §20 voto de legenda e separador');
await page.click('.card[data-cargo="df"] .digit[data-index="0"]');
await page.keyboard.press('1'); await page.keyboard.press('3');
const leg = await read('df');
eq('legenda: tag no lugar do nome', [leg.name, leg.tag], ['VOTO DE LEGENDA', 'legenda']);
eq('legenda: mostra partido', leg.party, 'FUT');
eq('legenda: sem foto de candidato', leg.photo, null);
eq('legenda: digitos', leg.digits, '13__');
const sep = await page.evaluate(() => {
  const cel = document.querySelector('.card[data-cargo="df"] .digit[data-index="2"]');
  const g = document.querySelector('.card[data-cargo="g"] .digit[data-index="1"]');
  const st = getComputedStyle(cel, '::before');
  return { classe: cel.classList.contains('after-party'), estilo: st.borderLeftStyle,
           gTem: document.querySelector('.card[data-cargo="g"] .digit.after-party') !== null };
});
eq('separador apos 2 digitos no proporcional', [sep.classe, sep.estilo], [true, 'dotted']);
eq('cargo majoritario nao tem separador', sep.gTem, false);
await page.keyboard.press('1'); await page.keyboard.press('3');
eq('legenda -> candidato completo', (await read('df')).name, 'MAYA EXEMPLO');

/* --------------------------------------------------------- §19 inválido */
console.log('\n== §19 inválido');
await page.click('.card[data-cargo="s1"] .digit[data-index="0"]');
for (const k of ['9','9','9']) await page.keyboard.press(k);
const inv = await read('s1');
eq('numero inexistente -> INVALIDO', [inv.name, inv.tag, inv.estado], ['INVÁLIDO', 'invalido', 'invalido']);
eq('invalido: sem partido', inv.party, null);
eq('invalido: sem foto', inv.photo, null);
const ph = await page.$eval('.card[data-cargo="s1"] .photo-empty', e => e.textContent);
eq('invalido: placeholder ?', ph, '?');
await page.click('.card[data-cargo="de"] .digit[data-index="0"]');
for (const k of ['1','3','9','9','9']) await page.keyboard.press(k);
eq('§13 candidatura inapta nao aparece (de)', (await read('de')).name, 'INVÁLIDO');
await page.click('.card[data-cargo="df"] .digit[data-index="0"]');
for (const k of ['1','3','9','9']) await page.keyboard.press(k);
eq('§13 sit=X -> INVALIDO', [(await read('df')).name, (await read('df')).estado], ['INVÁLIDO', 'invalido']);

/* ------------------------------------------------------------ §28 colar */
console.log('\n== §28 colar');
await page.goto(BASE, { waitUntil: 'networkidle0' }); await sleep(120);
await page.click('.card[data-cargo="de"] .digit[data-index="2"]');
await page.evaluate(() => {
  const dt = new DataTransfer();
  dt.setData('text', 'a1 3-13x1');
  document.activeElement.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
});
eq('colar numero completo de qualquer posicao', (await read('de')).digits, '13131');
eq('colar resolve candidato', (await read('de')).name, 'JOAO EXEMPLO');
await page.click('.card[data-cargo="df"] .digit[data-index="1"]');
await page.evaluate(() => {
  const dt = new DataTransfer(); dt.setData('text', '31');
  document.activeElement.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
});
eq('colar parcial entra na posicao atual', (await read('df')).digits, '_31_');

/* --------------------------------------------------- §26 toque no card */
console.log('\n== §26 toque na área geral do card');
await page.goto(BASE + '?uf=sp&de=131', { waitUntil: 'networkidle0' }); await sleep(120);
await page.click('.card[data-cargo="de"] .office');
eq('toque no card foca primeiro digito vazio', (await read('de')).caret, 3);
await page.goto(BASE + '?uf=sp&g=13', { waitUntil: 'networkidle0' }); await sleep(120);
await page.click('.card[data-cargo="g"] .office');
eq('card cheio foca o ultimo digito', (await read('g')).caret, 1);

/* --------------------------------------------------------- §4.1 URL */
console.log('\n== §4.1 URL acompanha a digitação');
await page.goto(BASE, { waitUntil: 'networkidle0' }); await sleep(120);
const hist0 = await page.evaluate(() => history.length);
eq('url normalizada na abertura', await page.evaluate(() => location.search), '?uf=SP'.toLowerCase());
await page.click('.card[data-cargo="p"] .digit[data-index="0"]');
await page.keyboard.press('1');
eq('url apos 1 digito', await page.evaluate(() => location.search), '?uf=sp&p=1');
await page.keyboard.press('3');
eq('url apos 2 digitos', await page.evaluate(() => location.search), '?uf=sp&p=13');
await page.click('.card[data-cargo="de"] .digit[data-index="0"]');
for (const k of ['1','3']) await page.keyboard.press(k);
eq('url com legenda parcial', await page.evaluate(() => location.search), '?uf=sp&de=13&p=13');
await page.click('.card[data-cargo="de"] .digit[data-index="3"]');
await page.keyboard.press('7');
eq('url codifica buraco', await page.evaluate(() => location.search), '?uf=sp&de=13-7&p=13');
eq('history nao cresce ao digitar', await page.evaluate(() => history.length), hist0);
const url = await page.evaluate(() => location.href);
await page.goto(url, { waitUntil: 'networkidle0' }); await sleep(150);
eq('buraco sobrevive ao recarregar', (await read('de')).digits, '13_7_');

/* ------------------------------------------------------ §6 troca de UF */
console.log('\n== §6 troca de UF');
await page.goto(BASE + '?uf=sp&df=1313&p=13', { waitUntil: 'networkidle0' }); await sleep(150);
eq('SP: df', (await read('df')).name, 'MAYA EXEMPLO');
await escolherUf('MG');
eq('MG mantem os numeros', (await read('df')).digits, '1313');
eq('MG revalida cargo estadual', (await read('df')).name, 'MAYA RIBEIRO DEMO');
eq('presidente permanece nacional', (await read('p')).name, 'PRES EXEMPLO A');
eq('url atualizada', await page.evaluate(() => location.search), '?uf=mg&df=1313&p=13');
await escolherUf('DF');
eq('DF: rotulo deputado distrital', (await read('de')).office, 'Dep. distrital');
eq('DF: aria com nome completo', await page.$eval('#num-de', e => e.getAttribute('aria-label')),
   'Deputado distrital, número de 5 dígitos');
eq('UF sem base -> indeterminado, nao INVALIDO', [(await read('df')).estado, (await read('df')).name], ['indeterminado', '-']);
eq('numeros preservados', (await read('df')).digits, '1313');

/* ------------------------------------------------------- §44 falha de dados */
console.log('\n== §44 falha de dados');
await page.setRequestInterception(true);
const bloq = req => { if (req.url().includes('/data/uf/SP.json')) req.abort(); else req.continue(); };
page.on('request', bloq);
await page.goto(BASE + '?uf=sp&df=1313&g=13', { waitUntil: 'networkidle0' }); await sleep(300);
eq('numeros preservados na falha', (await read('df')).digits, '1313');
eq('estado indeterminado, nao INVALIDO', (await read('df')).estado, 'indeterminado');
eq('presidente ainda valida (base nacional ok)', (await read('p')).estado, 'vazio');
eq('aviso discreto', await page.$eval('#status', e => e.textContent), 'Não foi possível validar os candidatos agora.');
ok('digitacao continua funcionando', await (async () => {
  await page.click('.card[data-cargo="g"] .digit[data-index="0"]');
  await page.keyboard.press('4'); await page.keyboard.press('5');
  return (await read('g')).digits === '45' && (await page.evaluate(() => location.search)).includes('g=45');
})());
page.off('request', bloq);
await page.setRequestInterception(false);
ok('trocar de UF e voltar tenta de novo', await (async () => {
  await escolherUf('MG');
  await escolherUf('SP');
  return (await read('df')).name === 'MAYA EXEMPLO'
      && (await page.$eval('#status', e => e.textContent)) !== 'Não foi possível validar os candidatos agora.';
})());

/* --------------------------------- nomes de urna longos (§15, §33) */
console.log('\n== nomes longos: inteiros, em até duas linhas, sem truncar');
for (const [w, h] of [[320,640],[360,800],[390,844],[430,932]]) {
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.goto(BASE + '?uf=sp&df=1777&de=45123&s1=131&s2=132&g=13&p=31', { waitUntil: 'networkidle0' });
  await sleep(250);
  const m = await page.evaluate(() => {
    const c = document.querySelector('.card[data-cargo="df"]');
    const n = c.querySelector('.name');
    const est = getComputedStyle(n);
    return {
      texto: n.textContent,
      fs: parseFloat(est.fontSize),
      linhas: Math.round(n.clientHeight / (parseFloat(est.fontSize) * 1.06)),
      cortado: n.scrollHeight > n.clientHeight + 1 || n.scrollWidth > n.clientWidth + 1,
      dentroDoCard: n.getBoundingClientRect().bottom <= c.getBoundingClientRect().bottom,
      vOver: document.scrollingElement.scrollHeight - document.scrollingElement.clientHeight,
      hOver: document.scrollingElement.scrollWidth - document.scrollingElement.clientWidth,
    };
  });
  eq('nome completo na tela ' + w, m.texto, 'MARIA DE EXEMPLO SOBRENOME DEMO');
  ok('nada cortado', !m.cortado, w + 'px (' + m.linhas + ' linha(s), ' + m.fs.toFixed(1) + 'px)');
  ok('nome dentro do card', m.dentroDoCard, w + 'px');
  ok('fonte legivel (>= 11px)', m.fs >= 11, w + 'px → ' + m.fs.toFixed(1) + 'px');
  ok('sem scroll vertical', m.vOver <= 1, w + 'px');
  ok('sem overflow horizontal', m.hOver <= 1, w + 'px');
}
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await page.goto(BASE + '?uf=sp&df=1313', { waitUntil: 'networkidle0' });
await sleep(200);
eq('nome curto fica em uma linha', await page.evaluate(() => {
  const n = document.querySelector('.card[data-cargo="df"] .name');
  return Math.round(n.clientHeight / (parseFloat(getComputedStyle(n).fontSize) * 1.06));
}), 1);
eq('nome curto intacto', (await read('df')).name, 'MAYA EXEMPLO');
/* sigla longa empurra o cargo para a linha de baixo, sem suprimi-lo (§32) */
const longa = await page.evaluate(() => {
  const c = document.querySelector('.card[data-cargo="de"]');
  const p = c.querySelector('.party'), o = c.querySelector('.office');
  return { sigla: p.textContent, truncSigla: p.scrollWidth > p.clientWidth + 1,
           cargo: o.textContent, truncCargo: o.scrollWidth > o.clientWidth + 1 };
});
await page.goto(BASE + '?uf=sp&de=45123', { waitUntil: 'networkidle0' });
await sleep(250);
const longa2 = await page.evaluate(() => {
  const c = document.querySelector('.card[data-cargo="de"]');
  const p = c.querySelector('.party'), o = c.querySelector('.office');
  return { sigla: p.textContent, truncSigla: p.scrollWidth > p.clientWidth + 1,
           cargo: o.textContent, truncCargo: o.scrollWidth > o.clientWidth + 1,
           hOver: document.scrollingElement.scrollWidth - document.scrollingElement.clientWidth };
});
eq('sigla longa inteira', longa2.sigla, 'SOLIDARIEDADE-DEMO');
ok('sigla nao truncada', !longa2.truncSigla);
eq('cargo preservado', longa2.cargo, 'Dep. estadual');
ok('cargo nao truncado', !longa2.truncCargo);
ok('sem overflow horizontal com sigla longa', longa2.hOver <= 1);

/* ------------------------------------------------- §43 carregamento lento */
console.log('\n== §43 tratamento de carregamento');
await page.setRequestInterception(true);
const atrasar = async req => {
  if (req.url().includes('/data/uf/SP.json')) { await sleep(600); req.continue(); }
  else req.continue();
};
page.on('request', atrasar);
await page.goto(BASE + '?uf=sp&df=1313', { waitUntil: 'domcontentloaded' });
await sleep(200);
eq('indicacao discreta enquanto carrega', await page.$eval('#status', e => e.textContent), 'carregando dados…');
/* a intenção é "nada cobrindo a interface": nenhum diálogo aberto e o ponto
   central pertencendo à área dos cards (pode cair no vão entre dois) */
eq('nao bloqueia: nenhum overlay', await page.evaluate(() => {
  const el = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
  return !document.querySelector('dialog[open]') &&
         Boolean(el) && Boolean(el.closest('.cards'));
}), true);
ok('permite digitar antes da base chegar', await (async () => {
  await page.click('.card[data-cargo="g"] .digit[data-index="0"]');
  await page.keyboard.press('1'); await page.keyboard.press('3');
  return (await read('g')).digits === '13';
})());
eq('estado neutro, nao INVALIDO', (await read('g')).estado, 'indeterminado');
await sleep(700);
eq('resolve assim que a base chega', (await read('g')).name, 'AGDA EXEMPLO');
eq('numero digitado durante a carga foi preservado', (await read('df')).name, 'MAYA EXEMPLO');
eq('aviso sai depois de carregar', await page.$eval('#status', e => e.textContent), 'dados de exemplo - base não oficial (MOCK)');
page.off('request', atrasar);
await page.setRequestInterception(false);

/* -------------------------------- casinha permanente nos dígitos (contra §30) */
console.log('\n== dígitos: casinha permanente, sem trocar de aparência ao focar');
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await page.goto(BASE + '?uf=sp&df=1313&g=13', { waitUntil: 'networkidle0' });
await sleep(250);
const medirDigitos = () => page.evaluate(() => {
  const cells = [...document.querySelectorAll('.card[data-cargo="df"] .digit')];
  const est = cells.map(c => getComputedStyle(c));
  const caixa = cells.map(c => c.getBoundingClientRect());
  return {
    comFundo: est.every(e => e.backgroundColor !== 'rgba(0, 0, 0, 0)'),
    comBorda: est.every(e => e.boxShadow !== 'none'),
    larguras: caixa.map(r => +r.width.toFixed(1)),
    esquerdas: caixa.map(r => +r.x.toFixed(1)),
    gap: getComputedStyle(document.querySelector('.card[data-cargo="df"] .digits')).columnGap,
  };
});
const emRepouso = await medirDigitos();
ok('casinha visível sem foco', emRepouso.comFundo && emRepouso.comBorda);
ok('dígitos separados sem foco (não é bloco único)', emRepouso.gap !== '0px' && emRepouso.gap !== 'normal',
   '(gap ' + emRepouso.gap + ')');
await page.click('.card[data-cargo="df"] .digit[data-index="1"]');
await sleep(200);
const emEdicao = await medirDigitos();
eq('larguras não mudam ao focar', emEdicao.larguras, emRepouso.larguras);
eq('posições não mudam ao focar', emEdicao.esquerdas, emRepouso.esquerdas);
eq('gap não muda ao focar', emEdicao.gap, emRepouso.gap);
ok('casinha continua visível em edição', emEdicao.comFundo && emEdicao.comBorda);
ok('dígito em foco fica preenchido com a cor do partido', await page.evaluate(() => {
  const c = document.querySelector('.card[data-cargo="df"] .digit.is-caret');
  const fundo = getComputedStyle(c).backgroundColor;
  const cor = document.querySelector('.card[data-cargo="df"]').style.getPropertyValue('--c').trim();
  const n = parseInt(cor.replace('#', ''), 16);
  const esperado = 'rgb(' + [(n >> 16) & 255, (n >> 8) & 255, n & 255].join(', ') + ')';
  return fundo === esperado;
}));
eq('sem bloco diagonal atrás do número', await page.evaluate(() => {
  const n = document.querySelector('.card[data-cargo="df"] .numwrap');
  return getComputedStyle(n, '::before').content;
}), 'none');

/* -------------------------------------------------- cor do partido (§16, §46) */
console.log('\n== cor do partido: oficial quando conhecida, contraste garantido');
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await page.goto(BASE + '?uf=sp&df=1313&g=45&s1=999', { waitUntil: 'networkidle0' });
await sleep(300);
const cores = await page.evaluate(() => {
  const ler = k => {
    const c = document.querySelector('.card[data-cargo="' + k + '"]');
    const selo = c.querySelector('.party');
    const digito = c.querySelector('.digit');
    return { c: c.style.getPropertyValue('--c').trim(),
             oficial: c.dataset.corOficial,
             corSelo: getComputedStyle(selo).color,
             fundoSelo: getComputedStyle(selo).backgroundColor,
             corDigito: getComputedStyle(digito).color };
  };
  return { fut: ler('df'), lum: ler('g'), invalido: ler('s1') };
});
eq('usa a cor oficial da sigla (FUT)', cores.fut.c, '#DA1208');
eq('marcado como cor oficial', cores.fut.oficial, '1');
eq('cor escura sem sigla conhecida cai no hash', cores.invalido.oficial, '0');
eq('cor clara (LUM #FFEE57) usa a cor oficial', cores.lum.c, '#FFEE57');

/* contraste: texto sobre o selo tem de ser claro na cor escura e escuro na clara */
const luminancia = cor => {
  const [r, g, b] = cor.match(/\d+/g).map(Number);
  const lin = v => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};
const razao = (a, b) => {
  const [x, y] = [luminancia(a), luminancia(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
};
ok('selo em cor escura: texto claro', luminancia(cores.fut.corSelo) > 0.5,
   '(' + cores.fut.corSelo + ' sobre ' + cores.fut.fundoSelo + ')');
ok('selo em cor clara: texto escuro', luminancia(cores.lum.corSelo) < 0.2,
   '(' + cores.lum.corSelo + ' sobre ' + cores.lum.fundoSelo + ')');
ok('contraste do selo >= 4.5:1 na cor escura',
   razao(cores.fut.corSelo, cores.fut.fundoSelo) >= 4.5,
   '(' + razao(cores.fut.corSelo, cores.fut.fundoSelo).toFixed(2) + ':1)');
ok('contraste do selo >= 4.5:1 na cor clara',
   razao(cores.lum.corSelo, cores.lum.fundoSelo) >= 4.5,
   '(' + razao(cores.lum.corSelo, cores.lum.fundoSelo).toFixed(2) + ':1)');
const fundoCard = await page.$eval('.card[data-cargo="g"]', e => getComputedStyle(e).backgroundColor);
ok('numero em cor clara ainda contrasta com o card',
   razao(cores.lum.corDigito, fundoCard) >= 4.5,
   '(' + razao(cores.lum.corDigito, fundoCard).toFixed(2) + ':1, ' + cores.lum.corDigito + ')');
ok('numero em cor escura contrasta com o card',
   razao(cores.fut.corDigito, fundoCard) >= 4.5,
   '(' + razao(cores.fut.corDigito, fundoCard).toFixed(2) + ':1)');

/* ------------------------------------------------ folha puxada do rodapé */
console.log('\n== folha: a aba sobe do botão do rodapé e leva a ficha');
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await page.goto(BASE + '?uf=sp&g=13', { waitUntil: 'networkidle0' });
await sleep(250);

/* medido pela API de animações, não por amostragem de quadros: o primeiro e o
   último quadro são lidos com a animação pausada, então o teste é determinístico */
const viagem = await page.evaluate(async () => {
  const rodape = document.getElementById('uf-trigger').getBoundingClientRect();
  document.getElementById('uf-trigger').click();
  await new Promise(r => requestAnimationFrame(r));
  const d = document.getElementById('uf-dialog');
  const anim = d.getAnimations()[0];
  if (!anim) return { semAnimacao: true };
  anim.pause();
  anim.currentTime = 0;
  const inicio = d.querySelector('.folha-abas').getBoundingClientRect();
  anim.currentTime = anim.effect.getTiming().duration;
  const fim = d.querySelector('.folha-abas').getBoundingClientRect();
  anim.play();
  return {
    nome: anim.animationName,
    abaNoInicio: Math.round(inicio.top),
    botaoDoRodape: Math.round(rodape.top),
    abaNoFim: Math.round(fim.top),
  };
});
eq('a folha sobe', viagem.nome, 'folha-sobe');
eq('a aba parte do pixel exato do botao do rodape', viagem.abaNoInicio, viagem.botaoDoRodape);
ok('a aba sobe junto com a ficha', viagem.abaNoFim < viagem.abaNoInicio - 200,
   '(' + viagem.abaNoInicio + ' → ' + viagem.abaNoFim + ')');
await sleep(400);

/* a aba fica no topo da folha, colada no corpo, alinhada com o rodapé */
const ficha = await page.evaluate(() => {
  const d = document.querySelector('dialog[open]');
  const abas = d.querySelector('.folha-abas').getBoundingClientRect();
  const corpo = d.querySelector('.folha-corpo').getBoundingClientRect();
  const par = nome => [
    document.getElementById(nome === 'uf' ? 'uf-trigger' : 'busca-trigger').getBoundingClientRect(),
    d.querySelector('[data-aba="' + nome + '"]').getBoundingClientRect(),
  ];
  const [rUf, aUf] = par('uf');
  const [rBusca, aBusca] = par('busca');
  return {
    abaAcimaDoCorpo: abas.bottom <= corpo.top + 0.5,
    abaColadaNoCorpo: Math.abs(abas.bottom - corpo.top) < 1,
    corpoAteAbase: Math.abs(innerHeight - corpo.bottom) < 1,
    ufAlinhada: Math.abs(rUf.x - aUf.x) < 1 && Math.abs(rUf.width - aUf.width) < 1,
    buscaAlinhada: Math.abs(rBusca.x - aBusca.x) < 1,
    ativaInerte: d.querySelector('.is-ativa').tagName,
    ativa: d.querySelector('.is-ativa').dataset.aba,
  };
});
ok('a aba fica no topo da folha', ficha.abaAcimaDoCorpo && ficha.abaColadaNoCorpo);
const atrasDaFicha = await page.evaluate(() => {
  const d = document.querySelector('dialog[open]');
  const est = e => getComputedStyle(e).boxShadow;
  return {
    ativa: est(d.querySelector('.aba.is-ativa')),
    atras: est(d.querySelector('.aba:not(.is-ativa)')),
    rodape: est(document.getElementById('busca-trigger')),
  };
});
eq('a aba ativa nao tem sombra: funde no corpo', atrasDaFicha.ativa, 'none');
eq('as duas fichas tem as bordas de cima arredondadas', await page.evaluate(() => {
  const raio = sel => {
    const c = document.querySelector(sel + ' .folha-corpo');
    const e = getComputedStyle(c);
    return [e.borderTopLeftRadius, e.borderTopRightRadius, e.borderBottomLeftRadius];
  };
  return { uf: raio('#uf-dialog'), busca: raio('#busca-dialog') };
}), { uf: ['18px', '18px', '0px'], busca: ['18px', '18px', '0px'] });
ok('a aba de tras tem sombra interna na base', atrasDaFicha.atras.includes('inset'),
   '(' + atrasDaFicha.atras.slice(0, 60) + '…)');
ok('a aba fechada tambem tem a sombra interna', atrasDaFicha.rodape.includes('inset'));
ok('o corpo da ficha desce até a base da tela', ficha.corpoAteAbase);
ok('abas alinhadas em x com os botoes do rodape', ficha.ufAlinhada && ficha.buscaAlinhada);
eq('a aba da folha aberta nao e um botao', ficha.ativaInerte, 'SPAN');
eq('a aba ativa e a da folha aberta', ficha.ativa, 'uf');

/* trocar de aba não desce e sobe: a ficha fica parada, só o conteúdo muda */
const troca = await page.evaluate(async () => {
  const antes = Math.round(document.querySelector('dialog[open] .folha-abas').getBoundingClientRect().top);
  document.querySelector('#uf-dialog [data-aba="busca"]').click();
  const posicoes = [];
  for (let i = 0; i < 5; i++) {
    await new Promise(r => requestAnimationFrame(r));
    const ab = document.querySelector('dialog[open] .folha-abas');
    posicoes.push(ab ? Math.round(ab.getBoundingClientRect().top) : null);
  }
  const d = document.querySelector('dialog[open]');
  return { antes, posicoes, animacoes: d.getAnimations().length,
           uf: document.getElementById('uf-dialog').open,
           busca: document.getElementById('busca-dialog').open,
           ativa: d.querySelector('.is-ativa').dataset.aba,
           fileiras: document.querySelectorAll('.folha-abas').length };
});
eq('troca de folha sem mexer na ficha', troca.posicoes, Array(5).fill(troca.antes));
eq('nenhuma animacao na troca', troca.animacoes, 0);
eq('a folha certa fica aberta', [troca.uf, troca.busca, troca.ativa], [false, true, 'busca']);
eq('sem fileira orfa', troca.fileiras, 1);
await page.click('#busca-dialog [data-aba="uf"]');
await sleep(250);
eq('volta pela aba', await page.evaluate(() => document.getElementById('uf-dialog').open), true);

/* a placa do cabeçalho puxa a mesma ficha */
await page.keyboard.press('Escape'); await esperarFolhaFechar();
await page.click('#uf-placa-trigger'); await sleep(450);
eq('placa do cabecalho abre a ficha de estado',
   await page.evaluate(() => document.getElementById('uf-dialog').open), true);
eq('aria-expanded da placa acompanha',
   await page.$eval('#uf-placa-trigger', e => e.getAttribute('aria-expanded')), 'true');
await page.keyboard.press('Escape'); await esperarFolhaFechar();
eq('aria-expanded da placa volta',
   await page.$eval('#uf-placa-trigger', e => e.getAttribute('aria-expanded')), 'false');
await page.click('#uf-trigger'); await sleep(450);

/* fechando, a ficha desce de volta para o rodapé */
const volta = await page.evaluate(async () => {
  const d = document.getElementById('uf-dialog');
  const rodape = Math.round(document.getElementById('uf-trigger').getBoundingClientRect().top);
  document.getElementById('uf-close').click();
  await new Promise(r => requestAnimationFrame(r));
  const anim = d.getAnimations()[0];
  if (!anim) return { semAnimacao: true };
  anim.pause();
  anim.currentTime = anim.effect.getTiming().duration;
  const fim = Math.round(d.querySelector('.folha-abas').getBoundingClientRect().top);
  anim.play();
  return { nome: anim.animationName, fim, rodape };
});
eq('a folha desce', volta.nome, 'folha-desce');
eq('desce até o pixel do botao do rodape', volta.fim, volta.rodape);
await esperarFolhaFechar();
eq('fecha depois de descer', await page.$eval('#uf-dialog', e => e.open), false);
eq('sem classe de fechamento pendurada',
   await page.$eval('#uf-dialog', e => e.classList.contains('is-fechando')), false);

/* no desktop a ficha continua saindo do rodapé, não centrada na tela */
for (const [w, h] of [[1280, 800], [1680, 1050]]) {
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
  await page.goto(BASE + '?uf=sp&g=13', { waitUntil: 'networkidle0' });
  await sleep(300);
  await page.click('#uf-trigger');
  await sleep(500);
  const noDesktop = await page.evaluate(() => {
    const d = document.getElementById('uf-dialog').getBoundingClientRect();
    const rod = document.getElementById('uf-trigger').getBoundingClientRect();
    const aba = document.querySelector('#uf-dialog [data-aba="uf"]').getBoundingClientRect();
    const corpo = document.querySelector('#uf-dialog .folha-corpo');
    return {
      base: Math.round(innerHeight - d.bottom),
      centrada: Math.abs((d.left + d.right) / 2 - innerWidth / 2) < 1.5,
      alturaPct: Math.round(d.height / innerHeight * 100),
      abaAlinhada: Math.abs(aba.x - rod.x) < 1.5 && Math.abs(aba.width - rod.width) < 1.5,
      raioTopo: getComputedStyle(corpo).borderTopLeftRadius,
    };
  });
  const tagD = w + 'x' + h;
  eq('desktop: ficha colada na base ' + tagD, noDesktop.base, 0);
  ok('desktop: ficha centrada em x', noDesktop.centrada, tagD);
  ok('desktop: nao passa de 80% da tela', noDesktop.alturaPct <= 80, tagD + ' (' + noDesktop.alturaPct + '%)');
  ok('desktop: aba alinhada com o botao do rodape', noDesktop.abaAlinhada, tagD);
  eq('desktop: bordas de cima arredondadas ' + tagD, noDesktop.raioTopo, '18px');
  await page.keyboard.press('Escape');
  await esperarFolhaFechar();
}
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await page.goto(BASE + '?uf=sp&g=13', { waitUntil: 'networkidle0' });
await sleep(300);
await page.click('#uf-trigger');
await sleep(400);

/* quem pede menos movimento fecha na hora */
await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
await page.click('#uf-trigger'); await sleep(200);
await page.keyboard.press('Escape'); await sleep(90);
eq('prefers-reduced-motion fecha sem esperar animacao',
   await page.$eval('#uf-dialog', e => e.open), false);
await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);

/* ------------------------------------------- seletor de UF (bandeira + sigla) */
console.log('\n== seletor de UF: diálogo com bandeira, nome e sigla');
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await page.goto(BASE + '?uf=sp&g=13', { waitUntil: 'networkidle0' });
await sleep(200);
eq('cabecalho mostra so a sigla', await siglaNoCabecalho(), 'SP');
eq('cabecalho tem bandeira', await page.$eval('#uf-flag', e => e.getAttribute('src')), 'assets/flags/SP.png');
eq('placa do cabecalho nomeia o estado', await page.$eval('#uf-placa-trigger', e => e.getAttribute('aria-label')),
   'Estado: SP - São Paulo. Trocar estado');
eq('botao do rodape nomeia a acao', await page.$eval('#uf-trigger', e => e.getAttribute('aria-label')),
   'Trocar estado, hoje São Paulo');
ok('sigla visivel contida no nome acessivel da placa (WCAG 2.5.3)', await page.evaluate(() => {
  const b = document.getElementById('uf-placa-trigger');
  return b.getAttribute('aria-label').includes(b.querySelector('.uf-sigla').textContent);
}));
eq('dialogo fechado no inicio', await page.$eval('#uf-dialog', e => e.open), false);
eq('aria-expanded false', await page.$eval('#uf-trigger', e => e.getAttribute('aria-expanded')), 'false');
eq('as 27 bandeiras nao entram no primeiro carregamento',
   await page.evaluate(() => document.querySelectorAll('.uf-opcao').length), 0);

await page.click('#uf-trigger');
await sleep(200);
eq('dialogo abriu', await page.$eval('#uf-dialog', e => e.open), true);
eq('aria-expanded true', await page.$eval('#uf-trigger', e => e.getAttribute('aria-expanded')), 'true');
eq('27 opcoes', await page.evaluate(() => document.querySelectorAll('.uf-opcao').length), 27);
eq('chips de regiao começam desmarcados', await page.evaluate(() =>
  [...document.querySelectorAll('#uf-filtros [data-regiao]')].map(c => c.getAttribute('aria-pressed'))),
['false', 'false', 'false', 'false', 'false']);
await page.click('#uf-filtros [data-regiao="SE"]');
eq('chip de regiao filtra os estados', await page.evaluate(() =>
  [...document.querySelectorAll('#uf-list .uf-opcao')]
    .filter(b => !b.parentElement.hidden).map(b => b.dataset.uf)), ['ES', 'MG', 'RJ', 'SP']);
eq('limpar regioes fica visivel com selecao', await page.$eval(
  '#uf-filtros [data-limpar-filtros]', e => e.hidden), false);
await page.click('#uf-filtros [data-limpar-filtros]');
eq('limpar regioes restaura todos os estados', await page.evaluate(() =>
  [...document.querySelectorAll('#uf-list .uf-opcao')].filter(b => !b.parentElement.hidden).length), 27);
await page.evaluate(() => document.querySelector('.uf-opcao.is-atual').focus());
const opcao = await page.evaluate(() => {
  const b = document.querySelector('.uf-opcao[data-uf="MG"]');
  return { flag: b.querySelector('.uf-opcao-flag').getAttribute('src'),
           nome: b.querySelector('.uf-opcao-nome').textContent,
           sigla: b.querySelector('.uf-opcao-sigla').textContent };
});
eq('opcao traz bandeira, nome e sigla', opcao, { flag: 'assets/flags/MG.png', nome: 'Minas Gerais', sigla: 'MG' });
eq('estado atual marcado', await page.evaluate(() => {
  const a = document.querySelector('.uf-opcao.is-atual');
  return [a.dataset.uf, a.getAttribute('aria-current')];
}), ['SP', 'true']);
eq('foco vai para o estado atual', await page.evaluate(() => document.activeElement.dataset.uf), 'SP');
ok('bandeiras carregaram de verdade', await page.evaluate(async () => {
  await new Promise(r => setTimeout(r, 600));
  const imgs = [...document.querySelectorAll('.uf-opcao-flag')];
  return imgs.filter(i => i.naturalWidth > 0).length >= 10;
}));
const caixa = await page.evaluate(() => {
  const r = document.getElementById('uf-dialog').getBoundingClientRect();
  return { x: Math.round(r.x), largura: Math.round(r.width), viewport: innerWidth,
           base: Math.round(innerHeight - r.bottom), altura: Math.round(r.height),
           tela: innerHeight };
});
const innerHeightDoTeste = caixa.tela;
eq('folha ocupa a largura da tela no celular', [caixa.x, caixa.largura], [0, caixa.viewport]);
eq('folha encostada na base', caixa.base, 0);
ok('folha do estado com 80% da tela', Math.abs(caixa.altura - innerHeightDoTeste * 0.8) <= 2,
   '(' + caixa.altura + ' de ' + innerHeightDoTeste + 'px)');
ok('a lista rola dentro do dialogo, nao na pagina', await page.evaluate(() => {
  const de = document.scrollingElement;
  return de.scrollHeight - de.clientHeight <= 1;
}));

await page.keyboard.press('ArrowDown');
eq('ArrowDown percorre a lista', await page.evaluate(() => document.activeElement.dataset.uf), 'SE');
await page.keyboard.press('ArrowUp');
eq('ArrowUp volta', await page.evaluate(() => document.activeElement.dataset.uf), 'SP');
await page.keyboard.press('Home');
eq('Home vai para o primeiro', await page.evaluate(() => document.activeElement.dataset.uf), 'AC');
/* campo de filtro no lugar do salto por letra */
const filtrarUf = async texto => {
  await page.evaluate(() => { document.getElementById('uf-busca').value = ''; });
  if (texto) await page.type('#uf-busca', texto, { delay: 6 });
  else await page.evaluate(() => document.getElementById('uf-busca').dispatchEvent(new Event('input')));
  await sleep(160);
  return page.evaluate(() => ({
    visiveis: [...document.querySelectorAll('#uf-list .uf-opcao')]
      .filter(b => !b.parentElement.hidden).map(b => b.dataset.uf),
    msg: document.getElementById('uf-contagem').textContent,
  }));
};
eq('sem filtro, os 27 estados', (await filtrarUf('')).visiveis.length, 27);
eq('filtra por nome', (await filtrarUf('minas')).visiveis, ['MG']);
eq('filtra sem acento', (await filtrarUf('ceara')).visiveis, ['CE']);
eq('filtra por sigla', (await filtrarUf('rj')).visiveis, ['RJ']);
eq('filtro parcial casa varios', (await filtrarUf('rio')).visiveis, ['RJ', 'RN', 'RS']);
eq('prefixo de palavra, nao substring', (await filtrarUf('ri')).visiveis, ['RJ', 'RN', 'RS']);
eq('varios termos somam', (await filtrarUf('rio grande')).visiveis, ['RN', 'RS']);
eq('termo casa palavra do meio', (await filtrarUf('grande sul')).visiveis, ['RS']);
eq('sigla nao vira substring de nome', (await filtrarUf('sp')).visiveis, ['SP']);
eq('sem resultado avisa', (await filtrarUf('zzz')).msg, 'nenhum estado encontrado');
eq('sem resultado, lista vazia', (await filtrarUf('zzz')).visiveis, []);
await filtrarUf('bahia');
await page.keyboard.press('ArrowDown');
eq('seta desce do campo para a lista',
   await page.evaluate(() => document.activeElement.dataset.uf), 'BA');
await filtrarUf('');
eq('o campo de filtro nao rouba o foco na abertura', await page.evaluate(() => {
  document.getElementById('uf-dialog').close();
  document.getElementById('uf-trigger').click();
  return document.activeElement.dataset.uf;
}), 'SP');
await sleep(300);
await page.keyboard.press('Escape');
await esperarFolhaFechar();
eq('Esc fecha', await page.$eval('#uf-dialog', e => e.open), false);
eq('foco volta para o gatilho', await page.evaluate(() => document.activeElement.id), 'uf-trigger');
eq('Esc nao troca de estado', await siglaNoCabecalho(), 'SP');

await escolherUf('MG');
eq('escolha atualiza a sigla', await siglaNoCabecalho(), 'MG');
eq('escolha atualiza a bandeira', await page.$eval('#uf-flag', e => e.getAttribute('src')), 'assets/flags/MG.png');
eq('escolha atualiza a URL', await page.evaluate(() => location.search), '?uf=mg&g=13');
eq('dialogo fechou apos escolher', await page.$eval('#uf-dialog', e => e.open), false);
eq('escolha revalida o cargo estadual', (await read('g')).name, 'OSMAR EXEMPLO');
await page.click('#uf-trigger'); await sleep(150);
eq('marcacao acompanha a escolha', await page.evaluate(() => document.querySelector('.uf-opcao.is-atual').dataset.uf), 'MG');
await page.click('#uf-close'); await esperarFolhaFechar();
eq('botao fechar funciona', await page.$eval('#uf-dialog', e => e.open), false);
/* clique fora do conteúdo fecha */
await page.click('#uf-trigger'); await sleep(200);
await page.evaluate(() => {
  const d = document.getElementById('uf-dialog');
  const r = d.getBoundingClientRect();
  d.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 5, clientY: Math.max(2, r.top - 20) }));
});
await esperarFolhaFechar();
eq('clique fora fecha o seletor de estado', await page.$eval('#uf-dialog', e => e.open), false);

/* --------------------------------------------- busca de candidato por nome */
/* a folha da busca puxa de baixo, igual à do estado */
console.log('\n== busca por nome: aproximada, sem virar vitrine (§46)');
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await page.goto(BASE + '?uf=sp', { waitUntil: 'networkidle0' });
await sleep(300);

const buscar = async texto => {
  await page.evaluate(() => { document.getElementById('busca-input').value = ''; });
  if (texto) await page.type('#busca-input', texto, { delay: 5 });
  else await page.evaluate(() => document.getElementById('busca-input').dispatchEvent(new Event('input')));
  await sleep(200);
  return page.evaluate(() => ({
    contagem: document.getElementById('busca-contagem').textContent,
    n: document.querySelectorAll('.busca-opcao').length,
    linhas: [...document.querySelectorAll('.busca-opcao')].map(o => ({
      nome: o.querySelector('.busca-nome').textContent,
      partido: o.querySelector('.busca-partido').textContent,
      cargo: o.querySelector('.busca-cargo').textContent,
      numero: o.querySelector('.busca-numero').textContent,
    })),
  }));
};

eq('dialogo de busca fechado no inicio', await page.$eval('#busca-dialog', e => e.open), false);
eq('aria-expanded false', await page.$eval('#busca-trigger', e => e.getAttribute('aria-expanded')), 'false');
await page.click('#busca-trigger');
await sleep(250);
eq('dialogo abriu', await page.$eval('#busca-dialog', e => e.open), true);
eq('foco vai para o campo', await page.evaluate(() => document.activeElement.id), 'busca-input');
eq('chips de cargo começam desmarcados', await page.evaluate(() =>
  [...document.querySelectorAll('#busca-filtros [data-cargo]')].map(c => c.getAttribute('aria-pressed'))),
['false', 'false', 'false', 'false', 'false']);
eq('chips de partido em ordem alfabetica', await page.evaluate(() => {
  const partidos = [...document.querySelectorAll('#busca-filtros-partidos [data-partido]')]
    .map(c => c.dataset.partido);
  return partidos.every((partido, i) =>
    i === 0 || partidos[i - 1].localeCompare(partido, 'pt-BR') <= 0);
}), true);
await page.click('#busca-filtros [data-cargo="g"]');
eq('chip de cargo filtra candidatos', await page.evaluate(() =>
  [...document.querySelectorAll('.busca-cargo')].every(c => c.textContent === 'Governador')), true);
eq('limpar cargos fica visivel com selecao', await page.$eval(
  '#busca-filtros [data-limpar-filtros]', e => e.hidden), false);
await page.click('#busca-filtros [data-limpar-filtros]');

/* abre com a lista completa, em ordem alfabética (§46: sem curadoria) */
const tudo = await buscar('');
const totalNaBase = await page.evaluate(async () => {
  const [sp, br] = await Promise.all([
    fetch('data/uf/SP.json').then(r => r.json()),
    fetch('data/br.json').then(r => r.json()),
  ]);
  const conta = b => Object.values(b.cargos).reduce((n, o) => n +
    Object.values(o).filter(c => c.sit !== 'X').length, 0);
  return conta(sp) + conta(br);
});
ok('primeira pagina tem 50 linhas', tudo.n === 50, '(' + tudo.n + ')');
eq('sem texto de contagem quando ha resultados', tudo.contagem, '');

/* ordem alfabética, número como segundo critério */
const nomes = tudo.linhas.map(l => l.nome);
eq('ordem alfabetica', nomes, [...nomes].sort((a, b) => a.localeCompare(b, 'pt-BR')));
const umaLetra = await buscar('m');
eq('uma letra nao filtra (mostra tudo)', umaLetra.n, tudo.n);

/* scroll infinito: rolar até o fim acrescenta a próxima página */
const antes = await page.evaluate(() => document.querySelectorAll('.busca-opcao').length);
await page.evaluate(() => {
  const l = document.querySelector('.busca-lista');
  l.scrollTop = l.scrollHeight;
});
await sleep(400);
const depois = await page.evaluate(() => document.querySelectorAll('.busca-opcao').length);
ok('scroll infinito acrescenta 50', depois > antes && depois <= antes + 50,
   '(' + antes + ' -> ' + depois + ')');
for (let i = 0; i < 6; i++) {
  await page.evaluate(() => {
    const l = document.querySelector('.busca-lista');
    l.scrollTop = l.scrollHeight;
  });
  await sleep(250);
}
const fim = await page.evaluate(() => ({
  linhas: document.querySelectorAll('.busca-opcao').length,
  sentinela: document.querySelectorAll('.busca-fim').length,
}));
eq('rolando até o fim, carrega todos', fim.linhas, totalNaBase);
eq('sentinela sai quando acaba', fim.sentinela, 0);

const folhaBusca = await page.evaluate(() => {
  const r = document.getElementById('busca-dialog').getBoundingClientRect();
  return { x: Math.round(r.x), largura: Math.round(r.width), altura: Math.round(r.height),
           base: Math.round(innerHeight - r.bottom), viewport: innerWidth, tela: innerHeight };
});
eq('folha da busca ocupa a largura da tela', [folhaBusca.x, folhaBusca.largura],
   [0, folhaBusca.viewport]);
eq('folha da busca encostada na base', folhaBusca.base, 0);
ok('folha da busca com 80% da tela', Math.abs(folhaBusca.altura - folhaBusca.tela * 0.8) <= 2,
   '(' + folhaBusca.altura + ' de ' + folhaBusca.tela + 'px)');

/* clique fora do conteúdo fecha a folha de busca também */
await page.evaluate(() => {
  const d = document.getElementById('busca-dialog');
  const r = d.getBoundingClientRect();
  d.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 5, clientY: Math.max(2, r.top - 20) }));
});
await esperarFolhaFechar();
eq('clique fora fecha a busca', await page.$eval('#busca-dialog', e => e.open), false);
await page.click('#busca-trigger'); await sleep(250);
eq('reabriu para seguir', await page.$eval('#busca-dialog', e => e.open), true);

const maya = await buscar('maya');
eq('acha por nome', maya.linhas[0],
   { nome: 'MAYA EXEMPLO', partido: 'FUT', cargo: 'Deputado federal', numero: '1313' });
eq('acha por sobrenome no meio', (await buscar('marlene')).linhas[0].nome, 'VETERINARIA MARLENE DEMONSTRA');
eq('tolera erro de digitacao', (await buscar('marlerne')).linhas[0].nome, 'VETERINARIA MARLENE DEMONSTRA');
eq('conectivo nao e exigido', (await buscar('maria exemplo demo')).linhas[0].nome,
   'MARIA DE EXEMPLO SOBRENOME DEMO');
eq('termo curto nao aceita erro (sem ruido)', (await buscar('xyz')).n, 0);
eq('sem resultado avisa a UF', (await buscar('zzzzzzz')).contagem, 'nenhum candidato encontrado em SP');
eq('filtro mantem a ordem alfabetica', await (async () => {
  const r = await buscar('demo');
  return r.linhas.map(l => l.nome).every((n, i, a) =>
    i === 0 || a[i - 1].localeCompare(n, 'pt-BR') <= 0);
})(), true);

/* §13: candidatura inapta não aparece nem na busca */
eq('candidatura inapta fica fora da busca', (await buscar('inapto')).n, 0);

/* presidente vem da base nacional */
eq('busca cobre a base nacional', (await buscar('pres demo')).linhas[0],
   { nome: 'PRES DEMO B', partido: 'ARC', cargo: 'Presidente', numero: '31' });
eq('senado aparece sem a vaga', (await buscar('rute')).linhas[0].cargo, 'Senador');

/* escolher um resultado preenche o card certo */
await buscar('agda');
await page.click('.busca-opcao');
await esperarFolhaFechar();
eq('dialogo fechou ao escolher', await page.$eval('#busca-dialog', e => e.open), false);
eq('preencheu o governador', (await read('g')).digits, '13');
eq('resolveu o candidato', (await read('g')).name, 'AGDA EXEMPLO');
eq('url atualizada', await page.evaluate(() => location.search), '?uf=sp&g=13');

/* §21: qual das duas vagas de senador a busca sobrescreve */
const escolherPelaBusca = async texto => {
  await page.click('#busca-trigger'); await sleep(200);
  await buscar(texto);
  await page.click('.busca-opcao'); await esperarFolhaFechar();
};
const senadores = async () => [(await read('s1')).digits, (await read('s2')).digits];

await escolherPelaBusca('rute');
eq('vagas vazias: preenche a primeira', await senadores(), ['131', '___']);
await escolherPelaBusca('ivo demo');
eq('uma vaga livre: preenche a livre', await senadores(), ['131', '132']);

/* duas válidas: sobrescreve a mexida há mais tempo, alternando */
await escolherPelaBusca('leda');
eq('duas válidas: atropela a mais antiga (s1)', await senadores(), ['313', '132']);
await escolherPelaBusca('helio');
eq('próxima busca atropela a outra (s2)', await senadores(), ['313', '450']);
await escolherPelaBusca('rute');
eq('volta a alternar', await senadores(), ['131', '450']);

/* não duplica: escolher quem já está numa vaga não ocupa a outra */
await escolherPelaBusca('helio');
eq('candidato já presente fica onde está', await senadores(), ['131', '450']);

/* vaga sem candidato válido perde para a válida, mesmo se mexida agora */
await page.goto(BASE + '?uf=sp&s1=131&s2=999', { waitUntil: 'networkidle0' }); await sleep(250);
await page.click('.card[data-cargo="s2"] .digit[data-index="2"]');
await page.keyboard.press('8');                       // mexe na s2 agora: 998, inválido
await sleep(150);
eq('s2 inválida e recém-mexida', await senadores(), ['131', '998']);
await escolherPelaBusca('leda');
eq('atropela a inválida, não a válida', await senadores(), ['131', '313']);

/* vaga vazia ganha de tudo, mesmo recém-esvaziada */
await page.goto(BASE + '?uf=sp&s1=131&s2=132', { waitUntil: 'networkidle0' }); await sleep(250);
await page.click('.card[data-cargo="s1"] .digit[data-index="2"]');
for (const _ of [1, 2, 3]) await page.keyboard.press('Backspace');
await sleep(150);
eq('s1 esvaziada à mão', await senadores(), ['___', '132']);
await escolherPelaBusca('leda');
eq('vaga vazia ganha, mesmo sendo a mexida mais recente', await senadores(), ['313', '132']);

/* editar à mão conta como mexer: a busca passa a atropelar a outra vaga */
await page.goto(BASE + '?uf=sp&s1=131&s2=132', { waitUntil: 'networkidle0' }); await sleep(250);
await page.click('.card[data-cargo="s1"] .digit[data-index="2"]');
await page.keyboard.press('2');                       // s1 = 132? não: 131 -> 132 é válido
await sleep(150);
await escolherPelaBusca('leda');
eq('edição manual move a vez para a outra vaga', (await senadores())[1], '313');

/* teclado */
await page.click('#busca-trigger'); await sleep(200);
await buscar('demo');
ok('varios resultados para navegar', (await page.evaluate(() => document.querySelectorAll('.busca-opcao').length)) > 2);
await page.keyboard.press('ArrowDown');
eq('ArrowDown foca o primeiro resultado', await page.evaluate(() =>
   document.activeElement.classList.contains('busca-opcao')), true);
await page.keyboard.press('ArrowDown');
eq('ArrowDown percorre', await page.evaluate(() => {
  const o = [...document.querySelectorAll('.busca-opcao')];
  return o.indexOf(document.activeElement);
}), 1);
await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowUp');
eq('ArrowUp volta ao campo', await page.evaluate(() => document.activeElement.id), 'busca-input');
await page.keyboard.press('Escape'); await esperarFolhaFechar();
eq('Esc fecha', await page.$eval('#busca-dialog', e => e.open), false);
eq('foco volta para o gatilho', await page.evaluate(() => document.activeElement.id), 'busca-trigger');

/* Enter escolhe o primeiro */
await page.goto(BASE + '?uf=sp', { waitUntil: 'networkidle0' }); await sleep(250);
await page.click('#busca-trigger'); await sleep(200);
await buscar('maya');
await page.keyboard.press('Enter'); await esperarFolhaFechar();
eq('Enter escolhe o primeiro resultado', (await read('df')).digits, '1313');

/* troca de UF invalida o indice */
await page.click('#busca-trigger'); await sleep(200);
eq('candidato de SP aparece em SP', (await buscar('maya')).n, 1);
await page.keyboard.press('Escape'); await esperarFolhaFechar();
await escolherUf('MG');
await page.click('#busca-trigger'); await sleep(250);
eq('indice acompanha a troca de UF', (await buscar('maya ribeiro')).linhas[0].nome, 'MAYA RIBEIRO DEMO');
eq('candidato exclusivo de SP nao aparece em MG', (await buscar('helio teste')).n, 0);
await page.keyboard.press('Escape'); await esperarFolhaFechar();

/* ----------------------------------------------------------- §5 share */
console.log('\n== §5 compartilhamento: cola em texto, imagem e link');
await page.goto(BASE + '?uf=sp&df=1313&de=13&s1=131&s2=999&g=13', { waitUntil: 'networkidle0' });
await sleep(1600);            /* a imagem é preparada em segundo plano */

/* espiona o que seria compartilhado, sem abrir folha nativa */
const espionar = async (opcoes = {}) => page.evaluate(op => {
  window.__share = null;
  window.__copiado = null;
  window.__baixado = null;
  if (op.comShare) {
    navigator.share = dados => {
      window.__share = {
        title: dados.title, text: dados.text, url: dados.url,
        arquivos: (dados.files || []).map(f => ({ nome: f.name, tipo: f.type, bytes: f.size })),
      };
      return op.cancela ? Promise.reject(Object.assign(new Error('x'), { name: 'AbortError' }))
                        : Promise.resolve();
    };
    navigator.canShare = dados => op.comArquivos ? true : !dados.files;
  } else {
    delete navigator.share;
    delete navigator.canShare;
  }
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: t => { window.__copiado = t; return Promise.resolve(); } },
  });
  HTMLAnchorElement.prototype.click = function () {
    if (this.download) window.__baixado = { nome: this.download, href: this.href.slice(0, 5) };
  };
}, opcoes);

const resultado = () => page.evaluate(() => ({
  share: window.__share, copiado: window.__copiado, baixado: window.__baixado,
}));

/* 1. plataforma com suporte a arquivo: imagem + texto + link numa só chamada */
await espionar({ comShare: true, comArquivos: true });
await page.click('#share');
await sleep(400);
const comArquivo = await resultado();
ok('compartilha com arquivo quando a plataforma aceita',
   comArquivo.share && comArquivo.share.arquivos.length === 1);
eq('o arquivo e um JPEG do santinho',
   comArquivo.share.arquivos[0].nome + ' ' + comArquivo.share.arquivos[0].tipo,
   'santinho-sp.jpg image/jpeg');
ok('a imagem tem tamanho plausivel',
   comArquivo.share.arquivos[0].bytes > 40000 && comArquivo.share.arquivos[0].bytes < 900000,
   '(' + Math.round(comArquivo.share.arquivos[0].bytes / 1024) + ' KB)');
eq('o link vai junto', comArquivo.share.url, await page.evaluate(() => location.href));
ok('o texto lista os votos', comArquivo.share.text.includes('Dep. federal · 1313'),
   JSON.stringify(comArquivo.share.text.slice(0, 60)));
eq('nao copia nem baixa quando compartilhou',
   [comArquivo.copiado, comArquivo.baixado], [null, null]);

/* conteúdo da cola em texto: só cargo e número */
const texto = comArquivo.share.text;
const linhas = texto.split('\n').filter(Boolean);
eq('cabecalho da cola', linhas[0], 'Minha cola eleitoral 2026 - SP');
eq('titulo com maiuscula', texto.startsWith('Minha cola'), true);
eq('uma linha por cargo preenchido', linhas.length - 1, 5);
ok('cargo e numero, em caixa normal',
   linhas.includes('Dep. federal · 1313'), JSON.stringify(linhas));
ok('legenda entra so com o numero do partido',
   linhas.includes('Dep. estadual · 13'), JSON.stringify(linhas));
ok('numero inexistente entra igual',
   linhas.includes('2º senador · 999'), JSON.stringify(linhas));
ok('cargo vazio nao entra na cola', !texto.includes('Presidente'));
ok('votos em linhas seguidas, sem branco entre eles',
   texto.includes('· 1313\nDep. estadual'), JSON.stringify(texto.slice(0, 120)));
ok('linha em branco entre titulo e votos', texto.includes('- SP\n\nDep. federal'),
   JSON.stringify(texto.slice(0, 80)));
ok('sem nome de candidato no texto', !texto.includes('MAYA'), JSON.stringify(texto));
ok('sem partido no texto', !texto.includes('(FUT)'), JSON.stringify(texto));

/* 2. plataforma sem suporte a arquivo: texto + link, sem imagem */
await espionar({ comShare: true, comArquivos: false });
await page.click('#share');
await sleep(300);
const semArquivo = await resultado();
eq('sem suporte a arquivo, compartilha so texto e link',
   semArquivo.share.arquivos.length, 0);
ok('o texto continua indo', semArquivo.share.text.includes('Dep. federal · 1313'));

/* 3. cancelar não deve cair para o clipboard */
await espionar({ comShare: true, comArquivos: true, cancela: true });
await page.click('#share');
await sleep(300);
eq('cancelar nao copia nada', (await resultado()).copiado, null);

/* 4. sem compartilhamento nativo: copia a cola e entrega a imagem */
await espionar({ comShare: false });
await page.click('#share');
await sleep(400);
const semShare = await resultado();
ok('copia a cola inteira', semShare.copiado && semShare.copiado.includes('Dep. federal · 1313'));
ok('copia o link no fim', semShare.copiado.trim().endsWith(await page.evaluate(() => location.href)));
ok('linha em branco antes do link', semShare.copiado.includes('\n\n' + await page.evaluate(() => location.href)));
eq('baixa a imagem', semShare.baixado && semShare.baixado.nome, 'santinho-sp.jpg');
eq('feedback conta as duas coisas',
   await page.$eval('#toast', e => e.hidden ? null : e.textContent),
   'Cola copiada ✓ · imagem baixada');

/* 5. a imagem acompanha o estado: mudar um número invalida o cache */
await page.click('.card[data-cargo="p"] .digit[data-index="0"]');
await page.keyboard.press('3');
await page.keyboard.press('1');
await espionar({ comShare: true, comArquivos: true });
await page.click('#share');
await sleep(300);
const logoApos = await resultado();
eq('logo apos editar, vai sem imagem (cache invalidado)',
   logoApos.share.arquivos.length, 0);
ok('mas o texto ja tem o voto novo', logoApos.share.text.includes('Presidente'));
await sleep(1600);
await espionar({ comShare: true, comArquivos: true });
await page.click('#share');
await sleep(400);
eq('a imagem volta a ficar pronta sozinha',
   (await resultado()).share.arquivos.length, 1);

/* aria continua descrevendo o botao */
eq('aria-label no botao', await page.$eval('#share', e => e.getAttribute('aria-label')), 'Compartilhar minha cola eleitoral');
eq('rotulo visivel no botao', await page.$eval('.share-rotulo', e => e.textContent), 'Compartilhar');
ok('rotulo visivel contido no acessivel (WCAG 2.5.3)', await page.$eval('#share',
   e => e.getAttribute('aria-label').includes(e.querySelector('.share-rotulo').textContent)));
eq('botao de estado diz o que faz', await page.$eval('#uf-trigger .rotulo-botao', e => e.textContent),
   'trocar estado');
eq('botao de busca diz o que faz', await page.$eval('#busca-trigger .rotulo-botao', e => e.textContent),
   'buscar por nome');
ok('rotulos do rodape contidos nos nomes acessiveis (WCAG 2.5.3)', await page.evaluate(() =>
  ['#uf-trigger', '#busca-trigger'].every(sel => {
    const b = document.querySelector(sel);
    const visivel = b.querySelector('.rotulo-botao').textContent.toLowerCase();
    return b.getAttribute('aria-label').toLowerCase().includes(visivel);
  })));
eq('os dois botoes do rodape seguem o mesmo padrao icone + rotulo', await page.evaluate(() => {
  const medir = sel => {
    const b = document.querySelector(sel);
    const svg = b.querySelector('svg');
    const rot = b.querySelector('.rotulo-botao');
    return { temIcone: Boolean(svg),
             icone: svg ? Math.round(svg.getBoundingClientRect().width) : 0,
             iconeAntesDoRotulo: svg && rot
               ? svg.getBoundingClientRect().right <= rot.getBoundingClientRect().left + 1 : false };
  };
  const uf = medir('#uf-trigger'), busca = medir('#busca-trigger');
  return { ambosComIcone: uf.temIcone && busca.temIcone,
           iconesDoMesmoTamanho: uf.icone === busca.icone,
           ordemIgual: uf.iconeAntesDoRotulo && busca.iconeAntesDoRotulo };
}), { ambosComIcone: true, iconesDoMesmoTamanho: true, ordemIgual: true });

/* -------------------------------------------------------- §34/§38 extras */
console.log('\n== §34 acessibilidade / §38 segurança');
await page.goto(BASE + '?uf=sp&df=1313', { waitUntil: 'networkidle0' }); await sleep(150);
await page.click('.card[data-cargo="df"] .digit[data-index="1"]');
const a11y = await page.evaluate(() => {
  const i = document.querySelector('#num-df');
  return { label: i.getAttribute('aria-label'),
           hint: document.getElementById(i.getAttribute('aria-describedby')).textContent,
           inputmode: i.inputMode, fonte: getComputedStyle(i).fontSize };
});
eq('aria-label do input', a11y.label, 'Deputado federal, número de 4 dígitos');
eq('posicao anunciada', a11y.hint, 'MAYA EXEMPLO, FUT, dígito 2 de 4');
eq('inputmode numeric', a11y.inputmode, 'numeric');
eq('fonte 16px (sem zoom no iOS)', a11y.fonte, '16px');
eq('sem user-scalable=no', await page.evaluate(() => document.querySelector('meta[name=viewport]').content.includes('user-scalable')), false);
const xss = await page.evaluate(async () => {
  const card = document.querySelector('.card[data-cargo="g"]');
  return { input: document.querySelectorAll('.sink').length, imgs: document.querySelectorAll('.photo img').length };
});
eq('um input mestre por card', xss.input, 6);

/* --------------------------------------------------- redes sociais no card */
console.log('\n== redes sociais no card');
await page.goto(BASE + '?uf=sp&df=1313&de=13131&s1=131&g=13&p=31', { waitUntil: 'networkidle0' });
/* as redes chegam em segundo plano, depois da base */
await page.waitForFunction(() => document.querySelectorAll('.card[data-cargo="df"] .rede').length > 0,
                           { timeout: 5000 });

const redes = await page.evaluate(() => {
  const ler = cargo => [...document.querySelectorAll(`.card[data-cargo="${cargo}"] .rede`)].map(a => ({
    href: a.href, target: a.target, rel: a.rel,
    rotulo: a.getAttribute('aria-label'),
    icone: a.querySelector('svg') ? a.querySelector('svg').getAttribute('aria-hidden') : null,
    alvo: Math.round(a.getBoundingClientRect().height),
  }));
  return { df: ler('df'), de: ler('de'), s1: ler('s1'), g: ler('g'), p: ler('p') };
});

/* o arquivo tem sete links; o front corta em cinco, para a garantia de layout
   nao depender do dado estar certo */
eq('cinco icones no maximo, na ordem da prioridade', redes.df.map(a => a.href),
   ['https://instagram.com/mayaexemplo', 'https://x.com/mayaexemplo',
    'https://tiktok.com/@mayaexemplo', 'https://facebook.com/mayaexemplo',
    'https://youtube.com/@mayaexemplo']);
eq('um icone so quando so ha uma rede', redes.s1.map(a => a.href),
   ['https://instagram.com/ruteexemplo']);
eq('duas redes, instagram antes de facebook', redes.g.map(a => a.href),
   ['https://instagram.com/agdaexemplo', 'https://facebook.com/agdaexemplo']);
eq('candidato sem rede nao ganha icone', redes.de.length, 0);
eq('escopo BR tem arquivo proprio', redes.p.map(a => a.href), ['https://wa.me/5511999999999']);
eq('abre em nova aba', [...new Set(redes.df.map(a => a.target))], ['_blank']);
eq('rel protege a aba de origem e nao endossa',
   [...new Set(redes.df.map(a => a.rel))], ['noopener noreferrer nofollow']);
eq('aria-label diz a rede, o nome e que abre fora', redes.df.map(a => a.rotulo),
   ['Instagram de MAYA EXEMPLO (abre em nova aba)',
    'X de MAYA EXEMPLO (abre em nova aba)',
    'TikTok de MAYA EXEMPLO (abre em nova aba)',
    'Facebook de MAYA EXEMPLO (abre em nova aba)',
    'YouTube de MAYA EXEMPLO (abre em nova aba)']);
eq('o desenho e decorativo para o leitor de tela',
   [...new Set(redes.df.map(a => a.icone))], ['true']);
eq('alvo de toque com pelo menos 24px', redes.df.every(a => a.alvo >= 24), true);

/* a linha vazia nao pode deixar buraco no card */
eq('linha de redes some quando nao ha nenhuma', await page.evaluate(() => {
  const el = document.querySelector('.card[data-cargo="de"] .redes');
  return { existe: Boolean(el), display: el ? getComputedStyle(el).display : null,
           altura: el ? Math.round(el.getBoundingClientRect().height) : null };
}), { existe: true, display: 'none', altura: 0 });

/* §26: o card inteiro é alvo de foco do dígito, nos dois eventos */
eq('tocar no icone nao move o foco do digito', await page.evaluate(() => {
  const card = document.querySelector('.card[data-cargo="df"]');
  card.querySelector('.digit[data-index="0"]').click();
  const antes = card.querySelector('.digit.is-caret')?.dataset.index ?? null;
  const a = card.querySelector('.rede');
  a.addEventListener('click', e => e.preventDefault(), { once: true });
  a.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  const depois = card.querySelector('.digit.is-caret')?.dataset.index ?? null;
  return { antes, depois };
}), { antes: '0', depois: '0' });

/* §44: sem os dados o produto continua servindo, só sem ícone */
eq('UF sem arquivo de redes nao quebra nada', await page.evaluate(async () => {
  const antes = [];
  window.addEventListener('error', e => antes.push(e.message));
  document.getElementById('uf-placa-trigger').click();
  return antes.length;
}), 0);
await page.goto(BASE + '?uf=mg&df=1313', { waitUntil: 'networkidle0' }); await sleep(400);
eq('nenhum icone e nenhum erro quando falta data/redes/MG.json',
   await page.evaluate(() => document.querySelectorAll('.rede').length), 0);

/* --------------------------------------- imagem do compartilhamento (§5) */
console.log('\n== imagem do compartilhamento em formato de stories');
await page.goto(BASE + '?uf=sp&df=1313&de=13131&s1=131&s2=132&g=13&p=13',
                { waitUntil: 'networkidle0' });
await sleep(500);
const img = await page.evaluate(async () => {
  const blob = await gerarImagem();
  const bitmap = await createImageBitmap(blob);
  const c = document.createElement('canvas');
  c.width = bitmap.width; c.height = bitmap.height;
  c.getContext('2d').drawImage(bitmap, 0, 0);
  const px = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  /* o fundo é #ececee com uma hachura de rgba(0,0,0,.016): a hachura desvia ~4
     do 236, e o cartão (#fbfbfc) desvia 15 - um limiar de 10 separa os dois */
  const conteudo = i => Math.abs(px[i] - 236) > 10 || Math.abs(px[i+1] - 236) > 10 ||
                        Math.abs(px[i+2] - 236) > 10;
  let topo = -1, base = -1, esq = c.width, dir = -1;
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) {
      if (!conteudo((y * c.width + x) * 4)) continue;
      if (topo < 0) topo = y;
      base = y;
      if (x < esq) esq = x;
      if (x > dir) dir = x;
    }
  }
  return { largura: bitmap.width, altura: bitmap.height, tipo: blob.type,
           kb: Math.round(blob.size / 1024), topo, base, esq, dir };
});
eq('1080x1920, o quadro de stories', [img.largura, img.altura], [1080, 1920]);
eq('proporcao 9:16 exata', img.largura / img.altura, 9 / 16);
eq('jpeg', img.tipo, 'image/jpeg');
ok('peso abaixo de 900 KB', img.kb < 900, img.kb + ' KB');
/* o conteúdo não pode invadir a zona que a interface de stories ocupa (avatar e
   nome no topo, campo de resposta embaixo) */
ok('conteudo a 200px ou mais do topo', img.topo >= 200, img.topo + 'px');
ok('conteudo a 200px ou mais da base', 1920 - img.base >= 200, (1920 - img.base) + 'px');
/* e as bordas laterais precisam de margem: era ali que o corte comia a foto */
ok('margem lateral esquerda de 20px ou mais', img.esq >= 20, img.esq + 'px');
ok('margem lateral direita de 20px ou mais', 1080 - img.dir >= 20, (1080 - img.dir) + 'px');

/* --------------------------------------------------------------- favicon */
console.log('\n== favicon');
const fav = await page.evaluate(async () => {
  const el = document.querySelector('link[rel=icon]');
  if (!el) return { existe: false };
  const href = el.getAttribute('href');
  const img = new Image();
  const carregou = await new Promise(r => {
    img.onload = () => r(true); img.onerror = () => r(false); img.src = href;
  });
  if (!carregou) return { existe: true, carregou: false, href };
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0, 64, 64);
  const px = ctx.getImageData(0, 0, 64, 64).data;
  let topo = -1, base = -1, esq = 64, dir = -1, tinta = 0;
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    if (px[(y * 64 + x) * 4 + 3] < 20) continue;   // alfa: o fundo é transparente
    tinta++;
    if (topo < 0) topo = y;
    base = y; if (x < esq) esq = x; if (x > dir) dir = x;
  }
  return { existe: true, carregou: true, embutido: href.startsWith('data:image/svg+xml,'),
           bytes: href.length, tinta,
           margens: { topo, base: 63 - base, esq, dir: 63 - dir } };
});
ok('favicon declarado', fav.existe);
ok('o navegador carrega o icone', fav.carregou);
ok('embutido, sem requisicao extra', fav.embutido, fav.bytes + ' bytes');
ok('tem desenho', fav.tinta > 200, fav.tinta + ' pixels');
/* em 54px o glifo ficava a 3px da borda e as mangas encostavam */
ok('nao encosta nas bordas (4px ou mais de cada lado)',
   Object.values(fav.margens).every(v => v >= 4), JSON.stringify(fav.margens));
ok('centrado na vertical e na horizontal',
   Math.abs(fav.margens.topo - fav.margens.base) <= 2 &&
   Math.abs(fav.margens.esq - fav.margens.dir) <= 2, JSON.stringify(fav.margens));

console.log('\n== erros de console/pageerror');
eq('sem erros de JS', erros, []);

console.log('\n---------------------------------------------');
console.log(pass + ' passaram, ' + fail + ' falharam');
await browser.close();
encerrar();
process.exit(fail ? 1 : 0);
