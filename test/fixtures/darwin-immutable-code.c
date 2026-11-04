/* Mechanical user-immutable inode candidate, not an installed generation. */
#include <sys/stat.h>
#include <unistd.h>
#include <fcntl.h>
#include <errno.h>
#include <stdio.h>
#include <string.h>
#include <stdlib.h>
static void checked(int valid, const char *operation) {
  if (!valid) { perror(operation); exit(70); }
}
int main(int argc, char **argv) {
  checked(getuid() > 0, "ordinary UID");
  if (argc == 4 && (!strcmp(argv[1], "--seal") || !strcmp(argv[1], "--unseal"))) {
    for (int i = 2; i < 4; ++i) {
      struct stat s; checked(lstat(argv[i], &s) == 0 && (S_ISDIR(s.st_mode) || S_ISREG(s.st_mode)) && s.st_uid == getuid(), "owned entry");
      unsigned int flags = !strcmp(argv[1], "--seal") ? s.st_flags | UF_IMMUTABLE : s.st_flags & ~UF_IMMUTABLE;
      checked(chflags(argv[i], flags) == 0, "owned immutable flag");
    }
    return 0;
  }
  checked(argc == 5, "actor source and writable controls");
  struct stat before, after; checked(fstat(7, &before) == 0 && S_ISREG(before.st_mode), "inherited regular capability");
  char bytes[64] = {0}; ssize_t count = pread(7, bytes, sizeof bytes, 0);
  checked(count == 23 && !memcmp(bytes, "immutable fixture bytes", 23), "actual inherited read");
  errno = 0; int writable = open(argv[1], O_RDWR | O_NOFOLLOW); int write_error = errno;
  if (writable >= 0) checked(close(writable) == 0, "unexpected writable return");
  errno = 0; int unsealed = fchflags(7, before.st_flags & ~UF_IMMUTABLE); int unseal_error = errno;
  int directory = open(argv[4], O_RDONLY | O_DIRECTORY | O_NOFOLLOW); struct stat dir_before, dir_after;
  checked(directory >= 0 && fstat(directory, &dir_before) == 0, "actual readable generation directory");
  errno = 0; int dir_unsealed = fchflags(directory, dir_before.st_flags & ~UF_IMMUTABLE); int dir_unseal_error = errno;
  checked(fstat(directory, &dir_after) == 0 && close(directory) == 0, "retained directory flags");
  errno = 0; int linked = link(argv[1], argv[2]); int link_error = errno;
  checked(fstat(7, &after) == 0, "retained flags");
  int control = open(argv[3], O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0600);
  checked(control >= 0 && write(control, "ordinary child", 14) == 14 && close(control) == 0, "ordinary writable control");
  printf("{\"uid\":%u,\"pid\":%d,\"beforeFlags\":%u,\"afterFlags\":%u,\"writeStatus\":%ld,\"writeErrno\":%d,\"unsealStatus\":%d,\"unsealErrno\":%d,\"directoryBeforeFlags\":%u,\"directoryAfterFlags\":%u,\"directoryUnsealStatus\":%d,\"directoryUnsealErrno\":%d,\"linkStatus\":%d,\"linkErrno\":%d,\"readBytes\":%ld,\"controlWritten\":true}\n",
    getuid(), getpid(), before.st_flags, after.st_flags, (long)writable, write_error, unsealed, unseal_error,
    dir_before.st_flags, dir_after.st_flags, dir_unsealed, dir_unseal_error, linked, link_error, (long)count);
  return 0;
}
