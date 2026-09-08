/**
 * Comprobación de las reglas y del encadenamiento de facturas.
 *
 * ⚠️ **Esto NO es código de la aplicación.** Es un guion para pegar una vez en
 * la consola del navegador, con la sesión abierta, y borrarlo después. Está
 * aquí y no en un test porque la única prueba que vale para `firestore.rules`
 * es la que se hace **saltándose la aplicación**: con el token de la sesión y
 * llamadas directas a la API REST de Firestore. Es la misma prueba con la que
 * se validaron los permisos de empleado el 7 de septiembre de 2026.
 *
 * ⚠️ **En DESARROLLO.** Intenta modificar y borrar una factura de verdad: si
 * alguna vez las reglas fallasen, en producción habría tocado un documento
 * fiscal que no se puede reponer.
 *
 * CÓMO SE USA
 *   1. Abre la aplicación (desarrollo) y entra con tu cuenta.
 *   2. Abre la consola del navegador (F12 → Console).
 *   3. Pega todo esto y pulsa Enter.
 *
 * RESULTADO DEL 8 DE SEPTIEMBRE DE 2026 — todo verde sobre cuatro facturas:
 *   ✅ Cadena íntegra (cada previousHash coincide con la anterior)
 *   ✅ PATCH  → 403      ✅ DELETE → 403      ✅ La factura sigue intacta
 *
 * Esa misma pasada destapó que las reglas eran más laxas que el permiso de la
 * aplicación: `viewInvoices` es de administrador y `invoices` se dejaba leer a
 * cualquier autorizado. Ver la nota en CLAUDE.md.
 *
 * QUÉ COMPRUEBA
 *   A. Que una factura emitida NO se puede modificar ni borrar, ni siendo
 *      administrador. Las dos llamadas deben dar 403.
 *   B. Que la cadena de huellas está bien: la huella de cada factura es la
 *      `previousHash` de la siguiente, y la primera arranca en vacío.
 */
(async () => {
  const PROJECT = 'velto-store';
  const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;

  // El token de la sesión abierta, tal cual lo guarda el SDK de Firebase.
  const token = await new Promise((resolve) => {
    const req = indexedDB.open('firebaseLocalStorageDb');
    req.onsuccess = () => {
      const tx = req.result.transaction('firebaseLocalStorage', 'readonly');
      const all = tx.objectStore('firebaseLocalStorage').getAll();
      all.onsuccess = () => {
        const rec = (all.result || []).find((r) => r?.value?.stsTokenManager?.accessToken);
        resolve(rec?.value?.stsTokenManager?.accessToken || null);
      };
      all.onerror = () => resolve(null);
    };
    req.onerror = () => resolve(null);
  });
  if (!token) return console.error('No hay sesión abierta en esta pestaña.');

  const call = async (method, path, body) => {
    const res = await fetch(`${BASE}/${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };

  // --- A. Leer las facturas -------------------------------------------------
  const lista = await call('GET', 'invoices?pageSize=20');
  if (lista.status !== 200) {
    return console.error('No se pudieron leer las facturas:', lista.status, lista.body);
  }
  const docs = (lista.body.documents || [])
    .map((d) => ({
      id: d.name.split('/').pop(),
      numero: d.fields?.fullNumber?.stringValue,
      n: Number(d.fields?.number?.integerValue ?? 0),
      hash: d.fields?.hash?.stringValue || '',
      previo: d.fields?.previousHash?.stringValue ?? '(sin campo)',
      total: d.fields?.totals?.mapValue?.fields?.total?.doubleValue ?? '?'
    }))
    .sort((a, b) => a.n - b.n);

  console.log('%c=== FACTURAS ===', 'font-weight:bold');
  console.table(docs.map((d) => ({ ...d, hash: d.hash.slice(0, 16) + '…', previo: String(d.previo).slice(0, 16) + '…' })));

  // --- B. La cadena de huellas ---------------------------------------------
  console.log('%c=== ENCADENAMIENTO ===', 'font-weight:bold');
  let cadenaOk = true;
  docs.forEach((d, i) => {
    const esperado = i === 0 ? '' : docs[i - 1].hash;
    const ok = String(d.previo) === esperado;
    if (!ok) cadenaOk = false;
    console.log(
      `${ok ? '✅' : '❌'} ${d.numero}: previousHash ${ok ? 'coincide con' : 'NO coincide con'} la anterior`
    );
  });
  console.log(cadenaOk ? '✅ Cadena íntegra' : '❌ CADENA ROTA');

  // --- C. Las reglas: modificar y borrar deben dar 403 ---------------------
  console.log('%c=== REGLAS (se esperan dos 403) ===', 'font-weight:bold');
  const victima = docs[0];
  if (!victima) return console.warn('No hay facturas que atacar.');

  const patch = await call(
    'PATCH',
    `invoices/${victima.id}?updateMask.fieldPaths=notes`,
    { fields: { notes: { stringValue: 'MODIFICADO SIN PERMISO' } } }
  );
  console.log(
    `${patch.status === 403 ? '✅' : '❌'} PATCH → ${patch.status}` +
      (patch.status === 403 ? ' (denegado, correcto)' : ' ¡SE PUDO MODIFICAR!')
  );

  const del = await call('DELETE', `invoices/${victima.id}`);
  console.log(
    `${del.status === 403 ? '✅' : '❌'} DELETE → ${del.status}` +
      (del.status === 403 ? ' (denegado, correcto)' : ' ¡SE PUDO BORRAR!')
  );

  // Y que la factura sigue intacta después del intento.
  const despues = await call('GET', `invoices/${victima.id}`);
  console.log(
    despues.status === 200 && despues.body?.fields?.notes?.stringValue !== 'MODIFICADO SIN PERMISO'
      ? '✅ La factura sigue intacta'
      : '❌ La factura cambió o desapareció'
  );
})();
