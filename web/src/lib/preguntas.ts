/**
 * Las preguntas frecuentes, en un solo sitio.
 *
 * ⚠️ **Cada respuesta sale de una cláusula real de
 * `functions/src/contracts/clauses.ts`** o de una regla del backoffice, como la
 * página de condiciones: la edad mínima de 21 años, la fianza que se devuelve
 * tras la inspección de devolución, la autorización escrita para salir de
 * España, la factura que se emite **a petición** y la entrega a domicilio que
 * se pacta antes con su importe propio. Si algo de esto deja de ser cierto, se
 * cambia aquí el mismo día.
 *
 * ⚠️ **Vive aquí y no dentro de una página porque lo leen DOS**: la portada
 * enseña un subconjunto y `/preguntas-frecuentes` las enseña todas. Con los
 * datos copiados en dos sitios, la primera vez que alguien corrigiera una
 * respuesta quedaría corregida en una sola — y la otra seguiría publicada
 * diciendo lo anterior, sin que nada avisara.
 */

export interface Pregunta {
  q: string;
  /** Admite HTML: va por `set:html`, así que **nada que venga de fuera**. */
  a: string;
  /**
   * Si sale también en la portada.
   *
   * ⚠️ **La portada NO las lleva todas, y no es por espacio.** Una página que
   * repite entera a otra le ofrece a Google dos veces el mismo contenido, y dos
   * copias **reparten** posicionamiento en vez de sumarlo — es el mismo motivo
   * por el que existe el `<link rel="canonical">`. En la portada van las que
   * decide un visitante que está a punto de reservar; el resto vive en su
   * página, que es la que puede posicionar por cada pregunta.
   */
  enPortada?: boolean;
}

export const PREGUNTAS: Pregunta[] = [
  {
    q: '¿El precio que veo es el final?',
    a: 'Sí. Lo que aparece en la web lleva el <strong>IVA incluido</strong> y es lo que se cierra en el contrato. La fianza va aparte y se devuelve; si pactamos entrega a domicilio, ese importe se acuerda antes y aparece en su propia línea.',
    enPortada: true,
  },
  {
    q: '¿Qué edad hay que tener y qué papeles hacen falta?',
    a: 'Desde <strong>21 años</strong>, con permiso de conducir en vigor y DNI o pasaporte. Si vais a turnaros al volante, cada conductor tiene que ir nombrado en el contrato: no cuesta nada, pero tiene que constar.',
    enPortada: true,
  },
  {
    q: '¿Cuánto es la fianza y cuándo me la devolvéis?',
    a: 'Es un <strong>depósito en garantía</strong>, no parte del precio. Se devuelve tras la inspección de devolución, salvo que haya que retener algo por daños, combustible o kilómetros de más. A clientes conocidos podemos no pedirla.',
    enPortada: true,
  },
  {
    q: '¿Me lo podéis llevar a casa?',
    a: 'Sí. En Arganda del Rey y los pueblos de al lado no cobramos el desplazamiento; más lejos se acuerda un suplemento antes de reservar. La ida y la vuelta se deciden por separado: hay quien recoge aquí y solo pide que vayamos a buscarlo.',
    enPortada: true,
  },
  {
    q: '¿Puedo salir de España con el coche?',
    a: 'Hace falta <strong>autorización nuestra por escrito</strong>, pedida antes del viaje. Dentro de España no hay restricción.',
  },
  {
    q: '¿Hacéis factura?',
    a: 'Sí, <strong>a petición</strong>. Dilo al reservar y la emitimos a nombre de quien nos indiques.',
  },
  {
    q: '¿Qué hago si el coche se avería?',
    a: 'Llama al teléfono de asistencia que viene impreso en tu contrato <strong>antes de tomar decisiones</strong>: una reparación por tu cuenta puede no estar cubierta.',
  },
  {
    q: '¿Cuántos kilómetros puedo hacer?',
    a: 'Los que se pacten al reservar. El kilometraje incluido y el precio del kilómetro de más van <strong>escritos en el contrato</strong>: si no se pactó nada, no se cobra nada por ese concepto.',
  },
  {
    q: '¿Cómo se devuelve el combustible?',
    a: 'Con el <strong>mismo nivel</strong> con el que salió. Se anota y se fotografía en el parte de entrega y otra vez en el de devolución, así que no hay discusión sobre con cuánto se lo llevó.',
  },
  {
    q: '¿Puedo pagar con tarjeta?',
    a: 'Sí. Se puede pagar en efectivo, por transferencia o con tarjeta desde un enlace que te mandamos al móvil.',
  },
  {
    q: '¿Qué pasa si devuelvo el coche tarde?',
    a: 'Hay <strong>treinta minutos de cortesía</strong>. A partir de ahí, cada 24 horas empezadas cuentan como un día más de alquiler. Si ves que vas a llegar tarde, avisa: casi siempre se puede prorrogar.',
  },
  {
    q: '¿Puedo alquilar si acabo de sacarme el carné?',
    a: 'El permiso tiene que estar <strong>en vigor</strong>, y la edad mínima son 21 años. Si tienes dudas con tu caso, pregúntanos antes de reservar y te lo decimos.',
  },
];

/** Las que se enseñan en la portada. */
export const PREGUNTAS_PORTADA = PREGUNTAS.filter((p) => p.enPortada);
