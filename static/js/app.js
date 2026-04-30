let categorias = [];
let pessoas = [];
let cartoes = [];
let currentSplitTxId = null;
let selectedTxIds = new Set();

const BRL = value => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

async function api(path, opts = {}) {
    const response = await fetch(path, opts);
    const contentType = response.headers.get('content-type') || '';
    const payload = contentType.includes('application/json')
        ? await response.json()
        : { error: await response.text() };
    if (!response.ok) throw new Error(payload.error || 'Erro inesperado na requisição');
    return payload;
}

function toast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    const toastEl = document.createElement('div');
    toastEl.className = `toast ${type}`;
    toastEl.textContent = message;
    container.appendChild(toastEl);
    setTimeout(() => toastEl.remove(), 3200);
}

function escapeHtml(value = '') {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function showEmptyState(message, icon = '…') {
    return `<div class="empty-state"><div class="empty-icon">${icon}</div><p>${message}</p></div>`;
}

function formatMonthRef(value) {
    if (!value || typeof value !== 'string' || !value.includes('-')) return '—';
    const [year, month] = value.split('-');
    return `${month}/${year}`;
}

function formatDate(value) {
    if (!value) return '—';
    // YYYY-MM-DD → dd/mm/yyyy
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        const [y, m, d] = value.split('-');
        return `${d}/${m}/${y}`;
    }
    return value;
}

// ─── Theme toggle ───

function toggleTheme() {
    const html = document.documentElement;
    const isDark = html.dataset.theme === 'dark';
    html.dataset.theme = isDark ? 'light' : 'dark';
    document.getElementById('theme-btn').textContent = isDark ? '🌞' : '🌙';
    localStorage.setItem('theme', html.dataset.theme);
}

(function initTheme() {
    const saved = localStorage.getItem('theme') || 'dark';
    document.documentElement.dataset.theme = saved;
    document.addEventListener('DOMContentLoaded', () => {
        const btn = document.getElementById('theme-btn');
        if (btn) btn.textContent = saved === 'dark' ? '🌙' : '🌞';
    });
})();

// ─── Navigation ───

document.querySelectorAll('.nav-item').forEach(el => {
    el.addEventListener('click', event => {
        event.preventDefault();
        showTab(el.dataset.tab);
    });
});

function showTab(name) {
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    document.querySelector(`[data-tab="${name}"]`).classList.add('active');
    document.getElementById(`tab-${name}`).classList.add('active');
    const loaders = {
        dashboard: loadDashboard,
        transacoes: loadTransacoes,
        revisao: loadReview,
        importar: loadImportHistory,
        regras: loadRegras,
        receitas: loadReceitas,
        dividas: loadDividas,
    };
    if (loaders[name]) loaders[name]();
}

// ─── Global data loaders ───

async function loadCategorias() {
    categorias = await api('/api/categorias');
    populateCatSelects();
}

async function loadFiltros() {
    const data = await api('/api/filtros');
    cartoes = data.cartoes || [];
    pessoas = data.pessoas || [];
    populateCardFilter();
    populateRespFilter();
}

function populateCardFilter() {
    const select = document.getElementById('tx-cartao');
    const previous = select.value;
    select.innerHTML = '<option value="">Todos os cartões</option>';
    cartoes.forEach(card => {
        const opt = document.createElement('option');
        opt.value = card;
        opt.textContent = `Final ${card}`;
        select.appendChild(opt);
    });
    select.value = previous;
}

function populateRespFilter() {
    const select = document.getElementById('tx-resp');
    if (!select) return;
    const previous = select.value;
    select.innerHTML = '<option value="">Todos os responsáveis</option>';
    pessoas.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = p.nome + (p.titular ? ' ✦' : '');
        select.appendChild(opt);
    });
    select.value = previous;
}

function populateCatSelects() {
    const txCat = document.getElementById('tx-cat');
    const previous = txCat.value;
    txCat.innerHTML = '<option value="">Todas as categorias</option><option value="sem">Sem categoria</option>';
    categorias.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = `${c.emoji} ${c.nome}`;
        txCat.appendChild(opt);
    });
    txCat.value = previous;

    ['regra-cat', 'orc-cat', 'batch-cat'].forEach(id => {
        const sel = document.getElementById(id);
        if (!sel) return;
        const prev = sel.value;
        sel.innerHTML = id === 'batch-cat' ? '<option value="">— Categoria —</option>' : '';
        categorias.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c.id;
            opt.textContent = `${c.emoji} ${c.nome}`;
            sel.appendChild(opt);
        });
        if (prev) sel.value = prev;
    });
}

function catSelectHTML(txId, currentCatId) {
    const options = ['<option value="">— sem —</option>']
        .concat(categorias.map(c => {
            const sel = c.id === currentCatId ? ' selected' : '';
            return `<option value="${c.id}"${sel}>${escapeHtml(c.emoji)} ${escapeHtml(c.nome)}</option>`;
        }));
    return `<select class="cat-select" onchange="updateCat(${txId}, this.value)">${options.join('')}</select>`;
}

function respSelectHTML(txId, currentRespId) {
    const options = ['<option value="">—</option>']
        .concat(pessoas.map(p => {
            const sel = p.id === currentRespId ? ' selected' : '';
            return `<option value="${p.id}"${sel}>${escapeHtml(p.nome)}${p.titular ? ' ✦' : ''}</option>`;
        }));
    return `<select class="resp-select" onchange="updateResp(${txId}, this.value)">${options.join('')}</select>`;
}

// ─── Plotly layout base ───

const PLOTLY_LAYOUT = {
    paper_bgcolor: 'transparent',
    plot_bgcolor: 'transparent',
    font: { color: '#94a3b8', family: 'Inter, sans-serif' },
    margin: { t: 10, r: 10, b: 40, l: 50 },
    xaxis: { gridcolor: 'rgba(255,255,255,0.05)' },
    yaxis: { gridcolor: 'rgba(255,255,255,0.05)' },
};

function renderSimpleTable(headers, rows) {
    if (!rows.length) return showEmptyState('Sem dados');
    return `
        <table class="data-table">
            <thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead>
            <tbody>${rows.join('')}</tbody>
        </table>
    `;
}

// ─── Dashboard ───

function renderCompare(data) {
    const container = document.getElementById('comparativo-mes');
    const cur = data.atual || {};
    const prev = data.anterior || {};
    const sign = v => v > 0 ? '+' : '';
    container.innerHTML = `
        <div class="compare-item">
            <span class="card-label">Mês atual</span>
            <strong>${escapeHtml(cur.label || '—')}</strong>
            <span>${BRL(cur.despesas || 0)}</span>
        </div>
        <div class="compare-item">
            <span class="card-label">Mês anterior</span>
            <strong>${escapeHtml(prev.label || '—')}</strong>
            <span>${BRL(prev.despesas || 0)}</span>
        </div>
        <div class="compare-item">
            <span class="card-label">Δ Despesas</span>
            <strong class="${(data.delta_despesas || 0) <= 0 ? 'positive' : 'negative'}">${sign(data.delta_despesas || 0)}${BRL(data.delta_despesas || 0)}</strong>
            <span>${cur.quantidade || 0} transações</span>
        </div>
        <div class="compare-item">
            <span class="card-label">Δ Receitas</span>
            <strong class="${(data.delta_receitas || 0) >= 0 ? 'positive' : 'negative'}">${sign(data.delta_receitas || 0)}${BRL(data.delta_receitas || 0)}</strong>
            <span>Saldo: ${BRL(cur.saldo || 0)}</span>
        </div>
    `;
}

function renderReviewCounters(review) {
    const r = review;
    document.getElementById('review-counters').innerHTML = `
        <div class="mini-stat" onclick="showTab('revisao'); setTimeout(()=>document.getElementById('rev-filter-tipo').value='sem-cat',100); loadReview()"><div class="mini-stat-value ${r.sem_categoria > 0 ? 'negative' : ''}">${r.sem_categoria}</div><div class="mini-stat-label">Sem Categoria</div></div>
        <div class="mini-stat" onclick="showTab('revisao'); setTimeout(()=>document.getElementById('rev-filter-tipo').value='sem-alias',100); loadReview()"><div class="mini-stat-value">${r.sem_alias}</div><div class="mini-stat-label">Sem Alias</div></div>
        <div class="mini-stat" onclick="showTab('revisao'); setTimeout(()=>document.getElementById('rev-filter-tipo').value='parceladas',100); loadReview()"><div class="mini-stat-value">${r.parceladas}</div><div class="mini-stat-label">Parceladas</div></div>
        <div class="mini-stat" onclick="showTab('revisao'); setTimeout(()=>document.getElementById('rev-filter-tipo').value='recorrentes',100); loadReview()"><div class="mini-stat-value">${r.recorrentes}</div><div class="mini-stat-label">Recorrentes</div></div>
    `;
}

function renderDashDevedores(data) {
    const c = document.getElementById('dash-devedores');
    if (!data || !data.devedores || data.devedores.length === 0) {
        c.innerHTML = showEmptyState('Ninguém te deve nada 😎');
        return;
    }
    const html = data.devedores.slice(0, 4).map(d => {
        let tags = '';
        if (d.total_cartao > 0) tags += `<span style="background:rgba(167,139,250,0.15);color:#c4b5fd;padding:2px 6px;border-radius:4px;white-space:nowrap;">💳 Cartão: ${BRL(d.total_cartao)}</span>`;
        if (d.total_divisoes > 0) tags += `<span style="background:rgba(52,211,153,0.15);color:#6ee7b7;padding:2px 6px;border-radius:4px;white-space:nowrap;">🔄 Divisão: ${BRL(d.total_divisoes)}</span>`;
        if (d.total_manual > 0) tags += `<span style="background:rgba(251,191,36,0.15);color:#fcd34d;padding:2px 6px;border-radius:4px;white-space:nowrap;">📝 Manual: ${BRL(d.total_manual)}</span>`;
        
        return `
        <div style="display:flex;flex-direction:column;gap:0.4rem;padding:0.75rem;background:var(--bg-lighter);border-radius:var(--radius-md);border:1px solid rgba(255,255,255,0.05);box-shadow:0 2px 4px rgba(0,0,0,0.1);transition:transform 0.2s" onmouseover="this.style.transform='scale(1.02)'" onmouseout="this.style.transform='scale(1)'">
            <div style="display:flex;justify-content:space-between;align-items:center">
                <span style="font-weight:600;font-size:1rem;color:var(--text-light)">${escapeHtml(d.nome)}</span>
                <span style="color:#ef4444;font-weight:700;font-size:1.1rem">${BRL(d.total_deve)}</span>
            </div>
            <div style="display:flex;flex-wrap:wrap;gap:0.4rem;font-size:0.75rem">
                ${tags}
            </div>
        </div>
        `;
    }).join('');
    c.innerHTML = html + (data.devedores.length > 4 ? `<div style="text-align:center;font-size:0.8rem;color:var(--text-muted);margin-top:0.5rem">+${data.devedores.length - 4} pessoa(s)</div>` : '');
}

function renderCategoryChart(data) {
    if (!data.length) { document.getElementById('chart-cat').innerHTML = showEmptyState('Sem dados'); return; }
    Plotly.react('chart-cat', [{
        values: data.map(d => d.total),
        labels: data.map(d => `${d.emoji} ${d.nome}`),
        marker: { colors: data.map(d => d.cor) },
        hole: 0.55, type: 'pie', textinfo: 'percent+value',
    }], { ...PLOTLY_LAYOUT, margin: { t: 10, r: 10, b: 10, l: 10 } }, { responsive: true });
}

function renderEvolutionChart(data) {
    if (!data.length) { document.getElementById('chart-evo').innerHTML = showEmptyState('Sem dados'); return; }
    const totals = data.map(d => d.total);
    const ma = totals.map((_, i) => {
        const slice = totals.slice(Math.max(0, i - 2), i + 1);
        return Math.round(slice.reduce((a, b) => a + b, 0) / slice.length);
    });
    Plotly.react('chart-evo', [
        { name: 'Real', x: data.map(d => d.mes_ano), y: totals, type: 'bar', marker: { color: 'rgba(124,58,237,0.8)' } },
        { name: 'Projetado', x: data.map(d => d.mes_ano), y: data.map(d => d.total_projetado), type: 'bar', marker: { color: 'rgba(34,211,238,0.55)' } },
        { name: 'Receitas', x: data.map(d => d.mes_ano), y: data.map(d => d.receita || 0), type: 'scatter', mode: 'lines+markers', line: { color: '#34d399', width: 2 }, marker: { size: 5 } },
        { name: 'Média 3m', x: data.map(d => d.mes_ano), y: ma, type: 'scatter', mode: 'lines+markers', line: { color: '#f59e0b', width: 2, dash: 'dot' }, marker: { size: 5 } },
    ], { ...PLOTLY_LAYOUT, barmode: 'stack' }, { responsive: true });
}

function renderCardChart(data) {
    if (!data.length) { document.getElementById('chart-cartao').innerHTML = showEmptyState('Sem dados'); return; }
    Plotly.react('chart-cartao', [{
        values: data.map(d => d.total),
        labels: data.map(d => d.cartao),
        type: 'pie', hole: 0.4,
        marker: { colors: ['#a78bfa', '#34d399', '#f472b6', '#60a5fa', '#fbbf24'] },
    }], PLOTLY_LAYOUT, { responsive: true });
}

function renderSemanaChart(data) {
    if (!data || !data.length) { document.getElementById('chart-semana').innerHTML = showEmptyState('Sem dados'); return; }
    Plotly.react('chart-semana', [{
        x: data.map(d => d.semana),
        y: data.map(d => d.total),
        type: 'bar',
        text: data.map(d => `${d.quantidade} compras`),
        marker: { color: 'rgba(52, 211, 153, 0.8)' }
    }], PLOTLY_LAYOUT, { responsive: true });
}

function renderDayChart(data) {
    if (!data.length) { document.getElementById('chart-dia').innerHTML = showEmptyState('Sem dados'); return; }
    Plotly.react('chart-dia', [{
        x: data.map(d => d.dia), y: data.map(d => d.total),
        type: 'scatter', mode: 'lines+markers',
        line: { color: '#f59e0b', width: 3 },
        fill: 'tozeroy', fillcolor: 'rgba(245,158,11,0.08)',
    }], PLOTLY_LAYOUT, { responsive: true });
}

function renderParcelChart(data) {
    if (!data.length) { document.getElementById('chart-parcelas').innerHTML = showEmptyState('Sem dados'); return; }
    Plotly.react('chart-parcelas', [{
        x: data.map(d => d.mes_ano), y: data.map(d => d.total),
        type: 'bar', marker: { color: '#34d399' },
    }], PLOTLY_LAYOUT, { responsive: true });
}

function renderRecurringList(targetId, rows) {
    const target = document.getElementById(targetId);
    if (!rows.length) { target.innerHTML = showEmptyState('Nenhuma recorrência detectada'); return; }
    target.innerHTML = rows.map(r => `
        <div class="list-row">
            <div>
                <strong>${escapeHtml(r.nome_exibido)}</strong>
                <div class="muted-line">${r.meses} meses · ${r.quantidade} lançamentos</div>
            </div>
            <div class="value-stack">
                <strong>${BRL(r.total)}</strong>
                <span>${BRL(r.valor_medio)} médio</span>
            </div>
        </div>
    `).join('');
}

function renderTopTables(topGastos, topEstab) {
    document.getElementById('top-gastos').innerHTML = renderSimpleTable(
        ['#', 'Descrição', 'Valor', 'Data'],
        topGastos.map((r, i) => `
            <tr>
                <td>${i + 1}</td>
                <td>${escapeHtml(r.nome_exibido)}</td>
                <td class="valor-cell">${BRL(r.valor)}</td>
                <td>${escapeHtml(r.data)}</td>
            </tr>
        `),
    );
    document.getElementById('top-estabelecimentos').innerHTML = renderSimpleTable(
        ['Estabelecimento', 'Qtd', 'Total'],
        topEstab.map(r => `
            <tr>
                <td>${escapeHtml(r.nome_exibido)}</td>
                <td>${r.quantidade}</td>
                <td class="valor-cell">${BRL(r.total)}</td>
            </tr>
        `),
    );
}

function renderDashOrcamentos(orcamentos) {
    const container = document.getElementById('dash-orcamentos');
    if (!orcamentos || !orcamentos.length) { container.innerHTML = ''; return; }
    const alertas = orcamentos.filter(o => o.status !== 'ok');
    if (!alertas.length) { container.innerHTML = ''; return; }
    container.innerHTML = `
        <div class="card" style="margin-bottom:1.5rem">
            <h3>🎯 Orçamentos — Alertas</h3>
            <div class="orc-dash-grid" style="margin-top:0.75rem">
                ${alertas.map(o => `
                    <div class="orc-dash-card ${o.status}">
                        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem">
                            <span>${escapeHtml(o.categoria_emoji)} ${escapeHtml(o.categoria_nome)}</span>
                            <span class="flag ${o.status === 'critico' ? 'warning' : 'info'}">${o.percentual}%</span>
                        </div>
                        <div class="orcamento-bar-bg">
                            <div class="orcamento-bar-fill ${o.status}" style="width:${Math.min(o.percentual, 100)}%"></div>
                        </div>
                        <div class="orcamento-labels">
                            <span>${BRL(o.gasto)}</span>
                            <span>de ${BRL(o.valor_limite)}</span>
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
}

function getDashboardParams() {
    const params = new URLSearchParams();
    const mes = document.getElementById('dash-mes')?.value || '';
    const mesInicio = document.getElementById('dash-mes-inicio')?.value || '';
    const mesFim = document.getElementById('dash-mes-fim')?.value || '';
    if (mesInicio && mesFim) {
        params.set('mes_inicio', mesInicio);
        params.set('mes_fim', mesFim);
    } else if (mes) {
        params.set('mes', mes);
    }
    return params;
}

async function loadDashboard() {
    try {
        const mes = document.getElementById('dash-mes').value;
        const dashParams = getDashboardParams();
        const dashQuery = dashParams.toString();
        const mesInicio = dashParams.get('mes_inicio');
        const mesFim = dashParams.get('mes_fim');
        const rangeActive = Boolean(mesInicio && mesFim);
        const [data, orcStatus, semanal, alertas, devedores] = await Promise.all([
            api(`/api/dashboard-data${dashQuery ? `?${dashQuery}` : ''}`),
            api(`/api/orcamentos/status${!rangeActive && mes ? `?mes=${mes}` : ''}`).catch(() => []),
            api(`/api/analytics/semanal${!rangeActive && mes ? `?mes=${mes}` : ''}`).catch(() => []),
            api(`/api/analytics/alertas${!rangeActive && mes ? `?mes=${mes}` : ''}`).catch(() => []),
            api(`/api/analytics/devedores`).catch(() => ({ devedores: [], total_a_receber: 0 })),
        ]);

        document.getElementById('v-despesas').textContent = BRL(data.total_despesas);
        document.getElementById('v-receitas').textContent = BRL(data.total_receitas);
        const cob = data.cobertura_fatura;
        const saldoVal = data.saldo_contabil ?? data.saldo;
        const saldoEl = document.getElementById('v-saldo');
        saldoEl.textContent = BRL(saldoVal);
        saldoEl.className = `card-value ${saldoVal >= 0 ? 'positive' : 'negative'}`;
        document.getElementById('v-dividas').textContent = BRL(data.dividas_abertas);
        document.getElementById('v-projetado').textContent = BRL(data.total_projetado);
        document.getElementById('v-maior-gasto').textContent = BRL(data.maior_gasto?.valor || 0);

        // Cobertura da fatura (Part 2)
        const cardCob = document.getElementById('card-cobertura');
        if (cob && !rangeActive && mes) {
            cardCob.style.display = '';
            const cobEl = document.getElementById('v-cobertura');
            cobEl.textContent = BRL(cob.saldo_cobertura);
            cobEl.className = `card-value ${cob.cobre ? 'positive' : 'negative'}`;
            document.getElementById('v-cobertura-label').textContent =
                `Receita ${cob.mes_pagamento} ${cob.cobre ? '✅ cobre' : '❌ não cobre'} esta fatura`;
        } else {
            if (cardCob) cardCob.style.display = 'none';
        }

        const alertGastos = document.getElementById('alert-gastos');
        const alertGastosMsg = document.getElementById('alert-gastos-msg');
        if (alertas && alertas.length > 0) {
            alertGastos.style.display = 'block';
            alertGastos.className = `alert ${alertas[0].nivel === 'critico' ? 'alert-danger' : 'alert-warning'}`;
            let html = `<strong>⚠️ Alerta de Gastos:</strong> Você excedeu o padrão histórico nas seguintes categorias:<br><ul style="margin-top:0.5rem;padding-left:1.5rem">`;
            alertas.slice(0, 3).forEach(a => {
                html += `<li>${a.emoji} ${escapeHtml(a.categoria)}: <strong>${BRL(a.total_atual)}</strong> (+${a.delta_pct}% acima da média de ${BRL(a.media_historica)})</li>`;
            });
            if (alertas.length > 3) html += `<li><em>E mais ${alertas.length - 3} categoria(s)...</em></li>`;
            html += `</ul>`;
            alertGastosMsg.innerHTML = html;
        } else {
            alertGastos.style.display = 'none';
        }

        const btnAjustar = document.getElementById('btn-ajustar-saldo');
        if (btnAjustar) {
            btnAjustar.style.display = (!rangeActive && mes && data.saldo_contabil < 0) ? 'inline-block' : 'none';
        }

        const monthSelect = document.getElementById('dash-mes');
        if (monthSelect.options.length <= 1 && data.meses_disponiveis.length) {
            data.meses_disponiveis.forEach(m => {
                const o = document.createElement('option');
                o.value = m.value; o.textContent = m.label;
                monthSelect.appendChild(o);
            });
            const txMonth = document.getElementById('tx-mes');
            data.meses_disponiveis.forEach(m => {
                const o = document.createElement('option');
                o.value = m.value; o.textContent = m.label;
                txMonth.appendChild(o);
            });
            if (!mes && data.mes_selecionado) {
                monthSelect.value = data.mes_selecionado;
                txMonth.value = data.mes_selecionado;
                loadDashboard();
                return;
            }
        }
        if (mes) monthSelect.value = mes;

        renderCompare(data.comparativo_mes);
        renderReviewCounters(data.review);
        renderDashOrcamentos(orcStatus);
        renderDashDevedores(devedores);
        renderCategoryChart(data.por_categoria);
        renderEvolutionChart(data.evolucao_mensal);
        renderCardChart(data.por_cartao);
        renderSemanaChart(semanal);
        renderDayChart(data.gastos_por_dia);
        renderParcelChart(data.parcelas_futuras_mes);
        renderRecurringList('lista-recorrentes', data.recorrentes);
        renderTopTables(data.top_gastos, data.top_estabelecimentos);
        requestAnimationFrame(resizeVisibleCharts);
    } catch (error) {
        toast(error.message, 'error');
    }
}

// ─── Dashboard Anual (Part 4) ───

function showDashView(view) {
    document.getElementById('dash-mensal').style.display = view === 'mensal' ? '' : 'none';
    document.getElementById('dash-anual').style.display = view === 'anual' ? '' : 'none';
    document.getElementById('btn-dash-mensal').classList.toggle('active', view === 'mensal');
    document.getElementById('btn-dash-anual').classList.toggle('active', view === 'anual');
    if (view === 'anual') loadDashboardAnual();
    requestAnimationFrame(resizeVisibleCharts);
}

function showDashSection(section) {
    document.querySelectorAll('.dash-section').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.section-tab').forEach(el => el.classList.remove('active'));
    document.getElementById(`dash-section-${section}`)?.classList.add('active');
    document.querySelector(`[data-dash-section="${section}"]`)?.classList.add('active');
    requestAnimationFrame(resizeVisibleCharts);
}

function resizeVisibleCharts() {
    if (!window.Plotly) return;
    document.querySelectorAll('.dash-section.active [id^="chart-"], #dash-anual:not([style*="display: none"]) [id^="chart-"]').forEach(el => {
        if (el.offsetParent) Plotly.Plots.resize(el);
    });
}

async function loadDashboardAnual() {
    try {
        const ano = document.getElementById('dash-ano')?.value || '';
        const data = await api(`/api/dashboard-anual${ano ? `?ano=${ano}` : ''}`);

        // Preencher select de anos
        const sel = document.getElementById('dash-ano');
        if (sel && sel.options.length === 0) {
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
        const sEl = document.getElementById('va-saldo');
        sEl.textContent = BRL(data.saldo);
        sEl.className = `card-value ${data.saldo >= 0 ? 'positive' : 'negative'}`;
        document.getElementById('va-media').textContent = BRL(data.media_mensal);
        document.getElementById('va-previsao').textContent = BRL(data.previsao_anual);

        // Maior/menor mês
        const mesToLabel = m => m ? m.replace(/^(\d{4})-(\d{2})$/, '$2/$1') : '—';
        document.getElementById('va-maior-mes').innerHTML = data.maior_mes
            ? `<div class="valor-cell" style="font-size:1.5rem">${BRL(data.maior_mes.total)}</div><div class="muted-line">${mesToLabel(data.maior_mes.mes)}</div>`
            : showEmptyState('Sem dados');
        document.getElementById('va-menor-mes').innerHTML = data.menor_mes
            ? `<div class="valor-cell" style="font-size:1.5rem">${BRL(data.menor_mes.total)}</div><div class="muted-line">${mesToLabel(data.menor_mes.mes)}</div>`
            : showEmptyState('Sem dados');

        // Gráfico evolução: barras despesas + linha receitas
        const recMap = {};
        data.receitas_mensal.forEach(r => recMap[r.mes] = r.total);
        const evoLabels = data.evolucao_mensal.map(d => d.label);
        Plotly.react('chart-anual-evo', [
            { name: 'Despesas', x: evoLabels, y: data.evolucao_mensal.map(d => d.total), type: 'bar', marker: { color: 'rgba(124,58,237,0.8)' } },
            { name: 'Receitas', x: evoLabels, y: data.evolucao_mensal.map(d => recMap[d.mes] || 0), type: 'scatter', mode: 'lines+markers', line: { color: '#34d399', width: 3 }, marker: { size: 6 } },
        ], { ...PLOTLY_LAYOUT, barmode: 'group' }, { responsive: true });

        // Gráfico categorias
        if (data.por_categoria.length) {
            Plotly.react('chart-anual-cat', [{
                values: data.por_categoria.map(d => d.total),
                labels: data.por_categoria.map(d => `${d.emoji} ${d.nome}`),
                marker: { colors: data.por_categoria.map(d => d.cor) },
                hole: 0.5, type: 'pie', textinfo: 'percent+label',
            }], { ...PLOTLY_LAYOUT, margin: { t: 10, r: 10, b: 10, l: 10 } }, { responsive: true });
        }

        // Tabelas
        document.getElementById('anual-top-gastos').innerHTML = renderSimpleTable(
            ['#', 'Descrição', 'Valor', 'Data'],
            data.top_gastos.map((r, i) => `<tr><td>${i+1}</td><td>${escapeHtml(r.nome)}</td><td class="valor-cell">${BRL(r.valor)}</td><td>${escapeHtml(r.data)}</td></tr>`)
        );
        document.getElementById('anual-top-cats').innerHTML = renderSimpleTable(
            ['Categoria', 'Qtd', 'Média', 'Total'],
            data.top_categorias.map(r => `<tr><td>${r.emoji} ${escapeHtml(r.nome)}</td><td>${r.quantidade}</td><td class="valor-cell">${BRL(r.media)}</td><td class="valor-cell">${BRL(r.total)}</td></tr>`)
        );
    } catch (error) {
        toast(error.message, 'error');
    }
}


async function ajustarSaldo() {
    const mes = document.getElementById('dash-mes').value;
    if (!mes) return;
    if (!confirm(`Deseja gerar uma Receita de Ajuste para zerar o saldo negativo de ${mes}?`)) return;
    try {
        await api('/api/receitas/ajuste-fatura', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mes: mes })
        });
        toast('Saldo ajustado com sucesso');
        loadDashboard();
    } catch (error) {
        toast(error.message, 'error');
    }
}

// ─── Transações ───

function getTransactionParams() {
    const params = new URLSearchParams();
    const mesInicio = document.getElementById('tx-mes-inicio')?.value || '';
    const mesFim = document.getElementById('tx-mes-fim')?.value || '';
    const fields = {
        mes: 'tx-mes', categoria_id: 'tx-cat', cartao_final: 'tx-cartao',
        responsavel_id: 'tx-resp', busca: 'tx-busca', valor_min: 'tx-min', valor_max: 'tx-max',
    };
    Object.entries(fields).forEach(([key, id]) => {
        const el = document.getElementById(id);
        if (el && el.value) params.set(key, el.value);
    });
    if (mesInicio && mesFim) {
        params.delete('mes');
        params.set('mes_inicio', mesInicio);
        params.set('mes_fim', mesFim);
    }
    if (!document.getElementById('tx-projetadas').checked) params.set('projetadas', 'false');
    if (document.getElementById('tx-parceladas').checked) params.set('parceladas', 'true');
    if (document.getElementById('tx-recorrentes').checked) params.set('recorrentes', 'true');
    if (document.getElementById('tx-ignoradas').checked) params.set('ignoradas', 'true');
    return params;
}

let txTimer;
function debouncedLoadTx() {
    clearTimeout(txTimer);
    txTimer = setTimeout(loadTransacoes, 300);
}

function renderFlags(tx) {
    const flags = [];
    if ((tx.flags || []).includes('sem_categoria')) flags.push('<span class="flag warning">Sem categoria</span>');
    if ((tx.flags || []).includes('sem_alias')) flags.push('<span class="flag info">Sem alias</span>');
    if (tx.projetado) flags.push('<span class="flag future">Futura</span>');
    if (tx.ignorado) flags.push('<span class="flag muted">Ignorada</span>');
    return flags.join('') || '<span class="flag success">OK</span>';
}

async function loadTransacoes() {
    try {
        const txs = await api(`/api/transacoes?${getTransactionParams().toString()}`);
        const body = document.getElementById('tx-body');
        selectedTxIds.clear();
        atualizarBatchBar();
        if (!txs.length) {
            body.innerHTML = `<tr><td colspan="11">${showEmptyState('Nenhuma transação encontrada')}</td></tr>`;
            return;
        }
        body.innerHTML = txs.map(tx => {
            const displayName = tx.alias
                ? `<span>${escapeHtml(tx.alias)}</span><br><span class="muted-line">${escapeHtml(tx.descricao)}</span>`
                : `<span>${escapeHtml(tx.descricao)}</span>`;
            const rowClass = tx.ignorado ? 'class="row-muted"' : '';
            const safeDesc = escapeHtml(tx.descricao).replace(/&#39;/g, "\\'");
            const safeDisplay = escapeHtml(tx.alias || tx.descricao).replace(/&#39;/g, "\\'");
            const hasNota = tx.nota ? 'has-nota' : '';
            return `
                <tr ${rowClass} data-id="${tx.id}">
                    <td><input type="checkbox" class="tx-check" value="${tx.id}" onchange="toggleTxSel(${tx.id}, this.checked)"></td>
                    <td>${escapeHtml(tx.data)}</td>
                    <td>${formatMonthRef(tx.mes_referencia)}</td>
                    <td>${displayName}</td>
                    <td class="valor-cell">${BRL(tx.valor)}</td>
                    <td>${escapeHtml(tx.parcela || '—')}</td>
                    <td>${escapeHtml(tx.cartao_final || '—')}</td>
                    <td>${respSelectHTML(tx.id, tx.responsavel_id)}</td>
                    <td>${catSelectHTML(tx.id, tx.categoria_id)}</td>
                    <td>
                        <div class="action-stack">
                            <button class="btn btn-ghost btn-sm" onclick="abrirAlias('${safeDesc}')">Alias</button>
                            <button class="btn btn-ghost btn-sm" onclick="abrirDivisao(${tx.id}, '${safeDisplay}', ${tx.valor})">÷</button>
                            <button class="btn btn-ghost btn-sm nota-btn ${hasNota}" onclick="abrirNota(${tx.id}, this)" title="${tx.nota ? escapeHtml(tx.nota) : 'Adicionar nota'}">📝</button>
                            <button class="btn btn-ghost btn-sm" onclick="toggleIgnorado(${tx.id}, ${tx.ignorado ? 'false' : 'true'})">${tx.ignorado ? '↩' : '👁'}</button>
                            <button class="btn btn-ghost btn-sm" onclick="delTransacao(${tx.id})" title="Excluir transação">🗑️</button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
    } catch (error) {
        toast(error.message, 'error');
    }
}

// ─── Batch selection ───

function toggleSelAll(checkbox) {
    document.querySelectorAll('.tx-check:not(:disabled)').forEach(el => {
        el.checked = checkbox.checked;
        const id = parseInt(el.value);
        if (checkbox.checked) selectedTxIds.add(id);
        else selectedTxIds.delete(id);
    });
    atualizarBatchBar();
}

function toggleTxSel(id, checked) {
    if (checked) selectedTxIds.add(id);
    else selectedTxIds.delete(id);
    atualizarBatchBar();
}

function atualizarBatchBar() {
    const bar = document.getElementById('batch-bar');
    const countEl = document.getElementById('batch-count');
    if (selectedTxIds.size > 0) {
        bar.style.display = 'flex';
        countEl.textContent = `${selectedTxIds.size} selecionada${selectedTxIds.size > 1 ? 's' : ''}`;
    } else {
        bar.style.display = 'none';
    }
}

function limparSelecao() {
    selectedTxIds.clear();
    document.querySelectorAll('.tx-check').forEach(el => el.checked = false);
    const selAll = document.getElementById('sel-all');
    if (selAll) selAll.checked = false;
    atualizarBatchBar();
}

async function aplicarBatchCat() {
    const catId = document.getElementById('batch-cat').value;
    if (!catId) { toast('Selecione uma categoria', 'error'); return; }
    if (!selectedTxIds.size) { toast('Nenhuma transação selecionada', 'error'); return; }
    try {
        const result = await api('/api/transacoes/batch-categoria', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: [...selectedTxIds], categoria_id: parseInt(catId) }),
        });
        toast(`${result.atualizadas} transações categorizadas`);
        limparSelecao();
        loadTransacoes();
        loadDashboard();
    } catch (error) {
        toast(error.message, 'error');
    }
}

// ─── Category / Responsável updates ───

async function updateCat(txId, catId) {
    try {
        await api(`/api/transacoes/${txId}/categoria`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ categoria_id: catId ? parseInt(catId, 10) : null }),
        });
        toast('Categoria atualizada');
        loadDashboard();
    } catch (error) { toast(error.message, 'error'); }
}

async function updateResp(txId, pessoaId) {
    try {
        await api(`/api/transacoes/${txId}/responsavel`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pessoa_id: pessoaId ? parseInt(pessoaId, 10) : null }),
        });
        toast('Responsável atualizado');
    } catch (error) { toast(error.message, 'error'); }
}

async function toggleIgnorado(txId, value) {
    try {
        await api(`/api/transacoes/${txId}/ignorar`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ignorado: value === 'true' }),
        });
        toast('Status atualizado');
        loadTransacoes();
        loadDashboard();
        loadReview();
    } catch (error) { toast(error.message, 'error'); }
}

function exportarCsv() {
    window.open(`/api/transacoes/exportar?${getTransactionParams().toString()}`, '_blank');
}

// ─── Notas ───

function abrirNota(txId, btn) {
    document.getElementById('nota-tx-id').value = txId;
    const title = btn.getAttribute('title');
    document.getElementById('nota-texto').value = (title && title !== 'Adicionar nota') ? title : '';
    document.getElementById('modal-nota').style.display = 'flex';
}

function fecharModalNota() {
    document.getElementById('modal-nota').style.display = 'none';
}

async function salvarNota() {
    const txId = document.getElementById('nota-tx-id').value;
    const nota = document.getElementById('nota-texto').value.trim();
    try {
        await api(`/api/transacoes/${txId}/nota`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nota }),
        });
        fecharModalNota();
        toast('Nota salva');
        loadTransacoes();
    } catch (error) { toast(error.message, 'error'); }
}

// ─── Upload ───

const uploadArea = document.getElementById('upload-area');
uploadArea.addEventListener('dragover', e => { e.preventDefault(); uploadArea.classList.add('dragover'); });
uploadArea.addEventListener('dragleave', () => uploadArea.classList.remove('dragover'));
uploadArea.addEventListener('drop', e => {
    e.preventDefault();
    uploadArea.classList.remove('dragover');
    if (e.dataTransfer.files.length) doUpload(e.dataTransfer.files[0]);
});

function uploadFatura(input) {
    if (input.files.length) doUpload(input.files[0]);
}

async function doUpload(file) {
    try {
        const formData = new FormData();
        formData.append('arquivo', file);
        const result = await api('/api/importar-fatura', { method: 'POST', body: formData });
        const target = document.getElementById('import-result');
        if (result.status === 'duplicado') {
            target.innerHTML = `<div class="alert alert-info">Fatura já importada (${result.existentes} transações${result.arquivo ? ` em ${escapeHtml(result.arquivo)}` : ''})</div>`;
        } else {
            target.innerHTML = `<div class="alert alert-success">${result.importadas} transações importadas e ${result.projetadas || 0} parcelas projetadas.</div>`;
        }
        toast('Importação concluída');
        await loadImportHistory();
        await loadDashboard();
    } catch (error) {
        document.getElementById('import-result').innerHTML = `<div class="alert alert-warning">${escapeHtml(error.message)}</div>`;
        toast(error.message, 'error');
    }
}

async function importarExistentes() {
    try {
        const results = await api('/api/importar-existentes', { method: 'POST' });
        const target = document.getElementById('import-result');
        if (!results.length) {
            target.innerHTML = '<div class="alert alert-info">Nenhum PDF encontrado na pasta Faturas.</div>';
            return;
        }
        target.innerHTML = results.map(item => item.status === 'ok'
            ? `<div class="alert alert-success">${escapeHtml(item.arquivo)}: ${item.importadas} transações e ${item.projetadas || 0} parcelas projetadas.</div>`
            : `<div class="alert alert-info">${escapeHtml(item.arquivo)}: já importada.</div>`
        ).join('');
        toast('Sincronização concluída');
        await loadImportHistory();
        await loadDashboard();
    } catch (error) { toast(error.message, 'error'); }
}

async function loadImportHistory() {
    try {
        const invoices = await api('/api/faturas');
        const target = document.getElementById('faturas-historico');
        if (!invoices.length) { target.innerHTML = showEmptyState('Nenhuma fatura importada'); return; }
        target.innerHTML = renderSimpleTable(
            ['Arquivo', 'Mês', 'Importado em', 'Transações', 'Total real', 'Projetado'],
            invoices.map(inv => `
                <tr>
                    <td>${escapeHtml(inv.arquivo_nome)}</td>
                    <td>${escapeHtml(inv.mes_label || '—')}</td>
                    <td>${escapeHtml(inv.imported_at.replace('T', ' ').slice(0, 16))}</td>
                    <td>${inv.qtd_real || inv.transacoes_importadas}</td>
                    <td class="valor-cell">${BRL(inv.total_real)}</td>
                    <td class="valor-cell">${BRL(inv.total_projetado)}</td>
                </tr>
            `),
        );
    } catch (error) { toast(error.message, 'error'); }
}

// ─── Revisão ───

async function loadReview() {
    try {
        const review = await api('/api/revisao');
        document.getElementById('review-summary').innerHTML = `
            <div class="mini-stat"><span class="card-label">Sem categoria</span><strong>${review.contadores.sem_categoria}</strong></div>
            <div class="mini-stat"><span class="card-label">Sem alias</span><strong>${review.contadores.sem_alias}</strong></div>
            <div class="mini-stat"><span class="card-label">Parceladas</span><strong>${review.contadores.parceladas}</strong></div>
            <div class="mini-stat"><span class="card-label">Recorrentes</span><strong>${review.contadores.recorrentes}</strong></div>
        `;
        document.getElementById('review-pendentes').innerHTML = renderSimpleTable(
            ['Data compra', 'Mês fatura', 'Descrição', 'Valor', 'Pendência'],
            review.pendentes.map(item => `
                <tr>
                    <td>${escapeHtml(item.data)}</td>
                    <td>${formatMonthRef(item.mes_referencia)}</td>
                    <td>${escapeHtml(item.alias || item.descricao)}</td>
                    <td class="valor-cell">${BRL(item.valor)}</td>
                    <td>${item.categoria_id ? '' : '<span class="flag warning">Categoria</span>'}${item.alias ? '' : '<span class="flag info">Alias</span>'}</td>
                </tr>
            `),
        );
        renderRecurringList('review-recorrencias', review.recorrencias);
        document.getElementById('review-maiores').innerHTML = renderSimpleTable(
            ['Data', 'Descrição', 'Valor'],
            review.maiores.map(item => `
                <tr>
                    <td>${escapeHtml(item.data)}</td>
                    <td>${escapeHtml(item.nome_exibido)}</td>
                    <td class="valor-cell">${BRL(item.valor)}</td>
                </tr>
            `),
        );
    } catch (error) { toast(error.message, 'error'); }
}

// ─── Categorias / Regras ───

async function loadRegras() {
    try {
        const aliases = await api('/api/aliases');
        document.getElementById('aliases-body').innerHTML = aliases.length
            ? aliases.map(a => `
                <tr>
                    <td><code>${escapeHtml(a.descricao_original)}</code></td>
                    <td><strong>${escapeHtml(a.alias)}</strong></td>
                    <td><button class="btn btn-danger btn-sm" onclick="delAlias(${a.id})">Excluir</button></td>
                </tr>
            `).join('')
            : `<tr><td colspan="3">${showEmptyState('Nenhum apelido cadastrado')}</td></tr>`;

        const rules = await api('/api/regras');
        document.getElementById('regras-body').innerHTML = rules.length
            ? rules.map(r => `
                <tr>
                    <td><code>${escapeHtml(r.palavra_chave)}</code></td>
                    <td>${escapeHtml(r.categoria_emoji)} ${escapeHtml(r.categoria_nome)}</td>
                    <td><button class="btn btn-danger btn-sm" onclick="delRegra(${r.id})">Excluir</button></td>
                </tr>
            `).join('')
            : `<tr><td colspan="3">${showEmptyState('Nenhuma regra criada')}</td></tr>`;

        await loadOrcamentos();
    } catch (error) { toast(error.message, 'error'); }
}

async function salvarAlias() {
    try {
        const original = document.getElementById('alias-orig').value.trim();
        const alias = document.getElementById('alias-novo').value.trim();
        if (!original || !alias) { toast('Preencha descrição original e apelido', 'error'); return; }
        await api('/api/aliases', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ descricao_original: original, alias }),
        });
        document.getElementById('alias-orig').value = '';
        document.getElementById('alias-novo').value = '';
        toast('Apelido salvo');
        loadRegras(); loadReview(); loadDashboard();
    } catch (error) { toast(error.message, 'error'); }
}

function abrirAlias(description) {
    showTab('regras');
    setTimeout(() => {
        document.getElementById('alias-orig').value = description.replace(/\\'/g, "'");
        document.getElementById('alias-novo').focus();
    }, 100);
}

async function delAlias(id) {
    try {
        await api(`/api/aliases/${id}`, { method: 'DELETE' });
        toast('Apelido excluído');
        loadRegras(); loadReview(); loadDashboard();
    } catch (error) { toast(error.message, 'error'); }
}

async function criarRegra() {
    try {
        const keyword = document.getElementById('regra-kw').value.trim();
        const categoryId = document.getElementById('regra-cat').value;
        if (!keyword) { toast('Informe a palavra-chave', 'error'); return; }
        const result = await api('/api/regras', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ palavra_chave: keyword, categoria_id: categoryId }),
        });
        document.getElementById('regra-kw').value = '';
        toast(`Regra criada. ${result.aplicadas} transações categorizadas.`);
        loadRegras(); loadReview(); loadDashboard();
    } catch (error) { toast(error.message, 'error'); }
}

async function delRegra(id) {
    try {
        await api(`/api/regras/${id}`, { method: 'DELETE' });
        toast('Regra excluída');
        loadRegras();
    } catch (error) { toast(error.message, 'error'); }
}

// ─── Orçamentos ───

async function loadOrcamentos() {
    try {
        const orcamentos = await api('/api/orcamentos');
        const container = document.getElementById('orcamentos-list');
        if (!orcamentos.length) {
            container.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem">Nenhum orçamento definido ainda.</p>';
            return;
        }
        // Get current month status
        const mes = document.getElementById('dash-mes')?.value || '';
        const status = await api(`/api/orcamentos/status${mes ? `?mes=${mes}` : ''}`).catch(() => orcamentos.map(o => ({ ...o, gasto: 0, percentual: 0, status: 'ok' })));
        const statusMap = Object.fromEntries(status.map(s => [s.categoria_id, s]));
        container.innerHTML = orcamentos.map(o => {
            const s = statusMap[o.categoria_id] || { gasto: 0, percentual: 0, status: 'ok' };
            return `
                <div class="orcamento-item">
                    <div class="orcamento-header">
                        <span>${escapeHtml(o.categoria_emoji)} ${escapeHtml(o.categoria_nome)}</span>
                        <div style="display:flex;align-items:center;gap:0.75rem">
                            <span style="color:var(--text-muted);font-size:0.8rem">${BRL(s.gasto)} / ${BRL(o.valor_limite)}</span>
                            <span class="flag ${s.status === 'critico' ? 'warning' : s.status === 'alerta' ? 'info' : 'success'}">${s.percentual}%</span>
                            <button class="btn btn-danger btn-sm" onclick="delOrcamento(${o.id})">✕</button>
                        </div>
                    </div>
                    <div class="orcamento-bar-bg">
                        <div class="orcamento-bar-fill ${s.status}" style="width:${Math.min(s.percentual, 100)}%"></div>
                    </div>
                    <div class="orcamento-labels">
                        <span>${s.status === 'critico' ? '🔴 Limite ultrapassado!' : s.status === 'alerta' ? '🟡 Atenção: 80%+' : '🟢 OK'}</span>
                        <span>Restam: ${BRL(Math.max(0, o.valor_limite - s.gasto))}</span>
                    </div>
                </div>
            `;
        }).join('');
    } catch (error) { toast(error.message, 'error'); }
}

async function salvarOrcamento() {
    try {
        const catId = document.getElementById('orc-cat').value;
        const valor = parseFloat(document.getElementById('orc-valor').value);
        if (!catId) { toast('Selecione a categoria', 'error'); return; }
        if (Number.isNaN(valor) || valor <= 0) { toast('Informe um valor válido', 'error'); return; }
        await api('/api/orcamentos', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ categoria_id: parseInt(catId), valor_limite: valor }),
        });
        document.getElementById('orc-valor').value = '';
        toast('Orçamento definido');
        loadOrcamentos();
        loadDashboard();
    } catch (error) { toast(error.message, 'error'); }
}

async function delOrcamento(id) {
    try {
        await api(`/api/orcamentos/${id}`, { method: 'DELETE' });
        toast('Orçamento removido');
        loadOrcamentos();
        loadDashboard();
    } catch (error) { toast(error.message, 'error'); }
}

// ─── Receitas ───

async function loadReceitas() {
    try {
        const records = await api('/api/receitas');
        document.getElementById('rec-body').innerHTML = records.length
            ? records.map(r => `
                <tr>
                    <td>${formatDate(r.data)}</td>
                    <td>${escapeHtml(r.descricao)}</td>
                    <td class="valor-cell" style="color:var(--success)">${BRL(r.valor)}</td>
                    <td>${escapeHtml(r.tipo)}</td>
                    <td>${r.recorrente ? '<span class="flag future">🔄 Sim</span>' : '—'}</td>
                    <td><button class="btn btn-danger btn-sm" onclick="delReceita(${r.id})">Excluir</button></td>
                </tr>
            `).join('')
            : `<tr><td colspan="6">${showEmptyState('Nenhuma receita cadastrada')}</td></tr>`;
    } catch (error) { toast(error.message, 'error'); }
}

async function criarReceita() {
    try {
        const data = document.getElementById('rec-data').value;
        const descricao = document.getElementById('rec-desc').value.trim();
        const valor = parseFloat(document.getElementById('rec-valor').value);
        const tipo = document.getElementById('rec-tipo').value;
        const recorrente = document.getElementById('rec-recorrente').checked;
        if (!data || !descricao || Number.isNaN(valor)) { toast('Preencha todos os campos de receita', 'error'); return; }
        await api('/api/receitas', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ data, descricao, valor, tipo, recorrente }),
        });
        ['rec-data', 'rec-desc', 'rec-valor'].forEach(id => document.getElementById(id).value = '');
        document.getElementById('rec-recorrente').checked = false;
        toast('Receita adicionada');
        loadReceitas(); loadDashboard();
    } catch (error) { toast(error.message, 'error'); }
}

async function projetarRecorrentes() {
    try {
        const result = await api('/api/receitas/recorrentes/projetar?meses=3', { method: 'POST' });
        toast(`${result.projetadas} receitas projetadas (3 meses)`);
        loadReceitas(); loadDashboard();
    } catch (error) { toast(error.message, 'error'); }
}

async function delReceita(id) {
    try {
        await api(`/api/receitas/${id}`, { method: 'DELETE' });
        toast('Receita excluída');
        loadReceitas(); loadDashboard();
    } catch (error) { toast(error.message, 'error'); }
}

// ─── Dívidas / Pessoas ───

async function loadDividas() {
    await loadPessoas();
    await loadResumoPessoas();
    await loadDivisoes();
    await loadDividasManuais();
}

async function loadPessoas() {
    pessoas = await api('/api/pessoas');
    const target = document.getElementById('pessoas-list');
    target.innerHTML = pessoas.length
        ? pessoas.map(p => `
            <span class="person-tag ${p.titular ? 'titular' : ''}">
                ${escapeHtml(p.nome)}${p.titular ? ' ✦' : ''}
                <button class="remove-btn" onclick="delPessoa(${p.id})">✕</button>
            </span>
        `).join('')
        : '<span style="color:var(--text-muted);font-size:0.85rem">Nenhuma pessoa cadastrada</span>';
    populateRespFilter();
}

async function criarPessoa() {
    try {
        const nome = document.getElementById('pes-nome').value.trim();
        const titular = document.getElementById('pes-titular').checked;
        if (!nome) { toast('Informe o nome', 'error'); return; }
        await api('/api/pessoas', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nome, titular }),
        });
        document.getElementById('pes-nome').value = '';
        document.getElementById('pes-titular').checked = false;
        toast('Pessoa adicionada');
        loadDividas();
    } catch (error) { toast(error.message, 'error'); }
}

async function delPessoa(id) {
    try {
        await api(`/api/pessoas/${id}`, { method: 'DELETE' });
        toast('Pessoa removida');
        loadDividas();
    } catch (error) { toast(error.message, 'error'); }
}

// ─── Divisão modal ───

async function abrirDivisao(txId, nome, valor) {
    if (!pessoas.length) { toast('Cadastre pessoas antes de dividir uma despesa', 'error'); return; }
    currentSplitTxId = txId;

    let existingDesc = '';
    let existingPagador = pessoas.find(p => p.titular)?.id || (pessoas[0] ? pessoas[0].id : null);
    let existingParts = [];

    try {
        const existing = await api(`/api/transacoes/${txId}/divisao`);
        if (existing) {
            existingDesc = existing.descricao || '';
            existingPagador = existing.pagador_id;
            existingParts = existing.participantes_ids || [];
        }
    } catch (e) { console.error('Erro ao buscar divisão:', e); }

    document.getElementById('modal-tx-info').innerHTML = `<strong>${escapeHtml(nome.replace(/\\'/g, "'"))}</strong><br><span class="valor-cell">${BRL(valor)}</span>`;
    document.getElementById('modal-desc').value = existingDesc;
    
    document.getElementById('modal-pagador').innerHTML = pessoas.map(p => `
        <option value="${p.id}"${parseInt(p.id) === parseInt(existingPagador) ? ' selected' : ''}>${escapeHtml(p.nome)}${p.titular ? ' ✦' : ''}</option>
    `).join('');
    
    document.getElementById('modal-participantes').innerHTML = pessoas.map(p => `
        <label><input type="checkbox" value="${p.id}" ${existingParts.includes(parseInt(p.id)) ? 'checked' : ''} onchange="updateSplitPreview(${valor})"> ${escapeHtml(p.nome)}</label>
    `).join('');
    
    updateSplitPreview(valor);
    document.getElementById('modal-dividir').style.display = 'flex';
}

function fecharModal() {
    document.getElementById('modal-dividir').style.display = 'none';
    currentSplitTxId = null;
}

function updateSplitPreview(valor) {
    const checked = document.querySelectorAll('#modal-participantes input:checked');
    const target = document.getElementById('modal-preview');
    if (!checked.length) { target.textContent = 'Selecione ao menos um participante'; return; }
    target.textContent = `${BRL(valor)} ÷ ${checked.length} = ${BRL(valor / checked.length)} por pessoa`;
}

async function salvarDivisao() {
    try {
        const participantes = [...document.querySelectorAll('#modal-participantes input:checked')].map(el => parseInt(el.value, 10));
        if (!participantes.length) { toast('Selecione participantes', 'error'); return; }
        const descricao = document.getElementById('modal-desc').value.trim();
        const pagador = parseInt(document.getElementById('modal-pagador').value, 10);
        await api('/api/divisoes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ transacao_id: currentSplitTxId, descricao, participantes_ids: participantes, pagador_id: pagador }),
        });
        fecharModal();
        toast('Divisão criada');
        loadTransacoes();
        loadDividas();
    } catch (error) { toast(error.message, 'error'); }
}

async function loadResumoPessoas() {
    const resumo = await api('/api/resumo-pessoas');
    const target = document.getElementById('resumo-pessoas');
    if (!resumo.length) { target.innerHTML = ''; return; }
    target.innerHTML = '<h3 style="margin-bottom:1rem;color:var(--text-dim)">Resumo de dívidas por pessoa</h3>' +
        (resumo.filter(item => item.total_deve > 0).map(item => `
            <div class="card resumo-card" style="margin-bottom:0.75rem">
                <div class="resumo-header" onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display==='none'?'block':'none'" style="cursor:pointer;display:flex;justify-content:space-between;align-items:center;padding:0.5rem 0">
                    <span class="resumo-nome">${escapeHtml(item.pessoa.nome)}</span>
                    <span class="resumo-total" style="color:var(--warning);font-weight:700">${BRL(item.total_deve)}</span>
                </div>
                <div class="resumo-detail" style="display:none;padding-top:0.5rem;border-top:1px solid var(--border)">
                    ${item.itens_cartao.length ? `<p>💳 Cartão: <strong>${BRL(item.total_cartao)}</strong></p>` : ''}
                    ${item.itens_divisoes.length ? `<p>÷ Rachões: <strong>${BRL(item.total_divisoes)}</strong></p>` : ''}
                </div>
            </div>
        `).join('') || showEmptyState('Ninguém te deve nada 🎉'));
}

async function loadDivisoes() {
    const divisoes = await api('/api/divisoes');
    const target = document.getElementById('divisoes-list');
    target.innerHTML = divisoes.length ? divisoes.map(d => `
        <div class="list-row">
            <div>
                <strong>${escapeHtml(d.tx_nome)}</strong>
                <div class="muted-line">${escapeHtml(d.tx_data)} · Pago por ${escapeHtml(d.pagador_nome)}</div>
            </div>
            <div class="action-stack">
                <span class="valor-cell">${BRL(d.tx_valor)}</span>
                <button class="btn btn-danger btn-sm" onclick="delDivisao(${d.id})">Excluir</button>
            </div>
        </div>
    `).join('') : showEmptyState('Nenhuma divisão');
}

async function delDivisao(id) {
    await api(`/api/divisoes/${id}`, { method: 'DELETE' });
    toast('Divisão excluída');
    loadDividas();
}

async function loadDividasManuais() {
    const dividas = await api('/api/dividas');
    const abertas = dividas.filter(d => !d.pago);
    const totalAberto = abertas.reduce((s, d) => s + d.valor, 0);
    const summary = document.getElementById('div-summary');
    summary.style.display = totalAberto > 0 ? 'block' : 'none';
    document.getElementById('div-total').textContent = BRL(totalAberto);
    document.getElementById('div-grid').innerHTML = dividas.length ? dividas.map(d => `
        <div class="card debt-card ${d.pago ? 'pago' : ''}">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem">
                <div class="pessoa">${escapeHtml(d.pessoa)}</div>
                <span class="status-badge ${d.pago ? 'pago' : 'pendente'}">${d.pago ? 'Pago' : 'Pendente'}</span>
            </div>
            <div class="debt-desc">${escapeHtml(d.descricao || '—')}</div>
            <div class="debt-valor">${BRL(d.valor)}</div>
            <div class="debt-data">${escapeHtml(d.data)}${d.pago && d.data_pagamento ? ` · Pago em ${escapeHtml(d.data_pagamento)}` : ''}</div>
            <div class="debt-actions">
                ${!d.pago ? `<button class="btn btn-success btn-sm" onclick="pagarDivida(${d.id})">✔ Pago</button>` : ''}
                <button class="btn btn-danger btn-sm" onclick="delDivida(${d.id})">Excluir</button>
            </div>
        </div>
    `).join('') : showEmptyState('Nenhuma dívida manual');
}

async function criarDivida() {
    try {
        const pessoa = document.getElementById('div-pessoa').value.trim();
        const descricao = document.getElementById('div-desc').value.trim();
        const valor = parseFloat(document.getElementById('div-valor').value);
        const data = document.getElementById('div-data').value;
        if (!pessoa || Number.isNaN(valor) || !data) { toast('Preencha os campos obrigatórios da dívida', 'error'); return; }
        await api('/api/dividas', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pessoa, descricao, valor, data }),
        });
        ['div-pessoa', 'div-desc', 'div-valor', 'div-data'].forEach(id => document.getElementById(id).value = '');
        toast('Dívida adicionada');
        loadDividas();
    } catch (error) { toast(error.message, 'error'); }
}

async function pagarDivida(id) {
    await api(`/api/dividas/${id}/pagar`, { method: 'PUT' });
    toast('Dívida marcada como paga');
    loadDividas();
}

async function delDivida(id) {
    await api(`/api/dividas/${id}`, { method: 'DELETE' });
    toast('Dívida excluída');
    loadDividas();
}

// ─── Init ───

document.addEventListener('DOMContentLoaded', async () => {
    try {
        await loadCategorias();
        await loadFiltros();
        await loadDashboard();
        await loadImportHistory();
    } catch (error) {
        toast(error.message, 'error');
    }
});

// ─── Deletar Transação (Part 1.4) ───

async function delTransacao(id) {
    if (!confirm('Excluir esta transação permanentemente?')) return;
    try {
        await api(`/api/transacoes/${id}`, { method: 'DELETE' });
        toast('Transação excluída');
        loadTransacoes();
        loadDashboard();
    } catch (error) {
        toast(error.message, 'error');
    }
}
