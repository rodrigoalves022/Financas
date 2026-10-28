import { useMemo, useRef } from 'react';
import type { ChangeEvent } from 'react';
import { AlertTriangle, DatabaseBackup, Download, FileText, FolderSync, RefreshCw, Send, Trash2, Upload } from 'lucide-react';
import { useFinance } from '../../store/FinanceContext';
import { FLAGS, readFlag } from '../../store/storage';
import { useTools } from '../../tools/useTools';
import { readBackup, type BackupSummary } from '../../tools/sistema/sistema.tool';
import { formatDate } from '../../utils/formatters';
import { Badge, Card, Field } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { useFeedback } from '../../components/ui/feedback';

export function ImportacaoPage({ onOpenImport }: { onOpenImport: () => void }) {
  const {
    processedFiles, transactions, resyncFaturas, resyncStatus, autoImportStatus,
    telegramSyncUrl, telegramSyncToken, setTelegramSyncUrl, setTelegramSyncToken, telegramSyncStatus, telegramLastSyncAt, syncTelegram,
  } = useFinance();
  const { callTool } = useTools();
  const { toast, confirm } = useFeedback();
  const backupInput = useRef<HTMLInputElement>(null);
  const paused = Boolean(readFlag(FLAGS.userCleared));

  // processedFiles guarda o nome e a assinatura ("arquivo#tamanho") de cada arquivo;
  // a lista mostra cada arquivo uma vez, com quantos lançamentos ele trouxe.
  const files = useMemo(() => {
    const names = Array.from(new Set(processedFiles.map(entry => entry.split('#')[0]))).sort().reverse();
    return names.map(name => ({ name, count: transactions.filter(item => item.sourceFile === name).length }));
  }, [processedFiles, transactions]);

  const exportBackup = async () => {
    const result = await callTool<{ fileName: string }>('exportar_dados', undefined);
    toast(result.success ? `Backup salvo como ${result.data?.fileName}.` : result.message, result.success ? 'success' : 'error');
  };

  const onBackupFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    let summary: BackupSummary;
    let data: unknown;
    try {
      data = JSON.parse(await file.text());
      summary = readBackup(data).summary;
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Arquivo inválido.', 'error');
      return;
    }
    const ok = await confirm({
      title: 'Restaurar este backup?',
      tone: 'danger',
      confirmLabel: 'Substituir meus dados',
      message: (
        <>
          <p style={{ marginTop: 0 }}>Todos os dados atuais deste aparelho serão <strong>substituídos</strong> pelo backup{summary.exportedAt ? ` de ${formatDate(summary.exportedAt)}` : ''}:</p>
          <p style={{ marginBottom: 0 }}>{summary.transactions} transações · {summary.incomes} receitas · {summary.members} pessoas · {summary.receivables} cobranças · {summary.debts} dívidas.</p>
          <p className="muted" style={{ fontSize: 12.5 }}>Dica: exporte um backup do estado atual antes, por segurança.</p>
        </>
      ),
    });
    if (!ok) return;
    const result = await callTool<BackupSummary>('restaurar_backup', { data });
    toast(result.success ? 'Backup restaurado.' : result.message, result.success ? 'success' : 'error');
  };

  const clearAll = async () => {
    const ok = await confirm({
      title: 'Apagar todos os dados?',
      tone: 'danger',
      confirmLabel: 'Apagar tudo',
      message: 'Transações, receitas, pessoas, cobranças, dívidas, regras e metas deste aparelho serão apagadas. A importação automática da pasta de faturas fica pausada. Não dá para desfazer — exporte um backup antes.',
    });
    if (!ok) return;
    await callTool('limpar_dados', undefined);
    toast('Dados apagados.', 'info');
  };

  const resumeAuto = async () => {
    await callTool('retomar_importacao_automatica', undefined);
    toast('Importação automática retomada — recarregue o app para importar as faturas da pasta.', 'info');
  };

  return (
    <div className="page-grid">
      <Card span="half" icon={<Upload size={17} />} title="Importar faturas" subtitle="CSV ou OFX do banco. Você revisa antes de gravar e duplicatas são ignoradas.">
        <button type="button" className="dropzone" style={{ width: '100%', minHeight: 150 }} onClick={onOpenImport}>
          <FileText size={30} />
          <strong>Selecionar arquivos</strong>
          <span>O mês da fatura é detectado pelo nome do arquivo.</span>
        </button>
      </Card>

      <Card span="half" icon={<DatabaseBackup size={17} />} title="Backup" subtitle="Seus dados ficam só neste aparelho (IndexedDB). Exporte de vez em quando.">
        <div style={{ display: 'grid', gap: 10 }}>
          <button type="button" className="secondary-button" onClick={exportBackup}><Download size={15} /> Exportar backup (JSON)</button>
          <button type="button" className="secondary-button" onClick={() => backupInput.current?.click()}><Upload size={15} /> Restaurar de um backup…</button>
          <input ref={backupInput} type="file" accept=".json,application/json" hidden onChange={onBackupFile} />
          <div className="notice"><DatabaseBackup size={16} /><span>Restaurar serve também para levar os dados do computador para o celular (e vice-versa).</span></div>
        </div>
      </Card>

      <Card span="half" icon={<FolderSync size={17} />} title={`Faturas da pasta (${files.length})`} subtitle={autoImportStatus}
        actions={<button type="button" className="secondary-button" onClick={() => resyncFaturas()}><RefreshCw size={15} /> Corrigir faturas locais</button>}>
        <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
          Arquivos em <code>public/faturas</code> são importados ao abrir o app. Se um arquivo foi corrigido depois, "Corrigir" reprocessa tudo e remove lançamentos de versões antigas, sem perder categorias e divisões.
        </p>
        {resyncStatus ? <div className="notice" style={{ marginBottom: 12 }}><RefreshCw size={15} /><span>{resyncStatus}</span></div> : null}
        {files.length ? (
          <div className="file-list">
            {files.map(file => (
              <div className="list-row" key={file.name}>
                <FileText size={16} className="muted" />
                <div className="grow"><span className="title">{file.name}</span></div>
                <Badge tone={file.count ? 'good' : 'neutral'}>{file.count} lançamento(s)</Badge>
              </div>
            ))}
          </div>
        ) : <EmptyState compact title="Nenhum arquivo importado ainda." />}
      </Card>

      <Card span="half" icon={<Send size={17} />} title="Telegram — quem me deve" subtitle="Registre empréstimos e pagamentos pelo bot. O servidor também roda o modo IA (Claude ou Antigravity) e recebe faturas mandadas no chat.">
        <div className="form-grid">
          <Field label="URL do servidor" full><input value={telegramSyncUrl} onChange={event => setTelegramSyncUrl(event.target.value)} placeholder="https://seu-servidor.exemplo.com" /></Field>
          <Field label="Token de sincronização" full hint="O mesmo SYNC_TOKEN do .env do servidor (veja server/README.md)."><input type="password" value={telegramSyncToken} onChange={event => setTelegramSyncToken(event.target.value)} /></Field>
        </div>
        <div className="card-footer-actions" style={{ marginTop: 14 }}>
          <button type="button" className="secondary-button" onClick={() => syncTelegram()}><Send size={15} /> Sincronizar agora</button>
          <span className="muted" style={{ fontSize: 12.5, alignSelf: 'center' }}>{telegramSyncStatus}{telegramLastSyncAt ? ` · ${new Date(telegramLastSyncAt).toLocaleTimeString('pt-BR')}` : ''}</span>
        </div>
      </Card>

      <Card span="full" className="danger-zone" icon={<AlertTriangle size={17} />} title="Zona de perigo">
        <div className="card-footer-actions" style={{ borderTop: 0, paddingTop: 0 }}>
          {paused ? <button type="button" className="secondary-button" onClick={resumeAuto}><FolderSync size={15} /> Retomar importação automática</button> : null}
          <button type="button" className="secondary-button danger-outline" onClick={clearAll}><Trash2 size={15} /> Apagar todos os dados</button>
        </div>
      </Card>
    </div>
  );
}
