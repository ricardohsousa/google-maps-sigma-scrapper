// Respostas HTML de Access/WAF não são erros JSON do backend do Sigma.
export async function readWebResponse(response) {
  const json = response.headers.get('content-type')?.includes('application/json');
  const ray = response.headers.get('cf-ray');
  if (!json) {
    if (response.status === 403) {
      const challenge = response.headers.get('cf-mitigated') === 'challenge';
      const message = challenge
        ? 'A Cloudflare solicitou uma verificação de segurança (HTTP 403). Reabra o site e conclua o login antes de tentar novamente.'
        : 'A requisição foi bloqueada antes da resposta da API (HTTP 403). Confira o Cloudflare Access e os eventos de segurança desse hostname.';
      throw Object.assign(new Error(`${message}${ray ? ` Referência Cloudflare: ${ray}.` : ''}`), { status: 403, code: challenge ? 'EDGE_CHALLENGE' : 'EDGE_FORBIDDEN' });
    }
    if (response.redirected || response.status === 401) throw Object.assign(new Error('Sua sessão terminou. Recarregue o site para entrar novamente pelo Cloudflare Access.'), { status: response.status, code: 'SESSION_EXPIRED' });
    throw Object.assign(new Error(`O servidor não retornou uma resposta válida do Sigma (HTTP ${response.status}). Recarregue e confira a conexão.`), { status: response.status, code: 'INVALID_API_RESPONSE' });
  }
  const result = await response.json();
  if (!response.ok || result.success === false) throw Object.assign(new Error(result.error || `Não foi possível concluir a ação (HTTP ${response.status}).`), { code: result.code, status: response.status });
  return result;
}
