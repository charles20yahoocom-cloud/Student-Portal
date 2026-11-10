require('dotenv').config();

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required; refusing to run the Neon smoke test against SQLite.');
}

const db = require('../src/config/database-runtime');
const { chatCompletion, listModels } = require('../src/config/neon-ai-gateway');

async function main() {
  try {
    const result = await db.prepare('SELECT 1 AS ok').get();
    if (Number(result.ok) !== 1) throw new Error('PostgreSQL returned an unexpected health-check result.');
    console.log('Neon PostgreSQL query: passed.');

    const models = await listModels();
    const model = models.find((entry) => entry.enabled === true);
    if (!model) {
      throw new Error('Neon AI Gateway has no enabled models. Check model access and AI Gateway credits in Neon.');
    }

    const completion = await chatCompletion({
      model: model.id,
      messages: [{ role: 'user', content: 'Reply with the number 2 only: what is 1 + 1?' }]
    });
    const answer = completion.choices && completion.choices[0] &&
      completion.choices[0].message && completion.choices[0].message.content;
    if (typeof answer !== 'string' || answer.trim() === '') {
      throw new Error('Neon AI Gateway returned no completion text.');
    }

    console.log(`Neon AI Gateway completion: passed (${model.id}).`);
  } finally {
    await db.close();
  }
}

main().catch((error) => {
  console.error(`Neon smoke test failed: ${error.message}`);
  process.exitCode = 1;
});
