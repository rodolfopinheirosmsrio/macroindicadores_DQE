import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { dataArquivo, garantirDiretorio, nomeCompetencia, normalizar } from "./util.mjs";
import { lerRelatorioExportado } from "./relatorio-xls.mjs";

// Estado leve da tela do portal. Ele serve apenas para evitar repetir a navegação
// Relatórios > Mensal > Categoria e a seleção do ano quando a página já está
// preparada. Antes de reutilizar o estado, os elementos visíveis são validados.
const estadoPaginas = new WeakMap();

function obterEstadoPagina(page) {
  let estado = estadoPaginas.get(page);
  if (!estado) {
    estado = { categoria: null, ano: null };
    estadoPaginas.set(page, estado);
  }
  return estado;
}

function invalidarEstadoPagina(page) {
  const estado = obterEstadoPagina(page);
  estado.categoria = null;
  estado.ano = null;
}

function estaNoLogin(page) {
  return page.url().includes("web2.smsrio.org/login") || /\/login\/?(?:#|$)/i.test(page.url());
}

async function garantirLoginSeguro(page, loginUrl) {
  if (!estaNoLogin(page) || !loginUrl) return;
  const atual = page.url();
  const estaSeguro = atual.startsWith("https://web2.smsrio.org/login/") && atual.includes("#/");
  if (estaSeguro) return;
  console.log("Redirecionando para a tela segura de login do SMS Rio...");
  await page.goto(loginUrl, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
}

async function preencherCredenciais(page, credenciais) {
  if (!credenciais?.cpf || !credenciais?.senha) return false;
  const campoSenha = page.locator('input[type="password"]:visible').first();
  if (!await campoSenha.isVisible({ timeout: 15000 }).catch(() => false)) return false;
  let campoCpf = page.getByLabel(/cpf|usu[aá]rio|login/i).first();
  if (!await campoCpf.isVisible().catch(() => false)) {
    campoCpf = page.locator(
      'input:visible:not([type="password"]):not([type="hidden"]):not([type="submit"]):not([type="button"])'
    ).first();
  }
  await campoCpf.fill(credenciais.cpf);
  await campoSenha.fill(credenciais.senha);
  console.log("CPF e senha preenchidos.");
  return true;
}

async function tentarEntrarAutomaticamente(page) {
  const campoSenha = page.locator('input[type="password"]:visible').first();
  if (!await campoSenha.isVisible().catch(() => false)) return false;
  if (!(await campoSenha.inputValue().catch(() => "")).trim()) return false;

  const respostaCaptcha = page.locator(
    'input[name="cf-turnstile-response"], textarea[name="cf-turnstile-response"]'
  ).first();
  const possuiRespostaCaptcha = await respostaCaptcha.count() > 0;
  if (possuiRespostaCaptcha) {
    const valorCaptcha = await respostaCaptcha.inputValue().catch(() => "");
    if (!valorCaptcha.trim()) return false;
  } else {
    const desafioCloudflare = page.locator('iframe[src*="challenges.cloudflare.com"]:visible').first();
    if (await desafioCloudflare.isVisible().catch(() => false)) return false;
  }

  const entrar = page.getByRole("button", { name: /^\s*Entrar\s*$/i }).first();
  if (!await entrar.isVisible().catch(() => false)) return false;
  if (!await entrar.isEnabled().catch(() => false)) return false;
  await entrar.click();
  return true;
}

async function esperarLoginManual(page, url, loginUrl, credenciais, { modoNavegador = "visivel" } = {}) {
  if (modoNavegador === "segundo-plano") {
    const erro = new Error(
      "A sessão do SMS Rio não está ativa. A execução em segundo plano só funciona com uma sessão já autenticada. " +
      "Execute novamente no modo visível, conclua o login/CAPTCHA e depois tente em segundo plano."
    );
    erro.codigo = "SESSAO_SMSRIO_EXPIRADA";
    throw erro;
  }
  await garantirLoginSeguro(page, loginUrl);
  const preenchido = await preencherCredenciais(page, credenciais);
  if (!preenchido) {
    console.log("Faça login no SMS Rio. O robô continuará automaticamente após o acesso.");
  } else {
    console.log(
      "O robô clicará em Entrar automaticamente. Se o Cloudflare solicitar confirmação, " +
      "marque apenas 'Confirme que é humano'."
    );
  }
  console.log("A janela permanecerá aguardando por até 15 minutos.");
  const limite = Date.now() + 15 * 60 * 1000;
  let informouRetentativa = false;
  let proximaTentativaEntrada = 0;

  while (Date.now() < limite) {
    if (estaNoLogin(page)) {
      await garantirLoginSeguro(page, loginUrl);
      if (preenchido && Date.now() >= proximaTentativaEntrada) {
        const clicou = await tentarEntrarAutomaticamente(page);
        if (clicou) console.log("Verificação pronta. Clicando em Entrar automaticamente...");
        proximaTentativaEntrada = Date.now() + 5000;
      }
      await page.waitForTimeout(1000);
      continue;
    }

    // O portal passa por páginas intermediárias depois do login. A URL pode
    // sair de /login por alguns instantes antes de a sessão estar disponível
    // para o Macroindicadores, por isso aguardamos a navegação estabilizar.
    await page.waitForLoadState("domcontentloaded").catch(() => {});
    await page.waitForTimeout(5000);
    if (estaNoLogin(page)) continue;

    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(5000);
    if (estaNoLogin(page)) {
      if (!informouRetentativa) {
        console.log("A sessão ainda não foi confirmada. Conclua novamente o login/CAPTCHA; o robô continuará aguardando.");
        informouRetentativa = true;
      }
      continue;
    }

    const painelUsuario = page.getByText(/PAINEL DO USU.RIO/i).first();
    if (await painelUsuario.isVisible({ timeout: 30000 }).catch(() => false)) return;
  }

  throw new Error("O login no SMS Rio não foi confirmado dentro de 15 minutos. Tente novamente e conclua o CAPTCHA.");
}

async function garantirAutenticacaoSms(
  page, url, loginUrl, credenciais, { estabilizar = false, modoNavegador = "visivel" } = {}
) {
  if (estabilizar) {
    // O portal pode mostrar a tela do Macroindicadores brevemente antes de redirecionar ao login.
    // Esta espera impede que o robô avance durante esse redirecionamento tardio.
    await page.waitForTimeout(8000);
  }
  if (estaNoLogin(page)) {
    invalidarEstadoPagina(page);
    await esperarLoginManual(page, url, loginUrl, credenciais, { modoNavegador });
  }
  if (!page.url().includes("/subhue/macroindicadores/")) {
    invalidarEstadoPagina(page);
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3500);
    if (estaNoLogin(page)) {
      await esperarLoginManual(page, url, loginUrl, credenciais, { modoNavegador });
    }
  }
  await page.getByText(/PAINEL DO USU.RIO/i).first().waitFor({ timeout: 30000 });
}

async function minimizarJanela(page) {
  let sessaoCdp = null;
  try {
    sessaoCdp = await page.context().newCDPSession(page);
    const { windowId } = await sessaoCdp.send("Browser.getWindowForTarget");
    await sessaoCdp.send("Browser.setWindowBounds", {
      windowId,
      bounds: { windowState: "minimized" }
    });
  } catch {
    // A minimização é apenas uma conveniência visual e não deve interromper a consulta.
  } finally {
    await sessaoCdp?.detach().catch(() => {});
  }
}

export async function abrirSmsRio({
  url,
  loginUrl = "https://web2.smsrio.org/login/#/",
  profileDir,
  credenciais = null,
  modoNavegador = "visivel"
}) {
  if (!["visivel", "segundo-plano"].includes(modoNavegador)) {
    throw new Error("Modo do navegador deve ser visivel ou segundo-plano.");
  }
  await garantirDiretorio(profileDir);

  async function iniciar(modoEfetivo) {
    const context = await chromium.launchPersistentContext(profileDir, {
      headless: modoEfetivo === "segundo-plano",
      acceptDownloads: true,
      viewport: modoEfetivo === "segundo-plano" ? { width: 1440, height: 900 } : null,
      args: modoEfetivo === "segundo-plano" ? [] : ["--start-maximized"]
    });
    try {
      const page = context.pages()[0] ?? await context.newPage();
      await page.goto(url, { waitUntil: "domcontentloaded" });
      await garantirAutenticacaoSms(page, url, loginUrl, credenciais, {
        estabilizar: true,
        modoNavegador: modoEfetivo
      });
      return {
        context,
        page,
        modoNavegador: modoEfetivo,
        garantirAutenticacao: () => garantirAutenticacaoSms(
          page, url, loginUrl, credenciais, { modoNavegador: modoEfetivo }
        )
      };
    } catch (erro) {
      await context.close().catch(() => {});
      throw erro;
    }
  }

  try {
    return await iniciar(modoNavegador);
  } catch (erro) {
    if (modoNavegador !== "segundo-plano" || erro.codigo !== "SESSAO_SMSRIO_EXPIRADA") throw erro;
    console.log("A sessão do SMS Rio expirou. Abrindo uma janela para login e CAPTCHA...");
    console.log("Após o login, a janela será minimizada e a execução continuará automaticamente.");
    const navegadorLogin = await iniciar("visivel");
    console.log("Login confirmado. Minimizando o navegador e continuando a execução...");
    await minimizarJanela(navegadorLogin.page);
    return navegadorLogin;
  }
}

async function prepararCategoria(page, categoria) {
  const estado = obterEstadoPagina(page);
  const tituloMensal = page.getByText("Relatório Mensal", { exact: true }).first();
  const buscaUnidade = page.getByRole("searchbox", { name: "Digite uma unidade para pesquisar" });

  // Quando continuamos na mesma categoria, não voltamos ao menu principal.
  // Essa é a otimização mais importante no processamento em lote.
  if (
    estado.categoria === categoria &&
    await tituloMensal.isVisible().catch(() => false) &&
    await buscaUnidade.isVisible().catch(() => false)
  ) {
    return;
  }

  const menuRelatorios = page.getByText("Relatórios", { exact: true }).first();
  const modalCarregamento = page.locator("#modal-carregamento-bs");
  await modalCarregamento.waitFor({ state: "hidden", timeout: 60000 }).catch(() => {
    throw new Error("A plataforma permaneceu na janela de carregamento por mais de 60 segundos.");
  });
  await menuRelatorios.waitFor({ state: "visible", timeout: 30000 });
  await menuRelatorios.click({ timeout: 15000 });
  await page.waitForTimeout(800);

  console.log("  Selecionando o tipo de relatório: Mensal...");
  const opcoesMensal = page.getByText(/^\s*Mensal\s*$/i);
  await opcoesMensal.first().waitFor({ state: "visible", timeout: 30000 });
  let mensal = null;
  for (let indice = 0; indice < await opcoesMensal.count(); indice++) {
    const opcao = opcoesMensal.nth(indice);
    if (await opcao.isVisible().catch(() => false)) {
      mensal = opcao;
      break;
    }
  }
  if (!mensal) throw new Error("Opção Mensal não encontrada.");
  await mensal.scrollIntoViewIfNeeded();
  await mensal.click({ timeout: 15000 });

  const selecaoCategoria = page.getByText(/Selecione a Categoria/i).first();
  await selecaoCategoria.waitFor({ state: "visible", timeout: 30000 });
  console.log(`  Selecionando a categoria: ${categoria}...`);
  const opcoesCategoria = page.getByText(categoria, { exact: true });
  let opcaoCategoria = null;
  for (let indice = 0; indice < await opcoesCategoria.count(); indice++) {
    const opcao = opcoesCategoria.nth(indice);
    if (await opcao.isVisible().catch(() => false)) {
      opcaoCategoria = opcao;
      break;
    }
  }
  if (!opcaoCategoria) throw new Error(`Categoria ausente no SMS Rio: ${categoria}`);
  await opcaoCategoria.scrollIntoViewIfNeeded();
  await opcaoCategoria.click({ timeout: 15000 });

  await tituloMensal.waitFor({ state: "visible", timeout: 30000 });
  console.log("  Relatório Mensal aberto.");
  estado.categoria = categoria;
  estado.ano = null;
}

async function localizarSeletorAno(page, ano) {
  const seletores = page.locator("select:visible");
  for (let indice = 0; indice < await seletores.count(); indice++) {
    const seletor = seletores.nth(indice);
    const possuiAno = await seletor.locator("option").evaluateAll(
      (opcoes, anoEsperado) => opcoes.some((opcao) =>
        opcao.value === anoEsperado || (opcao.textContent ?? "").trim() === anoEsperado
      ),
      String(ano)
    );
    if (possuiAno) return seletor;
  }
  throw new Error(`Seletor do ano ${ano} não encontrado.`);
}

async function prepararAno(page, ano) {
  const estado = obterEstadoPagina(page);
  const seletorAno = await localizarSeletorAno(page, ano);
  const atual = await seletorAno.inputValue().catch(() => "");
  if (String(atual) !== String(ano)) {
    console.log(`  Selecionando o ano: ${ano}...`);
    await seletorAno.selectOption(String(ano));
  } else if (estado.ano !== ano) {
    console.log(`  Ano ${ano} já selecionado.`);
  }
  estado.ano = ano;
  return seletorAno;
}

function cabecalhoCompetencia(comp) {
  const meses = [
    "Janeiro", "Fevereiro", "Marco", "Abril", "Maio", "Junho",
    "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"
  ];
  return `${meses[comp.mes - 1]}/${comp.ano}`;
}

function chaveApiCompetencia(comp) {
  return `${comp.ano}${String(comp.mes).padStart(2, "0")}`;
}

export function competenciaDisponivelNaRespostaDireta(dados, comp) {
  const chave = chaveApiCompetencia(comp);
  const colecoes = [dados?.id_indicador, dados?.enviado, dados?.cnes];
  return colecoes.some((colecao) =>
    colecao && typeof colecao === "object" && Object.prototype.hasOwnProperty.call(colecao, chave)
  );
}

function localizarUnidadeDireta(unidadesApi, unidade) {
  const busca = normalizar(unidade.smsBusca);
  const nome = normalizar(unidade.nome);
  const candidatos = (unidadesApi ?? []).map((item) => {
    const texto = normalizar(item?.unidade ?? "");
    let pontos = 0;
    if (texto === busca || texto === nome) pontos += 100;
    if (busca && (texto.includes(busca) || busca.includes(texto))) pontos += 60;
    if (nome && (texto.includes(nome) || nome.includes(texto))) pontos += 50;
    const palavras = new Set(texto.split(" ").filter((p) => p.length > 2));
    for (const palavra of busca.split(" ").filter((p) => p.length > 2)) {
      if (palavras.has(palavra)) pontos += 2;
    }
    return { item, pontos };
  }).sort((a, b) => b.pontos - a.pontos);
  if (!candidatos[0] || candidatos[0].pontos < 8) return null;
  return candidatos[0].item;
}

async function executarComConcorrencia(itens, limite, tarefa) {
  const resultados = new Array(itens.length);
  let proximo = 0;
  async function trabalhador() {
    while (proximo < itens.length) {
      const indice = proximo++;
      resultados[indice] = await tarefa(itens[indice], indice);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limite, itens.length) }, trabalhador));
  return resultados;
}

/**
 * Pré-verifica as competências diretamente no serviço usado pela própria tela.
 * A resposta é usada somente para pular relatórios sem nenhum mês solicitado;
 * os dados que seguem para auditoria e backup continuam vindo do XLS oficial.
 */
export async function consultarDisponibilidadeDiretaEmLote(
  page, unidades, competencias, { concorrencia = 4 } = {}
) {
  const categorias = [...new Set(unidades.map((unidade) => unidade.categoria))];
  const contextoCategorias = new Map();
  const avisos = [];

  for (const categoria of categorias) {
    const respostaUnidades = page.waitForResponse((resposta) =>
      resposta.url().includes("/server/relatorio/get_unidades_grupo") && resposta.status() === 200,
      { timeout: 30000 }
    );
    await prepararCategoria(page, categoria);
    try {
      const resposta = await respostaUnidades;
      const url = new URL(resposta.url());
      const tabela = url.searchParams.get("tabela");
      const unidadesApi = await resposta.json();
      if (!tabela || !Array.isArray(unidadesApi)) {
        throw new Error("A lista de unidades retornou em formato inesperado.");
      }
      contextoCategorias.set(categoria, {
        tabela,
        unidadesApi,
        endpoint: new URL("get_dados_por_vigencia", resposta.url()).toString()
      });
    } catch (erro) {
      avisos.push(`Categoria ${categoria}: ${erro.message}`);
    }
  }

  const anos = [...new Set(competencias.map((comp) => comp.ano))];
  const consultas = unidades.flatMap((unidade) => anos.map((ano) => ({ unidade, ano })));
  const pares = await executarComConcorrencia(consultas, concorrencia, async ({ unidade, ano }) => {
    const chave = `${unidade.categoria}::${unidade.aba}::${ano}`;
    const contexto = contextoCategorias.get(unidade.categoria);
    if (!contexto) return [chave, { conclusiva: false, erro: "Categoria não preparada para consulta direta." }];
    const unidadeApi = localizarUnidadeDireta(contexto.unidadesApi, unidade);
    if (!unidadeApi?.cnes) {
      return [chave, { conclusiva: false, erro: "CNES não localizado na lista do SMS Rio." }];
    }
    try {
      const resposta = await page.context().request.get(contexto.endpoint, {
        params: { tabela: contexto.tabela, cnes: String(unidadeApi.cnes), vigencia: String(ano) },
        timeout: 30000
      });
      if (!resposta.ok()) throw new Error(`HTTP ${resposta.status()}`);
      const dados = await resposta.json();
      const porCompetencia = Object.fromEntries(
        competencias
          .filter((comp) => comp.ano === ano)
          .map((comp) => [comp.chave, competenciaDisponivelNaRespostaDireta(dados, comp)])
      );
      return [chave, {
        conclusiva: true,
        cnes: String(unidadeApi.cnes),
        tabela: contexto.tabela,
        porCompetencia
      }];
    } catch (erro) {
      return [chave, { conclusiva: false, erro: erro.message }];
    }
  });

  return { resultados: new Map(pares), avisos };
}

async function selecionarUnidade(page, unidade, comp, { validarCompetencia = true } = {}) {
  const ano = comp.ano;
  const busca = page.getByRole("searchbox", { name: "Digite uma unidade para pesquisar" });
  console.log(`  Buscando a unidade: ${unidade.smsBusca}...`);
  await busca.fill("");
  await busca.fill(unidade.smsBusca);
  let resultado = null;
  const limite = Date.now() + 30000;
  while (!resultado && Date.now() < limite) {
    const resultados = page.locator("body *:visible");
    const textos = await resultados.allTextContents();
    const visiveis = [];
    for (let indice = 0; indice < textos.length; indice++) {
      const candidato = resultados.nth(indice);
      const texto = textos[indice]?.replace(/\s+/g, " ").trim();
      if (texto && normalizar(texto).includes(normalizar(unidade.smsBusca))) {
        visiveis.push({ candidato, tamanho: texto.length, texto });
      }
    }
    if (visiveis.length) {
      visiveis.sort((a, b) => a.tamanho - b.tamanho);
      resultado = visiveis[0];
      break;
    }
    await page.waitForTimeout(300);
  }
  if (!resultado) {
    throw new Error(
      `Unidade ${unidade.aba}: nenhum resultado visível para "${unidade.smsBusca}" após 30 segundos.`
    );
  }
  console.log(`  Unidade encontrada: ${resultado.texto}`);
  await resultado.candidato.scrollIntoViewIfNeeded();
  await resultado.candidato.click({ timeout: 15000 });

  // Algumas versões do portal mantêm o ano ao trocar de unidade; outras podem
  // restaurar o valor padrão. A checagem abaixo é barata e só refaz a seleção
  // caso o portal realmente tenha alterado o ano.
  await prepararAno(page, ano);

  console.log("  Pesquisando e aguardando os indicadores...");
  await page.getByRole("button", { name: /Pesquisar/ }).click();
  await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(2500);
  await page.getByText("Exportar para Excel", { exact: true }).first()
    .waitFor({ state: "visible", timeout: 30000 });
  if (!validarCompetencia) {
    console.log(
      `  Ano ${ano} carregado; exportação anual autorizada. ` +
      "A disponibilidade será verificada competência por competência após o download."
    );
    return;
  }

  // Não usa mais o texto visível da tabela para decidir se o mês existe.
  // O portal é uma SPA e, em algumas unidades, a tabela pode permanecer por
  // alguns instantes com o conteúdo anterior ou renderizar colunas fora da área
  // visível. Isso já gerou falso "MES_NAO_DISPONIVEL" mesmo com a competência
  // publicada. A confirmação definitiva passa a ser feita no XLS exportado.
  const esperado = cabecalhoCompetencia(comp);
  console.log(
    `  ${esperado}: tela carregada. A existência da competência será confirmada no arquivo exportado.`
  );
}

export async function consultarRelatorio(
  page, unidade, comp, downloadsDir, { validarCompetencia = true } = {}
) {
  await prepararCategoria(page, unidade.categoria);
  await prepararAno(page, comp.ano);
  await selecionarUnidade(page, unidade, comp, { validarCompetencia });

  const referencia = validarCompetencia ? nomeCompetencia(comp) : `Ano ${comp.ano}`;
  const nomeBase = `${unidade.aba} - ${unidade.categoria} - ${referencia} - ${dataArquivo()}`;
  await garantirDiretorio(downloadsDir);
  let nome = `${nomeBase}.xls`;
  let destino = path.join(downloadsDir, nome);
  for (let versao = 2; ; versao++) {
    try {
      await fs.access(destino);
      nome = `${nomeBase} (${versao}).xls`;
      destino = path.join(downloadsDir, nome);
    } catch {
      break;
    }
  }

  const exportar = page.getByText("Exportar para Excel", { exact: true });
  if (await exportar.count() !== 1) throw new Error("Botão Exportar para Excel não encontrado de forma única.");
  const downloadPromise = page.waitForEvent("download", { timeout: 20000 });
  await exportar.click();
  const download = await downloadPromise;
  await download.saveAs(destino);

  const tabela = await lerRelatorioExportado(destino);
  if (!tabela.rows.length) throw new Error(`Relatório vazio para ${unidade.aba}.`);

  const indiceMes = localizarMesNoRelatorio(tabela, comp);
  if (validarCompetencia && indiceMes < 0) {
    // Salvaguarda: se o arquivo exportado não contiver a competência, ele não
    // deve permanecer em Downloads nem ser enviado ao Google Drive.
    await fs.unlink(destino).catch(() => {});
    const erro = new Error(
      `Competência ${nomeCompetencia(comp)} não encontrada no relatório. ` +
      `Cabeçalhos encontrados: ${tabela.headers.join(" | ")}`
    );
    erro.codigo = "MES_NAO_DISPONIVEL_SMSRIO";
    throw erro;
  }

  return { ...tabela, indiceMes, arquivo: destino, nomeArquivo: nome };
}

export function localizarMesNoRelatorio(relatorio, comp) {
  const meses = [
    "janeiro", "fevereiro", "marco", "abril", "maio", "junho",
    "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"
  ];
  const mes = meses[comp.mes - 1];
  const abreviado = mes.slice(0, 3);
  const ano = String(comp.ano);
  const anoCurto = ano.slice(-2);
  const numeroMes = String(comp.mes).padStart(2, "0");

  return relatorio.headers.findIndex((cabecalho) => {
    const texto = normalizar(cabecalho).replace(/\s+/g, " ").trim();
    const temMesPorNome = texto.includes(mes) || texto.includes(abreviado);
    const temMesNumerico =
      texto.includes(`${numeroMes}/${ano}`) ||
      texto.includes(`${numeroMes}-${ano}`) ||
      texto.includes(`${numeroMes}/${anoCurto}`) ||
      texto.includes(`${numeroMes}-${anoCurto}`);
    const temAno = texto.includes(ano) || new RegExp(`(?:^|\\D)${anoCurto}(?:\\D|$)`).test(texto);
    return (temMesPorNome && temAno) || temMesNumerico;
  });
}
