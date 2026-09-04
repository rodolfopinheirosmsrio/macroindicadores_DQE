export function resumoAuditoria(itens) {
  const novos = itens.filter((item) =>
    item.diferente && (item.atual === "" || item.atual == null)
  );
  const divergentes = itens.filter((item) =>
    item.diferente && !(item.atual === "" || item.atual == null)
  );
  return {
    total: itens.length,
    zeros: itens.filter((item) => item.novo === 0).length,
    detalhesZeros: itens.filter((item) => item.novo === 0).map((item) => ({
      linha: item.linha, grupo: item.grupo, campo: item.campo
    })),
    novos: novos.length,
    detalhesNovos: novos.map((item) => ({
      linha: item.linha, grupo: item.grupo, campo: item.campo, smsRio: item.novo
    })),
    diferencas: divergentes.length,
    detalhesDiferencas: divergentes.map((item) => ({
      linha: item.linha, grupo: item.grupo, campo: item.campo,
      planilha: item.atual, smsRio: item.novo
    })),
    detalhesValores: itens.map((item) => ({
      linha: item.linha, grupo: item.grupo, campo: item.campo,
      planilha: item.atual, smsRio: item.novo
    }))
  };
}

function preenchido(valor) {
  return !(valor === "" || valor == null);
}

function zero(valor) {
  if (!preenchido(valor)) return false;
  const numero = typeof valor === "number" ? valor : Number(String(valor).replace(",", "."));
  return Number.isFinite(numero) && numero === 0;
}

export function classificarIndicadoresZerados(resumoAtual, historicos, mesesAnteriores = 6) {
  const quantidadeMeses = Math.max(0, Number(mesesAnteriores) || 0);
  const janela = historicos.slice(0, quantidadeMeses);
  resumoAtual.detalhesZeros = resumoAtual.detalhesZeros.map((item) => {
    if (quantidadeMeses === 0) {
      return {
        ...item,
        classificacao: "REQUER_VALIDACAO",
        evidencia: "Execucao realizada somente para a competencia selecionada, sem meses anteriores para classificar o zero.",
        valoresHistoricos: []
      };
    }
    const valores = janela.map((historico) =>
      historico.detalhesValores?.find((valor) => valor.linha === item.linha)?.smsRio ?? ""
    );
    const comValor = valores.filter(preenchido);
    const comValorPositivoOuNegativo = comValor.filter((valor) => !zero(valor));
    let classificacao;
    let evidencia;
    if (comValorPositivoOuNegativo.length) {
      classificacao = "POSSIVEL_PENDENCIA";
      evidencia = `Houve valor diferente de zero em ${comValorPositivoOuNegativo.length} dos ${quantidadeMeses} meses anteriores.`;
    } else if (comValor.length === quantidadeMeses && comValor.every(zero)) {
      classificacao = "POSSIVEL_NAO_APLICAVEL";
      evidencia = `O indicador permaneceu zerado em toda a janela de ${mesesAnteriores + 1} meses.`;
    } else {
      classificacao = "REQUER_VALIDACAO";
      evidencia = `Histórico disponível em ${comValor.length} dos ${quantidadeMeses} meses anteriores, sem valor diferente de zero.`;
    }
    return { ...item, classificacao, evidencia, valoresHistoricos: valores };
  });
  resumoAtual.classificacaoZeros = {
    possiveisPendencias: resumoAtual.detalhesZeros.filter((item) => item.classificacao === "POSSIVEL_PENDENCIA").length,
    possiveisNaoAplicaveis: resumoAtual.detalhesZeros.filter((item) => item.classificacao === "POSSIVEL_NAO_APLICAVEL").length,
    requeremValidacao: resumoAtual.detalhesZeros.filter((item) => item.classificacao === "REQUER_VALIDACAO").length
  };
  return resumoAtual;
}
