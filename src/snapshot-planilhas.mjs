import fs from "node:fs/promises";
import path from "node:path";
import { garantirDiretorio } from "./util.mjs";
import { lerSnapshotAba } from "./planilhas.mjs";

const nomeArquivo = "snapshot-planilhas.json";

function chave(item) {
  return `${item.categoria}|${item.sigla}|${item.competencia}`;
}

export async function carregarSnapshotPlanilhas(raiz) {
  const arquivo = path.join(raiz, "dados", nomeArquivo);
  try {
    return JSON.parse(await fs.readFile(arquivo, "utf8"));
  } catch {
    return { atualizadoEm: null, registros: [] };
  }
}

export async function salvarSnapshotPlanilhas(raiz, snapshot) {
  const pasta = path.join(raiz, "dados");
  await garantirDiretorio(pasta);
  const arquivo = path.join(pasta, nomeArquivo);
  await fs.writeFile(arquivo, JSON.stringify(snapshot, null, 2), "utf8");
  return arquivo;
}

export async function coletarSnapshotUnidade(sheets, config, unidade) {
  const spreadsheetId = config.workbooks[unidade.workbook];
  if (!spreadsheetId) throw new Error(`Workbook nao configurado: ${unidade.workbook}`);
  const competencias = await lerSnapshotAba(sheets, spreadsheetId, unidade.aba);
  return competencias.map((foto) => ({
    categoria: unidade.categoria,
    sigla: unidade.aba,
    unidade: unidade.nome,
    ...foto
  }));
}

export async function atualizarSnapshotUnidade(raiz, sheets, config, unidade) {
  const snapshot = await carregarSnapshotPlanilhas(raiz);
  const novos = await coletarSnapshotUnidade(sheets, config, unidade);
  const mapa = new Map((snapshot.registros ?? []).map((item) => [chave(item), item]));
  for (const item of novos) mapa.set(chave(item), item);
  const atualizado = {
    atualizadoEm: new Date().toISOString(),
    registros: [...mapa.values()].sort((a, b) =>
      b.competencia.localeCompare(a.competencia) || a.categoria.localeCompare(b.categoria) || a.sigla.localeCompare(b.sigla)
    )
  };
  await salvarSnapshotPlanilhas(raiz, atualizado);
  return novos;
}
