# Parecer de Marketing: Fio de Amor Semijoias

> Especialista: marketing para marcas de semijoias no Instagram (foto de produto, naming, copy, identidade visual).
> Base: logo em `public/marca/`, estilo de foto atual da loja, padrão de nome do UP Vendas, pedido X260926017 (72 linhas, fornecedor fornecedor de Guangzhou).
> Configuração que o app lê: `src/config/marca.json`. Nomes do pedido: `amostras/pedido-X260926017/nomes-sugeridos.json`.
> O Instagram @fiodeamorsemijoias não pôde ser acessado desta máquina; revisar este parecer com o perfil real aberto.

## 1. Leitura da identidade visual

- **Logo:** lettering script pesado e inclinado ("fiodeamor"), com um coração no lugar do pingo do "i" e um swash longo que termina em laço. Abaixo, "SEMI JÓIAS" em sans geométrica fina e espaçada. Uma única cor, rosé/malva **#CEA6B6**, sobre branco.
- **O que ele comunica:** afeto, feminilidade e um toque artesanal ("escrito à mão"). O swash em laço e o coração já trazem o conceito do nome: **um fio que une**. Isso precisa virar linguagem em tudo, não só no logo.
- **Posicionamento recomendado:** *semijoia afetiva para presentear e se presentear*. Preço acessível, acabamento de joia e tom de amiga, não de vitrine de luxo distante.
- **Assinatura visual proposta:** um **fio/fita fina de cetim rosé** em toda foto e arte (enrolado na peça, saindo da caixa, atravessando o card). Custa pouco, cria reconhecimento no feed sem depender do logo e conversa com o nome.
- **Ponto de atenção:** o logo escreve "JÓIAS" com acento (grafia antiga; o correto hoje é "JOIAS"). Não precisa mudar o logo agora, mas nos textos e cadastros usar **SEMIJOIA/SEMIJOIAS**, sem acento.

### Paleta (derivada do logo, testada para contraste)

| Token | Hex | Uso |
|---|---|---|
| primaria | `#CEA6B6` | Logo, faixas, selos, fios decorativos. **Não** usar em texto pequeno (contraste 2,1:1 com branco). |
| primaria_escura | `#8E5B6F` | Texto de destaque, preço, botões (≥ 4,5:1 sobre fundo, creme e rosé claro). |
| primaria_clara | `#F4E7EC` | Fundo de faixas e cards; casa com o veludo rosé das fotos. |
| creme | `#F6EFE6` | Fundo de foto e catálogo; aquece o dourado. |
| dourado | `#B8925A` | Só fios de 1–2 px, molduras e ícones (contraste 2,8:1, não serve para texto). |
| texto | `#4A353D` | Texto corrido (ameixa escura, mais suave que preto). |
| fundo | `#FFFBF8` | Fundo geral do app e das artes. |

### Tipografia (Google Fonts)

- **Título:** Cormorant Garamond (serifada de alto contraste, cara de joalheria). Preço e nomes de coleção.
- **Script:** Satisfy (pincel inclinado e encorpado, a mais próxima do lettering do logo no Google Fonts). Só para o nome comercial da peça ou coleção, até 4 palavras. **Nunca recriar o logo com ela.**
- **Texto:** Jost 300 em MAIÚSCULAS com tracking de 0,18em, que ecoa o "SEMI JÓIAS". Jost 400–500 para corpo e CTA.

## 2. Guia de fotografia de produto

O estilo atual (peça sobre porta-joias de veludo rosé, fundo creme, luz suave) **está certo e deve virar padrão**. O que falta é consistência.

**Montagem com celular (custo baixo):**
1. Luz de janela lateral difusa (cortina voil ou papel vegetal) ou 2 softboxes de 5500 K. Rebatedor branco (isopor) do lado oposto. Nunca usar o flash.
2. Celular no tripé, lente 2x (teleobjetiva) para não distorcer, foco e exposição travados na peça, exposição entre −0,3 e −0,7 para não estourar o dourado.
3. Fundos: cartolina ou linho **creme**, veludo **rosé**, mármore claro. Evitar branco estourado e o cinza dos cenários do fornecedor.
4. Limpar a peça com flanela e manusear com luva de algodão (digital aparece muito no dourado polido).

**Kit mínimo por produto (4 fotos e 1 vídeo):**
1. **Capa:** peça no veludo rosé ou no creme, com o fio de cetim (template `feed_produto`).
2. **Fundo branco limpo:** para vitrine, UP Vendas, WhatsApp e marketplace (`vitrine_loja`).
3. **Macro de detalhe:** textura, cravação, esmalte.
4. **Em uso e escala:** na orelha, colo, mão ou pulso (real ou IA, ver seção 6). É o que mais tira dúvida de tamanho no direct.
5. **Vídeo de 5 a 8 s** girando a peça na luz, para Reels e Stories.

**Por tipo:**
- Brincos: o par lado a lado, um de frente e outro levemente de perfil (mostra a tarraxa e o volume). Argolas em pé.
- Pingentes: sempre numa corrente fina (busto de veludo ou colo). Avisar se a corrente **não** acompanha.
- Braceletes: em pé ou num apoio cilíndrico. Para Reels, empilhados no pulso.
- Anéis: em cone ou fenda de veludo e na mão.
- Conjuntos: flat lay em "U" (colar por fora, pulseira dentro, brincos no centro), mais uma foto de uso.

**Edição:** um único preset para todas (temperatura levemente quente, sem saturar o amarelo). Conferir a cor do esmalte comparando com a peça na mão. Exportar em sRGB.

**Grade do perfil:** desde 2025 o Instagram mostra a grade em 3:4. Postar em 4:5 (1080x1350) com o essencial nos 1012 px centrais. Alternar produto, uso/lifestyle e vídeo para o feed não virar catálogo.

## 3. Regras de naming

Três camadas, cada uma com uma função:

| Camada | Onde | Exemplo |
|---|---|---|
| Nome de cadastro | UP Vendas, etiqueta, busca | `BRINCO (SJ) FLOR ESMALTADA BRANCA COM ZIRCÔNIA` |
| Nome comercial | Instagram, arte, WhatsApp | *Brinco Flor de Jasmim* |
| Legenda curta | Post/Story | "Uma flor branca com uma pétala de brilho: delicada como jasmim, marcante como você." |

**Cadastro (`TIPO (SIGLA) DESCRITORES`, máx. 60 caracteres):**
- Ordem: [KIT/QTDE] + FORMA/MOTIVO + ACABAMENTO + PEDRA + COR + MEDIDA.
- O banho dourado é padrão e vai na grade ("SEMIJOIA BANHADA A OURO..."). Só entra no nome **RÓDIO** ou **BICOLOR**.
- Kits de brincos: `BRINCO (SJ) KIT 3 PARES ...`. Conjuntos: `CONJUNTO (SJ) COLAR PULSEIRA E BRINCO ...`.
- `ASSIMÉTRICO` quando o fornecedor indica 分左右. Medidas coladas: `7MM`, `43CM`, `24X43MM`.
- Sem adjetivos subjetivos (LINDO, LUXO) e sem marcas de terceiros. Atenção ao cadastro atual **"BRINCO (SJ) INFANTIL BARBIE EM RESINA"**: "Barbie" é marca registrada da Mattel. Se a peça não for licenciada, prefira `BRINCO (SJ) INFANTIL BONECA ROSA EM RESINA`.
- O vocabulário controlado e o glossário chinês ficam em `marca.json` (`padrao_nome.vocabulario` e `glossario_fornecedor`), alinhados com `taxonomia.json`.

**Nome comercial:** tipo + imagem afetiva, de 2 a 5 palavras ("Brinco Leque Plissê", "Bracelete Confeito"). Reservar "Fio de Amor" para as peças-assinatura (corações, nós, fios entrelaçados).

## 4. Estratégia de lançamento do pedido X260926017

**Momento:** estamos em meados de novembro de 2026. A janela comercial é **Black Friday (27/11) → Natal → Réveillon**, mais formaturas e casamentos de fim de ano. O pedido é forte em brilho (zircônia, conjuntos) e em presentes de ticket médio. Lançar **antes** da Black Friday, construindo desejo e lista VIP, e usar a BF para converter. Não queimar os destaques com desconto: na BF, dar brinde (fita, caixa, cartão) ou frete, e reservar desconto para kits de entrada.

**Preços:** seguir `src/config/precificacao.json` e mostrar o preço em todas as artes.

### 4.1 As 11 peças destaque

| # | Código | Nome comercial | Por quê |
|---|---|---|---|
| 2 | KY1195B | Brinco Flor de Pérola | Romântico, pérola, perfil noiva/madrinha; muito salvável. |
| 14 | SH5140A | Brinco Flor de Jasmim | Flor branca esmaltada com uma pétala cravejada; a mais fotogênica do pedido. |
| 17 | LH470A | Brinco Leque Plissê | Statement de tendência; para em qualquer rolagem. |
| 23 | WD4895A | Brinco Onda Dourada | "Gold chunky", rende Reels de "1 brinco, 3 looks". |
| 36 | SH5122A rosa | Brinco Concha Rosé | Na cor da marca; puxa as versões off-white e turquesa. |
| 49 | SS1088A | Pingente Nossa Senhora Raios de Luz | Fé + acabamento luxuoso de baguetes; presente de Natal, mães e madrinhas. |
| 54 | CL1114A | Pingente Borboleta Perolada | Símbolo querido, ticket baixo, público amplo. |
| 57 | DGYH3018D | Bracelete Confeito | Esmalte colorido, tendência e vídeo ótimo. |
| 58 | CX554A | Bracelete Parafuso de Luz | Estética clássica de joalheria (destaque do fornecedor). Divulgar **sem** citar a marca que inspira. |
| 67 | YM157A | Conjunto Riviera Celebração | Maior ticket; âncora de Réveillon, noivas e formatura. |
| 69 | YL576A | Conjunto Flor de Luz | Presente completo (3 peças) pronto para o Natal. |

**Peça-manifesto (não é destaque de venda, é de marca):** #11 YF287B, *Brinco Nó Fio de Amor*. É o nome da loja em forma de joia: usar no post de história da marca e na bio.

### 4.2 Coleções temáticas (todas as 72 linhas)

| Coleção | Conceito | Linhas |
|---|---|---|
| **Pétalas** | Florais e folhagens, esmaltados e com pérola | 2, 10, 13, 14, 20, 31, 41, 46 |
| **Aquarela** | Esmaltes em rosa, off-white, turquesa e perolado; formas orgânicas e mosaico | 24, 25, 34, 35, 36, 39, 43, 45 |
| **Ouro Escultural** | Dourado com volume e textura: martelado, plissado, espiral, ondas | 1, 12, 15, 16, 17, 18, 23, 28 |
| **Assinatura Fio de Amor** | Corações, nós e fios entrelaçados: a história da marca | 7, 8, 11, 19, 33, 44 |
| **Pontos de Luz** | Delicadas com zircônia e pérola para o dia a dia | 21, 22, 26, 27, 29, 30, 32, 40, 42 |
| **Trio de Afeto** | Kits de 3 pares para composição de vários furos e presente | 3, 4, 5, 6, 9, 47 |
| **Amuletos** | Pingentes de fé e símbolos (Nossa Senhora, concha, borboleta, gota, pérola) | 48, 49, 50, 51, 52, 53, 54 |
| **Bombonière** | Braceletes esmaltados em chocolate, creme, nude, pérola e confeito | 55, 56, 57, 64, 65 |
| **Empilhados** | Braceletes dourados e cravejados, mais anel, para montar o mix | 37, 58, 59, 60, 61, 62, 63, 66 |
| **Celebração** | Conjuntos de festa: Réveillon, noivas, formaturas | 38, 67, 68, 69, 70, 71, 72 |

Lançar em ondas: semana 1 com Pétalas, Ouro Escultural, Empilhados e Celebração (teaser); semana 2 com Amuletos e Trio de Afeto (presentes de Natal); semana 3 com Aquarela e Bombonière (verão). Cada coleção vira um **Destaque fixo** nos Stories e um carrossel `catalogo_colecao`.

### 4.3 Conferir na chegada (antes de fotografar e cadastrar)

- **#12 HT881A:** foto prateada com especificação MR (provavelmente "cor padrão do catálogo"). Se vier prateado, acrescentar `RÓDIO` ao nome.
- **#32 SH4842A e #59 HS177A ("se" = bicolor?):** confirmar o acabamento. Os nomes já trazem `BICOLOR`.
- **#68 XM1998T:** foto prateada com pedido 14K (tom dourado claro). **#72 XM2027C:** pedido 白金 (ródio) com foto dourada. Ajustar nome e foto conforme a peça real.
- **#5 MR336A:** sem especificação de banho no pedido.
- **#34–36 SH5122A:** a foto do fornecedor mostra as 3 cores juntas. Fotografar cada cor separadamente.
- **#48, #49, #53:** confirmar a figura e a invocação de Nossa Senhora antes de publicar o nome definitivo.
- **Pingentes (48–54):** informar "corrente vendida separadamente" ou montar o kit pingente + corrente (ótimo para presente).
- **14K / 14KF:** indicam tom de cor, não teor de ouro. Nunca anunciar "ouro 14k".

## 5. Calendário da primeira semana (sugestão: 16 a 22/11/2026)

Horários de partida: **12h** e **19h30–21h**. Depois de 2 semanas, ajustar pelo Insights.

| Dia | Feed / Reels | Stories | Peças |
|---|---|---|---|
| Seg 16 | **Reels "Chegou novidade"**: mãos abrindo a caixa, peças surgindo no veludo rosé (tirar das cartelas antes de filmar) | Enquete: "Qual coleção primeiro? Pétalas × Celebração" | 2, 17, 57, 67 |
| Ter 17 | **Carrossel Coleção Pétalas** (capa + 4 peças + slide de preços e CTA) | Bastidor da sessão de fotos; caixinha "qual sua favorita?" | 2, 14, 41, 20 |
| Qua 18 | **Reels "1 brinco, 3 looks"** (trabalho, casual, noite) | Quiz: "plissado ou ondas?" | 17, 23 |
| Qui 19 | **Post `feed_lancamento`**: Bracelete Parafuso de Luz + carrossel "Monte seu mix" | Vídeo empilhando braceletes no pulso; link para o WhatsApp | 58, 60, 61, 63, 66 |
| Sex 20 | **Carrossel "Presentes de Natal até R$ X"** (faixas de preço) | Abrir a **lista VIP da Black Friday** (Close Friends) | 49, 54, 7, 47, 69 |
| Sáb 21 | **Reels "Brilho de Réveillon"** (cenário festas_fim_de_ano) | Prova no espelho (cliente real ou equipe), contagem regressiva da BF | 67, 69, 70, 21, 40 |
| Dom 22 | **Post de marca: "Por que Fio de Amor?"** com a peça-manifesto e a coleção Assinatura | Repost de clientes; lembrete "BF dia 27, a lista VIP compra antes" | 11, 33, 44, 8 |

Durante a semana, enviar a mesma arte em versão **sem preço** (`catalogo_whatsapp`) para as revendedoras das maletas, com legenda pronta para colar.

**Legenda modelo (ritmo da marca):**
> Brinco flor esmaltado com pérola: a nossa Flor de Pérola chegou. 🤍
> Três pétalas peroladas, contorno de zircônias e uma pérola de 7 mm no centro. Banhada a ouro.
> Para noivas, madrinhas e para quem ama o clássico com um toque romântico.
> R$ 00,00 · Chama no direct ou toque no link da bio.
> #fiodeamorsemijoias #semijoias #brincos #perolas #joiasparanoivas

Usar no máximo **5 hashtags** (limite atual do Instagram). A primeira linha da legenda e o texto alternativo da imagem, com as palavras-chave da peça, pesam mais na busca.

## 6. Fotos do fornecedor, direitos de imagem e IA

**Nunca publicar a foto do fornecedor como está.**
- A cartela **"Delicate"** é marca de terceiro, e as etiquetas e **QR codes** levam ao fornecedor. Isso confunde a cliente, entrega o seu fornecedor à concorrência e é um risco de marca. Remover sempre (no app: recorte/inpainting; o prompt base já pede).
- As fotos do fornecedor têm direito autoral (Lei 9.610/98). Use-as como **referência interna** e para gerar a imagem com IA. Para publicar a original, mesmo editada, peça autorização por escrito (WeChat/e-mail). O ideal é ter **foto própria** de toda peça destaque.
- Modelos reais (clientes, revendedoras, equipe) assinam um termo simples de autorização de uso de imagem.

**Imagens geradas por IA (modelo usando a peça):**
- **Fidelidade acima de tudo:** pelo Código de Defesa do Consumidor, a oferta vincula e a publicidade não pode induzir a erro (arts. 30, 31 e 37). A peça gerada tem que ser **idêntica** à real em forma, número de pedras, cor do esmalte, banho e tamanho. Conferir cada imagem com a peça na mão antes de aprovar e descartar qualquer uma com detalhe inventado.
- **Transparência:** em toda imagem fotorrealista feita com IA, ativar o rótulo de IA do Instagram e escrever na legenda ou na arte: *"Imagem ilustrativa criada com IA a partir da foto real da peça."* (`prompts_ia_foto.aviso_publicacao`).
- Todo carrossel com IA leva **pelo menos uma foto real** da peça (macro ou fundo limpo).
- Não gerar rosto inteiro identificável nem semelhança com pessoa real ou celebridade. Os prompts cortam o rosto na altura dos olhos e variam o tom de pele (`{skin_tone}`) para representar as clientes brasileiras.
- Não usar IA para "melhorar" a peça (mais brilho, mais pedras, dourado mais intenso). Isso gera devolução e reclamação.

**Outras promessas a evitar:** "não escurece", "antialérgico", "ouro 18k / 10 milésimos" sem laudo; "estilo Cartier/Tiffany/Vivara". Informar a garantia real da loja e os cuidados de conservação.

## 7. Como medir

- **Por post:** salvamentos e compartilhamentos (desejo), conversas no direct e cliques no link (intenção), vendas da peça em 7 dias.
- **Por coleção:** sell-through em 30 dias e giro nas maletas. A coleção que girar define a recompra e o próximo pedido.
- **Teste A/B simples:** a mesma peça com foto real × foto IA em uso, e com preço × sem preço na arte. Comparar o alcance e as conversas no direct.
