# Mutashabihat (similar-verse) source data

`source_waqar144.json` is the mutashabihat dataset from
**Waqar144/Quran_Mutashabihat_Data**:

- Repository: https://github.com/Waqar144/Quran_Mutashabihat_Data
- License: **CC0 1.0 Universal** (public-domain dedication)
- Content: 1,344 curated entries, based on the work of Qari Idrees Al Asim
  (late) and the maintainer's own experience. It intentionally lists the pairs
  that most often confuse huffaz rather than every textual similarity.

`config/build_mutashabihat.php` converts this file into the app-facing lookup
`web/data/mutashabihat.json`, keyed by `surah:ayah` and enriched with a
computed wording-similarity fallback for verses the curated list does not
cover.

The data is used locally by the mistake log to suggest a twin verse when the
memorizer tags a متشابهات mistake. Attribution is kept here (and in the
generated file's `_meta`) as a courtesy, even though CC0 does not require it.
