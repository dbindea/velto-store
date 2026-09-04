import { describe, expect, it } from 'vitest';
import { firstProblem, hasProblems, problemKeys } from './form-problems.util';

describe('qué impide guardar un formulario', () => {
  it('un mapa vacío es un formulario que se puede guardar', () => {
    expect(hasProblems({})).toBe(false);
    expect(problemKeys({})).toEqual([]);
    expect(firstProblem({})).toBeNull();
  });

  it('con un problema, lo dice', () => {
    const problems = { email: 'settings.errors.emailRequired' };
    expect(hasProblems(problems)).toBe(true);
    expect(problemKeys(problems)).toEqual(['settings.errors.emailRequired']);
    expect(firstProblem(problems)).toBe('settings.errors.emailRequired');
  });

  /**
   * El orden es el de la pantalla: el resumen junto al botón se lee de arriba
   * abajo igual que el formulario, y `firstProblem` —el que lanza un servicio—
   * señala el primer campo que falla, no uno cualquiera.
   */
  it('conserva el orden en que se declararon los campos', () => {
    const problems = {
      vehicleId: 'expenses.errors.vehicleRequired',
      concept: 'expenses.errors.conceptRequired',
      amount: 'expenses.errors.amountRequired'
    };
    expect(problemKeys(problems)).toEqual([
      'expenses.errors.vehicleRequired',
      'expenses.errors.conceptRequired',
      'expenses.errors.amountRequired'
    ]);
    expect(firstProblem(problems)).toBe('expenses.errors.vehicleRequired');
  });
});
