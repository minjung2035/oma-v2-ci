/* Minimal Darwin launch primitive: receive a TS-authored profile on FD 3,
 * close it, apply Seatbelt, then exec the absolute target. No business policy,
 * descendant supervision, credentials, entitlement or privileged service. */
#include <sandbox.h>
#include <sys/stat.h>
#include <unistd.h>
#include <errno.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

extern char **environ;
static _Noreturn void failed(const char *operation) {
  perror(operation);
  _exit(125);
}
static void receive(void *buffer, size_t length) {
  size_t at = 0;
  while (at < length) {
    size_t remaining = length - at;
    if (remaining > 65536) remaining = 65536;
    ssize_t count = read(3, (char *)buffer + at, remaining);
    if (count < 0) { if (errno == EINTR) continue; failed("Seatbelt profile read"); }
    if (count == 0) { fputs("Seatbelt profile is truncated\n", stderr); _exit(125); }
    at += (size_t)count;
  }
}
int main(int argc, char **argv) {
  if (argc < 2 || argv[1][0] != '/') {
    fputs("Seatbelt requires an absolute executable\n", stderr);
    return 125;
  }
  struct stat source;
  if (fstat(3, &source) != 0) failed("Seatbelt profile descriptor");
  if (!S_ISFIFO(source.st_mode) && !S_ISSOCK(source.st_mode)) {
    fputs("Seatbelt profile must arrive on its private byte channel\n", stderr);
    return 125;
  }
  unsigned char header[16];
  receive(header, sizeof(header));
  if (memcmp(header, "OMASBPL1", 8) != 0) {
    fputs("Seatbelt profile framing is invalid\n", stderr);
    return 125;
  }
  uint64_t declared = 0;
  for (size_t i = 8; i < sizeof(header); ++i) declared = (declared << 8) | header[i];
  if (declared == 0 || declared >= SIZE_MAX) { errno = EOVERFLOW; failed("Seatbelt profile size"); }
  size_t length = (size_t)declared;
  char *profile = malloc(length + 1);
  if (profile == NULL) failed("Seatbelt profile allocation");
  receive(profile, length);
  if (memchr(profile, 0, length) != NULL) {
    fputs("Seatbelt profile contains NUL\n", stderr);
    return 125;
  }
  unsigned char tail;
  ssize_t extra;
  do { extra = read(3, &tail, 1); } while (extra < 0 && errno == EINTR);
  if (extra < 0) failed("Seatbelt profile EOF");
  if (extra != 0) {
    fputs("Seatbelt profile has trailing bytes\n", stderr);
    return 125;
  }
  if (close(3) != 0) failed("Seatbelt profile close");
  profile[length] = 0;
  char *error = NULL;
  /* Public SDK API is deprecated without a replacement. Actual OS/SDK probe
   * failure blocks support; no private compile/apply symbols are imported. */
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
  int status = sandbox_init(profile, 0, &error);
  free(profile);
  if (status != 0) {
    fprintf(stderr, "Seatbelt apply failed: %s\n", error == NULL ? "unknown error" : error);
    if (error != NULL) sandbox_free_error(error);
    return 125;
  }
  if (error != NULL) sandbox_free_error(error);
#pragma clang diagnostic pop
  closefrom(3);
  execve(argv[1], argv + 1, environ);
  failed("Seatbelt target exec");
}
