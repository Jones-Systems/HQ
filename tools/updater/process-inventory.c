#define _DARWIN_C_SOURCE 1
#include <sys/types.h>
#include <sys/sysctl.h>
#include <sys/time.h>
#include <sys/proc.h>
#include <libproc.h>
#include <errno.h>
#include <inttypes.h>
#include <stdarg.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#define MAX_PROCESSES 32768u
#define MAX_OUTPUT (4u * 1024u * 1024u)
#define ENUMERATION_ATTEMPTS 3

static const char *failure_stage = "allocation";
static int failure_errno = 0;
static const char *failure_recheck = "not-run";

static void stage(const char *value) {
    failure_stage = value;
    failure_errno = 0;
    failure_recheck = "not-run";
}

struct output {
    char *bytes;
    size_t used;
};

static bool append(struct output *out, const char *format, ...) {
    va_list arguments;
    va_start(arguments, format);
    int length = vsnprintf(out->bytes + out->used, MAX_OUTPUT - out->used + 1, format, arguments);
    va_end(arguments);
    if (length < 0 || (size_t)length > MAX_OUTPUT - out->used) return false;
    out->used += (size_t)length;
    return true;
}

static bool valid_utf8(const unsigned char *text) {
    while (*text) {
        unsigned char first = *text++;
        if (first < 0x80) continue;
        unsigned int count;
        uint32_t scalar;
        uint32_t minimum;
        if (first >= 0xc2 && first <= 0xdf) { count = 1; scalar = first & 0x1f; minimum = 0x80; }
        else if (first >= 0xe0 && first <= 0xef) { count = 2; scalar = first & 0x0f; minimum = 0x800; }
        else if (first >= 0xf0 && first <= 0xf4) { count = 3; scalar = first & 0x07; minimum = 0x10000; }
        else return false;
        for (unsigned int i = 0; i < count; i++) {
            if (*text < 0x80 || *text > 0xbf) return false;
            scalar = (scalar << 6) | (*text++ & 0x3f);
        }
        if (scalar < minimum || scalar > 0x10ffff || (scalar >= 0xd800 && scalar <= 0xdfff)) return false;
    }
    return true;
}

static bool quoted(struct output *out, const char *text) {
    if (!valid_utf8((const unsigned char *)text) || !append(out, "\"")) return false;
    for (const unsigned char *byte = (const unsigned char *)text; *byte; byte++) {
        if (*byte == '"' || *byte == '\\') {
            if (!append(out, "\\%c", *byte)) return false;
        } else if (*byte < 0x20) {
            if (!append(out, "\\u%04x", (unsigned int)*byte)) return false;
        } else {
            if (out->used == MAX_OUTPUT) return false;
            out->bytes[out->used++] = (char)*byte;
            out->bytes[out->used] = '\0';
        }
    }
    return append(out, "\"");
}

static bool valid_time(const struct timeval *time) {
    return time->tv_sec > 0 && time->tv_usec >= 0 && time->tv_usec < 1000000;
}

static bool same_time(const struct timeval *left, const struct timeval *right) {
    return left->tv_sec == right->tv_sec && left->tv_usec == right->tv_usec;
}

static bool boot_time(struct timeval *boot) {
    int mib[] = { CTL_KERN, KERN_BOOTTIME };
    size_t length = sizeof(*boot);
    int result = sysctl(mib, 2, boot, &length, NULL, 0);
    if (result != 0) failure_errno = errno;
    return result == 0 && length == sizeof(*boot) && valid_time(boot);
}

/*
 * KERN_PROC supplies birth metadata without KERN_PROCARGS2 or the same-user
 * PROC_PIDTBSDINFO restriction. These SDK-visible interfaces still require
 * native qualification. XNU ac9718fb1af618d5ce8678d0dc6e8a58f252216f:
 * bsd/kern/kern_sysctl.c (sysctl_prochandle), bsd/sys/proc.h, bsd/sys/sysctl.h.
 */
static int read_process(pid_t pid, struct kinfo_proc *information) {
    int mib[] = { CTL_KERN, KERN_PROC, KERN_PROC_PID, pid };
    size_t length = sizeof(*information);
    memset(information, 0, sizeof(*information));
    if (sysctl(mib, 4, information, &length, NULL, 0) != 0) { failure_errno = errno; return -1; }
    if (length == 0) return 0;
    if (length != sizeof(*information) || information->kp_proc.p_pid != pid) return -1;
    return 1;
}

static bool same_birth(const struct kinfo_proc *left, const struct kinfo_proc *right) {
    return left->kp_proc.p_pid == right->kp_proc.p_pid && same_time(&left->kp_proc.p_starttime, &right->kp_proc.p_starttime);
}

static bool inactive(const struct kinfo_proc *expected) {
    struct kinfo_proc current;
    int found = read_process(expected->kp_proc.p_pid, &current);
    bool is_inactive = found == 0 || (found == 1 && same_birth(expected, &current) && current.kp_proc.p_stat == SZOMB);
    /* Classify only the existing recheck; uncertainty and PID reuse still fail closed. */
    if (!is_inactive) failure_recheck = found < 0 ? "unavailable" : same_birth(expected, &current) ? "same-live" : "reused";
    return is_inactive;
}

static bool executable_path(pid_t pid, char *buffer) {
    memset(buffer, 0, PROC_PIDPATHINFO_MAXSIZE);
    int length = proc_pidpath(pid, buffer, PROC_PIDPATHINFO_MAXSIZE);
    if (length <= 0) failure_errno = errno;
    return length > 0 && length < PROC_PIDPATHINFO_MAXSIZE && buffer[0] == '/' && strnlen(buffer, PROC_PIDPATHINFO_MAXSIZE) < PROC_PIDPATHINFO_MAXSIZE;
}

static bool list_processes(struct kinfo_proc **information, size_t *count) {
    int mib[] = { CTL_KERN, KERN_PROC, KERN_PROC_ALL, 0 };
    for (int attempt = 0; attempt < ENUMERATION_ATTEMPTS; attempt++) {
        size_t needed = 0;
        if (sysctl(mib, 4, NULL, &needed, NULL, 0) != 0) { failure_errno = errno; return false; }
        if (needed == 0 || needed > MAX_PROCESSES * sizeof(struct kinfo_proc)) return false;
        size_t capacity = needed + 32 * sizeof(struct kinfo_proc);
        if (capacity > MAX_PROCESSES * sizeof(struct kinfo_proc)) capacity = MAX_PROCESSES * sizeof(struct kinfo_proc);
        struct kinfo_proc *buffer = calloc(1, capacity);
        if (!buffer) { failure_errno = ENOMEM; return false; }
        size_t length = capacity;
        if (sysctl(mib, 4, buffer, &length, NULL, 0) == 0) {
            if (length == 0 || length > capacity || length % sizeof(struct kinfo_proc) != 0) { free(buffer); return false; }
            *information = buffer;
            *count = length / sizeof(struct kinfo_proc);
            return true;
        }
        int error = errno;
        failure_errno = error;
        free(buffer);
        if (error != ENOMEM) return false;
    }
    return false;
}

int main(int argc, char **argv) {
    (void)argv;
    if (argc != 1) { fputs("HQ process inventory accepts no arguments.\n", stderr); return 2; }
    struct timeval boot;
    struct timeval boot_after;
    struct kinfo_proc *processes = NULL;
    size_t count = 0;
    struct output out = { .bytes = calloc(1, MAX_OUTPUT + 1), .used = 0 };
    bool first = true;
    bool observed_self = false;
    int result = 2;
    if (!out.bytes) { failure_errno = ENOMEM; goto failure; }
    stage("boot");
    if (!boot_time(&boot)) goto failure;
    stage("enumeration");
    if (!list_processes(&processes, &count)) goto failure;
    stage("output");
    if (!append(&out, "{\"schemaVersion\":1,\"complete\":true,\"boot\":\"%jd:%06jd\",\"processes\":[", (intmax_t)boot.tv_sec, (intmax_t)boot.tv_usec)) goto failure;
    for (size_t index = 0; index < count; index++) {
        const struct kinfo_proc *listed = &processes[index];
        pid_t pid = listed->kp_proc.p_pid;
        struct kinfo_proc before;
        struct kinfo_proc middle;
        struct kinfo_proc after;
        char first_path[PROC_PIDPATHINFO_MAXSIZE];
        char second_path[PROC_PIDPATHINFO_MAXSIZE];
        stage("process-before");
        int found = read_process(pid, &before);
        if (found == 0) continue;
        if (found < 0 || !same_birth(listed, &before)) goto failure;
        if (pid == 0) {
            stage("kernel");
            /* Kernel classification uses metadata, never a mutable process name. */
            if (!(before.kp_proc.p_flag & P_SYSTEM) || before.kp_eproc.e_ppid != 0) goto failure;
            continue;
        }
        stage("process-identity");
        if (pid < 0 || !valid_time(&before.kp_proc.p_starttime) || before.kp_eproc.e_ppid < 0) goto failure;
        stage("zombie-before");
        if (before.kp_proc.p_stat == SZOMB) { if (inactive(&before)) continue; goto failure; }
        stage("path-before");
        if (!executable_path(pid, first_path)) { int original_errno = failure_errno; if (inactive(&before)) continue; failure_errno = original_errno; goto failure; }
        stage("process-middle");
        found = read_process(pid, &middle);
        if (found == 0) continue;
        if (found < 0 || !same_birth(&before, &middle) || before.kp_eproc.e_ppid != middle.kp_eproc.e_ppid) goto failure;
        stage("zombie-middle");
        if (middle.kp_proc.p_stat == SZOMB) { if (inactive(&middle)) continue; goto failure; }
        stage("path-after");
        if (!executable_path(pid, second_path)) { int original_errno = failure_errno; if (inactive(&middle)) continue; failure_errno = original_errno; goto failure; }
        stage("process-after");
        found = read_process(pid, &after);
        if (found == 0) continue;
        if (found < 0 || !same_birth(&middle, &after) || middle.kp_eproc.e_ppid != after.kp_eproc.e_ppid || strcmp(first_path, second_path) != 0) goto failure;
        stage("zombie-after");
        if (after.kp_proc.p_stat == SZOMB) { if (inactive(&after)) continue; goto failure; }
        if (pid == getpid()) observed_self = true;
        stage("output");
        if (!first && !append(&out, ",")) goto failure;
        first = false;
        if (!append(&out, "{\"pid\":%jd,\"ppid\":%jd,\"start\":\"%jd:%06jd\",\"boot\":\"%jd:%06jd\",\"executable\":", (intmax_t)pid, (intmax_t)after.kp_eproc.e_ppid, (intmax_t)after.kp_proc.p_starttime.tv_sec, (intmax_t)after.kp_proc.p_starttime.tv_usec, (intmax_t)boot.tv_sec, (intmax_t)boot.tv_usec)) goto failure;
        if (!quoted(&out, second_path) || !append(&out, "}")) goto failure;
    }
    stage("observer");
    if (!observed_self) goto failure;
    stage("boot-after");
    if (!boot_time(&boot_after) || !same_time(&boot, &boot_after)) goto failure;
    stage("output");
    if (!append(&out, "]}\n")) goto failure;
    if (fwrite(out.bytes, 1, out.used, stdout) != out.used || fflush(stdout) != 0) { failure_errno = errno; goto failure; }
    result = 0;
    goto finish;
failure:
    /* Fixed stages/recheck classes and bounded original errno expose no process identities or paths. */
    fprintf(stderr, "HQ inventory failure: stage=%s errno=%d recheck=%s\n", failure_stage, failure_errno >= 0 && failure_errno <= 4095 ? failure_errno : 0, failure_recheck);
finish:
    free(processes);
    free(out.bytes);
    return result;
}
