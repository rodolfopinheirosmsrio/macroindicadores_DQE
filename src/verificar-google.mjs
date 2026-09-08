import path from "node:path";
import { fileURLToPath } from "node:url";
import { autenticarGoogle, verificarContaGoogle } from "./google.mjs";
import { lerJson } from "./util.mjs";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const config = await lerJson(path.join(raiz, "config", "config.json"));
const auth = await autenticarGoogle({
  credentialsPath: path.resolve(raiz, config.googleCredentials),
  tokenPath: path.resolve(raiz, config.googleToken)
});
const conta = await verificarContaGoogle(auth, config.googleExpectedAccount);
console.log(`Google autorizado: ${conta.email}`);
