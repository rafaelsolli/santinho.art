/*
 * santinho.art — testes das funções puras do importador.
 *
 * Roda sem rede e sem navegador: importa scripts/update-data.mjs com
 * SANTINHO_IMPORTADOR_TESTE=1, que impede o pipeline de executar.
 *
 *   node tests/importador.mjs
 */
process.env.SANTINHO_IMPORTADOR_TESTE = '1';

const { normalizarUrlRede, escolherRedes, codigoDaRede, perfisDeTextoLivre, ehPlataforma,
        definirTlds,
        usuarioDaUrl, usuarioCanonico,
        PROVEDOR_DE_EMAIL, DOMINIO_TYPO } =
  await import('../scripts/update-data.mjs');

/* O importador busca a lista de TLDs na IANA em tempo de build; aqui instalamos
 * uma lista fixa, para o teste medir a regra e não a rede. */
definirTlds(['com', 'br', 'net', 'org', 'me', 'ee', 'website', 'ly', 'kr', 'sc', 'app']);

let pass = 0, fail = 0;
const eq = (nome, obtido, esperado) => {
  const a = JSON.stringify(obtido), b = JSON.stringify(esperado);
  if (a === b) { pass++; console.log('  ok   ' + nome); }
  else { fail++; console.log('  FAIL ' + nome + '\n         esperado: ' + b + '\n         obtido:   ' + a); }
};
const url = bruto => { const r = normalizarUrlRede(bruto); return r ? r.url : null; };

console.log('\n== normalização de DS_URL (o campo é texto livre na prática)');
eq('URL normal passa', url('https://www.instagram.com/foo'), 'https://instagram.com/foo');
eq('domínio nu ganha esquema', url('instagram.com/foo'), 'https://instagram.com/foo');
eq('URL embutida em frase é extraída',
   url('TWITTER - HTTPS://WWW.TWITTER.COM/CRUZORLEANS'), 'https://twitter.com/cruzorleans');
eq('prefixo "INSTAGRAM:" antes da URL',
   url('INSTAGRAM: HTTPS://WWW.INSTAGRAM.COM/ACIR_GURGACZ/'), 'https://instagram.com/acir_gurgacz/');
eq('só arroba não vira link', url('@LOBOPVH_RO'), null);
eq('nome de pessoa não vira link', url('JORGE BEZERRA MORAIS ( FACEBOOK)'), null);
eq('fragmento de query não vira link', url('igsh=b2Z0dWR0ZXA0anJz&utm_source=qr'), null);
eq('campo vazio', url(''), null);
eq('esquema não-web é recusado', url('javascript:alert(1)'), null);
eq('ftp é recusado', url('ftp://exemplo.com/x'), null);

console.log('\n== limpeza de parâmetro de rastreio (22% das URLs trazem algum)');
eq('igsh sai', url('https://www.instagram.com/foo?IGSH=ABC123'), 'https://instagram.com/foo');
eq('mibextid sai', url('https://www.facebook.com/foo?MIBEXTID=WWXIFR'), 'https://facebook.com/foo');
eq('utm_* sai', url('https://exemplo.com.br/?utm_source=qr&utm_medium=x'), 'https://exemplo.com.br/');
eq('xmt sai', url('https://www.threads.com/@foo?xmt=AQG0Ysi'), 'https://threads.com/@foo');
eq('parâmetro legítimo fica', url('https://x.com/foo?lang=en'), 'https://x.com/foo?lang=en');
eq('fragmento sai', url('https://instagram.com/foo#sobre'), 'https://instagram.com/foo');

console.log('\n== caixa alta (o TSE grava 79% das URLs em maiúsculas)');
eq('caminho de perfil é normalizado',
   url('HTTPS://WWW.INSTAGRAM.COM/GUTOJOSEOFICIAL'), 'https://instagram.com/gutojoseoficial');
eq('PROFILE.PHP viraria 404 no Facebook',
   url('HTTPS://WWW.FACEBOOK.COM/PROFILE.PHP?ID=61593211208618'),
   'https://facebook.com/profile.php?ID=61593211208618');
eq('id opaco em maiúsculas é descartado (link morto)',
   url('HTTPS://WWW.FACEBOOK.COM/SHARE/196FDR3YKL/'), null);
eq('/channel/ em maiúsculas é descartado',
   url('HTTPS://WWW.YOUTUBE.COM/CHANNEL/UCI7RLNYELOO2PE5MQXLHXSQ'), null);
eq('youtu.be em maiúsculas é descartado', url('HTTPS://YOUTU.BE/EOFQP'), null);
eq('mas id opaco com caixa preservada fica',
   url('https://www.facebook.com/share/196fdr3ykl/'), 'https://facebook.com/share/196fdr3ykl/');
eq('site próprio conserva o www e a caixa do caminho',
   url('https://www.MinhaCampanha.com.br/Propostas'), 'https://www.minhacampanha.com.br/Propostas');

console.log('\n== classificação por sufixo de domínio');
for (const [host, cod] of [
  ['instagram.com', 'i'], ['l.instagram.com', 'i'],
  ['facebook.com', 'f'], ['web.facebook.com', 'f'], ['pt-br.facebook.com', 'f'], ['m.me', 'f'],
  ['x.com', 'x'], ['twitter.com', 'x'],
  ['tiktok.com', 't'], ['vm.tiktok.com', 't'],
  ['youtube.com', 'y'], ['youtu.be', 'y'],
  ['threads.com', 'h'], ['threads.net', 'h'],
  ['linkedin.com', 'l'], ['br.linkedin.com', 'l'],
  ['kwai.com', 'k'], ['t.me', 'g'], ['wa.me', 'w'], ['bsky.app', 'b'],
  ['candidatos.pco.org.br', 's'], ['robertodelucenasp.com.br', 's'], ['gettr.com', 's'],
]) eq('domínio ' + host, codigoDaRede(host), cod);

console.log('\n== descartes de segurança');
for (const h of ['gmail.com', 'hotmail.com', 'outlook.com', 'yahoo.com.br'])
  eq('provedor de e-mail ' + h, PROVEDOR_DE_EMAIL.test(h), true);
eq('domínio de rede não é e-mail', PROVEDOR_DE_EMAIL.test('instagram.com'), false);
for (const h of ['instagran.com', 'intagram.com', 'nstagram.com', 'facebok.com',
                 'twiter.com', 'instagram.com.br', 'youtub.com'])
  eq('typosquatting ' + h, DOMINIO_TYPO.test(h), true);
for (const h of ['instagram.com', 'youtube.com', 'facebook.com', 'tiktok.com', 'x.com'])
  eq('domínio legítimo não é typo: ' + h, DOMINIO_TYPO.test(h), false);

console.log('\n== domínio tem que existir, e link de rede tem que ter caminho');
eq('TLD inventado não é site', url('LUCIANALANA.PARTICULAR'), null);
eq('arroba com sufixo não é domínio', url('@FULANO.OFICIAL'), null);
eq('barra esquecida depois do .com', url('INSTAGRAM.COMLAINNIOSOARES'), null);
eq('host terminando em ponto', url('https://exemplo.com./x'), null);
eq('.com.br passa', url('https://fulano.com.br/'), 'https://fulano.com.br/');
eq('.ee passa', url('https://linktr.ee/fulano'), 'https://linktr.ee/fulano');
eq('TLD longo mas real passa', url('https://biolink.website/fulano'),
   'https://biolink.website/fulano');
eq('sem lista carregada, a checagem de TLD não roda', (() => {
  definirTlds(null);
  const r = url('LUCIANALANA.PARTICULAR');
  definirTlds(['com', 'br', 'net', 'org', 'me', 'ee', 'website', 'ly', 'kr', 'sc', 'app']);
  return r;
})(), 'https://lucianalana.particular/');
/* duas URLs coladas: paramos na segunda, e da primeira sobra só o domínio, que
   levaria para a home do Instagram */
eq('rede sem caminho não vira link',
   url('HTTPS://WWW.INSTAGRAM.COM/HTTPS://WWW.THREADS.NET/@PLINIOVICENTIN?IGSHID=NTC4MTI'), null);
eq('idem no facebook',
   url('HTTPS://WWW.FACEBOOK.COM/HTTPS://WWW.FACEBOOK.COM/SHARE/1CNJA6ZBFH/?MIBEXTID=WWX'), null);
/* sem esquema na frente, a URL de dentro é a que vale - e essa serve */
eq('domínio nu seguido de URL: vale a de dentro',
   url('INSTAGRAM.COM/HTTPS://WWW.THREADS.NET/@FULANO'), 'https://threads.net/@fulano');
eq('home de rede não vira link', url('https://www.facebook.com/'), null);
eq('mas site próprio pode ser só o domínio',
   url('https://patrusananias.com.br/'), 'https://patrusananias.com.br/');

console.log('\n== dedupe, prioridade e corte em 3');
eq('cinco links da mesma rede viram um',
   escolherRedes([['i', 'a'], ['i', 'b'], ['i', 'c'], ['i', 'd'], ['i', 'e']]), [['i', 'a']]);
eq('as cinco redes de alcance vêm antes do site próprio',
   escolherRedes([['s', 's1'], ['y', 'y1'], ['x', 'x1'], ['i', 'i1'], ['f', 'f1'], ['t', 't1']])
     .map(l => l[0]), ['i', 'x', 't', 'f', 'y']);
eq('o site entra quando falta alguma das cinco',
   escolherRedes([['s', 's1'], ['x', 'x1'], ['i', 'i1']]).map(l => l[0]), ['i', 'x', 's']);
eq('corta em cinco, pela prioridade',
   escolherRedes([['w', 'w'], ['g', 'g'], ['f', 'f'], ['i', 'i'], ['s', 's'], ['y', 'y']])
     .map(l => l[0]), ['i', 'f', 'y', 's', 'g']);
eq('whatsapp fica por último e cai fora quando há concorrência',
   escolherRedes([['w', 'w'], ['i', 'i'], ['s', 's'], ['x', 'x'], ['t', 't'], ['f', 'f']])
     .map(l => l[0]), ['i', 'x', 't', 'f', 's']);
eq('whatsapp entra quando é o único', escolherRedes([['w', 'w']]), [['w', 'w']]);
eq('lista vazia', escolherRedes([]), []);

console.log('\n== @usuário de texto livre (fallback de dois níveis)');
const perfis = t => perfisDeTextoLivre(t);
/* nível 1 = rede que o texto nomeia · nível 2 = usuário propagado */
eq('helton junior: a rede nomeada em primeiro nível, o resto propagado',
   perfis('INSTAGRAM - @HELTONJUNIORBH'),
   [['i', 'https://instagram.com/heltonjuniorbh', 1],
    ['x', 'https://x.com/heltonjuniorbh', 2],
    ['t', 'https://tiktok.com/@heltonjuniorbh', 2],
    ['f', 'https://facebook.com/heltonjuniorbh', 2],
    ['h', 'https://threads.com/@heltonjuniorbh', 2]]);
/* YouTube fica fora do propagado: lá o @ precisa ser reivindicado, e sem dono a
   URL dá 404 */
eq('@ avulso propaga para cinco redes, sem youtube',
   perfis('@LOBOPVH_RO').map(l => [l[0], l[2]]),
   [['i', 2], ['x', 2], ['t', 2], ['f', 2], ['h', 2]]);
eq('tiktok nomeado vem em primeiro nível, os propagados atrás',
   perfis('Tik Tok - @clarianabr').map(l => [l[0], l[2]]),
   [['t', 1], ['i', 2], ['x', 2], ['f', 2], ['h', 2]]);
eq('threads nomeado depois do usuário',
   perfis('@JORGEOLIVEIRAM - THREADS').map(l => [l[0], l[2]]),
   [['h', 1], ['i', 2], ['x', 2], ['t', 2], ['f', 2]]);
eq('whatsapp não tem URL de perfil, mas o usuário ainda propaga',
   perfis('WHATSAPP: @FULANODETAL').map(l => [l[0], l[2]]),
   [['i', 2], ['x', 2], ['t', 2], ['f', 2], ['h', 2]]);
eq('x nomeado não repete no nível 2',
   perfis('TWITTER @CLARIANABR').map(l => [l[0], l[2]]),
   [['x', 1], ['i', 2], ['t', 2], ['f', 2], ['h', 2]]);
eq('rede nomeada sem @usuário não vira link', perfis('FACEBOOK SIDA PEDROSA'), []);
eq('nome de pessoa sem arroba não vira link', perfis('ANTONIA SALES'), []);
eq('domínio depois do @ não é usuário', perfis('INSTAGRAM @fulano.com.br'), []);
eq('e-mail no campo não vira perfil', perfis('INSTAGRAM @fulano@gmail.com'), []);
eq('usuário curto demais', perfis('INSTAGRAM - @a'), []);
eq('pontuação no fim é aparada', perfis('INSTAGRAM: @FULANO.')[0],
   ['i', 'https://instagram.com/fulano', 1]);
eq('normalizarUrlRede não cuida de texto livre', url('INSTAGRAM - @HELTONJUNIORBH'), null);

console.log('\n== fallback perde para declarado, e nomeado perde para propagado');
eq('link declarado vence o @ inferido da mesma rede',
   escolherRedes([
     ['i', 'https://instagram.com/inferido', 1, 2],
     ['i', 'https://instagram.com/declarado', 9, 0],
   ]), [['i', 'https://instagram.com/declarado']]);
eq('inferido entra quando a rede não foi declarada',
   escolherRedes([
     ['f', 'https://facebook.com/declarado', 1, 0],
     ['i', 'https://instagram.com/inferido', 2, 2],
   ]).map(l => l[0]), ['i', 'f']);
eq('cinco declarados enchem as vagas e os inferidos ficam fora',
   escolherRedes([
     ['f', 'https://facebook.com/f', 1, 0],
     ['y', 'https://youtube.com/@y', 2, 0],
     ['t', 'https://tiktok.com/@t', 3, 0],
     ['h', 'https://threads.com/@h', 4, 0],
     ['l', 'https://linkedin.com/in/l', 5, 0],
     ['i', 'https://instagram.com/inferido', 6, 2],
     ['x', 'https://x.com/inferido', 7, 2],
   ]).map(l => l[0]), ['t', 'f', 'y', 'h', 'l']);
/* a rede que o texto nomeia é mais confiável que o palpite: não pode ser
   empurrada para fora por dois palpites de prioridade mais alta */
eq('rede nomeada sobrevive aos propagados, que são de nível pior',
   escolherRedes([
     ['s', 'https://fulano.com.br/', 1, 0],
     ['t', 'https://tiktok.com/@fulano', 2, 0],
     ['h', 'https://threads.com/@fulano', 3, 0],
     ['l', 'https://linkedin.com/in/fulano', 4, 0],
     ['y', 'https://youtube.com/@fulano', 5, 1],
     ['i', 'https://instagram.com/fulano', 5, 2],
     ['x', 'https://x.com/fulano', 5, 2],
   ]).map(l => l[0]), ['t', 'y', 's', 'h', 'l']);
eq('com uma vaga só, o nomeado leva',
   escolherRedes([
     ['s', 'https://fulano.com.br/', 1, 0],
     ['t', 'https://tiktok.com/@fulano', 2, 0],
     ['f', 'https://facebook.com/f', 3, 0],
     ['h', 'https://threads.com/@fulano', 4, 0],
     ['y', 'https://youtube.com/@fulano', 5, 1],
     ['i', 'https://instagram.com/fulano', 5, 2],
   ]).map(l => l[0]), ['t', 'f', 'y', 's', 'h']);
/* cinco propagados para cinco vagas: é o caso de aposta máxima, um @ virando
   cinco ícones, todos inferidos */
eq('helton: nomeado na frente, propagados enchendo as vagas restantes',
   escolherRedes(perfisDeTextoLivre('INSTAGRAM - @HELTONJUNIORBH')
     .map(([c, u, n]) => [c, u, 1, n])).map(l => l[0]),
   ['i', 'x', 't', 'f', 'h']);

console.log('\n== corte de 80 caracteres do TSE');
/* exatamente 80 chars, caminho de dois níveis decepado: link nasce morto */
eq('podcast do lula, cortado em /PODCAS',
   url('HTTPS://MUSIC.AMAZON.COM.BR/PODCASTS/FF48DCC6-34FF-453A-92B9-9D27161A646D/PODCAS'), null);
eq('facebook /people/ cortado',
   url('HTTPS://WWW.FACEBOOK.COM/PEOPLE/JUNIOR-RIBEIRO/PFBID0VWH5GNQSGEAHUJ14F7F2MSVN9JP'), null);
/* 80 chars mas o corte pegou só a query: o perfil está inteiro */
eq('perfil de instagram com a query decepada',
   url('https://www.instagram.com/feijogustavo.al?igsh=MTNjOHBpeTJqMGpoMQ%3D%3D&igsi=MTN'),
   'https://instagram.com/feijogustavo.al');
eq('caminho de dois níveis mas sem bater no corte fica',
   url('https://facebook.com/people/fulano/123456/'), 'https://facebook.com/people/fulano/123456/');
eq('duas URLs coladas: vale a primeira',
   url('HTTPS://WWW.FACEBOOK.COM/FULANOHTTPS://WWW.FACEBOOK.COM/BELTRANO'.replace('FULANO', 'FULANO ')),
   'https://facebook.com/fulano');

console.log('\n== NR_ORDEM_REDE_SOCIAL decide dentro de cada rede');
eq('a ordem menor ganha, mesmo vindo depois na lista',
   escolherRedes([['i', 'segundo', 15], ['i', 'primeiro', 1]]), [['i', 'primeiro']]);
eq('sem ordem, vale a posição na lista',
   escolherRedes([['i', 'a'], ['i', 'b']]), [['i', 'a']]);
/* regressão: o site do Patrus saía patrusgovernador.com.br (ordem 5, fora do ar) */
eq('patrus: site oficial é o de ordem 1',
   escolherRedes([
     ['s', 'https://patrusananias.com.br/', 1],
     ['s', 'https://tocompatrus.com/', 2],
     ['i', 'https://instagram.com/patrus_ananias/', 3],
     ['f', 'https://facebook.com/patrusananias13/', 4],
     ['s', 'https://patrusgovernador.com.br/', 5],
     ['x', 'https://x.com/patrus_ananias', 8],
   ]),
   [['i', 'https://instagram.com/patrus_ananias/'],
    ['x', 'https://x.com/patrus_ananias'],
    ['f', 'https://facebook.com/patrusananias13/'],
    ['s', 'https://patrusananias.com.br/']]);
/* regressão: o site do Lula saía mercadodamentira.com.br (ordem 23) */
/* @lulaoficial aparece em duas redes e @obrasilcomlula em uma, então o X segue
   o usuário canônico, não a ordem 16 */
eq('lula: instagram e x no usuário canônico, site na ordem 12',
   escolherRedes([
     ['i', 'https://instagram.com/lulaoficial', 1],
     ['i', 'https://instagram.com/brasilcomlula', 15],
     ['s', 'https://lula.com.br/', 12],
     ['s', 'https://mercadodamentira.com.br/', 23],
     ['x', 'https://x.com/obrasilcomlula', 16],
     ['x', 'https://x.com/lulaoficial', 17],
   ]).map(l => l[1]),
   ['https://instagram.com/lulaoficial', 'https://x.com/lulaoficial',
    'https://lula.com.br/']);

console.log('\n== site próprio na frente de plataforma genérica');
eq('deezer perde para lula.com.br, mesmo declarado antes',
   escolherRedes([
     ['s', 'https://www.deezer.com/ES/SHOW/3728967', 7],
     ['s', 'https://lula.com.br/', 12],
   ]), [['s', 'https://lula.com.br/']]);
eq('plataforma continua valendo quando é o único site',
   escolherRedes([['s', 'https://queroapoiar.com.br/fulano', 1]]),
   [['s', 'https://queroapoiar.com.br/fulano']]);
eq('só o balde de site é reordenado; instagram segue pela ordem declarada',
   escolherRedes([
     ['i', 'https://instagram.com/segundo', 9],
     ['i', 'https://instagram.com/primeiro', 2],
   ]), [['i', 'https://instagram.com/primeiro']]);
eq('domínio de campanha não é plataforma', ehPlataforma('patrusananias.com.br'), false);
eq('subdomínio de plataforma conta', ehPlataforma('open.bit.ly'), true);

console.log('\n== usuário canônico desempata dentro da rede');
eq('usuário do caminho', usuarioDaUrl('https://instagram.com/Fulano_2026/'), 'fulano_2026');
eq('arroba fora', usuarioDaUrl('https://tiktok.com/@fulano'), 'fulano');
eq('prefixo de rota não é usuário', usuarioDaUrl('https://linkedin.com/in/fulano'), null);
eq('identificador opaco não é usuário',
   usuarioDaUrl('https://facebook.com/profile.php?id=123'), null);
eq('raiz não tem usuário', usuarioDaUrl('https://fulano.com.br/'), null);

const itens = (...ls) => ls.map(([cod, url, ordem]) => ({ cod, url, ordem }));
eq('canônico é quem repete em mais redes', usuarioCanonico(itens(
   ['i', 'https://instagram.com/lulaoficial', 1],
   ['i', 'https://instagram.com/brasilcomlula', 15],
   ['x', 'https://x.com/obrasilcomlula', 16],
   ['x', 'https://x.com/lulaoficial', 17],
   ['y', 'https://youtube.com/@lulaoficial', 9],
)), 'lulaoficial');
eq('usuário visto numa rede só não é evidência', usuarioCanonico(itens(
   ['i', 'https://instagram.com/fulano', 1],
   ['x', 'https://x.com/beltrano', 2],
)), null);
eq('empate de redes resolve pela menor ordem', usuarioCanonico(itens(
   ['i', 'https://instagram.com/beltrano', 9], ['x', 'https://x.com/beltrano', 10],
   ['y', 'https://youtube.com/@fulano', 1],    ['t', 'https://tiktok.com/@fulano', 2],
)), 'fulano');
eq('site não entra na conta de usuário', usuarioCanonico(itens(
   ['s', 'https://exemplo.com.br/fulano', 1], ['i', 'https://instagram.com/fulano', 2],
)), null);
eq('link inferido não vota no canônico', usuarioCanonico([
   { cod: 'i', url: 'https://instagram.com/declarado', ordem: 1, inferido: 0 },
   { cod: 'x', url: 'https://x.com/palpite', ordem: 2, inferido: 2 },
   { cod: 't', url: 'https://tiktok.com/@palpite', ordem: 2, inferido: 2 },
]), null);
eq('o canônico vence a ordem declarada dentro da rede', escolherRedes([
   ['i', 'https://instagram.com/fulano', 1, 0],
   ['y', 'https://youtube.com/@fulano', 2, 0],
   ['x', 'https://x.com/outraconta', 3, 0],
   ['x', 'https://x.com/fulano', 4, 0],
]).map(l => l[1]).filter(u => u.includes('x.com')), ['https://x.com/fulano']);
eq('sem canônico, a ordem manda', escolherRedes([
   ['x', 'https://x.com/primeiro', 1, 0],
   ['x', 'https://x.com/segundo', 2, 0],
]), [['x', 'https://x.com/primeiro']]);

console.log('\n---------------------------------------------');
console.log(pass + ' passaram, ' + fail + ' falharam');
process.exit(fail ? 1 : 0);
