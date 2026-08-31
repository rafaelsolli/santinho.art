# santinho.art — Especificação de Produto e Implementação

## 1. Objetivo

Desenvolver o **santinho.art**, uma aplicação web estática, mobile-first, para funcionar como uma **cola eleitoral digital para as eleições brasileiras de 2026**.

O usuário deve conseguir:

- informar os números de seus candidatos;
- visualizar automaticamente nome, partido e foto quando os dados forem válidos;
- usar voto de legenda nos cargos proporcionais;
- compartilhar a própria seleção por URL;
- abrir uma URL compartilhada e encontrar a cola já preenchida;
- usar o site confortavelmente no celular, sem rolagem vertical na tela principal.

A aplicação deve ter estética inspirada em **santinhos eleitorais impressos**, e não em formulários convencionais.

---

# 2. Princípios do produto

## 2.1. Simplicidade

O site deve ser extremamente direto.

A tela principal deve conter apenas:

- identidade `santinho.art`;
- indicação de eleições 2026;
- seletor de UF;
- botão de compartilhamento;
- os seis votos;
- feedback visual de validade;
- nenhuma navegação secundária obrigatória.

Evitar:

- menus;
- modais desnecessários;
- etapas;
- wizard;
- telas de confirmação;
- excesso de instruções.

---

## 2.2. Mobile-first

O principal dispositivo de uso é smartphone.

A interface deve ser projetada primeiro para larguras entre aproximadamente:

- 320 px;
- 360 px;
- 390 px;
- 412 px;
- 430 px.

Desktop pode existir como adaptação da mesma interface, mas não deve ditar o design.

---

## 2.3. Uma única tela

A tela principal deve caber integralmente na viewport.

Objetivo:

```css
height: 100dvh;
overflow: hidden;
```

Não deve existir scroll vertical em condições normais de uso.

A altura disponível deve ser distribuída entre:

- cabeçalho compacto;
- seis cards de voto.

Os cards devem aproveitar a altura disponível ao máximo.

---

# 3. Escopo eleitoral

A ordem dos votos deve ser:

1. Deputado federal — 4 dígitos
2. Deputado estadual ou distrital — 5 dígitos
3. Senador — 1ª vaga — 3 dígitos
4. Senador — 2ª vaga — 3 dígitos
5. Governador — 2 dígitos
6. Presidente — 2 dígitos

A aplicação deve considerar a UF selecionada para todos os cargos estaduais.

Presidente é nacional.

---

# 4. URL compartilhável

Toda a seleção deve ser representável na query string.

Formato sugerido:

```text
https://santinho.art/?uf=mg&df=1313&de=13131&s1=131&s2=132&g=13&p=31
```

Parâmetros:

```text
uf  = unidade federativa
df  = deputado federal
de  = deputado estadual/distrital
s1  = senador 1
s2  = senador 2
g   = governador
p   = presidente
```

## 4.1. Atualização da URL

A URL deve mudar automaticamente enquanto o usuário edita.

Usar:

```js
history.replaceState(...)
```

Não recarregar a página.

Não criar uma nova entrada no histórico a cada dígito.

---

## 4.2. Inicialização por URL

Ao abrir uma URL com parâmetros:

1. selecionar a UF;
2. preencher todos os números;
3. resolver candidatos;
4. carregar nome;
5. carregar partido;
6. carregar foto;
7. identificar votos de legenda;
8. identificar números inválidos.

---

# 5. Compartilhamento

Deve existir apenas um botão de compartilhamento no cabeçalho.

Usar preferencialmente o ícone `ShareNetwork` ou equivalente da biblioteca **Phosphor Icons**.

No mobile:

```js
navigator.share(...)
```

Fallback:

```js
navigator.clipboard.writeText(location.href)
```

Exibir feedback curto:

```text
Link copiado ✓
```

---

# 6. Seleção de UF

Deve haver seletor de UF no cabeçalho.

Exemplo:

```text
MG
SP
RJ
...
```

A UF também deve ser persistida na URL:

```text
?uf=mg
```

Ao trocar a UF:

- manter os números digitados;
- revalidar todos os cargos estaduais;
- presidente permanece nacional;
- atualizar a URL imediatamente.

---

# 7. Dados eleitorais

## 7.1. Fonte

Usar prioritariamente dados oficiais do **Tribunal Superior Eleitoral — TSE**.

Fonte preferencial:

```text
Portal de Dados Abertos do TSE
```

Dados necessários:

- UF;
- cargo;
- número;
- nome de urna;
- sigla do partido;
- situação da candidatura;
- SQ_CANDIDATO;
- foto.

---

# 8. Arquitetura de dados

A aplicação deve continuar sendo **100% estática**.

Não depender de backend próprio.

Arquitetura recomendada:

```text
TSE
 ↓
script de atualização/build
 ↓
JSON otimizado + fotos
 ↓
GitHub Pages
 ↓
santinho.art
```

Evitar fazer chamadas ao TSE a cada tecla digitada.

Motivos:

- desempenho;
- disponibilidade;
- CORS;
- estabilidade;
- controle de versão;
- experiência offline parcial;
- redução de dependência externa.

---

# 9. Pipeline de atualização

Criar um script, por exemplo:

```text
scripts/update-data.mjs
```

Responsabilidades:

1. baixar os arquivos oficiais do TSE;
2. descompactar;
3. ler os CSVs;
4. normalizar encoding;
5. selecionar apenas campos relevantes;
6. indexar candidatos;
7. localizar fotos;
8. gerar JSON otimizado;
9. opcionalmente copiar ou converter fotos;
10. registrar data da atualização.

---

# 10. Estrutura sugerida dos dados

Exemplo:

```json
{
  "meta": {
    "ano": 2026,
    "fonte": "TSE",
    "atualizadoEm": "2026-08-29T12:00:00Z"
  },

  "candidatos": {
    "MG": {
      "df": {
        "1313": {
          "nome": "Nome de Urna",
          "partido": "ABC",
          "foto": "/data/photos/123.jpg",
          "sq": "123456789"
        }
      },

      "de": {},
      "s": {},
      "g": {}
    },

    "BR": {
      "p": {}
    }
  },

  "partidos": {
    "MG": {
      "13": {
        "sigla": "ABC"
      }
    }
  }
}
```

O lookup no front deve ser O(1), por exemplo:

```js
db.candidatos.MG.g["13"]
```

Evitar arrays que exigem `find()` a cada tecla.

---

# 11. Fotos

As fotos devem vir preferencialmente da fonte oficial.

A aplicação deve aceitar:

```js
{
  foto: "/data/photos/123456789.jpg"
}
```

Preferir fotos locais geradas pelo build em vez de hotlink para servidores externos.

Motivos:

- estabilidade;
- performance;
- cache;
- evitar quebra futura de URLs;
- evitar CORS;
- controle de compressão.

Se possível:

- converter para WebP;
- limitar resolução;
- preservar proporção 3:4;
- gerar tamanho adequado a mobile.

---

# 12. Atualização automática

Criar GitHub Action.

Exemplo de comportamento:

```text
.github/workflows/update-data.yml
```

Rodar:

- manualmente;
- diariamente durante o período eleitoral.

Fluxo:

```text
checkout
→ instalar dependências
→ executar update-data
→ detectar alterações
→ commit
→ push
```

O site publicado no GitHub Pages deve passar a usar a nova base automaticamente.

---

# 13. Situação das candidaturas

A base deve manter a situação da candidatura.

A implementação deve decidir claramente quais situações são consideradas válidas para apresentação.

Não assumir que todo registro publicado é necessariamente uma candidatura apta.

A regra deve estar isolada em uma função, por exemplo:

```js
function candidaturaExibivel(candidate) {
  ...
}
```

Isso deve ser fácil de alterar conforme as regras e os dados oficiais evoluam.

---

# 14. Cards

Cada voto deve ser apresentado como um **mini santinho eleitoral horizontal**.

Não deve parecer:

- formulário bancário;
- OTP;
- formulário administrativo;
- tabela.

A linguagem visual deve lembrar propaganda eleitoral impressa.

Estrutura aproximada:

```text
┌─────────────────────────────────────┐
│ FOTO   NOME               13 13     │
│        PARTIDO                      │
│        DEPUTADO FEDERAL             │
└─────────────────────────────────────┘
```

---

# 15. Hierarquia visual do card

Ordem de destaque:

1. número;
2. foto;
3. nome;
4. partido;
5. cargo.

O número deve ser muito grande e imediatamente reconhecível.

O nome deve ter fonte pesada.

O cargo pode ser menor e funcionar como informação contextual.

---

# 16. Estética de santinho

Buscar referências visuais de santinhos eleitorais brasileiros.

Características desejáveis:

- cores fortes;
- faixas;
- blocos cromáticos;
- gradientes;
- recortes diagonais;
- foto grande;
- número muito grande;
- tipografia pesada;
- partido como selo;
- composição publicitária.

Não copiar identidade visual de candidato real.

A estrutura deve permanecer politicamente neutra.

A cor pode ser derivada:

- do partido;
- de hash da sigla;
- de paleta neutra consistente.

---

# 17. Foto

Proporção obrigatória:

```text
3:4
```

A foto deve ocupar praticamente toda a altura útil do card.

Usar:

```css
aspect-ratio: 3 / 4;
object-fit: cover;
```

Quando não houver candidato válido:

```text
?
```

Pode haver fundo neutro/gradiente.

---

# 18. Estado válido

Quando o número corresponder a uma candidatura válida:

Mostrar:

- foto;
- nome;
- partido;
- número;
- cargo.

Exemplo:

```text
MAYA RIBEIRO
FUT
Deputado federal
1313
```

---

# 19. Estado inválido

Quando:

- nenhum número foi preenchido;
- o número está incompleto;
- o número não existe;
- o número não corresponde a uma candidatura válida;

mostrar:

```text
[ INVÁLIDO ]
```

A tag deve ocupar o lugar do nome.

Estilo:

- cinza;
- discreto;
- mesma geometria da tag de voto de legenda.

Não usar:

```text
???
```

como nome ou partido.

A foto deve mostrar:

```text
?
```

O partido pode ficar oculto.

---

# 20. Voto de legenda

Aplicável apenas aos cargos proporcionais:

- deputado federal;
- deputado estadual/distrital.

Os dois primeiros dígitos representam o partido.

Deve existir um separador visual depois do segundo dígito.

Exemplo:

```text
13 ⋮ 13
```

ou equivalente com linha pontilhada.

CSS sugerido:

```css
border-right: 2px dotted ...
```

---

## 20.1. Estado de legenda

Quando os dois primeiros dígitos formarem um partido válido e os demais estiverem vazios:

- não mostrar candidato;
- não mostrar foto de candidato;
- mostrar tag:

```text
VOTO DE LEGENDA
```

A tag deve ocupar exatamente o espaço do nome do candidato.

Mostrar o partido.

Foto:

```text
?
```

ou, futuramente, símbolo/identidade do partido, caso faça sentido.

---

# 21. Dois senadores

Existem dois campos independentes:

```text
s1
s2
```

Ambos consultam a mesma base de candidatos ao Senado.

A aplicação não deve impedir inicialmente que o usuário coloque o mesmo número nas duas vagas, a menos que exista decisão explícita de produto sobre isso.

Pode existir validação futura.

---

# 22. Inputs de número

Essa é uma área crítica.

A UX deve funcionar muito bem em:

- Android;
- Chrome;
- Brave;
- Safari iOS;
- teclado virtual.

Não confiar apenas em:

```js
keydown
```

para comportamento de edição mobile.

Usar combinação robusta de:

```text
beforeinput
input
keydown
paste
focus
selection
```

---

# 23. Comportamento de digitação

Cada dígito deve ser individualmente editável.

Comportamento esperado:

### Ao digitar

```text
1
```

- preenche o dígito atual;
- avança imediatamente para o próximo.

### Ao digitar sobre um dígito existente

- substitui o valor;
- avança.

### No último dígito

- mantém foco;
- seleciona o dígito;
- não pula para outro card automaticamente.

---

# 24. Backspace

Comportamento obrigatório:

Se o campo atual possui valor:

```text
Backspace
```

→ apaga somente esse valor.

Se o campo atual está vazio:

```text
Backspace
```

→ volta para o campo anterior e apaga o valor anterior.

Deve funcionar consistentemente em teclado virtual.

---

# 25. Delete

Se suportado pelo dispositivo:

```text
Delete
```

deve apagar o dígito atual.

---

# 26. Navegação por toque

Ao tocar diretamente em um dígito:

- esse dígito recebe foco;
- o valor existente fica selecionado;
- a próxima digitação substitui o valor.

Ao tocar na área geral do card:

- focar o primeiro dígito vazio;
- se todos estiverem preenchidos, focar o último.

---

# 27. Navegação por teclado físico

Suportar:

```text
ArrowLeft
ArrowRight
Backspace
Delete
0-9
```

Opcionalmente:

```text
Tab
Shift+Tab
```

de forma previsível.

---

# 28. Colar número

Se o usuário colar:

```text
13131
```

a partir de qualquer posição:

- distribuir os dígitos sequencialmente;
- respeitar o limite do cargo;
- ignorar caracteres não numéricos;
- atualizar candidato;
- atualizar URL.

---

# 29. Destaque de foco

Quando qualquer dígito de um card estiver em edição, destacar o card inteiro.

Exemplo:

- borda escura;
- halo com cor de destaque;
- alteração sutil de fundo;
- sem deslocamentos bruscos.

O dígito individual também deve ter destaque claro.

---

# 30. Número em modo de leitura

Avaliar uma evolução visual importante:

Quando o card **não estiver focado** e houver número válido:

- renderizar visualmente o número como um único bloco tipográfico grande;
- reduzir aparência de múltiplos inputs.

Ao tocar:

- transformar novamente nos inputs individuais.

Objetivo:

aproximar a estética final de um santinho impresso.

Essa melhoria é recomendada, mas pode ser implementada depois do fluxo básico.

---

# 31. Cabeçalho

O cabeçalho deve ficar diretamente sobre o background.

Não usar:

- card;
- contorno;
- caixa branca.

Elementos:

```text
santinho.art
ELEIÇÕES 2026
UF
share
```

Texto auxiliar curto opcional:

```text
Sua cola eleitoral. Edite os números e compartilhe.
```

---

# 32. Responsividade vertical

A interface deve se adaptar também à altura disponível.

Testar pelo menos:

```text
640 px
667 px
720 px
740 px
780 px
800 px
844 px
896 px
932 px
```

Usar media queries baseadas em:

```css
@media (max-height: ...)
```

A redução de escala deve priorizar:

1. gaps;
2. padding;
3. texto secundário;
4. header;
5. tamanho dos dígitos.

Não remover:

- foto;
- nome;
- partido;
- cargo;
- número;

em cargos específicos apenas para fazer caber.

Todos os seis cards devem manter a mesma estrutura.

---

# 33. Responsividade horizontal

A aplicação deve funcionar sem overflow horizontal.

Especial atenção ao deputado estadual:

```text
5 dígitos
```

Os cinco números devem caber junto com:

- foto;
- identificação do candidato.

Usar:

```css
clamp(...)
minmax(0, 1fr)
```

Evitar dimensões fixas grandes.

---

# 34. Acessibilidade

Requisitos mínimos:

- contraste aceitável;
- botão de compartilhar com `aria-label`;
- inputs com identificação do cargo e posição;
- foco visível;
- não depender exclusivamente de cor;
- suporte a zoom do navegador;
- evitar `user-scalable=no`.

Exemplo de label:

```text
Deputado federal, dígito 2 de 4
```

---

# 35. Performance

Meta:

- first load rápido em 4G;
- interação instantânea;
- lookup local;
- sem framework pesado.

Preferência:

```text
HTML
CSS
JavaScript vanilla
```

Framework só deve ser usado se trouxer ganho claro.

---

# 36. Dependências

Minimizar dependências no front.

Phosphor pode ser:

- SVG inline;
- pacote local;
- CDN apenas se realmente necessário.

No build é aceitável usar bibliotecas Node para:

- CSV;
- ZIP;
- imagem;
- normalização.

---

# 37. Privacidade

A aplicação não precisa de:

- login;
- conta;
- cookies;
- backend;
- banco de dados de usuários.

As escolhas ficam:

- no estado local da página;
- na URL.

Não enviar os votos escolhidos para servidor próprio.

Evitar analytics invasivo.

---

# 38. Segurança

Como os dados são públicos e o site é estático:

- escapar strings vindas do TSE;
- não inserir texto externo com `innerHTML`;
- usar `textContent`;
- validar URLs de foto;
- não executar conteúdo externo;
- evitar dependências desnecessárias.

---

# 39. SEO e compartilhamento

Configurar:

```text
title
description
theme-color
Open Graph
Twitter Card
favicon
```

Descrição sugerida:

```text
Monte e compartilhe sua cola eleitoral para 2026.
```

---

# 40. PWA — opcional

Pode ser interessante posteriormente:

```text
manifest.webmanifest
service-worker.js
```

Objetivo:

- abrir rapidamente;
- instalar na tela inicial;
- funcionar parcialmente offline.

Não é requisito para MVP.

---

# 41. GitHub Pages

O projeto deve ser publicável diretamente no GitHub Pages.

Não depender de:

- SSR;
- serverless;
- banco;
- API própria;
- runtime Node em produção.

Node pode existir apenas no pipeline/build.

---

# 42. Estrutura sugerida do projeto

```text
/
├── index.html
├── styles.css
├── app.js
├── data/
│   ├── candidatos.json
│   └── photos/
├── scripts/
│   └── update-data.mjs
├── .github/
│   └── workflows/
│       └── update-data.yml
├── package.json
└── README.md
```

Pode manter tudo em `index.html` inicialmente, mas a versão final deve favorecer organização e manutenção.

---

# 43. Tratamento de carregamento

Enquanto o JSON ainda estiver carregando:

- não bloquear a interface;
- permitir digitação;
- mostrar estado neutro;
- resolver os candidatos assim que a base estiver disponível.

Evitar spinner ocupando a tela.

Pode existir indicação discreta:

```text
carregando dados…
```

---

# 44. Falha de dados

Se `candidatos.json` falhar:

A interface continua utilizável como cola numérica.

Mostrar aviso discreto:

```text
Não foi possível validar os candidatos agora.
```

Não apagar números do usuário.

Compartilhamento deve continuar funcionando.

---

# 45. Atualização de candidatura

Se uma URL antiga referenciar um candidato que deixou de estar válido:

- manter o número;
- mostrar `INVÁLIDO`;
- não substituir automaticamente por outro candidato.

---

# 46. Neutralidade

O produto não deve:

- recomendar candidatos;
- ordenar candidatos por preferência;
- destacar ideologias;
- sugerir combinações de voto;
- privilegiar partidos;
- exibir propaganda.

A função é apenas:

```text
registrar + validar + compartilhar uma cola eleitoral.
```

---

# 47. Critérios de aceite do MVP

O MVP só deve ser considerado concluído quando:

- [ ] abre no celular sem scroll vertical;
- [ ] exibe os seis cargos;
- [ ] respeita a ordem eleitoral;
- [ ] permite selecionar UF;
- [ ] recebe números pela URL;
- [ ] atualiza URL enquanto o usuário digita;
- [ ] compartilha a URL;
- [ ] cada dígito pode ser selecionado individualmente;
- [ ] digitar avança consistentemente;
- [ ] backspace funciona consistentemente em Android;
- [ ] colar número funciona;
- [ ] candidato válido mostra nome;
- [ ] candidato válido mostra partido;
- [ ] candidato válido mostra foto;
- [ ] inválido mostra tag `INVÁLIDO`;
- [ ] voto de legenda mostra `VOTO DE LEGENDA`;
- [ ] existe separador visual após os dois dígitos do partido;
- [ ] senador 1 e senador 2 funcionam independentemente;
- [ ] presidente consulta base nacional;
- [ ] cargos estaduais respeitam UF;
- [ ] funciona sem backend próprio;
- [ ] base pode ser atualizada automaticamente via GitHub Action.

---

# 48. Testes obrigatórios de interação

Criar testes manuais e, se possível, automatizados para os casos abaixo.

## Digitação normal

```text
Governador:
[ ] [ ]

digitar 1
→ [1] [foco]

digitar 3
→ [1] [3]
```

---

## Substituição

```text
[1] [3]

tocar no 1
digitar 2

resultado:
[2] [3]
```

---

## Backspace

```text
[1] [3]
     foco

backspace
→ [1] [ ]

backspace
→ [ ] [ ]
  foco no primeiro
```

---

## Legenda

```text
Deputado federal:
[1] [3] ⋮ [ ] [ ]
```

Se `13` for um partido válido:

```text
VOTO DE LEGENDA
FUT
```

---

## Número completo

```text
[1] [3] ⋮ [1] [3]
```

Se válido:

```text
MAYA RIBEIRO
FUT
foto
```

---

## Inválido

```text
[9] [9] [9]
```

Se não existir:

```text
INVÁLIDO
?
```

---

# 49. Testes de navegador

Testar manualmente em pelo menos:

- Chrome Android;
- Brave Android;
- Safari iPhone;
- Chrome desktop.

O comportamento de teclado virtual deve receber prioridade sobre desktop.

---

# 50. Testes de viewport

Validar pelo menos:

```text
320 × 640
360 × 800
375 × 667
390 × 844
412 × 915
430 × 932
```

Critério:

```text
zero scroll vertical
zero overflow horizontal
```

---

# 51. Desenvolvimento orientado por pequenas entregas

A IA deve implementar em etapas verificáveis.

Ordem sugerida:

### Etapa 1
Layout estático mobile sem dados.

### Etapa 2
Inputs robustos e navegação mobile.

### Etapa 3
URL bidirecional.

### Etapa 4
Mock local de candidatos.

### Etapa 5
Importador do TSE.

### Etapa 6
Fotos.

### Etapa 7
Todas as UFs.

### Etapa 8
GitHub Action.

### Etapa 9
Polimento visual.

### Etapa 10
Testes mobile.

Não avançar escondendo bugs de interação com CSS.

---

# 52. Direção de implementação para a IA

Ao desenvolver:

1. leia esta especificação inteira;
2. identifique ambiguidades;
3. escolha a solução mais simples compatível com os requisitos;
4. preserve o caráter estático do projeto;
5. priorize funcionamento no Android real;
6. teste comportamento de inputs antes de polir estética;
7. use dados oficiais do TSE;
8. não invente estrutura de arquivo/API sem validar;
9. mantenha transformações de dados fora do navegador;
10. documente decisões importantes no README.

---

# 53. Regra importante sobre integração TSE

Não codificar URLs ou formatos internos do TSE com base apenas em suposição.

Antes de concluir o importador:

- verificar os recursos disponíveis em 2026;
- inspecionar os nomes reais dos arquivos;
- inspecionar headers reais dos CSVs;
- confirmar encoding;
- confirmar coluna de cargo;
- confirmar coluna de número;
- confirmar `SQ_CANDIDATO`;
- confirmar formato/nome das fotos;
- confirmar situação da candidatura.

O importador deve falhar de forma explícita se o schema esperado mudar.

Evitar heurísticas silenciosas que produzam base errada.

---

# 54. Requisito de qualidade do código

Código deve ser:

- legível;
- pequeno;
- modular;
- sem abstrações prematuras;
- sem framework desnecessário;
- sem CSS excessivamente acoplado a dados;
- sem magic numbers quando possível.

Funções sugeridas:

```js
loadElectionData()
resolveCandidate()
resolvePartyVote()
syncUrl()
hydrateFromUrl()
renderCard()
focusDigit()
handleBeforeInput()
handlePaste()
```

---

# 55. Resultado esperado

Ao final, a experiência deve ser aproximadamente:

```text
santinho.art            MG      share

┌─────────────────────────────────────┐
│ FOTO   MAYA RIBEIRO       13 ⋮ 13   │
│        FUT                          │
│        DEPUTADO FEDERAL             │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│   ?    VOTO DE LEGENDA   13 ⋮ --   │
│        FUT                          │
│        DEPUTADO ESTADUAL            │
└─────────────────────────────────────┘

...
```

A impressão geral deve ser:

> “isso parece uma coleção de santinhos eleitorais, mas editável”.

E não:

> “isso parece um formulário para cadastrar votos”.

---

# 56. Prioridades absolutas

Em caso de conflito entre requisitos, priorizar nesta ordem:

1. funcionamento correto da digitação;
2. ausência de scroll;
3. legibilidade dos números;
4. correta identificação do candidato;
5. compartilhamento por URL;
6. estética de santinho;
7. animações e detalhes cosméticos.

---

# 57. Fora do escopo inicial

Não implementar no MVP:

- autenticação;
- perfil;
- comentários;
- ranking;
- recomendação política;
- analytics individualizado;
- backend;
- edição colaborativa;
- cadastro manual de candidato;
- propaganda;
- monetização.

---

# 58. Observação final

O produto deve ser tratado como uma **cola eleitoral pessoal e compartilhável**, e não como uma plataforma de campanha.

O principal diferencial é combinar:

```text
simplicidade de um santinho
+
dados oficiais
+
URL compartilhável
+
interface extremamente eficiente em mobile
```

---

# 59. Decisões de implementação

Seção escrita pela implementação (§52.10). Documenta o que foi decidido onde a
especificação deixava margem, e o que ainda depende de confirmação externa.

## 59.1. Estado atual

MVP implementado e verificado, **com a base real do TSE** (importada em
2026-08-31 do pacote gerado pelo TSE em 27/08/2026): HTML/CSS/JS puros, sem
dependência em produção, publicável direto no GitHub Pages.

```text
19.830 candidaturas · 28 bases (27 UFs + nacional) · SP = 183 KB, mediana ≈ 40 KB
```

O mock saiu de `data/` e virou fixture de teste (`tests/fixtures/data`), para que
uma atualização da base real não quebre a suíte.

```text
index.html  styles.css  app.js       # o site inteiro
og.png                               # preview de compartilhamento
data/       meta.json                # procedência e avisos da base
            cores-partidos.json      # sigla → cor oficial (Wikidata P465)
            br.json                  # presidente (base nacional)
            uf/AC.json … uf/TO.json  # uma base por UF, carregada sob demanda
assets/     flags/AC.png … TO.png    # bandeiras das 27 UFs (163 KB)
scripts/    update-data.mjs          # importador do TSE (só no build)
            update-flags.mjs         # baixa as bandeiras (só no build)
            update-party-colors.mjs  # cores dos partidos (só no build)
            og.html                  # fonte do og.png
tests/      interacao.mjs            # §48 e §50, em Chrome real
            fixtures/data/           # base fictícia, só para os testes
.github/workflows/update-data.yml
```

`data/meta.json` carrega a procedência e é lido pelo front:

```json
{ "ano": 2026, "fonte": "TSE", "atualizadoEm": "…",
  "geradoPeloTseEm": "27/08/2026",
  "situacaoPublicada": false, "numerosEmDisputa": 124, "fotos": "nenhuma" }
```

Se `fonte` não for `"TSE"`, o cabeçalho avisa `dados de exemplo — base não
oficial`. É o que acontece ao servir as fixtures, cujos nomes contêm
`EXEMPLO`/`DEMO`/`TESTE` para nunca serem confundidos com candidaturas reais.

## 59.2. Digitação: um input mestre por card

O §22 chama a área de inputs de crítica, e ela é. A implementação **não** usa um
`<input>` por dígito. Cada card tem **um** input transparente que guarda o número
inteiro; as casinhas de dígito são `<span>`s puramente visuais.

Motivos:

- O input **nunca fica vazio** (usa `-` como marca de dígito ausente) e mantém
  **sempre um caractere selecionado**. É essa combinação que faz o Gboard emitir
  `deleteContentBackward` de forma confiável — a causa raiz do bug clássico de
  backspace em campo vazio no Android.
- Um único elemento focável por card elimina o vai-e-vém de foco entre 26 inputs,
  que é a outra fonte recorrente de bug em teclado virtual.
- Todo `beforeinput` é cancelado com `preventDefault()`: o valor do campo nunca
  muda por conta do navegador. Substituição, avanço, backspace, delete e colagem
  são lógica própria sobre um array — determinístico em qualquer teclado.

Custo: o §34 sugeria um input por dígito com rótulo `dígito 2 de 4`. Aqui o
rótulo do cargo fica no `aria-label` do input e a posição corrente é anunciada
por um elemento `aria-describedby` que diz `MAYA EXEMPLO, FUT, dígito 2 de 4`.
Cada dígito continua individualmente selecionável por toque (§26) e por setas.

O estado de cada cargo é um **array com buracos**, não uma string, porque a
especificação permite `1 3 _ 3`. Buracos são preservados na URL como `de=13-7`.

## 59.3. Base fatiada por UF (desvio do §10)

O §10 sugere um `candidatos.json` único. A implementação gera **um arquivo por
UF** (`data/uf/SP.json`) mais `data/br.json` para presidente, carregados sob
demanda. Todas as UFs somam algo na casa de milhares de candidaturas; baixar a
base nacional para usar uma UF contraria a meta de first load do §35. O formato
interno preserva exatamente o lookup O(1) pedido:

```js
db.cargos.df["1313"]   // → { n, p, sq, sit, foto? }
```

Chaves curtas (`n`, `p`, `sq`, `sit`) para reduzir payload.

## 59.4. Situação da candidatura — o TSE ainda não julgou

O importador **normaliza** a situação do TSE em uma letra e a preserva no JSON:

```text
A = apta   P = pendente/sub judice   X = não apta   N = não informada
```

**Fato apurado na base real:** todas as 41.538 linhas de 2026 vêm com
`DS_SITUACAO_CANDIDATURA = "#NE"` e `CD_SITUACAO_CANDIDATURA = -3`, e o layout
de 2026 **não tem** a coluna `DS_DETALHE_SITUACAO_CAND`. Ou seja: os registros
foram protocolados, mas o julgamento não foi publicado. `#NE` virou `N` —
registro existe, situação não informada — e deliberadamente **não** `A`, para
não afirmar aptidão que o dado não sustenta.

A regra de exibição vive em `candidaturaExibivel()` em `app.js`, sobre
`SITUACOES_EXIBIVEIS`, hoje `{A, N}`. Excluir `N` hoje esconderia a base inteira;
quando o TSE publicar o julgamento, **remover `N` dali passa a ser a postura
correta** e não exige reprocessar a base (§13).

Enquanto `meta.situacaoPublicada` for `false`, o cabeçalho exibe
`registros ainda não julgados pelo TSE`.

### Números em disputa

124 colisões: dois `SQ_CANDIDATO` diferentes com o mesmo número no mesmo
cargo/UF — acontece de verdade no período de registro (dois pedidos do mesmo
partido com o mesmo número, nenhum julgado). Exemplo real em SP, deputado
federal 2777: dois candidatos distintos, ambos do DC.

O desempate é **determinístico e declarado**, nunca aleatório: melhor situação
primeiro; empatando, o `SQ_CANDIDATO` maior (pedido mais recente). Os registros
envolvidos ficam marcados com `dup: 1` no JSON, e o total vai para
`meta.numerosEmDisputa`. **O front ainda não sinaliza `dup` na tela** — decisão
de produto pendente, já que exibir um dos dois nomes sem aviso privilegia um
candidato (§46).

## 59.5. Estado `indeterminado` (acréscimo ao §19)

O §19 manda mostrar `INVÁLIDO` quando o número não existe. Mas enquanto a base
não carregou — ou falhou (§44) — não há como afirmar que o número não existe.
Existe, então, um sexto estado: o card mostra `—` em vez de `INVÁLIDO`, mantém os
números e continua editável e compartilhável. `INVÁLIDO` só aparece quando a base
está carregada e realmente não contém aquele número.

## 59.6. Cores: cinza no produto, cor real no partido

A regra é uma inversão do que estava aqui antes, e vale registrar o porquê.

**O cromo do produto é cinza puro.** Nenhum matiz em fundo, card, tipografia ou
controle. Uma paleta creme quente — que era o desenho original — é ela própria
uma cor competindo com as das legendas, e a cor de partido em cima dela nunca
fica limpa. Em cinza, **a única cor na tela é a do partido**.

**A cor de cada partido é a real.** O §16 lista "derivada do partido" como
primeira opção, e hash da sigla como segunda; a versão anterior usava hash,
argumentando neutralidade. O argumento não se sustenta: hash põe o PT em roxo,
que não é neutro, é *errado* — e informação errada não é neutralidade. Cor real
não privilegia ninguém, porque **toda** legenda recebe a sua.

### De onde vem a cor

`scripts/update-party-colors.mjs` → `data/cores-partidos.json`, a partir da
propriedade **P465 (cor)** do Wikidata, que é citável e reconferível — não de
memória.

```bash
npm run update-colors      # 27 das 30 siglas da base atual
```

São **duas consultas**: a restrita (instância direta de "partido político",
precisa) e, para o que sobrou, uma ampla — qualquer entidade brasileira com cor,
filtrada pelo casamento de sigla/rótulo. A segunda existe porque nem todo
partido está tipado como instância direta: PCB e PCdoB não estão, e a caminhada
de subclasses (`P31/P279*`) derruba o endpoint com 502. Os achados da consulta
ampla são listados na saída para auditoria.

Só resolve siglas que estão de fato na base gerada por `update-data.mjs`. Sigla
sem cor conhecida **não derruba o build**: cai na paleta por hash, que agora é
de cinzas — então a ausência de cor aparece como ausência, não como cor errada.

O Wikidata resolveu 27 das 30 siglas. Ficaram de fora `MISSÃO` (que herdou o
número 14 do PTB, cuja única entrada no Wikidata está marcada como extinta em
2023 — pintar o MISSÃO de verde-escuro do PTB atribuiria identidade que o dado
não sustenta), `PRD` (2023) e `UP`, que não têm `P465`.

### O arquivo é curadoria, e o script a preserva

As 30 cores hoje em `data/cores-partidos.json` foram **revisadas à mão**, e são
mais precisas que as do Wikidata em vários casos. Por isso o script mudou de
comportamento: **o que já está no arquivo tem precedência**, e o Wikidata só
preenche lacunas. Rodar `npm run update-colors` de novo não apaga ajuste manual —
ele lista o que preservou. Para descartar a curadoria e refazer tudo da fonte,
`--refazer`, explicitamente.

O arquivo carrega a procedência de cada sigla em `origem`
(`curadoria` | `manual` | `wikidata` | `wikidata-amplo`), então dá para auditar
depois de onde cada cor veio.

Três detalhes que custaram tempo e estão codificados no script:

- **Legenda extinta.** O Wikidata tem duas entradas para "PL": `#FF7F00`
  (laranja) para o PL de 1985-2006 e `#0F0073` para o fundado em 2006, que é o
  atual. O filtro de dissolução (`P576`) resolve — e a lembrança popular de
  "PL laranja" é justamente a legenda errada. `CORES_MANUAIS` existe para
  exceções e está **vazio de propósito**.
- **Renomeações.** Várias legendas mudaram de nome e o Wikidata guarda a sigla
  antiga em `P1813`: Republicanos→PRB, Cidadania→PPS, AGIR→PTC,
  Solidariedade→SD. O casamento é feito por sigla **ou por rótulo**, ambos
  normalizados sem acento; `APELIDOS` cobre o resto (União Brasil, Unidade
  Popular, PCdoB).
- **`P1813` tem de ser `OPTIONAL`.** União Brasil e Democrata não têm sigla no
  Wikidata e eram descartados antes de chegar ao casamento por rótulo.

### Contraste

Cor real inclui amarelo (PSOL `#FFEE57`) e azul-claro (Republicanos `#4DBCE7`),
onde texto branco é ilegível. Cada cor gera duas variantes calculadas por
luminância WCAG, uma vez por sigla:

```text
--c         cor cheia          → faixa diagonal, tintas, dígito em foco
--c-txt     #fbfbfc ou #17181b → texto sobre a cor cheia (selo, dígito em foco)
--c-escura  cor escurecida     → número e nome sobre o card quase branco
```

`--c-escura` escurece em passos de 10% até a luminância cair abaixo de 0,17, o
que dá ~4,5:1 contra o card. A suíte mede a razão de contraste de verdade, em
cor escura e em cor clara, em vez de confiar no olho.

### Marca

O favicon anterior era um quadrado **vermelho com "13"** — que é número de
partido real. Virou marca neutra (`00`, número que nenhuma legenda tem). O
`og.png` seguiu o mesmo caminho: cinza, com `00` nos exemplos.

## 59.7. Fotos — locais, todas as 19.830

O plano inicial era referenciar a foto oficial por URL em runtime, sem peso no
repositório. **Essa URL não existe.** Apurado contra os servidores reais:

| Tentativa | Resultado |
|---|---|
| `cdn.tse.jus.br/.../fotos/F{UF}{SQ}_div.jpg` (arquivo solto) | 404 |
| `divulgacandcontas.../candidatura/buscar/{ano}/{UE}/{eleicao}/candidato/{SQ}` | 200 com **corpo vazio** para todo SQ real |
| `divulgacandcontas.../candidaturas/oficial/...` | 403 |
| `cdn.tse.jus.br/.../fotos/foto_cand2026_{UF}_div.zip` (ZIP por UF) | **200 ✔** |

Sobrou a fonte que o §11 já preferia: **fotos locais geradas pelo build**.

```text
28 ZIPs (27 UFs + BR) baixados pelo importador
19.830 fotos salvas, 113 MB · zero candidaturas sem foto
JPEG 111x155 ou 161x225, já em 3:4 — não precisa converter
data/photos/<UF>/F<UF><SQ_CANDIDATO>_div.jpg
```

Como os JPEGs já vêm pequenos (2-5 KB) e na proporção certa, **converter para
WebP não traz ganho real** e custaria 19.830 conversões por atualização. Vices,
suplentes e o `leiame.pdf` que vêm nos ZIPs são descartados: só entra foto de
candidatura que está na base.

O JSON guarda apenas a marca `"f": 1`; o caminho é derivado de UF + `SQ_CANDIDATO`
por `fotoLocal()` em `app.js`. Repetir o caminho inteiro engordava `SP.json` de
199 KB para 304 KB — 100 KB de string repetida no primeiro carregamento (§35).
É caminho gerado por nós, não URL do TSE montada por suposição.

Toda URL ainda passa por `fotoUrlSegura()` antes de virar `src` (§38): exige
`https:` e host em allowlist (`divulgacandcontas.tse.jus.br`, `cdn.tse.jus.br`),
ou caminho relativo `data/photos/…`. Foto que não carrega volta ao placeholder
`?` (§17).

**Custo:** o repositório passa a ter ~113 MB de JPEG. O GitHub Pages serve sem
problema (cada visita baixa as 6 fotos que usa, ~30 KB), mas o clone fica pesado
para sempre. Rodar o importador **sem** `--fotos` preserva as fotos existentes;
para removê-las é preciso pedir explicitamente `--fotos=nenhuma`.

## 59.8. Escala vertical e horizontal

A tipografia interna do card usa **unidades de container** (`cqh`/`cqw`), então o
número, o nome e a foto escalam com a altura real do card sem uma media query por
altura. O número recebe um **orçamento de largura fixo** dividido pela quantidade
de dígitos:

```css
font-size: min(42cqh, calc(38cqw / var(--n)));
```

Assim o cargo de 5 dígitos (deputado estadual, o pior caso do §33) ocupa a mesma
fração de largura que o de 2, e a tag `VOTO DE LEGENDA` sempre cabe inteira. As
media queries de `max-height` cuidam apenas da ordem de redução do §32: gaps →
padding → texto auxiliar → header → dígitos.

Os rótulos de cargo aparecem abreviados no card (`DEP. ESTADUAL`, `1º SENADOR`)
porque o espaço é disputado com o número; o nome completo permanece nos rótulos
de acessibilidade.

### Dígitos: casinha permanente (recusa consciente do §30)

O §30 recomenda uma evolução visual: com o card em repouso, o número viraria um
bloco tipográfico único, "reduzindo a aparência de múltiplos inputs", voltando a
casinhas ao toque. Isso foi implementado e **desfeito**.

Dois motivos:

- **Afordância.** Sem a casinha, o número não se anuncia como campo. O produto
  todo é editar seis números; esconder que eles são editáveis contraria o
  objetivo antes de ganhar estética.
- **Troca de aparência.** O número mudava de forma entre repouso e edição, o que
  chama mais atenção do que o ganho de acabamento justifica.

Hoje a casinha é permanente e o foco só intensifica o que já está lá: a tinta do
fundo sobe de 8% para 13% e o dígito corrente é preenchido com a cor cheia do
partido. **Nenhuma mudança de geometria** — a suíte compara largura, posição e
gap de cada dígito antes e depois de focar, porque o §29 proíbe deslocamento.

Efeito colateral que teve de ser pago: casinha separada ocupa mais largura que o
bloco colapsado, e nomes médios como `CELSO RUSSOMANNO` passaram a quebrar em
duas linhas. O orçamento de largura do número caiu de 33cqw para 31cqw e
devolveu a linha.

### Nome de urna: inteiro, sem abreviar

Os dados reais quebraram duas hipóteses que o mock escondia.

**Siglas longas.** `REPUBLICANOS`, `SOLIDARIEDADE` (30 siglas na base). O selo do
partido não é truncado — `.meta` usa `flex-wrap`, então a sigla longa empurra o
cargo para a linha de baixo em vez de cortá-lo (o §32 proíbe suprimir o cargo).

**Nomes longos.** Mediana 14 caracteres, p90 = 20, máximo 30 — e o máximo é 30
porque **o próprio TSE já corta o nome de urna nesse tamanho** (`VILMAR A
GUERREIRA DA ZONA OES` é "ZONA OESTE" truncado na origem). Abreviar em cima
disso seria abreviar duas vezes, então o nome vai **inteiro**: a fonte se ajusta
ao comprimento e o nome usa até duas linhas.

O detalhe que importa: `--nl` não é "metade dos caracteres", é a **linha mais
longa depois da quebra por palavras**, calculada por busca binária em
`maiorLinha()` — palavras não quebram no meio. `ZÉ - TELMO CORRETOR DE IMÓVEIS`
quebra em `ZÉ - TELMO CORRETOR` + `DE IMÓVEIS`, ou seja 19 caracteres, não 15.
Com o palpite ingênuo a fonte ficava grande demais e o nome era cortado com `…`.
Cálculo puro, sem medir o DOM: nenhum reflow por tecla digitada. A terceira linha
existe como rede de segurança para nomes de letras largas.

## 59.9. Integração com o TSE — verificada

Os caminhos abaixo foram **confirmados contra os servidores reais** em
2026-08-31, não supostos (§53).

### Descoberta, não chute

O portal do TSE roda CKAN, que lista os recursos de cada dataset. Perguntar ao
portal é o que dispensa adivinhar nome de arquivo:

```bash
node scripts/update-data.mjs --probe
```

Imprime todos os recursos reais do dataset, testa os caminhos codificados
(incluindo um arquivo de 2022 como controle, para separar "não existe" de "acesso
bloqueado") e conclui qual comando rodar.

### Caminhos confirmados

```text
página do dataset
  https://dadosabertos.tse.jus.br/dataset/candidatos-2026
API de descoberta (CKAN)
  https://dadosabertos.tse.jus.br/api/3/action/package_show?id=candidatos-2026
candidatos (3,1 MB, CSVs latin-1 separados por ';')
  https://cdn.tse.jus.br/estatistica/sead/odsele/consulta_cand/consulta_cand_2026.zip
fotos, um ZIP por UF (113 MB no total)
  https://cdn.tse.jus.br/estatistica/sead/eleicoes/eleicoes2026/fotos/foto_cand2026_<UF>_div.zip
```

**Atenção ao caminho das fotos**: não está sob `odsele/foto_candidato/` como em
anos anteriores, e sim sob `eleicoes/eleicoes2026/fotos/`. O caminho antigo
responde 404.

### A pegadinha do User-Agent

`curl` recebe **403 do Akamai** em todos os domínios do TSE, mesmo passando um
User-Agent de navegador — o bloqueio olha o fingerprint TLS. O `fetch` do Node
passa normalmente. Ou seja: um 403 no `curl` **não** significa que a base está
inacessível. O importador manda User-Agent de navegador em todas as requisições.

### O que o pacote real contém

```text
consulta_cand_2026_<UF>.csv  +  consulta_cand_2026_BRASIL.csv (agregado)
50 colunas; a UF de cada linha vem de SG_UF, nunca do nome do arquivo
duas eleições: 6257 "Eleição Geral Federal" (presidente)
               6259 "Eleições Gerais Estaduais" (demais cargos)
```

O agregado `BRASIL.csv` duplica o conteúdo dos arquivos por UF; a indexação por
`(UF, cargo, número)` absorve isso sem efeito colateral.

**Mapeamento de `CD_CARGO` confirmado** contra `DS_CARGO` na base real:

| Código | Cargo | Uso |
|---|---|---|
| 1 | Presidente | `p` (base nacional) |
| 3 | Governador | `g` |
| 5 | Senador | `s` |
| 6 | Deputado federal | `df` |
| 7 | Deputado estadual | `de` |
| 8 | Deputado distrital | `de` (DF) |
| 2, 4, 9, 10 | Vice-presidente, vice-governador, 1º e 2º suplente | ignorados |

### As travas continuam de pé

| Constante em `scripts/update-data.mjs` | Estado |
|---|---|
| `TSE_SOURCES` | **confirmado** (200) — e `--probe` reconfirma |
| `PORTAL` | **confirmado** — descobre os recursos reais |
| `FOTOS_ZIP_URL` | **confirmado** (200) — única fonte de foto que existe |
| `COLUNAS_EXIGIDAS` | valida o header; aborta listando o diff |
| `CARGOS_TSE` | `CD_CARGO` fora da tabela aborta a execução |
| `SITUACOES` | situação fora da tabela aborta a execução |

Essas travas não são decorativas: foi `SITUACOES` que derrubou a primeira
importação com `"#NE" (39784x)` e obrigou a olhar o dado real, em vez de gerar
uma base afirmando que 20 mil candidaturas estavam aptas.

### Rodar o importador

```bash
node scripts/update-data.mjs --probe                  # o que existe no portal
node scripts/update-data.mjs --fetch --ano=2026       # baixa e importa
node scripts/update-data.mjs --fetch --url=<URL>      # URL descoberta no probe
node scripts/update-data.mjs --from-local <dir|zip>   # arquivos já baixados
node scripts/update-data.mjs --from-local <dir> --dry-run   # valida sem escrever
node scripts/update-data.mjs --fetch --fotos=locais   # +113 MB de fotos oficiais
node scripts/update-data.mjs --fetch --fotos=nenhuma  # remove as fotos da base
```

Aceita diretório, `.zip` ou `.csv`. Sem `--fotos`, mantém o que já existe. Sem dependências npm; para `.zip` usa o
`unzip` do sistema.

### GitHub Action

`.github/workflows/update-data.yml` roda `--fetch` manualmente
(`workflow_dispatch`) e diariamente. O download funcionou daqui, então
provavelmente funciona nos runners; se o Akamai bloquear o IP do runner, a Action
falha de forma visível — e o caminho alternativo é rodar o importador localmente
e commitar `data/`.

## 59.10. Seletor de estado

O `<select>` nativo foi trocado por um seletor próprio: no cabeçalho fica apenas
**bandeira + sigla**; tocar abre um diálogo com **bandeira, nome por extenso e
sigla** das 27 UFs, com o estado atual destacado.

O botão é dividido em duas metades exatas — bandeira à esquerda, sigla centrada
à direita — e tem a **mesma altura do botão de compartilhar**, que virou
quadrado arredondado para os dois formarem um par. Nenhum contorno: usa o
material dos cards (preenchimento claro, raio pequeno da mesma família, sombra
suave). Um pill arredondadíssimo com traço preto grosso destoava dos cards e,
sendo contorno, contrariava o §31; a versão atual parece clicável sem brigar com
os números, que devem ser o elemento mais alto da tela (§56).

Isso tensiona o §2.1 ("evitar modais desnecessários"). O julgamento aqui é que um
seletor de 27 itens com bandeira não é um modal desnecessário: é o próprio
controle, e sem ele o cabeçalho carregaria uma lista impossível de estilizar.
Nada mais no produto usa modal.

### Como é feito

Usa o elemento nativo `<dialog>` com `showModal()`, que já dá de graça
aprisionamento de foco, `Esc` para fechar, backdrop e devolução do foco ao
gatilho. Em cima disso: setas ↑↓ percorrem a lista, `Home`/`End` vão aos
extremos, e digitar uma letra salta para o primeiro estado com aquela inicial.
Clique fora fecha. No celular é folha inferior; a partir de 700 px, cartão
centrado.

A lista só é construída **na primeira abertura**: são 27 bandeiras (163 KB) que
não têm por que entrar no primeiro carregamento (§35). O `<img>` do cabeçalho
carrega apenas a bandeira da UF corrente.

### Bandeiras

`scripts/update-flags.mjs` baixa as 27 bandeiras do Wikimedia Commons
rasterizadas pequenas (`Special:FilePath/<arquivo>?width=160`, devolve PNG de
1-19 KB). As bandeiras estaduais são símbolos oficiais, de domínio público no
Brasil; a procedência de cada arquivo fica em `assets/flags/CREDITOS.md`.

Mesma postura do importador do TSE: cada UF tem uma lista de nomes candidatos no
Commons (`Bandeira do X`, `Bandeira de X`, `Bandeira do estado de X`…), o script
usa o primeiro que responder 200 com imagem e **aborta listando as UFs que não
resolveram**, em vez de deixar bandeira faltando em silêncio.

```bash
npm run update-flags
```

### Duas armadilhas do `<dialog>` que os testes pegaram

Ambas viram teste de regressão, porque não são óbvias em revisão de código:

- **`display` do diálogo fechado.** O navegador aplica `display: none` a
  `dialog:not([open])`, mas estilo de autor vence estilo do agente: o
  `display: flex` do layout deixava a folha desenhada no rodapé, cobrindo o card
  do presidente. Precisa de `.uf-dialog:not([open]) { display: none }` explícito.
- **`max-width` herdado.** O navegador aplica `max-width: calc(100% - 38px)` a
  `dialog` — sobra do `padding: 1em` e da borda padrão, que zeramos. Sem
  `max-width: 100%`, a folha ficava 38 px estreita e encostada num lado.

## 59.11. Cabeçalho e rodapé

```text
santinho.art                    [🇧🇷│SP]  [⤴ Compartilhar]
nada impresso: nem voto, nem santinho

        …seis cards…

    ┌──────────────────┐ ┌──────────────────┐   ← abas encostadas na base,
    │ 📍 trocar estado │ │🔍 buscar por nome│     arredondadas só em cima
```

Tocar numa aba puxa a ficha para cima, e a aba sobe com ela (ver 59.12).

O layout virou três faixas (`grid-template-rows: auto 1fr auto`): identidade em
cima, cards no meio, **controles no rodapé** — zona do polegar, que é onde eles
são usados. Compartilhar ficou no cabeçalho, com rótulo, porque é a ação de
saída, não de edição.

A **placa de estado** (bandeira + sigla em duas metades exatas) fica no
cabeçalho, ao lado do compartilhar, e também puxa a ficha: se alguém tentar
trocar de estado clicando ali, funciona. O botão do rodapé ficou só com o rótulo
`trocar estado`. Não existe mais selo de ano — a placa ocupa aquele lugar.

### O subtítulo passa por baixo dos controles

O subtítulo é `grid-column: 1 / -1` de propósito: colocado na coluna 1, ele
herdaria a largura sobrada pela coluna dos controles (~144px) e quebraria em duas
linhas em qualquer tela.

Sendo de largura cheia, ele corre por baixo da placa e do compartilhar — e por um
tempo **encavalava** neles: uma margem negativa o trazia para dentro daquela
faixa. A correção não foi mexer no subtítulo, e sim **encurtar os controles do
cabeçalho** (`--btn-topo: calc(var(--btn) * .84)`), que passaram a terminar antes
dele. As abas do rodapé continuam em `--btn` cheio, por serem o alvo de toque
principal.

Com isso o subtítulo tem 6-7px de respiro dos botões (medido; ele tinha ficado
colado quando os controles encurtaram) e 12-13px do título — distância aceita
como consequência de ele estar embaixo dos botões, não do lado deles.

E como ele não disputa espaço com nada, **não precisa mais sumir por largura**:
fica visível até 280px. Só a marca cede lugar, e apenas abaixo de 310px, onde a
primeira faixa realmente não cabe. A escada por *altura* do §32 continua.

### O ".art" recua

`santinho` fica em tinta cheia; `.art` num cinza discreto (`--ink-soft`), porque
é irrelevante para quem usa. Mantém 4,4:1 contra o fundo — acima do 3:1 exigido
para texto grande, e a suíte mede essa razão.

Dentro do cabeçalho, título e controles começam na **mesma linha**
(`align-items: start`). Antes era `end`, e o título descia até a base dos
controles, deixando uma faixa branca em cima dele. O subtítulo fica em faixa de
largura cheia logo abaixo: tentei colocá-lo na coluna da marca, junto ao título,
mas ali a coluna é estreita e a frase quebrava em duas linhas.

Isso criou um segundo problema: os controles (30-38px) são mais altos que o texto
do título (20-27px), então a primeira faixa **sobra abaixo do título** e o
subtítulo era empurrado 12-15px para baixo, longe demais. A sobra é proporcional
a `--btn` — as duas medidas escalam por `vw` —, então é recuperada com margem
negativa:

```css
.tagline { margin-top: calc(3px - var(--btn) * 0.24); }
```

Coeficiente empírico, e é justamente por isso que a suíte **mede a distância
resultante** em todas as larguras do §50 e exige entre 2 e 8px: hoje dá 3,9 a
5,7px. O título também subiu de `clamp(19px, 5.6vw, 26px)` para
`clamp(20.5px, 6.1vw, 27px)`, aproveitando a folga horizontal e reduzindo a
sobra na origem.

O ano saiu do subtítulo `ELEIÇÕES 2026` e virou **selo** ao lado do
compartilhar, com a mesma altura e o mesmo raio dos botões, mas sem sombra: não é
clicável e não deve se anunciar como controle.

### A folha é uma ficha puxada pela aba

Os dois controles do rodapé são **abas**: arredondadas só em cima, encostadas na
borda de baixo, sombra projetada para cima. Tocar puxa a ficha, e **a aba sobe
junto com ela**, terminando no topo da folha — é a aba que carrega o cartão, como
numa ficha de arquivo.

```text
fechado                          aberto
──────────────────────────       ──────────────────────────
                                 ┌────────┐┌────────┐  ← abas no topo da ficha
   …cards…                       │ SP     ││ buscar │
                                 ├────────┴┴────────┤
┌────────┐┌────────┐             │                  │
│ SP     ││ buscar │  ← abas     │   conteúdo       │
└────────┘└────────┘             └──────────────────┘
```

A continuidade é medida, não estimada: a animação parte de
`translateY(calc(100% - var(--btn)))`, posição em que a fileira de abas fica
**no pixel exato** dos botões do rodapé (809px numa tela de 844), e sobe 640px
até o repouso. A suíte lê o primeiro e o último quadro com a animação pausada
(`getAnimations()`, `currentTime`), então o teste é determinístico em vez de
depender de amostragem.

As abas dentro da folha são **clonadas dos botões originais**
(`cloneNode(true)`, ids removidos): mesma estrutura, mesma geometria, mesmo
`--btn`. A suíte confere `x` e `width` de cada aba contra o botão correspondente.

Duas decisões dentro disso:

- **A aba da folha aberta deixa de ser um botão.** Ela é a aba da ficha, não um
  controle: viraria um botão cujo rótulo visível diz "trocar estado" mas cuja
  ação é fechar, o que quebra o WCAG 2.5.3. É convertida em `<span>` inerte
  (`aria-hidden`), e fechar continua no ✕, no `Esc` e no clique fora.
- **A outra aba troca de folha sem descer e subir.** A ficha fica parada; só o
  conteúdo e a aba fundida mudam. A folha fechada não guarda fileira órfã: ela é
  removida no evento `close`.
- **A aba mostra que continua para dentro.** Toda aba tem uma **sombra interna
  na base** (`inset 0 -8px 10px -7px`) — com a folha fechada e com a folha aberta
  na aba inativa. Só a aba ativa perde tudo e se funde ao corpo da ficha. A
  primeira tentativa foi uma linha dura de 2px na base da aba inativa; ficou
  ruim, a sombra interna resolve melhor e vale nos dois estados.

### No desktop também sai do rodapé

Havia um resto de desenho antigo: acima de 700px o diálogo era **centrado na
tela**, o que fazia sentido para um modal comum, mas não para uma ficha puxada
por uma aba — as abas ficavam soltas no meio, desconectadas dos botões de onde
saíram (visível no Brave desktop). Agora a ficha é bottom-sheet em qualquer
largura; no desktop só a largura acompanha a coluna dos cards (620px, centrada) e
a altura mantém o teto absoluto de 620px, senão 80dvh viraria um cartão gigante.

A suíte verifica em 1280×800 e 1680×1050: colada na base, centrada em x, no
máximo 80% da tela, aba alinhada ao pixel com o botão do rodapé e bordas de cima
arredondadas.

Um detalhe que me atrasou: havia **dois blocos `@media (min-width: 700px)`
separados** no arquivo, e minha primeira substituição assumiu que eram contíguos
— não casou, e a medição mostrou o diálogo ainda com 440px e a 90px da base.

### Animação de puxar e devolver

Abrir anima `translateY(calc(100% - var(--btn))) → 0`. Fechar é o lado difícil:
`<dialog>` sai da top layer no instante em que `close()` é chamado, sem dar tempo
de animar. Então `fecharComAnimacao()` adiciona `.is-fechando`, espera o
`animationend` (com `setTimeout` de segurança) e só então fecha. O `Esc` tem o
`cancel` cancelado com `preventDefault()` para passar pelo mesmo caminho.

Duas armadilhas que custaram medição:

- **Especificidade.** Durante o fechamento o diálogo **ainda é `[open]`**, e a
  regra de subida `[open]:not(.sem-animacao)` vencia a de descida — a folha
  simplesmente não descia (a medição quadro a quadro dava `169, 169, 169…`).
  Precisa do `:not(.is-fechando)` explícito.
- **`requestAnimationFrame` é cedo demais.** A troca de aba desliga a animação
  com `.sem-animacao`, e eu removia a classe no quadro seguinte — antes de a
  animação começar, então ela rodava de novo e a folha descia e subia. A classe
  agora sai no evento `close`.

`prefers-reduced-motion: reduce` fecha na hora, sem animação — e a suíte verifica
isso emulando a media feature.

### Rótulo dentro do botão, não ao lado

Os dois controles do rodapé seguem o mesmo padrão — **ícone + rótulo**:
`📍 trocar estado` e `🔍 buscar por nome`. Os ícones são SVG inline
(equivalentes ao `MapPin` e ao `MagnifyingGlass` do Phosphor), do mesmo tamanho e
sempre antes do rótulo; a suíte confere a paridade. O rótulo fica **dentro** do `<button>` — texto ao lado não
seria clicável e frustraria quem tocasse nele. No seletor de estado, as duas
metades exatas (bandeira à esquerda, sigla centrada à direita) passaram para uma
placa interna, então a geometria pedida sobrevive e o rótulo vem depois dela.

Os três rótulos visíveis estão **contidos** nos nomes acessíveis
(`Estado: SP - São Paulo. Trocar estado`, `Buscar por nome do candidato`,
`Compartilhar minha cola eleitoral`), como pede o WCAG 2.5.3 — senão comando de
voz pelo texto visível não funciona. A suíte verifica essa continência.

### O que a suíte trava aqui

O cabeçalho e o rodapé ficaram apertados, então em **todas** as larguras do §50 a
suíte confere: selo `2026` à esquerda do compartilhar e dentro do cabeçalho;
selo, estado, busca e compartilhar com a mesma altura; estado e busca abaixo dos
cards e dentro da tela; a marca cabendo sem encavalar no selo; e a marca
continuando exatamente `santinho.art` — porque, quando o ano ainda morava dentro
do `<h1>`, o `gap` do flex passou a separar cada nó de texto do `<span>` do
ponto, e a marca virou `santinho . art`.

### Aviso removido

`registros ainda não julgados pelo TSE` saiu por decisão de produto. A ressalva
continua no dado (`meta.situacaoPublicada`) e documentada em 59.4 — só não
aparece mais na interface. Os outros avisos seguem de pé: `carregando dados…`,
`dados de exemplo - base não oficial` e a falha de validação do §44.

## 59.12. Busca de candidato por nome

Um segundo diálogo, no mesmo estilo do seletor de estado, com campo de busca no
topo. Achar o candidato pelo nome e deixar o app preencher o número resolve o
problema real de quem não decorou 5 dígitos.

### Onde fica

Um botão de lupa no cabeçalho, ao lado do compartilhar. Um único ponto de
entrada, e a busca cobre **todos os cargos de uma vez** — a UF corrente mais a
base nacional. O resultado sabe a que cargo pertence, então escolher preenche o
card certo sozinho; não é preciso saber em qual card tocar antes.

Cada linha traz foto, nome, selo do partido na cor da legenda, cargo e número.

### Neutralidade (§46) — e uma inversão de leitura

A primeira versão abria com lista vazia e ordenava por semelhança de nome, por
medo de "virar vitrine". A leitura mudou, e a nova é melhor: **lista alfabética
completa é mais neutra que ranking**. Ranking por semelhança é uma ordem que o
produto escolhe; A-Z é uma ordem que ninguém escolhe. Todos entram, ninguém é
destacado, e o critério é objetivo — nome, com número do candidato como segundo
critério.

O que o §46 proíbe continua valendo: nada de popularidade, cargo, partido,
ideologia ou sugestão de combinação. E candidatura não exibível pelo §13 fica
fora da lista também.

O diálogo abre, então, com a **base inteira da UF corrente mais a nacional** —
2.583 candidatos em SP — e o campo filtra.

### Scroll infinito

Montar 2.583 linhas de uma vez é desperdício, então a lista pagina de **50 em
50**, com uma sentinela de 1px no fim observada por `IntersectionObserver`
(`root` na própria lista, `rootMargin` de 240px para carregar antes de o usuário
bater no fim). A sentinela se remove quando acaba.

A ordenação acontece **uma vez**, na construção do índice, então filtrar não
reordena nada: montar a lista completa custa 2,7 ms.

### A ficha de estado tem o mesmo campo

O diálogo de estado ganhou campo de busca no topo, igual ao de candidato, e as
duas fichas têm as bordas de cima arredondadas.

O filtro de estado usa **prefixo de palavra**, não substring: com 27 itens,
substring fazia `ri` trazer Distrito Federal (dist-**ri**-to) e Espírito Santo
(e-**s**pí-**ri**-to). Cada termo digitado precisa iniciar alguma palavra do nome
ou a sigla — `ri` → os três Rios, `rio grande` → RN e RS, `grande sul` → RS,
`sp` → SP e não ES.

O campo **não rouba o foco na abertura**: quem abre a ficha recebe o foco no
estado atual, com a lista já rolada até ele. São 27 itens; abrir o teclado virtual
por padrão custaria mais do que ajuda. Na busca de candidato é o contrário — lá
são 2.583 nomes e digitar é o caminho normal, então o campo recebe o foco.

### O texto de contagem saiu

`2.583 candidatos em SP · A-Z` não dizia nada que a lista não mostrasse. As
mensagens de estado continuam: `carregando dados…`,
`nenhum candidato encontrado em SP` e, na ficha de estado,
`nenhum estado encontrado`.

### Como o "nome aproximado" funciona

Sem biblioteca (§36), ~60 linhas em `app.js`. Normaliza acento e caixa, quebra a
consulta em termos e exige que **todos** casem — mas cada um pode casar de
quatro formas, com pontuação decrescente:

```text
100  o nome inteiro começa com o termo
 70  alguma palavra começa com o termo
 40  o termo está dentro de uma palavra
 20  distância de edição ≤ 1 (termo de 4-6 letras) ou ≤ 2 (7+)
```

Nome mais curto desempata. Duas decisões que só apareceram testando com dados
reais:

- **Distância de edição por palavra, não pelo nome inteiro.** A primeira versão
  usava subsequência sobre o nome completo, e `haddad` casava com
  `RICHARDSON DA PADARIA`; `lula` trazia 32 resultados. Comparar termo contra
  palavra derrubou o ruído sem perder `russomano` → `RUSSOMANNO` e
  `gonsalves` → `GONÇALVES`.
- **Conectivos não são exigidos.** `jose da silva` tem de achar
  `JOSE SILVA LIMA DO TRANSPORTE`, que não tem a palavra "da". Termos de 4 letras
  ou menos também não aceitam erro de digitação — seria ruído.

Custo medido em SP (2.583 candidatos, o maior estado): **0,03 a 1,3 ms por
tecla**. Índice construído sob demanda e invalidado quando a UF ou o estado de
carga das bases muda.

Nota sobre o filtro com a ordem alfabética: o escore de semelhança decide **o
que** casa, não a posição. Buscar `lula` lista os 7 casamentos em A-Z, então
`DR CÉLIO, LULA DO BEM` aparece antes de `LULA`. É previsível e neutro; se
preferir o casamento mais forte primeiro, basta reordenar `achados` por escore em
`buscarCandidatos()`.

### Duas vagas de senador (§21)

A primeira versão preenchia a primeira vaga livre e, com as duas ocupadas,
sempre atropelava a `s1` — então buscar um terceiro senador sobrescrevia
justamente quem tinha acabado de ser escolhido. A regra agora tem quatro níveis,
nesta ordem:

1. **a vaga que já tem esse mesmo número** — escolher alguém que já está na cola
   é idempotente, não ocupa a outra vaga nem duplica;
2. **a vaga vazia**;
3. **a vaga sem candidato válido** (número incompleto ou inexistente) — perder
   isso não custa nada;
4. entre duas válidas, **a mexida há mais tempo**.

O "há mais tempo" usa um contador monotônico (`state.mexidoEm`), não relógio:
determinístico e fácil de testar. Editar dígitos à mão também conta como mexer,
então a vez passa para a outra vaga. Hidratar pela URL marca os cargos na ordem
em que aparecem, de modo que a primeira substituição começa pela `s1`.

### Um achado dos dados reais

Oito nomes em SP aparecem em **mais de um cargo**, com `SQ_CANDIDATO` diferentes
— `GUTO SCHIAVETTO` está como deputado federal 1444 e como senador 144. Como o
TSE não publicou o julgamento dos registros (59.4), não há como saber qual vale;
a busca mostra os dois, com o cargo em cada linha, porque esconder um seria o
produto decidindo qual é o verdadeiro.

### Detalhe de implementação

O campo é `type="text"`, não `type="search"`: com `search`, o navegador faz o
`Escape` limpar o campo em vez de fechar o diálogo, e o botão nativo de limpar já
estava oculto no CSS. O `Escape` também é tratado explicitamente, para o
comportamento ser o mesmo em qualquer navegador.

A folha puxa de baixo, igual à do estado. O campo fica no topo dela, então
continua visível com o teclado virtual aberto. Clique fora do conteúdo fecha —
no backdrop de um `<dialog>`, o alvo do clique é o próprio elemento, e isso
estava implementado só no diálogo de estado.

**As duas folhas têm altura fixa de 80% da tela** (`height: 80dvh`), mesmo sem
conteúdo suficiente para preencher: folha que muda de tamanho conforme o
resultado dá a sensação de instabilidade. No desktop vale o teto absoluto de
620px, senão 80dvh viraria um cartão gigante.

## 59.13. Compartilhamento: link, cola em texto e imagem

Um toque em `Compartilhar` entrega as três coisas de uma vez, quando a
plataforma deixa.

### A cola em texto

Toda pontuação exibida usa **hífen simples**, nunca travessão: `-` no lugar de
`—`. Vale para a interface (rótulos, avisos, dígito vazio), a cola compartilhada
e as meta tags. Os comentários do código seguem com travessão, que é prosa e não
texto de tela.

```text
Minha cola eleitoral 2026 - SP

Dep. federal · 1000
Dep. estadual · 50
1º senador · 111
2º senador · 999
Governador · 13
Presidente · 13

https://santinho.art/?uf=sp&df=1000&de=50&s1=111&s2=999&g=13&p=13
```

**Só cargo e número.** As duas primeiras versões traziam nome, partido e o
motivo de cada estado ("voto de legenda", "número não encontrado"), com tudo em
caixa alta e sem linha em branco — ficava pesada de ler. Nome, partido e foto
vão na imagem, que segue junto no compartilhamento; repetir em texto era
redundante. O cargo ficou em caixa normal, com uma linha em branco entre os
votos, e o título traz só a sigla da UF.

Linha em branco em dois lugares apenas: entre o título e os votos, e antes do
link. Com só cargo e número por linha, branco entre cada voto deixava a cola
longa sem ganhar clareza. O link entra no texto apenas no caminho do clipboard —
no `navigator.share` ele vai no campo `url`.

Cargo vazio não entra. Legenda e número inexistente são ditos com palavras, em
vez de sumirem. Não há alinhamento por espaços: a fonte de aplicativo de mensagem
é proporcional e o alinhamento não sobreviveria — separador dá conta.

### A imagem do santinho

Gerada em `<canvas>`, **sem biblioteca**: o layout do card é reescrito em 2D
(`gerarImagem()` em `app.js`). Não usei `html2canvas` porque seria dependência
externa (§36) e, por CDN, conteúdo de terceiro no site (§38). Tudo é do mesmo
domínio, então o canvas não fica *tainted* e o `toBlob` funciona.

Saída: 1080px de largura, altura conforme os seis cards, **JPEG q0.92**. A escolha
do formato foi medida, não chutada:

| Formato | Peso |
|---|---|
| PNG | 505 KB |
| **JPEG q0.92** | **209 KB** |
| WebP q0.92 | ~40 KB, mas alguns alvos de compartilhamento ainda tropeçam |

As fotos são o volume da imagem e são conteúdo fotográfico — comprimem muito
melhor em JPEG, e todo alvo aceita JPEG.

### A imagem é preparada antes do clique

O `navigator.share()` precisa ser chamado **dentro do gesto do usuário**; o Safari
recusa se houver `await` demais antes. Gerar a imagem carrega até seis fotos e
codifica um JPEG, então ela é montada em segundo plano (`requestIdleCallback`,
700ms depois da última edição) e guardada num cache com a assinatura do estado.
No clique, se o cache corresponde ao estado atual, o arquivo vai junto; se não,
compartilha texto e link e deixa a imagem pronta para a próxima. A suíte cobre
exatamente esse caso: editar um número e compartilhar em seguida vai sem imagem,
e depois de 1,6s a imagem volta sozinha.

### Escada de recursos

| Situação | O que acontece |
|---|---|
| `canShare({files})` | imagem + texto + link numa folha nativa |
| só `navigator.share` | texto + link |
| sem nada (desktop) | copia a cola inteira e **baixa** a imagem |
| usuário cancela | nada; não cai para o clipboard |

## 59.14. Publicação no GitHub Pages

Nada de build: *Settings → Pages → Deploy from a branch → `main` / root*.
Existe `.nojekyll` para o Jekyll não interferir. Todos os caminhos são
**relativos** (`data/…`, não `/data/…`), então o site funciona igual em
`usuario.github.io/santinho.art/` e no domínio próprio. Para o domínio, adicione
um arquivo `CNAME` com `santinho.art` e aponte o DNS.

## 59.15. Verificação

`tests/interacao.mjs` — **644 asserções passando**, cobrindo os §48/§50 e mais.
A suíte sobe o servidor estático, acha o Chrome e dirige um navegador de verdade.
Ela serve `tests/fixtures/data` (base fictícia fixa), **não** `data/`: atualizar
a base real do TSE não pode quebrar teste.

```bash
npm install        # puppeteer-core, só para os testes
npm test
CHROME_PATH=/caminho/para/chrome npm test   # se o Chrome não estiver nos lugares usuais
```

O que ela verifica:

- zero scroll vertical e zero overflow horizontal em 320×640, 360×800, 375×667,
  390×844, 412×915 e 430×932, com os 6 cards presentes e nada truncado;
- digitação, substituição, backspace (com valor e em campo vazio), delete, setas,
  colagem de número completo e parcial, toque em dígito e na área do card;
- legenda, inválido, candidatura inapta, separador pontilhado só nos
  proporcionais, senadores independentes, presidente na base nacional;
- URL bidirecional, `history` que não cresce ao digitar, buraco de dígito
  sobrevivendo ao recarregamento, troca de UF preservando números;
- falha de dados: interface segue utilizável, números preservados, aviso
  discreto, compartilhamento funcionando;
- compartilhamento: conteúdo da cola em texto (título, cargo e número, linha em
  branco só entre título e votos, cargo vazio fora, sem nome nem partido),
  linha em branco antes do link no clipboard, imagem indo como JPEG de tamanho
  plausível,
  link junto, cancelamento não caindo para o clipboard, desktop copiando e
  baixando, e o cache da imagem invalidando ao editar e voltando sozinho;
- carregamento lento: aviso discreto, interface não bloqueada, digitação
  liberada antes de a base chegar e resolução assim que ela chega;
- nomes de urna longos: inteiros, em até duas linhas, sem corte vertical nem
  horizontal, fonte nunca abaixo de 11px, em 320/360/390/430px de largura;
- sigla de partido longa (`SOLIDARIEDADE-DEMO`): selo inteiro e cargo preservado;
- foto: placeholder `?` escondido quando há foto, visível quando não há, e foto
  quebrada voltando ao placeholder;
- cor do partido: cor oficial quando conhecida, hash quando não, e razão de
  contraste WCAG medida (≥ 4,5:1) para selo e número, em cor escura e clara;
- dígitos: casinha visível em repouso, dígitos separados (não é bloco único), e
  largura/posição/gap idênticos antes e depois de focar;
- geometria das duas folhas: largura cheia, encostadas na base, altura de
  exatamente 80% da tela, e clique fora fechando ambas;
- a ficha puxada pela aba: a aba partindo do pixel exato do botão do rodapé,
  subindo 640px, ficando no topo da folha e colada no corpo, e descendo até o
  mesmo pixel ao fechar (lido com a animação pausada); troca de aba sem mover a
  ficha e sem nenhuma animação; aba ativa inerte; sem fileira órfã; e
  `prefers-reduced-motion` fechando sem esperar animação;
- filtro de estado: prefixo de palavra (não substring), sem acento, por sigla,
  com vários termos, seta descendo do campo para a lista, Enter escolhendo o
  primeiro, aviso de "nenhum estado" e o campo não roubando o foco na abertura;
- bordas de cima arredondadas nas duas fichas e ausência do texto de contagem;
- lista de candidatos: abre completa, em ordem alfabética, com 50 linhas no DOM;
  rolar acrescenta 50 por vez até carregar todos e remover a sentinela; o filtro
  preserva a ordem;
- rótulos dos botões e continência no nome acessível (WCAG 2.5.3);
- cabeçalho: título na mesma linha dos controles; subtítulo em uma linha, com
  respiro de 4 a 12px dos botões e **sem sobrepor** placa ou compartilhar;
  controles do topo mais baixos que as abas do rodapé; e o `.art` mais claro que
  o resto da marca, ainda acima de 3:1 de contraste;
- placa de estado: no cabeçalho antes do compartilhar, nomeando o estado no
  rótulo acessível com a sigla visível contida nele (WCAG 2.5.3), e puxando a
  mesma ficha que o botão do rodapé;
- abas: a ativa sem sombra alguma, a inativa e as fechadas com sombra interna na
  base;
- busca por nome: lista vazia sem consulta e com uma letra só, acerto por nome,
  sobrenome do meio, erro de digitação e conectivo ignorado, candidatura inapta
  fora dos resultados, cobertura da base nacional, escolha preenchendo o card e a
  URL, teclado (setas, Enter, Esc) e índice acompanhando a troca de UF;
- escolha da vaga de senador: vaga vazia, vaga inválida, alternância entre as
  duas válidas pela mexida mais antiga, idempotência ao reescolher quem já está
  na cola, e edição manual passando a vez para a outra vaga;
- seletor de estado: diálogo fechado ao abrir a página e sem as 27 bandeiras
  carregadas, abertura marcando o estado atual e levando o foco a ele, bandeira
  e nome corretos por opção, setas/`Home`/letra/`Esc`, foco voltando ao gatilho,
  folha ocupando a largura da tela e encostada na base, rolagem contida na lista,
  e a escolha atualizando sigla, bandeira, URL e os cargos estaduais;
- integração ponta a ponta com uma base **gerada pelo importador** (não o mock),
  validando acentuação e o filtro de candidatura inapta.

O importador tem verificação própria, com fixtures no formato do TSE (latin-1,
separador `;`, campos entre aspas): schema válido gera a base com acentuação
correta e situação normalizada; coluna ausente, `CD_CARGO` novo e situação nova
abortam com mensagem específica e código de saída 1.

Falta o que só o dispositivo real prova (§49): Chrome e Brave no Android com
Gboard — em especial backspace em campo vazio e ausência de zoom ao focar — e
Safari no iPhone.

### Dois furos na própria suíte

Ambos apareceram só porque eu olhei os screenshots, não porque um teste falhou:

1. **Asserção que lia `undefined`.** Ao reescrever o bloco de medição do
   cabeçalho, minha substituição engoliu a propriedade `semTruncar`. A asserção
   passou a receber `undefined`, virou `false` e falhou em todas as larguras — o
   susto foi útil, mas se tivesse engolido uma propriedade cujo valor esperado
   fosse falso, teria passado silenciosamente.
2. **Asserção que passava vazia.**

   A asserção "subtítulo em uma linha" passava sem medir nada: as fixtures têm
   `fonte: MOCK`, o que faz o cabeçalho exibir `dados de exemplo - base não
   oficial`, e a regra `body.has-status .tagline { display: none }` esconde o
   subtítulo. A verificação caía no ramo `!subVisivel` e dava verde mesmo com a
   frase quebrando em duas linhas no site real. Agora a suíte remove
   `has-status` antes de medir.

### Verificado com a base real

Além da suíte, conferido à mão contra os dados do TSE: nomes e siglas reais nos
seis cargos, voto de legenda por número de partido real, troca de UF revalidando
cargos estaduais (`df=2777` → `RODRIGO MORAES` em SP, `EMILIO PAULO` em MG),
presidente vindo da base nacional, número inexistente caindo em `INVÁLIDO`, os
quatro nomes mais longos da base (30 caracteres) renderizando inteiros em
320×640 e 390×844, e as fotos oficiais carregando nos seis cards sem nenhuma
requisição falhando.

## 59.16. Pendências conscientes

- **`og:image`**: `og.png` (1200×630) está no repositório; a fonte é
  `scripts/og.html`, que se captura em 1200×630 com qualquer headless para
  regerar. As URLs em `index.html` são **absolutas** (`https://santinho.art/og.png`)
  porque scrapers de Open Graph não resolvem caminho relativo — publicando em
  outro domínio, ajuste `og:image`, `twitter:image` e `og:url`.
- **PWA** (§40): não implementado, conforme o próprio §40.
- **`dup: 1`** não é sinalizado na tela: 124 números têm dois candidatos
  registrados. Decisão consciente de deixar como está — são 0,6% da base e a
  tendência é resolver quando o TSE julgar os registros. Ver 59.4.
- **Peso do repositório**: ~113 MB de fotos. Ver 59.7.
- **Cores de partido** são curadoria manual sobre a base do Wikidata; ao trocar
  de eleição vale reconferir sigla por sigla. Ver 59.6.
- **Situação da candidatura**: quando o TSE publicar o julgamento, remover `N` de
  `SITUACOES_EXIBIVEIS` em `app.js`. Ver 59.4.
