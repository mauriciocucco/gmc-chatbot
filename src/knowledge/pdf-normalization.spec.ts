import { isValidChunk, normalizePdfContent } from './pdf-normalization';

const SPEED_LIMITS_FIXTURE = `LÍMITES MÁXIMOS Y MÍNIMOS DE VELOCIDAD
autopistas
Pasos a nivel sin
barrera ni semáforo
130 km/h
100 km/h
Id carreteras
20 km/h
motos
automóviles
ómnibus y
autocasas
restantes
todos
65 km/h
10 km/h
Calles
Avenidas
Vías Semaforizadas
Intersecciones
Establecimientos de alta
concentración de personas
escuelas-cines-estadios
Rutas que cruzan
Carreteras
o caminos comunes
semiautopista o autovías
motos
automóviles
camionetas
miscros-buses
casas autopro-
pulsadas
camiones
autos con casa
rodante
motos
automóviles
camionetas
restantes
110 km/h
90 km/h
80 km/h
120 km/h
110 km/h
Id carreteras
todos
sólo motos
y autos
todos
40 km/h
60 km/h
coordinación
semafórica
30 km/h
20 km/h
60 km/h
20 km/h
30 km/h
mitad del
máximo
15 km/h
10 km/h
30 km/h
40 km/h
salvo
maquinaria
especial
URBANA
RURAL
AMBAS
USO DE LAS LUCES
Texto siguiente.`;

const CNEV_REQUIREMENTS_FIXTURE = `CENAT
Requisitos para circular en la Argentina
El conductor debe portar:
La licencia que lo habilita para conducir
esa clase de vehiculo.
C ehiculo.
Comprobante de poliza de seguro vigente.
Placa patente correctamente colocada.
C evision Tecnica
Obligatoria.
ABC 123
LICENCIA SEGURO
CÉDULA
RTO

conductor con la siguiente documentacion:
a. Documento de Identidad valido para
circular en el MERCOSUR.
b. Licencia para conducir.
c. Titulo u otro documento oficial que
acredite la propiedad del vehiculo.
d. Comprobante de seguro vigente.`;

const CNEV_URBAN_SPEED_FIXTURE = `Reglas de velocidades: limites
maximos y minimos de velocidad
(zona urbana, zona rural)
Calles
Avenidas
Vias semaforizadas
Intersecciones
Rutas en zona urbana
Autopistas
Paso a nivel sin barrera
Ruta
Semiautopistas
Todos
Todos
Todos
Todos
Todos
Motos y autos
Camionetas
Micros, buses y casas autopropulsadas
Motos y autos
Omnibus y casas autopropulsadas
Camionetas
Camiones y autos con casa rodante
Todos
Motos y autos
Camionetas, micros, buses y casas
autopropulsadas
Camiones y autos con casa rodante
110 km/h
90 km/h
80 km/h
40 km/h
40 km/h
Salvo maquinaria especial
40 km/h Salvo maq. especial
40 km/h Salvo maq. especial
40 km/h Salvo maq. especial
40 km/h Salvo maq. especial
65 km/h
65 km/h
65 km/h
65 km/h
20 km/h
40 km/h
60 km/h
Coordinacion semaforica
30 km/h
60 km/h
120 km/h
110 km/h
90 km/h
130 km/h
100 km/h
110 km/h
80 km/h
20 km/h
20 km/h
30 km/h
Mitad del maximo
15 km/h
30 km/h`;

describe('pdf normalization', () => {
  it('expande la tabla de velocidades de manual_pba en filas atomicas', () => {
    const blocks = normalizePdfContent(
      'manual_pba',
      SPEED_LIMITS_FIXTURE,
      'Manual Oficial Provincia BSAS',
    );

    const tableRows = blocks.filter(
      (block) => block.metadata.contentType === 'table-row',
    );

    expect(tableRows).toHaveLength(16);
    expect(
      tableRows.find(
        (block) => block.metadata.rowKey === 'autopista_motos_automoviles',
      )?.content,
    ).toBe(
      'En autopistas, la velocidad minima para motos y automoviles es 65 km/h y la maxima es 130 km/h.',
    );
    expect(
      tableRows.find(
        (block) => block.metadata.rowKey === 'rural_semiautopista_camionetas',
      )?.content,
    ).toContain('110 km/h');
    expect(
      tableRows.find(
        (block) => block.metadata.rowKey === 'rural_carreteras_motos_automoviles',
      )?.content,
    ).toContain('En rutas, carreteras o caminos comunes');
    expect(
      tableRows.find(
        (block) => block.metadata.rowKey === 'urbana_vias_semaforizadas',
      )?.content,
    ).toContain('coordinacion semaforica');
  });

  it('acepta filas tabulares normalizadas aunque tengan muchos numeros', () => {
    const blocks = normalizePdfContent(
      'manual_pba',
      SPEED_LIMITS_FIXTURE,
      'Manual Oficial Provincia BSAS',
    );
    const targetRow = blocks.find(
      (block) => block.metadata.rowKey === 'autopista_motos_automoviles',
    );

    expect(targetRow).toBeDefined();
    expect(isValidChunk(targetRow!.content, targetRow!.metadata)).toBe(true);
  });

  it('normaliza los requisitos para circular del cnev', () => {
    const blocks = normalizePdfContent(
      'cnev_nacional',
      CNEV_REQUIREMENTS_FIXTURE,
      'Ley Nacional de Transito (CNEV)',
    );

    const argentinaRequirements = blocks.find(
      (block) =>
        block.metadata.rowKey === 'argentina_documentacion_obligatoria',
    );
    const mercosurRequirements = blocks.find(
      (block) =>
        block.metadata.rowKey === 'mercosur_documentacion_obligatoria',
    );

    expect(argentinaRequirements?.content).toContain('licencia habilitante');
    expect(argentinaRequirements?.content).toContain(
      'Revision Tecnica Obligatoria',
    );
    expect(mercosurRequirements?.content).toContain(
      'documento de identidad valido',
    );
    expect(mercosurRequirements?.content).toContain(
      'comprobante de seguro vigente',
    );
  });

  it('normaliza las velocidades urbanas del cnev', () => {
    const blocks = normalizePdfContent(
      'cnev_nacional',
      CNEV_URBAN_SPEED_FIXTURE,
      'Ley Nacional de Transito (CNEV)',
    );

    const rows = blocks.filter(
      (block) => block.metadata.tableId === 'cnev_urban_speed_limits',
    );

    expect(rows).toHaveLength(5);
    expect(
      rows.find((block) => block.metadata.rowKey === 'urbana_calles')?.content,
    ).toContain('40 km/h');
    expect(
      rows.find(
        (block) => block.metadata.rowKey === 'urbana_vias_semaforizadas',
      )?.content,
    ).toContain('coordinacion semaforica');
    expect(
      rows.find((block) => block.metadata.rowKey === 'urbana_rutas')?.content,
    ).toContain('60 km/h');
  });
});
