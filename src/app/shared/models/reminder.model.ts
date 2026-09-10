/**
 * Recordatorios manuales: lo que hay que hacer y no sale de ningún dato.
 *
 * «Comprar ambientadores para todos los coches» no lo puede deducir la
 * aplicación de ninguna reserva ni de ninguna ficha. Esto es el sitio donde se
 * apunta, y aparece mezclado con lo que sí se deduce —entregas, ITV, facturas—
 * en la misma pantalla de Eventos.
 *
 * ⚠️ **Lo ve todo el equipo**, decisión de Dorel del 10 de septiembre de 2026.
 * «Limpiar coches» es trabajo que hace su gente; esconderlo obligaría a
 * decírselo por otra vía y entonces la pantalla no serviría para nada. Lo que sí
 * es solo suyo son las **comisiones**, que viven en otro módulo y con su propio
 * permiso.
 */

/**
 * De qué va el recordatorio.
 *
 * ⚠️ **Es para agrupar y poner un icono, no para restringir.** El título es
 * texto libre y es lo que se lee; esto solo ayuda a que veinte recordatorios no
 * sean una lista plana. Por eso hay `other`: una categoría cerrada que obligue a
 * forzar la realidad acaba con todo en la que menos molesta.
 *
 * Los valores salen de los ejemplos que dio Dorel, que son los reales:
 * pagar deuda, apuntar un pago en efectivo, comprar ambientadores, limpiar
 * coches, pagar incentivos a los colaboradores.
 */
export type ReminderCategory =
  /** Pagar algo: una deuda, un proveedor, los incentivos de un colaborador. */
  | 'payment'
  /** Apuntar algo en la aplicación que se hizo fuera. Un cobro en efectivo. */
  | 'paperwork'
  /** Comprar: ambientadores, consumibles, recambios. */
  | 'purchase'
  /** Trabajo sobre la flota que no es mantenimiento mecánico: limpiar, fotos. */
  | 'fleet'
  | 'other';

export const REMINDER_CATEGORIES: ReminderCategory[] = [
  'payment',
  'paperwork',
  'purchase',
  'fleet',
  'other'
];

export const REMINDER_CATEGORY_LABELS: Record<ReminderCategory, string> = {
  payment: 'events.categories.payment',
  paperwork: 'events.categories.paperwork',
  purchase: 'events.categories.purchase',
  fleet: 'events.categories.fleet',
  other: 'events.categories.other'
};

/** El icono de cada categoría. PrimeIcons, por clase CSS. */
export const REMINDER_CATEGORY_ICONS: Record<ReminderCategory, string> = {
  payment: 'pi pi-wallet',
  paperwork: 'pi pi-pencil',
  purchase: 'pi pi-shopping-cart',
  fleet: 'pi pi-car',
  other: 'pi pi-bookmark'
};

export interface Reminder {
  id?: string;

  /** Lo que hay que hacer, en las palabras de quien lo apunta. */
  title: string;
  notes?: string;
  category: ReminderCategory;

  /**
   * Cuándo toca.
   *
   * ⚠️ **Fecha de verdad, nunca la cadena del `<input type="date">`.** Guardada
   * como texto, ninguna comparación con un `Timestamp` casa nunca y el
   * recordatorio se vuelve invisible sin dar un solo error — es exactamente lo
   * que pasó con la ITV programada, y por eso el formulario convierte antes de
   * escribir.
   */
  dueDate: any;

  /**
   * ⚠️ **`done` es un campo, no un borrado.** Lo hecho se queda: sirve para
   * saber que se compró el ambientador el mes pasado y decidir si toca otra vez.
   * La pantalla lo esconde por defecto, que no es lo mismo.
   */
  done: boolean;
  doneAt?: any;
  doneBy?: string;

  createdAt?: any;
  updatedAt?: any;
  createdBy?: string;
}
