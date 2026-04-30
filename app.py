"""Flask server — Personal Finance Dashboard."""
from __future__ import annotations

import hashlib
import csv
import io
from pathlib import Path

from flask import Flask, jsonify, render_template, request, Response
from werkzeug.utils import secure_filename

import database as db
from parser_inter import extract_transactions
from parser_csv import extract_transactions_csv

BASE_DIR = Path(__file__).resolve().parent
INVOICES_DIR = BASE_DIR / "Faturas"
INVOICES_DIR.mkdir(exist_ok=True)

app = Flask(__name__)

db.init_db()


def _json_error(message: str, status_code: int = 400):
    return jsonify({"error": message}), status_code


def _get_json_payload():
    return request.get_json(silent=True) or {}


def _build_pdf_hash(pdf_bytes: bytes) -> str:
    return hashlib.sha256(pdf_bytes).hexdigest()


def _auto_import():
    """Import any new PDFs/CSVs found in Faturas/ on every startup (skips already-imported)."""
    from database import get_db
    for ext in ["*.pdf", "*.csv"]:
        for file_path in INVOICES_DIR.glob(ext):
            file_bytes = file_path.read_bytes()
            file_hash = _build_pdf_hash(file_bytes)
            # Skip if already imported
            with get_db() as conn:
                exists = conn.execute(
                    "SELECT COUNT(*) FROM arquivos_importados WHERE arquivo_hash = ?",
                    (file_hash,),
                ).fetchone()[0]
            if exists:
                continue
            
            print(f"[auto-import] Importando {file_path.name}...")
            if file_path.suffix.lower() == ".pdf":
                txns = extract_transactions(file_bytes)
            else:
                # CSV needs string content
                txns = extract_transactions_csv(file_bytes.decode("utf-8", errors="ignore"))
                
            if txns:
                db.inserir_transacoes(txns, file_path.name, file_hash)
                print(f"[auto-import] {file_path.name}: {len(txns)} transações importadas.")




# ────────────────── Pages ──────────────────

@app.route("/")
def index():
    return render_template("index.html")


# ────────────────── API: Import ──────────────────

@app.route("/api/importar-fatura", methods=["POST"])
def importar_fatura():
    if "arquivo" not in request.files:
        return _json_error("Nenhum arquivo enviado")

    arq = request.files["arquivo"]
    if not arq or not arq.filename:
        return _json_error("Arquivo invalido")
        
    ext = arq.filename.lower()
    if not (ext.endswith(".pdf") or ext.endswith(".csv")):
        return _json_error("Apenas PDF ou CSV")

    file_bytes = arq.read()
    if not file_bytes:
        return _json_error("Arquivo vazio")

    if ext.endswith(".pdf"):
        txns = extract_transactions(file_bytes)
    else:
        txns = extract_transactions_csv(file_bytes.decode("utf-8", errors="ignore"))

    if not txns:
        return _json_error("Nenhuma transação encontrada")

    safe_name = secure_filename(arq.filename)
    (INVOICES_DIR / safe_name).write_bytes(file_bytes)
    return jsonify(db.inserir_transacoes(txns, safe_name, _build_pdf_hash(file_bytes)))


@app.route("/api/importar-existentes", methods=["POST"])
def importar_existentes():
    results = []
    for ext in ["*.pdf", "*.csv"]:
        for file_path in INVOICES_DIR.glob(ext):
            file_bytes = file_path.read_bytes()
            if file_path.suffix.lower() == ".pdf":
                txns = extract_transactions(file_bytes)
            else:
                txns = extract_transactions_csv(file_bytes.decode("utf-8", errors="ignore"))
                
            if txns:
                results.append({
                    "arquivo": file_path.name,
                    **db.inserir_transacoes(txns, file_path.name, _build_pdf_hash(file_bytes)),
                })
    return jsonify(results)


# ────────────────── API: Transações ──────────────────

@app.route("/api/transacoes")
def api_transacoes():
    incluir = request.args.get("projetadas", "true").lower() != "false"
    incluir_ignoradas = request.args.get("ignoradas", "false").lower() == "true"
    somente_parceladas = request.args.get("parceladas", "false").lower() == "true"
    somente_recorrentes = request.args.get("recorrentes", "false").lower() == "true"
    return jsonify(db.listar_transacoes(
        mes=request.args.get("mes"),
        mes_inicio=request.args.get("mes_inicio"),
        mes_fim=request.args.get("mes_fim"),
        categoria_id=request.args.get("categoria_id"),
        busca=request.args.get("busca"),
        incluir_projetadas=incluir,
        cartao_final=request.args.get("cartao_final"),
        somente_parceladas=somente_parceladas,
        valor_min=request.args.get("valor_min"),
        valor_max=request.args.get("valor_max"),
        incluir_ignoradas=incluir_ignoradas,
        somente_recorrentes=somente_recorrentes,
        responsavel_id=request.args.get("responsavel_id"),
    ))


@app.route("/api/transacoes/<int:tid>/categoria", methods=["PUT"])
def api_atualizar_cat(tid):
    data = _get_json_payload()
    db.atualizar_categoria_transacao(tid, data.get("categoria_id"))
    return jsonify({"status": "ok"})


@app.route("/api/transacoes/<int:tid>/responsavel", methods=["PUT"])
def api_atualizar_resp(tid):
    data = _get_json_payload()
    db.atualizar_responsavel_transacao(tid, data.get("pessoa_id"))
    return jsonify({"status": "ok"})


@app.route("/api/transacoes/<int:tid>/ignorar", methods=["PUT"])
def api_ignorar_transacao(tid):
    data = _get_json_payload()
    db.atualizar_ignorado_transacao(tid, data.get("ignorado", True))
    return jsonify({"status": "ok"})


@app.route("/api/transacoes/<int:tid>/nota", methods=["PUT"])
def api_nota_transacao(tid):
    data = _get_json_payload()
    db.atualizar_nota_transacao(tid, data.get("nota"))
    return jsonify({"status": "ok"})


@app.route("/api/transacoes/batch-categoria", methods=["PUT"])
def api_batch_categoria():
    data = _get_json_payload()
    ids = data.get("ids", [])
    categoria_id = data.get("categoria_id")
    if not ids:
        return _json_error("Selecione ao menos uma transacao")
    count = db.batch_categorizar(ids, categoria_id)
    return jsonify({"status": "ok", "atualizadas": count})


@app.route("/api/transacoes/exportar")
def api_exportar_transacoes():
    incluir = request.args.get("projetadas", "true").lower() != "false"
    incluir_ignoradas = request.args.get("ignoradas", "false").lower() == "true"
    somente_parceladas = request.args.get("parceladas", "false").lower() == "true"
    somente_recorrentes = request.args.get("recorrentes", "false").lower() == "true"
    rows = db.listar_transacoes(
        mes=request.args.get("mes"),
        mes_inicio=request.args.get("mes_inicio"),
        mes_fim=request.args.get("mes_fim"),
        categoria_id=request.args.get("categoria_id"),
        busca=request.args.get("busca"),
        incluir_projetadas=incluir,
        cartao_final=request.args.get("cartao_final"),
        somente_parceladas=somente_parceladas,
        valor_min=request.args.get("valor_min"),
        valor_max=request.args.get("valor_max"),
        incluir_ignoradas=incluir_ignoradas,
        somente_recorrentes=somente_recorrentes,
    )
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow([
        "data", "descricao", "alias", "valor", "parcela", "cartao_final",
        "categoria", "responsavel", "projetado", "ignorado", "fatura_origem"
    ])
    for row in rows:
        writer.writerow([
            row.get("data"),
            row.get("descricao"),
            row.get("alias") or "",
            row.get("valor"),
            row.get("parcela") or "",
            row.get("cartao_final") or "",
            row.get("categoria_nome") or "",
            row.get("responsavel_nome") or "",
            row.get("projetado"),
            row.get("ignorado", 0),
            row.get("fatura_origem") or "",
        ])
    filename = f"transacoes_{request.args.get('mes') or 'geral'}.csv"
    return Response(
        buffer.getvalue(),
        mimetype="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


@app.route("/api/filtros")
def api_filtros():
    return jsonify({
        "cartoes": db.listar_cartoes(),
        "pessoas": db.listar_pessoas(),
    })


@app.route("/api/backup")
def api_backup():
    import shutil, tempfile
    tmp = tempfile.mktemp(suffix=".db")
    shutil.copy2(str(db.DB_PATH), tmp)
    with open(tmp, "rb") as f:
        data = f.read()
    import os; os.unlink(tmp)
    return Response(
        data,
        mimetype="application/octet-stream",
        headers={"Content-Disposition": "attachment; filename=financas_backup.db"},
    )


@app.route("/api/faturas")
def api_faturas():
    return jsonify(db.listar_faturas())


@app.route("/api/revisao")
def api_revisao():
    return jsonify(db.get_review_data())


# ────────────────── API: Pessoas ──────────────────

@app.route("/api/pessoas", methods=["GET", "POST"])
def api_pessoas():
    if request.method == "POST":
        d = _get_json_payload()
        nome = (d.get("nome") or "").strip()
        if not nome:
            return _json_error("Nome da pessoa é obrigatório")
        pid = db.criar_pessoa(nome, d.get("titular", False))
        return jsonify({"id": pid})
    return jsonify(db.listar_pessoas())


@app.route("/api/pessoas/<int:pid>", methods=["DELETE"])
def api_del_pessoa(pid):
    db.deletar_pessoa(pid)
    return jsonify({"status": "ok"})


@app.route("/api/transacoes/<int:tid>/divisao")
def api_get_tx_divisao(tid):
    return jsonify(db.get_divisao_por_transacao(tid))


# ────────────────── API: Divisões ──────────────────

@app.route("/api/divisoes", methods=["GET", "POST"])
def api_divisoes():
    if request.method == "POST":
        d = _get_json_payload()
        if not d.get("transacao_id"):
            return _json_error("Transação é obrigatória")
        if not isinstance(d.get("participantes_ids"), list) or not d["participantes_ids"]:
            return _json_error("Selecione ao menos um participante")
        if not d.get("pagador_id"):
            return _json_error("Pagador é obrigatório")

        did = db.criar_divisao(
            d["transacao_id"],
            d.get("descricao", ""),
            d["participantes_ids"],
            d["pagador_id"],
        )
        if did is None:
            return _json_error("Não foi possível criar a divisão")
        return jsonify({"id": did})
    return jsonify(db.listar_divisoes())


@app.route("/api/divisoes/<int:did>", methods=["DELETE"])
def api_del_divisao(did):
    db.deletar_divisao(did)
    return jsonify({"status": "ok"})


@app.route("/api/divisoes/participante/<int:part_id>/pagar", methods=["PUT"])
def api_pagar_part(part_id):
    db.marcar_participante_pago(part_id)
    return jsonify({"status": "ok"})


@app.route("/api/resumo-pessoas")
def api_resumo_pessoas():
    return jsonify(db.get_resumo_pessoas())


# ────────────────── API: Categorias ──────────────────

@app.route("/api/categorias", methods=["GET", "POST"])
def api_categorias():
    if request.method == "POST":
        d = _get_json_payload()
        nome = (d.get("nome") or "").strip()
        if not nome:
            return _json_error("Nome da categoria é obrigatório")
        cid = db.criar_categoria(nome, d.get("emoji", "💳"), d.get("cor", "#6b7280"))
        return jsonify({"id": cid})
    return jsonify(db.listar_categorias())


# ────────────────── API: Aliases ──────────────────

@app.route("/api/aliases", methods=["GET", "POST"])
def api_aliases():
    if request.method == "POST":
        d = _get_json_payload()
        descricao_original = (d.get("descricao_original") or "").strip()
        alias = (d.get("alias") or "").strip()
        if not descricao_original or not alias:
            return _json_error("Descrição original e apelido são obrigatórios")
        db.salvar_alias(descricao_original, alias)
        db.aplicar_regras_existentes()
        return jsonify({"status": "ok"})
    return jsonify(db.listar_aliases())


@app.route("/api/aliases/<int:aid>", methods=["DELETE"])
def api_del_alias(aid):
    db.deletar_alias(aid)
    return jsonify({"status": "ok"})


# ────────────────── API: Regras ──────────────────

@app.route("/api/regras", methods=["GET", "POST"])
def api_regras():
    if request.method == "POST":
        d = _get_json_payload()
        palavra_chave = (d.get("palavra_chave") or "").strip()
        categoria_id = d.get("categoria_id")
        if not palavra_chave:
            return _json_error("Palavra-chave é obrigatória")
        if not categoria_id:
            return _json_error("Categoria é obrigatória")
        rid = db.criar_regra(palavra_chave, categoria_id)
        aplicadas = db.aplicar_regras_existentes()
        return jsonify({"id": rid, "aplicadas": aplicadas})
    return jsonify(db.listar_regras())


@app.route("/api/regras/<int:rid>", methods=["DELETE"])
def api_del_regra(rid):
    db.deletar_regra(rid)
    return jsonify({"status": "ok"})


# ────────────────── API: Receitas ──────────────────

@app.route("/api/receitas", methods=["GET", "POST"])
def api_receitas():
    if request.method == "POST":
        d = _get_json_payload()
        if not d.get("data") or not (d.get("descricao") or "").strip():
            return _json_error("Data e descrição são obrigatórias")
        if d.get("valor") in (None, ""):
            return _json_error("Valor é obrigatório")
        rid = db.criar_receita(d["data"], d["descricao"], d["valor"],
                               d.get("tipo", "Outros"), d.get("recorrente", False))
        return jsonify({"id": rid})
    return jsonify(db.listar_receitas())


@app.route("/api/receitas/recorrentes/projetar", methods=["POST"])
def api_projetar_receitas():
    meses = int(request.args.get("meses", 3))
    count = db.projetar_receitas_recorrentes(meses)
    return jsonify({"status": "ok", "projetadas": count})


@app.route("/api/receitas/<int:rid>", methods=["DELETE"])
def api_del_receita(rid):
    db.deletar_receita(rid)
    return jsonify({"status": "ok"})


@app.route("/api/receitas/ajuste-fatura", methods=["POST"])
def api_ajuste_fatura():
    data = _get_json_payload()
    mes = data.get("mes")
    if not mes:
        return _json_error("Mês é obrigatório")
    
    dash = db.get_dashboard_data(mes)
    saldo = dash.get("saldo_contabil", dash.get("saldo", 0))
    if saldo >= 0:
        return _json_error("O saldo deses mês não é negativo, não há déficit para ajustar.")
    
    year, month = mes.split("-")
    dt = f"{year}-{month}-01"
    descricao = f"Ajuste Fatura Paga ({mes})"
    db.criar_receita(data=dt, descricao=descricao, valor=abs(saldo), tipo="Ajuste", recorrente=False)
    
    return jsonify({"status": "ok", "valor_ajustado": abs(saldo)})


# ────────────────── API: Dívidas ──────────────────

@app.route("/api/dividas", methods=["GET", "POST"])
def api_dividas():
    if request.method == "POST":
        d = _get_json_payload()
        if not (d.get("pessoa") or "").strip():
            return _json_error("Pessoa é obrigatória")
        if d.get("valor") in (None, "") or not d.get("data"):
            return _json_error("Valor e data são obrigatórios")
        did = db.criar_divida(d["pessoa"], d.get("descricao", ""), d["valor"], d["data"])
        return jsonify({"id": did})
    return jsonify(db.listar_dividas())


@app.route("/api/dividas/<int:did>", methods=["DELETE"])
def api_del_divida(did):
    db.deletar_divida(did)
    return jsonify({"status": "ok"})


@app.route("/api/dividas/<int:did>/pagar", methods=["PUT"])
def api_pagar(did):
    db.marcar_divida_paga(did)
    return jsonify({"status": "ok"})


# ────────────────── API: Orçamentos ──────────────────

@app.route("/api/orcamentos", methods=["GET", "POST"])
def api_orcamentos():
    if request.method == "POST":
        d = _get_json_payload()
        if not d.get("categoria_id"):
            return _json_error("Categoria é obrigatória")
        if d.get("valor_limite") in (None, ""):
            return _json_error("Valor limite é obrigatório")
        db.salvar_orcamento(d["categoria_id"], d["valor_limite"])
        return jsonify({"status": "ok"})
    return jsonify(db.listar_orcamentos())


@app.route("/api/orcamentos/<int:oid>", methods=["DELETE"])
def api_del_orcamento(oid):
    db.deletar_orcamento(oid)
    return jsonify({"status": "ok"})


@app.route("/api/orcamentos/status")
def api_orcamentos_status():
    return jsonify(db.get_orcamentos_status(mes=request.args.get("mes")))


# ────────────────── API: Dashboard ──────────────────

@app.route("/api/dashboard-data")
def api_dashboard():
    return jsonify(db.get_dashboard_data(
        mes=request.args.get("mes"),
        mes_inicio=request.args.get("mes_inicio"),
        mes_fim=request.args.get("mes_fim"),
    ))


@app.route("/api/dashboard-anual")
def api_dashboard_anual():
    return jsonify(db.get_dashboard_anual(ano=request.args.get("ano")))


@app.route("/api/transacoes/<int:tid>", methods=["DELETE"])
def api_del_transacao(tid):
    db.deletar_transacao(tid)
    return jsonify({"status": "ok"})


@app.route("/api/analytics/semanal")
def api_analise_semanal():
    return jsonify(db.get_analise_semanal(mes=request.args.get("mes")))


@app.route("/api/analytics/alertas")
def api_alertas():
    return jsonify(db.get_alertas_gastos(mes=request.args.get("mes")))


@app.route("/api/analytics/devedores")
def api_devedores():
    return jsonify(db.get_resumo_devedores())


if __name__ == "__main__":
    _auto_import()
    app.run(debug=True, port=5000)
