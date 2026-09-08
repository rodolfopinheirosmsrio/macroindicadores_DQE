import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { Readable } from "node:stream";
import { obterOuCriarPasta } from "./google.mjs";
import { garantirDiretorio } from "./util.mjs";

const CACHE_NOME = "estado-equipe-cache.json";
const SNAPSHOT_NOME = "snapshot-planilhas.json";

function cfgEstado(config) {
  return {
    habilitado: config.estadoEquipe?.habilitado !== false,
    pastaNome: config.estadoEquipe?.pastaNome ?? "Estado compartilhado do painel",
    logsPastaNome: config.estadoEquipe?.logsPastaNome ?? "Logs de execucao",
    snapshotsPastaNome: config.estadoEquipe?.snapshotsPastaNome ?? "Snapshots por unidade"
  };
}

function normalizarNomeArquivo(texto) {
  return String(texto ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

function chaveUnidade(item) {
  return `${item?.categoria ?? ""}|${item?.sigla ?? item?.aba ?? ""}`;
}

function chaveRegistro(item) {
  return `${item?.categoria ?? ""}|${item?.sigla ?? ""}|${item?.competencia ?? ""}`;
}

function usuarioWindows() {
  return String(process.env.USERNAME ?? process.env.USER ?? os.userInfo().username ?? "usuario").trim();
}

async function lerJsonSeguro(arquivo, padrao) {
  try { return JSON.parse(await fs.readFile(arquivo, "utf8")); }
  catch { return padrao; }
}

async function listarArquivosDrive(drive, pastaId, { prefixo = "", camposExtras = "" } = {}) {
  const arquivos = [];
  let pageToken;
  do {
    const q = [
      `'${pastaId}' in parents`,
      "trashed = false",
      prefixo ? `name contains '${String(prefixo).replaceAll("'", "\\'")}'` : null
    ].filter(Boolean).join(" and ");
    const fields = `nextPageToken,files(id,name,modifiedTime,size,mimeType,appProperties${camposExtras ? `,${camposExtras}` : ""})`;
    const resposta = await drive.files.list({ q, spaces: "drive", pageSize: 1000, pageToken, fields });
    arquivos.push(...(resposta.data.files ?? []));
    pageToken = resposta.data.nextPageToken ?? undefined;
  } while (pageToken);
  return arquivos;
}

async function baixarJsonDrive(drive, fileId) {
  const resposta = await drive.files.get(
    { fileId, alt: "media" },
    { responseType: "arraybuffer" }
  );
  const texto = Buffer.from(resposta.data).toString("utf8");
  return JSON.parse(texto);
}

async function baixarArquivoDrive(drive, fileId, destino) {
  const resposta = await drive.files.get(
    { fileId, alt: "media" },
    { responseType: "arraybuffer" }
  );
  await garantirDiretorio(path.dirname(destino));
  await fs.writeFile(destino, Buffer.from(resposta.data));
}

async function criarJsonDrive(drive, pastaId, nome, valor, appProperties = {}) {
  const corpo = JSON.stringify(valor, null, 2);
  const resposta = await drive.files.create({
    requestBody: {
      name: nome,
      parents: [pastaId],
      mimeType: "application/json",
      appProperties
    },
    media: { mimeType: "application/json", body: Readable.from([corpo]) },
    fields: "id,name,modifiedTime,size,appProperties"
  });
  return resposta.data;
}

async function atualizarJsonDrive(drive, fileId, valor, appProperties = {}) {
  const corpo = JSON.stringify(valor, null, 2);
  const resposta = await drive.files.update({
    fileId,
    requestBody: { mimeType: "application/json", appProperties },
    media: { mimeType: "application/json", body: Readable.from([corpo]) },
    fields: "id,name,modifiedTime,size,appProperties"
  });
  return resposta.data;
}

async function carregarCache(raiz) {
  return lerJsonSeguro(path.join(raiz, "dados", CACHE_NOME), {
    versao: 1,
    atualizadoEm: null,
    snapshots: {}
  });
}

async function salvarCache(raiz, cache) {
  const pasta = path.join(raiz, "dados");
  await garantirDiretorio(pasta);
  cache.versao = 1;
  cache.atualizadoEm = new Date().toISOString();
  await fs.writeFile(path.join(pasta, CACHE_NOME), JSON.stringify(cache, null, 2), "utf8");
}

export async function obterPastasEstadoEquipe(drive, config) {
  const cfg = cfgEstado(config);
  if (!cfg.habilitado) return null;
  if (!config.driveRootFolderId) throw new Error("driveRootFolderId nao configurado para o estado compartilhado.");
  const raizId = await obterOuCriarPasta(drive, config.driveRootFolderId, cfg.pastaNome);
  const logsId = await obterOuCriarPasta(drive, raizId, cfg.logsPastaNome);
  const snapshotsId = await obterOuCriarPasta(drive, raizId, cfg.snapshotsPastaNome);
  return { raizId, logsId, snapshotsId, ...cfg };
}

async function sincronizarLogs({ drive, raiz, pastas, permitirUploadLocal = true }) {
  const pastaLocal = path.join(raiz, "logs");
  await garantirDiretorio(pastaLocal);
  const locais = (await fs.readdir(pastaLocal).catch(() => []))
    .filter((nome) => /^execucao-.*\.json$/i.test(nome));
  const remotos = await listarArquivosDrive(drive, pastas.logsId, { prefixo: "execucao-" });
  const porNomeRemoto = new Map(remotos.map((item) => [item.name, item]));
  let enviados = 0;
  let baixados = 0;

  if (permitirUploadLocal) {
    for (const nome of locais) {
      if (porNomeRemoto.has(nome)) continue;
      const arquivo = path.join(pastaLocal, nome);
      const log = await lerJsonSeguro(arquivo, null);
      if (!log) continue;
      const criado = await criarJsonDrive(drive, pastas.logsId, nome, log, {
        tipo: "execucao",
        competencia: String(log.competencia ?? ""),
        usuario: String(log.usuarioWindows ?? "legado").slice(0, 120)
      });
      porNomeRemoto.set(nome, criado);
      enviados++;
    }
  }

  const nomesLocais = new Set(await fs.readdir(pastaLocal).catch(() => []));
  for (const remoto of remotos) {
    if (nomesLocais.has(remoto.name)) continue;
    await baixarArquivoDrive(drive, remoto.id, path.join(pastaLocal, remoto.name));
    baixados++;
  }

  return { enviados, baixados, totalRemoto: Math.max(remotos.length + enviados, porNomeRemoto.size) };
}

function gruposSnapshot(snapshot) {
  const grupos = new Map();
  for (const item of snapshot?.registros ?? []) {
    const chave = chaveUnidade(item);
    if (!grupos.has(chave)) grupos.set(chave, []);
    grupos.get(chave).push(item);
  }
  return grupos;
}

function nomeSnapshotUnidade(chave, atualizadoEm = new Date().toISOString()) {
  const [categoria, sigla] = chave.split("|");
  const carimbo = normalizarNomeArquivo(atualizadoEm);
  const usuario = normalizarNomeArquivo(usuarioWindows()).slice(0, 30) || "usuario";
  return `snapshot-${normalizarNomeArquivo(categoria)}-${normalizarNomeArquivo(sigla)}-${carimbo}-${usuario}.json`;
}

function remotoMaisNovoPorUnidade(remotos) {
  const mapa = new Map();
  for (const item of remotos) {
    const chave = item.appProperties?.chave;
    if (!chave) continue;
    const anterior = mapa.get(chave);
    const momento = String(item.modifiedTime ?? "");
    const momentoAnterior = String(anterior?.modifiedTime ?? "");
    if (!anterior || momento > momentoAnterior || (momento === momentoAnterior && String(item.id) > String(anterior.id))) {
      mapa.set(chave, item);
    }
  }
  return mapa;
}

async function sincronizarSnapshots({ drive, raiz, pastas, permitirSeedLocal = true }) {
  const arquivoSnapshot = path.join(raiz, "dados", SNAPSHOT_NOME);
  const snapshotLocal = await lerJsonSeguro(arquivoSnapshot, { atualizadoEm: null, registros: [] });
  const gruposLocais = gruposSnapshot(snapshotLocal);
  const cache = await carregarCache(raiz);
  cache.snapshots ??= {};

  let remotos = await listarArquivosDrive(drive, pastas.snapshotsId, { prefixo: "snapshot-" });
  let maisNovos = remotoMaisNovoPorUnidade(remotos);
  let enviados = 0;
  let baixados = 0;

  // Migracao inicial: o computador que ja possui o historico completo divide o
  // snapshot grande em um arquivo por unidade. Depois disso cada execucao cria
  // uma nova versao somente das unidades consultadas. Os arquivos sao imutaveis,
  // evitando sobrescrita quando duas pessoas executam o robo ao mesmo tempo.
  if (permitirSeedLocal) {
    for (const [chave, registros] of gruposLocais) {
      if (maisNovos.has(chave)) continue;
      const [categoria, sigla] = chave.split("|");
      const atualizadoEm = snapshotLocal.atualizadoEm ?? new Date().toISOString();
      const payload = {
        versao: 2,
        categoria,
        sigla,
        atualizadoEm,
        usuarioWindows: usuarioWindows(),
        registros
      };
      const nome = nomeSnapshotUnidade(chave, atualizadoEm);
      const criado = await criarJsonDrive(drive, pastas.snapshotsId, nome, payload, {
        tipo: "snapshot-unidade-v2",
        chave: chave.slice(0, 120),
        categoria: String(categoria).slice(0, 120),
        sigla: String(sigla).slice(0, 120),
        estadoAtualizadoEm: atualizadoEm,
        usuario: usuarioWindows().slice(0, 120)
      });
      remotos.push(criado);
      maisNovos.set(chave, criado);
      cache.snapshots[chave] = {
        fileId: criado.id,
        modifiedTime: criado.modifiedTime,
        atualizadoEm
      };
      enviados++;
    }
  }

  const mapaRegistros = new Map((snapshotLocal.registros ?? []).map((item) => [chaveRegistro(item), item]));
  const chavesLocais = new Set(gruposLocais.keys());

  // Baixa apenas a versao mais recente de cada unidade e somente quando ela
  // mudou desde a ultima sincronizacao deste computador.
  for (const [chave, remoto] of maisNovos) {
    const cacheInfo = cache.snapshots[chave];
    const podePular = Boolean(
      chavesLocais.has(chave) && cacheInfo?.fileId === remoto.id && cacheInfo?.modifiedTime === remoto.modifiedTime
    );
    if (podePular) continue;

    const payload = await baixarJsonDrive(drive, remoto.id);
    if (!payload.categoria || !payload.sigla || !Array.isArray(payload.registros)) continue;

    for (const k of [...mapaRegistros.keys()]) {
      if (k.startsWith(`${chave}|`)) mapaRegistros.delete(k);
    }
    for (const item of payload.registros) mapaRegistros.set(chaveRegistro(item), item);
    chavesLocais.add(chave);
    cache.snapshots[chave] = {
      fileId: remoto.id,
      modifiedTime: remoto.modifiedTime,
      atualizadoEm: payload.atualizadoEm ?? remoto.appProperties?.estadoAtualizadoEm ?? null
    };
    baixados++;
  }

  const registros = [...mapaRegistros.values()].sort((a, b) =>
    String(b.competencia ?? "").localeCompare(String(a.competencia ?? "")) ||
    String(a.categoria ?? "").localeCompare(String(b.categoria ?? "")) ||
    String(a.sigla ?? "").localeCompare(String(b.sigla ?? ""))
  );
  if (baixados || enviados || !await fs.stat(arquivoSnapshot).catch(() => null)) {
    await garantirDiretorio(path.dirname(arquivoSnapshot));
    await fs.writeFile(arquivoSnapshot, JSON.stringify({
      atualizadoEm: new Date().toISOString(),
      origem: "ESTADO_COMPARTILHADO_EQUIPE",
      registros
    }, null, 2), "utf8");
  }
  await salvarCache(raiz, cache);

  return { enviados, baixados, totalRemoto: remotos.length, unidadesRemotas: maisNovos.size, cache };
}

export async function publicarSnapshotsUnidades({ drive, raiz, pastas, unidades }) {
  if (!pastas || !unidades?.length) return { enviados: 0 };
  const snapshot = await lerJsonSeguro(path.join(raiz, "dados", SNAPSHOT_NOME), { registros: [] });
  const grupos = gruposSnapshot(snapshot);
  const cache = await carregarCache(raiz);
  cache.snapshots ??= {};
  let enviados = 0;

  for (const unidade of unidades) {
    const chave = `${unidade.categoria}|${unidade.aba}`;
    const registros = grupos.get(chave);
    if (!registros?.length) continue;
    const atualizadoEm = new Date().toISOString();
    const payload = {
      versao: 2,
      categoria: unidade.categoria,
      sigla: unidade.aba,
      unidade: unidade.nome,
      atualizadoEm,
      usuarioWindows: usuarioWindows(),
      registros
    };
    const nome = nomeSnapshotUnidade(chave, atualizadoEm);
    const salvo = await criarJsonDrive(drive, pastas.snapshotsId, nome, payload, {
      tipo: "snapshot-unidade-v2",
      chave: chave.slice(0, 120),
      categoria: String(unidade.categoria).slice(0, 120),
      sigla: String(unidade.aba).slice(0, 120),
      estadoAtualizadoEm: atualizadoEm,
      usuario: usuarioWindows().slice(0, 120)
    });
    cache.snapshots[chave] = {
      fileId: salvo.id,
      modifiedTime: salvo.modifiedTime,
      atualizadoEm
    };
    enviados++;
  }
  await salvarCache(raiz, cache);
  return { enviados };
}

export async function publicarLogEquipe({ drive, pastas, arquivoLog }) {
  if (!pastas || !arquivoLog) return null;
  const nome = path.basename(arquivoLog);
  const remotos = await listarArquivosDrive(drive, pastas.logsId, { prefixo: nome });
  if (remotos.some((item) => item.name === nome)) return remotos.find((item) => item.name === nome);
  const log = await lerJsonSeguro(arquivoLog, null);
  if (!log) throw new Error(`Log invalido para compartilhar: ${arquivoLog}`);
  return criarJsonDrive(drive, pastas.logsId, nome, log, {
    tipo: "execucao",
    competencia: String(log.competencia ?? ""),
    usuario: String(log.usuarioWindows ?? usuarioWindows()).slice(0, 120)
  });
}

export async function sincronizarEstadoEquipe({
  drive,
  raiz,
  config,
  permitirUploadLocal = true,
  permitirSeedSnapshotLocal = true
}) {
  const cfg = cfgEstado(config);
  if (!cfg.habilitado) return { habilitado: false };
  const pastas = await obterPastasEstadoEquipe(drive, config);
  const logs = await sincronizarLogs({ drive, raiz, pastas, permitirUploadLocal });
  const snapshots = await sincronizarSnapshots({
    drive, raiz, pastas, permitirSeedLocal: permitirSeedSnapshotLocal
  });
  return { habilitado: true, pastas, logs, snapshots };
}

export async function finalizarEstadoEquipe({ drive, raiz, config, arquivoLog, unidades }) {
  const pastas = await obterPastasEstadoEquipe(drive, config);
  const log = await publicarLogEquipe({ drive, pastas, arquivoLog });
  const snapshotsPublicados = await publicarSnapshotsUnidades({ drive, raiz, pastas, unidades });
  const sincronizacao = await sincronizarEstadoEquipe({
    drive,
    raiz,
    config,
    permitirUploadLocal: true,
    permitirSeedSnapshotLocal: false
  });
  return { pastas, log, snapshotsPublicados, sincronizacao };
}
