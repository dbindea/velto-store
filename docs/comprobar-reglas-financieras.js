/**
 * ¿Puede un empleado ver la cuenta de resultados saltándose la aplicación?
 *
 * ⚠️ **Esto NO es código de la aplicación.** Es un guion para pegar en la consola
 * del navegador con la sesión abierta. Está aquí y no en un test porque la única
 * prueba que vale para `firestore.rules` es la que se hace **por fuera**: con el
 * token de la sesión sacado de IndexedDB y llamadas directas a la API REST de
 * Firestore. Un test de la aplicación solo demuestra que la aplicación se porta
 * bien, y el agujero de `invoices` del 8 de septiembre de 2026 —permiso de
 * administrador, regla abierta a cualquiera— lo habría pasado por alto entero.
 *
 * CÓMO SE USA
 *   1. Abre la aplicación (desarrollo) y entra.
 *   2. F12 → Console, pega esto, Enter.
 *   3. Repítelo con una cuenta de rol `employee`: es la pasada que importa.
 *
 * El guion **lee tu rol** de `authorizedUsers` y ajusta lo que espera, así que
 * sirve para las dos sesiones sin tocar nada.
 *
 * ⚠️ **`payments` sale en verde con 200 para un empleado, y es correcto.** No es
 * un hueco que se haya olvidado: la ficha de la reserva y la del cliente
 * necesitan leer los pagos **cobrados** para enseñar su resumen, y una regla no
 * distingue si quien lee llegó desde una reserva o desde una consulta suelta. Lo
 * que la aplicación hace con eso es no ofrecer el histórico
 * (`viewPaymentHistory`, ver `payment-scope.util.ts`), y eso es interfaz, no
 * seguridad. Está escrito aquí para que nadie lea este guion en verde y crea que
 * el libro de caja está cerrado por las reglas, porque no lo está.
 */
(async () => {
  const PROJECT = 'velto-store';
  const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;

  const sesion = await new Promise((resolve) => {
    const req = indexedDB.open('firebaseLocalStorageDb');
    req.onsuccess = () => {
      const tx = req.result.transaction('firebaseLocalStorage', 'readonly');
      const all = tx.objectStore('firebaseLocalStorage').getAll();
      all.onsuccess = () => {
        const rec = (all.result || []).find((r) => r?.value?.stsTokenManager?.accessToken);
        resolve({
          token: rec?.value?.stsTokenManager?.accessToken || null,
          email: (rec?.value?.email || '').toLowerCase()
        });
      };
      all.onerror = () => resolve({ token: null, email: '' });
    };
    req.onerror = () => resolve({ token: null, email: '' });
  });
  if (!sesion.token) return console.error('No hay sesión abierta en esta pestaña.');

  const call = async (method, path, body) => {
    const res = await fetch(`${BASE}/${path}`, {
      method,
      headers: { Authorization: `Bearer ${sesion.token}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };

  // --- Quién eres, según Firestore y no según la pantalla ------------------
  const yo = await call('GET', `authorizedUsers/${sesion.email}`);
  const rol = yo.body?.fields?.role?.stringValue || '(desconocido)';
  const esAdmin = rol === 'admin';
  console.log(`%cSesión: ${sesion.email} — rol ${rol}`, 'font-weight:bold');

  /**
   * Lo que hay que poder leer y lo que no.
   *
   * `soloAdmin: true` significa que la colección es información de dueño y la
   * regla tiene que denegarla a cualquier otro. `soloAdmin: false` es lo que un
   * empleado necesita para trabajar y por tanto está abierto **a propósito**.
   */
  const COLECCIONES = [
    { nombre: 'expenses', soloAdmin: true, que: 'los gastos' },
    { nombre: 'invoices', soloAdmin: true, que: 'las facturas, con NIF y domicilio fiscal' },
    { nombre: 'invoiceCounters', soloAdmin: true, que: 'los contadores de serie' },
    { nombre: 'billingProfiles', soloAdmin: true, que: 'la agenda fiscal' },
    { nombre: 'verifactuDeclarations', soloAdmin: true, que: 'las declaraciones responsables' },
    { nombre: 'verifactuSubmissions', soloAdmin: true, que: 'los acuses de la AEAT' },
    { nombre: 'collaborators', soloAdmin: true, que: 'a quién se le paga comisión' },
    { nombre: 'collaboratorSales', soloAdmin: true, que: 'cuánto se le debe a cada uno' },
    { nombre: 'payments', soloAdmin: false, que: 'los cobros — abierto a propósito, ver cabecera' },
    { nombre: 'reservations', soloAdmin: false, que: 'las reservas' },
    { nombre: 'vehicles', soloAdmin: false, que: 'la flota' }
  ];

  console.log('%c=== LECTURA ===', 'font-weight:bold');
  const filas = [];
  let fallos = 0;
  for (const c of COLECCIONES) {
    const r = await call('GET', `${c.nombre}?pageSize=1`);
    const deberia = esAdmin || !c.soloAdmin ? 200 : 403;
    const ok = r.status === deberia;
    if (!ok) fallos++;
    filas.push({
      colección: c.nombre,
      qué: c.que,
      esperado: deberia,
      recibido: r.status,
      '': ok ? '✅' : '❌'
    });
  }
  console.table(filas);

  // --- Escribir donde no toca ---------------------------------------------
  // Leer es la mitad. Un empleado que pudiera CREAR un gasto o una comisión
  // metería ruido en unas cifras que solo mira Dorel, y sin dejar rastro de
  // quién lo hizo.
  console.log('%c=== ESCRITURA ===', 'font-weight:bold');
  const escrituras = [
    { nombre: 'expenses', campos: { concept: { stringValue: 'PRUEBA DE REGLAS' } } },
    { nombre: 'collaboratorSales', campos: { note: { stringValue: 'PRUEBA DE REGLAS' } } }
  ];
  for (const e of escrituras) {
    const r = await call('POST', e.nombre, { fields: e.campos });
    const deberia = esAdmin ? 200 : 403;
    const ok = r.status === deberia;
    if (!ok) fallos++;
    console.log(`${ok ? '✅' : '❌'} POST ${e.nombre} → ${r.status} (esperado ${deberia})`);
    // Si el administrador lo creó de verdad, se retira: esto es una prueba, no
    // un gasto.
    const id = r.body?.name?.split('/').pop();
    if (r.status === 200 && id) await call('DELETE', `${e.nombre}/${id}`);
  }

  // --- Lo que lo desharía todo --------------------------------------------
  // Un empleado que pueda ascenderse a administrador no tiene ninguna de las
  // restricciones de arriba: le basta con un PATCH y volver a entrar.
  console.log('%c=== ASCENDERSE A ADMINISTRADOR ===', 'font-weight:bold');
  const ascenso = await call(
    'PATCH',
    `authorizedUsers/${sesion.email}?updateMask.fieldPaths=role`,
    { fields: { role: { stringValue: 'admin' } } }
  );
  if (esAdmin) {
    console.log(`· PATCH → ${ascenso.status} (ya eres admin: aquí no prueba nada)`);
  } else {
    const ok = ascenso.status === 403;
    if (!ok) fallos++;
    console.log(
      `${ok ? '✅' : '❌'} PATCH → ${ascenso.status}` +
        (ok ? ' (denegado, correcto)' : ' ¡TE HAS PODIDO ASCENDER! Revisa authorizedUsers YA')
    );
  }

  console.log(
    fallos === 0
      ? `%c✅ Las reglas dicen lo mismo que permissions.util.ts (rol ${rol})`
      : `%c❌ ${fallos} discrepancia(s) entre las reglas y la tabla de permisos`,
    'font-weight:bold'
  );
})();
