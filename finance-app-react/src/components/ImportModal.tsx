import { useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { CheckCircle, UploadCloud, X } from 'lucide-react';
import { useFinance } from '../store/FinanceContext';
import { parseCSV, parseOFX } from '../utils/csvParser';
import { formatBRL, formatDate } from '../utils/formatters';
import type { Transaction } from '../types';

export function ImportModal({ onClose }: { onClose: () => void }) {
  const { categories, addTransactions } = useFinance();
  const [parsedData, setParsedData] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;
    setLoading(true);
    setError('');
    try {
      const rows: Transaction[] = [];
      for (const file of files) {
        if (file.name.toLowerCase().endsWith('.ofx')) {
          rows.push(...parseOFX(await file.text(), categories, file.name));
        } else {
          rows.push(...await parseCSV(file, categories, file.name));
        }
      }
      setParsedData(rows);
    } catch {
      setError('Nao consegui ler o arquivo. Confira se ele tem data, descricao e valor.');
    } finally {
      setLoading(false);
    }
  };

  const updateCategory = (id: string, categoryId: string) => {
    setParsedData(previous => previous.map(item => item.id === id ? { ...item, categoryId } : item));
  };

  const confirm = () => {
    addTransactions(parsedData);
    onClose();
  };

  return (
    <div className="modal-backdrop">
      <div className="modal large">
        <header className="modal-header">
          <div>
            <h2>Importar faturas</h2>
            <p>CSV ou OFX, varios arquivos de uma vez. Sem categoria vira Outros automaticamente.</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose}><X size={18} /></button>
        </header>

        {!parsedData.length ? (
          <div className="upload-box" onClick={() => fileInputRef.current?.click()}>
            <UploadCloud size={42} />
            <strong>{loading ? 'Lendo arquivos...' : 'Clique para selecionar CSV/OFX'}</strong>
            <span>Colunas esperadas: data, descricao, valor, categoria opcional.</span>
            {error ? <small className="error-text">{error}</small> : null}
            <input ref={fileInputRef} type="file" multiple accept=".csv,.ofx" hidden onChange={handleFileChange} />
          </div>
        ) : (
          <div className="review-panel">
            <div className="success-line"><CheckCircle size={18} /> {parsedData.length} transacoes prontas para revisar.</div>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="align-center">Data</th>
                    <th>Descricao</th>
                    <th className="align-right">Valor</th>
                    <th className="align-center">Categoria</th>
                  </tr>
                </thead>
                <tbody>
                  {parsedData.slice(0, 200).map(item => (
                    <tr key={item.id}>
                      <td className="align-center">{formatDate(item.date)}</td>
                      <td>{item.description}</td>
                      <td className="align-right">{formatBRL(item.amount)}</td>
                      <td className="align-center">
                        <select value={item.categoryId} onChange={event => updateCategory(item.id, event.target.value)}>
                          {categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {parsedData.length > 200 ? <p className="muted">Mostrando os primeiros 200 registros na revisao.</p> : null}
          </div>
        )}

        <footer className="modal-footer">
          <button type="button" className="secondary-button" onClick={onClose}>Cancelar</button>
          {parsedData.length ? <button type="button" className="primary-button" onClick={confirm}>Confirmar importacao</button> : null}
        </footer>
      </div>
    </div>
  );
}
