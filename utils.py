from __future__ import annotations

import re
from datetime import date

MONTH_MAP = {
    "jan.": 1,
    "fev.": 2,
    "mar.": 3,
    "abr.": 4,
    "mai.": 5,
    "jun.": 6,
    "jul.": 7,
    "ago.": 8,
    "set.": 9,
    "out.": 10,
    "nov.": 11,
    "dez.": 12,
}


def parse_brl_to_float(value: str) -> float:
    # Handle non-breaking spaces and other possible noise
    cleaned = value.replace("R$", "").replace("\xa0", "").replace(".", "").replace(",", ".").strip()
    return float(cleaned)


def format_brl(value: float) -> str:
    formatted = f"{value:,.2f}"
    return f"R$ {formatted}".replace(",", "X").replace(".", ",").replace("X", ".")


def parse_inter_date(date_text: str) -> date:
    match = re.fullmatch(r"(\d{2}) de ([a-z]{3}\.) (\d{4})", date_text.strip(), re.IGNORECASE)
    if not match:
        raise ValueError(f"Data fora do padrao esperado: {date_text}")

    day, month_label, year = match.groups()
    month = MONTH_MAP[month_label.lower()]
    return date(int(year), month, int(day))


def extract_installment(description: str) -> tuple[str, str | None]:
    match = re.search(r"\(Parcela\s+(\d{2})\s+de\s+(\d{2})\)", description, re.IGNORECASE)
    if not match:
        return description.strip(), None

    current, total = match.groups()
    normalized = f"{int(current)}/{int(total)}"
    cleaned_description = re.sub(r"\s*\(Parcela\s+\d{2}\s+de\s+\d{2}\)", "", description, flags=re.IGNORECASE)
    return cleaned_description.strip(), normalized


def should_keep_transaction(description: str, amount: float, is_credit: bool) -> bool:
    if is_credit or amount <= 0:
        return False

    blocked_terms = (
        "PAGAMENTO",
        "CRED COMPRA",
        "JUROS",
        "IOF",
        "ENCARGOS",
    )
    description_upper = description.upper()
    return not any(term in description_upper for term in blocked_terms)
