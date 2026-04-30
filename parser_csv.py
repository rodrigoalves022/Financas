from __future__ import annotations
import csv
import io
from dataclasses import dataclass
from utils import parse_brl_to_float, should_keep_transaction

@dataclass(slots=True)
class Transaction:
    date: str
    description: str
    amount: float
    installment: str | None
    card_suffix: str | None

def extract_transactions_csv(csv_content: str) -> list[Transaction]:
    # Remove BOM if present
    if csv_content.startswith('\ufeff'):
        csv_content = csv_content[1:]
        
    f = io.StringIO(csv_content)
    reader = csv.DictReader(f)
    
    # Normalize fieldnames: remove quotes and strip
    if reader.fieldnames:
        reader.fieldnames = [f.replace('"', '').strip() for f in reader.fieldnames]
    
    transactions: list[Transaction] = []
    
    for row in reader:
        try:
            # Try both with and without quotes just in case, though normalization should handle it
            date_str = row.get("Data") or row.get('"Data"')
            description = (row.get("Lançamento") or row.get('"Lançamento"') or row.get("Lancamento") or "").strip()
            tipo = (row.get("Tipo") or row.get('"Tipo"') or "").strip()
            valor_raw = (row.get("Valor") or row.get('"Valor"') or "").strip()
            
            if not date_str or not description or not valor_raw:
                continue
                
            # Inter CSV uses -R$ for credits/payments
            is_credit = valor_raw.startswith("-")
            # Remove negative sign for float parsing, we handle credit via is_credit flag
            amount = abs(parse_brl_to_float(valor_raw))
            
            # Check if it's an installment
            installment = None
            if "Parcela" in tipo:
                # tipo example: "Parcela 2/4"
                parts = tipo.split()
                if len(parts) >= 2:
                    installment = parts[1]
            
            if not should_keep_transaction(description, amount, is_credit):
                continue
                
            transactions.append(Transaction(
                date=date_str,
                description=description,
                amount=amount,
                installment=installment,
                card_suffix=None
            ))
        except Exception as e:
            print(f"[CSV Parser] Error parsing row {row}: {e}")
            continue
            
    return transactions
