import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { abrirSmsRio, consultarRelatorio } from "../src/smsrio.mjs";
import { carregarCredenciais } from "../src/credenciais.mjs";
import { competencia, garantirDiretorio, lerJson } from "../src/util.mjs";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const config = await lerJson(path.join(raiz, "config", "config.json"));
const unidades = await lerJson(path.join(raiz, "config", "unidades.json"));
const comp = competencia(process.argv[2] ?? "2026-08");
const sigla = String(process.argv[3] ?? "HMMC").trim().toLowerCase();
const categoria = String(process.argv[4] ?? "Geral").trim().toLowerCase();
const unidade = unidades.find((item) =>
  item.aba.toLowerCase() === sigla && item.categoria.toLowerCase() === categoria
);

if (!unidade) throw new Error(`Unidade não configurada: ${categoria}/${sigla}.`);

function urlSegura(valor) {
  try {
    const url = new URL(valor);
    const parametrosPermitidos = new Set(["tabela", "cnes", "vigencia"]);
    for (const chave of [...url.searchParams.keys()]) {
      if (!parametrosPermitidos.has(chave)) url.searchParams.set(chave, "[oculto]");
    }
    return url.toString();
  } catch {
    return String(valor).split("?")[0];
  }
}

function hash(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function pontuarCandidato(item) {
  let pontos = 0;
  if (/\/relatorio\/get_dados_por_vigencia/i.test(item.url)) pontos += 30;
  if (/attachment|filename/i.test(item.disposicao)) pontos += 20;
  if (/excel|spreadsheet|octet-stream|ms-excel/i.test(item.tipoConteudo)) pontos += 15;
  if (/export|excel|xls|download/i.test(item.url)) pontos += 8;
  if (/relatorio|mensal|macroindicador/i.test(item.url)) pontos += 3;
  if (item.status >= 200 && item.status < 300) pontos += 2;
  return pontos;
}

async function resumirRespostaSegura(item) {
  if (!/get_unidades_grupo|get_dados_por_vigencia/i.test(item.url)) return null;
  const texto = await item.resposta.text().catch(() => "");
  let json;
  try {
    json = JSON.parse(texto);
  } catch {
    return { tipo: "texto", bytes: Buffer.byteLength(texto), inicio: texto.slice(0, 200) };
  }
  if (/get_unidades_grupo/i.test(item.url)) {
    return { tipo: Array.isArray(json) ? "array" : typeof json, conteudo: json };
  }
  const camposPermitidos = Object.entries(json ?? {})
    .filter(([chave]) => !/cpf|senha|token|session/i.test(chave))
    .slice(0, 25);
  const metadados = Object.fromEntries(
    Object.entries(json ?? {}).filter(([chave]) => ["cnes", "enviado", "datahora_enviado"].includes(chave))
  );
  return {
    tipo: Array.isArray(json) ? "array" : typeof json,
    amostra: Object.fromEntries(camposPermitidos),
    metadados
  };
}

const pastaTemporaria = path.join(os.tmpdir(), "smsrio-diagnostico-endpoint");
await garantirDiretorio(pastaTemporaria);
const credenciais = await carregarCredenciais(raiz);
const navegador = await abrirSmsRio({
  url: config.smsRioUrl,
  loginUrl: config.smsRioLoginUrl,
  profileDir: path.resolve(raiz, config.browserProfileDir),
  credenciais,
  modoNavegador: "visivel"
});

const observados = [];
const candidatos = [];
const inicio = Date.now();

navegador.page.on("response", async (resposta) => {
  try {
    const requisicao = resposta.request();
    const tipoRecurso = requisicao.resourceType();
    if (!["xhr", "fetch", "document", "other"].includes(tipoRecurso)) return;
    const cabecalhos = await resposta.allHeaders();
    const item = {
      metodo: requisicao.method(),
      url: urlSegura(requisicao.url()),
      tipoRecurso,
      status: resposta.status(),
      tipoConteudo: cabecalhos["content-type"] ?? "",
      disposicao: cabecalhos["content-disposition"] ?? "",
      requisicao,
      resposta
    };
    observados.push(item);
    if (pontuarCandidato(item) >= 8) candidatos.push(item);
  } catch {
    // Uma resposta encerrada durante o download não deve cancelar o diagnóstico.
  }
});

let relatorio = null;
try {
  console.log(`Testando ${unidade.categoria}/${unidade.aba} em ${comp.chave}, sem acessar Google Sheets...`);
  relatorio = await consultarRelatorio(
    navegador.page, unidade, comp, pastaTemporaria, { validarCompetencia: false }
  );
  await navegador.page.waitForTimeout(1500);

  const arquivoOriginal = await fs.readFile(relatorio.arquivo);
  const ordenados = [...candidatos].sort((a, b) => pontuarCandidato(b) - pontuarCandidato(a));
  const candidato = ordenados[0];
  let resultadoDireto;

  if (candidato) {
    const inicioDireto = Date.now();
    const respostaDireta = await navegador.context.request.fetch(candidato.requisicao, { timeout: 60000 });
    const corpoDireto = await respostaDireta.body();
    const corpoOriginalApi = await candidato.resposta.body().catch(() => null);
    let estruturaJson = null;
    try {
      const json = JSON.parse(corpoDireto.toString("utf8"));
      if (Array.isArray(json)) {
        estruturaJson = { tipo: "array", quantidade: json.length };
      } else if (json && typeof json === "object") {
        estruturaJson = {
          tipo: "objeto",
          chaves: Object.keys(json),
          colecoes: Object.fromEntries(
            Object.entries(json)
              .filter(([, valor]) => Array.isArray(valor))
              .map(([chave, valor]) => [chave, valor.length])
          )
        };
      }
    } catch {
      estruturaJson = { tipo: "texto" };
    }
    resultadoDireto = {
      viavel: respostaDireta.ok() && corpoDireto.length > 0,
      status: respostaDireta.status(),
      url: candidato.url,
      metodo: candidato.metodo,
      tipoConteudo: respostaDireta.headers()["content-type"] ?? candidato.tipoConteudo,
      duracaoMs: Date.now() - inicioDireto,
      bytes: corpoDireto.length,
      mesmaRespostaDaTela: corpoOriginalApi ? hash(corpoDireto) === hash(corpoOriginalApi) : null,
      indicadoresNoExcel: relatorio.rows.length,
      estruturaJson
    };
  } else {
    resultadoDireto = {
      viavel: false,
      motivo: "Nenhuma resposta de exportação foi identificada automaticamente."
    };
  }

  const carimbo = new Date().toISOString().replace(/[:.]/g, "-");
  const pastaDiagnostico = path.join(raiz, "diagnosticos");
  await garantirDiretorio(pastaDiagnostico);
  const arquivoDiagnostico = path.join(pastaDiagnostico, `endpoint-smsrio-${carimbo}.json`);
  const respostasSeguras = [];
  for (const item of observados) {
    const resumo = await resumirRespostaSegura(item);
    if (resumo) respostasSeguras.push({ url: item.url, resumo });
  }
  const diagnostico = {
    criadoEm: new Date().toISOString(),
    unidade: { categoria: unidade.categoria, aba: unidade.aba, nome: unidade.nome },
    competencia: comp.chave,
    duracaoFluxoVisualMs: Date.now() - inicio,
    download: { bytes: arquivoOriginal.length, hashSha256: hash(arquivoOriginal) },
    resultadoDireto,
    respostasSeguras,
    respostasObservadas: observados.map(({ requisicao, resposta, ...item }) => ({
      ...item,
      pontuacao: pontuarCandidato(item)
    }))
  };
  await fs.writeFile(arquivoDiagnostico, JSON.stringify(diagnostico, null, 2), "utf8");

  console.log("\nRESULTADO DO PILOTO");
  console.log(`Fluxo visual: ${diagnostico.duracaoFluxoVisualMs} ms`);
  console.log(`Consulta direta viável: ${resultadoDireto.viavel ? "SIM" : "NÃO CONFIRMADA"}`);
  if (resultadoDireto.status) console.log(`Status direto: ${resultadoDireto.status}`);
  if (resultadoDireto.duracaoMs != null) console.log(`Tempo direto: ${resultadoDireto.duracaoMs} ms`);
  if (resultadoDireto.mesmaRespostaDaTela != null) {
    console.log(`Resposta idêntica à usada pela tela: ${resultadoDireto.mesmaRespostaDaTela ? "SIM" : "NÃO"}`);
  }
  if (resultadoDireto.estruturaJson) console.log(`Estrutura: ${JSON.stringify(resultadoDireto.estruturaJson)}`);
  console.log(`Diagnóstico: ${arquivoDiagnostico}`);
} finally {
  await navegador.context.close().catch(() => {});
  if (relatorio?.arquivo) await fs.unlink(relatorio.arquivo).catch(() => {});
}
