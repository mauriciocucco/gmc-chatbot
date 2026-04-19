export type PdfSource = 'manual_pba' | 'cnev_nacional' | 'bateria_preguntas';

export interface Section {
  header: string;
  content: string;
}

export interface NormalizedBlockMetadata {
  contentType: 'text' | 'table-row';
  tableId?: string;
  rowKey?: string;
}

export interface NormalizedPdfBlock {
  sectionHeader: string;
  content: string;
  metadata: NormalizedBlockMetadata;
  chunkStrategy: 'split' | 'single';
}

const SECTION_HEADER_PATTERNS = [
  /^(CAPITULO|CAPITULO|TITULO|TITULO|SECCION|SECCION)\s+[\dIVXLCDM]+/i,
  /^ARTICULO\s+\d+/i,
  /^Art(iculo)?\.?\s*\d+/i,
];

const MANUAL_PBA_SPEED_LIMITS_TABLE_ID = 'manual_pba_speed_limits';
const CNEV_REQUIREMENTS_TABLE_ID = 'cnev_requirements';
const CNEV_URBAN_SPEED_LIMITS_TABLE_ID = 'cnev_urban_speed_limits';

function normalizeForMatch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function buildTableRow(
  baseHeader: string,
  tableId: string,
  rowKey: string,
  sectionLabel: string,
  content: string,
): NormalizedPdfBlock {
  return {
    sectionHeader: `${baseHeader} - ${sectionLabel}`,
    content,
    metadata: {
      contentType: 'table-row',
      tableId,
      rowKey,
    },
    chunkStrategy: 'single',
  };
}

function normalizeManualPbaSpeedLimits(section: Section): NormalizedPdfBlock[] | null {
  const normalizedHeader = normalizeForMatch(section.header);
  if (!normalizedHeader.includes('limites maximos y minimos de velocidad')) {
    return null;
  }

  const normalizedContent = normalizeForMatch(section.content);
  const requiredMarkers = [
    'autopistas',
    'pasos a nivel sin barrera ni semaforo',
    'calles',
    'carreteras o caminos comunes',
    'semiautopista o autovias',
  ];

  if (!requiredMarkers.every((marker) => normalizedContent.includes(marker))) {
    return null;
  }

  const baseHeader = section.header;

  return [
    buildTableRow(
      baseHeader,
      MANUAL_PBA_SPEED_LIMITS_TABLE_ID,
      'autopista_motos_automoviles',
      'Autopistas - motos y automoviles',
      'En autopistas, la velocidad minima para motos y automoviles es 65 km/h y la maxima es 130 km/h.',
    ),
    buildTableRow(
      baseHeader,
      MANUAL_PBA_SPEED_LIMITS_TABLE_ID,
      'autopista_omnibus_autocasas',
      'Autopistas - omnibus y autocasas',
      'En autopistas, la velocidad minima para omnibus y autocasas es 65 km/h y la maxima es 100 km/h.',
    ),
    buildTableRow(
      baseHeader,
      MANUAL_PBA_SPEED_LIMITS_TABLE_ID,
      'autopista_restantes',
      'Autopistas - restantes',
      'En autopistas, para los vehiculos restantes la velocidad minima es 65 km/h y la maxima es la misma que rige para carreteras.',
    ),
    buildTableRow(
      baseHeader,
      MANUAL_PBA_SPEED_LIMITS_TABLE_ID,
      'paso_nivel_sin_barrera',
      'Pasos a nivel sin barrera ni semaforo',
      'En pasos a nivel sin barrera ni semaforo, la velocidad maxima es 20 km/h y la minima es 10 km/h.',
    ),
    buildTableRow(
      baseHeader,
      MANUAL_PBA_SPEED_LIMITS_TABLE_ID,
      'urbana_calles',
      'Urbana - calles',
      'En calles, la velocidad maxima es 40 km/h y la minima es 20 km/h.',
    ),
    buildTableRow(
      baseHeader,
      MANUAL_PBA_SPEED_LIMITS_TABLE_ID,
      'urbana_avenidas',
      'Urbana - avenidas',
      'En avenidas, la velocidad maxima es 60 km/h y la minima es 30 km/h.',
    ),
    buildTableRow(
      baseHeader,
      MANUAL_PBA_SPEED_LIMITS_TABLE_ID,
      'urbana_vias_semaforizadas',
      'Urbana - vias semaforizadas',
      'En vias semaforizadas, solo motos y autos pueden circular a velocidad de coordinacion semaforica; la minima es la mitad del maximo habilitado.',
    ),
    buildTableRow(
      baseHeader,
      MANUAL_PBA_SPEED_LIMITS_TABLE_ID,
      'urbana_intersecciones',
      'Urbana - intersecciones',
      'En intersecciones, la velocidad maxima es 30 km/h y la minima es 15 km/h.',
    ),
    buildTableRow(
      baseHeader,
      MANUAL_PBA_SPEED_LIMITS_TABLE_ID,
      'urbana_establecimientos_alta_concentracion',
      'Urbana - establecimientos de alta concentracion',
      'En establecimientos de alta concentracion de personas, como escuelas, cines y estadios, la velocidad maxima es 20 km/h y la minima es 10 km/h.',
    ),
    buildTableRow(
      baseHeader,
      MANUAL_PBA_SPEED_LIMITS_TABLE_ID,
      'urbana_rutas_que_cruzan',
      'Urbana - rutas que cruzan',
      'En rutas que cruzan zonas urbanas, la velocidad maxima es 60 km/h y la minima es 30 km/h.',
    ),
    buildTableRow(
      baseHeader,
      MANUAL_PBA_SPEED_LIMITS_TABLE_ID,
      'rural_carreteras_motos_automoviles',
      'Rural - carreteras - motos y automoviles',
      'En rutas, carreteras o caminos comunes, la velocidad maxima para motos y automoviles es 110 km/h y la minima general es 40 km/h, salvo maquinaria especial.',
    ),
    buildTableRow(
      baseHeader,
      MANUAL_PBA_SPEED_LIMITS_TABLE_ID,
      'rural_carreteras_camionetas_micros_casas',
      'Rural - carreteras - camionetas, micros-buses y casas autopropulsadas',
      'En rutas, carreteras o caminos comunes, la velocidad maxima para camionetas, micros-buses y casas autopropulsadas es 90 km/h y la minima general es 40 km/h, salvo maquinaria especial.',
    ),
    buildTableRow(
      baseHeader,
      MANUAL_PBA_SPEED_LIMITS_TABLE_ID,
      'rural_carreteras_camiones_casa_rodante',
      'Rural - carreteras - camiones y autos con casa rodante',
      'En rutas, carreteras o caminos comunes, la velocidad maxima para camiones y autos con casa rodante es 80 km/h y la minima general es 40 km/h, salvo maquinaria especial.',
    ),
    buildTableRow(
      baseHeader,
      MANUAL_PBA_SPEED_LIMITS_TABLE_ID,
      'rural_semiautopista_motos_automoviles',
      'Rural - semiautopistas - motos y automoviles',
      'En semiautopistas o autovias, la velocidad maxima para motos y automoviles es 120 km/h y la minima general es 40 km/h, salvo maquinaria especial.',
    ),
    buildTableRow(
      baseHeader,
      MANUAL_PBA_SPEED_LIMITS_TABLE_ID,
      'rural_semiautopista_camionetas',
      'Rural - semiautopistas - camionetas',
      'En semiautopistas o autovias, la velocidad maxima para camionetas es 110 km/h y la minima general es 40 km/h, salvo maquinaria especial.',
    ),
    buildTableRow(
      baseHeader,
      MANUAL_PBA_SPEED_LIMITS_TABLE_ID,
      'rural_semiautopista_restantes',
      'Rural - semiautopistas - restantes',
      'En semiautopistas o autovias, para los vehiculos restantes la velocidad maxima es la misma que en carreteras y la minima general es 40 km/h, salvo maquinaria especial.',
    ),
  ];
}

function normalizeCnevRequirements(section: Section): NormalizedPdfBlock[] | null {
  const normalizedContent = normalizeForMatch(section.content);
  const normalizedHeader = normalizeForMatch(section.header);
  const rows: NormalizedPdfBlock[] = [];

  if (
    normalizedContent.includes('requisitos para circular en la argentina') &&
    normalizedContent.includes('el conductor debe portar') &&
    normalizedContent.includes('comprobante de poliza de seguro vigente')
  ) {
    rows.push(
      buildTableRow(
        'Requisitos para circular en la Argentina',
        CNEV_REQUIREMENTS_TABLE_ID,
        'argentina_documentacion_obligatoria',
        'Argentina - documentacion obligatoria',
        'Para circular en la Argentina, el conductor debe portar la licencia habilitante para esa clase de vehiculo, la cedula o documentacion del vehiculo, comprobante de seguro vigente, la patente correctamente colocada y la Revision Tecnica Obligatoria cuando corresponda.',
      ),
    );
  }

  if (
    (normalizedHeader.includes('cenat') ||
      normalizedContent.includes('requisitos para circular en el mercosur') ||
      normalizedContent.includes('circular en el mercosur')) &&
    normalizedContent.includes('documento de identidad valido para circular en el mercosur') &&
    normalizedContent.includes('licencia para conducir') &&
    normalizedContent.includes('titulo u otro documento') &&
    normalizedContent.includes('comprobante de seguro vigente')
  ) {
    rows.push(
      buildTableRow(
        'Requisitos para circular en el Mercosur y en el exterior',
        CNEV_REQUIREMENTS_TABLE_ID,
        'mercosur_documentacion_obligatoria',
        'Mercosur - documentacion obligatoria',
        'Para circular en el Mercosur y en el exterior, el conductor debe portar documento de identidad valido, licencia para conducir, titulo u otro documento oficial que acredite la propiedad del vehiculo y comprobante de seguro vigente.',
      ),
    );
  }

  return rows.length > 0 ? rows : null;
}

function normalizeCnevUrbanSpeedLimits(section: Section): NormalizedPdfBlock[] | null {
  const normalizedHeader = normalizeForMatch(section.header);
  const normalizedContent = normalizeForMatch(section.content);

  if (
    !normalizedHeader.includes('reglas de velocidades') &&
    !normalizedContent.includes('reglas de velocidades: limites maximos y minimos de velocidad')
  ) {
    return null;
  }

  const requiredMarkers = [
    'calles',
    'avenidas',
    'vias semaforizadas',
    'intersecciones',
    'rutas en zona urbana',
    'coordinacion semaforica',
    'mitad del maximo',
  ];

  if (!requiredMarkers.every((marker) => normalizedContent.includes(marker))) {
    return null;
  }

  return [
    buildTableRow(
      'Reglas de velocidades: limites maximos y minimos de velocidad',
      CNEV_URBAN_SPEED_LIMITS_TABLE_ID,
      'urbana_calles',
      'Urbana - calles',
      'Segun la CNEV, en calles la velocidad maxima es 40 km/h y la minima es 20 km/h.',
    ),
    buildTableRow(
      'Reglas de velocidades: limites maximos y minimos de velocidad',
      CNEV_URBAN_SPEED_LIMITS_TABLE_ID,
      'urbana_avenidas',
      'Urbana - avenidas',
      'Segun la CNEV, en avenidas la velocidad maxima es 60 km/h y la minima es 30 km/h.',
    ),
    buildTableRow(
      'Reglas de velocidades: limites maximos y minimos de velocidad',
      CNEV_URBAN_SPEED_LIMITS_TABLE_ID,
      'urbana_vias_semaforizadas',
      'Urbana - vias semaforizadas',
      'Segun la CNEV, en vias semaforizadas se puede circular a velocidad de coordinacion semaforica y la minima es la mitad del maximo habilitado.',
    ),
    buildTableRow(
      'Reglas de velocidades: limites maximos y minimos de velocidad',
      CNEV_URBAN_SPEED_LIMITS_TABLE_ID,
      'urbana_intersecciones',
      'Urbana - intersecciones',
      'Segun la CNEV, en intersecciones la velocidad maxima es 30 km/h y la minima es 15 km/h.',
    ),
    buildTableRow(
      'Reglas de velocidades: limites maximos y minimos de velocidad',
      CNEV_URBAN_SPEED_LIMITS_TABLE_ID,
      'urbana_rutas',
      'Urbana - rutas en zona urbana',
      'Segun la CNEV, en rutas ubicadas en zona urbana la velocidad maxima es 60 km/h y la minima es 30 km/h.',
    ),
  ];
}

export function isLikelySectionHeader(line: string): boolean {
  const trimmed = line.trim();

  if (trimmed.length === 0 || trimmed.length > 80) return false;

  if (SECTION_HEADER_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return true;
  }

  const hasLetters = /[A-ZÁÉÍÓÚÑ]/i.test(trimmed);

  if (
    hasLetters &&
    trimmed.length >= 5 &&
    trimmed.length <= 60 &&
    trimmed === trimmed.toUpperCase() &&
    !/^\d+$/.test(trimmed)
  ) {
    return true;
  }

  return false;
}

export function splitIntoSections(text: string, fallbackHeader: string): Section[] {
  const lines = text.split('\n');
  const sections: Section[] = [];
  let currentHeader = fallbackHeader;
  const currentContent: string[] = [];

  for (const line of lines) {
    if (isLikelySectionHeader(line)) {
      const content = currentContent.join('\n').trim();

      if (content.length > 0) {
        sections.push({ header: currentHeader, content });
      }

      currentHeader = line.trim();
      currentContent.length = 0;
      continue;
    }

    currentContent.push(line);
  }

  const remaining = currentContent.join('\n').trim();
  if (remaining.length > 0) {
    sections.push({ header: currentHeader, content: remaining });
  }

  if (sections.length <= 1) {
    return [{ header: fallbackHeader, content: text }];
  }

  return sections;
}

export function normalizePdfContent(
  source: PdfSource,
  cleanedText: string,
  fallbackHeader: string,
): NormalizedPdfBlock[] {
  const sections = splitIntoSections(cleanedText, fallbackHeader);
  const blocks: NormalizedPdfBlock[] = [];

  for (const section of sections) {
    if (source === 'manual_pba') {
      const normalizedTable = normalizeManualPbaSpeedLimits(section);
      if (normalizedTable) {
        blocks.push(...normalizedTable);
        continue;
      }
    }

    if (source === 'cnev_nacional') {
      const normalizedRequirements = normalizeCnevRequirements(section);
      if (normalizedRequirements) {
        blocks.push(...normalizedRequirements);
        continue;
      }

      const normalizedUrbanSpeedLimits = normalizeCnevUrbanSpeedLimits(section);
      if (normalizedUrbanSpeedLimits) {
        blocks.push(...normalizedUrbanSpeedLimits);
        continue;
      }
    }

    blocks.push({
      sectionHeader: section.header,
      content: section.content,
      metadata: { contentType: 'text' },
      chunkStrategy: 'split',
    });
  }

  return blocks;
}

export function isValidChunk(
  text: string,
  metadata: Partial<NormalizedBlockMetadata> = {},
): boolean {
  const minLength = metadata.contentType === 'table-row' ? 40 : 80;
  if (text.length < minLength) return false;

  const minWordCount = metadata.contentType === 'table-row' ? 6 : 8;
  const wordCount = text.split(/\s+/).length;
  if (wordCount < minWordCount) return false;

  if (/^(capitulo|seccion|articulo|titulo|indice|anexo)\s*\d*\s*$/i.test(text.trim())) {
    return false;
  }

  const digitRatio = (text.match(/\d/g)?.length ?? 0) / text.length;
  if (digitRatio > 0.4) {
    const looksLikeNormativeTableRow =
      metadata.contentType === 'table-row' ||
      /\b(km\/h|maxima|minima|velocidad|autopista|autovia|carretera|avenida|calle|interseccion|semaforica|ruta)\b/i.test(
        text,
      );

    if (!looksLikeNormativeTableRow) {
      return false;
    }
  }

  return true;
}

export function describeNormalizedBlock(block: NormalizedPdfBlock): string {
  if (block.metadata.contentType !== 'table-row' || !block.metadata.rowKey) {
    return block.sectionHeader;
  }

  return `${block.sectionHeader} (${titleCase(block.metadata.rowKey.replace(/_/g, ' '))})`;
}
