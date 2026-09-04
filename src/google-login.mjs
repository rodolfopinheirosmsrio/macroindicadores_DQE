import path from "node:path";
import { fileURLToPath } from "node:url";
import { autenticarGoogle } from "./google.mjs";
import { lerJson } from "./util.mjs";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const config = await lerJson(path.join(raiz, "config", "config.json"));
await autenticarGoogle({
  credentialsPath: path.resolve(raiz, config.googleCredentials),
  tokenPath: path.resolve(raiz, config.googleToken),
  forcarLogin: true
});
console.log("Autorização do Google concluída e token salvo.");
