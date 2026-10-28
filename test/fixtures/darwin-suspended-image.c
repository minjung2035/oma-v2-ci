/** Public spawn/Security experiment, not a production execution capability.
 * Only the direct, unreaped child is signalled. The Python fixture supervisor
 * bounds Security calls and owns this controller's separate process group. */
#include <CoreFoundation/CoreFoundation.h>
#include <Security/Security.h>
#include <errno.h>
#include <fcntl.h>
#include <signal.h>
#include <stdbool.h>
#include <spawn.h>
#include <stdio.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

extern char **environ;

static double now(void) {
    struct timespec value;
    if (clock_gettime(CLOCK_MONOTONIC, &value) != 0) return -1;
    return (double)value.tv_sec + (double)value.tv_nsec / 1000000000.0;
}

static int wait_event(pid_t *child, int options, int *status, double seconds) {
    const double started = now();
    if (started < 0) return -1;
    const pid_t owned = *child;
    for (;;) {
        const pid_t answer = waitpid(owned, status, options | WNOHANG);
        if (answer == owned) {
            if (WIFEXITED(*status) || WIFSIGNALED(*status)) *child = 0;
            return 1;
        }
        if (answer < 0 && errno != EINTR) {
            if (errno == ECHILD) *child = 0;
            return -1;
        }
        const double current = now();
        if (current < 0) return -1;
        if (current - started >= seconds) return 0;
        usleep(1000);
    }
}

static int present(const char *name) {
    struct stat value;
    if (lstat(name, &value) == 0) return 1;
    if (errno == ENOENT) return 0;
    return -1;
}

static long long size_of(const char *name) {
    struct stat value;
    if (stat(name, &value) != 0) return -1;
    return (long long)value.st_size;
}

struct check {
    OSStatus parsed;
    OSStatus validated;
    bool attempted;
};

static struct check validate(SecCodeRef code, const char *expression) {
    struct check answer = { .parsed = 0, .validated = 0, .attempted = false };
    CFStringRef text = CFStringCreateWithCString(NULL, expression, kCFStringEncodingUTF8);
    if (text == NULL) {
        answer.parsed = errSecAllocate;
        return answer;
    }
    SecRequirementRef requirement = NULL;
    answer.parsed = SecRequirementCreateWithString(text, kSecCSDefaultFlags, &requirement);
    CFRelease(text);
    if (answer.parsed == errSecSuccess) {
        answer.attempted = true;
        answer.validated = SecCodeCheckValidity(code, kSecCSNoNetworkAccess, requirement);
    }
    if (requirement != NULL) CFRelease(requirement);
    return answer;
}

static void print_check(const struct check *answer) {
    printf("{\"parseStatus\":%d,\"validationStatus\":", (int)answer->parsed);
    if (answer->attempted) printf("%d", (int)answer->validated);
    else printf("null");
    printf("}");
}

int main(int argc, char **argv) {
    if (argc < 6) {
        fprintf(stderr, "usage: controller primary-requirement alternate-or-dash restore-or-dash directory executable [args...]\n");
        return 2;
    }
    pid_t child = 0;
    int status = 0, stop_signal = 0, result = 2;
    bool actions_ready = false, attributes_ready = false, released = false;
    posix_spawn_file_actions_t actions;
    posix_spawnattr_t attributes;
    CFNumberRef pid_number = NULL;
    CFDictionaryRef properties = NULL;
    SecCodeRef code = NULL;
    OSStatus copied = 0;
    struct check primary = {0}, alternate = {0};
    int before_constructor = -1, before_main = -1;
    long long before_stdout = -1, before_stderr = -1;
    const bool has_alternate = strcmp(argv[2], "-") != 0;

    if (chdir(argv[4]) != 0) { perror("controller chdir"); goto cleanup; }
    int error = posix_spawn_file_actions_init(&actions);
    if (error != 0) { fprintf(stderr, "file actions init: %d\n", error); goto cleanup; }
    actions_ready = true;
    error = posix_spawn_file_actions_addopen(&actions, 0, "/dev/null", O_RDONLY, 0);
    if (error == 0) error = posix_spawn_file_actions_addopen(&actions, 1, "target.stdout", O_WRONLY | O_CREAT | O_EXCL, 0600);
    if (error == 0) error = posix_spawn_file_actions_addopen(&actions, 2, "target.stderr", O_WRONLY | O_CREAT | O_EXCL, 0600);
    if (error != 0) { fprintf(stderr, "stdio actions: %d\n", error); goto cleanup; }
    error = posix_spawnattr_init(&attributes);
    if (error != 0) { fprintf(stderr, "spawn attributes init: %d\n", error); goto cleanup; }
    attributes_ready = true;
    // Explicit opens survive CLOEXEC_DEFAULT; no SETEXEC/addinherit recipe.
    error = posix_spawnattr_setflags(&attributes, POSIX_SPAWN_START_SUSPENDED | POSIX_SPAWN_CLOEXEC_DEFAULT);
    if (error != 0) { fprintf(stderr, "spawn flags: %d\n", error); goto cleanup; }
    error = posix_spawn(&child, argv[5], &actions, &attributes, &argv[5], environ);
    if (error != 0) { child = 0; fprintf(stderr, "spawn: %d\n", error); goto cleanup; }
    if (wait_event(&child, WUNTRACED, &status, 2) != 1) {
        fprintf(stderr, "suspended child stop was not observed\n"); goto cleanup;
    }
    if (!WIFSTOPPED(status)) {
        // This wait reaped the child. Its old integer is no longer a target.
        child = 0;
        fprintf(stderr, "child exited before suspended observation\n"); goto cleanup;
    }
    stop_signal = WSTOPSIG(status);
    before_constructor = present("constructor.json");
    before_main = present("main.json");
    before_stdout = size_of("target.stdout");
    before_stderr = size_of("target.stderr");
    if (before_constructor < 0 || before_main < 0 || before_stdout < 0 || before_stderr < 0) {
        perror("before-release observation"); goto cleanup;
    }
    // The process has mapped the old executable; replace its name before the
    // first SecCode lookup. A pathname/static-signature comparison is not proof.
    if (strcmp(argv[3], "-") != 0 && rename(argv[3], argv[5]) != 0) {
        perror("restore selected pathname"); goto cleanup;
    }
    const int numeric_pid = (int)child;
    pid_number = CFNumberCreate(NULL, kCFNumberIntType, &numeric_pid);
    if (pid_number == NULL) { fprintf(stderr, "PID number allocation failed\n"); goto cleanup; }
    const void *keys[] = { kSecGuestAttributePid };
    const void *values[] = { pid_number };
    properties = CFDictionaryCreate(NULL, keys, values, 1, &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
    if (properties == NULL) { fprintf(stderr, "guest properties allocation failed\n"); goto cleanup; }
    copied = SecCodeCopyGuestWithAttributes(NULL, properties, kSecCSDefaultFlags, &code);
    if (copied == errSecSuccess && code == NULL) {
        fprintf(stderr, "guest lookup returned no code reference\n"); goto cleanup;
    }
    if (copied == errSecSuccess) {
        primary = validate(code, argv[1]);
        if (has_alternate) alternate = validate(code, argv[2]);
    }
    released = copied == errSecSuccess && primary.attempted && primary.validated == errSecSuccess;
    if (kill(child, released ? SIGCONT : SIGKILL) != 0) {
        perror("owned child release/refusal"); goto cleanup;
    }
    if (wait_event(&child, 0, &status, 5) != 1) {
        fprintf(stderr, "owned child did not exit\n"); goto cleanup;
    }
    printf("{\"stopped\":true,\"stopSignal\":%d,\"beforeRelease\":{\"constructor\":%s,\"main\":%s,\"stdoutBytes\":%lld,\"stderrBytes\":%lld},\"copyStatus\":%d,\"primary\":",
        stop_signal, before_constructor ? "true" : "false", before_main ? "true" : "false", before_stdout, before_stderr, (int)copied);
    if (copied == errSecSuccess) print_check(&primary); else printf("null");
    printf(",\"alternate\":");
    if (copied == errSecSuccess && has_alternate) print_check(&alternate); else printf("null");
    printf(",\"released\":%s,\"childReaped\":true,\"exitCode\":", released ? "true" : "false");
    if (WIFEXITED(status)) printf("%d", WEXITSTATUS(status)); else printf("null");
    printf(",\"signal\":");
    if (WIFSIGNALED(status)) printf("%d", WTERMSIG(status)); else printf("null");
    printf("}\n");
    result = 0;

cleanup:
    if (child > 0) {
        // No asynchronous reaper exists. The unreaped child pins this PID.
        if (kill(child, SIGKILL) != 0 && errno != ESRCH) { perror("cleanup kill"); result = 2; }
        pid_t joined;
        do { joined = waitpid(child, &status, 0); } while (joined < 0 && errno == EINTR);
        if (joined != child) { perror("cleanup wait"); result = 2; }
    }
    if (code != NULL) CFRelease(code);
    if (properties != NULL) CFRelease(properties);
    if (pid_number != NULL) CFRelease(pid_number);
    if (attributes_ready && posix_spawnattr_destroy(&attributes) != 0) result = 2;
    if (actions_ready && posix_spawn_file_actions_destroy(&actions) != 0) result = 2;
    return result;
}
