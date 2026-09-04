/**
 * Quién puede hacer qué.
 *
 * Es **la única autoridad** sobre los permisos, igual que
 * `reservation-workflow.util.ts` lo es sobre el orden del alquiler: el menú, los
 * guards de ruta y los componentes preguntan aquí y no deciden por su cuenta. Un
 * `if (role === 'admin')` suelto en una plantilla es una segunda fuente de
 * verdad, y la primera vez que las dos discrepen nadie sabrá cuál manda.
 *
 * ⚠️ **Esto es la interfaz, no la seguridad.** Un permiso denegado aquí oculta
 * un botón o corta una navegación; lo que impide de verdad que alguien lea o
 * escriba es `firestore.rules`. Los dos tienen que decir lo mismo, y cuando se
 * añade un permiso hay que mirar las reglas también. Defensa en profundidad, la
 * misma idea que «bloquear en UI y validar en el servicio».
 *
 * ⚠️ **Hoy solo están conectados los permisos de módulo entero** —los que
 * deciden si una sección existe para alguien—. Los finos, los que gobiernan
 * botones concretos dentro de una pantalla, están declarados aquí pero todavía
 * no los consulta nadie: ver N-11 en `docs/mejoras-pendientes.md`. Están
 * escritos ya, y no al revés, para que la tabla de permisos nazca completa y en
 * un solo sitio en vez de crecer desperdigada.
 */

export type UserRole = 'admin' | 'employee';

/**
 * Todo lo que se puede permitir o negar.
 *
 * Los nombres dicen la acción, no la pantalla: `viewReports` sigue valiendo si
 * mañana los informes se ven desde otro sitio.
 */
export type Permission =
  // Módulos enteros
  | 'viewReports'
  | 'viewExpenses'
  | 'manageSettings'
  | 'manageUsers'
  // Dinero
  | 'editPricing'
  | 'grantDiscounts'
  | 'waiveDeposit'
  // Irreversible
  | 'deleteRecords'
  | 'cancelReservations'
  // Workflow
  | 'skipWorkflowSteps';

/**
 * La tabla, que es el documento de la decisión.
 *
 * Criterio de Dorel (4 de septiembre de 2026) sobre qué **no** hace un
 * compañero de agencia:
 *
 * - **Precios y descuentos**, porque es donde se regala dinero sin que se note.
 * - **Borrar y cancelar**, que es lo irreversible y lo que descuadra la caja.
 * - **Informes y gastos**, que son la cuenta de resultados del negocio:
 *   información de dueño, no de operación diaria.
 *
 * Y dos que **sí** puede, también por decisión suya, las dos por el mismo
 * motivo: quien está en el mostrador con el cliente delante tiene que poder
 * seguir, y las dos dejan rastro con autor y motivo.
 *
 * - **Saltarse un paso del workflow**, que es la salida de emergencia.
 * - **Eximir la fianza**, que exige motivo desde que existe. Si necesitara
 *   permiso, cada cliente conocido al que no se le cobra fianza acabaría siendo
 *   una llamada a Dorel — y la fianza a 0 es lo normal con clientes conocidos,
 *   no la excepción.
 */
const PERMISSIONS_BY_ROLE: Record<UserRole, Permission[]> = {
  admin: [
    'viewReports',
    'viewExpenses',
    'manageSettings',
    'manageUsers',
    'editPricing',
    'grantDiscounts',
    'waiveDeposit',
    'deleteRecords',
    'cancelReservations',
    'skipWorkflowSteps'
  ],
  employee: ['waiveDeposit', 'skipWorkflowSteps']
};

/**
 * ¿Puede este rol hacer esto?
 *
 * Sin rol —sesión a medio cargar, documento sin `role`— la respuesta es **no**.
 * Es deliberado: mientras no se sepa quién es alguien, no se le abre nada. El
 * caso normal, un usuario legítimo cuya autorización aún está resolviéndose,
 * dura milisegundos y termina con el permiso concedido; el caso raro, alguien
 * sin rol, se queda fuera en vez de entrar por defecto.
 */
export function can(role: UserRole | null | undefined, permission: Permission): boolean {
  if (!role) return false;
  const granted = PERMISSIONS_BY_ROLE[role];
  return !!granted && granted.includes(permission);
}

/** Todos los permisos de un rol, para pintarlos en la ficha del usuario. */
export function permissionsOf(role: UserRole | null | undefined): Permission[] {
  if (!role) return [];
  return [...(PERMISSIONS_BY_ROLE[role] || [])];
}

export const USER_ROLES: UserRole[] = ['admin', 'employee'];

export const USER_ROLE_LABELS: Record<UserRole, string> = {
  admin: 'settings.users.roles.admin',
  employee: 'settings.users.roles.employee'
};

export const USER_ROLE_DESCRIPTIONS: Record<UserRole, string> = {
  admin: 'settings.users.roles.adminHint',
  employee: 'settings.users.roles.employeeHint'
};

/**
 * El permiso que hace falta para entrar en una ruta, si hace falta alguno.
 *
 * Vive aquí y no en `app.routes.ts` para que la lista de rutas restringidas y la
 * tabla de permisos no puedan separarse. Las rutas que no aparecen son las que
 * cualquier usuario autorizado puede ver.
 */
export const ROUTE_PERMISSIONS: Record<string, Permission> = {
  reports: 'viewReports',
  expenses: 'viewExpenses',
  settings: 'manageSettings'
};
