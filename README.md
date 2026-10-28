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

**Análise**

- **Painel**: destaque da fatura do mês, cobertura pela receita, alertas ("pede atenção"), categorias, evolução e próximos compromissos. Somente leitura.
- **Análises**: abas de categorias e locais, fluxo mensal, comportamento, pessoas e dívidas, e análise da fatura com IA.

**Gestão**

- **Fatura**: linha do tempo das faturas igual à do banco (a pagar, pago antecipado, paga em, vencimento, melhor dia de compra), dados do cartão e limite disponível, revisão dos lançamentos, filtros rápidos, categoria inline (com "aplicar ao local inteiro"), observação da compra (vale para todas as parcelas), apelido do local, divisão e lançamento manual parcelado.
- **Receitas**: entradas reais, status da fatura (quitar/reabrir), recorrentes e ajustes.
- **Pessoas e cobranças**: quem te deve, recebimento total ou parcial, cobrança pelo WhatsApp, histórico e cadastro de pessoas.
- **Contas fixas**: contas pagas fora do cartão — valor fixo (internet), valor que muda todo mês (lançado mês a mês) e parceladas (financiamento, com parcela atual e quanto falta). Entram nos compromissos e no saldo do mês.
- **Dívidas**: dívidas próprias e plano de quitação (avalanche ou bola de neve, com aporte extra).
- **Metas e planejamento**: teto por categoria, sugestões pela média e compromissos dos próximos meses.
- **Categorias e regras**: categorias, regras inteligentes, teste de descrição, reclassificação com prévia e assistente de IA.

**Sistema**

- **Importação e backup**: upload CSV/OFX com revisão, faturas locais, exportar/restaurar backup, Telegram.

## Aparência

Tema claro/escuro e cor de destaque (laranja, azul, esmeralda, rosa, violeta, grafite) no rodapé da barra lateral. O ícone da aba acompanha a cor escolhida.

## Modo IA (CLIs locais, sem API)

O app usa um CLI de IA instalado no computador, com a sua assinatura — não precisa de chave de API:

- **Claude Code** (`claude -p`): Haiku, Sonnet, Opus.
- **Antigravity** (`agy -p`): Gemini 4 Argon, Gemini 3.8 Flash e os demais modelos da conta (a lista vem de `agy models`).

1. Instale o CLI e rode `claude` ou `agy` uma vez para fazer login.
2. Rode o app com `npm run dev`: o Vite expõe `/api/ai/*` e chama o CLI.
3. Escolha a IA e o modelo nos controles de cada tela (a escolha vale para todas):
   - **Painel → Dicas da IA**: leitura rápida do mês aberto, com as 4 dicas principais.
   - **Análises → Análise com IA**: todas as dicas e uma pergunta livre ("onde economizo R$ 300?").
   - **Categorias e regras → Assistente IA**: sugere categoria e palavra-chave para os estabelecimentos.

As dicas e as sugestões ficam salvas até serem refeitas, e a IA continua rodando se você trocar de página.

No build estático/APK não há como executar o CLI; nesse caso escolha "Servidor do Telegram" como local da IA e rode o servidor (`server/`) num PC com o CLI logado.

## Caixa de entrada local

Os dados ficam no IndexedDB do navegador, onde ferramentas de fora (como o Claude Code) não alcançam. Com o `npm run dev` rodando, qualquer `inbox/*.json` é aplicado pelo app uma vez — pelas mesmas ferramentas dos botões — e movido para `inbox/aplicados/`. A pasta fica fora de `public/` e do git; no build publicado a rota não existe.

```json
{
  "id": "identificador-unico",
  "title": "O que o pacote faz",
  "operations": [
    { "tool": "adicionar_receita", "params": { "income": { "id": "salario-2026-01", "month": "2026-01", "amount": 3000, "isRecurring": true } } }
  ]
}
```

Só ferramentas que criam ou atualizam (`adicionar_`, `salvar_`, `cadastrar_`, `lancar_`, `pagar_`, `quitar_`, `criar_`, `atualizar_`); nada de excluir, limpar ou restaurar. Use ids fixos nos registros para que reaplicar não duplique.

## Telegram com IA

O bot (`server/`) entende frases livres e perguntas ("quanto gastei com delivery esse mês?"), manda dicas (`dicas`) e recebe a **fatura em CSV/OFX** pelo chat — o app importa sozinho na próxima sincronização, sem duplicar, e o bot avisa o resultado. Veja `server/README.md`.

## Regras importantes

- Receita só existe quando cadastrada explicitamente em **Receitas**.
- Marcar fatura como quitada não cria receita.
- `paidInvoiceMonths` controla status da fatura, não renda.
- Categoria escolhida à mão (`manualCategory`) nunca é sobrescrita por regras automáticas.
- `monthlyIncomes` controla receita real.
- Pix via cartão fica em **Transações**.
- Pix/dinheiro emprestado fora do cartão fica em **Pessoas e cobranças**.
- Cobranças de terceiros ficam em `receivables`.
- Dívidas próprias ficam em `debts`.
- O dashboard é somente leitura: sem cadastro, edição ou botões que alterem estado.

## Dados e persistência

O app usa IndexedDB (com flags de controle no `localStorage`) para persistir dados no navegador/dispositivo:

- Transações importadas
- Receitas mensais
- Categorias e regras
- Aliases de estabelecimento
- Membros
- Cobranças
- Empréstimos/Pix
- Dívidas
- Faturas quitadas

Em **Importação e backup** dá para exportar e restaurar tudo em JSON — também serve para levar os dados do computador para o celular.

## Build validado

Antes de enviar alterações, rode:

```bash
npm run lint
npm run build
```

