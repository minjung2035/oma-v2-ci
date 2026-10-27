/* Actual POSIX oracle controls. This never claims to run a Darwin kernel. */
#define _GNU_SOURCE 1
#include <sys/types.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <fcntl.h>
#include <unistd.h>
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
static void require(int condition, const char *label) {
  if (!condition) { perror(label); exit(2); }
}
#include "descriptor-capabilities.h"
int main(int argc, char **argv) {
  if (descriptor_exec_target(argc, argv)) return 0;
  require(argc == 1, "descriptor controls take no arguments");
  printf("{\"case\":\"descriptor-oracle-controls\"");
  descriptor_capabilities_probe(argv[0]); puts("}"); return 0;
}
