import path from "node:path";
import { fileURLToPath } from "node:url";
import { autenticarGoogle, clientesGoogle } from "./google.mjs";
import { lerJson } from "./util.mjs";
import { coletarSnapshotUnidade, salvarSnapshotPlanilhas } from "./snapshot-planilhas.mjs";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const config = await lerJson(path.join(raiz, "config", "config.json"));
const unidades = await lerJson(path.join(raiz, "config", "unidades.json"));
const auth = await autenticarGoogle({
  credentialsPath: path.resolve(raiz, config.googleCredentials),
  tokenPath: path.resolve(raiz, config.googleToken)
});
const { sheets } = clientesGoogle(auth);
const registros = [];
let erros = 0;
for (const [indice, unidade] of unidades.entries()) {
  process.stdout.write(`[${indice + 1}/${unidades.length}] ${unidade.categoria} ${unidade.aba}... `);
  try {
    const fotos = await coletarSnapshotUnidade(sheets, config, unidade);
    registros.push(...fotos);
    console.log(`${fotos.length} competencias.`);
  } catch (erro) {
    erros += 1;
    console.log(`ERRO: ${erro.message}`);
  }
}
if (!registros.length) {
  throw new Error(`Nenhuma aba foi lida; snapshot anterior preservado. Falhas: ${erros}.`);
}
const arquivo = await salvarSnapshotPlanilhas(raiz, {
  atualizadoEm: new Date().toISOString(),
  registros
});
console.log(`Snapshot salvo: ${arquivo}`);
