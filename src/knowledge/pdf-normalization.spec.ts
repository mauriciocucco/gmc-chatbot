import {
  isValidChunk,
  normalizePdfContent,
} from './pdf-normalization';

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
});
