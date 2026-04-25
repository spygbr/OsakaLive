/**
 * slugify-japanese-artists.ts
 *
 * Finds artists whose slug is the auto-generated `artist-XXXXXXXX` form,
 * romanises their Japanese name (Hepburn) and updates the slug.
 *
 * Uses kuromoji (morphological analyser) + wanakana (kana → romaji) directly,
 * skipping the kuroshiro wrapper — fewer deps, easier to debug.
 *
 * Usage (from project root):
 *   npx tsx scripts/slugify-japanese-artists.ts            # dry run
 *   npx tsx scripts/slugify-japanese-artists.ts --execute  # apply
 *
 * Required env:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
// @ts-expect-error – kuromoji ships no types
import kuromoji from "kuromoji";
import * as wanakana from "wanakana";

// ── Load .env.local (matches the convention used by other scripts) ────────────

const envPath = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([^#=\s][^=]*)=(.*)$/);
    if (m) {
      const key = m[1].trim();
      const val = m[2].trim().replace(/^["']|["']$/g, "");
      if (!process.env[key]) process.env[key] = val;
    }
  }
}

// ── Config ────────────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DRY_RUN = !process.argv.includes("--execute");
const HEX_SLUG_RE = /^artist-[0-9a-f]{8}$/;
const DICT_PATH = path.join(
  process.cwd(),
  "node_modules",
  "kuromoji",
  "dict",
);

// ── Types ─────────────────────────────────────────────────────────────────────

interface KuromojiToken {
  surface_form: string;
  reading?: string; // katakana, may be "*" or undefined for non-Japanese tokens
}

interface Tokenizer {
  tokenize(text: string): KuromojiToken[];
}

interface Artist {
  id: string;
  slug: string;
  name_en: string | null;
  name_ja: string | null;
}

// ── Romanisation ──────────────────────────────────────────────────────────────

function buildTokenizer(): Promise<Tokenizer> {
  return new Promise((resolve, reject) => {
    kuromoji
      .builder({ dicPath: DICT_PATH })
      .build((err: Error | null, tokenizer: Tokenizer) => {
        if (err) reject(err);
        else resolve(tokenizer);
      });
  });
}

/**
 * Convert a Japanese string to Hepburn romaji.
 *
 * Strategy: tokenise with kuromoji, replace each kanji token with its katakana
 * reading, then run the whole string through wanakana for the kana → romaji
 * step (handles small-tsu, long vowels, etc. correctly).
 */
function toRomaji(tokenizer: Tokenizer, text: string): string {
  const kanaForm = tokenizer
    .tokenize(text)
    .map((t) => {
      const reading = t.reading && t.reading !== "*" ? t.reading : t.surface_form;
      return reading;
    })
    .join("");

  return wanakana.toRomaji(kanaForm);
}

// ── Slug shaping ──────────────────────────────────────────────────────────────

/**
 * Hepburn often emits macron vowels (ā ī ū ē ō). Strip them to plain ASCII —
 * URL slugs should stay in [a-z0-9-]. Covers both lowercase (which wanakana
 * outputs) and uppercase forms defensively.
 */
function stripMacrons(s: string): string {
  return s
    .replace(/[āĀ]/g, "a")
    .replace(/[īĪ]/g, "i")
    .replace(/[ūŪ]/g, "u")
    .replace(/[ēĒ]/g, "e")
    .replace(/[ōŌ]/g, "o");
}

function slugify(romaji: string): string {
  return stripMacrons(romaji.toLowerCase())
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** foo → foo, foo (taken) → foo-2, foo-2 (taken) → foo-3, … */
function resolveConflict(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error(
      "Missing env: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.",
    );
    process.exit(1);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  // 1. Fetch artists with hex slugs
  const { data: candidates, error: fetchErr } = await supabase
    .from("artists")
    .select("id, slug, name_en, name_ja")
    .like("slug", "artist-%");

  if (fetchErr) throw fetchErr;

  const targets = ((candidates ?? []) as Artist[]).filter((a) =>
    HEX_SLUG_RE.test(a.slug),
  );
  if (targets.length === 0) {
    console.log("✓ No artists with hex slugs found — nothing to do.");
    return;
  }
  console.log(`Found ${targets.length} artist(s) with hex slugs.\n`);

  // 2. Pull all current slugs for conflict checking
  const { data: allRows, error: slugErr } = await supabase
    .from("artists")
    .select("slug");
  if (slugErr) throw slugErr;
  const taken = new Set<string>((allRows ?? []).map((r) => r.slug));

  // 3. Boot the tokenizer (one-time, ~1s)
  const tokenizer = await buildTokenizer();

  // 4. Compute new slugs
  console.log(DRY_RUN ? "── DRY RUN (pass --execute to apply) ──\n" : "── EXECUTING ──\n");

  type Update = { id: string; oldSlug: string; newSlug: string; name: string };
  const updates: Update[] = [];
  const skipped: Array<{ slug: string; name: string; reason: string }> = [];

  for (const a of targets) {
    const name = a.name_ja ?? a.name_en ?? "";
    if (!name.trim()) {
      skipped.push({ slug: a.slug, name: "(empty)", reason: "no name" });
      continue;
    }

    let base: string;
    try {
      base = slugify(toRomaji(tokenizer, name));
    } catch (e) {
      skipped.push({ slug: a.slug, name, reason: `romaji error: ${(e as Error).message}` });
      continue;
    }

    if (!base) {
      skipped.push({ slug: a.slug, name, reason: "empty slug after normalization" });
      continue;
    }

    // Don't conflict with the artist's own current slug
    taken.delete(a.slug);
    const newSlug = resolveConflict(base, taken);
    taken.add(newSlug);

    updates.push({ id: a.id, oldSlug: a.slug, newSlug, name });
  }

  // 5. Print plan
  printTable(updates);
  if (skipped.length) {
    console.log(`\n⚠ Skipped ${skipped.length}:`);
    for (const s of skipped) console.log(`    ${s.slug}  ${s.name}  — ${s.reason}`);
  }

  // 6. Apply
  if (DRY_RUN) {
    console.log(`\n${updates.length} slug(s) would be updated. Re-run with --execute to apply.`);
    return;
  }

  console.log(`\nApplying ${updates.length} update(s)...`);
  let ok = 0;
  let fail = 0;
  for (const u of updates) {
    const { error } = await supabase.from("artists").update({ slug: u.newSlug }).eq("id", u.id);
    if (error) {
      console.error(`  ✗ ${u.oldSlug} → ${u.newSlug}: ${error.message}`);
      fail++;
    } else {
      ok++;
    }
  }
  console.log(`\nDone. ${ok} updated, ${fail} failed.`);
}

function printTable(rows: Array<{ oldSlug: string; name: string; newSlug: string }>) {
  if (rows.length === 0) return;
  const w1 = Math.max(8, ...rows.map((r) => r.oldSlug.length));
  const w2 = Math.max(4, ...rows.map((r) => r.name.length));
  const pad = (s: string, n: number) => s + " ".repeat(Math.max(0, n - s.length));
  console.log(`  ${pad("Old slug", w1)}  ${pad("Name", w2)}  New slug`);
  console.log(`  ${"─".repeat(w1)}  ${"─".repeat(w2)}  ${"─".repeat(20)}`);
  for (const r of rows) {
    console.log(`  ${pad(r.oldSlug, w1)}  ${pad(r.name, w2)}  ${r.newSlug}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
