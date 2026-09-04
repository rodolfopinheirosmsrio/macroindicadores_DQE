import fs from "node:fs/promises";
import path from "node:path";
import { authenticate } from "@google-cloud/local-auth";
import { google } from "googleapis";
import { garantirDiretorio } from "./util.mjs";

export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/spreadsheets"
];

async function existe(arquivo) {
  try { await fs.access(arquivo); return true; }
  catch { return false; }
}

export async function autenticarGoogle({ credentialsPath, tokenPath, forcarLogin = false }) {
  if (!await existe(credentialsPath)) {
    throw new Error(`Credencial do Google não encontrada: ${credentialsPath}`);
  }

  if (!forcarLogin && await existe(tokenPath)) {
    const token = JSON.parse(await fs.readFile(tokenPath, "utf8"));
    return google.auth.fromJSON(token);
  }

  const auth = await authenticate({ scopes: GOOGLE_SCOPES, keyfilePath: credentialsPath });
  const credenciais = JSON.parse(await fs.readFile(credentialsPath, "utf8"));
  const chave = credenciais.installed ?? credenciais.web;
  const tokenSalvo = {
    type: "authorized_user",
    client_id: chave.client_id,
    client_secret: chave.client_secret,
    refresh_token: auth.credentials.refresh_token
  };
  await garantirDiretorio(path.dirname(tokenPath));
  await fs.writeFile(tokenPath, JSON.stringify(tokenSalvo, null, 2), "utf8");
  return auth;
}

export function clientesGoogle(auth) {
  return {
    drive: google.drive({ version: "v3", auth }),
    sheets: google.sheets({ version: "v4", auth })
  };
}

function escaparDrive(texto) {
  return String(texto).replaceAll("'", "\\'");
}

export async function obterOuCriarPasta(drive, parentId, nome) {
  const q = [
    `'${parentId}' in parents`,
    `name = '${escaparDrive(nome)}'`,
    "mimeType = 'application/vnd.google-apps.folder'",
    "trashed = false"
  ].join(" and ");
  const busca = await drive.files.list({ q, fields: "files(id,name)", spaces: "drive" });
  if (busca.data.files?.length) return busca.data.files[0].id;
  const criada = await drive.files.create({
    requestBody: { name: nome, mimeType: "application/vnd.google-apps.folder", parents: [parentId] },
    fields: "id"
  });
  return criada.data.id;
}

export async function obterPastaCompetencia(drive, config, comp, nomePasta) {
  const pastaRaizId = config.driveRootFolderId;
  if (!pastaRaizId) {
    throw new Error("Pasta principal do Google Drive não configurada (driveRootFolderId).");
  }

  const ano = String(comp.ano);
  const pastaAnoConfigurada = config.driveYearFolderIds?.[ano];
  const pastaAnoId = pastaAnoConfigurada
    ?? await obterOuCriarPasta(drive, pastaRaizId, ano);
  const id = await obterOuCriarPasta(drive, pastaAnoId, nomePasta);

  return { id, nome: nomePasta, ano: comp.ano, anoId: pastaAnoId };
}

export async function enviarBackup(drive, pastaId, arquivo, nome) {
  const resposta = await drive.files.create({
    requestBody: { name: nome, parents: [pastaId] },
    media: { mimeType: "application/vnd.ms-excel", body: (await import("node:fs")).createReadStream(arquivo) },
    fields: "id,name,size,webViewLink"
  });
  return resposta.data;
}
