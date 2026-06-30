#define _POSIX_C_SOURCE 200809L

#include <errno.h>
#include <fcntl.h>
#include <linux/watchdog.h>
#include <limits.h>
#include <signal.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

#define X8_WATCHDOG_DEFAULT_DEVICE "/dev/watchdog0"
#define X8_WATCHDOG_DEFAULT_FEED_SEC 10U
#define X8_WATCHDOG_DEFAULT_CHECK_SEC 60U
#define X8_WATCHDOG_DEFAULT_OFFLINE_REBOOT_SEC 10800U
#define X8_WATCHDOG_DEFAULT_PING_TIMEOUT_SEC 10U
#define X8_WATCHDOG_DEFAULT_PING_HARD_TIMEOUT_SEC 30U
#define X8_WATCHDOG_DEFAULT_WATCHDOG_RETRY_SEC 5U
#define X8_WATCHDOG_POLL_NSEC 100000000L

static const char *const x8_watchdog_targets[] = {
    "100.100.100.100",
};

typedef struct x8_watchdog_options {
    const char *device;
    unsigned int feed_sec;
    unsigned int check_sec;
    unsigned int offline_reboot_sec;
    unsigned int ping_timeout_sec;
    unsigned int ping_hard_timeout_sec;
    unsigned int watchdog_retry_sec;
    bool no_watchdog;
    bool once;
} x8_watchdog_options;

static volatile sig_atomic_t g_stop_requested = 0;

static void handle_signal(int signo)
{
    (void)signo;
    g_stop_requested = 1;
}

static bool install_signal_handler(int signo)
{
    struct sigaction action;

    memset(&action, 0, sizeof(action));
    action.sa_handler = handle_signal;
    sigemptyset(&action.sa_mask);

    return sigaction(signo, &action, NULL) == 0;
}

static int64_t monotonic_sec(void)
{
    struct timespec ts;

    if (clock_gettime(CLOCK_MONOTONIC, &ts) != 0) {
        return 0;
    }

    return (int64_t)ts.tv_sec;
}

static void sleep_poll(void)
{
    struct timespec ts = {
        .tv_sec = 0,
        .tv_nsec = X8_WATCHDOG_POLL_NSEC,
    };

    while (nanosleep(&ts, &ts) != 0 && errno == EINTR && !g_stop_requested) {
    }
}

static bool parse_uint_option(const char *name,
                              const char *value,
                              unsigned int *out)
{
    char *end = NULL;
    unsigned long parsed;

    if (value == NULL || value[0] == '\0') {
        fprintf(stderr, "x8-watchdogd: %s requires a value\n", name);
        return false;
    }

    errno = 0;
    parsed = strtoul(value, &end, 10);
    if (errno != 0 || end == value || *end != '\0' || parsed == 0 ||
        parsed > UINT_MAX) {
        fprintf(stderr, "x8-watchdogd: invalid %s value: %s\n", name, value);
        return false;
    }

    *out = (unsigned int)parsed;
    return true;
}

static void print_usage(FILE *stream)
{
    fprintf(stream,
            "Usage: x8-watchdogd [OPTIONS]\n"
            "\n"
            "Options:\n"
            "  --device PATH                   Watchdog device "
            "(default " X8_WATCHDOG_DEFAULT_DEVICE ")\n"
            "  --feed-sec SECONDS              Watchdog feed interval "
            "(default %u)\n"
            "  --check-sec SECONDS             Network check interval "
            "(default %u)\n"
            "  --offline-reboot-sec SECONDS    Continuous offline window "
            "before reset (default %u)\n"
            "  --ping-timeout-sec SECONDS      ping -W timeout "
            "(default %u)\n"
            "  --ping-hard-timeout-sec SECONDS Process-level ping timeout "
            "(default %u)\n"
            "  --watchdog-retry-sec SECONDS    Retry interval for watchdog "
            "open/feed failures (default %u)\n"
            "  --no-watchdog                   Do not open or feed watchdog\n"
            "  --once                          Run one network check and exit\n"
            "  --help                          Show this help\n",
            X8_WATCHDOG_DEFAULT_FEED_SEC,
            X8_WATCHDOG_DEFAULT_CHECK_SEC,
            X8_WATCHDOG_DEFAULT_OFFLINE_REBOOT_SEC,
            X8_WATCHDOG_DEFAULT_PING_TIMEOUT_SEC,
            X8_WATCHDOG_DEFAULT_PING_HARD_TIMEOUT_SEC,
            X8_WATCHDOG_DEFAULT_WATCHDOG_RETRY_SEC);
}

static bool parse_options(int argc,
                          char **argv,
                          x8_watchdog_options *options)
{
    for (int i = 1; i < argc; i++) {
        const char *arg = argv[i];

        if (strcmp(arg, "--help") == 0) {
            print_usage(stdout);
            exit(EXIT_SUCCESS);
        } else if (strcmp(arg, "--no-watchdog") == 0) {
            options->no_watchdog = true;
        } else if (strcmp(arg, "--once") == 0) {
            options->once = true;
        } else if (strcmp(arg, "--device") == 0) {
            if (i + 1 >= argc) {
                fprintf(stderr, "x8-watchdogd: --device requires a value\n");
                return false;
            }
            options->device = argv[++i];
        } else if (strcmp(arg, "--feed-sec") == 0) {
            if (i + 1 >= argc ||
                !parse_uint_option("--feed-sec", argv[++i], &options->feed_sec)) {
                return false;
            }
        } else if (strcmp(arg, "--check-sec") == 0) {
            if (i + 1 >= argc ||
                !parse_uint_option("--check-sec", argv[++i], &options->check_sec)) {
                return false;
            }
        } else if (strcmp(arg, "--offline-reboot-sec") == 0) {
            if (i + 1 >= argc ||
                !parse_uint_option("--offline-reboot-sec",
                                   argv[++i],
                                   &options->offline_reboot_sec)) {
                return false;
            }
        } else if (strcmp(arg, "--ping-timeout-sec") == 0) {
            if (i + 1 >= argc ||
                !parse_uint_option("--ping-timeout-sec",
                                   argv[++i],
                                   &options->ping_timeout_sec)) {
                return false;
            }
        } else if (strcmp(arg, "--ping-hard-timeout-sec") == 0) {
            if (i + 1 >= argc ||
                !parse_uint_option("--ping-hard-timeout-sec",
                                   argv[++i],
                                   &options->ping_hard_timeout_sec)) {
                return false;
            }
        } else if (strcmp(arg, "--watchdog-retry-sec") == 0) {
            if (i + 1 >= argc ||
                !parse_uint_option("--watchdog-retry-sec",
                                   argv[++i],
                                   &options->watchdog_retry_sec)) {
                return false;
            }
        } else {
            fprintf(stderr, "x8-watchdogd: unknown option: %s\n", arg);
            return false;
        }
    }

    if (options->feed_sec >= options->offline_reboot_sec) {
        fprintf(stderr,
                "x8-watchdogd: --feed-sec must be lower than "
                "--offline-reboot-sec\n");
        return false;
    }

    if (options->ping_hard_timeout_sec < options->ping_timeout_sec) {
        fprintf(stderr,
                "x8-watchdogd: --ping-hard-timeout-sec must be greater "
                "than or equal to --ping-timeout-sec\n");
        return false;
    }

    return true;
}

static bool ping_target(const char *target,
                        unsigned int ping_timeout_sec,
                        unsigned int hard_timeout_sec)
{
    pid_t pid;
    int status = 0;
    char timeout_arg[32];
    int64_t deadline;

    snprintf(timeout_arg, sizeof(timeout_arg), "%u", ping_timeout_sec);

    pid = fork();
    if (pid < 0) {
        fprintf(stderr,
                "x8-watchdogd: failed to fork ping for %s: %s\n",
                target,
                strerror(errno));
        return false;
    }

    if (pid == 0) {
        int null_fd = open("/dev/null", O_WRONLY);

        if (null_fd >= 0) {
            (void)dup2(null_fd, STDOUT_FILENO);
            (void)dup2(null_fd, STDERR_FILENO);
            close(null_fd);
        }

        execlp("ping",
               "ping",
               "-c",
               "1",
               "-W",
               timeout_arg,
               target,
               (char *)NULL);
        _exit(127);
    }

    deadline = monotonic_sec() + (int64_t)hard_timeout_sec;
    while (!g_stop_requested && monotonic_sec() < deadline) {
        pid_t result = waitpid(pid, &status, WNOHANG);

        if (result == pid) {
            return WIFEXITED(status) && WEXITSTATUS(status) == 0;
        }

        if (result < 0) {
            if (errno == EINTR) {
                continue;
            }
            fprintf(stderr,
                    "x8-watchdogd: waitpid failed for ping %s: %s\n",
                    target,
                    strerror(errno));
            return false;
        }

        sleep_poll();
    }

    fprintf(stderr,
            "x8-watchdogd: ping %s timed out after %u second(s); killing pid %d\n",
            target,
            hard_timeout_sec,
            (int)pid);
    if (kill(pid, SIGTERM) == 0) {
        for (unsigned int i = 0; i < 10; i++) {
            pid_t result = waitpid(pid, &status, WNOHANG);

            if (result == pid) {
                return false;
            }
            if (result < 0) {
                if (errno == EINTR) {
                    continue;
                }
                break;
            }

            sleep_poll();
        }
    }

    kill(pid, SIGKILL);
    waitpid(pid, &status, 0);
    return false;
}

static bool network_check(const x8_watchdog_options *options)
{
    size_t target_count =
        sizeof(x8_watchdog_targets) / sizeof(x8_watchdog_targets[0]);

    for (size_t i = 0; i < target_count; i++) {
        const char *target = x8_watchdog_targets[i];

        if (ping_target(target,
                        options->ping_timeout_sec,
                        options->ping_hard_timeout_sec)) {
            printf("x8-watchdogd: reached %s\n", target);
            return true;
        }

        printf("x8-watchdogd: did not reach %s\n", target);
    }

    fprintf(stderr,
            "x8-watchdogd: failed all %zu network target(s)\n",
            target_count);
    return false;
}

static int watchdog_open_and_describe(const char *device)
{
    int fd;
    struct watchdog_info info;
    int timeout = 0;

    fd = open(device, O_WRONLY | O_CLOEXEC);
    if (fd < 0) {
        fprintf(stderr,
                "x8-watchdogd: failed to open %s: %s\n",
                device,
                strerror(errno));
        return -1;
    }

    memset(&info, 0, sizeof(info));
    if (ioctl(fd, WDIOC_GETSUPPORT, &info) == 0) {
        printf("x8-watchdogd: watchdog identity %s, options 0x%08x\n",
               info.identity[0] != '\0' ? (char *)info.identity : "<unknown>",
               info.options);
    } else {
        fprintf(stderr,
                "x8-watchdogd: WDIOC_GETSUPPORT failed: %s\n",
                strerror(errno));
    }

    if (ioctl(fd, WDIOC_GETTIMEOUT, &timeout) == 0) {
        printf("x8-watchdogd: watchdog timeout %d second(s)\n", timeout);
    } else {
        fprintf(stderr,
                "x8-watchdogd: WDIOC_GETTIMEOUT failed: %s\n",
                strerror(errno));
    }

    return fd;
}

static bool watchdog_feed(int fd)
{
    char keepalive = '\0';

    if (ioctl(fd, WDIOC_KEEPALIVE, 0) == 0) {
        return true;
    }

    if (write(fd, &keepalive, 1) == 1) {
        return true;
    }

    fprintf(stderr,
            "x8-watchdogd: watchdog feed failed: %s\n",
            strerror(errno));
    return false;
}

static void watchdog_close_fd(int fd, bool request_disarm)
{
    char magic = 'V';

    if (fd < 0) {
        return;
    }

    if (request_disarm && write(fd, &magic, 1) != 1) {
        fprintf(stderr,
                "x8-watchdogd: watchdog magic close write failed: %s\n",
                strerror(errno));
    }

    close(fd);
}

static int run_once(const x8_watchdog_options *options)
{
    bool ok = network_check(options);

    printf("x8-watchdogd: one-shot network check %s\n", ok ? "ok" : "failed");
    return ok ? EXIT_SUCCESS : EXIT_FAILURE;
}

static int run_daemon(const x8_watchdog_options *options)
{
    int watchdog_fd = -1;
    bool feeding_enabled = true;
    int64_t next_feed = monotonic_sec();
    int64_t next_check = monotonic_sec();
    int64_t next_watchdog_open = monotonic_sec();
    int64_t offline_since = 0;

    if (options->no_watchdog) {
        printf("x8-watchdogd: watchdog disabled by --no-watchdog\n");
    }

    printf("x8-watchdogd: started; check %us, feed %us, offline reset %us, watchdog retry %us\n",
           options->check_sec,
           options->feed_sec,
           options->offline_reboot_sec,
           options->watchdog_retry_sec);

    while (!g_stop_requested) {
        int64_t now = monotonic_sec();

        if (!options->no_watchdog && watchdog_fd < 0 &&
            now >= next_watchdog_open) {
            watchdog_fd = watchdog_open_and_describe(options->device);
            if (watchdog_fd >= 0) {
                if (feeding_enabled) {
                    if (watchdog_feed(watchdog_fd)) {
                        next_feed = now + (int64_t)options->feed_sec;
                    } else {
                        watchdog_close_fd(watchdog_fd, false);
                        watchdog_fd = -1;
                        next_watchdog_open =
                            now + (int64_t)options->watchdog_retry_sec;
                    }
                } else {
                    fprintf(stderr,
                            "x8-watchdogd: watchdog opened after reset "
                            "policy fired; not feeding\n");
                }
            } else {
                next_watchdog_open =
                    now + (int64_t)options->watchdog_retry_sec;
            }
        }

        if (feeding_enabled && watchdog_fd >= 0 && now >= next_feed) {
            if (!watchdog_feed(watchdog_fd)) {
                watchdog_close_fd(watchdog_fd, false);
                watchdog_fd = -1;
                next_watchdog_open =
                    now + (int64_t)options->watchdog_retry_sec;
                fprintf(stderr,
                        "x8-watchdogd: watchdog feed failed; will retry "
                        "open in %u second(s)\n",
                        options->watchdog_retry_sec);
                sleep_poll();
                continue;
            }
            next_feed = now + (int64_t)options->feed_sec;
        }

        if (now >= next_check) {
            bool ok = network_check(options);

            now = monotonic_sec();
            if (ok) {
                if (offline_since != 0) {
                    printf("x8-watchdogd: network recovered after %lld second(s)\n",
                           (long long)(now - offline_since));
                }
                offline_since = 0;
            } else {
                if (offline_since == 0) {
                    offline_since = now;
                    fprintf(stderr,
                            "x8-watchdogd: network offline timer started\n");
                } else {
                    fprintf(stderr,
                            "x8-watchdogd: network offline for %lld second(s)\n",
                            (long long)(now - offline_since));
                }

                if ((uint64_t)(now - offline_since) >=
                    (uint64_t)options->offline_reboot_sec) {
                    fprintf(stderr,
                            "x8-watchdogd: network offline for %u second(s); "
                            "stopping watchdog feed\n",
                            options->offline_reboot_sec);
                    feeding_enabled = false;
                }
            }

            next_check = now + (int64_t)options->check_sec;
        }

        sleep_poll();
    }

    printf("x8-watchdogd: shutdown requested\n");
    watchdog_close_fd(watchdog_fd, true);
    return EXIT_SUCCESS;
}

int main(int argc, char **argv)
{
    x8_watchdog_options options = {
        .device = X8_WATCHDOG_DEFAULT_DEVICE,
        .feed_sec = X8_WATCHDOG_DEFAULT_FEED_SEC,
        .check_sec = X8_WATCHDOG_DEFAULT_CHECK_SEC,
        .offline_reboot_sec = X8_WATCHDOG_DEFAULT_OFFLINE_REBOOT_SEC,
        .ping_timeout_sec = X8_WATCHDOG_DEFAULT_PING_TIMEOUT_SEC,
        .ping_hard_timeout_sec = X8_WATCHDOG_DEFAULT_PING_HARD_TIMEOUT_SEC,
        .watchdog_retry_sec = X8_WATCHDOG_DEFAULT_WATCHDOG_RETRY_SEC,
    };

    if (!parse_options(argc, argv, &options)) {
        print_usage(stderr);
        return EXIT_FAILURE;
    }

    if (!install_signal_handler(SIGINT) || !install_signal_handler(SIGTERM)) {
        fprintf(stderr,
                "x8-watchdogd: failed to install signal handler: %s\n",
                strerror(errno));
        return EXIT_FAILURE;
    }

    if (options.once) {
        return run_once(&options);
    }

    return run_daemon(&options);
}
