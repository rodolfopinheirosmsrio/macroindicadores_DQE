export async function carregarCredenciais() {
  const cpf = process.env.SMSRIO_CPF?.trim();
  const senha = process.env.SMSRIO_SENHA;
  return cpf && senha ? { cpf, senha } : null;
}
