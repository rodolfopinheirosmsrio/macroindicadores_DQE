import fs from "node:fs/promises";
import { normalizar } from "./util.mjs";

function textoCelula(html) {
  return html
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, numero) => String.fromCodePoint(Number(numero)))
    .replace(/&#x([0-9a-f]+);/gi, (_, numero) => String.fromCodePoint(parseInt(numero, 16)))
    .trim();
}

function extrairCelulas(html, tag) {
  const expressao = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi");
  return [...html.matchAll(expressao)].map((item) => textoCelula(item[1]));
}

export async function lerRelatorioExportado(arquivo) {
  const html = await fs.readFile(arquivo, "utf8");
  const cabecalhoHtml = /<thead\b[^>]*>([\s\S]*?)<\/thead>/i.exec(html)?.[1] ?? "";
  const corpoHtml = /<tbody\b[^>]*>([\s\S]*?)<\/tbody>/i.exec(html)?.[1] ?? "";
  let headers = extrairCelulas(cabecalhoHtml, "th");
  let rows = [...corpoHtml.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)]
    .map((item) => extrairCelulas(item[1], "td"));

  if (!headers.length || !rows.length) throw new Error("O Excel exportado não contém uma tabela válida.");
  if (normalizar(headers[0]) === "unidade") {
    headers = headers.slice(1);
    rows = rows.map((linha) => linha.slice(1));
  }
  return { headers, rows };
}
