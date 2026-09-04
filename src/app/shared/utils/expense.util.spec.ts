import { describe, expect, it } from 'vitest';
import {
  buildExpenseRows,
  defaultVatRateFor,
  extractVatFromGross,
  maintenanceToExpenseRow,
  totalsOf,
  validateExpense
} from './expense.util';
import { Expense } from '@shared/models/expense.model';
import { VehicleMaintenance } from '@shared/models/vehicle-maintenance.model';

function expense(over: Partial<Expense> = {}): Expense {
  const gross = over.amount ?? 121;
  const split = extractVatFromGross(gross, over.vatRate ?? 0.21);
  return {
    scope: 'general',
    category: 'other',
    concept: 'Un gasto',
    amount: split.gross,
    netAmount: split.net,
    vatAmount: split.vat,
    vatRate: split.rate,
    date: new Date('2026-09-01T10:00:00Z'),
    ...over
  };
}

describe('el IVA de un gasto se extrae, no se suma', () => {
  /**
   * Es la diferencia con `pricing.util.ts`, donde el IVA se suma a un neto que
   * es el número negociado. Aquí el número que existe es el del ticket.
   */
  it('saca la base de un total que ya lo lleva dentro', () => {
    const split = extractVatFromGross(121, 0.21);
    expect(split.net).toBe(100);
    expect(split.vat).toBe(21);
    expect(split.gross).toBe(121);
  });

  it('base + IVA cuadra al céntimo con lo que pone la factura', () => {
    for (const gross of [60.5, 47.33, 19.99, 1234.56, 0.05, 89.9]) {
      const split = extractVatFromGross(gross, 0.21);
      expect(split.net + split.vat, `${gross}`).toBeCloseTo(gross, 10);
    }
  });

  it('admite los tipos reducidos y el cero', () => {
    expect(extractVatFromGross(110, 0.1).net).toBe(100);
    expect(extractVatFromGross(104, 0.04).net).toBe(100);
    const sinIva = extractVatFromGross(100, 0);
    expect(sinIva.net).toBe(100);
    expect(sinIva.vat).toBe(0);
  });

  it('no inventa nada con importes imposibles', () => {
    for (const bad of [0, -10, NaN, Infinity]) {
      const split = extractVatFromGross(bad as number, 0.21);
      expect(split.gross, `${bad}`).toBe(0);
      expect(split.net).toBe(0);
      expect(split.vat).toBe(0);
    }
  });

  /** Una multa es una sanción repercutida, no un servicio: no lleva IVA. */
  it('propone 0 % para una multa y el general para lo demás', () => {
    expect(defaultVatRateFor('fine')).toBe(0);
    expect(defaultVatRateFor('repair')).toBe(0.21);
    expect(defaultVatRateFor('accounting')).toBe(0.21);
  });
});

describe('el mantenimiento se lee, no se duplica', () => {
  function maintenance(over: Partial<VehicleMaintenance> = {}): VehicleMaintenance {
    return {
      id: 'm1',
      vehicleId: 'v1',
      vehicleSnapshot: { brand: 'Renault', model: 'Clio', plateNumber: '1234KDB' },
      type: 'oil_change',
      status: 'completed',
      priority: 'medium',
      title: 'Cambio de aceite',
      cost: 180,
      provider: 'Taller Pepe',
      performedAtDate: new Date('2026-08-20T09:00:00Z'),
      ...over
    } as VehicleMaintenance;
  }

  it('convierte un mantenimiento hecho y pagado en una fila de gasto', () => {
    const row = maintenanceToExpenseRow(maintenance())!;
    expect(row.origin).toBe('maintenance');
    expect(row.scope).toBe('vehicle');
    expect(row.category).toBe('repair');
    expect(row.amount).toBe(180);
    expect(row.vehiclePlate).toBe('1234KDB');
    expect(row.supplier).toBe('Taller Pepe');
  });

  /**
   * Lo que todavía no ha pasado no se ha pagado. Contar una ITV agendada como
   * gasto haría que el módulo mintiera sobre lo que llevas puesto.
   */
  it('ignora lo que no está realizado', () => {
    for (const status of ['pending', 'scheduled', 'overdue', 'cancelled'] as const) {
      expect(maintenanceToExpenseRow(maintenance({ status })), status).toBeNull();
    }
  });

  it('ignora lo realizado sin coste: no hay dinero que sumar', () => {
    expect(maintenanceToExpenseRow(maintenance({ cost: undefined }))).toBeNull();
    expect(maintenanceToExpenseRow(maintenance({ cost: 0 }))).toBeNull();
  });

  /**
   * Suponerle un 21 % sería fabricar una base imponible que después alguien
   * daría por buena. Cuando no se sabe, se dice que no se sabe.
   */
  it('no le inventa desglose de IVA', () => {
    const row = maintenanceToExpenseRow(maintenance())!;
    expect(row.netAmount).toBeUndefined();
    expect(row.vatAmount).toBeUndefined();
  });

  it('mapea los tipos que tienen categoría propia', () => {
    expect(maintenanceToExpenseRow(maintenance({ type: 'insurance' }))!.category).toBe('insurance');
    expect(maintenanceToExpenseRow(maintenance({ type: 'itv' }))!.category).toBe('itv');
    expect(maintenanceToExpenseRow(maintenance({ type: 'tires' }))!.category).toBe('tires');
    expect(maintenanceToExpenseRow(maintenance({ type: 'brakes' }))!.category).toBe('repair');
  });
});

describe('la lista y sus totales', () => {
  it('junta las dos fuentes y ordena de más reciente a más antigua', () => {
    const rows = buildExpenseRows(
      [
        expense({ id: 'e1', concept: 'Gestoría', date: new Date('2026-09-01T00:00:00Z') }),
        expense({ id: 'e2', concept: 'Publicidad', date: new Date('2026-07-01T00:00:00Z') })
      ],
      [
        {
          id: 'm1',
          vehicleId: 'v1',
          type: 'oil_change',
          status: 'completed',
          priority: 'medium',
          title: 'Aceite',
          cost: 180,
          performedAtDate: new Date('2026-08-01T00:00:00Z')
        } as VehicleMaintenance
      ]
    );
    expect(rows.map((r) => r.concept)).toEqual(['Gestoría', 'Aceite', 'Publicidad']);
  });

  it('manda al final lo que no tiene fecha, en vez de colarlo arriba', () => {
    const rows = buildExpenseRows([
      expense({ id: 'e1', concept: 'Sin fecha', date: null }),
      expense({ id: 'e2', concept: 'Con fecha', date: new Date('2026-01-01T00:00:00Z') })
    ]);
    expect(rows.map((r) => r.concept)).toEqual(['Con fecha', 'Sin fecha']);
  });

  it('suma el bruto de todo y reparte por imputación', () => {
    const totals = totalsOf(
      buildExpenseRows([
        expense({ id: 'e1', scope: 'vehicle', amount: 121 }),
        expense({ id: 'e2', scope: 'general', amount: 242 }),
        expense({ id: 'e3', scope: 'reservation', amount: 60.5 })
      ])
    );
    expect(totals.gross).toBe(423.5);
    expect(totals.byScope.vehicle).toBe(121);
    expect(totals.byScope.general).toBe(242);
    expect(totals.byScope.reservation).toBe(60.5);
  });

  /**
   * Que el bruto no sea la suma de bases + IVA es correcto, y la pantalla tiene
   * que poder explicarlo. Si esto se «arregla» igualando los tres números, lo
   * que se ha hecho es inventar el IVA de los mantenimientos.
   */
  it('el IVA solo suma sobre las filas que lo tienen, y dice cuántas son', () => {
    const totals = totalsOf(
      buildExpenseRows(
        [expense({ id: 'e1', amount: 121 })],
        [
          {
            id: 'm1',
            vehicleId: 'v1',
            type: 'brakes',
            status: 'completed',
            priority: 'medium',
            title: 'Frenos',
            cost: 200,
            performedAtDate: new Date('2026-08-01T00:00:00Z')
          } as VehicleMaintenance
        ]
      )
    );
    expect(totals.gross).toBe(321);
    expect(totals.net).toBe(100);
    expect(totals.vat).toBe(21);
    expect(totals.withVatBreakdown).toBe(1);
    expect(totals.count).toBe(2);
    // Y no cuadran, que es justo lo que hay que contar.
    expect(totals.net + totals.vat).not.toBe(totals.gross);
  });

  it('una lista vacía da ceros, no NaN', () => {
    const totals = totalsOf([]);
    expect(totals.gross).toBe(0);
    expect(totals.count).toBe(0);
    expect(totals.byScope.vehicle).toBe(0);
  });

  it('redondea el dinero derivado en cada suma', () => {
    // 0.1 + 0.2 === 0.30000000000000004 sin redondeo por paso.
    const totals = totalsOf(
      buildExpenseRows([expense({ id: 'e1', amount: 0.1 }), expense({ id: 'e2', amount: 0.2 })])
    );
    expect(totals.gross).toBe(0.3);
  });
});

describe('lo que impide guardar un gasto', () => {
  it('acepta un gasto completo', () => {
    expect(validateExpense(expense())).toEqual({});
  });

  /**
   * La clave del mapa es el **nombre del campo**, y eso es lo que permite
   * marcar en rojo el que falla en vez de soltar un mensaje suelto.
   */
  it('exige concepto, importe y fecha, y dice cuál es cuál', () => {
    const problems = validateExpense({ scope: 'general', amount: 0 });
    expect(problems['concept']).toBe('expenses.errors.conceptRequired');
    expect(problems['amount']).toBe('expenses.errors.amountRequired');
    expect(problems['date']).toBe('expenses.errors.dateRequired');
  });

  /**
   * Un gasto imputado a un coche sin coche falsea el coste por vehículo: acaba
   * siendo un gasto general con la etiqueta equivocada.
   */
  it('exige el vehículo si se imputa a un vehículo', () => {
    expect(
      validateExpense(expense({ scope: 'vehicle', vehicleId: undefined }))['vehicleId']
    ).toBe('expenses.errors.vehicleRequired');
    expect(validateExpense(expense({ scope: 'vehicle', vehicleId: 'v1' }))).toEqual({});
  });

  it('exige la reserva si se imputa a una reserva', () => {
    expect(validateExpense(expense({ scope: 'reservation' }))['reservationId']).toBe(
      'expenses.errors.reservationRequired'
    );
  });

  it('no exige nada de eso a un gasto general', () => {
    expect(validateExpense(expense({ scope: 'general' }))).toEqual({});
  });

  /**
   * El orden de las claves es el de los campos en la pantalla: es lo que hace
   * que el resumen junto al botón se lea de arriba abajo igual que el
   * formulario.
   */
  it('devuelve los problemas en el orden en que están los campos', () => {
    const problems = validateExpense({ scope: 'vehicle', amount: 0 });
    expect(Object.keys(problems)).toEqual(['vehicleId', 'concept', 'amount', 'date']);
  });
});
