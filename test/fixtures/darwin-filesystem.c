/* Public SDK layout and actual held-directory observation, no mount effects. */
#include <sys/mount.h>
#include <sys/stat.h>
#include <stddef.h>
#include <fcntl.h>
#include <errno.h>
#include <stdio.h>
#include <unistd.h>

_Static_assert(sizeof(struct statfs) == 2168, "statfs64 size");
_Static_assert(offsetof(struct statfs, f_type) == 60, "statfs64 type offset");
_Static_assert(offsetof(struct statfs, f_flags) == 64, "statfs64 flags offset");
_Static_assert(offsetof(struct statfs, f_fstypename) == 72, "statfs64 name offset");
#ifdef MNT_EXT_FSKIT
_Static_assert(offsetof(struct statfs, f_flags_ext) == 2136, "statfs64 extended flags offset");
#endif

int main(int argc, char **argv) {
  if (argc != 2) return 64;
  int fd = open(argv[1], O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  if (fd < 0) { perror("open directory"); return 70; }
  struct statfs observed;
  int result = fstatfs(fd, &observed), saved = errno;
  if (close(fd)) { perror("close directory"); return 71; }
  if (result) { errno = saved; perror("fstatfs"); return 71; }
  int user_space = 0;
#ifdef MNT_EXT_FSKIT
  user_space = (observed.f_flags_ext & MNT_EXT_FSKIT) != 0;
#endif
  printf("{\"type\":%u,\"name\":\"%s\",\"local\":%s,\"readOnly\":%s,\"userSpace\":%s}\n", observed.f_type, observed.f_fstypename,
    (observed.f_flags & MNT_LOCAL) ? "true" : "false", (observed.f_flags & MNT_RDONLY) ? "true" : "false", user_space ? "true" : "false");
  return 0;
}
