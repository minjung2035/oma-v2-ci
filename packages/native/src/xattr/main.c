/* One metadata observation under the inherited directory inode. No target
 * open, content I/O, mutation, subprocess or pathname reconstruction. Only
 * this single-threaded helper changes cwd; the Node host never does. */
#if !defined(__APPLE__)
#error This helper requires the public Darwin xattr ABI
#endif
#include <sys/xattr.h>
#include <unistd.h>
#include <errno.h>
#include <stdio.h>
#include <string.h>

int main(int argc, char **argv) {
    if (argc != 2 || !argv[1][0] || strchr(argv[1], '/') ||
        !strcmp(argv[1], ".") || !strcmp(argv[1], "..")) return 125;
    if (fchdir(3) != 0) { perror("directory xattr fchdir"); return 1; }
    ssize_t size = listxattr(argv[1], NULL, 0, XATTR_NOFOLLOW | XATTR_SHOWCOMPRESSION);
    if (size < 0) { perror("directory xattr listxattr"); return 1; }
    /* A successful observation is exactly one canonical nonnegative decimal
     * ssize_t and LF. An exit code alone is never an empty observation. */
    if (printf("%lld\n", (long long)size) < 0 || fflush(stdout) != 0) return 125;
    return 0;
}
