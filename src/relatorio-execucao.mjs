import fs from "node:fs/promises";
import path from "node:path";
import { exibirIndicador } from "./indicadores.mjs";
import { prazoCompetencia } from "./monitoramento.mjs";

function escapar(valor) {
  return String(valor ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function dataHora(data) {
  if (!data) return "—";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short",
    timeZone: "America/Sao_Paulo" }).format(new Date(data));
}

function dataCurta(data) {
  if (!data) return "—";
  const texto = String(data).length === 10 ? `${data}T12:00:00-03:00` : data;
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short",
    timeZone: "America/Sao_Paulo" }).format(new Date(texto));
}

function nomeMesCompetencia(chave) {
  const [ano, mes] = String(chave).split("-").map(Number);
  const nome = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(ano, mes - 1, 1)));
  return nome.charAt(0).toUpperCase() + nome.slice(1);
}

function carimboLocal(data) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit",
    day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    timeZone: "America/Sao_Paulo" }).formatToParts(new Date(data)).filter((x) => x.type !== "literal")
    .map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}_${p.hour}-${p.minute}`;
}

function retratoSms(item) {
  return item.verificacao ?? item.competenciaAtual;
}

function possuiDados(item) {
  return Number(retratoSms(item)?.total ?? 0) > 0;
}

function situacaoUnidade(item, agora, prazo) {
  if (possuiDados(item)) return { ordem: 1, classe: "ok", titulo: "Dados localizados",
    detalhe: "A competência foi localizada no SMS Rio." };
  if (item.status === "ERRO_SEM_ATUALIZAR" || item.competenciaSolicitada?.status === "ANO_NAO_EXTRAIDO") {
    return { ordem: 4, classe: "error", titulo: "Não foi possível consultar",
      detalhe: "Erro técnico; não concluir que a unidade está pendente." };
  }
  if (agora < new Date(prazo.pendenciaDesde)) return { ordem: 2, classe: "deadline", titulo: "Dentro do prazo",
    detalhe: `Pode preencher até ${dataCurta(prazo.prazoPreenchimento)}.` };
  return { ordem: 3, classe: "pending", titulo: "Pendente de preenchimento",
    detalhe: `Prazo terminou em ${dataCurta(prazo.prazoPreenchimento)}.` };
}

function valor(campo, v) {
  return escapar(v === "" || v == null ? "—" : exibirIndicador(campo, v));
}

function preenchido(v) {
  return !(v === "" || v === null || v === undefined);
}

function ehZero(v) {
  if (!preenchido(v)) return false;
  const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
  return Number.isFinite(n) && Math.abs(n) < 1e-12;
}

function chaveIndicador(v) {
  return `${v?.linha ?? ""}|${String(v?.grupo ?? "").toLowerCase()}|${String(v?.campo ?? "").toLowerCase()}`;
}

// Critério conservador para não transformar todo zero em pendência:
// atual vazio/zero + pelo menos 3 dos últimos 6 meses não zerados + mês anterior não zerado.
export function identificarPendenciasProvaveis(item) {
  const atual = retratoSms(item)?.detalhesValores ?? [];
  const historicos = [...(item.historicoSomenteLeitura ?? [])]
    .filter((h) => Array.isArray(h.detalhesValores))
    .sort((a, b) => String(b.competencia).localeCompare(String(a.competencia))).slice(0, 6);
  const candidatos = new Map();
  for (const v of atual) candidatos.set(chaveIndicador(v), { linha: v.linha, grupo: v.grupo, campo: v.campo });
  for (const h of historicos) for (const v of h.detalhesValores) {
    const k = chaveIndicador(v);
    if (!candidatos.has(k)) candidatos.set(k, { linha: v.linha, grupo: v.grupo, campo: v.campo });
  }
  const mapaAtual = new Map(atual.map((v) => [chaveIndicador(v), v.smsRio]));
  return [...candidatos.entries()].flatMap(([k, base]) => {
    const atualValor = mapaAtual.get(k) ?? "";
    if (preenchido(atualValor) && !ehZero(atualValor)) return [];
    const serie = historicos.map((h) => {
      const encontrado = h.detalhesValores.find((v) => chaveIndicador(v) === k);
      return { competencia: h.competencia, valor: encontrado?.smsRio ?? "" };
    });
    const mesesNaoZerados = serie.filter((x) => preenchido(x.valor) && !ehZero(x.valor)).length;
    const mesAnteriorPreenchido = serie.length > 0 && preenchido(serie[0].valor) && !ehZero(serie[0].valor);
    if (mesesNaoZerados < 3 || !mesAnteriorPreenchido) return [];
    return [{ ...base, valorAtual: atualValor, mesesNaoZerados, totalMeses: historicos.length, serie }];
  });
}

function idUnidade(item) {
  return `detalhes-${item.categoria}-${item.aba}`.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-");
}

async function organizarRelatoriosAntigos(pastaRaiz) {
  const nomes = await fs.readdir(pastaRaiz).catch(() => []);
  for (const nome of nomes) {
    const m = /^relatorio-(\d{4}-\d{2})-.*\.(html|pdf)$/i.exec(nome);
    if (!m) continue;
    const destino = path.join(pastaRaiz, m[1]);
    await fs.mkdir(destino, { recursive: true });
    await fs.rename(path.join(pastaRaiz, nome), path.join(destino, nome)).catch(() => {});
  }
}

export async function salvarRelatorioExecucao(log, raiz) {
  const unidades = log.unidades ?? [];
  const agora = new Date(log.fim ?? log.inicio ?? Date.now());
  const prazo = prazoCompetencia(log.competencia);
  const indicadoresForaPrazo = agora >= new Date(prazo.pendenciaDesde);
  const rotuloPendencias = "Indicadores pendentes pelo histórico";
  const eventos = unidades.flatMap((item) => item.monitoramento ?? []);
  const ordemCategoria = new Map([["Geral", 1], ["Maternidade", 2], ["Pediatria", 3]]);
  const linhas = unidades.map((item) => {
    const pendenciasIndicadores = identificarPendenciasProvaveis(item);
    const chavesPendentes = new Set(pendenciasIndicadores.map(chaveIndicador));
    const valoresAtuais = retratoSms(item)?.detalhesValores ?? [];
    const preenchidos = valoresAtuais.filter((v) => preenchido(v.smsRio) && !chavesPendentes.has(chaveIndicador(v))).length;
    const alteracoesIndicadores = [...new Map(eventos.filter((e) => e.tipo === "ALTERACAO_INDICADOR" &&
      e.categoria === item.categoria && e.sigla === item.aba).map((e) => [chaveIndicador(e), e])).values()];
    const alteracoesPosMarcoIndicadores = alteracoesIndicadores.filter((e) => e.aposMarco);
    return { item, situacao: situacaoUnidade(item, agora, prazo), pendenciasIndicadores,
      alteracoesIndicadores, alteracoesPosMarcoIndicadores, preenchidos,
      totalIndicadores: valoresAtuais.length || retratoSms(item)?.total || 0 };
  }).sort((a, b) => (ordemCategoria.get(a.item.categoria) ?? 99) - (ordemCategoria.get(b.item.categoria) ?? 99) ||
    a.situacao.ordem - b.situacao.ordem || String(a.item.aba).localeCompare(String(b.item.aba)));
  const localizadas = linhas.filter((x) => x.situacao.classe === "ok");
  const dentroPrazo = linhas.filter((x) => x.situacao.classe === "deadline");
  const pendentes = linhas.filter((x) => x.situacao.classe === "pending");
  const erros = linhas.filter((x) => x.situacao.classe === "error");
  const alteracoes = eventos.filter((x) => x.tipo === "ALTERACAO_INDICADOR");
  const alteracoesPosMarco = alteracoes.filter((x) => x.aposMarco);
  const preenchimentos = eventos.filter((x) => x.tipo === "NOVO_PREENCHIMENTO");
  const primeirasFotos = eventos.filter((x) => x.tipo === "PRIMEIRA_FOTOGRAFIA");
  const totalPreenchidos = linhas.reduce((soma, x) => soma + x.preenchidos, 0);
  const totalPendenciasIndicadores = linhas.reduce((soma, x) => soma + x.pendenciasIndicadores.length, 0);
  const totalAlteracoesIndicadores = linhas.reduce((soma, x) => soma + x.alteracoesIndicadores.length, 0);
  const logoArquivo = path.join(raiz, "assets", "logo-dqe.png");
  const logoBase64 = await fs.readFile(logoArquivo).then((d) => d.toString("base64")).catch(() => "");

  const tabelaUnidades = linhas.map(({ item, situacao, pendenciasIndicadores, alteracoesIndicadores,
    alteracoesPosMarcoIndicadores, preenchidos, totalIndicadores }) => {
    return `<tr><td><span class="tag">${escapar(item.categoria)}</span></td><td><strong>${escapar(item.aba)}</strong></td>
      <td class="left">${escapar(item.nome)}</td><td><span class="status ${situacao.classe}">${situacao.titulo}</span><small>${situacao.detalhe}</small></td>
      <td><strong>${preenchidos}</strong><small>de ${totalIndicadores || "—"}</small></td>
      <td>${pendenciasIndicadores.length ? `<button class="count-button ${indicadoresForaPrazo ? "pending-count" : "open-count"}" data-dialog="${idUnidade(item)}" data-focus="pendencias" title="Abrir indicadores pendentes pelo histórico">${pendenciasIndicadores.length}</button>` : "<span class=\"count-zero\">0</span>"}</td>
      <td>${alteracoesIndicadores.length ? `<button class="count-button change-count" data-dialog="${idUnidade(item)}" data-focus="alteracoes" title="Abrir indicadores alterados">${alteracoesIndicadores.length}</button>` : "<span class=\"count-zero\">0</span>"}</td>
      <td>${alteracoesPosMarcoIndicadores.length ? `<button class="count-button after-count" data-dialog="${idUnidade(item)}" data-focus="pos-marco" title="Abrir alterações após o dia 10">${alteracoesPosMarcoIndicadores.length}</button>` : "<span class=\"count-zero\">0</span>"}</td></tr>`;
  }).join("");

  const dialogos = linhas.filter((x) => x.pendenciasIndicadores.length || x.alteracoesIndicadores.length)
    .map(({ item, pendenciasIndicadores, alteracoesIndicadores, alteracoesPosMarcoIndicadores }) => `<dialog id="${idUnidade(item)}"><div class="dialog-head"><div><span class="tag">${escapar(item.categoria)}</span><h2>${escapar(item.aba)} · ${escapar(item.nome)}</h2></div><button class="dialog-close" aria-label="Fechar">×</button></div>
    <div class="dialog-body"><section data-section="pendencias"><h3>${rotuloPendencias} (${pendenciasIndicadores.length})</h3><p class="section-note">Não são todos os zeros: entram apenas os que interromperam o padrão recente de preenchimento. ${indicadoresForaPrazo ? "O prazo já terminou." : `A unidade ainda está dentro do prazo até ${dataCurta(prazo.prazoPreenchimento)}.`}</p>${pendenciasIndicadores.length ? `<table><thead><tr><th>Indicador</th><th>Atual</th><th>Evidência histórica</th></tr></thead><tbody>${pendenciasIndicadores.map((p) => `<tr><td class="left"><strong>${escapar(p.campo)}</strong><br><small>${escapar(p.grupo)}</small></td><td>${valor(p.campo, p.valorAtual)}</td><td>${p.mesesNaoZerados} de ${p.totalMeses} meses com valor; mês anterior preenchido</td></tr>`).join("")}</tbody></table>` : `<p class="empty">Nenhum indicador pendente pelo critério histórico.</p>`}</section>
    <section data-section="alteracoes"><h3>Indicadores alterados desde a última consulta (${alteracoesIndicadores.length})</h3>${alteracoesIndicadores.length ? `<table><thead><tr><th>Indicador</th><th>Anterior</th><th>Atual</th><th>Detectado</th><th>Prazo</th></tr></thead><tbody>${alteracoesIndicadores.map((e) => `<tr class="${e.aposMarco ? "critical-row" : ""}"><td class="left"><strong>${escapar(e.campo)}</strong><br><small>${escapar(e.grupo)}</small></td><td>${valor(e.campo, e.valorAnterior)}</td><td>${valor(e.campo, e.valorAtual)}</td><td>${dataHora(e.detectadoEm)}</td><td>${e.aposMarco ? `<span class="alert critical">APÓS O MARCO DO DIA 10</span>` : `<span class="alert normal">Dentro do acompanhamento</span>`}</td></tr>`).join("")}</tbody></table>` : `<p class="empty">Nenhum indicador alterado.</p>`}</section>
    <section data-section="pos-marco"><h3>Indicadores alterados após o dia 10 (${alteracoesPosMarcoIndicadores.length})</h3>${alteracoesPosMarcoIndicadores.length ? `<table><thead><tr><th>Indicador</th><th>Anterior</th><th>Atual</th><th>Detectado</th></tr></thead><tbody>${alteracoesPosMarcoIndicadores.map((e) => `<tr class="critical-row"><td class="left"><strong>${escapar(e.campo)}</strong><br><small>${escapar(e.grupo)}</small></td><td>${valor(e.campo, e.valorAnterior)}</td><td>${valor(e.campo, e.valorAtual)}</td><td>${dataHora(e.detectadoEm)}</td></tr>`).join("")}</tbody></table>` : `<p class="empty">Nenhuma alteração após o dia 10.</p>`}</section></div></dialog>`).join("");

  const tabelaEventos = [...preenchimentos, ...alteracoes].sort((a, b) => String(b.detectadoEm).localeCompare(String(a.detectadoEm)))
    .map((e) => {
      const posMarco = e.aposMarco;
      const atrasoPreenchimento = e.tipo === "NOVO_PREENCHIMENTO" && e.preenchimentoForaPrazoConfirmado;
      const alerta = posMarco ? "ALERTA: APÓS O MARCO DO DIA 10" : atrasoPreenchimento ? "PREENCHIMENTO APÓS O PRAZO" : "Mudança dentro do acompanhamento";
      return `<tr class="${posMarco ? "critical-row" : atrasoPreenchimento ? "late-row" : ""}">
        <td>${dataHora(e.detectadoEm)}</td><td><span class="tag">${escapar(e.categoria)}</span></td><td><strong>${escapar(e.sigla)}</strong><br><small>${escapar(e.unidade)}</small></td>
        <td>${e.tipo === "NOVO_PREENCHIMENTO" ? "Novo preenchimento detectado" : "Indicador alterado"}</td>
        <td class="left"><strong>${escapar(e.campo ?? "—")}</strong>${e.grupo ? `<br><small>${escapar(e.grupo)}</small>` : ""}</td>
        <td>${valor(e.campo, e.valorAnterior)}</td><td>${valor(e.campo, e.valorAtual)}</td><td><span class="alert ${posMarco ? "critical" : atrasoPreenchimento ? "late" : "normal"}">${alerta}</span></td></tr>`;
    }).join("");

  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Relatório SMS Rio — ${escapar(log.competencia)}</title><style>
    :root{--navy:#12345a;--blue:#247eb5;--cyan:#43c4e8;--ink:#10243d;--muted:#60758c;--line:#cfe0ec;--ok:#16825d;--warn:#c78310;--red:#c53d4b}
    *{box-sizing:border-box}body{margin:0;background:linear-gradient(135deg,#eef8fc,#f8fbfd);color:var(--ink);font-family:"Segoe UI",Arial,sans-serif;font-size:13px}.page{max-width:1450px;margin:24px auto;padding:0 18px 36px}
    .hero{display:grid;grid-template-columns:145px 1fr;background:linear-gradient(105deg,#0b2748,#174f7a 68%,#218bb1);border-radius:18px;overflow:hidden;box-shadow:0 12px 30px #173c5b26}.brand{background:#fff;display:flex;align-items:center;justify-content:center;padding:14px}.brand img{max-width:116px;max-height:190px}.hero-main{padding:25px 30px;color:#fff}.eyebrow{font-size:11px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:#8ee9ff}.hero h1{font-size:28px;margin:9px 0 5px}.hero p{margin:0;color:#d8eff9}.hero-meta{display:flex;gap:24px;flex-wrap:wrap;border-top:1px solid #ffffff38;margin-top:20px;padding-top:14px;font-size:12px}
    .rules{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin:18px 0}.rule{background:#fff;border:1px solid var(--line);border-left:6px solid var(--blue);border-radius:12px;padding:15px 18px;box-shadow:0 5px 15px #173c5b10}.rule.critical{border-left-color:var(--red);background:#fff8f8}.rule strong{display:block;font-size:16px;margin-bottom:3px}.rule span{color:var(--muted)}
    .metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(175px,1fr));gap:12px}.metric{background:#fff;border:1px solid var(--line);border-radius:14px;padding:17px;box-shadow:0 5px 15px #173c5b10}.metric b{font-size:31px;color:var(--navy);display:block}.metric span{font-weight:700}.metric small{display:block;color:var(--muted);margin-top:3px}.metric.pending{border-top:5px solid var(--red)}.metric.deadline{border-top:5px solid var(--warn)}.metric.ok{border-top:5px solid var(--ok)}.metric.changed{border-top:5px solid var(--blue)}
    .panel{background:#fff;border:1px solid var(--line);border-radius:16px;margin-top:16px;padding:18px;box-shadow:0 6px 20px #173c5b12}.panel h2{font-size:19px;margin:0 0 4px}.panel>p{color:var(--muted);margin:0 0 14px}.attention{background:#fff1f2;border:2px solid var(--red);color:#8f1d2b;padding:14px;border-radius:12px;font-weight:800;font-size:16px;margin:12px 0}
    .table-wrap{overflow:auto;border:1px solid var(--line);border-radius:12px}table{border-collapse:collapse;width:100%;min-width:980px}th{background:var(--navy);color:#fff;text-transform:uppercase;letter-spacing:.06em;font-size:10px;padding:11px 8px}td{border-bottom:1px solid #dce8f0;padding:10px 8px;text-align:center;vertical-align:middle}td.left{text-align:left}tbody tr:nth-child(even){background:#f7fbfd}.tag{display:inline-block;border-radius:999px;padding:3px 8px;background:#e3f5fb;color:#125477;font-size:10px;font-weight:800}.status,.alert{display:inline-block;border-radius:999px;padding:5px 9px;font-weight:800;font-size:11px}.status+small{display:block;margin-top:4px;color:var(--muted)}.status.ok{background:#e5f6ef;color:#126644}.status.deadline{background:#fff5d9;color:#865700}.status.pending,.status.error,.alert.critical{background:#ffe3e6;color:#9f1d2d}.alert.late{background:#fff0cf;color:#845400}.alert.normal{background:#e6f4fa;color:#145978}.critical-row{background:#fff0f1!important;border-left:5px solid var(--red)}.late-row{background:#fff8e8!important}
    .count-button{min-width:44px;border:0;border-radius:12px;padding:8px 13px;color:#fff;font-size:16px;font-weight:900;cursor:pointer;box-shadow:0 4px 12px #173c5b20;transition:.18s}.count-button:hover{transform:translateY(-2px);filter:brightness(1.06)}.pending-count,.after-count{background:var(--red)}.open-count{background:var(--warn)}.change-count{background:var(--blue)}.count-zero{color:#8798a9;font-weight:700}
    dialog{width:min(1050px,92vw);max-height:88vh;border:0;border-radius:18px;padding:0;box-shadow:0 25px 80px #06192d66;color:var(--ink)}dialog::backdrop{background:#071b2dcc;backdrop-filter:blur(4px)}.dialog-head{display:flex;justify-content:space-between;align-items:center;padding:18px 22px;background:linear-gradient(105deg,#0b2748,#218bb1);color:#fff}.dialog-head h2{margin:6px 0 0}.dialog-close{border:1px solid #ffffff66;background:#ffffff18;color:#fff;border-radius:50%;width:40px;height:40px;font-size:25px;cursor:pointer}.dialog-body{padding:20px;overflow:auto;max-height:calc(88vh - 92px);scroll-behavior:smooth}.dialog-body h3{color:var(--navy);border-left:4px solid var(--cyan);padding-left:9px;margin-top:20px}.section-note{color:var(--muted);margin:0 0 12px}.dialog-body section{scroll-margin-top:12px}.dialog-body section.focused{animation:focusSection 1.4s ease}@keyframes focusSection{0%,45%{background:#e9f8fd;box-shadow:0 0 0 9px #e9f8fd;border-radius:8px}100%{background:transparent;box-shadow:none}}
    .empty{padding:24px;text-align:center;color:var(--muted);background:#f7fbfd;border-radius:10px}.footer{text-align:center;color:var(--muted);font-size:10px;margin-top:18px}
    @media print{body{background:#fff;font-size:9px}.page{max-width:none;margin:0;padding:0}.hero{box-shadow:none;border-radius:8px}.hero-main{padding:18px 22px}.hero h1{font-size:22px}.brand img{max-height:125px}.rules,.metrics{break-inside:avoid}.panel{box-shadow:none}.table-wrap{overflow:visible}table{min-width:0}th{font-size:8px}td{padding:6px 5px}.critical-row{break-inside:avoid}}
  </style></head><body><div class="page">
    <header class="hero"><div class="brand">${logoBase64 ? `<img src="data:image/png;base64,${logoBase64}" alt="Prefeitura do Rio">` : "RIO · SAÚDE · SUBHUE"}</div><div class="hero-main"><div class="eyebrow">Acompanhamento de preenchimento</div><h1>Relatório da Plataforma SMS Rio</h1><p>Leitura simples da disponibilidade e das alterações dos Macroindicadores</p><div class="hero-meta"><span><strong>Competência:</strong> ${escapar(nomeMesCompetencia(log.competencia))}</span><span><strong>Conferido em:</strong> ${dataHora(log.fim)}</span><span><strong>Unidades:</strong> ${unidades.length}</span></div></div></header>
    <section class="rules"><div class="rule"><strong>Prazo de preenchimento: até ${dataCurta(prazo.prazoPreenchimento)}</strong><span>Antes dessa data, uma unidade sem dados aparece como “Dentro do prazo”. A pendência começa no dia 6.</span></div><div class="rule critical"><strong>Marco de alterações: dia ${dataCurta(prazo.fechamento)}</strong><span>Alterações detectadas a partir do dia 11 recebem o alerta “Após o marco do dia 10”.</span></div></section>
    ${alteracoesPosMarco.length ? `<div class="attention">⚠ ${alteracoesPosMarco.length} ALTERAÇÃO(ÕES) DE INDICADOR DETECTADA(S) APÓS O MARCO DO DIA 10</div>` : ""}
    <section class="metrics"><div class="metric"><b>${unidades.length}</b><span>Unidades consultadas</span><small>Escopo desta execução</small></div><div class="metric ok"><b>${localizadas.length}</b><span>Unidades com dados localizados</span><small>Competência encontrada no SMS Rio</small></div><div class="metric deadline"><b>${dentroPrazo.length}</b><span>Unidades ainda dentro do prazo</span><small>Podem preencher até o dia 5</small></div><div class="metric pending"><b>${pendentes.length}</b><span>Unidades pendentes</span><small>Sem dados a partir do dia 6</small></div><div class="metric ok"><b>${totalPreenchidos}</b><span>Indicadores preenchidos</span><small>Somatório das unidades consultadas</small></div><div class="metric ${indicadoresForaPrazo ? "pending" : "deadline"}"><b>${totalPendenciasIndicadores}</b><span>${rotuloPendencias}</span><small>Não inclui todos os zeros · ${indicadoresForaPrazo ? "prazo encerrado" : "amarelo enquanto estiver no prazo"}</small></div><div class="metric changed"><b>${totalAlteracoesIndicadores}</b><span>Indicadores alterados</span><small>Desde a última consulta comparável</small></div></section>
    <section class="panel"><h2>Situação das unidades · leitura rápida</h2><p>Os números coloridos são clicáveis. A coluna de pendências usa somente a regra histórica dos seis meses; não soma todos os zeros. ${indicadoresForaPrazo ? "Vermelho: prazo encerrado." : "Amarelo: a unidade ainda pode preencher até o dia 5; depois disso, o botão fica vermelho."}</p><div class="table-wrap"><table><thead><tr><th>Categoria</th><th>Sigla</th><th>Unidade</th><th>Situação</th><th>Indicadores preenchidos</th><th>Indicadores pendentes<br>regra dos 6 meses</th><th>Alterados desde<br>a última consulta</th><th>Alterados após<br>o dia 10</th></tr></thead><tbody>${tabelaUnidades}</tbody></table></div></section>
    <section class="panel"><h2>Novos preenchimentos e indicadores alterados</h2><p>Valores anteriores e atuais são fotografias da própria plataforma SMS Rio em execuções diferentes.</p>${tabelaEventos ? `<div class="table-wrap"><table><thead><tr><th>Detectado em</th><th>Categoria</th><th>Unidade</th><th>Ocorrência</th><th>Indicador</th><th>Valor anterior</th><th>Valor atual</th><th>Alerta</th></tr></thead><tbody>${tabelaEventos}</tbody></table></div>` : `<div class="empty">Nenhum novo preenchimento ou alteração foi confirmado entre as fotografias disponíveis.${primeirasFotos.length ? " Esta execução criou a primeira fotografia de referência para " + primeirasFotos.length + " unidade(s)." : ""}</div>`}</section>
    ${erros.length ? `<section class="panel"><h2>Consultas que exigem nova tentativa</h2><p>${erros.map((x) => escapar(`${x.item.aba} — ${x.item.nome}`)).join(" · ")}</p></section>` : ""}
    <div class="footer">DQE — Dados e Indicadores · SUBHUE · Secretaria Municipal de Saúde do Rio de Janeiro</div>
  </div>${dialogos}<script>document.querySelectorAll('[data-dialog]').forEach((b)=>b.addEventListener('click',()=>{const d=document.getElementById(b.dataset.dialog);if(!d)return;d.showModal();const s=d.querySelector('[data-section="'+b.dataset.focus+'"]');if(s){d.querySelectorAll('.focused').forEach((x)=>x.classList.remove('focused'));s.classList.add('focused');s.scrollIntoView({block:'start'})}}));document.querySelectorAll('.dialog-close').forEach((b)=>b.addEventListener('click',()=>b.closest('dialog').close()));document.querySelectorAll('dialog').forEach((d)=>d.addEventListener('click',(e)=>{if(e.target===d)d.close()}));</script></body></html>`;

  const pastaRaiz = path.join(raiz, "relatorios");
  await fs.mkdir(pastaRaiz, { recursive: true });
  await organizarRelatoriosAntigos(pastaRaiz);
  const pastaCompetencia = path.join(pastaRaiz, log.competencia);
  await fs.mkdir(pastaCompetencia, { recursive: true });
  const base = `Relatorio_SMSRio_${log.competencia}_${carimboLocal(log.fim)}`;
  const arquivo = path.join(pastaCompetencia, `${base}.html`);
  await fs.writeFile(arquivo, html, "utf8");
  return arquivo;
}
