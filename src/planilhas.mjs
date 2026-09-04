import { colunaA1, MESES, normalizar, valorSms, valoresIguais } from "./util.mjs";
import { converterIndicador, formatoIndicador, valorDaCelula, valorParaCelula } from './indicadores.mjs';

function chave(grupo, campo) {
  return `${normalizar(grupo)}||${normalizar(campo)}`;
}

function nomeAbaA1(aba) {
  return `'${String(aba).replaceAll("'", "''")}'`;
}

function erroTemporario(erro) {
  const texto = String(erro?.message ?? erro);
  return erro?.code === 429 || /quota exceeded|rate limit|too many requests|user-rate/i.test(texto);
}

async function comTentativas(operacao, tentativa = 1) {
  try {
    return await operacao();
  } catch (erro) {
    if (!erroTemporario(erro) || tentativa >= 5) throw erro;
    const espera = 1500 * (2 ** (tentativa - 1));
    console.warn(`Google Sheets com limite tempor&aacute;rio. Nova tentativa em ${Math.round(espera / 1000)}s...`);
    await new Promise((resolver) => setTimeout(resolver, espera));
    return comTentativas(operacao, tentativa + 1);
  }
}

function reconhecerCabecalho(valor, comp) {
  const n = normalizar(valor).replaceAll(".", "");
  const mes = normalizar(MESES[comp.mes - 1]).slice(0, 3);
  return n.includes(mes) && (n.includes(String(comp.ano)) || n.includes(String(comp.ano).slice(-2)));
}

function competenciaDoCabecalho(valor) {
  const texto = normalizar(valor).replaceAll(".", "");
  const meses = [
    "janeiro", "fevereiro", "marco", "abril", "maio", "junho",
    "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"
  ];
  const indiceMes = meses.findIndex((mes) => texto.includes(mes.slice(0, 3)));
  if (indiceMes < 0) return null;
  const anos = texto.match(/\d{2,4}/g) ?? [];
  if (!anos.length) return null;
  const textoAno = anos.at(-1);
  const ano = textoAno.length === 2 ? 2000 + Number(textoAno) : Number(textoAno);
  if (!Number.isInteger(ano) || ano < 2000 || ano > 2100) return null;
  return { ano, mes: indiceMes + 1, competencia: `${ano}-${String(indiceMes + 1).padStart(2, "0")}` };
}

// Leitura independente do SMS Rio. Ela permite registrar o que existe no
// Google Sheets mesmo quando a competencia ainda nao aparece na plataforma.
export async function lerSnapshotAba(sheets, spreadsheetId, aba) {
  // Os meses da linha 3 podem ser datas verdadeiras com formato "jan./26".
  // Por isso o cabecalho precisa ser lido formatado; como valor bruto ele vira
  // um numero serial de data e deixa de ser reconhecido como competencia.
  const [respostaCabecalho, respostaValores] = await Promise.all([
    comTentativas(() => sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${nomeAbaA1(aba)}!3:3`,
      valueRenderOption: "FORMATTED_VALUE"
    })),
    comTentativas(() => sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${nomeAbaA1(aba)}!A4:ZZ500`,
      valueRenderOption: "UNFORMATTED_VALUE"
    }))
  ]);
  const cabecalhos = respostaCabecalho.data.values?.[0] ?? [];
  const linhasBrutas = respostaValores.data.values ?? [];
  const linhas = linhasBrutas
    .map((linha, indice) => ({ linha: indice + 4, grupo: linha[0] ?? "", campo: linha[1] ?? "", valores: linha }))
    .filter((linha) => linha.grupo || linha.campo);
  const colunasCompetencia = cabecalhos
    .map((cabecalho, indiceColuna) => ({ indiceColuna, comp: competenciaDoCabecalho(cabecalho) }))
    .filter((item) => item.comp);
  const formatosPorColuna = new Map();
  if (colunasCompetencia.length) {
    const respostaFormatos = await comTentativas(() => sheets.spreadsheets.get({
      spreadsheetId,
      ranges: colunasCompetencia.map(({ indiceColuna }) => {
        const coluna = colunaA1(indiceColuna);
        return `${nomeAbaA1(aba)}!${coluna}4:${coluna}500`;
      }),
      includeGridData: true,
      fields: 'sheets(data(startColumn,rowData(values(userEnteredFormat(numberFormat)))))'
    }));
    for (const bloco of respostaFormatos.data.sheets?.[0]?.data ?? []) {
      const indiceColuna = Number(bloco.startColumn ?? -1);
      formatosPorColuna.set(indiceColuna, bloco.rowData ?? []);
    }
  }
  const competencias = [];
  for (const { indiceColuna, comp } of colunasCompetencia) {
    const formatos = formatosPorColuna.get(indiceColuna) ?? [];
    const detalhesValores = linhas.map((linha) => ({
      linha: linha.linha,
      grupo: linha.grupo,
      campo: linha.campo,
      planilha: valorDaCelula(
        linha.campo,
        linha.valores[indiceColuna] ?? "",
        formatos[linha.linha - 4]?.values?.[0]?.userEnteredFormat?.numberFormat?.pattern ?? ''
      ),
      smsRio: ""
    }));
    competencias.push({
      ...comp,
      total: detalhesValores.length,
      planilhaDisponivel: detalhesValores.some((item) => item.planilha !== "" && item.planilha != null),
      detalhesValores
    });
  }
  return competencias;
}

export async function lerEstruturaAba(sheets, spreadsheetId, aba, comp) {
  const resposta = await comTentativas(() => sheets.spreadsheets.values.batchGet({
    spreadsheetId,
    ranges: [`${nomeAbaA1(aba)}!3:3`, `${nomeAbaA1(aba)}!A4:B500`],
    valueRenderOption: "FORMATTED_VALUE"
  }));
  const cabecalhos = resposta.data.valueRanges?.[0]?.values?.[0] ?? [];
  const indiceColuna = cabecalhos.findIndex((v) => reconhecerCabecalho(v, comp));
  if (indiceColuna < 0) throw new Error(`Coluna de ${comp.ano}-${String(comp.mes).padStart(2, "0")} não encontrada na aba ${aba}.`);
  const rotulos = resposta.data.valueRanges?.[1]?.values ?? [];
  const linhas = rotulos
    .map((r, i) => ({ linha: i + 4, grupo: r[0] ?? "", campo: r[1] ?? "" }))
    .filter((r) => r.grupo || r.campo);
  const coluna = colunaA1(indiceColuna);
  const grade = await comTentativas(() => sheets.spreadsheets.get({
    spreadsheetId,
    ranges: [`${nomeAbaA1(aba)}!${coluna}1:${coluna}500`],
    includeGridData: true,
    fields: 'sheets(properties(sheetId,title),data(rowData(values(userEnteredValue,userEnteredFormat(numberFormat,backgroundColor),note))))'
  }));
  const folha = grade.data.sheets?.find((s) => s.properties?.title === aba) ?? grade.data.sheets?.[0];
  const celulas = folha?.data?.[0]?.rowData ?? [];
  const formatosPorLinha = new Map(linhas.map((l) => {
    const c = celulas[l.linha - 1]?.values?.[0] ?? {};
    return [l.linha, { formato: c.userEnteredFormat?.numberFormat?.pattern ?? '',
      formula: c.userEnteredValue?.formulaValue ?? '', nota: c.note ?? '' }];
  }));
  return { indiceColuna, coluna, linhas, sheetId: folha?.properties?.sheetId, formatosPorLinha };
}

export function mapearRelatorio(relatorio, estrutura) {
  const origem = new Map(relatorio.rows.map((r) => [chave(r[0], r[1]), r]));
  const mapeados = estrutura.linhas.map((linha) => ({
    ...linha,
    origem: origem.get(chave(linha.grupo, linha.campo))
  }));
  const faltantes = mapeados.filter((m) => !m.origem);
  const extras = relatorio.rows.filter((r) => !estrutura.linhas.some((l) => chave(l.grupo, l.campo) === chave(r[0], r[1])));
  return { mapeados, faltantes, extras };
}

export async function auditarCompetencia(sheets, spreadsheetId, aba, estrutura, mapeados, relatorio) {
  const inicio = Math.min(...mapeados.map((m) => m.linha));
  const fim = Math.max(...mapeados.map((m) => m.linha));
  const range = `${nomeAbaA1(aba)}!${estrutura.coluna}${inicio}:${estrutura.coluna}${fim}`;
  const resposta = await comTentativas(() => sheets.spreadsheets.values.get({ spreadsheetId, range, valueRenderOption: "UNFORMATTED_VALUE" }));
  const existentes = resposta.data.values ?? [];
  return mapeados.map((m) => {
    const novo = converterIndicador(m.campo, m.origem[relatorio.indiceMes]);
    const meta = estrutura.formatosPorLinha?.get(m.linha);
    const atual = valorDaCelula(m.campo, existentes[m.linha - inicio]?.[0] ?? "", meta?.formato);
    return { ...m, atual, novo, diferente: !valoresIguais(atual, novo) };
  });
}

// Audita uma competencia usando uma fotografia ja lida da aba inteira.
// Isso evita uma chamada ao Google Sheets para cada mes historico.
export function auditarCompetenciaComSnapshot(snapshotCompetencia, mapeados, relatorio) {
  const existentes = new Map(
    (snapshotCompetencia?.detalhesValores ?? []).map((item) => [Number(item.linha), item.planilha])
  );
  return mapeados.map((m) => {
    const novo = converterIndicador(m.campo, m.origem[relatorio.indiceMes]);
    const atual = existentes.get(Number(m.linha)) ?? "";
    return { ...m, atual, novo, diferente: !valoresIguais(atual, novo) };
  });
}

export async function atualizarCompetencia(sheets, spreadsheetId, aba, estrutura, auditoria, {
  completo = false, classificacaoZeros = new Map()
} = {}) {
  const elegiveis = auditoria.filter((item) => {
    if (estrutura.formatosPorLinha?.get(item.linha)?.formula) return false;
    if (item.novo === '' || item.novo == null) return false;
    if (!item.diferente) return false;
    if (completo) return true;
    const vazio = item.atual === '' || item.atual == null;
    const zeroPendente = valoresIguais(item.atual, 0) && !valoresIguais(item.novo, 0) &&
      classificacaoZeros.get(item.linha) === 'POSSIVEL_PENDENCIA';
    return vazio || zeroPendente;
  });
  const data = elegiveis.map((item) => ({
    range: `${nomeAbaA1(aba)}!${estrutura.coluna}${item.linha}`,
    values: [[valorParaCelula(item.campo, item.novo)]]
  }));
  if (data.length) {
    await comTentativas(() => sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: { valueInputOption: "USER_ENTERED", data }
    }));
  }
  const vermelho = { red: 1, green: 0.91, blue: 0.91 };
  const amarelo = { red: 1, green: 0.96, blue: 0.78 };
  const marcacoes = auditoria.flatMap((item) => {
    const celulaPodeExibirZero = completo || item.atual === '' || item.atual == null || valoresIguais(item.atual, 0);
    const possivelPendente = celulaPodeExibirZero && valoresIguais(item.novo, 0) &&
      classificacaoZeros.get(item.linha) === 'POSSIVEL_PENDENCIA';
    const corrigido = elegiveis.includes(item) && !(item.atual === '' || item.atual == null);
    if (!possivelPendente && !corrigido) return [];
    const mensagem = possivelPendente
      ? '[ROBÔ MACRO] Possível pendência: valor atual zero e houve valor diferente de zero nos seis meses anteriores.'
      : `[ROBÔ MACRO] Valor sincronizado: ${item.atual} → ${item.novo}.`;
    return [{
      repeatCell: {
        range: { sheetId: estrutura.sheetId, startRowIndex: item.linha - 1, endRowIndex: item.linha,
          startColumnIndex: estrutura.indiceColuna, endColumnIndex: estrutura.indiceColuna + 1 },
        cell: { userEnteredFormat: { numberFormat: formatoIndicador(item.campo, item.novo),
          backgroundColor: possivelPendente ? vermelho : amarelo }, note: mensagem },
        fields: 'userEnteredFormat.numberFormat,userEnteredFormat.backgroundColor,note'
      }
    }];
  });
  // Formata também os valores escritos sem destaque.
  const candidatosFormato = completo
    ? auditoria.filter((item) => !estrutura.formatosPorLinha?.get(item.linha)?.formula && item.novo !== '' && item.novo != null)
    : elegiveis;
  const formatos = candidatosFormato.filter((item) => !marcacoes.some((r) => r.repeatCell.range.startRowIndex === item.linha - 1))
    .map((item) => ({ repeatCell: { range: { sheetId: estrutura.sheetId,
      startRowIndex: item.linha - 1, endRowIndex: item.linha, startColumnIndex: estrutura.indiceColuna,
      endColumnIndex: estrutura.indiceColuna + 1 }, cell: { userEnteredFormat: { numberFormat: formatoIndicador(item.campo, item.novo) } },
      fields: 'userEnteredFormat.numberFormat' } }));
  if (estrutura.sheetId != null && (marcacoes.length || formatos.length)) {
    await comTentativas(() => sheets.spreadsheets.batchUpdate({ spreadsheetId,
      requestBody: { requests: [...marcacoes, ...formatos] } }));
    for (const item of auditoria) {
      if (elegiveis.includes(item) || marcacoes.some((r) => r.repeatCell.range.startRowIndex === item.linha - 1)) {
        const meta = estrutura.formatosPorLinha?.get(item.linha) ?? {};
        estrutura.formatosPorLinha?.set(item.linha, { ...meta, formato: formatoIndicador(item.campo, item.novo).pattern });
      }
    }
  }
  return {
    intervalo: elegiveis.length
      ? `${nomeAbaA1(aba)}!${estrutura.coluna}${elegiveis[0].linha}:${estrutura.coluna}${elegiveis.at(-1).linha}`
      : null,
    quantidade: elegiveis.length,
    linhas: elegiveis.map((item) => item.linha)
  };
}

export async function validarAbasConfiguradas(sheets, workbooks, unidades) {
  const resultado = {};
  for (const [nome, spreadsheetId] of Object.entries(workbooks)) {
    const resposta = await comTentativas(() => sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties.title" }));
    const abas = (resposta.data.sheets ?? []).map((s) => s.properties.title);
    const configuradas = unidades.filter((u) => u.workbook === nome).map((u) => u.aba);
    const ausentes = configuradas.filter((aba) => !abas.includes(aba));
    const naoConfiguradas = abas.filter((aba) =>
      !normalizar(aba).startsWith("consolidado") && !configuradas.includes(aba)
    );
    resultado[nome] = { abas, configuradas, ausentes, naoConfiguradas };
  }
  return resultado;
}
