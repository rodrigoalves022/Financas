import { useMemo, useRef, useState } from 'react';
import type { ChangeEvent, DragEvent } from 'react';
import { AlertCircle, CheckCircle2, FileUp, Loader2, Upload } from 'lucide-react';
import { useFinance } from '../store/FinanceContext';
import { financeReducer } from '../store/reducer';
import { useTools } from '../tools/useTools';
import { invoiceMonthFromFileName, parseInvoiceFile } from '../utils/csvParser';
import { formatBRL, formatDate, formatInvoiceMonthLabel, shiftMonth } from '../utils/formatters';
import { Badge, Field } from './ui/Card';
import { Modal } from './ui/Modal';
import { useFeedback } from './ui/feedback';
import type { Transaction } from '../types';

interface ParsedFile {
  name: string;
  rows: Transaction[];
  detectedMonth: string;
  month: string;
}

// Sem mês no nome do arquivo, o palpite é o mês seguinte à compra mais recente:
// a fatura vence depois do fechamento.
const guessMonth = (rows: Transaction[]) => {
  const latest = rows.map(row => row.date.substring(0, 7)).sort().at(-1);
  return latest ? shiftMonth(latest, 1) : '';
};

export function ImportModal({ onClose }: { onClose: () => void }) {
  const { categories, categoryRules, aliases, getState } = useFinance();
  const { callTool } = useTools();
  const { toast } = useFeedback();
  const [files, setFiles] = useState<ParsedFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const processFiles = async (list: File[]) => {
    const accepted = list.filter(file => /\.(csv|ofx)$/i.test(file.name));
    if (!accepted.length) {
      setError('Selecione arquivos .csv ou .ofx.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const context = { categories, rules: categoryRules, aliases };
      const parsed: ParsedFile[] = [];
      for (const file of accepted) {
        const rows = await parseInvoiceFile(file.name, file, context);
        const detectedMonth = invoiceMonthFromFileName(file.name);
        parsed.push({ name: file.name, rows, detectedMonth, month: detectedMonth || guessMonth(rows) });
      }
      setFiles(parsed);
    } catch {
      setError('Não consegui ler o arquivo. Confira se ele tem colunas de data, descrição e valor.');
    } finally {
      setLoading(false);
    }
  };

  const finalRows = useMemo(() => files.flatMap(file => file.rows.map(row => (
    file.month && file.month !== file.detectedMonth ? { ...row, invoiceMonth: file.month } : row
  ))), [files]);

  // Simula a gravação no estado atual para mostrar quantas linhas já existem.
  const preview = useMemo(() => {
    if (!finalRows.length) return { added: 0, duplicates: 0 };
    const state = getState();
    const next = financeReducer(state, { type: 'ADD_TRANSACTIONS', payload: finalRows });
    const added = next.transactions.length - state.transactions.length;
    return { added, duplicates: finalRows.length - added };
  }, [finalRows, getState]);

  const updateCategory = (id: string, categoryId: string) => {
    setFiles(previous => previous.map(file => ({
      ...file,
      rows: file.rows.map(row => row.id === id ? { ...row, categoryId, manualCategory: true, categorySource: 'manual' } : row),
    })));
  };

  const confirm = async () => {
    const result = await callTool<{ added: number; skippedDuplicates: number }>('importar_fatura', { transactions: finalRows, fileNames: files.map(file => file.name) });
    if (!result.success) {
      toast(result.message, 'error');
      return;
    }
    toast(`${result.data?.added || 0} lançamento(s) importado(s)${result.data?.skippedDuplicates ? ` · ${result.data.skippedDuplicates} já existiam` : ''}.`);
    onClose();
  };

  const onDrop = async (event: DragEvent) => {
    event.preventDefault();
    setDragActive(false);
    await processFiles(Array.from(event.dataTransfer.files));
  };

  const expenseRows = finalRows.filter(row => row.type === 'expense');
  const creditRows = finalRows.filter(row => row.type === 'income');
  const total = expenseRows.reduce((sum, row) => sum + row.amount, 0);
  const categoryName = (id: string) => categories.find(category => category.id === id)?.name || 'Outros';

  return (
    <Modal size="xl" title="Importar faturas" subtitle="CSV ou OFX do banco. Nada é gravado antes da sua confirmação." onClose={onClose} icon={<Upload size={18} />}
      footer={files.length ? (
        <>
          <button type="button" className="secondary-button" onClick={() => { setFiles([]); if (inputRef.current) inputRef.current.value = ''; }}>Escolher outros arquivos</button>
          <button type="button" className="primary-button" onClick={confirm} disabled={!preview.added}>
            {preview.added ? `Importar ${preview.added} lançamento(s)` : 'Nada novo para importar'}
          </button>
        </>
      ) : undefined}>
      {!files.length ? (
        <div
          className={`dropzone ${dragActive ? 'active' : ''}`}
          onClick={() => inputRef.current?.click()}
          onDrop={onDrop}
          onDragOver={event => { event.preventDefault(); setDragActive(true); }}
          onDragLeave={() => setDragActive(false)}
        >
          {loading ? <Loader2 size={34} className="spin" /> : <FileUp size={34} />}
          <strong>{loading ? 'Lendo arquivos…' : 'Arraste os arquivos aqui ou clique para escolher'}</strong>
          <span>Vários arquivos de uma vez. O mês da fatura é detectado pelo nome (ex.: fatura-2026-06.csv).</span>
          {error ? <span className="text-bad" style={{ display: 'flex', gap: 6, alignItems: 'center' }}><AlertCircle size={15} /> {error}</span> : null}
          <input ref={inputRef} type="file" multiple accept=".csv,.ofx" hidden onChange={(event: ChangeEvent<HTMLInputElement>) => processFiles(Array.from(event.target.files || []))} />
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 16 }}>
          <div className={`notice ${preview.added ? 'good' : 'warn'}`}>
            {preview.added ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
            <span>
              <strong>{expenseRows.length} compra(s)</strong> · {formatBRL(total)}{creditRows.length ? ` · ${creditRows.length} pagamento(s)/estorno(s)` : ''} ·{' '}
              <strong>{preview.added} novo(s)</strong>{preview.duplicates ? ` · ${preview.duplicates} já importado(s) antes (serão ignorados)` : ''}
            </span>
          </div>

          <div className="file-list">
            {files.map(file => (
              <div className="list-row bordered" key={file.name}>
                <div className="grow">
                  <span className="title">{file.name}</span>
                  <span className="subtitle">{file.rows.filter(row => row.type === 'expense').length} compra(s) · {formatBRL(file.rows.filter(row => row.type === 'expense').reduce((sum, row) => sum + row.amount, 0))}</span>
                </div>
                {file.detectedMonth ? <Badge tone="good">mês detectado</Badge> : <Badge tone="warn">confira o mês</Badge>}
                <Field label="Fatura de">
                  <input type="month" value={file.month} onChange={event => setFiles(previous => previous.map(item => item.name === file.name ? { ...item, month: event.target.value } : item))} style={{ width: 170 }} />
                </Field>
                <span className="muted nowrap" style={{ fontSize: 12 }}>{file.month ? formatInvoiceMonthLabel(file.month) : ''}</span>
              </div>
            ))}
          </div>

          <div className="table-scroll" style={{ maxHeight: 380 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Descrição</th>
                  <th className="align-right">Valor</th>
                  <th>Categoria sugerida</th>
                </tr>
              </thead>
              <tbody>
                {finalRows.slice(0, 150).map(row => (
                  <tr key={row.id}>
                    <td>{formatDate(row.date)}</td>
                    <td>{row.description} {row.installment ? <Badge>{row.installment}</Badge> : null}</td>
                    <td className={`align-right num ${row.type === 'income' ? 'text-good' : ''}`}>{row.type === 'income' ? '−' : ''}{formatBRL(row.amount)}</td>
                    <td>
                      {row.type === 'income' ? <Badge tone={row.creditKind === 'pagamento' ? 'good' : 'info'}>{row.creditKind}</Badge> : (
                        <select value={row.categoryId} onChange={event => updateCategory(row.id, event.target.value)} title={categoryName(row.categoryId)}>
                          {categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
                        </select>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {finalRows.length > 150 ? <p className="muted" style={{ margin: 0, textAlign: 'center', fontSize: 12.5 }}>Mostrando 150 de {finalRows.length}. Todos serão importados.</p> : null}
        </div>
      )}
    </Modal>
  );
}
