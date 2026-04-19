import { normalizeRagQuery } from './rag-query-normalization';

describe('normalizeRagQuery', () => {
  it('corrige autoposta a autopista', () => {
    expect(normalizeRagQuery('¿Cuál es la velocidad mínima en autoposta?')).toBe(
      '¿Cuál es la velocidad mínima en autopista?',
    );
  });

  it('normaliza variantes frecuentes del dominio vial', () => {
    expect(normalizeRagQuery('semi autopista y autopostas')).toBe(
      'semiautopista y autopistas',
    );
  });
});
