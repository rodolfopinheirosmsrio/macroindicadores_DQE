import fs from 'node:fs/promises';
import path from 'node:path';
import { normalizar, valoresIguais } from './util.mjs';

export const chaveMedida = (v) => `${normalizar(v.grupo)}|${normalizar(v.campo)}`;
export const chaveFoto = (comp, u) => `${comp}|${u.categoria}|${u.aba}`;

export function prazoCompetencia(comp) {
  const [ano, mes] = comp.split('-').map(Number);
  const proximo = new Date(Date.UTC(ano, mes, 1));
  const base = `${proximo.getUTCFullYear()}-${String(proximo.getUTCMonth() + 1).padStart(2, '0')}`;
  return {
    prazoPreenchimento: `${base}-05`,
    pendenciaDesde: `${base}-06T00:00:00-03:00`,
    fechamento: `${base}-10`,
    foraDaMetaDesde: `${base}-11T00:00:00-03:00`
  };
}

export function compararFotografias(comp, unidade, anterior, resumo, detectadoEm) {
  const prazo = prazoCompetencia(comp);
  const aposMarco = new Date(detectadoEm) >= new Date(prazo.foraDaMetaDesde);
  const base = { competencia: comp, categoria: unidade.categoria, sigla: unidade.aba,
    unidade: unidade.nome, detectadoEm, marcoEm: `${prazo.fechamento}T00:00:00-03:00`,
    foraDaMetaDesde: prazo.foraDaMetaDesde, aposMarco,
    prazoPreenchimento: prazo.prazoPreenchimento,
    pendenciaDesde: prazo.pendenciaDesde,
    fotografiaAnteriorEm: anterior?.observadoEm ?? null,
    confirmadoForaPrazo: aposMarco && !!anterior && new Date(anterior.observadoEm) >= new Date(prazo.foraDaMetaDesde) };
  if (!resumo?.detalhesValores?.length) return [];
  if (!anterior) return [{ ...base, tipo: 'PRIMEIRA_FOTOGRAFIA', confirmado: false }];
  if (!anterior.possuiDados) return [{ ...base, tipo: 'NOVO_PREENCHIMENTO', confirmado: true,
    preenchimentoForaPrazoConfirmado: new Date(detectadoEm) >= new Date(prazo.pendenciaDesde) &&
      new Date(anterior.observadoEm) >= new Date(prazo.pendenciaDesde) }];
  const antigos = new Map(anterior.valores.map((v) => [chaveMedida(v), v]));
  return resumo.detalhesValores.flatMap((v) => {
    const antes = antigos.get(chaveMedida(v));
    if (!antes || valoresIguais(antes.smsRio, v.smsRio)) return [];
    return [{ ...base, tipo: 'ALTERACAO_INDICADOR', confirmado: true, linha: v.linha,
      grupo: v.grupo, campo: v.campo, valorAnterior: antes.smsRio, valorAtual: v.smsRio }];
  });
}

export async function carregarFotografiasAnteriores(raiz) {
  const fotos = new Map();
  const arquivos = (await fs.readdir(path.join(raiz, 'logs')).catch(() => []))
    .filter((n) => /^execucao-.*\.json$/.test(n)).sort();
  for (const nome of arquivos) {
    const log = JSON.parse(await fs.readFile(path.join(raiz, 'logs', nome), 'utf8'));
    for (const u of log.unidades ?? []) {
      const pares = [{ competencia: log.competencia, ...(u.verificacao ?? u.competenciaAtual) }, ...(u.historicoSomenteLeitura ?? [])];
      for (const r of pares) {
        const k = chaveFoto(r.competencia, u), observadoEm = log.fim ?? log.inicio;
        if (!r.detalhesValores?.length) {
          if (r.competencia === log.competencia && u.competenciaSolicitada?.status === 'MES_NAO_DISPONIVEL' && !fotos.get(k)?.possuiDados)
            fotos.set(k, { possuiDados: false, valores: [], observadoEm });
          continue;
        }
        if (!fotos.has(k) || observadoEm > fotos.get(k).observadoEm)
          fotos.set(k, { possuiDados: true, valores: r.detalhesValores, observadoEm });
      }
    }
  }
  return fotos;
}
