/* X1 keyring-sharing probe. See keyring-share.mjs for how it is driven.
 * argv[1]=="add" name payload  -> ADDED serial=N
 * argv[1]=="find" name         -> FOUND serial=N payload=... | NOTFOUND
 * argv[1]=="revoke" serial      -> REVOKED N
 */
#define _GNU_SOURCE
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <errno.h>
#include <unistd.h>
#include <sys/syscall.h>
#include <linux/keyctl.h>

typedef int key_serial_t;

static long add_key(const char *type, const char *desc, const void *payload, size_t plen, key_serial_t ring) {
  return syscall(SYS_add_key, type, desc, payload, plen, ring);
}
static long keyctl(int op, unsigned long a2, unsigned long a3, unsigned long a4, unsigned long a5) {
  return syscall(SYS_keyctl, op, a2, a3, a4, a5);
}

int main(int argc, char **argv) {
  if (argc < 2) { fprintf(stderr, "usage\n"); return 2; }
  if (!strcmp(argv[1], "add")) {
    long s = add_key("user", argv[2], argv[3], strlen(argv[3]), KEY_SPEC_USER_KEYRING);
    if (s < 0) { printf("ADD_FAILED errno=%d\n", errno); return 1; }
    printf("ADDED serial=%ld\n", s);
    return 0;
  }
  if (!strcmp(argv[1], "find")) {
    long s = keyctl(KEYCTL_SEARCH, (unsigned long)KEY_SPEC_USER_KEYRING, (unsigned long)"user", (unsigned long)argv[2], 0);
    if (s < 0) { printf("NOTFOUND errno=%d (%s)\n", errno, strerror(errno)); return 0; }
    char buf[256]; memset(buf, 0, sizeof buf);
    long n = keyctl(KEYCTL_READ, (unsigned long)s, (unsigned long)buf, sizeof buf - 1, 0);
    printf("FOUND serial=%ld payload=%.*s\n", s, n > 0 ? (int)n : 0, buf);
    return 0;
  }
  if (!strcmp(argv[1], "revoke")) {
    long s = strtol(argv[2], NULL, 10);
    keyctl(KEYCTL_REVOKE, (unsigned long)s, 0, 0, 0);
    keyctl(KEYCTL_UNLINK, (unsigned long)s, (unsigned long)KEY_SPEC_USER_KEYRING, 0, 0);
    printf("REVOKED %ld\n", s);
    return 0;
  }
  return 2;
}
