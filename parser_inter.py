from __future__ import annotations

import io
import re
from dataclasses import asdict, dataclass
from typing import Iterable

import pandas as pd
import pdfplumber

from utils import extract_installment, parse_brl_to_float, parse_inter_date, should_keep_transaction

DATE_PATTERN = r"\d{2} de [a-z]{3}\. \d{4}"
LINE_PATTERNS = (
    re.compile(
        rf"^(?P<date>{DATE_PATTERN})\s+(?P<description>.+?)\s+-\s+(?P<credit>\+ )?R\$ (?P<amount>[\d\.,]+)$",
        re.IGNORECASE,
    ),
    re.compile(
        rf"^(?P<date>{DATE_PATTERN})\s+(?P<description>.+?)\s+(?P<credit>\+ )?R\$ (?P<amount>[\d\.,]+)$",
        re.IGNORECASE,
    ),
)


@dataclass(slots=True)
class Transaction:
    date: str
    description: str
    amount: float
    installment: str | None
    card_suffix: str | None


def extract_text_from_pdf(pdf_bytes: bytes) -> str:
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        return "\n".join((page.extract_text() or "") for page in pdf.pages)


def extract_transactions(pdf_bytes: bytes) -> list[Transaction]:
    text = extract_text_from_pdf(pdf_bytes)
    lines = [line.strip() for line in text.splitlines() if line.strip()]

    transactions: list[Transaction] = []
    current_card_suffix: str | None = None

    for line in lines:
        card_match = re.match(r"^CARTAO?\s+2306\*{4}(\d{4})$", line, re.IGNORECASE)
        if not card_match:
            card_match = re.match(r"^CARTÃO\s+2306\*{4}(\d{4})$", line, re.IGNORECASE)
        if card_match:
            current_card_suffix = card_match.group(1)
            continue

        if line.startswith("Total CARTÃO"):
            current_card_suffix = None
            continue

        match = _match_transaction_line(line)
        if not match:
            continue

        raw_description = match.group("description").strip()
        description, installment = extract_installment(raw_description)
        amount = parse_brl_to_float(match.group("amount"))
        is_credit = bool(match.group("credit"))

        if not should_keep_transaction(description, amount, is_credit):
            continue

        parsed_date = parse_inter_date(match.group("date"))
        transactions.append(
            Transaction(
                date=parsed_date.strftime("%d/%m/%Y"),
                description=description,
                amount=amount,
                installment=installment,
                card_suffix=current_card_suffix,
            )
        )

    return transactions


def transactions_to_dataframe(transactions: Iterable[Transaction]) -> pd.DataFrame:
    rows = [asdict(transaction) for transaction in transactions]
    if not rows:
        return pd.DataFrame(columns=["date", "description", "amount", "installment", "card_suffix"])

    dataframe = pd.DataFrame(rows)
    dataframe = dataframe.rename(
        columns={
            "date": "data",
            "description": "descricao",
            "amount": "valor",
            "installment": "parcela",
            "card_suffix": "cartao_final",
        }
    )
    dataframe["parcela"] = dataframe["parcela"].fillna("")
    dataframe["cartao_final"] = dataframe["cartao_final"].fillna("")
    return dataframe


def _match_transaction_line(line: str) -> re.Match[str] | None:
    for pattern in LINE_PATTERNS:
        match = pattern.match(line)
        if match:
            return match
    return None
