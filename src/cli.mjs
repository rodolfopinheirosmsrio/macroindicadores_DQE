import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { autenticarGoogle, clientesGoogle, enviarBackup, obterPastaCompetencia } from "./google.mjs";
import {
  auditarCompetencia, auditarCompetenciaComSnapshot, atualizarCompetencia, lerEstruturaAba,
  mapearRelatorio, validarAbasConfiguradas
} from "./planilhas.mjs";
import {
  abrirSmsRio, consultarDisponibilidadeDiretaEmLote, consultarRelatorio, localizarMesNoRelatorio
} from "./smsrio.mjs";
import { carregarCredenciais } from "./credenciais.mjs";
import { salvarRelatorioExecucao } from "./relatorio-execucao.mjs";
import { classificarIndicadoresZerados, resumoAuditoria } from "./auditoria.mjs";
import { carregarFotografiasAnteriores, chaveFoto, compararFotografias } from "./monitoramento.mjs";
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
const modoDigitado = String(args.modo ?? "1").trim().toLowerCase();
const modos = new Map([
  ["1", "conferir"],
  ["conferir", "conferir"],
  ["2", "atualizar-pendencias"],
  ["atualizar", "atualizar-pendencias"],
  ["atualizar-pendencias", "atualizar-pendencias"],
  ["atualizar-zerados", "atualizar-pendencias"],
  ["3", "atualizar-completo"],
  ["atualizar-completo", "atualizar-completo"]
]);
const modo = modos.get(modoDigitado);
if (!modo) throw new Error("Modo deve ser 1 (conferir), 2 (atualizar-pendencias) ou 3 (atualizar-completo).");
const navegadorDigitado = String(args.navegador ?? args["modo-navegador"] ?? "visivel")
  .trim()
  .toLowerCase()
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/[\s_]+/g, "-");
const modoNavegador = ["1", "visivel"].includes(navegadorDigitado)
  ? "visivel"
  : ["2", "segundo-plano", "segundoplano", "headless"].includes(navegadorDigitado)
    ? "segundo-plano"
    : null;
if (!modoNavegador) {
  throw new Error("Navegador deve ser visivel ou segundo-plano.");
}
const comp = competencia(args.competencia);
const config = await lerJson(path.join(raiz, "config", "config.json"));
const historicoInicio = config.historicoInicio ? competencia(config.historicoInicio) : null;

function resolverJanelaHistorico() {
  const digitado = String(
    args.janela ?? args["janela-historico"] ?? config.janelaHistoricoPadrao ?? "1"
  ).trim().toLowerCase();
  const tudo = ["todos", "todas", "tudo", "all", "completo", "completa"].includes(digitado);
  if (tudo) {
    if (historicoInicio) {
      const anteriores = Math.max(0, (comp.ano - historicoInicio.ano) * 12 + (comp.mes - historicoInicio.mes));
      return { totalMeses: anteriores + 1, anteriores, origem: `todos desde ${historicoInicio.chave}` };
    }
    const anteriores = Math.max(0, Number(config.historicoMeses ?? 0));
    return { totalMeses: anteriores + 1, anteriores, origem: "todos conforme config" };
  }
  const totalMeses = Number.parseInt(digitado, 10);
  if (!Number.isInteger(totalMeses) || totalMeses < 1) {
    throw new Error("Janela histórica deve ser 1, 12, 24, 36, outro número positivo ou 'todos'.");
  }
  return { totalMeses, anteriores: totalMeses - 1, origem: `${totalMeses} mes(es)` };
}

const janelaHistorico = resolverJanelaHistorico();
const historicoSolicitadoMeses = janelaHistorico.anteriores;
const historicoMeses = Math.max(6, historicoSolicitadoMeses);
const fotografiasAnteriores = await carregarFotografiasAnteriores(raiz);
const todasUnidades = await lerJson(path.join(raiz, "config", "unidades.json"));
const palavrasTodas = new Set(["todos", "todas", "all"]);
const mapaCategorias = new Map([
  ["1", "geral"],
  ["2", "pediatria"],
  ["3", "maternidade"],
  ["4", "todos"]
]);
const categoriasDigitadas = lista(args.categorias).map((v) => {
  const categoria = v.toLowerCase();
  return mapaCategorias.get(categoria) ?? categoria;
});
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
const pastasDrive = new Map();
async function resolverPastaDrive(alvo) {
  if (!pastasDrive.has(alvo.chave)) {
    const nome = `${nomeCompetencia(alvo)} - Robo`;
    pastasDrive.set(alvo.chave, await obterPastaCompetencia(drive, config, alvo, nome));
  }
  return pastasDrive.get(alvo.chave);
}

const pastaAtual = await resolverPastaDrive(comp);
const pastaNome = pastaAtual.nome;
const pastaId = pastaAtual.id;
const credenciaisSmsRio = await carregarCredenciais(raiz);
const navegador = await abrirSmsRio({
  url: config.smsRioUrl,
  loginUrl: config.smsRioLoginUrl,
  profileDir: path.resolve(raiz, config.browserProfileDir),
  credenciais: credenciaisSmsRio,
  modoNavegador
});

const log = {
  inicio: new Date().toISOString(), modo,
  navegadorSolicitado: modoNavegador,
  navegadorEfetivo: navegador.modoNavegador,
  competencia: comp.chave,
  janelaMeses: historicoMeses + 1,
  janelaSolicitadaMeses: janelaHistorico.totalMeses,
  janelaHistorico: janelaHistorico.origem,
  historicoInicio: historicoInicio?.chave ?? null,
  janelaZerosMeses: 6,
  pastaDrive: pastaAtual, validacaoAbas, unidades: []
};

const inicioJanela = historicoMeses ? competenciaAnterior(comp, historicoMeses).chave : comp.chave;
console.log(`\nJanela solicitada: ${janelaHistorico.totalMeses} competência(s).`);
console.log(`Janela efetiva de análise: ${historicoMeses + 1} competência(s) (${inicioJanela} até ${comp.chave}), incluindo seis meses para avaliar zeros.`);
console.log(
  `Navegador: ${navegador.modoNavegador === "segundo-plano"
    ? "segundo plano (sessão autenticada reutilizada)"
    : "visível (permite login e CAPTCHA)"}.`
);
console.log("Análise de zeros: seis meses anteriores em somente leitura, mesmo com janela 1.");
if (modo === "atualizar-completo") console.log("ATENÇÃO: atualização completa sincroniza também valores já preenchidos, somente na competência selecionada.");

function chaveUnidade(unidade) {
  return `${unidade.categoria}::${unidade.aba}`;
}

function chaveRelatorio(unidade, ano) {
  return `${chaveUnidade(unidade)}::${ano}`;
}

// Prepara o log antes da extração em lote. Assim cada unidade mantém seu
// histórico e seus erros mesmo que a etapa de download encontre alguma falha.
const itensPorUnidade = new Map();
for (const unidade of unidades) {
  const item = { categoria: unidade.categoria, aba: unidade.aba, nome: unidade.nome, status: "INICIADO" };
  log.unidades.push(item);
  itensPorUnidade.set(chaveUnidade(unidade), item);
}

// O relatório mensal do SMS Rio contém os 12 meses do ano. Em vez de abrir
// Mensal > Categoria novamente para cada unidade e alternar os anos unidade a
// unidade, primeiro coletamos os relatórios em blocos: Categoria > Ano > Unidades.
// Isso reduz drasticamente navegação, cliques e tempo de espera no portal.
const competenciasJanela = Array.from({ length: historicoMeses + 1 }, (_, indice) =>
  indice === 0 ? comp : competenciaAnterior(comp, indice)
);
const anosNecessarios = [...new Set(competenciasJanela.map((alvo) => alvo.ano))];
const unidadesPorCategoria = new Map();
for (const unidade of unidades) {
  if (!unidadesPorCategoria.has(unidade.categoria)) unidadesPorCategoria.set(unidade.categoria, []);
  unidadesPorCategoria.get(unidade.categoria).push(unidade);
}
const relatoriosExtraidos = new Map();

async function extrairRelatoriosEmLote() {
  console.log("\n===============================================");
  console.log("ETAPA 1 - EXTRAÇÃO HÍBRIDA OTIMIZADA DO SMS RIO");
  console.log("Fluxo: consulta rápida de disponibilidade > XLS oficial somente quando necessário.");
  console.log("Cada relatório anual é baixado sem exigir que uma competência específica esteja finalizada.");
  console.log(`Categorias: ${[...unidadesPorCategoria.keys()].join(", ")}`);
  console.log(`Anos necessários: ${anosNecessarios.join(", ")}`);

  let disponibilidadeDireta = null;
  try {
    console.log("\nPré-verificando as competências pelo mesmo serviço usado pela tela...");
    disponibilidadeDireta = await consultarDisponibilidadeDiretaEmLote(
      navegador.page, unidades, competenciasJanela
    );
    for (const aviso of disponibilidadeDireta.avisos) console.warn(`  ATENÇÃO: ${aviso}`);
    const conclusivas = [...disponibilidadeDireta.resultados.values()]
      .filter((resultado) => resultado.conclusiva).length;
    console.log(`Pré-verificação concluída: ${conclusivas}/${disponibilidadeDireta.resultados.size} consulta(s) conclusiva(s).`);
  } catch (erro) {
    console.warn(`  ATENÇÃO: consulta rápida indisponível (${erro.message}).`);
    console.warn("  O robô continuará automaticamente pelo fluxo visual tradicional.");
  }

  for (const [categoria, unidadesCategoria] of unidadesPorCategoria) {
    console.log(`\n[Categoria ${categoria}] ${unidadesCategoria.length} unidade(s)`);
    for (const ano of anosNecessarios) {
      // A referência serve apenas para manter o ano correto na consulta. O arquivo
      // exportado contém o relatório mensal anual, e a disponibilidade será
      // verificada mês a mês somente na ETAPA 2.
      const referencia = ano === comp.ano ? comp : competencia(`${ano}-12`);
      console.log(`\n  Ano ${ano}: preparando ${unidadesCategoria.length} unidade(s)...`);

      for (const unidade of unidadesCategoria) {
        const item = itensPorUnidade.get(chaveUnidade(unidade));
        const chave = chaveRelatorio(unidade, ano);
        const chaveDireta = `${unidade.categoria}::${unidade.aba}::${ano}`;
        const resultadoDireto = disponibilidadeDireta?.resultados.get(chaveDireta);
        const competenciasDoAno = competenciasJanela.filter((alvo) => alvo.ano === ano);
        const nenhumaDisponivel =
          resultadoDireto?.conclusiva &&
          competenciasDoAno.every((alvo) => resultadoDireto.porCompetencia?.[alvo.chave] === false);

        if (nenhumaDisponivel) {
          const nomes = competenciasDoAno.map((alvo) => nomeCompetencia(alvo)).join(", ");
          relatoriosExtraidos.set(chave, {
            indisponivel: true,
            consultaDireta: resultadoDireto,
            observacao: `${nomes} não localizado(s) na consulta direta do SMS Rio.`
          });
          item.extracaoSmsRio ??= [];
          item.extracaoSmsRio.push({
            ano,
            status: "PULADO_SEM_COMPETENCIA",
            competencias: competenciasDoAno.map((alvo) => alvo.chave),
            cnes: resultadoDireto.cnes
          });
          console.log(`  [${unidade.aba}] ${nomes}: ainda não disponível; download anual dispensado.`);
          continue;
        }

        if (resultadoDireto && !resultadoDireto.conclusiva) {
          console.warn(`  [${unidade.aba}] Consulta rápida inconclusiva: ${resultadoDireto.erro}. Usando a tela.`);
        }
        try {
          await navegador.garantirAutenticacao();
          const relatorio = await consultarRelatorio(
            navegador.page, unidade, referencia, downloadsDir, { validarCompetencia: false }
          );
          relatoriosExtraidos.set(chave, { relatorio });
          item.extracaoSmsRio ??= [];
          item.extracaoSmsRio.push({ ano, status: "BAIXADO", arquivo: relatorio.arquivo });
        } catch (erro) {
          // Falha ao obter um ano não bloqueia os demais anos da mesma unidade.
          // Um mês ausente também nunca bloqueia meses anteriores: quando o
          // relatório anual é obtido, a checagem de cada competência é feita depois.
          relatoriosExtraidos.set(chave, { erro });
          item.extracaoSmsRio ??= [];
          item.extracaoSmsRio.push({
            ano,
            status: "ERRO_ANO_NAO_EXTRAIDO",
            observacao: erro.message
          });
          console.warn(`  [${unidade.aba}] Não foi possível extrair o relatório anual de ${ano}: ${erro.message}`);
        }
      }
    }
  }

  const baixados = [...relatoriosExtraidos.values()].filter((entrada) => entrada.relatorio).length;
  const pulados = [...relatoriosExtraidos.values()].filter((entrada) => entrada.indisponivel).length;
  const falhas = relatoriosExtraidos.size - baixados - pulados;
  console.log("\nExtração em lote concluída.");
  console.log(`Relatórios anuais baixados: ${baixados}`);
  console.log(`Downloads dispensados por competência ausente: ${pulados}`);
  console.log(`Relatórios anuais com erro: ${falhas}`);
  console.log("A disponibilidade de cada mês será verificada individualmente na etapa de conferência.");
  console.log("===============================================\n");
}

try {
  await extrairRelatoriosEmLote();

  console.log("ETAPA 2 - CONFERÊNCIA / ATUALIZAÇÃO DAS PLANILHAS");
  for (const unidade of unidades) {
    const item = itensPorUnidade.get(chaveUnidade(unidade));
    console.log(`\n[${unidade.categoria}] ${unidade.aba} - ${unidade.nome}`);
    try {
      const spreadsheetId = config.workbooks[unidade.workbook];
      if (!spreadsheetId) throw new Error(`Workbook não configurado: ${unidade.workbook}`);
      item.historicoSomenteLeitura = [];

      // Uma fotografia completa da aba por unidade abastece o painel e evita
      // dezenas de leituras repetidas do Google Sheets durante o histórico.
      let fotosPlanilha = [];
      try {
        fotosPlanilha = await atualizarSnapshotUnidade(raiz, sheets, config, unidade);
        item.snapshotPlanilha = {
          atualizado: true,
          competencias: fotosPlanilha.length,
          competenciaSolicitadaComDados: Boolean(
            fotosPlanilha.find((foto) => foto.competencia === comp.chave)?.planilhaDisponivel
          )
        };
      } catch (erroSnapshot) {
        item.erroSnapshotPlanilha = erroSnapshot.stack ?? String(erroSnapshot);
        console.warn(`  ATENÇÃO: não foi possível atualizar a fotografia do Google Sheets: ${erroSnapshot.message}`);
      }
      const fotosPlanilhaPorCompetencia = new Map(
        fotosPlanilha.map((foto) => [foto.competencia, foto])
      );

      // O relatório do ano atual é anual. A ausência da competência solicitada
      // NÃO impede o uso de janeiro, fevereiro, ... ou de anos anteriores.
      // Primeiro identificamos se o mês atual existe; o histórico será processado
      // independentemente desse resultado.
      const entradaAtual = relatoriosExtraidos.get(chaveRelatorio(unidade, comp.ano));
      let relatorioAtual = null;
      let erroAnoAtual = null;
      let falhaBackupAtual = null;

      if (entradaAtual?.relatorio) {
        const relatorioAnualAtual = entradaAtual.relatorio;
        const indiceAtual = localizarMesNoRelatorio(relatorioAnualAtual, comp);
        if (indiceAtual >= 0) {
          relatorioAtual = { ...relatorioAnualAtual, indiceMes: indiceAtual };
          item.competenciaSolicitada = { competencia: comp.chave, status: "DISPONIVEL" };
          item.backupLocal = relatorioAnualAtual.arquivo;
          try {
            // Nenhuma gravação ocorre se o backup anual da competência localizada
            // não tiver sido confirmado no Drive.
            item.backupDrive = await enviarBackup(
              drive, pastaId, relatorioAnualAtual.arquivo, relatorioAnualAtual.nomeArquivo
            );
          } catch (erroBackupAtual) {
            falhaBackupAtual = erroBackupAtual;
            item.erroBackupDrive = erroBackupAtual.stack ?? String(erroBackupAtual);
            console.warn(`  ATENÇÃO: backup do relatório anual ${comp.ano} não confirmado: ${erroBackupAtual.message}`);
          }
        } else {
          // O download foi necessário para checar o cabeçalho anual. Como o mês
          // solicitado não existe, não preservamos nem enviamos esse arquivo.
          await fs.unlink(relatorioAnualAtual.arquivo).catch(() => {});
          item.competenciaSolicitada = {
            competencia: comp.chave,
            status: "MES_NAO_DISPONIVEL",
            observacao: `${nomeCompetencia(comp)} ainda não aparece no relatório anual ${comp.ano}.`
          };
          console.warn(
            `  ${nomeCompetencia(comp)} não está disponível para ${unidade.aba}; ` +
            "os meses retroativos continuarão sendo conferidos normalmente."
          );
        }
      } else if (entradaAtual?.indisponivel) {
        item.competenciaSolicitada = {
          competencia: comp.chave,
          status: "MES_NAO_DISPONIVEL",
          observacao: entradaAtual.observacao
        };
        console.warn(`  ${nomeCompetencia(comp)} ainda não está disponível para ${unidade.aba}.`);
      } else {
        erroAnoAtual = entradaAtual?.erro ?? new Error(
          `Relatório anual ${comp.ano} não foi extraído para ${unidade.aba}.`
        );
        item.competenciaSolicitada = {
          competencia: comp.chave,
          status: "ANO_NAO_EXTRAIDO",
          observacao: erroAnoAtual.message
        };
        console.warn(
          `  Relatório anual ${comp.ano} indisponível para ${unidade.aba}; ` +
          "anos retroativos que tenham sido baixados continuarão sendo conferidos."
        );
      }

      // Os relatórios anuais já foram coletados na etapa 1 em ordem otimizada
      // (categoria > ano > unidades). Aqui não há mais navegação no SMS Rio.
      // Cada competência é tratada de forma independente: um mês ausente nunca
      // cancela os demais meses do mesmo ano nem os anos anteriores.
      const backupsHistoricosEnviados = new Set();

      for (let n = 1; n <= historicoMeses; n++) {
        const anterior = competenciaAnterior(comp, n);
        const chaveAnterior = `${anterior.ano}-${String(anterior.mes).padStart(2, "0")}`;
        const entradaHistorica = relatoriosExtraidos.get(chaveRelatorio(unidade, anterior.ano));
        if (!entradaHistorica?.relatorio) {
          item.historicoSomenteLeitura.push({
            competencia: chaveAnterior,
            status: "MES_NAO_DISPONIVEL",
            observacao: entradaHistorica?.observacao ?? entradaHistorica?.erro?.message ?? `Ano ${anterior.ano} não foi extraído.`
          });
          continue;
        }
        const relatorioHistorico = entradaHistorica.relatorio;

        // Faz um backup do relatório anual histórico apenas uma vez por ano/unidade.
        if (anterior.ano !== comp.ano && !backupsHistoricosEnviados.has(anterior.ano)) {
          try {
            const pastaHistorica = await resolverPastaDrive(anterior);
            const backupDriveHistorico = await enviarBackup(
              drive, pastaHistorica.id, relatorioHistorico.arquivo, relatorioHistorico.nomeArquivo
            );
            backupsHistoricosEnviados.add(anterior.ano);
            item.backupsHistoricos ??= [];
            item.backupsHistoricos.push({
              ano: anterior.ano,
              arquivo: relatorioHistorico.arquivo,
              pastaDrive: pastaHistorica,
              backupDrive: backupDriveHistorico
            });
          } catch (erroBackupHistorico) {
            item.historicoSomenteLeitura.push({
              competencia: chaveAnterior,
              status: "ERRO_BACKUP_HISTORICO",
              observacao: erroBackupHistorico.message
            });
            continue;
          }
        }

        const indice = localizarMesNoRelatorio(relatorioHistorico, anterior);
        if (indice < 0) {
          item.historicoSomenteLeitura.push({
            competencia: chaveAnterior,
            status: "MES_NAO_DISPONIVEL",
            observacao: `${nomeCompetencia(anterior)} não aparece no relatório anual ${anterior.ano}.`
          });
          continue;
        }
        const relatorioAnterior = { ...relatorioHistorico, indiceMes: indice };
        const fotoPlanilha = fotosPlanilhaPorCompetencia.get(chaveAnterior);
        let estruturaAnterior;
        let mapaAnterior;
        let auditoriaAnterior;

        if (fotoPlanilha?.detalhesValores?.length) {
          estruturaAnterior = {
            linhas: fotoPlanilha.detalhesValores.map((valor) => ({
              linha: valor.linha, grupo: valor.grupo, campo: valor.campo
            }))
          };
          mapaAnterior = mapearRelatorio(relatorioAnterior, estruturaAnterior);
          if (mapaAnterior.faltantes.length || mapaAnterior.extras.length) {
            item.historicoSomenteLeitura.push({
              competencia: chaveAnterior,
              status: "MAPEAMENTO_HISTORICO_INSEGURO",
              faltantes: mapaAnterior.faltantes,
              extras: mapaAnterior.extras
            });
            continue;
          }
          auditoriaAnterior = auditarCompetenciaComSnapshot(
            fotoPlanilha, mapaAnterior.mapeados, relatorioAnterior
          );
        } else {
          // Fallback para planilhas sem fotografia reconhecível.
          try {
            estruturaAnterior = await lerEstruturaAba(sheets, spreadsheetId, unidade.aba, anterior);
          } catch (erroEstrutura) {
            item.historicoSomenteLeitura.push({
              competencia: chaveAnterior,
              status: "COLUNA_PLANILHA_NAO_DISPONIVEL",
              observacao: erroEstrutura.message
            });
            continue;
          }
          mapaAnterior = mapearRelatorio(relatorioAnterior, estruturaAnterior);
          if (mapaAnterior.faltantes.length || mapaAnterior.extras.length) {
            item.historicoSomenteLeitura.push({
              competencia: chaveAnterior,
              status: "MAPEAMENTO_HISTORICO_INSEGURO",
              faltantes: mapaAnterior.faltantes,
              extras: mapaAnterior.extras
            });
            continue;
          }
          auditoriaAnterior = await auditarCompetencia(
            sheets, spreadsheetId, unidade.aba, estruturaAnterior, mapaAnterior.mapeados, relatorioAnterior
          );
        }

        item.historicoSomenteLeitura.push({
          competencia: chaveAnterior, status: "NAO_ALTERADO", ...resumoAuditoria(auditoriaAnterior)
        });
      }

      item.resumoHistorico = {
        solicitadas: historicoMeses,
        conferidas: item.historicoSomenteLeitura.filter((historico) => typeof historico.total === "number").length,
        mesesNaoDisponiveis: item.historicoSomenteLeitura.filter((historico) => historico.status === "MES_NAO_DISPONIVEL").length,
        outrosProblemas: item.historicoSomenteLeitura.filter((historico) =>
          !["NAO_ALTERADO", "MES_NAO_DISPONIVEL"].includes(historico.status)
        ).length
      };

      // Só a competência solicitada pode ser gravada. Se ela ainda não foi
      // finalizada no SMS Rio, o histórico já conferido acima é preservado no log
      // e no painel, mas nenhuma célula dessa competência é alterada.
      if (relatorioAtual) {
        const estrutura = await lerEstruturaAba(sheets, spreadsheetId, unidade.aba, comp);
        const mapa = mapearRelatorio(relatorioAtual, estrutura);
        item.mapeamento = {
          encontrados: mapa.mapeados.length - mapa.faltantes.length,
          faltantes: mapa.faltantes,
          extras: mapa.extras
        };
        if (mapa.faltantes.length || mapa.extras.length) {
          throw new Error(`Mapeamento inseguro: ${mapa.faltantes.length} faltantes e ${mapa.extras.length} extras.`);
        }

        const auditoria = await auditarCompetencia(
          sheets, spreadsheetId, unidade.aba, estrutura, mapa.mapeados, relatorioAtual
        );
        item.competenciaAtual = resumoAuditoria(auditoria);
        item.competenciaAtual = classificarIndicadoresZerados(
          item.competenciaAtual,
          item.historicoSomenteLeitura,
          6
        );
        item.monitoramento = compararFotografias(
          comp.chave, unidade, fotografiasAnteriores.get(chaveFoto(comp.chave, unidade)),
          item.competenciaAtual, new Date().toISOString()
        );
        const zerosPlanilha = classificarIndicadoresZerados(
          resumoAuditoria(auditoria.map((v) => ({ ...v, novo: v.atual }))),
          item.historicoSomenteLeitura, 6
        );
        const classificacaoZeros = new Map([
          ...zerosPlanilha.detalhesZeros.map((v) => [v.linha, v.classificacao]),
          ...item.competenciaAtual.detalhesZeros.map((v) => [v.linha, v.classificacao])
        ]);

        if (modo !== "conferir") {
          if (falhaBackupAtual) {
            item.status = "ERRO_SEM_ATUALIZAR";
            item.erro =
              `Backup do relatório anual ${comp.ano} não confirmado no Drive. ` +
              `A competência ${comp.chave} foi conferida, mas não foi alterada. ${falhaBackupAtual.message}`;
            console.error(`  ERRO SEM ATUALIZAR: ${item.erro}`);
          } else {
            const gravacao = await atualizarCompetencia(
              sheets, spreadsheetId, unidade.aba, estrutura, auditoria,
              { completo: modo === "atualizar-completo", classificacaoZeros }
            );
            item.intervaloAtualizado = gravacao.intervalo;
            item.indicadoresAtualizados = gravacao.quantidade;
            item.linhasAtualizadas = gravacao.linhas;
            const verificacao = await auditarCompetencia(
              sheets, spreadsheetId, unidade.aba, estrutura, mapa.mapeados, relatorioAtual
            );
            item.verificacao = resumoAuditoria(verificacao);
            const pendenciasVerificacao = verificacao.filter(
              (indicador) => gravacao.linhas.includes(indicador.linha) && indicador.diferente
            ).length;
            if (pendenciasVerificacao) {
              throw new Error(`Falha na verificação: ${pendenciasVerificacao} valores diferentes após gravação.`);
            }
            item.status = "ATUALIZADO_E_VERIFICADO";
            item.tipoAtualizacao = modo;
            item.correcoesNaoAplicadas = verificacao.filter((v) => v.diferente && !gravacao.linhas.includes(v.linha)).length;
            await atualizarSnapshotUnidade(raiz, sheets, config, unidade);
          }
        } else {
          item.status = "CONFERIDO_SEM_ALTERAR";
        }

        console.log(`  ${item.status}`);
        if (modo !== "conferir" && item.verificacao) {
          console.log("  Situação encontrada antes da atualização:");
          imprimirAuditoria(item.competenciaAtual);
          console.log(`  Células sincronizadas: ${item.indicadoresAtualizados}`);
          if (item.correcoesNaoAplicadas) console.log(`  Diferenças preservadas: ${item.correcoesNaoAplicadas}. Consulte o PDF; use atualização completa para sincronizá-las.`);
          console.log("  Verificação depois da atualização:");
          imprimirAuditoria(item.verificacao, { listarZeros: false, listarDiferencas: true });
        } else {
          imprimirAuditoria(item.competenciaAtual);
        }
      } else if (entradaAtual?.relatorio || entradaAtual?.indisponivel) {
        item.status = "MES_NAO_DISPONIVEL_SMSRIO";
        console.log(`  ${comp.chave}: MES_NAO_DISPONIVEL_SMSRIO`);
        console.log(
          `  Histórico retroativo: ${item.resumoHistorico.conferidas}/${item.resumoHistorico.solicitadas} ` +
          "competência(s) conferida(s) com dados."
        );
      } else {
        item.status = "ERRO_SEM_ATUALIZAR";
        item.erro = erroAnoAtual?.stack ?? String(erroAnoAtual ?? `Relatório anual ${comp.ano} não extraído.`);
        console.error(`  ERRO NO ANO ATUAL: ${erroAnoAtual?.message ?? item.erro}`);
        console.log(
          `  Mesmo assim, histórico retroativo: ${item.resumoHistorico.conferidas}/${item.resumoHistorico.solicitadas} ` +
          "competência(s) conferida(s) com dados."
        );
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
  const possuiCompetenciaAtual = (item) => Number(item.competenciaAtual?.total ?? 0) > 0;
  const possuiHistoricoIncompleto = (item) =>
    (item.status === "MES_NAO_DISPONIVEL_SMSRIO" && possuiCompetenciaAtual(item)) ||
    (item.historicoSomenteLeitura ?? []).some((historico) => historico.status === "MES_NAO_DISPONIVEL");
  const semMes = log.unidades.filter((item) =>
    item.status === "MES_NAO_DISPONIVEL_SMSRIO" && !possuiCompetenciaAtual(item)
  );
  const historicoIncompleto = log.unidades.filter(possuiHistoricoIncompleto);
  const erros = log.unidades.filter((item) => item.status === "ERRO_SEM_ATUALIZAR");
  const concluidas = log.unidades.filter((item) =>
    ["CONFERIDO_SEM_ALTERAR", "ATUALIZADO_E_VERIFICADO", "ZERADOS_ATUALIZADOS_E_VERIFICADOS"].includes(item.status) ||
    (item.status === "MES_NAO_DISPONIVEL_SMSRIO" && possuiCompetenciaAtual(item))
  );
  console.log("\n===============================================");
  console.log("RESUMO FINAL");
  console.log(`Unidades solicitadas: ${log.unidades.length}`);
  console.log(`Unidades concluídas: ${concluidas.length}`);
  console.log(`Unidades sem ${nomeCompetencia(comp)} no SMS Rio: ${semMes.length}`);
  for (const item of semMes) console.log(`  - [${item.categoria}] ${item.aba} - ${item.nome}`);
  console.log(`Unidades com ${nomeCompetencia(comp)} localizada, mas com histórico incompleto: ${historicoIncompleto.length}`);
  for (const item of historicoIncompleto) console.log(`  - [${item.categoria}] ${item.aba} - ${item.nome}`);
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
    const infoPainel = await fs.stat(log.dashboardHtml).catch(() => null);
    if (infoPainel) {
      log.dashboardAtualizadoEm = infoPainel.mtime.toISOString();
      log.dashboardBytes = infoPainel.size;
    }
  } catch (erroDashboard) {
    log.erroDashboardHtml = erroDashboard.stack ?? String(erroDashboard);
    console.error(`Não foi possível atualizar o painel: ${erroDashboard.message}`);
  }
  await navegador.context.close();
  console.log(`\nLog: ${log.arquivo}`);
  await fs.writeFile(log.arquivo, JSON.stringify(log, null, 2), "utf8");
  if (log.relatorioHtml) console.log(`Relatório visual HTML: ${log.relatorioHtml}`);
  if (log.dashboardHtml) {
    console.log(`Painel: ${log.dashboardHtml}`);
    if (log.dashboardAtualizadoEm) console.log(`Painel regenerado em: ${log.dashboardAtualizadoEm}`);
    console.log("Se o painel já estava aberto no navegador, atualize a aba com Ctrl+F5 para carregar o novo arquivo.");
  }
}
