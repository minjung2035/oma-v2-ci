/* One metadata observation under the inherited directory inode. No target
 * open, content I/O, mutation, subprocess or pathname reconstruction. Only
 * this single-threaded helper changes cwd; the Node host never does. */
#if !defined(__APPLE__)
#error This helper requires the public Darwin xattr ABI
#endif
#include <sys/xattr.h>
#include <sys/attr.h>
#include <stdint.h>
#include <unistd.h>
#include <errno.h>
#include <stdio.h>
#include <string.h>

int main(int argc, char **argv) {
    if (argc != 2 || !argv[1][0] || strchr(argv[1], '/') ||
        !strcmp(argv[1], ".") || !strcmp(argv[1], "..")) return 125;
    if (fchdir(3) != 0) { perror("directory xattr fchdir"); return 1; }
    struct attrlist attributes = { .bitmapcount = ATTR_BIT_MAP_COUNT,
        .commonattr = ATTR_CMN_FLAGS | ATTR_CMN_EXTENDED_SECURITY };
    struct {
        uint32_t length;
        uint32_t flags;
        attrreference_t security;
    } observed = { 0 };
    if (getattrlist(argv[1], &attributes, &observed, sizeof(observed),
            FSOPT_NOFOLLOW | FSOPT_REPORT_FULLSIZE) != 0) {
        perror("directory metadata getattrlist"); return 1;
    }
    if (observed.length < sizeof(observed)) {
        fputs("directory metadata attributes are incomplete\n", stderr); return 1;
    }
    /* Only extended security has variable data in this request. The kernel's
     * full required size proves presence without copying/allocating the ACL.
     * lstatx_np loses an actually stored zero-entry NO_INHERIT ACL on APFS. */
    int acl_present = observed.length > sizeof(observed);
    ssize_t size = listxattr(argv[1], NULL, 0, XATTR_NOFOLLOW | XATTR_SHOWCOMPRESSION);
    if (size < 0) { perror("directory xattr listxattr"); return 1; }
    /* Native observations only: xattr-list bytes, complete BSD flags and ACL
     * presence (including an explicitly stored empty ACL). TS decides whether
     * these can be preserved. An exit code alone is never an observation. */
    if (printf("%lld %u %d\n", (long long)size, observed.flags, acl_present) < 0 ||
        fflush(stdout) != 0) return 125;
    return 0;
}
