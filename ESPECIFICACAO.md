# Controle Financeiro Pessoal — Especificação Completa

## Objetivo

Sistema de controle financeiro pessoal focado em **visualização clara de receitas, despesas de cartão e dívidas**. Não é app de score, não é coach financeiro. É painel de controle real.

---

## Diagnóstico do Estado Atual

### O que está correto ✅

| Área | Status |
|---|---|
| Agrupamento por mês da fatura via `sourceFile` | Funciona bem |
| Deduplificação de transações por chave composta | Sólido |
| Parser CSV/OFX com categorização automática | OK |
| Sistema de aliases de estabelecimento | OK |
| Regras de categoria com persistência | OK |
| Modal de divisão de compra com seleção por clique | OK |
| Separação receita vs fatura quitada (`paidInvoiceMonths`) | Conceito correto |
| Projeção de parcelas futuras em meses corretos | OK |

### Problemas Críticos Identificados 🔴

#### 1. Projeção Mensal Absurda
- **Arquivo**: `src/utils/analytics.ts` — `getMonthProjection` (L165-L176)
- **Problema**: Divide gasto total pelos dias decorridos e projeta linearmente. Como a fatura inteira entra de uma vez, no dia 5 o sistema projeta R$ 18.600 para um gasto real de R$ 3.000.
- **Correção**: Remover projeção linear. Para faturas fechadas, o valor é final. Projeção só faz sentido para mês corrente com fatura aberta.

#### 2. Heatmap Perde Dias
- **Arquivo**: `src/utils/analytics.ts` — `getDailyHeatmap` (L83-L99)
- **Problema**: Gera array com dias do mês da fatura, mas as compras têm datas do mês anterior. Dias 29-31 somem quando o mês da fatura tem menos dias.
- **Correção**: Gerar o heatmap baseado nos dias reais das transações, não no calendário do mês selecionado.

#### 3. Cobranças Não Abatecem do Gasto Pessoal
- **Arquivo**: `src/utils/analytics.ts` — `getMonthlySummaries` (L30-L45)
- **Problema**: Conta 100% do valor como despesa do usuário, mesmo quando parte (ou tudo) será paga por terceiros via divisão/responsável.
- **Correção**: Calcular `despesaPessoal = totalFatura - totalCobrançasPendentes` para refletir o gasto real do usuário.

#### 4. Simulação de Dívida Ignora Pagamentos Vinculados
- **Arquivo**: `src/utils/analytics.ts` — `getDebtPayoffRows` (L255-L266)
- **Problema**: Usa `debt.totalAmount - debt.paidAmount` mas ignora `linkedTransactionIds` (pagamentos feitos via fatura).
- **Correção**: Usar `getDebtBalance()` que já desconta `linkedPaid`.

#### 5. Insights com Média Distorcida
- **Arquivo**: `src/utils/analytics.ts` — `getInsights` (L268-L285)
- **Problema**: Calcula média incluindo meses sem dados/futuros, puxando a média para baixo e gerando alertas falsos.
- **Correção**: Filtrar apenas meses com transações reais.

#### 6. Score Financeiro Não Solicitado
- **Arquivo**: `src/components/blocks/Block1Overview.tsx` (L23)
- **Problema**: KPI "Nota financeira" com score 0-100 que não agrega valor ao objetivo do sistema.
- **Correção**: Remover. Substituir por KPI útil (ex: total de cobranças pendentes, parcelas futuras restantes).

#### 7. Dashboard Tem Botão de Ação
- **Arquivo**: `src/components/blocks/Block1Overview.tsx` (L53)
- **Problema**: Botão "Marcar fatura quitada" no dashboard viola a regra de somente-leitura.
- **Correção**: Mover para o módulo de Receitas ou topbar.

---

## Arquitetura de Dados

### Entidades

```
Transaction
├── id, date, description, amount
├── categoryId → Category
├── type (expense | income)
├── source (csv | ofx | manual | projection)
├── sourceFile, installment, cardLastDigits
├── responsibleMemberId → Member
├── debtId → Debt
├── note, tags, status, normalizedMerchant
│
MonthlyIncome
├── month (PK), amount, isRecurring, source
│
PaidInvoiceMonths
├── month (PK) — lista de strings
│
Receivable
├── id, memberId → Member
├── source (responsavel | divisao | emprestimo_pix)
├── amount, paidAmount, date, description
├── transactionId → Transaction
├── status (pendente | parcial | quitado)
│
Debt
├── id, type (a_receber | a_pagar)
├── origin (manual | cartao | emprestimo | financiamento | outros)
├── counterparty, totalAmount, paidAmount
├── monthlyPayment, interestRate, startDate
├── linkedTransactionIds, currentInstallment, totalInstallments, note
│
Member
├── id, name, nickname, contact, isOwner, aliases
│
Category
├── id, name, color, keywords
│
CategoryRule
├── id, keyword, categoryId → Category, createdAt
│
Alias
├── original (PK), alias
```

### Regras de Separação (Nunca Misturar)

| Conceito | Onde Vive | Nunca Confundir Com |
|---|---|---|
| Receita real | `monthlyIncomes` | Quitação de fatura |
| Fatura quitada | `paidInvoiceMonths` | Receita |
| Gasto de cartão | `transactions` | Empréstimo Pix |
| Cobrança de terceiro | `receivables` | Dívida própria |
| Dívida própria | `debts` | Cobrança |
| Pix via cartão | `transactions` (source=csv/ofx) | Pix dinheiro |
| Pix dinheiro emprestado | `receivables` (source=emprestimo_pix) | Pix cartão |

---

## Módulos — Especificação Detalhada

### 1. Painel (Dashboard) — Somente Leitura

> **REGRA**: Zero edição. Zero cadastro. Zero botão de ação que mude dados.

#### KPIs Principais (cards no topo)
| KPI | Cálculo | Cor |
|---|---|---|
| Receita do mês | `monthlyIncomes[month].amount` | Verde |
| Valor da fatura | Soma expenses do mês | Vermelho |
| Saldo | Receita - Fatura | Verde/Vermelho |
| Status da fatura | `paidInvoiceMonths` ou saldo ≥ 0 | Badge |
| Parcelas futuras | Soma de installments nos próximos 3 meses | Azul |
| Cobranças pendentes | Soma receivables não quitados | Amarelo |

#### Gráficos e Tabelas

| Visualização | Tipo | Dados |
|---|---|---|
| Receita vs Despesa | BarChart agrupado | Histórico mensal |
| Saldo acumulado | LineChart | Running total |
| Categorias rankeadas | BarChart horizontal | Top 10 do mês |
| Treemap de gastos | Treemap | Proporção por categoria |
| Top 3 categorias no tempo | LineChart multi-série | Evolução mensal |
| Valor x Frequência | ScatterChart | Categorias como bolhas |
| Comparativo mês a mês | Tabela | Diff entre 2 meses |
| Heatmap diário | Grid de células | Gasto por dia real |
| Waterfall mensal | BarChart | Receita → categorias → saldo |
| Saldo mensal + projeção | BarChart | Histórico + média móvel |
| Sazonalidade | BarChart | Índice vs média |
| Gasto por dia da semana | BarChart | Média por dia |
| Ticket médio por categoria | BarChart horizontal | Top 8 |
| Volatilidade | BarChart horizontal | Desvio/média |
| Recorrências | Tabela | Merchants ≥ 2 meses |
| Anomalias | Tabela | Compras ≥ 2.5x média |
| Compromissos futuros | BarChart + Tabela | Parcelas + dívidas fixas |
| Metas/orçamento | Progress bars | Gasto vs limite |

#### Removidos do Dashboard
- ~~Score financeiro~~
- ~~Botão "Marcar fatura quitada"~~
- ~~Botão "Quitar faturas antigas"~~ (vai para topbar ou Receitas)
- ~~Simulador "e se"~~ (pode ficar, é somente leitura)

---

### 2. Receitas

**Objetivo**: Cadastrar a renda real recebida no mês.

#### Formulário
- Mês (input month)
- Valor recebido (number)
- Receita recorrente (checkbox)
- Salvar / Atualizar / Cancelar

#### Lista
- Tabela com mês, valor, tipo (recorrente/mensal), fonte
- Botões: Editar, Excluir

#### Regras
- Receita é **dinheiro real**. Nunca gerar receita automática.
- `addIncome` substitui receita do mesmo mês (correto hoje).
- Botão "Quitar faturas antigas" pode ficar aqui ou na topbar. Ele marca `paidInvoiceMonths`, **não gera receita**.

---

### 3. Transações

**Objetivo**: Revisar, categorizar e organizar lançamentos da fatura.

#### Tabela Principal
| Coluna | Tipo | Editável |
|---|---|---|
| Data | Texto | Não |
| Descrição original | Texto | Não |
| Local (alias) | Texto | Via botão Alias |
| Valor | BRL | Não |
| Categoria | Select inline | **Sim** |
| Vai pagar | Texto | Via botão Dividir |
| Nota | Input inline | **Sim** |
| Parcela | Texto | Não |
| Ações | Botões | Alias + Dividir |

#### Funcionalidades
- Filtro por período/fatura (já existe via seletor de mês)
- Busca por texto (já existe no DataTable)
- Filtro por categoria (adicionar)
- Filtro por responsável (adicionar)
- Ordenação por coluna (já existe)

#### Regras de Categoria
- Formulário: palavra-chave + categoria
- Aplica imediatamente + futuras importações
- Lista com editar/excluir (já funciona)

---

### 4. Membros

**Objetivo**: Cadastrar pessoas para divisão/cobrança.

#### Formulário
- Nome, Apelido, Contato, Titular do cartão

#### Lista
- Nome, apelido/contato, saldo devedor
- Titular nunca aparece como devedor

#### Regras
- Titular (`isOwner`) não gera cobrança contra si mesmo (correto hoje)
- Saldo = soma de receivables pendentes da pessoa

---

### 5. Divisões e Cobranças

**Objetivo**: Painel de tudo que outras pessoas devem.

#### Conteúdo
- Grid de totais por pessoa (quem deve quanto)
- Lista de cobranças pendentes (divisões + responsáveis)
- Botão "Marcar recebido" por cobrança
- Botão "Apagar" cobrança

#### Fluxo de Divisão (via Transações → botão Dividir)
1. Abre modal com valor e descrição
2. Clica nos nomes das pessoas (toggle visual, sem checkbox)
3. Recalcula valor por pessoa automaticamente
4. Titular nunca gera cobrança
5. 1 pessoa = "vai pagar sozinha"
6. Reabrir = mostra seleção anterior
7. Remover pessoa = recalcula para as restantes

#### Regras
- Não mostrar empréstimos Pix aqui (ficam no módulo 6)

---

### 6. Empréstimos e Pix

**Objetivo**: Registrar Pix/dinheiro emprestado **fora do cartão**.

#### Formulário
- Quem (select de membros não-titulares)
- Valor, Data, Descrição

#### Lista
- Totais por pessoa
- Histórico com status (pendente/parcial/quitado)
- Botão "Marcar recebido"

#### Regras
- Source = `emprestimo_pix`
- Pix via cartão **não aparece aqui** (fica em Transações)

---

### 7. Dívidas

**Objetivo**: Controlar dívidas próprias (financiamento, empréstimo, cartão).

#### Formulário
| Campo | Tipo |
|---|---|
| Credor | Select membros + "Outro credor" |
| Origem | Select: financiamento, empréstimo, cartão, manual, outros |
| Valor total | Number |
| Valor pago | Number |
| Parcela mensal | Number |
| Parcela atual | Number (ex: 26) |
| Total parcelas | Number (ex: 48) |
| Juros mensal % | Number |
| Data inicial | Date |
| Nota | Text |

#### Visualização (Block4Debts)
- KPIs: Total a pagar, Total a receber, Parcela mensal, Maior juros
- Gráfico resumo por tipo
- Simulação de quitação com aporte extra
- Tabela resumo por pessoa
- Tabela detalhada

#### Correção Necessária
- Simulação deve usar `getDebtBalance()` (descontando linkedPaid)

---

### 8. Importação

**Objetivo**: Upload e processamento de faturas CSV/OFX.

#### Fluxo
1. Clica "Selecionar arquivos"
2. Modal abre com upload
3. Parser lê e exibe tabela de revisão
4. Usuário ajusta categorias nos selects
5. Confirma importação

#### Regras
- Deduplificação por `date|description|amount|installment`
- Assinatura de arquivo (`file#length`) evita reimportação
- Importação automática de `public/faturas/` via manifest
- Juros de Pix crédito são importados (já tratado no parser)
- Créditos/pagamentos são ignorados (amount < 0)

---

## Correções de Cálculo — Detalhamento

### Fix 1: Remover `getMonthProjection` ou torná-la inteligente

```diff
// analytics.ts
-export const getMonthProjection = (transactions, incomes, selectedMonth) => {
-  // ... projeção linear que não faz sentido para fatura fechada
-};
+// Projeção só faz sentido para fatura ABERTA do mês corrente
+// Para meses passados com fatura importada, o valor é definitivo
```

### Fix 2: Heatmap baseado em datas reais

```diff
// analytics.ts - getDailyHeatmap
-const daysInMonth = selectedMonth
-  ? new Date(...).getDate()
-  : 31;
-return Array.from({ length: daysInMonth }, ...);
+// Usar os dias reais das transações
+const allDays = new Set(scoped.map(item => Number(item.date.substring(8, 10))));
+const maxDay = Math.max(...allDays, daysInMonth);
+return Array.from({ length: maxDay }, ...);
```

### ~~Fix 3: Despesa pessoal descontando cobranças~~ — NÃO APLICAR

**Decisão**: Despesa mostra o valor TOTAL da fatura (o que sai do cartão). Cobranças de terceiros são rastreadas separadamente no módulo de Divisões. O dashboard não desconta.

### Fix 4: Simulação de dívida com saldo real

```diff
// analytics.ts - getDebtPayoffRows
-let baseBalance = debt.totalAmount - debt.paidAmount;
+let baseBalance = getDebtBalance(debt, transactions);
```

### Fix 5: Insights sem meses vazios

```diff
// analytics.ts - getInsights
-const averageMonthly = summaries.length ? ... : 0;
+const realSummaries = summaries.filter(s => s.expense > 0);
+const averageMonthly = realSummaries.length ? ... : 0;
```

### Fix 6: Remover score do dashboard

```diff
// Block1Overview.tsx
-const score = getFinancialHealthScore(...);
-<Kpi label="Nota financeira" value={`${score}/100`} ... />
+<Kpi label="Cobranças pendentes" value={formatBRL(pendingReceivables)} ... />
```

### Fix 7: Dashboard somente leitura

```diff
// Block1Overview.tsx
-{selectedMonth && expense > 0 && !invoicePaid ?
-  <button onClick={markInvoicePaid}>Marcar fatura quitada</button> : null}
+// Mover para topbar ou módulo Receitas
```

---

## UI/UX — Padrões

### Tema
- **Dark mode** obrigatório
- Fundo: `#0f172a` / `#1e293b`
- Cards: `#1e293b` com borda sutil
- Texto primário: `#f1f5f9`
- Texto secundário: `#94a3b8`
- Sem string em inglês visível ao usuário

### Cores Semânticas
| Uso | Cor |
|---|---|
| Positivo/receita | `#16a34a` |
| Negativo/despesa | `#dc2626` |
| Alerta | `#f59e0b` |
| Informação | `#2563eb` / `#0ea5e9` |
| Neutro | `#64748b` |

### Tooltips de Gráficos
- Fundo escuro (`#1e293b`)
- Texto claro
- **Nunca** tooltip branco
- **Sem** highlight branco/cinza atrás de barras

### Treemap
- Paleta suave: `['#5b7cfa', '#4aa3b5', '#6ea879', '#c79a58', '#9b7ac7', '#c46f75', '#6f93b8', '#8aa0b2', '#7a8fb8', '#5f9ea0']`

### Mobile
- Scroll horizontal em gráficos/tabelas grandes
- Nunca quebrar a página inteira por overflow
- Gráficos não devem ficar ilegíveis ao espremer

### Navegação
- Sidebar com módulos separados
- Brand clicável volta ao Painel
- Títulos descritivos em cada módulo

---

## Referências de Mercado

Apps de referência para UX de controle financeiro pessoal:

| App | Inspiração |
|---|---|
| **Copilot** | Dashboard limpo, cards com mini-gráficos, categorização inteligente |
| **Monarch Money** | Visão completa de ativos/passivos, bills tracking |
| **YNAB** | Disciplina orçamentária, "cada real tem um destino" |
| **Mobills** (BR) | Controle de cartão brasileiro, faturas por mês |
| **Organizze** (BR) | Simplicidade, foco em receita vs despesa |

### Funcionalidades do mercado que o sistema JÁ tem
- ✅ Categorização automática por keywords
- ✅ Treemap de gastos
- ✅ Comparativo mês a mês
- ✅ Recorrências detectadas
- ✅ Divisão de compra entre pessoas
- ✅ Controle de dívidas com simulação
- ✅ Heatmap diário
- ✅ Waterfall de composição

### Funcionalidades do mercado para considerar futuramente
- 🔲 Multi-cartão (vários cartões/contas)
- 🔲 Tags livres nas transações
- 🔲 Notificações de vencimento
- 🔲 Importação de PDF de fatura
- 🔲 Histórico por membro (timeline)
- 🔲 Gráfico de evolução patrimonial
- 🔲 Export CSV/PDF do relatório

---

## Verificação

### Testes Automatizados
- `npm run build` sem erros de TypeScript
- Verificar que todos os cálculos de `analytics.ts` produzem valores coerentes

### Testes Manuais no Browser
1. Importar fatura CSV → verificar categorização e dedup
2. Cadastrar receita → verificar no dashboard
3. Dividir compra → verificar cobrança gerada
4. Marcar fatura quitada → verificar status no dashboard
5. Navegar entre meses → verificar que dados mudam
6. Verificar heatmap não perde dias
7. Verificar que dashboard não tem botões de edição
8. Testar mobile (responsive)

---

## Decisões Tomadas ✅

| Pergunta | Decisão |
|---|---|
| Meses anteriores a abril/2026 | **Manter visíveis** no seletor. Opção de "quitar faturas" marca `paidInvoiceMonths`, sem criar receita |
| Ajuste histórico | **Permitido somente por ação explícita**. "Igualar receitas às faturas antigas" cria `monthlyIncomes.source = adjustment` para meses anteriores ao mês atual, com receita = valor da fatura |
| Cobranças no gasto pessoal | **Opção A**: Despesa = valor total da fatura (o que sai do cartão). Cobranças são rastreadas à parte |
| Simulador "E se" | **Remover**. Não agrega valor ao objetivo do sistema |
