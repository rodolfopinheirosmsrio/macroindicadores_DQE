import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { autenticarGoogle, clientesGoogle, enviarBackup, obterOuCriarPasta } from "./google.mjs";
import {
  auditarCompetencia, atualizarCompetencia, lerEstruturaAba,
  mapearRelatorio, validarAbasConfiguradas
} from "./planilhas.mjs";
import { abrirSmsRio, consultarRelatorio, localizarMesNoRelatorio } from "./smsrio.mjs";
import { carregarCredenciais } from "./credenciais.mjs";
import { salvarRelatorioExecucao } from "./relatorio-execucao.mjs";
import { classificarIndicadoresZerados, resumoAuditoria } from "./auditoria.mjs";
import { salvarDashboard } from "./dashboard.mjs";
import { atualizarSnapshotUnidade } from "./snapshot-planilhas.mjs";
import {
  competencia, competenciaAnterior, downloadsPadrao, garantirDiretorio,
  lerJson, nomeCompetencia
} from "./util.mjs";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function argumentos(argv) {
  const saida = {};
  for (const arg of argv) {
    const m = /^--([^=]+)=(.*)$/.exec(arg);
    if (m) saida[m[1]] = m[2];
  }
  return saida;
}

function lista(texto) {
  return texto ? texto.split(",").map((v) => v.trim()).filter(Boolean) : [];
}

function valorExibicao(valor) {
  if (valor === "" || valor == null) return "(vazio)";
  return String(valor);
}

function imprimirAuditoria(resumo, { listarZeros = true, listarDiferencas = true } = {}) {
  console.log(`  Total de indicadores: ${resumo.total}`);
  console.log(`  Novos dados encontrados: ${resumo.novos ?? 0}`);
  console.log(`  Indicadores zerados: ${resumo.zeros}`);
  console.log(`  Indicadores divergentes: ${resumo.diferencas}`);
}

async function salvarLog(log) {
  const dir = path.join(raiz, "logs");
  await garantirDiretorio(dir);
  const carimbo = new Date().toISOString().replace(/[:.]/g, "-");
  const arquivo = path.join(dir, `execucao-${carimbo}.json`);
  await fs.writeFile(arquivo, JSON.stringify(log, null, 2), "utf8");
  return arquivo;
}

const args = argumentos(process.argv.slice(2));
const modo = (args.modo ?? "conferir").trim().toLowerCase();
if (!["conferir", "atualizar", "atualizar-zerados"].includes(modo)) {
  throw new Error("Modo deve ser conferir, atualizar ou atualizar-zerados.");
}
const comp = competencia(args.competencia);
const config = await lerJson(path.join(raiz, "config", "config.json"));
const historicoMeses = Math.max(6, Number(config.historicoMeses ?? 0));
const todasUnidades = await lerJson(path.join(raiz, "config", "unidades.json"));
const palavrasTodas = new Set(["todos", "todas", "all"]);
const categoriasDigitadas = lista(args.categorias).map((v) => v.toLowerCase());
const siglasDigitadas = lista(args.unidades).map((v) => v.toLowerCase());
const categorias = categoriasDigitadas.some((v) => palavrasTodas.has(v)) ? [] : categoriasDigitadas;
const siglas = siglasDigitadas.some((v) => palavrasTodas.has(v)) ? [] : siglasDigitadas;
const unidades = todasUnidades.filter((u) =>
  (!categorias.length || categorias.includes(u.categoria.toLowerCase())) &&
  (!siglas.length || siglas.includes(u.aba.toLowerCase()))
);
if (!unidades.length) throw new Error("Nenhuma unidade corresponde aos filtros informados.");

const downloadsDir = config.downloadsDir ? path.resolve(raiz, config.downloadsDir) : downloadsPadrao();
const auth = await autenticarGoogle({
  credentialsPath: path.resolve(raiz, config.googleCredentials),
  tokenPath: path.resolve(raiz, config.googleToken)
});
const { drive, sheets } = clientesGoogle(auth);
const validacaoAbas = await validarAbasConfiguradas(sheets, config.workbooks, todasUnidades);
for (const [workbook, validacao] of Object.entries(validacaoAbas)) {
  if (validacao.ausentes.length) {
    throw new Error(`Abas configuradas ausentes em ${workbook}: ${validacao.ausentes.join(", ")}`);
  }
  if (validacao.naoConfiguradas.length) {
    console.warn(`ATENÇÃO - abas ainda não configuradas em ${workbook}: ${validacao.naoConfiguradas.join(", ")}`);
  }
}
const pastaNome = `${nomeCompetencia(comp)} - Robo`;
const pastaId = await obterOuCriarPasta(drive, config.driveParentFolderId, pastaNome);
const credenciaisSmsRio = await carregarCredenciais(raiz);
const navegador = await abrirSmsRio({
  url: config.smsRioUrl,
  profileDir: path.resolve(raiz, config.browserProfileDir),
  credenciais: credenciaisSmsRio
});

const log = {
  inicio: new Date().toISOString(), modo, competencia: comp.chave,
  janelaMeses: 6,
  janelaZerosMeses: 7,
  pastaDrive: { nome: pastaNome, id: pastaId }, validacaoAbas, unidades: []
};

try {
  for (const unidade of unidades) {
    const item = { categoria: unidade.categoria, aba: unidade.aba, nome: unidade.nome, status: "INICIADO" };
    log.unidades.push(item);
    console.log(`\n[${unidade.categoria}] ${unidade.aba} - ${unidade.nome}`);
    try {
      await navegador.garantirAutenticacao();
      const relatorio = await consultarRelatorio(navegador.page, unidade, comp, downloadsDir);
      item.backupLocal = relatorio.arquivo;

      // Trava obrigatória: o Sheets não é tocado antes do upload confirmado.
      item.backupDrive = await enviarBackup(drive, pastaId, relatorio.arquivo, relatorio.nomeArquivo);

      const spreadsheetId = config.workbooks[unidade.workbook];
      if (!spreadsheetId) throw new Error(`Workbook não configurado: ${unidade.workbook}`);
      const estrutura = await lerEstruturaAba(sheets, spreadsheetId, unidade.aba, comp);
      const mapa = mapearRelatorio(relatorio, estrutura);
      item.mapeamento = {
        encontrados: mapa.mapeados.length - mapa.faltantes.length,
        faltantes: mapa.faltantes,
        extras: mapa.extras
      };
      if (mapa.faltantes.length || mapa.extras.length) {
        throw new Error(`Mapeamento inseguro: ${mapa.faltantes.length} faltantes e ${mapa.extras.length} extras.`);
      }

      const auditoria = await auditarCompetencia(sheets, spreadsheetId, unidade.aba, estrutura, mapa.mapeados, relatorio);
      item.competenciaAtual = resumoAuditoria(auditoria);
      item.historicoSomenteLeitura = [];

      for (let n = 1; n <= historicoMeses; n++) {
        const anterior = competenciaAnterior(comp, n);
        const chaveAnterior = `${anterior.ano}-${String(anterior.mes).padStart(2, "0")}`;
        let relatorioHistorico = relatorio;
        if (anterior.ano !== comp.ano) {
          item.backupsHistoricos ??= [];
          const jaCarregado = item.backupsHistoricos.find((b) => b.ano === anterior.ano);
          if (jaCarregado) {
            relatorioHistorico = jaCarregado.relatorio;
          } else {
            await navegador.garantirAutenticacao();
            relatorioHistorico = await consultarRelatorio(navegador.page, unidade, anterior, downloadsDir);
            const backupDriveHistorico = await enviarBackup(
              drive, pastaId, relatorioHistorico.arquivo, relatorioHistorico.nomeArquivo
            );
            item.backupsHistoricos.push({ ano: anterior.ano, relatorio: relatorioHistorico, backupDrive: backupDriveHistorico });
          }
        }
        const indice = localizarMesNoRelatorio(relatorioHistorico, anterior);
        if (indice < 0) {
          item.historicoSomenteLeitura.push({ competencia: chaveAnterior, status: "MES_NAO_DISPONIVEL" });
          continue;
        }
        const relatorioAnterior = { ...relatorioHistorico, indiceMes: indice };
        const estruturaAnterior = await lerEstruturaAba(sheets, spreadsheetId, unidade.aba, anterior);
        const mapaAnterior = mapearRelatorio(relatorioAnterior, estruturaAnterior);
        if (mapaAnterior.faltantes.length || mapaAnterior.extras.length) {
          item.historicoSomenteLeitura.push({
            competencia: chaveAnterior,
            status: "MAPEAMENTO_HISTORICO_INSEGURO",
            faltantes: mapaAnterior.faltantes,
            extras: mapaAnterior.extras
          });
          continue;
        }
        const auditoriaAnterior = await auditarCompetencia(
          sheets, spreadsheetId, unidade.aba, estruturaAnterior, mapaAnterior.mapeados, relatorioAnterior
        );
        item.historicoSomenteLeitura.push({
          competencia: chaveAnterior, status: "NAO_ALTERADO", ...resumoAuditoria(auditoriaAnterior)
        });
      }

      item.competenciaAtual = classificarIndicadoresZerados(
        item.competenciaAtual,
        item.historicoSomenteLeitura,
        6
      );

      const somenteZerados = modo === "atualizar-zerados";
      if (modo === "atualizar" || somenteZerados) {
        const gravacao = await atualizarCompetencia(sheets, spreadsheetId, unidade.aba, estrutura, auditoria, { somenteZerados });
        item.intervaloAtualizado = gravacao.intervalo;
        item.indicadoresAtualizados = gravacao.quantidade;
        item.linhasAtualizadas = gravacao.linhas;
        const verificacao = await auditarCompetencia(sheets, spreadsheetId, unidade.aba, estrutura, mapa.mapeados, relatorio);
        item.verificacao = resumoAuditoria(verificacao);
        const pendenciasVerificacao = somenteZerados
          ? verificacao.filter((indicador) => gravacao.linhas.includes(indicador.linha) && indicador.diferente).length
          : item.verificacao.novos + item.verificacao.diferencas;
        if (pendenciasVerificacao) {
          throw new Error(`Falha na verificação: ${pendenciasVerificacao} valores diferentes após gravação.`);
        }
        item.status = somenteZerados ? "ZERADOS_ATUALIZADOS_E_VERIFICADOS" : "ATUALIZADO_E_VERIFICADO";
      } else {
        item.status = "CONFERIDO_SEM_ALTERAR";
      }
      console.log(`  ${item.status}`);
      if (modo === "atualizar" || modo === "atualizar-zerados") {
        console.log("  Situação encontrada antes da atualização:");
        imprimirAuditoria(item.competenciaAtual);
        if (somenteZerados) console.log(`  CÃ©lulas vazias/zeradas corrigidas: ${item.indicadoresAtualizados}`);
        console.log("  Verificação depois da atualização:");
        imprimirAuditoria(item.verificacao, { listarZeros: false, listarDiferencas: true });
      } else {
        imprimirAuditoria(item.competenciaAtual);
      }
      for (const historico of item.historicoSomenteLeitura) {
        console.log(`  Histórico ${historico.competencia}: ${historico.status}`);
        if (typeof historico.total === "number") {
          imprimirAuditoria(historico, { listarZeros: false, listarDiferencas: true });
        }
      }
    } catch (erro) {
      item.status = erro.codigo === "MES_NAO_DISPONIVEL_SMSRIO"
        ? "MES_NAO_DISPONIVEL_SMSRIO"
        : "ERRO_SEM_ATUALIZAR";
      // Mesmo que a consulta ao SMS Rio falhe ou o mes ainda nao exista na
      // plataforma, preserva uma fotografia independente do Google Sheets.
      try {
        const fotosPlanilha = await atualizarSnapshotUnidade(raiz, sheets, config, unidade);
        item.snapshotPlanilha = {
          atualizado: true,
          competencias: fotosPlanilha.length,
          competenciaSolicitadaComDados: Boolean(
            fotosPlanilha.find((foto) => foto.competencia === comp.chave)?.planilhaDisponivel
          )
        };
      } catch (erroSnapshot) {
        item.erroSnapshotPlanilha = erroSnapshot.stack ?? String(erroSnapshot);
      }
      if (erro.arquivo) {
        item.backupLocal = erro.arquivo;
        if (erro.nomeArquivo) {
          try {
            item.backupDrive = await enviarBackup(drive, pastaId, erro.arquivo, erro.nomeArquivo);
          } catch (erroBackup) {
            item.erroBackupDrive = erroBackup.stack ?? String(erroBackup);
          }
        }
      }
      item.erro = erro.stack ?? String(erro);
      console.error(`  ERRO: ${erro.message}`);
    }
  }
} finally {
  const semMes = log.unidades.filter((item) => item.status === "MES_NAO_DISPONIVEL_SMSRIO");
  const erros = log.unidades.filter((item) => item.status === "ERRO_SEM_ATUALIZAR");
  const concluidas = log.unidades.filter((item) =>
    ["CONFERIDO_SEM_ALTERAR", "ATUALIZADO_E_VERIFICADO", "ZERADOS_ATUALIZADOS_E_VERIFICADOS"].includes(item.status)
  );
  console.log("\n===============================================");
  console.log("RESUMO FINAL");
  console.log(`Unidades solicitadas: ${log.unidades.length}`);
  console.log(`Unidades concluídas: ${concluidas.length}`);
  console.log(`Unidades sem ${nomeCompetencia(comp)} no SMS Rio: ${semMes.length}`);
  for (const item of semMes) console.log(`  - [${item.categoria}] ${item.aba} - ${item.nome}`);
  console.log(`Outros erros: ${erros.length}`);
  for (const item of erros) console.log(`  - [${item.categoria}] ${item.aba} - ${item.nome}`);
  log.fim = new Date().toISOString();
  log.arquivo = await salvarLog(log);
  try {
    log.relatorioHtml = await salvarRelatorioExecucao(log, raiz);
  } catch (erroRelatorio) {
    log.erroRelatorioHtml = erroRelatorio.stack ?? String(erroRelatorio);
    console.error(`Não foi possível criar o relatório visual: ${erroRelatorio.message}`);
  }
  try {
    log.dashboardHtml = await salvarDashboard(raiz);
  } catch (erroDashboard) {
    log.erroDashboardHtml = erroDashboard.stack ?? String(erroDashboard);
    console.error(`Não foi possível atualizar o painel: ${erroDashboard.message}`);
  }
  await navegador.context.close();
  console.log(`\nLog: ${log.arquivo}`);
  if (log.relatorioHtml) console.log(`Relatório visual: ${log.relatorioHtml}`);
  if (log.dashboardHtml) console.log(`Painel: ${log.dashboardHtml}`);
}
