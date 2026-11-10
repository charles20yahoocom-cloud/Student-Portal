function gatewayConfig() {
  const baseUrl = process.env.NEON_AI_GATEWAY_BASE_URL;
  const token = process.env.NEON_AI_GATEWAY_TOKEN;
  if (!baseUrl || !token) {
    throw new Error('NEON_AI_GATEWAY_BASE_URL and NEON_AI_GATEWAY_TOKEN are required.');
  }

  const parsedUrl = new URL(baseUrl);
  if (parsedUrl.protocol !== 'https:' || parsedUrl.pathname !== '/') {
    throw new Error('NEON_AI_GATEWAY_BASE_URL must be an HTTPS host without a path.');
  }

  return { baseUrl: parsedUrl.origin, token };
}

async function request(path, init = {}) {
  const { baseUrl, token } = gatewayConfig();
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers
    },
    signal: AbortSignal.timeout(20000)
  });

  if (!response.ok) {
    throw new Error(`Neon AI Gateway request failed with HTTP ${response.status}.`);
  }

  return response.json();
}

async function listModels() {
  const result = await request('/v1/models');
  if (!result || !Array.isArray(result.data)) {
    throw new Error('Neon AI Gateway returned an invalid model catalog.');
  }
  return result.data;
}

async function chatCompletion({ model, messages, maxTokens = 16 }) {
  if (!model || !Array.isArray(messages) || messages.length === 0) {
    throw new Error('A model and at least one chat message are required.');
  }

  return request('/v1/chat/completions', {
    method: 'POST',
    body: JSON.stringify({ model, messages, max_tokens: maxTokens })
  });
}

module.exports = { chatCompletion, listModels };
