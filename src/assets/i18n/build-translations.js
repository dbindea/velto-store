// scripts/translations.js
//
// Reads the canonical schema, migrates existing translations, fills missing
// keys from a curated dictionary (es/en/ro), and writes the final files.
//
// Run:  node src/assets/i18n/build-translations.js

const fs = require('fs');
const path = require('path');
const ROOT = 'C:/Users/dorel/workspace/velto-store/src/assets/i18n';

// ---------------------------------------------------------------------------
// Curated translations for keys the previous locale files were missing.
// Only keys that were NOT in the old es/en/ro files are listed here.
// ---------------------------------------------------------------------------

const T = {
  // common
  'common.create': { es: 'Crear', en: 'Create', ro: 'Creează' },

  // currentImage
  'currentImage.url': { es: 'URL de imagen actual', en: 'Current image URL', ro: 'URL imagine curentă' },

  // inspections.cleanliness (extra)
  'inspections.cleanliness.normal':  { es: 'Normal', en: 'Normal', ro: 'Normal' },
  'inspections.cleanliness.veryDirty': { es: 'Muy sucio', en: 'Very dirty', ro: 'Foarte murdar' },

  // inspections.fuel
  'inspections.fuel.empty':         { es: 'Vacío',         en: 'Empty',          ro: 'Gol' },
  'inspections.fuel.quarter':       { es: '1/4',           en: '1/4',            ro: '1/4' },
  'inspections.fuel.half':          { es: '1/2',           en: '1/2',            ro: '1/2' },
  'inspections.fuel.threeQuarters': { es: '3/4',           en: '3/4',            ro: '3/4' },
  'inspections.fuel.full':          { es: 'Lleno',         en: 'Full',           ro: 'Plin' },

  // inspections.photos categories
  'inspections.photos.front':     { es: 'Frontal',         en: 'Front',          ro: 'Față' },
  'inspections.photos.rear':      { es: 'Trasera',         en: 'Rear',           ro: 'Spate' },
  'inspections.photos.leftSide':  { es: 'Lateral izquierdo', en: 'Left side',    ro: 'Partea stângă' },
  'inspections.photos.rightSide': { es: 'Lateral derecho', en: 'Right side',     ro: 'Partea dreaptă' },
  'inspections.photos.interior':  { es: 'Interior',        en: 'Interior',       ro: 'Interior' },
  'inspections.photos.dashboard': { es: 'Cuadro',          en: 'Dashboard',      ro: 'Bord' },
  'inspections.photos.fuel':      { es: 'Combustible',     en: 'Fuel',           ro: 'Combustibil' },
  'inspections.photos.damage':    { es: 'Daño',            en: 'Damage',         ro: 'Deteriorare' },
  'inspections.photos.other':     { es: 'Otro',            en: 'Other',          ro: 'Altul' },

  // inspections.damages
  'inspections.damages.areaFront':     { es: 'Frontal',         en: 'Front',       ro: 'Față' },
  'inspections.damages.areaRear':      { es: 'Trasera',         en: 'Rear',        ro: 'Spate' },
  'inspections.damages.areaLeftSide':  { es: 'Lateral izquierdo', en: 'Left side', ro: 'Stânga' },
  'inspections.damages.areaRightSide': { es: 'Lateral derecho',  en: 'Right side', ro: 'Dreapta' },
  'inspections.damages.areaRoof':      { es: 'Techo',           en: 'Roof',        ro: 'Acoperiș' },
  'inspections.damages.areaInterior':  { es: 'Interior',        en: 'Interior',    ro: 'Interior' },
  'inspections.damages.areaWheels':    { es: 'Ruedas',          en: 'Wheels',      ro: 'Roți' },
  'inspections.damages.areaWindows':   { es: 'Ventanas',        en: 'Windows',     ro: 'Geamuri' },
  'inspections.damages.areaOther':     { es: 'Otro',            en: 'Other',       ro: 'Altul' },
  'inspections.damages.minor':         { es: 'Leve',            en: 'Minor',       ro: 'Minor' },
  'inspections.damages.medium':        { es: 'Medio',           en: 'Medium',      ro: 'Mediu' },
  'inspections.damages.serious':       { es: 'Grave',           en: 'Serious',     ro: 'Grav' },

  // inspections type labels
  'inspections.pickup': { es: 'Entrega',  en: 'Pickup',  ro: 'Predare' },
  'inspections.return': { es: 'Devolución', en: 'Return', ro: 'Returnare' },

  // reservations
  'reservations.actions.close':          { es: 'Cerrar reserva',     en: 'Close reservation', ro: 'Închide rezervarea' },
  'reservations.actions.viewReservation':{ es: 'Ver reserva',        en: 'View reservation',  ro: 'Vezi rezervarea' },

  // contracts (sign page)
  'contracts.sign.invalid': { es: 'Enlace no válido o contrato no encontrado.', en: 'Invalid link or contract not found.', ro: 'Link nevalid sau contract negăsit.' },
  'contracts.sign.highlightsTitle': { es: 'Lo principal a tener en cuenta', en: 'What you need to know', ro: 'Ce trebuie să știți' },

  // common
  'common.viewAll': { es: 'Ver todo', en: 'View all', ro: 'Vezi tot' },
  'common.copied': { es: 'Copiado', en: 'Copied', ro: 'Copiat' },

  // photos
  'photos.camera': { es: 'Cámara', en: 'Camera', ro: 'Cameră' },
  'photos.gallery': { es: 'Galería', en: 'Gallery', ro: 'Galerie' },

  // brand
  'brand.logoAlt': { es: 'Velto Rent', en: 'Velto Rent', ro: 'Velto Rent' },
  'brand.velto': { es: 'Velto', en: 'Velto', ro: 'Velto' },

  // payments.types.freePayment
  'payments.types.freePayment': { es: 'Cobro libre', en: 'Free payment', ro: 'Plată liberă' },

  // payments.free
  'payments.free.title': { es: 'Cobro libre', en: 'Free payment', ro: 'Plată liberă' },
  'payments.free.subtitle': {
    es: 'Crea un cobro sin reserva asociada (diferencias, penalizaciones, servicios sueltos).',
    en: 'Create a charge without a reservation (differences, penalties, one-off services).',
    ro: 'Creează o încasare fără rezervare asociată (diferențe, penalități, servicii ocazionale).'
  },
  'payments.free.new': { es: 'Nuevo cobro', en: 'New charge', ro: 'Încasare nouă' },
  'payments.free.amount': { es: 'Importe', en: 'Amount', ro: 'Sumă' },
  'payments.free.concept': { es: 'Concepto', en: 'Concept', ro: 'Concept' },
  'payments.free.conceptPlaceholder': {
    es: 'Ej: diferencia por combustible',
    en: 'E.g. fuel difference',
    ro: 'Ex: diferență combustibil'
  },
  'payments.free.payerSection': { es: 'Datos del pagador (opcional)', en: 'Payer details (optional)', ro: 'Datele plătitorului (opțional)' },
  'payments.free.payerHint': {
    es: 'Si los rellenas, te servirán para localizar al pagador y para enviarle el link de Redsys.',
    en: 'If filled in, they help locate the payer and send them the Redsys link.',
    ro: 'Dacă sunt completate, ajută la identificarea plătitorului și la trimiterea linkului Redsys.'
  },
  'payments.free.payerName': { es: 'Nombre del pagador', en: 'Payer name', ro: 'Nume plătitor' },
  'payments.free.payerEmail': { es: 'Email del pagador', en: 'Payer email', ro: 'Email plătitor' },
  'payments.free.payerPhone': { es: 'Teléfono del pagador', en: 'Payer phone', ro: 'Telefon plătitor' },
  'payments.free.generateRedsysLink': {
    es: 'Generar cobro',
    en: 'Generate charge',
    ro: 'Generează încasare'
  },
  'payments.free.openRedsys': { es: 'Abrir pasarela', en: 'Open gateway', ro: 'Deschide gateway' },
  'payments.free.copyLink': { es: 'Copiar link', en: 'Copy link', ro: 'Copiază link' },
  'payments.free.created': { es: 'Cobro creado', en: 'Charge created', ro: 'Încasare creată' },
  'payments.free.paid': { es: 'Cobro pagado', en: 'Charge paid', ro: 'Încasare plătită' },
  'payments.free.failed': { es: 'Cobro fallido', en: 'Charge failed', ro: 'Încasare eșuată' },
  'payments.free.amountRequired': {
    es: 'Introduce un importe mayor que 0.',
    en: 'Enter an amount greater than 0.',
    ro: 'Introdu o sumă mai mare decât 0.'
  },
  'payments.free.conceptRequired': {
    es: 'El concepto es obligatorio.',
    en: 'Concept is required.',
    ro: 'Conceptul este obligatoriu.'
  },
  'payments.free.webhookHint': {
    es: 'El estado se actualizará automáticamente cuando Redsys confirme el pago.',
    en: 'Status will update automatically once Redsys confirms the payment.',
    ro: 'Starea se va actualiza automat când Redsys confirmă plata.'
  },
  'payments.free.manualHint': {
    es: 'Pago manual: márcalo como pagado desde el detalle cuando lo confirmes.',
    en: 'Manual payment: mark it as paid from the detail once confirmed.',
    ro: 'Plată manuală: marchează ca plătită din detaliu după confirmare.'
  },

  // payments.filters
  'payments.filters.reservationPayments': {
    es: 'Pagos de reservas',
    en: 'Reservation payments',
    ro: 'Plăți din rezervări'
  },
  'payments.filters.freePayments': {
    es: 'Cobros libres',
    en: 'Free payments',
    ro: 'Plăți libere'
  },

  // maintenance
  'maintenance.title': { es: 'Mantenimiento', en: 'Maintenance', ro: 'Mentenanță' },
  'maintenance.subtitle': {
    es: 'Historial y alertas de mantenimiento del vehículo.',
    en: 'Maintenance history and alerts for this vehicle.',
    ro: 'Istoric și alerte de mentenanță pentru acest vehicul.'
  },
  'maintenance.new': { es: 'Nuevo mantenimiento', en: 'New maintenance', ro: 'Mentenanță nouă' },
  'maintenance.edit': { es: 'Editar mantenimiento', en: 'Edit maintenance', ro: 'Editează mentenanța' },
  'maintenance.history': { es: 'Historial', en: 'History', ro: 'Istoric' },
  'maintenance.upcoming': { es: 'Próximos', en: 'Upcoming', ro: 'Viitoare' },
  'maintenance.overdue': { es: 'Vencidos', en: 'Overdue', ro: 'Întârziate' },
  'maintenance.completed': { es: 'Realizados', en: 'Completed', ro: 'Efectuate' },
  'maintenance.dueSoon': { es: 'Próximos a vencer', en: 'Due soon', ro: 'Aproape de scadență' },
  'maintenance.empty': {
    es: 'Sin registros de mantenimiento para este vehículo.',
    en: 'No maintenance records for this vehicle.',
    ro: 'Fără înregistrări de mentenanță pentru acest vehicul.'
  },
  'maintenance.itemSingular': { es: 'ítem', en: 'item', ro: 'element' },
  'maintenance.itemPlural': { es: 'ítems', en: 'items', ro: 'elemente' },
  'maintenance.type.oilChange': { es: 'Cambio de aceite', en: 'Oil change', ro: 'Schimb de ulei' },
  'maintenance.type.tires': { es: 'Cambio de ruedas', en: 'Tire change', ro: 'Schimb de anvelope' },
  'maintenance.type.itv': { es: 'ITV', en: 'MOT / ITV', ro: 'ITV' },
  'maintenance.type.insurance': { es: 'Seguro', en: 'Insurance', ro: 'Asigurare' },
  'maintenance.type.generalRevision': { es: 'Revisión general', en: 'General revision', ro: 'Revizie generală' },
  'maintenance.type.brakes': { es: 'Frenos', en: 'Brakes', ro: 'Frâne' },
  'maintenance.type.battery': { es: 'Batería', en: 'Battery', ro: 'Baterie' },
  'maintenance.type.breakdown': { es: 'Avería', en: 'Breakdown', ro: 'Defecțiune' },
  'maintenance.type.cleaning': { es: 'Limpieza', en: 'Cleaning', ro: 'Curățenie' },
  'maintenance.type.other': { es: 'Otro', en: 'Other', ro: 'Altceva' },
  'maintenance.status.pending': { es: 'Pendiente', en: 'Pending', ro: 'În așteptare' },
  'maintenance.status.scheduled': { es: 'Programado', en: 'Scheduled', ro: 'Programat' },
  'maintenance.status.completed': { es: 'Completado', en: 'Completed', ro: 'Efectuat' },
  'maintenance.status.overdue': { es: 'Vencido', en: 'Overdue', ro: 'Întârziat' },
  'maintenance.status.cancelled': { es: 'Cancelado', en: 'Cancelled', ro: 'Anulat' },
  'maintenance.priority.low': { es: 'Baja', en: 'Low', ro: 'Scăzută' },
  'maintenance.priority.medium': { es: 'Media', en: 'Medium', ro: 'Medie' },
  'maintenance.priority.high': { es: 'Alta', en: 'High', ro: 'Ridicată' },
  'maintenance.priority.critical': { es: 'Crítica', en: 'Critical', ro: 'Critică' },
  'maintenance.fields.title': { es: 'Título', en: 'Title', ro: 'Titlu' },
  'maintenance.fields.status': { es: 'Estado', en: 'Status', ro: 'Stare' },
  'maintenance.fields.priority': { es: 'Prioridad', en: 'Priority', ro: 'Prioritate' },
  'maintenance.fields.description': { es: 'Descripción', en: 'Description', ro: 'Descriere' },
  'maintenance.fields.performedAt': { es: 'Realización', en: 'Performed', ro: 'Efectuare' },
  'maintenance.fields.performedAtDate': { es: 'Fecha realizado', en: 'Date performed', ro: 'Data efectuarii' },
  'maintenance.fields.performedAtKm': { es: 'Km realizado', en: 'Km performed', ro: 'Km la efectuare' },
  'maintenance.fields.nextDue': { es: 'Próxima', en: 'Next due', ro: 'Următoarea' },
  'maintenance.fields.nextDueDate': { es: 'Próxima fecha', en: 'Next due date', ro: 'Data următoare' },
  'maintenance.fields.nextDueKm': { es: 'Próximo km', en: 'Next due km', ro: 'Km următor' },
  'maintenance.fields.cost': { es: 'Coste', en: 'Cost', ro: 'Cost' },
  'maintenance.fields.provider': { es: 'Proveedor', en: 'Provider', ro: 'Furnizor' },
  'maintenance.fields.notes': { es: 'Notas', en: 'Notes', ro: 'Note' },
  'maintenance.fields.invoice': { es: 'Factura / documento', en: 'Invoice / document', ro: 'Factură / document' },
  'maintenance.actions.complete': { es: 'Completar', en: 'Complete', ro: 'Completează' },
  'maintenance.actions.cancel': { es: 'Cancelar', en: 'Cancel', ro: 'Anulează' },
  'maintenance.actions.uploadInvoice': { es: 'Subir factura', en: 'Upload invoice', ro: 'Încarcă factura' },
  'maintenance.alerts.dueSoon': { es: 'Vence pronto', en: 'Due soon', ro: 'Aproape de scadență' },
  'maintenance.alerts.overdue': { es: 'Vencido', en: 'Overdue', ro: 'Întârziat' },
  'maintenance.alerts.kmSoon': { es: 'Km próximo', en: 'Km approaching', ro: 'Km aproape' },
  'maintenance.alerts.kmOverdue': { es: 'Km superado', en: 'Km overdue', ro: 'Km depășit' },

  // timeline
  'timeline.title': { es: 'Estado de la reserva', en: 'Reservation status', ro: 'Starea rezervării' },
  'timeline.reservationCreated': { es: 'Reserva creada', en: 'Reservation created', ro: 'Rezervare creată' },
  'timeline.initialPaymentPaid': { es: 'Señal pagada', en: 'Deposit paid', ro: 'Avans plătit' },
  'timeline.contractGenerated': { es: 'Contrato generado', en: 'Contract generated', ro: 'Contract generat' },
  'timeline.contractSigned': { es: 'Contrato firmado', en: 'Contract signed', ro: 'Contract semnat' },
  'timeline.remainingPaymentPaid': { es: 'Resto del alquiler pagado', en: 'Remaining rental paid', ro: 'Rest de închiriere plătit' },
  'timeline.depositPaid': { es: 'Fianza cobrada', en: 'Deposit collected', ro: 'Garanție încasată' },
  'timeline.pickupCompleted': { es: 'Entrega realizada', en: 'Pickup completed', ro: 'Predare efectuată' },
  'timeline.returnCompleted': { es: 'Devolución realizada', en: 'Return completed', ro: 'Returnare efectuată' },
  'timeline.depositSettled': { es: 'Fianza resuelta', en: 'Deposit settled', ro: 'Garanție soluționată' },
  'timeline.reservationClosed': { es: 'Reserva cerrada', en: 'Reservation closed', ro: 'Rezervare închisă' },
  'timeline.completed': { es: 'Completado', en: 'Completed', ro: 'Efectuat' },
  'timeline.current': { es: 'En curso', en: 'In progress', ro: 'În curs' },
  'timeline.pending': { es: 'Pendiente', en: 'Pending', ro: 'În așteptare' },
  'timeline.blocked': { es: 'Bloqueado', en: 'Blocked', ro: 'Blocat' },
  'timeline.skippedByException': {
    es: 'Omitido por excepción',
    en: 'Skipped by exception',
    ro: 'Omis prin excepție'
  },
  'timeline.nextAction': {
    es: 'Siguiente acción',
    en: 'Next action',
    ro: 'Acțiune următoare'
  },

  // workflow actions (timeline)
  'workflow.payInitial': { es: 'Cobrar señal', en: 'Collect deposit', ro: 'Încasează avans' },
  'workflow.generateContract': { es: 'Generar contrato', en: 'Generate contract', ro: 'Generează contract' },
  'workflow.generateSigningLink': { es: 'Crear link de firma', en: 'Create signing link', ro: 'Creează link semnare' },
  'workflow.contractPending': { es: 'Pendiente de firma', en: 'Pending signature', ro: 'În așteptarea semnării' },
  'workflow.payRemaining': { es: 'Cobrar resto', en: 'Collect remaining', ro: 'Încasează rest' },
  'workflow.payDeposit': { es: 'Cobrar fianza', en: 'Collect deposit (hold)', ro: 'Încasează garanție' },
  'workflow.startPickup': { es: 'Iniciar entrega', en: 'Start pickup', ro: 'Începe predarea' },
  'workflow.startReturn': { es: 'Iniciar devolución', en: 'Start return', ro: 'Începe returnarea' },
  'workflow.settleDeposit': { es: 'Resolver fianza', en: 'Settle deposit', ro: 'Soluționează garanția' },
  'workflow.closeReservation': { es: 'Cerrar reserva', en: 'Close reservation', ro: 'Închide rezervarea' },
  'workflow.blockedPickup': {
    es: 'Falta contrato firmado, resto pagado y fianza cobrada.',
    en: 'Signed contract, remaining payment and deposit required first.',
    ro: 'Contract semnat, rest plătit și garanție necesare mai întâi.'
  },
  'workflow.blockedReturn': {
    es: 'Primero realiza la entrega.',
    en: 'Complete the pickup first.',
    ro: 'Efectuează întâi predarea.'
  },
  'workflow.blockedSettleDeposit': {
    es: 'Espera a la devolución del vehículo.',
    en: 'Wait for the vehicle return.',
    ro: 'Așteaptă returnarea vehiculului.'
  },
  'workflow.blockedClose': {
    es: 'Falta devolver el vehículo y resolver la fianza.',
    en: 'Return the vehicle and settle the deposit first.',
    ro: 'Returnează vehiculul și soluționează garanția mai întâi.'
  },

  // common
  'common.refresh': { es: 'Actualizar', en: 'Refresh', ro: 'Reîmprospătează' },
  'common.error': { es: 'Algo ha ido mal', en: 'Something went wrong', ro: 'Ceva nu a mers bine' },
  'common.systemUser': { es: 'Sistema', en: 'System', ro: 'Sistem' },

  // reservations.notes
  'reservations.notes.title': { es: 'Notas internas', en: 'Internal notes', ro: 'Note interne' },
  'reservations.notes.hint': {
    es: 'Estas notas son privadas y no aparecen en el contrato. Se conservan como histórico del operador.',
    en: 'These notes are private and never appear on the contract. They are kept as operator history.',
    ro: 'Aceste note sunt private și nu apar pe contract. Sunt păstrate ca istoric al operatorului.'
  },
  'reservations.notes.placeholder': {
    es: 'Añade una nota para el equipo…',
    en: 'Add a note for the team…',
    ro: 'Adaugă o notă pentru echipă…'
  },
  'reservations.notes.add': { es: 'Añadir nota', en: 'Add note', ro: 'Adaugă notă' },
  'reservations.notes.empty': {
    es: 'Sin notas internas todavía.',
    en: 'No internal notes yet.',
    ro: 'Încă nu există note interne.'
  },
  'reservations.notes.systemUser': { es: 'Sistema', en: 'System', ro: 'Sistem' },

  // search (global)
  'search.placeholder': { es: 'Buscar cliente, vehículo o reserva…', en: 'Search client, vehicle or reservation…', ro: 'Caută client, vehicul sau rezervare…' },
  'search.trigger': { es: 'Buscar…', en: 'Search…', ro: 'Caută…' },
  'search.open': { es: 'Abrir búsqueda', en: 'Open search', ro: 'Deschide căutarea' },
  'search.minChars': { es: 'Escribe al menos 2 caracteres.', en: 'Type at least 2 characters.', ro: 'Scrie cel puțin 2 caractere.' },
  'search.empty': { es: 'No hay coincidencias.', en: 'No matches.', ro: 'Nicio potrivire.' },
  'search.navigate': { es: 'Navegar', en: 'Navigate', ro: 'Navighează' },
  'search.openHint': { es: 'Abrir', en: 'Open', ro: 'Deschide' },
  'search.close': { es: 'Cerrar', en: 'Close', ro: 'Închide' },
  'search.groups.clients': { es: 'Cliente', en: 'Clients', ro: 'Clienți' },
  'search.groups.vehicles': { es: 'Vehículos', en: 'Vehicles', ro: 'Vehicule' },
  'search.groups.reservations': { es: 'Reservas', en: 'Reservations', ro: 'Rezervări' },

  // calendar
  'calendar.subtitle': {
    es: 'Vista mensual de las reservas. Pulsa un día para ver el detalle.',
    en: 'Monthly view of all reservations. Tap a day to see the details.',
    ro: 'Vizualizare lunară a rezervărilor. Apasă pe o zi pentru detalii.'
  },
  'calendar.today': { es: 'Hoy', en: 'Today', ro: 'Astăzi' },
  'calendar.prev': { es: 'Mes anterior', en: 'Previous month', ro: 'Luna anterioară' },
  'calendar.next': { es: 'Mes siguiente', en: 'Next month', ro: 'Luna următoare' },
  'calendar.emptyDay': {
    es: 'No hay reservas para este día.',
    en: 'No reservations for this day.',
    ro: 'Nicio rezervare pentru această zi.'
  },
  'calendar.weekdays.mon': { es: 'Lun', en: 'Mon', ro: 'Lun' },
  'calendar.weekdays.tue': { es: 'Mar', en: 'Tue', ro: 'Mar' },
  'calendar.weekdays.wed': { es: 'Mié', en: 'Wed', ro: 'Mie' },
  'calendar.weekdays.thu': { es: 'Jue', en: 'Thu', ro: 'Joi' },
  'calendar.weekdays.fri': { es: 'Vie', en: 'Fri', ro: 'Vin' },
  'calendar.weekdays.sat': { es: 'Sáb', en: 'Sat', ro: 'Sâm' },
  'calendar.weekdays.sun': { es: 'Dom', en: 'Sun', ro: 'Dum' },

  // reports
  'reports.subtitle': {
    es: 'Ingresos, ocupación y pagos pendientes de los últimos meses.',
    en: 'Revenue, fleet utilization and outstanding balances for the last few months.',
    ro: 'Venituri, utilizare flotă și solduri restante pentru ultimele luni.'
  },
  'reports.range.1m': { es: 'Último mes', en: 'Last month', ro: 'Ultima lună' },
  'reports.range.3m': { es: 'Últimos 3 meses', en: 'Last 3 months', ro: 'Ultimele 3 luni' },
  'reports.range.6m': { es: 'Últimos 6 meses', en: 'Last 6 months', ro: 'Ultimele 6 luni' },
  'reports.range.12m': { es: 'Último año', en: 'Last year', ro: 'Ultimul an' },
  'reports.windowLabel': { es: 'en el período seleccionado', en: 'in the selected window', ro: 'în perioada selectată' },
  'reports.totalRevenue': { es: 'Ingresos cobrados', en: 'Collected revenue', ro: 'Venituri încasate' },
  'reports.utilization': { es: 'Ocupación de flota', en: 'Fleet utilization', ro: 'Utilizare flotă' },
  'reports.outstanding': { es: 'Pagos pendientes', en: 'Outstanding payments', ro: 'Plăți restante' },
  'reports.outstandingHint': {
    es: 'Reservas activas con saldo a favor del cliente.',
    en: 'Active reservations with a balance in the customer\'s favor.',
    ro: 'Rezervări active cu sold în favoarea clientului.'
  },
  'reports.outstandingTitle': { es: 'Reservas con saldo pendiente', en: 'Reservations with outstanding balance', ro: 'Rezervări cu sold restant' },
  'reports.noOutstanding': { es: 'Todo al día: no hay pagos pendientes.', en: 'All clear: no outstanding payments.', ro: 'Totul în ordine: nu există plăți restante.' },
  'reports.days': { es: 'días', en: 'days', ro: 'zile' },
  'reports.monthlyRevenue': { es: 'Ingresos por mes', en: 'Monthly revenue', ro: 'Venituri lunare' },
  'reports.topVehicles': { es: 'Vehículos con más ingresos', en: 'Top-earning vehicles', ro: 'Vehicule cu cele mai multe venituri' },
  'reports.noData': {
    es: 'Sin datos en este período.',
    en: 'No data in this period.',
    ro: 'Fără date în această perioadă.'
  },
  'reports.reservations': { es: 'reservas', en: 'reservations', ro: 'rezervări' }
};

// ---------------------------------------------------------------------------
// 1. Load existing locale files (each flat-mapped).
// 2. Load canonical schema and flatten it.
// 3. For every schema leaf: pick from existing > T dict > identity placeholder.
// 4. Emit final JSON files keyed by schema structure.
// ---------------------------------------------------------------------------

function flatten(node, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(node || {})) {
    const full = prefix ? prefix + '.' + k : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, full, out);
    else out[full] = v;
  }
  return out;
}

function unflatten(flat) {
  const root = {};
  for (const [key, val] of Object.entries(flat)) {
    const parts = key.split('.');
    let cur = root;
    for (let i = 0; i < parts.length - 1; i++) {
      cur[parts[i]] = cur[parts[i]] || {};
      cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = val;
  }
  return root;
}

// Pull the schema by extracting the object literal from build-schema.js.
const schemaCode = fs.readFileSync(path.join(ROOT, 'build-schema.js'), 'utf8');
const SCHEMA_START = schemaCode.indexOf('const SCHEMA = {');
{
  let depth = 0;
  let endIdx = -1;
  for (let i = SCHEMA_START + 'const SCHEMA = '.length; i < schemaCode.length; i++) {
    if (schemaCode[i] === '{') depth++;
    else if (schemaCode[i] === '}') {
      depth--;
      if (depth === 0) { endIdx = i; break; }
    }
  }
  var schemaLiteral = schemaCode.slice(SCHEMA_START + 'const SCHEMA = '.length, endIdx + 1);
}
const SCHEMA = (new Function('return (' + schemaLiteral + ');'))();
const schemaLeaves = flatten(SCHEMA);

const used = fs.readFileSync(path.join(ROOT, 'used-i18n-keys.txt'), 'utf8')
  .split('\n').filter(Boolean);

function migrate(locale, existing) {
  const result = {};
  const missing = [];
  for (const k of used) {
    if (!(k in schemaLeaves)) {
      // key is in used but not schema — shouldn't happen because schema is validated
      continue;
    }
    if (existing[k] != null) {
      result[k] = existing[k];
    } else if (T[k] && T[k][locale]) {
      result[k] = T[k][locale];
    } else {
      missing.push(k);
      result[k] = k; // placeholder, will be flagged below
    }
  }
  if (missing.length) {
    console.warn('[' + locale + '] still missing translations for ' + missing.length + ' keys:');
    missing.forEach(k => console.warn('  - ' + k + ' (using key as placeholder)'));
  }
  return result;
}

function stripExisting(file) {
  const p = path.join(ROOT, file);
  if (!fs.existsSync(p)) return {};
  return flatten(JSON.parse(fs.readFileSync(p, 'utf8')));
}

const existing = {
  es: stripExisting('es.json'),
  en: stripExisting('en.json'),
  ro: stripExisting('ro.json')
};

const built = {
  es: migrate('es', existing.es),
  en: migrate('en', existing.en),
  ro: migrate('ro', existing.ro)
};

for (const loc of ['es', 'en', 'ro']) {
  const out = unflatten(built[loc]);
  const final = JSON.stringify(out, null, 2) + '\n';
  fs.writeFileSync(path.join(ROOT, loc + '.json'), final);
  console.log('Wrote ' + loc + '.json  (' + Object.keys(built[loc]).length + ' leaves)');
}

// Verify every locale has the same leaf count.
const counts = Object.fromEntries(Object.entries(built).map(([k, v]) => [k, Object.keys(v).length]));
console.log('Counts:', counts);
