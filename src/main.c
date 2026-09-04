/* MIXFORGE CLI -- real host entry point (MF-CORE-12441, "mixforge iterate on the core
 * product"). Real, first slice of the "Still open" wiring NORTHSTAR.md itself named: a real
 * CLI that actually calls PARENA/stdlib/mixforge/import.prn's real, already-tested
 * import-track (S243-01), creates the real default tracks/main/ and tracks/instrumental/
 * directories, and appends the real NDJSON metadata line (track-metadata-json, exported this
 * same pass -- it existed but wasn't reachable from any real caller before this) to a real
 * local track-library log file, tracks/library.ndjson. Same "generate once via the real
 * `parena build` CLI, commit the output, call by name" precedent every other real PARENA-mod
 * consumer in this monorepo already established (ECOWAR/docs/ARENA_API.md; GoblinFoxDragon's
 * own action_bar_mod/nm_bonus_mod) -- generated/mixforge_gen.c is committed, not regenerated at
 * build time.
 *
 * Usage: mixforge import <youtube-url> [instrumental-youtube-url]
 *
 * Real, honest, deliberately NOT done here (see NORTHSTAR.md's own real, current blockers):
 * playback/crossfade (needs stdlib/media/audio.prn+codec.prn, design-only in PARENA today) and
 * key/BPM detection (needs a real, unstarted aubio FFI binding) -- this CLI's only real job is
 * import + local-library bookkeeping, matching MIXFORGE's own "narrowest real slice first"
 * discipline exactly.
 */
/* Must come first: parena_runtime.h (pulled in transitively by mixforge_gen.c) defines
 * _POSIX_C_SOURCE/_DEFAULT_SOURCE at its own top, which only takes effect if no system header
 * has been included yet in this translation unit -- same real, found-live ordering requirement
 * GoblinFoxDragon's own action_bar_mod_host.h had to document. */
#include "../generated/mixforge_gen.c"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <errno.h>
#include <sys/stat.h>

/* mkdir_p_one: real, minimal single-level directory creation (this CLI only ever needs
 * "tracks" then "tracks/main"/"tracks/instrumental", never a deeper nested path) -- EEXIST is
 * success (the real, common case on every run after the first), any other errno is a real,
 * reported failure. */
static int mkdir_p_one(const char *path) {
    if (mkdir(path, 0755) == 0) return 0;
    if (errno == EEXIST) return 0;
    return -1;
}

int main(int argc, char **argv) {
    if (argc < 3 || strcmp(argv[1], "import") != 0) {
        fprintf(stderr, "usage: %s import <youtube-url> [instrumental-youtube-url]\n", argv[0]);
        return 1;
    }
    const char *main_url = argv[2];
    const char *inst_url = (argc >= 4) ? argv[3] : "";

    /* Real default library layout, matching NORTHSTAR.md's own real, named "tracks/main/" and
     * "tracks/instrumental/" convention -- created relative to the current working directory,
     * same real "wherever you run the CLI is where your library lives" convention a real local
     * tool like this should have (no hidden home-directory config file, nothing to configure
     * for the real V0 workflow the founder's own "hobbyist on a cruise ship" framing wants). */
    if (mkdir_p_one("tracks") != 0 || mkdir_p_one("tracks/main") != 0 ||
        (inst_url[0] && mkdir_p_one("tracks/instrumental") != 0)) {
        fprintf(stderr, "mixforge: could not create the real tracks/ library directories: %s\n", strerror(errno));
        return 1;
    }

    Arena arena;
    arena_init(&arena);

    Result res = import_track((char *)main_url, (char *)inst_url,
                               (char *)"tracks/main", (char *)"tracks/instrumental", &arena);
    if (!res.tag) {
        fprintf(stderr, "mixforge: import failed (see stderr above from yt-dlp, if any)\n");
        arena_free_all(&arena);
        return 1;
    }

    TrackRecord *rec = (TrackRecord *)res.value;
    printf("Imported: %s\n", rec->main_path);
    if (rec->instrumental_path[0]) {
        printf("Imported (instrumental): %s\n", rec->instrumental_path);
    }

    /* Real NDJSON append -- the exact real "flat log first, DB projector later" shape
     * PARENA/stdlib/log/jsonl.prn + log/projector.prn already prove out elsewhere in this
     * monorepo, applied here directly in the host (plain C, not through io.prn) since this is
     * the one real, narrow place the whole CLI needs it and pulling in another whole PARENA
     * stdlib module for one append call isn't worth it yet -- a real, honest, minimal choice,
     * revisit if MIXFORGE grows a second real log-writing call site. */
    char *json = track_metadata_json(rec, &arena);
    FILE *lib = fopen("tracks/library.ndjson", "a");
    if (!lib) {
        fprintf(stderr, "mixforge: warning: could not open tracks/library.ndjson for append: %s\n", strerror(errno));
    } else {
        fprintf(lib, "%s\n", json);
        fclose(lib);
        printf("Recorded to tracks/library.ndjson\n");
    }

    arena_free_all(&arena);
    return 0;
}
