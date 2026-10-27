/* Actual production grammar only; this portable probe makes no Darwin
 * descriptor inheritance or execution claim. */
#include "launch-fds.h"
int main(int argc, char **argv) {
  if (argc != 2) return 2;
  struct oma_fd_policy policy = oma_parse_kept_fds(argv[1]);
  printf("[");
  for (size_t i = 0; i < policy.count; ++i)
    printf("%s%d", i == 0 ? "" : ",", policy.fds[i]);
  printf("]\n");
  free(policy.fds);
  return 0;
}
