# 📊 Plano de Melhorias — Dashboard Finanças Pessoais

> **Contexto**: Sistema Flask + SQLite + Plotly.js para análise de faturas de cartão de crédito (Banco Inter).
> **Arquivos principais**: `database.py`, `app.py`, `templates/index.html`, `static/js/app.js`, `static/css/style.css`
> **Este plano foi feito para ser implementado por outro modelo de IA.**

---

## PARTE 1 — CORREÇÕES RÁPIDAS

### 1.1 Nova Categoria: Academia
**Arquivo**: `database.py` linha ~28
**Ação**: Adicionar `("Academia", "🏋️", "#06b6d4")` à lista `CATEGORIAS_PADRAO`, antes de `("Outros", ...)`.
O `init_db()` já faz `INSERT OR IGNORE`, então basta adicionar.

### 1.2 Tipos de Receita Expandidos
**Arquivo**: `templates/index.html` linha ~244-246
**Ação**: Substituir o `<select id="rec-tipo">` atual por:
```html
<select id="rec-tipo" class="form-select">
    <option>Salário</option>
    <option>Vale Alimentação</option>
    <option>Vale Refeição</option>
    <option>Freelance</option>
    <option>Investimento</option>
    <option>Reembolso</option>
    <option>Ajuste</option>
    <option>Outros</option>
</select>
```

### 1.3 Reorganizar aba "Dívidas" — Quem me deve no topo
**Arquivo**: `templates/index.html`
- Renomear na sidebar: `<span>Pessoas / Dívidas</span>`
- Dentro de `tab-dividas`, mover `<div id="resumo-pessoas"></div>` para ser o **primeiro elemento** da seção (antes de "Pessoas do Cartão")
- Dar um título claro: `<h3>💰 Quem me deve</h3>`

### 1.4 Deletar Transações
**Arquivo**: `database.py` — Adicionar:
```python
def deletar_transacao(tid):
    with get_db() as db:
        db.execute("DELETE FROM divisao_participantes WHERE divisao_id IN (SELECT id FROM divisoes WHERE transacao_id = ?)", (tid,))
        db.execute("DELETE FROM divisoes WHERE transacao_id = ?", (tid,))
        db.execute("DELETE FROM transacoes WHERE id = ?", (tid,))
```
**Arquivo**: `app.py` — Adicionar rota:
```python
@app.route("/api/transacoes/<int:tid>", methods=["DELETE"])
def api_del_transacao(tid):
    db.deletar_transacao(tid)
    return jsonify({"status": "ok"})
```
**Arquivo**: `app.js` — Na tabela de transações, adicionar botão 🗑️ na coluna Ações:
```javascript
<button class="btn btn-ghost btn-sm" onclick="if(confirm('Excluir transação?')) delTransacao(${tx.id})" title="Excluir">🗑️</button>
```
E a função:
```javascript
async function delTransacao(id) {
    await api(`/api/transacoes/${id}`, { method: 'DELETE' });
    toast('Transação excluída');
    loadTransacoes();
    loadDashboard();
}
```

---

## PARTE 2 — MODELO DE SALDO (FATURA PAGA NO MÊS SEGUINTE)

### Conceito
O cartão de crédito funciona assim:
- **Fatura do mês 5** = compras que entram na fatura de maio
- **Pagamento** = feito com o salário recebido no **mês 6**

### Decisão de Design
Manter **dois cálculos** visíveis:
1. **Saldo Contábil** (atual): `Receitas(M) - Despesas(M)` — mantém o que já existe
2. **Cobertura da Fatura** (novo): `Receitas(M+1) - Despesas(M)` — mostra se a receita do mês seguinte cobre a fatura

### Implementação

**Arquivo**: `database.py` — Na função `get_dashboard_data` (~linha 994), adicionar cálculo:
```python
# Calcular cobertura: receita do mês seguinte cobre a fatura atual?
cobertura_fatura = None
if year and month:
    from dateutil.relativedelta import relativedelta
    from datetime import datetime
    mes_dt = datetime(int(year), int(month), 1)
    prox = mes_dt + relativedelta(months=1)
    prox_mes = prox.strftime("%Y-%m")
    rec_prox = db.execute(
        "SELECT COALESCE(SUM(valor), 0) AS total FROM receitas WHERE SUBSTR(data,1,7) = ?",
        (prox_mes,)
    ).fetchone()["total"]
    cobertura_fatura = {
        "receita_prox_mes": rec_prox,
        "despesa_mes_atual": total_desp,
        "saldo_cobertura": rec_prox - total_desp,
        "mes_pagamento": prox_mes,
        "cobre": rec_prox >= total_desp,
    }
```
Adicionar `"cobertura_fatura": cobertura_fatura` no return dict.

**Arquivo**: `index.html` — Adicionar card novo após os summary-cards existentes:
```html
<div class="card summary-card" id="card-cobertura" style="display:none">
    <div class="card-icon">📋</div>
    <div class="card-info">
        <span class="card-label">Cobertura da fatura</span>
        <span class="card-value" id="v-cobertura">R$ 0,00</span>
        <span class="card-sublabel" id="v-cobertura-label"></span>
    </div>
</div>
```

**Arquivo**: `app.js` — No `loadDashboard`, renderizar:
```javascript
const cob = data.cobertura_fatura;
const cardCob = document.getElementById('card-cobertura');
if (cob && mes) {
    cardCob.style.display = '';
    document.getElementById('v-cobertura').textContent = BRL(cob.saldo_cobertura);
    document.getElementById('v-cobertura').className = `card-value ${cob.cobre ? 'positive' : 'negative'}`;
    document.getElementById('v-cobertura-label').textContent =
        `Receita ${cob.mes_pagamento} ${cob.cobre ? 'cobre' : 'NÃO cobre'} esta fatura`;
} else {
    cardCob.style.display = 'none';
}
```

---

## PARTE 3 — FILTRO POR INTERVALO DE DATAS

### Implementação

**Arquivo**: `database.py`
- Em `listar_transacoes` (~linha 394), adicionar parâmetros `mes_inicio=None, mes_fim=None`
- Quando ambos preenchidos, substituir o filtro de mês único por:
```python
if mes_inicio and mes_fim:
    sql += " AND t.mes_referencia BETWEEN ? AND ?"
    params.extend([mes_inicio, mes_fim])
elif year and month:
    sql += " AND t.mes_referencia = ?"
    params.append(f"{year}-{month}")
```
- Fazer o mesmo em `get_dashboard_data`: aceitar `mes_inicio` e `mes_fim`
- Quando intervalo ativo, calcular totais agregando todo o range

**Arquivo**: `app.py`
- Nas rotas `api_transacoes`, `api_dashboard`, `api_exportar_transacoes`: ler e passar `mes_inicio` e `mes_fim` do `request.args`

**Arquivo**: `index.html`
- No Dashboard, após o select de mês, adicionar:
```html
<span style="color:var(--text-dim);margin:0 0.25rem">ou</span>
<input type="month" id="dash-mes-inicio" class="form-input short-input" onchange="loadDashboard()" placeholder="De">
<input type="month" id="dash-mes-fim" class="form-input short-input" onchange="loadDashboard()" placeholder="Até">
```
- Mesmo padrão na aba Transações

**Arquivo**: `app.js`
- No `loadDashboard`: quando os inputs de intervalo estiverem preenchidos, enviar `mes_inicio` e `mes_fim` e ignorar o select de mês único
- No `getTransactionParams`: mesmo tratamento

---

## PARTE 4 — DASHBOARD ANUAL

### Decisão: Sub-aba dentro do Dashboard (toggle Mensal/Anual)
Razão: menos poluição na sidebar, contexto mantido.

### 4.1 Backend

**Arquivo**: `database.py` — Nova função:
```python
def get_dashboard_anual(ano=None):
    if not ano:
        ano = str(date_type.today().year)
    with get_db() as db:
        rc = _real_clause("")
        base = f"{rc} AND COALESCE(ignorado,0)=0 AND mes_referencia LIKE ?"
        param = f"{ano}-%"

        # Total despesas do ano
        total_desp = db.execute(
            f"SELECT COALESCE(SUM(valor),0) AS t FROM transacoes WHERE {base}", (param,)
        ).fetchone()["t"]

        # Total receitas do ano
        total_rec = db.execute(
            "SELECT COALESCE(SUM(valor),0) AS t FROM receitas WHERE data LIKE ?", (f"{ano}-%",)
        ).fetchone()["t"]

        # Contagem de meses com dados
        meses_com_dados = db.execute(
            f"SELECT COUNT(DISTINCT mes_referencia) AS t FROM transacoes WHERE {base}", (param,)
        ).fetchone()["t"]

        # Média mensal
        media_mensal = total_desp / max(meses_com_dados, 1)

        # Previsão anual (média * 12)
        previsao_anual = media_mensal * 12

        # Evolução mês a mês
        evolucao = [dict(r) for r in db.execute(f"""
            SELECT mes_referencia AS mes,
                   SUBSTR(mes_referencia,6,2)||'/'||SUBSTR(mes_referencia,1,4) AS label,
                   ROUND(SUM(valor),2) AS total
            FROM transacoes
            WHERE {base}
            GROUP BY mes_referencia ORDER BY mes_referencia
        """, (param,)).fetchall()]

        # Receitas mês a mês
        receitas_mes = [dict(r) for r in db.execute("""
            SELECT SUBSTR(data,1,7) AS mes,
                   SUBSTR(data,6,2)||'/'||SUBSTR(data,1,4) AS label,
                   ROUND(SUM(valor),2) AS total
            FROM receitas WHERE data LIKE ?
            GROUP BY SUBSTR(data,1,7) ORDER BY mes
        """, (f"{ano}-%",)).fetchall()]

        # Gastos por categoria no ano
        por_categoria = [dict(r) for r in db.execute(f"""
            SELECT c.nome, c.emoji, c.cor, ROUND(SUM(t.valor),2) AS total
            FROM transacoes t JOIN categorias c ON t.categoria_id = c.id
            WHERE {_real_clause('t.')} AND COALESCE(t.ignorado,0)=0 AND t.mes_referencia LIKE ?
            GROUP BY c.id HAVING total > 0 ORDER BY total DESC
        """, (param,)).fetchall()]

        # Mês com maior gasto
        maior_mes = db.execute(f"""
            SELECT mes_referencia AS mes, ROUND(SUM(valor),2) AS total
            FROM transacoes WHERE {base}
            GROUP BY mes_referencia ORDER BY total DESC LIMIT 1
        """, (param,)).fetchone()

        # Mês com menor gasto
        menor_mes = db.execute(f"""
            SELECT mes_referencia AS mes, ROUND(SUM(valor),2) AS total
            FROM transacoes WHERE {base}
            GROUP BY mes_referencia ORDER BY total ASC LIMIT 1
        """, (param,)).fetchone()

        # Top 10 gastos do ano
        top_gastos = [dict(r) for r in db.execute(f"""
            SELECT COALESCE(a.alias, t.descricao) AS nome, t.valor, t.data
            FROM transacoes t
            LEFT JOIN aliases a ON UPPER(a.descricao_original)=UPPER(t.descricao)
            WHERE {_real_clause('t.')} AND COALESCE(t.ignorado,0)=0 AND t.mes_referencia LIKE ?
            ORDER BY t.valor DESC LIMIT 10
        """, (param,)).fetchall()]

        # Top categorias
        top_categorias = [dict(r) for r in db.execute(f"""
            SELECT c.nome, c.emoji, c.cor,
                   ROUND(SUM(t.valor),2) AS total,
                   COUNT(*) AS quantidade,
                   ROUND(AVG(t.valor),2) AS media
            FROM transacoes t JOIN categorias c ON t.categoria_id = c.id
            WHERE {_real_clause('t.')} AND COALESCE(t.ignorado,0)=0 AND t.mes_referencia LIKE ?
            GROUP BY c.id ORDER BY total DESC LIMIT 8
        """, (param,)).fetchall()]

        # Anos disponíveis
        anos = [r[0] for r in db.execute(
            "SELECT DISTINCT SUBSTR(mes_referencia,1,4) FROM transacoes WHERE mes_referencia != '' ORDER BY 1 DESC"
        ).fetchall()]

        return {
            "ano": ano,
            "anos_disponiveis": anos,
            "total_despesas": total_desp,
            "total_receitas": total_rec,
            "saldo": total_rec - total_desp,
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
```

**Arquivo**: `app.py` — Nova rota:
```python
@app.route("/api/dashboard-anual")
def api_dashboard_anual():
    return jsonify(db.get_dashboard_anual(ano=request.args.get("ano")))
```

### 4.2 Frontend

**Arquivo**: `index.html` — Dentro de `tab-dashboard`, antes do conteúdo atual:
Envolver todo o conteúdo atual do dashboard em `<div id="dash-mensal">...</div>`.
Adicionar toggle e seção anual:
```html
<!-- Toggle no topo -->
<div class="dash-toggle" style="display:flex;gap:0.5rem;margin-bottom:1rem">
    <button class="toggle-btn active" id="btn-dash-mensal" onclick="showDashView('mensal')">📅 Mensal</button>
    <button class="toggle-btn" id="btn-dash-anual" onclick="showDashView('anual')">📊 Anual</button>
</div>

<!-- Seção Anual (inicialmente oculta) -->
<div id="dash-anual" style="display:none">
    <div class="section-header">
        <h2>Visão Anual</h2>
        <select id="dash-ano" class="filter-select" onchange="loadDashboardAnual()"></select>
    </div>
    <div class="summary-cards">
        <div class="card summary-card despesas"><div class="card-icon">💸</div><div class="card-info"><span class="card-label">Total gasto no ano</span><span class="card-value" id="va-despesas">R$ 0</span></div></div>
        <div class="card summary-card receitas"><div class="card-icon">💰</div><div class="card-info"><span class="card-label">Receita total</span><span class="card-value" id="va-receitas">R$ 0</span></div></div>
        <div class="card summary-card"><div class="card-icon">📊</div><div class="card-info"><span class="card-label">Média mensal</span><span class="card-value" id="va-media">R$ 0</span></div></div>
        <div class="card summary-card"><div class="card-icon">🔮</div><div class="card-info"><span class="card-label">Previsão anual</span><span class="card-value" id="va-previsao">R$ 0</span></div></div>
    </div>
    <div class="dashboard-grid" style="margin-bottom:1.5rem">
        <div class="card insight-card"><h3>📈 Mês mais caro</h3><div id="va-maior-mes"></div></div>
        <div class="card insight-card"><h3>📉 Mês mais barato</h3><div id="va-menor-mes"></div></div>
    </div>
    <div class="charts-row">
        <div class="card chart-card"><h3>📈 Despesas vs Receitas por Mês</h3><div id="chart-anual-evo" style="height:350px"></div></div>
        <div class="card chart-card"><h3>🥧 Categorias no Ano</h3><div id="chart-anual-cat" style="height:350px"></div></div>
    </div>
    <div class="dashboard-grid">
        <div class="card"><h3>🏆 Top 10 gastos do ano</h3><div id="anual-top-gastos"></div></div>
        <div class="card"><h3>📂 Ranking de categorias</h3><div id="anual-top-cats"></div></div>
    </div>
</div>
```

**Arquivo**: `app.js` — Adicionar funções:
```javascript
function showDashView(view) {
    document.getElementById('dash-mensal').style.display = view === 'mensal' ? '' : 'none';
    document.getElementById('dash-anual').style.display = view === 'anual' ? '' : 'none';
    document.getElementById('btn-dash-mensal').classList.toggle('active', view === 'mensal');
    document.getElementById('btn-dash-anual').classList.toggle('active', view === 'anual');
    if (view === 'anual') loadDashboardAnual();
}

async function loadDashboardAnual() {
    const ano = document.getElementById('dash-ano').value;
    const data = await api(`/api/dashboard-anual${ano ? `?ano=${ano}` : ''}`);

    // Preencher select de anos
    const sel = document.getElementById('dash-ano');
    if (sel.options.length <= 1) {
        sel.innerHTML = '';
        data.anos_disponiveis.forEach(a => {
            const o = document.createElement('option');
            o.value = a; o.textContent = a;
            sel.appendChild(o);
        });
        sel.value = data.ano;
    }

    // Cards
    document.getElementById('va-despesas').textContent = BRL(data.total_despesas);
    document.getElementById('va-receitas').textContent = BRL(data.total_receitas);
    document.getElementById('va-media').textContent = BRL(data.media_mensal);
    document.getElementById('va-previsao').textContent = BRL(data.previsao_anual);

    // Maior/menor mês
    document.getElementById('va-maior-mes').innerHTML = data.maior_mes
        ? `<div class="valor-cell" style="font-size:1.5rem">${BRL(data.maior_mes.total)}</div><div class="muted-line">${data.maior_mes.mes}</div>`
        : showEmptyState('Sem dados');
    document.getElementById('va-menor-mes').innerHTML = data.menor_mes
        ? `<div class="valor-cell" style="font-size:1.5rem">${BRL(data.menor_mes.total)}</div><div class="muted-line">${data.menor_mes.mes}</div>`
        : showEmptyState('Sem dados');

    // Gráfico evolução: barras de despesa + linha de receita
    const evoLabels = data.evolucao_mensal.map(d => d.label);
    const recMap = {};
    data.receitas_mensal.forEach(r => recMap[r.mes] = r.total);
    Plotly.react('chart-anual-evo', [
        { name: 'Despesas', x: evoLabels, y: data.evolucao_mensal.map(d => d.total), type: 'bar', marker: { color: 'rgba(124,58,237,0.8)' } },
        { name: 'Receitas', x: evoLabels, y: data.evolucao_mensal.map(d => recMap[d.mes] || 0), type: 'scatter', mode: 'lines+markers', line: { color: '#34d399', width: 3 } },
    ], { ...PLOTLY_LAYOUT, barmode: 'group' }, { responsive: true });

    // Gráfico categorias
    if (data.por_categoria.length) {
        Plotly.react('chart-anual-cat', [{
            values: data.por_categoria.map(d => d.total),
            labels: data.por_categoria.map(d => `${d.emoji} ${d.nome}`),
            marker: { colors: data.por_categoria.map(d => d.cor) },
            hole: 0.55, type: 'pie', textinfo: 'percent+label',
        }], { ...PLOTLY_LAYOUT, margin: { t: 10, r: 10, b: 10, l: 10 } }, { responsive: true });
    }

    // Top gastos
    document.getElementById('anual-top-gastos').innerHTML = renderSimpleTable(
        ['#', 'Descrição', 'Valor', 'Data'],
        data.top_gastos.map((r, i) => `<tr><td>${i+1}</td><td>${escapeHtml(r.nome)}</td><td class="valor-cell">${BRL(r.valor)}</td><td>${escapeHtml(r.data)}</td></tr>`)
    );

    // Ranking categorias
    document.getElementById('anual-top-cats').innerHTML = renderSimpleTable(
        ['Categoria', 'Qtd', 'Média', 'Total'],
        data.top_categorias.map(r => `<tr><td>${r.emoji} ${escapeHtml(r.nome)}</td><td>${r.quantidade}</td><td class="valor-cell">${BRL(r.media)}</td><td class="valor-cell">${BRL(r.total)}</td></tr>`)
    );
}
```

**Arquivo**: `style.css` — Adicionar:
```css
.dash-toggle { display: flex; gap: 0.5rem; }
.toggle-btn {
    padding: 0.5rem 1.25rem; border-radius: var(--radius-sm);
    background: var(--surface); border: 1px solid var(--border);
    color: var(--text-dim); cursor: pointer; font-weight: 600;
    transition: var(--transition);
}
.toggle-btn.active {
    background: var(--primary); color: white; border-color: var(--primary);
}
.toggle-btn:hover:not(.active) { background: var(--surface-hover); }
```

---

## PARTE 5 — FILTRO POR INTERVALO DE DATAS

**Arquivo**: `database.py`
- Em `listar_transacoes` (linha ~394): adicionar params `mes_inicio=None, mes_fim=None`
- Em `get_dashboard_data` (linha ~994): adicionar mesmos params
- Lógica de filtro (em ambas as funções):
```python
if mes_inicio and mes_fim:
    sql += " AND t.mes_referencia BETWEEN ? AND ?"
    params.extend([mes_inicio, mes_fim])
elif year and month:
    sql += " AND t.mes_referencia = ?"
    params.append(f"{year}-{month}")
```

**Arquivo**: `app.py`
- Nas rotas `api_transacoes`, `api_dashboard`, `api_exportar_transacoes`: ler `request.args.get("mes_inicio")` e `request.args.get("mes_fim")` e passar.

**Arquivo**: `index.html`
- No Dashboard e na aba Transações, adicionar após o select de mês:
```html
<span style="color:var(--text-dim)">ou intervalo:</span>
<input type="month" id="dash-mes-inicio" class="form-input short-input" onchange="loadDashboard()">
<input type="month" id="dash-mes-fim" class="form-input short-input" onchange="loadDashboard()">
```

**Arquivo**: `app.js`
- Atualizar `loadDashboard` e `getTransactionParams` para priorizar intervalo sobre mês único:
```javascript
const mesInicio = document.getElementById('dash-mes-inicio')?.value;
const mesFim = document.getElementById('dash-mes-fim')?.value;
if (mesInicio && mesFim) {
    url += `?mes_inicio=${mesInicio}&mes_fim=${mesFim}`;
} else if (mes) {
    url += `?mes=${mes}`;
}
```

---

## PARTE 6 — MELHORIAS NOS GRÁFICOS

### 6.1 Gráfico Receita vs Despesa no Dashboard Mensal
**Arquivo**: `database.py` — Em `get_dashboard_data`, adicionar ao `evolucao`:
```python
# Adicionar receitas por mês à evolução
receitas_por_mes = {}
for r in db.execute("SELECT SUBSTR(data,1,7) AS mes, SUM(valor) AS total FROM receitas GROUP BY SUBSTR(data,1,7)").fetchall():
    receitas_por_mes[r["mes"]] = r["total"]
for item in evolucao:
    item["receita"] = receitas_por_mes.get(item["mes_sort"], 0)
```

**Arquivo**: `app.js` — Em `renderEvolutionChart`, adicionar trace de receitas:
```javascript
{
    name: 'Receitas', x: data.map(d => d.mes_ano),
    y: data.map(d => d.receita || 0),
    type: 'scatter', mode: 'lines+markers',
    line: { color: '#34d399', width: 2 },
}
```

### 6.2 Gráfico de Categorias com valores
**Arquivo**: `app.js` — No `renderCategoryChart`, mudar `textinfo` para `'percent+value'`

---

## PARTE 7 — CORREÇÃO TÉCNICA: ORÇAMENTOS

**Arquivo**: `database.py` — Na função `get_orcamentos_status` (linha ~547):
Trocar o filtro de data:
```python
# DE:
where += " AND data LIKE ?"
params.append(f"%/{month}/{year}")
# PARA:
where += " AND mes_referencia = ?"
params.append(f"{year}-{month}")
```
Isso alinha com o resto do sistema que usa `mes_referencia`.

---

## RESUMO DE ARQUIVOS MODIFICADOS

| Arquivo | Seções alteradas |
|---|---|
| `database.py` | CATEGORIAS_PADRAO, listar_transacoes, get_dashboard_data, get_orcamentos_status, **NEW** get_dashboard_anual, **NEW** deletar_transacao |
| `app.py` | **NEW** rota dashboard-anual, **NEW** rota DELETE transacao, params de intervalo em rotas existentes |
| `templates/index.html` | Receitas tipos, sidebar renome, resumo-pessoas no topo, toggle mensal/anual, seção anual, card cobertura, inputs intervalo |
| `static/js/app.js` | **NEW** showDashView, **NEW** loadDashboardAnual, **NEW** delTransacao, atualização loadDashboard, atualização gráficos |
| `static/css/style.css` | **NEW** .dash-toggle, .toggle-btn |

## ORDEM DE IMPLEMENTAÇÃO SUGERIDA
1. Parte 1 (rápidas) → testar
2. Parte 7 (fix orçamentos) → testar
3. Parte 2 (saldo cobertura) → testar
4. Parte 5 (intervalo datas) → testar
5. Parte 4 (dashboard anual) → testar
6. Parte 6 (gráficos) → testar
