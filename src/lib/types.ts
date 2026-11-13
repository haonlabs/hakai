export type Verdict = 'keep' | 'usang' | 'duplikat';
export interface AuditItem { path: string; verdict: Verdict; reason: string; reviewed: string | null }
export interface Audit { generatedAt: string; vaultRoot: string; items: AuditItem[] }
export interface Backlink { path: string; name: string }
export interface NoteDetail { item: AuditItem; content: string; mtime: string; backlinks: Backlink[] }
export interface DeleteResult { deleted: string; indexLinesRemoved: number; brokenLinksIn: string[] }
