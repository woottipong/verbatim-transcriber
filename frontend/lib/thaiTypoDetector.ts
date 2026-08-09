export interface TypoMatch {
  id: string;
  wrong: string;
  correct: string;
  startIndex: number;
  endIndex: number;
}

export interface ThaiTypoRule {
  wrong: string;
  correct: string;
}

export const COMMON_THAI_TYPOS: ThaiTypoRule[] = [
  { wrong: 'อนุญาติ', correct: 'อนุญาต' },
  { wrong: 'สัมนา', correct: 'สัมมนา' },
  { wrong: 'คำนวน', correct: 'คำนวณ' },
  { wrong: 'ผูกพันธ์', correct: 'ผูกพัน' },
  { wrong: 'กระทัดรัด', correct: 'กะทัดรัด' },
  { wrong: 'สังเกตุ', correct: 'สังเกต' },
  { wrong: 'เวทย์มนตร์', correct: 'เวทมนตร์' },
  { wrong: 'คลีนิก', correct: 'คลินิก' },
  { wrong: 'โลกาภิวัฒน์', correct: 'โลกาภิวัตน์' },
  { wrong: 'หน้าจะ', correct: 'น่าจะ' },
  { wrong: 'โอกาศ', correct: 'โอกาส' },
  { wrong: 'ปรากฎ', correct: 'ปรากฏ' },
  { wrong: 'กฏหมาย', correct: 'กฎหมาย' },
  { wrong: 'สังสรร', correct: 'สังสรรค์' },
  { wrong: 'ประสูตร', correct: 'ประสูติ' },
];

export function detectThaiTypos(
  text: string,
  customRules: ThaiTypoRule[] = [],
): TypoMatch[] {
  if (!text) return [];
  const rules = [...customRules, ...COMMON_THAI_TYPOS];
  const matches: TypoMatch[] = [];

  for (const rule of rules) {
    if (!rule.wrong || !rule.correct || rule.wrong === rule.correct) continue;
    let idx = text.indexOf(rule.wrong);
    while (idx !== -1) {
      matches.push({
        id: `${rule.wrong}-${idx}`,
        wrong: rule.wrong,
        correct: rule.correct,
        startIndex: idx,
        endIndex: idx + rule.wrong.length,
      });
      idx = text.indexOf(rule.wrong, idx + rule.wrong.length);
    }
  }

  // Deduplicate overlapping matches and sort by position
  const sorted = matches.sort((a, b) => a.startIndex - b.startIndex);
  const result: TypoMatch[] = [];
  let lastEnd = -1;

  for (const match of sorted) {
    if (match.startIndex >= lastEnd) {
      result.push(match);
      lastEnd = match.endIndex;
    }
  }

  return result;
}

export function replaceTypoInText(
  text: string,
  match: TypoMatch,
): string {
  if (!text) return '';
  const before = text.slice(0, match.startIndex);
  const after = text.slice(match.endIndex);
  return before + match.correct + after;
}
