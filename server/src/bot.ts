import { Bot, InlineKeyboard, type Context } from 'grammy';
import {
  deleteEvent,
  getLastPendingEvent,
  getLastUndoableEvent,
  getSnapshot,
  insertEvent,
} from './db.js';
import { HELP_TEXT, matchPersonName, normalizeName, parseCommand, type ParsedCommand } from './parser.js';
import { botAiMode, generateTips, interpretWithAi } from './botAi.js';
import { NO_SNAPSHOT_TEXT, formatBRL, formatCardInvoice, formatOverview, formatPerson } from './format.js';
import type { ImportarFaturaPayload, MarcarPagoPayload, RachaPayload, RegistrarDividaPayload } from './types.js';

const BOT_TOKEN = process.env.BOT_TOKEN;
const ALLOWED_CHAT_ID = process.env.ALLOWED_CHAT_ID;

if (!BOT_TOKEN) throw new Error('BOT_TOKEN não configurado (.env)');
if (!ALLOWED_CHAT_ID) throw new Error('ALLOWED_CHAT_ID não configurado (.env)');

export const bot = new Bot(BOT_TOKEN);

// Porteiro: qualquer atualização de outro chat morre aqui, antes de qualquer handler —
// inclusive os que chamam a IA. O Telegram não mostra o telefone de quem escreve; o
// chat_id da conversa privada é o id da própria conta, e ninguém mais consegue usá-lo.
// Quem tentar é ignorado em silêncio; o dono recebe um aviso por pessoa a cada execução.
const warnedStrangers = new Set<string>();
bot.use(async (ctx, next) => {
  const chatId = String(ctx.chat?.id ?? ctx.from?.id ?? '');
  if (chatId === ALLOWED_CHAT_ID) {
    await next();
    return;
  }
  if (!chatId || warnedStrangers.has(chatId)) return;
  warnedStrangers.add(chatId);
  const who = [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(' ') || 'sem nome';
  const handle = ctx.from?.username ? ` @${ctx.from.username}` : '';
  console.warn(`[bot] Ignorei mensagem de um chat não autorizado: ${who}${handle} (${chatId}).`);
  await bot.api.sendMessage(ALLOWED_CHAT_ID, `🚫 Alguém tentou usar o bot e foi ignorado: ${who}${handle} (id ${chatId}). Nada foi registrado e a IA não foi chamada.`)
    .catch(() => undefined);
});

const knownNames = () => getSnapshot()?.allMemberNames ?? [];

// Confirmações pendentes ficam em memória com id curto, porque callback_data do Telegram
// aceita só 64 bytes. Se o servidor reiniciar, o botão responde que expirou.
const pendingConfirmations = new Map<string, ParsedCommand>();
let confirmationSeq = 0;
const rememberConfirmation = (command: ParsedCommand) => {
  const id = String((confirmationSeq += 1));
  pendingConfirmations.set(id, command);
  if (pendingConfirmations.size > 50) {
    pendingConfirmations.delete(pendingConfirmations.keys().next().value as string);
  }
  return id;
};

// ─── Ações que viram evento na fila ───────────────────────────────────────────

const queueRegistro = (personName: string, amount: number, description?: string, allowCreate = false) => {
  const payload: RegistrarDividaPayload = { personName, amount, description, allowCreate };
  insertEvent('registrar_divida', payload);
  const desc = description ? ` (${description})` : '';
  return `📥 Anotado: *${personName}* te deve ${formatBRL(amount)}${desc}.`;
};

const queuePagamento = (personName: string, amount?: number) => {
  const payload: MarcarPagoPayload = { personName, amount };
  insertEvent('marcar_pago', payload);
  const amountText = amount ? formatBRL(amount) : 'tudo que estava pendente';
  return `📥 Anotado: pagamento de *${personName}* (${amountText}).`;
};

const queueRacha = (amount: number, personNames: string[], includeOwner: boolean, description?: string) => {
  const shares = personNames.length + (includeOwner ? 1 : 0);
  const payload: RachaPayload = { amount, personNames, shares, description };
  insertEvent('racha', payload);
  const share = amount / shares;
  const who = personNames.join(', ');
  return [
    `🍻 Racha de ${formatBRL(amount)} em ${shares} parte(s) de ${formatBRL(share)}.`,
    `Vou cobrar ${formatBRL(share)} de: *${who}*.`,
    includeOwner ? '_Sua parte não vira cobrança._' : '',
  ].filter(Boolean).join('\n');
};

// ─── Resolução de nome com rede de segurança ──────────────────────────────────

interface Resolution {
  reply: string;
  keyboard?: InlineKeyboard;
}

/**
 * Só registra direto quando o nome bate com alguém conhecido. Nome desconhecido vira
 * pergunta com botão — antes, qualquer mensagem no formato "palavra número" ("ok 2")
 * criava silenciosamente uma cobrança e um membro de lixo no cadastro.
 */
const resolvePerson = (command: ParsedCommand, personName: string, apply: (name: string) => string): Resolution => {
  const names = knownNames();
  const match = matchPersonName(personName, names);

  if (match.status === 'exact' && match.name) return { reply: apply(match.name) };

  if (match.status === 'suggestion' && match.name) {
    return { reply: `${apply(match.name)}\n\n_Entendi "${personName}" como *${match.name}*._` };
  }

  if (match.status === 'ambiguous') {
    const keyboard = new InlineKeyboard();
    match.candidates.slice(0, 4).forEach(name => {
      const id = rememberConfirmation({ ...command, personName: name } as ParsedCommand);
      keyboard.text(name, `pick:${id}`).row();
    });
    return { reply: `Qual deles é "${personName}"?`, keyboard };
  }

  // Desconhecido: para pagamento não faz sentido criar ninguém.
  if (command.kind === 'marcar_pago') {
    const list = names.length ? names.join(', ') : 'ninguém cadastrado ainda';
    return { reply: `Não conheço "${personName}". Pessoas cadastradas: ${list}.` };
  }

  const id = rememberConfirmation(command);
  const keyboard = new InlineKeyboard()
    .text(`Criar "${personName}"`, `create:${id}`)
    .text('Cancelar', `cancel:${id}`);
  return { reply: `Não conheço "${personName}". Quer cadastrar essa pessoa?`, keyboard };
};

// ─── Execução de um comando já interpretado ───────────────────────────────────

const runCommand = (command: ParsedCommand): Resolution => {
  switch (command.kind) {
    case 'ajuda':
      return { reply: HELP_TEXT };

    case 'consulta_fatura': {
      const snapshot = getSnapshot();
      return { reply: snapshot ? formatCardInvoice(snapshot) : NO_SNAPSHOT_TEXT };
    }

    case 'consulta_geral': {
      const snapshot = getSnapshot();
      return { reply: snapshot ? formatOverview(snapshot) : NO_SNAPSHOT_TEXT };
    }

    case 'consulta_pessoa': {
      const snapshot = getSnapshot();
      if (!snapshot) return { reply: NO_SNAPSHOT_TEXT };
      const target = normalizeName(command.personName);
      const person = snapshot.people.find(item => normalizeName(item.name) === target);
      if (person) return { reply: formatPerson(person, snapshot, command.detailed) };

      const match = matchPersonName(command.personName, snapshot.allMemberNames);
      if (match.name) {
        const fallback = snapshot.people.find(item => normalizeName(item.name) === normalizeName(match.name!));
        if (fallback) return { reply: formatPerson(fallback, snapshot, command.detailed) };
        return { reply: `*${match.name}* não está te devendo nada.` };
      }
      return { reply: `Não encontrei ninguém parecido com "${command.personName}".` };
    }

    case 'desfazer': {
      // Evento ainda na fila é cancelado na hora, sem envolver o app.
      const queued = getLastPendingEvent();
      if (queued) {
        deleteEvent(queued.id);
        return { reply: '↩️ Cancelei o último lançamento antes mesmo dele chegar no app.' };
      }
      const applied = getLastUndoableEvent();
      if (!applied?.undo) return { reply: 'Não há nada recente que eu saiba desfazer.' };
      insertEvent('desfazer', { targetEventId: applied.id, undo: applied.undo });
      return { reply: '↩️ Pedi a reversão do último lançamento. Confirmo assim que o app aplicar.' };
    }

    case 'registrar_divida':
      return resolvePerson(command, command.personName, name =>
        queueRegistro(name, command.amount, command.description));

    case 'marcar_pago':
      return resolvePerson(command, command.personName, name =>
        queuePagamento(name, command.amount));

    case 'racha': {
      const names = knownNames();
      const resolved: string[] = [];
      const unknown: string[] = [];
      command.personNames.forEach(name => {
        const match = matchPersonName(name, names);
        if (match.name) resolved.push(match.name);
        else unknown.push(name);
      });
      if (unknown.length) {
        return { reply: `Não conheço: ${unknown.join(', ')}. Cadastre no app ou registre individualmente antes de rachar.` };
      }
      return { reply: queueRacha(command.amount, resolved, command.includeOwner, command.description) };
    }

    default:
      return { reply: HELP_TEXT };
  }
};

// ─── IA: "digitando…" enquanto o CLI pensa ────────────────────────────────────

// O indicador do Telegram some sozinho em ~5s; um CLI pode levar de 5s a um minuto.
const withTyping = async <T>(ctx: Context, work: () => Promise<T>): Promise<T> => {
  const send = () => ctx.replyWithChatAction('typing').catch(() => undefined);
  send();
  const timer = setInterval(send, 4500);
  try {
    return await work();
  } finally {
    clearInterval(timer);
  }
};

const replyTips = async (ctx: Context) => {
  try {
    const text = await withTyping(ctx, () => generateTips(getSnapshot()));
    await ctx.reply(text);
  } catch (error) {
    await ctx.reply(`⚠️ Não consegui gerar as dicas: ${error instanceof Error ? error.message : String(error)}`);
  }
};

// ─── Handlers ─────────────────────────────────────────────────────────────────

bot.on('message:text', async ctx => {
  if (String(ctx.chat.id) !== ALLOWED_CHAT_ID) return;

  let command = parseCommand(ctx.message.text);

  // A IA entra só no que as regras fixas não entenderam: o caminho comum continua
  // instantâneo, e a IA cuida das frases livres e das perguntas sobre os gastos.
  if (command.kind === 'unrecognized') {
    const ai = await withTyping(ctx, () => interpretWithAi(ctx.message.text, getSnapshot()));
    if (ai?.kind === 'answer') {
      await ctx.reply(ai.text);
      return;
    }
    if (ai?.kind === 'command') command = ai.command;
  }

  if (command.kind === 'dicas') {
    await replyTips(ctx);
    return;
  }

  const { reply, keyboard } = runCommand(command);
  await ctx.reply(reply, { parse_mode: 'Markdown', reply_markup: keyboard });
});

// ─── Fatura mandada como arquivo ──────────────────────────────────────────────

const MAX_INVOICE_BYTES = 2_000_000;

// Markdown legado do Telegram: nomes de arquivo com "_" viravam itálico quebrado.
const escapeMarkdown = (text: string) => text.replace(/([_*`[])/g, '\\$1');

// CSV do Inter vem em UTF-8 (com BOM, que o TextDecoder remove); outros bancos ainda
// exportam em Windows-1252.
const decodeInvoice = (bytes: Uint8Array) => {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
};

bot.on('message:document', async ctx => {
  if (String(ctx.chat.id) !== ALLOWED_CHAT_ID) return;
  const document = ctx.message.document;
  const fileName = (document.file_name || 'fatura.csv').trim();

  if (!/\.(csv|ofx)$/i.test(fileName)) {
    await ctx.reply('Por enquanto eu leio a fatura em *CSV* ou *OFX* — no app do banco, exporte a fatura nesse formato e mande o arquivo aqui. PDF e print ainda não.', { parse_mode: 'Markdown' });
    return;
  }
  if ((document.file_size || 0) > MAX_INVOICE_BYTES) {
    await ctx.reply('Arquivo grande demais para uma fatura (máximo 2 MB).');
    return;
  }

  try {
    const file = await ctx.getFile();
    const response = await fetch(`https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`);
    if (!response.ok) throw new Error(`download ${response.status}`);
    const content = decodeInvoice(new Uint8Array(await response.arrayBuffer()));

    const isOfx = /\.ofx$/i.test(fileName);
    const rows = isOfx ? (content.match(/<STMTTRN>/gi) || []).length : content.split(/\r?\n/).filter(line => line.trim()).length - 1;
    const looksValid = isOfx ? rows > 0 : rows > 0 && /data|date/i.test(content.split(/\r?\n/)[0] || '');
    if (!looksValid) {
      await ctx.reply('Esse arquivo não parece uma fatura: esperava um CSV com cabeçalho (Data, Lançamento, Valor…) ou um OFX com transações.');
      return;
    }

    const payload: ImportarFaturaPayload = { fileName, content, caption: ctx.message.caption?.slice(0, 120) };
    insertEvent('importar_fatura', payload);
    await ctx.reply(
      `📎 Recebi *${escapeMarkdown(fileName)}* (${rows} lançamento(s)). O app importa assim que sincronizar — ele ignora o que já existe e eu te aviso o resultado aqui.`,
      { parse_mode: 'Markdown' },
    );
  } catch (error) {
    console.error('[bot] Falha ao receber fatura:', error);
    await ctx.reply('⚠️ Não consegui baixar o arquivo do Telegram. Tente mandar de novo.');
  }
});

bot.on('callback_query:data', async ctx => {
  if (String(ctx.chat?.id) !== ALLOWED_CHAT_ID) return;

  const [action, id] = ctx.callbackQuery.data.split(':');

  // Botão "Dicas desta fatura", enviado depois de importar uma fatura pelo chat.
  if (action === 'tips') {
    await ctx.answerCallbackQuery('Gerando as dicas…');
    await replyTips(ctx);
    return;
  }

  const command = pendingConfirmations.get(id);

  if (!command) {
    await ctx.answerCallbackQuery('Essa confirmação expirou.');
    return;
  }
  pendingConfirmations.delete(id);

  if (action === 'cancel') {
    await ctx.answerCallbackQuery('Cancelado');
    await ctx.editMessageText('❌ Cancelado, nada foi registrado.');
    return;
  }

  let reply = '';
  if (action === 'create' && command.kind === 'registrar_divida') {
    reply = queueRegistro(command.personName, command.amount, command.description, true);
  } else if (action === 'pick') {
    reply = runCommand(command).reply;
  }

  await ctx.answerCallbackQuery();
  await ctx.editMessageText(reply || 'Feito.', { parse_mode: 'Markdown' });
});

// Menu nativo que aparece ao digitar "/" no Telegram.
export const registerCommands = async () => {
  await bot.api.setMyCommands([
    { command: 'fatura', description: 'Consultar sua fatura do cartão e dívidas a pagar' },
    { command: 'deve', description: 'Registrar que alguém te deve — Carlos 50' },
    { command: 'pago', description: 'Marcar como pago — pago Carlos' },
    { command: 'racha', description: 'Dividir conta — racha 150 eu Lucas' },
    { command: 'saldo', description: 'Saldo de uma pessoa — saldo Carlos' },
    { command: 'extrato', description: 'Detalhar pendências — extrato Carlos' },
    { command: 'desfazer', description: 'Cancelar o último lançamento' },
    { command: 'dicas', description: 'Dicas da IA sobre a fatura e onde economizar' },
    { command: 'ajuda', description: 'Guia completo de como usar o bot' },
  ]);
};

export const notifyAllowedChat = async (message: string, keyboard?: InlineKeyboard): Promise<void> => {
  await bot.api.sendMessage(ALLOWED_CHAT_ID!, message, { parse_mode: 'Markdown', reply_markup: keyboard });
};

/** Botão de dicas só aparece quando há um CLI de IA para gerá-las. */
export const tipsKeyboard = async (): Promise<InlineKeyboard | undefined> => {
  const mode = await botAiMode();
  return mode === 'antigravity' || mode === 'claude' ? new InlineKeyboard().text('💡 Dicas desta fatura', 'tips:fatura') : undefined;
};
