import { useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { CheckCircle, FileUp, Loader2, X, AlertCircle } from 'lucide-react';
import { useFinance } from '../store/FinanceContext';
import { parseCSV, parseOFX } from '../utils/csvParser';
import { formatBRL, formatDate } from '../utils/formatters';
import type { Transaction } from '../types';

export function ImportModal({ onClose }: { onClose: () => void }) {
  const { categories, addTransactions } = useFinance();
  const [parsedData, setParsedData] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processFiles = async (files: File[]) => {
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
      setError('Não consegui ler o arquivo. Confira se ele tem data, descrição e valor.');
    } finally {
      setLoading(false);
    }
  };

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    await processFiles(files);
  };

  const handleDrop = async (event: React.DragEvent) => {
    event.preventDefault();
    setDragActive(false);
    const files = Array.from(event.dataTransfer.files);
    await processFiles(files);
  };

  const handleDragOver = (event: React.DragEvent) => {
    event.preventDefault();
    setDragActive(true);
  };

  const handleDragLeave = () => {
    setDragActive(false);
  };

  const updateCategory = (id: string, categoryId: string) => {
    setParsedData(prev => prev.map(item => item.id === id ? { ...item, categoryId } : item));
  };

  const confirm = () => {
    addTransactions(parsedData);
    onClose();
  };

  const reset = () => {
    setParsedData([]);
    setError('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal large" onClick={e => e.stopPropagation()}>
        <header className="modal-header">
          <div>
            <h2>Importar faturas</h2>
            <p>CSV ou OFX - arraste ou clique para selecionar</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Fechar">
            <X size={18} />
          </button>
        </header>

        {!parsedData.length ? (
          <div 
            className={`upload-box ${dragActive ? 'drag-active' : ''}`}
            onClick={() => fileInputRef.current?.click()}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            style={dragActive ? { borderColor: 'var(--color-primary)', background: 'rgba(59, 130, 246, 0.08)' } : {}}
          >
            {loading ? (
              <>
                <Loader2 size={40} className="animate-spin" style={{ animation: 'spin 1s linear infinite' }} />
                <strong>Processando arquivos...</strong>
              </>
            ) : (
              <>
                <FileUp size={40} />
                <strong>Arraste arquivos aqui ou clique para selecionar</strong>
                <span style={{ fontSize: 13, opacity: 0.7 }}>
                  Formatos aceitos: CSV, OFX. Múltiplos arquivos permitidos.
                </span>
              </>
            )}
            {error && (
              <div style={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: 8, 
                color: 'var(--color-danger)',
                marginTop: 8
              }}>
                <AlertCircle size={16} />
                <small>{error}</small>
              </div>
            )}
            <input 
              ref={fileInputRef} 
              type="file" 
              multiple 
              accept=".csv,.ofx" 
              hidden 
              onChange={handleFileChange} 
            />
          </div>
        ) : (
          <div className="review-panel">
            <div className="success-line">
              <CheckCircle size={18} /> 
              <span>{parsedData.length} transações prontas para importar</span>
            </div>
            
            <div className="table-scroll" style={{ maxHeight: 400 }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="align-center" style={{ width: 100 }}>Data</th>
                    <th className="align-left">Descrição</th>
                    <th className="align-right" style={{ width: 120 }}>Valor</th>
                    <th className="align-center" style={{ width: 180 }}>Categoria</th>
                  </tr>
                </thead>
                <tbody>
                  {parsedData.slice(0, 200).map(item => (
                    <tr key={item.id}>
                      <td className="align-center">{formatDate(item.date)}</td>
                      <td className="align-left" style={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {item.description}
                      </td>
                      <td className="align-right" style={{ fontWeight: 500 }}>
                        {formatBRL(item.amount)}
                      </td>
                      <td className="align-center">
                        <select 
                          value={item.categoryId} 
                          onChange={e => updateCategory(item.id, e.target.value)}
                          style={{ width: '100%' }}
                        >
                          {categories.map(cat => (
                            <option key={cat.id} value={cat.id}>{cat.name}</option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            
            {parsedData.length > 200 && (
              <p className="muted" style={{ marginTop: 12, textAlign: 'center' }}>
                Mostrando os primeiros 200 registros. Todos os {parsedData.length} serão importados.
              </p>
            )}
          </div>
        )}

        <footer className="modal-footer">
          {parsedData.length > 0 && (
            <button type="button" className="secondary-button" onClick={reset}>
              Selecionar outros arquivos
            </button>
          )}
          <button type="button" className="secondary-button" onClick={onClose}>
            Cancelar
          </button>
          {parsedData.length > 0 && (
            <button type="button" className="primary-button" onClick={confirm}>
              Importar {parsedData.length} transações
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
