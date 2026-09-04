import { normalizar, valorSms } from './util.mjs';

export function tipoIndicador(campo) {
  const n = normalizar(campo);
  if (/indicador de queda|indicador de lesao por pressao|infeccao no trato urinario|infeccao na corrente sanguinea|pneumomia|pneumonia|\(pav\)|\(ics\)|\(itu\)/.test(n)) return 'permil';
  if (/taxa|percentual/.test(n)) return 'percentual';
  if (n.includes('duracao de utilizacao do centro cirurgico')) return 'duracao';
  return 'numero';
}

// Valores canônicos de taxas são frações; a escala nunca depende da magnitude.
export function converterIndicador(campo, bruto) {
  const texto = String(bruto ?? '').trim();
  const valor = valorSms(texto);
  if (valor == null || typeof valor !== 'number' || /[%‰]/.test(texto)) return valor;
  const tipo = tipoIndicador(campo);
  return tipo === 'percentual' ? valor / 100 : tipo === 'permil' ? valor / 1000 : valor;
}

export function valorParaCelula(campo, valor) {
  return typeof valor === 'number' && tipoIndicador(campo) === 'permil' ? valor * 1000 : valor;
}

export function valorDaCelula(campo, valor, formato = '') {
  if (typeof valor !== 'number') return valor;
  return tipoIndicador(campo) === 'permil' && formato.includes('‰') ? valor / 1000 : valor;
}

export function formatoIndicador(campo, valor = undefined) {
  const tipo = tipoIndicador(campo);
  if (tipo === 'percentual') return { type: 'PERCENT', pattern: '0.00%' };
  if (tipo === 'permil') return { type: 'NUMBER', pattern: '0.00"‰"' };
  // O SMS Rio entrega esta duração como horas decimais (ex.: 28,90 horas),
  // e não como fração de dia usada por planilhas para horários.
  // No locale pt-BR, o padrão com casas opcionais deixa uma vírgula solta em
  // inteiros (ex.: "351,"). Por isso inteiros recebem um padrão sem decimais.
  const numero = typeof valor === 'number' ? valor : Number.NaN;
  const pattern = Number.isInteger(numero) ? '#,##0' : '#,##0.########';
  if (tipo === 'duracao') return { type: 'NUMBER', pattern };
  return { type: 'NUMBER', pattern };
}

export function exibirIndicador(campo, valor) {
  if (valor === '' || valor == null) return '—';
  if (typeof valor !== 'number') return String(valor);
  const tipo = tipoIndicador(campo);
  if (tipo === 'duracao') {
    const minutos = Math.round(valor * 60);
    return `${Math.floor(minutos / 60)}h${String(minutos % 60).padStart(2, '0')}`;
  }
  const escala = tipo === 'percentual' ? 100 : tipo === 'permil' ? 1000 : 1;
  return (valor * escala).toLocaleString('pt-BR', { maximumFractionDigits: tipo === 'numero' ? 4 : 3 }) +
    (tipo === 'percentual' ? '%' : tipo === 'permil' ? '‰' : '');
}
