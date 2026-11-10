const test = require('node:test');
const assert = require('node:assert/strict');
const { chatCompletion, listModels } = require('../src/config/neon-ai-gateway');

test('uses branch-scoped Neon credentials for catalog and chat requests', async () => {
  const previousBaseUrl = process.env.NEON_AI_GATEWAY_BASE_URL;
  const previousToken = process.env.NEON_AI_GATEWAY_TOKEN;
  const previousFetch = global.fetch;
  process.env.NEON_AI_GATEWAY_BASE_URL = 'https://branch-api.ai.us-east-2.aws.neon.tech';
  process.env.NEON_AI_GATEWAY_TOKEN = 'test-token';

  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/v1/models')) {
      return Response.json({ data: [{ id: 'test-model', enabled: true }] });
    }
    return Response.json({ choices: [{ message: { content: '2' } }] });
  };

  try {
    const models = await listModels();
    const completion = await chatCompletion({
      model: models[0].id,
      messages: [{ role: 'user', content: 'Reply with 2.' }]
    });

    assert.equal(models[0].enabled, true);
    assert.equal(completion.choices[0].message.content, '2');
    assert.equal(calls[0].url, 'https://branch-api.ai.us-east-2.aws.neon.tech/v1/models');
    assert.equal(calls[1].url, 'https://branch-api.ai.us-east-2.aws.neon.tech/v1/chat/completions');
    assert.equal(calls[0].options.headers.Authorization, 'Bearer test-token');
    assert.equal(JSON.parse(calls[1].options.body).model, 'test-model');
  } finally {
    global.fetch = previousFetch;
    if (previousBaseUrl === undefined) delete process.env.NEON_AI_GATEWAY_BASE_URL;
    else process.env.NEON_AI_GATEWAY_BASE_URL = previousBaseUrl;
    if (previousToken === undefined) delete process.env.NEON_AI_GATEWAY_TOKEN;
    else process.env.NEON_AI_GATEWAY_TOKEN = previousToken;
  }
});

test('fails explicitly when Neon AI Gateway credentials are missing', async () => {
  const previousBaseUrl = process.env.NEON_AI_GATEWAY_BASE_URL;
  const previousToken = process.env.NEON_AI_GATEWAY_TOKEN;
  delete process.env.NEON_AI_GATEWAY_BASE_URL;
  delete process.env.NEON_AI_GATEWAY_TOKEN;

  try {
    await assert.rejects(listModels(), /NEON_AI_GATEWAY_BASE_URL and NEON_AI_GATEWAY_TOKEN are required/);
  } finally {
    if (previousBaseUrl !== undefined) process.env.NEON_AI_GATEWAY_BASE_URL = previousBaseUrl;
    if (previousToken !== undefined) process.env.NEON_AI_GATEWAY_TOKEN = previousToken;
  }
});
