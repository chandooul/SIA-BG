import React, { useState, useMemo } from 'react';
import { 
  Table as TableIcon, 
  FileText, 
  Download, 
  Copy, 
  Check, 
  Search, 
  Printer, 
  ChevronDown, 
  ChevronUp, 
  ExternalLink, 
  Filter, 
  FileSpreadsheet,
  Award,
  Calendar,
  DollarSign,
  Briefcase,
  Layers,
  Sparkles,
  ShieldCheck
} from 'lucide-react';

export interface Officer {
  id: string;
  name: string;
  registration: string;
  unit: string;
  rank?: string;
  role?: 'admin' | 'user';
  email?: string;
  phone?: string;
  keywords?: string[];
}

export interface IdentificationResult {
  type: 'officer' | 'unit' | 'term';
  match: string;
  context: string;
  page: number;
  metadata?: any;
}

export interface PageText {
  page: number;
  text: string;
}

export interface TableColumnDef {
  key: string;
  label: string;
  width?: string;
  align?: 'left' | 'center' | 'right';
  isNumeric?: boolean;
}

export interface SubjectOfficerEntry {
  officer: Officer;
  values: Record<string, string>; // Dynamic column values map (ord, rank, quadro, pmNumber, name, registration, ome, promoDate, points, parecer, obs, etc.)
  ord: string;
  rank: string;
  quadro?: string;
  pmNumber: string;
  name: string;
  registration: string;
  ome: string;
  promoDate?: string;
  points: string;
  parecer?: string;
  obs?: string;
  page: number;
  rawContext: string;
  publicationSnippet?: string;
}

export interface SubjectGroup {
  id: string;
  subjectKey: string;
  title: string;
  category: 'promocao' | 'diarias' | 'escala' | 'ferias' | 'elogio' | 'licenca' | 'transferencia' | 'portaria' | 'geral';
  pages: number[];
  docType: string;
  docNumber: string;
  docDate?: string;
  isTable: boolean;
  columns: TableColumnDef[]; // Dynamic columns detected for this specific document table
  officers: SubjectOfficerEntry[];
}

interface SubjectGroupedTablesProps {
  docType: string;
  docNumber: string;
  docDate?: string;
  pdfUrl?: string | null;
  results: IdentificationResult[];
  pagesText: PageText[];
  officersList: Officer[];
  onOpenPdfPage?: (page: number) => void;
}

// Normalize text for comparison (remove accents, lowercase, trim)
function normalizeText(text: string): string {
  return (text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

// Extract text windows around the officer in rawPageText / context
function getOfficerRowWindows(rawPageText: string, context: string, officer: Officer): { preWindow: string; postWindow: string; fullRowWindow: string } {
  const sources = [rawPageText, context].filter(Boolean);
  const cleanReg = (officer.registration || '').replace(/\D/g, '');
  const fullNameNorm = normalizeText(officer.name);
  const nameParts = (officer.name || '').split(' ').filter(w => w.length >= 2);

  for (const text of sources) {
    if (!text) continue;
    let matchStart = -1;
    let matchEnd = -1;

    // 1. Search full normalized name
    if (fullNameNorm) {
      const normText = normalizeText(text);
      const idx = normText.indexOf(fullNameNorm);
      if (idx !== -1) {
        matchStart = idx;
        matchEnd = idx + officer.name.length;
      }
    }

    // 2. Search first 2 name parts (e.g. "ANTHONNY BRUNO")
    if (matchStart === -1 && nameParts.length >= 2) {
      const twoPartsNorm = normalizeText(`${nameParts[0]} ${nameParts[1]}`);
      const normText = normalizeText(text);
      const idx = normText.indexOf(twoPartsNorm);
      if (idx !== -1) {
        matchStart = idx;
        matchEnd = idx + twoPartsNorm.length;
      }
    }

    // 3. Search first name (e.g. "ANTHONNY")
    if (matchStart === -1 && nameParts.length >= 1 && nameParts[0].length >= 3) {
      const firstNorm = normalizeText(nameParts[0]);
      const normText = normalizeText(text);
      const idx = normText.indexOf(firstNorm);
      if (idx !== -1) {
        matchStart = idx;
        matchEnd = idx + firstNorm.length;
      }
    }

    // 4. Search registration if name search failed
    if (matchStart === -1 && cleanReg && cleanReg.length >= 5) {
      const idx = text.indexOf(cleanReg.slice(0, 6));
      if (idx !== -1) {
        matchStart = idx;
        matchEnd = idx + cleanReg.length;
      }
    }

    if (matchStart !== -1) {
      const start = Math.max(0, matchStart - 250);
      const end = Math.min(text.length, matchEnd + 550);
      return {
        preWindow: text.substring(start, matchStart),
        postWindow: text.substring(matchEnd, end),
        fullRowWindow: text.substring(start, end)
      };
    }
  }

  return { preWindow: '', postWindow: '', fullRowWindow: `${context} ${rawPageText}` };
}

// Extract standard ranks from text or officer metadata
function extractRank(officer: Officer, context: string, rawPageText: string): string {
  const { preWindow, postWindow, fullRowWindow } = getOfficerRowWindows(rawPageText, context, officer);

  // Ordered rank patterns from most specific to generic
  const rankPatterns: { regex: RegExp; label: string }[] = [
    { regex: /\b2[º°ªo\.]?\s*(?:sgt|sargento)(?:\s*pm)?\b|\b2\s*sgt\b|\bsegundo\s+sargento(?:\s*pm)?\b/i, label: '2º SGT PM' },
    { regex: /\b1[º°ªo\.]?\s*(?:sgt|sargento)(?:\s*pm)?\b|\b1\s*sgt\b|\bprimeiro\s+sargento(?:\s*pm)?\b/i, label: '1º SGT PM' },
    { regex: /\b3[º°ªo\.]?\s*(?:sgt|sargento)(?:\s*pm)?\b|\b3\s*sgt\b|\bterceiro\s+sargento(?:\s*pm)?\b/i, label: '3º SGT PM' },
    { regex: /\b(?:st|subten(?:ente)?)(?:\s*pm)?\b|\bsub\s*ten(?:ente)?\b/i, label: 'ST PM' },
    { regex: /\b(?:cb|cabo)(?:\s*pm)?\b/i, label: 'CB PM' },
    { regex: /\b(?:sd|soldado)(?:\s*pm)?\b/i, label: 'SD PM' },
    { regex: /\b1[º°ªo\.]?\s*(?:ten|tenente)(?:\s*pm)?\b|\bprimeiro\s+tenente(?:\s*pm)?\b/i, label: '1º TEN PM' },
    { regex: /\b2[º°ªo\.]?\s*(?:ten|tenente)(?:\s*pm)?\b|\bsegundo\s+tenente(?:\s*pm)?\b/i, label: '2º TEN PM' },
    { regex: /\b(?:cap|capit[aã]o)(?:\s*pm)?\b/i, label: 'CAP PM' },
    { regex: /\b(?:maj|major)(?:\s*pm)?\b/i, label: 'MAJ PM' },
    { regex: /\b(?:tc|ten\s*cel|tenente\s*coronel)(?:\s*pm)?\b/i, label: 'TEN CEL PM' },
    { regex: /\b(?:cel|coronel)(?:\s*pm)?\b/i, label: 'CEL PM' },
    { regex: /\b(?:asp|aspirante)(?:\s*pm)?\b/i, label: 'ASP PM' },
    { regex: /\bal(?:uno)?\s*sd(?:\s*pm)?\b|\baluno\s*soldado\b/i, label: 'AL SD PM' },
    { regex: /\b(?:sgt|sargento)(?:\s*pm)?\b/i, label: 'SGT PM' }
  ];

  // 1. First check preWindow strictly preceding the officer name
  if (preWindow) {
    for (const { regex, label } of rankPatterns) {
      if (regex.test(preWindow)) {
        return label;
      }
    }
  }

  // 2. Check postWindow immediately following the officer name (typical in Aditamento: "Sergio da Silva Gonçalves ST PM 164.321-5...")
  if (postWindow) {
    const postSnippet = postWindow.substring(0, 45);
    for (const { regex, label } of rankPatterns) {
      if (regex.test(postSnippet)) {
        return label;
      }
    }
  }

  // 3. Check fullRowWindow / context
  if (fullRowWindow) {
    for (const { regex, label } of rankPatterns) {
      if (regex.test(fullRowWindow)) {
        return label;
      }
    }
  }

  // 3. If officer record has a registered rank in metadata, format it
  if (officer?.rank && officer.rank.trim()) {
    const r = officer.rank.trim().toUpperCase();
    for (const { regex, label } of rankPatterns) {
      if (regex.test(r)) {
        return label;
      }
    }
    return officer.rank.trim();
  }

  // 4. Fallback to searching the entire raw page text
  for (const { regex, label } of rankPatterns) {
    if (regex.test(rawPageText)) {
      return label;
    }
  }

  return '2º SGT PM';
}

// Extract PM number (e.g. 2009.0050, 2004.0353, 1634.810, 2001.0453) from context / pageText
function extractPmNumber(context: string, rawPageText: string, officer: Officer): string {
  const { preWindow, postWindow, fullRowWindow } = getOfficerRowWindows(rawPageText, context, officer);

  const pmNumberRegex = /\b((?:19|20)\d{2}[\.\/]\d{3,4}|\d{3,4}[\.\/]\d{3,4})\b/g;

  // 1. Look in preWindow immediately before officer name (pick the LAST/closest match to the name)
  if (preWindow) {
    const matches = Array.from(preWindow.matchAll(pmNumberRegex));
    if (matches.length > 0) {
      const lastMatch = matches[matches.length - 1];
      return lastMatch[1];
    }
  }

  // 2. Look in postWindow right after officer name
  if (postWindow) {
    const matches = Array.from(postWindow.matchAll(pmNumberRegex));
    if (matches.length > 0) {
      return matches[0][1];
    }
  }

  // 3. Look in context
  const contextMatch = context.match(/\b((?:19|20)\d{2}[\.\/]\d{3,4}|\d{3,4}[\.\/]\d{3,4})\b/);
  if (contextMatch) {
    return contextMatch[1];
  }

  // 4. If officer registration has 7 digits, format like 1634.810
  const reg = (officer.registration || '').replace(/\D/g, '');
  if (reg.length === 7) {
    return `${reg.slice(0, 4)}.${reg.slice(4, 7)}`;
  }
  if (reg.length >= 6) {
    return `${reg.slice(0, 4)}.${reg.slice(4, 8)}`;
  }

  return '-';
}

// Extract ORD (Order number / Classificação in original document table, e.g. 174, 99, 732, 450, 441, 15, 1, 2)
function extractOrd(context: string, rawPageText: string, officer: Officer): string {
  if (!officer) return '-';

  const { preWindow } = getOfficerRowWindows(rawPageText, context, officer);

  // Helper to test if an extracted number is a valid integer ORD (not a PM number year, not points, not a 7-digit matricula)
  const isValidOrd = (val: string): boolean => {
    if (!val || val === '-') return false;
    const num = parseInt(val, 10);
    if (isNaN(num) || num <= 0 || num > 9999) return false;
    // Disallow 4-digit years like 1970-2035 (PM number year prefix or promo year)
    if (num >= 1970 && num <= 2035) return false;
    return true;
  };

  // Comprehensive rank regex pattern that captures the FULL rank term
  const rankRegexStr = `(?:(?:[123][º°ªo\.]?\\s*)?(?:CEL|CORONEL|TC|TEN\\s*CEL|TENENTE\\s*CORONEL|MAJ|MAJOR|CAP|CAPIT[ÃA]O|1[º°ªo\.]?\\s*TEN|2[º°ªo\.]?\\s*TEN|TEN|TENENTE|SUB\\s*TEN|SUBTEN|SUBTENENTE|1[º°ªo\.]?\\s*SGT|2[º°ªo\.]?\\s*SGT|3[º°ªo\.]?\\s*SGT|SGT|SARGENTO|CB|CABO|SD|SOLDADO|AL\\s*SD|ASP|ASPIRANTE)(?:\\s*PM)?\\b)`;
  const quadroRegexStr = `(?:QPPM|QOPM|QOAPM|QEPPM|QPMG|QOS|QCO|QOC|QPE)`;
  const pmNumRegexStr = `(?:(?:19|20)\\d{2}[\\.\\/]\\d{3,4}|\\d{3,4}[\\.\\/]\\d{3,4})`;

  if (preWindow) {
    // Case A: Exact promotion row format: [ORD] [RANK] [QUADRO]? [PM_NUM]?
    // e.g. "174 2º SARGENTO PM QPPM 2009.0050 " or "174 2º SGT PM QPPM 2009.0050 "
    const promoOrdMatch = preWindow.match(new RegExp(`(?:^|[\\s\\|;\\n\\r])(\\d{1,4})\\s+${rankRegexStr}(?:\\s+${quadroRegexStr})?(?:\\s+${pmNumRegexStr})?\\s*$`, 'i'));
    if (promoOrdMatch && isValidOrd(promoOrdMatch[1])) {
      return promoOrdMatch[1];
    }

    // Case B: Standard table row format: [ORD] [RANK] [PM_NUM]?
    // e.g. "99 2º SGT 2004.0159 " or "27 SGT PM 2004.0589 "
    const stdOrdMatch = preWindow.match(new RegExp(`(?:^|[\\s\\|;\\n\\r])(\\d{1,4})\\s+${rankRegexStr}(?:\\s+${pmNumRegexStr})?\\s*$`, 'i'));
    if (stdOrdMatch && isValidOrd(stdOrdMatch[1])) {
      return stdOrdMatch[1];
    }

    // Case C: Format where Quadro appears before rank: [ORD] [QUADRO] [PM_NUM]?
    const quadroOrdMatch = preWindow.match(new RegExp(`(?:^|[\\s\\|;\\n\\r])(\\d{1,4})\\s+${quadroRegexStr}(?:\\s+${pmNumRegexStr})?\\s*$`, 'i'));
    if (quadroOrdMatch && isValidOrd(quadroOrdMatch[1])) {
      return quadroOrdMatch[1];
    }

    // Case D: Format where only PM number precedes name: [ORD] [PM_NUM]
    const pmOnlyOrdMatch = preWindow.match(new RegExp(`(?:^|[\\s\\|;\\n\\r])(\\d{1,4})\\s+${pmNumRegexStr}\\s*$`, 'i'));
    if (pmOnlyOrdMatch && isValidOrd(pmOnlyOrdMatch[1])) {
      return pmOnlyOrdMatch[1];
    }

    // Case E: Check if preWindow starts with or contains any valid isolated ORD number before the officer
    const numberMatches = Array.from(preWindow.matchAll(/(?:^|[\\s\\|;\\n\\r])(\d{1,4})(?=[\\s\\|;\\n\\r]|$)/g));
    if (numberMatches.length > 0) {
      // Test candidates starting from the closest one to the rank/name
      for (let i = numberMatches.length - 1; i >= 0; i--) {
        const candidate = numberMatches[i][1];
        if (isValidOrd(candidate)) {
          const afterIdx = (numberMatches[i].index || 0) + numberMatches[i][0].length;
          const trailing = preWindow.substring(afterIdx, afterIdx + 12);
          // Ensure it's not followed by a date slash (e.g. 25/12/2019) or ordinal symbol (e.g. 5º BPM)
          if (!/^[\/\.º°ªo]/i.test(trailing.trim())) {
            return candidate;
          }
        }
      }
    }

    // Case F: Check if preWindow directly starts with RANK and NO number exists before it
    const startsDirectlyWithRank = new RegExp(`^\\s*${rankRegexStr}`, 'i').test(preWindow.trim());
    if (startsDirectlyWithRank) {
      return '-';
    }
  }

  // 2. Fallback: Search context string
  const cleanContext = (context || '').replace(/^\.{2,3}|\.{2,3}$/g, '').trim();
  const contextOrdMatch = cleanContext.match(new RegExp(`(?:^|[\\s\\|;\\n\\r])(\\d{1,4})\\s+${rankRegexStr}`, 'i'));
  if (contextOrdMatch && isValidOrd(contextOrdMatch[1])) {
    return contextOrdMatch[1];
  }

  return '-';
}

// Extract formatted registration (preserving hyphen/dots from text if present, e.g. 202.511-6, 112.283-5 or 164.190-5)
function extractRegistrationFormatted(context: string, rawPageText: string, officer: Officer): string {
  if (!officer) return 'S/M';
  const cleanReg = (officer.registration || '').replace(/\D/g, '');
  const { postWindow, fullRowWindow } = getOfficerRowWindows(rawPageText, context, officer);

  const searchSources = [postWindow, fullRowWindow, rawPageText, context].filter(Boolean);

  for (const text of searchSources) {
    if (!text) continue;
    // Look for formatted matricula like 202.511-6, 112.283-5 or 112283-5
    if (cleanReg.length >= 5) {
      const regPattern = new RegExp(`\\b(${cleanReg.slice(0, 3)}[\\.\\s]?${cleanReg.slice(3, 6)}(?:[-–—]\\d)?)\\b`);
      const match = text.match(regPattern);
      if (match) {
        return match[1].replace(/\s+/g, '');
      }
    }
  }

  return officer.registration || 'S/M';
}

// Extract Quadro (e.g. QPPM, QOPM, QOAPM, QEPPM, QPMG, QOS)
function extractQuadro(context: string, rawPageText: string, officer: Officer): string {
  const { preWindow, postWindow, fullRowWindow } = getOfficerRowWindows(rawPageText, context, officer);
  const quadroRegex = /\b(QPPM|QOPM|QOAPM|QEPPM|QPMG|QOS|QCO|QOC|QPE)\b/i;

  if (preWindow) {
    const m = preWindow.match(quadroRegex);
    if (m) return m[1].toUpperCase();
  }

  if (postWindow) {
    const m = postWindow.match(quadroRegex);
    if (m) return m[1].toUpperCase();
  }

  if (fullRowWindow) {
    const m = fullRowWindow.match(quadroRegex);
    if (m) return m[1].toUpperCase();
  }

  return 'QPPM';
}

// Extract Promotion Date (e.g. 25/08/2026, 25/12/2019, 21/04/2023, 25/08/2020, 25/12/2021, 21/04/2022)
function extractPromoDate(context: string, rawPageText: string, officer: Officer): string {
  const { postWindow, fullRowWindow } = getOfficerRowWindows(rawPageText, context, officer);
  const dateRegex = /\b([0-3]?\d\/[0-1]?\d\/(?:19|20)\d{2})\b/;

  // 1. Check in postWindow (closest date after officer row cells)
  if (postWindow) {
    const m = postWindow.match(dateRegex);
    if (m) return m[1];
  }

  // 2. Check fullRowWindow
  if (fullRowWindow) {
    const m = fullRowWindow.match(dateRegex);
    if (m) return m[1];
  }

  // 3. Fallback to context
  const m = (context || '').match(dateRegex);
  if (m) return m[1];

  return '-';
}

// Extract Diárias quantity (e.g. 1, 2, 3, 4, 1/2)
function extractDiarias(context: string, rawPageText: string, officer: Officer): string {
  const { postWindow, fullRowWindow } = getOfficerRowWindows(rawPageText, context, officer);
  const search = `${postWindow} ${fullRowWindow} ${context}`;
  const m = search.match(/\b(\d{1,2}(?:\s*,\s*5|\s*\/\s*2)?)\s*(?:di[aá]rias?|dias?)\b/i);
  if (m) return m[1].replace(/\s+/g, '');
  return '-';
}

// Extract Valor em R$ (e.g. R$ 480,00, 360,00)
function extractValor(context: string, rawPageText: string, officer: Officer): string {
  const { postWindow, fullRowWindow } = getOfficerRowWindows(rawPageText, context, officer);
  const search = `${postWindow} ${fullRowWindow} ${context}`;
  const m = search.match(/(?:R\$\s*)?(\d{2,4}[\.,]\d{2})\b/);
  if (m) return `R$ ${m[1]}`;
  return '-';
}

// Extract Período (e.g. 01/08/2026 a 30/08/2026 or 30 dias)
function extractPeriod(context: string, rawPageText: string, officer: Officer): string {
  const { postWindow, fullRowWindow } = getOfficerRowWindows(rawPageText, context, officer);
  const search = `${postWindow} ${fullRowWindow} ${context}`;
  const m = search.match(/(\d{2}\/\d{2}\/\d{4}\s*(?:a|à|até|-)\s*\d{2}\/\d{2}\/\d{4})/i);
  if (m) return m[1];
  const mDays = search.match(/(\d{1,2}\s*dias?(?:\s*\([^\)]+\))?)/i);
  if (mDays) return mDays[1];
  return '-';
}

// Clean and sanitize OME text to prevent leaking next person's data, dates, points, or medical parecer
function cleanOmeText(ome: string): string {
  if (!ome) return '';
  let clean = ome.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
  
  // Standardize arrows: e.g. " - > ", " -> ", " → ", " > ", " –> ", " —> "
  clean = clean.replace(/\s*(?:[-–—]+>|→|>)\s*/g, ' -> ');
  
  // Cut off if medical opinion / parecer leaked into OME
  clean = clean.replace(/\s+(?:Incapaz|Apto|Dispensad[oa]|Necessita|Homologad[oa]|Deferid[oa]|Indeferid[oa]|Concedid[oa]|Prorrogad[oa]|Favor[aá]vel|Desfavor[aá]vel|Por\s+conclus[aã]o|\*NR)\b.*$/i, '');

  // Cut off if date leaked into OME (e.g. "5º BPM 21/04/2024" or "À DISPOSIÇÃO 25/12/2019" or "5º BPM 25/08/2026")
  clean = clean.replace(/\s+\d{2}\/\d{2}\/\d{4}(?:\s+.*)?$/g, '');

  // Cut off if points score leaked into OME (e.g. "... 5º BPM -> 1 Cia 132.95" or "... 132.95")
  clean = clean.replace(/\s+\d{2,3}[\.,]\d{2}(?:\s+.*)?$/i, '');
  
  // Cut off if next person's ORD / Rank / PM number / Name leaked into OME
  clean = clean.replace(/\s+\d{1,4}\s+(?:2[º°ª]|1[º°ª]|3[º°ª]|CEL|TC|MAJ|CAP|TEN|SUB|ST|SGT|CB|SD|AL|ASP)\b.*$/i, '');
  clean = clean.replace(/\s+(?:2[º°ª]\s*SGT|1[º°ª]\s*SGT|3[º°ª]\s*SGT|SUBTEN|ST\s*PM|CB\s*PM|SD\s*PM|1[º°ª]\s*TEN|2[º°ª]\s*TEN|CAP\s*PM|MAJ\s*PM|TEN\s*CEL|CEL\s*PM)\b.*$/i, '');
  clean = clean.replace(/\b(?:19|20)\d{2}\.\d{3,4}\b.*$/i, '');

  return clean.trim();
}

// Extract OME - Extracts the EXACT hierarchical OME text from the document table cell (e.g. 9º BPM, 5º BPM, À DISPOSIÇÃO, AJUDÂNCIA GERAL, SESED -> PMRN -> CMD GERAL -> 5º BPM)
function extractOme(context: string, rawPageText: string, officer: Officer): string {
  const { postWindow } = getOfficerRowWindows(rawPageText, context, officer);

  if (postWindow) {
    // 1. Look for text between registration (e.g. 164.321-5 or 202.511-6) and Parecer / Date / Points
    // E.g. "164.321-5 9º BPM Incapaz temporariamente..." -> matches "9º BPM"
    // E.g. "202.511-6 5º BPM 25/08/2026" -> matches "5º BPM"
    // E.g. "112.283-5 À DISPOSIÇÃO 25/12/2019" -> matches "À DISPOSIÇÃO"
    const betweenRegAndNext = postWindow.match(/(?:[12]\d{2}[\.\s]?\d{3}(?:[-–—]\d)?|\b\d{6,7}\b)\s+([A-ZÁÉÍÓÚÂÊÔÃÕÇ0-9\sºª°\.\-\/>→]+?)(?=\s+(?:Incapaz|Apto|Dispensad[oa]|Necessita|Homologad[oa]|Deferid[oa]|Indeferid[oa]|Concedid[oa]|Prorrogad[oa]|Favor[aá]vel|Desfavor[aá]vel|Por\s+conclus[aã]o|\*NR|\d{2}\/\d{2}\/\d{4}|\d{2,3}[\.,]\d{2}|\d{1,4}\s+(?:2[º°ª]|1[º°ª]|3[º°ª]|CEL|TC|MAJ|CAP|TEN|SUB|ST|SGT|SD|CB))|\s*$)/i);
    if (betweenRegAndNext) {
      const cleaned = cleanOmeText(betweenRegAndNext[1]);
      if (cleaned.length >= 2) return cleaned;
    }

    // 2. Look for known units or administrative terms (e.g. 9º BPM, 5º BPM, À DISPOSIÇÃO, AJUDÂNCIA GERAL, CIPM, CIA)
    const unitMatch = postWindow.match(/((?:\d{1,2}[º°ª\.]?\s*BPM|BPM|CIA|CIPM|CPRE|BPCQ|BOPE|BCHOQUE|[ÀA]\s*DISPOSI[ÇC][ÃA]O|AJUD[AÂ]NCIA\s*GERAL|DIRETORIA|DPM)[^;\n\r\|]{0,80}?)(?=\s+(?:Incapaz|Apto|Dispensad[oa]|Necessita|Homologad[oa]|Deferid[oa]|Indeferid[oa]|Concedid[oa]|Prorrogad[oa]|Favor[aá]vel|Desfavor[aá]vel|Por\s+conclus[aã]o|\*NR|\d{2,3}[\.,]\d{2}|\d{2}\/\d{2}\/\d{4}|\d{1,4}\s+(?:2[º°ª]|1[º°ª]|3[º°ª]|CEL|TC|MAJ|CAP|TEN|SUB|ST|SGT))|\s*$|[\n\r])/i);
    if (unitMatch) {
      const cleaned = cleanOmeText(unitMatch[1]);
      if (cleaned.length >= 2) return cleaned;
    }

    // 3. Look for SESED -> ... hierarchy chain
    const sesedMatch = postWindow.match(/(SESED\s*(?:[-–—]+>|→|>)\s*[^;\n\r\|]{6,160}?)(?=\s+(?:Incapaz|Apto|Dispensad[oa]|Necessita|\d{2,3}[\.,]\d{2}|\d{2}\/\d{2}\/\d{4}|\d{1,4}\s+(?:2[º°ª]|1[º°ª]|3[º°ª]|CEL|TC|MAJ|CAP|TEN|SUB|ST|SGT))|\s*$|[\n\r])/i);
    if (sesedMatch) {
      const cleaned = cleanOmeText(sesedMatch[1]);
      if (cleaned.length > 5) return cleaned;
    }

    // 4. Look for any arrow hierarchy chain (PMRN -> ... or CMD GERAL -> ...)
    const arrowChainMatch = postWindow.match(/([A-Z0-9\sªº°\.\-\/]{2,30}\s*(?:[-–—]+>|→|>)\s*[^;\n\r\|]{6,160}?)(?=\s+(?:Incapaz|Apto|Dispensad[oa]|Necessita|\d{2,3}[\.,]\d{2}|\d{2}\/\d{2}\/\d{4}|\d{1,4}\s+(?:2[º°ª]|1[º°ª]|3[º°ª]|CEL|TC|MAJ|CAP|TEN|SUB|ST|SGT))|\s*$|[\n\r])/i);
    if (arrowChainMatch) {
      const cleaned = cleanOmeText(arrowChainMatch[1]);
      if (cleaned.length > 5) return cleaned;
    }
  }

  // 5. Default fallback to officer's registered unit
  return officer.unit || '5º BPM';
}

// Extract PARECER da Junta Médica / Inspeção de Saúde / Ato Administrativo
function extractParecer(context: string, rawPageText: string, officer: Officer): string {
  const { postWindow, fullRowWindow } = getOfficerRowWindows(rawPageText, context, officer);
  const searchSources = [postWindow, fullRowWindow, context].filter(Boolean);

  for (const text of searchSources) {
    if (!text) continue;

    // Look for medical parecer text starting with Incapaz, Apto, Necessita, Dispensado, etc.
    const parecerMatch = text.match(/\b((?:Incapaz\s+temporariamente|Incapaz\s+definitivamente|Incapaz|Apto\s+para|Apto\s+com|Apto|Necessita\s+de|Dispensad[oa]\s+de|Homologad[oa]|Deferid[oa]|Indeferid[oa]|Concedid[oa]|Prorrogad[oa]|Favor[aá]vel|Desfavor[aá]vel)[^;\n\r\|]{8,500}?)(?=\s+(?:Por\s+conclus[aã]o|Em\s+virtude|A\s+contar\s+de|Sem\s+preju[ií]zo|Conforme|Referente\s+a|Obs:?|Observa[çc][ãa]o:?|\b\d{6,7}\b|\b[A-ZÁÉÍÓÚÂÊÔÃÕÇ\s]{4,30}\s+(?:ST\s*PM|SGT\s*PM|CB\s*PM|SD\s*PM))|$)/i);
    if (parecerMatch) {
      let clean = parecerMatch[1].replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
      return clean;
    }
  }

  return '-';
}

// Extract OBS (Observações / Justificativas)
function extractObs(context: string, rawPageText: string, officer: Officer): string {
  const { postWindow, fullRowWindow } = getOfficerRowWindows(rawPageText, context, officer);
  const searchSources = [postWindow, fullRowWindow, context].filter(Boolean);

  for (const text of searchSources) {
    if (!text) continue;

    // Look for explicit OBS phrases: e.g. "Por conclusão da 2ª licença de 97 dias."
    const obsMatch = text.match(/\b((?:Por\s+conclus[aã]o|Em\s+virtude|A\s+contar\s+de|Sem\s+preju[ií]zo|Conforme|Referente\s+a|Prorroga[çc][aã]o|Obs:?|Observa[çc][ãa]o:?)[^;\n\r\|]{3,300}?)(?=\s*(?:[\n\r]|\b\d{6,7}\b|\b[A-ZÁÉÍÓÚÂÊÔÃÕÇ\s]{4,30}\s+(?:ST\s*PM|SGT\s*PM|CB\s*PM|SD\s*PM)|$))/i);
    if (obsMatch) {
      let clean = obsMatch[1].replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
      return clean;
    }
  }

  return '-';
}

// Extract PONTOS - ONLY the numeric points value (e.g. "132.95", "148.75"), no "pts" or extra words
function extractPoints(context: string, rawPageText?: string, officer?: Officer): string {
  // If officer registration/name is found, look for points right after OME
  if (rawPageText && officer) {
    const cleanReg = (officer.registration || '').replace(/[^\d]/g, '');
    let searchSource = rawPageText;
    let officerIdx = -1;

    if (cleanReg && cleanReg.length >= 5) {
      officerIdx = searchSource.indexOf(cleanReg.slice(0, 6));
    }
    if (officerIdx === -1 && officer.name) {
      const firstToken = officer.name.split(' ')[0];
      officerIdx = searchSource.toLowerCase().indexOf(firstToken.toLowerCase());
    }

    if (officerIdx !== -1) {
      const forwardSnippet = searchSource.substring(officerIdx, officerIdx + 280);
      const pointsAfterMatch = forwardSnippet.match(/\b(\d{2,3}[\.,]\d{2})\b/);
      if (pointsAfterMatch) {
        return pointsAfterMatch[1].replace(',', '.');
      }
    }
  }

  // Match decimal score like 148.75 or 148,89 or 132.95
  const pointsMatch = context.match(/\b(\d{2,3}[\.,]\d{2})\b/);
  if (pointsMatch) {
    return pointsMatch[1].replace(',', '.');
  }

  // Match integer score if available
  const intPoints = context.match(/\b(\d{2,3})\s*(?:pontos|pts)?\b/i);
  if (intPoints && parseInt(intPoints[1], 10) >= 50 && parseInt(intPoints[1], 10) <= 300) {
    return intPoints[1];
  }

  return '-';
}

// Extract full publication snippet for text-based decrees, portarias, and dispatches
function extractPublicationSnippet(rawPageText: string, context: string, officerName: string, officerReg: string): string {
  const cleanReg = (officerReg || '').replace(/\D/g, '');
  const firstName = (officerName || '').split(' ')[0].toLowerCase();
  
  if (rawPageText) {
    const lines = rawPageText.split(/[\r\n]+/).map(l => l.trim()).filter(Boolean);
    
    // Find index of the line containing the officer
    let matchIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i].toLowerCase();
      if ((firstName && l.includes(firstName)) || (cleanReg && cleanReg.length >= 5 && l.includes(cleanReg))) {
        matchIdx = i;
        break;
      }
    }
    
    if (matchIdx !== -1) {
      // Find start of the decree/portaria/despacho block
      let startIdx = Math.max(0, matchIdx - 4);
      for (let i = matchIdx; i >= Math.max(0, matchIdx - 8); i--) {
        const l = lines[i];
        if (/^(?:DECRETO|PORTARIA|DESPACHO|NOTA|ATO|ASSUNTO:|RESOLVE:|O COMANDANTE|O GOVERNADOR|[1-4][ªº°\.]?\s*PARTE|ESTADO DO RIO GRANDE)/i.test(l)) {
          startIdx = i;
          break;
        }
      }
      
      // Find end of the decree/portaria/despacho block
      let endIdx = Math.min(lines.length, matchIdx + 6);
      for (let i = matchIdx + 1; i < Math.min(lines.length, matchIdx + 10); i++) {
        const l = lines[i];
        if (/^(?:DECRETO|PORTARIA|DESPACHO|NOTA|ATO|ASSUNTO:|[1-4][ªº°\.]?\s*PARTE|ESTADO DO RIO GRANDE)/i.test(l)) {
          endIdx = i;
          break;
        }
      }
      
      const snippetLines = lines.slice(startIdx, endIdx);
      const combined = snippetLines.join(' ').replace(/\s+/g, ' ').trim();
      if (combined.length > 25) {
        return combined;
      }
    }
  }

  return (context || '').replace(/\s+/g, ' ').trim();
}

// Categorize subject by keywords
function detectCategory(title: string, context: string): SubjectGroup['category'] {
  const combined = `${title} ${context}`.toLowerCase();
  if (combined.includes('promoção') || combined.includes('promocao') || combined.includes('quadro de acesso') || combined.includes('qap') || combined.includes('qao') || combined.includes('pontos') || combined.includes('antiguidade') || combined.includes('merecimento')) {
    return 'promocao';
  }
  if (combined.includes('diária') || combined.includes('diaria') || combined.includes('indeniza')) {
    return 'diarias';
  }
  if (combined.includes('escala') || combined.includes('serviço extraordinário') || combined.includes('servico extraordinario') || combined.includes('operacional')) {
    return 'escala';
  }
  if (combined.includes('férias') || combined.includes('ferias')) {
    return 'ferias';
  }
  if (combined.includes('elogio') || combined.includes('medalha') || combined.includes('láurea') || combined.includes('laurea')) {
    return 'elogio';
  }
  if (combined.includes('licença') || combined.includes('licenca') || combined.includes('dispensa') || combined.includes('lts') || combined.includes('ltip') || combined.includes('junta médica') || combined.includes('junta medica') || combined.includes('inspeção de saúde') || combined.includes('inspecao de saude') || combined.includes('saúde') || combined.includes('saude') || combined.includes('parecer') || combined.includes('laudo')) {
    return 'licenca';
  }
  if (combined.includes('transferência') || combined.includes('transferencia') || combined.includes('movimentação') || combined.includes('movimentacao') || combined.includes('classificação') || combined.includes('admissão')) {
    return 'transferencia';
  }
  if (combined.includes('portaria') || combined.includes('decreto') || combined.includes('despacho') || combined.includes('nota nº') || combined.includes('aditamento')) {
    return 'portaria';
  }
  return 'geral';
}

// Determine whether a subject group was presented in a real table in the original document
function detectIsTable(
  group: { title: string; category: string; officers: SubjectOfficerEntry[]; pages: number[] },
  pagesTextMap: Map<number, string>
): boolean {
  // 1. If any officer in this group has an explicit numeric order number (ORD)
  const hasValidOrd = group.officers.some(o => o.ord && o.ord !== '-' && /^\d+$/.test(o.ord.trim()));
  if (hasValidOrd) return true;

  // 2. If any officer has explicit numeric points (PONTOS) or promoDate or parecer
  const hasValidPoints = group.officers.some(o => o.points && o.points !== '-' && /\d/.test(o.points));
  if (hasValidPoints) return true;
  const hasValidPromoDate = group.officers.some(o => o.promoDate && o.promoDate !== '-');
  if (hasValidPromoDate) return true;
  const hasValidParecer = group.officers.some(o => o.values?.parecer && o.values.parecer !== '-');
  if (hasValidParecer) return true;

  // 3. Check subject keywords that inherently represent structured tables
  const titleNorm = normalizeText(group.title);
  if (
    titleNorm.includes('aditamento') ||
    titleNorm.includes('junta medica') ||
    titleNorm.includes('inspecao de saude') ||
    titleNorm.includes('quadro de acesso') || 
    titleNorm.includes('relacao de diarias') || 
    titleNorm.includes('mapa de diarias') ||
    titleNorm.includes('pontuacao') ||
    titleNorm.includes('antiguidade') ||
    titleNorm.includes('merecimento') ||
    titleNorm.includes('folha de pagamento') ||
    titleNorm.includes('tabela') ||
    titleNorm.includes('qap') ||
    titleNorm.includes('qao') ||
    titleNorm.includes('promocao de pracas') ||
    titleNorm.includes('promocao de oficiais')
  ) {
    return true;
  }

  // 4. Check if the pages for this group contain table column headers
  for (const pageNum of group.pages) {
    const rawText = pagesTextMap.get(pageNum) || '';
    const norm = normalizeText(rawText);
    if (
      (norm.includes('nome') && (norm.includes('post/grad') || norm.includes('post / grad') || norm.includes('graduacao')) && (norm.includes('matric') || norm.includes('parecer') || norm.includes('cia') || norm.includes('ome'))) ||
      (norm.includes('ord') && norm.includes('graduacao') && norm.includes('nome')) ||
      (norm.includes('ordem') && norm.includes('graduacao') && norm.includes('nome')) ||
      (norm.includes('ord') && norm.includes('matricula') && (norm.includes('pontos') || norm.includes('data'))) ||
      (norm.includes('ord') && norm.includes('ome') && (norm.includes('pontos') || norm.includes('promocao'))) ||
      (norm.includes('quadro de acesso') && (norm.includes('pontos') || norm.includes('qgppm'))) ||
      (norm.includes('junta medica') && (norm.includes('parecer') || norm.includes('obs')))
    ) {
      return true;
    }
  }

  // Otherwise (e.g. DECRETO, PORTARIA, DESPACHO, NOTA, ATO EM TEXTO CORRIDO) -> It's a text publication
  return false;
}

// Dynamically detect table columns matching the EXACT document table structure
function detectTableColumns(
  group: { title: string; category: string; officers: SubjectOfficerEntry[]; pages: number[] },
  pagesTextMap: Map<number, string>
): TableColumnDef[] {
  const pagesTextCombined = group.pages.map(p => pagesTextMap.get(p) || '').join('\n');
  const normText = normalizeText(pagesTextCombined);
  const normTitle = normalizeText(group.title);

  // Check signals for Aditamento / Medical inspection / Parecer tables
  const hasParecer = normText.includes('parecer') || normTitle.includes('parecer') || normTitle.includes('junta medica') || normTitle.includes('inspecao') || normTitle.includes('saude') || normTitle.includes('aditamento') || group.officers.some(o => o.values?.parecer && o.values.parecer !== '-');
  const hasPostGradHeader = normText.includes('post/grad') || normText.includes('post / grad') || normText.includes('post/grad/no') || normText.includes('post/grad/n°') || normText.includes('post/grad/nº');
  const hasMatricHeader = normText.includes('matric') || normText.includes('matricula');
  const hasCiaHeader = normText.includes('cia') || normText.includes('opm');
  const hasObsHeader = normText.includes('obs') || normText.includes('observacao') || group.officers.some(o => o.values?.obs && o.values.obs !== '-');
  const hasOrd = group.officers.some(o => o.ord && o.ord !== '-' && /^\d+$/.test(o.ord.trim()));

  // Check signals in text and parsed officer values
  const hasQgppm = normText.includes('qgppm') || normText.includes('qppm') || group.officers.some(o => o.quadro && o.quadro !== '-');
  const hasPromoDate = normText.includes('data de promocao') || normText.includes('data promocao') || normText.includes('ultima promocao') || group.officers.some(o => o.promoDate && o.promoDate !== '-');
  const hasPoints = (normText.includes('pontos') || normText.includes('pontuacao') || normTitle.includes('quadro de acesso')) && group.officers.some(o => o.points && o.points !== '-');
  const hasDiarias = normText.includes('diaria') || normTitle.includes('diaria') || group.officers.some(o => o.values?.diarias && o.values.diarias !== '-');
  const hasValor = normText.includes('valor') || group.officers.some(o => o.values?.valor && o.values.valor !== '-');
  const hasPeriod = (normText.includes('periodo') || normTitle.includes('ferias') || normTitle.includes('licenca')) && group.officers.some(o => o.values?.period && o.values.period !== '-');

  // Case A: Aditamento / Junta Médica / Inspeção de Saúde table (NOME | POST/GRAD/Nº | MATRIC | CIA | PARECER | OBS)
  if (hasParecer || (hasPostGradHeader && hasMatricHeader) || (normTitle.includes('aditamento') && (hasPostGradHeader || hasCiaHeader || hasMatricHeader))) {
    const cols: TableColumnDef[] = [];
    if (hasOrd) {
      cols.push({ key: 'ord', label: 'ORD', width: 'w-14', align: 'center' });
    }
    const postGradLabel = hasPostGradHeader ? (normText.includes('post/grad/no') || normText.includes('post/grad/n°') || normText.includes('post/grad/nº') ? 'POST/GRAD/Nº' : 'POST/GRAD') : 'POST/GRAD/Nº';
    const matricLabel = normText.includes('matric ') || normText.includes('matric\n') || normText.includes('matric\r') || normText.includes('matric|') ? 'MATRIC' : 'MATRÍCULA';
    const ciaLabel = hasCiaHeader ? 'CIA' : 'OME';

    cols.push(
      { key: 'name', label: 'NOME', width: 'min-w-[200px]', align: 'center' },
      { key: 'rank', label: postGradLabel, width: 'w-32', align: 'center' },
      { key: 'registration', label: matricLabel, width: 'w-28', align: 'center' },
      { key: 'ome', label: ciaLabel, width: 'w-24', align: 'center' },
      { key: 'parecer', label: 'PARECER', width: 'min-w-[320px]', align: 'left' }
    );
    if (hasObsHeader || group.officers.some(o => o.values?.obs && o.values.obs !== '-')) {
      cols.push({ key: 'obs', label: 'OBS', width: 'min-w-[200px]', align: 'left' });
    }
    return cols;
  }

  // Case 1: PMRN Promotion Table (e.g. Image 2: ORDEM | GRADUAÇÃO | QGPPM | Nº PRAÇA | NOME | MATRÍCULA | OME | DATA DE PROMOÇÃO)
  if (hasPromoDate || hasQgppm) {
    const cols: TableColumnDef[] = [
      { key: 'ord', label: 'ORDEM', width: 'w-16', align: 'center' },
      { key: 'rank', label: 'GRADUAÇÃO', width: 'w-36', align: 'center' },
    ];
    if (hasQgppm) {
      cols.push({ key: 'quadro', label: 'QGPPM', width: 'w-20', align: 'center' });
    }
    cols.push(
      { key: 'pmNumber', label: 'Nº PRAÇA', width: 'w-28', align: 'center' },
      { key: 'name', label: 'NOME', width: 'min-w-[220px]', align: 'center' },
      { key: 'registration', label: 'MATRÍCULA', width: 'w-28', align: 'center' },
      { key: 'ome', label: 'OME', width: 'min-w-[200px]', align: 'center' }
    );
    if (hasPromoDate) {
      cols.push({ key: 'promoDate', label: 'DATA DE PROMOÇÃO', width: 'w-36', align: 'center' });
    }
    return cols;
  }

  // Case 2: Score / Quadro de Acesso Table (e.g. Image 1: ORD | GRADUAÇÃO | Nº | NOME | MAT | OME | PONTOS)
  if (hasPoints) {
    return [
      { key: 'ord', label: 'ORD', width: 'w-14', align: 'center' },
      { key: 'rank', label: 'GRADUAÇÃO', width: 'w-28', align: 'center' },
      { key: 'pmNumber', label: 'Nº', width: 'w-28', align: 'center' },
      { key: 'name', label: 'NOME', width: 'min-w-[200px]', align: 'center' },
      { key: 'registration', label: 'MAT', width: 'w-28', align: 'center' },
      { key: 'ome', label: 'OME', width: 'min-w-[220px]', align: 'center' },
      { key: 'points', label: 'PONTOS', width: 'w-24', align: 'center' }
    ];
  }

  // Case 3: Diárias Table (ORDEM | GRADUAÇÃO | Nº | NOME | MATRÍCULA | OME | DIÁRIAS | VALOR)
  if (hasDiarias) {
    const cols: TableColumnDef[] = [
      { key: 'ord', label: 'ORDEM', width: 'w-14', align: 'center' },
      { key: 'rank', label: 'GRADUAÇÃO', width: 'w-28', align: 'center' },
      { key: 'pmNumber', label: 'Nº', width: 'w-28', align: 'center' },
      { key: 'name', label: 'NOME', width: 'min-w-[200px]', align: 'center' },
      { key: 'registration', label: 'MATRÍCULA', width: 'w-28', align: 'center' },
      { key: 'ome', label: 'OME', width: 'min-w-[180px]', align: 'center' },
      { key: 'diarias', label: 'DIÁRIAS', width: 'w-24', align: 'center' }
    ];
    if (hasValor) {
      cols.push({ key: 'valor', label: 'VALOR', width: 'w-28', align: 'center' });
    }
    return cols;
  }

  // Case 4: Period / Férias Table (ORDEM | GRADUAÇÃO | Nº | NOME | MATRÍCULA | OME | PERÍODO)
  if (hasPeriod) {
    return [
      { key: 'ord', label: 'ORDEM', width: 'w-14', align: 'center' },
      { key: 'rank', label: 'GRADUAÇÃO', width: 'w-28', align: 'center' },
      { key: 'pmNumber', label: 'Nº', width: 'w-28', align: 'center' },
      { key: 'name', label: 'NOME', width: 'min-w-[200px]', align: 'center' },
      { key: 'registration', label: 'MATRÍCULA', width: 'w-28', align: 'center' },
      { key: 'ome', label: 'OME', width: 'min-w-[180px]', align: 'center' },
      { key: 'period', label: 'PERÍODO', width: 'w-32', align: 'center' }
    ];
  }

  // Fallback: Standard 6-column military table
  return [
    { key: 'ord', label: 'ORD', width: 'w-14', align: 'center' },
    { key: 'rank', label: 'GRADUAÇÃO', width: 'w-28', align: 'center' },
    { key: 'pmNumber', label: 'Nº', width: 'w-28', align: 'center' },
    { key: 'name', label: 'NOME', width: 'min-w-[200px]', align: 'center' },
    { key: 'registration', label: 'MATRÍCULA', width: 'w-28', align: 'center' },
    { key: 'ome', label: 'OME', width: 'min-w-[200px]', align: 'center' }
  ];
}

// Normalize and extract unified subject key & title across multiple pages
function detectSubjectOnPage(pageText: string, officerName: string, officerReg: string): { title: string; subjectKey: string } {
  if (!pageText) {
    return { title: 'Assunto Geral / Publicações Diversas', subjectKey: 'assunto_geral' };
  }

  const lines = pageText.split(/[\r\n]+/).map(l => l.trim()).filter(Boolean);
  
  // Specific regex patterns in official bulletins
  const headerPatterns = [
    { pattern: /(ADITAMENTO\s+(?:AO\s+BOLETIM\s+GERAL|AO\s+BG|N[º°ªo\.]?|NÚMERO)\s*[\d\.\-\/]*[^\n\r]*)/i, key: 'aditamento_bg' },
    { pattern: /(JUNTA\s+MÉDICA\s+DE\s+SAÚDE[^\n\r]*)/i, key: 'junta_medica_saude' },
    { pattern: /(INSPEÇÃO\s+DE\s+SAÚDE[^\n\r]*)/i, key: 'inspecao_saude' },
    { pattern: /(HOMOLOGAÇÃO\s+DE\s+LAUDO[^\n\r]*)/i, key: 'homologacao_laudo' },
    { pattern: /(ATA\s+DA\s+JUNTA\s+MÉDICA[^\n\r]*)/i, key: 'ata_junta_medica' },
    { pattern: /(LICENÇA\s+PARA\s+TRATAMENTO\s+DE\s+SAÚDE[^\n\r]*)/i, key: 'lts_saude' },
    { pattern: /(QUADRO\s+DE\s+ACESSO[^\n\r]*)/i, key: 'quadro_de_acesso_promocao' },
    { pattern: /(PROMOÇÃO\s+DE\s+(?:OFICIAIS|PRAÇAS)[^\n\r]*)/i, key: 'promocao_pracas_oficiais' },
    { pattern: /(PORTARIA\s+(?:N[º°ªo\.]?|NÚMERO)\s*[\d\.\-\/]+[^\n\r]*)/i, key: 'portaria' },
    { pattern: /(NOTA\s+(?:N[º°ªo\.]?|NÚMERO)\s*[\d\.\-\/]+[^\n\r]*)/i, key: 'nota_informativa' },
    { pattern: /(DESPACHO\s+(?:N[º°ªo\.]?|NÚMERO)?\s*[\d\.\-\/]+[^\n\r]*)/i, key: 'despacho' },
    { pattern: /(DECRETO\s+(?:N[º°ªo\.]?|NÚMERO)\s*[\d\.\-\/]+[^\n\r]*)/i, key: 'decreto' },
    { pattern: /(ATO\s+(?:N[º°ªo\.]?|NÚMERO)\s*[\d\.\-\/]+[^\n\r]*)/i, key: 'ato' },
    { pattern: /(PARTE\s+GENÉRICA\s*[\d\.\-\/]+[^\n\r]*)/i, key: 'parte_generica' },
    { pattern: /(ASSUNTO:\s*[^\n\r]+)/i, key: 'assunto_especifico' },
    { pattern: /([1-4][ªº°\.]?\s*PARTE\s*[-–—]\s*[^\n\r]+)/i, key: 'parte_boletim' },
    { pattern: /((?:CONCESSÃO|SUSPENSÃO|INTERRUPÇÃO)\s+DE\s+FÉRIAS[^\n\r]*)/i, key: 'concessao_ferias' },
    { pattern: /((?:CONCESSÃO|PAGAMENTO)\s+DE\s+DIÁRIAS[^\n\r]*)/i, key: 'concessao_diarias' },
    { pattern: /(ESCALA\s+DE\s+SERVIÇO[^\n\r]*)/i, key: 'escala_servico' },
    { pattern: /(ELOGIO\s+(?:INDIVIDUAL|COLETIVO)[^\n\r]*)/i, key: 'elogio_merito' },
    { pattern: /(ALTERAÇÃO\s+DE\s+(?:OFICIAIS|PRAÇAS)[^\n\r]*)/i, key: 'alteracao_efetivo' }
  ];

  let bestTitle = '';
  let bestKey = '';

  for (const line of lines) {
    for (const item of headerPatterns) {
      const match = line.match(item.pattern);
      if (match && match[1]) {
        let clean = match[1].replace(/\s+/g, ' ').trim();
        if (clean.length > 120) clean = clean.substring(0, 117) + '...';
        bestTitle = clean;
        
        // Formulate normalized subject key so that multiple pages of the same Portaria or Topic merge
        const normTitle = normalizeText(clean);
        if (normTitle.includes('aditamento')) {
          const aditNumMatch = clean.match(/ADITAMENTO\s*(?:AO\s+BG|AO\s+BOLETIM\s+GERAL)?\s*(?:N[º°ªo\.]?|NÚMERO)?\s*([\d\.\-\/]+)/i);
          bestKey = aditNumMatch ? `aditamento_${aditNumMatch[1].replace(/[^a-zA-Z0-9]/g, '_')}` : `aditamento_${normTitle.substring(0, 25).replace(/[^a-z0-9]/g, '_')}`;
        } else if (normTitle.includes('junta medica') || normTitle.includes('inspecao de saude') || normTitle.includes('laudo')) {
          bestKey = 'junta_medica_saude';
        } else if (normTitle.includes('quadro de acesso') || normTitle.includes('promocao')) {
          bestKey = 'promocao_quadro_acesso';
        } else if (normTitle.includes('diaria') || normTitle.includes('diarias')) {
          bestKey = 'concessao_diarias_operacionais';
        } else if (normTitle.includes('escala')) {
          bestKey = 'escala_servico_operacional';
        } else if (normTitle.includes('ferias')) {
          bestKey = 'ferias_regulamentares';
        } else if (normTitle.includes('elogio')) {
          bestKey = 'elogios_condecoracoes';
        } else if (normTitle.includes('portaria')) {
          const portNumMatch = clean.match(/PORTARIA\s+(?:N[º°ªo\.]?|NÚMERO)?\s*([\d\.\-\/]+)/i);
          bestKey = portNumMatch ? `portaria_${portNumMatch[1].replace(/[^a-zA-Z0-9]/g, '_')}` : `portaria_${normTitle.substring(0, 25)}`;
        } else {
          bestKey = `${item.key}_${normTitle.substring(0, 25).replace(/[^a-z0-9]/g, '_')}`;
        }
      }
    }

    if ((line.toLowerCase().includes(officerName.toLowerCase()) || (officerReg && line.includes(officerReg))) && bestTitle) {
      return { title: bestTitle, subjectKey: bestKey };
    }
  }

  if (bestTitle && bestKey) {
    return { title: bestTitle, subjectKey: bestKey };
  }

  // Fallback: check parts
  const partMatch = pageText.match(/([1-4][ªº°\.]?\s*PARTE\s*[-–—]\s*[A-ZÁÉÍÓÚÂÊÔÃÕÇ\s]{4,40})/i);
  if (partMatch) {
    const clean = partMatch[1].replace(/\s+/g, ' ').trim();
    return { title: clean, subjectKey: `parte_${normalizeText(clean).substring(0, 25).replace(/[^a-z0-9]/g, '_')}` };
  }

  return { title: 'Assunto Geral / Publicações Diversas', subjectKey: 'assunto_geral' };
}

export function SubjectGroupedTables({
  docType,
  docNumber,
  docDate,
  pdfUrl,
  results,
  pagesText,
  officersList,
  onOpenPdfPage
}: SubjectGroupedTablesProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [formatFilter, setFormatFilter] = useState<'all' | 'table' | 'text'>('all');
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [tableOverrides, setTableOverrides] = useState<Record<string, boolean>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Unified Subject Groups - All pages with the SAME subject merge into ONE single group
  const subjectGroups = useMemo(() => {
    const officerResults = results.filter(r => r.type === 'officer' && r.metadata);
    const groupsMap = new Map<string, SubjectGroup>();

    // Page text lookup
    const pageTextMap = new Map<number, string>();
    pagesText.forEach(p => pageTextMap.set(p.page, p.text));

    officerResults.forEach(res => {
      const officer: Officer = res.metadata;
      if (!officer) return;

      const pageNum = res.page;
      const rawPageText = pageTextMap.get(pageNum) || '';
      
      const { title: detectedTitle, subjectKey } = detectSubjectOnPage(rawPageText, officer.name, officer.registration);
      const category = detectCategory(detectedTitle, res.context);
      
      // Grouping key based on normalized subject key
      const groupKey = subjectKey || `subject_${category}_${normalizeText(detectedTitle).substring(0, 30)}`;

      if (!groupsMap.has(groupKey)) {
        groupsMap.set(groupKey, {
          id: groupKey,
          subjectKey: groupKey,
          title: detectedTitle,
          category,
          pages: [pageNum],
          docType,
          docNumber,
          docDate,
          isTable: true, // evaluated below
          columns: [],
          officers: []
        });
      }

      const group = groupsMap.get(groupKey)!;

      // Add page to group pages list if not already present
      if (!group.pages.includes(pageNum)) {
        group.pages.push(pageNum);
        group.pages.sort((a, b) => a - b);
      }

      // Avoid duplicate officer entries in the same subject
      const alreadyAdded = group.officers.some(
        o => o.officer.id === officer.id || (o.registration && o.registration === officer.registration)
      );

      if (!alreadyAdded) {
        const detectedRank = extractRank(officer, res.context, rawPageText);
        const ord = extractOrd(res.context, rawPageText, officer);
        const quadro = extractQuadro(res.context, rawPageText, officer);
        const pmNumber = extractPmNumber(res.context, rawPageText, officer);
        const formattedReg = extractRegistrationFormatted(res.context, rawPageText, officer);
        const ome = extractOme(res.context, rawPageText, officer);
        const promoDate = extractPromoDate(res.context, rawPageText, officer);
        const points = extractPoints(res.context, rawPageText, officer);
        const diarias = extractDiarias(res.context, rawPageText, officer);
        const valor = extractValor(res.context, rawPageText, officer);
        const period = extractPeriod(res.context, rawPageText, officer);
        const parecer = extractParecer(res.context, rawPageText, officer);
        const obs = extractObs(res.context, rawPageText, officer);
        const publicationSnippet = extractPublicationSnippet(rawPageText, res.context, officer.name, officer.registration);

        const values: Record<string, string> = {
          ord,
          rank: detectedRank,
          quadro,
          pmNumber,
          name: officer.name.toUpperCase(),
          registration: formattedReg,
          ome,
          promoDate,
          points,
          diarias,
          valor,
          period,
          parecer,
          obs
        };

        group.officers.push({
          officer,
          values,
          ord,
          rank: detectedRank,
          quadro,
          pmNumber,
          name: officer.name.toUpperCase(),
          registration: formattedReg,
          ome,
          promoDate,
          points,
          parecer,
          obs,
          page: pageNum,
          rawContext: res.context,
          publicationSnippet
        });
      }
    });

    // Convert map to sorted array
    const list = Array.from(groupsMap.values());

    // Determine whether each group is an actual table or a running text publication, and detect exact dynamic columns
    list.forEach(g => {
      g.isTable = detectIsTable(g, pageTextMap);
      g.columns = detectTableColumns(g, pageTextMap);
    });
    
    // Sort groups by category priority
    const categoryPriority: Record<string, number> = {
      promocao: 1,
      diarias: 2,
      escala: 3,
      ferias: 4,
      elogio: 5,
      licenca: 6,
      transferencia: 7,
      portaria: 8,
      geral: 9
    };

    list.sort((a, b) => {
      const pA = categoryPriority[a.category] || 10;
      const pB = categoryPriority[b.category] || 10;
      if (pA !== pB) return pA - pB;
      return (a.pages[0] || 0) - (b.pages[0] || 0);
    });

    // Sort officers within each group by their exact ORD number from document (or name if no ord)
    list.forEach(g => {
      g.officers.sort((a, b) => {
        const numA = parseInt(a.ord, 10);
        const numB = parseInt(b.ord, 10);
        if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
        return a.name.localeCompare(b.name);
      });
    });

    return list;
  }, [results, pagesText, docType, docNumber, docDate]);

  // Filter groups according to user search, category, and table/text format
  const filteredGroups = useMemo(() => {
    return subjectGroups.filter(group => {
      const isTable = tableOverrides[group.id] !== undefined ? tableOverrides[group.id] : group.isTable;

      // Format filter (Tabelas vs Textos/Atos)
      if (formatFilter === 'table' && !isTable) return false;
      if (formatFilter === 'text' && isTable) return false;

      // Category filter
      if (selectedCategory !== 'all' && group.category !== selectedCategory) {
        return false;
      }

      // Search query filter
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();

      const titleMatches = group.title.toLowerCase().includes(q);
      const officerMatches = group.officers.some(o => 
        o.name.toLowerCase().includes(q) ||
        o.registration.toLowerCase().includes(q) ||
        o.ome.toLowerCase().includes(q) ||
        o.rank.toLowerCase().includes(q) ||
        (o.quadro && o.quadro.toLowerCase().includes(q)) ||
        (o.promoDate && o.promoDate.toLowerCase().includes(q)) ||
        o.points.toLowerCase().includes(q) ||
        o.ord.toLowerCase().includes(q) ||
        (o.publicationSnippet && o.publicationSnippet.toLowerCase().includes(q))
      );

      return titleMatches || officerMatches;
    });
  }, [subjectGroups, searchQuery, selectedCategory, formatFilter, tableOverrides]);

  // Total unique officers of 5º BPM identified across all subjects
  const totalUniqueOfficers = useMemo(() => {
    const set = new Set<string>();
    subjectGroups.forEach(g => {
      g.officers.forEach(o => set.add(o.registration || o.name));
    });
    return set.size;
  }, [subjectGroups]);

  // Count tables vs text publications
  const counts = useMemo(() => {
    let tables = 0;
    let texts = 0;
    subjectGroups.forEach(g => {
      const isTable = tableOverrides[g.id] !== undefined ? tableOverrides[g.id] : g.isTable;
      if (isTable) tables++;
      else texts++;
    });
    return { tables, texts, total: subjectGroups.length };
  }, [subjectGroups, tableOverrides]);

  // Toggle group expansion
  const toggleGroup = (groupId: string) => {
    setExpandedGroups(prev => ({
      ...prev,
      [groupId]: prev[groupId] === undefined ? false : !prev[groupId]
    }));
  };

  // Toggle all groups
  const toggleAll = (expand: boolean) => {
    const newState: Record<string, boolean> = {};
    subjectGroups.forEach(g => {
      newState[g.id] = expand;
    });
    setExpandedGroups(newState);
  };

  // Toggle view mode (Table vs Text) for a specific group
  const toggleGroupFormat = (groupId: string, currentIsTable: boolean) => {
    setTableOverrides(prev => ({
      ...prev,
      [groupId]: !currentIsTable
    }));
  };

  // Export single subject table to CSV matching EXACT dynamic columns
  const exportSubjectToCSV = (group: SubjectGroup) => {
    if (group.officers.length === 0 || !group.columns || group.columns.length === 0) return;

    const headers = group.columns.map(c => c.label).join(';');
    const rows = group.officers.map(o => 
      group.columns.map(c => {
        const val = o.values[c.key] || (o as any)[c.key] || '-';
        return `"${String(val).replace(/"/g, '""')}"`;
      }).join(';')
    );

    const csvContent = "data:text/csv;charset=utf-8,\uFEFF" + headers + "\n" + rows.join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Tabela_${group.docType}_${group.docNumber}_${group.category}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Export ALL grouped tables to CSV matching EXACT document columns per table
  const exportAllGroupedTablesToCSV = () => {
    const tableGroups = subjectGroups.filter(g => g.officers.length > 0);
    if (tableGroups.length === 0) return;

    let csvContent = "data:text/csv;charset=utf-8,\uFEFF";

    tableGroups.forEach((group, gIdx) => {
      if (gIdx > 0) csvContent += "\n\n";
      csvContent += `# ASSUNTO: ${group.title} (${group.docType} Nº ${group.docNumber} - Pág. ${group.pages.join(', ')})\n`;
      const cols = group.columns && group.columns.length > 0 ? group.columns : [
        { key: 'ord', label: 'ORD' },
        { key: 'rank', label: 'GRADUAÇÃO' },
        { key: 'pmNumber', label: 'Nº' },
        { key: 'name', label: 'NOME' },
        { key: 'registration', label: 'MAT' },
        { key: 'ome', label: 'OME' }
      ];

      csvContent += cols.map(c => c.label).join(';') + "\n";
      group.officers.forEach(o => {
        const row = cols.map(c => {
          const val = o.values[c.key] || (o as any)[c.key] || '-';
          return `"${String(val).replace(/"/g, '""')}"`;
        }).join(';');
        csvContent += row + "\n";
      });
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Tabelas_Oficiais_${docType}_${docNumber}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Copy table or text publication content for Word/WhatsApp formatted with dynamic columns
  const copySubjectContent = (group: SubjectGroup, isTable: boolean) => {
    let text = `========================================================================================\n`;
    text += `${group.docType} Nº ${group.docNumber}${group.docDate ? `, de ${group.docDate}` : ''} (Pág. ${group.pages.join(', ')})\n`;
    text += `ASSUNTO: ${group.title}\n`;
    text += `========================================================================================\n`;

    if (isTable && group.columns && group.columns.length > 0) {
      text += `RELAÇÃO DE POLICIAIS MILITARES DO 5º BPM\n`;
      
      // Calculate dynamic character padding per column
      const colWidths = group.columns.map(col => {
        let maxLen = col.label.length;
        group.officers.forEach(o => {
          const val = o.values[col.key] || (o as any)[col.key] || '-';
          if (val.length > maxLen) maxLen = val.length;
        });
        return Math.max(maxLen + 2, 6);
      });

      const divider = '+' + colWidths.map(w => '-'.repeat(w + 2)).join('+') + '+\n';
      const headerRow = '|' + group.columns.map((col, i) => ` ${col.label.padEnd(colWidths[i], ' ')} `).join('|') + '|\n';

      text += divider;
      text += headerRow;
      text += divider;

      group.officers.forEach(o => {
        const row = '|' + group.columns.map((col, i) => {
          const val = o.values[col.key] || (o as any)[col.key] || '-';
          return ` ${val.padEnd(colWidths[i], ' ')} `;
        }).join('|') + '|\n';
        text += row;
      });

      text += divider;
    } else {
      text += `PUBLICAÇÃO OFICIAL EM TEXTO / ATO ADMINISTRATIVO\n`;
      text += `----------------------------------------------------------------------------------------\n`;
      group.officers.forEach(o => {
        text += `POLICIAL: ${o.rank} ${o.pmNumber !== '-' ? `Nº ${o.pmNumber} ` : ''}${o.name} | MAT: ${o.registration} | OME: ${o.ome} (Pág. ${o.page})\n`;
        text += `TRANSCRIÇÃO:\n"${o.publicationSnippet || o.rawContext}"\n\n`;
      });
    }

    text += `========================================================================================\n`;

    navigator.clipboard.writeText(text);
    setCopiedId(group.id);
    setTimeout(() => setCopiedId(null), 2500);
  };

  // Print formatted report
  const printReport = () => {
    window.print();
  };

  // Badge icon/color per category
  const getCategoryBadge = (category: SubjectGroup['category']) => {
    switch (category) {
      case 'promocao':
        return { label: 'Promoção / Quadro de Acesso', color: 'bg-red-50 text-red-700 border-red-200', icon: Award };
      case 'diarias':
        return { label: 'Diárias Operacionais', color: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: DollarSign };
      case 'escala':
        return { label: 'Escala Operacional', color: 'bg-blue-50 text-blue-700 border-blue-200', icon: Briefcase };
      case 'ferias':
        return { label: 'Férias Regulamentares', color: 'bg-amber-50 text-amber-700 border-amber-200', icon: Calendar };
      case 'elogio':
        return { label: 'Elogios e Mérito', color: 'bg-purple-50 text-purple-700 border-purple-200', icon: Sparkles };
      case 'licenca':
        return { label: 'Licenças e Dispensas', color: 'bg-teal-50 text-teal-700 border-teal-200', icon: ShieldCheck };
      case 'transferencia':
        return { label: 'Movimentação / Classificação', color: 'bg-indigo-50 text-indigo-700 border-indigo-200', icon: Layers };
      case 'portaria':
        return { label: 'Portarias e Atos', color: 'bg-stone-100 text-stone-700 border-stone-300', icon: FileText };
      default:
        return { label: 'Assunto Geral', color: 'bg-gray-100 text-gray-700 border-gray-200', icon: FileText };
    }
  };

  // Highlight officer occurrences inside snippet text
  const renderHighlightedSnippet = (text: string, officer: Officer) => {
    if (!text) return null;
    const nameParts = (officer.name || '').split(' ').filter(p => p.length >= 3);
    const cleanReg = (officer.registration || '').replace(/\D/g, '');

    const termsToHighlight = [
      officer.name,
      ...nameParts,
      officer.registration,
      cleanReg
    ].filter(Boolean);

    if (termsToHighlight.length === 0) return text;

    const regex = new RegExp(`(${termsToHighlight.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
    const parts = text.split(regex);

    return parts.map((part, i) => {
      const isMatch = termsToHighlight.some(t => t.toLowerCase() === part.toLowerCase());
      if (isMatch) {
        return (
          <span 
            key={i} 
            className="bg-amber-200/90 text-black font-bold px-1 py-0.5 rounded border border-amber-300 font-serif"
          >
            {part}
          </span>
        );
      }
      return <React.Fragment key={i}>{part}</React.Fragment>;
    });
  };

  return (
    <div className="space-y-6">
      {/* Top Filter and Actions Bar */}
      <div className="bg-white rounded-2xl p-4 md:p-6 border border-black/10 shadow-xs print:hidden">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <h3 className="text-xl font-serif font-bold text-black flex items-center gap-2">
              <TableIcon className="w-5 h-5 text-[#5A5A40]" />
              Organização por Assunto (Tabelas e Atos Oficiais)
            </h3>
            <p className="text-xs md:text-sm text-stone-600 font-serif mt-0.5">
              Apresenta tabelas oficiais para relações estruturadas (Quadro de Acesso, Diárias) e transcrições em texto corrido para portarias, decretos e despachos.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={exportAllGroupedTablesToCSV}
              className="flex items-center gap-2 px-4 py-2 bg-[#5A5A40] text-white rounded-xl shadow-xs hover:bg-[#4a4a35] transition-all text-xs font-bold uppercase tracking-wider cursor-pointer"
            >
              <FileSpreadsheet className="w-4 h-4" /> Exportar CSV
            </button>
            <button
              onClick={printReport}
              className="flex items-center gap-2 px-4 py-2 bg-stone-100 border border-stone-300 text-black rounded-xl hover:bg-stone-200 transition-all text-xs font-bold uppercase tracking-wider cursor-pointer"
            >
              <Printer className="w-4 h-4" /> Imprimir
            </button>
            <button
              onClick={() => toggleAll(true)}
              className="px-3 py-2 text-xs font-bold text-stone-700 hover:text-black uppercase tracking-wider bg-stone-100 rounded-xl border border-stone-200 cursor-pointer"
            >
              Expandir
            </button>
            <button
              onClick={() => toggleAll(false)}
              className="px-3 py-2 text-xs font-bold text-stone-700 hover:text-black uppercase tracking-wider bg-stone-100 rounded-xl border border-stone-200 cursor-pointer"
            >
              Recolher
            </button>
          </div>
        </div>

        {/* Filter and Search Bar */}
        <div className="mt-4 pt-4 border-t border-stone-200 flex flex-col md:flex-row items-center justify-between gap-3">
          <div className="relative flex-1 w-full">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-stone-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Pesquisar por assunto, policial, graduação, matrícula ou texto..."
              className="w-full pl-10 pr-4 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-[#5A5A40]/20 placeholder-stone-400"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs font-bold text-red-500 hover:text-red-700 uppercase cursor-pointer"
              >
                Limpar
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
            {/* Format Filter: All vs Tables vs Text */}
            <div className="flex items-center bg-stone-100 p-1 rounded-xl border border-stone-200 text-xs font-bold uppercase">
              <button
                onClick={() => setFormatFilter('all')}
                className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${formatFilter === 'all' ? 'bg-white text-black shadow-xs font-bold' : 'text-stone-600 hover:text-black'}`}
              >
                Todos ({counts.total})
              </button>
              <button
                onClick={() => setFormatFilter('table')}
                className={`px-3 py-1.5 rounded-lg flex items-center gap-1 transition-all cursor-pointer ${formatFilter === 'table' ? 'bg-[#5A5A40] text-white shadow-xs font-bold' : 'text-stone-600 hover:text-black'}`}
              >
                <TableIcon className="w-3 h-3" /> Tabelas ({counts.tables})
              </button>
              <button
                onClick={() => setFormatFilter('text')}
                className={`px-3 py-1.5 rounded-lg flex items-center gap-1 transition-all cursor-pointer ${formatFilter === 'text' ? 'bg-stone-800 text-white shadow-xs font-bold' : 'text-stone-600 hover:text-black'}`}
              >
                <FileText className="w-3 h-3" /> Textos ({counts.texts})
              </button>
            </div>

            {/* Category Dropdown */}
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-stone-500 shrink-0" />
              <select
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                className="bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-xs font-bold uppercase tracking-wider text-black focus:outline-none focus:ring-2 focus:ring-[#5A5A40]/20 cursor-pointer"
              >
                <option value="all">Todas Matérias</option>
                <option value="promocao">Promoção / Quadro de Acesso</option>
                <option value="diarias">Diárias Operacionais</option>
                <option value="escala">Escala de Serviço</option>
                <option value="ferias">Férias Regulamentares</option>
                <option value="elogio">Elogios e Condecorações</option>
                <option value="licenca">Licenças e Dispensas</option>
                <option value="transferencia">Movimentação</option>
                <option value="portaria">Portarias e Atos</option>
                <option value="geral">Geral / Outros</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* List of Subjects (Tables and Text Publications) */}
      {filteredGroups.length === 0 ? (
        <div className="bg-white rounded-2xl p-12 text-center border border-stone-200">
          <FileText className="w-12 h-12 text-stone-300 mx-auto mb-3" />
          <h4 className="text-lg font-serif font-bold text-stone-700">Nenhum assunto encontrado</h4>
          <p className="text-xs text-stone-500 mt-1 max-w-md mx-auto">
            {searchQuery 
              ? `Nenhum policial ou assunto correspondeu à busca "${searchQuery}".` 
              : 'Não foram encontradas publicações ou tabelas para o filtro selecionado.'}
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          {filteredGroups.map((group) => {
            const isExpanded = expandedGroups[group.id] !== false; // expanded by default
            const catBadge = getCategoryBadge(group.category);
            const isTable = tableOverrides[group.id] !== undefined ? tableOverrides[group.id] : group.isTable;

            return (
              <div 
                key={group.id}
                className="bg-white border-2 border-black overflow-hidden shadow-xs"
              >
                {/* Official Military Document Top Banner */}
                <div className="bg-white border-b-2 border-black px-4 py-2.5 flex flex-wrap items-center justify-between gap-2">
                  <div className="font-serif font-bold text-sm md:text-base text-black tracking-wide flex items-center gap-3">
                    <span>
                      {group.docType} Nº {group.docNumber}{group.docDate ? `, de ${group.docDate}` : ''}
                    </span>
                    <span className="text-xs font-mono font-normal text-stone-600 bg-stone-100 px-2 py-0.5 border border-stone-300">
                      Pág. {group.pages.join(', ')}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {/* Mode Tag: Tabela vs Texto */}
                    <span className={`px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider border flex items-center gap-1 ${isTable ? 'bg-amber-50 text-amber-900 border-amber-300' : 'bg-blue-50 text-blue-900 border-blue-300'}`}>
                      {isTable ? <TableIcon className="w-3 h-3" /> : <FileText className="w-3 h-3" />}
                      {isTable ? 'Tabela Oficial' : 'Publicação em Texto'}
                    </span>
                    <span className={`px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider border ${catBadge.color}`}>
                      {catBadge.label}
                    </span>
                    <span className="text-xs font-serif font-bold text-black bg-stone-100 px-2 py-0.5 border border-black">
                      Total: {group.officers.length} {group.officers.length === 1 ? 'policial' : 'policiais'}
                    </span>
                  </div>
                </div>

                {/* Subject Title Bar with Actions */}
                <div 
                  onClick={() => toggleGroup(group.id)}
                  className="bg-stone-50 border-b-2 border-black px-4 py-3 flex flex-col md:flex-row md:items-center justify-between gap-2 cursor-pointer hover:bg-stone-100 transition-colors"
                >
                  <div className="flex-1 pr-2">
                    <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-stone-500 block">
                      ASSUNTO:
                    </span>
                    <h4 className="text-sm md:text-base font-serif font-bold text-black uppercase leading-snug">
                      {group.title}
                    </h4>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 self-end md:self-center shrink-0" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => copySubjectContent(group, isTable)}
                      className="flex items-center gap-1.5 px-3 py-1 bg-white border border-black text-xs font-bold uppercase tracking-wider text-black hover:bg-stone-100 transition-colors cursor-pointer"
                      title={isTable ? "Copiar Tabela" : "Copiar Texto da Publicação"}
                    >
                      {copiedId === group.id ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-green-700" />
                          <span className="text-green-700">Copiado</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          <span>{isTable ? 'Copiar Tabela' : 'Copiar Texto'}</span>
                        </>
                      )}
                    </button>

                    {isTable && (
                      <button
                        onClick={() => exportSubjectToCSV(group)}
                        className="flex items-center gap-1.5 px-3 py-1 bg-white border border-black text-xs font-bold uppercase tracking-wider text-black hover:bg-stone-100 transition-colors cursor-pointer"
                        title="Exportar CSV"
                      >
                        <Download className="w-3.5 h-3.5" /> CSV
                      </button>
                    )}

                    {/* Toggle View Mode Button */}
                    <button
                      onClick={() => toggleGroupFormat(group.id, isTable)}
                      className="px-2.5 py-1 text-[11px] font-bold text-stone-700 bg-white border border-stone-400 hover:bg-stone-100 hover:text-black uppercase tracking-wider cursor-pointer"
                      title={isTable ? "Visualizar como Texto Corrido" : "Visualizar em Grade de Tabela"}
                    >
                      {isTable ? 'Ver em Texto' : 'Ver em Tabela'}
                    </button>

                    <button
                      onClick={() => toggleGroup(group.id)}
                      className="p-1 bg-stone-200 border border-black text-black hover:bg-stone-300 transition-colors cursor-pointer"
                    >
                      {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* Body: Render Table (if tabular) OR Official Text Publication Card (if running text) */}
                {isExpanded && (
                  <div>
                    {isTable ? (
                      /* Table Body - Exact PMRN Document Grid Layout with Dynamic Columns */
                      <div className="overflow-x-auto">
                        <table className="w-full text-center border-collapse text-black bg-white text-xs md:text-sm">
                          <thead>
                            <tr className="bg-stone-100 font-bold uppercase tracking-wider text-black border-b-2 border-black">
                              {group.columns.map((col, cIdx) => {
                                const alignClass = col.align === 'left' ? 'text-left' : col.align === 'right' ? 'text-right' : 'text-center';
                                return (
                                  <th 
                                    key={col.key} 
                                    className={`py-2.5 px-3 ${cIdx < group.columns.length - 1 ? 'border-r-2' : 'border-r-0'} border-black font-serif ${col.width || ''} ${alignClass}`}
                                  >
                                    {col.label}
                                  </th>
                                );
                              })}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-black">
                            {group.officers.map((officerEntry, idx) => (
                              <tr 
                                key={idx}
                                className="hover:bg-amber-50/40 transition-colors"
                              >
                                {group.columns.map((col, cIdx) => {
                                  const val = officerEntry.values[col.key] || (officerEntry as any)[col.key] || '-';
                                  const isLast = cIdx === group.columns.length - 1;
                                  const isName = col.key === 'name';
                                  const isParecerOrObs = col.key === 'parecer' || col.key === 'obs';
                                  const isMono = col.key === 'ord' || col.key === 'pmNumber' || col.key === 'registration' || col.key === 'points' || col.key === 'promoDate' || col.key === 'diarias' || col.key === 'valor' || col.key === 'quadro';
                                  const isBold = isName || col.key === 'ord' || col.key === 'rank' || col.key === 'points' || col.key === 'promoDate' || col.key === 'quadro';
                                  const alignClass = col.align === 'left' ? 'text-left' : col.align === 'right' ? 'text-right' : 'text-center';

                                  return (
                                    <td 
                                      key={col.key}
                                      className={`py-3 px-3 md:px-4 ${isLast ? 'border-r-0' : 'border-r-2'} border-black ${alignClass} text-xs md:text-sm ${
                                        isMono ? 'font-mono' : 'font-serif'
                                      } ${isBold ? 'font-bold' : ''} ${isName ? 'uppercase tracking-tight text-black' : ''} ${isParecerOrObs ? 'leading-relaxed text-stone-800' : ''}`}
                                    >
                                      {val}
                                    </td>
                                  );
                                })}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      /* Text Publication Body - Clean Narrative Layout for Decretos, Portarias, Despachos & Atos */
                      <div className="p-4 md:p-6 bg-white space-y-6">
                        {group.officers.map((officerEntry, idx) => (
                          <div 
                            key={idx}
                            className="bg-stone-50/70 border border-black/20 p-4 md:p-5 rounded-none space-y-4"
                          >
                            {/* Officer Header Card */}
                            <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-black/10">
                              <div className="flex items-center gap-3">
                                <span className="font-serif font-bold text-sm md:text-base text-black uppercase">
                                  {officerEntry.rank} {officerEntry.name}
                                </span>
                                {officerEntry.pmNumber !== '-' && (
                                  <span className="text-xs font-mono bg-white px-2 py-0.5 border border-black/20 text-stone-800">
                                    Nº {officerEntry.pmNumber}
                                  </span>
                                )}
                              </div>

                              <div className="flex items-center gap-2 text-xs font-serif">
                                <span className="font-mono bg-white px-2 py-0.5 border border-black/20 font-semibold text-stone-900">
                                  Matrícula: {officerEntry.registration}
                                </span>
                                <span className="bg-stone-200/80 px-2 py-0.5 border border-black/10 font-bold text-black">
                                  {officerEntry.ome}
                                </span>
                                <span className="bg-white px-2 py-0.5 border border-black/20 font-mono text-stone-700">
                                  Pág. {officerEntry.page}
                                </span>
                              </div>
                            </div>

                            {/* Official Document Transcript */}
                            <div>
                              <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-stone-500 block mb-1.5">
                                TRANSCRIÇÃO OFICIAL DA PUBLICAÇÃO:
                              </span>
                              <div className="bg-white border border-black/20 p-4 font-serif text-xs md:text-sm text-stone-900 leading-relaxed shadow-2xs">
                                <p className="whitespace-pre-line">
                                  {renderHighlightedSnippet(officerEntry.publicationSnippet || officerEntry.rawContext, officerEntry.officer)}
                                </p>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
