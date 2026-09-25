/**
 * Append-only registry of archive claim IDs (research/claim-registry.json).
 *
 * Archive claim IDs are derived from a claim's position (e.g. `terms.2`), and published verifications,
 * term revisions and notes refer to them. Inserting a record in the middle of a list would silently
 * move an ID onto a different claim, so `verify:content` checks every registered ID against the
 * compiled archive:
 *  - a registered ID that disappeared, or whose label now describes a different claim → error
 *    (restore the order, or retire the ID deliberately with a reason);
 *  - a changed value at the same ID → warning, logged in the entry's revisions;
 *  - new IDs are registered with the archive version that first contained them.
 */
import type { CompiledArchive } from "../../shared/archive/compile";

export interface RegistryRevision {
  archiveVersion: string;
  label?: [string, string];
  display?: [string, string];
}

export interface RegistryEntry {
  subject: string;
  field: string;
  document: string;
  label: string;
  display: string;
  firstSeen: string;
  revisions?: RegistryRevision[];
}

export interface ClaimRegistry {
  format: "finance-claim-registry-v1";
  about: string;
  /** How the registry was first populated (kept verbatim). */
  seed?: string;
  claims: Record<string, RegistryEntry>;
  retired: Record<string, { reason: string; retiredIn: string; entry: RegistryEntry }>;
}

export const REGISTRY_ABOUT =
  "Append-only registry of archive claim IDs, maintained by `npm run verify:content`. A registered ID must keep describing the same claim: if one disappears or its label changes, verification fails until the archive order is restored or the ID is retired here with a reason. Value changes are logged under `revisions`. `firstSeen` is the archive version that first contained the claim.";

export interface RegistryResult {
  missing: Array<{ id: string; entry: RegistryEntry }>;
  relabelled: Array<{ id: string; from: string; to: string; subject: string; field: string }>;
  valueChanged: Array<{ id: string; from: string; to: string; subject: string }>;
  added: string[];
  /** Retired IDs that the archive produces again (they may now denote a different claim). */
  reused: string[];
  registered: number;
  retired: number;
  created: boolean;
  /** Registry to write back; null when the check failed (nothing is recorded until the problem is fixed). */
  next: ClaimRegistry | null;
}

export function checkClaimRegistry(current: ClaimRegistry | null, compiled: CompiledArchive, opts: { acceptRelabel?: boolean } = {}): RegistryResult {
  const reg: ClaimRegistry = current ? structuredClone(current) : { format: "finance-claim-registry-v1", about: REGISTRY_ABOUT, claims: {}, retired: {} };
  reg.about = REGISTRY_ABOUT;
  const missing: RegistryResult["missing"] = [];
  const relabelled: RegistryResult["relabelled"] = [];
  const valueChanged: RegistryResult["valueChanged"] = [];
  const added: string[] = [];
  const reused = Object.keys(reg.retired).filter((id) => compiled.claims[id]);
  for (const [id, entry] of Object.entries(reg.claims)) {
    if (reg.retired[id]) continue;
    const c = compiled.claims[id];
    if (!c) {
      missing.push({ id, entry });
      continue;
    }
    const subject = `${c.subject.type}:${c.subject.id}`;
    if (subject !== entry.subject || c.field !== entry.field || c.label !== entry.label) {
      relabelled.push({ id, from: `${entry.subject} ${entry.field} “${entry.label}”`, to: `${subject} ${c.field} “${c.label}”`, subject, field: c.field });
      if (opts.acceptRelabel) {
        entry.revisions = [...(entry.revisions ?? []), { archiveVersion: compiled.version, label: [entry.label, c.label] }];
        entry.label = c.label;
        entry.subject = subject;
        entry.field = c.field;
      }
    }
    if (c.display !== entry.display) {
      valueChanged.push({ id, from: entry.display, to: c.display, subject });
      entry.revisions = [...(entry.revisions ?? []), { archiveVersion: compiled.version, display: [entry.display, c.display] }];
      entry.display = c.display;
    }
    if (c.documentId !== entry.document) entry.document = c.documentId;
  }
  for (const [id, c] of Object.entries(compiled.claims)) {
    if (reg.claims[id] || reg.retired[id]) continue;
    reg.claims[id] = { subject: `${c.subject.type}:${c.subject.id}`, field: c.field, document: c.documentId, label: c.label, display: c.display, firstSeen: compiled.version };
    added.push(id);
  }
  const failed = missing.length > 0 || (relabelled.length > 0 && !opts.acceptRelabel);
  // Keep the file stable and diff-friendly: IDs sorted.
  const sorted: ClaimRegistry = { format: reg.format, about: reg.about, ...(reg.seed ? { seed: reg.seed } : {}), claims: Object.fromEntries(Object.entries(reg.claims).sort(([a], [b]) => a.localeCompare(b))), retired: Object.fromEntries(Object.entries(reg.retired).sort(([a], [b]) => a.localeCompare(b))) };
  return { missing, relabelled, valueChanged, added, reused, registered: Object.keys(sorted.claims).length, retired: Object.keys(sorted.retired).length, created: !current, next: failed ? null : sorted };
}
