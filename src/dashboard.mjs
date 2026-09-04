import fs from "node:fs/promises";
import path from "node:path";
import { renderDashboardHtml } from "./dashboard-ui.mjs";

function seguroJson(valor) {
  return JSON.stringify(valor).replaceAll("<", "\\u003c");
}

function normalizarTexto(valor) {
  return String(valor ?? "").normalize("NFD").replaceAll(/\p{Diacritic}/gu, "").toLowerCase();
}

function preenchido(valor) {
  return !(valor === "" || valor === null || valor === undefined);
}

function numeroComparavel(valor) {
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : null;
  const texto = String(valor ?? "").trim().replace(/[‰%]/g, "").replace(",", ".");
  const numero = Number(texto);
  return Number.isFinite(numero) ? numero : null;
}

function valoresIguais(a, b) {
  if (!preenchido(a) && !preenchido(b)) return true;
  if (!preenchido(a) || !preenchido(b)) return false;
  const na = numeroComparavel(a);
  const nb = numeroComparavel(b);
  if (na !== null && nb !== null) return Math.abs(na - nb) < 1e-8;
  return String(a) === String(b);
}

function dataMarcoDaCompetencia(chaveCompetencia) {
  const [ano, mes] = String(chaveCompetencia ?? "").split("-").map(Number);
  if (!ano || !mes) return null;
  // O mês é intencionalmente usado como índice: julho (7) gera 10 de agosto.
  return new Date(ano, mes, 10, 0, 0, 0, 0);
}

function dataForaDaMetaDaCompetencia(chaveCompetencia) {
  const [ano, mes] = String(chaveCompetencia ?? "").split("-").map(Number);
  if (!ano || !mes) return null;
  // O dia 10 inteiro permanece dentro do prazo. O atraso começa às 00h do dia 11.
  return new Date(ano, mes, 11, 0, 0, 0, 0);
}

function chaveIndicador(item) {
  return `${item?.linha ?? ""}|${normalizarTexto(item?.grupo)}|${normalizarTexto(item?.campo)}`;
}

function registrarMonitoramentoPosMarco({ log, unidade, atual, possuiDados, estado, eventos }) {
  const instante = new Date(log.fim ?? log.inicio);
  const marco = dataMarcoDaCompetencia(log.competencia);
  const foraDaMetaDesde = dataForaDaMetaDaCompetencia(log.competencia);
  if (!marco || !foraDaMetaDesde || Number.isNaN(instante.getTime())) return;

  const chaveUnidade = `${log.competencia}|${unidade.categoria}|${unidade.aba}`;
  const valores = Array.isArray(atual?.detalhesValores) ? atual.detalhesValores : [];
  const fotografia = {
    possuiDados,
    valores: new Map(valores.map((item) => [chaveIndicador(item), item])),
    executadoEm: instante.toISOString(),
    jaPossuiuDados: Boolean(estado.get(chaveUnidade)?.jaPossuiuDados || possuiDados),
    ultimoComDados: null
  };
  const anterior = estado.get(chaveUnidade);
  fotografia.ultimoComDados = possuiDados
    ? { valores: fotografia.valores, executadoEm: fotografia.executadoEm }
    : (anterior?.ultimoComDados ?? null);

  if (instante >= foraDaMetaDesde) {
    const base = {
      competencia: log.competencia,
      categoria: unidade.categoria,
      sigla: unidade.aba,
      unidade: unidade.nome,
      detectadoEm: instante.toISOString(),
      marcoEm: marco.toISOString(),
      foraDaMetaDesde: foraDaMetaDesde.toISOString(),
      statusPrazo: "FORA_DA_META",
      modo: log.modo
    };

    if (anterior && !anterior.jaPossuiuDados && possuiDados) {
      eventos.push({ ...base, tipo: "PREENCHIMENTO_POS_MARCO", confirmado: true });
    } else if (!anterior && possuiDados) {
      eventos.push({ ...base, tipo: "PRIMEIRA_FOTOGRAFIA_POS_MARCO", confirmado: false });
    }

    if (anterior?.ultimoComDados && possuiDados) {
      for (const item of valores) {
        const itemAnterior = anterior.ultimoComDados.valores.get(chaveIndicador(item));
        if (!itemAnterior || valoresIguais(itemAnterior.smsRio, item.smsRio)) continue;
        eventos.push({
          ...base,
          tipo: "ALTERACAO_INDICADOR_POS_MARCO",
          confirmado: true,
          linha: item.linha,
          grupo: item.grupo,
          campo: item.campo,
          valorAnterior: itemAnterior.smsRio,
          valorAtual: item.smsRio,
          fotografiaAnteriorEm: anterior.ultimoComDados.executadoEm
        });
      }
    }
  }

  estado.set(chaveUnidade, fotografia);
}

// Uma competência já confirmada no SMS Rio não deve voltar a ser classificada
// como "pendente" apenas porque uma reconsulta posterior falhou ou a SPA
// apresentou momentaneamente uma tabela incompleta. Mantemos a fotografia SMS
// confirmada mais recente e registramos separadamente a tentativa posterior.
function escolherRegistroMaisConfiavel(anterior, atual) {
  if (!anterior) return atual;
  const atualEhMaisNovo = String(atual.executadoEm ?? "") > String(anterior.executadoEm ?? "");
  if (!atualEhMaisNovo) return anterior;
  if (atual.possuiDados || !anterior.possuiDados) return atual;

  return {
    ...anterior,
    ultimaReconsultaEm: atual.executadoEm,
    ultimaReconsultaStatus: atual.status,
    ultimaReconsultaErro: atual.erro ?? "",
    origemStatus: "FOTOGRAFIA_SMS_CONFIRMADA_ANTERIORMENTE"
  };
}

// Painel local: uma p&aacute;gina HTML sem servidor, atualizada ao final de cada execu&ccedil;&atilde;o.
export async function salvarDashboard(raiz) {
  const pastaLogs = path.join(raiz, "logs");
  const arquivos = await fs.readdir(pastaLogs).catch(() => []);
  const ultimos = new Map();
  const configuradas = await fs.readFile(path.join(raiz, "config", "unidades.json"), "utf8")
    .then((texto) => JSON.parse(texto)).catch(() => []);
  const snapshotPlanilhas = await fs.readFile(path.join(raiz, "dados", "snapshot-planilhas.json"), "utf8")
    .then((texto) => JSON.parse(texto)).catch(() => ({ atualizadoEm: null, registros: [] }));
  const chavesConfiguradas = new Set(configuradas.map((item) => `${item.categoria}|${item.aba}`));
  const arquivosLogs = arquivos.filter((nome) => nome.endsWith(".json")).sort();
  const monitoramentoPosMarco = [];
  const estadoMonitoramento = new Map();

  for (const nomeArquivo of arquivosLogs) {
    try {
      const log = JSON.parse(await fs.readFile(path.join(pastaLogs, nomeArquivo), "utf8"));
      for (const unidade of log.unidades ?? []) {
        if (chavesConfiguradas.size && !chavesConfiguradas.has(`${unidade.categoria}|${unidade.aba}`)) continue;
        const antes = unidade.competenciaAtual;
        // Em modo atualizar, "competenciaAtual" retrata o que foi encontrado antes da gravacao.
        // "verificacao" e a fotografia confirmada depois da gravacao e deve representar o estado atual.
        const atual = unidade.verificacao ?? antes;
        const possuiCompetenciaAtual = Number(atual?.total ?? 0) > 0;
        // A partir da versão otimizada, uma ausência só é definitiva quando o
        // relatório anual foi exportado e a competência não apareceu no arquivo.
        // Logs antigos usavam a tabela visível da SPA e podiam gerar falso negativo.
        const ausenciaConfirmadaNoArquivo =
          unidade.competenciaSolicitada?.status === "MES_NAO_DISPONIVEL";
        const statusConfiavel =
          unidade.status === "MES_NAO_DISPONIVEL_SMSRIO" &&
          !possuiCompetenciaAtual &&
          !ausenciaConfirmadaNoArquivo
            ? "REVALIDAR_SMSRIO"
            : unidade.status;
        const historicoIncompleto =
          (unidade.status === "MES_NAO_DISPONIVEL_SMSRIO" && possuiCompetenciaAtual) ||
          (unidade.historicoSomenteLeitura ?? []).some((historico) => historico.status === "MES_NAO_DISPONIVEL");
        const chave = `${log.competencia}|${unidade.categoria}|${unidade.aba}`;
        const registro = {
          competencia: log.competencia,
          ano: Number(String(log.competencia).slice(0, 4)),
          mes: Number(String(log.competencia).slice(5, 7)),
          categoria: unidade.categoria,
          sigla: unidade.aba,
          unidade: unidade.nome,
          status: historicoIncompleto
            ? "CONFERIDO_HISTORICO_INCOMPLETO"
            : statusConfiavel === "ERRO_SEM_ATUALIZAR" && possuiCompetenciaAtual
              ? "DADOS_COLETADOS_VERIFICAR" : statusConfiavel,
          erro: unidade.erro ?? "",
          possuiDados: possuiCompetenciaAtual,
          historicoIncompleto,
          erroHistorico: historicoIncompleto ? (unidade.erro ?? "") : "",
          executadoEm: log.fim ?? log.inicio,
          origem: unidade.verificacao ? "APOS_ATUALIZACAO" : "CONSULTA",
          total: atual?.total ?? 0,
          competenciaAtual: atual?.novos ?? 0,
          zerados: atual?.zeros ?? 0,
          divergentes: atual?.diferencas ?? 0,
          pendencias: antes?.classificacaoZeros?.possiveisPendencias ?? 0,
          naoAplicaveis: antes?.classificacaoZeros?.possiveisNaoAplicaveis ?? 0,
          requerValidacao: antes?.classificacaoZeros?.requeremValidacao ?? 0,
          detalhesZeros: antes?.detalhesZeros ?? atual?.detalhesZeros ?? [],
          detalhesDivergencias: atual?.detalhesDiferencas ?? [],
          detalhesValores: atual?.detalhesValores ?? [],
          alteracoesEncontradas: (antes?.novos ?? 0) + (antes?.diferencas ?? 0),
          detalhesAlteracoes: [
            ...(antes?.detalhesNovos ?? []).map((item) => ({ ...item, planilha: "", tipo: "DADO_NOVO" })),
            ...(antes?.detalhesDiferencas ?? []).map((item) => ({ ...item, tipo: "DIVERGENCIA" }))
          ]
        };
        if (Array.isArray(unidade.monitoramento)) {
          for (const evento of unidade.monitoramento) {
            if (!evento.aposMarco) continue;
            monitoramentoPosMarco.push({
              ...evento,
              tipo: evento.tipo === "ALTERACAO_INDICADOR"
                ? "ALTERACAO_INDICADOR_POS_MARCO"
                : evento.tipo === "NOVO_PREENCHIMENTO"
                  ? "PREENCHIMENTO_POS_MARCO"
                  : "PRIMEIRA_FOTOGRAFIA_POS_MARCO",
              statusPrazo: evento.confirmadoForaPrazo ? "FORA_DA_META" : "AGUARDANDO_CONFIRMACAO",
              confirmado: Boolean(evento.confirmadoForaPrazo),
              modo: log.modo
            });
          }
        } else {
          registrarMonitoramentoPosMarco({
            log,
            unidade,
            atual,
            possuiDados: possuiCompetenciaAtual,
            estado: estadoMonitoramento,
            eventos: monitoramentoPosMarco
          });
        }
        if (registro.status === "ERRO_SEM_ATUALIZAR" && registro.possuiDados) {
          registro.statusPainel = "DADOS_COLETADOS_VERIFICAR";
        } else {
          registro.statusPainel = registro.status;
        }
        const anterior = ultimos.get(chave);
        ultimos.set(chave, escolherRegistroMaisConfiavel(anterior, registro));
      }
    } catch {}
  }

  const execucoes = [];
  for (const nomeArquivo of arquivosLogs) {
    try {
      const log = JSON.parse(await fs.readFile(path.join(pastaLogs, nomeArquivo), "utf8"));
      const unidades = log.unidades ?? [];
      const possuiCompetenciaAtual = (item) => Number(item.competenciaAtual?.total ?? 0) > 0;
      const semCompetencia = unidades.filter((item) =>
        item.status === "MES_NAO_DISPONIVEL_SMSRIO" && !possuiCompetenciaAtual(item)
      );
      const historicoIncompleto = unidades.filter((item) =>
        (item.status === "MES_NAO_DISPONIVEL_SMSRIO" && possuiCompetenciaAtual(item)) ||
        (item.historicoSomenteLeitura ?? []).some((historico) => historico.status === "MES_NAO_DISPONIVEL")
      );
      const naoLocalizadas = unidades.filter((item) => {
        const erro = normalizarTexto(item.erro);
        return item.status === "ERRO_SEM_ATUALIZAR" &&
          (erro.includes("nenhum resultado") || erro.includes("nao encontrad") || erro.includes("esperado 1 resultado"));
      });
      const errosTecnicos = unidades.filter((item) =>
        item.status === "ERRO_SEM_ATUALIZAR" && !naoLocalizadas.includes(item)
      );
      const lancadas = unidades.filter((item) => typeof item.competenciaAtual?.total === "number" && item.competenciaAtual.total > 0);
      const alteradas = unidades.filter((item) => (item.competenciaAtual?.diferencas ?? 0) > 0);
      const alteradasHistorico = unidades.filter((item) =>
        (item.historicoSomenteLeitura ?? []).some((historico) => (historico.diferencas ?? 0) > 0)
      );
      execucoes.push({
        inicio: log.inicio,
        fim: log.fim ?? log.inicio,
        competencia: log.competencia,
        ano: Number(String(log.competencia).slice(0, 4)),
        mes: Number(String(log.competencia).slice(5, 7)),
        modo: log.modo,
        solicitadas: unidades.length,
        lancadas: lancadas.length,
        semCompetencia: semCompetencia.length,
        historicoIncompleto: historicoIncompleto.length,
        naoLocalizadas: naoLocalizadas.length,
        errosTecnicos: errosTecnicos.length,
        unidadesLancadas: lancadas.map((item) => `${item.categoria}: ${item.aba}`),
        unidadesSemCompetencia: semCompetencia.map((item) => `${item.categoria}: ${item.aba}`),
        unidadesHistoricoIncompleto: historicoIncompleto.map((item) => `${item.categoria}: ${item.aba}`),
        unidadesNaoLocalizadas: naoLocalizadas.map((item) => `${item.categoria}: ${item.aba}`),
        unidadesComErro: errosTecnicos.map((item) => `${item.categoria}: ${item.aba}`),
        unidadesAlteradas: alteradas.map((item) => `${item.categoria}: ${item.aba}`),
        unidadesAlteradasHistorico: alteradasHistorico.map((item) => `${item.categoria}: ${item.aba}`),
        indicadoresDivergentes: alteradas.reduce((total, item) => total + (item.competenciaAtual?.diferencas ?? 0), 0)
      });
    } catch {}
  }
  execucoes.sort((a, b) => String(b.fim).localeCompare(String(a.fim)));

  // Inclui tamb&eacute;m as compet&ecirc;ncias anteriores consultadas durante cada execu&ccedil;&atilde;o.
  // Assim o filtro de ano/m&ecirc;s mostra a janela hist&oacute;rica j&aacute; conferida pelo rob&ocirc;.
  for (const nomeArquivo of arquivosLogs) {
    try {
      const log = JSON.parse(await fs.readFile(path.join(pastaLogs, nomeArquivo), "utf8"));
      for (const unidade of log.unidades ?? []) {
        if (chavesConfiguradas.size && !chavesConfiguradas.has(`${unidade.categoria}|${unidade.aba}`)) continue;
        for (const historico of unidade.historicoSomenteLeitura ?? []) {
          if (typeof historico.total !== "number") continue;
          const chave = `${historico.competencia}|${unidade.categoria}|${unidade.aba}`;
          const registro = {
            competencia: historico.competencia,
            ano: Number(String(historico.competencia).slice(0, 4)),
            mes: Number(String(historico.competencia).slice(5, 7)),
            categoria: unidade.categoria,
            sigla: unidade.aba,
            unidade: unidade.nome,
            status: "CONFERIDO_HISTORICO",
            statusPainel: "CONFERIDO_HISTORICO",
            erro: "",
            possuiDados: true,
            executadoEm: log.fim ?? log.inicio,
            origem: "HISTORICO_SOMENTE_LEITURA",
            total: historico.total,
            competenciaAtual: historico.novos ?? 0,
            zerados: historico.zeros ?? 0,
            divergentes: historico.diferencas ?? 0,
            pendencias: historico.classificacaoZeros?.possiveisPendencias ?? 0,
            naoAplicaveis: historico.classificacaoZeros?.possiveisNaoAplicaveis ?? 0,
            requerValidacao: historico.classificacaoZeros?.requeremValidacao ?? 0,
            detalhesZeros: historico.detalhesZeros ?? [],
            detalhesDivergencias: historico.detalhesDiferencas ?? [],
            detalhesValores: historico.detalhesValores ?? [],
            alteracoesEncontradas: (historico.novos ?? 0) + (historico.diferencas ?? 0),
            detalhesAlteracoes: [
              ...(historico.detalhesNovos ?? []).map((item) => ({ ...item, planilha: "", tipo: "DADO_NOVO" })),
              ...(historico.detalhesDiferencas ?? []).map((item) => ({ ...item, tipo: "DIVERGENCIA" }))
            ]
          };
          const anterior = ultimos.get(chave);
          ultimos.set(chave, escolherRegistroMaisConfiavel(anterior, registro));
        }
      }
    } catch {}
  }

  // Ausência de uma fotografia não pode reduzir o total de unidades previstas.
  // Completa cada competência conhecida com as 36 combinações da configuração atual.
  const competenciasConhecidas = [...new Set([...ultimos.values()].map((item) => item.competencia))];
  for (const competencia of competenciasConhecidas) {
    for (const unidade of configuradas) {
      const chave = `${competencia}|${unidade.categoria}|${unidade.aba}`;
      if (ultimos.has(chave)) continue;
      ultimos.set(chave, {
        competencia, ano: Number(competencia.slice(0, 4)), mes: Number(competencia.slice(5, 7)),
        categoria: unidade.categoria, sigla: unidade.aba, unidade: unidade.nome,
        status: "SEM_REGISTRO_DE_CONSULTA", statusPainel: "SEM_REGISTRO_DE_CONSULTA",
        erro: "Não existe fotografia concluída desta unidade/competência nos logs disponíveis.",
        possuiDados: false, executadoEm: null, origem: "SEM_REGISTRO", total: 0,
        competenciaAtual: 0, zerados: 0, divergentes: 0, pendencias: 0,
        naoAplicaveis: 0, requerValidacao: 0, detalhesZeros: [], detalhesDivergencias: [],
        detalhesValores: [], alteracoesEncontradas: 0, detalhesAlteracoes: []
      });
    }
  }
  const dados = [...ultimos.values()].sort((a, b) =>
    b.competencia.localeCompare(a.competencia) || a.categoria.localeCompare(b.categoria) || a.sigla.localeCompare(b.sigla)
  );
  const fotosPlanilha = new Map((snapshotPlanilhas.registros ?? []).map((item) => [
    `${item.competencia}|${item.categoria}|${item.sigla}`, item
  ]));
  for (const registro of dados) {
    const foto = fotosPlanilha.get(`${registro.competencia}|${registro.categoria}|${registro.sigla}`);
    const valoresSms = registro.detalhesValores ?? [];

    if (foto?.detalhesValores?.length) {
      // SMS Rio e Google Sheets são fontes independentes. Sempre aplica a
      // fotografia mais recente do Sheets sem apagar a fotografia confirmada do SMS.
      const planilhaPorChave = new Map(
        foto.detalhesValores.map((item) => [`${item.linha ?? ""}|${item.campo ?? ""}`, item])
      );
      const smsPorChave = new Map(
        valoresSms.map((item) => [`${item.linha ?? ""}|${item.campo ?? ""}`, item])
      );
      const chaves = [...new Set([...smsPorChave.keys(), ...planilhaPorChave.keys()])];

      registro.detalhesValores = chaves.map((chave) => {
        const sms = smsPorChave.get(chave) ?? {};
        const planilha = planilhaPorChave.get(chave) ?? {};
        return {
          ...planilha,
          ...sms,
          grupo: sms.grupo ?? planilha.grupo ?? "",
          campo: sms.campo ?? planilha.campo ?? "",
          linha: sms.linha ?? planilha.linha,
          planilha: planilha.planilha ?? planilha.valor ?? sms.planilha ?? "",
          smsRio: sms.smsRio ?? ""
        };
      }).sort((a, b) => Number(a.linha ?? 99999) - Number(b.linha ?? 99999));

      registro.planilhaDisponivel = Boolean(foto.planilhaDisponivel);
      registro.origemPlanilha = "SNAPSHOT_GOOGLE_SHEETS";
      registro.snapshotPlanilhaEm = snapshotPlanilhas.atualizadoEm;

      if (registro.possuiDados && registro.planilhaDisponivel) {
        const divergencias = registro.detalhesValores.filter((item) =>
          preenchido(item.planilha) && preenchido(item.smsRio) &&
          !valoresIguais(item.planilha, item.smsRio)
        );
        registro.detalhesDivergencias = divergencias.map((item) => ({
          linha: item.linha, grupo: item.grupo, campo: item.campo,
          planilha: item.planilha, smsRio: item.smsRio
        }));
        registro.divergentes = registro.detalhesDivergencias.length;
      }
    } else {
      registro.planilhaDisponivel = valoresSms.some((item) => preenchido(item.planilha));
    }
  }
  const logo = await fs.readFile(path.join(raiz, "assets", "logo-dqe.png"))
    .then((valor) => valor.toString("base64")).catch(() => "");
  const sidebarMotion = await fs.readFile(path.join(raiz, "painel", "assets", "sidebar-ai-bg.webp"))
    .then((valor) => valor.toString("base64")).catch(() => "");

  const htmlLegado = `<!doctype html><html lang="pt-BR"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Painel Macroindicadores | SMS Rio</title>
<style>
:root{--navy:#101f64;--blue:#3159c8;--paper:#edf3fa;--card:#fff;--ink:#1b2440;--muted:#66718a;--line:#dce4ef;--green:#187953;--amber:#b77412;--red:#b43a46}*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--paper);color:var(--ink);font:13px/1.45 "Segoe UI",Arial,sans-serif}.layout{min-height:100vh;display:grid;grid-template-columns:230px 1fr}.sidebar{position:sticky;top:0;height:100vh;background:linear-gradient(155deg,#0d1d5d,#284cb3);color:#fff;padding:10px 12px;display:flex;flex-direction:column}.brand{background:#fff;border-radius:7px;padding:14px;height:239px;display:flex;align-items:center;justify-content:center}.brand img{width:100%;height:100%;object-fit:contain}.brand-fallback{color:var(--navy);font:bold 27px "Segoe UI",Arial,sans-serif;text-align:center}.side-title{font-size:15px;font-weight:700;margin:15px 0 2px}.side-subtitle{font-size:11px;opacity:.78;margin:0 0 27px}.side-label{font-size:10px;letter-spacing:.12em;font-weight:700;opacity:.56;margin:10px 9px}.menu{display:grid;gap:4px}.menu button{appearance:none;border:0;background:transparent;color:#fff;text-align:left;padding:10px;border-radius:5px;font:600 12px "Segoe UI",Arial,sans-serif;cursor:pointer}.menu button:hover,.menu button.active{background:rgba(255,255,255,.2);border-left:3px solid #fff;padding-left:7px}.side-footer{margin-top:auto;border-top:1px solid rgba(255,255,255,.15);padding-top:15px;font-size:10px;opacity:.72}.main{min-width:0}.topbar{min-height:63px;padding:13px max(24px,4vw);background:linear-gradient(105deg,#102061,#3154c4);color:#fff;display:flex;align-items:center;justify-content:space-between;gap:16px}.topbar h1{margin:0;font-size:18px}.topbar p{margin:2px 0 0;font-size:11px;opacity:.75}.competencia-selo{background:rgba(255,255,255,.16);border-radius:20px;padding:7px 14px;font-size:11px;font-weight:700;white-space:nowrap}.content{max-width:1320px;margin:0 auto;padding:18px 28px 35px}.filterbar{background:#fff;border-bottom:1px solid var(--line);box-shadow:0 1px 4px rgba(26,54,109,.05);padding:11px 28px}.filters{max-width:1320px;margin:auto;display:flex;gap:10px;align-items:end}.filter-field{min-width:120px}.filter-field label{display:block;text-transform:uppercase;font-size:9px;color:#707b93;font-weight:700;margin:0 0 4px}.filter-field select{width:100%;border:1px solid #dce5f0;background:#f7faff;border-radius:6px;padding:8px;color:#26314a;font-weight:600;font-size:12px}.clear{margin-left:auto;background:#fff;border:1px solid var(--line);border-radius:18px;padding:7px 12px;color:#63708a;font-size:11px;cursor:pointer}.contexto{font-size:11px;color:#6f7890;margin:0 0 14px}.metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.metric{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:14px;min-height:94px;box-shadow:0 2px 6px rgba(26,54,109,.06)}.metric.primary{border-left:3px solid var(--blue)}.metric-label{text-transform:uppercase;letter-spacing:.08em;font-size:9px;font-weight:700;color:#75809a}.metric b{display:block;font:600 29px/1.15 "Segoe UI",Arial,sans-serif;color:#405486;margin:8px 0 4px}.metric small{color:var(--muted);font-size:11px}.metric small.positive{color:var(--green);font-weight:700}.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:14px}.panel{background:var(--card);border:1px solid var(--line);border-radius:8px;box-shadow:0 2px 6px rgba(26,54,109,.06);overflow:hidden;scroll-margin-top:15px}.panel-head{padding:13px 16px;border-bottom:1px solid var(--line);font-weight:700;font-size:14px;display:flex;justify-content:space-between;align-items:center}.panel-body{padding:16px}.legend{font-size:10px;color:var(--muted);font-weight:500}.legend i{display:inline-block;width:9px;height:9px;border-radius:2px;background:var(--blue);margin:0 4px 0 8px}.legend i:first-child{margin-left:0;background:#dbe4f2}.bars{display:grid;gap:13px}.bar-row .bar-info{display:flex;justify-content:space-between;gap:8px;font-size:12px;margin-bottom:5px}.bar-row .bar-info span:last-child{font-size:11px;color:#5b667c}.track{height:9px;background:#dfe7f3;border-radius:2px;overflow:hidden}.fill{height:100%;background:linear-gradient(90deg,#355fc9,#3155bb);border-radius:2px}.evolucao{height:235px;display:flex;align-items:end;gap:8px;padding:15px 5px 0;border-bottom:1px solid #dce4ee}.evo-item{height:100%;flex:1;display:flex;flex-direction:column;justify-content:end;align-items:center;gap:5px;min-width:22px}.evo-value{font-size:10px;font-weight:700;color:#45577f}.evo-bar{width:100%;max-width:38px;background:linear-gradient(180deg,#6f8ce1,#3157bf);border-radius:4px 4px 0 0;min-height:3px}.evo-label{font-size:9px;color:#7b8498;white-space:nowrap}.note{font-size:11px;color:#64718a;margin:11px 0 0}.full{margin-top:14px}.table-wrap{overflow:auto}table{width:100%;border-collapse:collapse;min-width:1000px;font-size:12px}th{background:#f7f9fc;color:#68738d;text-transform:uppercase;letter-spacing:.04em;font-size:9px;text-align:left;padding:10px;border-bottom:1px solid var(--line);white-space:normal;line-height:1.2}td{padding:9px 10px;border-bottom:1px solid #e7edf4}tbody tr:nth-child(even){background:#fbfcfe}.pending-row{background:#fffaf0!important}.badge{display:inline-block;border-radius:10px;padding:2px 7px;font-size:10px;font-weight:700}.b-ok{background:#e7f5ee;color:#17724f}.b-pending{background:#fff1d7;color:#9c620b}.b-err{background:#fde8ea;color:#a52f3c}.priority{background:#fffaf0;border-left:3px solid #d39a2a;padding:11px 13px;margin:0 0 13px;font-size:11px}.unit-summary{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px;margin-bottom:14px}.unit-summary div{background:#f4f7fb;border:1px solid #e0e7f0;border-radius:5px;padding:9px}.unit-summary span{display:block;color:#66718a;font-size:10px}.unit-summary b{font-size:18px}.zero-list{margin:0;padding-left:18px}.zero-list li{margin:0 0 9px;font-size:12px}.zero-list small{color:#66718a}.empty{color:var(--muted);margin:0}.analysis-note{background:#f5f8fd;border-left:3px solid var(--blue);padding:10px 12px;margin:0 0 14px;color:#53617a;font-size:11px}.group-small{font-size:10px;color:#75809a}@media(max-width:1050px){.layout{grid-template-columns:190px 1fr}.metrics,.unit-summary{grid-template-columns:repeat(2,1fr)}.filters{flex-wrap:wrap}.clear{margin-left:0}.grid{grid-template-columns:1fr}}@media(max-width:720px){.layout{grid-template-columns:1fr}.sidebar{display:none}.content{padding:14px}.filterbar{padding:10px 14px}.topbar{padding:12px 14px}.metrics,.unit-summary{grid-template-columns:1fr 1fr}.competencia-selo{display:none}}
.last-run{background:#e7eefb;border:1px solid #cbd9ef;border-left:4px solid var(--blue);border-radius:7px;padding:11px 14px;margin:0 0 14px;display:flex;justify-content:space-between;gap:12px;align-items:center}.last-run strong{color:#213f75}.last-run small{color:#61708c}.status-board{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:14px}.status-card{background:#fff;border:1px solid var(--line);border-radius:8px;padding:14px}.status-card h3{margin:0 0 7px;font-size:12px}.status-card p{margin:0;color:#5f6d86;font-size:11px;line-height:1.65}.status-ok{border-left:4px solid #2e8b65}.status-pending{border-left:4px solid #d49525}.status-missing{border-left:4px solid #b74b58}.status-error{border-left:4px solid #7a6f87}.history-list{font-size:11px;color:#5d6b84;max-width:360px}.history-highlight{font-weight:700;color:#8a4e00}.metric.good{border-left:3px solid #2e8b65}.metric.warn{border-left:3px solid #d49525}.metric.bad{border-left:3px solid #b74b58}.definitions{margin-top:14px}.definitions-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.definition{background:#eef5ff;border:1px solid #d4e3f7;border-radius:7px;padding:12px}.definition b{display:block;color:#203d74;margin-bottom:4px}.cat{display:inline-block;border-radius:12px;padding:3px 8px;font-size:10px;font-weight:700;margin:2px}.cat-geral{background:#e4edff;color:#2452a5}.cat-maternidade{background:#f5e5f3;color:#8b347e}.cat-pediatria{background:#dff4ef;color:#14705f}.cat-psiquiatria{background:#fff0d9;color:#985d09}.unit-chip{display:inline-flex;align-items:center;gap:5px;border:1px solid var(--line);border-radius:14px;padding:2px 7px;margin:2px;background:#fff;font-size:10px}.zero-card{border:1px solid var(--line);border-left:4px solid var(--blue);border-radius:8px;padding:14px;margin:0 0 12px;background:#fff}.zero-card h3{margin:0 0 10px}.zero-card details{border-top:1px solid #e5ebf3;padding:9px 0}.zero-card summary{cursor:pointer}.state-ok{color:var(--green);font-weight:700}.state-diff{color:var(--red);font-weight:700}.state-empty{color:var(--amber);font-weight:700}.meta-ok{background:#e7f5ee;color:#17724f}.meta-bad{background:#fde8ea;color:#a52f3c}.meta-none{background:#eef1f6;color:#66718a}.source-note{font-size:10px;color:#6b7890}.history-cells{display:flex;flex-wrap:wrap;max-width:360px}.center-table td:not(:nth-child(4)),.center-table th:not(:nth-child(4)){text-align:center}@media(max-width:900px){.definitions-grid{grid-template-columns:1fr}}@media(max-width:720px){.status-board{grid-template-columns:1fr}.last-run{align-items:flex-start;flex-direction:column}}
.filterbar{position:sticky;top:0;z-index:30}.filter-field:has(#competencia),.indicator-field{display:none}.table-wrap{max-height:72vh}.table-wrap thead th{position:sticky;top:0;z-index:4;background:#eef3fa}.pivot-table{width:max-content;min-width:100%}.pivot-table thead tr:first-child th{top:0;z-index:8}.pivot-table thead tr:nth-child(2) th{top:31px;z-index:7}.pivot-table th.month-head{text-align:center;background:#263f75;color:#fff;border-right:2px solid #94a8c7}.pivot-table th.sub-head{text-align:center;background:#e8eef8;color:#33476f}.pivot-table thead tr:nth-child(2) th:nth-child(3n){border-right:2px solid #c4d0e3}.pivot-table tbody td:nth-child(3n + 1){border-right:2px solid #c4d0e3}.pivot-table td{text-align:center;white-space:nowrap}.pivot-table td.unit-col,.pivot-table th.unit-col{position:sticky;left:0;z-index:5;background:#fff;text-align:left;min-width:230px}.pivot-table th.unit-col{z-index:10;background:#263f75;color:#fff}.macro-summary{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:14px}.macro-card{background:#fff;border:1px solid var(--line);border-top:4px solid var(--blue);border-radius:8px;padding:14px}.macro-card h3{margin:0 0 10px}.macro-card dl{display:grid;grid-template-columns:1fr auto;gap:5px;margin:0}.macro-card dt{color:#66718a}.macro-card dd{margin:0;font-weight:700}.history-cards{display:grid;gap:12px}.history-card{border:1px solid var(--line);border-left:4px solid var(--blue);border-radius:8px;padding:14px;background:#fff}.history-card-head{display:flex;justify-content:space-between;gap:12px;margin-bottom:10px}.history-metrics{display:grid;grid-template-columns:repeat(5,1fr);gap:8px}.history-metrics div{background:#f4f7fb;border-radius:6px;padding:8px}.history-metrics span{display:block;font-size:10px;color:#68748c}.history-metrics b{font-size:18px}.history-groups{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:10px}.history-groups div{border-top:1px solid var(--line);padding-top:8px}.indicator-field{min-width:260px;flex:1}.indicator-local{margin:0 0 14px;max-width:610px}.indicator-local label{display:block;text-transform:uppercase;font-size:10px;font-weight:700;color:#66718a;margin-bottom:5px}.indicator-local select{width:100%;padding:9px;border:1px solid #dce5f0;border-radius:6px;background:#f7faff;color:#26314a;font-weight:600}.category-row td{background:#eaf0fb!important;color:#203f76;font-weight:700;text-align:left;padding:8px 10px}.unverified{background:#f0f2f6;color:#5f6879}.b-neutral{background:#edf0f5;color:#596478}@media(max-width:900px){.macro-summary,.history-groups{grid-template-columns:1fr}.history-metrics{grid-template-columns:repeat(2,1fr)}}
.grafico-indicador{min-height:260px;border:1px solid var(--line);border-radius:8px;padding:18px;background:#fbfcff}.grafico-barras{height:210px;display:flex;align-items:end;gap:12px;border-bottom:1px solid #cfd9e8;padding:0 8px}.barra-grafico{min-width:48px;flex:1;height:100%;display:flex;flex-direction:column;justify-content:end;align-items:center;gap:6px}.barra-grafico i{display:block;width:min(48px,100%);background:linear-gradient(180deg,#6f8ce1,#3157bf);border-radius:5px 5px 0 0}.barra-grafico b{font-size:11px}.barra-grafico small{font-size:10px;color:#64718a;white-space:nowrap}</style></head><body><div class="layout">
<aside class="sidebar"><div class="brand">${logo ? `<img src="data:image/png;base64,${logo}" alt="Prefeitura do Rio - Sa&uacute;de - SUBHUE - DQE">` : '<div class="brand-fallback">PREFEITURA<br>RIO<br><small>Sa&uacute;de</small></div>'}</div><div class="side-title">Painel Macroindicadores</div><p class="side-subtitle">SMS Rio &middot; acompanhamento de dados e indicadores</p><div class="side-label">AN&Aacute;LISES</div><nav class="menu"><button class="active" data-view="resumo">Resumo executivo</button><button data-view="pendencias">Unidades e pend&ecirc;ncias</button><button data-view="consolidado">Consolidado mensal por unidade</button><button data-view="indicadores">Comparativo por indicador</button><button data-view="unidade-indicadores">Comparativo por unidade</button><button data-view="dados-sms">Dados SMS Rio</button><button data-view="dados-planilha">Dados Google Sheets</button><button data-view="divergencias">Diverg&ecirc;ncias: Sheets x SMS Rio</button><button data-view="zerados">Indicadores zerados</button><button data-view="historico">Hist&oacute;rico de execu&ccedil;&otilde;es</button></nav><div class="side-footer">SUBHUE &middot; DQE &mdash; Dados e Indicadores<br>Painel atualizado a cada execu&ccedil;&atilde;o</div></aside>
<main class="main"><header class="topbar"><div><h1>Macroindicadores</h1><p>Situa&ccedil;&atilde;o da compet&ecirc;ncia, pend&ecirc;ncias e indicadores por unidade</p></div><div class="competencia-selo" id="selo">Todas as compet&ecirc;ncias</div></header>
<section class="filterbar"><div class="filters"><div class="filter-field"><label>Compet&ecirc;ncia</label><select id="competencia"></select></div><div class="filter-field"><label>Ano</label><select id="ano"></select></div><div class="filter-field"><label>M&ecirc;s</label><select id="mes"></select></div><div class="filter-field"><label>Categoria</label><select id="categoria"></select></div><div class="filter-field"><label>Unidade</label><select id="unidade"></select></div><div class="filter-field indicator-field"><label>Indicador</label><select id="indicador"></select></div><button class="clear" id="limpar">Limpar filtros</button></div></section>
<div class="content"><div class="last-run" id="ultima-execucao"><span><strong>&Uacute;ltima verifica&ccedil;&atilde;o:</strong> aguardando dados...</span></div><p class="contexto" id="contexto">Carregando dados...</p><section class="metrics"><div class="metric primary"><div class="metric-label">Unidades previstas</div><b id="m-unidades">0</b><small>registros de unidade/categoria solicitados</small></div><div class="metric good"><div class="metric-label">Com dados lan&ccedil;ados</div><b id="m-lancadas">0</b><small>compet&ecirc;ncia localizada no SMS Rio</small></div><div class="metric warn"><div class="metric-label">Pendentes de preenchimento</div><b id="m-pend-preench">0</b><small>unidade localizada, mas o m&ecirc;s ainda n&atilde;o existe</small></div><div class="metric bad"><div class="metric-label">N&atilde;o localizadas no SMS Rio</div><b id="m-nao-localizadas">0</b><small>nome da unidade n&atilde;o encontrado na plataforma</small></div><div class="metric"><div class="metric-label">Erros t&eacute;cnicos</div><b id="m-erros-tecnicos">0</b><small>falha de rede, login, arquivo, Google ou verifica&ccedil;&atilde;o</small></div><div class="metric"><div class="metric-label">Unidades com altera&ccedil;&atilde;o detectada</div><b id="m-unidades-alteradas">0</b><small>diferen&ccedil;a encontrada antes de eventual atualiza&ccedil;&atilde;o</small></div><div class="metric"><div class="metric-label">Diverg&ecirc;ncias atuais SMS Rio x Google Sheets</div><b id="m-div">0</b><small>situa&ccedil;&atilde;o verificada ao final da execu&ccedil;&atilde;o</small></div><div class="metric"><div class="metric-label">Indicadores zerados no SMS Rio</div><b id="m-zeros">0</b><small>podem ser pend&ecirc;ncia ou n&atilde;o aplic&aacute;veis</small></div></section><section class="status-board"><article class="status-card status-ok"><h3>Unidades com dados lan&ccedil;ados</h3><p id="lista-ok">&mdash;</p></article><article class="status-card status-pending"><h3>Pendentes de preenchimento</h3><p id="lista-pendentes">&mdash;</p></article><article class="status-card status-missing"><h3>N&atilde;o localizadas no SMS Rio</h3><p id="lista-nao-localizadas">&mdash;</p></article><article class="status-card status-error"><h3>Erros t&eacute;cnicos</h3><p id="lista-erros">&mdash;</p></article></section><section class="panel definitions"><div class="panel-head">Como interpretar o resumo <span id="marco-fechamento"></span></div><div class="panel-body definitions-grid"><div class="definition"><b>Pendente de preenchimento</b>A unidade foi localizada, mas a compet&ecirc;ncia solicitada ainda n&atilde;o aparece no SMS Rio.</div><div class="definition"><b>N&atilde;o localizada no SMS Rio</b>O rob&ocirc; n&atilde;o encontrou o nome configurado da unidade dentro da categoria selecionada.</div><div class="definition"><b>Erro t&eacute;cnico</b>A consulta n&atilde;o terminou por falha operacional; n&atilde;o significa falta de preenchimento.</div></div></section>
<section class="grid"><article class="panel"><div class="panel-head">Pend&ecirc;ncias por categoria <span class="legend"><i></i>Poss&iacute;veis pend&ecirc;ncias</span></div><div class="panel-body"><div class="bars" id="barras"></div><p class="note">Indicadores que est&atilde;o em zero, mas apresentaram valor diferente de zero em algum dos seis meses anteriores.</p></div></article><article class="panel"><div class="panel-head">Evolu&ccedil;&atilde;o por compet&ecirc;ncia <span class="legend"><i></i>Pend&ecirc;ncias</span></div><div class="panel-body"><div class="evolucao" id="evolucao"></div><p class="note">As barras mostram as poss&iacute;veis pend&ecirc;ncias nas compet&ecirc;ncias dispon&iacute;veis no hist&oacute;rico do rob&ocirc;.</p></div></article></section>
<section class="panel full"><div class="panel-head">Resumo por unidade <span class="legend">Total de indicadores &middot; Compet&ecirc;ncia atual &middot; Zerados &middot; Pend&ecirc;ncias &middot; Divergentes</span></div><div class="panel-body"><p class="analysis-note"><strong>Legenda:</strong> Compet&ecirc;ncia atual = dados existentes no SMS Rio onde a c&eacute;lula estava vazia. Indicadores divergentes = valor do SMS Rio diferente do valor que j&aacute; constava na planilha. Poss&iacute;veis pend&ecirc;ncias = indicador zerado agora, mas com valor diferente de zero no hist&oacute;rico.</p></div><div class="table-wrap"><table><thead><tr><th>Compet&ecirc;ncia</th><th>Categoria</th><th>Sigla</th><th>Unidade</th><th>Status da execu&ccedil;&atilde;o</th><th>Total de indicadores</th><th>Compet&ecirc;ncia atual</th><th>Indicadores zerados</th><th>Poss&iacute;veis pend&ecirc;ncias</th><th>Indicadores divergentes</th></tr></thead><tbody id="corpo"></tbody></table></div></section>
<section class="panel full"><div class="panel-head">Diverg&ecirc;ncias atuais &middot; SMS Rio x Google Sheets</div><div class="panel-body"><p class="analysis-note"><strong>Estado ao final da execu&ccedil;&atilde;o.</strong> Uma diverg&ecirc;ncia significa que o valor existente no Google Sheets &eacute; diferente do SMS Rio. Em modo atualizar, a fotografia anterior permanece no hist&oacute;rico de altera&ccedil;&otilde;es, mas deixa de aparecer aqui depois que a verifica&ccedil;&atilde;o confirma a grava&ccedil;&atilde;o.</p><div class="table-wrap"><table><thead><tr><th>Compet&ecirc;ncia</th><th>Categoria</th><th>Sigla</th><th>Indicador</th><th>Grupo</th><th>Google Sheets</th><th>SMS Rio</th><th>Capturado em</th></tr></thead><tbody id="corpo-divergencias"></tbody></table></div></div></section>
<section class="panel full"><div class="panel-head">Indicadores zerados &middot; an&aacute;lise por unidade</div><div class="panel-body"><p class="analysis-note">Selecione uma <strong>unidade</strong> no filtro superior. Os indicadores s&atilde;o separados por compet&ecirc;ncia e o nome do indicador aparece em destaque. O grupo fica resumido apenas como apoio.</p><div id="analise-unidade"></div></div></section>
<section class="panel full"><div class="panel-head">Hist&oacute;rico das execu&ccedil;&otilde;es</div><div class="panel-body"><p class="analysis-note">Cada linha &eacute; uma fotografia da execu&ccedil;&atilde;o: quando foi realizada, quantas unidades tinham lan&ccedil;ado a compet&ecirc;ncia, quais estavam pendentes e quais apresentaram altera&ccedil;&otilde;es em rela&ccedil;&atilde;o &agrave; planilha.</p><div class="table-wrap"><table><thead><tr><th>Data e hor&aacute;rio</th><th>Compet&ecirc;ncia</th><th>Modo</th><th>Solicitadas</th><th>Com dados</th><th>Pendentes</th><th>N&atilde;o localizadas</th><th>Erros</th><th>Unidades alteradas</th><th>Altera&ccedil;&otilde;es hist&oacute;ricas</th></tr></thead><tbody id="corpo-historico"></tbody></table></div></div></section>
<section class="panel full"><div class="panel-head">Consolidado por unidade</div><div class="panel-body"><p class="analysis-note">Uma linha por unidade, categoria e compet&ecirc;ncia. <strong>Dados Google Sheets</strong> indica se a coluna possui ao menos um valor; <strong>Dados SMS Rio</strong> indica se a compet&ecirc;ncia foi localizada; a diverg&ecirc;ncia compara as duas fontes no fim da execu&ccedil;&atilde;o.</p><div class="table-wrap"><table class="center-table"><thead><tr><th>Compet&ecirc;ncia</th><th>Categoria</th><th>Sigla</th><th>Unidade</th><th>Dados Google Sheets</th><th>Dados SMS Rio</th><th>Indic. diverg. SMS x planilha</th><th>Alterações detectadas</th><th>Última captura</th></tr></thead><tbody id="corpo-consolidado"></tbody></table></div></div></section>
<section class="panel full"><div class="panel-head">Consolidado por indicador</div><div class="panel-body"><p class="analysis-note">Comparativo mensal por indicador. As metas s&atilde;o avaliadas pelo valor do SMS Rio: perman&ecirc;ncia hospitalar conforme a unidade; parto ces&aacute;reo &le; 37%; perman&ecirc;ncia em UTI Neonatal &le; 9,8 dias.</p><div class="indicator-local"><label for="indicador-local">Indicador para comparar</label><select id="indicador-local"></select></div><div class="table-wrap"><table id="tabela-indicadores"><thead><tr><th>Compet&ecirc;ncia</th><th>Categoria</th><th>Sigla</th><th>Indicador</th><th>Grupo</th><th>Valor Google Sheets</th><th>Valor SMS Rio</th><th>Confer&ecirc;ncia</th><th>Meta</th><th>Resultado da meta</th></tr></thead><tbody id="corpo-indicadores"></tbody></table></div></div></section>
<section class="panel full"><div class="panel-head">Comparativo por unidade</div><div class="panel-body"><p class="analysis-note">Use a <strong>Unidade</strong> escolhida no filtro superior para comparar todos os seus indicadores ao longo dos meses: Google Sheets, SMS Rio e situa&ccedil;&atilde;o de confer&ecirc;ncia.</p><select id="unidade-local" hidden></select><div class="table-wrap"><table id="tabela-unidade"><tbody id="corpo-unidade"></tbody></table></div></div></section>
<section class="panel full"><div class="panel-head">Dados SMS Rio</div><div class="panel-body"><p class="analysis-note">Todos os indicadores da unidade escolhida no filtro superior, apresentados como no relatório mensal da plataforma SMS Rio.</p><div class="table-wrap"><table id="tabela-sms"><tbody id="corpo-sms"></tbody></table></div></div></section>
<section class="panel full"><div class="panel-head">Dados Google Sheets</div><div class="panel-body"><p class="analysis-note">Todos os indicadores da unidade escolhida no filtro superior, apresentados conforme registrados no Google Sheets.</p><div class="table-wrap"><table id="tabela-planilha"><tbody id="corpo-planilha"></tbody></table></div></div></section>
</div></main></div>
<script>
const D=${seguroJson(dados)},E=${seguroJson(execucoes)};const q=id=>document.getElementById(id);const meses=['','Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const h=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const uniq=a=>[...new Set(a)].sort();function opts(id,valores,rotulo){q(id).innerHTML='<option value="">'+rotulo+'</option>'+valores.map(v=>'<option value="'+h(v.valor)+'">'+h(v.texto)+'</option>').join('')}
opts('competencia',uniq(D.map(x=>x.competencia)).reverse().map(x=>({valor:x,texto:x})),'Todas');opts('ano',uniq(D.map(x=>x.ano)).reverse().map(x=>({valor:x,texto:x})),'Todos');opts('mes',Array.from({length:12},(_,i)=>({valor:i+1,texto:meses[i+1]})),'Todos');opts('categoria',uniq(D.map(x=>x.categoria)).map(x=>({valor:x,texto:x})),'Todas');const unidadesFiltro=Object.values(Object.fromEntries(D.map(x=>[x.sigla,x]))).sort((a,b)=>a.sigla.localeCompare(b.sigla));opts('unidade',unidadesFiltro.map(x=>({valor:x.sigla,texto:x.sigla+' — '+x.unidade})),'Todas');
function soma(a,c){return a.reduce((t,x)=>t+(Number(x[c])||0),0)}function filtro(){return D.filter(x=>(!q('competencia').value||x.competencia===q('competencia').value)&&(!q('ano').value||x.ano==q('ano').value)&&(!q('mes').value||x.mes==q('mes').value)&&(!q('categoria').value||x.categoria===q('categoria').value)&&(!q('unidade').value||x.sigla===q('unidade').value))}
function status(x){const estado=typeof x==='string'?x:x.status;const erro=typeof x==='string'?'':x.erro;if(estado==='ATUALIZADO_E_VERIFICADO')return '<span class="badge b-ok">Atualizado e verificado</span>';if(estado==='ZERADOS_ATUALIZADOS_E_VERIFICADOS')return '<span class="badge b-ok">Zeros atualizados</span>';if(estado==='CONFERIDO_SEM_ALTERAR'||estado==='CONFERIDO_HISTORICO')return '<span class="badge b-ok">Conferido</span>';if(estado==='DADOS_COLETADOS_VERIFICAR')return '<span class="badge b-pending" title="'+h(erro)+'">Dados coletados &mdash; verificar</span>';if(estado==='MES_NAO_DISPONIVEL_SMSRIO')return '<span class="badge b-pending">Sem compet&ecirc;ncia</span>';return '<span class="badge b-err" title="'+h(erro)+'">Erro na execu&ccedil;&atilde;o</span>'}
const norm=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();const naoLocalizada=x=>{const e=norm(x.erro);return x.status==='ERRO_SEM_ATUALIZAR'&&(e.includes('nenhum resultado')||e.includes('nao encontrad')||e.includes('esperado 1 resultado'))};const dataHora=v=>new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'medium'}).format(new Date(v));
const catClass=c=>'cat-'+norm(c).replaceAll(' ','-');const catBadge=c=>'<span class="cat '+catClass(c)+'">'+h(c)+'</span>';const unidadeChip=x=>'<span class="unit-chip">'+catBadge(x.categoria)+' <b>'+h(x.sigla)+'</b></span>';const siglas=a=>a.length?a.map(x=>typeof x==='string'?chipTexto(x):unidadeChip(x)).join(' '):'Nenhuma';function chipTexto(v){const [categoria,...resto]=String(v).split(':');return '<span class="unit-chip">'+catBadge(categoria.trim())+' <b>'+h(resto.join(':').trim())+'</b></span>'}
function marco(comp){if(!/^\d{4}-\d{2}$/.test(comp||''))return '';const [a,m]=comp.split('-').map(Number);const fechamento=new Date(a,m,10,23,59,59);const encerrado=new Date()>=fechamento;return '<span class="badge '+(encerrado?'b-ok':'b-pending')+'">Marco mensal: '+(encerrado?'fechado em ':'fecha em ')+new Intl.DateTimeFormat('pt-BR').format(fechamento)+'</span>'}
const preenchido=v=>!(v===''||v===null||v===undefined);const numerico=v=>{if(typeof v==='number')return v;const n=Number(String(v??'').replace('%','').replace(',','.'));return Number.isFinite(n)?n:null};function formatarValor(campo,valor){if(!preenchido(valor))return '—';const n=numerico(valor),nome=norm(campo);if(n===null)return String(valor);if(nome.includes('duracao de utilizacao do centro cirurgico')){const minutos=Math.round(n*60);return Math.floor(minutos/60)+'h'+String(minutos%60).padStart(2,'0')}if(nome.includes('taxa')||nome.includes('percentual')||nome.includes('parto cesareo')){const percentual=n<=1?n*100:n;return percentual.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})+'%'}return n.toLocaleString('pt-BR',{maximumFractionDigits:2})}const mesmo=(a,b)=>preenchido(a)&&preenchido(b)&&Math.abs(Number(a)-Number(b))<1e-9;
const hospital85=new Set(['HMMC','HMLJ','HMSA','HMRF','HMSF','HMAS','HMPII','HMEF','HFCF','HFA']);const hospital74=new Set(['HMFST','HMP','HMBR','HMRM','HMRG','HMJ','HMNSL']);
function metaIndicador(campo,sigla){const n=norm(campo);if(n.includes('tempo medio de permanencia')&&n.includes('hospitalar')){if(hospital85.has(sigla))return {limite:8.5,rotulo:'≤ 8,5 dias'};if(hospital74.has(sigla))return {limite:7.4,rotulo:'≤ 7,4 dias'}}if(n==='cesareo'||n.includes('parto cesareo'))return {limite:.37,rotulo:'≤ 37%'};if(n.includes('tempo medio de permanencia')&&(n.includes('uti neonatal')||n.includes('utin')))return {limite:9.8,rotulo:'≤ 9,8 dias'};return null}
function metaResultado(campo,sigla,valor){const m=metaIndicador(campo,sigla),n=numerico(valor);if(!m)return ['Sem meta','meta-none','—'];if(n===null)return ['Sem valor','meta-none',m.rotulo];const ajustado=m.limite===.37&&n>1?n/100:n;return ajustado<=m.limite?['Meta atingida','meta-ok',m.rotulo]:['Meta não atingida','meta-bad',m.rotulo]}
function render(){const f=filtro(),comp=q('competencia').value;const contexto=[q('ano').value||'Todos os anos',q('mes').value?meses[q('mes').value]:'todos os meses',q('categoria').value||'todas as categorias'].join(' &middot; ');const lancadas=f.filter(x=>x.possuiDados&&x.status!=='MES_NAO_DISPONIVEL_SMSRIO');const pendentes=f.filter(x=>x.status==='MES_NAO_DISPONIVEL_SMSRIO');const naoLocalizadas=f.filter(naoLocalizada);const erros=f.filter(x=>(x.status==='ERRO_SEM_ATUALIZAR'||x.status==='DADOS_COLETADOS_VERIFICAR')&&!naoLocalizada(x));const alteradas=f.filter(x=>x.alteracoesEncontradas>0);const unicas=new Set(f.map(x=>x.sigla)).size;q('contexto').innerHTML=f.length+' registros de unidade/categoria ('+unicas+' siglas distintas) &middot; '+contexto;q('selo').textContent=comp||'Todas as compet&ecirc;ncias';q('marco-fechamento').innerHTML=marco(comp||(f[0]?.competencia||''));q('m-unidades').textContent=f.length;q('m-lancadas').textContent=lancadas.length;q('m-pend-preench').textContent=pendentes.length;q('m-nao-localizadas').textContent=naoLocalizadas.length;q('m-erros-tecnicos').textContent=erros.length;q('m-unidades-alteradas').textContent=alteradas.length;q('m-zeros').textContent=soma(f,'zerados');q('m-div').textContent=soma(f,'divergentes');q('lista-ok').innerHTML=siglas(lancadas);q('lista-pendentes').innerHTML=siglas(pendentes);q('lista-nao-localizadas').innerHTML=siglas(naoLocalizadas);q('lista-erros').innerHTML=siglas(erros);
const ef=E.filter(x=>(!q('competencia').value||x.competencia===q('competencia').value)&&(!q('ano').value||x.ano==q('ano').value)&&(!q('mes').value||x.mes==q('mes').value));const ultima=ef[0]||E[0];q('ultima-execucao').innerHTML=ultima?'<span><strong>&Uacute;ltima verifica&ccedil;&atilde;o:</strong> '+dataHora(ultima.fim)+' &middot; compet&ecirc;ncia '+h(ultima.competencia)+' &middot; modo '+h(ultima.modo)+'</span><small>'+ultima.lancadas+' de '+ultima.solicitadas+' registros de unidade/categoria com dados lan&ccedil;ados</small>':'<span><strong>Nenhuma execu&ccedil;&atilde;o registrada.</strong></span>';q('corpo-historico').innerHTML=ef.length?ef.map(x=>'<tr><td>'+dataHora(x.fim)+'</td><td>'+h(x.competencia)+'<br>'+marco(x.competencia)+'</td><td>'+h(x.modo)+'</td><td><b>'+x.solicitadas+'</b><div class="source-note">registros de unidade/categoria solicitados</div></td><td>'+x.lancadas+'</td><td><span class="history-highlight">'+x.semCompetencia+'</span><div class="history-cells">'+siglas(x.unidadesSemCompetencia)+'</div></td><td>'+x.naoLocalizadas+'<div class="history-cells">'+siglas(x.unidadesNaoLocalizadas)+'</div></td><td>'+x.errosTecnicos+'<div class="history-cells">'+siglas(x.unidadesComErro)+'</div></td><td><div class="history-cells">'+siglas(x.unidadesAlteradas)+'</div><div class="history-list">'+x.indicadoresDivergentes+' altera&ccedil;&atilde;o(&otilde;es) detectada(s) antes da atualiza&ccedil;&atilde;o</div></td><td><div class="history-cells">'+siglas(x.unidadesAlteradasHistorico)+'</div></td></tr>').join(''):'<tr><td colspan="10" class="empty">Nenhuma execu&ccedil;&atilde;o encontrada para o per&iacute;odo.</td></tr>';
const porCat={};f.forEach(x=>porCat[x.categoria]=(porCat[x.categoria]||0)+x.pendencias);const cat=Object.entries(porCat).sort((a,b)=>b[1]-a[1]);const max=Math.max(1,...cat.map(x=>x[1]));q('barras').innerHTML=cat.length?cat.map(([nome,v])=>'<div class="bar-row"><div class="bar-info"><strong>'+h(nome)+'</strong><span><b>'+v+'</b> poss&iacute;veis pend&ecirc;ncias</span></div><div class="track"><div class="fill" style="width:'+Math.max(2,v/max*100)+'%"></div></div></div>').join(''):'<p class="empty">Sem dados para os filtros escolhidos.</p>';
const porComp={};f.forEach(x=>porComp[x.competencia]=(porComp[x.competencia]||0)+x.pendencias);const comps=Object.entries(porComp).sort((a,b)=>a[0].localeCompare(b[0]));const maxComp=Math.max(1,...comps.map(x=>x[1]));q('evolucao').innerHTML=comps.length?comps.map(([nome,v])=>'<div class="evo-item"><span class="evo-value">'+v+'</span><div class="evo-bar" style="height:'+Math.max(3,v/maxComp*180)+'px"></div><span class="evo-label">'+h(nome.slice(5))+'/'+h(nome.slice(2,4))+'</span></div>').join(''):'<p class="empty">Sem compet&ecirc;ncias para exibir.</p>';
q('corpo').innerHTML=f.map(x=>'<tr class="'+(x.pendencias?'pending-row':'')+'"><td>'+h(x.competencia)+'</td><td>'+catBadge(x.categoria)+'</td><td>'+h(x.sigla)+'</td><td>'+h(x.unidade)+'</td><td>'+status(x.status)+'</td><td>'+x.total+'</td><td>'+x.competenciaAtual+'</td><td>'+x.zerados+'</td><td>'+x.pendencias+'</td><td>'+x.divergentes+'</td></tr>').join('')||'<tr><td colspan="10" class="empty">Nenhuma unidade encontrada.</td></tr>';
const divergencias=D.flatMap(x=>(x.detalhesDivergencias||[]).map(i=>({...i,competencia:x.competencia,categoria:x.categoria,sigla:x.sigla,executadoEm:x.executadoEm})));q('corpo-divergencias').innerHTML=divergencias.length?divergencias.sort((a,b)=>b.competencia.localeCompare(a.competencia)||a.sigla.localeCompare(b.sigla)).map(i=>'<tr><td>'+h(i.competencia)+'</td><td>'+catBadge(i.categoria)+'</td><td>'+h(i.sigla)+'</td><td><strong>'+h(i.campo)+'</strong></td><td class="group-small">'+h(i.grupo)+'</td><td>'+h(i.planilha)+'</td><td><strong>'+h(i.smsRio)+'</strong></td><td>'+dataHora(i.executadoEm)+'</td></tr>').join(''):'<tr><td colspan="8" class="empty">Nenhuma diverg&ecirc;ncia atual entre o Google Sheets e o SMS Rio.</td></tr>';
const escolhido=q('unidade').value;const destino=q('analise-unidade');if(!escolhido){const prioritarias=f.filter(x=>x.divergentes||x.pendencias||x.status==='DADOS_COLETADOS_VERIFICAR');destino.innerHTML='<div class="priority"><strong>Como usar:</strong> selecione uma sigla no filtro Unidade para ver os indicadores daquela unidade. '+(prioritarias.length?'Unidades que merecem aten&ccedil;&atilde;o neste recorte: <strong>'+prioritarias.map(x=>h(x.sigla)).join(', ')+'</strong>.':'Nenhuma pend&ecirc;ncia ou diverg&ecirc;ncia encontrada neste recorte.')+'</div>'}else{const diverg=f.flatMap(x=>(x.detalhesDivergencias||[]).map(i=>({...i,competencia:x.competencia})));const zeros=f.flatMap(x=>(x.detalhesZeros||[]).map(i=>({...i,competencia:x.competencia})));const primeiro=f[0];const reduzir=g=>String(g||'').length>24?String(g).slice(0,21)+'...':String(g||'');const rot={POSSIVEL_PENDENCIA:['Poss&iacute;vel pend&ecirc;ncia','b-pending'],POSSIVEL_NAO_APLICAVEL:['Poss&iacute;vel n&atilde;o aplic&aacute;vel','b-ok'],REQUER_VALIDACAO:['Requer valida&ccedil;&atilde;o','b-err']};const porCompetencia={};zeros.forEach(i=>(porCompetencia[i.competencia]??=[]).push(i));destino.innerHTML='<h3>'+h(primeiro?.unidade||escolhido)+' ('+h(escolhido)+')</h3><div class="unit-summary"><div><span>Total de indicadores</span><b>'+soma(f,'total')+'</b></div><div><span>Compet&ecirc;ncia atual</span><b>'+soma(f,'competenciaAtual')+'</b></div><div><span>Zerados</span><b>'+soma(f,'zerados')+'</b></div><div><span>Poss&iacute;veis pend&ecirc;ncias</span><b>'+soma(f,'pendencias')+'</b></div><div><span>Divergentes</span><b>'+soma(f,'divergentes')+'</b></div></div><h4>Dados diferentes da planilha</h4>'+(diverg.length?'<ul class="zero-list">'+diverg.map(i=>'<li><strong>'+h(i.competencia)+' &middot; '+h(i.campo)+'</strong><br><span class="group-small">'+h(reduzir(i.grupo))+'</span> &mdash; Planilha: <b>'+h(i.planilha)+'</b> | SMS Rio: <b>'+h(i.smsRio)+'</b></li>').join('')+'</ul>':'<p class="empty">Nenhum dado diferente da planilha neste recorte.</p>')+'<h4>Indicadores zerados por compet&ecirc;ncia</h4>'+(zeros.length?Object.entries(porCompetencia).sort((a,b)=>b[0].localeCompare(a[0])).map(([c,itens])=>'<details><summary><strong>'+h(c)+'</strong> &middot; '+itens.length+' indicadores zerados</summary><ul class="zero-list">'+itens.map(i=>{const r=rot[i.classificacao]||['Requer valida&ccedil;&atilde;o','b-pending'];return '<li><strong>'+h(i.campo)+'</strong> <span class="group-small">('+h(reduzir(i.grupo))+')</span><br><span class="badge '+r[1]+'">'+r[0]+'</span> <small>'+h(i.evidencia||'')+'</small></li>'}).join('')+'</ul></details>').join(''):'<p class="empty">Nenhum indicador zerado neste recorte.</p>')}
}
function mostrarVisao(visao){const paineis=document.querySelectorAll('.panel.full');const blocos={resumo:[document.querySelector('.metrics'),document.querySelector('.status-board'),document.querySelector('.grid')],pendencias:[paineis[0]],divergencias:[paineis[1]],zerados:[paineis[2]],historico:[paineis[3]]};Object.values(blocos).flat().forEach(el=>{if(el)el.style.display='none'});(blocos[visao]||blocos.resumo).forEach(el=>{if(el)el.style.display='' });document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===visao));window.scrollTo({top:0,behavior:'smooth'})}
document.querySelectorAll('select').forEach(s=>s.addEventListener('change',render));q('limpar').addEventListener('click',()=>{document.querySelectorAll('select').forEach(s=>s.value='');render()});document.querySelectorAll('[data-go]').forEach(b=>b.addEventListener('click',()=>document.querySelector('.filterbar')?.scrollIntoView({behavior:'smooth',block:'start'})));document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>mostrarVisao(b.dataset.view)));render();mostrarVisao('resumo');
</script><script>
function renderZerosPlus(f){const grupos={};f.forEach(x=>{const k=x.categoria+'|'+x.sigla;(grupos[k]??=[]).push(x)});const rot={POSSIVEL_PENDENCIA:['Possível pendência no SMS Rio','b-pending'],POSSIVEL_NAO_APLICAVEL:['Possível não aplicável','b-ok'],REQUER_VALIDACAO:['Requer validação','b-err']};q('analise-unidade').innerHTML=Object.values(grupos).sort((a,b)=>a[0].categoria.localeCompare(b[0].categoria)||a[0].sigla.localeCompare(b[0].sigla)).map(registros=>{const x=registros[0],zeros=registros.flatMap(r=>(r.detalhesZeros||[]).map(i=>({...i,competencia:r.competencia})));const porComp={};zeros.forEach(i=>(porComp[i.competencia]??=[]).push(i));return '<article class="zero-card"><h3>'+catBadge(x.categoria)+' '+h(x.unidade)+' ('+h(x.sigla)+')</h3><div class="unit-summary"><div><span>Total de indicadores</span><b>'+soma(registros,'total')+'</b></div><div><span>Zerados no SMS Rio</span><b>'+zeros.length+'</b></div><div><span>Possíveis pendências</span><b>'+soma(registros,'pendencias')+'</b></div><div><span>Possíveis não aplicáveis</span><b>'+soma(registros,'naoAplicaveis')+'</b></div><div><span>Requerem validação</span><b>'+soma(registros,'requerValidacao')+'</b></div></div>'+(zeros.length?Object.entries(porComp).sort((a,b)=>b[0].localeCompare(a[0])).map(([c,itens])=>'<details><summary><strong>'+h(c)+'</strong> · '+itens.length+' zerado(s) no SMS Rio</summary><ul class="zero-list">'+itens.map(i=>{const r=rot[i.classificacao]||rot.REQUER_VALIDACAO;return '<li><strong>'+h(i.campo)+'</strong><br><span class="group-small">'+h(i.grupo)+'</span> <span class="badge '+r[1]+'">'+r[0]+'</span> <small>'+h(i.evidencia||'')+'</small></li>'}).join('')+'</ul></details>').join(''):'<p class="empty">Nenhum indicador zerado no SMS Rio neste recorte.</p>')+'</article>'}).join('')||'<p class="empty">Nenhuma unidade encontrada.</p>'}
function renderPlus(){const f=filtro();renderZerosPlus(f);q('corpo-consolidado').innerHTML=f.map(x=>{const vals=x.detalhesValores||[],planilha=vals.some(v=>preenchido(v.planilha));return '<tr><td>'+h(x.competencia)+'</td><td>'+catBadge(x.categoria)+'</td><td><b>'+h(x.sigla)+'</b></td><td>'+h(x.unidade)+'</td><td class="'+(planilha?'state-ok':'state-empty')+'">'+(planilha?'Sim':'Não')+'</td><td class="'+(x.possuiDados?'state-ok':'state-empty')+'">'+(x.possuiDados?'Sim':'Não')+'</td><td class="'+(x.divergentes?'state-diff':'state-ok')+'">'+x.divergentes+'</td><td>'+x.alteracoesEncontradas+'</td><td>'+dataHora(x.executadoEm)+'</td></tr>'}).join('')||'<tr><td colspan="9" class="empty">Nenhuma unidade encontrada.</td></tr>';const linhas=f.flatMap(x=>(x.detalhesValores||[]).map(i=>({...i,competencia:x.competencia,categoria:x.categoria,sigla:x.sigla})));q('corpo-indicadores').innerHTML=linhas.map(i=>{const a=numerico(i.planilha),b=numerico(i.smsRio),igual=preenchido(i.planilha)&&preenchido(i.smsRio)&&(a!==null&&b!==null?Math.abs(a-b)<1e-9:String(i.planilha)===String(i.smsRio));const mr=metaResultado(i.campo,i.sigla,i.smsRio);return '<tr><td>'+h(i.competencia)+'</td><td>'+catBadge(i.categoria)+'</td><td><b>'+h(i.sigla)+'</b></td><td><strong>'+h(i.campo)+'</strong></td><td class="group-small">'+h(i.grupo)+'</td><td>'+h(i.planilha)+'</td><td><b>'+h(i.smsRio)+'</b></td><td class="'+(igual?'state-ok':'state-diff')+'">'+(igual?'OK':'Diferente')+'</td><td>'+h(mr[2])+'</td><td><span class="badge '+mr[1]+'">'+h(mr[0])+'</span></td></tr>'}).join('')||'<tr><td colspan="10" class="empty">Sem valores de indicadores neste recorte.</td></tr>'}
function mostrarPlus(visao){const paineis=document.querySelectorAll('.panel.full');const extras=[document.querySelector('.metrics'),document.querySelector('.status-board'),document.querySelector('.grid'),document.querySelector('.definitions')];[...paineis,...extras].forEach(el=>{if(el)el.style.display='none'});const blocos={resumo:extras,pendencias:[paineis[0]],divergencias:[paineis[1]],zerados:[paineis[2]],historico:[paineis[3]],consolidado:[paineis[4]],indicadores:[paineis[5]],'unidade-indicadores':[paineis[6]],'dados-sms':[paineis[7]],'dados-planilha':[paineis[8]]};(blocos[visao]||extras).forEach(el=>{if(el)el.style.display=''});document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===visao))}
document.querySelectorAll('select').forEach(s=>s.addEventListener('change',renderPlus));document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>mostrarPlus(b.dataset.view)));renderPlus();mostrarPlus('resumo');
</script><script>
// Camada analítica: mantém a coleta simples e apresenta os dados como matrizes mensais.
const resumoMacros=document.createElement('section');resumoMacros.id='resumo-macros';resumoMacros.className='macro-summary';document.querySelector('.status-board').after(resumoMacros);
const nomesIndicadores=uniq(D.flatMap(x=>(x.detalhesValores||[]).map(v=>v.campo)).filter(Boolean));opts('indicador',nomesIndicadores.map(x=>({valor:x,texto:x})),'Todos os indicadores');opts('indicador-local',nomesIndicadores.map(x=>({valor:x,texto:x})),'Selecione um indicador');
if(![...q('ano').options].some(o=>o.value==='2025'))q('ano').add(new Option('2025','2025'));
function statusSenior(x){if((typeof x==='string'?x:x.status)==='SEM_REGISTRO_DE_CONSULTA')return '<span class="badge b-neutral">Não consultada neste histórico</span>';return status(x)}
function recorteResumo(){let f=filtro();const semTempo=!q('competencia').value&&!q('ano').value&&!q('mes').value;if(semTempo&&f.length){const ultima=[...new Set(f.map(x=>x.competencia))].sort().at(-1);f=f.filter(x=>x.competencia===ultima)}return f}
function resumoPorMacro(f){const cats=['Geral','Maternidade','Pediatria'];resumoMacros.innerHTML=cats.map(c=>{const a=f.filter(x=>x.categoria===c),dados=a.filter(x=>x.possuiDados).length,pend=a.filter(x=>x.status==='MES_NAO_DISPONIVEL_SMSRIO').length,sem=a.filter(x=>x.status==='SEM_REGISTRO_DE_CONSULTA').length,err=a.filter(x=>x.status==='ERRO_SEM_ATUALIZAR'||x.status==='DADOS_COLETADOS_VERIFICAR').length;return '<article class="macro-card '+catClass(c)+'"><h3>'+catBadge(c)+'</h3><dl><dt>Unidades previstas</dt><dd>'+a.length+'</dd><dt>Com dados no SMS Rio</dt><dd>'+dados+'</dd><dt>Pendentes de preenchimento</dt><dd>'+pend+'</dd><dt>Não consultadas no histórico</dt><dd>'+sem+'</dd><dt>Erros técnicos</dt><dd>'+err+'</dd><dt>Divergências atuais Sheets x SMS</dt><dd>'+soma(a,'divergentes')+'</dd></dl></article>'}).join('')}
function anoAnalise(){return Number(q('ano').value||(q('competencia').value||'').slice(0,4)||Math.max(...D.map(x=>x.ano)))}
function mesesAnalise(){return q('mes').value?[Number(q('mes').value)]:Array.from({length:12},(_,i)=>i+1)}
function registrosAno(){const ano=anoAnalise();return D.filter(x=>x.ano===ano&&(!q('categoria').value||x.categoria===q('categoria').value)&&(!q('unidade').value||x.sigla===q('unidade').value))}
const simNao=v=>v?'<span class="state-ok">Sim</span>':'<span class="state-empty">Não</span>';
function renderConsolidadoPivot(){const ano=anoAnalise(),ms=mesesAnalise(),base=registrosAno(),unidades={};base.forEach(x=>unidades[x.categoria+'|'+x.sigla]??=x);const cab1='<tr><th class="unit-col" rowspan="2">Unidade</th>'+ms.map(m=>'<th class="month-head" colspan="3">'+h(meses[m])+'/'+ano+'</th>').join('')+'</tr>';const cab2='<tr>'+ms.map(()=>'<th class="sub-head">Dados Google Sheets</th><th class="sub-head">Dados SMS Rio</th><th class="sub-head">Indic. diverg. Sheets x SMS</th>').join('')+'</tr>';const corpo=Object.values(unidades).sort((a,b)=>a.categoria.localeCompare(b.categoria)||a.sigla.localeCompare(b.sigla)).map(u=>'<tr><td class="unit-col">'+catBadge(u.categoria)+' <b>'+h(u.sigla)+'</b><br><small>'+h(u.unidade)+'</small></td>'+ms.map(m=>{const r=base.find(x=>x.categoria===u.categoria&&x.sigla===u.sigla&&x.mes===m);if(!r)return '<td>—</td><td>—</td><td>—</td>';const plan=(r.detalhesValores||[]).some(v=>preenchido(v.planilha));return '<td>'+simNao(plan)+'</td><td>'+simNao(r.possuiDados)+'</td><td class="'+(r.divergentes?'state-diff':'state-ok')+'">'+(r.possuiDados?r.divergentes:'—')+'</td>'}).join('')+'</tr>').join('');q('corpo-consolidado').closest('.table-wrap').innerHTML='<table class="pivot-table"><thead>'+cab1+cab2+'</thead><tbody>'+corpo+'</tbody></table>'}
function estadoComparacao(p,s){if(!preenchido(p)&&!preenchido(s))return ['—',''];if(!preenchido(p)&&preenchido(s))return ['Planilha vazia','state-empty'];const a=numerico(p),b=numerico(s),ok=a!==null&&b!==null?Math.abs(a-b)<1e-9:String(p)===String(s);return [ok?'OK':'Diferente',ok?'state-ok':'state-diff']}
function renderIndicadorPivot(){const indicador=q('indicador-local').value,ano=anoAnalise(),ms=mesesAnalise(),base=registrosAno(),tabela=q('tabela-indicadores');if(!indicador){tabela.innerHTML='<tbody id="corpo-indicadores"><tr><td colspan="10" class="analysis-note"><strong>Selecione o indicador acima.</strong> O painel mostrará todas as unidades que possuem esse indicador, com os valores do Google Sheets e do SMS Rio mês a mês.</td></tr></tbody>';return}const candidatas={};D.forEach(x=>{if((x.detalhesValores||[]).some(v=>v.campo===indicador))candidatas[x.categoria+'|'+x.sigla]=x});const cab1='<tr><th class="unit-col" rowspan="2">Unidade</th>'+ms.map(m=>'<th class="month-head" colspan="3">'+h(meses[m])+'/'+ano+'</th>').join('')+'</tr>';const cab2='<tr>'+ms.map(()=>'<th class="sub-head">Google Sheets</th><th class="sub-head">SMS Rio</th><th class="sub-head">Situação</th>').join('')+'</tr>';const corpo=Object.values(candidatas).filter(u=>(!q('categoria').value||u.categoria===q('categoria').value)&&(!q('unidade').value||u.sigla===q('unidade').value)).sort((a,b)=>a.categoria.localeCompare(b.categoria)||a.sigla.localeCompare(b.sigla)).map(u=>'<tr><td class="unit-col">'+catBadge(u.categoria)+' <b>'+h(u.sigla)+'</b><br><small>'+h(u.unidade)+'</small></td>'+ms.map(m=>{const r=base.find(x=>x.categoria===u.categoria&&x.sigla===u.sigla&&x.mes===m),v=(r?.detalhesValores||[]).find(i=>i.campo===indicador);if(!v)return '<td>—</td><td>—</td><td>Não consultado</td>';const e=estadoComparacao(v.planilha,v.smsRio);return '<td>'+h(formatarValor(indicador,v.planilha))+'</td><td><b>'+h(formatarValor(indicador,v.smsRio))+'</b></td><td class="'+e[1]+'">'+e[0]+'</td>'}).join('')+'</tr>').join('');tabela.className='pivot-table';tabela.innerHTML='<thead>'+cab1+cab2+'</thead><tbody id="corpo-indicadores">'+(corpo||'<tr><td colspan="37" class="empty">Nenhuma unidade possui este indicador neste recorte.</td></tr>')+'</tbody>'}
function renderHistoricoCards(){const ef=E.filter(x=>(!q('competencia').value||x.competencia===q('competencia').value)&&(!q('ano').value||x.ano==q('ano').value)&&(!q('mes').value||x.mes==q('mes').value));const painel=q('corpo-historico').closest('.table-wrap');painel.className='history-cards';painel.innerHTML=ef.map(x=>'<article class="history-card"><div class="history-card-head"><div><b>'+dataHora(x.fim)+'</b><br><span>Competência '+h(x.competencia)+' · modo '+h(x.modo)+'</span></div>'+marco(x.competencia)+'</div><div class="history-metrics"><div><span>Solicitadas</span><b>'+x.solicitadas+'</b></div><div><span>Com dados</span><b>'+x.lancadas+'</b></div><div><span>Pendentes</span><b>'+x.semCompetencia+'</b></div><div><span>Não localizadas</span><b>'+x.naoLocalizadas+'</b></div><div><span>Erros técnicos</span><b>'+x.errosTecnicos+'</b></div></div><div class="history-groups"><div><strong>Pendentes de preenchimento</strong><p>'+siglas(x.unidadesSemCompetencia)+'</p></div><div><strong>Erros e não localizadas</strong><p>'+siglas([...x.unidadesNaoLocalizadas,...x.unidadesComErro])+'</p></div><div><strong>Alterações encontradas antes da atualização</strong><p>'+siglas(x.unidadesAlteradas)+'</p><small>'+x.indicadoresDivergentes+' indicador(es)</small></div></div></article>').join('')||'<p class="empty">Nenhuma execução neste recorte.</p>'}
function preencherFiltro(id,itens,rotulo){const el=q(id),anterior=el.value;el.innerHTML='<option value="">'+h(rotulo)+'</option>'+itens.map(i=>'<option value="'+h(i.valor)+'">'+h(i.texto)+'</option>').join('');if(itens.some(i=>String(i.valor)===String(anterior)))el.value=anterior}
function atualizarFiltrosDependentes(){const ano=q('ano').value,categoria=q('categoria').value,unidade=q('unidade').value;const porAno=D.filter(x=>!ano||String(x.ano)===String(ano));preencherFiltro('categoria',uniq(porAno.map(x=>x.categoria)).map(x=>({valor:x,texto:x})),'Todas');if(categoria&&![...q('categoria').options].some(o=>o.value===categoria))q('categoria').value='';const cat=q('categoria').value;const porCategoria=porAno.filter(x=>!cat||x.categoria===cat);const mesesDisponiveis=uniq(porCategoria.filter(x=>!unidade||x.sigla===unidade).map(x=>x.mes)).map(Number).sort((a,b)=>a-b);preencherFiltro('mes',mesesDisponiveis.map(x=>({valor:x,texto:meses[x]})),'Todos');const unidades=Object.values(Object.fromEntries(porCategoria.map(x=>[x.categoria+'|'+x.sigla,x]))).sort((a,b)=>a.unidade.localeCompare(b.unidade));const opcoesUnidade=unidades.map(x=>({valor:x.sigla,texto:x.sigla+' — '+x.unidade}));preencherFiltro('unidade',opcoesUnidade,'Todas');preencherFiltro('unidade-local',opcoesUnidade,'Selecione uma unidade');if(q('unidade').value&&![...q('unidade-local').options].some(o=>o.value===q('unidade').value))q('unidade-local').value='';if(q('unidade').value&&!q('unidade-local').value)q('unidade-local').value=q('unidade').value}
function siglaSelecionada(){const seletor=q('unidade');const texto=seletor?.selectedOptions?.[0]?.textContent||'';return seletor?.value||texto.split(' — ')[0].trim()}
function dadosDaUnidadeSelecionada(){let sigla=siglaSelecionada(),ano=anoAnalise();const recorte=filtro();const encontrado=recorte.find(x=>x.sigla===sigla)||recorte[0];if(encontrado)sigla=encontrado.sigla;let base=D.filter(x=>String(x.sigla)===String(sigla)&&String(x.ano)===String(ano));if(!base.length&&encontrado)base=D.filter(x=>String(x.sigla)===String(encontrado.sigla));return {sigla,ano,base}}
function renderUnidadePivot(){const {sigla,ano,base}=dadosDaUnidadeSelecionada(),ms=mesesAnalise(),tabela=q('tabela-unidade');if(!sigla){tabela.innerHTML='<tbody id="corpo-unidade"><tr><td class="analysis-note"><strong>Selecione uma unidade no filtro superior.</strong> O comparativo mostrará todos os indicadores daquela unidade, com os meses em colunas.</td></tr></tbody>';return}const exemplo=base[0];if(!exemplo){tabela.innerHTML='<tbody id="corpo-unidade"><tr><td class="empty">Nenhum dado encontrado para esta unidade no recorte selecionado.</td></tr></tbody>';return}const campos=uniq(base.flatMap(x=>(x.detalhesValores||[]).map(v=>v.campo)).filter(Boolean));const cab1='<tr><th class="unit-col" rowspan="2">Indicador</th>'+ms.map(m=>'<th class="month-head" colspan="3">'+h(meses[m])+'/'+ano+'</th>').join('')+'</tr>';const cab2='<tr>'+ms.map(()=>'<th class="sub-head">Google Sheets</th><th class="sub-head">SMS Rio</th><th class="sub-head">Situação</th>').join('')+'</tr>';const corpo=campos.map(campo=>'<tr><td class="unit-col"><strong>'+h(campo)+'</strong></td>'+ms.map(m=>{const reg=base.find(x=>Number(x.mes)===Number(m)),v=(reg?.detalhesValores||[]).find(i=>i.campo===campo);if(!v)return '<td>—</td><td>—</td><td>Não consultado</td>';const e=estadoComparacao(v.planilha,v.smsRio);return '<td>'+h(formatarValor(campo,v.planilha))+'</td><td><b>'+h(formatarValor(campo,v.smsRio))+'</b></td><td class="'+e[1]+'">'+e[0]+'</td>'}).join('')+'</tr>').join('');tabela.className='pivot-table';tabela.innerHTML='<thead>'+cab1+cab2+'</thead><tbody id="corpo-unidade">'+corpo+'</tbody>'}
function renderFonteTabela(tipo){const {sigla,ano,base}=dadosDaUnidadeSelecionada(),ms=mesesAnalise(),tabela=q(tipo==='sms'?'tabela-sms':'tabela-planilha'),chave=tipo==='sms'?'smsRio':'planilha';if(!sigla){tabela.innerHTML='<tbody><tr><td class="analysis-note"><strong>Selecione uma unidade no filtro superior.</strong> Serão exibidos todos os indicadores disponíveis.</td></tr></tbody>';return}const campos=uniq(base.flatMap(x=>(x.detalhesValores||[]).map(v=>v.campo)).filter(Boolean));if(!campos.length){tabela.innerHTML='<tbody><tr><td class="empty">Nenhum indicador encontrado para esta unidade no recorte selecionado.</td></tr></tbody>';return}const cab='<tr><th class="unit-col">Indicador</th>'+ms.map(m=>'<th class="month-head">'+h(meses[m])+'/'+ano+'</th>').join('')+'</tr>';const corpo=campos.map(campo=>'<tr><td class="unit-col"><strong>'+h(campo)+'</strong></td>'+ms.map(m=>{const reg=base.find(x=>Number(x.mes)===Number(m));const valor=(reg?.detalhesValores||[]).find(v=>v.campo===campo)?.[chave];return '<td>'+h(formatarValor(campo,valor))+'</td>'}).join('')+'</tr>').join('');tabela.className='pivot-table tabela-fonte';tabela.innerHTML='<thead>'+cab+'</thead><tbody>'+corpo+'</tbody>'}
function organizarTabelaUnidades(){let f=filtro();const semPeriodo=!q('ano').value&&!q('mes').value&&!q('categoria').value&&!q('unidade').value;if(semPeriodo&&f.length){const ultima=[...new Set(f.map(x=>x.competencia))].sort().at(-1);f=f.filter(x=>x.competencia===ultima)}let categoriaAnterior='';const linhas=[...f].sort((a,b)=>a.categoria.localeCompare(b.categoria)||a.unidade.localeCompare(b.unidade)).map(x=>{const divisor=x.categoria!==categoriaAnterior?'<tr class="category-row"><td colspan="10">'+h(x.categoria)+'</td></tr>':'';categoriaAnterior=x.categoria;return divisor+'<tr class="'+(x.pendencias?'pending-row':'')+'"><td>'+h(x.competencia)+'</td><td>'+catBadge(x.categoria)+'</td><td><b>'+h(x.sigla)+'</b></td><td>'+h(x.unidade)+'</td><td>'+statusSenior(x)+'</td><td>'+x.total+'</td><td>'+x.competenciaAtual+'</td><td>'+x.zerados+'</td><td>'+x.pendencias+'</td><td>'+x.divergentes+'</td></tr>'});q('corpo').innerHTML=linhas.join('')||'<tr><td colspan="10" class="empty">Nenhuma unidade encontrada.</td></tr>'}
function renderSenior(){const f=recorteResumo(),lancadas=f.filter(x=>x.possuiDados),pend=f.filter(x=>x.status==='MES_NAO_DISPONIVEL_SMSRIO'),nao=f.filter(naoLocalizada),erros=f.filter(x=>(x.status==='ERRO_SEM_ATUALIZAR'||x.status==='DADOS_COLETADOS_VERIFICAR')&&!naoLocalizada(x));q('m-unidades').textContent=f.length;q('m-lancadas').textContent=lancadas.length;q('m-pend-preench').textContent=pend.length;q('m-nao-localizadas').textContent=nao.length;q('m-erros-tecnicos').textContent=erros.length;q('lista-ok').innerHTML=siglas(lancadas);q('lista-pendentes').innerHTML=siglas(pend);q('lista-nao-localizadas').innerHTML=siglas(nao);q('lista-erros').innerHTML=siglas(erros);resumoPorMacro(f);renderConsolidadoPivot();renderIndicadorPivot();renderHistoricoCards();organizarTabelaUnidades();renderUnidadePivot();renderFonteTabela('sms');renderFonteTabela('planilha')}
document.querySelectorAll('select').forEach(s=>s.addEventListener('change',renderSenior));q('indicador-local').addEventListener('change',renderIndicadorPivot);q('unidade-local').addEventListener('change',renderUnidadePivot);['ano','mes','categoria','unidade'].forEach(id=>q(id).addEventListener('change',()=>{atualizarFiltrosDependentes();renderSenior()}));q('limpar').addEventListener('click',()=>{q('indicador-local').value='';q('unidade-local').value='';atualizarFiltrosDependentes();renderSenior()});document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>{resumoMacros.style.display=b.dataset.view==='resumo'?'grid':'none';document.querySelector('.filterbar').style.display=b.dataset.view==='divergencias'?'none':''}));atualizarFiltrosDependentes();renderSenior();
</script><script>
/* Mantem os contenedores das tabelas estaveis: os filtros podem ser usados repetidamente. */
function painelEstavel(id,chave){if(!window[chave])window[chave]=q(id)?.closest('.table-wrap');return window[chave]}
function renderConsolidadoPivot(){const ano=anoAnalise(),ms=mesesAnalise(),base=registrosAno(),painel=painelEstavel('corpo-consolidado','__painelConsolidado');if(!painel)return;const unidades={};base.forEach(x=>unidades[x.categoria+'|'+x.sigla]??=x);const cab1='<tr><th class="unit-col" rowspan="2">Unidade</th>'+ms.map(m=>'<th class="month-head" colspan="3">'+h(meses[m])+'/'+ano+'</th>').join('')+'</tr>';const cab2='<tr>'+ms.map(()=>'<th class="sub-head">Google Sheets</th><th class="sub-head">SMS Rio</th><th class="sub-head">Divergencias</th>').join('')+'</tr>';const linhas=Object.values(unidades).map(u=>'<tr><td class="unit-col">'+catBadge(u.categoria)+' <b>'+h(u.sigla)+'</b><br><small>'+h(u.unidade)+'</small></td>'+ms.map(m=>{const r=base.find(x=>x.categoria===u.categoria&&x.sigla===u.sigla&&Number(x.mes)===Number(m));if(!r)return '<td>—</td><td>—</td><td>—</td>';const plan=(r.detalhesValores||[]).some(v=>preenchido(v.planilha));return '<td>'+simNao(plan)+'</td><td>'+simNao(r.possuiDados)+'</td><td class="'+(r.divergentes?'state-diff':'state-ok')+'">'+(r.possuiDados?r.divergentes:'—')+'</td>'}).join('')+'</tr>').join('');painel.innerHTML='<table class="pivot-table"><thead>'+cab1+cab2+'</thead><tbody id="corpo-consolidado">'+linhas+'</tbody></table>'}
function renderHistoricoCards(){const ef=E.filter(x=>(!q('competencia').value||x.competencia===q('competencia').value)&&(!q('ano').value||x.ano==q('ano').value)&&(!q('mes').value||x.mes==q('mes').value));const painel=painelEstavel('corpo-historico','__painelHistorico');if(!painel)return;painel.className='history-cards';const cards=ef.map(x=>'<article class="history-card"><div class="history-card-head"><div><b>'+dataHora(x.fim)+'</b><br><span>Competência '+h(x.competencia)+' · modo '+h(x.modo)+'</span></div>'+marco(x.competencia)+'</div><div class="history-metrics"><div><span>Solicitadas</span><b>'+x.solicitadas+'</b></div><div><span>Com dados</span><b>'+x.lancadas+'</b></div><div><span>Pendentes</span><b>'+x.semCompetencia+'</b></div><div><span>Não localizadas</span><b>'+x.naoLocalizadas+'</b></div><div><span>Erros técnicos</span><b>'+x.errosTecnicos+'</b></div></div></article>').join('')||'<p class="empty">Nenhuma execução neste recorte.</p>';painel.innerHTML='<div id="corpo-historico" hidden></div>'+cards}
['ano','mes','categoria','unidade'].forEach(id=>q(id).addEventListener('change',()=>setTimeout(renderSenior,0)));
</script></body></html>`;

  const pasta = path.join(raiz, "painel");
  await fs.mkdir(pasta, { recursive: true });
  const arquivo = path.join(pasta, "painel-dashboard.html");
  monitoramentoPosMarco.sort((a, b) => String(b.detectadoEm).localeCompare(String(a.detectadoEm)));
  const html = renderDashboardHtml({
    dados,
    execucoes,
    logo,
    sidebarMotion,
    monitoramentoPosMarco,
    unidadesConfiguradas: configuradas
  });
  await fs.writeFile(arquivo, html, "utf8");
  return arquivo;
}
