// utils/voiceParser.ts

export interface ParsedItem {
  name: string;
  quantity: number;
}

export type VoiceAction = 'ADD' | 'REMOVE' | 'CLEAR' | 'FINALIZE' | 'NONE';

export interface VoiceAnalysisResult {
  action: VoiceAction;
  items: ParsedItem[];
  targetRemoveName?: string;
}

const NUMBER_WORDS: Record<string, number> = {
  one: 1, ek: 1,
  two: 2, do: 2,
  three: 3, teen: 3,
  four: 4, char: 4,
  five: 5, paanch: 5,
  six: 6, chhah: 6,
  seven: 7, saat: 7,
  eight: 8, aath: 8,
  nine: 9, nau: 9,
  ten: 10, das: 10,
};

export function analyzeVoiceStream(transcript: string): VoiceAnalysisResult {
  const clean = transcript.toLowerCase().trim();

  // 1. Detect Commands
  if (/finalize\s*bill|final\s*bill|finish\s*bill|complete\s*bill/i.test(clean)) {
    return { action: 'FINALIZE', items: [] };
  }

  if (/clear\s*bill|clear\s*all|reset\s*bill|empty\s*cart/i.test(clean)) {
    return { action: 'CLEAR', items: [] };
  }

  // Detect Remove command: "remove kitkat" or "delete dairymilk"
  const removeMatch = clean.match(/(?:remove|delete|drop)\s+([a-z\s]+)/i);
  if (removeMatch && removeMatch[1]) {
    return {
      action: 'REMOVE',
      items: [],
      targetRemoveName: removeMatch[1].trim(),
    };
  }

  // Detect Add command
  const hasAddTrigger = /ok\s*add\s*product|add\s*product|add\s*items/i.test(clean);
  let itemText = clean.replace(/ok\s*add\s*product|add\s*products?|add\s*items?/gi, '').trim();

  // 2. Extract Multi-Product Pairs
  const regex = /([a-z\s]+?)\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten|ek|do|teen|char|paanch|chhah|saat|aath|nau|das)(?=\s+[a-z]|$)/gi;
  const items: ParsedItem[] = [];
  let match: RegExpExecArray | null;

  while ((match = regex.exec(itemText)) !== null) {
    const rawName = match[1].replace(/^(and|then|also)\s+/i, '').trim();
    const rawQty = match[2].trim();

    if (!rawName || rawName.length < 2) continue;

    let qty = parseInt(rawQty, 10);
    if (isNaN(qty)) {
      qty = NUMBER_WORDS[rawQty.toLowerCase()] || 1;
    }

    const formattedName = rawName
      .split(' ')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');

    items.push({ name: formattedName, quantity: qty });
  }

  return {
    action: hasAddTrigger || items.length > 0 ? 'ADD' : 'NONE',
    items,
  };
}

export function speakText(text: string) {
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.0;
    utterance.lang = 'en-IN';
    window.speechSynthesis.speak(utterance);
  }
}
