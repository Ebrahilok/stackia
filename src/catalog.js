'use strict';
const E5 = ['low', 'medium', 'high', 'xhigh', 'max'];
const E6 = [...E5, 'ultra'];

/** Providers, models and effort levels offered in the UI. */
const CATALOG = {
  claude: {
    label: 'Claude',
    models: [
      { id: 'opus', efforts: E5 },
      { id: 'sonnet', efforts: E5 },
      { id: 'haiku', efforts: E5 },
      { id: 'claude-fable-5-1', efforts: E5 },
    ],
  },
  codex: {
    label: 'Codex',
    models: [
      { id: 'gpt-6.1-sol', efforts: E6 },
      { id: 'gpt-6.1-terra', efforts: E6 },
      { id: 'gpt-6-sol', efforts: E6 },
      { id: 'gpt-6-astra', efforts: E6 },
      { id: 'gpt-6-luna', efforts: E5 },
      { id: 'gpt-5.6-sol', efforts: E6 },
      { id: 'gpt-5.6-terra', efforts: E6 },
      { id: 'gpt-5.6-luna', efforts: E5 },
    ],
  },
  agy: {
    label: 'agy',
    models: [{ id: 'gemini-3.8-flash', efforts: ['low', 'medium', 'high'] }],
  },
};

const MOCK = { label: 'Mock', models: [{ id: 'mock', efforts: ['low'] }] };

function catalog(enableMock) {
  return enableMock ? { ...CATALOG, mock: MOCK } : CATALOG;
}

function isValidChoice(cat, provider, model, effort) {
  const entry = cat[provider]?.models.find((m) => m.id === model);
  return Boolean(entry && entry.efforts.includes(effort));
}

module.exports = { catalog, isValidChoice };
