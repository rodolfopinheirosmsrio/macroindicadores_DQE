import path from "node:path";
import { fileURLToPath } from "node:url";
import { autenticarGoogle, clientesGoogle, verificarContaGoogle } from "./google.mjs";
import { sincronizarEstadoEquipe } from "./estado-equipe.mjs";
import { salvarDashboard } from "./dashboard.mjs";
import { lerJson } from "./util.mjs";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = new Map(process.argv.slice(2).map((arg) => {
  const m = /^--([^=]+)=(.*)$/.exec(arg);
  return m ? [m[1], m[2]] : [arg.replace(/^--/, ""), "true"];
}));
const somenteLeitura = String(args.get("somente-leitura") ?? "false").toLowerCase() === "true";

const config = await lerJson(path.join(raiz, "config", "config.json"));
const auth = await autenticarGoogle({
  credentialsPath: path.resolve(raiz, config.googleCredentials),
  tokenPath: path.resolve(raiz, config.googleToken)
});
const conta = await verificarContaGoogle(auth, config.googleExpectedAccount);
const { drive } = clientesGoogle(auth);

console.log(`Google autorizado: ${conta.email}`);
console.log("Sincronizando o estado compartilhado do painel...");
const estado = await sincronizarEstadoEquipe({
  drive,
  raiz,
  config,
  permitirUploadLocal: !somenteLeitura,
  permitirSeedSnapshotLocal: !somenteLeitura
});
if (estado.habilitado !== false) {
  console.log(
    `Logs: ${estado.logs?.baixados ?? 0} baixado(s), ${estado.logs?.enviados ?? 0} enviado(s). ` +
    `Snapshots: ${estado.snapshots?.baixados ?? 0} baixado(s), ${estado.snapshots?.enviados ?? 0} enviado(s).`
  );
}
const painel = await salvarDashboard(raiz);
console.log(`Painel consolidado da equipe gerado: ${painel}`);
