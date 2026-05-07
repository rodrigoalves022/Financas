# Finanças

Sistema pessoal de controle financeiro para acompanhar faturas de cartão, receitas reais, cobranças de terceiros, empréstimos/Pix, dívidas próprias e evolução dos gastos.

O projeto é uma aplicação **React + TypeScript + Vite**, com visualizações em **Recharts** e empacotamento mobile via **Capacitor**.

## Stack

- React 19
- TypeScript
- Vite
- Tailwind CSS
- Recharts
- date-fns
- Papaparse
- Capacitor Android

## Como rodar

Instale as dependências:

```bash
npm install
```

Rode em desenvolvimento:

```bash
npm run dev
```

Gere a versão de produção:

```bash
npm run build
```

Valide o código:

```bash
npm run lint
```

## Android

Depois de gerar o build web:

```bash
npm run build
npx cap sync android
npx cap open android
```

No Android Studio, gere o APK pela opção de build do projeto Android.

## Módulos do sistema

- **Painel**: visão somente leitura com resumo do período, fatura, saldo, categorias, comportamento de consumo e planejamento.
- **Receitas**: cadastro manual das entradas reais de dinheiro. O sistema soma várias receitas no mesmo mês.
- **Transações**: revisão da fatura importada, categoria, alias de estabelecimento, nota e divisão de compra.
- **Membros**: cadastro das pessoas usadas em divisões, cobranças e empréstimos.
- **Divisões e cobranças**: controle do que terceiros precisam pagar por compras no cartão.
- **Empréstimos e Pix**: valores emprestados fora do cartão, em dinheiro ou Pix.
- **Dívidas**: financiamentos, empréstimos e compromissos próprios.
- **Importação**: upload/processamento de arquivos CSV/OFX e faturas locais.

## Regras importantes

- Receita só existe quando cadastrada explicitamente em **Receitas**.
- Marcar fatura como quitada não cria receita.
- `paidInvoiceMonths` controla status da fatura, não renda.
- `monthlyIncomes` controla receita real.
- Pix via cartão fica em **Transações**.
- Pix/dinheiro emprestado fora do cartão fica em **Empréstimos e Pix**.
- Cobranças de terceiros ficam em `receivables`.
- Dívidas próprias ficam em `debts`.
- O dashboard é somente leitura: sem cadastro, edição ou botões que alterem estado.

## Dados e persistência

O app usa `localStorage` para persistir dados no navegador/dispositivo:

- Transações importadas
- Receitas mensais
- Categorias e regras
- Aliases de estabelecimento
- Membros
- Cobranças
- Empréstimos/Pix
- Dívidas
- Faturas quitadas

Também existe exportação/importação de dados em JSON para backup.

## Build validado

Antes de enviar alterações, rode:

```bash
npm run lint
npm run build
```

