# Especificação do Sistema Finanças

## Objetivo

Aplicação pessoal para controlar fatura de cartão, receitas reais, cobranças de terceiros, empréstimos/Pix, dívidas próprias e análise de gastos.

O sistema não é um app de score financeiro genérico. O foco é responder perguntas práticas:

- Quanto entrou de receita no período?
- Quanto saiu na fatura?
- Quanto ainda falta pagar?
- Quanto terceiros me devem?
- Quanto eu devo em dívidas próprias?
- Quais categorias e locais concentram os gastos?
- O que mudou entre meses?

## Regra central

O sistema tem dois mundos separados:

- **Análise**: dashboard somente leitura.
- **Gestão**: módulos para cadastrar, editar, corrigir, dividir e quitar.

O dashboard nunca deve alterar dados globais.

## Stack

- React
- TypeScript
- Vite
- Tailwind CSS
- Recharts
- date-fns
- Papaparse
- Capacitor Android

## Entidades principais

### Transaction

Representa lançamentos importados da fatura/cartão.

Campos importantes:

- `id`
- `date`
- `description`
- `amount`
- `categoryId`
- `type`
- `source`
- `sourceFile`
- `installment`
- `responsibleMemberId`
- `debtId`
- `note`
- `normalizedMerchant`

Regras:

- Pix via cartão é transação de fatura.
- Compra parcelada deve ser distribuída conforme o mês de fatura correto.
- Crédito/pagamento não deve virar despesa.
- Duplicados devem ser evitados por chave composta.

### MonthlyIncome

Representa receita real cadastrada pelo usuário.

Campos:

- `id`
- `month`
- `amount`
- `description`
- `isRecurring`
- `source`

Regras:

- Receita nunca é gerada automaticamente.
- O usuário pode cadastrar várias entradas no mesmo mês.
- O dashboard deve somar todas as entradas do mês.
- Ajustes históricos só podem existir por ação explícita do usuário.

### PaidInvoiceMonths

Lista de meses de fatura marcados como quitados.

Regras:

- Não é receita.
- Não altera `monthlyIncomes`.
- Serve apenas para status da fatura.
- A ação de quitar fatura fica no módulo **Receitas**, não no dashboard.

### Receivable

Representa valores que terceiros devem ao titular.

Origens:

- `responsavel`
- `divisao`
- `emprestimo_pix`

Regras:

- Cobranças de cartão aparecem em **Divisões e cobranças**.
- Pix/dinheiro emprestado fora do cartão aparece em **Empréstimos e Pix**.
- Receivable não é dívida própria.
- Titular não deve gerar cobrança contra si mesmo.

### Debt

Representa dívidas próprias ou registros manuais a pagar/a receber.

Campos:

- `id`
- `type`: `a_pagar` ou `a_receber`
- `origin`: `manual`, `cartao`, `emprestimo`, `financiamento`, `outros`
- `counterparty`
- `totalAmount`
- `paidAmount`
- `monthlyPayment`
- `interestRate`
- `startDate`
- `linkedTransactionIds`
- `currentInstallment`
- `totalInstallments`
- `note`

Regras:

- Dívida própria fica em **Dívidas**.
- Empréstimo/Pix fora do cartão deve gerar cobrança operacional, não duplicar saldo em dívida própria.
- Simulação de quitação deve usar saldo real com pagamentos vinculados.

### Member

Pessoa usada em divisões, cobranças e empréstimos.

Campos:

- `id`
- `name`
- `nickname`
- `contact`
- `isOwner`

Regras:

- O titular é dono do cartão.
- O titular não aparece como pessoa a cobrar.
- Membros não titulares podem ser selecionados para pagar/dividir compras.

### Alias

Alias é de estabelecimento, não de membro.

Exemplo:

- Original: `MP BARRESTAURAN OSASCO BRA`
- Alias: `EMPORIO ALMEIDA`

Regras:

- Ajuda a juntar maquininhas diferentes do mesmo local.
- Deve ser editável pelo usuário.
- Deve afetar visualizações e agrupamentos.
- Vale para o local normalizado (todas as variações de maquininha/cidade), não para o texto exato; um apelido novo substitui o anterior do mesmo local.
- Criar ou remover um apelido recategoriza só as compras daquele local (escolhas manuais ficam).
- Gerenciado em Categorias e regras → Apelidos de locais: renomear, voltar ao nome do extrato ou transformar em observação de compras escolhidas.

### Observação da compra

Para identificar uma compra específica ("celular", "lanternagem do carro") usa-se a observação, não o apelido.

- Numa compra parcelada, vale para todas as parcelas dela (mesmo local, data de compra, número de parcelas e valor ±R$ 1).
- Parcelas que chegam nas próximas faturas herdam a observação.
- Aparece na busca da fatura e nas parcelas futuras (Metas → compromissos).
- O lápis da linha abre "Identificar compra", com observação e apelido lado a lado e o alcance de cada um.

### CategoryRule

Regra personalizada de categorização.

Exemplo:

- Palavra-chave: `EMPORIO ALMEIDA`
- Categoria: `Bebida Alcoólica`

Regras:

- Aplica agora e em futuras importações.
- Usuário precisa conseguir listar, editar e excluir regras.

## Módulos

### Painel

Somente leitura. Pode ter links para outras telas, nunca botões que alterem dados.

Deve mostrar:

- Destaque da fatura do mês: valor, status (quitada / coberta pela receita / em aberto), variação vs. fatura anterior, maior compra
- Cobertura: receita x compromissos (fatura + parcelas de dívidas próprias da fatura da vez)
- Receita, saldo, total a receber de terceiros, compromissos dos próximos 3 meses
- Para onde foi o dinheiro (categorias do mês)
- Pede atenção: fatura em aberto, metas no limite, categorias incertas, possíveis duplicatas, cobranças com mais de 30 dias, dívida cuja parcela não cobre os juros, fatura acima da média
- Evolução das faturas (12 meses, com média)
- Locais que mais pesaram, quem te deve, metas do mês

Não pode ter:

- Botão para marcar fatura quitada
- Botão para editar compra
- Cadastro de receita
- Cadastro de dívida
- Score financeiro 0-100

### Análises

Somente leitura, em abas:

- Categorias e locais: treemap, top 3 no tempo, comparação com outro mês, rankings
- Fluxo mensal: receita x fatura, composição do saldo (cascata), saldo acumulado, sazonalidade
- Comportamento: calendário de gastos alinhado aos dias da semana, gasto por dia, ticket por categoria, volatilidade, recorrências, compras fora do padrão
- Pessoas e dívidas: quem deve pra quem, divisões por categoria
- Análise com IA: leitura da fatura pela IA (Claude ou Antigravity) a partir de um resumo agregado; o resultado é o mesmo do card "Dicas da IA" do Painel

### Receitas

Objetivo: registrar dinheiro real recebido.

Funcionalidades:

- Adicionar, editar e excluir receita (inclusive as antigas sem id)
- Somar múltiplas entradas no mesmo mês
- Copiar receitas recorrentes do último mês que tiver alguma
- Marcar fatura como quitada e reabrir
- Igualar receita do mês à fatura (com confirmação)
- Em lote, só para faturas já vencidas (o mês corrente entra depois do dia do vencimento do cartão): quitar e igualar

Regras:

- Igualar receita histórica é ajuste consciente; nunca acontece sozinho.
- Quitar fatura não cria receita.
- Os valores de fatura usam a mesma base canônica do Painel.

### Fatura (transações)

Objetivo: organizar faturas importadas.

Funcionalidades:

- Linha do tempo das faturas (como no app do banco): valor a pagar, status, vencimento, pago antecipado, "paga em", melhor dia de compra e aviso de CSV incompleto
- Dados do cartão (por aparelho): dia do vencimento, dias entre fechamento e vencimento (Inter: 8), limite — usado para status, datas e limite disponível
- Pagamentos e estornos do ciclo listados à parte

- Filtros rápidos: a revisar, manuais, parceladas, divididas, possíveis duplicatas; filtro por categoria
- Busca (entende valores no formato "11,90")
- Categoria inline; ao trocar, oferece aplicar a todas as compras do local e criar a regra
- Selo explicando a origem da categoria (regra, automática, manual, revisar)
- Observação inline (grava ao sair do campo; numa parcelada, vale para todas as parcelas)
- "Identificar compra" (observação × apelido do local) e divisão por linha
- Lançamento manual de despesa, com parcelamento e mês da fatura; exclusão de lançamentos manuais

### Pessoas e cobranças

Objetivo: tudo que terceiros devem ao titular e o cadastro de pessoas (antes eram três telas: Membros, Divisões e cobranças, Empréstimos e Pix).

Funcionalidades:

- Card por pessoa com pendências, total e dias desde a mais antiga
- Receber item, receber tudo, receber uma parte (abate das mais antigas)
- Cobrar pelo WhatsApp com mensagem pronta (usa o contato da pessoa) ou copiar a mensagem
- Registrar valor a receber (dinheiro/Pix fora do cartão), inclusive criando a pessoa
- Histórico de recebidos com opção de reabrir
- Cadastro, edição e exclusão de pessoas, com saldo por pessoa

Regras:

- Dividir compra: o titular pode entrar como participante para a conta das partes, mas nunca vira cobrança.
- Divisão pode ser em partes iguais ou com valores por pessoa.
- Renomear uma pessoa atualiza as dívidas ligadas a ela pelo nome.
- Só existe um titular.
- Ao excluir um registro, o valor sai de todos os totais e não volta por migração.

### Contas fixas

Objetivo: contas pagas fora do cartão (boleto, Pix, débito) que pesam todo mês.

Tipos:

- Valor fixo: o mesmo valor todo mês (ex.: internet).
- Valor muda todo mês: o valor é lançado em cada mês (ex.: moradia); até lá o saldo usa o último valor lançado ou a estimativa cadastrada, e o Painel avisa para lançar.
- Parcelada: valor fixo por N meses. O cadastro pede "parcelas já pagas" e o mês da próxima; o app calcula a parcela 1, mostra "parcela X/N", quanto falta e o último mês.

Regras:

- Meses de calendário (`FixedExpense`, fatia `finance_fixed_expenses_v1`).
- `trackedFrom`: antes desse mês a conta não entra em nenhum total (o histórico anterior não foi registrado). Nas parceladas as parcelas anteriores contam como pagas.
- Entram nos compromissos e no saldo do Painel e de Receitas, nos próximos compromissos (Painel e Metas) e no resumo da IA.
- Painel: o card da fatura continua só com o cartão; "Gasto total do mês" soma cartão + contas fixas + parcelas de dívidas. "Para onde foi o dinheiro", a evolução e as Análises (categorias e fluxo mensal) têm a escolha "Tudo / Só cartão" (`finance_spending_scope_v1`, compartilhada entre as telas); em "Tudo" cada conta entra na categoria dela e o saldo do fluxo mensal desconta as contas fixas.
- Pago/a pagar é por mês; o Painel avisa conta do mês corrente vencendo em até 5 dias ou vencida.

### Dívidas

Objetivo: controlar dívidas próprias.

Funcionalidades:

- Cards com saldo real, % pago, parcelas, juros e alerta quando a parcela não cobre os juros
- Pagar parcela, quitar, editar, excluir
- Plano de quitação de todas as dívidas juntas, com aporte extra e estratégia avalanche (maior juros) ou bola de neve (menor saldo): prazo, juros totais, economia e ordem de quitação

Regras:

- Saldo sempre via `getDebtBalance` (desconta pagamentos vinculados na fatura).
- Valores a receber ficam em Pessoas e cobranças.

### Metas e planejamento

- Teto mensal por categoria, com progresso, valor livre/excedente e média dos 3 meses anteriores
- Sugestões de meta para categorias sem teto (média arredondada)
- Compromissos dos próximos 12 meses: parcelas do cartão e parcelas de dívidas

### Categorias e regras

- Categorias: criar, editar nome/cor/palavras-chave, excluir (lançamentos são recategorizados; regras e metas da categoria saem junto). "Outros" não pode ser excluída.
- Regras: palavra-chave + categoria + forma de comparação, com contagem de lançamentos que cada uma pega e origem (manual/IA).
- Testar uma descrição: mostra nome, cidade e maquininha extraídos e qual regra decidiu.
- Reclassificar: prévia agrupada por estabelecimento do que mudaria com as regras atuais; aplica só o que for marcado.
- Assistente IA: ver "Modo IA".

### Importação e backup

- Upload manual com revisão, detecção do mês da fatura pelo nome do arquivo (ou escolha manual) e contagem de novos x já importados
- Faturas locais em `public/faturas` (automático ao abrir) e "Corrigir faturas locais"
- Exportar e restaurar backup JSON (com resumo e confirmação)
- Telegram
- Zona de perigo: apagar tudo, retomar importação automática

Regras:

- CSV substituído não deve duplicar dados antigos.
- Parcelas devem cair no mês correto da fatura.
- Juros de Pix crédito devem ser lidos quando estiverem no arquivo.

## Extrato da fatura

- O CSV traz valores negativos: "PAGAMENTO ON LINE" (pagamento ao banco) e estornos. Eles viram transações `type: 'income'` com `creditKind` e não contam como despesa.
- Valor da fatura = compras − estornos. A pagar = valor − pagamento antecipado.
- Pagamentos lançados no ciclo de uma fatura até o vencimento da anterior quitam a anterior; depois do vencimento, primeiro completam o que faltou dela e o resto é antecipado da atual. Cada mês só olha os vizinhos (erros antigos não se propagam).
- Status automático: paga (pagamento no ciclo seguinte), parcial, aberta, sem pagamento no extrato. "Marcar como quitada" continua existindo como ajuste manual.
- Linhas idênticas no mesmo arquivo são compras distintas (`occurrence`), não duplicatas.
- Arquivo de `public/faturas` é identificado por hash do conteúdo: CSV substituído é reimportado sozinho, removendo as linhas da versão antiga.
- Parcelas futuras são projetadas a partir da última parcela vista (ex.: 2/12 gera 3/12...12/12).

## Motor de categorização

A descrição da fatura é quebrada em maquininha, nome e cidade antes de comparar:

- Layout do Inter (22 caracteres de nome + 13 de cidade + país): a cidade é separada com precisão.
- Prefixos de maquininha (PAG*, PG, TON, MP*, MERCADOPAGO, ZP, PINBANK, SUMUP...) são removidos.

Ordem de decisão (a primeira que casar vence; dentro de cada nível, a palavra mais longa):

1. Escolha manual do usuário (`manualCategory`) — nunca é sobrescrita por regras
2. Regras personalizadas (`categoryRules`)
3. Palavras-chave que o usuário colocou nas categorias
4. Dicionário embutido de estabelecimentos brasileiros + palavras padrão
5. Categoria que o banco mandou no CSV (`rawCategory`) — baixa confiança
6. Outros — baixa confiança

Comparação automática: palavras de até 4 letras só casam como palavra inteira ("cea" não casa com "merCEAria", "bar" não casa com "BARueri"); expressões e palavras médias precisam começar no início de uma palavra; palavras longas casam em qualquer trecho. Regras podem forçar "palavra inteira", "começa com" ou "contém (inclui cidade)".

Sem regra e sem a categoria do banco, o motor não rebaixa uma categoria existente para Outros.

Cada lançamento guarda `categorySource`; fontes 5 e 6 formam a fila "a revisar".

## Modo IA (CLIs locais)

- Dois provedores, ambos com a assinatura logada na máquina (sem chave de API), numa pasta temporária própria e com o conteúdo pelo stdin:
  - Claude Code: `claude -p`, sem ferramentas (`--disallowedTools`).
  - Antigravity: `agy -p` no modo stream-json (o modo texto só lê o prompt da linha de comando, que no Windows corta em 8 mil caracteres) e com `--sandbox`.
- Preferência por aparelho (`finance_ai_settings_v1`): provedor, modelo e onde roda (este computador ou servidor do Telegram). Preferência antiga sem provedor vira Claude.
- Rotas `/api/ai/status` (os dois provedores e os modelos do `agy models`), `/api/ai/categorize`, `/api/ai/insights`: no `npm run dev` pelo próprio Vite; também no servidor do Telegram (protegidas pelo token) quando ele roda num PC com o CLI.
- Categorização: envia nomes de estabelecimentos (e a categoria do banco como pista), em lotes de 40 (25 nos modelos "high" e no Opus); o usuário revisa e cada sugestão aceita vira regra (`origin: 'ia'`), podendo criar categorias novas.
- Dicas/análise: `buildFinanceSummary` monta só agregados (fatura e histórico, categorias do mês e por mês, principais locais, recorrências, parcelas futuras por mês, metas, dívidas, total a receber), nunca compras individuais. O último resultado fica salvo (`finance_ai_insights_v1`) e aparece no Painel e em Análises.

## Telegram com IA

- O app manda o mesmo resumo agregado no snapshot (`financeSummary`).
- Mensagem que as regras fixas não entendem vai para a IA (`BOT_AI`: auto, gemini, off ou uma ordem de preferência com modelo, como `claude:opus,antigravity`; cada CLI disponível é tentado na ordem quando o anterior falha, e sem nenhum o bot cai para a API do Gemini só na interpretação). Uma chamada só classifica a intenção e, se for pergunta, já responde com os números do resumo.
- `dicas` (ou o botão depois de importar uma fatura) gera as dicas com o modelo padrão do provedor.
- Fatura no chat: CSV/OFX até 2 MB vira o evento `importar_fatura`. O app escolhe o mês pela legenda ("11/2026", "novembro"), pelo nome do arquivo (se não for uma data completa) ou pela compra à vista mais recente e o fechamento do cartão; grava como `fatura-inter-AAAA-MM`, reconcilia com `RESYNC_TRANSACTIONS` (mandar de novo não duplica; a versão fechada substitui a parcial) e soma a assinatura do conteúdo sem apagar as antigas, para uma versão anterior em `public/faturas` não ser reimportada por cima.

## Regras de cálculo

### Mês da fatura

O mês contábil usado nos dashboards é o mês da fatura/vencimento, não necessariamente a data real da compra.

Exemplo:

- Compra feita em abril.
- Fatura vence em maio.
- Despesa entra em maio.
- A tabela pode mostrar que a compra foi em abril.

### Receita vs fatura quitada

São coisas diferentes:

- Receita: dinheiro que entrou.
- Fatura quitada: status operacional.

Nunca misturar `monthlyIncomes` com `paidInvoiceMonths`.

### Heatmap diário

O heatmap usa o dia real da transação filtrada, não o calendário do mês da fatura.

Isso evita perder compras em dias 29, 30 e 31 quando a fatura é de um mês menor.

### Projeção mensal

Não usar projeção linear por dias decorridos.

Como a fatura é importada de uma vez, dividir por dias usados cria valores absurdos.

Para meses fechados:

- Valor real é definitivo.

Para mês corrente:

- Só projetar se houver lógica confiável e fatura aberta.

### Insights

Média mensal deve ignorar meses sem despesa real.

### Dívidas

Saldo de dívida deve usar:

```ts
getDebtBalance(debt, transactions)
```

Isso desconta:

- valor pago manualmente
- pagamentos vinculados por transação

## UI/UX

### Tema

Dark mode obrigatório.

Cores base:

- Fundo: `#0f172a`
- Card: `#1e293b`
- Texto principal: `#f1f5f9`
- Texto secundário: `#94a3b8`

### Gráficos

Regras:

- Tooltip sempre escuro.
- Texto sempre claro.
- Nenhum tooltip branco.
- Sem highlight branco/cinza em hover.
- Eixos legíveis.
- Treemap com paleta suave.

### Mobile

Regras:

- Não pode existir scroll horizontal da página inteira.
- Tabelas podem virar cards.
- Gráficos grandes podem ter área própria rolável, sem quebrar layout.
- Botões precisam ter área mínima confortável de toque.

### Texto

Toda string visível deve estar em pt-BR.

Não pode haver:

- Texto em inglês visível.
- Acento quebrado.
- Nomenclatura técnica confusa para usuário final.

## Verificação antes de subir

Rodar:

```bash
npm run lint
npm run build
```

Checklist manual:

- Dashboard não altera dados.
- Receitas somam múltiplas entradas.
- Quitar fatura não cria receita.
- Divisão reabre mantendo seleção.
- Excluir empréstimo/Pix remove dos totais.
- Dívidas não duplicam cobrança operacional.
- Heatmap mostra dias reais.
- Tooltips dos gráficos estão escuros.

