# financas-telegram-sync

Bot do Telegram + fila de eventos que alimenta o módulo **Empréstimos e Pix** do app de controle financeiro com "quem me deve" e "quem já pagou", sem precisar abrir o app.

## Como funciona

1. Você manda `/deve <nome> <valor> [descrição]` ou `/pago <nome> [valor]` pro bot no Telegram.
2. O bot grava um evento pendente num SQLite local e responde confirmando o que entendeu.
3. O app (página **Importação**) busca os eventos pendentes ao abrir ou no botão "Sincronizar agora", aplica no estado local (cria/atualiza cobrança em Empréstimos e Pix) e avisa o backend do resultado.
4. O bot manda uma última mensagem no Telegram confirmando que foi aplicado (ou avisando que deu erro, ex: pessoa sem cobrança pendente).

## Comandos

A barra `/` é opcional em todos eles.

**Registrar**
- `Daniel 50 bebida` — Daniel te deve R$ 50 (descrição opcional)
- `Paulo Vitor 50 almoço` — nomes compostos funcionam
- `Paulo Vitor, 50, almoço` — vírgula deixa os campos explícitos
- `Paulo Vitor me deve 50 de cerveja` — mesma coisa, em frase

**Pagar**
- `pago Daniel` — quita tudo que ele deve
- `pago Bruno Henrique 20` — abate R$ 20 (parcial)

**Rachar conta** — separe os nomes por vírgula
- `racha 150 Paulo Vitor, Bruno Henrique` — R$ 75 para cada um
- `racha 150 eu, Paulo Vitor, Bruno Henrique` — divide em 3, cobra R$ 50 de cada um (sua parte não vira cobrança)
- Sem vírgula, cada palavra vira uma pessoa (`racha 150 Lucas Carlos` = duas pessoas) — por isso a vírgula é obrigatória com nomes compostos

**Consultar**
- `quem me deve` — resumo geral
- `saldo Daniel` — total de uma pessoa
- `extrato Daniel` — lista detalhada das pendências

**Corrigir**
- `desfazer` — cancela o último lançamento

### Rede de segurança

- Só o seu `ALLOWED_CHAT_ID` usa o bot. O Telegram não mostra o telefone de quem escreve, mas o chat_id da conversa privada é o id da sua conta (a do seu número): mensagens, arquivos e botões de qualquer outro chat são descartados antes de qualquer handler — nada é registrado e a IA não é chamada. Você recebe um aviso com o nome de quem tentou.
- As rotas HTTP (`/api/*`, inclusive as de IA) exigem o `SYNC_TOKEN`. Se expuser o servidor na internet, use um token longo (40+ caracteres aleatórios) e HTTPS.

- Nome desconhecido não vira cobrança automaticamente: o bot pergunta antes de cadastrar alguém novo.
- Erro de digitação é corrigido sozinho (`danie` → Daniel); se houver empate, ele pergunta qual você quis dizer.
- As consultas mostram há quanto tempo o app sincronizou pela última vez, para você saber se o número está fresco.

## Configurar

1. Crie um bot com o [@BotFather](https://t.me/BotFather) no Telegram e copie o token.
2. Descubra seu `chat_id` conversando com [@userinfobot](https://t.me/userinfobot).
3. Copie `.env.example` para `.env` e preencha `BOT_TOKEN`, `ALLOWED_CHAT_ID` e invente um `SYNC_TOKEN` (string aleatória longa — vai ser usado também no app).

### Opcionais

- **`BOT_AI` / `BOT_AI_MODEL`** — qual IA o bot usa para frases livres, perguntas e dicas (padrão: o primeiro CLI logado no PC). Veja "IA no bot e no app".
- **`GEMINI_API_KEY`** — plano B quando não há CLI: deixa o bot entender frases fora do formato ("paguei o almoço do Daniel, 50 pila"). Gere em [aistudio.google.com/apikey](https://aistudio.google.com/apikey); a chave começa com `AIzaSy`. As regras fixas rodam primeiro, então a IA só é chamada no que elas não entenderem.
- **`REMINDER_WEEKDAY` / `REMINDER_HOUR`** — lembrete automático de quem está devendo (ex: `1` e `9` = toda segunda às 9h). Vazio desliga.

> Com a IA ativa, o texto das mensagens que as regras não entendem, os nomes cadastrados e o resumo agregado das finanças vão para o provedor escolhido (Google no Antigravity/Gemini, Anthropic no Claude).

## Rodar local (dev)

```bash
npm install
npm run dev
```

## Rodar com Docker

```bash
docker build -t financas-telegram-sync .
docker run -d --name financas-telegram-sync \
  --env-file .env \
  -p 3000:3000 \
  -v financas-telegram-data:/app/data \
  financas-telegram-sync
```

O volume `/app/data` guarda o SQLite da fila de eventos — sem ele, os eventos somem se o container for recriado.

## No app

Na página **Importação**, no card "Telegram", informe a URL onde esse servidor está acessível (ex: `https://seu-dominio.com` ou `http://IP:3000`) e o mesmo `SYNC_TOKEN` do `.env`. HTTPS fica por sua conta caso exponha isso pra internet — o token trafega em texto puro sem TLS.

## Mandar a fatura pelo chat

Mande o arquivo **CSV** ou **OFX** da fatura (exportado no app do banco) direto na conversa com o bot. Ele confere se parece uma fatura, guarda como evento e o app importa na próxima sincronização (a cada 15 s com o app aberto), ignorando o que já existe. O bot avisa o resultado e oferece o botão **💡 Dicas desta fatura**.

O mês é deduzido pelas datas e pelo fechamento do cartão; para forçar, escreva na legenda `11/2026` ou `novembro`.

## IA no bot e no app (CLIs, sem API)

Se este servidor rodar num computador com o **Antigravity** (`agy`) ou o **Claude Code** (`claude`) instalado e logado:

- o bot entende frases fora do formato e responde perguntas sobre os gastos (`quanto gastei com mercado esse mês?`) usando o resumo que o app manda;
- `dicas` gera uma leitura da fatura com onde economizar;
- as rotas de IA do app respondem aqui, protegidas pelo mesmo `SYNC_TOKEN`: `GET /api/ai/status`, `POST /api/ai/categorize`, `POST /api/ai/insights` (no app, escolha "Servidor do Telegram" em "Onde roda").

Configure com `BOT_AI` e `BOT_AI_MODEL` (veja `.env.example`); o log de inicialização mostra qual IA ficou ativa. Na imagem Docker não há CLI: o bot cai para a API do Gemini (se houver `GEMINI_API_KEY`) só para interpretar frases.
