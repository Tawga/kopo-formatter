# Change Log

All notable changes to the "kopo-formatter" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

### Fixed

- Out-of-line `PERFORM ... UNTIL x.` no longer swallows following statements into a phantom body and no longer gets a spurious `END-PERFORM` (which produced non-compiling output)
- Period-terminated `EVALUATE` (legacy style without `END-EVALUATE`) no longer gets a spurious `END-EVALUATE` inserted after the period
- Fixed-form continued string literals (`-` in col 7 resuming with a quote) are now spliced per punched-card semantics instead of being joined with a space, which corrupted the literal's value and quote pairing
- Identification area (cols 73-80) is now stripped when the file uses punched-card layout, instead of sequence numbers/tags being merged into statements; files containing lines longer than 80 columns are left untouched
- Line wrapping no longer picks a split point inside the leading indent (could recurse indefinitely on lines whose only spaces sit inside a long literal)
- The `kopo-formatter.formatDocument` command declared in package.json is now actually registered
- The formatting provider is registered for both `COBOL` and `cobol` language ids
- Formatting now returns a minimal edit for the changed region instead of replacing the whole document (keeps cursor position stable)
- Removed the invalid `contributes.formatters` block from package.json; README install instructions now point to `packages/` instead of `build/`

- Initial release