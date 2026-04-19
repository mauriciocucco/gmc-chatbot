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

const SPEED_LIMITS_TABLE_ID = 'manual_pba_speed_limits';

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
  rowKey: string,
  sectionLabel: string,
  content: string,
): NormalizedPdfBlock {
  return {
    sectionHeader: `${baseHeader} - ${sectionLabel}`,
    content,
    metadata: {
      contentType: 'table-row',
      tableId: SPEED_LIMITS_TABLE_ID,
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
      'autopista_motos_automoviles',
      'Autopistas - motos y automoviles',
      'En autopistas, la velocidad minima para motos y automoviles es 65 km/h y la maxima es 130 km/h.',
    ),
    buildTableRow(
      baseHeader,
      'autopista_omnibus_autocasas',
      'Autopistas - omnibus y autocasas',
      'En autopistas, la velocidad minima para omnibus y autocasas es 65 km/h y la maxima es 100 km/h.',
    ),
    buildTableRow(
      baseHeader,
      'autopista_restantes',
      'Autopistas - restantes',
      'En autopistas, para los vehiculos restantes la velocidad minima es 65 km/h y la maxima es la misma que rige para carreteras.',
    ),
    buildTableRow(
      baseHeader,
      'paso_nivel_sin_barrera',
      'Pasos a nivel sin barrera ni semaforo',
      'En pasos a nivel sin barrera ni semaforo, la velocidad maxima es 20 km/h y la minima es 10 km/h.',
    ),
    buildTableRow(
      baseHeader,
      'urbana_calles',
      'Urbana - calles',
      'En calles, la velocidad maxima es 40 km/h y la minima es 20 km/h.',
    ),
    buildTableRow(
      baseHeader,
      'urbana_avenidas',
      'Urbana - avenidas',
      'En avenidas, la velocidad maxima es 60 km/h y la minima es 30 km/h.',
    ),
    buildTableRow(
      baseHeader,
      'urbana_vias_semaforizadas',
      'Urbana - vias semaforizadas',
      'En vias semaforizadas, solo motos y autos pueden circular a velocidad de coordinacion semaforica; la minima es la mitad del maximo habilitado.',
    ),
    buildTableRow(
      baseHeader,
      'urbana_intersecciones',
      'Urbana - intersecciones',
      'En intersecciones, la velocidad maxima es 30 km/h y la minima es 15 km/h.',
    ),
    buildTableRow(
      baseHeader,
      'urbana_establecimientos_alta_concentracion',
      'Urbana - establecimientos de alta concentracion',
      'En establecimientos de alta concentracion de personas, como escuelas, cines y estadios, la velocidad maxima es 20 km/h y la minima es 10 km/h.',
    ),
    buildTableRow(
      baseHeader,
      'urbana_rutas_que_cruzan',
      'Urbana - rutas que cruzan',
      'En rutas que cruzan zonas urbanas, la velocidad maxima es 60 km/h y la minima es 30 km/h.',
    ),
    buildTableRow(
      baseHeader,
      'rural_carreteras_motos_automoviles',
      'Rural - carreteras - motos y automoviles',
      'En carreteras o caminos comunes, la velocidad maxima para motos y automoviles es 110 km/h y la minima general es 40 km/h, salvo maquinaria especial.',
    ),
    buildTableRow(
      baseHeader,
      'rural_carreteras_camionetas_micros_casas',
      'Rural - carreteras - camionetas, micros-buses y casas autopropulsadas',
      'En carreteras o caminos comunes, la velocidad maxima para camionetas, micros-buses y casas autopropulsadas es 90 km/h y la minima general es 40 km/h, salvo maquinaria especial.',
    ),
    buildTableRow(
      baseHeader,
      'rural_carreteras_camiones_casa_rodante',
      'Rural - carreteras - camiones y autos con casa rodante',
      'En carreteras o caminos comunes, la velocidad maxima para camiones y autos con casa rodante es 80 km/h y la minima general es 40 km/h, salvo maquinaria especial.',
    ),
    buildTableRow(
      baseHeader,
      'rural_semiautopista_motos_automoviles',
      'Rural - semiautopistas - motos y automoviles',
      'En semiautopistas o autovias, la velocidad maxima para motos y automoviles es 120 km/h y la minima general es 40 km/h, salvo maquinaria especial.',
    ),
    buildTableRow(
      baseHeader,
      'rural_semiautopista_camionetas',
      'Rural - semiautopistas - camionetas',
      'En semiautopistas o autovias, la velocidad maxima para camionetas es 110 km/h y la minima general es 40 km/h, salvo maquinaria especial.',
    ),
    buildTableRow(
      baseHeader,
      'rural_semiautopista_restantes',
      'Rural - semiautopistas - restantes',
      'En semiautopistas o autovias, para los vehiculos restantes la velocidad maxima es la misma que en carreteras y la minima general es 40 km/h, salvo maquinaria especial.',
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
