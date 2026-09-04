import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { atualizarCompetencia, lerSnapshotAba, mapearRelatorio } from "../src/planilhas.mjs";
import { competenciaDisponivelNaRespostaDireta } from "../src/smsrio.mjs";
import { competencia, competenciaAnterior, normalizar, valorSms } from "../src/util.mjs";
import { converterIndicador, formatoIndicador, tipoIndicador } from "../src/indicadores.mjs";
import { compararFotografias, prazoCompetencia } from "../src/monitoramento.mjs";
import { identificarPendenciasProvaveis } from "../src/relatorio-execucao.mjs";

test("normaliza acentos e espaços", () => {
  assert.equal(normalizar("  Clínica   Médica "), "clinica medica");
});

test("interpreta competência e cruza o ano", () => {
  const janeiro = competencia("2026-01");
  assert.deepEqual(competenciaAnterior(janeiro, 2), { ano: 2025, mes: 11, chave: "2025-11" });
});

test("classifica e converte percentuais e taxas por mil sem depender da magnitude", () => {
  assert.equal(tipoIndicador("Taxa de ocupação hospitalar"), "percentual");
  assert.equal(tipoIndicador("Indicador de Queda"), "permil");
  assert.equal(tipoIndicador("Pneumomia Associada à Ventilação Mecânica (PAV)"), "permil");
  assert.equal(converterIndicador("Taxa de ocupação hospitalar", "75"), 0.75);
  assert.equal(converterIndicador("Indicador de Queda", "2,5"), 0.0025);
  assert.deepEqual(formatoIndicador("Percentual de suspensão"), { type: "PERCENT", pattern: "0.00%" });
  assert.deepEqual(formatoIndicador("Duração de utilização do centro cirúrgico"),
    { type: "NUMBER", pattern: "#,##0.########" });
  assert.deepEqual(formatoIndicador("Total de Internações", 351), { type: "NUMBER", pattern: "#,##0" });
  assert.deepEqual(formatoIndicador("Índice de Giro", 2.4), { type: "NUMBER", pattern: "#,##0.########" });
});

test("só confirma atraso quando duas fotografias consecutivas são posteriores ao dia 10", () => {
  const unidade = { categoria: "Geral", aba: "HFA", nome: "Hospital Federal de Andaraí" };
  const resumo = { detalhesValores: [{ linha: 4, grupo: "Capital Humano", campo: "Funcionários", smsRio: 10 }] };
  const anteriorAntes = { possuiDados: false, valores: [], observadoEm: "2026-09-09T12:00:00-03:00" };
  const primeiroDepois = compararFotografias("2026-08", unidade, anteriorAntes, resumo, "2026-09-11T09:00:00-03:00")[0];
  assert.equal(primeiroDepois.aposMarco, true);
  assert.equal(primeiroDepois.confirmadoForaPrazo, false);
  const anteriorDepois = { possuiDados: false, valores: [], observadoEm: "2026-09-11T08:00:00-03:00" };
  const confirmado = compararFotografias("2026-08", unidade, anteriorDepois, resumo, "2026-09-12T09:00:00-03:00")[0];
  assert.equal(confirmado.confirmadoForaPrazo, true);
  assert.equal(prazoCompetencia("2026-08").fechamento, "2026-09-10");
  assert.equal(prazoCompetencia("2026-08").prazoPreenchimento, "2026-09-05");
  assert.equal(prazoCompetencia("2026-08").pendenciaDesde, "2026-09-06T00:00:00-03:00");
});

test("converte formatos do SMS Rio em números", () => {
  assert.equal(valorSms("90.5%"), 0.905);
  assert.equal(valorSms("0.380‰"), 0.00038);
  assert.equal(valorSms("50.147"), 50147);
  assert.equal(valorSms("3.5"), 3.5);
  assert.equal(valorSms("1193:36:00"), 49.733333333333334);
});

test("mapeia por grupo e campo normalizados", () => {
  const relatorio = { rows: [["Internação", "Clínica Médica", "10"]] };
  const estrutura = { linhas: [{ linha: 4, grupo: " Internacao ", campo: "Clinica   Medica" }] };
  const mapa = mapearRelatorio(relatorio, estrutura);
  assert.equal(mapa.faltantes.length, 0);
  assert.equal(mapa.extras.length, 0);
  assert.equal(mapa.mapeados[0].origem[2], "10");
});

test("configura 36 unidades sem duplicar categoria e aba", async () => {
  const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const unidades = JSON.parse(await fs.readFile(path.join(raiz, "config", "unidades.json"), "utf8"));
  assert.equal(unidades.length, 36);
  const chaves = unidades.map((u) => `${u.categoria}||${u.aba}`);
  assert.equal(new Set(chaves).size, chaves.length);
  assert.equal(unidades.filter((u) => u.categoria === "Geral").length, 17);
  assert.equal(unidades.filter((u) => u.categoria === "Pediatria").length, 5);
  assert.equal(unidades.filter((u) => u.categoria === "Maternidade").length, 14);
});

test("consulta direta distingue mês ausente de mês publicado com zeros", () => {
  const dados = {
    id_indicador: { "202607": "10", "202608": "11" },
    enviado: { "202607": "1", "202608": "1" },
    ch_tt_funcionarios: { "202607": "25", "202608": "0" }
  };
  assert.equal(competenciaDisponivelNaRespostaDireta(dados, competencia("2026-08")), true);
  assert.equal(competenciaDisponivelNaRespostaDireta(dados, competencia("2026-09")), false);
});

test("fotografia da planilha normaliza uma taxa por mil formatada", async () => {
  const sheets = { spreadsheets: {
    values: { get: async ({ range }) => range.endsWith("3:3")
      ? { data: { values: [["Grupo", "Indicador", "jan./26"]] } }
      : { data: { values: [["Qualidade", "Indicador de Queda", 2.5]] } } },
    get: async () => ({ data: { sheets: [{ data: [{ startColumn: 2, rowData: [{ values: [{
      userEnteredFormat: { numberFormat: { pattern: '0.00"‰"' } }
    }] }] }] }] } })
  } };
  const fotos = await lerSnapshotAba(sheets, "teste", "HFA");
  assert.equal(fotos[0].detalhesValores[0].planilha, 0.0025);
});

test("atualização de pendências preserva fórmulas e escreve somente zero suspeito", async () => {
  const valores = [];
  const formatacoes = [];
  const sheets = { spreadsheets: {
    values: { batchUpdate: async (pedido) => { valores.push(pedido); } },
    batchUpdate: async (pedido) => { formatacoes.push(pedido); }
  } };
  const estrutura = { coluna: "C", indiceColuna: 2, sheetId: 7,
    formatosPorLinha: new Map([[4, { formato: "", formula: "" }], [5, { formato: "", formula: "=1+1" }]]) };
  const auditoria = [
    { linha: 4, grupo: "Produção", campo: "Total", atual: 0, novo: 10, diferente: true },
    { linha: 5, grupo: "Produção", campo: "Taxa de ocupação", atual: 0, novo: 0.8, diferente: true }
  ];
  const r = await atualizarCompetencia(sheets, "teste", "HFA", estrutura, auditoria,
    { classificacaoZeros: new Map([[4, "POSSIVEL_PENDENCIA"], [5, "POSSIVEL_PENDENCIA"]]) });
  assert.deepEqual(r.linhas, [4]);
  assert.equal(valores[0].requestBody.data.length, 1);
  assert.equal(formatacoes[0].requestBody.requests.length, 1);
});

test("relatório considera pendente só a interrupção sustentada pelos últimos seis meses", () => {
  const indicador = (campo, smsRio) => ({ linha: campo === "Internações" ? 4 : 5,
    grupo: "Produção", campo, smsRio });
  const item = {
    competenciaAtual: { detalhesValores: [indicador("Internações", 0), indicador("Cirurgias", 12)] },
    historicoSomenteLeitura: [
      { competencia: "2026-07", detalhesValores: [indicador("Internações", 18)] },
      { competencia: "2026-06", detalhesValores: [indicador("Internações", 20)] },
      { competencia: "2026-05", detalhesValores: [indicador("Internações", 17)] },
      { competencia: "2026-04", detalhesValores: [indicador("Internações", 0)] },
      { competencia: "2026-03", detalhesValores: [indicador("Internações", 19)] },
      { competencia: "2026-02", detalhesValores: [indicador("Internações", "")] }
    ]
  };
  const pendencias = identificarPendenciasProvaveis(item);
  assert.equal(pendencias.length, 1);
  assert.equal(pendencias[0].campo, "Internações");
  assert.equal(pendencias[0].mesesNaoZerados, 4);
});

test("relatório não acusa pendência quando o mês anterior também estava zerado", () => {
  const indicador = (smsRio) => ({ linha: 4, grupo: "Produção", campo: "Internações", smsRio });
  const item = {
    competenciaAtual: { detalhesValores: [indicador(0)] },
    historicoSomenteLeitura: [0, 20, 18, 17, 16, 15].map((smsRio, i) => ({
      competencia: `2026-0${7 - i}`, detalhesValores: [indicador(smsRio)]
    }))
  };
  assert.deepEqual(identificarPendenciasProvaveis(item), []);
});
