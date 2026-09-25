export function decodeEntities(s: string): string;
export function htmlToParagraphs(html: string): string[];
export function plainTextToParagraphs(text: string): string[];
export function expectedTokens(display: string): { kind: "date"; alternatives: string[] } | { kind: "numbers"; numbers: string[] } | { kind: "words"; words: string[] };
export function findEvidence(paragraphs: string[], display: string): { locator: string; excerpt: string; checkedValue: string; matchKind: string } | null;
export function robotsAllows(robotsTxt: string, uaToken: string, path: string): boolean;
