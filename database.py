"""SQLite database management for the personal finance dashboard."""
from __future__ import annotations

import sqlite3
import re
from contextlib import contextmanager
from datetime import date as date_type, datetime
from dateutil.relativedelta import relativedelta
from decimal import Decimal, ROUND_HALF_UP
from calendar import month_name
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent / "financas.db"
REFERENCE_MONTH_RE = re.compile(r"(20\d{2})[-_](0[1-9]|1[0-2])")

CATEGORIAS_PADRAO = [
    ("Bebida Alcoólica", "🍺", "#f59e0b"),
    ("Posto de Gasolina", "⛽", "#ef4444"),
    ("Supermercado", "🛒", "#10b981"),
    ("Alimentação / Restaurante", "🍔", "#f97316"),
    ("Farmácia / Saúde", "💊", "#ec4899"),
    ("Entretenimento / Lazer", "🎮", "#8b5cf6"),
    ("Vestuário", "👕", "#6366f1"),
    ("Assinaturas / Streaming", "📱", "#3b82f6"),
    ("Casa / Moradia", "🏠", "#14b8a6"),
    ("Transporte", "🚗", "#64748b"),
    ("Educação", "📚", "#a855f7"),
    ("Academia", "🏋️", "#06b6d4"),
    ("PIX via Crédito", "💸", "#10b981"),
    ("Outros", "💳", "#6b7280"),
]


@contextmanager
def get_db():
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db():
    with get_db() as db:
        db.executescript("""
            CREATE TABLE IF NOT EXISTS categorias (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                nome TEXT NOT NULL UNIQUE,
                emoji TEXT DEFAULT '💳',
                cor TEXT DEFAULT '#6b7280'
            );
            CREATE TABLE IF NOT EXISTS transacoes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                data TEXT NOT NULL,
                descricao TEXT NOT NULL,
                valor REAL NOT NULL,
                parcela TEXT DEFAULT '',
                cartao_final TEXT DEFAULT '',
                categoria_id INTEGER,
                fatura_origem TEXT,
                projetado INTEGER DEFAULT 0,
                FOREIGN KEY (categoria_id) REFERENCES categorias(id)
            );
            CREATE TABLE IF NOT EXISTS regras_categoria (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                palavra_chave TEXT NOT NULL UNIQUE,
                categoria_id INTEGER NOT NULL,
                FOREIGN KEY (categoria_id) REFERENCES categorias(id)
            );
            CREATE TABLE IF NOT EXISTS receitas (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                data TEXT NOT NULL,
                descricao TEXT NOT NULL,
                valor REAL NOT NULL,
                tipo TEXT DEFAULT 'Outros'
            );
            CREATE TABLE IF NOT EXISTS dividas (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                pessoa TEXT NOT NULL,
                descricao TEXT DEFAULT '',
                valor REAL NOT NULL,
                data TEXT NOT NULL,
                pago INTEGER DEFAULT 0,
                data_pagamento TEXT
            );
            CREATE TABLE IF NOT EXISTS aliases (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                descricao_original TEXT NOT NULL UNIQUE,
                alias TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS pessoas (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                nome TEXT NOT NULL UNIQUE,
                titular INTEGER DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS divisoes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                transacao_id INTEGER NOT NULL,
                descricao TEXT DEFAULT '',
                pagador_id INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (transacao_id) REFERENCES transacoes(id),
                FOREIGN KEY (pagador_id) REFERENCES pessoas(id)
            );
            CREATE TABLE IF NOT EXISTS divisao_participantes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                divisao_id INTEGER NOT NULL,
                pessoa_id INTEGER NOT NULL,
                valor REAL NOT NULL,
                pago INTEGER DEFAULT 0,
                FOREIGN KEY (divisao_id) REFERENCES divisoes(id),
                FOREIGN KEY (pessoa_id) REFERENCES pessoas(id)
            );
            CREATE TABLE IF NOT EXISTS arquivos_importados (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                arquivo_nome TEXT NOT NULL,
                arquivo_hash TEXT NOT NULL UNIQUE,
                imported_at TEXT NOT NULL,
                transacoes_importadas INTEGER DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS orcamentos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                categoria_id INTEGER NOT NULL UNIQUE,
                valor_limite REAL NOT NULL,
                FOREIGN KEY (categoria_id) REFERENCES categorias(id)
            );
        """)
        # Migrations
        for col, default, typ in [
            ("projetado", "0", "INTEGER"),
            ("responsavel_id", "NULL", "INTEGER"),
            ("ignorado", "0", "INTEGER"),
            ("nota", "NULL", "TEXT"),
            ("mes_referencia", "''", "TEXT"),
        ]:
            try:
                db.execute(f"ALTER TABLE transacoes ADD COLUMN {col} {typ} DEFAULT {default}")
            except Exception:
                pass
        try:
            db.execute("ALTER TABLE receitas ADD COLUMN recorrente INTEGER DEFAULT 0")
        except Exception:
            pass
        db.executescript("""
            CREATE INDEX IF NOT EXISTS idx_transacoes_data ON transacoes(data);
            CREATE INDEX IF NOT EXISTS idx_transacoes_mes_ref ON transacoes(mes_referencia);
            CREATE INDEX IF NOT EXISTS idx_transacoes_categoria ON transacoes(categoria_id);
            CREATE INDEX IF NOT EXISTS idx_transacoes_fatura ON transacoes(fatura_origem);
            CREATE INDEX IF NOT EXISTS idx_transacoes_cartao ON transacoes(cartao_final);
            CREATE INDEX IF NOT EXISTS idx_aliases_original ON aliases(descricao_original);
        """)
        rows = db.execute(
            "SELECT id, data, fatura_origem FROM transacoes WHERE COALESCE(mes_referencia, '') = ''"
        ).fetchall()
        for row in rows:
            db.execute(
                "UPDATE transacoes SET mes_referencia = ? WHERE id = ?",
                (infer_reference_month(row["fatura_origem"], row["data"]), row["id"]),
            )
        db.execute(
            "UPDATE transacoes SET mes_referencia = SUBSTR(data,7,4)||'-'||SUBSTR(data,4,2) WHERE projetado = 1"
        )
        for nome, emoji, cor in CATEGORIAS_PADRAO:
            db.execute(
                "INSERT OR IGNORE INTO categorias (nome, emoji, cor) VALUES (?, ?, ?)",
                (nome, emoji, cor),
            )


def _parse_mes(mes):
    if not mes:
        return None, None
    parts = mes.split("-")
    if len(parts) != 2:
        return None, None
    return parts[0], parts[1]


def infer_reference_month(fatura_origem, transaction_date=None):
    if fatura_origem:
        match = REFERENCE_MONTH_RE.search(str(fatura_origem))
        if match:
            return f"{match.group(1)}-{match.group(2)}"
    return reference_month_from_date(transaction_date)


def reference_month_from_date(transaction_date):
    if transaction_date and len(transaction_date) == 10:
        return f"{transaction_date[6:10]}-{transaction_date[3:5]}"
    return ""


_MESES_PT = {
    1: 'Janeiro', 2: 'Fevereiro', 3: 'Março', 4: 'Abril',
    5: 'Maio', 6: 'Junho', 7: 'Julho', 8: 'Agosto',
    9: 'Setembro', 10: 'Outubro', 11: 'Novembro', 12: 'Dezembro',
}


def _to_mes_label(mes_sort):
    if not mes_sort:
        return ""
    year, month = mes_sort.split("-")
    return f"{_MESES_PT[int(month)]}/{year}"


def _real_clause(prefix=""):
    cm = date_type.today().strftime("%Y-%m")
    ref = f"COALESCE(NULLIF({prefix}mes_referencia, ''), SUBSTR({prefix}data,7,4)||'-'||SUBSTR({prefix}data,4,2))"
    return f"({prefix}projetado = 0 OR ({prefix}projetado = 1 AND {ref} < '{cm}'))"


def _proj_clause(prefix=""):
    cm = date_type.today().strftime("%Y-%m")
    ref = f"COALESCE(NULLIF({prefix}mes_referencia, ''), SUBSTR({prefix}data,7,4)||'-'||SUBSTR({prefix}data,4,2))"
    return f"({prefix}projetado = 1 AND {ref} >= '{cm}')"


def _base_where(alias="t", incluir_projetadas=True, incluir_ignoradas=False):
    prefix = f"{alias}." if alias else ""
    clauses = ["1=1"]
    if not incluir_projetadas:
        clauses.append(_real_clause(prefix))
    if not incluir_ignoradas:
        clauses.append(f"COALESCE({prefix}ignorado, 0) = 0")
    return clauses


def _append_mes_filter(clauses, params, mes, field):
    year, month = _parse_mes(mes)
    if year and month:
        clauses.append(f"{field} LIKE ?")
        params.append(f"%/{month}/{year}")


def _resumo_periodo(db, mes):
    clauses = _base_where(alias="", incluir_projetadas=False, incluir_ignoradas=False)
    params = []
    year, month = _parse_mes(mes)
    if year and month:
        clauses.append("mes_referencia = ?")
        params.append(f"{year}-{month}")
    total_desp = db.execute(
        f"SELECT COALESCE(SUM(valor), 0) AS total FROM transacoes WHERE {' AND '.join(clauses)}",
        params,
    ).fetchone()["total"]
    total_tx = db.execute(
        f"SELECT COUNT(*) AS total FROM transacoes WHERE {' AND '.join(clauses)}",
        params,
    ).fetchone()["total"]
    total_rec = db.execute(
        "SELECT COALESCE(SUM(valor), 0) AS total FROM receitas WHERE (? IS NULL OR data LIKE ?)",
        (mes, f"{mes}%" if mes else None),
    ).fetchone()["total"]
    return {
        "mes": mes,
        "label": _to_mes_label(mes) if mes else "Todo periodo",
        "despesas": total_desp,
        "receitas": total_rec,
        "saldo": total_rec - total_desp,
        "quantidade": total_tx,
    }


def _resumo_intervalo(db, mes_inicio, mes_fim):
    clauses = _base_where(alias="", incluir_projetadas=False, incluir_ignoradas=False)
    clauses.append("mes_referencia BETWEEN ? AND ?")
    params = [mes_inicio, mes_fim]
    total_desp = db.execute(
        f"SELECT COALESCE(SUM(valor), 0) AS total FROM transacoes WHERE {' AND '.join(clauses)}",
        params,
    ).fetchone()["total"]
    total_tx = db.execute(
        f"SELECT COUNT(*) AS total FROM transacoes WHERE {' AND '.join(clauses)}",
        params,
    ).fetchone()["total"]
    total_rec = db.execute(
        "SELECT COALESCE(SUM(valor), 0) AS total FROM receitas WHERE SUBSTR(data,1,7) BETWEEN ? AND ?",
        (mes_inicio, mes_fim),
    ).fetchone()["total"]
    return {
        "mes": f"{mes_inicio}:{mes_fim}",
        "label": f"{_to_mes_label(mes_inicio)} a {_to_mes_label(mes_fim)}",
        "despesas": total_desp,
        "receitas": total_rec,
        "saldo": total_rec - total_desp,
        "quantidade": total_tx,
    }


def _add_mes_filter(sql, params, field, mes=None, mes_inicio=None, mes_fim=None):
    if mes_inicio and mes_fim:
        sql += f" AND {field} BETWEEN ? AND ?"
        params.extend([mes_inicio, mes_fim])
    else:
        year, month = _parse_mes(mes)
        if year and month:
            sql += f" AND {field} = ?"
            params.append(f"{year}-{month}")
    return sql


# ──────────────────────── Categorias ────────────────────────

def listar_categorias():
    with get_db() as db:
        return [dict(r) for r in db.execute("SELECT * FROM categorias ORDER BY nome").fetchall()]


def criar_categoria(nome, emoji="💳", cor="#6b7280"):
    with get_db() as db:
        cur = db.execute("INSERT INTO categorias (nome, emoji, cor) VALUES (?, ?, ?)", (nome, emoji, cor))
        return cur.lastrowid


# ──────────────────────── Transações ────────────────────────

def _aplicar_regras_desc(db_conn, descricao):
    regras = db_conn.execute("SELECT palavra_chave, categoria_id FROM regras_categoria").fetchall()
    
    # Busca se já existe um apelido para essa descrição para aumentar a chance de match
    alias_row = db_conn.execute("SELECT alias FROM aliases WHERE UPPER(descricao_original) = UPPER(?)", (descricao,)).fetchone()
    
    desc_to_check = descricao.upper()
    if alias_row and alias_row["alias"]:
        desc_to_check += " " + alias_row["alias"].upper()
        
    for r in regras:
        if r["palavra_chave"].upper() in desc_to_check:
            return r["categoria_id"]
    return None


def _parse_parcela(parcela_str):
    """Parse '2/5' -> (atual=2, total=5). Returns (None, None) if not a parcel."""
    if not parcela_str:
        return None, None
    parts = parcela_str.split("/")
    if len(parts) == 2:
        try:
            return int(parts[0]), int(parts[1])
        except ValueError:
            pass
    return None, None


def _projetar_parcelas(db, t, fatura_origem, cat_id):
    """Given a transaction with installment info, project future months."""
    atual, total = _parse_parcela(t.installment)
    if atual is None or total is None or total <= 1:
        return 0

    # Parse the base date from dd/mm/yyyy
    try:
        base_date = datetime.strptime(t.date, "%d/%m/%Y")
    except ValueError:
        return 0

    created = 0
    for i in range(1, total - atual + 1):
        future_date = base_date + relativedelta(months=i)
        future_date_str = future_date.strftime("%d/%m/%Y")
        parcela_str = f"{atual + i}/{total}"
        # Check if this projected parcel already exists
        dup = db.execute(
            """SELECT COUNT(*) FROM transacoes
               WHERE descricao = ? AND parcela = ? AND projetado = 1""",
            (t.description, parcela_str)
        ).fetchone()[0]
        if dup > 0:
            continue
        db.execute(
            """INSERT INTO transacoes
               (data, descricao, valor, parcela, cartao_final, categoria_id, fatura_origem, mes_referencia, projetado)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)""",
            (future_date_str, t.description, t.amount, parcela_str,
             t.card_suffix or "", cat_id, fatura_origem, reference_month_from_date(future_date_str)),
        )
        created += 1
    return created


def inserir_transacoes(transacoes, fatura_origem, arquivo_hash=None):
    with get_db() as db:
        if arquivo_hash:
            existente_hash = db.execute(
                "SELECT arquivo_nome, transacoes_importadas FROM arquivos_importados WHERE arquivo_hash = ?",
                (arquivo_hash,),
            ).fetchone()
            if existente_hash:
                return {
                    "status": "duplicado",
                    "existentes": existente_hash["transacoes_importadas"],
                    "arquivo": existente_hash["arquivo_nome"],
                    "motivo": "hash",
                }

        existente = db.execute(
            "SELECT COUNT(*) FROM transacoes WHERE fatura_origem = ? AND projetado = 0",
            (fatura_origem,)
        ).fetchone()[0]
        if existente > 0:
            return {"status": "duplicado", "existentes": existente, "arquivo": fatura_origem, "motivo": "nome"}
        importadas = 0
        projetadas = 0
        for t in transacoes:
            cat_id = _aplicar_regras_desc(db, t.description)
            db.execute(
                """INSERT INTO transacoes
                   (data, descricao, valor, parcela, cartao_final, categoria_id, fatura_origem, mes_referencia, projetado)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)""",
                (t.date, t.description, t.amount, t.installment or "",
                 t.card_suffix or "", cat_id, fatura_origem, infer_reference_month(fatura_origem, t.date)),
            )
            importadas += 1
            projetadas += _projetar_parcelas(db, t, fatura_origem, cat_id)
        if arquivo_hash:
            db.execute(
                """INSERT INTO arquivos_importados
                   (arquivo_nome, arquivo_hash, imported_at, transacoes_importadas)
                   VALUES (?, ?, ?, ?)""",
                (fatura_origem, arquivo_hash, datetime.now().isoformat(), importadas),
            )
        return {"status": "ok", "importadas": importadas, "projetadas": projetadas}


def listar_transacoes(
    mes=None,
    mes_inicio=None,
    mes_fim=None,
    categoria_id=None,
    busca=None,
    incluir_projetadas=True,
    cartao_final=None,
    somente_parceladas=False,
    valor_min=None,
    valor_max=None,
    incluir_ignoradas=False,
    somente_recorrentes=False,
    responsavel_id=None,
):
    with get_db() as db:
        sql = """SELECT t.*,
                        c.nome AS categoria_nome, c.emoji AS categoria_emoji, c.cor AS categoria_cor,
                        a.alias AS alias,
                        p.nome AS responsavel_nome
                 FROM transacoes t
                 LEFT JOIN categorias c ON t.categoria_id = c.id
                 LEFT JOIN aliases a ON UPPER(a.descricao_original) = UPPER(t.descricao)
                 LEFT JOIN pessoas p ON t.responsavel_id = p.id
                 WHERE 1=1"""
        params = []
        if not incluir_projetadas:
            sql += " AND t.projetado = 0"
        if not incluir_ignoradas:
            sql += " AND COALESCE(t.ignorado, 0) = 0"
        sql = _add_mes_filter(sql, params, "t.mes_referencia", mes, mes_inicio, mes_fim)
        if categoria_id:
            if categoria_id == "sem":
                sql += " AND t.categoria_id IS NULL"
            else:
                sql += " AND t.categoria_id = ?"
                params.append(int(categoria_id))
        if cartao_final:
            sql += " AND t.cartao_final = ?"
            params.append(str(cartao_final))
        if responsavel_id:
            sql += " AND t.responsavel_id = ?"
            params.append(int(responsavel_id))
        if somente_parceladas:
            sql += " AND COALESCE(t.parcela, '') <> ''"
        if valor_min not in (None, ""):
            sql += " AND t.valor >= ?"
            params.append(float(valor_min))
        if valor_max not in (None, ""):
            sql += " AND t.valor <= ?"
            params.append(float(valor_max))
        if busca:
            sql += " AND (UPPER(t.descricao) LIKE UPPER(?) OR UPPER(COALESCE(a.alias,'')) LIKE UPPER(?))"
            params.extend([f"%{busca}%", f"%{busca}%"])
        if somente_recorrentes:
            sql += """ AND t.descricao IN (
                        SELECT descricao
                        FROM transacoes
                        WHERE projetado = 0 AND COALESCE(ignorado, 0) = 0
                        GROUP BY descricao
                        HAVING COUNT(DISTINCT COALESCE(NULLIF(mes_referencia, ''), SUBSTR(data,7,4)||'-'||SUBSTR(data,4,2))) >= 2
                    )"""
        sql += " ORDER BY SUBSTR(t.data,7,4)||SUBSTR(t.data,4,2)||SUBSTR(t.data,1,2) DESC, t.id DESC"
        rows = [dict(r) for r in db.execute(sql, params).fetchall()]
        # Check if transaction has an active split
        for row in rows:
            row['tem_divisao'] = db.execute(
                "SELECT COUNT(*) FROM divisoes WHERE transacao_id = ?", (row['id'],)
            ).fetchone()[0] > 0
            row['flags'] = []
            if not row.get("categoria_id"):
                row["flags"].append("sem_categoria")
            if not row.get("alias"):
                row["flags"].append("sem_alias")
            if row.get("parcela"):
                row["flags"].append("parcelada")
            if row.get("ignorado"):
                row["flags"].append("ignorada")
        return rows


def atualizar_categoria_transacao(tid, cat_id):
    with get_db() as db:
        db.execute("UPDATE transacoes SET categoria_id = ? WHERE id = ?",
                   (cat_id if cat_id else None, tid))


def atualizar_responsavel_transacao(tid, pessoa_id):
    with get_db() as db:
        db.execute("UPDATE transacoes SET responsavel_id = ? WHERE id = ?",
                   (pessoa_id if pessoa_id else None, tid))


def atualizar_ignorado_transacao(tid, ignorado):
    with get_db() as db:
        db.execute(
            "UPDATE transacoes SET ignorado = ? WHERE id = ?",
            (1 if ignorado else 0, tid),
        )


def atualizar_nota_transacao(tid, nota):
    with get_db() as db:
        db.execute("UPDATE transacoes SET nota = ? WHERE id = ?",
                   (nota.strip() if nota else None, tid))


def batch_categorizar(ids, categoria_id):
    """Set categoria for multiple transactions at once."""
    with get_db() as db:
        for tid in ids:
            db.execute("UPDATE transacoes SET categoria_id = ? WHERE id = ?",
                       (int(categoria_id) if categoria_id else None, int(tid)))
    return len(ids)


def listar_cartoes():
    with get_db() as db:
        rows = db.execute(
            """SELECT DISTINCT cartao_final
               FROM transacoes
               WHERE COALESCE(cartao_final, '') <> ''
               ORDER BY cartao_final"""
        ).fetchall()
        return [row["cartao_final"] for row in rows]


# ──────────────────────── Orçamentos ────────────────────────

def listar_orcamentos():
    with get_db() as db:
        return [dict(r) for r in db.execute(
            """SELECT o.*, c.nome AS categoria_nome, c.emoji AS categoria_emoji, c.cor AS categoria_cor
               FROM orcamentos o JOIN categorias c ON o.categoria_id = c.id
               ORDER BY c.nome"""
        ).fetchall()]


def salvar_orcamento(categoria_id, valor_limite):
    with get_db() as db:
        db.execute(
            """INSERT INTO orcamentos (categoria_id, valor_limite) VALUES (?, ?)
               ON CONFLICT(categoria_id) DO UPDATE SET valor_limite = excluded.valor_limite""",
            (int(categoria_id), float(valor_limite)),
        )


def deletar_orcamento(oid):
    with get_db() as db:
        db.execute("DELETE FROM orcamentos WHERE id = ?", (oid,))


def get_orcamentos_status(mes=None):
    """Return each budget with current spending for the period."""
    with get_db() as db:
        orcamentos = [dict(r) for r in db.execute(
            """SELECT o.id, o.valor_limite,
                      c.id AS categoria_id, c.nome AS categoria_nome,
                      c.emoji AS categoria_emoji, c.cor AS categoria_cor
               FROM orcamentos o JOIN categorias c ON o.categoria_id = c.id
               ORDER BY c.nome"""
        ).fetchall()]
        result = []
        for o in orcamentos:
            params = [o["categoria_id"]]
            where = "categoria_id = ? AND projetado = 0 AND COALESCE(ignorado,0) = 0"
            year, month = _parse_mes(mes)
            if year and month:
                where += " AND mes_referencia = ?"
                params.append(f"{year}-{month}")
            gasto = db.execute(
                f"SELECT COALESCE(SUM(valor),0) AS t FROM transacoes WHERE {where}", params
            ).fetchone()["t"]
            pct = round(gasto / o["valor_limite"] * 100, 1) if o["valor_limite"] else 0
            result.append({**o, "gasto": gasto, "percentual": pct,
                           "status": "critico" if pct >= 100 else "alerta" if pct >= 80 else "ok"})
        return result



def listar_faturas():
    with get_db() as db:
        rows = db.execute(
            """
            WITH historico AS (
                SELECT ai.arquivo_nome AS arquivo_nome,
                       ai.arquivo_hash AS arquivo_hash,
                       ai.imported_at AS imported_at,
                       ai.transacoes_importadas AS transacoes_importadas
                FROM arquivos_importados ai
                UNION
                SELECT t.fatura_origem AS arquivo_nome,
                       '' AS arquivo_hash,
                       MIN(t.data) AS imported_at,
                       COUNT(*) AS transacoes_importadas
                FROM transacoes t
                WHERE COALESCE(t.fatura_origem, '') <> ''
                  AND t.fatura_origem NOT IN (SELECT arquivo_nome FROM arquivos_importados)
                GROUP BY t.fatura_origem
            )
            SELECT h.arquivo_nome,
                   h.arquivo_hash,
                   h.imported_at,
                   h.transacoes_importadas,
                   COALESCE(SUM(CASE WHEN t.projetado = 0 THEN t.valor ELSE 0 END), 0) AS total_real,
                   COALESCE(SUM(CASE WHEN t.projetado = 1 THEN t.valor ELSE 0 END), 0) AS total_projetado,
                   COALESCE(COUNT(CASE WHEN t.projetado = 0 THEN 1 END), 0) AS qtd_real,
                   COALESCE(MAX(SUBSTR(t.data,7,4)||'-'||SUBSTR(t.data,4,2)), '') AS mes_ref
            FROM historico h
            LEFT JOIN transacoes t ON t.fatura_origem = h.arquivo_nome
            GROUP BY h.arquivo_nome, h.arquivo_hash, h.imported_at, h.transacoes_importadas
            ORDER BY h.imported_at DESC
            """
        ).fetchall()
        result = []
        for row in rows:
            item = dict(row)
            item["mes_label"] = _to_mes_label(item["mes_ref"])
            result.append(item)
        return result


def get_review_data():
    with get_db() as db:
        base_where = "t.projetado = 0 AND COALESCE(t.ignorado, 0) = 0"
        sem_categoria = db.execute(
            f"SELECT COUNT(*) AS total FROM transacoes t WHERE {base_where} AND t.categoria_id IS NULL"
        ).fetchone()["total"]
        sem_alias = db.execute(
            f"""SELECT COUNT(*) AS total
                FROM transacoes t
                LEFT JOIN aliases a ON UPPER(a.descricao_original) = UPPER(t.descricao)
                WHERE {base_where} AND a.id IS NULL"""
        ).fetchone()["total"]
        parceladas = db.execute(
            f"SELECT COUNT(*) AS total FROM transacoes t WHERE {base_where} AND COALESCE(t.parcela, '') <> ''"
        ).fetchone()["total"]
        recorrentes = db.execute(
            """
            SELECT COUNT(*) AS total
            FROM (
                SELECT descricao
                FROM transacoes
                WHERE projetado = 0 AND COALESCE(ignorado, 0) = 0
                GROUP BY descricao
                HAVING COUNT(DISTINCT SUBSTR(data, 4, 7)) >= 2
            )
            """
        ).fetchone()["total"]
        pendentes = db.execute(
            """
            SELECT t.id, t.data, t.mes_referencia, t.descricao, t.valor, t.parcela, t.cartao_final,
                   t.categoria_id, COALESCE(a.alias, '') AS alias
            FROM transacoes t
            LEFT JOIN aliases a ON UPPER(a.descricao_original) = UPPER(t.descricao)
            WHERE t.projetado = 0
              AND COALESCE(t.ignorado, 0) = 0
              AND (t.categoria_id IS NULL OR a.id IS NULL)
            ORDER BY (t.categoria_id IS NULL) DESC, (a.id IS NULL) DESC, t.valor DESC, t.data DESC
            LIMIT 30
            """
        ).fetchall()
        maiores = db.execute(
            """
            SELECT t.data, COALESCE(a.alias, t.descricao) AS nome_exibido, t.valor
            FROM transacoes t
            LEFT JOIN aliases a ON UPPER(a.descricao_original) = UPPER(t.descricao)
            WHERE t.projetado = 0 AND COALESCE(t.ignorado, 0) = 0
            ORDER BY t.valor DESC
            LIMIT 10
            """
        ).fetchall()
        recorrencias = db.execute(
            """
            SELECT COALESCE(a.alias, t.descricao) AS nome_exibido,
                   t.descricao,
                   COUNT(*) AS quantidade,
                   COUNT(DISTINCT SUBSTR(t.data, 4, 7)) AS meses,
                   ROUND(AVG(t.valor), 2) AS valor_medio,
                   ROUND(SUM(t.valor), 2) AS total
            FROM transacoes t
            LEFT JOIN aliases a ON UPPER(a.descricao_original) = UPPER(t.descricao)
            WHERE t.projetado = 0 AND COALESCE(t.ignorado, 0) = 0
            GROUP BY t.descricao
            HAVING COUNT(DISTINCT SUBSTR(t.data, 4, 7)) >= 2
            ORDER BY meses DESC, total DESC
            LIMIT 12
            """
        ).fetchall()
        return {
            "contadores": {
                "sem_categoria": sem_categoria,
                "sem_alias": sem_alias,
                "parceladas": parceladas,
                "recorrentes": recorrentes,
            },
            "pendentes": [dict(row) for row in pendentes],
            "maiores": [dict(row) for row in maiores],
            "recorrencias": [dict(row) for row in recorrencias],
        }


# ──────────────────────── Pessoas ────────────────────────

def listar_pessoas():
    with get_db() as db:
        return [dict(r) for r in db.execute(
            "SELECT * FROM pessoas ORDER BY titular DESC, nome").fetchall()]


def criar_pessoa(nome, titular=False):
    with get_db() as db:
        cur = db.execute("INSERT INTO pessoas (nome, titular) VALUES (?, ?)",
                         (nome.strip(), int(titular)))
        return cur.lastrowid


def deletar_pessoa(pid):
    with get_db() as db:
        db.execute("DELETE FROM divisao_participantes WHERE pessoa_id = ?", (pid,))
        db.execute("UPDATE transacoes SET responsavel_id = NULL WHERE responsavel_id = ?", (pid,))
        db.execute("DELETE FROM pessoas WHERE id = ?", (pid,))


# ──────────────────────── Divisões ────────────────────────

def criar_divisao(transacao_id, descricao, participantes_ids, pagador_id):
    with get_db() as db:
        tx = db.execute("SELECT valor FROM transacoes WHERE id = ?",
                        (transacao_id,)).fetchone()
        if not tx:
            return None
        if not participantes_ids:
            return None

        total_centavos = int(
            (
                Decimal(str(tx["valor"])) * Decimal("100")
            ).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
        )
        base_centavos = total_centavos // len(participantes_ids)
        resto_centavos = total_centavos % len(participantes_ids)
        # Se já existir uma divisão para essa transação, removemos para substituir pela nova
        existente = db.execute("SELECT id FROM divisoes WHERE transacao_id = ?", (transacao_id,)).fetchone()
        if existente:
            db.execute("DELETE FROM divisao_participantes WHERE divisao_id = ?", (existente["id"],))
            db.execute("DELETE FROM divisoes WHERE id = ?", (existente["id"],))

        now = datetime.now().isoformat()
        cur = db.execute(
            "INSERT INTO divisoes (transacao_id, descricao, pagador_id, created_at) VALUES (?,?,?,?)",
            (transacao_id, descricao, pagador_id, now),
        )
        did = cur.lastrowid
        for index, pid in enumerate(participantes_ids):
            valor_centavos = base_centavos + (1 if index < resto_centavos else 0)
            valor_cada = float(Decimal(valor_centavos) / Decimal("100"))
            pago = 1 if int(pid) == int(pagador_id) else 0
            db.execute(
                "INSERT INTO divisao_participantes (divisao_id, pessoa_id, valor, pago) VALUES (?,?,?,?)",
                (did, int(pid), valor_cada, pago),
            )
        return did


def get_divisao_por_transacao(tid):
    with get_db() as db:
        d = db.execute("SELECT * FROM divisoes WHERE transacao_id = ?", (tid,)).fetchone()
        if not d:
            return None
        d = dict(d)
        parts = db.execute("SELECT pessoa_id FROM divisao_participantes WHERE divisao_id = ?", (d["id"],)).fetchall()
        d["participantes_ids"] = [p["pessoa_id"] for p in parts]
        return d


def listar_divisoes():
    with get_db() as db:
        divs = [dict(r) for r in db.execute("""
            SELECT d.*, t.descricao AS tx_descricao, t.valor AS tx_valor, t.data AS tx_data,
                   ps.nome AS pagador_nome, COALESCE(a.alias, t.descricao) AS tx_nome
            FROM divisoes d
            JOIN transacoes t ON d.transacao_id = t.id
            JOIN pessoas ps ON d.pagador_id = ps.id
            LEFT JOIN aliases a ON UPPER(a.descricao_original)=UPPER(t.descricao)
            ORDER BY d.created_at DESC
        """).fetchall()]
        for d in divs:
            d['participantes'] = [dict(r) for r in db.execute("""
                SELECT dp.*, p.nome AS pessoa_nome
                FROM divisao_participantes dp JOIN pessoas p ON dp.pessoa_id = p.id
                WHERE dp.divisao_id = ? ORDER BY p.nome
            """, (d['id'],)).fetchall()]
        return divs


def deletar_divisao(did):
    with get_db() as db:
        db.execute("DELETE FROM divisao_participantes WHERE divisao_id = ?", (did,))
        db.execute("DELETE FROM divisoes WHERE id = ?", (did,))


def marcar_participante_pago(part_id):
    with get_db() as db:
        db.execute("UPDATE divisao_participantes SET pago = 1 WHERE id = ?", (part_id,))


def get_resumo_pessoas():
    """Aggregate debts per person: card usage + splits."""
    with get_db() as db:
        pessoas = [dict(r) for r in db.execute(
            "SELECT * FROM pessoas ORDER BY titular DESC, nome").fetchall()]
        resumo = []
        for p in pessoas:
            if p['titular']:
                continue
            # Full transactions where this person is responsavel
            tx_total = db.execute(
                "SELECT COALESCE(SUM(valor),0) AS t FROM transacoes WHERE responsavel_id=?",
                (p['id'],)).fetchone()['t']
            tx_items = [dict(r) for r in db.execute("""
                SELECT COALESCE(a.alias,t.descricao) AS nome, t.valor, t.data
                FROM transacoes t LEFT JOIN aliases a ON UPPER(a.descricao_original)=UPPER(t.descricao)
                WHERE t.responsavel_id=? ORDER BY t.data DESC
            """, (p['id'],)).fetchall()]
            # Unpaid split participations
            sp_total = db.execute(
                "SELECT COALESCE(SUM(valor),0) AS t FROM divisao_participantes WHERE pessoa_id=? AND pago=0",
                (p['id'],)).fetchone()['t']
            sp_items = [dict(r) for r in db.execute("""
                SELECT dp.id, dp.valor, d.descricao AS motivo,
                       COALESCE(a.alias,t.descricao) AS tx_nome, t.data AS tx_data
                FROM divisao_participantes dp
                JOIN divisoes d ON dp.divisao_id=d.id
                JOIN transacoes t ON d.transacao_id=t.id
                LEFT JOIN aliases a ON UPPER(a.descricao_original)=UPPER(t.descricao)
                WHERE dp.pessoa_id=? AND dp.pago=0 ORDER BY d.created_at DESC
            """, (p['id'],)).fetchall()]
            resumo.append({
                'pessoa': p,
                'total_cartao': tx_total,
                'total_divisoes': sp_total,
                'total_deve': tx_total + sp_total,
                'itens_cartao': tx_items,
                'itens_divisoes': sp_items,
            })
        return resumo


# ──────────────────────── Aliases ────────────────────────

def listar_aliases():
    with get_db() as db:
        return [dict(r) for r in db.execute(
            "SELECT * FROM aliases ORDER BY descricao_original").fetchall()]


def salvar_alias(descricao_original, alias):
    """Create or update an alias."""
    with get_db() as db:
        db.execute(
            """INSERT INTO aliases (descricao_original, alias) VALUES (?, ?)
               ON CONFLICT(descricao_original) DO UPDATE SET alias = excluded.alias""",
            (descricao_original.strip(), alias.strip()),
        )


def deletar_alias(aid):
    with get_db() as db:
        db.execute("DELETE FROM aliases WHERE id = ?", (aid,))


# ──────────────────────── Regras ────────────────────────

def listar_regras():
    with get_db() as db:
        return [dict(r) for r in db.execute(
            """SELECT r.*, c.nome AS categoria_nome, c.emoji AS categoria_emoji
               FROM regras_categoria r JOIN categorias c ON r.categoria_id = c.id
               ORDER BY r.palavra_chave""").fetchall()]


def criar_regra(palavra_chave, categoria_id):
    with get_db() as db:
        cur = db.execute(
            "INSERT INTO regras_categoria (palavra_chave, categoria_id) VALUES (?, ?)",
            (palavra_chave, int(categoria_id)),
        )
        return cur.lastrowid


def deletar_regra(rid):
    with get_db() as db:
        db.execute("DELETE FROM regras_categoria WHERE id = ?", (rid,))


def aplicar_regras_existentes():
    with get_db() as db:
        regras = db.execute("SELECT palavra_chave, categoria_id FROM regras_categoria").fetchall()
        # Busca transações sem categoria, trazendo também o apelido se existir
        sem_cat = db.execute("""
            SELECT t.id, t.descricao, a.alias 
            FROM transacoes t
            LEFT JOIN aliases a ON UPPER(a.descricao_original) = UPPER(t.descricao)
            WHERE t.categoria_id IS NULL
        """).fetchall()
        
        count = 0
        for t in sem_cat:
            desc_to_check = t["descricao"].upper()
            if t["alias"]:
                desc_to_check += " " + t["alias"].upper()
                
            for r in regras:
                if r["palavra_chave"].upper() in desc_to_check:
                    db.execute("UPDATE transacoes SET categoria_id = ? WHERE id = ?",
                               (r["categoria_id"], t["id"]))
                    count += 1
                    break
        return count


# ──────────────────────── Receitas ────────────────────────

def listar_receitas():
    with get_db() as db:
        return [dict(r) for r in db.execute("SELECT * FROM receitas ORDER BY data DESC").fetchall()]


def criar_receita(data, descricao, valor, tipo="Outros", recorrente=False):
    with get_db() as db:
        cur = db.execute(
            "INSERT INTO receitas (data, descricao, valor, tipo, recorrente) VALUES (?, ?, ?, ?, ?)",
            (data, descricao, float(valor), tipo, 1 if recorrente else 0)
        )
        return cur.lastrowid


def projetar_receitas_recorrentes(meses_futuros=3):
    """Project recurring incomes into future months."""
    with get_db() as db:
        recorrentes = db.execute(
            "SELECT * FROM receitas WHERE recorrente = 1"
        ).fetchall()
        inseridas = 0
        for r in recorrentes:
            try:
                base = datetime.strptime(r["data"], "%Y-%m-%d")
            except ValueError:
                continue
            for i in range(1, meses_futuros + 1):
                futuro = base + relativedelta(months=i)
                new_data = futuro.strftime("%Y-%m-%d")
                exists = db.execute(
                    "SELECT COUNT(*) FROM receitas WHERE descricao=? AND data=?",
                    (r["descricao"], new_data)
                ).fetchone()[0]
                if not exists:
                    db.execute(
                        "INSERT INTO receitas (data, descricao, valor, tipo, recorrente) VALUES (?,?,?,?,1)",
                        (new_data, r["descricao"], r["valor"], r["tipo"])
                    )
                    inseridas += 1
        return inseridas


def deletar_receita(rid):
    with get_db() as db:
        db.execute("DELETE FROM receitas WHERE id = ?", (rid,))


# ──────────────────────── Dívidas ────────────────────────

def listar_dividas():
    with get_db() as db:
        return [dict(r) for r in db.execute(
            "SELECT * FROM dividas ORDER BY pago ASC, data DESC").fetchall()]


def criar_divida(pessoa, descricao, valor, data):
    with get_db() as db:
        cur = db.execute("INSERT INTO dividas (pessoa, descricao, valor, data) VALUES (?, ?, ?, ?)",
                         (pessoa, descricao, float(valor), data))
        return cur.lastrowid


def marcar_divida_paga(did):
    with get_db() as db:
        db.execute("UPDATE dividas SET pago = 1, data_pagamento = ? WHERE id = ?",
                   (date_type.today().isoformat(), did))


def deletar_divida(did):
    with get_db() as db:
        db.execute("DELETE FROM dividas WHERE id = ?", (did,))


# ──────────────────────── Dashboard Data ────────────────────────

def get_dashboard_data(mes=None, mes_inicio=None, mes_fim=None):
    with get_db() as db:
        intervalo_ativo = bool(mes_inicio and mes_fim)
        meses = [dict(r) for r in db.execute("""
            SELECT DISTINCT
                   CASE WHEN COALESCE(mes_referencia, '') <> ''
                        THEN SUBSTR(mes_referencia,6,2)||'/'||SUBSTR(mes_referencia,1,4)
                        ELSE SUBSTR(data,4,2)||'/'||SUBSTR(data,7,4)
                   END AS label,
                   CASE WHEN COALESCE(mes_referencia, '') <> ''
                        THEN mes_referencia
                        ELSE SUBSTR(data,7,4)||'-'||SUBSTR(data,4,2)
                   END AS value
            FROM transacoes ORDER BY value DESC
        """).fetchall()]
        # mes_atual = filtering month (None = all months, i.e. "Todos os meses")
        mes_atual = None if intervalo_ativo else (mes or None)

        # mes_selecionado = hint to the frontend for dropdown auto-select
        # (always a specific month — the most recent one with real data)
        mes_selecionado = mes
        if not mes_selecionado and meses:
            today_key = date_type.today().strftime("%Y-%m")
            real_cond = _real_clause("")
            meses_reais = [dict(r) for r in db.execute(f"""
                SELECT DISTINCT COALESCE(NULLIF(mes_referencia,''),
                    SUBSTR(data,7,4)||'-'||SUBSTR(data,4,2)) AS value
                FROM transacoes
                WHERE {real_cond} AND COALESCE(ignorado,0) = 0
                ORDER BY value DESC
            """).fetchall()]
            real_values = [m["value"] for m in meses_reais]
            if today_key in real_values:
                mes_selecionado = today_key
            elif real_values:
                mes_selecionado = real_values[0]
            else:
                mes_selecionado = meses[0]["value"]

        mes_anterior = None
        if mes_selecionado and meses:
            values = [item["value"] for item in meses]
            if mes_selecionado in values:
                idx = values.index(mes_selecionado)
                if idx + 1 < len(values):
                    mes_anterior = values[idx + 1]

        # Gastos por categoria
        rc_t = _real_clause("t.")
        sql_cat = f"""SELECT c.nome, c.emoji, c.cor, COALESCE(SUM(t.valor), 0) AS total
                     FROM categorias c
                     LEFT JOIN transacoes t ON t.categoria_id = c.id
                        AND {rc_t}
                        AND COALESCE(t.ignorado, 0) = 0"""
        p_cat = []
        sql_cat = _add_mes_filter(sql_cat, p_cat, "t.mes_referencia", mes_atual, mes_inicio, mes_fim)
        sql_cat += " GROUP BY c.id HAVING total > 0 ORDER BY total DESC"
        por_cat = [dict(r) for r in db.execute(sql_cat, p_cat).fetchall()]

        if intervalo_ativo:
            periodos = {
                "atual": _resumo_intervalo(db, mes_inicio, mes_fim),
                "anterior": None,
            }
        else:
            periodos = {
                "atual": _resumo_periodo(db, mes_atual),
                "anterior": _resumo_periodo(db, mes_anterior) if mes_anterior else None,
            }
        total_desp = periodos["atual"]["despesas"]
        total_rec = periodos["atual"]["receitas"]
        saldo_contabil = round(total_rec - total_desp, 2)

        proj_clauses = [_proj_clause(""), "COALESCE(ignorado, 0) = 0"]
        p_proj = []
        year, month = _parse_mes(mes_atual)
        if intervalo_ativo:
            proj_clauses.append("mes_referencia BETWEEN ? AND ?")
            p_proj.extend([mes_inicio, mes_fim])
        elif year and month:
            proj_clauses.append("mes_referencia = ?")
            p_proj.append(f"{year}-{month}")
        total_proj = db.execute(
            f"SELECT COALESCE(SUM(valor), 0) AS total FROM transacoes WHERE {' AND '.join(proj_clauses)}",
            p_proj,
        ).fetchone()["total"]

        div_abertas = db.execute(
            "SELECT COALESCE(SUM(valor), 0) AS total FROM dividas WHERE pago = 0"
        ).fetchone()["total"]

        real_cond = _real_clause("")
        sem_cat_count = db.execute(
            f"SELECT COUNT(*) AS total FROM transacoes WHERE categoria_id IS NULL AND {real_cond} AND COALESCE(ignorado, 0) = 0"
        ).fetchone()["total"]

        rc = _real_clause("")
        pc = _proj_clause("")
        evolucao = [dict(r) for r in db.execute(f"""
            SELECT SUBSTR(COALESCE(NULLIF(mes_referencia, ''), SUBSTR(data,7,4)||'-'||SUBSTR(data,4,2)),6,2)||'/'||
                   SUBSTR(COALESCE(NULLIF(mes_referencia, ''), SUBSTR(data,7,4)||'-'||SUBSTR(data,4,2)),1,4) AS mes_ano,
                   COALESCE(NULLIF(mes_referencia, ''), SUBSTR(data,7,4)||'-'||SUBSTR(data,4,2)) AS mes_sort,
                   SUM(CASE WHEN {rc} AND COALESCE(ignorado,0)=0 THEN valor ELSE 0 END) AS total,
                   SUM(CASE WHEN {pc} AND COALESCE(ignorado,0)=0 THEN valor ELSE 0 END) AS total_projetado
            FROM transacoes GROUP BY mes_sort ORDER BY mes_sort
        """).fetchall()]

        # Adicionar receitas por mês à evolução (Part 6)
        _rec_por_mes = {}
        for r in db.execute(
            "SELECT SUBSTR(data,1,7) AS mes, SUM(valor) AS total FROM receitas GROUP BY SUBSTR(data,1,7)"
        ).fetchall():
            _rec_por_mes[r["mes"]] = r["total"]
        for item in evolucao:
            item["receita"] = _rec_por_mes.get(item["mes_sort"], 0)

        rc_t = _real_clause("t.")
        sql_top = f"""SELECT t.descricao, COALESCE(a.alias, t.descricao) AS nome_exibido,
                            SUM(t.valor) AS valor, t.data
                     FROM transacoes t
                     LEFT JOIN aliases a ON UPPER(a.descricao_original)=UPPER(t.descricao)
                     WHERE {rc_t} AND COALESCE(t.ignorado, 0) = 0"""
        p_top = []
        sql_top = _add_mes_filter(sql_top, p_top, "t.mes_referencia", mes_atual, mes_inicio, mes_fim)
        sql_top += " GROUP BY t.descricao, t.data ORDER BY valor DESC LIMIT 10"
        top = [dict(r) for r in db.execute(sql_top, p_top).fetchall()]

        rc_t = _real_clause("t.")
        base_month_clause = f"{rc_t} AND COALESCE(t.ignorado,0)=0"
        params_month = []
        if intervalo_ativo:
            base_month_clause += " AND t.mes_referencia BETWEEN ? AND ?"
            params_month.extend([mes_inicio, mes_fim])
        elif year and month:
            base_month_clause += " AND t.mes_referencia = ?"
            params_month.append(f"{year}-{month}")

        por_cartao = [dict(r) for r in db.execute(
            f"""SELECT COALESCE(NULLIF(t.cartao_final, ''), 'Sem final') AS cartao,
                       ROUND(SUM(t.valor), 2) AS total
                FROM transacoes t
                WHERE {base_month_clause}
                GROUP BY COALESCE(NULLIF(t.cartao_final, ''), 'Sem final')
                ORDER BY total DESC""",
            params_month,
        ).fetchall()]

        top_estabelecimentos = [dict(r) for r in db.execute(
            f"""SELECT COALESCE(a.alias, t.descricao) AS nome_exibido,
                       COUNT(*) AS quantidade,
                       ROUND(SUM(t.valor), 2) AS total
                FROM transacoes t
                LEFT JOIN aliases a ON UPPER(a.descricao_original)=UPPER(t.descricao)
                WHERE {base_month_clause}
                GROUP BY t.descricao
                ORDER BY total DESC
                LIMIT 10""",
            params_month,
        ).fetchall()]

        gastos_por_dia = [dict(r) for r in db.execute(
            f"""SELECT SUBSTR(t.data,1,2) AS dia,
                       ROUND(SUM(t.valor), 2) AS total
                FROM transacoes t
                WHERE {base_month_clause}
                GROUP BY SUBSTR(t.data,1,2)
                ORDER BY CAST(SUBSTR(t.data,1,2) AS INTEGER)""",
            params_month,
        ).fetchall()]

        pc = _proj_clause("")
        parcelas_futuras = [dict(r) for r in db.execute(
            f"""
            SELECT SUBSTR(mes_referencia,6,2)||'/'||SUBSTR(mes_referencia,1,4) AS mes_ano,
                   mes_referencia AS mes_sort,
                   ROUND(SUM(valor), 2) AS total
            FROM transacoes
            WHERE {pc} AND COALESCE(ignorado,0) = 0 AND COALESCE(mes_referencia,'') <> ''
            GROUP BY mes_referencia
            ORDER BY mes_sort
            LIMIT 12
            """
        ).fetchall()]

        rc_t = _real_clause("t.")
        recorrentes = [dict(r) for r in db.execute(
            f"""
            SELECT COALESCE(a.alias, t.descricao) AS nome_exibido,
                   t.descricao,
                   COUNT(*) AS quantidade,
                   COUNT(DISTINCT COALESCE(NULLIF(t.mes_referencia, ''), SUBSTR(t.data,7,4)||'-'||SUBSTR(t.data,4,2))) AS meses,
                   ROUND(AVG(t.valor), 2) AS valor_medio,
                   ROUND(SUM(t.valor), 2) AS total
            FROM transacoes t
            LEFT JOIN aliases a ON UPPER(a.descricao_original) = UPPER(t.descricao)
            WHERE {rc_t} AND COALESCE(t.ignorado,0) = 0
            GROUP BY t.descricao
            HAVING COUNT(DISTINCT SUBSTR(t.data, 4, 7)) >= 2
            ORDER BY meses DESC, total DESC
            LIMIT 8
            """
        ).fetchall()]

        review = get_review_data()
        maior_gasto = top[0] if top else None
        comparativo = {
            "atual": periodos["atual"],
            "anterior": periodos["anterior"],
            "delta_despesas": total_desp - (periodos["anterior"]["despesas"] if periodos["anterior"] else 0),
            "delta_receitas": total_rec - (periodos["anterior"]["receitas"] if periodos["anterior"] else 0),
        }

        # Cobertura da fatura: receita do mes seguinte cobre a fatura atual? (Part 2)
        cobertura_fatura = None
        if not intervalo_ativo and year and month:
            from dateutil.relativedelta import relativedelta as _rd
            from datetime import datetime as _dt
            _mes_dt = _dt(int(year), int(month), 1)
            _prox = _mes_dt + _rd(months=1)
            _prox_mes = _prox.strftime("%Y-%m")
            _rec_prox = db.execute(
                "SELECT COALESCE(SUM(valor), 0) AS total FROM receitas WHERE SUBSTR(data,1,7) = ?",
                (_prox_mes,),
            ).fetchone()["total"]
            cobertura_fatura = {
                "receita_prox_mes": _rec_prox,
                "despesa_mes_atual": total_desp,
                "saldo_cobertura": round(_rec_prox - total_desp, 2),
                "mes_pagamento": _prox_mes,
                "cobre": _rec_prox >= total_desp,
            }

        return {
            "mes_selecionado": mes_selecionado,
            "por_categoria": por_cat,
            "total_despesas": total_desp,
            "total_projetado": total_proj,
            "total_receitas": total_rec,
            "saldo": saldo_contabil,
            "saldo_contabil": saldo_contabil,
            "dividas_abertas": div_abertas,
            "sem_categoria": sem_cat_count,
            "evolucao_mensal": evolucao,
            "top_gastos": top,
            "meses_disponiveis": meses,
            "comparativo_mes": comparativo,
            "por_cartao": por_cartao,
            "top_estabelecimentos": top_estabelecimentos,
            "gastos_por_dia": gastos_por_dia,
            "parcelas_futuras_mes": parcelas_futuras,
            "recorrentes": recorrentes,
            "maior_gasto": maior_gasto,
            "review": review["contadores"],
            "cobertura_fatura": cobertura_fatura,
        }


# ──────────────────────── Dashboard Anual ────────────────────────

def get_dashboard_anual(ano=None):
    if not ano:
        ano = str(date_type.today().year)
    with get_db() as db:
        rc = _real_clause("")
        base = f"{rc} AND COALESCE(ignorado,0)=0 AND mes_referencia LIKE ?"
        param = f"{ano}-%"

        total_desp = db.execute(
            f"SELECT COALESCE(SUM(valor),0) AS t FROM transacoes WHERE {base}", (param,)
        ).fetchone()["t"]

        total_rec = db.execute(
            "SELECT COALESCE(SUM(valor),0) AS t FROM receitas WHERE data LIKE ?", (f"{ano}-%",)
        ).fetchone()["t"]

        meses_com_dados = db.execute(
            f"SELECT COUNT(DISTINCT mes_referencia) AS t FROM transacoes WHERE {base}", (param,)
        ).fetchone()["t"]

        media_mensal = total_desp / max(meses_com_dados, 1)
        previsao_anual = media_mensal * 12

        evolucao = [dict(r) for r in db.execute(
            f"SELECT mes_referencia AS mes, "
            f"SUBSTR(mes_referencia,6,2)||'/'||SUBSTR(mes_referencia,1,4) AS label, "
            f"ROUND(SUM(valor),2) AS total "
            f"FROM transacoes WHERE {base} GROUP BY mes_referencia ORDER BY mes_referencia",
            (param,)
        ).fetchall()]

        receitas_mes = [dict(r) for r in db.execute(
            "SELECT SUBSTR(data,1,7) AS mes, "
            "SUBSTR(data,6,2)||'/'||SUBSTR(data,1,4) AS label, "
            "ROUND(SUM(valor),2) AS total "
            "FROM receitas WHERE data LIKE ? GROUP BY SUBSTR(data,1,7) ORDER BY mes",
            (f"{ano}-%",)
        ).fetchall()]

        por_categoria = [dict(r) for r in db.execute(
            f"SELECT c.nome, c.emoji, c.cor, ROUND(SUM(t.valor),2) AS total "
            f"FROM transacoes t JOIN categorias c ON t.categoria_id = c.id "
            f"WHERE {_real_clause('t.')} AND COALESCE(t.ignorado,0)=0 AND t.mes_referencia LIKE ? "
            f"GROUP BY c.id HAVING total > 0 ORDER BY total DESC",
            (param,)
        ).fetchall()]

        maior_mes = db.execute(
            f"SELECT mes_referencia AS mes, ROUND(SUM(valor),2) AS total "
            f"FROM transacoes WHERE {base} GROUP BY mes_referencia ORDER BY total DESC LIMIT 1",
            (param,)
        ).fetchone()

        menor_mes = db.execute(
            f"SELECT mes_referencia AS mes, ROUND(SUM(valor),2) AS total "
            f"FROM transacoes WHERE {base} GROUP BY mes_referencia ORDER BY total ASC LIMIT 1",
            (param,)
        ).fetchone()

        top_gastos = [dict(r) for r in db.execute(
            f"SELECT COALESCE(a.alias, t.descricao) AS nome, t.valor, t.data "
            f"FROM transacoes t "
            f"LEFT JOIN aliases a ON UPPER(a.descricao_original)=UPPER(t.descricao) "
            f"WHERE {_real_clause('t.')} AND COALESCE(t.ignorado,0)=0 AND t.mes_referencia LIKE ? "
            f"ORDER BY t.valor DESC LIMIT 10",
            (param,)
        ).fetchall()]

        top_categorias = [dict(r) for r in db.execute(
            f"SELECT c.nome, c.emoji, c.cor, "
            f"ROUND(SUM(t.valor),2) AS total, COUNT(*) AS quantidade, ROUND(AVG(t.valor),2) AS media "
            f"FROM transacoes t JOIN categorias c ON t.categoria_id = c.id "
            f"WHERE {_real_clause('t.')} AND COALESCE(t.ignorado,0)=0 AND t.mes_referencia LIKE ? "
            f"GROUP BY c.id ORDER BY total DESC LIMIT 8",
            (param,)
        ).fetchall()]

        anos = [r[0] for r in db.execute(
            "SELECT DISTINCT SUBSTR(mes_referencia,1,4) FROM transacoes "
            "WHERE mes_referencia != '' ORDER BY 1 DESC"
        ).fetchall()]

        return {
            "ano": ano,
            "anos_disponiveis": anos,
            "total_despesas": total_desp,
            "total_receitas": total_rec,
            "saldo": round(total_rec - total_desp, 2),
            "media_mensal": round(media_mensal, 2),
            "previsao_anual": round(previsao_anual, 2),
            "meses_com_dados": meses_com_dados,
            "evolucao_mensal": evolucao,
            "receitas_mensal": receitas_mes,
            "por_categoria": por_categoria,
            "maior_mes": dict(maior_mes) if maior_mes else None,
            "menor_mes": dict(menor_mes) if menor_mes else None,
            "top_gastos": top_gastos,
            "top_categorias": top_categorias,
        }


# ──────────────────────── Deletar Transacao ────────────────────────

def deletar_transacao(tid):
    with get_db() as db:
        db.execute(
            "DELETE FROM divisao_participantes WHERE divisao_id IN "
            "(SELECT id FROM divisoes WHERE transacao_id = ?)",
            (tid,),
        )
        db.execute("DELETE FROM divisoes WHERE transacao_id = ?", (tid,))
        db.execute("DELETE FROM transacoes WHERE id = ?", (tid,))


# ──────────────────────── Analytics Avancados ────────────────────────

def get_analise_semanal(mes=None):
    """Agrupa gastos por semana do mes. Data no formato dd/mm/yyyy."""
    with get_db() as db:
        base = "projetado = 0 AND COALESCE(ignorado,0)=0"
        params_s = []
        year, month = _parse_mes(mes)
        if year and month:
            base += " AND mes_referencia = ?"
            params_s.append(f"{year}-{month}")
        rows = db.execute(
            f"SELECT CAST(SUBSTR(data,1,2) AS INTEGER) AS dia, valor "
            f"FROM transacoes WHERE {base}",
            params_s,
        ).fetchall()

        semanas = {1: 0.0, 2: 0.0, 3: 0.0, 4: 0.0}
        contagem = {1: 0, 2: 0, 3: 0, 4: 0}
        for r in rows:
            dia = r["dia"]
            semana = min(4, (dia - 1) // 7 + 1)
            semanas[semana] += r["valor"]
            contagem[semana] += 1

        return [
            {
                "semana": f"{k}a semana (dias {(k-1)*7+1}-{min(k*7, 31)})",
                "total": round(semanas[k], 2),
                "quantidade": contagem[k],
            }
            for k in [1, 2, 3, 4]
        ]


def get_crescimento_categorias(mes_atual=None):
    """Compara gasto por categoria entre mes atual e anterior."""
    with get_db() as db:
        year, month = _parse_mes(mes_atual)
        if not (year and month):
            from datetime import date as _d
            today = _d.today()
            year, month = str(today.year), str(today.month).zfill(2)
        mes_ref = f"{year}-{month}"
        from dateutil.relativedelta import relativedelta as _rd
        from datetime import datetime as _dt
        mes_ant = (_dt(int(year), int(month), 1) - _rd(months=1)).strftime("%Y-%m")

        rc = _real_clause("t.")
        rows = db.execute(
            f"SELECT c.id, c.nome, c.emoji, c.cor, "
            f"COALESCE(SUM(CASE WHEN t.mes_referencia = ? THEN t.valor ELSE 0 END), 0) AS atual, "
            f"COALESCE(SUM(CASE WHEN t.mes_referencia = ? THEN t.valor ELSE 0 END), 0) AS anterior "
            f"FROM categorias c "
            f"LEFT JOIN transacoes t ON t.categoria_id = c.id AND {rc} AND COALESCE(t.ignorado,0)=0 "
            f"GROUP BY c.id HAVING atual > 0 OR anterior > 0 ORDER BY atual DESC",
            (mes_ref, mes_ant)
        ).fetchall()
        result = []
        for r in rows:
            delta = r["atual"] - r["anterior"]
            pct = round((delta / r["anterior"] * 100), 1) if r["anterior"] > 0 else None
            result.append({
                "nome": r["nome"],
                "emoji": r["emoji"],
                "cor": r["cor"],
                "atual": round(r["atual"], 2),
                "anterior": round(r["anterior"], 2),
                "delta": round(delta, 2),
                "delta_pct": pct,
            })
        return result


def get_alertas_gastos(mes=None):
    """Detecta categorias com gasto 30%+ acima da media historica."""
    with get_db() as db:
        year, month = _parse_mes(mes)
        if not (year and month):
            from datetime import date as _d
            today = _d.today()
            year, month = str(today.year), str(today.month).zfill(2)
        mes_ref = f"{year}-{month}"
        rc = _real_clause("t.")

        historico = db.execute(
            f"SELECT t.categoria_id, AVG(mes_total) AS media, MAX(mes_total) AS maximo "
            f"FROM ("
            f"  SELECT t.categoria_id, t.mes_referencia, SUM(t.valor) AS mes_total "
            f"  FROM transacoes t "
            f"  WHERE {rc} AND COALESCE(t.ignorado,0)=0 AND t.mes_referencia != ? "
            f"  AND t.categoria_id IS NOT NULL "
            f"  GROUP BY t.categoria_id, t.mes_referencia"
            f") t GROUP BY t.categoria_id",
            (mes_ref,)
        ).fetchall()
        hist_map = {r["categoria_id"]: {"media": r["media"], "maximo": r["maximo"]} for r in historico}

        atual = db.execute(
            f"SELECT t.categoria_id, c.nome, c.emoji, SUM(t.valor) AS total "
            f"FROM transacoes t JOIN categorias c ON t.categoria_id = c.id "
            f"WHERE {rc} AND COALESCE(t.ignorado,0)=0 AND t.mes_referencia = ? "
            f"GROUP BY t.categoria_id",
            (mes_ref,)
        ).fetchall()

        alertas = []
        for r in atual:
            cid = r["categoria_id"]
            if cid not in hist_map:
                continue
            h = hist_map[cid]
            if h["media"] and h["media"] > 0:
                pct = (r["total"] - h["media"]) / h["media"] * 100
                if pct >= 30:
                    alertas.append({
                        "categoria": r["nome"],
                        "emoji": r["emoji"],
                        "total_atual": round(r["total"], 2),
                        "media_historica": round(h["media"], 2),
                        "delta_pct": round(pct, 1),
                        "nivel": "critico" if pct >= 80 else "alerta",
                    })
        alertas.sort(key=lambda x: x["delta_pct"], reverse=True)
        return alertas


def get_resumo_devedores():
    """Resumo compacto de quem deve, para o dashboard principal."""
    with get_db() as db:
        pessoas = [dict(r) for r in db.execute(
            "SELECT * FROM pessoas WHERE titular = 0 ORDER BY nome"
        ).fetchall()]
        
        dividas_manuais = db.execute(
            "SELECT UPPER(pessoa) AS p_upper, pessoa, SUM(valor) AS total FROM dividas WHERE pago=0 GROUP BY UPPER(pessoa)"
        ).fetchall()
        div_map = {r["p_upper"]: r["total"] for r in dividas_manuais}
        nomes_originais = {r["p_upper"]: r["pessoa"] for r in dividas_manuais}

        devedores_dict = {}
        total_a_receber = 0.0

        for p in pessoas:
            tx_total = db.execute(
                "SELECT COALESCE(SUM(valor),0) AS t FROM transacoes WHERE responsavel_id=?",
                (p["id"],),
            ).fetchone()["t"]
            sp_total = db.execute(
                "SELECT COALESCE(SUM(valor),0) AS t FROM divisao_participantes WHERE pessoa_id=? AND pago=0",
                (p["id"],),
            ).fetchone()["t"]
            
            nome_upper = p["nome"].upper()
            div_total = div_map.get(nome_upper, 0.0)
            
            total = tx_total + sp_total + div_total
            if total > 0:
                total_a_receber += total
                devedores_dict[nome_upper] = {
                    "pessoa_id": p["id"],
                    "nome": p["nome"],
                    "total_cartao": round(tx_total, 2),
                    "total_divisoes": round(sp_total, 2),
                    "total_manual": round(div_total, 2),
                    "total_deve": round(total, 2),
                }
            if nome_upper in div_map:
                del div_map[nome_upper]

        for p_upper, div_total in div_map.items():
            if div_total > 0:
                total_a_receber += div_total
                devedores_dict[p_upper] = {
                    "pessoa_id": None,
                    "nome": nomes_originais[p_upper],
                    "total_cartao": 0.0,
                    "total_divisoes": 0.0,
                    "total_manual": round(div_total, 2),
                    "total_deve": round(div_total, 2),
                }

        devedores = list(devedores_dict.values())
        devedores.sort(key=lambda x: x["total_deve"], reverse=True)
        
        return {
            "total_a_receber": round(total_a_receber, 2),
            "devedores": devedores,
        }
