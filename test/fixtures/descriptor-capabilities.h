/* Real descriptor observations shared by the Darwin probe and the portable
 * oracle controls. This is test code, not an execution or authority backend.
 * The including translation unit supplies the POSIX headers and require(). */
#if defined(__APPLE__) && __has_include(<sys/fileport.h>)
#include <sys/fileport.h>
#include <mach/mach.h>
#define OMA_PROBE_FILEPORT 1
#else
#define OMA_PROBE_FILEPORT 0
#endif

static void descriptor_write_all(int fd, const void *data, size_t size) {
  const char *bytes = data;
  while (size != 0) {
    ssize_t written = write(fd, bytes, size);
    if (written < 0 && errno == EINTR) continue;
    require(written > 0, "descriptor oracle write");
    bytes += written; size -= (size_t)written;
  }
}

/* A successful exec must reach this independently recognizable code. A zero
 * exit alone cannot distinguish our image from the replacement executable. */
static int descriptor_exec_target(int argc, char **argv) {
  if (argc != 3 || strcmp(argv[1], "--oma-fd-exec-child") != 0) return 0;
  require(strcmp(argv[2], "3") == 0, "descriptor oracle reply slot");
  descriptor_write_all(3, "ORIGINAL\n", 9);
  _exit(0);
}

struct descriptor_exec_result {
  int exec_error, exit_code, signal;
  char reply[64];
};
static struct descriptor_exec_result descriptor_try_exec(const char *path, int held) {
  int channel[2]; require(pipe(channel) == 0, "descriptor exec reply pipe");
  pid_t child = fork(); require(child >= 0, "descriptor exec fork");
  if (child == 0) {
    close(channel[0]);
    if (channel[1] != 3) { require(dup2(channel[1], 3) == 3, "descriptor reply dup"); close(channel[1]); }
    require(fcntl(3, F_SETFD, 0) == 0 && fcntl(held, F_SETFD, 0) == 0, "descriptor exec inheritance");
    char *const args[] = { (char *)path, "--oma-fd-exec-child", "3", NULL };
    char *const environment[] = { NULL };
    execve(path, args, environment);
    int error = errno;
    char answer[32]; int size = snprintf(answer, sizeof answer, "E%d\n", error);
    if (size > 0 && (size_t)size < sizeof answer) descriptor_write_all(3, answer, (size_t)size);
    _exit(125);
  }
  close(channel[1]);
  struct descriptor_exec_result result = { .exec_error = 0, .exit_code = -1, .signal = 0, .reply = {0} };
  size_t count = 0;
  for (;;) {
    char bytes[64]; ssize_t n = read(channel[0], bytes, sizeof bytes);
    if (n < 0 && errno == EINTR) continue;
    require(n >= 0, "descriptor exec reply read");
    if (n == 0) break;
    require(count + (size_t)n < sizeof result.reply, "descriptor exec reply length");
    memcpy(result.reply + count, bytes, (size_t)n); count += (size_t)n;
  }
  close(channel[0]); int status;
  pid_t reaped; do { reaped = waitpid(child, &status, 0); } while (reaped < 0 && errno == EINTR);
  require(reaped == child, "descriptor exec reap");
  if (WIFEXITED(status)) result.exit_code = WEXITSTATUS(status);
  if (WIFSIGNALED(status)) result.signal = WTERMSIG(status);
  if (result.reply[0] == 'E') {
    char *end; long value = strtol(result.reply + 1, &end, 10);
    require(value > 0 && value <= 2147483647 && strcmp(end, "\n") == 0, "descriptor exec errno reply");
    result.exec_error = (int)value;
  }
  return result;
}
static void descriptor_print_exec(struct descriptor_exec_result result) {
  const char *reply = strcmp(result.reply, "ORIGINAL\n") == 0 ? "original" :
    strcmp(result.reply, "REPLACEMENT\n") == 0 ? "replacement" : result.reply[0] == 0 ? "none" :
    result.exec_error != 0 ? "exec-error" : "unknown";
  printf("{\"execErrno\":");
  if (result.exec_error != 0) printf("%d", result.exec_error); else printf("null");
  printf(",\"exitCode\":");
  if (result.exit_code >= 0) printf("%d", result.exit_code); else printf("null");
  printf(",\"signal\":");
  if (result.signal != 0) printf("%d", result.signal); else printf("null");
  printf(",\"reply\":\"%s\"}", reply);
}

struct descriptor_duplicate_result {
  int attempted, returned, error, same_inode, close_on_exec, access_mode;
  off_t source_before, source_after, duplicate_before, duplicate_after;
};
static struct descriptor_duplicate_result descriptor_read_duplicate(int source, int duplicate, int error,
    struct stat expected) {
  struct descriptor_duplicate_result result = { .attempted = 1, .returned = duplicate, .error = error };
  if (duplicate < 0) return result;
  struct stat actual; require(fstat(duplicate, &actual) == 0, "duplicate fstat");
  result.same_inode = actual.st_dev == expected.st_dev && actual.st_ino == expected.st_ino;
  int descriptor_flags = fcntl(duplicate, F_GETFD), access_flags = fcntl(duplicate, F_GETFL);
  require(descriptor_flags >= 0 && access_flags >= 0, "duplicate flags");
  result.close_on_exec = (descriptor_flags & FD_CLOEXEC) != 0;
  result.access_mode = access_flags & O_ACCMODE;
  result.source_before = lseek(source, 0, SEEK_CUR);
  result.duplicate_before = lseek(duplicate, 0, SEEK_CUR);
  char byte; ssize_t count; do { count = read(duplicate, &byte, 1); } while (count < 0 && errno == EINTR);
  require(count == 1, "duplicate single byte read");
  result.source_after = lseek(source, 0, SEEK_CUR);
  result.duplicate_after = lseek(duplicate, 0, SEEK_CUR);
  require(result.source_before >= 0 && result.duplicate_before >= 0 &&
    result.source_after >= 0 && result.duplicate_after >= 0, "duplicate seek observations");
  require(close(duplicate) == 0, "duplicate close");
  return result;
}
static void descriptor_print_duplicate(struct descriptor_duplicate_result result) {
  printf("{\"attempted\":%s,\"openReturn\":", result.attempted ? "true" : "false");
  if (result.attempted) printf("%d", result.returned); else printf("null");
  printf(",\"openErrno\":");
  if (result.attempted) printf("%d", result.error); else printf("null");
  if (result.attempted && result.returned >= 0)
    printf(",\"sameInode\":%s,\"closeOnExec\":%s,\"accessMode\":%d,\"sourceBefore\":%lld,\"sourceAfter\":%lld,\"duplicateBefore\":%lld,\"duplicateAfter\":%lld}",
      result.same_inode ? "true" : "false", result.close_on_exec ? "true" : "false", result.access_mode,
      (long long)result.source_before, (long long)result.source_after,
      (long long)result.duplicate_before, (long long)result.duplicate_after);
  else printf(",\"sameInode\":null,\"closeOnExec\":null,\"accessMode\":null,\"sourceBefore\":null,\"sourceAfter\":null,\"duplicateBefore\":null,\"duplicateAfter\":null}");
}

static void descriptor_copy_executable(const char *self, int directory) {
  int source = open(self, O_RDONLY | O_CLOEXEC); require(source >= 0, "descriptor executable source");
  int target = openat(directory, "tool", O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0700);
  require(target >= 0, "descriptor executable create");
  for (;;) {
    char bytes[65536]; ssize_t count = read(source, bytes, sizeof bytes);
    if (count < 0 && errno == EINTR) continue;
    require(count >= 0, "descriptor executable copy"); if (count == 0) break;
    descriptor_write_all(target, bytes, (size_t)count);
  }
  require(fsync(target) == 0 && close(target) == 0 && close(source) == 0, "descriptor executable flush");
}

static void descriptor_capabilities_probe(const char *self) {
  require(mkdir("fd-capabilities", 0700) == 0, "descriptor directory");
  int directory = open("fd-capabilities", O_RDONLY | O_DIRECTORY | O_CLOEXEC);
  require(directory >= 0, "descriptor directory open");
  descriptor_copy_executable(self, directory);
  int original = openat(directory, "tool", O_RDONLY | O_NOFOLLOW | O_CLOEXEC);
  require(original >= 0, "descriptor original open");
  /* Slot3 is the independent exec-reply channel; retain the image above it. */
  int held = fcntl(original, F_DUPFD_CLOEXEC, 10);
  require(held >= 10 && close(original) == 0, "descriptor retained image");
  struct stat expected; require(fstat(held, &expected) == 0 && S_ISREG(expected.st_mode), "descriptor retained stat");
  require(lseek(held, 2, SEEK_SET) == 2, "descriptor initial position");
  char alias[64]; int length = snprintf(alias, sizeof alias, "/dev/fd/%d", held);
  require(length > 0 && (size_t)length < sizeof alias, "descriptor alias size");
  errno = 0; int duplicate = open(alias, O_RDONLY | O_CLOEXEC); int open_error = errno;
  struct descriptor_duplicate_result devfd = descriptor_read_duplicate(held, duplicate, open_error, expected);
  int fileport_return = 0, fileport_error = 0;
  struct descriptor_duplicate_result fileport = {0};
#if OMA_PROBE_FILEPORT
  fileport_t port = MACH_PORT_NULL;
  errno = 0; fileport_return = fileport_makeport(held, &port); fileport_error = errno;
  if (fileport_return == 0) {
    errno = 0; duplicate = fileport_makefd(port); open_error = errno;
    fileport = descriptor_read_duplicate(held, duplicate, open_error, expected);
    require(mach_port_deallocate(mach_task_self(), port) == KERN_SUCCESS, "descriptor fileport release");
  }
#else
  (void)fileport_return; (void)fileport_error;
#endif
  struct descriptor_exec_result direct = descriptor_try_exec("fd-capabilities/tool", held);
  require(direct.exec_error == 0 && direct.exit_code == 0 && direct.signal == 0 &&
    strcmp(direct.reply, "ORIGINAL\n") == 0, "descriptor direct exec positive control");
  struct descriptor_exec_result before_swap = descriptor_try_exec(alias, held);
  require(renameat(directory, "tool", directory, "original") == 0, "descriptor namespace swap");
  int replacement = openat(directory, "tool", O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0700);
  require(replacement >= 0, "descriptor replacement create");
  const char script[] = "#!/bin/sh\nprintf 'REPLACEMENT\\n' >&3\n";
  descriptor_write_all(replacement, script, sizeof script - 1);
  require(fsync(replacement) == 0 && close(replacement) == 0, "descriptor replacement flush");
  struct stat named, retained;
  require(fstatat(directory, "tool", &named, AT_SYMLINK_NOFOLLOW) == 0 && fstat(held, &retained) == 0, "descriptor namespace stat");
  int held_after_swap = retained.st_dev == expected.st_dev && retained.st_ino == expected.st_ino;
  int named_is_replacement = named.st_dev != expected.st_dev || named.st_ino != expected.st_ino;
  struct descriptor_exec_result swapped = descriptor_try_exec("fd-capabilities/tool", held);
  require(swapped.exec_error == 0 && swapped.exit_code == 0 && strcmp(swapped.reply, "REPLACEMENT\n") == 0,
    "descriptor pathname replacement negative control");
  struct descriptor_exec_result after_swap = descriptor_try_exec(alias, held);
  require(unlinkat(directory, "original", 0) == 0 && fstat(held, &retained) == 0, "descriptor original unlink");
  int held_after_unlink = retained.st_dev == expected.st_dev && retained.st_ino == expected.st_ino;
  struct descriptor_exec_result after_unlink = descriptor_try_exec(alias, held);
  require(close(held) == 0 && close(directory) == 0, "descriptor fixture close");
#if defined(__APPLE__)
  const char *platform = "darwin";
#elif defined(__linux__)
  const char *platform = "linux";
#else
  const char *platform = "other";
#endif
  printf(",\"fileDescriptors\":{\"platform\":\"%s\",\"devFd\":", platform);
  descriptor_print_duplicate(devfd);
  printf(",\"fileport\":{\"available\":%s,\"makeportReturn\":", OMA_PROBE_FILEPORT ? "true" : "false");
#if OMA_PROBE_FILEPORT
  printf("%d,\"makeportErrno\":%d", fileport_return, fileport_error);
#else
  printf("null,\"makeportErrno\":null");
#endif
  printf(",\"duplicate\":"); descriptor_print_duplicate(fileport);
  printf("},\"namespace\":{\"heldAfterSwap\":%s,\"namedIsReplacement\":%s,\"heldAfterUnlink\":%s},\"exec\":{\"direct\":",
    held_after_swap ? "true" : "false", named_is_replacement ? "true" : "false", held_after_unlink ? "true" : "false");
  descriptor_print_exec(direct); printf(",\"fdBeforeSwap\":"); descriptor_print_exec(before_swap);
  printf(",\"namedAfterSwap\":"); descriptor_print_exec(swapped);
  printf(",\"fdAfterSwap\":"); descriptor_print_exec(after_swap);
  printf(",\"fdAfterUnlink\":"); descriptor_print_exec(after_unlink); printf("}}");
}
