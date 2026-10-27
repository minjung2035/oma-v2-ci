/* One metadata observation under the inherited directory inode. No target
 * open, content I/O, mutation, subprocess or pathname reconstruction. Only
 * this single-threaded helper changes cwd; the Node host never does. */
#if !defined(__APPLE__)
#error This helper requires the public Darwin xattr ABI
#endif
#include <sys/xattr.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <unistd.h>
#include <errno.h>
#include <stdio.h>
#include <string.h>

int main(int argc, char **argv) {
    if (argc != 2 || !argv[1][0] || strchr(argv[1], '/') ||
        !strcmp(argv[1], ".") || !strcmp(argv[1], "..")) return 125;
    if (fchdir(3) != 0) { perror("directory xattr fchdir"); return 1; }
    filesec_t security = filesec_init();
    if (security == NULL) { perror("directory metadata filesec_init"); return 1; }
    struct stat observed;
    int acl_present = 0;
    int status = lstatx_np(argv[1], &observed, security);
    if (status == 0) status = filesec_query_property(security, FILESEC_ACL, &acl_present);
    int saved_errno = errno;
    filesec_free(security);
    if (status != 0) { errno = saved_errno; perror("directory metadata security"); return 1; }
    ssize_t size = listxattr(argv[1], NULL, 0, XATTR_NOFOLLOW | XATTR_SHOWCOMPRESSION);
    if (size < 0) { perror("directory xattr listxattr"); return 1; }
    /* Native observations only: xattr-list bytes, complete BSD flags and ACL
     * presence (including an explicitly stored empty ACL). TS decides whether
     * these can be preserved. An exit code alone is never an observation. */
    if (printf("%lld %u %d\n", (long long)size, observed.st_flags, acl_present ? 1 : 0) < 0 ||
        fflush(stdout) != 0) return 125;
    return 0;
}
