import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const MESES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"
];

export function normalizar(texto) {
  return String(texto ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function competencia(texto) {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(texto ?? "");
  if (!match) throw new Error("Use a competência no formato AAAA-MM, por exemplo 2026-06.");
  return { ano: Number(match[1]), mes: Number(match[2]), chave: texto };
}

export function nomeCompetencia({ ano, mes }) {
  return `${MESES[mes - 1]} ${ano}`;
}

export function competenciaAnterior({ ano, mes }, quantidade = 1) {
  const data = new Date(Date.UTC(ano, mes - 1 - quantidade, 1));
  const anterior = { ano: data.getUTCFullYear(), mes: data.getUTCMonth() + 1 };
  return { ...anterior, chave: `${anterior.ano}-${String(anterior.mes).padStart(2, "0")}` };
}

export function dataArquivo(data = new Date()) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric", timeZone: "America/Sao_Paulo"
  }).format(data).replaceAll("/", "-");
}

export function downloadsPadrao() {
  return path.join(os.homedir(), "Documents", "Backup do macro indicadores");
}

export async function lerJson(arquivo) {
  return JSON.parse(await fs.readFile(arquivo, "utf8"));
}

export async function garantirDiretorio(diretorio) {
  await fs.mkdir(diretorio, { recursive: true });
}

export function colunaA1(indiceZeroBased) {
  let n = indiceZeroBased + 1;
  let saida = "";
  while (n > 0) {
    n--;
    saida = String.fromCharCode(65 + (n % 26)) + saida;
    n = Math.floor(n / 26);
  }
  return saida;
}

export function valorSms(texto) {
  const bruto = String(texto ?? "").trim();
  if (bruto === "") return null;
  const duracao = /^(\d+):(\d{2}):(\d{2})$/.exec(bruto);
  if (duracao) {
    return Number(duracao[1]) / 24 + Number(duracao[2]) / 1440 + Number(duracao[3]) / 86400;
  }
  const percentual = bruto.endsWith("%");
  const porMil = bruto.endsWith("‰");
  let numero = bruto.replace(/[%‰]/g, "").trim();
  if (/^\d{1,3}(\.\d{3})+$/.test(numero) && !percentual && !porMil) {
    numero = numero.replaceAll(".", "");
  }
  const convertido = Number(numero.replace(",", "."));
  if (!Number.isFinite(convertido)) return bruto;
  if (percentual) return convertido / 100;
  if (porMil) return convertido / 1000;
  return convertido;
}

export function valoresIguais(a, b) {
  if (a === "" || a == null) return b === "" || b == null;
  const na = typeof a === "number" ? a : Number(String(a).replace(",", "."));
  const nb = typeof b === "number" ? b : Number(String(b).replace(",", "."));
  if (Number.isFinite(na) && Number.isFinite(nb)) return Math.abs(na - nb) < 1e-9;
  return normalizar(a) === normalizar(b);
}
