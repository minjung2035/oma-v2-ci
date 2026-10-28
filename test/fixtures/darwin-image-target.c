/** Controlled constructor/main markers for the suspended-image experiment. */
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>

#ifndef PROBE_VARIANT
#error PROBE_VARIANT is required
#endif

static void record(const char *name) {
    const char *directory = getenv("PROBE_MARKER_DIRECTORY");
    char path[PATH_MAX], bytes[96];
    if (directory == NULL) _exit(125);
    const int path_size = snprintf(path, sizeof(path), "%s/%s.json", directory, name);
    const int size = snprintf(bytes, sizeof(bytes), "{\"variant\":%d,\"pid\":%d}\n", PROBE_VARIANT, (int)getpid());
    if (path_size < 0 || (size_t)path_size >= sizeof(path) || size < 0 || (size_t)size >= sizeof(bytes)) _exit(125);
    const int fd = open(path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0600);
    if (fd < 0) _exit(125);
    size_t offset = 0;
    while (offset < (size_t)size) {
        const ssize_t written = write(fd, bytes + offset, (size_t)size - offset);
        if (written < 0 && errno == EINTR) continue;
        if (written <= 0) _exit(125);
        offset += (size_t)written;
    }
    if (close(fd) != 0) _exit(125);
}

__attribute__((constructor)) static void before_main(void) { record("constructor"); }
int main(void) { record("main"); return 0; }
