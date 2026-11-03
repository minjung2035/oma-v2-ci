/* Prints the exact invocation execve handed over: a native candidate has no
 * interpreter that could rewrite argv[0] or the environment. */
#include <stdio.h>
#include <stdlib.h>

int main(int argc, char **argv) {
  const char *kept = getenv("OMA_PROBE_VALUE");
  const char *unset = getenv("OMA_PROBE_UNSET");
  printf("argv0=%s\n", argc > 0 ? argv[0] : "");
  for (int index = 1; index < argc; index++) printf("arg=%s\n", argv[index]);
  printf("kept=%s\n", kept == NULL ? "absent" : kept);
  printf("unset=%s\n", unset == NULL ? "absent" : unset);
  return 0;
}
