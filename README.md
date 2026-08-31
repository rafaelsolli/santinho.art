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
            br.json                  # presidente (base nacional)
            uf/AC.json … uf/TO.json  # uma base por UF, carregada sob demanda
scripts/    update-data.mjs          # importador do TSE (só no build)
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

## 59.6. Cores e neutralidade

A cor de cada card vem de **hash da sigla do partido** sobre uma paleta fixa de
10 cores (`PALETA` em `app.js`). Não é a cor real de nenhum partido — é
exatamente isso que sustenta a neutralidade do §46: nenhuma legenda ganha
identidade visual própria no produto.

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

## 59.10. Publicação no GitHub Pages

Nada de build: *Settings → Pages → Deploy from a branch → `main` / root*.
Existe `.nojekyll` para o Jekyll não interferir. Todos os caminhos são
**relativos** (`data/…`, não `/data/…`), então o site funciona igual em
`usuario.github.io/santinho.art/` e no domínio próprio. Para o domínio, adicione
um arquivo `CNAME` com `santinho.art` e aponte o DNS.

## 59.11. Verificação

`tests/interacao.mjs` — **233 asserções passando**, cobrindo os §48/§50 e mais.
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
- carregamento lento: aviso discreto, interface não bloqueada, digitação
  liberada antes de a base chegar e resolução assim que ela chega;
- nomes de urna longos: inteiros, em até duas linhas, sem corte vertical nem
  horizontal, fonte nunca abaixo de 11px, em 320/360/390/430px de largura;
- sigla de partido longa (`SOLIDARIEDADE-DEMO`): selo inteiro e cargo preservado;
- foto: placeholder `?` escondido quando há foto, visível quando não há, e foto
  quebrada voltando ao placeholder;
- integração ponta a ponta com uma base **gerada pelo importador** (não o mock),
  validando acentuação e o filtro de candidatura inapta.

O importador tem verificação própria, com fixtures no formato do TSE (latin-1,
separador `;`, campos entre aspas): schema válido gera a base com acentuação
correta e situação normalizada; coluna ausente, `CD_CARGO` novo e situação nova
abortam com mensagem específica e código de saída 1.

Falta o que só o dispositivo real prova (§49): Chrome e Brave no Android com
Gboard — em especial backspace em campo vazio e ausência de zoom ao focar — e
Safari no iPhone.

### Verificado com a base real

Além da suíte, conferido à mão contra os dados do TSE: nomes e siglas reais nos
seis cargos, voto de legenda por número de partido real, troca de UF revalidando
cargos estaduais (`df=2777` → `RODRIGO MORAES` em SP, `EMILIO PAULO` em MG),
presidente vindo da base nacional, número inexistente caindo em `INVÁLIDO`, os
quatro nomes mais longos da base (30 caracteres) renderizando inteiros em
320×640 e 390×844, e as fotos oficiais carregando nos seis cards sem nenhuma
requisição falhando.

## 59.12. Pendências conscientes

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
- **Situação da candidatura**: quando o TSE publicar o julgamento, remover `N` de
  `SITUACOES_EXIBIVEIS` em `app.js`. Ver 59.4.
