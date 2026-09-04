import { describe, expect, it } from 'vitest';
import {
  Permission,
  ROUTE_PERMISSIONS,
  USER_ROLES,
  can,
  permissionsOf
} from './permissions.util';

describe('lo que puede un administrador', () => {
  it('puede todo lo que existe', () => {
    const todos = permissionsOf('admin');
    for (const permiso of todos) {
      expect(can('admin', permiso), permiso).toBe(true);
    }
    // Y «todo» quiere decir todo: si mañana se añade un permiso nuevo y se
    // olvida en la lista del admin, esto lo dice.
    const delEmpleado = permissionsOf('employee');
    for (const permiso of delEmpleado) {
      expect(can('admin', permiso), permiso).toBe(true);
    }
  });
});

describe('lo que NO puede un empleado', () => {
  /**
   * Los tres límites que decidió Dorel el 4 de septiembre de 2026. Este test es
   * el sitio donde esa decisión queda escrita de forma que no se pueda relajar
   * sin enterarse.
   */
  it('no toca precios ni descuentos: es donde se regala dinero', () => {
    expect(can('employee', 'editPricing')).toBe(false);
    expect(can('employee', 'grantDiscounts')).toBe(false);
    expect(can('employee', 'waiveDeposit')).toBe(false);
  });

  it('no borra ni cancela: lo irreversible y lo que descuadra la caja', () => {
    expect(can('employee', 'deleteRecords')).toBe(false);
    expect(can('employee', 'cancelReservations')).toBe(false);
  });

  it('no ve la cuenta de resultados', () => {
    expect(can('employee', 'viewReports')).toBe(false);
    expect(can('employee', 'viewExpenses')).toBe(false);
  });

  it('no administra ni los ajustes ni a los demás usuarios', () => {
    expect(can('employee', 'manageSettings')).toBe(false);
    expect(can('employee', 'manageUsers')).toBe(false);
  });

  /**
   * Sí puede, y también es decisión suya: es la salida de emergencia de quien
   * tiene al cliente delante y el coche en la puerta, y queda registrada con
   * autor y motivo.
   */
  it('sí puede saltarse un paso del workflow, que queda registrado', () => {
    expect(can('employee', 'skipWorkflowSteps')).toBe(true);
  });
});

describe('sin rol no se abre nada', () => {
  /**
   * Mientras no se sepa quién es alguien, la respuesta es no. El caso normal
   * —una autorización que todavía está resolviéndose— dura milisegundos; el
   * raro, un documento sin `role`, se queda fuera en vez de entrar por defecto.
   */
  it('null, undefined y un rol desconocido no pueden nada', () => {
    const permisos: Permission[] = [
      'viewReports',
      'viewExpenses',
      'manageSettings',
      'manageUsers',
      'editPricing',
      'deleteRecords',
      'skipWorkflowSteps'
    ];
    for (const permiso of permisos) {
      expect(can(null, permiso), permiso).toBe(false);
      expect(can(undefined, permiso), permiso).toBe(false);
      expect(can('supervisor' as any, permiso), permiso).toBe(false);
    }
  });

  it('permissionsOf devuelve una lista vacía, no revienta', () => {
    expect(permissionsOf(null)).toEqual([]);
    expect(permissionsOf(undefined)).toEqual([]);
    expect(permissionsOf('lo-que-sea' as any)).toEqual([]);
  });
});

describe('las rutas restringidas', () => {
  it('exigen un permiso que existe en la tabla', () => {
    for (const [ruta, permiso] of Object.entries(ROUTE_PERMISSIONS)) {
      // Si un permiso de ruta no se lo da nadie, esa ruta es inalcanzable para
      // todo el mundo y el fallo pasaría por «no se ve el menú».
      const alguienPuede = USER_ROLES.some((role) => can(role, permiso));
      expect(alguienPuede, `${ruta} → ${permiso}`).toBe(true);
    }
  });

  it('dejan fuera al empleado de informes, gastos y ajustes', () => {
    expect(can('employee', ROUTE_PERMISSIONS['reports'])).toBe(false);
    expect(can('employee', ROUTE_PERMISSIONS['expenses'])).toBe(false);
    expect(can('employee', ROUTE_PERMISSIONS['settings'])).toBe(false);
  });

  it('no restringen la operación diaria', () => {
    for (const ruta of ['reservations', 'vehicles', 'clients', 'payments', 'inspections']) {
      expect(ROUTE_PERMISSIONS[ruta], ruta).toBeUndefined();
    }
  });
});

describe('permissionsOf no deja tocar la tabla desde fuera', () => {
  /**
   * Devolvía la lista interna y cualquiera podía hacerle `push`. Una copia
   * cuesta nada y evita que un componente amplíe los permisos de todos sin
   * querer.
   */
  it('devuelve una copia', () => {
    const primera = permissionsOf('employee');
    primera.push('deleteRecords');
    expect(permissionsOf('employee')).not.toContain('deleteRecords');
  });
});
