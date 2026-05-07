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

Somente leitura.

Deve mostrar:

- Receita do período
- Valor total
- Valor da fatura
- Dívidas cadastradas
- Saldo
- Situação da fatura
- Cobranças pendentes
- Parcelas futuras
- Receita vs despesa
- Saldo acumulado
- Categorias rankeadas
- Treemap
- Comparativo mês a mês
- Heatmap diário
- Recorrências
- Anomalias
- Dívidas e planejamento

Não pode ter:

- Botão para marcar fatura quitada
- Botão para editar compra
- Cadastro de receita
- Cadastro de dívida
- Score financeiro 0-100

### Receitas

Objetivo: registrar dinheiro real recebido.

Funcionalidades:

- Adicionar receita
- Editar receita
- Excluir receita
- Somar múltiplas entradas no mesmo mês
- Marcar fatura selecionada como quitada
- Quitar faturas antigas
- Igualar receitas às faturas antigas por ação explícita

Regras:

- Igualar receita histórica é ajuste consciente para meses antigos.
- Essa ação não deve acontecer sozinha.
- Quitar fatura não deve criar receita.

### Transações

Objetivo: organizar faturas importadas.

Funcionalidades:

- Filtro por fatura/período
- Busca por texto
- Filtro por coluna
- Categoria inline
- Nota inline
- Botão de alias por linha
- Botão de dividir por linha

Colunas esperadas:

- Data
- Fatura
- Descrição
- Local
- Valor
- Categoria
- Vai pagar
- Nota
- Parcela
- Ações

Evitar excesso de colunas de data. A interface deve deixar claro:

- data real da compra
- mês da fatura

### Membros

Objetivo: cadastrar pessoas.

Funcionalidades:

- Cadastrar membro
- Editar membro
- Excluir membro quando possível
- Marcar titular
- Exibir saldo por pessoa

Layout:

- Cadastro em cima
- Lista de membros abaixo

### Divisões e cobranças

Objetivo: controlar compras no cartão que terceiros devem pagar.

Funcionalidades:

- Dividir compra clicando nos nomes
- Sem checkbox cru
- Reabrir divisão mantendo seleção anterior
- Remover pessoa e recalcular automaticamente
- Marcar cobrança como recebida
- Excluir cobrança
- Ver total por pessoa

Regras:

- Se selecionar uma pessoa, ela paga sozinha.
- Se selecionar várias, divide igualmente.
- Titular não entra como devedor.
- Cobrança de cartão fica aqui, não em Empréstimos e Pix.

### Empréstimos e Pix

Objetivo: registrar dinheiro/Pix emprestado fora do cartão.

Funcionalidades:

- Cadastrar novo empréstimo/Pix
- Editar registro
- Excluir registro
- Marcar recebido
- Ver histórico
- Ver total por pessoa

Regras:

- Não mostrar Pix via cartão aqui.
- Ao excluir, o valor precisa sair de todos os totais.
- Não pode reaparecer por importação ou dado antigo.

### Dívidas

Objetivo: controlar dívidas próprias e compromissos.

Funcionalidades:

- Cadastrar dívida por modal
- Editar dívida
- Excluir dívida
- Ver histórico
- Ver resumo por pessoa/entidade
- Simular quitação com aporte extra

Campos:

- Quem eu devo
- Origem
- Valor total
- Valor pago
- Parcela mensal
- Parcela atual
- Total de parcelas
- Juros mensal
- Data inicial
- Nota

KPIs:

- Total a pagar
- Total a receber
- Parcela mensal
- Maior juros

Regras:

- Total a pagar soma dívidas próprias.
- Total a receber soma cobranças operacionais e registros manuais válidos, sem duplicar.
- Simulação usa `getDebtBalance`.

### Importação

Objetivo: importar faturas CSV/OFX.

Funcionalidades:

- Upload manual
- Importação de faturas locais em `public/faturas`
- Revisão antes de confirmar
- Categorização automática
- Aplicação de aliases e regras
- Deduplicação

Regras:

- CSV substituído não deve duplicar dados antigos.
- Parcelas devem cair no mês correto da fatura.
- Juros de Pix crédito devem ser lidos quando estiverem no arquivo.

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

